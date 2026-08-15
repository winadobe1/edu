const https = require('https');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.liveland.af/graphql';

async function fetchGraphQL(query) {
  const data = JSON.stringify({ query });
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(API_URL, options, (res) => {
      let d = '';
      res.on('data', (chunk) => { d += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (json.errors) {
            reject(new Error(json.errors[0].message));
          } else {
            resolve(json.data);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function fetchChannels() {
  const query = `
    query {
      channels(input: {}) {
        id
        slug
        name
        english_name
        type
        logo_url
      }
    }
  `;
  const data = await fetchGraphQL(query);
  return data.channels;
}

async function fetchStreamUrl(channelId) {
  const query = `
    query {
      streamUrl(channelId: "${channelId}")
    }
  `;
  const data = await fetchGraphQL(query);
  return data.streamUrl;
}

async function main() {
  try {
    console.log('Fetching channels from liveland.af API...');
    const channels = await fetchChannels();
    console.log(`Found ${channels.length} channels. Fetching stream URLs dynamically...`);

    let m3uContent = '#EXTM3U\n\n';

    // Fetch stream URL for each channel dynamically
    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];
      try {
        const channelName = channel.english_name || channel.name;
        process.stdout.write(`Fetching URL for ${channelName} (${channel.slug})... `);
        const streamUrl = await fetchStreamUrl(channel.id);
        
        if (streamUrl) {
          console.log('OK');
          
          const groupTitle = channel.type || 'GENERAL';
          
          m3uContent += `#EXTINF:-1 tvg-id="${channel.slug}" tvg-logo="${channel.logo_url || ''}" group-title="${groupTitle}",${channelName}\n`;
          m3uContent += `#EXTVLCOPT:http-referrer=https://liveland.af/\n`;
          m3uContent += `#EXTVLCOPT:http-user-agent=Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36\n`;
          m3uContent += `#EXTVLCOPT:http-origin=https://liveland.af\n`;
          m3uContent += `${streamUrl}|User-Agent=Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36&Referer=https://liveland.af/&Origin=https://liveland.af\n\n`;
        } else {
          console.log('FAILED (No URL)');
        }
      } catch (err) {
        console.log('ERROR:', err.message);
      }
    }

    const args = process.argv.slice(2);
    let outPath = 'persia.m3u8';
    const outArg = args.find(a => !a.startsWith('--'));
    if (outArg) {
      outPath = outArg;
    }

    const outputPath = path.resolve(process.cwd(), outPath);
    fs.writeFileSync(outputPath, m3uContent);
    console.log(`\nSuccessfully saved dynamic playlist to ${outputPath}`);

  } catch (error) {
    console.error('Failed to extract channels:', error);
  }
}

main();
