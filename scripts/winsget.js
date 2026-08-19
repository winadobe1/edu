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
const FALLBACK_STREAM_BASE  = 'https://247v2.xyzstreams.st/';
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
function fetchLive(urlOrPath, referer = SITE_REFERER, extraHeaders = {}) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(urlOrPath, SITE_ORIGIN);
    } catch(e) {
      return resolve({ status: 0, body: '', error: e.message });
    }

    console.log(`[Fetch] Fetching ${u.href}...`);
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': SITE_UA,
        'Referer': referer,
        'Accept': '*/*',
        ...extraHeaders,
      },
      rejectUnauthorized: false
    };
    const req = https.get(opts, res => {
      // Follow redirect if needed (for 301/308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = new URL(res.headers.location, u).href;
        console.log(`[Fetch] Redirected to ${loc}`);
        res.destroy();
        return fetchLive(loc, referer, extraHeaders).then(resolve);
      }

      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', e => resolve({ status: 0, body: '', error: e.message }));

    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timed out after 30 seconds'));
    });
  });
}

function decodeHtmlUrl(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/\\\//g, '/')
    .trim();
}

function scriptVariablesForPage(html, pageUrl) {
  const values = {};
  let currentUrl;
  try {
    currentUrl = new URL(pageUrl, SITE_ORIGIN);
  } catch (_) {
    return values;
  }

  // Example: const eventId = urlParams.get('id');
  const queryVarRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\.get\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = queryVarRe.exec(html)) !== null) {
    const value = currentUrl.searchParams.get(match[2]);
    if (value !== null) values[match[1]] = value;
  }

  // Example: const encodedStreamId = encodeURIComponent(streamId);
  const encodedVarRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*encodeURIComponent\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
  let changed = true;
  while (changed) {
    changed = false;
    encodedVarRe.lastIndex = 0;
    while ((match = encodedVarRe.exec(html)) !== null) {
      if (values[match[2]] !== undefined && values[match[1]] === undefined) {
        values[match[1]] = encodeURIComponent(values[match[2]]);
        changed = true;
      }
    }
  }

  return values;
}

function resolveJsUrlTemplate(template, html, pageUrl) {
  const values = scriptVariablesForPage(html, pageUrl);
  let resolved = decodeHtmlUrl(template);

  resolved = resolved.replace(/\$\{\s*encodeURIComponent\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\}/g, (all, name) => {
    return values[name] === undefined ? all : encodeURIComponent(values[name]);
  });
  resolved = resolved.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (all, name) => {
    return values[name] === undefined ? all : values[name];
  });

  if (!resolved || resolved.includes('${') || /^(?:#|javascript:|about:)/i.test(resolved)) return null;
  try {
    return new URL(resolved, pageUrl).href;
  } catch (_) {
    return null;
  }
}

function extractM3u8Urls(html, pageUrl) {
  const urls = [];
  const signedRe = /data-signed-url=["']([^"']+)["']/gi;
  const m3u8Re = /https?:\\?\/\\?\/[^"'`\s<>]+\.m3u8[^"'`\s<>]*/gi;
  let match;

  while ((match = signedRe.exec(html)) !== null) {
    const url = resolveJsUrlTemplate(match[1], html, pageUrl);
    if (url) urls.push(url);
  }
  while ((match = m3u8Re.exec(html)) !== null) {
    const url = resolveJsUrlTemplate(match[0], html, pageUrl);
    if (url) urls.push(url);
  }

  return Array.from(new Set(urls));
}

function extractNestedPlayerUrls(html, pageUrl) {
  const candidates = [];
  const htmlUrlRe = /<(?:iframe|source)[^>]+src=["']([^"']+)["']/gi;
  const dataUrlRe = /data-url=["']([^"']+)["']/gi;
  // Handles JavaScript such as: iframe.src = `...${eventId}...`.
  const assignedSrcRe = /\b[A-Za-z_$][\w$]*\.src\s*=\s*([`'"])([\s\S]*?)\1/g;
  let match;

  while ((match = htmlUrlRe.exec(html)) !== null) candidates.push(match[1]);
  while ((match = dataUrlRe.exec(html)) !== null) candidates.push(match[1]);
  while ((match = assignedSrcRe.exec(html)) !== null) candidates.push(match[2]);

  const urls = candidates
    .map(candidate => resolveJsUrlTemplate(candidate, html, pageUrl))
    .filter(Boolean);
  return Array.from(new Set(urls));
}

async function resolvePageStreamUrls(pageUrl, referer, depth, seen) {
  if (depth > 3 || seen.has(pageUrl)) return [];
  seen.add(pageUrl);

  const pageRes = await fetchLive(pageUrl, referer || SITE_REFERER);
  if (pageRes.status !== 200) return [];

  const directUrls = extractM3u8Urls(pageRes.body, pageUrl);
  if (directUrls.length > 0) return directUrls;

  const resolved = [];
  for (const nestedUrl of extractNestedPlayerUrls(pageRes.body, pageUrl)) {
    const nestedStreams = await resolvePageStreamUrls(nestedUrl, pageUrl, depth + 1, seen);
    resolved.push(...nestedStreams);
  }
  return Array.from(new Set(resolved));
}

const streamResolutionCache = new Map();

async function resolveEventStreamUrl(eventPageUrl) {
  let absoluteUrl;
  try {
    absoluteUrl = new URL(eventPageUrl, SITE_ORIGIN).href;
  } catch (_) {
    return [];
  }

  if (!streamResolutionCache.has(absoluteUrl)) {
    streamResolutionCache.set(
      absoluteUrl,
      resolvePageStreamUrls(absoluteUrl, SITE_REFERER, 0, new Set())
        .catch(() => [])
    );
  }
  return streamResolutionCache.get(absoluteUrl);
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

function discoverJsonFeedUrls(html, pageUrl) {
  const constants = {};
  const urls = [];
  let match;

  const constantRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([`'"])(.*?)\2/g;
  while ((match = constantRe.exec(html)) !== null) {
    constants[match[1]] = match[3];
  }

  // Supports fetch(API_URL), fetch('/events.json'), and fetch(`https://...`).
  const fetchRe = /\bfetch\s*\(\s*(?:([A-Za-z_$][\w$]*)|([`'"])(.*?)\2)/g;
  while ((match = fetchRe.exec(html)) !== null) {
    const candidate = match[1] ? constants[match[1]] : match[3];
    if (!candidate || candidate.includes('${')) continue;
    try {
      urls.push(new URL(decodeHtmlUrl(candidate), pageUrl).href);
    } catch (_) {}
  }

  return Array.from(new Set(urls));
}

function isoDurationSeconds(value) {
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(value || '');
  if (!match) return 0;
  return (Number(match[1] || 0) * 86400)
    + (Number(match[2] || 0) * 3600)
    + (Number(match[3] || 0) * 60)
    + Number(match[4] || 0);
}

function normalizeFeedImage(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return normalizeFeedImage(value[0]);
  if (value && typeof value === 'object') {
    return value.url || value.contentUrl || value.thumbnailUrl || '';
  }
  return '';
}

function normalizeDynamicFeed(data) {
  let rawItems = [];
  if (data && Array.isArray(data.itemListElement)) rawItems = data.itemListElement;
  else if (data && Array.isArray(data.events)) rawItems = data.events;
  else if (data && Array.isArray(data.items)) rawItems = data.items;
  else return [];

  return rawItems
    .filter(item => item && typeof item === 'object')
    .map((item, index) => {
      const title = item.name || item.title || item.displayName || '';
      const contentUrl = item.contentUrl || item.embedUrl || item.streamUrl || item.href || item.url || '';
      const startValue = item.startTime || item.start || item.startDate || item.uploadDate || '';
      const explicitEnd = item.endTime || item.end || item.endDate || '';
      const startMs = Date.parse(startValue);
      const durationMs = isoDurationSeconds(item.duration) * 1000;
      let stop = explicitEnd;
      if (!stop && Number.isFinite(startMs) && durationMs > 0) {
        stop = new Date(startMs + durationMs).toISOString();
      }

      return {
        title: String(title || '').trim(),
        description: String(item.description || '').trim(),
        contentUrl: String(contentUrl || '').trim(),
        logo: normalizeFeedImage(item.thumbnailUrl || item.image || item.logo),
        start: Number.isFinite(startMs) ? new Date(startMs).toISOString() : '',
        stop: stop && Number.isFinite(Date.parse(stop)) ? new Date(stop).toISOString() : '',
        position: Number.isFinite(Number(item.position)) ? Number(item.position) : index + 1,
      };
    })
    .filter(item => item.title)
    .sort((a, b) => a.position - b.position);
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
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

  // 3. Fetch discovered pages and extract maps or JSON feeds
  const dynamicSportMaps = {};
  const dynamicEventFeeds = {};
  const dynamicFeedSources = {};
  
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
      const jsonData = await fetchLive(jsonUrl, new URL(url, SITE_ORIGIN).href, { 'Accept': 'application/json' });
      if (jsonData.status === 200) {
        try {
          const streamsObj = JSON.parse(jsonData.body);
          if (!dynamicSportMaps[sport]) dynamicSportMaps[sport] = {};
          
          for (const [team, streams] of Object.entries(streamsObj)) {
            streams.forEach((s) => {
              dynamicSportMaps[sport][`${team} (${s.name})`] = s.url;
            });
          }
        } catch(e) {
          console.warn(`[${sport}] Could not parse GIST_URL response: ${e.message}`);
        }
      }
    }

    // C) Discover client-side JSON APIs, such as ESPN+'s fetch(API_URL).
    if (!noEvents) {
      const pageUrl = new URL(url, SITE_ORIGIN).href;
      const feedUrls = discoverJsonFeedUrls(pageData.body, pageUrl);
      for (const feedUrl of feedUrls) {
        console.log(`[${sport}] Inspecting dynamic JSON feed: ${feedUrl}`);
        const feedResp = await fetchLive(feedUrl, pageUrl, { 'Accept': 'application/json' });
        if (feedResp.status !== 200) continue;

        try {
          const items = normalizeDynamicFeed(JSON.parse(feedResp.body));
          if (items.length === 0) continue;
          if (!dynamicEventFeeds[sport]) dynamicEventFeeds[sport] = [];
          dynamicEventFeeds[sport].push(...items);
          dynamicFeedSources[sport] = feedUrl;
          console.log(`        -> Found ${items.length} scheduled item(s)`);
        } catch (e) {
          console.warn(`[${sport}] Ignoring non-event JSON feed ${feedUrl}: ${e.message}`);
        }
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

  // Dynamic Stream Base Discovery
  let currentStreamBase = FALLBACK_STREAM_BASE;
  console.log(`[Discovery] Fetching sample player to determine dynamic stream base...`);
  const sampleResp = await fetchLive('/247?streamid=sample&proid=sling');
  if (sampleResp.status === 200) {
    const baseMatch = sampleResp.body.match(/https?:\/\/[^\/]+\/\?stream_id=/i);
    if (baseMatch) {
      currentStreamBase = baseMatch[0].replace(/\?stream_id=$/i, '');
      console.log(`[Discovery] Dynamic stream base found: ${currentStreamBase}`);
    } else {
      console.log(`[Discovery] Dynamic stream base not found in sample, using fallback: ${currentStreamBase}`);
    }
  } else {
    console.log(`[Discovery] Could not fetch sample player, using fallback: ${currentStreamBase}`);
  }

  // 4. Build M3U
  const lines = [
    '#EXTM3U x-tvg-url=""',
    `# Generated from xyzstreams.st (Standalone Auto-Discovery) - ${new Date().toISOString()}`,
    `# Channels: ${slingChannels.length} | Homepage Events: ${eventsData.length} | Dynamic Feeds: ${Object.keys(dynamicEventFeeds).join(', ') || 'None'} | Discovered Sports: ${Object.keys(dynamicSportMaps).join(', ') || 'None'}`,
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
      let url = `${currentStreamBase}?stream_id=${encodeURIComponent(ch.id)}&pro_id=${PRO_ID}&index.m3u8`;
      
      if (ch.embedUrl && !ch.embedUrl.includes('{TEMPLATE}')) {
        console.log(`[Fetch] Resolving dynamic URL for ${ch.displayName} via ${ch.embedUrl}`);
        const embedPath = ch.embedUrl.startsWith('/') ? ch.embedUrl : '/' + ch.embedUrl;
        const resolved = await resolveEventStreamUrl(embedPath);
        if (resolved.length > 0) {
          url = resolved[0];
          console.log(`        -> Found dynamic URL: ${url}`);
        } else {
          console.log(`        -> No M3U8 found in embed, using fallback`);
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
      if (!/\.m3u8(?:[?#]|$)/i.test(url)) {
        console.log(`[${sport}] Resolving embed URL for ${teamOrName}: ${url}`);
        const resolved = await resolveEventStreamUrl(url);
        if (resolved && resolved.length > 0) {
          finalUrl = resolved[0];
        }
      }
      appendStream(`${sport}: ${teamOrName}`, sport, finalUrl);
    }
  }

  // Dynamically discovered scheduled-event feeds (ESPN+ and compatible schemas).
  const dynamicFeedStats = {};
  if (!noEvents) {
    for (const [sport, feedItems] of Object.entries(dynamicEventFeeds)) {
      const playableItems = feedItems.filter(item => item.contentUrl);
      const uniqueContentUrls = Array.from(new Set(playableItems.map(item => item.contentUrl)));
      const resolvedPairs = await mapLimit(uniqueContentUrls, 4, async contentUrl => {
        console.log(`[${sport}] Resolving feed player: ${contentUrl}`);
        const urls = await resolveEventStreamUrl(contentUrl);
        return [contentUrl, urls];
      });
      const streamsByContentUrl = new Map(resolvedPairs);
      let written = 0;
      let unresolved = 0;

      lines.push('#-----------------------------------------');
      lines.push(`# ${sport} SCHEDULED STREAMS (Dynamic Feed)`);
      lines.push(`# Source: ${dynamicFeedSources[sport] || 'auto-discovered JSON feed'}`);
      lines.push('#-----------------------------------------');

      for (const item of playableItems) {
        const streamUrls = streamsByContentUrl.get(item.contentUrl) || [];
        if (streamUrls.length === 0) {
          unresolved++;
          console.warn(`[${sport}] No playable M3U8 for: ${item.title} (${item.contentUrl})`);
          continue;
        }

        for (let i = 0; i < streamUrls.length; i++) {
          const title = streamUrls.length > 1 ? `${item.title} (Link ${i + 1})` : item.title;
          appendStream(title, sport, streamUrls[i], item.logo, item.start, item.stop);
          written++;
        }
      }

      dynamicFeedStats[sport] = {
        total: feedItems.length,
        linked: playableItems.length,
        missingUrl: feedItems.length - playableItems.length,
        unresolved,
        written,
      };
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
  for (const [sport, stats] of Object.entries(dynamicFeedStats)) {
    console.log(`   ${sport} Feed    : ${stats.written} written / ${stats.linked} linked / ${stats.total} total (${stats.missingUrl} without URL, ${stats.unresolved} unresolved)`);
  }
  
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    console.error("Fatal error during extraction:", err);
    process.exit(1);
  });
}

module.exports = {
  decodeHtmlUrl,
  discoverJsonFeedUrls,
  extractM3u8Urls,
  extractNestedPlayerUrls,
  isoDurationSeconds,
  normalizeDynamicFeed,
  parseEventsData,
  parseM3u8ChannelsMap,
  parseSlingLineupMap,
  resolveJsUrlTemplate,
  scriptVariablesForPage,
};
