// lib/utils.js — Shared tiny utilities

export function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Inject (or strip) the Umami analytics script block in an HTML string.
// When websiteId is set, fills in the empty data-website-id="" attribute.
// When websiteId is falsy, strips the entire Umami block (script + the two
// preceding HTML comments) so we don't load a CDN script that does nothing.
const _UMAMI_BLOCK = /\s*<!-- Umami Cloud Analytics[\s\S]*?<\/script>/;
export function applyUmamiInjection(html, websiteId) {
  if (websiteId) {
    return html.replace('data-website-id=""', `data-website-id="${websiteId}"`);
  }
  return html.replace(_UMAMI_BLOCK, '');
}

// URL normalisation — single source of truth for comparing / deduplicating URLs
export const normaliseUrl = u => (u || '').trim().replace(/\/+$/, '').replace(/^http:\/\//i, 'https://').replace(/^(https:\/\/)www\./i, '$1').toLowerCase();

// ── Bullet → auction date ────────────────────────────────────────────
// Lots from different platforms describe their auction date in different
// bullet formats. This is the single source of truth for parsing them so
// both write-time (persist-lots.js) and read-time (routes/search.js) agree.
//
// Recognised formats (case-insensitive):
//   - "Auction Ends: 22/04/2026"           → 2026-04-22  (EIG timed-auction)
//   - "20 May 2026 LIVE ONLINE AUCTION"    → 2026-05-20  (EIG white-label, full date)
//   - "20 May LIVE ONLINE AUCTION"         → next 20 May ≥ today  (EIG white-label, no year)
//   - "Auction: Wednesday 14th May 2026"   → 2026-05-14  (header-style)
//
// Returns ISO YYYY-MM-DD or null. `today` is injected for testability;
// defaults to today's UTC date.
const _MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

export function parseAuctionDateFromBullet(bullet, today) {
  if (!bullet || typeof bullet !== 'string') return null;
  const t = bullet.replace(/\u00a0/g, ' ').trim();

  // 1. EIG timed-auction format: "Auction Ends: DD/MM/YYYY"
  const m1 = t.match(/Auction\s*Ends?:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;

  // 2. EIG white-label live-auction with full date — e.g. "20 May 2026 LIVE ONLINE AUCTION"
  //    or "Wednesday 14th May 2026 Auction"
  const m2 = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(20\d{2})\b/);
  if (m2) {
    const mo = _MONTHS[m2[2].slice(0, 3).toLowerCase()];
    const day = parseInt(m2[1], 10);
    const yr = parseInt(m2[3], 10);
    if (mo && day >= 1 && day <= 31) return `${yr}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  // 3. EIG white-label live-auction WITHOUT year — e.g. "20 MAY LIVE ONLINE AUCTION".
  //    Resolve to the current-year occurrence if still upcoming. If the date
  //    is already past this year, return null — the bullet is a historical
  //    reference (e.g. a past auction's lot kept in the catalogue listing for
  //    `?showsold=on&showstc=on` views). Catalogue-level auction_date will
  //    fill in the correct date if known.
  //
  //    Why not roll forward to next year? Maggs & Allen 2026-05-12: the
  //    "roll-forward to next year" behaviour was firing on cache-enrichment
  //    passes that re-processed bullets from the April 2026 catalogue after
  //    23 April had passed — persisting 18 lots with auction_date='2027-04-23'.
  //    Rolling forward by ~12 months is almost never correct for these
  //    catalogue bullets; they refer to a specific past or upcoming live
  //    auction, not "next year's equivalent".
  const m3 = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\b(?!\s+20\d{2})/);
  if (m3 && /\bAUCTION\b/i.test(t)) {
    const mo = _MONTHS[m3[2].slice(0, 3).toLowerCase()];
    const day = parseInt(m3[1], 10);
    if (mo && day >= 1 && day <= 31) {
      const todayIso = today || new Date().toISOString().slice(0, 10);
      const yr = parseInt(todayIso.slice(0, 4), 10);
      const candidate = `${yr}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      return candidate >= todayIso ? candidate : null;
    }
  }

  return null;
}

// Run parseAuctionDateFromBullet across an array of bullets. Returns the
// FIRST match (bullets are usually ordered with the most relevant first).
export function findAuctionDateInBullets(bullets, today) {
  if (!Array.isArray(bullets)) return null;
  for (const b of bullets) {
    const d = parseAuctionDateFromBullet(b, today);
    if (d) return d;
  }
  return null;
}
