/**
 * Pure-function tests for qualityGate in lib/pipeline/quality-gate.js.
 *
 * Locks the load-bearing guards: promo-card stripping, price-floor strip,
 * and Guard 1b (buyer's-premium fee detection — null price, keep lot).
 *
 * Guard 1b matters because several AH UK catalogues display the buyer's
 * premium (~£1,200 inc VAT) prominently on the card while hiding the real
 * guide on the detail page. The extractor takes the prominent number and
 * persists it; nulling the price here lets detail-page enrichment recover
 * the real guide on the next pass.
 *
 * Run: node tests/test-quality-gate.js
 */

const { qualityGate } = await import('../lib/pipeline/quality-gate.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log('Test 1: Guard 1b nulls residential house/flat with sub-£5k "guide"');
{
  const lots = [
    { address: '12 Acacia Ave', price: 1200, propType: 'house', beds: 3, url: 'x' },
    { address: '7 Oak St', price: 1800, propType: 'flat', beds: 2, url: 'y' },
  ];
  const { lots: out, alerts } = qualityGate(lots, 'ahlondon', null, null);
  assert(out.length === 2, 'both lots kept (not stripped)');
  assert(out[0].price === null, 'house £1,200 nulled');
  assert(out[1].price === null, 'flat £1,800 nulled');
  assert(alerts.some(a => /buyer's-premium/.test(a)), 'single aggregated alert fired');
  assert(alerts.filter(a => /buyer's-premium/.test(a)).length === 1, 'alert is aggregated, not per-lot');
}

console.log('\nTest 2: Guard 1b ignores land, garages, commercial, "other"');
{
  const lots = [
    { address: 'Land at A', price: 2500, propType: 'land', beds: null, url: 'x' },
    { address: 'Garage 12', price: 1500, propType: 'garage', beds: null, url: 'y' },
    { address: 'Unit 3', price: 4000, propType: 'commercial', beds: null, url: 'z' },
    { address: 'Misc', price: 3000, propType: 'other', beds: null, url: 'w' },
  ];
  const { lots: out } = qualityGate(lots, 'somehouse', null, null);
  assert(out.length === 4, 'all kept');
  assert(out[0].price === 2500, 'land price untouched');
  assert(out[1].price === 1500, 'garage price untouched');
  assert(out[2].price === 4000, 'commercial price untouched');
  assert(out[3].price === 3000, 'other price untouched');
}

console.log('\nTest 3: Guard 1b ignores studios (beds === 0) — conservative');
{
  const lots = [
    { address: 'Studio 1', price: 1200, propType: 'flat', beds: 0, url: 'x' },
  ];
  const { lots: out } = qualityGate(lots, 'h', null, null);
  assert(out[0].price === 1200, 'studio price left alone (out of safe set)');
}

console.log('\nTest 4: Guard 1b ignores residential >=£5k (real cheap-end guides survive)');
{
  const lots = [
    { address: 'Cheap House', price: 5000, propType: 'house', beds: 2, url: 'x' },
    { address: 'Cheap Flat', price: 9500, propType: 'flat', beds: 1, url: 'y' },
  ];
  const { lots: out } = qualityGate(lots, 'h', null, null);
  assert(out[0].price === 5000, '£5,000 boundary kept');
  assert(out[1].price === 9500, '£9,500 kept');
}

console.log('\nTest 5: Guard 1 still strips sub-£1k garbage prices');
{
  const lots = [
    { address: 'Junk', price: 50, propType: 'house', beds: 3, url: 'x' },
  ];
  const { lots: out, alerts } = qualityGate(lots, 'h', null, null);
  assert(out.length === 0, 'sub-£1k lot stripped by Guard 1');
  assert(alerts.some(a => /implausible price/.test(a)), 'Guard 1 alert fired');
}

console.log('\nTest 6: missing price untouched');
{
  const lots = [
    { address: 'No price', price: null, propType: 'house', beds: 3, url: 'x' },
  ];
  const { lots: out } = qualityGate(lots, 'h', null, null);
  assert(out.length === 1, 'kept');
  assert(out[0].price === null, 'still null');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
