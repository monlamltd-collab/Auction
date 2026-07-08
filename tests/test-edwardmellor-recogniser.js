// tests/test-edwardmellor-recogniser.js — Edward Mellor two-tier static recogniser.
// The house broke to 0 lots mid-June: the pipeline scraped the /auctions/ landing
// (auction DATES only, no lots) → 0 → Gemini fallback then 429'd. Fixed by a
// two-tier drill (landing → soonest upcoming dated page) + this recogniser on the
// server-rendered /property-for-sale/{id} cards. Fixtures mirror the real markdown.

import {
  recogniseEdwardMellorLotsFromMarkdown,
  resolveEdwardMellorCatalogueUrl,
} from '../lib/pipeline/firecrawl-extract.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// ── Tier-2 recogniser (dated page → lots) ──
// Card shape: image link, "LOT\ TBC", full-address text link, beds/baths/receptions,
// "Guide Price £N", status badge.
const DATED_MD = `
#### Need to speak to the Auction Department? Call 0161 443 4740

[![20, 22 and 22a Dale St, Blackpool, FY1](https://edwardmellor.co.uk/search/images/10169117/320-0-3x2-1783355407.JPG)](https://edwardmellor.co.uk/property-for-sale/10169117)

LOT\\
TBC

[20, 22 and 22a Dale St, Blackpool, Lancashire, FY1](https://edwardmellor.co.uk/property-for-sale/10169117)

4

4

4

Guide Price[](#)\\
£160,000

AVAILABLE

[Legal Pack](https://auctioneertemplates.eigroup.co.uk/guides.aspx?a=92&c=edm)

* * *

[![A & B, Edleston Road, Crewe, CW2](https://edwardmellor.co.uk/search/images/10169209/320-0-3x2-1.png)](https://edwardmellor.co.uk/property-for-sale/10169209)

LOT\\
5

[A & B, Edleston Road, Crewe, CW2](https://edwardmellor.co.uk/property-for-sale/10169209)

2

2

[Virtual Viewing](https://edwardmellor.co.uk/property-for-sale/10169209#tour)

Guide Price[](#)\\
£80,000

SOLD

[Legal Pack](https://auctioneertemplates.eigroup.co.uk/guides.aspx?a=92&c=edm)

* * *
`;

console.log('recogniseEdwardMellorLotsFromMarkdown');
const lots = recogniseEdwardMellorLotsFromMarkdown(DATED_MD);
assert(lots.size === 2, `parses 2 lots (got ${lots.size})`);

const a = lots.get('10169117');
assert(!!a, 'lot 10169117 present');
assert(a && a.address === '20, 22 and 22a Dale St, Blackpool, Lancashire, FY1', `lot 1 full address (got ${a && a.address})`);
assert(a && a.guide_price === '£160,000', `lot 1 guide price (got ${a && a.guide_price})`);
assert(a && a.bedrooms === 4, `lot 1 beds=4 (got ${a && a.bedrooms})`);
assert(a && a.image_url === 'https://edwardmellor.co.uk/search/images/10169117/320-0-3x2-1783355407.JPG', `lot 1 image (got ${a && a.image_url})`);
assert(a && a.lot_status === 'available', `lot 1 status available (got ${a && a.lot_status})`);
assert(a && a.detail_url === 'https://edwardmellor.co.uk/property-for-sale/10169117', 'lot 1 detail url');

const b = lots.get('10169209');
assert(b && b.bedrooms === 2, `lot 2 beds=2 (got ${b && b.bedrooms})`);
assert(b && b.lot_status === 'sold', `lot 2 status sold (got ${b && b.lot_status})`);
assert(b && b.lot_number === '5', `lot 2 lot number 5 (got ${b && b.lot_number})`);

console.log('\nedge cases');
assert(recogniseEdwardMellorLotsFromMarkdown('').size === 0, 'empty markdown → 0 lots');
assert(recogniseEdwardMellorLotsFromMarkdown(null).size === 0, 'null → 0 lots');
// The image link inner (leading "!") must NOT be mistaken for a lot text link.
const imgOnly = '[![Some Addr](https://edwardmellor.co.uk/search/images/1/x.jpg)](https://edwardmellor.co.uk/property-for-sale/999)';
assert(recogniseEdwardMellorLotsFromMarkdown(imgOnly).size === 0, 'lone image link (no text link) → 0 lots');

// ── Tier-1 drill (landing → soonest upcoming dated URL) ──
console.log('\nresolveEdwardMellorCatalogueUrl');
const LANDING_HTML = `
<a href="/auctions/22apr2026">22 April 2026</a>
<a href="/auctions/10jun2026">10 June 2026</a>
<a href="/auctions/22jul2026">22 July 2026</a>
<a href="/auctions/12aug2026">12 August 2026</a>
<a href="/auctions/09sep2026">9 September 2026</a>
`;
const fakeFetch = async () => LANDING_HTML;

const r1 = await resolveEdwardMellorCatalogueUrl('https://edwardmellor.co.uk/auctions/', fakeFetch, '2026-07-08');
assert(r1 && r1.url === 'https://edwardmellor.co.uk/auctions/22jul2026', `picks soonest upcoming (got ${r1 && r1.url})`);
assert(r1 && r1.auctionDateIso === '2026-07-22', `returns ISO date (got ${r1 && r1.auctionDateIso})`);

const r2 = await resolveEdwardMellorCatalogueUrl('x', fakeFetch, '2026-08-01');
assert(r2 && r2.url === 'https://edwardmellor.co.uk/auctions/12aug2026', `rolls forward past 22jul when today is 1 Aug (got ${r2 && r2.url})`);

const r3 = await resolveEdwardMellorCatalogueUrl('x', fakeFetch, '2027-01-01');
assert(r3 === null, 'no upcoming auction → null');

const r4 = await resolveEdwardMellorCatalogueUrl('x', async () => { throw new Error('boom'); }, '2026-07-08');
assert(r4 === null, 'fetch failure → null (graceful)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
