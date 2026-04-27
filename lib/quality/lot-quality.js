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
export const ISSUE_CODES = Object.freeze([
  'no_image',
  'no_price',
  'poa_price',
  'no_postcode',
  'no_address',
  'no_uprn',
  'no_epc',
  'no_tenure',
  'no_beds',
]);

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

  // Price — POA is treated as a partial gap (seller chose to withhold,
  // pipeline didn't fail). Half the points, distinct issue code.
  if (typeof lot.price === 'number' && lot.price > 0) {
    score += FIELD_WEIGHTS.price;
  } else if (lot.priceText && /poa|tba|guide tbc|on application/i.test(lot.priceText)) {
    score += Math.floor(FIELD_WEIGHTS.price / 2);
    issues.push('poa_price');
  } else {
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
  return {
    total_lots: total,
    image_pct:    Math.round((have(l => !!l.imageUrl) / total) * 1000) / 10,
    price_pct:    Math.round((have(l => typeof l.price === 'number' && l.price > 0) / total) * 1000) / 10,
    postcode_pct: Math.round((have(l => !!l.postcode) / total) * 1000) / 10,
    uprn_pct:     Math.round((have(l => !!l.uprn) / total) * 1000) / 10,
    epc_pct:      Math.round((have(l => !!l.epcRating) / total) * 1000) / 10,
  };
}

// Exported for tests + auditing.
export const _internals = { FIELD_WEIGHTS };
