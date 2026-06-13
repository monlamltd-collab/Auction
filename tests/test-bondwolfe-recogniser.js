// tests/test-bondwolfe-recogniser.js — recogniseBondwolfeLotsFromMarkdown.
//
// Bond Wolfe (major West-Midlands auctioneer) loads lots via a WordPress
// "Load more" button (admin-ajax) behind Cloudflare with a JS-injected nonce —
// so the only way in is a rendered browser (the Crawlee render clicks "Load
// more" to exhaustion, then turndown bridges HTML→markdown). The recogniser
// parses that markdown. Each card becomes one markdown link wrapping an image,
// an `##### {address}` heading, the type tagline, type/vacancy badges, a
// `#### £{guide}` heading and "Auction: {date}", closed by the lot URL.
// Fixtures below match the REAL turndown output verified live 2026-06-13
// (htmlToRecognitionMarkdown of the live cards).

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { recogniseBondwolfeLotsFromMarkdown } = await import('../lib/pipeline/firecrawl-extract.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// Commercial / mixed-use, multi-badge, "&" in address, no beds, has guide.
const CARD_COMMERCIAL = `[

![Mixed use property in Hartlepool](https://cdn.eigpropertyauctions.co.uk/ams/images/243/auction/3450/2700100_web_medium)

##### 1 Oxford Street & 171 Stockton Road, Hartlepool, Cleveland, TS25 1SL

Mixed use property in Hartlepool

Commercial Investment

Mixed Use

Residential Investment

Guide price

#### £39,000+

Auction: 9th Jul 2026

](https://www.bondwolfe.com/auctions/properties/348547-property-auction-hartlepool/)`;

// Residential vacant, 3-bed, has guide. (Verified turndown output.)
const CARD_RESIDENTIAL = `[

![3 bedroom mid terraced house in Stoke on Trent](https://cdn.eigpropertyauctions.co.uk/ams/images/243/auction/3450/2695079_web_medium)

##### 22 West Terrace, Stoke-on-Trent, ST6 6QZ

3 bedroom mid terraced house in Stoke on Trent

Residential Vacant

Guide price

#### £20,000+

Auction: 9th Jul 2026

](https://www.bondwolfe.com/auctions/properties/348599-property-auction-stoke-on-trent/)`;

// Withdrawn lot with NO guide price → must NOT persist as available.
const CARD_WITHDRAWN = `[

![Land in Dudley](https://cdn.eigpropertyauctions.co.uk/ams/images/243/auction/3450/9999999_web_medium)

##### Land at Birmingham New Road, Dudley, DY1 4SB

Land in Dudley

Withdrawn

Auction: 9th Jul 2026

](https://www.bondwolfe.com/auctions/properties/348700-property-auction-dudley/)`;

console.log('Test 1: parses both standard cards');
const map = recogniseBondwolfeLotsFromMarkdown(CARD_COMMERCIAL + '\n\n' + CARD_RESIDENTIAL);
assert(map instanceof Map && map.size === 2, `Map of 2 (got ${map.size})`);

console.log('\nTest 2: commercial card fields');
const c = map.get('348547');
assert(!!c, 'keyed by propertyId 348547');
assert(c.address === '1 Oxford Street & 171 Stockton Road, Hartlepool, Cleveland, TS25 1SL', `address + & decoded (got "${c.address}")`);
assert(c.image_url === 'https://cdn.eigpropertyauctions.co.uk/ams/images/243/auction/3450/2700100_web_medium', `EIG-CDN image (got "${c.image_url}")`);
assert(c.guide_price === '£39,000', `guide_price (got "${c.guide_price}")`);
assert(c.property_type === 'commercial', `propType commercial (got "${c.property_type}")`);
assert(c.bedrooms === null, 'no beds on commercial');
assert(c.detail_url.includes('/auctions/properties/348547-'), 'detail_url captured');
assert(c.lot_status === 'available', `available (got "${c.lot_status}")`);

console.log('\nTest 3: residential card fields');
const r = map.get('348599');
assert(r.address === '22 West Terrace, Stoke-on-Trent, ST6 6QZ', `address (got "${r.address}")`);
assert(r.guide_price === '£20,000', `guide_price (got "${r.guide_price}")`);
assert(r.bedrooms === 3, `beds 3 (got ${r.bedrooms})`);
assert(r.property_type === 'residential', `propType residential (got "${r.property_type}")`);
assert(r.bullets.includes('Vacant'), 'vacant bullet');
assert(r.lot_status === 'available', 'available');

console.log('\nTest 4: withdrawn (no guide) is NOT marked available');
const w = recogniseBondwolfeLotsFromMarkdown(CARD_WITHDRAWN);
assert(w.size === 1 && w.get('348700').lot_status === 'withdrawn', `withdrawn (got "${w.get('348700')?.lot_status}")`);

console.log('\nTest 5: dedup by propertyId');
const dup = recogniseBondwolfeLotsFromMarkdown(CARD_COMMERCIAL + '\n\n' + CARD_COMMERCIAL);
assert(dup.size === 1, `same card twice → 1 (got ${dup.size})`);

console.log('\nTest 6: junk / empty input is safe');
assert(recogniseBondwolfeLotsFromMarkdown('').size === 0, 'empty → 0');
assert(recogniseBondwolfeLotsFromMarkdown('[no lots here](https://example.com/x)').size === 0, 'no bondwolfe links → 0');
assert(recogniseBondwolfeLotsFromMarkdown(null).size === 0, 'null → 0');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
