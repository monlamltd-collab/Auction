/**
 * Lot date consensus (Task 8)
 * Run: node tests/test-lot-date-consensus.js
 */
import {
  computeLotDateConsensus,
  shouldLiftConsensusToCalendar,
  isLotConsensusLiftEnabled,
  DEFAULT_MIN_LOTS,
} from '../lib/pipeline/lot-date-consensus.js';
import { isSanelyNearFutureDate } from '../lib/utils/auction-date-parse.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const TODAY = '2026-07-25';

function lotsWith(date, n, extra = []) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push({ auction_date: date, url: `https://x/lot/${i}` });
  return arr.concat(extra);
}

console.log('sanity date');
assert(isSanelyNearFutureDate('2026-08-01', { todayIso: TODAY }) === true, 'near ok');
assert(isSanelyNearFutureDate('2030-08-01', { todayIso: TODAY }) === false, 'far reject');
assert(isSanelyNearFutureDate('2099-12-31', { todayIso: TODAY }) === false, 'sentinel reject');

console.log('\nmajority');
{
  const lots = lotsWith('2026-09-15', 10, [
    { auction_date: '2026-10-01' },
    { auction_date: '2026-10-01' },
  ]);
  const c = computeLotDateConsensus(lots, {
    todayIso: TODAY,
    catalogueUrl: 'https://house.example/catalogue',
  });
  assert(c.ok === true, 'ok majority');
  assert(c.majorityDate === '2026-09-15', 'date');
  assert(c.majorityCount === 10, 'count 10');
  assert(c.ratio >= 0.7, `ratio ${c.ratio}`);
}

console.log('\ninsufficient');
{
  const c = computeLotDateConsensus(lotsWith('2026-09-15', 3), {
    todayIso: TODAY,
    catalogueUrl: 'https://x',
  });
  assert(c.ok === false && c.reason === 'insufficient_lots', 'need min lots');
  assert(DEFAULT_MIN_LOTS === 8, 'default 8');
}

console.log('\nno majority');
{
  const lots = [
    ...lotsWith('2026-09-01', 5),
    ...lotsWith('2026-10-01', 5),
  ];
  const c = computeLotDateConsensus(lots, { todayIso: TODAY, catalogueUrl: 'https://x' });
  assert(c.ok === false, 'split no majority');
}

console.log('\nlift decision');
{
  const consensus = {
    ok: true,
    majorityDate: '2026-09-15',
    catalogueUrl: 'https://house.example/cat',
  };
  const dark = shouldLiftConsensusToCalendar(consensus, [], { todayIso: TODAY });
  assert(dark.lift === true, 'lift dark');

  const ready = shouldLiftConsensusToCalendar(consensus, [
    { status: 'upcoming', date: '2026-09-15', catalogue_ready: true, url: 'https://house.example/cat' },
  ], { todayIso: TODAY });
  assert(ready.lift === false, 'skip already ready');

  const otherUrl = shouldLiftConsensusToCalendar(consensus, [
    { status: 'upcoming', date: '2026-09-15', catalogue_ready: false, url: 'https://old' },
  ], { todayIso: TODAY });
  assert(otherUrl.lift === true, 'can fix not-ready');
}

console.log('\nflag default on');
assert(isLotConsensusLiftEnabled({}) === true, 'default on');
assert(isLotConsensusLiftEnabled({ LOT_DATE_CONSENSUS_LIFT_ENABLED: 'true' }) === true, 'on');
assert(isLotConsensusLiftEnabled({ LOT_DATE_CONSENSUS_LIFT_ENABLED: 'false' }) === false, 'off');
assert(isLotConsensusLiftEnabled({ LOT_DATE_CONSENSUS_LIFT_ENABLED: '0' }) === false, '0 off');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
