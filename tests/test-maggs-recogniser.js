/**
 * Pure-function tests for recogniseMaggsLotsFromMarkdown — the markdown
 * recogniser used as a recall fallback when Firecrawl JSON extract drops
 * lots on /?auction={N} pages.
 *
 * Captured from a live probe of
 * https://www.maggsandallen.co.uk/search-auction/?auction=3 on 2026-05-11
 * (current 20 May auction). Includes:
 *  - a normal lot with bullets + guide price
 *  - a lot preceded by repeated `![SOLD](...)` overlay images (the case
 *    JSON extract drops)
 *  - a **LOT TBC** preview for the next auction
 *  - a non-lot section (price/fees footer) that must not match
 *
 * Run: node tests/test-maggs-recogniser.js
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { recogniseMaggsLotsFromMarkdown } = await import('../lib/pipeline/firecrawl-extract.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const SAMPLE = `
## NEXT AUCTION:  20 May 2026

STILL TAKING ENTRIES

**LOT 1**

## [30, Avonvale Road, Redfield,\\ \\ Bristol, BS5 9RL](https://www.maggsandallen.co.uk/property-details/34630929/-/bristol/avonvale-road)

## [\\*Guide Price £215,000+](https://www.maggsandallen.co.uk/property-details/34630929/-/bristol/avonvale-road)

- 20 May LIVE ONLINE AUCTION
- Victorian House
- In need of refurbishment
- 3 Bedrooms
- 2 Reception Rooms

[Full\\\\
Details](https://www.maggsandallen.co.uk/property-details/34630929/-/bristol/avonvale-road)

**LOT 6**

![SOLD](https://www.maggsandallen.co.uk/images/corner-flash-sold.svg)![SOLD](https://www.maggsandallen.co.uk/images/corner-flash-sold.svg)

## [Flats 1-4, Hazelwood, Broadway, Chilcompton,\\ \\ Radstock, BA3 4GT](https://www.maggsandallen.co.uk/property-details/34648209/-/radstock/hazelwood)

## [\\*Guide Price £325,000+](https://www.maggsandallen.co.uk/property-details/34648209/-/radstock/hazelwood)

- SOLD PRIOR - 20 May LIVE ONLINE AUCTION
- Freehold block of four flats
- 2 x 2-Bedroom Flats & 2 x 1-Bedroom Flats

[Full\\\\
Details](https://www.maggsandallen.co.uk/property-details/34648209/-/radstock/hazelwood)

**LOT TBC**

## [4, Tiverton Walk, Speedwell,\\ \\ Bristol, BS16 3LH](https://www.maggsandallen.co.uk/property-details/34657794/-/bristol/tiverton-walk)

## [\\*Guide Price £185,000+](https://www.maggsandallen.co.uk/property-details/34657794/-/bristol/tiverton-walk)

- 25 June LIVE ONLINE AUCTION
- Three bedroom semi-detached house
- In need of full refurbishment

[Full\\\\
Details](https://www.maggsandallen.co.uk/property-details/34657794/-/bristol/tiverton-walk)

### \\*GUIDE PRICE INFORMATION

Guide Prices are provided as an indication of each seller's minimum expectation.
`;

console.log('Test 1: recogniser returns a Map of 3 lots');
const lots = recogniseMaggsLotsFromMarkdown(SAMPLE);
assert(lots instanceof Map, 'returns a Map');
assert(lots.size === 3, `expected 3 lots, got ${lots.size}`);

console.log('\nTest 2: keys are the numeric property-details ids');
assert(lots.has('34630929'), 'has key 34630929 (Lot 1)');
assert(lots.has('34648209'), 'has key 34648209 (Lot 6)');
assert(lots.has('34657794'), 'has key 34657794 (Lot TBC)');

console.log('\nTest 3: Lot 1 — normal available lot, bullets + price + address');
{
  const l = lots.get('34630929');
  assert(l.lot_number === 1, `lot_number === 1, got ${l.lot_number}`);
  assert(l.address === '30, Avonvale Road, Redfield, Bristol, BS5 9RL', `address: ${l.address}`);
  assert(l.guide_price === '£215,000+', `guide_price: ${l.guide_price}`);
  assert(l.lot_status === 'available', `status: ${l.lot_status}`);
  assert(l.bedrooms === 3, `bedrooms: ${l.bedrooms}`);
  assert(l.property_type === 'house', `propType: ${l.property_type}`);
  assert(Array.isArray(l.bullets) && l.bullets.length === 5, `bullets.length: ${l.bullets?.length}`);
  assert(l.bullets[0] === '20 May LIVE ONLINE AUCTION', `first bullet: ${l.bullets[0]}`);
  assert(l.detail_url === 'https://www.maggsandallen.co.uk/property-details/34630929/-/bristol/avonvale-road', 'detail_url');
}

console.log('\nTest 4: Lot 6 — SOLD-overlay case (the JSON extractor drops this one)');
{
  const l = lots.get('34648209');
  assert(l.lot_number === 6, `lot_number === 6, got ${l.lot_number}`);
  assert(l.lot_status === 'sold', `status should be 'sold' (SOLD overlay + bullet SOLD PRIOR), got ${l.lot_status}`);
  assert(l.address.startsWith('Flats 1-4, Hazelwood'), `address: ${l.address}`);
  assert(l.guide_price === '£325,000+', `guide_price: ${l.guide_price}`);
  assert(l.bullets.some(b => /SOLD PRIOR/.test(b)), 'bullets include SOLD PRIOR');
}

console.log('\nTest 5: LOT TBC — preview entry with no lot number');
{
  const l = lots.get('34657794');
  assert(l.lot_number === null, `lot_number must be null for TBC, got ${l.lot_number}`);
  assert(l.address.startsWith('4, Tiverton Walk, Speedwell'), `address: ${l.address}`);
  assert(l.guide_price === '£185,000+', `guide_price: ${l.guide_price}`);
  assert(l.lot_status === 'available', `status: ${l.lot_status}`);
}

console.log('\nTest 6: footer text ("### *GUIDE PRICE INFORMATION") does not create a phantom lot');
assert(lots.size === 3, 'still 3 lots — footer ignored');

console.log('\nTest 7: empty / null input safe');
{
  assert(recogniseMaggsLotsFromMarkdown('').size === 0, 'empty string → empty Map');
  assert(recogniseMaggsLotsFromMarkdown(null).size === 0, 'null → empty Map');
  assert(recogniseMaggsLotsFromMarkdown(undefined).size === 0, 'undefined → empty Map');
  assert(recogniseMaggsLotsFromMarkdown(123).size === 0, 'non-string → empty Map');
}

console.log('\nTest 8: duplicate lot id (same ID appearing twice) is de-duped');
{
  const dupMd = SAMPLE + '\n**LOT 1**\n\n## [Dup](https://www.maggsandallen.co.uk/property-details/34630929/-/x/y)\n';
  const out = recogniseMaggsLotsFromMarkdown(dupMd);
  assert(out.size === 3, `dup ignored, size still 3, got ${out.size}`);
  assert(out.get('34630929').address.startsWith('30, Avonvale'), 'first occurrence wins');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
