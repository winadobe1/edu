const fs = require('fs');
const https = require('https');

// ==============================
// CONFIG
// ==============================
const OUTPUT_M3U = "vavoo.m3u8";
const VAVOO_CATALOG_URL = "https://vavoo.to/mediahubmx-catalog.json";

// ==============================
// UTILS
// ==============================
function cleanText(text) {
    if (!text) return text;
    return text.replace(/\s+/g, " ").trim();
}

// ==============================
// FETCH (POST with Pagination & Groups)
// ==============================
function postCatalogHelper(filter = {}, cursor = null) {
    return new Promise((resolve) => {
        const payload = {
            "language": "de",
            "region": "DE",
            "catalogId": "iptv",
            "id": "",
            "adult": false,
            "search": "",
            "sort": "trending",
            "filter": filter,
            "cursor": cursor
        };
        const data = JSON.stringify(payload);

        const req = https.request(VAVOO_CATALOG_URL, {
            method: 'POST',
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": Buffer.byteLength(data),
                "Origin": "https://vavoo.to",
                "Referer": "https://vavoo.to/live"
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    resolve(null);
                }
            });
        });

        req.on('error', (e) => resolve(null));
        req.write(data);
        req.end();
    });
}

async function fetchVavooChannels() {
    console.log("Mendapatkan daftar grup dari server VAVOO...");
    const initRes = await postCatalogHelper({}, null);
    
    let groups = [];
    if (initRes && initRes.features && initRes.features.filter) {
        const groupFilter = initRes.features.filter.find(f => f.id === 'group');
        if (groupFilter && Array.isArray(groupFilter.values)) {
            groups = groupFilter.values;
        }
    }

    // Jika gagal mendapatkan grup, fallback ke query umum tanpa filter
    if (groups.length === 0) {
        groups = [null];
    } else {
        console.log(` -> Ditemukan ${groups.length} grup/negara: ${groups.join(", ")}\n`);
    }

    const allChannels = [];
    const seenIds = new Set();

    for (const grp of groups) {
        const grpLabel = grp || "Umum";
        console.log(`=== Mengambil channel untuk grup: [${grpLabel}] ===`);
        let cursor = null;
        let page = 1;
        let grpCount = 0;

        while (true) {
            const filterObj = grp ? { "group": grp } : {};
            const res = await postCatalogHelper(filterObj, cursor);
            if (!res || !res.items || res.items.length === 0) {
                break;
            }

            for (const item of res.items) {
                const id = item.ids ? item.ids.id : item.id;
                if (!id) continue;

                if (!seenIds.has(id)) {
                    seenIds.add(id);
                    allChannels.push(item);
                }
            }

            grpCount += res.items.length;

            if (res.nextCursor !== undefined && res.nextCursor !== null && res.nextCursor !== cursor) {
                cursor = res.nextCursor;
                page++;
            } else {
                break;
            }
        }
        console.log(` -> Selesai grup [${grpLabel}]: ${grpCount} items (Total unik sementara: ${allChannels.length})\n`);
    }

    return allChannels;
}

// ==============================
// M3U
// ==============================
function generateM3u(channels) {
    let m3u = "#EXTM3U\n\n";
    let count = 0;

    for (const channel of channels) {
        const id = channel.ids ? channel.ids.id : channel.id;
        if (!id || !channel.name) continue;

        const name = cleanText(channel.name);
        const group = cleanText(channel.group || channel.country) || "Uncategorized";
        const logo = channel.logo || "";

        // Format stream URL yang diminta: https://vavoo.to/play/{id}/index.m3u8
        const streamUrl = `https://vavoo.to/play/${id}/index.m3u8`;

        // Metadata M3U
        const logoAttr = logo ? ` tvg-logo="${logo}"` : "";
        m3u += `#EXTINF:-1 tvg-id="${id}"${logoAttr} group-title="${group}",${name}\n`;
        m3u += `${streamUrl}\n\n`;
        
        count++;
    }

    fs.writeFileSync(OUTPUT_M3U, m3u, 'utf-8');
    console.log(`✅ File M3U berhasil dibuat: ${OUTPUT_M3U} dengan total ${count} channels unik.`);
}

// ==============================
// MAIN
// ==============================
async function main() {
    try {
        console.log("Mulai mendownload seluruh channel dari server VAVOO...");
        const channels = await fetchVavooChannels();
        console.log(`=== Selesai ekstraksi: Berhasil mengumpulkan ${channels.length} saluran unik dari seluruh dunia ===`);
        generateM3u(channels);
    } catch(e) {
        console.error("❌ Terjadi kesalahan:", e.message);
    }
}

main();
