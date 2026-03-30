const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const zlib = require('zlib');

const APP_PASSWORD = "oAR80SGuX3EEjUGFRwLFKBTiris=";

class SportzxClient {
    constructor(excludedCategories = [], timeout = 12000) {
        this.excludedCategories = excludedCategories.map(c => c.toLowerCase());
        this.timeout = timeout;
        this.baseHeaders = {
            "User-Agent": "Dalvik/2.1.0 (Linux; Android 13)",
            "Accept-Encoding": "gzip"
        };
    }

    _generateAesKeyIv(s) {
        const CHARSET = Buffer.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+!@#$%&=");
        const data = Buffer.from(s, 'utf-8');
        const n = data.length;

        const u32 = (x) => x >>> 0; 

        let u = 0x811c9dc5;
        for (let i = 0; i < n; i++) {
            u = Math.imul(u ^ data[i], 0x1000193) >>> 0;
        }

        const key = Buffer.alloc(16);
        for (let i = 0; i < 16; i++) {
            const b = data[i % n];
            u = u32(Math.imul(u, 0x1f) + (i ^ b));
            key[i] = CHARSET[u % CHARSET.length];
        }

        u = 0x811c832a;
        for (let i = 0; i < n; i++) {
            u = Math.imul(u ^ data[i], 0x1000193) >>> 0;
        }

        const iv = Buffer.alloc(16);
        let idx = 0;
        let acc = 0;
        while (idx !== 0x30) {
            const b = data[idx % n];
            u = u32(Math.imul(u, 0x1d) + (acc ^ b));
            iv[Math.floor(idx / 3)] = CHARSET[u % CHARSET.length];
            idx += 3;
            acc = u32(acc + 7);
        }

        return { key, iv };
    }

    _decryptData(b64Data) {
        if (!b64Data || !b64Data.trim()) return "";

        try {
            const ct = Buffer.from(b64Data, 'base64');
            const { key, iv } = this._generateAesKeyIv(APP_PASSWORD);
            
            const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
            decipher.setAutoPadding(false); 
            let pt = Buffer.concat([decipher.update(ct), decipher.final()]);

            const pad = pt[pt.length - 1];
            if (pad >= 1 && pad <= 16) {
                pt = pt.slice(0, pt.length - pad);
            }

            return pt.toString('utf-8', 0, pt.length).replace(/\uFFFD/g, '');
        } catch (e) {
            console.error(`Decryption error: ${e.message}`);
            return "";
        }
    }

    async _fetchAndDecrypt(url) {
        try {
            const r = await fetch(url, { headers: this.baseHeaders, signal: AbortSignal.timeout(this.timeout) });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            
            const jsonResponse = await r.json();
            const encrypted = jsonResponse.data || "";
            const decrypted = this._decryptData(encrypted);
            if (!decrypted) return {};
            return JSON.parse(decrypted);
        } catch (e) {
            console.error(`Fetch/decrypt failed ${url}: ${e.message}`);
            return {};
        }
    }

    async _getApiUrl() {
        const installUrl = "https://firebaseinstallations.googleapis.com/v1/projects/sportzx-7cc3f/installations";
        const installHeaders = {
            ...this.baseHeaders,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Android-Cert": "A0047CD121AE5F71048D41854702C52814E2AE2B",
            "X-Android-Package": "com.sportzx.live",
            "x-firebase-client": "H4sIAAAAAAAAAKtWykhNLCpJSk0sKVayio7VUSpLLSrOzM9TslIyUqoFAFyivEQfAAAA",
            "x-goog-api-key": "AIzaSyBa5qiq95T97xe4uSYlKo0Wosmye_UEf6w",
        };
        const installBody = {
            "fid": "eOaLWBo8S7S1oN-vb23mkf",
            "appId": "1:446339309956:android:b26582b5d2ad841861bdd1",
            "authVersion": "FIS_v2",
            "sdkVersion": "a:18.0.0"
        };

        let authToken;
        try {
            const r = await fetch(installUrl, {
                method: 'POST',
                headers: installHeaders,
                body: JSON.stringify(installBody),
                signal: AbortSignal.timeout(this.timeout)
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            authToken = data.authToken.token;
        } catch (e) {
            console.error(`Firebase Install error: ${e.message}`);
            return null;
        }

        const configUrl = "https://firebaseremoteconfig.googleapis.com/v1/projects/446339309956/namespaces/firebase:fetch";
        const configHeaders = {
            ...this.baseHeaders,
            "Content-Type": "application/json",
            "X-Android-Cert": "A0047CD121AE5F71048D41854702C52814E2AE2B",
            "X-Android-Package": "com.sportzx.live",
            "X-Firebase-RC-Fetch-Type": "BASE/1",
            "X-Goog-Api-Key": "AIzaSyBa5qiq95T97xe4uSYlKo0Wosmye_UEf6w",
            "X-Goog-Firebase-Installations-Auth": authToken,
        };
        const configBody = {
            "appVersion": "2.1",
            "firstOpenTime": "2025-11-10T16:00:00.000Z",
            "timeZone": "Europe/Rome",
            "appInstanceIdToken": authToken,
            "languageCode": "it-IT",
            "appBuild": "12",
            "appInstanceId": "eOaLWBo8S7S1oN-vb23mkf",
            "countryCode": "IT",
            "appId": "1:446339309956:android:b26582b5d2ad841861bdd1",
            "platformVersion": "33",
            "sdkVersion": "22.1.2",
            "packageName": "com.sportzx.live"
        };

        try {
            const r = await fetch(configUrl, {
                method: 'POST',
                headers: configHeaders,
                body: JSON.stringify(configBody),
                signal: AbortSignal.timeout(this.timeout)
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            return data.entries ? data.entries.api_url : null;
        } catch (e) {
            console.error(`Remote Config error: ${e.message}`);
            return null;
        }
    }

    async getChannels() {
        const apiUrl = await this._getApiUrl();
        if (!apiUrl) {
            console.log("Failed to retrieve API URL");
            return [];
        }

        const channelsList = [];
        const apiBase = apiUrl.replace(/\/$/, "");
        
        const eventsUrl = `${apiBase}/events.json`;
        let events = await this._fetchAndDecrypt(eventsUrl);
        if (!Array.isArray(events)) events = [];

        const validEvents = events.filter(e => 
            e && typeof e === 'object' && e.cat && !this.excludedCategories.includes(e.cat.toLowerCase())
        );

        for (const event of validEvents) {
            const eid = event.id;
            if (!eid) continue;

            const chUrl = `${apiBase}/channels/${eid}.json`;
            const channels = await this._fetchAndDecrypt(chUrl);

            if (!Array.isArray(channels)) continue;

            const startTime = (event.eventInfo && event.eventInfo.startTime) ? event.eventInfo.startTime : "";
            const eventTimeFull = startTime ? startTime.substring(0, 16).replace(/\//g, "-") : "";

            for (const ch of channels) {
                if (!ch || typeof ch !== 'object') continue;

                const link = ch.link || "";
                if (!link) continue;

                const streamUrl = link.split("|")[0].trim();
                let keyid = null;
                let key = null;
                const apiVal = ch.api;
                if (apiVal && apiVal.includes(":")) {
                    [keyid, key] = apiVal.split(/:(.+)/);
                }

                channelsList.push({
                    event_title: event.title || "Untitled Event",
                    event_id: eid,
                    event_cat: event.cat || "",
                    event_name: (event.eventInfo && event.eventInfo.eventName) ? event.eventInfo.eventName : "",
                    event_time: eventTimeFull,
                    channel_title: ch.title,
                    stream_url: streamUrl,
                    keyid: keyid,
                    key: key,
                    api: apiVal,
                });
            }
        }
        return channelsList;
    }

    _increaseTimeByOneHour(timeStr) {
        if (!timeStr || timeStr.length < 5 || !timeStr.includes(':')) return timeStr;

        try {
            const parts = timeStr.split(" ");
            const timePart = parts[parts.length - 1].substring(0, 5);
            let [hh, mm] = timePart.split(':').map(Number);
            
            if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
                hh = (hh + 1) % 24;
                return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
            }
            return timePart;
        } catch {
            return timeStr;
        }
    }

    generateM3u(channels, filename = "Sportzx.m3u8", genericLogo = "https://via.placeholder.com/512/000000/FFFFFF?text=Sport") {
        let lines = ["#EXTM3U", "#EXT-X-VERSION:3", ""];
        let included = 0;

        for (const ch of channels) {
            if (!ch.stream_url || (!ch.stream_url.toLowerCase().endsWith(".mpd") && !ch.stream_url.toLowerCase().endsWith(".m3u8"))) {
                continue;
            }

            included++;

            const evento = (ch.event_title || "Event").trim();

            let orarioOriginale = "";
            if (ch.event_time && ch.event_time.length >= 11) {
                const parti = ch.event_time.split(" ");
                if (parti.length >= 2) orarioOriginale = parti[1].substring(0, 5);
            }

            const orarioAumentato = this._increaseTimeByOneHour(orarioOriginale);
            const orarioPart = orarioAumentato ? ` ${orarioAumentato}` : "";

            let canale = "";
            if (ch.channel_title && ch.channel_title.trim()) {
                const titCanale = ch.channel_title.trim();
                if (!evento.toLowerCase().includes(titCanale.toLowerCase())) {
                    canale = ` (${titCanale})`;
                }
            }

            const nomeFinale = `${evento}${orarioPart}${canale}`.trim();
            const nomePulito = nomeFinale.replace(/[^\w\s\-:\(\),\.']/g, ' ').trim();

            const gruppo = ch.event_cat ? ch.event_cat.charAt(0).toUpperCase() + ch.event_cat.slice(1) : "Sportzx";

            const tvg = nomePulito.toLowerCase().replace(/[^a-z0-9]/g, '');
            const tvgId = tvg ? tvg.substring(0, 50) : `sportzx-${ch.event_id.substring(0, 8)}`;

            lines.push(`#EXTINF:-1 tvg-id="${tvgId}" tvg-logo="${genericLogo}" group-title="${gruppo}",${nomePulito}`);

            if (ch.keyid && ch.key) {
                lines.push("#KODIPROP:inputstream.adaptive.license_type=clearkey");
                lines.push(`#KODIPROP:inputstream.adaptive.license_key=${ch.keyid}:${ch.key}`);
            }

            lines.push(ch.stream_url);
            lines.push("");
        }

        const contenuto = lines.join("\n").trimEnd();
        try {
            fs.writeFileSync(filename, contenuto + "\n", 'utf-8');
            console.log(`Playlist created: ${filename}`);
            console.log(`Channels added: ${included}`);
        } catch (e) {
            console.log(`Error saving: ${e.message}`);
        }
        return contenuto;
    }
}

async function main() {
    const client = new SportzxClient(["adult", "test", "xxx"], 12000);

    console.log("Fetching channels...");
    const canali = await client.getChannels();
    console.log(`Found ${canali.length} total channels`);

    if (canali.length > 0) {
        console.log("Creating playlist Sportzx.m3u8 ...");
        client.generateM3u(canali, "Sportzx.m3u8", "https://upload.wikimedia.org/wikipedia/commons/c/c2/Serie_A.png");
    } else {
        console.log("No channels found");
    }
}

main();
