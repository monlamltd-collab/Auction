// tests/test-suttonkersh-recogniser.js — Sutton Kersh static-catalogue recogniser.
//
// The house went dark (218 lots, 0 live) because it had NO recogniser and leaned on
// the AI extractor, which dies whenever the AI quota is exhausted. `?perPage=all`
// (forced in rewriteUrl) ships the whole current auction SSR in one fetch; this
// recogniser parses it deterministically. Verified 97/97 = 100% recall against the
// live page 2026-07-10 (79 available / 17 sold / 1 withdrawn).
//
// The status parse is the anti-leak contract: the current-auction page carries
// SOLD-prior and WITHDRAWN lots alongside available ones — they must never persist
// as `available`.

import { recogniseSuttonKershLotsFromMarkdown } from '../lib/pipeline/firecrawl-extract.js';
import { rewriteUrl } from '../lib/houses.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// Mirrors the real turndown markdown: photo link, H1 address anchor (with the
// trailing `\\` hard-break inside the link text), guide-price H2, `**Lot: N**`,
// then the descriptor line. Card 3 is SOLD (no guide price); card 4 is WITHDRAWN.
// String.raw so the `\\` hard-break stays two LITERAL backslashes followed by a real
// newline (a plain template literal would treat `\<newline>` as a line continuation
// and silently collapse the shape the recogniser must actually cope with).
const MD = String.raw`
[![](https://www.suttonkersh.co.uk/image_crop.php?filename=./property_images/auctions/155/2642900_web_medium.jpg&x=600&y=400)](https://www.suttonkersh.co.uk/properties/lot/343654/)
![Video Tour](https://www.suttonkersh.co.uk/assets/Uploads/video-tour.png)
×
# [29 Oxford Drive, Waterloo, Liverpool, Merseyside, L22 7RY\\
](https://www.suttonkersh.co.uk/properties/lot/343654/)
## [Guide Price: £225,000+ \*](https://www.suttonkersh.co.uk/properties/lot/343654/)
**Lot: 1**
VACANT RESIDENTIAL
[Details](https://www.suttonkersh.co.uk/properties/lot/343654/)

[![](https://www.suttonkersh.co.uk/image_crop.php?filename=./property_images/auctions/155/2724555_web_medium.jpg&x=600&y=400)](https://www.suttonkersh.co.uk/properties/lot/351527/)
×
# [54 Buttermere Gardens, Liverpool, Merseyside, L23 0SF\\
](https://www.suttonkersh.co.uk/properties/lot/351527/)
## [Guide Price: £70,000+ \*](https://www.suttonkersh.co.uk/properties/lot/351527/)
**Lot: 2**
VACANT RESIDENTIAL
[Details](https://www.suttonkersh.co.uk/properties/lot/351527/)

[![](https://www.suttonkersh.co.uk/image_crop.php?filename=./property_images/auctions/155/2700001_web_medium.jpg&x=600&y=400)](https://www.suttonkersh.co.uk/properties/lot/343999/)
×
# [2 Euston Street, Liverpool, Merseyside, L4 5UB\\
](https://www.suttonkersh.co.uk/properties/lot/343999/)
**Lot: 3**
Sold
VACANT RESIDENTIAL
[Details](https://www.suttonkersh.co.uk/properties/lot/343999/)

[![](https://www.suttonkersh.co.uk/image_crop.php?filename=./property_images/auctions/155/2700002_web_medium.jpg&x=600&y=400)](https://www.suttonkersh.co.uk/properties/lot/344100/)
×
# [7 Aigburth Road, Liverpool, Merseyside, L17 4JQ\\
](https://www.suttonkersh.co.uk/properties/lot/344100/)
## [Guide Price: £95,000+ \*](https://www.suttonkersh.co.uk/properties/lot/344100/)
**Lot: 4**
Withdrawn
COMMERCIAL
[Details](https://www.suttonkersh.co.uk/properties/lot/344100/)
`;

console.log('Sutton Kersh recogniser — 100% recall + sold/withdrawn never available');
const lots = recogniseSuttonKershLotsFromMarkdown(MD);

// ── Recall: every card recovered, keyed by lot id ──
assert(lots.size === 4, `all 4 cards recovered (got ${lots.size})`);
assert(lots.has('343654') && lots.has('351527') && lots.has('343999') && lots.has('344100'), 'keyed by lot id');

// ── Anti-leak: status parsed per card ──
assert(lots.get('343654').lot_status === 'available', 'lot 1 available');
assert(lots.get('351527').lot_status === 'available', 'lot 2 available');
assert(lots.get('343999').lot_status === 'sold', 'SOLD lot is status=sold (never available)');
assert(lots.get('344100').lot_status === 'withdrawn', 'WITHDRAWN lot is status=withdrawn (never available)');
assert([...lots.values()].filter(l => l.lot_status === 'available').length === 2, 'exactly 2 available lots');

// ── Fields ──
const l1 = lots.get('343654');
assert(l1.address === '29 Oxford Drive, Waterloo, Liverpool, Merseyside, L22 7RY', `address parsed, hard-break stripped (got ${l1.address})`);
assert(l1.guide_price === '£225,000', `guide price parsed (got ${l1.guide_price})`);
assert(l1.lot_number === '1', `lot number parsed (got ${l1.lot_number})`);
assert(l1.description === 'VACANT RESIDENTIAL', `descriptor parsed (got ${l1.description})`);
assert(/image_crop\.php/.test(l1.image_url) && /2642900/.test(l1.image_url), `own photo bound to the lot, no bleed (got ${l1.image_url.slice(-40)})`);
assert(l1.detail_url === 'https://www.suttonkersh.co.uk/properties/lot/343654/', 'detail url');

// image must not bleed from the previous card
assert(/2724555/.test(lots.get('351527').image_url), 'lot 2 gets its OWN photo (no bleed from lot 1)');
// a sold lot with no guide price yields an empty price, not a neighbour's
assert(lots.get('343999').guide_price === '', 'sold lot with no guide price → empty (no bleed)');

// ── Empty / garbage input never throws ──
assert(recogniseSuttonKershLotsFromMarkdown('').size === 0, 'empty markdown → empty map');
assert(recogniseSuttonKershLotsFromMarkdown(null).size === 0, 'null markdown → empty map');

// ── rewriteUrl query-param CASE repair (2026-07-22) ──
// Calendar URLs pass through the normalise_calendar_url DB trigger (NEW.url :=
// lower(...)) and normaliseUrl, so `auctionPeriod` returns as `auctionperiod`.
// The param is CASE-SENSITIVE: with perPage=all the lowercase form returns the
// whole ARCHIVE (11,476 lots, 15MB) instead of the 22-lot current sale. That
// 15MB fetch timed out into a 0-lot run and kept re-opening the circuit breaker.
// rewriteUrl must restore auctionPeriod. NB signature is rewriteUrl(url, house).
const skRewrite = async (url) => (await rewriteUrl(url, 'suttonkersh')).baseUrl;
{
  const lower = await skRewrite('https://suttonkersh.co.uk/properties/gallery/?section=auction&auctionperiod=current');
  assert(/auctionPeriod=current/.test(lower), `lowercased param is repaired to auctionPeriod (got ${lower})`);
  assert(!/auctionperiod=/.test(lower), 'no lowercase auctionperiod remains');
  assert(/perPage=all/.test(lower), 'perPage=all still forced');

  const already = await skRewrite('https://www.suttonkersh.co.uk/properties/gallery/?section=auction&auctionPeriod=current');
  assert(/auctionPeriod=current/.test(already) && !/auctionperiod=/.test(already),
    'a correctly-cased URL is left correct (idempotent)');

  const withStart = await skRewrite('https://suttonkersh.co.uk/properties/gallery/?section=auction&auctionperiod=current&start=16');
  assert(/auctionPeriod=current/.test(withStart) && !/[?&]start=/.test(withStart),
    'case repaired AND pagination dropped together');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
