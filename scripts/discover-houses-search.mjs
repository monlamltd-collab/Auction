#!/usr/bin/env node
// scripts/discover-houses-search.mjs
//
// Search-driven auction house discovery using Firecrawl /v2/search.
// Independent of third-party directories. Each result returns markdown
// inline (via scrapeOptions), so sentinel research runs without a second
// fetch.
//
// Output: discovery-output-search.json (gitignored). Manual review only.
//
// Run: FIRECRAWL_API_KEY=fc-... node scripts/discover-houses-search.mjs

import { writeFileSync } from 'node:fs';
import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES } from '../lib/houses.js';
import { normaliseUrl } from '../lib/utils.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) {
  console.error('ERROR: FIRECRAWL_API_KEY not set');
  process.exit(1);
}

const QUERIES = [
  { q: '"property auction" UK', limit: 30 },
  { q: 'UK property auctioneers', limit: 30 },
  { q: 'online property auction UK', limit: 30 },
  { q: '"land and property auction" UK', limit: 20 },
  { q: 'commercial property auction UK', limit: 20 },
  { q: 'residential property auction UK', limit: 20 },
  { q: 'property auction catalogue UK', limit: 20 },
  { q: 'property auction London', limit: 20 },
  { q: 'property auction Manchester', limit: 20 },
  { q: 'property auction Birmingham', limit: 20 },
  { q: 'property auction Leeds', limit: 20 },
  { q: 'property auction Liverpool', limit: 20 },
  { q: 'property auction Sheffield', limit: 20 },
  { q: 'property auction Newcastle', limit: 20 },
  { q: 'property auction Bristol', limit: 20 },
  { q: 'property auction Yorkshire', limit: 20 },
  { q: 'property auction Scotland', limit: 20 },
  { q: 'property auction Edinburgh', limit: 20 },
  { q: 'property auction Glasgow', limit: 20 },
  { q: 'property auction Wales', limit: 20 },
  { q: 'property auction Cardiff', limit: 20 },
  { q: 'property auction Northern Ireland', limit: 20 },
  { q: 'property auction Belfast', limit: 20 },
  { q: 'property auction Devon', limit: 20 },
  { q: 'property auction Cornwall', limit: 20 },
  { q: 'property auction East Anglia', limit: 20 },
  { q: 'property auction North East', limit: 20 },
];

const DOMAIN_BLOCKLIST = new Set([
  'propertyauctions.io', 'propertyauctionaction.co.uk', 'theauctionguide.com',
  'rightmove.co.uk', 'zoopla.co.uk', 'onthemarket.com', 'primelocation.com',
  'home.co.uk', 'nethouseprices.com',
  'theguardian.com', 'telegraph.co.uk', 'thetimes.com', 'bbc.co.uk', 'bbc.com',
  'thisismoney.co.uk', 'mortgagestrategy.co.uk', 'estateagenttoday.co.uk',
  'propertyindustryeye.com',
  'youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'linkedin.com',
  'instagram.com', 'reddit.com', 'wikipedia.org', 'quora.com',
  'gov.uk', 'parliament.uk', 'landregistry.gov.uk', 'companieshouse.gov.uk',
  'nava.org.uk', 'rics.org', 'naea.co.uk', 'propertymark.co.uk',
]);

const STOPWORDS = new Set([
  'auctions', 'auction', 'property', 'properties', 'auctioneers', 'auctioneer',
  'limited', 'ltd', 'and', 'co', 'company', 'group', '&', 'the',
  'plc', 'llp', 'partnership', 'partners',
]);
const NAV_PATTERNS = /\/(about|contact|login|sign-?in|sign-?up|register|privacy|terms|cookies?|sitemap|search|admin|account|legal|disclaimer|faq|help|news|blog|careers|jobs|press)(\/|\?|#|$)/i;
const ASSET_PATTERNS = /\.(jpg|jpeg|png|gif|svg|webp|css|js|pdf|ico|woff2?|ttf|mp4|mp3)(\?|$)/i;
const SOCIAL_PATTERNS = /(facebook\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|instagram\.com|pinterest\.com|tiktok\.com)/i;
const PATH_BLOCKLIST = /\/(news|blog|article|story|press|tag|category|author)\//i;
const TITLE_BLOCKLIST = /\b(news|article|blog|guide to|how to|what is|compared|vs\.?|best.{0,20}auction (house|company|sites?))\b/i;

const FIRECRAWL_GAP_MS = 500;
const PER_CALL_TIMEOUT_MS = 180000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getHostname(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

function tokenise(name) {
  return new Set(
    String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/).filter(Boolean).filter(w => !STOPWORDS.has(w))
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let i = 0; for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
}

function slugify(name) {
  return String(name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '').slice(0, 32);
}

function classifyPlatform(url) {
  const h = getHostname(url) || '';
  if (/eigonlineauctions\.com|eigpropertyauctions\.co\.uk/.test(h)) return 'EIG';
  if (/auctionhouse\.co\.uk/.test(h)) return 'AH UK';
  if (/bambooauctions\.com/.test(h)) return 'Bamboo';
  if (/sdlauctions\.co\.uk|btgeddisons/.test(h)) return 'SDL';
  if (/iamsold\.co\.uk/.test(h)) return 'iamsold';
  if (/sequenceauctions\.co\.uk/.test(h)) return 'Sequence';
  return 'bespoke';
}

function knownPlatformSentinel(platform) {
  switch (platform) {
    case 'EIG':
    case 'AH UK': return '/\\/lot\\/(?:details|redirect)\\/(\\d+)/g';
    case 'Bamboo': return '/\\/property\\/([a-z0-9_-]{6,})/gi';
    default: return null;
  }
}

function buildFallbackSentinel(catalogueUrl) {
  const host = getHostname(catalogueUrl);
  if (!host) return null;
  const escapedHost = host.replace(/\./g, '\\.');
  return `/${escapedHost}\\/(?:lot|property|properties|auction|auctions|listing|listings|propert(?:y|ies)|sale|sales|details|view)\\/(\\d+|[a-z0-9-]{6,})/gi`;
}

async function firecrawlSearch(query, limit, retry = 0) {
  try {
    const resp = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query, limit, location: 'gb',
        scrapeOptions: { formats: ['markdown'] },
      }),
      signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
    });
    if (!resp.ok) {
      if (resp.status >= 500 && retry < 1) {
        await sleep(3000);
        return firecrawlSearch(query, limit, retry + 1);
      }
      const text = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, error: text.slice(0, 200) };
    }
    const data = await resp.json();
    if (!data.success) return { ok: false, error: data.error || 'success=false' };
    return { ok: true, results: data.data?.web || [], creditsUsed: data.creditsUsed || 0 };
  } catch (err) {
    if (retry < 1) {
      await sleep(3000);
      return firecrawlSearch(query, limit, retry + 1);
    }
    return { ok: false, error: err.message };
  }
}

function extractLotUrls(markdown, candidateUrl) {
  const candidateDomain = getHostname(candidateUrl);
  if (!candidateDomain) return [];
  const urls = [];
  const urlRe = /https?:\/\/[^\s)"\]<>]+/g;
  let m;
  while ((m = urlRe.exec(markdown)) !== null) {
    let url = m[0].replace(/[.,;:!?'"]+$/, '');
    const host = getHostname(url);
    if (!host) continue;
    if (host !== candidateDomain && !host.endsWith('.' + candidateDomain) && !candidateDomain.endsWith('.' + host)) continue;
    if (NAV_PATTERNS.test(url)) continue;
    if (ASSET_PATTERNS.test(url)) continue;
    if (SOCIAL_PATTERNS.test(host)) continue;
    if (normaliseUrl(url) === normaliseUrl(candidateUrl)) continue;
    urls.push(url);
  }
  return urls;
}

function patternKey(url) {
  try {
    const u = new URL(url);
    let path = u.pathname;
    path = path.replace(/\/\d+/g, '/__NUM__');
    path = path.replace(/\/[a-z0-9_-]{4,}/gi, seg => {
      if (seg.includes('__NUM__')) return seg;
      return '/__SLUG__';
    });
    if (u.search) {
      const params = [...new URLSearchParams(u.search).keys()].sort().join(',');
      return path + '?' + params;
    }
    return path;
  } catch { return url; }
}

function buildRegexFromUrls(urls) {
  if (urls.length === 0) return null;
  const sample = urls[0];
  try {
    const u = new URL(sample);
    const path = u.pathname;
    const host = u.hostname.replace(/^www\./, '').replace(/\./g, '\\.');
    if (u.search) {
      const idKey = [...new URLSearchParams(u.search).keys()][0];
      if (idKey) {
        const escapedPath = path.replace(/\./g, '\\.').replace(/\//g, '\\/');
        return `/${host}${escapedPath}\\?[^"\\s]*${idKey}=(\\d+)/gi`;
      }
    }
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    const lastSeg = segments[segments.length - 1] || '';
    const prefixSegs = segments.slice(0, -1).map(s => s.replace(/\./g, '\\.'));
    const prefix = prefixSegs.length > 0 ? '\\/' + prefixSegs.join('\\/') : '';
    if (/^\d+$/.test(lastSeg)) return `/${host}${prefix}\\/(\\d+)/gi`;
    if (/^[a-z0-9-]{6,}$/i.test(lastSeg)) return `/${host}${prefix}\\/([a-z0-9-]+)/gi`;
    const numIdx = segments.findIndex(s => /^\d{3,}$/.test(s));
    if (numIdx >= 0) {
      const prefSegs = segments.slice(0, numIdx).map(s => s.replace(/\./g, '\\.'));
      const pref = prefSegs.length > 0 ? '\\/' + prefSegs.join('\\/') : '';
      return `/${host}${pref}\\/(\\d+)/gi`;
    }
    return null;
  } catch { return null; }
}

function researchSentinelFromMarkdown(candidate, markdown) {
  const platform = classifyPlatform(candidate.url);
  const known = knownPlatformSentinel(platform);
  if (known) {
    return {
      platform, sentinelRegex: known, sentinelConfidence: 'high',
      sentinelStrategy: 'platform', lotUrlsSeen: null, note: 'platform_default',
    };
  }
  const fallback = buildFallbackSentinel(candidate.url);
  if (!markdown) {
    return {
      platform, sentinelRegex: fallback, sentinelConfidence: 'low',
      sentinelStrategy: 'fallback_keyword', lotUrlsSeen: 0, error: 'no_markdown',
    };
  }
  const lotUrls = extractLotUrls(markdown, candidate.url);
  if (lotUrls.length === 0) {
    return {
      platform, sentinelRegex: fallback, sentinelConfidence: 'low',
      sentinelStrategy: 'fallback_keyword', lotUrlsSeen: 0, error: 'no_lot_urls_found',
    };
  }
  const groups = new Map();
  for (const u of lotUrls) {
    const k = patternKey(u);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(u);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const [topKey, topUrls] = sortedGroups[0];
  const groupCount = topUrls.length;
  if (groupCount < 3) {
    return {
      platform, sentinelRegex: fallback, sentinelConfidence: 'low',
      sentinelStrategy: 'fallback_keyword', lotUrlsSeen: lotUrls.length,
      topGroupCount: groupCount, error: 'no_repeating_pattern',
    };
  }
  const regex = buildRegexFromUrls(topUrls);
  if (!regex) {
    return {
      platform, sentinelRegex: fallback, sentinelConfidence: 'low',
      sentinelStrategy: 'fallback_keyword', lotUrlsSeen: lotUrls.length,
      topGroupCount: groupCount, samplePattern: topKey,
      sampleUrls: topUrls.slice(0, 3), error: 'regex_build_failed',
    };
  }
  const confidence = groupCount >= 5 ? 'high' : 'medium';
  return {
    platform, sentinelRegex: regex, sentinelConfidence: confidence,
    sentinelStrategy: 'derived_from_urls', lotUrlsSeen: lotUrls.length,
    topGroupCount: groupCount, samplePattern: topKey,
    sampleUrls: topUrls.slice(0, 3),
  };
}

function buildExistingIndex() {
  const byHostname = new Map();
  const familiesByHostname = new Map();
  const byTokenSet = [];
  for (const [slug, url] of Object.entries(HOUSE_ROOTS)) {
    const host = getHostname(url);
    if (!host) continue;
    if (!byHostname.has(host)) byHostname.set(host, slug);
    if (!familiesByHostname.has(host)) familiesByHostname.set(host, []);
    familiesByHostname.get(host).push(slug);
  }
  for (const [slug, displayName] of Object.entries(HOUSE_DISPLAY_NAMES)) {
    byTokenSet.push({ slug, displayName, tokens: tokenise(displayName) });
  }
  return { byHostname, familiesByHostname, byTokenSet };
}

function dedupAgainstExisting(candidate, index) {
  if (index.familiesByHostname.has(candidate.hostname)) {
    const family = index.familiesByHostname.get(candidate.hostname);
    return {
      status: 'duplicate', existingSlug: family[0], familySlugs: family,
      reason: family.length > 1 ? 'brand_family_match' : 'hostname_match',
    };
  }
  for (const [existingHost, slug] of index.byHostname) {
    if (candidate.hostname.endsWith('.' + existingHost) || existingHost.endsWith('.' + candidate.hostname)) {
      const family = index.familiesByHostname.get(existingHost) || [slug];
      return { status: 'duplicate', existingSlug: slug, familySlugs: family, reason: 'hostname_subdomain_match' };
    }
  }
  const candTokens = tokenise(candidate.name);
  if (candTokens.size === 0) return { status: 'new' };
  let bestJ = 0, bestSlug = null, bestDisplay = null;
  for (const e of index.byTokenSet) {
    const j = jaccard(candTokens, e.tokens);
    if (j > bestJ) { bestJ = j; bestSlug = e.slug; bestDisplay = e.displayName; }
  }
  if (bestJ >= 0.8) return { status: 'duplicate', existingSlug: bestSlug, reason: 'name_match', jaccard: +bestJ.toFixed(2) };
  if (bestJ >= 0.5) {
    return {
      status: 'needsReview', possibleExistingSlug: bestSlug, possibleExistingName: bestDisplay,
      reason: 'fuzzy_name_match', jaccard: +bestJ.toFixed(2),
    };
  }
  return { status: 'new' };
}

function dedupWithinBatch(candidates) {
  const byHost = new Map();
  for (const c of candidates) {
    if (!byHost.has(c.hostname)) {
      byHost.set(c.hostname, c);
    } else {
      const existing = byHost.get(c.hostname);
      for (const q of c.queries) if (!existing.queries.includes(q)) existing.queries.push(q);
      if (!existing.markdown && c.markdown) {
        existing.markdown = c.markdown;
        existing.url = c.url;
      }
      if (c.name && c.name.length > (existing.name || '').length) existing.name = c.name;
    }
  }
  return [...byHost.values()];
}

function isPlausibleAuctionHouseResult(result) {
  const host = getHostname(result.url);
  if (!host) return false;
  if (DOMAIN_BLOCKLIST.has(host)) return false;
  if (PATH_BLOCKLIST.test(result.url)) return false;
  if (TITLE_BLOCKLIST.test(result.title || '')) return false;
  return true;
}

async function main() {
  console.log('═'.repeat(70));
  console.log('Search-driven house discovery (Firecrawl /v2/search)');
  console.log('═'.repeat(70));
  console.log(`Existing houses: ${Object.keys(HOUSE_ROOTS).length}`);
  console.log(`Queries: ${QUERIES.length}`);
  console.log('');

  const index = buildExistingIndex();
  const allRawResults = [];
  let totalCredits = 0;

  for (let i = 0; i < QUERIES.length; i++) {
    const { q, limit } = QUERIES[i];
    process.stdout.write(`[search ${i+1}/${QUERIES.length}] "${q}" ... `);
    const result = await firecrawlSearch(q, limit);
    if (!result.ok) {
      console.log(`FAIL: ${result.error || result.status}`);
      continue;
    }
    totalCredits += result.creditsUsed || 0;
    console.log(`${result.results.length} results, ${result.creditsUsed} credits`);
    for (const r of result.results) allRawResults.push({ ...r, query: q });
    await sleep(FIRECRAWL_GAP_MS);
  }

  console.log('');
  console.log(`Total raw results: ${allRawResults.length}`);
  console.log(`Total credits used: ${totalCredits}`);

  const filtered = allRawResults.filter(isPlausibleAuctionHouseResult);
  console.log(`After blocklist + article filter: ${filtered.length}`);

  const candidates = filtered.map(r => ({
    name: r.title || '',
    url: r.url,
    hostname: getHostname(r.url),
    markdown: r.markdown || '',
    queries: [r.query],
  })).filter(c => c.hostname);

  const unique = dedupWithinBatch(candidates);
  console.log(`Unique by hostname: ${unique.length}`);

  const newList = [];
  const duplicates = [];
  const needsReview = [];

  for (const candidate of unique) {
    const dedupResult = dedupAgainstExisting(candidate, index);
    if (dedupResult.status === 'duplicate') {
      duplicates.push({
        name: candidate.name, url: candidate.url,
        existingSlug: dedupResult.existingSlug, familySlugs: dedupResult.familySlugs,
        reason: dedupResult.reason, jaccard: dedupResult.jaccard,
        queries: candidate.queries,
      });
      continue;
    }
    if (dedupResult.status === 'needsReview') {
      needsReview.push({
        name: candidate.name, url: candidate.url,
        possibleExistingSlug: dedupResult.possibleExistingSlug,
        possibleExistingName: dedupResult.possibleExistingName,
        reason: dedupResult.reason, jaccard: dedupResult.jaccard,
        queries: candidate.queries,
      });
      continue;
    }
    const research = researchSentinelFromMarkdown(candidate, candidate.markdown);
    const entry = {
      slug: slugify(candidate.name),
      displayName: candidate.name,
      catalogueUrl: candidate.url,
      platform: research.platform,
      sentinelRegex: research.sentinelRegex,
      sentinelConfidence: research.sentinelConfidence,
      sentinelStrategy: research.sentinelStrategy,
      lotUrlsSeen: research.lotUrlsSeen,
      queries: candidate.queries,
    };
    if (research.samplePattern) entry.samplePattern = research.samplePattern;
    if (research.sampleUrls) entry.sampleUrls = research.sampleUrls;
    if (research.error) entry.error = research.error;
    if (research.note) entry.note = research.note;
    newList.push(entry);
  }

  console.log(`After dedup: ${duplicates.length} duplicates, ${needsReview.length} needsReview, ${newList.length} new`);

  const sentinelStrategyCounts = {};
  const sentinelConfidenceCounts = {};
  const platformCounts = {};
  for (const e of newList) {
    sentinelStrategyCounts[e.sentinelStrategy] = (sentinelStrategyCounts[e.sentinelStrategy] || 0) + 1;
    sentinelConfidenceCounts[e.sentinelConfidence] = (sentinelConfidenceCounts[e.sentinelConfidence] || 0) + 1;
    platformCounts[e.platform] = (platformCounts[e.platform] || 0) + 1;
  }
  const familiesDetected = duplicates
    .filter(d => d.familySlugs && d.familySlugs.length > 1)
    .map(d => ({ hostname: getHostname(d.url), slugs: d.familySlugs, triggeredBy: d.name }));

  const output = {
    runAt: new Date().toISOString(),
    queries: QUERIES.map(qq => qq.q),
    totalRawResults: allRawResults.length,
    afterBlocklistFilter: filtered.length,
    uniqueByHostname: unique.length,
    creditsUsed: totalCredits,
    summary: {
      new: newList.length,
      duplicates: duplicates.length,
      needsReview: needsReview.length,
    },
    analysis: {
      sentinelStrategies: sentinelStrategyCounts,
      sentinelConfidence: sentinelConfidenceCounts,
      platforms: platformCounts,
      brandFamiliesTriggered: familiesDetected,
    },
    new: newList,
    duplicates,
    needsReview,
  };

  const outPath = 'discovery-output-search.json';
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log('');
  console.log('═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log(`new:         ${newList.length}`);
  console.log(`duplicates:  ${duplicates.length}`);
  console.log(`needsReview: ${needsReview.length}`);
  console.log(`credits:     ${totalCredits}`);
  console.log('');
  console.log('Sentinel strategy breakdown (new):');
  for (const [s, n] of Object.entries(sentinelStrategyCounts)) {
    console.log(`  ${s.padEnd(22)} ${n}`);
  }
  console.log('');
  console.log(`Written to: ${outPath}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
