const fs = require('fs');
const https = require('https');

// ==============================
// CONFIG
// ==============================
const DEFAULT_LOGO = "https://skygo.sky.it/etc/designs/skygo/img/sky-logo@2x.png";
const OUTPUT_M3U = "sky.m3u8";
const AMSTAFF_URL = "https://test34344.herokuapp.com/filter.php?numTest=A1A260";

const PASSWORD = "MandraKodi3";
const DEVICE_ID = "2K1WPN";
const VERSION = "2.0.0";
const USER_AGENT = `MandraKodi2@@${VERSION}@@${PASSWORD}@@${DEVICE_ID}`;

// ==============================
// DATABASE CANALI
// ==============================
const CHANNELS_DB = {
    "cinemaaction": { nome: "Sky Cinema Action", logo: "https://pixel.disco.nowtv.it/logo/skychb_206_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Cinema" },
    "cinemastories": { nome: "Sky Cinema Stories", logo: "https://static.skyassets.com/contentstack/assets/blt4b099fa9cc3801a6/bltc18b20583b1e4d5c/69298d9f7d013486e53a81ee/logo_sky_cinema_stories.png?downsize=640:*&output-format=jpg", group: "Sky Cinema" },
    "cinemacomedy": { nome: "Sky Cinema Comedy", logo: "https://pixel.disco.nowtv.it/logo/skychb_30_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Cinema" },
    "cinemadrama": { nome: "Sky Cinema Drama", logo: "https://pixel.disco.nowtv.it/logo/skychb_769_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Cinema" },
    "cinemadue": { nome: "Sky Cinema Due", logo: "https://pixel.disco.nowtv.it/logo/skychb_564_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Cinema" },
    "cinemauno": { nome: "Sky Cinema Uno", logo: "https://pixel.disco.nowtv.it/logo/skychb_202_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Cinema" },
    "cinemafamily": { nome: "Sky Cinema Family", logo: "https://pixel.disco.nowtv.it/logo/skychb_255_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Cinema" },
    "cinemasuspense": { nome: "Sky Cinema Suspense", logo: "https://pixel.disco.nowtv.it/logo/skychb_47_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Cinema" },
    "cinemaromance": { nome: "Sky Cinema Romance", logo: "https://upload.wikimedia.org/wikipedia/en/thumb/9/91/Sky_Cinema_Romance_-_2021_logo.svg/960px-Sky_Cinema_Romance_-_2021_logo.svg.png", group: "Sky Cinema" },
    "cinemacollection": { nome: "Sky Cinema Collection", logo: "https://pixel.disco.nowtv.it/logo/skychb_204_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Cinema" },
    "sportf1": { nome: "Sky Sport F1", logo: "https://pixel.disco.nowtv.it/logo/skychb_478_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sport24": { nome: "Sky Sport 24", logo: "https://pixel.disco.nowtv.it/logo/skychb_35_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sportuno": { nome: "Sky Sport Uno", logo: "https://pixel.disco.nowtv.it/logo/skychb_23_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sportmotogp": { nome: "Sky Sport MotoGP", logo: "https://pixel.disco.nowtv.it/logo/skychb_483_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sportcalcio": { nome: "Sky Sport Calcio", logo: "https://pixel.disco.nowtv.it/logo/skychb_209_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sportbasket": { nome: "Sky Sport Basket", logo: "https://pixel.disco.nowtv.it/logo/skychb_764_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sportmax": { nome: "Sky Sport Max", logo: "https://pixel.disco.nowtv.it/logo/skychb_248_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sportmix": { nome: "Sky Sport Mix", logo: "https://pixel.disco.nowtv.it/logo/skychb_579_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sportarena": { nome: "Sky Sport Arena", logo: "https://pixel.disco.nowtv.it/logo/skychb_24_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sporttennis": { nome: "Sky Sport Tennis", logo: "https://pixel.disco.nowtv.it/logo/skychb_559_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sportlegend": { nome: "Sky Sport Legend", logo: "https://pixel.disco.nowtv.it/logo/skychb_578_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sportgolf": { nome: "Sky Sport Golf", logo: "https://pixel.disco.nowtv.it/logo/skychb_768_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sport251": { nome: "Sky Sport 251", logo: "https://pixel.disco.nowtv.it/logo/skychb_917_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sport252": { nome: "Sky Sport 252", logo: "https://pixel.disco.nowtv.it/logo/skychb_951_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sport253": { nome: "Sky Sport 253", logo: "https://pixel.disco.nowtv.it/logo/skychb_233_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sport254": { nome: "Sky Sport 254", logo: "https://pixel.disco.nowtv.it/logo/skychb_234_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sport255": { nome: "Sky Sport 255", logo: "https://pixel.disco.nowtv.it/logo/skychb_910_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sport256": { nome: "Sky Sport 256", logo: "https://pixel.disco.nowtv.it/logo/skychb_912_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sport257": { nome: "Sky Sport 257", logo: "https://pixel.disco.nowtv.it/logo/skychb_775_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sport258": { nome: "Sky Sport 258", logo: "https://pixel.disco.nowtv.it/logo/skychb_912_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "sport259": { nome: "Sky Sport 259", logo: "https://pixel.disco.nowtv.it/logo/skychb_613_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Sport" },
    "dazn": { nome: "Dazn 1", logo: "https://upload.wikimedia.org/wikipedia/commons/e/e3/Tv-channel-%E2%94%82-dazn-1.png", group: "Sky Sport" },
    "uno": { nome: "Sky Uno", logo: "https://pixel.disco.nowtv.it/logo/skychb_477_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "unoplus": { nome: "Sky Uno", logo: "https://pixel.disco.nowtv.it/logo/skychb_477_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "atlantic": { nome: "Sky Atlantic", logo: "https://pixel.disco.nowtv.it/logo/skychb_226_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "serie": { nome: "Sky Serie", logo: "https://pixel.disco.nowtv.it/logo/skychb_684_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "crime": { nome: "Sky Crime", logo: "https://pixel.disco.nowtv.it/logo/skychb_249_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "investigation": { nome: "Sky Investigation", logo: "https://pixel.disco.nowtv.it/logo/skychb_686_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "nature": { nome: "Sky Nature", logo: "https://pixel.disco.nowtv.it/logo/skychb_695_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "documentaries": { nome: "Sky Documentaries", logo: "https://pixel.disco.nowtv.it/logo/skychb_697_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "adventure": { nome: "Sky Adventure", logo: "https://pixel.disco.nowtv.it/logo/skychb_961_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "collection": { nome: "Sky Collection", logo: "https://images.contentstack.io/v3/assets/blt4b099fa9cc3801a6/blt6210e5c9e5633b2c/69088303a15f04806ab5deed/logo_sky_collection.png", group: "Sky Intrattenimento" },
    "comedycentral": { nome: "Comedy Central", logo: "https://pixel.disco.nowtv.it/logo/skychb_404_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "history": { nome: "History Channel", logo: "https://pixel.disco.nowtv.it/logo/skychb_513_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "arte": { nome: "Sky Arte", logo: "https://pixel.disco.nowtv.it/logo/skychb_74_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "mtv": { nome: "MTV", logo: "https://pixel.disco.nowtv.it/logo/skychb_763_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "tg24": { nome: "Sky TG24", logo: "https://pixel.disco.nowtv.it/logo/skychb_519_lightnow/LOGO_CHANNEL_DARK/4000?language=it-IT&proposition=NOWOTT", group: "Sky Intrattenimento" },
    "cartoonnetwork": { nome: "Cartoon Network", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/italy/cartoon-network-it.png", group: "Sky Bambini" },
    "nickjr": { nome: "Nick Junior", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/italy/nick-jr-it.png", group: "Sky Bambini" },
    "boomerang": { nome: "Boomerang", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/italy/boomerang-it.png", group: "Sky Bambini" },
    "nickelodeon": { nome: "Nickelodeon", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/italy/nickelodeon-it.png", group: "Sky Bambini" },
    "mrbean": { nome: "Mr Bean Channel", logo: "https://i.postimg.cc/rmwVGQNn/Mr-Bean-29-logo-svg.png", group: "Sky Bambini" },
    "deakids": { nome: "Deakids", logo: "https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/italy/dea-kids-it.png", group: "Sky Bambini" }
};

// ==============================
// UTILS
// ==============================
function cleanM3uText(text) {
    if (!text) return text;
    text = text.replace(/\[\/?COLOR[^\]]*\]/gi, "");
    return text.replace(/\s+/g, " ").trim();
}

function normalize(text) {
    return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchChannel(title) {
    const key = normalize(title);
    for (const [k, v] of Object.entries(CHANNELS_DB)) {
        if (key.includes(k) || key.includes(normalize(v.nome))) {
            return v;
        }
    }
    return null;
}

// ==============================
// DECODE AMSTAFF
// ==============================
function decodeAmstaff(encoded) {
    if (encoded.startsWith("amstaff@@")) {
        encoded = encoded.substring(9);
    }
    encoded = encoded.trim();
    while (encoded.length % 4 !== 0) {
        encoded += "=";
    }
    
    let decoded;
    try {
        decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    } catch(e) {
        return null;
    }

    if (!decoded.includes("|") || !decoded.includes(":")) return null;

    const parts = decoded.split("|");
    if (parts.length < 2) return null;
    const url = parts[0];
    const keyPart = parts.slice(1).join("|"); // handles cases if there are more pipes

    const keyParts = keyPart.split(":");
    if (keyParts.length < 2) return null;
    const keyId = keyParts[0];
    const key = keyParts.slice(1).join(":");

    return [url, keyId, key];
}

// ==============================
// FETCH
// ==============================
function extractWithRegex(text) {
    const results = [];
    const regex = /"title"\s*:\s*"([^"]+)"[\s\S]*?"myresolve"\s*:\s*"([^"]+)"/ig;
    let match;
    while ((match = regex.exec(text)) !== null) {
        results.push([match[1], match[2]]);
    }
    return results;
}

async function fetchAmstaffChannels() {
    return new Promise((resolve, reject) => {
        const req = https.get(AMSTAFF_URL, {
            headers: {
                "User-Agent": USER_AGENT
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const text = data.trim();
                let jsonData;
                try {
                    jsonData = JSON.parse(text);
                } catch (e) {
                    let cleaned = text.replace(/,\s*([}\]])/g, "$1");
                    cleaned = cleaned.replace(/\/\/.*?$/gm, "");
                    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");
                    try {
                        jsonData = JSON.parse(cleaned);
                    } catch (e2) {
                        console.log("⚠️ JSON non valido → uso regex");
                        resolve(extractWithRegex(text));
                        return;
                    }
                }

                const found = [];
                function walk(o) {
                    if (typeof o === 'object' && o !== null) {
                        if (o.title && o.myresolve) {
                            found.push([o.title, o.myresolve]);
                        }
                        for(const k in o) {
                            walk(o[k]);
                        }
                    } else if (Array.isArray(o)) {
                        o.forEach(item => walk(item));
                    }
                }
                walk(jsonData);
                resolve(found);
            });
        });
        req.on('error', (e) => reject(e));
    });
}

// ==============================
// M3U
// ==============================
function generateM3u(channels) {
    let m3u = "#EXTM3U\n\n";

    for (const [title, encoded] of channels) {
        const cleanTitle = cleanM3uText(title);
        const decoded = decodeAmstaff(encoded);
        if (!decoded) continue;

        const [url, keyId, key] = decoded;
        const meta = matchChannel(cleanTitle);

        const name = cleanM3uText(meta ? meta.nome : cleanTitle);
        const logo = meta ? meta.logo : DEFAULT_LOGO;
        const group = meta ? meta.group : "Altro";

        const tvgId = normalize(name);

        m3u += `#EXTINF:-1 tvg-id="${tvgId}" tvg-logo="${logo}" group-title="${group}",${name}\n`;
        m3u += `#KODIPROP:inputstream.adaptive.license_type=clearkey\n`;
        m3u += `#KODIPROP:inputstream.adaptive.license_key=${keyId}:${key}\n`;
        m3u += `${url}\n\n`;
    }

    fs.writeFileSync(OUTPUT_M3U, m3u, 'utf-8');
    console.log(`✅ File M3U creato: ${OUTPUT_M3U}`);
}

// ==============================
// MAIN
// ==============================
async function main() {
    try {
        const channels = await fetchAmstaffChannels();
        generateM3u(channels);
    } catch(e) {
        console.error(e);
    }
}

main();
