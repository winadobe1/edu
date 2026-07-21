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
let outPath = 'xyzstreams.m3u8';

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
function fetchLive(urlOrPath, referer = SITE_REFERER) {
  return new Promise((resolve) => {
    let fullUrl = urlOrPath.startsWith('http') ? urlOrPath : `${SITE_ORIGIN}${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}`;
    let u;
    try {
      u = new URL(fullUrl);
    } catch(e) {
      return resolve({ status: 0, body: '', error: e.message });
    }

    console.log(`[Fetch] Fetching ${u.href}...`);
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: { 'User-Agent': SITE_UA, 'Referer': referer },
      rejectUnauthorized: false
    };
    https.get(opts, res => {
      // Follow redirect if needed (for 301/308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (!loc.startsWith('http')) {
           loc = `${u.protocol}//${u.hostname}${loc.startsWith('/') ? '' : '/'}${loc}`;
        }
        console.log(`[Fetch] Redirected to ${loc}`);
        res.destroy();
        return fetchLive(loc, referer).then(resolve);
      }

      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', e => resolve({ status: 0, body: '', error: e.message }));
  });
}

async function resolveEventStreamUrl(eventPageUrl) {
  const pageRes = await fetchLive(eventPageUrl);
  if (pageRes.status !== 200) return [];

  // Find embed iframe URL(s)
  const embedMatches = [...pageRes.body.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
  const dataUrlMatches = [...pageRes.body.matchAll(/data-url=["']([^"']+)["']/gi)].map(m => m[1]);
  
  const embedUrls = Array.from(new Set([...embedMatches, ...dataUrlMatches]));
  const m3u8List = [];

  for (let embedUrl of embedUrls) {
    if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
    else if (embedUrl.startsWith('/')) embedUrl = `${SITE_ORIGIN}${embedUrl}`;

    const embedRes = await fetchLive(embedUrl, eventPageUrl);
    if (embedRes.status !== 200) continue;

    // Check data-signed-url
    const signedMatch = embedRes.body.match(/data-signed-url=["']([^"']+)["']/i);
    if (signedMatch) {
      m3u8List.push(signedMatch[1]);
    } else {
      // Fallback m3u8 match
      const m3u8Match = embedRes.body.match(/https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*/i);
      if (m3u8Match) {
        m3u8List.push(m3u8Match[0]);
      }
    }
  }
  return m3u8List;
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
    const getEmbedUrl = props.match(/\bembedUrl\s*:\s*'([^']+)'/);
    
    if (!getId) continue;
    channels.push({
      id: getId[1],
      displayName: getDisplayName ? getDisplayName[1] : getId[1],
      logo: getLogo ? getLogo[1] : '',
      embedUrl: getEmbedUrl ? getEmbedUrl[1] : null,
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
    for (const ch of slingChannels) {
      let url = `${STREAM_BASE}?stream_id=${encodeURIComponent(ch.id)}&pro_id=${PRO_ID}&index.m3u8`;
      
      if (ch.embedUrl && !ch.embedUrl.includes('{TEMPLATE}')) {
        console.log(`[Fetch] Resolving dynamic URL for ${ch.displayName} via ${ch.embedUrl}`);
        const embedPath = ch.embedUrl.startsWith('/') ? ch.embedUrl : '/' + ch.embedUrl;
        const embedHtml = await fetchLive(embedPath);
        if (embedHtml.status === 200) {
          const m3u8Match = embedHtml.body.match(/['"`](https?:\/\/[^'"`\s]+\.m3u8[^'"`\s]*)['"`]/);
          if (m3u8Match) {
            let foundUrl = m3u8Match[1];
            if (foundUrl.includes('${')) {
              // Sometimes the URL is a JS template literal, e.g. https://ftv.../${encodedStreamId}/${encodedProId}/master.m3u8
              const params = new URL(ch.embedUrl, 'https://xyzstreams.st').searchParams;
              const sid = params.get('streamid') || '';
              const pid = params.get('proid') || '';
              foundUrl = foundUrl.replace(/\$\{(?:encoded)?StreamId\}/i, sid)
                                 .replace(/\$\{(?:encoded)?ProId\}/i, pid);
            }
            url = foundUrl;
            console.log(`        -> Found dynamic URL: ${url}`);
          } else {
            console.log(`        -> No M3U8 found in embed, using fallback`);
          }
        } else {
          console.log(`        -> Failed to fetch embed, using fallback`);
        }
      }
      
      appendStream(ch.displayName, 'XYZ Channels', url, ch.logo);
    }
  }

  // Dynamically Discovered Sports
  for (const [sport, streamsMap] of Object.entries(dynamicSportMaps)) {
    const keys = Object.keys(streamsMap);
    if (keys.length === 0) continue;

    lines.push('#-----------------------------------------');
    lines.push(`# ${sport} STREAMS (Auto-Discovered)`);
    lines.push('#-----------------------------------------');
    
    for (const [teamOrName, url] of Object.entries(streamsMap)) {
      let finalUrl = url;
      if (url.includes('/embed/')) {
        console.log(`[${sport}] Resolving embed URL for ${teamOrName}: ${url}`);
        const resolved = await resolveEventStreamUrl(url);
        if (resolved && resolved.length > 0) {
          finalUrl = resolved[0];
        }
      }
      appendStream(`${sport}: ${teamOrName}`, sport, finalUrl);
    }
  }

  // Live Events (Homepage)
  if (!noEvents && eventsData.length > 0) {
    lines.push('#-----------------------------------------');
    lines.push('# LIVE EVENTS (Homepage)');
    lines.push('#-----------------------------------------');
    for (const ev of eventsData) {
      if (!ev.title) continue;
      const rawUrl = ev.href ? (ev.href.startsWith('http') ? ev.href : `${SITE_ORIGIN}/${ev.href.replace(/^\//, '')}`) : SITE_ORIGIN;
      const start = ev.start ? new Date(ev.start).toISOString() : '';
      const stop  = ev.end ? new Date(ev.end).toISOString() : '';

      console.log(`[Events] Resolving m3u8 stream for event: ${ev.title}`);
      const resolvedUrls = await resolveEventStreamUrl(rawUrl);

      if (resolvedUrls && resolvedUrls.length > 0) {
        for (let i = 0; i < resolvedUrls.length; i++) {
          const streamTitle = resolvedUrls.length > 1 ? `${ev.title} (Link ${i+1})` : ev.title;
          appendStream(streamTitle, ev.category || 'Events', resolvedUrls[i], ev.bg || '', start, stop);
        }
      } else {
        // Fallback to event page URL if m3u8 not resolved
        appendStream(ev.title, ev.category || 'Events', rawUrl, ev.bg || '', start, stop);
      }
    }
  }

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

  console.log(`\n✅ Complete M3U written to: ${outPath}`);
  console.log(`   24/7 Channels : ${slingChannels.length}`);
  console.log(`   Events        : ${eventsData.length}`);
  for (const [sport, streamsMap] of Object.entries(dynamicSportMaps)) {
    console.log(`   ${sport} Streams : ${Object.keys(streamsMap).length}`);
  }
  
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error during extraction:", err);
  process.exit(1);
});
