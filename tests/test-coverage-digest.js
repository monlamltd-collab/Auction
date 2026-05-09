/**
 * Coverage digest tests
 * =====================
 * Exercises the pure aggregation + formatting helpers in
 * lib/pipeline/coverage-digest.js.
 *
 * Run: node tests/test-coverage-digest.js
 */

import {
  computeCoverage,
  computeDeltas,
  isPositive,
  POSITIVE_STATUSES,
  formatDigestForTelegram,
} from '../lib/pipeline/coverage-digest.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// ── Test 1: isPositive accepts ok/cache_hit/api_ok/ok_no_comps ──
console.log('Test 1: isPositive');
{
  assert(isPositive({ status: 'ok' }) === true, 'status=ok');
  assert(isPositive({ status: 'cache_hit' }) === true, 'status=cache_hit');
  assert(isPositive({ status: 'api_ok' }) === true, 'status=api_ok');
  assert(isPositive({ status: 'ok_no_comps' }) === true, 'status=ok_no_comps');
  assert(isPositive({ status: 'no_match' }) === false, 'status=no_match → false');
  assert(isPositive({ status: 'circuit_open' }) === false, 'status=circuit_open → false');
  assert(isPositive({}) === false, 'empty entry → false');
  assert(isPositive(null) === false, 'null → false');
  assert(isPositive(undefined) === false, 'undefined → false');
}

// ── Test 2: computeCoverage with mixed manifests ──
console.log('\nTest 2: computeCoverage');
{
  const rows = [
    {
      image_url: 'x', postcode: 'BS1 1AB', est_gross_yield: 5,
      enrichment_manifest: {
        epc: { status: 'ok' },
        flood: { status: 'ok' },
        land_registry: { status: 'ok' },
        geocode: { status: 'ok' },
        fundability: { status: 'api_ok' },
      },
    },
    {
      image_url: 'x', postcode: 'BS1 1AB', est_gross_yield: null,
      enrichment_manifest: {
        epc: { status: 'no_match' },
        flood: { status: 'ok' },
        land_registry: { status: 'circuit_open' },
        geocode: { status: 'cache_hit' },
        fundability: { status: 'no_price' },
      },
    },
    {
      image_url: null, postcode: null, est_gross_yield: null,
      enrichment_manifest: null,
    },
    {
      image_url: 'x', postcode: 'BS1 1AB', est_gross_yield: 6,
      enrichment_manifest: {
        epc: { status: 'ok' },
        flood: { status: 'no_postcode' },
        land_registry: { status: 'ok_no_comps' },
        geocode: { status: 'ok' },
        fundability: { status: 'api_ok' },
      },
    },
  ];
  const c = computeCoverage(rows);
  // image: 3/4 = 75%
  assert(c.image_pct === 75, `image_pct = 75 (got ${c.image_pct})`);
  // postcode: 3/4 = 75
  assert(c.postcode_pct === 75, 'postcode_pct = 75');
  // yield: 2/4 = 50
  assert(c.yield_pct === 50, 'yield_pct = 50');
  // epc: 2/4 = 50 (rows 1 + 4 are ok)
  assert(c.epc_pct === 50, `epc_pct = 50 (got ${c.epc_pct})`);
  // flood: 2/4 = 50 (rows 1 + 2 are ok)
  assert(c.flood_pct === 50, 'flood_pct = 50');
  // land_registry: 2/4 = 50 (row 1 ok + row 4 ok_no_comps)
  assert(c.land_registry_pct === 50, 'land_registry_pct = 50');
  // geocode: 3/4 = 75 (rows 1 + 2 cache_hit + 4)
  assert(c.geocode_pct === 75, 'geocode_pct = 75');
  // fundability: 2/4 = 50
  assert(c.fundability_pct === 50, 'fundability_pct = 50');
}

// ── Test 3: empty rows → all 0 ──
console.log('\nTest 3: empty rows');
{
  const c = computeCoverage([]);
  for (const k of Object.keys(c)) {
    assert(c[k] === 0, `${k} = 0`);
  }
}

// ── Test 4: alternative manifest field name (landRegistry) ──
console.log('\nTest 4: landRegistry alias');
{
  const c = computeCoverage([
    { image_url: null, postcode: null, est_gross_yield: null, enrichment_manifest: { landRegistry: { status: 'ok' } } },
  ]);
  assert(c.land_registry_pct === 100, 'landRegistry alias works');
}

// ── Test 5: computeDeltas ──
console.log('\nTest 5: computeDeltas');
{
  const today = { epc_pct: 50, flood_pct: 60, image_pct: 80 };
  const yesterday = { epc_pct: 45, flood_pct: 60, image_pct: 90 };
  const d = computeDeltas(today, yesterday);
  assert(d.epc_pct === 5, '+5 epc');
  assert(d.flood_pct === 0, 'flat flood');
  assert(d.image_pct === -10, '-10 image');
}

// ── Test 6: formatDigestForTelegram baseline ──
console.log('\nTest 6: formatDigestForTelegram (no deltas)');
{
  const out = formatDigestForTelegram({
    totalLots: 1234,
    since: '2026-05-02',
    coverage: { epc_pct: 75, flood_pct: 90, land_registry_pct: 80, geocode_pct: 95, fundability_pct: 60, image_pct: 85, postcode_pct: 92, yield_pct: 55 },
    deltas: {},
  });
  assert(out.includes('1234'), 'total lots in output');
  assert(out.includes('EPC: 75.0%'), 'epc rendered');
  assert(out.includes('Flood: 90.0%'), 'flood rendered');
  assert(out.includes('Yield: 55.0%'), 'yield rendered');
  assert(!out.includes('+'), 'no deltas means no plus signs');
}

// ── Test 7: formatDigestForTelegram with deltas ──
console.log('\nTest 7: formatDigestForTelegram (with deltas)');
{
  const out = formatDigestForTelegram({
    totalLots: 100,
    since: '2026-05-02',
    coverage: { epc_pct: 50, flood_pct: 60, land_registry_pct: 50, geocode_pct: 80, fundability_pct: 40, image_pct: 70, postcode_pct: 80, yield_pct: 30 },
    deltas: { epc_pct: 5, flood_pct: -3, image_pct: 0 },
  });
  assert(out.includes('EPC: 50.0% (+5)'), 'positive delta rendered');
  assert(out.includes('Flood: 60.0% (-3)'), 'negative delta rendered');
  assert(out.includes('Image: 70.0% (=)'), 'flat delta rendered with equals');
}

// ── Test 8: error path ──
console.log('\nTest 8: formatDigestForTelegram error path');
{
  const out = formatDigestForTelegram({ error: 'connection refused', totalLots: 0, coverage: {}, deltas: {} });
  assert(out.includes('ERROR'), 'error label present');
  assert(out.includes('connection refused'), 'error message included');
}

// ── Test 9: zero lots edge case ──
console.log('\nTest 9: zero lots edge case');
{
  const out = formatDigestForTelegram({ totalLots: 0, coverage: {}, deltas: {} });
  assert(out.includes('No lots seen'), 'zero-lots message');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
