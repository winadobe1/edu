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
            // Fallback: Try static keys from sportzx_client.js (NKEY/JKEY)
            let b64_padded = b64Data.replace(/-/g, '+').replace(/_/g, '/');
            b64_padded += '=='.substring(0, (4 - b64_padded.length % 4) % 4);
            const buf = Buffer.from(b64_padded, 'base64');

            if (buf.length >= 4 && buf.readUInt32BE(0) === 0xdeadbeef) return "";

            const fallbackKeys = [
                { key: Buffer.from('6ayJ7jo@ao#pxVc%'), iv: Buffer.from('HsjJTCA7jJztpL2w') },
                { key: Buffer.from('HmIcX6iHMHfI0zji'), iv: Buffer.from('MZ63rk5cIGYEy0GY') }
            ];

            for (const {key, iv} of fallbackKeys) {
                try {
                    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
                    decipher.setAutoPadding(true);
                    const decrypted = Buffer.concat([decipher.update(buf), decipher.final()]);
                    return decrypted.toString('utf8');
                } catch (err) {}
            }
            console.error(`Decryption error on all keys: ${e.message}`);
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
            console.error(`Firebase Install error: ${e.message} - Falling back to default URL`);
            return "https://cdn-stream.top";
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
            return data.entries ? data.entries.api_url : "https://cdn-stream.top";
        } catch (e) {
            console.error(`Remote Config error: ${e.message} - Falling back to default URL`);
            return "https://cdn-stream.top";
        }
    }

    _extractClearKey(api) {
        if (!api) return null;
        if (api.trim().startsWith('{')) {
            try {
                const j = JSON.parse(api);
                if (j.keys && j.keys.length > 0) {
                    const b64tohex = (str) => Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex');
                    return { kid: b64tohex(j.keys[0].kid), key: b64tohex(j.keys[0].k) };
                }
            } catch(e) {}
        } else if (api.includes(':')) {
            const [kid, key] = api.split(':');
            return { kid: kid.trim(), key: key.trim() };
        }
        return null;
    }

    _getCleanGroupTitle(catTitle, channelTitle) {
        const title = (channelTitle || "").toLowerCase();
        if (title.includes("nova sport")) return "Nova Sports";
        if (title.includes("setanta")) return "Setanta Sports";
        if (title.includes("sky sport")) return "Sky Sports";
        if (title.includes("bein")) return "beIN Sports";
        if (title.includes("dazn")) return "DAZN";
        if (title.includes("eleven sport")) return "Eleven Sports";
        if (title.includes("supersport") || title.includes("astro supersport")) return "SuperSport";
        if (title.includes("sony sport") || title.includes("ten sports") || title.includes("ten cricket")) return "Sony Sports";
        if (title.includes("arena sport")) return "Arena Sport";
        if (title.includes("cosmote")) return "Cosmote Sport";
        if (title.includes("spotv")) return "SpoTV";
        if (title.includes("fox sport") || title.includes("fox deportes")) return "FOX Sports";
        if (title.includes("match football") || title.includes("match !")) return "Match TV";
        if (title.includes("premier sport") || title.includes("premierer")) return "Premier Sports";
        if (title.includes("wwe") || title.includes("ufc") || title.includes("ringside")) return "Combat Sports";
        if (title.includes("fancode") || title.includes("cricbuzz") || title.includes("willow")) return "Cricket";
        if (title.includes("nfl") || title.includes("nba") || title.includes("mlb")) return "US Sports";
        if (title.includes("ssc")) return "SSC Sports";
        
        const fakeCategories = ["zee5", "fc - ind", "bangla", "kolkata", "kids", "music", "information", "toffee", "tataplay in", "sonyliv ind", "sonyliv events", "sun nxt", "tv series", "chorki", "sonyliv bd", "star", "airtel tv", "toffee content", "epl bd ip", "plex all", "pluto tv", "stirr tv", "usa v2", "usa v3", "usa v4", "russian v2", "fancode bd", "fancode np", "fancode sl", "jio cinema", "jiohotstar"];
        if (fakeCategories.includes((catTitle || "").toLowerCase())) {
            return "Sports Channels";
        }

        return catTitle || "Sports Channels";
    }

    async getChannels() {
        const apiUrl = await this._getApiUrl();
        if (!apiUrl) {
            console.log("Failed to retrieve API URL");
            return [];
        }

        const channelsList = [];
        const apiBase = apiUrl.replace(/\/$/, "");

        // 1. Fetch Categories & Normal 24/7 Channels
        console.log("Fetching categories (cats.json)...");
        const catsUrl = `${apiBase}/cats.json`;
        let categories = await this._fetchAndDecrypt(catsUrl);
        if (Array.isArray(categories)) {
            for (const cat of categories) {
                if (!cat || !cat.id) continue;
                if (this.excludedCategories.includes((cat.title || "").toLowerCase())) continue;

                console.log(` -> Fetching channels for category: ${cat.title} (${cat.id})...`);
                const chUrl = `${apiBase}/channels/${cat.id}.json`;
                const channels = await this._fetchAndDecrypt(chUrl);
                if (!Array.isArray(channels)) continue;

                for (const ch of channels) {
                    if (!ch || typeof ch !== 'object') continue;
                    const link = ch.link || "";
                    if (!link) continue;

                    const streamUrl = link.split("|")[0].trim();
                    const clearkey = this._extractClearKey(ch.api);

                    channelsList.push({
                        is_event: false,
                        group_title: this._getCleanGroupTitle(cat.title, ch.title),
                        channel_title: ch.title || "Untitled Channel",
                        logo: ch.logo || "",
                        stream_url: streamUrl,
                        clearkey: clearkey,
                        id: ch.id || ""
                    });
                }
            }
        }

        // 2. Fetch Live Events (events.json)
        console.log("Fetching live events (events.json)...");
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
            const eventBanner = (event.eventInfo && event.eventInfo.eventBanner) ? event.eventInfo.eventBanner : "";

            // Grouping: "Live: {Category}" instead of unique group per match title
            const eventGroup = event.cat ? `Live: ${event.cat.charAt(0).toUpperCase() + event.cat.slice(1)}` : "Live Events";

            for (const ch of channels) {
                if (!ch || typeof ch !== 'object') continue;

                const link = ch.link || "";
                if (!link) continue;

                const streamUrl = link.split("|")[0].trim();
                const clearkey = this._extractClearKey(ch.api);

                channelsList.push({
                    is_event: true,
                    group_title: eventGroup,
                    event_title: event.title || "Untitled Event",
                    event_id: eid,
                    event_cat: event.cat || "",
                    event_time: eventTimeFull,
                    channel_title: ch.title,
                    logo: eventBanner || ch.logo || "",
                    stream_url: streamUrl,
                    clearkey: clearkey
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
            if (!ch.stream_url || (!ch.stream_url.toLowerCase().includes(".mpd") && !ch.stream_url.toLowerCase().includes(".m3u8"))) {
                continue;
            }

            included++;

            let nomePulito = "";
            if (ch.is_event) {
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
                nomePulito = nomeFinale.replace(/[^\w\s\-:\(\),\.']/g, ' ').trim();
            } else {
                nomePulito = (ch.channel_title || "Channel").replace(/[^\w\s\-:\(\),\.']/g, ' ').trim();
            }

            const gruppo = ch.group_title || "Sportzx";
            const logo = ch.logo || genericLogo;

            const tvg = nomePulito.toLowerCase().replace(/[^a-z0-9]/g, '');
            const tvgId = tvg ? tvg.substring(0, 50) : `sportzx-${included}`;

            lines.push(`#EXTINF:-1 tvg-id="${tvgId}" tvg-logo="${logo}" group-title="${gruppo}",${nomePulito}`);

            if (ch.clearkey && ch.clearkey.kid && ch.clearkey.key) {
                lines.push("#KODIPROP:inputstream.adaptive.license_type=clearkey");
                lines.push(`#KODIPROP:inputstream.adaptive.license_key={"${ch.clearkey.kid}":"${ch.clearkey.key}"}`);
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
    console.log(`Found ${canali.length} total channels/streams`);

    if (canali.length > 0) {
        console.log("Creating playlist Sportzx.m3u8 ...");
        client.generateM3u(canali, "Sportzx.m3u8", "https://upload.wikimedia.org/wikipedia/commons/c/c2/Serie_A.png");
    } else {
        console.log("No channels found");
    }
}

main();
