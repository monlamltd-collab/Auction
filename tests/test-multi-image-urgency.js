// tests/test-multi-image-urgency.js — splitFreshByUrgency (urgency-first sweep).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { splitFreshByUrgency } = await import('../lib/pipeline/multi-image-sweep.js');

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

// today = 2026-06-21, urgencyDays = 7 -> cutoff = 2026-06-28 (inclusive)
const fresh = [
  { id: 1, auction_date: '2026-06-22' },              // urgent
  { id: 2, auction_date: '2026-06-28' },              // urgent (boundary, inclusive)
  { id: 3, auction_date: '2026-06-29' },              // rest (just past window)
  { id: 4, auction_date: null },                      // rest (undated)
  { id: 5, auction_date: '2026-06-20' },              // rest (past - guard)
  { id: 6, auction_date: '2026-06-24T00:00:00+00' },  // urgent (timestamp form tolerated)
];
const { urgent, rest } = splitFreshByUrgency(fresh, '2026-06-21', 7);
assert(urgent.map(l => l.id).join(',') === '1,2,6', `urgent = 1,2,6 (got ${urgent.map(l => l.id)})`);
assert(rest.map(l => l.id).join(',') === '3,4,5', `rest = 3,4,5 (got ${rest.map(l => l.id)})`);
assert(splitFreshByUrgency([], '2026-06-21', 7).urgent.length === 0, 'empty input -> no urgent');
assert(splitFreshByUrgency(null, '2026-06-21', 7).rest.length === 0, 'null input safe');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
