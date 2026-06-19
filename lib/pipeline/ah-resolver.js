// lib/pipeline/ah-resolver.js
// ═══════════════════════════════════════════════════════════════
// AUCTION HOUSE UK — FUTURE-AUCTION-DATES RESOLVER
// ═══════════════════════════════════════════════════════════════
//
// Auction House UK is a 30+ branch multi-tenant platform sharing one domain
// (auctionhouse.co.uk). The generic homepage-watch strips paths to fetch
// `homepage origin + "/"` — for every regional sibling that resolves to the
// NATIONAL root, which always advertises `/national` as the catalogue. Every
// regional slug then looks "drifted to /national" — 30+ structural false
// positives per cycle.
//
// future-auction-dates is the platform's own canonical schedule: one row per
// upcoming regional auction, each linking to `/<region>/auction/lots/<id>`
// (or `/<region>/auction/<yyyy>/<mm>/<dd>` for date-only catalogues). Parse
// that page once per cycle, map region → slug from HOUSE_ROOTS, and we have
// a credit-cheap, drift-free source of truth for the entire AH family.
//
// Exports:
//   AH_PLATFORM_SLUGS  — set of every slug rooted at auctionhouse.co.uk
//   parseAhFutureDates — pure markdown → Map<slug, catalogueUrl>
//   fetchAhFutureDates — network-backed wrapper, returns null on failure
// ═══════════════════════════════════════════════════════════════

import { HOUSE_ROOTS } from '../houses.js';
import { fetchPage } from '../scraper/http.js';
import { hasCrawlee, scrapeWithCrawlee } from '../scraper/crawlee.js';
import { htmlToRecognitionMarkdown } from '../scraper/html-to-markdown.js';

const FUTURE_DATES_URL = 'https://www.auctionhouse.co.uk/auction/future-auction-dates';

// First-path-segments that are NOT regions (they're shared sections of the
// platform). Anything else found under auctionhouse.co.uk in HOUSE_ROOTS is
// treated as a regional branch and gets mapped into REGION_TO_SLUG.
const NON_REGION_PATHS = new Set(['auction', 'online']);

// Aliases where future-auction-dates uses a different region label than the
// HOUSE_ROOTS path. Mirror detectAuctionHouse() in lib/houses.js.
//   /wales  → auctionhousewales (HOUSE_ROOTS uses /southwales)
const REGION_ALIASES = {
  wales: 'auctionhousewales',
};

function buildRegionMap() {
  const regionToSlug = new Map();
  const platformSlugs = new Set();
  for (const [slug, url] of Object.entries(HOUSE_ROOTS)) {
    let parsed;
    try { parsed = new URL(url); } catch { continue; }
    if (parsed.hostname.replace(/^www\./, '') !== 'auctionhouse.co.uk') continue;
    platformSlugs.add(slug);
    const segs = parsed.pathname.split('/').filter(Boolean);
    const region = segs[0];
    if (!region || NON_REGION_PATHS.has(region)) continue;
    if (!regionToSlug.has(region)) regionToSlug.set(region, slug);
  }
  for (const [alias, slug] of Object.entries(REGION_ALIASES)) {
    if (!regionToSlug.has(alias)) regionToSlug.set(alias, slug);
  }
  return { regionToSlug, platformSlugs };
}

const { regionToSlug: REGION_TO_SLUG, platformSlugs: AH_PLATFORM_SLUGS_INTERNAL } = buildRegionMap();

export const AH_PLATFORM_SLUGS = AH_PLATFORM_SLUGS_INTERNAL;
export const AH_FUTURE_DATES_URL = FUTURE_DATES_URL;

// Path shape: /<region>/auction/lots/<numeric-id>  OR
//             /<region>/auction/<yyyy>/<mm>/<dd>
// Match both in one regex; case-insensitive so URL casing variants are picked up.
const PATH_REGEX = /\/([a-z][a-z0-9]*)\/auction\/(?:lots\/\d+|\d{4}\/\d{1,2}\/\d{1,2})/gi;

export function parseAhFutureDates(markdown) {
  const out = new Map();
  if (!markdown) return out;
  const re = new RegExp(PATH_REGEX.source, PATH_REGEX.flags);
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const region = m[1].toLowerCase();
    const slug = REGION_TO_SLUG.get(region);
    if (!slug) continue;
    if (out.has(slug)) continue; // first match wins (most recently listed auction)
    out.set(slug, `https://www.auctionhouse.co.uk${m[0]}`);
  }
  return out;
}

// Network resolver. Returns Map<slug, catalogueUrl> on success, null on
// failure. Failure cases (fetch unavailable, page returned empty markdown,
// no recognised links) are all treated as "no signal" — caller must handle
// null by skipping the AH slug audit this cycle.
//
// The future-auction-dates page is a public schedule (no Cloudflare) — plain
// Crawlee/HTTP fetch + htmlToRecognitionMarkdown is enough; no Gemini audit
// needed since parseAhFutureDates just reads the catalogue links.
//
// `opts.fetchMarkdown` lets tests inject a stub returning the markdown string.
export async function fetchAhFutureDates(opts = {}) {
  const fetchMd = opts.fetchMarkdown || (async () => {
    let html = '';
    if (hasCrawlee()) {
      try { const r = await scrapeWithCrawlee(FUTURE_DATES_URL); html = r?.html || ''; } catch { /* fall through */ }
    }
    if (!html) html = await fetchPage(FUTURE_DATES_URL);
    return htmlToRecognitionMarkdown(html, FUTURE_DATES_URL) || '';
  });
  try {
    const md = await fetchMd();
    if (!md) return null;
    const map = parseAhFutureDates(md);
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}
