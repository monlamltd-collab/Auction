// tests/test-purplebricks-recogniser.js — Purplebricks / GOTO Properties EIG
// static-catalogue recogniser. The house broke to 0 lots mid-June (browser
// render re-hydrated + broke capture); fixed by a static ?pagesize=5000 fetch
// parsed here. Fixture mirrors the real card markdown (2 cards).

import { recognisePurplebricksGotoLotsFromMarkdown } from '../lib/pipeline/firecrawl-extract.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const MD = `
### End Time - **08 Jul 2026 12:00**

[![Primary Lot Photo](https://cdn.eigpropertyauctions.co.uk/ams/images/156/auction/0/2428200_web_medium?v=)](https://purplebricks.gotoproperties.co.uk/lot/details/169784)

[

### 11 Ravens Close, Bromley, Kent, BR2 0EL

](https://purplebricks.gotoproperties.co.uk/lot/details/169784)

#### **THE GOTO GROUP PRESENTS A 3 BEDROOM TERRACED PROPERTY IN BROMLEY - BR2**

Three bedroom mid terrace house with off street parking, garage and no onward chain.

#### Minimum Opening Bid:   **£475,000**

[View / Bid](https://purplebricks.gotoproperties.co.uk/lot/details/169784)

### End Time - **09 Jul 2026 12:00**

[![Primary Lot Photo](https://cdn.eigpropertyauctions.co.uk/ams/images/156/auction/0/2500000_web_medium?v=)](https://purplebricks.gotoproperties.co.uk/lot/details/170782)

[

### Flat 83 Copeland House, Garratt Lane, London, SW17 0NG

](https://purplebricks.gotoproperties.co.uk/lot/details/170782)

#### **A WELL PRESENTED 2 BEDROOM APARTMENT**

Modern two bedroom flat.

#### Guide Price   **£350,000**

[View / Bid](https://purplebricks.gotoproperties.co.uk/lot/details/170782)
`;

console.log('\nrecognisePurplebricksGotoLotsFromMarkdown');
{
  const lots = recognisePurplebricksGotoLotsFromMarkdown(MD);
  assert(lots.size === 2, `recovers both lots (got ${lots.size})`);

  const a = lots.get('169784');
  assert(a && a.address === '11 Ravens Close, Bromley, Kent, BR2 0EL', 'lot 1 address');
  assert(a && a.guide_price === '£475,000', `lot 1 price (got ${a && a.guide_price})`);
  assert(a && a.image_url === 'https://cdn.eigpropertyauctions.co.uk/ams/images/156/auction/0/2428200_web_medium?v=', 'lot 1 image = its own EIG photo');
  assert(a && a.property_type === 'house', `lot 1 type house (got ${a && a.property_type})`);
  assert(a && a.bedrooms === 3, `lot 1 beds 3 (got ${a && a.bedrooms})`);
  assert(a && a.detail_url === 'https://purplebricks.gotoproperties.co.uk/lot/details/169784', 'lot 1 detail url');
  assert(a && a.lot_status === 'available', 'lot 1 available');

  const b = lots.get('170782');
  assert(b && b.address === 'Flat 83 Copeland House, Garratt Lane, London, SW17 0NG', 'lot 2 address');
  assert(b && b.guide_price === '£350,000', `lot 2 price (got ${b && b.guide_price})`);
  assert(b && b.property_type === 'flat', `lot 2 type flat (got ${b && b.property_type})`);
  assert(b && b.bedrooms === 2, `lot 2 beds 2 (got ${b && b.bedrooms})`);
  // lot 2's image must be ITS OWN photo, not lot 1's (image-bleed guard).
  assert(b && b.image_url.includes('2500000'), 'lot 2 image is its own, not lot 1 bleed');
}

console.log('\nedge cases');
{
  assert(recognisePurplebricksGotoLotsFromMarkdown('').size === 0, 'empty markdown → 0 lots');
  assert(recognisePurplebricksGotoLotsFromMarkdown(null).size === 0, 'null → 0 lots');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
