// tests/test-sdlauctions-recogniser.js — recogniseSdlAuctionsLotsFromMarkdown.
//
// SDL Property Auctions (sdlauctions) — major UK auctioneer, now under the BTG
// Eddisons brand but still trading its own catalogue at sdlauctions.co.uk. The
// /search/ grid is AJAX-hydrated (WordPress theme `searchProperty()` POSTs to
// /wp-content/themes/sdl-auctions/library/property-functions.php with func=ajaxProp),
// so the catalogue must be rendered (Crawlee → turndown) before recognition.
// Fixtures below are the REAL recognition markdown captured live 2026-06-22
// (ajaxProp response → htmlToRecognitionMarkdown). Each card: an empty-text
// image-wrapper link, a "[{Type} in {Town}]" title link, an address bullet with
// postcode, a "Guide price*" + "£N+ (plus fees)" pair, an "Auction date:" line,
// then (when present) the estate-AGENT partner LOGO image (rejected — the real
// property photo is lazy-loaded in a <style> block turndown strips), then
// "Find out more". The lot id is NUMERIC in the URL and the lot link renders 3×.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { recogniseSdlAuctionsLotsFromMarkdown } = await import('../lib/pipeline/firecrawl-extract.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// REAL captured markdown — three consecutive cards from the live ajaxProp response
// (lots 51073, 51063, 51065 — captured 2026-06-22):
//  • 51073 — no image at all in the markdown (lazy-only photo).
//  • 51063 — markdown image is the estate-agent PARTNER LOGO (1735918725669.jpg).
//  • 51065 — markdown image is the estate-agent PARTNER LOGO (The_property_Fox.jpg).
const REAL = String.raw`[

](https://www.sdlauctions.co.uk/property/51073/commercial-property-for-auction-rotherham/)

[Commercial Property in Rotherham](https://www.sdlauctions.co.uk/property/51073/commercial-property-for-auction-rotherham/)

-   1 College Walk, Rotherham, South Yorkshire S60 1QB
-   Guide price\*
-   £80,000+ (plus fees)

-   **Auction date:**\\
    24th Jun 2026 at 10.00am

[Find out more](https://www.sdlauctions.co.uk/property/51073/commercial-property-for-auction-rotherham/)

[

](https://www.sdlauctions.co.uk/property/51063/terraced-house-for-auction-burton-on-trent/)

[Terraced House in Burton-On-Trent](https://www.sdlauctions.co.uk/property/51063/terraced-house-for-auction-burton-on-trent/)

-   2

-   126 Waterloo Street, Burton-On-Trent, Staffordshire DE14 2NF
-   Guide price\*
-   £82,000+ (plus fees)

-   **Auction date:**\\
    29th Jul 2026 at 10.00am

![](https://sdl-hub.property-world.co.uk/skyco13/XIII-HUB-SDL-2/../../sdl_data/address/pkm_sdl/artnr_956F4AC4-F983-4204-8C95-520A4A87A6FC/_pictures/1735918725669.jpg)

[Find out more](https://www.sdlauctions.co.uk/property/51063/terraced-house-for-auction-burton-on-trent/)

[

](https://www.sdlauctions.co.uk/property/51065/town-house-for-auction-leicester/)

[Town House in Leicester](https://www.sdlauctions.co.uk/property/51065/town-house-for-auction-leicester/)

-   2

-   4 Cavendish Mews, Aylestone, Leicester, Leicestershire LE2 7PN
-   Guide price\*
-   £100,000+ (plus fees)

-   **Auction date:**\\
    29th Jul 2026 at 10.00am

![](https://sdl-hub.property-world.co.uk/skyco13/XIII-HUB-SDL-2/address/pkm_sdl/artnr_E881BB05-4033-434D-B654-8FCC64BC7C63/_pictures/The_property_Fox.jpg)

[Find out more](https://www.sdlauctions.co.uk/property/51065/town-house-for-auction-leicester/)`;

console.log('Test 1: parses all 3 real lots, keyed by numeric id');
const map = recogniseSdlAuctionsLotsFromMarkdown(REAL);
assert(map instanceof Map && map.size === 3, `Map of 3 (got ${map.size})`);

console.log('\nTest 2: card 51073 — address, guide price, type, auction date');
const a = map.get('51073');
assert(!!a, 'keyed by lot id 51073');
assert(a && a.address === '1 College Walk, Rotherham, South Yorkshire S60 1QB', `address (got "${a?.address}")`);
assert(a && a.guide_price === '£80,000', `guide_price (got "${a?.guide_price}")`);
assert(a && a.property_type === 'Commercial Property', `property_type (got "${a?.property_type}")`);
assert(a && a.auction_date === '2026-06-24', `auction_date from 24th Jun 2026 (got "${a?.auction_date}")`);
assert(a && a.detail_url === 'https://www.sdlauctions.co.uk/property/51073/commercial-property-for-auction-rotherham/', `detail_url (got "${a?.detail_url}")`);
assert(a && a.lot_status === 'available', `available (got "${a?.lot_status}")`);

console.log('\nTest 3: card 51063 — address skips the bare beds bullet; price + date; partner LOGO rejected');
const b = map.get('51063');
assert(b && b.address === '126 Waterloo Street, Burton-On-Trent, Staffordshire DE14 2NF', `address skips "2" beds bullet (got "${b?.address}")`);
assert(b && b.guide_price === '£82,000', `guide_price (got "${b?.guide_price}")`);
assert(b && b.auction_date === '2026-07-29', `auction_date from 29th Jul 2026 (got "${b?.auction_date}")`);
assert(b && b.image_url === '', `estate-agent partner logo rejected → empty image (got "${b?.image_url}")`);

console.log('\nTest 4: card 51065 — "The_property_Fox.jpg" agent logo rejected (mirrors BTG card-2 logo case)');
const c = map.get('51065');
assert(c && c.address === '4 Cavendish Mews, Aylestone, Leicester, Leicestershire LE2 7PN', `address (got "${c?.address}")`);
assert(c && c.guide_price === '£100,000', `guide_price (got "${c?.guide_price}")`);
assert(c && c.image_url === '', `"The_property_Fox.jpg" logo rejected → empty image (got "${c?.image_url}")`);

console.log('\nTest 5: detail-url id pattern — every parsed key is the numeric /property/{id}');
for (const [id, lot] of map) {
  assert(new RegExp(`/property/${id}/`).test(lot.detail_url), `lot ${id} detail_url carries /property/${id}/`);
}

console.log('\nTest 6: dedup + junk-safe');
assert(recogniseSdlAuctionsLotsFromMarkdown(REAL + '\n\n' + REAL).size === 3, 'same cards twice → 3 (dedup by id)');
assert(recogniseSdlAuctionsLotsFromMarkdown('').size === 0, 'empty → 0');
assert(recogniseSdlAuctionsLotsFromMarkdown(null).size === 0, 'null → 0');
assert(recogniseSdlAuctionsLotsFromMarkdown('[Some House, Town SW1 1AA](https://example.com/property/123/x/)').size === 0, 'non-SDL host → 0');

console.log('\nTest 7: real property photo (timestamped _pictures filename) IS accepted when present');
{
  // Synthetic card carrying a real property photo (not a logo) to prove the
  // image binder accepts a genuine property-world _pictures/ photo.
  const WITH_PHOTO = String.raw`[Detached House in Derby](https://www.sdlauctions.co.uk/property/51999/detached-house-for-auction-derby/)

-   12 Test Road, Derby, Derbyshire DE1 1AA
-   Guide price\*
-   £150,000+ (plus fees)

-   **Auction date:**\\
    1st Aug 2026 at 10.00am

![](https://sdl-hub.property-world.co.uk/skyco13/XIII-HUB-SDL-2/sdl_data/address/pkm_sdl/artnr_202606111039sq_4jqh/_pictures/126_water7_t202606111046.jpg?&uuid=sdl_website)

[Find out more](https://www.sdlauctions.co.uk/property/51999/detached-house-for-auction-derby/)`;
  const m = recogniseSdlAuctionsLotsFromMarkdown(WITH_PHOTO);
  const lot = m.get('51999');
  assert(!!lot, 'photo card parsed');
  assert(lot && lot.image_url.includes('artnr_202606111039sq_4jqh/_pictures'), `property photo bound (got "${lot?.image_url?.slice(-50)}")`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
