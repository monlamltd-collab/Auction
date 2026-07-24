/**
 * Pins sale-format / lifecycle rules for traditional vs MMOA catalogues.
 * Run: node tests/test-sale-format.js
 */
import {
  SENTINEL_AUCTION_DATE,
  isSentinelDate,
  isRealAuctionDate,
  effectiveAuctionDate,
  deriveSaleFormat,
  deriveLifecycle,
  enrichLotsWithSaleFormat,
  lifecyclePill,
} from '../lib/sale-format.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const TODAY = '2026-07-24';

console.log('sentinel / real date guards');
assert(isSentinelDate(SENTINEL_AUCTION_DATE), '2099-12-31 is sentinel');
assert(isSentinelDate('2099-01-01'), 'any >2098 is sentinel');
assert(!isSentinelDate('2026-08-01'), 'normal date is not sentinel');
assert(isRealAuctionDate('2026-08-01'), 'real auction date');
assert(!isRealAuctionDate(SENTINEL_AUCTION_DATE), 'sentinel is not real');
assert(effectiveAuctionDate(SENTINEL_AUCTION_DATE) === null, 'effective nulls sentinel');
assert(effectiveAuctionDate('2026-08-01') === '2026-08-01', 'effective keeps real date');

console.log('\\nsale_format');
assert(deriveSaleFormat({ calendarStatus: 'always_on' }) === 'mmoa', 'always_on → mmoa');
assert(deriveSaleFormat({ auctionDate: SENTINEL_AUCTION_DATE }) === 'mmoa', 'sentinel date → mmoa');
assert(deriveSaleFormat({ auctionDate: '2026-08-26' }) === 'traditional', 'real date → traditional');
assert(deriveSaleFormat({ auctionDate: null, lotStatus: 'available', assumeAvailableNullIsMmoa: true }) === 'mmoa',
  'null available + assume → mmoa');
assert(deriveSaleFormat({ auctionDate: null }) === 'unknown', 'null alone → unknown');

console.log('\\nlifecycle — traditional');
assert(deriveLifecycle({ status: 'available', _saleFormat: 'traditional', _auctionDate: '2026-08-01' }, TODAY) === 'live',
  'future available → live');
assert(deriveLifecycle({ status: 'available', _saleFormat: 'traditional', _auctionDate: '2026-06-01' }, TODAY) === 'passed_in_play',
  'past available stays passed_in_play (NOT forced finished)');
assert(deriveLifecycle({ status: 'unsold', _saleFormat: 'traditional', _auctionDate: '2026-06-01' }, TODAY) === 'passed_in_play',
  'past unsold → passed_in_play');
assert(deriveLifecycle({ status: 'sold', _saleFormat: 'traditional', _auctionDate: '2026-06-01' }, TODAY) === 'finished',
  'sold → finished');
assert(deriveLifecycle({ status: 'withdrawn', _saleFormat: 'traditional', _auctionDate: null }, TODAY) === 'finished',
  'withdrawn → finished');

console.log('\\nlifecycle — mmoa');
assert(deriveLifecycle({ status: 'available', _saleFormat: 'mmoa', _auctionDate: null }, TODAY) === 'live',
  'mmoa available → live (never passed-by-date)');
assert(deriveLifecycle({ status: 'sold', _saleFormat: 'mmoa', _auctionDate: null }, TODAY) === 'finished',
  'mmoa sold → finished');
assert(deriveLifecycle({ status: 'available', _saleFormat: 'mmoa', _auctionDate: '2020-01-01' }, TODAY) === 'live',
  'mmoa ignores faux past date for lifecycle');

console.log('\\nenrichLotsWithSaleFormat');
{
  const lots = [
    { status: 'available', _auctionDate: SENTINEL_AUCTION_DATE, _sourceUrl: 'https://ex/a' },
    { status: 'available', _auctionDate: '2026-06-01', _sourceUrl: 'https://ex/b' },
    { status: 'available', _auctionDate: '2026-08-01', _sourceUrl: 'https://ex/c' },
    { status: 'sold', _auctionDate: '2026-06-01', _sourceUrl: 'https://ex/d' },
  ];
  const cal = new Map([
    ['https://ex/a', { status: 'always_on' }],
  ]);
  enrichLotsWithSaleFormat(lots, { today: TODAY, calendarByUrl: cal });
  assert(lots[0]._saleFormat === 'mmoa' && lots[0]._auctionDate === null && lots[0]._lifecycle === 'live',
    'sentinel lot classified mmoa live + date nulled');
  assert(lots[1]._saleFormat === 'traditional' && lots[1]._lifecycle === 'passed_in_play',
    'past available stays in-play (key hunt mode)');
  assert(lots[2]._lifecycle === 'live' && lots[2]._saleFormat === 'traditional',
    'future traditional live');
  assert(lots[3]._lifecycle === 'finished', 'sold finished');
}

console.log('\\nlifecycle pills');
{
  const p1 = lifecyclePill({ status: 'available', _saleFormat: 'mmoa', _lifecycle: 'live' }, TODAY);
  assert(p1 && /Modern Method/i.test(p1.text), 'mmoa live pill');
  const p2 = lifecyclePill({ status: 'available', _saleFormat: 'traditional', _lifecycle: 'passed_in_play', _auctionDate: '2026-06-01' }, TODAY);
  assert(p2 && /still listed/i.test(p2.text), 'passed still-listed pill');
}

console.log(`\\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
