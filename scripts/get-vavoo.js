const fs = require('fs');
const https = require('https');

// ==============================
// CONFIG
// ==============================
const OUTPUT_M3U = "vavoo.m3u8";
const VAVOO_CHANNELS_URL = "https://vavoo.to/channels";

// ==============================
// UTILS
// ==============================
function cleanText(text) {
    if (!text) return text;
    return text.replace(/\s+/g, " ").trim();
}

// ==============================
// FETCH
// ==============================
async function fetchVavooChannels() {
    return new Promise((resolve, reject) => {
        const req = https.get(VAVOO_CHANNELS_URL, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "Origin": "https://vavoo.to",
                "Referer": "https://vavoo.to/"
            }
        }, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Gagal menghubungi server, status: ${res.statusCode}`));
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data.trim());
                    resolve(jsonData);
                } catch (e) {
                    reject(new Error("Gagal melakukan parse respons JSON"));
                }
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
    let count = 0;

    for (const channel of channels) {
        if (!channel.id || !channel.name) continue;

        const name = cleanText(channel.name);
        const country = cleanText(channel.country) || "Uncategorized";
        const id = channel.id;

        // Tampilan format yang diminta user: https://vavoo.to/play/{id}/index.m3u8
        const streamUrl = `https://vavoo.to/play/${id}/index.m3u8`;

        // Menambahkan metadata ke file M3U
        m3u += `#EXTINF:-1 tvg-id="${id}" group-title="${country}",${name}\n`;
        m3u += `${streamUrl}\n\n`;
        
        count++;
    }

    fs.writeFileSync(OUTPUT_M3U, m3u, 'utf-8');
    console.log(`✅ File M3U creato: ${OUTPUT_M3U} dengan total ${count} channels.`);
}

// ==============================
// MAIN
// ==============================
async function main() {
    try {
        console.log("Mendownload daftar channel dari server VAVOO...");
        const channels = await fetchVavooChannels();
        console.log(`Berhasil mendapatkan ${channels.length} saluran. Memproses menjadi M3U...`);
        generateM3u(channels);
    } catch(e) {
        console.error("❌ Terjadi kesalahan:", e.message);
    }
}

main();
