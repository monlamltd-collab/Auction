/**
 * Pure-function tests for adaptive scheduling helpers
 * (lib/pipeline/scheduling.js). The Supabase writer (recordScrapeOutcome)
 * is covered by integration smoke; this file only exercises the math.
 *
 * Run: node tests/test-adaptive-scheduling.js
 */

import {
  intervalForCount,
  computeScheduleUpdate,
  isEligibleNow,
  _internals,
} from '../lib/pipeline/scheduling.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-05-12T09:00:00Z');

console.log('Test 1: intervalForCount backoff curve');
{
  assert(intervalForCount(0) === 6 * HOUR, 'count=0 → 6h');
  assert(intervalForCount(1) === 12 * HOUR, 'count=1 → 12h');
  assert(intervalForCount(2) === 24 * HOUR, 'count=2 → 24h');
  assert(intervalForCount(3) === 48 * HOUR, 'count=3 → 48h');
  assert(intervalForCount(4) === 96 * HOUR, 'count=4 → 96h');
  assert(intervalForCount(5) === 168 * HOUR, 'count=5 → 168h (weekly cap)');
  assert(intervalForCount(99) === 168 * HOUR, 'count=99 → 168h (clamped to weekly)');
  assert(intervalForCount(-1) === 6 * HOUR, 'negative count clamped to 0 → 6h');
  assert(intervalForCount(null) === 6 * HOUR, 'null count clamped to 0 → 6h');
  assert(intervalForCount(undefined) === 6 * HOUR, 'undefined count clamped to 0 → 6h');
}

console.log('\nTest 2: computeScheduleUpdate — first ever scrape, result=same');
{
  const patch = computeScheduleUpdate({}, 'same', NOW);
  assert(patch.consecutive_same_count === 1, 'count increments to 1');
  assert(patch.last_probe_result === 'same', 'result recorded');
  assert(patch.last_probe_at === NOW.toISOString(), 'probe stamp = now');
  assert(patch.last_full_extract_at === null, 'no full extract happened');
  // count=1 → 12h
  const expected = new Date(NOW.getTime() + 12 * HOUR).toISOString();
  assert(patch.next_scrape_at === expected, `next_scrape_at = now + 12h (got ${patch.next_scrape_at})`);
}

console.log('\nTest 3: computeScheduleUpdate — result=changed resets counter and stamps full extract');
{
  const prev = { consecutive_same_count: 4, last_full_extract_at: new Date(NOW.getTime() - 5 * 24 * HOUR).toISOString() };
  const patch = computeScheduleUpdate(prev, 'changed', NOW);
  assert(patch.consecutive_same_count === 0, 'count reset to 0');
  assert(patch.last_probe_result === 'changed', 'result recorded');
  assert(patch.last_full_extract_at === NOW.toISOString(), 'last_full_extract_at stamped now');
  const expected = new Date(NOW.getTime() + 6 * HOUR).toISOString();
  assert(patch.next_scrape_at === expected, 'next_scrape_at = now + 6h (volatile interval)');
}

console.log('\nTest 4: computeScheduleUpdate — result=error preserves counter, 1h retry');
{
  const prev = { consecutive_same_count: 3, last_full_extract_at: new Date(NOW.getTime() - 1 * 24 * HOUR).toISOString() };
  const patch = computeScheduleUpdate(prev, 'error', NOW);
  assert(patch.consecutive_same_count === 3, 'count preserved');
  assert(patch.last_probe_result === 'error', 'error recorded');
  assert(patch.last_full_extract_at === prev.last_full_extract_at, 'full extract stamp preserved');
  const expected = new Date(NOW.getTime() + 1 * HOUR).toISOString();
  assert(patch.next_scrape_at === expected, 'next_scrape_at = now + 1h (error retry)');
}

console.log('\nTest 5: freshness floor — never let interval push beyond last_full_extract_at + 7d');
{
  // Last full extract 6 days ago. Counter=5 wants 168h (7d) from now → that's 13d after extract.
  // Floor: extract + 7d = 1 day from now. So next_scrape_at should be in 1 day.
  const prev = {
    consecutive_same_count: 5,
    last_full_extract_at: new Date(NOW.getTime() - 6 * 24 * HOUR).toISOString(),
  };
  const patch = computeScheduleUpdate(prev, 'same', NOW);
  const floorMs = new Date(prev.last_full_extract_at).getTime() + 7 * 24 * HOUR;
  assert(new Date(patch.next_scrape_at).getTime() === floorMs, 'clamped to extract + 7d, not now + 168h');
  assert(patch.consecutive_same_count === 6, 'count still increments to 6');
}

console.log('\nTest 6: freshness floor — no clamp when interval fits inside the floor');
{
  // Last full extract 1 hour ago. Counter=0 → next count=1 → 12h interval.
  // Floor: extract + 7d ≈ 167h from now. 12h is well under floor → no clamp.
  const prev = {
    consecutive_same_count: 0,
    last_full_extract_at: new Date(NOW.getTime() - 1 * HOUR).toISOString(),
  };
  const patch = computeScheduleUpdate(prev, 'same', NOW);
  const expected = new Date(NOW.getTime() + 12 * HOUR).toISOString();
  assert(patch.next_scrape_at === expected, 'no clamp; next = now + 12h (count=1)');
}

console.log('\nTest 7: computeScheduleUpdate — null/undefined prev safely defaults');
{
  const p1 = computeScheduleUpdate(null, 'same', NOW);
  assert(p1.consecutive_same_count === 1, 'null prev → count=1 after same');
  const p2 = computeScheduleUpdate(undefined, 'changed', NOW);
  assert(p2.consecutive_same_count === 0, 'undefined prev → count=0 after changed');
  const p3 = computeScheduleUpdate({ consecutive_same_count: null }, 'same', NOW);
  assert(p3.consecutive_same_count === 1, 'null count field treated as 0');
}

console.log('\nTest 8: computeScheduleUpdate — unknown result throws');
{
  let threw = false;
  try { computeScheduleUpdate({}, 'weird', NOW); } catch (e) { threw = e instanceof Error; }
  assert(threw, 'unknown result throws Error');
}

console.log('\nTest 9: isEligibleNow — no schedule means eligible');
{
  assert(isEligibleNow(null, NOW) === true, 'null skill row → eligible');
  assert(isEligibleNow({}, NOW) === true, 'empty skill row → eligible');
  assert(isEligibleNow({ next_scrape_at: null }, NOW) === true, 'null next_scrape_at → eligible');
}

console.log('\nTest 10: isEligibleNow — future schedule means not eligible');
{
  const future = new Date(NOW.getTime() + 1 * HOUR).toISOString();
  const past = new Date(NOW.getTime() - 1 * HOUR).toISOString();
  assert(isEligibleNow({ next_scrape_at: future }, NOW) === false, 'future next_scrape_at → not eligible');
  assert(isEligibleNow({ next_scrape_at: past }, NOW) === true, 'past next_scrape_at → eligible');
  assert(isEligibleNow({ next_scrape_at: NOW.toISOString() }, NOW) === true, 'exact now → eligible (inclusive)');
}

console.log('\nTest 11: Internals exported for visibility');
{
  assert(Array.isArray(_internals.BACKOFF_HOURS), 'BACKOFF_HOURS array exposed');
  assert(_internals.FRESHNESS_FLOOR_MS === 7 * 24 * HOUR, 'freshness floor = 7d');
  assert(_internals.CHANGED_INTERVAL_MS === 6 * HOUR, 'changed interval = 6h');
  assert(_internals.ERROR_RETRY_MS === 1 * HOUR, 'error retry = 1h');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
