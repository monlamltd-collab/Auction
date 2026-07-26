// tests/test-purplebricks-recogniser.js — Purplebricks / GOTO Properties EIG
// static-catalogue recogniser. The house broke to 0 lots mid-June (browser
// render re-hydrated + broke capture); fixed by a static ?pagesize=5000 fetch
// parsed here. Fixture mirrors the real card markdown (2 cards).

import { recognisePurplebricksGotoLotsFromMarkdown } from '../lib/pipeline/firecrawl-extract.js';
import { HOUSE_RECOGNISERS } from '../lib/scraper/house-recognisers.js';
import { HOUSE_ROOTS } from '../lib/houses.js';
import { FALLBACK_CALENDAR } from '../lib/calendar.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const MD = `
### End Time - **08 Aug 2026 12:00**

[![Primary Lot Photo](https://cdn.eigpropertyauctions.co.uk/ams/images/156/auction/0/2428200_web_medium?v=)](https://purplebricks.gotoproperties.co.uk/lot/details/169784)

[

### 11 Ravens Close, Bromley, Kent, BR2 0EL

](https://purplebricks.gotoproperties.co.uk/lot/details/169784)

#### **THE GOTO GROUP PRESENTS A 3 BEDROOM TERRACED PROPERTY IN BROMLEY - BR2**

Three bedroom mid terrace house with off street parking, garage and no onward chain.

#### Minimum Opening Bid:   **£475,000**

[View / Bid](https://purplebricks.gotoproperties.co.uk/lot/details/169784)

### End Time - **09 Aug 2026 12:00**

[![Primary Lot Photo](https://cdn.eigpropertyauctions.co.uk/ams/images/156/auction/0/2500000_web_medium?v=)](https://purplebricks.gotoproperties.co.uk/lot/details/170782)

[

### Flat 83 Copeland House, Garratt Lane, London, SW17 0NG

](https://purplebricks.gotoproperties.co.uk/lot/details/170782)

#### **A WELL PRESENTED 2 BEDROOM APARTMENT**

Modern two bedroom flat.

#### Guide Price   **£350,000**

[View / Bid](https://purplebricks.gotoproperties.co.uk/lot/details/170782)

### End Time - **10 Aug 2026 12:00**

[![Primary Lot Photo](https://cdn.eigpropertyauctions.co.uk/ams/images/156/auction/0/2600000_web_medium?v=6/1/2026 10:02:50 AM)](https://purplebricks.gotoproperties.co.uk/lot/details/c3339e64-2406-46d1-b39a-91eb0eed2fb7)

[

### 22 Current Street, Bristol, BS1 1AA

](https://purplebricks.gotoproperties.co.uk/lot/details/c3339e64-2406-46d1-b39a-91eb0eed2fb7)

#### **A TWO BEDROOM CITY APARTMENT**

#### Guide Price **£210,000**

[View / Bid](https://purplebricks.gotoproperties.co.uk/lot/details/c3339e64-2406-46d1-b39a-91eb0eed2fb7)

### Auction Ended - **01 Jul 2026 12:00**

[

### 9 Ended Road, Leeds, LS1 1AA

](https://purplebricks.gotoproperties.co.uk/lot/details/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee)

#### **A SOLD TERRACED HOUSE**

#### Result: **Sold**

[View Result](https://purplebricks.gotoproperties.co.uk/lot/details/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee)
`;

console.log('\nrecognisePurplebricksGotoLotsFromMarkdown');
{
  const lots = recognisePurplebricksGotoLotsFromMarkdown(MD);
  assert(lots.size === 3, `recovers only live numeric and UUID lots (got ${lots.size})`);

  const a = lots.get('169784');
  assert(a && a.address === '11 Ravens Close, Bromley, Kent, BR2 0EL', 'lot 1 address');
  assert(a && a.guide_price === '£475,000', `lot 1 price (got ${a && a.guide_price})`);
  assert(a && a.image_url === 'https://cdn.eigpropertyauctions.co.uk/ams/images/156/auction/0/2428200_web_medium', 'lot 1 image = its own EIG photo');
  assert(a && a.property_type === 'house', `lot 1 type house (got ${a && a.property_type})`);
  assert(a && a.bedrooms === 3, `lot 1 beds 3 (got ${a && a.bedrooms})`);
  assert(a && a.detail_url === 'https://purplebricks.gotoproperties.co.uk/lot/details/169784', 'lot 1 detail url');
  assert(a && a.lot_status === 'available', 'lot 1 available');
  assert(a && a.auction_date === '2026-08-08', `lot 1 real auction date (got ${a && a.auction_date})`);

  const b = lots.get('170782');
  assert(b && b.address === 'Flat 83 Copeland House, Garratt Lane, London, SW17 0NG', 'lot 2 address');
  assert(b && b.guide_price === '£350,000', `lot 2 price (got ${b && b.guide_price})`);
  assert(b && b.property_type === 'flat', `lot 2 type flat (got ${b && b.property_type})`);
  assert(b && b.bedrooms === 2, `lot 2 beds 2 (got ${b && b.bedrooms})`);
  // lot 2's image must be ITS OWN photo, not lot 1's (image-bleed guard).
  assert(b && b.image_url.includes('2500000'), 'lot 2 image is its own, not lot 1 bleed');

  const uuidLive = lots.get('c3339e64-2406-46d1-b39a-91eb0eed2fb7');
  assert(uuidLive && uuidLive.address === '22 Current Street, Bristol, BS1 1AA', 'UUID lot address');
  assert(uuidLive && uuidLive.guide_price === '£210,000', 'UUID lot price');
  assert(uuidLive && uuidLive.lot_status === 'available', 'live UUID remains available');
  assert(uuidLive && uuidLive.auction_date === '2026-08-10', 'live UUID carries its end date');
  assert(uuidLive && uuidLive.image_url.endsWith('/2600000_web_medium'), 'live UUID preserves EIG image with a spaced cache query');
  assert(uuidLive && uuidLive.description === 'A TWO BEDROOM CITY APARTMENT', `live UUID preserves its source descriptor (got ${uuidLive && uuidLive.description})`);
  assert(uuidLive && uuidLive.bullets.includes('A TWO BEDROOM CITY APARTMENT'), 'live UUID preserves descriptor as a useful bullet');

  const uuidEnded = lots.get('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert(!uuidEnded, 'ended UUID is dropped rather than persisted as available');
}

console.log('\nedge cases');
{
  assert(recognisePurplebricksGotoLotsFromMarkdown('').size === 0, 'empty markdown → 0 lots');
  assert(recognisePurplebricksGotoLotsFromMarkdown(null).size === 0, 'null → 0 lots');
}

console.log('\nrecall sentinel');
{
  const sentinel = HOUSE_RECOGNISERS.purplebricksgoto.recallSentinelPattern;
  sentinel.lastIndex = 0;
  assert(sentinel.test('https://purplebricks.gotoproperties.co.uk/lot/details/c3339e64-2406-46d1-b39a-91eb0eed2fb7'), 'recall sentinel counts UUID lot IDs');
}

console.log('\nfull archive configuration');
{
  // The deterministic recogniser must receive the complete EIG archive and
  // then filter it down to affirmative-live cards. A 48-card fetch can contain
  // only ended/result cards and produce a false zero-lot scrape.
  assert(new URL(HOUSE_ROOTS.purplebricksgoto).searchParams.get('pagesize') === '5000',
    'house root requests the complete Purplebricks archive');
  const purpleCalendar = FALLBACK_CALENDAR.find(a => a.houseSlug === 'purplebricksgoto');
  assert(new URL(purpleCalendar?.url).searchParams.get('pagesize') === '5000',
    'fallback calendar requests the complete Purplebricks archive');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
