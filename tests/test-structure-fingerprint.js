/**
 * Tests for the proactive presentation-change detector
 * (lib/scraper/structure-fingerprint.js): a house's page-1 render is reduced
 * to a structural fingerprint; a step-change vs the previous run fires a
 * structure_drift alert BEFORE extraction quietly under-recalls.
 *
 * The key property: routine lot churn (new addresses, new prices, same
 * template) must NOT drift; a template rebuild or signal collapse MUST.
 *
 * Run: node tests/test-structure-fingerprint.js
 */

import { computeStructureFingerprint, compareFingerprints, _internals } from '../lib/scraper/structure-fingerprint.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const SENTINEL = /\/lot\/details\/(\d+)/g;

// Build a realistic EIG-style catalogue page from a template + lot data.
function catalogueHtml(lots, { classes = ['lot-panel', 'list-address', 'list-guideprice', 'list-image', 'btn-view'] } = {}) {
  const cards = lots.map(l => `
    <div class="${classes[0]} card-wrap">
      <img class="${classes[3]}" src="https://cdn.example-host.co.uk/img/${l.id}.jpg">
      <h3 class="${classes[1]}">${l.address}</h3>
      <div class="${classes[2]}"><b>Guide Price £${l.price.toLocaleString()}</b></div>
      <a class="${classes[4]}" href="/lot/details/${l.id}">View lot</a>
    </div>`).join('\n');
  return `<html><head><style>.x{}</style></head><body>
    <nav class="site-nav nav-main"><a class="nav-link" href="/">Home</a></nav>
    <div class="lot-grid container">${cards}</div>
    <footer class="site-footer"><span class="copyright">© Auction Co</span></footer>
  </body></html>`.repeat(2); // repeat to clear the 500-char floor comfortably
}

const lotsA = [
  { id: 101, address: '12 Harbour View, Whitby, YO21 3EX', price: 95000 },
  { id: 102, address: '4 Mill Lane, Leeds, LS1 4AB', price: 120000 },
  { id: 103, address: 'Flat 2, 88 Crown St, York, YO1 7LJ', price: 78000 },
  { id: 104, address: '23 Acre Rd, Hull, HU5 2TT', price: 64000 },
  { id: 105, address: '9 Garth End, Beverley, HU17 0PQ', price: 156000 },
];
const lotsB = [
  { id: 201, address: '7 Station Approach, Selby, YO8 4PL', price: 88000 },
  { id: 202, address: '15 Westgate, Ripon, HG4 2AT', price: 132000 },
  { id: 203, address: '3 The Croft, Malton, YO17 7DD', price: 71000 },
  { id: 204, address: '41 Priory Walk, Goole, DN14 5XZ', price: 59000 },
  { id: 205, address: '2 Orchard Close, Thirsk, YO7 1HD', price: 149000 },
];

console.log('Test 1: fingerprint shape');
{
  const fp = computeStructureFingerprint(catalogueHtml(lotsA), SENTINEL);
  assert(fp && Array.isArray(fp.classVocab) && fp.classVocab.includes('lot-panel'), 'class vocabulary captured');
  assert(fp.counts.sentinelIds === 5, `5 sentinel ids counted (got ${fp.counts.sentinelIds})`);
  assert(fp.counts.priceTokens >= 5, `price tokens counted (got ${fp.counts.priceTokens})`);
  assert(fp.counts.postcodes >= 5, `postcodes counted (got ${fp.counts.postcodes})`);
}

console.log('\nTest 2: tiny page (cookie wall) → null fingerprint');
{
  assert(computeStructureFingerprint('<html><body>Accept cookies</body></html>') === null, 'sub-500-char shell not fingerprinted');
}

console.log('\nTest 3: routine lot churn — same template, all-new lots → NO drift');
{
  const prev = computeStructureFingerprint(catalogueHtml(lotsA), SENTINEL);
  const curr = computeStructureFingerprint(catalogueHtml(lotsB), SENTINEL);
  const v = compareFingerprints(prev, curr);
  assert(v.drift === false, `no drift on content churn (similarity ${v.similarity})`);
  assert(v.similarity >= 0.9, `vocabulary essentially identical (got ${v.similarity})`);
}

console.log('\nTest 4: template rebuild — new class vocabulary → DRIFT');
{
  const prev = computeStructureFingerprint(catalogueHtml(lotsA), SENTINEL);
  const rebuilt = catalogueHtml(lotsA, { classes: ['prop-card-v2', 'addr-line-v2', 'price-tag-v2', 'thumb-v2', 'cta-v2'] })
    .replace(/site-nav nav-main/g, 'header-v2 nav-v2')
    .replace(/lot-grid container/g, 'grid-v2 wrap-v2')
    .replace(/site-footer/g, 'footer-v2')
    .replace(/card-wrap/g, 'cell-v2')
    .replace(/nav-link/g, 'link-v2')
    .replace(/copyright/g, 'legal-v2');
  const curr = computeStructureFingerprint(rebuilt, SENTINEL);
  const v = compareFingerprints(prev, curr);
  assert(v.drift === true, `rebuild detected (similarity ${v.similarity})`);
  assert(v.reasons.some(r => /vocabulary/.test(r)), 'reason names the vocabulary shift');
}

console.log('\nTest 5: price collapse on an otherwise-similar page → DRIFT with named reason');
{
  const prev = computeStructureFingerprint(catalogueHtml(lotsA), SENTINEL);
  const noPrices = catalogueHtml(lotsA).replace(/Guide Price £[\d,]+/g, 'Guide Price on application');
  const curr = computeStructureFingerprint(noPrices, SENTINEL);
  const v = compareFingerprints(prev, curr);
  assert(v.drift === true, 'price collapse detected');
  assert(v.reasons.some(r => /price tokens collapsed/.test(r)), 'reason names the price collapse');
}

console.log('\nTest 6: sentinel-id collapse (lot URL shape changed) → DRIFT');
{
  const prev = computeStructureFingerprint(catalogueHtml(lotsA), SENTINEL);
  const reshaped = catalogueHtml(lotsA).replace(/\/lot\/details\/(\d+)/g, '/listing/v2/$1');
  const curr = computeStructureFingerprint(reshaped, SENTINEL);
  const v = compareFingerprints(prev, curr);
  assert(v.drift === true, 'sentinel collapse detected');
  assert(v.reasons.some(r => /sentinel lot ids collapsed/.test(r)), 'reason says the sentinel needs updating');
}

console.log('\nTest 7: first run (no previous fingerprint) → no drift');
{
  const curr = computeStructureFingerprint(catalogueHtml(lotsA), SENTINEL);
  const v = compareFingerprints(null, curr);
  assert(v.drift === false && v.similarity === null, 'nothing to compare is not a change');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Structure-fingerprint tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
