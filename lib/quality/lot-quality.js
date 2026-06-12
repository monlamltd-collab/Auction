// lib/quality/lot-quality.js — Per-lot quality score + issue codes
//
// Pure helpers. No DB, no I/O, no module state — every input flows through
// the function arguments. Makes it cheap to compute at persist time and
// cheap to test.
//
// COVERAGE_FIX_PLAN.md rollout #4. The score is a single integer 0-100;
// the issues array lists short codes for the gaps that pulled the score
// down ('no_image', 'poa_price', 'no_postcode', 'no_uprn', 'no_epc').
// Frontend uses both: score for sort/filter, issues for the "why is this
// lot incomplete?" tooltip.
//
// Weighting rationale — derived from coverage-baseline.json + product
// importance, not arbitrary:
//
//   image (25)    — visual is the #1 signal a buyer needs. No image kills
//                   any lot listing visually.
//   price (25)    — a lot without a price is unactionable. POA is a softer
//                   gap (we know the seller meant to set one) and only
//                   docks half the points.
//   postcode (15) — drives geographic search, comps, flood lookups. Heavily
//                   penalised because too much downstream relies on it.
//   address (10)  — minimum-viable for any lot. Always required; the lots
//                   that hit this case are extractor edge-failures.
//   uprn (10)     — the COVERAGE_FIX_PLAN.md focus. Worth tracking but most
//                   houses are 0% by structure right now, so it's a small
//                   slice.
//   epc (8)       — drives £/sqft and energy-cost signals. Substantive but
//                   not blocking.
//   tenure (4)    — needed for fundability + scoring; usually present.
//   beds (3)      — needed for £/bed comps. Not blocking.
//
// Total = 100. The cap is enforced in case the weights are tweaked later.
//
// Issues vocabulary — keep additions small and meaningful. A flag should
// represent something the user/operator can act on, not every absent field.

const FIELD_WEIGHTS = {
  image:    25,
  price:    25,
  postcode: 15,
  address:  10,
  uprn:     10,
  epc:       8,
  tenure:    4,
  beds:      3,
};

// All known issue codes. Exported so callers can validate against this set
// rather than passing arbitrary strings.
//
// Price-related codes break out by intent:
//   no_price        — genuine gap (no signal at all). Docks the score.
//   poa_price       — "price on application", intentional withhold. Half-credit.
//   tba_price       — "TBA / TBC", placeholder. Half-credit, distinct from POA.
//   sold_price      — auction over with sold_price. Status, not failure.
//   withdrawn_price — pulled from sale. Status, not failure.
// Status-class codes (sold/withdrawn) don't dock the score — the price field
// is missing for a legitimate reason. Coverage queries / regression alerts
// should also denominator them out.
export const ISSUE_CODES = Object.freeze([
  'no_image',
  'no_price',
  'poa_price',
  'tba_price',
  'nil_reserve',
  'starting_bid',
  'sold_price',
  'withdrawn_price',
  'no_postcode',
  'no_address',
  'no_uprn',
  'no_epc',
  'no_tenure',
  'no_beds',
]);

// Price statuses that aren't real coverage gaps — denominator-out from
// price_pct in computeBatchCoverage so the regression alerts don't fire on
// houses with legitimately high POA fractions.
// Price statuses that are NOT coverage gaps — a missing numeric price here is
// correct, not a failure. nil_reserve (sells to highest bid — an investor
// POSITIVE) and starting_bid (only an opening bid published) join the original
// poa/tba/sold/withdrawn so the scanner stops flagging them as "No Guide
// Price" (the pugh false-alarm class, 2026-06-12).
const PRICE_STATUS_NOT_A_GAP = new Set(['poa', 'tba', 'sold', 'withdrawn', 'nil_reserve', 'starting_bid']);

// ── derivePriceStatus — structured pricing intent from loose lot signals ──
// THE single source of truth for price_status. Lives here (pure module) so
// the upsert (persist-lots), the batch coverage denominator, and the per-lot
// quality score all derive identically; persist-lots re-exports it for
// back-compat. Mirrors the backfill in
// migrations/2026-06-12-nil-reserve-price-status.sql — keep the two in sync.
//
// Vocabulary (CHECK-constrained in the DB):
//   sold         — auction concluded (status sold/unsold); the guide is gone.
//                  Status-only keying: prod's lean rebuild has no sold_price
//                  column, so a soldPrice gate made this branch unreachable
//                  and re-upserts contradicted the migration (review 2026-06-12 #2).
//   withdrawn    — pulled from the sale.
//   nil_reserve  — no reserve; sells to the highest bid. Investor-POSITIVE.
//   poa          — "price on application" — intentional withhold, not a gap.
//   tba          — "to be advised / TBC" — same.
//   starting_bid — only an opening bid published.
//   guide        — numeric guide price present.
//   unknown      — genuine gap; no recognisable signal.
//
// Priority: sold → withdrawn → nil_reserve → poa → tba → starting_bid → guide.

// Shared nil-reserve detector (the ONE copy on the Node side; public/app.js
// necessarily carries a literal twin — keep them aligned). [\s-]* admits
// "No-Reserve"; no trailing \b so "no reserves" also matches.
export const NIL_RESERVE_RE = /\b(?:nil|no|without|zero)[\s-]*reserve|unreserved\b/i;

export function derivePriceStatus(lot) {
  if (!lot || typeof lot !== 'object') return 'unknown';

  const status = (lot.status || '').toLowerCase();
  const priceText = lot.priceText || '';
  const hasPrice = typeof lot.price === 'number' && lot.price > 0;

  if (status === 'sold' || status === 'unsold') return 'sold';
  if (status === 'withdrawn') return 'withdrawn';

  if (!hasPrice && priceText && NIL_RESERVE_RE.test(priceText)) return 'nil_reserve';
  if (priceText && /poa|on application/i.test(priceText) && !hasPrice) return 'poa';
  if (priceText && /tba|tbc|to be advised|to be confirmed/i.test(priceText) && !hasPrice) return 'tba';
  if (priceText && /starting\s*bid|opening\s*bid|minimum\s*opening/i.test(priceText)) return 'starting_bid';

  if (hasPrice) return 'guide';
  return 'unknown';
}

// Resilient read of a lot's price status: the stamped value (normaliseScrapedLot
// and dbRowToLot both set it now) or, for any lot built outside those funnels,
// derived on the spot. Keeps computeBatchCoverage/computeLotQuality correct
// regardless of where the lot came from.
function effectivePriceStatus(lot) {
  return (lot?.priceStatus || '').toLowerCase() || derivePriceStatus(lot);
}

/**
 * Compute a quality score (0-100) and issue list for a single lot.
 *
 * @param {object} lot - lot object as produced by the pipeline (camelCase fields)
 * @returns {{ score: number, issues: string[] }}
 */
export function computeLotQuality(lot) {
  if (!lot || typeof lot !== 'object') {
    return { score: 0, issues: ['no_address'] };
  }

  let score = 0;
  const issues = [];

  // Image
  if (lot.imageUrl && typeof lot.imageUrl === 'string' && lot.imageUrl.length > 0) {
    score += FIELD_WEIGHTS.image;
  } else {
    issues.push('no_image');
  }

  // Price — branched on the structured priceStatus when available, deriving
  // it on the spot (same single classifier) for lots that haven't been
  // through the upsert yet. Status-class outcomes (sold / withdrawn) are
  // awarded full marks because the price field is missing for a legitimate
  // reason — they're not coverage failures.
  const priceStatus = effectivePriceStatus(lot);
  if (typeof lot.price === 'number' && lot.price > 0) {
    score += FIELD_WEIGHTS.price;
  } else if (priceStatus === 'sold') {
    // Auction over — the original guide is gone but the lot still has its
    // sold_price elsewhere. Full credit.
    score += FIELD_WEIGHTS.price;
    issues.push('sold_price');
  } else if (priceStatus === 'withdrawn') {
    // Pulled from sale — no price expected. Full credit, status flag.
    score += FIELD_WEIGHTS.price;
    issues.push('withdrawn_price');
  } else if (priceStatus === 'nil_reserve') {
    // Sells to the highest bid with no reserve — a complete, correct, and
    // investor-positive state. Full credit; tagged (not as a failure).
    score += FIELD_WEIGHTS.price;
    issues.push('nil_reserve');
  } else if (priceStatus === 'starting_bid') {
    // Only an opening bid published — a real published figure, just not a
    // guide. Full credit; tagged.
    score += FIELD_WEIGHTS.price;
    issues.push('starting_bid');
  } else if (priceStatus === 'poa') {
    score += Math.floor(FIELD_WEIGHTS.price / 2);
    issues.push('poa_price');
  } else if (priceStatus === 'tba') {
    score += Math.floor(FIELD_WEIGHTS.price / 2);
    issues.push('tba_price');
  } else {
    // priceStatus is always non-empty here (effectivePriceStatus derives from
    // priceText/status when unset), so the old priceText fallback branches
    // are covered by the branches above.
    issues.push('no_price');
  }

  // Postcode
  if (lot.postcode && typeof lot.postcode === 'string' && lot.postcode.length >= 3) {
    score += FIELD_WEIGHTS.postcode;
  } else {
    issues.push('no_postcode');
  }

  // Address
  if (lot.address && typeof lot.address === 'string' && lot.address.length >= 5) {
    score += FIELD_WEIGHTS.address;
  } else {
    issues.push('no_address');
  }

  // UPRN — gate on string non-empty rather than truthy because '0' would
  // pass typeof === 'string' && length but isn't a valid UPRN.
  if (lot.uprn && typeof lot.uprn === 'string' && /^\d{6,}$/.test(lot.uprn)) {
    score += FIELD_WEIGHTS.uprn;
  } else {
    issues.push('no_uprn');
  }

  // EPC
  if (lot.epcRating && typeof lot.epcRating === 'string' && /^[A-G]$/i.test(lot.epcRating)) {
    score += FIELD_WEIGHTS.epc;
  } else {
    issues.push('no_epc');
  }

  // Tenure
  if (lot.tenure && typeof lot.tenure === 'string' && lot.tenure.length > 0) {
    score += FIELD_WEIGHTS.tenure;
  } else {
    issues.push('no_tenure');
  }

  // Beds — 0 is valid (studio); only undefined/null is missing.
  if (typeof lot.beds === 'number' && lot.beds >= 0) {
    score += FIELD_WEIGHTS.beds;
  } else {
    issues.push('no_beds');
  }

  // Clamp defensively — if FIELD_WEIGHTS ever sums above 100 the partial
  // POA bonus could push score over.
  if (score > 100) score = 100;
  if (score < 0) score = 0;

  return { score, issues };
}

/**
 * Compute aggregate per-field coverage for a batch of lots.
 * Used by the persist stage to update house_skills.field_coverage_history
 * and detect regressions vs the previous scrape.
 *
 * Returns null when the batch is empty — callers should skip persistence
 * for empty batches rather than write a misleading 0% record.
 */
export function computeBatchCoverage(lots) {
  if (!Array.isArray(lots) || lots.length === 0) return null;
  const total = lots.length;
  const have = (predicate) => lots.filter(predicate).length;

  // Price coverage uses a different denominator: lots whose priceStatus is
  // a "not a gap" value (poa / tba / nil_reserve / starting_bid / sold /
  // withdrawn) are removed from BOTH numerator and denominator. Without this,
  // a house with a 10% POA fraction would falsely show a 10pp drop in
  // price_pct vs a house with no POA listings — and the regression-alert
  // system would page for a bug that doesn't exist. effectivePriceStatus
  // (not raw l.priceStatus) because the persist-stage and parity-gate call
  // sites pass raw pipeline lots that never carried priceStatus.
  const priceEligible = lots.filter(l => !PRICE_STATUS_NOT_A_GAP.has(effectivePriceStatus(l)));
  const pricePct = priceEligible.length === 0
    ? 100  // every lot was a known unknown — nothing to fail
    : Math.round((priceEligible.filter(l => typeof l.price === 'number' && l.price > 0).length / priceEligible.length) * 1000) / 10;

  return {
    total_lots: total,
    image_pct:    Math.round((have(l => !!l.imageUrl) / total) * 1000) / 10,
    price_pct:    pricePct,
    postcode_pct: Math.round((have(l => !!l.postcode) / total) * 1000) / 10,
    uprn_pct:     Math.round((have(l => !!l.uprn) / total) * 1000) / 10,
    epc_pct:      Math.round((have(l => !!l.epcRating) / total) * 1000) / 10,
  };
}

// Exported for tests + auditing.
export const _internals = { FIELD_WEIGHTS, PRICE_STATUS_NOT_A_GAP };
