/**
 * extract_xyzstream.js
 *
 * Standalone M3U Extractor for https://xyzstreams.st/
 * 
 * Fitur:
 *   1. Fetch langsung ke server tanpa perlu file HAR.
 *   2. Ekstrak 24/7 SLING channels dari homepage.
 *   3. Ekstrak EVENTS_DATA (Live Events) dari homepage.
 *   4. Auto-discovery: otomatis mencari URL olahraga di homepage (MLB, WNBA, F1, dll)
 *      lalu mengambil link stream M3U8_CHANNELS_MAP secara dinamis.
 *   5. Fallback fetch NBA dari JSON API endpoint rahasia.
 *
 * Usage:
 *   node extract_xyzstream.js [output.m3u]
 */

'use strict';
const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ─────────────────────────────────────────
//  Configuration & Constants
// ─────────────────────────────────────────
const SITE_UA      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';
const SITE_ORIGIN  = 'https://xyzstreams.st';
const SITE_REFERER = 'https://xyzstreams.st/';
const STREAM_BASE  = 'https://247v2.xyzstreams.st/';
const PRO_ID       = 'sling';

// ─────────────────────────────────────────
//  CLI args
// ─────────────────────────────────────────
const args = process.argv.slice(2);
let outPath = 'xyzstreams_playlist.m3u';

// If user provides a non-flag argument, treat it as output path
const outArg = args.find(a => !a.startsWith('--'));
if (outArg) {
  outPath = outArg;
}

const noEvents   = args.includes('--no-events');
const noChannels = args.includes('--no-channels');

// ─────────────────────────────────────────
//  HTTP Fetch Helper
// ─────────────────────────────────────────
function fetchLive(pathPath) {
  return new Promise((resolve) => {
    console.log(`[Fetch] Fetching ${pathPath}...`);
    const opts = {
      hostname: 'xyzstreams.st', port: 443, path: pathPath,
      headers: { 'User-Agent': SITE_UA, 'Referer': SITE_REFERER },
      rejectUnauthorized: false
    };
    https.get(opts, res => {
      // Follow redirect if needed (for 301/308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`[Fetch] Redirected to ${res.headers.location}`);
        let loc = res.headers.location;
        if (loc.startsWith('http')) {
           const u = new URL(loc);
           loc = u.pathname + u.search;
        }
        return fetchLive(loc).then(resolve);
      }

      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', e => resolve({ status: 0, body: '', error: e.message }));
  });
}

// ─────────────────────────────────────────
//  Parsing logic for embedded script maps
// ─────────────────────────────────────────
function parseSlingLineupMap(html) {
  const idx = html.indexOf('SLING_LINEUP_MAP');
  if (idx < 0) return [];

  const openBrace = html.indexOf('{', idx);
  let depth = 0, closeIdx = -1;
  for (let i = openBrace; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  
  if (openBrace < 0 || closeIdx < 0) return [];
  const block = html.substring(openBrace, closeIdx + 1);

  const channels = [];
  const entryRe = /'([^']+)'\s*:\s*\{([^}]+)\}/g;
  let m;
  while ((m = entryRe.exec(block)) !== null) {
    const props = m[2];
    const getId = props.match(/\bid\s*:\s*'([^']+)'/);
    const getDisplayName = props.match(/\bdisplayName\s*:\s*'([^']+)'/);
    const getLogo = props.match(/\blogo\s*:\s*'([^']+)'/);
    if (!getId) continue;
    channels.push({
      id: getId[1],
      displayName: getDisplayName ? getDisplayName[1] : getId[1],
      logo: getLogo ? getLogo[1] : '',
    });
  }
  return channels;
}

function parseEventsData(html) {
  const idx = html.indexOf('EVENTS_DATA');
  if (idx < 0) return [];

  const openBracket = html.indexOf('[', idx);
  let depth = 0, closeIdx = -1;
  for (let i = openBracket; i < html.length; i++) {
    if (html[i] === '[' || html[i] === '{') depth++;
    else if (html[i] === ']' || html[i] === '}') {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  if (closeIdx < 0) return [];

  let arrStr = html.substring(openBracket, closeIdx + 1);
  arrStr = arrStr.replace(/^[ \t]*\/\/[^\n]*/gm, '');

  try {
    const events = (new Function('return ' + arrStr))();
    return Array.isArray(events) ? events : [];
  } catch (e) {
    console.warn('Could not parse EVENTS_DATA:', e.message);
    return [];
  }
}

function parseM3u8ChannelsMap(html) {
  const idx = html.indexOf('M3U8_CHANNELS_MAP');
  if (idx < 0) return {};

  const openBrace = html.indexOf('{', idx);
  let depth = 0, closeIdx = -1;
  for (let i = openBrace; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  
  if (openBrace < 0 || closeIdx < 0) return {};
  const block = html.substring(openBrace, closeIdx + 1);
  const map = {};
  const entryRe = /'([^']+)'\s*:\s*'([^']+)'/g;
  let m;
  while ((m = entryRe.exec(block)) !== null) {
    map[m[1]] = m[2];
  }
  return map;
}

// ─────────────────────────────────────────
//  Main Async Execution
// ─────────────────────────────────────────
async function main() {
  console.log(`Starting XYZStreams Extractor (Standalone Mode)`);
  
  // 1. Fetch Homepage
  const homeResp = await fetchLive('/');
  if (homeResp.status !== 200) {
    console.error(`Failed to fetch homepage. HTTP Status: ${homeResp.status}`);
    process.exit(1);
  }
  const homeHtml = homeResp.body;

  const slingChannels = parseSlingLineupMap(homeHtml);
  const eventsData    = parseEventsData(homeHtml);

  // 2. AUTO DISCOVERY: Scan homepage for sport links
  const sportLinks = new Map();
  // Regex to find: <a href="mlb.html" class="sport-search-card">
  const linkRe = /<a\s+href=["']([^"']+)["'][^>]*class=["'][^"']*sport-search-card[^"']*["']/g;
  let lm;
  while ((lm = linkRe.exec(homeHtml)) !== null) {
    let url = lm[1];
    if (url && url !== 'undefined' && !url.startsWith('#')) {
      let name = url.replace(/\.html$/, '').replace(/^\//, '').toUpperCase();
      if (name === 'ALT') name = 'NBA'; // Their NBA page is named alt.html
      const cleanUrl = url.replace(/\.html$/, '');
      sportLinks.set(name, cleanUrl.startsWith('/') ? cleanUrl : '/' + cleanUrl);
    }
  }

  // 3. Fetch discovered pages and extract maps or JSON
  const dynamicSportMaps = {};
  
  for (const [sport, url] of sportLinks.entries()) {
    const pageData = await fetchLive(url);
    if (pageData.status !== 200) continue;

    // A) Try to find embedded M3U8_CHANNELS_MAP (like MLB, WNBA)
    const map = parseM3u8ChannelsMap(pageData.body);
    if (Object.keys(map).length > 0) {
      if (!dynamicSportMaps[sport]) dynamicSportMaps[sport] = {};
      Object.assign(dynamicSportMaps[sport], map);
    }

    // B) Try to find GIST_URL for JSON data (like NBA)
    const gistRe = /GIST_URL\s*=\s*['"]([^'"]+\.json)['"]/i;
    const gm = pageData.body.match(gistRe);
    if (gm) {
      const jsonUrl = gm[1];
      const jsonData = await fetchLive(jsonUrl.startsWith('/') ? jsonUrl : '/' + jsonUrl);
      if (jsonData.status === 200) {
        try {
          const streamsObj = JSON.parse(jsonData.body);
          if (!dynamicSportMaps[sport]) dynamicSportMaps[sport] = {};
          
          for (const [team, streams] of Object.entries(streamsObj)) {
            streams.forEach((s) => {
              dynamicSportMaps[sport][`${team} (${s.name})`] = s.url;
            });
          }
        } catch(e) {}
      }
    }
  }

  // Fallback: Always try to fetch NBA directly from /nbastreams.json just in case 
  if (!dynamicSportMaps['NBA']) {
    const nbaFallback = await fetchLive('/nbastreams.json');
    if (nbaFallback.status === 200) {
      try {
        const streamsObj = JSON.parse(nbaFallback.body);
        dynamicSportMaps['NBA'] = {};
        for (const [team, streams] of Object.entries(streamsObj)) {
          streams.forEach((s) => {
            dynamicSportMaps['NBA'][`${team} (${s.name})`] = s.url;
          });
        }
      } catch(e) {}
    }
  }

  // 4. Build M3U
  const lines = [
    '#EXTM3U x-tvg-url=""',
    `# Generated from xyzstreams.st (Standalone Auto-Discovery) - ${new Date().toISOString()}`,
    `# Channels: ${slingChannels.length} | Events: ${eventsData.length} | Discovered Sports: ${Object.keys(dynamicSportMaps).join(', ') || 'None'}`,
    '',
  ];

  // Helper to append a stream
  function appendStream(title, group, url, logo = '', start = '', stop = '') {
    const logoAttr = logo ? ` tvg-logo="${logo}"` : '';
    const startAttr = start ? ` tvg-start="${start}"` : '';
    const stopAttr = stop ? ` tvg-stop="${stop}"` : '';
    
    lines.push(`#EXTINF:-1${logoAttr}${startAttr}${stopAttr} group-title="${group}",${title.replace(/,/g, '')}`);
    lines.push(`#EXTVLCOPT:http-user-agent=${SITE_UA}`);
    lines.push(`#EXTVLCOPT:http-referrer=${SITE_REFERER}`);
    lines.push(`#EXTVLCOPT:http-origin=${SITE_ORIGIN}`);
    lines.push(url);
    lines.push('');
  }

  // 24/7 Channels
  if (!noChannels && slingChannels.length > 0) {
    lines.push('#-----------------------------------------');
    lines.push('# 24/7 CHANNELS');
    lines.push('#-----------------------------------------');
    slingChannels.forEach(ch => {
      // Without HAR, we always use the baseline URL template
      const url = `${STREAM_BASE}?stream_id=${encodeURIComponent(ch.id)}&pro_id=${PRO_ID}&index.m3u8`;
      appendStream(ch.displayName, 'XYZ Channels', url, ch.logo);
    });
  }

  // Dynamically Discovered Sports
  for (const [sport, streamsMap] of Object.entries(dynamicSportMaps)) {
    const keys = Object.keys(streamsMap);
    if (keys.length === 0) continue;

    lines.push('#-----------------------------------------');
    lines.push(`# ${sport} STREAMS (Auto-Discovered)`);
    lines.push('#-----------------------------------------');
    
    for (const [teamOrName, url] of Object.entries(streamsMap)) {
      appendStream(`${sport}: ${teamOrName}`, sport, url);
    }
  }

  // Live Events (Homepage)
  if (!noEvents && eventsData.length > 0) {
    lines.push('#-----------------------------------------');
    lines.push('# LIVE EVENTS (Homepage)');
    lines.push('#-----------------------------------------');
    eventsData.forEach(ev => {
      if (!ev.title) return;
      const url = ev.href ? (ev.href.startsWith('http') ? ev.href : `https://xyzstreams.st/${ev.href.replace(/^\//, '')}`) : 'https://xyzstreams.st/';
      const start = ev.start ? new Date(ev.start).toISOString() : '';
      const stop  = ev.end ? new Date(ev.end).toISOString() : '';
      appendStream(ev.title, ev.category || 'Events', url, ev.bg || '', start, stop);
    });
  }

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

  console.log(`\n✅ Complete M3U written to: ${outPath}`);
  console.log(`   24/7 Channels : ${slingChannels.length}`);
  console.log(`   Events        : ${eventsData.length}`);
  for (const [sport, streamsMap] of Object.entries(dynamicSportMaps)) {
    console.log(`   ${sport} Streams : ${Object.keys(streamsMap).length}`);
  }
}

main().catch(err => {
  console.error("Fatal error during extraction:", err);
  process.exit(1);
});
