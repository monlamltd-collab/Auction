// tests/test-charlesdarrow-recogniser.js — recogniseCharlesDarrowLotsFromMarkdown.
//
// Charles Darrow is an INDEPENDENT Devon/Cornwall auctioneer on its own ASP.NET
// site (de-conflated from the overloaded `sdl`/`btgeddisons` slug 2026-06-21).
// The /Auctions/ grid is AJAX-hydrated into #resultsControl, so it needs a
// browser render (Crawlee) before turndown. The fixtures below are a SMALL
// excerpt of the REAL turndown recognition markdown captured live 2026-06-21
// (htmlToRecognitionMarkdown of /Auctions/). Each lot card is an image-wrapper
// link (real photo via ImageServer.aspx?I={id}_{n}.jpg + a property-icon.png
// placeholder), then "# Auction Lot: {title}" / "# {types}" / "# {town,county}"
// headings, a Type:/Location:/FH Price:/Ref: block, a feature bullet list (with
// "Public Auction {date}"), and a [VIEW DETAILS] link. The lot link renders
// TWICE per card (image wrapper, then VIEW DETAILS) — keyed by numeric id.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { recogniseCharlesDarrowLotsFromMarkdown } = await import('../lib/pipeline/firecrawl-extract.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// REAL captured markdown — lot 34493 (Torquay) followed by lot 34480 (Paignton).
// Verbatim from htmlToRecognitionMarkdown(/Auctions/) on 2026-06-21.
const FIXTURE = `[

![](https://www.charlesdarrow.co.uk/Modules/Controls/ImageServer.aspx?I=34493_22108.jpg&T=-1&C=/Images/Im2/1/)

![Auction Lot: A freehold mixed-use investment property situated in Torquay](https://www.charlesdarrow.co.uk/images/websiteComponents/property%20icon.png)

VIEW PROPERTY



](https://www.charlesdarrow.co.uk/propertyInfo/34493/for-sale/Shop-Commercial-Property,-Mixed-Use,-Investment,-Auctions/Torquay-Devon)

# Auction Lot: A freehold mixed-use investment property situated in Torquay

# Shop, Commercial Property, Mixed Use, Investment, Auctions

# Torquay, Devon

Type: Shop, Commercial Property, Mixed Use, Investment, Auctions\\\\
Location: Torquay, Devon\\\\
FH Price: £185,000 Guide Price\\\\
Ref: CD-90336

-   For Sale by Public Auction 25/6/26
-   Freehold mixed-use investment
-   Ground floor retail unit
-   Fully let, producing £22,260 per annum
-   EPC Rating: D, D & D

FH Price: £185,000 Guide Price\\\\

Ref: CD-90336

[VIEW DETAILS](https://www.charlesdarrow.co.uk/propertyInfo/34493/for-sale/Shop-Commercial-Property,-Mixed-Use,-Investment,-Auctions/Torquay-Devon)

[

![](https://www.charlesdarrow.co.uk/Modules/Controls/ImageServer.aspx?I=34480_21860.jpg&T=-1&C=/Images/Im2/1/)

![Auction Lot: Cottage in Paignton, Devon](https://www.charlesdarrow.co.uk/images/websiteComponents/property%20icon.png)

VIEW PROPERTY



](https://www.charlesdarrow.co.uk/propertyInfo/34480/for-sale/Block-of-Apartments-Mixed-Use,-Investment,-Auctions/Paignton-Devon)

# Auction Lot: Cottage in Paignton, Devon

# Block of Apartments, Mixed Use, Investment, Auctions

# Paignton, Devon

Type: Block of Apartments, Mixed Use, Investment, Auctions\\\\
Location: Paignton, Devon\\\\
FH Price: £45,000 Guide Price\\\\
Ref: CD-90332

-   To be Sold by Public Auction 25/6/26
-   Single-storey cottage
-   Development potential
-   Vacant

FH Price: £45,000 Guide Price\\\\

Ref: CD-90332

[VIEW DETAILS](https://www.charlesdarrow.co.uk/propertyInfo/34480/for-sale/Block-of-Apartments-Mixed-Use,-Investment,-Auctions/Paignton-Devon)`;

console.log('Test 1: parses both lots, keyed by numeric propertyInfo id');
const map = recogniseCharlesDarrowLotsFromMarkdown(FIXTURE);
assert(map instanceof Map && map.size === 2, `Map of 2 (got ${map.size})`);

console.log('\nTest 2: lot 34493 — address, price, detail_url id, image, date, tenure, type');
const a = map.get('34493');
assert(!!a, 'keyed by id 34493');
assert(a && /Torquay/.test(a.address) && a.address.length >= 6, `address contains location (got "${a?.address}")`);
assert(a && a.guide_price === '£185,000', `guide_price (got "${a?.guide_price}")`);
assert(a && /\/propertyInfo\/34493\/for-sale\//.test(a.detail_url), `detail_url id 34493 (got "${a?.detail_url}")`);
assert(a && a.image_url.includes('I=34493_'), `property image bound to lot (got "${a?.image_url?.slice(-50)}")`);
assert(a && a.auction_date === '2026-06-25', `auction_date from 25/6/26 (got "${a?.auction_date}")`);
assert(a && a.tenure === 'Freehold', `tenure from FH price (got "${a?.tenure}")`);
assert(a && /Shop/.test(a.property_type) && !/Auctions/.test(a.property_type), `property_type drops Auctions tag (got "${a?.property_type}")`);
assert(a && a.lot_status === 'available', `available (got "${a?.lot_status}")`);
assert(a && a.bullets.length >= 1, `bullets captured (got ${a?.bullets?.length})`);

console.log('\nTest 3: lot 34480 — distinct lot, own price + image');
const b = map.get('34480');
assert(b && b.guide_price === '£45,000', `guide_price (got "${b?.guide_price}")`);
assert(b && b.image_url.includes('I=34480_'), `own image, not neighbour's (got "${b?.image_url?.slice(-40)}")`);
assert(b && /Paignton/.test(b.address), `address (got "${b?.address}")`);

console.log('\nTest 4: dedup + junk-safe');
assert(recogniseCharlesDarrowLotsFromMarkdown(FIXTURE + '\n\n' + FIXTURE).size === 2, 'same page twice → 2 (dedup by id)');
assert(recogniseCharlesDarrowLotsFromMarkdown('').size === 0, 'empty → 0');
assert(recogniseCharlesDarrowLotsFromMarkdown(null).size === 0, 'null → 0');
assert(recogniseCharlesDarrowLotsFromMarkdown('[Some House](https://example.com/propertyInfo/9/for-sale/x/y)').size === 0, 'non-CD host → 0');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
