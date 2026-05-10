/**
 * Phantom-lot sweeper — pure-function tests.
 *
 * The orchestration layer (Supabase queries, chunked UPDATE) is checked
 * by hand once the cron fires in production. The pure selectPhantomLots()
 * predicate is the load-bearing piece: if it stops detecting placeholder
 * addresses, the daily backstop silently does nothing.
 *
 * Run: node tests/test-phantom-lot-sweep.js
 */

import { selectPhantomLots } from '../lib/pipeline/phantom-lot-sweep.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const realLot = {
  id: 'real-1',
  house: 'allsop',
  address: '12 Acacia Avenue, Bristol, BS1 1AB',
};

const phantomCases = [
  { id: 'p-add', address: 'Add to calendar' },
  { id: 'p-vv', address: 'Virtual Viewing' },
  { id: 'p-share', address: 'Share auction' },
  { id: 'p-save', address: 'Save search' },
  { id: 'p-reg', address: 'Register' },
  { id: 'p-look', address: 'Looking to bid' },
  { id: 'p-next', address: 'Next auction' },
  { id: 'p-bed', address: 'A three bedroom semi-detached house' },
  { id: 'p-lot', address: 'Lot 14' },
];

console.log('Test 1: real addresses with postcode are kept');
assert(selectPhantomLots([realLot]).length === 0, 'real address with postcode passes');

console.log('\nTest 2: each placeholder phrase is rejected');
for (const c of phantomCases) {
  const out = selectPhantomLots([c]);
  assert(out.length === 1, `phantom address "${c.address}" detected`);
}

console.log('\nTest 3: short / empty / nullish addresses are rejected');
{
  const lots = [
    { id: 'short', address: 'abc' },
    { id: 'empty', address: '' },
    { id: 'nullish', address: null },
    { id: 'wrong-type', address: 12345 },
  ];
  assert(selectPhantomLots(lots).length === 4, 'all four invalid rows flagged');
}

console.log('\nTest 4: mixed input — only phantoms returned');
{
  const lots = [
    realLot,
    { id: 'p1', address: 'Add to calendar' },
    { id: 'real-2', address: '4 Penn Lane, Birmingham, B1 2AB' },
    { id: 'p2', address: 'Virtual Viewing' },
  ];
  const out = selectPhantomLots(lots);
  assert(out.length === 2, '2 phantoms among 4');
  assert(out.every(o => o.id.startsWith('p')), 'only phantoms returned');
}

console.log('\nTest 5: nullish input is handled safely');
assert(selectPhantomLots(null).length === 0, 'null → empty');
assert(selectPhantomLots(undefined).length === 0, 'undefined → empty');
assert(selectPhantomLots('not-an-array').length === 0, 'string → empty');

console.log('\nTest 6: ignores rows with no address field');
{
  const out = selectPhantomLots([{ id: 'x', house: 'foo' }]);
  assert(out.length === 1, 'row with missing address treated as phantom');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
