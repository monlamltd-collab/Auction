// tests/test-auctionhouselondon-recogniser.js — recogniseAuctionHouseLondonLotsFromMarkdown.
//
// Auction House London rebuilt on a Next.js + EIG-AMS (account 20) template that
// the auctionhouse.co.uk franchise recogniser (AH_CARD_RE) does NOT match. Its
// ~96-lot /current-auction page can token-undercount via the AI extractor, so a
// deterministic recogniser recovers every card. Fixtures are the REAL turndown
// markdown verified live 2026-06-14 (htmlToRecognitionMarkdown of /current-auction).

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { recogniseAuctionHouseLondonLotsFromMarkdown } = await import('../lib/pipeline/firecrawl-extract.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const CARD1 = `[![82 Harley Road, Harlesden, London, NW10 8AX](https://cdn.eigpropertyauctions.co.uk/ams/images/20/auction/3472/2705923_web_medium)

LOT 1

Guide Price: £375,000+

](https://auctionhouselondon.co.uk/lot/82-harley-road-harlesden-london-nw10-8ax-349500)

TerracedFreehold

82 Harley Road, Harlesden, London, NW10 8AX

A Vacant Six Room Mid Terrace House

[](https://auctionhouselondon.co.uk/lot/82-harley-road-harlesden-london-nw10-8ax-349500)[Next Viewing: Mon 15th Jun](data:text/calendar)`;

const CARD2 = `[![101 Welbeck Road, Harrow, Middlesex, HA2 0RU](https://cdn.eigpropertyauctions.co.uk/ams/images/20/auction/3472/2709448_web_medium)

LOT 2

Guide Price: £300,000+

](https://auctionhouselondon.co.uk/lot/101-welbeck-road-harrow-middlesex-ha2-0ru-349644)

Semi-DetachedFreehold

101 Welbeck Road, Harrow, Middlesex, HA2 0RU

A Vacant Three Bedroom Semi Detached House Potential for Rear Extension (Subject to Obtaining all Relevant Consents)

[](https://auctionhouselondon.co.uk/lot/101-welbeck-road-harrow-middlesex-ha2-0ru-349644)`;

const CARD3 = `[![28A Highcroft Avenue, Wembley, Middlesex, HA0 1TG](https://cdn.eigpropertyauctions.co.uk/ams/images/20/auction/3472/2707776_web_medium)

LOT 3

Guide Price: £100,000+

](https://auctionhouselondon.co.uk/lot/28a-highcroft-avenue-wembley-middlesex-ha0-1tg-349491)

FlatLeasehold

28A Highcroft Avenue, Wembley, Middlesex, HA0 1TG

A Vacant First Floor Three Room Flat`;

console.log('Test 1: parses all three lots, keyed by trailing numeric id');
// Page header carries the sale date ("All Lots for 24th-25th June 2026") — the
// recogniser must stamp it on every lot (the /current-auction calendar is stale).
const PAGE = 'All Lots for 24th-25th June 2026 | Auction House London\n\n' + [CARD1, CARD2, CARD3].join('\n\n');
const map = recogniseAuctionHouseLondonLotsFromMarkdown(PAGE);
assert(map instanceof Map && map.size === 3, `Map of 3 (got ${map.size})`);

console.log('\nTest 2: lot 1 fields (Terraced/Freehold house, guide, eig image, status)');
const a = map.get('349500');
assert(!!a, 'keyed by id 349500');
assert(a && a.address === '82 Harley Road, Harlesden, London, NW10 8AX', `address (got "${a?.address}")`);
assert(a && a.guide_price === '£375,000', `guide_price strips the + (got "${a?.guide_price}")`);
assert(a && a.lot_number === '1', `lot_number (got "${a?.lot_number}")`);
assert(a && a.property_type === 'house', `Terraced → house (got "${a?.property_type}")`);
assert(a && a.tenure === 'Freehold', `tenure (got "${a?.tenure}")`);
assert(a && a.image_url.includes('/ams/images/20/'), `EIG image (got "${a?.image_url}")`);
assert(a && a.detail_url.endsWith('-349500'), 'detail_url captured');
assert(a && a.auction_date === '2026-06-25', `auction_date = last day of the header range (got "${a?.auction_date}")`);
assert(a && a.lot_status === 'available', `available (got "${a?.lot_status}")`);

console.log('\nTest 3: lot 2 — Semi-Detached house, beds from description');
const b = map.get('349644');
assert(b && b.guide_price === '£300,000', `guide_price (got "${b?.guide_price}")`);
assert(b && b.property_type === 'house', `Semi-Detached → house (got "${b?.property_type}")`);
assert(b && b.bedrooms === 3, `3 bedrooms from "Three Bedroom" (got ${b?.bedrooms})`);

console.log('\nTest 4: lot 3 — Flat/Leasehold; "Three Room" is NOT bedrooms');
const c = map.get('349491');
assert(c && c.property_type === 'flat', `Flat → flat (got "${c?.property_type}")`);
assert(c && c.tenure === 'Leasehold', `tenure (got "${c?.tenure}")`);
assert(c && c.bedrooms === null, `"Three Room" ≠ bedrooms (got ${c?.bedrooms})`);

console.log('\nTest 5: dedup by id + junk-safe');
assert(recogniseAuctionHouseLondonLotsFromMarkdown(CARD1 + '\n\n' + CARD1).size === 1, 'same lot twice → 1');
assert(recogniseAuctionHouseLondonLotsFromMarkdown('').size === 0, 'empty → 0');
assert(recogniseAuctionHouseLondonLotsFromMarkdown(null).size === 0, 'null → 0');
assert(recogniseAuctionHouseLondonLotsFromMarkdown('[![X](https://e.com/i.jpg)\n\n](https://example.com/lot/x-1)').size === 0, 'non-AHL host → 0');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
