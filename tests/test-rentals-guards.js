// tests/test-rentals-guards.js — locks the contract for the two
// defence-in-depth guards added on top of the rental scraper:
//   1. applySanityFilters — drops listings with implausible rent/beds
//      (catches sibling-card bleed, OCR-style typos, deposit refs).
//   2. shouldFireRegression — decides whether a (postcode, source) drop
//      from N → ≤1 deserves a pipeline_alerts row.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { applySanityFilters, shouldFireRegression } = await import('../lib/rentals/index.js');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

console.log('\napplySanityFilters: rent bounds');
{
  const listings = [
    { source_id: '1', rent_pcm: 950, beds: 1 },     // ok
    { source_id: '2', rent_pcm: 199, beds: 1 },     // too low (< 200)
    { source_id: '3', rent_pcm: 200, beds: 1 },     // boundary — keep
    { source_id: '4', rent_pcm: 20000, beds: 5 },   // boundary high — keep
    { source_id: '5', rent_pcm: 20001, beds: 5 },   // too high (> 20000)
    { source_id: '6', rent_pcm: 0, beds: 1 },       // zero — reject
    { source_id: '7', rent_pcm: -100, beds: 1 },    // negative — reject
    { source_id: '8', rent_pcm: 'not-a-number', beds: 1 }, // NaN — reject
  ];
  const { kept, rejected } = applySanityFilters(listings);
  const keptIds = kept.map(l => l.source_id).sort();
  assert(JSON.stringify(keptIds) === JSON.stringify(['1', '3', '4']),
    `keeps only listings with rent in [200, 20000]; got [${keptIds.join(',')}]`);
  assert(rejected.length === 5, `rejects 5 listings (got ${rejected.length})`);
  assert(rejected.every(r => r.reason === 'rent_out_of_range'),
    'all rent-bound rejections tagged with reason=rent_out_of_range');
}

console.log('\napplySanityFilters: bed bounds');
{
  const listings = [
    { source_id: 'a', rent_pcm: 1500, beds: 3 },     // ok
    { source_id: 'b', rent_pcm: 1500, beds: 10 },    // boundary — keep
    { source_id: 'c', rent_pcm: 1500, beds: 11 },    // too high
    { source_id: 'd', rent_pcm: 1500, beds: null },  // missing beds — keep
    { source_id: 'e', rent_pcm: 1500 },              // no beds field — keep
  ];
  const { kept, rejected } = applySanityFilters(listings);
  const keptIds = kept.map(l => l.source_id).sort();
  assert(JSON.stringify(keptIds) === JSON.stringify(['a', 'b', 'd', 'e']),
    `keeps listings with beds<=10 or null; got [${keptIds.join(',')}]`);
  assert(rejected.length === 1 && rejected[0].reason === 'beds_too_high',
    'rejects beds=11 with reason=beds_too_high');
}

console.log('\napplySanityFilters: empty + odd inputs');
{
  assert(applySanityFilters([]).kept.length === 0, 'empty array → empty kept');
  assert(applySanityFilters([]).rejected.length === 0, 'empty array → empty rejected');
}

console.log('\nshouldFireRegression: baseline cases');
{
  // No baseline → never alert
  assert(!shouldFireRegression(null, 0), 'no prior baseline → no alert');
  assert(!shouldFireRegression(null, 10), 'no prior even with healthy current → no alert');

  // Baseline too thin → never alert (could be a one-off)
  assert(!shouldFireRegression(0, 0), 'prev=0 → no alert');
  assert(!shouldFireRegression(3, 0), 'prev=3 (below MIN=5) → no alert');
  assert(!shouldFireRegression(4, 0), 'prev=4 (below MIN=5) → no alert');

  // Healthy baseline + healthy current → no alert
  assert(!shouldFireRegression(10, 10), 'steady 10 → no alert');
  assert(!shouldFireRegression(10, 5), 'modest drop 10→5 → no alert');
  assert(!shouldFireRegression(10, 2), 'drop to 2 (above MAX=1) → no alert');

  // The actual regression cases: prev≥5, current≤1
  assert(shouldFireRegression(5, 0), 'prev=5 → 0 → ALERT');
  assert(shouldFireRegression(5, 1), 'prev=5 → 1 → ALERT');
  assert(shouldFireRegression(20, 0), 'prev=20 → 0 → ALERT');
  assert(shouldFireRegression(100, 1), 'prev=100 → 1 → ALERT');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
