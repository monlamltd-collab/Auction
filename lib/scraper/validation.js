// ═══════════════════════════════════════════════════════════════
// lib/scraper/validation.js — Pure utilities for image URLs, HTML
// stripping and lot-status normalisation. No state, no I/O.
//
// Image URL validation lives in public/img-validator.js so the same
// regexes and helpers are shared by the Node server and the browser
// frontend (public/app.js loads it via a <script> tag). Re-exported
// here to keep `lib/scraper.js` consumers unchanged.
// ═══════════════════════════════════════════════════════════════

export {
  IMG_EXTENSIONS,
  IMG_CDN_DOMAINS,
  IMG_PATH_HINTS,
  isValidImageUrl,
  unwrapProxyImageUrl,
} from '../../public/img-validator.js';

// ── Placeholder-URL guard (2026-06-12 incident) ──
// 174 fabricated lots reached the live table with example.com lot URLs and
// realistic-looking addresses — invented by the extraction model, and invisible
// to the address-grounding guard when the page happened to contain the street
// tokens. A reserved/placeholder domain can NEVER be a real lot URL, so this is
// a deterministic fabrication tell: drop the lot (or null the image) on sight.
// Covers the RFC 2606 reserved names (example.com/org/net, .test, .invalid,
// .localhost, .example) plus bare localhost.
const PLACEHOLDER_URL_RE = /^(?:https?:)?\/\/(?:[\w-]+\.)*(?:example\.(?:com|org|net|co\.uk)|localhost)(?:[:/?#]|$)|^(?:https?:)?\/\/(?:[\w-]+\.)+(?:test|invalid|localhost|example)(?:[:/?#]|$)/i;
export function isPlaceholderUrl(url) {
  return typeof url === 'string' && PLACEHOLDER_URL_RE.test(url.trim());
}

// ── Anti-fabrication batch guard (2026-06-21 SDL incident) ──
// Blatant placeholder/template-address signals only (fictional town names + the
// impossible "AT1 1Ax" demo postcode). HIGH PRECISION by design: a real UK address
// must never match — hiding a real lot is worse than missing a subtle fake (which the
// purge migration + grounded-extraction guard + proper per-house scraping handle).
// Keys on ADDRESS content only — never on URL shape, because real catalogues use
// /property/{id}/ URLs.
export const PLACEHOLDER_ADDRESS_RE = /\b(?:anytown|sometown|exampletown|sampletown|placeholdertown|yourtown)\b|\bdemo(?:ville|town)\b|\bAT1\s*1A[A-Z]\b/i;

/**
 * Reject a batch of extracted catalogue lots that is clearly fabricated/hallucinated
 * (blatant placeholder/template addresses). Keys on ADDRESS content only — never on
 * URL shape, because real catalogues use /property/{id}/ URLs. Conservative on two
 * axes: the regex matches only unambiguous placeholders (a real UK address never
 * matches), AND the batch needs >= 5 lots at a high placeholder ratio so a genuine
 * small catalogue is never killed.
 * @param {Array<{address?: string}>} lots
 * @param {{minLots?: number, ratio?: number}} [opts]
 * @returns {{flagged: boolean, reason: string|null, placeholderRatio: number}}
 */
export function detectFabricatedBatch(lots, { minLots = 5, ratio = 0.6 } = {}) {
  if (!Array.isArray(lots) || lots.length < minLots) return { flagged: false, reason: null, placeholderRatio: 0 };
  let hits = 0;
  for (const l of lots) {
    if (l && typeof l.address === 'string' && PLACEHOLDER_ADDRESS_RE.test(l.address)) hits++;
  }
  const placeholderRatio = hits / lots.length;
  if (placeholderRatio >= ratio) {
    return { flagged: true, reason: `fabricated batch: ${Math.round(placeholderRatio * 100)}% placeholder/template addresses (${hits}/${lots.length})`, placeholderRatio };
  }
  return { flagged: false, reason: null, placeholderRatio };
}

// ── Event-page URL guard (2026-07-03 robinsonhall incident) ──
// The extractor read Robinson & Hall's "future auctions" cards as lots: the
// auction VENUE (Delta Marriott Hotel) persisted once per event URL —
// /auction/05-08-2026/, /auction/14-10-2026/, … — 8 duplicate junk rows on
// the live board. A URL whose path ends at /auction(s)/<date>/ is an auction
// EVENT page, never a lot detail page; real lot URLs carry a lot slug or id
// beyond the date. Deterministic tell — drop the lot at persist.
const EVENT_PAGE_URL_RE = /\/auctions?\/\d{1,2}-\d{1,2}-\d{2,4}\/?(?:[?#]|$)/i;
export function isEventPageUrl(url) {
  return typeof url === 'string' && EVENT_PAGE_URL_RE.test(url.trim());
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
      else if (/\bSOLD\b|\bEXCHANGED\b/i.test(bulletStr)) lot.status = 'sold';
      else if (/\bSTC\b|\bSALE.?AGREED\b|\bUNDER.?OFFER\b/i.test(bulletStr)) lot.status = 'stc';
      else if (/\bWITHDRAWN\b|\bPOSTPONED\b/i.test(bulletStr)) lot.status = 'withdrawn';
      else lot.status = 'available';
    }
    // Normalise any non-standard values
    const s = (lot.status || '').toLowerCase().trim();
    if (/unsold|not.?sold|passed|no.?sale/i.test(s)) lot.status = 'unsold';
    else if (/sold|exchanged/i.test(s) && !/stc|agreed/i.test(s)) lot.status = 'sold';
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
