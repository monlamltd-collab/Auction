// ═══════════════════════════════════════════════════════════════
// lib/pipeline/image-extract.js — pure, dependency-free image helpers.
//
// House-agnostic gallery primitives shared by the multi-image sweep and the
// retroactive de-chrome cleanup. No DB or network imports so the logic stays
// unit-testable in isolation (tests run without node_modules) and reusable
// across the fleet.
//
// Two complementary, house-agnostic defences against non-property "chrome"
// (logos, trade-body badges, map tiles, theme assets, shared placeholders)
// leaking into galleries/thumbnails:
//   1. isChromeUrl — token + format heuristic for UNAMBIGUOUS chrome
//      (.svg/.gif, propertymark/naea/rics/tpo/nava badges, loaders, EIG /oas/
//      assets, …). Zero false-positive risk: a property photo is never these.
//   2. computeBleedByHouse / stripBleedImages — cross-lot repetition: an image
//      recurring across >= N distinct lots of one house is shared chrome
//      (e.g. M&A's text slide, S&S's webdadi PNG), even when the token filter
//      can't name it. Mirrors the persist-lots hero-bleed guard.
//
// NOTE: lib/scraper/lot-detail.js and lib/scraper/image-backfill.js still carry
// their own near-identical <img> regex + junk filter. Adopt these helpers there
// in a follow-up so there's a single source of truth — flagged, not refactored
// here (surgical change).
// ═══════════════════════════════════════════════════════════════

const MAX_IMAGES_PER_LOT = 8;

// Token-based chrome filter. Historical set (kept stable for the sweep).
export const JUNK_IMG = /(logo|icon|sprite|favicon|placeholder|avatar|spinner|loading|google|facebook|twitter|x-icon|linkedin|youtube|instagram|pinterest|whatsapp|telegram|gravatar|emoji|button|arrow|chevron|caret|hamburger|burger|close|cross|tick|cookie|consent|advertisement|sponsor|track(?:er|ing)?|pixel|beacon|stripe|paypal|trustpilot|trusted|gdpr|disclaimer|google-analytics|gtag|recaptcha)/i;

// Extra high-signal chrome tokens observed leaking into galleries fleet-wide
// (trade-body badges, map loaders/tiles, video thumbs, EIG on-page-asset svgs,
// estate-agent "open for business" banners). High-signal only — anything that
// could plausibly appear in a real photo URL is left to the repetition guard.
const CHROME_EXTRA = /(propertymark|\bnaea\b|\brics\b|\btpo\b|\bnava\b|ombudsman|cyber.?essentials|regulated[-_]?by|map.?marker|\bloader\b|gstatic|vimeocdn|\/oas\/|open[-_]?for[-_]?business)/i;

// Vector / animated formats — a property photo is never an .svg or .gif.
// Tolerates query strings and pagespeed suffixes (….svg.pagespeed.ce.x).
const VECTOR_OR_ANIM = /\.(?:svg|gif)(?:[?#.]|$)/i;

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
 * True if a URL is unambiguous non-property chrome (logo/badge/loader/theme
 * asset/vector). House-agnostic, zero false-positive risk for real photos.
 * Cross-lot repetition (computeBleedByHouse) catches the rest.
 * @param {string} url
 * @returns {boolean}
 */
export function isChromeUrl(url) {
  if (!url || typeof url !== 'string') return true;
  return JUNK_IMG.test(url) || CHROME_EXTRA.test(url) || VECTOR_OR_ANIM.test(url);
}

/**
 * Pull real property image URLs out of detail-page HTML.
 * Drops data:/short/dup/chrome srcs; absolutises relative URLs.
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
    if (isChromeUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Cross-lot repetition detector. An image URL recurring across >= threshold
 * DISTINCT lots OF THE SAME HOUSE is shared chrome, not a per-property photo.
 * @param {Array<{ house?: string, lotKey: any, urls?: string[], images?: string[] }>} items
 * @param {number} [threshold=3]
 * @returns {Map<string, Set<string>>} house -> set of bleed URLs
 */
export function computeBleedByHouse(items, threshold = 3) {
  const perHouse = new Map(); // house -> Map(url -> Set(distinct lotKey))
  for (const it of items || []) {
    if (!it) continue;
    const urls = it.urls || it.images || [];
    if (!urls.length) continue;
    const house = it.house || '';
    if (!perHouse.has(house)) perHouse.set(house, new Map());
    const urlMap = perHouse.get(house);
    for (const url of new Set(urls)) {
      if (!url) continue;
      if (!urlMap.has(url)) urlMap.set(url, new Set());
      urlMap.get(url).add(it.lotKey);
    }
  }
  const bleedByHouse = new Map();
  for (const [house, urlMap] of perHouse) {
    const bleed = new Set(
      [...urlMap.entries()].filter(([, lots]) => lots.size >= threshold).map(([url]) => url),
    );
    if (bleed.size) bleedByHouse.set(house, bleed);
  }
  return bleedByHouse;
}

/**
 * Strip cross-lot bleed images from each result's gallery (used by the sweep).
 * Mutates each result's `images` in place.
 * @param {Array<{ house?: string, lotKey: any, images: string[] }>} results
 * @param {number} [threshold=3]
 * @returns {{ results, bleedByHouse: Map<string, Set<string>> }}
 */
export function stripBleedImages(results, threshold = 3) {
  const bleedByHouse = computeBleedByHouse(
    (results || []).map(r => ({ house: r && r.house, lotKey: r && r.lotKey, urls: r && r.images })),
    threshold,
  );
  if (bleedByHouse.size) {
    for (const r of results) {
      if (!r || !Array.isArray(r.images)) continue;
      const bleed = bleedByHouse.get(r.house || '');
      if (bleed) r.images = r.images.filter(u => !bleed.has(u));
    }
  }
  return { results, bleedByHouse };
}

/**
 * De-chrome a single lot's gallery + thumbnail. Drops chrome (isChromeUrl) and
 * per-house bleed URLs from the gallery; if the thumbnail is chrome/bleed/empty,
 * promotes the first surviving real photo (or null). A thumbnail that is itself
 * a real photo (not chrome/bleed) is preserved even if not in the gallery.
 * @param {string[]} images
 * @param {string|null} imageUrl
 * @param {Set<string>} [bleedUrls]
 * @returns {{ images: string[], imageUrl: string|null, changed: boolean }}
 */
export function dechromeGallery(images, imageUrl, bleedUrls = new Set()) {
  const orig = Array.isArray(images) ? images : [];
  const arr = orig.filter(Boolean);

  // Token-chrome (.svg/.gif, badges, loaders, …) is never a real photo — always
  // removable. If that empties the gallery, the lot becomes under-target and the
  // sweep refetches real photos. Bleed (cross-lot repetition) is only PROBABLY
  // chrome — it can be a genuinely shared real photo (a development sold as
  // several lots), so it is removed ONLY when a real image survives. The gallery
  // is NEVER blanked by the repetition heuristic alone — that would risk
  // destroying a real photo (the 100%-coverage mandate outranks tidiness).
  const afterToken = arr.filter(u => !isChromeUrl(u));
  const afterBleed = afterToken.filter(u => !bleedUrls.has(u));
  const removeBleed = afterBleed.length > 0;
  const removed = new Set(arr.filter(u => isChromeUrl(u) || (removeBleed && bleedUrls.has(u))));
  const finalImages = arr.filter(u => !removed.has(u));

  const prevThumb = imageUrl ?? null;
  let newThumb = prevThumb;
  // Replace the thumbnail only if it was removed (chrome, or bleed we stripped)
  // or is missing/too-short. A real photo — or a bleed image we deliberately
  // kept (guard) — stays the card image.
  if (!newThumb || newThumb.length < 10 || removed.has(newThumb) || isChromeUrl(newThumb)) {
    newThumb = finalImages.length ? finalImages[0] : null;
  }
  const changed = JSON.stringify(finalImages) !== JSON.stringify(orig) || newThumb !== prevThumb;
  return { images: finalImages, imageUrl: newThumb, changed };
}
