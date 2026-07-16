const fs = require('fs');
const https = require('https');

// ==============================
// CONFIG
// ==============================
const OUTPUT_M3U = "vavoo.m3u8";
const VAVOO_CATALOG_URL = "https://vavoo.to/mediahubmx-catalog.json";
const VAVOO_RESOLVE_URL = "https://vavoo.to/mediahubmx-resolve.json";
const CONCURRENCY = 40; // Resolving 40 channels concurrently untuk kecepatan tinggi

// CLI flags
const args = process.argv.slice(2);
const noResolve = args.includes('--no-resolve'); // Gunakan --no-resolve jika hanya ingin ID katalog tanpa resolving

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
// STREAM RESOLVER (POST to resolve.json)
// ==============================
function resolveSingleChannel(id) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({
            "language": "de",
            "region": "DE",
            "url": `https://vavoo.to/vavoo-iptv/play/${id}`
        });

        const req = https.request(VAVOO_RESOLVE_URL, {
            method: 'POST',
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": Buffer.byteLength(payload),
                "Origin": "https://vavoo.to",
                "Referer": "https://vavoo.to/watch"
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const j = JSON.parse(body);
                    if (Array.isArray(j) && j[0] && j[0].url) {
                        resolve(j[0].url);
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        req.write(payload);
        req.end();
    });
}

async function resolveChannelsInBatches(channels) {
    console.log(`\n=== Memulai proses Resolving Stream HLS untuk ${channels.length} channel (Concurrency: ${CONCURRENCY}) ===`);
    let resolvedCount = 0;
    const startTime = Date.now();

    for (let i = 0; i < channels.length; i += CONCURRENCY) {
        const batch = channels.slice(i, i + CONCURRENCY);
        const tasks = batch.map(async (ch) => {
            const id = ch.ids ? ch.ids.id : ch.id;
            const realUrl = await resolveSingleChannel(id);
            if (realUrl) {
                ch.stream_url = realUrl;
                resolvedCount++;
            } else {
                ch.stream_url = `https://vavoo.to/play/${id}/index.m3u8`;
            }
        });

        await Promise.all(tasks);

        if ((i + CONCURRENCY) % 1000 < CONCURRENCY || i + batch.length === channels.length) {
            const progress = Math.min(channels.length, i + batch.length);
            const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[Resolving Progress] ${progress}/${channels.length} channels (${resolvedCount} berhasil resolved, ${elapsedSec}s)`);
        }
    }

    console.log(`=== Selesai Resolving: ${resolvedCount}/${channels.length} stream HLS asli berhasil didapatkan ===\n`);
    return channels;
}

// ==============================
// M3U GENERATION
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

        // Jika berhasil diresolve, gunakan URL HLS asli (ngolpdkyoctjcddxshli469r.org), jika tidak gunakan fallback
        const streamUrl = channel.stream_url || `https://vavoo.to/play/${id}/index.m3u8`;

        const logoAttr = logo ? ` tvg-logo="${logo}"` : "";
        m3u += `#EXTINF:-1 tvg-id="${id}"${logoAttr} group-title="${group}",${name}\n`;
        m3u += `${streamUrl}\n\n`;
        
        count++;
    }

    fs.writeFileSync(OUTPUT_M3U, m3u, 'utf-8');
    console.log(`✅ File M3U berhasil dibuat: ${OUTPUT_M3U} dengan total ${count} channels.`);
}

// ==============================
// MAIN
// ==============================
async function main() {
    try {
        console.log("Mulai mendownload seluruh channel dari server VAVOO...");
        let channels = await fetchVavooChannels();
        console.log(`=== Selesai ekstraksi: Berhasil mengumpulkan ${channels.length} saluran unik dari seluruh dunia ===`);

        if (!noResolve) {
            channels = await resolveChannelsInBatches(channels);
        } else {
            console.log("[Info] Melewati proses resolving karena flag --no-resolve aktif.");
        }

        generateM3u(channels);
    } catch(e) {
        console.error("❌ Terjadi kesalahan:", e.message);
    }
}

main();
