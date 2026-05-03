const fs = require('fs');

// ==============================
// CONFIG
// ==============================
const PLAYLIST_URLS = [
    "https://enak.maling.pl/"
];
const OUTPUT_FILE  = "enak.m3u8";
const USER_AGENT   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CLEARKEY_PROXY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36";

// ==============================
// FETCH CLEARKEY
// ==============================
async function fetchAndFormatClearKey(licenseUrl, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const payload = { kids: ["W2uFp1vEQKigw1q1yU_9Wg"], type: "temporary" };
            let headers = {
                'Content-Type': 'application/json',
                'User-Agent': CLEARKEY_PROXY_UA
            };

            try {
                const urlObj = new URL(licenseUrl);
                headers['Referer'] = urlObj.origin + '/';
                headers['Origin']  = urlObj.origin;
            } catch (e) {}

            const { spawnSync } = require('child_process');
            const curlArgs = [
                '-sL', licenseUrl, '-X', 'POST',
                '-H', `Content-Type: ${headers['Content-Type']}`,
                '-H', `User-Agent: ${headers['User-Agent']}`,
                '-H', `Referer: ${headers['Referer']}`,
                '-H', `Origin: ${headers['Origin']}`,
                '-d', JSON.stringify(payload), '--compressed'
            ];

            const curlResult = spawnSync('curl', curlArgs, { encoding: 'utf-8' });

            if (curlResult.status !== 0 || !curlResult.stdout || curlResult.stdout.includes('Cloudflare') || curlResult.stdout.includes('<html')) {
                if (attempt < retries) { await new Promise(r => setTimeout(r, 1500 * attempt)); continue; }
                return licenseUrl;
            }

            let data;
            try { data = JSON.parse(curlResult.stdout); } catch (e) {
                if (attempt < retries) { await new Promise(r => setTimeout(r, 1500 * attempt)); continue; }
                return licenseUrl;
            }

            if (data.keys && data.keys.length > 0) {
                const base64ToHex = (b64) => {
                    const raw = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('binary');
                    return Array.from(raw).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
                };
                const keyPairs = data.keys
                    .filter(k => k.kty === 'oct' && k.k && k.kid)
                    .map(k => `${base64ToHex(k.kid)}:${base64ToHex(k.k)}`);
                if (keyPairs.length > 0) return keyPairs.join(',');
            }
            return licenseUrl;
        } catch (e) {
            if (attempt < retries) { await new Promise(r => setTimeout(r, 1000 * attempt)); continue; }
            return licenseUrl;
        }
    }
}

// ==============================
// PROXY FETCHER
// ==============================
async function getWorkingProxy() {
    console.log(`[0/3] Fetching Indonesian proxies...`);
    let allProxies = new Set();
    try {
        const fetch = require('node-fetch');
        const r1 = await fetch('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=id&ssl=all&anonymity=all');
        (await r1.text()).split('\n').map(p => p.trim()).filter(Boolean).forEach(p => allProxies.add(p));
    } catch (e) {}
    try {
        const fetch = require('node-fetch');
        const r2 = await fetch('https://www.proxy-list.download/api/v1/get?type=http&country=ID');
        (await r2.text()).split('\n').map(p => p.trim()).filter(Boolean).forEach(p => allProxies.add(p));
    } catch (e) {}
    const proxyList = Array.from(allProxies);
    console.log(`  -> Found ${proxyList.length} proxies.`);
    return proxyList;
}

// ==============================
// FETCH WITH RETRY (curl + proxy)
// ==============================
async function fetchWithRetry(url, options, proxies) {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const fetchWithAgent = require('node-fetch');
    const { spawnSync } = require('child_process');

    // 1. Coba curl
    try {
        console.log(`  -> Trying system curl (TLS Bypass)...`);
        const args = ['-sL', url,
            '-H', `User-Agent: ${options.headers['User-Agent']}`,
            '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            '-H', 'Accept-Language: id-ID,id;q=0.9',
            '-H', 'Connection: keep-alive',
            '--compressed'
        ];
        const result = spawnSync('curl', args, { encoding: 'utf-8' });
        if (result.stdout) {
            let text = result.stdout.trim();
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            if (text.startsWith('#EXTM3U')) {
                console.log(`  -> Success with curl!`);
                return text;
            }
            console.log(`  -> Curl response preview: ${text.substring(0, 50)}...`);
        }
    } catch (e) {}

    // 2. Coba Node fetch langsung
    try {
        console.log(`  -> Trying direct Node fetch...`);
        const fetch = require('node-fetch');
        const res = await fetch(url, options);
        let text = (await res.text()).trim();
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        if (text.startsWith('#EXTM3U')) return text;
        console.log(`  -> Direct fetch response (${res.status}): ${text.substring(0, 50)}...`);
    } catch (e) { console.log(`  -> Direct fetch error: ${e.message}`); }

    if (proxies.length === 0) throw new Error("No proxies available.");

    // 3. Race proxies
    console.log(`  -> Racing ${proxies.length} proxies...`);
    return new Promise((resolve, reject) => {
        let pending = proxies.length, resolved = false;
        if (pending === 0) return reject(new Error("No proxies available."));

        const timeoutId = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                reject(new Error("Proxy racing timed out (30s)"));
            }
        }, 30000);

        for (const proxy of proxies) {
            try {
                if (!proxy.includes(':')) { 
                    pending--; 
                    if (pending === 0 && !resolved) {
                        clearTimeout(timeoutId);
                        reject(new Error("All proxies were invalid."));
                    }
                    continue; 
                }
                
                const agent = new HttpsProxyAgent(`http://${proxy}`);
                fetchWithAgent(url, { ...options, agent, timeout: 12000 })
                    .then(async res => {
                        if (resolved) return;
                        if (!res.ok) throw new Error("Status " + res.status);
                        let text = (await res.text()).trim();
                        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
                        if (text.startsWith('#EXTM3U')) {
                            resolved = true;
                            clearTimeout(timeoutId);
                            console.log(`  -> Success with proxy ${proxy}!`);
                            resolve(text);
                        } else throw new Error("Not M3U");
                    })
                    .catch(() => { 
                        pending--; 
                        if (pending === 0 && !resolved) {
                            resolved = true;
                            clearTimeout(timeoutId);
                            reject(new Error("All proxies failed."));
                        }
                    });
            } catch (e) {
                pending--;
                if (pending === 0 && !resolved) {
                    resolved = true;
                    clearTimeout(timeoutId);
                    reject(new Error("All proxies failed during initialization."));
                }
            }
        }
    });
}

// ==============================
// PROCESS SINGLE M3U TEXT
// ==============================
async function processM3U(m3uText) {
    const lines = m3uText.split('\n');
    let processedLines = [];
    let skipChannel = false;
    let currentLicenseType = '';

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        if (line.startsWith('#EXTM3U')) continue;

        if (line.startsWith('#KODIPROP:inputstream.adaptive.license_type=')) {
            currentLicenseType = line.split('=')[1].trim();
        } else if (line.startsWith('#EXTINF:')) {
            currentLicenseType = '';
        }

        if (line.startsWith('#EXTINF:')) {
            skipChannel = line.includes('https://t.me/semar_25');
        }
        if (skipChannel) continue;

        if (line.startsWith('#KODIPROP:inputstream.adaptive.license_key=') && currentLicenseType === 'clearkey') {
            let licenseUrl = line.substring('#KODIPROP:inputstream.adaptive.license_key='.length).trim();
            if (licenseUrl && licenseUrl.startsWith('http') && !licenseUrl.includes('indick.kt')) {
                process.stdout.write(`  Fetching key -> ${licenseUrl.substring(0, 50)}... `);
                const hexKey = await fetchAndFormatClearKey(licenseUrl);
                if (hexKey && hexKey !== licenseUrl) {
                    console.log(`OK`);
                    processedLines.push(`#KODIPROP:inputstream.adaptive.license_key=${hexKey}`);
                } else {
                    console.log(`FAILED (keeping URL)`);
                    processedLines.push(line);
                }
            } else {
                processedLines.push(line);
            }
        } else {
            processedLines.push(line);
        }
    }
    return processedLines;
}

// ==============================
// MAIN
// ==============================
async function main() {
    const fetchOptions = {
        headers: {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Encoding": "gzip",
            "Connection": "Keep-Alive"
        },
        redirect: "follow"
    };

    let mergedLines = ['#EXTM3U'];
    let totalChannels = 0;

    const proxies = await getWorkingProxy();

    for (let idx = 0; idx < PLAYLIST_URLS.length; idx++) {
        const url = PLAYLIST_URLS[idx];
        console.log(`\n[${idx + 1}/${PLAYLIST_URLS.length}] Downloading: ${url}`);
        try {
            const m3uText = await fetchWithRetry(url, fetchOptions, proxies);
            console.log(`  -> Downloaded (${m3uText.length} chars). Processing...`);
            const processed = await processM3U(m3uText);
            const channelCount = processed.filter(l => l.startsWith('#EXTINF')).length;
            console.log(`  -> Processed: ${channelCount} channels`);
            totalChannels += channelCount;
            mergedLines.push(...processed, '');
        } catch (err) {
            console.error(`  -> FAILED: ${err.message} (skipping)`);
        }
    }

    fs.writeFileSync(OUTPUT_FILE, mergedLines.join('\n'));
    console.log(`\n✅ DONE! Output: ${OUTPUT_FILE} | Total: ${totalChannels} channels from ${PLAYLIST_URLS.length} sources`);
    process.exit(0);
}

main();
