/**
 * Pure-function tests for recogniseHollisMorganLotsFromMarkdown — the markdown
 * recogniser used as a recall fallback when Firecrawl JSON extract drops
 * Hollis Morgan lots from /search-auction/.
 *
 * Hollis Morgan runs its own CMS — NOT EIG white-label. The lot card shape is:
 *   #### Lot N  (or "#### Lot TBC")
 *   ### <address>
 *   #### **£price**  (sometimes "#### **<prefix>** **£price**")
 *   - bullet 1
 *   - bullet 2
 *   [SHOW ME MORE](https://www.hollismorgan.co.uk/property-details/<id>/...)
 *
 * Captured from a live Firecrawl probe of
 * https://www.hollismorgan.co.uk/search-auction/ on 2026-05-11. The fixture
 * covers the common variants:
 *   - Lot N with a single-bold-group price ("#### **£X +++**")
 *   - Lot N with a two-bold-group price ("#### **Auction Guide Price** **£X +++**")
 *   - Lot TBC preview entry with no lot number
 *   - Commercial property-type detection from bullets (nightclub)
 *   - Duplicate ID de-duping (two cards point at the same property-details id)
 *   - Bullet structure preserved as an array
 *
 * Run: node tests/test-hollismorgan-recogniser.js
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { recogniseHollisMorganLotsFromMarkdown } = await import('../lib/pipeline/firecrawl-extract.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const SAMPLE = `
![Bedrooms](https://www.hollismorgan.co.uk/images/bed-icon.svg)**4**![Bathrooms](https://www.hollismorgan.co.uk/images/bath-icon.svg)**3**![Reception](https://www.hollismorgan.co.uk/images/reception-icon.svg)**3**

#### Lot 12

### Parrys Close, Stoke Bishop, BS9 1AW

#### **£1,195,000 +++**

- Three Bathrooms
- Gym/Office
- Garage
- Level Rear Garden

[SHOW ME MORE](https://www.hollismorgan.co.uk/property-details/33935468/bristol-city/bristol/parrys-close-1?page=1)

![Bedrooms](https://www.hollismorgan.co.uk/images/bed-icon.svg)**21**![Bathrooms](https://www.hollismorgan.co.uk/images/bath-icon.svg)**14**![Reception](https://www.hollismorgan.co.uk/images/reception-icon.svg)**3**

#### Lot 30

### Cambridge Road, Clevedon, BS21 7HX

#### **Auction Guide Price** **£1,250,000 +++**

- CLOSE TO SEASIDE
- 21 BED LICENSED HMO
- SCOPE FOR £176K + INCOME pa
- POTENTIAL FOR LARGE FAMILY HOME
- VACANT POSSESSION

[SHOW ME MORE](https://www.hollismorgan.co.uk/property-details/34359461/north-somerset/north-somerset/cambridge-road-1?page=1)

#### Lot TBC

### Willway Street, Bedminster, BS3 4BG

#### **Auction Guide Price** **£900,000 +++**

- JUNE LIVE ONLINE AUCTION
- FREEHOLD FORMER NIGHTCLUB
- DEVELOPMENT OPPORTUNITY
- RESI SCHEME \\| SUBJECT TO PLANNING
- EXTENDED 8 WEEK COMPLETION

[SHOW ME MORE](https://www.hollismorgan.co.uk/property-details/34474154/bristol-city/bristol/willway-street?page=1)

#### Lot TBC

### College Road, Clifton, BS8 3HX

#### **£1,500,000 +++**

- A rare opportunity to own a new build house in Clifton
- Close to Clifton College and playing fields
- Internal photos of show home and external CGIs
- Ready to reserve now
- Summer 2026 completion

[SHOW ME MORE](https://www.hollismorgan.co.uk/property-details/34470497/bristol-city/bristol/the-mews-the-clifton-collection?page=1)

#### Lot 29

### Redland Road, Redland, BS6 6QX

#### **Auction Guide Price** **£875,000 +++**

- MAY LIVE ONLINE AUCTION
- FREEHOLD PERIOD HOUSE
- GARDEN & VACANT POSSESSION
- 10 BED HMO \\| 5 - 7 BED FAMILY HOME
- EXTENDED COMPLETION \\| SEPTEMBER 2026

[SHOW ME MORE](https://www.hollismorgan.co.uk/property-details/34525403/bristol-city/bristol/redland-road-1?page=1)

### A footer line that should not produce a phantom lot

#### Guidance about reserve prices

This section explains how reserve prices work and must NOT be matched as a lot.
`;

console.log('Test 1: recogniser returns a Map of 5 lots');
const lots = recogniseHollisMorganLotsFromMarkdown(SAMPLE);
assert(lots instanceof Map, 'returns a Map');
assert(lots.size === 5, `expected 5 lots, got ${lots.size}`);

console.log('\nTest 2: keys are the numeric property-details ids');
assert(lots.has('33935468'), 'has key 33935468 (Lot 12 Parrys Close)');
assert(lots.has('34359461'), 'has key 34359461 (Lot 30 Cambridge Road)');
assert(lots.has('34474154'), 'has key 34474154 (Lot TBC Willway Street)');
assert(lots.has('34470497'), 'has key 34470497 (Lot TBC College Road)');
assert(lots.has('34525403'), 'has key 34525403 (Lot 29 Redland Road)');

console.log('\nTest 3: Lot 12 — single-bold-group price, normal numeric lot');
{
  const l = lots.get('33935468');
  assert(l.lot_number === 12, `lot_number === 12, got ${l.lot_number}`);
  assert(l.address === 'Parrys Close, Stoke Bishop, BS9 1AW', `address: ${l.address}`);
  assert(l.guide_price === '£1,195,000 +++', `guide_price: ${l.guide_price}`);
  assert(l.lot_status === 'available', `status: ${l.lot_status}`);
  assert(Array.isArray(l.bullets) && l.bullets.length === 4, `bullets.length === 4, got ${l.bullets?.length}`);
  assert(l.bullets[0] === 'Three Bathrooms', `first bullet: ${l.bullets[0]}`);
  assert(l.detail_url === 'https://www.hollismorgan.co.uk/property-details/33935468/bristol-city/bristol/parrys-close-1', 'detail_url has ?page=1 stripped');
}

console.log('\nTest 4: Lot 30 — two-bold-group price ("Auction Guide Price" + amount)');
{
  const l = lots.get('34359461');
  assert(l.lot_number === 30, `lot_number === 30, got ${l.lot_number}`);
  assert(l.address.startsWith('Cambridge Road'), `address: ${l.address}`);
  assert(l.guide_price === '£1,250,000 +++', `guide_price (amount only, prefix discarded): ${l.guide_price}`);
  assert(l.bullets.some(b => /21 BED LICENSED HMO/.test(b)), 'bullets include "21 BED LICENSED HMO"');
  assert(l.bedrooms === 21, `bedrooms detected from bullet "21 BED LICENSED HMO": ${l.bedrooms}`);
  assert(l.property_type === 'house', `propType (HMO → house): ${l.property_type}`);
}

console.log('\nTest 5: Lot TBC — "DEVELOPMENT OPPORTUNITY" wins over "nightclub" (matches Maggs precedent)');
{
  const l = lots.get('34474154');
  assert(l.lot_number === null, `lot_number must be null for TBC, got ${l.lot_number}`);
  assert(l.address.startsWith('Willway Street'), `address: ${l.address}`);
  assert(l.guide_price === '£900,000 +++', `guide_price: ${l.guide_price}`);
  // "DEVELOPMENT OPPORTUNITY" matches the land branch BEFORE the commercial
  // branch — same regex order as recogniseMaggsLotsFromMarkdown. Downstream
  // enrichment refines property_type from the detail page.
  assert(l.property_type === 'land', `propType (development opportunity → land, prio over commercial): ${l.property_type}`);
}

console.log('\nTest 6: Lot TBC with single-bold-group price (no prefix)');
{
  const l = lots.get('34470497');
  assert(l.lot_number === null, `lot_number === null for TBC, got ${l.lot_number}`);
  assert(l.address.startsWith('College Road'), `address: ${l.address}`);
  assert(l.guide_price === '£1,500,000 +++', `guide_price: ${l.guide_price}`);
  assert(l.property_type === 'house', `propType (new build house → house): ${l.property_type}`);
}

console.log('\nTest 7: Lot 29 — bullet structure preserved, "10 BED HMO" detected');
{
  const l = lots.get('34525403');
  assert(l.lot_number === 29, `lot_number === 29, got ${l.lot_number}`);
  assert(l.bullets.length === 5, `bullets.length === 5, got ${l.bullets.length}`);
  assert(l.bedrooms === 10, `bedrooms from "10 BED HMO": ${l.bedrooms}`);
  assert(l.property_type === 'house', `propType (HMO → house): ${l.property_type}`);
}

console.log('\nTest 8: footer text after lots does not create a phantom lot');
assert(lots.size === 5, 'still 5 lots — footer h3 / h4 ignored');

console.log('\nTest 9: empty / null / non-string input is safe');
{
  assert(recogniseHollisMorganLotsFromMarkdown('').size === 0, 'empty string → empty Map');
  assert(recogniseHollisMorganLotsFromMarkdown(null).size === 0, 'null → empty Map');
  assert(recogniseHollisMorganLotsFromMarkdown(undefined).size === 0, 'undefined → empty Map');
  assert(recogniseHollisMorganLotsFromMarkdown(123).size === 0, 'non-string → empty Map');
}

console.log('\nTest 10: duplicate lot id (same property-details/<id>/ in two cards) is de-duped');
{
  const dupMd = SAMPLE + `

#### Lot 99

### Some Other Address

#### **£99,999 +++**

- duplicate bullet

[SHOW ME MORE](https://www.hollismorgan.co.uk/property-details/33935468/bristol-city/bristol/dup?page=1)
`;
  const out = recogniseHollisMorganLotsFromMarkdown(dupMd);
  assert(out.size === 5, `dup ignored, size still 5, got ${out.size}`);
  assert(out.get('33935468').address.startsWith('Parrys Close'), 'first occurrence wins');
}

console.log('\nTest 11: no-www host variant (Crawlee-rendered DOM, 2026-06-13 incident)');
{
  // Crawlee renders the June-24 catalogue URL on the bare host, and the DOM's
  // SHOW ME MORE hrefs come out as https://hollismorgan.co.uk/... (no www.) —
  // the recogniser must match both hosts or recovery silently returns 0
  // while the host-less sentinel still counts every lot (recall 49%, +0
  // recognised, production 2026-06-13).
  const noWwwMd = `
![BS30](https://hollismorgan.co.uk/resize/34641077/0/480.pagespeed.ce.aREffy08bS.jpg)

#### Lot 1

### Bath Road, Willsbridge, BS30 6EP

#### **Auction Guide Price £350,000 +++**

- JUNE LIVE ONLINE AUCTION
- FREEHOLD DEVELOPMENT OPPORTUNITY

[SHOW ME MORE](https://hollismorgan.co.uk/property-details/34641077/south-gloucestershire/bristol/and-92a?page=1&bid=11&showstc=on&orderby=lot_no+asc)
`;
  const out = recogniseHollisMorganLotsFromMarkdown(noWwwMd);
  assert(out.size === 1, `no-www markdown recognised, size === 1, got ${out.size}`);
  const l = out.get('34641077');
  assert(!!l, 'has key 34641077');
  if (l) {
    assert(l.lot_number === 1, `lot_number === 1, got ${l.lot_number}`);
    assert(l.guide_price === '£350,000 +++', `guide_price: ${l.guide_price}`);
    assert(l.detail_url === 'https://hollismorgan.co.uk/property-details/34641077/south-gloucestershire/bristol/and-92a', `EIG params stripped: ${l.detail_url}`);
    assert(l.image_url === 'https://hollismorgan.co.uk/resize/34641077/0/480.pagespeed.ce.aREffy08bS.jpg', `hero image joined by /resize/<id>/: ${l.image_url}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
