// tests/test-eig-oas-recogniser.js — shared EIG OAS current-auction recogniser.
//
// THE contract under test (the anti-leak guarantee): the recogniser returns ONLY
// currently-live lots and NEVER an ended one. Verified live 2026-07-08 across four
// OAS theme variants (tcpa uuid/Buy-It-Now, paulfosh Auction-Ended, landwood
// Result:Unsold-with-no-badge, sageandco). Fixtures mirror the real turndown
// markdown (raw /lot/details/{id} anchors, ended markers, markdown-bold status).
// Dates are pinned far past/future so the test never rots.

import { recogniseEigOasLotsFromMarkdown } from '../lib/pipeline/firecrawl-extract.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const TODAY = '2026-07-08';

// Card 1: LIVE, UUID id, tcpa "Buy It Now - Available Until <future>" theme.
// Card 2: LIVE, numeric id, landwood/sageandco "Guide Price" + future date theme.
// Card 3: ENDED, numeric id, paulfosh "Auction Ended" + "Result: **Unsold**".
// Card 4: ENDED-no-badge (landwood 170612): address + description + "Result:
//         **Unsold**" + "View Result", NO date/price — must NOT leak as live.
// Card 5: bare address + description, no date/price/status token — no positive
//         live signal, must be dropped (not affirmatively live).
const MD = `
[![](https://cdn.eigpropertyauctions.co.uk/ams/images/288/auction/0/2713510_web_medium?v=6/5/2026 4:37:25 PM)](https://eastmidlands.townandcountrypropertyauctions.co.uk/lot/details/742e9488-b032-426b-8af4-e243afaa0265?searchToken=ABC123)

### Buy It Now - Available Until: 09/07/2099 10:06

East Midlands Office

91 Bridgeman Road, Coventry, West Midlands, CV6 1NS

-   5 Bedroom Fully Licensed HMO

Buy it Now:\\
£260,000  + fees

[View Details](https://eastmidlands.townandcountrypropertyauctions.co.uk/lot/details/742e9488-b032-426b-8af4-e243afaa0265?searchToken=ABC123)

[![](https://cdn.eigpropertyauctions.co.uk/ams/images/188/auction/0/2500001_web_medium?v=)](https://www.landwoodpropertyauctions.com/lot/details/186060)
[
### Apartment 215 Manor Mills, Ingram Street, Leeds, West Yorkshire, LS11 9BN
](https://www.landwoodpropertyauctions.com/lot/details/186060)
#### Guide Price:   **£80,000**
End Time - 15/07/2099 12:00
[View Details](https://www.landwoodpropertyauctions.com/lot/details/186060)

[![](https://cdn.eigpropertyauctions.co.uk/ams/images/37/auction/0/2733834_web_medium?v=)](https://auction.paulfosh.com/lot/details/186986)
Lot 94 - Auction Ended - 25/06/2020 16:42
#### 377 Cardiff Road, Aberdare, Mid Glamorgan, CF44 6HX
Result:   **Unsold**
4 bids
[View Result](https://auction.paulfosh.com/lot/details/186986)

[![](https://cdn.eigpropertyauctions.co.uk/ams/images/188/auction/0/2600000_web_medium?v=)](https://www.landwoodpropertyauctions.com/lot/details/170612)
[
### 252 Summergangs Road, Hull, North Humberside, HU8 8LL
](https://www.landwoodpropertyauctions.com/lot/details/170612)
#### **On Behalf of the Court Appointed Receiver: Vacant 4-bedroom semi-detached house.**
The property comprises a 4 bedroom semi-detached house available to view.
#### Result:   **Unsold**
#### 6 bids
[View Result](https://www.landwoodpropertyauctions.com/lot/details/170612)

[![](https://cdn.eigpropertyauctions.co.uk/ams/images/188/auction/0/2600001_web_medium?v=)](https://www.landwoodpropertyauctions.com/lot/details/999001)
[
### 5 Nowhere Lane, Somewhere, Countyshire, ZZ1 1ZZ
](https://www.landwoodpropertyauctions.com/lot/details/999001)
A description with no price, no date, no status token at all.
[View Details](https://www.landwoodpropertyauctions.com/lot/details/999001)

[![](https://cdn.eigpropertyauctions.co.uk/ams/images/43/auction/0/2720133_web_medium?v=)](https://online.firstforauctions.co.uk/lot/details/186266)
[
### Flat 1 Marston Ferry Court, Marston Ferry Road, Oxford, Oxfordshire, OX2 7XH
](https://online.firstforauctions.co.uk/lot/details/186266)
**Guide Price\*:**  £270,000 **Minimum Opening Bid:**  £250,000 **End Time:**  30 Jul 2099 12:00
[View Details](https://online.firstforauctions.co.uk/lot/details/186266)
`;

console.log('EIG OAS recogniser — live-only, zero ended leakage');
const lots = recogniseEigOasLotsFromMarkdown(MD, TODAY);

// ── Recall: all three live lots captured, keyed by id ──
assert(lots.size === 3, `exactly 3 live lots recovered (got ${lots.size})`);
assert(lots.has('742e9488-b032-426b-8af4-e243afaa0265'), 'UUID live lot (Buy It Now) captured');
assert(lots.has('186060'), 'numeric live lot (Guide Price) captured');
assert(lots.has('186266'), 'live lot with month-name End Time date captured');
// month-name date ("30 Jul 2099") parses to ISO — the firstforauctions theme.
assert(lots.get('186266')?.auction_date === '2099-07-30', `month-name date → ISO (got ${lots.get('186266')?.auction_date})`);

// ── Anti-leak: no ended / no-signal lot present ──
assert(!lots.has('186986'), 'ended lot (Auction Ended + Result: Unsold) DROPPED');
assert(!lots.has('170612'), 'ended-with-no-badge lot (Result/View Result) DROPPED');
assert(!lots.has('999001'), 'no-live-signal lot (no date/price/token) DROPPED');

// ── Every returned lot is affirmatively live ──
for (const [id, lot] of lots) {
  assert(lot.lot_status === 'available', `lot ${id} status=available`);
  assert(!!lot.auction_date && lot.auction_date >= TODAY, `lot ${id} has a real future auction_date (${lot.auction_date})`);
}

// ── Field extraction + URL hygiene ──
const uuidLot = lots.get('742e9488-b032-426b-8af4-e243afaa0265');
assert(uuidLot.address === '91 Bridgeman Road, Coventry, West Midlands, CV6 1NS', 'UUID lot address parsed');
assert(uuidLot.guide_price === '£260,000', `UUID lot guide price parsed (got ${uuidLot.guide_price})`);
assert(uuidLot.auction_date === '2099-07-09', `UUID lot date DD/MM/YYYY → ISO (got ${uuidLot.auction_date})`);
assert(!/[?]/.test(uuidLot.detail_url) && /\/lot\/details\/742e9488/.test(uuidLot.detail_url),
  `UUID lot detail_url keeps host+path, strips searchToken (got ${uuidLot.detail_url})`);

const numLot = lots.get('186060');
assert(numLot.guide_price === '£80,000', `numeric lot guide price parsed (got ${numLot.guide_price})`);
assert(numLot.auction_date === '2099-07-15', `numeric lot date parsed (got ${numLot.auction_date})`);

// ── Empty / garbage input never throws ──
assert(recogniseEigOasLotsFromMarkdown('', TODAY).size === 0, 'empty markdown → empty map');
assert(recogniseEigOasLotsFromMarkdown(null, TODAY).size === 0, 'null markdown → empty map');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
