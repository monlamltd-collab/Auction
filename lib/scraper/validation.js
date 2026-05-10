// ═══════════════════════════════════════════════════════════════
// lib/scraper/validation.js — Pure utilities for image URLs, HTML
// stripping and lot-status normalisation. No state, no I/O.
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

// ── HTML → text for AI extraction ──
export function stripHtml(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    // Remove common noise sections by class/id patterns
    .replace(/<div[^>]*class="[^"]*(?:testimonial|review|cookie|consent|modal|popup|newsletter|sidebar|social|share|footer|banner|advert)[^"]*"[\s\S]*?<\/div>/gi, '')
    .replace(/<section[^>]*class="[^"]*(?:testimonial|review|cookie|consent|modal|popup|newsletter)[^"]*"[\s\S]*?<\/section>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    // Remove repeated whitespace more aggressively
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/ \n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Allow up to 120k for large catalogues (Claude can handle it)
  if (text.length > 120000) text = text.substring(0, 120000);
  return text;
}

// ═══════════════════════════════════════════════════════════════
// LOT STATUS NORMALISATION
// ═══════════════════════════════════════════════════════════════
export function normaliseLotStatuses(lots) {
  for (const lot of lots) {
    // Also re-check 'available' status against bullets
    if (!lot.status || lot.status === 'available') {
      const bulletStr = (lot.bullets || []).join(' ');
      if (/\bUNSOLD\b|\bNOT.?SOLD\b|\bPASSED\b|\bNO.?SALE\b|\bAuction\s*Ended\b/i.test(bulletStr)) lot.status = 'unsold';
      else if (/\bSOLD\b/i.test(bulletStr)) lot.status = 'sold';
      else if (/\bSTC\b|\bSALE.?AGREED\b|\bUNDER.?OFFER\b/i.test(bulletStr)) lot.status = 'stc';
      else if (/\bWITHDRAWN\b|\bPOSTPONED\b/i.test(bulletStr)) lot.status = 'withdrawn';
      else lot.status = 'available';
    }
    // Normalise any non-standard values
    const s = (lot.status || '').toLowerCase().trim();
    if (/unsold|not.?sold|passed|no.?sale/i.test(s)) lot.status = 'unsold';
    else if (/sold/i.test(s) && !/stc|agreed/i.test(s)) lot.status = 'sold';
    else if (/stc|agreed|under.?offer/i.test(s)) lot.status = 'stc';
    else if (/withdrawn|postponed/i.test(s)) lot.status = 'withdrawn';
    else if (s !== 'sold' && s !== 'stc' && s !== 'withdrawn' && s !== 'unsold') lot.status = 'available';

    // Lease length from bullets (fallback when lot page enrichment misses it)
    if (lot.tenure === 'Leasehold' && !lot.leaseLength) {
      const bulletStr = (lot.bullets || []).join(' ').toLowerCase();
      const lm = bulletStr.match(/\b(\d{2,4})\s*(?:year|yr)s?\s*(?:remaining|unexpired|left|lease)\b/) ||
                 bulletStr.match(/lease\s*(?:length|term|remaining)?\s*:?\s*(\d{2,4})\s*(?:year|yr)s?\b/) ||
                 bulletStr.match(/\b(\d{2,4})\s*(?:year|yr)\s*lease\b/) ||
                 bulletStr.match(/(?:term|length)\s*(?:of)?\s*(\d{2,4})\s*(?:year|yr)s?\b/);
      if (lm) {
        const years = parseInt(lm[1], 10);
        if (years >= 1 && years <= 999) lot.leaseLength = years;
      }
    }
  }
  return lots;
}
