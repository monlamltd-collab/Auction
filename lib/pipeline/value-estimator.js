// ═══════════════════════════════════════════════════════════════
// VALUE ESTIMATOR — rule-based, AI-free
// ═══════════════════════════════════════════════════════════════
// Pure function. Composes already-enriched lot fields into a single
// estimated value with low/high band and confidence label. Reads only
// fields present after a normal enrichment wave pass — no I/O, no AI.
//
// Inputs (camelCase, matching dbRowToFrontendLot):
//   streetAvg, streetSalesCount  — type-matched postcode median (from PPD)
//   hpiAvgPrice                  — area average (from HPI, optional)
//   hpiAreaName                  — area label (for breakdown text)
//   propType                     — house | flat | bungalow | commercial | land | garage | other
//   epcFloorAreaSqft, sqft       — floor area (EPC preferred)
//   opps[], risks[]              — condition + opportunity signals
//   floodZone                    — '1' | '2' | '3' | '3a' | '3b' (highest is most-risky)
//   titleSplit                   — boolean
//   epcWorksCostMid              — sum of EPC recommendation indicative costs (£)
//   epcDate                      — ISO date string of the matched EPC certificate
//
// Output:
//   { estimate, low, high, confidence, breakdown, generatedAt }
//   or null if no usable anchor (no comps + no HPI fallback)

const ANCHOR_STREET_PSQFT = 'street_psqft';
const ANCHOR_STREET_MEDIAN = 'street_median';
const ANCHOR_AREA_AVG = 'area_avg';

// ── Condition adjustments — additive % of anchor.
// Order: most-impactful first; checked against opps[] / risks[] / structured fields.
// Keep in lockstep with tests/test-value-estimator.js — the table IS the spec.
const CONDITION_RULES = [
  // ── Negatives ──
  { match: ({ opps, condition }) => condition === 'poor' || hasAny(opps, ['Poor condition', 'Derelict']),
    pct: -25, label: 'Poor / derelict condition' },
  { match: ({ risks }) => has(risks, 'Sitting tenant'),
    pct: -20, label: 'Sitting tenant' },
  { match: ({ risks }) => has(risks, 'Knotweed'),
    pct: -15, label: 'Knotweed' },
  { match: ({ opps, condition }) => condition === 'needs work' || has(opps, 'Needs modernisation'),
    pct: -10, label: 'Needs modernisation' },
  { match: ({ risks }) => hasAny(risks, ['Non-std construction', 'Non-standard construction']),
    pct: -10, label: 'Non-std construction' },
  { match: ({ risks }) => has(risks, 'Contamination'),
    pct: -8, label: 'Asbestos / contamination' },
  { match: ({ risks }) => has(risks, 'Flying freehold'),
    pct: -8, label: 'Flying freehold' },
  { match: ({ risks, floodZone }) => has(risks, 'Flood risk') || isHighFloodZone(floodZone),
    pct: -5, label: 'Flood risk' },
  // ── Positives ──
  { match: ({ opps, propType }) => has(opps, 'Vacant') && ['house', 'flat', 'bungalow'].includes(propType),
    pct: 3, label: 'Vacant possession' },
  { match: ({ titleSplit }) => titleSplit === true,
    pct: 10, label: 'Title split potential' },
];

// Caps prevent compounding signals from producing absurd values.
const ADJ_NEG_FLOOR = -45;
const ADJ_POS_CEIL  = 20;

// EPC works (deferred capex) is real money but most buyers defer it +
// some EPC recommendations are over-generous. Multiply by 0.7 to dampen.
// Tunable; revisit after backtest against sold_price.
const EPC_WORKS_REALISATION = 0.7;

// HPI-typed multipliers when falling back to area-level average.
// HPI rows expose detached_price/semi_price/terraced_price/flat_price —
// when present we use those directly. This map only kicks in if those
// breakdown fields are missing.
const TYPE_AREA_MULTIPLIER = { detached: 1.30, house: 1.00, semi: 0.95, terraced: 0.85, bungalow: 0.95, flat: 0.65 };

/**
 * Compose an estimated value for a single lot.
 *
 * @param {object} lot - Enriched lot (camelCase, post dbRowToFrontendLot)
 * @param {object} [opts]
 * @param {object} [opts.hpiRow] - Optional HPI row override (test injection / backfill)
 * @param {Date}   [opts.now]   - Test override for generatedAt
 * @returns {object|null} Estimate object, or null if no usable anchor.
 */
export function estimateValue(lot, opts = {}) {
  if (!lot || typeof lot !== 'object') return null;

  const breakdown = {
    anchor: null,
    anchor_source: null,
    condition_pct: 0,
    condition_signals: [],
    epc_works_deduction: 0,
    epc_works_count: null,
    epc_works_realisation: EPC_WORKS_REALISATION,
    comp_count: 0,
    comp_window_months: 36,
    hpi_age_adjusted: false,
    formula_text: '',
    caps_hit: [],
  };

  // ── 1. Anchor selection ────────────────────────────────────────
  const anchor = pickAnchor(lot, opts.hpiRow);
  if (!anchor) return null;       // no comps + no HPI fallback → cannot estimate
  breakdown.anchor = anchor.value;
  breakdown.anchor_source = anchor.source;
  breakdown.comp_count = anchor.compCount || 0;
  breakdown.hpi_age_adjusted = anchor.source === ANCHOR_AREA_AVG;

  // ── 2. Condition adjustments ───────────────────────────────────
  let pct = 0;
  for (const rule of CONDITION_RULES) {
    if (rule.match(lot)) {
      pct += rule.pct;
      breakdown.condition_signals.push(rule.label);
    }
  }
  // Cap negatives + positives independently so a derelict + sitting-tenant +
  // knotweed combo can't drive the value to zero.
  let cappedPct = pct;
  if (pct < ADJ_NEG_FLOOR) { cappedPct = ADJ_NEG_FLOOR; breakdown.caps_hit.push('negative_floor'); }
  if (pct > ADJ_POS_CEIL)  { cappedPct = ADJ_POS_CEIL;  breakdown.caps_hit.push('positive_ceiling'); }
  breakdown.condition_pct = cappedPct;

  const postCondition = anchor.value * (1 + cappedPct / 100);

  // ── 3. EPC works (deferred capex) ──────────────────────────────
  const worksMid = numericOrNull(lot.epcWorksCostMid);
  if (worksMid != null && worksMid > 0) {
    breakdown.epc_works_count = numericOrNull(lot.epcWorksCount); // set by EPC enrichment when populated
    breakdown.epc_works_deduction = Math.round(worksMid * EPC_WORKS_REALISATION);
  }
  let estimate = postCondition - breakdown.epc_works_deduction;

  // Floor estimate at 1 (avoid negative or zero from extreme adjustments)
  estimate = Math.max(1, Math.round(estimate / 100) * 100);

  // ── 4. Confidence + bounds ─────────────────────────────────────
  const confidence = scoreConfidence(lot, anchor);
  const bandPct = confidenceBandPct(confidence);
  const low  = Math.max(1, Math.round((estimate * (1 - bandPct / 100)) / 100) * 100);
  const high = Math.round((estimate * (1 + bandPct / 100)) / 100) * 100;

  // ── 5. Formula text (UI-facing one-liner) ──────────────────────
  breakdown.formula_text = buildFormulaText(anchor, lot, breakdown);

  return {
    estimate,
    low,
    high,
    confidence,
    breakdown,
    generatedAt: (opts.now || new Date()).toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
// Anchor selection
// ═══════════════════════════════════════════════════════════════
function pickAnchor(lot, hpiRow) {
  const sqft = numericOrNull(lot.epcFloorAreaSqft) || numericOrNull(lot.sqft);
  const streetAvg = numericOrNull(lot.streetAvg);
  const streetCount = numericOrNull(lot.streetSalesCount) || 0;

  // Anchor 1: type-matched postcode median is the strongest comp-based signal.
  // Use it whenever we have ≥2 comps. If we also have a floor area, surface
  // it via the implied-psqft check (drives confidence, not the anchor value).
  if (streetAvg != null && streetCount >= 2) {
    const source = sqft && streetCount >= 5 ? ANCHOR_STREET_PSQFT : ANCHOR_STREET_MEDIAN;
    return { value: streetAvg, source, compCount: streetCount, sqft };
  }

  // Anchor 2: area-level HPI average for the lot's property type.
  const hpi = hpiRow || lotHpi(lot);
  if (hpi && hpi.average_price) {
    const typed = typedAreaPrice(hpi, lot.propType);
    if (typed) {
      return { value: typed, source: ANCHOR_AREA_AVG, compCount: 0, areaName: hpi.area_name };
    }
    // No type-specific number — fall back to the all-types area avg with a soft multiplier.
    const mult = TYPE_AREA_MULTIPLIER[lot.propType] ?? 1.0;
    return { value: Math.round(hpi.average_price * mult), source: ANCHOR_AREA_AVG, compCount: 0, areaName: hpi.area_name };
  }

  // Last resort: streetAvg with only 1 comp — better than nothing, but flag low-confidence.
  if (streetAvg != null && streetCount >= 1) {
    return { value: streetAvg, source: ANCHOR_STREET_MEDIAN, compCount: streetCount, sqft };
  }

  return null;
}

function lotHpi(lot) {
  // Fields are populated in-memory by lib/enrichment.js queryHPI(); not persisted
  // as DB columns yet. Backfill flow will pass `hpiRow` explicitly via opts.
  if (lot.hpiAvgPrice == null) return null;
  return {
    average_price: lot.hpiAvgPrice,
    area_name: lot.hpiAreaName,
    detached_price: lot.hpiDetachedPrice,
    semi_price: lot.hpiSemiPrice,
    terraced_price: lot.hpiTerracedPrice,
    flat_price: lot.hpiFlatPrice,
  };
}

function typedAreaPrice(hpi, propType) {
  switch (propType) {
    case 'flat':     return numericOrNull(hpi.flat_price);
    case 'bungalow': return numericOrNull(hpi.semi_price); // bungalows mostly trade like semis
    case 'house':    return numericOrNull(hpi.terraced_price); // safest mid-band assumption
    default:         return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Confidence + bounds
// ═══════════════════════════════════════════════════════════════
function scoreConfidence(lot, anchor) {
  let pts = 0;
  // Comp coverage
  if (anchor.compCount >= 5) pts += 2;
  else if (anchor.compCount >= 2) pts += 1;
  else if (anchor.compCount === 1) pts -= 1;
  // Anchor source quality
  if (anchor.source === ANCHOR_STREET_PSQFT) pts += 1;
  else if (anchor.source === ANCHOR_AREA_AVG) pts -= 1;
  // Floor area provenance — EPC is more reliable than regex from bullets
  if (numericOrNull(lot.epcFloorAreaSqft)) pts += 1;
  else if (numericOrNull(lot.sqft)) pts += 0;
  else pts -= 1;

  if (pts >= 3) return 'high';
  if (pts >= 1) return 'medium';
  return 'low';
}

function confidenceBandPct(confidence) {
  return confidence === 'high' ? 5 : confidence === 'medium' ? 10 : 20;
}

// ═══════════════════════════════════════════════════════════════
// Formula text — drives "Show working" UI
// ═══════════════════════════════════════════════════════════════
function buildFormulaText(anchor, lot, breakdown) {
  const parts = [];
  const postcode = (lot.postcode || '').split(' ')[0] || 'the area';

  if (anchor.source === ANCHOR_STREET_PSQFT || anchor.source === ANCHOR_STREET_MEDIAN) {
    parts.push(`Based on ${anchor.compCount} comparable ${anchor.compCount === 1 ? 'sale' : 'sales'} in ${postcode} (median £${formatGBP(anchor.value)})`);
  } else {
    parts.push(`Based on ${anchor.areaName || 'area'} average for ${lot.propType || 'this property type'} (£${formatGBP(anchor.value)})`);
  }
  if (breakdown.condition_signals.length) {
    parts.push(`${breakdown.condition_pct >= 0 ? '+' : ''}${breakdown.condition_pct}% (${breakdown.condition_signals.join(' · ')})`);
  }
  if (breakdown.epc_works_deduction > 0) {
    parts.push(`−£${formatGBP(breakdown.epc_works_deduction)} deferred EPC works`);
  }
  return parts.join(' · ');
}

function formatGBP(n) {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  const v = Number(n);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
  if (v >= 1_000)     return Math.round(v / 1000) + 'k';
  return String(Math.round(v));
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
function numericOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function has(arr, needle) {
  return Array.isArray(arr) && arr.some(x => typeof x === 'string' && x === needle);
}
function hasAny(arr, needles) {
  return Array.isArray(arr) && arr.some(x => typeof x === 'string' && needles.includes(x));
}
function isHighFloodZone(z) {
  if (z == null) return false;
  const s = String(z).toLowerCase();
  return s === '2' || s === '3' || s === '3a' || s === '3b';
}

// Test-only export
export const _internal = {
  CONDITION_RULES, ADJ_NEG_FLOOR, ADJ_POS_CEIL, EPC_WORKS_REALISATION,
  ANCHOR_STREET_PSQFT, ANCHOR_STREET_MEDIAN, ANCHOR_AREA_AVG,
  scoreConfidence, confidenceBandPct, buildFormulaText, pickAnchor,
};
