/**
 * Pure-function tests for selectPruneCandidates — the decision predicate that
 * picks which lots get soft-deleted ('withdrawn') because they vanished from
 * the latest catalogue scrape. The orchestration (UPDATE statements, alert
 * inserts) is verified in production once the cron fires.
 *
 * Run: node tests/test-prune-vanished.js
 */

// Stub Supabase env so the persist-lots.js module graph doesn't error on
// import (same shim used by tests/test-first-contact.js, test-coverage-fix.js).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { selectPruneCandidates } = await import('../lib/pipeline/persist-lots.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const NOW = new Date('2026-05-10T12:00:00Z');
const day = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

function lot(id, url, status, lastSeenDaysAgo) {
  return { id, url, status, last_seen_at: day(lastSeenDaysAgo) };
}

console.log('Test 1: no existing → no candidates, ratio=1');
{
  const r = selectPruneCandidates([], new Set(['a']), NOW);
  assert(r.candidates.length === 0, 'no candidates');
  assert(r.ratio === 1, 'ratio defaults to 1 when prevCount=0');
  assert(r.blockedByRatio === false, 'not blocked');
}

console.log('\nTest 2: all existing lots present in scrape → no candidates');
{
  const existing = [lot('1', 'u1', 'available', 10), lot('2', 'u2', 'stc', 10)];
  const r = selectPruneCandidates(existing, new Set(['u1', 'u2']), NOW);
  assert(r.candidates.length === 0, 'no candidates when all matched');
  assert(r.ratio === 1, 'ratio = 1');
}

console.log('\nTest 3: vanished but within 7-day grace → no candidates');
{
  const existing = [lot('1', 'u1', 'available', 3)]; // 3 days old, grace = 7d
  const r = selectPruneCandidates(existing, new Set(), NOW);
  assert(r.candidates.length === 0, 'within grace window, not pruned');
}

console.log('\nTest 4: vanished and older than grace → prune candidate');
{
  const existing = [lot('1', 'u1', 'available', 14)]; // 14 days, > 7d grace
  const r = selectPruneCandidates(existing, new Set(['u-other']), NOW);
  assert(r.candidates.length === 1 && r.candidates[0].id === '1', 'pruned');
  assert(r.ratio === 1 / 1, 'ratio = scraped/prev = 1/1');
}

console.log('\nTest 5: vanished but status=sold → not pruned (already terminal)');
{
  const existing = [
    lot('1', 'u1', 'sold', 30),
    lot('2', 'u2', 'withdrawn', 30),
    lot('3', 'u3', 'available', 30),
  ];
  const r = selectPruneCandidates(existing, new Set(), NOW);
  assert(r.candidates.length === 1, 'only available was pruned');
  assert(r.candidates[0].id === '3', 'available row only');
}

console.log('\nTest 6: extractor failure (scraped=0, prev=27) → blocked by ratio');
{
  const existing = Array.from({ length: 27 }, (_, i) =>
    lot(`${i}`, `u${i}`, 'available', 30),
  );
  const r = selectPruneCandidates(existing, new Set(), NOW);
  assert(r.candidates.length === 27, '27 candidates collected');
  assert(r.ratio === 0, 'ratio = 0/27');
  assert(r.blockedByRatio === true, 'BLOCKED — 0% < 50% ratio gate');
}

console.log('\nTest 7: partial scrape (scraped=10, prev=20) → ratio 0.5 passes');
{
  const existing = Array.from({ length: 20 }, (_, i) =>
    lot(`${i}`, `u${i}`, 'available', 30),
  );
  const scraped = new Set(['u0','u1','u2','u3','u4','u5','u6','u7','u8','u9']);
  const r = selectPruneCandidates(existing, scraped, NOW);
  assert(r.candidates.length === 10, '10 vanished lots are candidates');
  assert(r.ratio === 0.5, 'ratio = 10/20 = 0.5');
  assert(r.blockedByRatio === false, 'exactly 0.5 ratio is NOT blocked (>= gate)');
}

console.log('\nTest 8: 30%/70% disappearance → blocked');
{
  const existing = Array.from({ length: 10 }, (_, i) =>
    lot(`${i}`, `u${i}`, 'available', 30),
  );
  const scraped = new Set(['u0', 'u1', 'u2']); // only 3 of 10
  const r = selectPruneCandidates(existing, scraped, NOW);
  assert(r.ratio === 0.3, 'ratio = 3/10');
  assert(r.blockedByRatio === true, '30% blocked');
}

console.log('\nTest 9: null/undefined safe');
{
  assert(selectPruneCandidates(null, new Set(), NOW).candidates.length === 0, 'null existing → empty');
  assert(selectPruneCandidates([], null, NOW).candidates.length === 0, 'null scraped → empty');
  assert(selectPruneCandidates(undefined, undefined, NOW).candidates.length === 0, 'all undefined → empty');
}

console.log('\nTest 10: missing fields are skipped, not crashed');
{
  const existing = [
    { id: '1', url: 'u1', status: 'available', last_seen_at: day(30) }, // ok
    { id: '2', url: 'u2', status: 'available' },                         // no last_seen_at
    { id: '3', status: 'available', last_seen_at: day(30) },             // no url
    { url: 'u4', status: 'available', last_seen_at: day(30) },           // no id
    null,                                                                 // null entry
  ];
  const r = selectPruneCandidates(existing, new Set(), NOW);
  assert(r.candidates.length === 1, 'only the well-formed row pruned');
  assert(r.candidates[0].id === '1', 'well-formed row');
}

console.log('\nTest 11: custom graceMs / ratioGate respected');
{
  const existing = [lot('1', 'u1', 'available', 2)]; // 2 days
  const r = selectPruneCandidates(existing, new Set(), NOW, { graceMs: 1 * 86400000 });
  assert(r.candidates.length === 1, '1-day grace allows pruning 2-day-old lot');
  const existing2 = [lot('1', 'u1', 'available', 30), lot('2', 'u2', 'available', 30)];
  const r2 = selectPruneCandidates(existing2, new Set(['u1']), NOW, { ratioGate: 0.8 });
  assert(r2.blockedByRatio === true, 'tighter 0.8 gate blocks 0.5 ratio');
}

console.log('\nTest 12: scrapedUrls as plain array (not Set) also accepted');
{
  const existing = [lot('1', 'u1', 'available', 30), lot('2', 'u2', 'available', 30)];
  const r = selectPruneCandidates(existing, ['u1', 'u2'], NOW);
  assert(r.candidates.length === 0, 'array of scraped URLs treated as Set');
}

console.log('\nTest 13: prevCount excludes ended/sold/withdrawn rows');
{
  const existing = [
    lot('1', 'u1', 'available', 30),
    lot('2', 'u2', 'ended', 30),
    lot('3', 'u3', 'sold', 30),
    lot('4', 'u4', 'withdrawn', 30),
    lot('5', 'u5', 'stc', 30),
    lot('6', 'u6', 'unsold', 30),
  ];
  const r = selectPruneCandidates(existing, new Set(['u1', 'u5', 'u6']), NOW);
  assert(r.prevCount === 3, 'prevCount counts only in-play (available/stc/unsold), not ended/sold/withdrawn');
  assert(r.scrapedCount === 3, 'scrapedCount = 3 URLs');
  assert(r.ratio === 1, 'ratio = 3/3 = 1 (all in-play accounted for)');
  assert(r.candidates.length === 0, 'no candidates — every in-play row is in scrape');
}

console.log('\nTest 14: edwardmellor-style — 178 ended + 1 in-play stale + 4 in scrape → prunes the 1');
{
  const existing = [
    ...Array.from({ length: 178 }, (_, i) => lot(`e${i}`, `ue${i}`, 'ended', 60)),
    lot('stale', 'uStale', 'available', 30),
    ...Array.from({ length: 4 }, (_, i) => lot(`a${i}`, `ua${i}`, 'available', 1)),
  ];
  const scraped = new Set(['ua0', 'ua1', 'ua2', 'ua3']);
  const r = selectPruneCandidates(existing, scraped, NOW);
  assert(r.prevCount === 5, `prevCount = 5 in-play (4 active + 1 stale), was ${r.prevCount}`);
  assert(r.scrapedCount === 4, 'scrapedCount = 4');
  assert(r.ratio === 0.8, `ratio = 4/5 = 0.8, got ${r.ratio}`);
  assert(r.candidates.length === 1 && r.candidates[0].id === 'stale', '1 candidate: the stale in-play row');
  assert(r.blockedByRatio === false, 'NOT blocked — 80% recall passes the 50% gate, prunes the 1 stale lot');
}

console.log('\nTest 15: venmore-style — 54 in-play stale + 1 in scrape → still blocked (correct safety behaviour)');
{
  const existing = [
    ...Array.from({ length: 54 }, (_, i) => lot(`s${i}`, `us${i}`, 'available', 30)),
    lot('fresh', 'uFresh', 'available', 1),
  ];
  const scraped = new Set(['uFresh']);
  const r = selectPruneCandidates(existing, scraped, NOW);
  assert(r.prevCount === 55, `prevCount = 55 in-play, got ${r.prevCount}`);
  assert(r.scrapedCount === 1, 'scrapedCount = 1');
  assert(Math.abs(r.ratio - (1 / 55)) < 1e-9, `ratio ≈ 1/55, got ${r.ratio}`);
  assert(r.candidates.length === 54, '54 stale in-play candidates');
  assert(r.blockedByRatio === true, 'BLOCKED — 2% recall trips the 50% gate, preserves the 54 lots');
}

console.log('\nTest 16: ratio defaults to 1 when no in-play rows exist (only history)');
{
  const existing = [
    lot('1', 'u1', 'ended', 60),
    lot('2', 'u2', 'sold', 60),
  ];
  const r = selectPruneCandidates(existing, new Set(), NOW);
  assert(r.prevCount === 0, 'prevCount = 0 (no in-play rows)');
  assert(r.ratio === 1, 'ratio defaults to 1 when prevCount=0 (no false-positive block)');
  assert(r.candidates.length === 0, 'no candidates (terminal statuses skipped)');
  assert(r.blockedByRatio === false, 'not blocked');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
