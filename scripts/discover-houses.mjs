#!/usr/bin/env node
// scripts/discover-houses.mjs
//
// One-shot Firecrawl-powered discovery of new UK auction houses.
//
// Crawls a list of auction-house directories, extracts candidate
// { name, url } pairs from the markdown, deduplicates them (within-batch
// and against the existing HOUSE_ROOTS registry), then for each genuinely-
// new candidate visits the catalogue page and proposes a RECALL_SENTINELS
// regex by finding repeating lot-URL patterns in the markdown.
//
// Output: discovery-output.json (gitignored). Review manually, then paste
// approved entries into lib/houses.js + lib/analysis.js. No auto-apply.
//
// Run:
//   FIRECRAWL_API_KEY=xxx node scripts/discover-houses.mjs

import { writeFileSync } from 'node:fs';
import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES } from '../lib/houses.js';
import { normaliseUrl } from '../lib/utils.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) {
  console.error('ERROR: FIRECRAWL_API_KEY not set');
  process.exit(1);
}

// ── Configuration ───────────────────────────────────────────────────

// followProfiles=true means candidates from this directory are internal
// profile/listing pages (e.g. propertyauctions.io/auctioneers/savills) that
// must be fetched individually to extract the actual auction house's
// outbound website URL. followProfiles=false means the directory page lists
// outbound URLs directly.
// Many directory pages lazy-load entries on scroll. Firecrawl actions chain
// scrolls + waits to coax the full list out before the markdown is captured.
const SCROLL_ACTIONS = [
  { type: 'wait', milliseconds: 3000 },
  { type: 'scroll', direction: 'down' },
  { type: 'wait', milliseconds: 2000 },
  { type: 'scroll', direction: 'down' },
  { type: 'wait', milliseconds: 2000 },
  { type: 'scroll', direction: 'down' },
  { type: 'wait', milliseconds: 2000 },
  { type: 'scroll', direction: 'down' },
  { type: 'wait', milliseconds: 2000 },
  { type: 'scroll', direction: 'down' },
  { type: 'wait', milliseconds: 2000 },
];

// Two crawl modes:
// (a) Sitemap mode: fetch a sitemap.xml index → fetch each child sitemap
//     → extract every URL matching profileUrlPattern. This is the canonical
//     source for a directory's full inventory (e.g. propertyauctions.io
//     advertises 250+ but only ~20 appear on the /auctioneers page; the
//     sitemap holds 600+).
// (b) HTML mode: fetch a directory page, extract markdown links matching
//     profileUrlPattern. Fallback for directories without a useful sitemap.
const DIRECTORIES = [
  {
    name: 'propertyauctions.io',
    sitemapIndex: 'https://propertyauctions.io/sitemap.xml',
    profileUrlPattern: /^https?:\/\/(?:www\.)?propertyauctions\.io\/auctioneers\/[^/?#]+$/i,
    followProfiles: true,
  },
  {
    name: 'propertyauctionaction',
    url: 'https://www.propertyauctionaction.co.uk/auction-houses/',
    waitFor: 3000,
    actions: SCROLL_ACTIONS,
    followProfiles: true,
    profileUrlPattern: /^https?:\/\/(?:www\.)?propertyauctionaction\.co\.uk\/[a-z0-9-]+\/?$/i,
  },
];

// Concurrency for profile-follow + sentinel research stages. Firecrawl's
// rate limit is generous; 5 parallel requests is well within bounds.
const CONCURRENCY = 5;

const STOPWORDS = new Set([
  'auctions', 'auction', 'property', 'properties', 'auctioneers', 'auctioneer',
  'limited', 'ltd', 'and', 'co', 'company', 'group', '&', 'the',
  'plc', 'llp', 'partnership', 'partners',
]);

const NAV_PATTERNS = /\/(about|contact|login|sign-?in|sign-?up|register|privacy|terms|cookies?|sitemap|search|admin|account|legal|disclaimer|faq|help|news|blog|careers|jobs|press)(\/|\?|#|$)/i;
const ASSET_PATTERNS = /\.(jpg|jpeg|png|gif|svg|webp|css|js|pdf|ico|woff2?|ttf|mp4|mp3)(\?|$)/i;
const SOCIAL_PATTERNS = /(facebook\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|instagram\.com|pinterest\.com|tiktok\.com)/i;

const FIRECRAWL_GAP_MS = 300;
const RETRY_DELAY_MS = 2000;
const PER_CALL_TIMEOUT_MS = 90000;

// ── Helpers ─────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function tokenise(name) {
  return new Set(
    String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter(w => !STOPWORDS.has(w))
  );
}

function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 32);
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
    case 'AH UK':
      return '/\\/lot\\/(?:details|redirect)\\/(\\d+)/g';
    case 'Bamboo':
      return '/\\/property\\/([a-z0-9_-]{6,})/gi';
    default:
      return null;
  }
}

// Fallback sentinel for a host where we couldn't identify a clean lot-URL
// pattern. The user's directive: every house gets a sentinel — the cost of
// having one is zero, and a wide-net fallback still surfaces recall
// asymmetry (mdIds vs jsonIds) even when the regex over-matches. It's
// intentionally permissive: matches any URL on the host whose path contains
// a recognisable lot-related keyword followed by an ID or slug. False
// positives only inflate mdIds, which surfaces as low recall — that's
// information, not breakage.
function buildFallbackSentinel(catalogueUrl) {
  const host = getHostname(catalogueUrl);
  if (!host) return null;
  const escapedHost = host.replace(/\./g, '\\.');
  return `/${escapedHost}\\/(?:lot|property|properties|auction|auctions|listing|listings|propert(?:y|ies)|sale|sales|details|view)\\/(\\d+|[a-z0-9-]{6,})/gi`;
}

// ── Sitemap (plain HTTP, XML) ───────────────────────────────────────

async function fetchSitemap(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuctionDiscoveryBot/1.0)' },
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

function extractLocsFromXml(xml) {
  const out = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

async function harvestSitemapProfileUrls(sitemapIndexUrl, profileUrlPattern) {
  const indexXml = await fetchSitemap(sitemapIndexUrl);
  if (!indexXml) return { ok: false, error: 'index_fetch_failed' };
  const childSitemaps = extractLocsFromXml(indexXml);
  // If the "index" already contains direct URLs (not other sitemaps), use those
  const directMatches = childSitemaps.filter(u => profileUrlPattern.test(u));
  const childSitemapUrls = childSitemaps.filter(u => !profileUrlPattern.test(u));

  const profileUrls = new Set(directMatches);
  for (const childUrl of childSitemapUrls) {
    const childXml = await fetchSitemap(childUrl);
    if (!childXml) continue;
    for (const u of extractLocsFromXml(childXml)) {
      if (profileUrlPattern.test(u)) profileUrls.add(u);
    }
  }
  return { ok: true, urls: [...profileUrls] };
}

// ── Concurrency helper ──────────────────────────────────────────────

async function runWithConcurrency(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let nextIdx = 0;
  let completed = 0;
  async function pump() {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = { error: err.message };
      }
      completed++;
      if (onProgress) onProgress(completed, items.length);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => pump());
  await Promise.all(workers);
  return results;
}

// ── Firecrawl ───────────────────────────────────────────────────────

async function firecrawlScrape(url, { waitFor = 2000, actions = null, retry = 0 } = {}) {
  try {
    const body = { url, formats: ['markdown'], waitFor };
    if (actions) body.actions = actions;

    const resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
    });

    if (!resp.ok) {
      const status = resp.status;
      if (status >= 500 && retry < 1) {
        await sleep(RETRY_DELAY_MS);
        return firecrawlScrape(url, { waitFor, actions, retry: retry + 1 });
      }
      const text = await resp.text().catch(() => '');
      return { ok: false, status, error: text.slice(0, 200) };
    }

    const data = await resp.json();
    if (!data.success) {
      return { ok: false, error: data.error || 'success=false' };
    }
    return { ok: true, markdown: data.data?.markdown || '' };
  } catch (err) {
    if (retry < 1) {
      await sleep(RETRY_DELAY_MS);
      return firecrawlScrape(url, { waitFor, actions, retry: retry + 1 });
    }
    return { ok: false, error: err.message };
  }
}

// ── Candidate extraction from directory markdown ────────────────────

// Reject names that look like blog articles, FAQs, or nav text rather than
// an auction house name. Names with question marks, "compared", "vs",
// "guide", "how to", "what is", or names longer than 60 chars are very
// unlikely to be real auction house names.
const ARTICLE_NAME_PATTERN = /\b(compared|guide|faq|how[ -]?to|what[ -]?is|vs\.?|versus|tips|advice|explained|review|the (best|top|ultimate))\b|\?/i;
const NAV_NAME_EXACT = /^(home|about|contact|search|login|register|sign in|sign up|terms|privacy|cookies|menu|next|previous|view all|see more|read more|click here|members?|services|pricing|blog|news|find|listings|properties)$/i;

function isPlausibleAuctionHouseName(name) {
  const trimmed = name.trim();
  if (trimmed.length < 3) return false;
  if (trimmed.length > 60) return false;
  if (NAV_NAME_EXACT.test(trimmed)) return false;
  if (ARTICLE_NAME_PATTERN.test(trimmed)) return false;
  return true;
}

function extractCandidatesFromMarkdown(markdown, sourceName, directory) {
  const directoryHostname = getHostname(directory.url);
  const candidates = [];
  const linkRe = /\[([^\]]{2,80})\]\((https?:\/\/[^)\s]+)\)/g;
  let m;
  while ((m = linkRe.exec(markdown)) !== null) {
    const name = m[1].trim();
    const url = m[2].trim();
    const host = getHostname(url);
    if (!host) continue;
    if (SOCIAL_PATTERNS.test(host)) continue;
    if (ASSET_PATTERNS.test(url)) continue;
    if (NAV_PATTERNS.test(url)) continue;
    if (!isPlausibleAuctionHouseName(name)) continue;

    // Determine candidate type:
    //  - sameHostAsDirectory: an internal profile/listing page on the
    //    directory itself. Only useful if the directory's profile pages link
    //    out to the actual auction house — handled by followProfiles step.
    //  - outbound: a direct link to an external auction house website.
    const sameHostAsDirectory = host === directoryHostname ||
      host.endsWith('.' + directoryHostname) ||
      directoryHostname.endsWith('.' + host);

    if (sameHostAsDirectory) {
      // Only useful if the directory has follow-profile mode enabled AND
      // the URL matches the profile pattern (filters out blog posts, etc.)
      if (!directory.followProfiles) continue;
      if (directory.profileUrlPattern && !directory.profileUrlPattern.test(url)) continue;
      candidates.push({
        name,
        profileUrl: url,
        url: null,         // will be filled by follow-profile step
        hostname: null,
        sources: [sourceName],
        kind: 'profile',
      });
    } else {
      candidates.push({
        name,
        url,
        hostname: host,
        sources: [sourceName],
        kind: 'outbound',
      });
    }
  }
  return candidates;
}

// ── Follow profile pages to extract outbound URLs ───────────────────

// Score outbound links by auction-relevance. Prefer links whose URL or text
// hints at an auction catalogue (e.g. "View auctions", /auctions/, /lots/)
// over generic homepage links. Falls back to the first plausible outbound.
const AUCTION_KEYWORDS = /(auction|lot|catalogue|catalog|properties[\W_]for[\W_]auction|forthcoming[\W_]auction|current[\W_]auction|live[\W_]auction|book[\W_]auction|view[\W_]auction)/i;

function scoreOutboundLink({ url, host, anchorText }) {
  let score = 1; // base score for any plausible outbound
  if (AUCTION_KEYWORDS.test(url)) score += 5;
  if (AUCTION_KEYWORDS.test(anchorText || '')) score += 3;
  // Subdomain like `auctions.example.co.uk` is a strong signal
  if (/^(auctions?|lots?|catalogue)\./i.test(host)) score += 4;
  return score;
}

async function followProfilePage(profileCandidate, directoryHostname) {
  const result = await firecrawlScrape(profileCandidate.profileUrl, { waitFor: 2000 });
  if (!result.ok) {
    return { ok: false, error: result.error || result.status };
  }
  // Collect all plausible outbound links and pick the highest-scoring one.
  const linkRe = /\[([^\]]{0,80})\]\((https?:\/\/[^)\s]+)\)/g;
  let m;
  const outbounds = [];
  while ((m = linkRe.exec(result.markdown)) !== null) {
    const anchorText = m[1].trim();
    const url = m[2].trim();
    const host = getHostname(url);
    if (!host) continue;
    if (host === directoryHostname || host.endsWith('.' + directoryHostname)) continue;
    if (SOCIAL_PATTERNS.test(host)) continue;
    if (ASSET_PATTERNS.test(url)) continue;
    if (/google\.com|google\.co\.uk|maps\.google|wikipedia\.org/.test(host)) continue;
    if (/^mailto:|^tel:/.test(url)) continue;
    outbounds.push({ url, host, anchorText, score: 0 });
  }
  if (outbounds.length === 0) {
    return { ok: false, error: 'no_outbound_link_found' };
  }
  // Score each, sort descending, pick top
  for (const o of outbounds) o.score = scoreOutboundLink(o);
  outbounds.sort((a, b) => b.score - a.score);
  const winner = outbounds[0];
  return {
    ok: true,
    url: winner.url,
    hostname: winner.host,
    score: winner.score,
    candidateCount: outbounds.length,
  };
}

// ── Within-batch dedup ──────────────────────────────────────────────

function dedupWithinBatch(candidates) {
  const byKey = new Map();
  for (const c of candidates) {
    const key = normaliseUrl(c.url);
    if (!byKey.has(key)) {
      byKey.set(key, c);
    } else {
      const existing = byKey.get(key);
      for (const s of c.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s);
      }
      if (c.name.length > existing.name.length) existing.name = c.name;
    }
  }
  const byHost = new Map();
  for (const c of byKey.values()) {
    if (!byHost.has(c.hostname)) {
      byHost.set(c.hostname, c);
    } else {
      const existing = byHost.get(c.hostname);
      for (const s of c.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s);
      }
      if (c.name.length > existing.name.length) existing.name = c.name;
    }
  }
  return [...byHost.values()];
}

// ── Dedup against existing registry ─────────────────────────────────

// Brand families: multiple slugs share the same hostname because one parent
// company runs several brands (e.g. BTG Eddisons hosts sdl + network +
// markjenkinson on btgeddisonspropertyauctions.com; iamsold hosts
// driversnorris + wrightmarshall + davidjames). Discovery should report
// matches against the whole family, not just the first slug it bumps into.
function buildExistingIndex() {
  const byHostname = new Map();              // hostname → primary slug (first seen)
  const familiesByHostname = new Map();      // hostname → [slug1, slug2, ...]
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
  // Layer 1a: exact hostname match — surface the whole brand family
  if (index.familiesByHostname.has(candidate.hostname)) {
    const family = index.familiesByHostname.get(candidate.hostname);
    return {
      status: 'duplicate',
      existingSlug: family[0],
      familySlugs: family,
      reason: family.length > 1 ? 'brand_family_match' : 'hostname_match',
    };
  }

  // Layer 1b: subdomain match (candidate is subdomain of existing or vice versa)
  for (const [existingHost, slug] of index.byHostname) {
    if (candidate.hostname.endsWith('.' + existingHost) || existingHost.endsWith('.' + candidate.hostname)) {
      const family = index.familiesByHostname.get(existingHost) || [slug];
      return {
        status: 'duplicate',
        existingSlug: slug,
        familySlugs: family,
        reason: 'hostname_subdomain_match',
      };
    }
  }

  // Layer 2: token-set Jaccard
  const candTokens = tokenise(candidate.name);
  if (candTokens.size === 0) {
    return { status: 'new' };
  }
  let bestJ = 0;
  let bestSlug = null;
  let bestDisplay = null;
  for (const e of index.byTokenSet) {
    const j = jaccard(candTokens, e.tokens);
    if (j > bestJ) {
      bestJ = j;
      bestSlug = e.slug;
      bestDisplay = e.displayName;
    }
  }
  if (bestJ >= 0.8) {
    return { status: 'duplicate', existingSlug: bestSlug, reason: 'name_match', jaccard: +bestJ.toFixed(2) };
  }
  if (bestJ >= 0.5) {
    return {
      status: 'needsReview',
      possibleExistingSlug: bestSlug,
      possibleExistingName: bestDisplay,
      reason: 'fuzzy_name_match',
      jaccard: +bestJ.toFixed(2),
    };
  }

  return { status: 'new' };
}

// ── Sentinel research ───────────────────────────────────────────────

function extractLotUrls(markdown, candidateUrl) {
  const candidateDomain = getHostname(candidateUrl);
  if (!candidateDomain) return [];
  const urls = [];
  const urlRe = /https?:\/\/[^\s)"\]<>]+/g;
  let m;
  while ((m = urlRe.exec(markdown)) !== null) {
    let url = m[0];
    url = url.replace(/[.,;:!?'"]+$/, '');
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
  } catch {
    return url;
  }
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
    const lastSeg = segments[segments.length - 1] || '';

    if (/^\d+$/.test(lastSeg)) {
      const prefix = segments.slice(0, -1).map(s => s.replace(/\./g, '\\.')).join('\\/');
      return `/${host}\\/${prefix}\\/(\\d+)/gi`;
    }
    if (/^[a-z0-9-]{6,}$/i.test(lastSeg)) {
      const prefix = segments.slice(0, -1).map(s => s.replace(/\./g, '\\.')).join('\\/');
      return `/${host}\\/${prefix}\\/([a-z0-9-]+)/gi`;
    }
    const numIdx = segments.findIndex(s => /^\d{3,}$/.test(s));
    if (numIdx >= 0) {
      const prefix = segments.slice(0, numIdx).map(s => s.replace(/\./g, '\\.')).join('\\/');
      return `/${host}\\/${prefix}\\/(\\d+)/gi`;
    }
    return null;
  } catch {
    return null;
  }
}

async function researchSentinel(candidate) {
  const platform = classifyPlatform(candidate.url);
  const known = knownPlatformSentinel(platform);
  if (known) {
    return {
      platform,
      sentinelRegex: known,
      sentinelConfidence: 'high',
      sentinelStrategy: 'platform',
      lotUrlsSeen: null,
      note: 'platform_default',
    };
  }

  const fallback = buildFallbackSentinel(candidate.url);

  const result = await firecrawlScrape(candidate.url, { waitFor: 2000 });
  if (!result.ok) {
    return {
      platform,
      sentinelRegex: fallback,
      sentinelConfidence: 'low',
      sentinelStrategy: 'fallback_keyword',
      lotUrlsSeen: 0,
      error: `fetch_failed: ${result.error || result.status}`,
    };
  }

  const lotUrls = extractLotUrls(result.markdown, candidate.url);
  if (lotUrls.length === 0) {
    return {
      platform,
      sentinelRegex: fallback,
      sentinelConfidence: 'low',
      sentinelStrategy: 'fallback_keyword',
      lotUrlsSeen: 0,
      error: 'no_lot_urls_found',
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
      platform,
      sentinelRegex: fallback,
      sentinelConfidence: 'low',
      sentinelStrategy: 'fallback_keyword',
      lotUrlsSeen: lotUrls.length,
      topGroupCount: groupCount,
      error: 'no_repeating_pattern',
    };
  }

  const regex = buildRegexFromUrls(topUrls);
  if (!regex) {
    return {
      platform,
      sentinelRegex: fallback,
      sentinelConfidence: 'low',
      sentinelStrategy: 'fallback_keyword',
      lotUrlsSeen: lotUrls.length,
      topGroupCount: groupCount,
      samplePattern: topKey,
      sampleUrls: topUrls.slice(0, 3),
      error: 'regex_build_failed',
    };
  }

  let confidence;
  if (groupCount >= 5) confidence = 'high';
  else confidence = 'medium';

  return {
    platform,
    sentinelRegex: regex,
    sentinelConfidence: confidence,
    sentinelStrategy: 'derived_from_urls',
    lotUrlsSeen: lotUrls.length,
    topGroupCount: groupCount,
    samplePattern: topKey,
    sampleUrls: topUrls.slice(0, 3),
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(70));
  console.log('Firecrawl-powered house discovery');
  console.log('═'.repeat(70));
  console.log(`Existing houses: ${Object.keys(HOUSE_ROOTS).length}`);
  console.log(`Directories to crawl: ${DIRECTORIES.length}`);
  console.log('');

  const index = buildExistingIndex();

  const allCandidates = [];
  const sourcesScraped = [];
  const followFailures = [];

  for (const dir of DIRECTORIES) {
    let extracted = [];
    let directoryHostname = null;

    if (dir.sitemapIndex) {
      // ── Sitemap mode ─────────────────────────────────────────
      console.log(`[crawl] ${dir.name} (sitemap: ${dir.sitemapIndex})`);
      directoryHostname = getHostname(dir.sitemapIndex);
      const harvest = await harvestSitemapProfileUrls(dir.sitemapIndex, dir.profileUrlPattern);
      if (!harvest.ok) {
        console.log(`  FAIL: ${harvest.error}`);
        continue;
      }
      console.log(`  OK: ${harvest.urls.length} profile URLs harvested from sitemap`);
      // Construct profile candidates with placeholder names (we'll get real names from outbound link's anchor text)
      extracted = harvest.urls.map(u => {
        const slug = u.split('/').filter(Boolean).pop() || '';
        const niceName = slug.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return {
          name: niceName,
          profileUrl: u,
          url: null,
          hostname: null,
          sources: [dir.name],
          kind: 'profile',
        };
      });
    } else {
      // ── HTML mode ────────────────────────────────────────────
      console.log(`[crawl] ${dir.name} (${dir.url})`);
      directoryHostname = getHostname(dir.url);
      const result = await firecrawlScrape(dir.url, { waitFor: dir.waitFor, actions: dir.actions || null });
      if (!result.ok) {
        console.log(`  FAIL: ${result.error || result.status}`);
        continue;
      }
      extracted = extractCandidatesFromMarkdown(result.markdown, dir.name, dir);
      const profileCount = extracted.filter(c => c.kind === 'profile').length;
      const outboundCount = extracted.filter(c => c.kind === 'outbound').length;
      console.log(`  OK: ${extracted.length} candidates (${profileCount} profiles, ${outboundCount} outbound, markdown ${result.markdown.length} chars)`);
    }

    sourcesScraped.push(dir.name);

    // ── Resolve profile candidates in parallel ─────────────────
    const profileCandidates = extracted.filter(c => c.kind === 'profile');
    if (profileCandidates.length > 0) {
      console.log(`  resolving ${profileCandidates.length} profile pages (concurrency=${CONCURRENCY})...`);
      let lastReported = 0;
      const followResults = await runWithConcurrency(
        profileCandidates,
        CONCURRENCY,
        async (cand) => followProfilePage(cand, directoryHostname),
        (done, total) => {
          if (done - lastReported >= 25 || done === total) {
            console.log(`    progress: ${done}/${total}`);
            lastReported = done;
          }
        },
      );
      let resolved = 0;
      for (let i = 0; i < profileCandidates.length; i++) {
        const cand = profileCandidates[i];
        const fr = followResults[i];
        if (!fr || !fr.ok) {
          followFailures.push({
            name: cand.name,
            profileUrl: cand.profileUrl,
            source: dir.name,
            error: (fr && fr.error) || 'unknown',
          });
          continue;
        }
        cand.url = fr.url;
        cand.hostname = fr.hostname;
        resolved++;
      }
      console.log(`  resolved ${resolved}/${profileCandidates.length} profile pages`);
    }

    // Only push candidates that ended up with a real outbound URL
    for (const cand of extracted) {
      if (cand.url && cand.hostname) allCandidates.push(cand);
    }
  }

  console.log(`\nTotal raw candidates with outbound URLs: ${allCandidates.length}`);
  console.log(`Profile-follow failures: ${followFailures.length}`);

  const unique = dedupWithinBatch(allCandidates);
  console.log(`Unique after batch dedup: ${unique.length}`);

  const newList = [];
  const duplicates = [];
  const needsReview = [];
  const noCurrentCatalogue = [];

  // ── Step A: classify each candidate (sync, no API calls) ─────────
  const toResearch = [];
  for (const candidate of unique) {
    const dedupResult = dedupAgainstExisting(candidate, index);
    if (dedupResult.status === 'duplicate') {
      duplicates.push({
        name: candidate.name,
        url: candidate.url,
        existingSlug: dedupResult.existingSlug,
        familySlugs: dedupResult.familySlugs,
        reason: dedupResult.reason,
        jaccard: dedupResult.jaccard,
        sources: candidate.sources,
      });
    } else if (dedupResult.status === 'needsReview') {
      needsReview.push({
        name: candidate.name,
        url: candidate.url,
        possibleExistingSlug: dedupResult.possibleExistingSlug,
        possibleExistingName: dedupResult.possibleExistingName,
        reason: dedupResult.reason,
        jaccard: dedupResult.jaccard,
        sources: candidate.sources,
      });
    } else {
      toResearch.push(candidate);
    }
  }
  console.log(`After dedup: ${duplicates.length} duplicates, ${needsReview.length} needsReview, ${toResearch.length} to research`);

  // ── Step B: research sentinels in parallel ──────────────────────
  if (toResearch.length > 0) {
    console.log(`Researching sentinels for ${toResearch.length} new candidates (concurrency=${CONCURRENCY})...`);
    let lastReported = 0;
    const researchResults = await runWithConcurrency(
      toResearch,
      CONCURRENCY,
      async (cand) => researchSentinel(cand),
      (done, total) => {
        if (done - lastReported >= 10 || done === total) {
          console.log(`  progress: ${done}/${total}`);
          lastReported = done;
        }
      },
    );

    for (let i = 0; i < toResearch.length; i++) {
      const candidate = toResearch[i];
      const research = researchResults[i];
      if (!research || research.error === undefined && !research.platform) {
        // Worker error case
        continue;
      }
      const baseEntry = {
        slug: slugify(candidate.name),
        displayName: candidate.name,
        catalogueUrl: candidate.url,
        platform: research.platform,
        sentinelRegex: research.sentinelRegex,
        sentinelConfidence: research.sentinelConfidence,
        sentinelStrategy: research.sentinelStrategy,
        lotUrlsSeen: research.lotUrlsSeen,
        sources: candidate.sources,
      };
      if (research.samplePattern) baseEntry.samplePattern = research.samplePattern;
      if (research.sampleUrls) baseEntry.sampleUrls = research.sampleUrls;
      if (research.error) baseEntry.error = research.error;
      if (research.note) baseEntry.note = research.note;

      newList.push(baseEntry);
    }
  }

  // ── Asymmetry analysis ───────────────────────────────────────
  // The user's directive: when sentinel/scraping outputs diverge across
  // houses, surface the divergence so we can see WHY some houses behave
  // differently. This block summarises the spread of strategies and
  // confidence levels across the new houses, plus brand-family detection
  // findings, so review can spot anomalies at a glance.
  const sentinelStrategyCounts = {};
  const sentinelConfidenceCounts = {};
  const platformCounts = {};
  for (const entry of newList) {
    sentinelStrategyCounts[entry.sentinelStrategy] = (sentinelStrategyCounts[entry.sentinelStrategy] || 0) + 1;
    sentinelConfidenceCounts[entry.sentinelConfidence] = (sentinelConfidenceCounts[entry.sentinelConfidence] || 0) + 1;
    platformCounts[entry.platform] = (platformCounts[entry.platform] || 0) + 1;
  }
  const familiesDetected = duplicates
    .filter(d => d.familySlugs && d.familySlugs.length > 1)
    .map(d => ({
      hostname: getHostname(d.url),
      slugs: d.familySlugs,
      triggeredBy: d.name,
    }));
  // Existing brand families found in HOUSE_ROOTS (regardless of whether a
  // candidate landed on them this run) — useful for the user to see all the
  // multi-slug-per-hostname situations in the registry.
  const allRegistryFamilies = [];
  for (const [host, slugs] of index.familiesByHostname) {
    if (slugs.length > 1) {
      allRegistryFamilies.push({ hostname: host, slugs, size: slugs.length });
    }
  }
  allRegistryFamilies.sort((a, b) => b.size - a.size);

  const lowConfidenceNew = newList.filter(e => e.sentinelConfidence === 'low');
  const fallbackUsed = newList.filter(e => e.sentinelStrategy === 'fallback_keyword');

  const output = {
    runAt: new Date().toISOString(),
    sourcesScraped,
    totalRawCandidates: allCandidates.length,
    uniqueAfterBatchDedup: unique.length,
    summary: {
      new: newList.length,
      duplicates: duplicates.length,
      needsReview: needsReview.length,
      noCurrentCatalogue: noCurrentCatalogue.length,
      followFailures: followFailures.length,
    },
    analysis: {
      sentinelStrategies: sentinelStrategyCounts,
      sentinelConfidence: sentinelConfidenceCounts,
      platforms: platformCounts,
      lowConfidenceNewCount: lowConfidenceNew.length,
      fallbackSentinelCount: fallbackUsed.length,
      brandFamiliesTriggered: familiesDetected,
      allRegistryFamilies,
      asymmetryNotes: [
        lowConfidenceNew.length > 0
          ? `${lowConfidenceNew.length} new houses use fallback (low-confidence) sentinels — their catalogue page didn't expose a clear repeating lot URL pattern. Either (a) the catalogue is off-cycle / empty, (b) the page is JS-heavy and Firecrawl saw only the shell, or (c) the URL we landed on was the homepage rather than the actual catalogue page.`
          : null,
        fallbackUsed.length > 0
          ? `${fallbackUsed.length} new houses received the keyword-fallback sentinel. These will still emit recall_diagnostic alerts but the regex is wide-net and may over-match nav links.`
          : null,
        allRegistryFamilies.length > 0
          ? `${allRegistryFamilies.length} brand families detected in the existing registry (multiple slugs per hostname). When discovery surfaces a candidate matching one of these hostnames, all family slugs are listed in the duplicate entry.`
          : null,
      ].filter(Boolean),
    },
    new: newList,
    duplicates,
    needsReview,
    noCurrentCatalogue,
    followFailures,
  };

  const outPath = 'discovery-output.json';
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log('');
  console.log('═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log(`new:                ${newList.length}`);
  console.log(`duplicates:         ${duplicates.length}`);
  console.log(`needsReview:        ${needsReview.length}`);
  console.log(`noCurrentCatalogue: ${noCurrentCatalogue.length}`);
  console.log(`followFailures:     ${followFailures.length}`);
  console.log('');
  console.log('Sentinel strategy breakdown (new houses):');
  for (const [s, n] of Object.entries(sentinelStrategyCounts)) {
    console.log(`  ${s.padEnd(22)} ${n}`);
  }
  console.log('');
  console.log(`Brand families in registry: ${allRegistryFamilies.length}`);
  for (const fam of allRegistryFamilies.slice(0, 5)) {
    console.log(`  ${fam.hostname.padEnd(40)} [${fam.slugs.join(', ')}]`);
  }
  if (allRegistryFamilies.length > 5) {
    console.log(`  ... and ${allRegistryFamilies.length - 5} more`);
  }
  console.log('');
  console.log(`Written to: ${outPath}`);
  console.log('Review the JSON, then manually paste approved entries into:');
  console.log('  - lib/houses.js     (HOUSE_ROOTS + HOUSE_DISPLAY_NAMES)');
  console.log('  - lib/analysis.js   (RECALL_SENTINELS)');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
