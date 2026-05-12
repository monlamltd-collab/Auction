/**
 * Pure-function tests for lib/pipeline/recall.js (Move 3 Phase 3c).
 *
 * Run: node tests/test-recall.js
 */

import { computeRecall, summariseRecall } from '../lib/pipeline/recall.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log('Test 1: computeRecall — identical sets → 1.0');
{
  const urls = ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'];
  assert(computeRecall(urls, urls) === 1, 'identical → 1.0');
}

console.log('\nTest 2: computeRecall — 80% retained → 0.8');
{
  const prev = ['a', 'b', 'c', 'd', 'e'];
  const current = ['a', 'b', 'c', 'd', 'f']; // dropped e, added f
  const r = computeRecall(prev, current);
  assert(Math.abs(r - 0.8) < 1e-9, `expected 0.8, got ${r}`);
}

console.log('\nTest 3: computeRecall — empty prev → 1.0 (no prior to fail)');
{
  assert(computeRecall([], ['x', 'y']) === 1, 'empty prev → 1.0');
  assert(computeRecall(null, ['x']) === 1, 'null prev → 1.0');
  assert(computeRecall(undefined, ['x']) === 1, 'undefined prev → 1.0');
}

console.log('\nTest 4: computeRecall — total collapse → 0');
{
  assert(computeRecall(['a', 'b', 'c'], []) === 0, 'no overlap → 0');
  assert(computeRecall(['a', 'b'], ['c', 'd']) === 0, 'disjoint → 0');
}

console.log('\nTest 5: computeRecall — Set vs Array input');
{
  const r1 = computeRecall(new Set(['a', 'b']), ['b', 'c']);
  const r2 = computeRecall(['a', 'b'], new Set(['b', 'c']));
  assert(r1 === 0.5, `Set→Array recall (got ${r1})`);
  assert(r2 === 0.5, `Array→Set recall (got ${r2})`);
}

console.log('\nTest 6: computeRecall — only counts intersection denominator (additions are ignored)');
{
  // Prev = 3, current adds 7 new URLs but keeps all 3 → recall still 1.0.
  // Recall isn't a "Jaccard" — it's specifically prev-keep ratio.
  const prev = ['a', 'b', 'c'];
  const current = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  assert(computeRecall(prev, current) === 1, 'growing catalogue retains 100% of prev');
}

console.log('\nTest 7: summariseRecall — multi-auction aggregation');
{
  const pairs = [
    { auction_id: 'a', recall: 1.0 },
    { auction_id: 'b', recall: 0.5 },
    { auction_id: 'c', recall: 0.8 },
    { auction_id: 'd', recall: 0.95 },
    { auction_id: 'e', recall: 0.02 }, // venmore-style problem child
  ];
  const s = summariseRecall(pairs);
  assert(s.count === 5, 'count = 5');
  assert(Math.abs(s.averageRecall - 0.654) < 1e-3, `avg ≈ 0.654 (got ${s.averageRecall})`);
  assert(s.minRecall === 0.02, 'min = 0.02');
  assert(s.maxRecall === 1.0, 'max = 1.0');
  assert(s.medianRecall === 0.8, `median = 0.8 (got ${s.medianRecall})`);
  assert(s.worst[0].auction_id === 'e', 'worst[0] = the 0.02 auction');
  assert(s.worst.length <= 5, 'worst capped at worstN');
}

console.log('\nTest 8: summariseRecall — empty input');
{
  const s = summariseRecall([]);
  assert(s.count === 0, 'count = 0');
  assert(s.averageRecall === 1, 'avg defaults to 1 when empty');
  assert(s.worst.length === 0, 'worst = []');
}

console.log('\nTest 9: summariseRecall — single auction');
{
  const s = summariseRecall([{ auction_id: 'x', recall: 0.75 }]);
  assert(s.count === 1, 'count = 1');
  assert(s.averageRecall === 0.75, 'avg = 0.75');
  assert(s.medianRecall === 0.75, 'median = 0.75 (single value)');
  assert(s.worst[0].recall === 0.75, 'worst includes the single entry');
}

console.log('\nTest 10: summariseRecall — even number of pairs → median is mean of two middles');
{
  const s = summariseRecall([
    { auction_id: 'a', recall: 0.1 },
    { auction_id: 'b', recall: 0.3 },
    { auction_id: 'c', recall: 0.7 },
    { auction_id: 'd', recall: 0.9 },
  ]);
  assert(Math.abs(s.medianRecall - 0.5) < 1e-9, `median = (0.3+0.7)/2 = 0.5 (got ${s.medianRecall})`);
}

console.log('\nTest 11: summariseRecall — worstN respected');
{
  const pairs = Array.from({ length: 20 }, (_, i) => ({ auction_id: `a${i}`, recall: i / 20 }));
  const s = summariseRecall(pairs, { worstN: 3 });
  assert(s.worst.length === 3, 'worst capped at 3');
  assert(s.worst[0].recall === 0, 'worst[0] is the lowest (0/20)');
  assert(s.worst[2].recall === 0.1, 'worst[2] is 2/20 = 0.1');
}

console.log('\nTest 12: summariseRecall — filters out malformed entries');
{
  const s = summariseRecall([
    { auction_id: 'a', recall: 0.5 },
    null,
    { auction_id: 'b' }, // no recall
    { auction_id: 'c', recall: 'not a number' },
    { auction_id: 'd', recall: 0.9 },
  ]);
  assert(s.count === 2, 'count = 2 (malformed filtered)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
