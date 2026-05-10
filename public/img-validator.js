// ═══════════════════════════════════════════════════════════════
// public/img-validator.js — Source of truth for image URL validation.
//
// Loaded by both the Node server (ESM `import` from
// lib/scraper/validation.js) AND the browser (script tag in index.html
// before app.js). Keep it framework-free: no Node built-ins, no DOM.
//
// History: server (lib/scraper/validation.js) and frontend (public/app.js)
// each had their own copy of isValidImageUrl. Their CDN allowlists drifted
// — server accepted cdn.shopify.com, akamaized.net, twimg.com, fbcdn.net,
// images.unsplash.com, ik.imagekit.io, res.cloudinary.com; frontend didn't.
// Result: server-validated URLs were re-rejected on the client → blank
// cards on the live site. This module unifies both. UNION of both
// allowlists, no tightening, no loosening.
//
// The frontend keeps its own JUNK pre-filter (logos, floorplans, EPC
// charts, .svg, placeholders) wrapped around the call site in app.js —
// that concern is client-rendering-only, not validation.
// ═══════════════════════════════════════════════════════════════

// ── Image URL validation ──
export const IMG_EXTENSIONS = /\.(jpe?g|png|webp)(\?.*)?$/i;
export const IMG_CDN_DOMAINS = /cloudinary\.com|imgix\.net|cdn\.sanity\.io|images\.unsplash\.com|ik\.imagekit\.io|res\.cloudinary\.com|s3\.amazonaws\.com|amazonaws\.com\/.*\.(jpe?g|png|webp)|cdn\.shopify\.com|akamaized\.net|cloudfront\.net|twimg\.com|fbcdn\.net|googleusercontent\.com|wp-content\/uploads|supabase\.co\/storage|i\.imgur\.com|eigpropertyauctions\.co\.uk|auction|property|lot|catalogue|catalog/i;

export function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https:\/\//i.test(url)) return false;
  if (IMG_EXTENSIONS.test(url)) return true;
  if (IMG_CDN_DOMAINS.test(url)) return true;
  return false;
}

// ── Next.js image-proxy unwrap ──
//
// Some source sites emit Next.js image-proxy URLs whose wrapper host wasn't
// substituted at render time, leaving the placeholder `cdn.example.com`
// wrapping the real URL in the `?url=` query parameter:
//
//   https://cdn.example.com/_next/image?url=https://real.cdn.com/foo.jpg&w=3840&q=75
//
// The real image lives in the `url=` parameter. Returning it lets the existing
// IMG_CDN_DOMAINS / IMG_EXTENSIONS checks accept it normally. We unwrap when:
//   (a) host is the literal placeholder `cdn.example.com`, OR
//   (b) path matches `/_next/image` and the `url` param is present.
//
// Defensive: any parse error (malformed input, non-string, missing `url`
// param) returns the input unchanged. Never throws.
export function unwrapProxyImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    const parsed = new URL(url);
    const isPlaceholderHost = parsed.hostname === 'cdn.example.com';
    const isNextImagePath = parsed.pathname === '/_next/image';
    if (!isPlaceholderHost && !isNextImagePath) return url;
    const inner = parsed.searchParams.get('url');
    if (!inner) return url;
    return inner;
  } catch {
    return url;
  }
}

// ── Browser interop ──
// Expose on window for the frontend (public/app.js) which loads this file
// via a plain <script src="..."> tag before app.js. ESM consumers (Node)
// ignore this branch.
if (typeof window !== 'undefined') {
  window.imgValidator = { IMG_EXTENSIONS, IMG_CDN_DOMAINS, isValidImageUrl, unwrapProxyImageUrl };
}
