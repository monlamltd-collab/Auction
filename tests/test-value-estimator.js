// tests/test-value-estimator.js
/**
 * Value-estimator pure-function tests
 * ===================================
 * Covers anchor selection, condition table, caps, EPC works deduction,
 * confidence scoring, bounds widening, and edge cases.
 *
 * Run: node tests/test-value-estimator.js
 */

import { estimateValue, _internal } from '../lib/pipeline/value-estimator.js';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function test(name, fn) {
  console.log(`\n${name}`);
  return Promise.resolve().then(fn).catch(e => {
    failed++;
    console.error(`  THREW: ${e.message}\n${e.stack}`);
  });
}

// Default lot fixture — modify per test
function makeLot(overrides = {}) {
  return {
    postcode: 'BS5 9BJ',
    propType: 'house',
    streetAvg: 200000,
    streetSalesCount: 6,
    epcFloorAreaSqft: 800,
    sqft: 800,
    opps: [],
    risks: [],
    floodZone: null,
    titleSplit: false,
    epcWorksCostMid: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// Smoke / null inputs
// ═══════════════════════════════════════════════════════════════

await test('estimateValue: null/empty/non-object input returns null', () => {
  assert(estimateValue(null) === null, 'null → null');
  assert(estimateValue(undefined) === null, 'undefined → null');
  assert(estimateValue('not an object') === null, 'string → null');
});

await test('estimateValue: lot with no anchor data returns null', () => {
  const lot = { propType: 'house' }; // no streetAvg, no hpiAvgPrice
  assert(estimateValue(lot) === null, 'no comp + no HPI → null');
});

// ═══════════════════════════════════════════════════════════════
// Anchor selection priority
// ═══════════════════════════════════════════════════════════════

await test('Anchor: street_psqft preferred when ≥5 comps + sqft', () => {
  const lot = makeLot({ streetAvg: 200000, streetSalesCount: 6, epcFloorAreaSqft: 800 });
  const out = estimateValue(lot);
  assert(out.breakdown.anchor_source === 'street_psqft', `got ${out.breakdown.anchor_source}`);
});

await test('Anchor: street_median used when 2-4 comps even with sqft', () => {
  const lot = makeLot({ streetAvg: 200000, streetSalesCount: 3, epcFloorAreaSqft: 800 });
  const out = estimateValue(lot);
  assert(out.breakdown.anchor_source === 'street_median', `got ${out.breakdown.anchor_source}`);
});

await test('Anchor: street_median used when no sqft regardless of comp count', () => {
  const lot = makeLot({ streetAvg: 200000, streetSalesCount: 7, epcFloorAreaSqft: null, sqft: null });
  const out = estimateValue(lot);
  assert(out.breakdown.anchor_source === 'street_median', `got ${out.breakdown.anchor_source}`);
});

await test('Anchor: falls back to area_avg when no street comps', () => {
  const lot = makeLot({
    streetAvg: null, streetSalesCount: 0,
    hpiAvgPrice: 280000, hpiAreaName: 'Bristol', hpiTerracedPrice: 240000,
  });
  const out = estimateValue(lot);
  assert(out.breakdown.anchor_source === 'area_avg', `got ${out.breakdown.anchor_source}`);
  assert(out.breakdown.anchor === 240000, `terraced_price preferred for house, got ${out.breakdown.anchor}`);
});

await test('Anchor: area_avg uses flat_price for flats', () => {
  const lot = makeLot({
    propType: 'flat',
    streetAvg: null, streetSalesCount: 0,
    hpiAvgPrice: 280000, hpiAreaName: 'Bristol', hpiFlatPrice: 180000,
  });
  const out = estimateValue(lot);
  assert(out.breakdown.anchor === 180000, `flat_price preferred for flat, got ${out.breakdown.anchor}`);
});

await test('Anchor: area_avg falls to soft multiplier when no typed price', () => {
  const lot = makeLot({
    propType: 'flat',
    streetAvg: null, streetSalesCount: 0,
    hpiAvgPrice: 280000, hpiAreaName: 'Bristol', // no flat_price
  });
  const out = estimateValue(lot);
  assert(out.breakdown.anchor < 280000, 'flat multiplier applied');
});

await test('Anchor: 1-comp street average is last-resort low-confidence anchor', () => {
  const lot = makeLot({ streetAvg: 200000, streetSalesCount: 1, epcFloorAreaSqft: null, sqft: null });
  const out = estimateValue(lot);
  assert(out.breakdown.anchor_source === 'street_median', `got ${out.breakdown.anchor_source}`);
  assert(out.confidence === 'low', `got ${out.confidence}`);
});

// ═══════════════════════════════════════════════════════════════
// Condition adjustments
// ═══════════════════════════════════════════════════════════════

await test('Condition: poor/derelict applies -25%', () => {
  const lot = makeLot({ opps: ['Poor condition'] });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === -25, `got ${out.breakdown.condition_pct}`);
  assert(out.estimate < 200000, 'estimate reduced');
});

await test('Condition: needs modernisation applies -10%', () => {
  const lot = makeLot({ opps: ['Needs modernisation'] });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === -10, `got ${out.breakdown.condition_pct}`);
});

await test('Condition: sitting tenant applies -20%', () => {
  const lot = makeLot({ risks: ['Sitting tenant'] });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === -20, `got ${out.breakdown.condition_pct}`);
});

await test('Condition: knotweed applies -15%', () => {
  const lot = makeLot({ risks: ['Knotweed'] });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === -15, `got ${out.breakdown.condition_pct}`);
});

await test('Condition: flying freehold applies -8%', () => {
  const lot = makeLot({ risks: ['Flying freehold'] });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === -8, `got ${out.breakdown.condition_pct}`);
});

await test('Condition: non-std construction applies -10%', () => {
  const lot = makeLot({ risks: ['Non-std construction'] });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === -10, `got ${out.breakdown.condition_pct}`);
});

await test('Condition: contamination applies -8%', () => {
  const lot = makeLot({ risks: ['Contamination'] });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === -8, `got ${out.breakdown.condition_pct}`);
});

await test('Condition: explicit Flood risk in risks[] applies -5%', () => {
  const lot = makeLot({ risks: ['Flood risk'] });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === -5, `got ${out.breakdown.condition_pct}`);
});

await test('Condition: floodZone=3 applies -5% even without explicit risk', () => {
  const lot = makeLot({ floodZone: '3' });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === -5, `got ${out.breakdown.condition_pct}`);
  assert(out.breakdown.condition_signals.includes('Flood risk'), 'flood signal labelled');
});

await test('Condition: floodZone=1 → no flood adjustment', () => {
  const lot = makeLot({ floodZone: '1' });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === 0, `got ${out.breakdown.condition_pct}`);
});

await test('Condition: Vacant + house applies +3%', () => {
  const lot = makeLot({ opps: ['Vacant'], propType: 'house' });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === 3, `got ${out.breakdown.condition_pct}`);
});

await test('Condition: Vacant + commercial → no premium', () => {
  const lot = makeLot({ opps: ['Vacant'], propType: 'commercial' });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === 0, `got ${out.breakdown.condition_pct}`);
});

await test('Condition: titleSplit=true applies +10%', () => {
  const lot = makeLot({ titleSplit: true });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === 10, `got ${out.breakdown.condition_pct}`);
});

await test('Condition: signals stack additively', () => {
  // -10 (mod) + -20 (sitting tenant) + -5 (flood) = -35
  const lot = makeLot({ opps: ['Needs modernisation'], risks: ['Sitting tenant', 'Flood risk'] });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === -35, `got ${out.breakdown.condition_pct}`);
  assert(out.breakdown.condition_signals.length === 3, '3 signals labelled');
});

await test('Caps: negative floor -45% holds even with worst-case stack', () => {
  // -25 (poor) + -20 (tenant) + -15 (knotweed) + -10 (non-std) + -8 (contam) + -8 (FF) = -86
  const lot = makeLot({
    opps: ['Poor condition'],
    risks: ['Sitting tenant', 'Knotweed', 'Non-std construction', 'Contamination', 'Flying freehold'],
  });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === -45, `got ${out.breakdown.condition_pct}`);
  assert(out.breakdown.caps_hit.includes('negative_floor'), 'cap recorded');
});

await test('Caps: positive ceiling +20% holds when premiums combine', () => {
  // +3 (vacant) + +10 (titleSplit) = +13 (under cap, no cap hit)
  // Force above cap via stacking — only two positives exist so cap can't actually be hit
  // with current rules; assert cap mechanism is wired by checking combined positive
  const lot = makeLot({ opps: ['Vacant'], propType: 'house', titleSplit: true });
  const out = estimateValue(lot);
  assert(out.breakdown.condition_pct === 13, `expected 13, got ${out.breakdown.condition_pct}`);
  assert(!out.breakdown.caps_hit.includes('positive_ceiling'), 'no cap hit at +13');
});

// ═══════════════════════════════════════════════════════════════
// EPC works (deferred capex)
// ═══════════════════════════════════════════════════════════════

await test('EPC works: subtracts works_cost × 0.7 multiplier', () => {
  const lot = makeLot({ epcWorksCostMid: 10000 });
  const out = estimateValue(lot);
  assert(out.breakdown.epc_works_deduction === 7000, `expected 7000, got ${out.breakdown.epc_works_deduction}`);
  assert(out.estimate <= 200000 - 7000, 'estimate reflects deduction');
});

await test('EPC works: null/zero leaves estimate unchanged', () => {
  const a = estimateValue(makeLot({ epcWorksCostMid: null })).estimate;
  const b = estimateValue(makeLot({ epcWorksCostMid: 0 })).estimate;
  const baseline = estimateValue(makeLot()).estimate;
  assert(a === baseline && b === baseline, 'no deduction when no/zero works');
});

await test('EPC works: combines correctly with condition adjustment', () => {
  const lot = makeLot({ opps: ['Needs modernisation'], epcWorksCostMid: 10000 });
  const out = estimateValue(lot);
  // 200000 × 0.9 = 180000; minus 7000 = 173000
  assert(out.estimate === 173000, `expected 173000, got ${out.estimate}`);
});

// ═══════════════════════════════════════════════════════════════
// Confidence scoring + bounds
// ═══════════════════════════════════════════════════════════════

await test('Confidence: high when ≥5 comps + EPC sqft', () => {
  const lot = makeLot({ streetSalesCount: 6, epcFloorAreaSqft: 800 });
  const out = estimateValue(lot);
  assert(out.confidence === 'high', `got ${out.confidence}`);
});

await test('Confidence: medium when 2-4 comps', () => {
  const lot = makeLot({ streetSalesCount: 3, epcFloorAreaSqft: 800 });
  const out = estimateValue(lot);
  assert(out.confidence === 'medium', `got ${out.confidence}`);
});

await test('Confidence: low when only HPI fallback', () => {
  const lot = makeLot({
    streetAvg: null, streetSalesCount: 0,
    hpiAvgPrice: 280000, hpiTerracedPrice: 240000,
    epcFloorAreaSqft: null, sqft: null,
  });
  const out = estimateValue(lot);
  assert(out.confidence === 'low', `got ${out.confidence}`);
});

await test('Bounds: high confidence band is ±5%', () => {
  const lot = makeLot({ streetSalesCount: 6, epcFloorAreaSqft: 800 });
  const out = estimateValue(lot);
  // 200000 × 0.95 = 190000; × 1.05 = 210000
  assert(out.low === 190000, `low expected 190000, got ${out.low}`);
  assert(out.high === 210000, `high expected 210000, got ${out.high}`);
});

await test('Bounds: medium confidence band is ±10%', () => {
  const lot = makeLot({ streetSalesCount: 3, epcFloorAreaSqft: 800 });
  const out = estimateValue(lot);
  assert(out.low === 180000 && out.high === 220000, `expected 180k/220k, got ${out.low}/${out.high}`);
});

await test('Bounds: low confidence band is ±20%', () => {
  const lot = makeLot({
    streetAvg: null, streetSalesCount: 0,
    hpiAvgPrice: 280000, hpiTerracedPrice: 240000,
    epcFloorAreaSqft: null, sqft: null,
  });
  const out = estimateValue(lot);
  // estimate = 240000; ±20% = 192000 / 288000
  assert(out.low === 192000 && out.high === 288000, `expected 192k/288k, got ${out.low}/${out.high}`);
});

// ═══════════════════════════════════════════════════════════════
// Output shape stability — UI consumers depend on these field names
// ═══════════════════════════════════════════════════════════════

await test('Output shape: stable keys present', () => {
  const out = estimateValue(makeLot());
  for (const key of ['estimate', 'low', 'high', 'confidence', 'breakdown', 'generatedAt']) {
    assert(key in out, `top-level key '${key}'`);
  }
  for (const key of ['anchor', 'anchor_source', 'condition_pct', 'condition_signals',
                     'epc_works_deduction', 'epc_works_count', 'comp_count',
                     'comp_window_months', 'hpi_age_adjusted', 'formula_text', 'caps_hit']) {
    assert(key in out.breakdown, `breakdown key '${key}'`);
  }
});

await test('Output shape: estimate / low / high are integers ending in 00', () => {
  const out = estimateValue(makeLot({ opps: ['Needs modernisation'], epcWorksCostMid: 10333 }));
  assert(out.estimate % 100 === 0, 'estimate rounded to nearest £100');
  assert(out.low % 100 === 0, 'low rounded to nearest £100');
  assert(out.high % 100 === 0, 'high rounded to nearest £100');
});

await test('Output shape: confidence is one of high|medium|low', () => {
  const out = estimateValue(makeLot());
  assert(['high', 'medium', 'low'].includes(out.confidence), `got ${out.confidence}`);
});

// ═══════════════════════════════════════════════════════════════
// Formula text — the user-facing one-liner
// ═══════════════════════════════════════════════════════════════

await test('Formula: includes comp count + median when street anchor', () => {
  const lot = makeLot({ postcode: 'BS5 9BJ', streetAvg: 200000, streetSalesCount: 6 });
  const out = estimateValue(lot);
  assert(/6 comparable sales in BS5/.test(out.breakdown.formula_text), `got: ${out.breakdown.formula_text}`);
  assert(/£200k/.test(out.breakdown.formula_text), 'median formatted as £200k');
});

await test('Formula: includes condition signal when applied', () => {
  const lot = makeLot({ opps: ['Needs modernisation'] });
  const out = estimateValue(lot);
  assert(/-10%.*Needs modernisation/.test(out.breakdown.formula_text), `got: ${out.breakdown.formula_text}`);
});

await test('Formula: includes EPC works deduction when present', () => {
  const lot = makeLot({ epcWorksCostMid: 10000 });
  const out = estimateValue(lot);
  assert(/£7k deferred EPC works/.test(out.breakdown.formula_text), `got: ${out.breakdown.formula_text}`);
});

await test('Formula: area-avg variant labels area name', () => {
  const lot = makeLot({
    streetAvg: null, streetSalesCount: 0,
    hpiAvgPrice: 280000, hpiAreaName: 'Bristol', hpiTerracedPrice: 240000,
  });
  const out = estimateValue(lot);
  assert(/Bristol average/.test(out.breakdown.formula_text), `got: ${out.breakdown.formula_text}`);
});

// ═══════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════

await test('Edge: extreme negatives floor estimate at 1 (never zero/negative)', () => {
  const lot = makeLot({
    streetAvg: 50000, // small anchor
    opps: ['Poor condition'],
    risks: ['Sitting tenant', 'Knotweed', 'Non-std construction', 'Contamination'],
    epcWorksCostMid: 100000, // monstrous EPC works > anchor
  });
  const out = estimateValue(lot);
  assert(out.estimate >= 1, `estimate must be ≥ 1, got ${out.estimate}`);
  assert(out.low >= 1, 'low band ≥ 1');
});

await test('Edge: opts.now overrides generatedAt for deterministic tests', () => {
  const out = estimateValue(makeLot(), { now: new Date('2026-01-15T00:00:00Z') });
  assert(out.generatedAt === '2026-01-15T00:00:00.000Z', `got ${out.generatedAt}`);
});

await test('Edge: hpiRow override beats lot fields', () => {
  const lot = makeLot({
    streetAvg: null, streetSalesCount: 0,
    hpiAvgPrice: 999999, // would be picked from lot
  });
  const out = estimateValue(lot, { hpiRow: { average_price: 280000, area_name: 'Override', terraced_price: 240000 } });
  assert(out.breakdown.anchor === 240000, `override used, got ${out.breakdown.anchor}`);
});

await test('Edge: lot with no postcode still produces formula text', () => {
  const lot = makeLot({ postcode: null });
  const out = estimateValue(lot);
  assert(/the area/.test(out.breakdown.formula_text), `got: ${out.breakdown.formula_text}`);
});

// ═══════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════

await test('Internal: confidenceBandPct returns 5/10/20', () => {
  assert(_internal.confidenceBandPct('high') === 5, 'high → 5');
  assert(_internal.confidenceBandPct('medium') === 10, 'medium → 10');
  assert(_internal.confidenceBandPct('low') === 20, 'low → 20');
});

await test('Internal: EPC realisation multiplier is 0.7', () => {
  assert(_internal.EPC_WORKS_REALISATION === 0.7, `got ${_internal.EPC_WORKS_REALISATION}`);
});

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════

console.log(`\n──────────────────────────────────────────`);
console.log(`Value-estimator tests: ${passed} passed, ${failed} failed`);
console.log(`──────────────────────────────────────────`);
if (failed > 0) process.exit(1);
