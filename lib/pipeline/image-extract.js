// ═══════════════════════════════════════════════════════════════
// lib/pipeline/image-extract.js — pure, dependency-free image helpers.
//
// House-agnostic gallery primitives shared by the multi-image sweep. No DB or
// network imports so the logic stays unit-testable in isolation (tests run
// without node_modules) and reusable across the fleet.
//
// NOTE: lib/scraper/lot-detail.js and lib/scraper/image-backfill.js still carry
// their own near-identical <img> regex + junk filter. Adopt these helpers there
// in a follow-up so there's a single source of truth for image extraction —
// flagged, not silently refactored here (surgical change).
// ═══════════════════════════════════════════════════════════════

const MAX_IMAGES_PER_LOT = 8;

// Chrome/non-photo image tokens. Kept identical to the sweep's historical set
// so behaviour is unchanged when callers switch to this module.
export const JUNK_IMG = /(logo|icon|sprite|favicon|placeholder|avatar|spinner|loading|google|facebook|twitter|x-icon|linkedin|youtube|instagram|pinterest|whatsapp|telegram|gravatar|emoji|button|arrow|chevron|caret|hamburger|burger|close|cross|tick|cookie|consent|advertisement|sponsor|track(?:er|ing)?|pixel|beacon|stripe|paypal|trustpilot|trusted|gdpr|disclaimer|google-analytics|gtag|recaptcha)/i;

const IMG_RE = /<img[^>]+(?:src|data-src|data-lazy-src|data-original)="([^"]+)"/gi;

export function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/**
 * Pull real property image URLs out of detail-page HTML.
 * Drops data:/short/dup/junk-chrome srcs; absolutises relative URLs.
 * @param {string} html
 * @param {string} baseUrl - for resolving relative srcs
 * @param {{ max?: number }} [opts]
 * @returns {string[]}
 */
export function extractImagesFromHtml(html, baseUrl, { max = MAX_IMAGES_PER_LOT } = {}) {
  const out = [];
  const seen = new Set();
  let m;
  IMG_RE.lastIndex = 0; // module-level regex is stateful — reset before each scan
  while ((m = IMG_RE.exec(html)) !== null) {
    const raw = m[1];
    if (!raw || raw.length <= 20 || raw.startsWith('data:')) continue;
    let url = decodeHtmlEntities(raw);
    if (!/^https?:\/\//i.test(url)) {
      try { url = new URL(url, baseUrl).href; } catch { continue; }
    }
    if (JUNK_IMG.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Gallery analogue of the persist-lots hero-bleed guard. An image URL that
 * recurs across >= threshold DISTINCT lots OF THE SAME HOUSE is site chrome
 * (banner/placeholder/shared CDN frame), not a per-property photo — strip it
 * from every gallery so a shared boilerplate frame never leads a carousel or
 * becomes a card thumbnail. House-agnostic: one pass cleans the whole fleet
 * (e.g. Symonds & Sampson's shared webdadi PNG) with no per-house code.
 *
 * Mutates each result's `images` in place.
 * @param {Array<{ house?: string, lotKey: any, images: string[] }>} results
 * @param {number} [threshold=3]
 * @returns {{ results, bleedByHouse: Map<string, Set<string>> }}
 */
export function stripBleedImages(results, threshold = 3) {
  const perHouse = new Map(); // house -> Map(url -> Set(distinct lotKey))
  for (const r of results || []) {
    if (!r || !Array.isArray(r.images) || r.images.length === 0) continue;
    const house = r.house || '';
    if (!perHouse.has(house)) perHouse.set(house, new Map());
    const urlMap = perHouse.get(house);
    for (const url of new Set(r.images)) {
      if (!urlMap.has(url)) urlMap.set(url, new Set());
      urlMap.get(url).add(r.lotKey);
    }
  }

  const bleedByHouse = new Map();
  for (const [house, urlMap] of perHouse) {
    const bleed = new Set(
      [...urlMap.entries()].filter(([, lots]) => lots.size >= threshold).map(([url]) => url),
    );
    if (bleed.size) bleedByHouse.set(house, bleed);
  }

  if (bleedByHouse.size) {
    for (const r of results) {
      if (!r || !Array.isArray(r.images)) continue;
      const bleed = bleedByHouse.get(r.house || '');
      if (bleed) r.images = r.images.filter(u => !bleed.has(u));
    }
  }
  return { results, bleedByHouse };
}
