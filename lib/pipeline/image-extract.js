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

// ── Floor-plan detection ──
// A floor plan's URL almost never carries a "floor" token (EIG /lot-image/<id>,
// hollismorgan/maggsandallen /resize/<id>, eig CDN <id>_web). The signal lives
// in the surrounding markup — alt / title / href / data-* — so we match the
// whole <img>/<a> tag, not the URL. Verified against 8 houses (auctionhouse*,
// austingray, hollismorgan, maggsandallen, propertysolvers, connectuk,
// bradleyhall, purplebricksgoto/EIG-modal).
const FLOORPLAN_TOKEN = /floor[\s_-]?plan|site[\s_-]?plan/i;
const ASSET_HREF_RE = /\.(?:jpe?g|png|webp|gif|pdf)(?:[?#]|$)/i;
// JS-app payloads (auctionhouselondon, hunters) embed the plans as a URL array
// under a floor-plan key. Quotes may be backslash-escaped when the JSON is
// itself nested inside a JSON string, hence the optional \\ before each quote.
const JSON_PLAN_KEY_RE = /\\?"(?:floor[_-]?plans?(?:images)?)\\?"\s*:\s*\[/gi;
const URL_IN_JSON_RE = /https?:\/\/[^"'\\\s\],]+/g;

// Read one double-quoted attribute value from a raw tag-attribute string.
// The (?:^|\s) prefix stops `src` from matching inside `data-src`.
function readAttr(attrs, name) {
  const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*"([^"]*)"', 'i').exec(attrs);
  return m ? m[1].trim() : '';
}

// Chrome guard for a URL we have ALREADY positively identified as a floor plan
// from its markup. The broad JUNK_IMG token filter is the wrong tool here: it
// matches anywhere in the URL, so a plan named after a UK street — "15_Nunney_
// Close_t2026.jpg" — is rejected on the token `close` (meant for ✕ buttons).
// Given a positive plan signal, only two things disqualify a URL: a format a
// plan can never be, and a filename that is plainly a logo/icon asset.
const PLAN_REJECT_RE = /(?:^|[^a-z])(?:logo|icon|sprite|favicon|placeholder|avatar|banner|spinner|loader)(?:[^a-z]|$)/i;
function fileNameOf(url) {
  try { const p = new URL(url).pathname; return p.slice(p.lastIndexOf('/') + 1); } catch { return url; }
}

// An <a href> is a plausible plan asset if it points at an image/pdf, or has no
// file extension at all (an image endpoint like /lot-image/<id> or <id>_web).
// A page extension (.html/.php/.aspx) means it's a link, not a plan — skip it
// (guards against e.g. a "how to read a floor plan" article link).
function hrefIsPlausibleAsset(href) {
  if (ASSET_HREF_RE.test(href)) return true;
  let path = href;
  try { path = new URL(href, 'http://x/').pathname; } catch { /* keep raw */ }
  const ext = (path.match(/\.([a-z0-9]{1,5})$/i) || [])[1];
  if (!ext) return true;
  return /^(?:jpe?g|png|webp|gif|pdf)$/i.test(ext);
}

/**
 * Pull floor-plan asset URLs out of detail-page HTML. House-agnostic; keys off
 * floor-plan tokens in tag markup, not the URL. Five shapes are handled:
 *   1. <img ...alt/title/class=floorplan...>                     → its src   (EIG platform, hollismorgan, maggsandallen)
 *   2. <a href=…floorplan.jpg | data-fslightbox="floorplans" …>  → its href  (propertysolvers, connectuk, bradleyhall)
 *   3. <a href="…fpm.jpeg"><span>FLOORPLAN</span></a>            → its href  (auctionhammermidlands — token in the TEXT)
 *   4. <button data-target="#id"> … <div id="id"><img>           → modal img (purplebricks, Auction House UK FloorplanModal)
 *   5. "floorPlans":["https://…"] embedded in a JS payload       → the URLs   (auctionhouselondon, hunters)
 * Only modal ids named by a floor-plan-labelled trigger are resolved, so a
 * sibling EPC modal (same id prefix, alt="EPC") is never mistaken for a plan.
 * @param {string} html
 * @param {string} baseUrl - for resolving relative srcs/hrefs
 * @param {{ max?: number }} [opts]
 * @returns {string[]} deduped absolute floor-plan URLs (thumb/fullsize variants of one plan collapse by pathname)
 */
export function extractFloorPlansFromHtml(html, baseUrl, { max = 6 } = {}) {
  if (!html || typeof html !== 'string') return [];
  const out = [];
  const seenPath = new Set();   // collapse thumb + fullsize of one plan by origin+pathname
  const modalIds = [];          // fragment targets from floor-plan-labelled triggers (shape 4)

  const push = (raw) => {
    if (out.length >= max) return;
    let url = decodeHtmlEntities(String(raw || '').trim());
    if (!url || url.startsWith('#') || url.startsWith('data:') || /^(?:javascript|mailto|tel):/i.test(url)) return;
    if (!/^https?:\/\//i.test(url)) {
      try { url = new URL(url, baseUrl).href; } catch { return; }
    }
    if (VECTOR_OR_ANIM.test(url)) return;              // .svg/.gif is never a scanned plan
    if (PLAN_REJECT_RE.test(fileNameOf(url))) return;  // logo/icon asset, not a plan
    let key;
    try { const u = new URL(url); key = u.origin + u.pathname.toLowerCase(); } catch { key = url; }
    if (seenPath.has(key)) return;
    seenPath.add(key);
    out.push(url);
  };

  // Pull the asset (or modal target) out of an <a>/<button>. `attrSignal` marks
  // the strong case — the tag's own attributes name the plan. A text-only signal
  // is weaker, so it demands a real image/pdf extension: otherwise a link that
  // merely *mentions* a plan ("Lot 12 — floor plan available") would be captured.
  const collectTrigger = (attrs, attrSignal) => {
    const href = readAttr(attrs, 'href');
    const dataTarget = readAttr(attrs, 'data-target');
    if (href && !href.startsWith('#')) {
      if (attrSignal ? hrefIsPlausibleAsset(href) : ASSET_HREF_RE.test(href)) push(href);
    }
    if (href && href.startsWith('#')) modalIds.push(href.slice(1));
    if (dataTarget && dataTarget.startsWith('#')) modalIds.push(dataTarget.slice(1));
  };

  // ── Shapes 1 & 2 — floor-plan token inside an <img>/<a>/<button> tag ──
  const TAG_RE = /<(img|a|button)\b([^>]*)>/gi;
  let m;
  while ((m = TAG_RE.exec(html)) !== null) {
    if (out.length >= max) break;
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    if (!FLOORPLAN_TOKEN.test(attrs)) continue;
    if (tag === 'img') {
      push(readAttr(attrs, 'src') || readAttr(attrs, 'data-src') ||
           readAttr(attrs, 'data-lazy-src') || readAttr(attrs, 'data-original'));
    } else {
      collectTrigger(attrs, true);
    }
  }

  // ── Shape 3 — token in the anchor/button TEXT rather than its attributes ──
  const TEXT_RE = /<(a|button)\b([^>]*)>([\s\S]{0,300}?)<\/\1>/gi;
  while ((m = TEXT_RE.exec(html)) !== null) {
    if (out.length >= max) break;
    const inner = m[3].replace(/<[^>]*>/g, ' ');   // strip nested <span> wrappers
    if (!FLOORPLAN_TOKEN.test(inner)) continue;
    collectTrigger(m[2], false);
  }

  // ── Shape 4 — resolve floor-plan modal/tab panels to their first inner <img> ──
  for (const id of modalIds) {
    if (out.length >= max) break;
    const at = html.indexOf('id="' + id + '"');
    if (at < 0) continue;
    const windowHtml = html.slice(at, at + 1200);
    const im = /<img\b[^>]*?(?:src|data-src)\s*=\s*"([^"]+)"/i.exec(windowHtml);
    if (im) push(im[1]);
  }

  // ── Shape 5 — plans carried in an embedded JSON array ──
  // Slice only as far as that array's closing bracket, so a neighbouring photo
  // gallery array can never bleed in.
  JSON_PLAN_KEY_RE.lastIndex = 0;
  while ((m = JSON_PLAN_KEY_RE.exec(html)) !== null) {
    if (out.length >= max) break;
    const start = m.index + m[0].length;
    const close = html.indexOf(']', start);
    const slice = html.slice(start, close < 0 ? start + 600 : Math.min(close, start + 2000));
    for (const u of (slice.match(URL_IN_JSON_RE) || [])) {
      if (out.length >= max) break;
      if (hrefIsPlausibleAsset(u)) push(u);
    }
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
