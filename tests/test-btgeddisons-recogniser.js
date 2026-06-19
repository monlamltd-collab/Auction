// tests/test-btgeddisons-recogniser.js — recogniseBtgEddisonsLotsFromMarkdown.
//
// BTG Eddisons (the SDL-network catalogue scraped under the `sdl` slug) rebuilt its
// listing template (structure_drift 2026-06-14 → 0 lots since ~31 May). The new page
// is server-rendered + paginated, but ?page=1&limit=500 returns the whole catalogue in
// one fetch. Fixtures are the REAL turndown markdown verified live 2026-06-14
// (htmlToRecognitionMarkdown of /properties?limit=500): each card is an address text-link,
// an image (often an estate-AGENT LOGO under a different artnr, with the property photo —
// when present — under artnr_{lotIdPrefix}/_pictures/), a "Guide Price: £X+" line, then
// "View Listing". The lot id carries a -DDMMYY auction-date suffix.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { recogniseBtgEddisonsLotsFromMarkdown } = await import('../lib/pipeline/firecrawl-extract.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// CARD1 — property photo present (artnr matches the lot id prefix) + guide price.
const CARD1 = `[Land Adjacent to Thornsett Trading Estate, Birch Vale, High Peak, Derbyshire SK22 1AH](https://www.btgeddisonspropertyauctions.com/properties/202603201159sq_pjgl-160626/for-auction-high-peak)

![](https://asta.btgeddisonspropertyauctions.com/skyco13/XIII-HUB-SDL-3/sdl_data/address/pkm_sdl/artnr_202603201159sq_pjgl/_pictures/1_t202605180933.jpeg?&uuid=html5-ccbbf0bb)

Guide Price: £595,000+

View Listing`;

// CARD2 — only an estate-agent LOGO image (different artnr) — must be rejected (image '').
const CARD2 = `[Rose Villa, Welshpool Road, Bicton Heath, Shrewsbury, Shropshire SY3 8EN](https://www.btgeddisonspropertyauctions.com/properties/202602241100sq_ywgw-180626/for-auction-shrewsbury)

![](https://asta.btgeddisonspropertyauctions.com/skyco13/XIII-HUB-SDL-3/sdl_data/address/pkm_sdl/artnr_B86196DE-1BE0-4D45/_pictures/Impey__amp__Co.jpg?&uuid=html5-aaa)

Guide Price: £395,000+

View Listing`;

// CARD3 — price rendered with markdown emphasis ("Guide Price* **£X+**"), the
// turndown bold variant. The old `Guide Price:? £` regex missed this entirely,
// dropping the guide price even though it was on the card.
const CARD3 = `[The Old Bakery, Mill Street, Ludlow, Shropshire SY8 1AB](https://www.btgeddisonspropertyauctions.com/properties/202604011200sq_zzzz-200626/for-auction-ludlow)

![](https://asta.btgeddisonspropertyauctions.com/skyco13/XIII-HUB-SDL-3/sdl_data/address/pkm_sdl/artnr_202604011200sq_zzzz/_pictures/1_t.jpeg)

Guide Price\\* **£250,000+**

View Listing`;

console.log('Test 0: markdown-emphasised "Guide Price* **£X+**" is captured');
{
  const m3 = recogniseBtgEddisonsLotsFromMarkdown(CARD3);
  const c = m3.get('202604011200sq_zzzz-200626');
  assert(!!c, 'bold-price card parsed');
  assert(c && c.guide_price === '£250,000', `guide_price from bold markdown (got "${c?.guide_price}")`);
}

console.log('Test 1: parses both lots, keyed by id');
const map = recogniseBtgEddisonsLotsFromMarkdown(CARD1 + '\n\n' + CARD2);
assert(map instanceof Map && map.size === 2, `Map of 2 (got ${map.size})`);

console.log('\nTest 2: card 1 — price, property image (artnr-bound), auction date');
const a = map.get('202603201159sq_pjgl-160626');
assert(!!a, 'keyed by lot id');
assert(a && a.address.startsWith('Land Adjacent to Thornsett'), `address (got "${a?.address?.slice(0, 30)}")`);
assert(a && a.guide_price === '£595,000', `guide_price (got "${a?.guide_price}")`);
assert(a && a.auction_date === '2026-06-16', `auction_date from -160626 (got "${a?.auction_date}")`);
assert(a && a.image_url.includes('artnr_202603201159sq_pjgl/_pictures'), `property image bound to lot (got "${a?.image_url?.slice(-50)}")`);
assert(a && a.lot_status === 'available', `available (got "${a?.lot_status}")`);

console.log('\nTest 3: card 2 — price + date captured, agent LOGO rejected');
const b = map.get('202602241100sq_ywgw-180626');
assert(b && b.guide_price === '£395,000', `guide_price (got "${b?.guide_price}")`);
assert(b && b.auction_date === '2026-06-18', `auction_date from -180626 (got "${b?.auction_date}")`);
assert(b && b.image_url === '', `agent logo rejected → empty image (got "${b?.image_url}")`);

console.log('\nTest 4: dedup + junk-safe');
assert(recogniseBtgEddisonsLotsFromMarkdown(CARD1 + '\n\n' + CARD1).size === 1, 'same lot twice → 1');
assert(recogniseBtgEddisonsLotsFromMarkdown('').size === 0, 'empty → 0');
assert(recogniseBtgEddisonsLotsFromMarkdown(null).size === 0, 'null → 0');
assert(recogniseBtgEddisonsLotsFromMarkdown('[Some House, Town](https://example.com/properties/x/for-auction-y)').size === 0, 'non-BTG host → 0');

console.log('\nTest 5: lot link appears TWICE per card — guide price (2nd window) is merged');
{
  // The REAL post-rebuild layout: each lot's link renders twice (image/title
  // link, then the address text link), and "Guide Price: £X" sits only in the
  // SECOND window. The old dedup-skip kept the first (price-less) occurrence, so
  // every lot persisted with no guide price (catalogue coverage 92%→16%). The
  // recogniser must merge the price (and image) across the two occurrences.
  const CARD_DOUBLE = `[Mulberry Brook, Manchester Road, Marsden, Huddersfield HD7 6LU](https://www.btgeddisonspropertyauctions.com/properties/202604221320sq_flm9-220626/for-auction-marsden)

![](https://asta.btgeddisonspropertyauctions.com/skyco13/XIII-HUB-SDL-3/sdl_data/address/pkm_sdl/artnr_202604221320sq_flm9/_pictures/1.jpeg)

Single-Lot Timed Auction

[Mulberry Brook, Manchester Road, Marsden, Huddersfield HD7 6LU](https://www.btgeddisonspropertyauctions.com/properties/202604221320sq_flm9-220626/for-auction-marsden)

Guide Price: £875,000+

View Listing`;
  const md = recogniseBtgEddisonsLotsFromMarkdown(CARD_DOUBLE);
  const c = md.get('202604221320sq_flm9-220626');
  assert(md.size === 1, `double-link card → 1 lot (got ${md.size})`);
  assert(c && c.guide_price === '£875,000', `guide price merged from 2nd window (got "${c?.guide_price}")`);
  assert(c && c.image_url.includes('artnr_202604221320sq_flm9/_pictures'), `image bound from 1st window (got "${c?.image_url?.slice(-40)}")`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
