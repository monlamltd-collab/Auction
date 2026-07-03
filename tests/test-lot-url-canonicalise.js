// tests/test-lot-url-canonicalise.js — Defends the 2026-07-03 duplicate-lots
// fixes. lots.url is the upsert conflict key, so every URL variant a house
// emits for the same lot mints a duplicate row users see twice:
//   * hollismorgan appended list-navigation params (?page=1&bid=11…) to
//     /property-details/ hrefs depending on how the render reached the lot;
//   * venmore served www and bare-host hrefs interchangeably;
//   * robinsonhall's auction VENUE persisted as a "lot" once per
//     /auction/<date>/ event URL.
// canonicaliseLotUrl runs at persist so the conflict key is render-stable;
// isEventPageUrl drops event pages before they become rows.
import { canonicaliseLotUrl, UNSTABLE_LOT_URL_HOUSES } from '../lib/houses.js';
import { isEventPageUrl } from '../lib/scraper/validation.js';

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  if (actual === expected) { console.log(`✓ ${label}`); pass++; }
  else { console.log(`✗ ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); fail++; }
};

// ── canonicaliseLotUrl ──

// hollismorgan: the path uniquely identifies the lot — the whole query is
// list-navigation state and is stripped (real prod variant from the incident).
check('hollismorgan query stripped',
  canonicaliseLotUrl('https://www.hollismorgan.co.uk/property-details/34771431/bristol-city/bristol/bath-road-3?page=1&bid=11&showstc=on&orderby=lot_no+asc&extra_2%21=501%2C502', 'hollismorgan'),
  'https://www.hollismorgan.co.uk/property-details/34771431/bristol-city/bristol/bath-road-3');
check('hollismorgan bare host gains www AND loses query',
  canonicaliseLotUrl('https://hollismorgan.co.uk/property-details/34771431/x?page=1', 'hollismorgan'),
  'https://www.hollismorgan.co.uk/property-details/34771431/x');
check('hollismorgan clean url unchanged',
  canonicaliseLotUrl('https://www.hollismorgan.co.uk/property-details/34771437/bristol-city/bristol/bath-road-4', 'hollismorgan'),
  'https://www.hollismorgan.co.uk/property-details/34771437/bristol-city/bristol/bath-road-4');

// venmore: host aligned to the HOUSE_ROOTS host (www); the query is lot
// identity on this house and is KEPT.
check('venmore bare host aligned to www, query kept',
  canonicaliseLotUrl('https://venmoreauctions.co.uk/Property-Details?property_reference=AUC260227', 'venmore'),
  'https://www.venmoreauctions.co.uk/Property-Details?property_reference=AUC260227');
check('venmore www host unchanged',
  canonicaliseLotUrl('https://www.venmoreauctions.co.uk/Property-Details?property_reference=4', 'venmore'),
  'https://www.venmoreauctions.co.uk/Property-Details?property_reference=4');

// Tracking params are never identity — stripped on any house; real params
// kept. (Host also aligns to the HOUSE_ROOTS www form — that applies to
// every configured house, not just the incident ones.)
check('tracking params stripped, real params kept',
  canonicaliseLotUrl('https://pattinson.co.uk/lot/123?utm_source=x&utm_campaign=y&ref=99', 'pattinson'),
  'https://www.pattinson.co.uk/lot/123?ref=99');

// Fragments are never identity.
check('hash dropped',
  canonicaliseLotUrl('https://pattinson.co.uk/lot/123#gallery', 'pattinson'),
  'https://www.pattinson.co.uk/lot/123');

// Foreign domains for a configured house are left alone (defensive).
check('foreign domain untouched',
  canonicaliseLotUrl('https://example-other.com/lot/1', 'venmore'),
  'https://example-other.com/lot/1');

// Robustness: synthetic keys and junk pass through untouched.
check('synthetic key passes through',
  canonicaliseLotUrl('__synthetic__venmore__60_moss_lane__135000', 'venmore'),
  '__synthetic__venmore__60_moss_lane__135000');
check('null returns null', canonicaliseLotUrl(null, 'venmore'), null);
check('garbage returns input', canonicaliseLotUrl('not a url', 'venmore'), 'not a url');

// The unstable-URL set drives the persist-side property-key merge guard.
check('venmore is flagged unstable', UNSTABLE_LOT_URL_HOUSES.has('venmore'), true);

// ── isEventPageUrl ──
check('robinsonhall event url detected',
  isEventPageUrl('https://www.robinsonandhallauctions.co.uk/auction/05-08-2026/'), true);
check('event url without trailing slash detected',
  isEventPageUrl('https://x.co.uk/auctions/14-10-2026'), true);
check('event url with query detected',
  isEventPageUrl('https://x.co.uk/auction/17-02-2027/?src=nav'), true);
check('real lot url not flagged',
  isEventPageUrl('https://www.allsop.co.uk/lot-overview/stepney-lane-newcastle/RI00055'), false);
check('lot slug beyond the date not flagged',
  isEventPageUrl('https://x.co.uk/auction/05-08-2026/lot-12-high-street/'), false);
check('null not flagged', isEventPageUrl(null), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
