/**
 * Tests for the product-integrity parity gate (lib/pipeline/parity-gate.js).
 * Exercises the real composition (validateBatch + computeBatchCoverage +
 * detectFieldRegressions + shouldDemote) against fixture lot batches — a
 * house migrates Firecrawl→Crawlee ONLY when the product is preserved.
 *
 * Run: node tests/test-parity-gate.js
 */

import { evaluateParity } from '../lib/pipeline/parity-gate.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// A complete, high-quality lot (image + price + address + tenure + beds + url).
function goodLot(i, over = {}) {
  return {
    lot: i,
    address: `${i} Test Street, Townsville, AB1 2CD`,
    price: 100000 + i * 1000,
    imageUrl: `https://cdn.example.com/photos/${i}.jpg`,
    url: `https://house.example.com/lot/${i}`,
    tenure: 'Freehold',
    beds: 3,
    ...over,
  };
}
const batch = (n, mk = goodLot) => Array.from({ length: n }, (_, i) => mk(i + 1));

console.log('Test 1: full parity → promote');
{
  const v = evaluateParity({
    incumbent: { lots: batch(10), recall: 1.0 },
    challenger: { lots: batch(10), recall: 1.0 },
    house: 'astleys',
  });
  assert(v.promote === true, 'equal recall + equal quality + no regression → promote');
  assert(v.reason === 'product-parity-passed', 'reason states parity passed');
}

console.log('\nTest 2: recall shortfall → keep incumbent');
{
  const v = evaluateParity({
    incumbent: { lots: batch(10), recall: 1.0 },
    challenger: { lots: batch(10), recall: 0.9 },
    house: 'astleys',
  });
  assert(v.promote === false, 'challenger 0.9 recall vs 1.0 → no promote');
  assert(/recall:/.test(v.reason), 'reason cites recall');
}

console.log('\nTest 3: fewer lots → keep incumbent');
{
  const v = evaluateParity({
    incumbent: { lots: batch(10), recall: 1.0 },
    challenger: { lots: batch(9), recall: 1.0 },
    house: 'astleys',
  });
  assert(v.promote === false, 'challenger found fewer lots → no promote (shouldDemote guard)');
}

console.log('\nTest 4: product-quality drop (no images/price) → keep incumbent');
{
  const poorLot = (i) => goodLot(i, { imageUrl: '', price: null, priceStatus: 'unknown' });
  const v = evaluateParity({
    incumbent: { lots: batch(10), recall: 1.0 },
    challenger: { lots: batch(10, poorLot), recall: 1.0 },
    house: 'astleys',
  });
  assert(v.promote === false, 'equal recall but degraded per-lot data → no promote');
  assert(v.qualityOk === false || v.noRegression === false, 'quality drop or field regression caught');
  assert(v.chBatchQuality < v.incBatchQuality, 'challenger batchQuality is lower');
}

console.log('\nTest 5: image-coverage regression alone → keep incumbent');
{
  // Challenger keeps price/address but loses every image → image_pct regresses.
  const noImg = (i) => goodLot(i, { imageUrl: '' });
  const v = evaluateParity({
    incumbent: { lots: batch(10), recall: 1.0 },
    challenger: { lots: batch(10, noImg), recall: 1.0 },
    house: 'astleys',
  });
  assert(v.promote === false, 'image coverage drop → no promote');
  assert(v.regressions.some(r => r.label === 'image_url'), 'field regression flags image_url');
}

console.log('\nTest 6: too few lots to judge → keep incumbent');
{
  const v = evaluateParity({
    incumbent: { lots: batch(3), recall: 1.0 },
    challenger: { lots: batch(3), recall: 1.0 },
    house: 'astleys',
    minLots: 5,
  });
  assert(v.promote === false, 'incumbent below minLots → no promote');
  assert(/too-few-lots/.test(v.recallVerdict.reason), 'recall verdict cites too-few-lots');
}

console.log('\nTest 7: null recall (no sentinel) → keep incumbent');
{
  const v = evaluateParity({
    incumbent: { lots: batch(10), recall: null },
    challenger: { lots: batch(10), recall: null },
    house: 'astleys',
  });
  assert(v.promote === false, 'no recall signal → never promote');
}

console.log('\nTest 8: verdict object is fully auditable');
{
  const v = evaluateParity({
    incumbent: { lots: batch(10), recall: 1.0 },
    challenger: { lots: batch(10), recall: 1.0 },
    house: 'astleys',
  });
  for (const k of ['promote', 'reason', 'recallVerdict', 'qualityOk', 'noRegression', 'regressions', 'incBatchQuality', 'chBatchQuality', 'incRecall', 'chRecall', 'incLots', 'chLots']) {
    assert(k in v, `verdict has '${k}'`);
  }
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Parity gate tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
