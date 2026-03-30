const fs = require('fs');

// ==============================
// CONFIG
// ==============================
const DEBUG = true;
const DEFAULT_LOGO = "https://viverediturismofestival.it/wp-content/uploads/2025/10/Sponsor-piccolopartner-2025-10-24T180159.016.png";
const OUTPUT_M3U = "sport_lastminute.m3u8";
const HOME_URL = "https://test34344.herokuapp.com/filter.php";
const PASSWORD = "MandraKodi3";
const DEVICE_ID = "2K1WPN";
const VERSION = "2.0.0";
const USER_AGENT = `MandraKodi2@@${VERSION}@@${PASSWORD}@@${DEVICE_ID}`;

// ==============================
// LOGGER
// ==============================
function log(msg, level = "INFO") {
    if (DEBUG) {
        console.log(`[${level}] ${msg}`);
    }
}

// ==============================
// UTILITY
// ==============================
function cleanTitle(t) {
    return t.replace(/\[\/?[a-zA-Z]+[^\]]*\]/gi, "").trim();
}

// =====================================================
// DECODER AMSTAFF RAW
// =====================================================
function decodeAmstaffRaw(encodedStr) {
    log("Attempting AMSTAFF decode", "AMSTAFF");
    
    const prefixes = [
        "amstaff@@", "amstaffd@@", "amstaf@@", "mstf@@",
        "https://amstaff@@", "http://amstaff@@",
        "amstaff:https://", "amstaffd:https://"
    ];
    
    let encoded = encodedStr;
    const original = encoded;
    
    for (const p of prefixes) {
        if (encoded.toLowerCase().startsWith(p)) {
            encoded = encoded.substring(p.length).trimStart();
            log(`Removed prefix: ${p}`, "STRIP");
            break;
        }
    }

    encoded = encoded.replace(/[\n\r]/g, "").trim();
    
    // Caso pipe: url|kid:key   (accetta anche 0000)
    if (encoded.includes("|")) {
        try {
            const parts = encoded.split("|");
            const keyPart = parts.pop().trim();
            const urlPart = parts.join("|").trim();
            
            if (urlPart.startsWith("http://") || urlPart.startsWith("https://")) {
                let keyId = "";
                let key = keyPart;
                if (keyPart.includes(":")) {
                    const kParts = keyPart.split(":");
                    keyId = kParts[0].trim();
                    key = kParts.slice(1).join(":").trim();
                }
                
                log(`AMSTAFF OK (pipe) → ${urlPart}  key=${key.substring(0, 12)}${key.length > 12 ? '...' : ''}`, "OK");
                return {
                    type: "amstaff",
                    url: urlPart,
                    key_id: keyId,
                    key: key
                };
            }
        } catch (e) {
            log(`Error parsing pipe: ${e.message}`, "ERROR");
        }
    }

    // Fallback base64
    const attempts = [];

    function tryDecode(s) {
        try {
            const sClean = s.replace(/[^A-Za-z0-9+/=]/g, "");
            const missing = sClean.length % 4;
            const padded = sClean + (missing ? "=".repeat(4 - missing) : "");
            const d = Buffer.from(padded, 'base64').toString('utf-8').trim();
            if (d && !d.includes('')) {
                attempts.push(d);
            }
        } catch (e) {
            // ignore
        }
    }

    tryDecode(encoded);
    if (encoded !== original) {
        tryDecode(original);
    }

    if (attempts.length > 0) {
        let decoded = attempts[0];
        if (decoded.includes("##")) {
            decoded = decoded.split("##")[0].trim();
        }

        if (decoded.includes("|")) {
            try {
                const parts = decoded.split("|");
                const rest = parts.pop().trim();
                const url = parts.join("|").trim();
                if (rest.includes(":")) {
                    const kParts = rest.split(":");
                    const kid = kParts[0].trim();
                    const key = kParts.slice(1).join(":").trim();
                    log(`AMSTAFF base64+pipe OK → ${url}`, "OK");
                    return {
                        type: "amstaff",
                        url: url,
                        key_id: kid,
                        key: key
                    };
                }
            } catch (e) {
                // ignore
            }
        }
    }

    log("AMSTAFF format not recognized", "DROP");
    return null;
}

// =====================================================
// UNIVERSAL STREAM DECODER
// =====================================================
function decodeStream(value) {
    if (!value) {
        log("Empty resolve", "DROP");
        return null;
    }
    
    value = value.trim();
    log(`Decoding → ${value.substring(0, 120)}${value.length > 120 ? '...' : ''}`, "DECODE");

    if (value.toLowerCase().startsWith("freeshot@@")) {
        log("Freeshot ignored", "DROP");
        return null;
    }

    // Prova AMSTAFF per primo
    const amstaff = decodeAmstaffRaw(value);
    if (amstaff) {
        return amstaff;
    }

    // URL diretto semplice
    if (value.startsWith("http://") || value.startsWith("https://")) {
        const keyIdMatch = value.match(/key_id=([A-Za-z0-9-_]+)/);
        const keyMatch = value.match(/key=([A-Za-z0-9-_/=]+)/);
        return {
            type: "direct",
            url: value,
            key_id: keyIdMatch ? keyIdMatch[1] : "",
            key: keyMatch ? keyMatch[1] : ""
        };
    }

    log("No decoder applicable", "DROP");
    return null;
}

// =====================================================
// KODI PROPERTIES
// =====================================================
function buildKodiProps(stream) {
    const props = [];
    const url = (stream.url || "").toLowerCase();

    if (url.includes(".mpd")) {
        props.push("#KODIPROP:inputstream.adaptive.manifest_type=mpd");
    } else if (url.includes(".m3u8")) {
        props.push("#KODIPROP:inputstream.adaptive.manifest_type=hls");
    }

    const keyId = (stream.key_id || "").trim();
    const key = (stream.key || "").trim();

    if (keyId && key) {
        props.push("#KODIPROP:inputstream.adaptive.license_type=clearkey");
        props.push(`#KODIPROP:inputstream.adaptive.license_key=${keyId}:${key}`);
    }

    return props;
}

// =====================================================
// JSON PARSER
// =====================================================
function extractChannels(obj, out) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        if ("title" in obj && "myresolve" in obj) {
            const title = cleanTitle(obj.title);
            const resolve = obj.myresolve;
            log(`Channel → ${title}`, "FOUND");
            out.push({ title: title, resolve: resolve });
        }
        for (const v of Object.values(obj)) {
            extractChannels(v, out);
        }
    } else if (Array.isArray(obj)) {
        for (const item of obj) {
            extractChannels(item, out);
        }
    }
    return out;
}

function findCategoryLink(data, name) {
    name = name.toUpperCase();
    let found = null;
    function search(x) {
        if (found) return;
        if (x && typeof x === 'object' && !Array.isArray(x)) {
            const title = x.title ? x.title.toUpperCase() : "";
            if (title.includes(name) && "externallink" in x) {
                found = x.externallink;
                return;
            }
            for (const v of Object.values(x)) {
                search(v);
            }
        } else if (Array.isArray(x)) {
            for (const i of x) {
                search(i);
            }
        }
    }
    search(data);
    return found;
}

// =====================================================
// FETCH CHANNELS
// =====================================================
async function fetchAmstaffChannels() {
    const headers = { "User-Agent": USER_AGENT };
    let lastJson;
    try {
        const r1 = await fetch(HOME_URL, { headers });
        if (!r1.ok) throw new Error(`HTTP ${r1.status}`);
        const home = await r1.json();
        
        const sportLink = findCategoryLink(home, "SPORT");
        if (!sportLink) return [];
        
        const r2 = await fetch(sportLink, { headers });
        if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
        const sportJson = await r2.json();
        
        const lastLink = findCategoryLink(sportJson, "LAST MINUTE");
        if (!lastLink) return [];
        
        const r3 = await fetch(lastLink, { headers });
        if (!r3.ok) throw new Error(`HTTP ${r3.status}`);
        lastJson = await r3.json();
        
    } catch (e) {
        log(`Fetch error: ${e.message}`, "ERROR");
        return [];
    }

    const rawChannels = extractChannels(lastJson, []);
    log(`Found ${rawChannels.length} raw channels`, "STATS");

    const final = [];
    for (const ch of rawChannels) {
        const decoded = decodeStream(ch.resolve);
        if (decoded) {
            decoded.title = ch.title;
            final.push(decoded);
        }
    }
    
    log(`Successfully decoded: ${final.length}`, "STATS");
    return final;
}

// =====================================================
// PULIZIA - NESSUNA DEDUPLICA
// =====================================================
function cleanAndDedupChannels(channels) {
    log(`No deduplication applied → kept all ${channels.length} channels (including duplicates)`, "INFO");
    return channels;
}

// =====================================================
// GENERA M3U 
// =====================================================
function generateM3u(channels) {
    let m3u = "#EXTM3U\n\n";

    for (const ch of channels) {
        const title = ch.title;
        const url = ch.url || "";
        let keyId = (ch.key_id || "").trim();
        let key = (ch.key || "").trim();

        const tvgId = title.replace(/[^A-Za-z0-9]/g, "").toLowerCase();

        // Placeholder → forziamo 0000
        if (!key || key === "0000" || key === "0" || key.length <= 8) {
            key = "0000";
            if (!keyId) {
                keyId = "00000000000000000000000000000000";
            }
        }

        // We create a copy to not mutate original
        ch.key_id = keyId;
        ch.key = key;

        let props = buildKodiProps(ch);

        // Override per 0000
        if (key === "0000") {
            props = props.filter(p => !p.includes("license_key") && !p.includes("license_type"));
            props.push("#KODIPROP:inputstream.adaptive.license_type=clearkey");
            props.push("#KODIPROP:inputstream.adaptive.license_key=0000");
        }

        m3u += `#EXTINF:-1 tvg-id="${tvgId}" tvg-logo="${DEFAULT_LOGO}" group-title="LAST MINUTE",${title}\n`;
        for (const p of props) {
            m3u += p + "\n";
        }
        m3u += url + "\n\n";
    }

    try {
        fs.writeFileSync(OUTPUT_M3U, m3u, 'utf-8');
        log(`Playlist generated: ${OUTPUT_M3U}  (${channels.length} channels)`, "DONE");
    } catch (e) {
        log(`Error saving: ${e.message}`, "ERROR");
    }
}

// =====================================================
// MAIN
// =====================================================
async function main() {
    const channels = await fetchAmstaffChannels();
    if (channels && channels.length > 0) {
        const cleaned = cleanAndDedupChannels(channels);
        generateM3u(cleaned);
    } else {
        log("No channels retrieved", "FAIL");
    }
}

main();
