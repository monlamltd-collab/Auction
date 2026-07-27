/**
 * Address quality gate — city/region shells, portfolio titles, town-county labels.
 * Run: node tests/test-address-quality.js
 */
import {
  assessLotAddress,
  isBrowseableLotAddress,
  filterBrowseableLots,
} from '../lib/quality/address-quality.js';
import { extractAllsopLotsFromJson } from '../lib/scraper/allsop.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log('reject shells');
{
  const cases = [
    ['Bristol', 'city_region_shell'],
    ['Teesside', 'city_region_shell'],
    ['Blackpool', 'city_region_shell'],
    ['Portsmouth', 'city_region_shell'],
    ['Salisbury', 'single_token_shell'],
    ['The Ace Portfolio', 'portfolio_title_shell'],
    ['North Leeds Properties Portfolio, Leeds', 'portfolio_title_shell'],
    ['LS6 HMO Portfolio, Leeds, LS6', 'portfolio_title_shell'],
    ['Dover - Kent', 'town_county_label'],
    ['Maidstone - Kent', 'town_county_label'],
    ['Canterbury Area - Kent Area', 'town_county_label'],
    ['Properties coming soon', 'placeholder'],
    ['Heathfield Area', 'town_county_label'],
  ];
  for (const [addr, expectReason] of cases) {
    const v = assessLotAddress(addr);
    assert(v.ok === false, `reject ${addr} (got ${v.reason})`);
    if (expectReason) assert(v.reason === expectReason, `${addr} reason=${v.reason} expect=${expectReason}`);
  }
}

console.log('\nallow real addresses');
{
  const ok = [
    '10 Redcliffe Parade East, Redcliffe, Bristol, BS1 6SW',
    '85 St. Johns Lane, Bedminster, Bristol, BS3 5AB',
    'Land at Mill Lade, Linwood, Renfrewshire',
    'Plot at Balridgeburn, Dunfermline',
    'The Glen Bar and Restaurant, Carradale',
    'Unit 4, Industrial Estate, Coventry',
    'Manor Farm, Somewhere',
    ['Bristol', { postcode: 'BS1 6SW' }], // postcode opts rescues city if ever paired
  ];
  for (const item of ok) {
    const addr = Array.isArray(item) ? item[0] : item;
    const opts = Array.isArray(item) ? item[1] : {};
    const v = assessLotAddress(addr, opts);
    // Bristol + postcode only — still city shell text; postcode alone shouldn't
    // make "Bristol" a street. Expect reject unless we change policy.
    if (addr === 'Bristol') {
      assert(v.ok === false, 'Bristol + postcode still shell (need street)');
      continue;
    }
    assert(v.ok === true, `allow ${addr} (got ${v.reason})`);
  }
  assert(isBrowseableLotAddress('12 High Street, Dover, Kent') === true, 'high street dover');
}

console.log('\nfilterBrowseableLots');
{
  const lots = [
    { address: 'Bristol', price: 8000000 },
    { address: '10 High Street, Bath, BA1 1AA', postcode: 'BA1 1AA' },
    { address: 'Dover - Kent', price: 180000 },
    { address: 'The Ace Portfolio' },
  ];
  const { kept, dropped } = filterBrowseableLots(lots);
  assert(kept.length === 1, 'one kept');
  assert(dropped.length === 3, 'three dropped');
  assert(kept[0].address.includes('High Street'), 'kept high street');
}

console.log('\nAllsop JSON extract drops shells');
{
  const page = {
    page: 1,
    html: JSON.stringify({
      data: {
        results: [
          {
            reference: 'CP00010',
            allsop_address: 'Bristol',
            price: '8000000.00',
            property_types: ['Houses'],
          },
          {
            reference: 'RP00116',
            allsop_address: 'Teesside',
            price: '3500000.00',
            property_types: ['Houses'],
          },
          {
            reference: 'CI00235',
            allsop_address: 'The Ace Portfolio',
            price: null,
            property_types: ['Commercial'],
          },
          {
            reference: 'RP00103',
            allsop_address: 'North Leeds Properties Portfolio, Leeds',
            price: '5650000.00',
          },
          {
            reference: 'R12345',
            allsop_address: '10 Redcliffe Parade East, Bristol',
            postcode: 'BS1 6SW',
            price: '550000.00',
            property_types: ['Houses'],
            image_file_id: 'abc',
          },
        ],
      },
    }),
  };
  const lots = extractAllsopLotsFromJson([page]);
  assert(lots.length === 1, `only real lot kept (got ${lots.length})`);
  assert(/Redcliffe/.test(lots[0].address), 'kept redcliffe');
  assert(!lots.some((l) => /^(Bristol|Teesside)$|Ace Portfolio|North Leeds Properties Portfolio/i.test(l.address)), 'shells gone');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
