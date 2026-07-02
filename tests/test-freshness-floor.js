/**
 * Pure-function tests for the Phase-1 freshness/coverage guarantees:
 *   - isPastAttemptFloor / attemptFloorHours (lib/pipeline/scheduling.js) —
 *     the queue-side attempt floor that boosts houses not ATTEMPTED in >48h
 *     past the adaptive backoff gate.
 *   - computeUnscheduledHouses (lib/pipeline/scheduling.js) — the silent-drop
 *     guardrail's set diff (active houses absent from the scrape queue).
 *   - pickCatalogueReadyRescues (lib/pipeline/calendar-sync.js) — the
 *     dated-row catalogue_ready rescue for houses with no schedulable row
 *     (the mchughandco/bondwolfe silent-drop class, 2026-06-28).
 *
 * Run: node tests/test-freshness-floor.js
 */

// Stub Supabase env so the calendar-sync.js module graph (via persist-lots.js)
// doesn't error on import (same shim as tests/test-single-cal-fallback.js).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { isPastAttemptFloor, attemptFloorHours, computeUnscheduledHouses } =
  await import('../lib/pipeline/scheduling.js');
const { pickCatalogueReadyRescues } = await import('../lib/pipeline/calendar-sync.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-06-28T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * HOUR_MS).toISOString();

console.log('Test 1: isPastAttemptFloor');
{
  assert(isPastAttemptFloor(null, NOW) === false, 'null skill → false (never-scraped boost covers new houses)');
  assert(isPastAttemptFloor(undefined, NOW) === false, 'undefined skill → false');
  assert(isPastAttemptFloor({ last_probe_at: null }, NOW) === true, 'row exists but never attempted → true');
  assert(isPastAttemptFloor({ last_probe_at: hoursAgo(1) }, NOW) === false, 'attempted 1h ago → false');
  assert(isPastAttemptFloor({ last_probe_at: hoursAgo(47) }, NOW) === false, 'attempted 47h ago → false (inside default 48h floor)');
  assert(isPastAttemptFloor({ last_probe_at: hoursAgo(49) }, NOW) === true, 'attempted 49h ago → true (past default floor)');
  assert(isPastAttemptFloor({ last_probe_at: hoursAgo(360) }, NOW) === true, 'attempted 15d ago → true');
  assert(isPastAttemptFloor({ last_probe_at: hoursAgo(30) }, NOW, 24) === true, 'custom 24h floor: 30h ago → true');
  assert(isPastAttemptFloor({ last_probe_at: hoursAgo(30) }, NOW, 36) === false, 'custom 36h floor: 30h ago → false');
}

console.log('\nTest 2: attemptFloorHours env override');
{
  const prev = process.env.FRESHNESS_FLOOR_HOURS;
  delete process.env.FRESHNESS_FLOOR_HOURS;
  assert(attemptFloorHours() === 48, 'default → 48');
  process.env.FRESHNESS_FLOOR_HOURS = '24';
  assert(attemptFloorHours() === 24, 'env 24 → 24');
  process.env.FRESHNESS_FLOOR_HOURS = '0';
  assert(attemptFloorHours() === 48, 'env 0 (invalid) → default 48');
  process.env.FRESHNESS_FLOOR_HOURS = 'nonsense';
  assert(attemptFloorHours() === 48, 'env non-numeric → default 48');
  if (prev === undefined) delete process.env.FRESHNESS_FLOOR_HOURS;
  else process.env.FRESHNESS_FLOOR_HOURS = prev;
}

console.log('\nTest 3: computeUnscheduledHouses');
{
  const out = computeUnscheduledHouses({
    rootSlugs: ['alpha', 'bravo', 'charlie', 'delta', 'echo'],
    retiredSlugs: new Set(['bravo']),
    dormantSlugs: new Set(['charlie']),
    scheduledSlugs: new Set(['alpha']),
  });
  assert(JSON.stringify(out) === JSON.stringify(['delta', 'echo']), 'drops scheduled/retired/dormant, keeps + sorts silent-drops');

  const none = computeUnscheduledHouses({
    rootSlugs: ['alpha'],
    retiredSlugs: new Set(),
    dormantSlugs: new Set(),
    scheduledSlugs: new Set(['alpha']),
  });
  assert(none.length === 0, 'fully-scheduled → empty');

  const all = computeUnscheduledHouses({
    rootSlugs: ['a', 'b'],
    retiredSlugs: new Set(),
    dormantSlugs: new Set(),
    scheduledSlugs: new Set(),
  });
  assert(JSON.stringify(all) === JSON.stringify(['a', 'b']), 'empty queue → every active house flagged');
}

console.log('\nTest 4: pickCatalogueReadyRescues');
{
  const TODAY = '2026-06-28';
  const ROOTS = {
    mchughandco: 'https://mchughandco.com/current-auction',
    bondwolfe: 'https://www.bondwolfe.com/auctions/properties/',
    markjenkinson: 'https://www.markjenkinson.co.uk/',
    readyhouse: 'https://readyhouse.example/auctions',
    retiredco: 'https://retiredco.example/auctions',
  };
  const RETIRED = new Set(['retiredco']);

  // The mchughandco shape: only row is dated upcoming, ready=false, URL == root.
  const mchugh = { id: 1, house_slug: 'mchughandco', status: 'upcoming', date: '2026-06-30', catalogue_ready: false, url: 'https://mchughandco.com/current-auction' };
  // www/trailing-slash variant of the root must still match via normaliseUrl.
  const mchughWww = { id: 2, house_slug: 'mchughandco', status: 'upcoming', date: '2026-07-30', catalogue_ready: false, url: 'https://www.mchughandco.com/current-auction/' };
  // The bondwolfe shape: URL is a bespoke marketing page, NOT the root → alert-only, no rescue.
  const bondwolfe = { id: 3, house_slug: 'bondwolfe', status: 'upcoming', date: '2026-07-09', catalogue_ready: false, url: 'https://bondwolfe.com/property-auctions-west-midlands/upcoming-property-auctions-jul' };
  // The markjenkinson shape: merged rows are deliberately parked — never rescued.
  const merged = { id: 4, house_slug: 'markjenkinson', status: 'merged', date: '2099-12-31', catalogue_ready: false, url: 'https://markjenkinson.co.uk' };
  // Past-dated upcoming row → stale, not rescued.
  const past = { id: 5, house_slug: 'mchughandco', status: 'upcoming', date: '2026-05-13', catalogue_ready: false, url: 'https://mchughandco.com/current-auction' };
  // House that already has a ready row → untouched even though a matching row exists.
  const readyA = { id: 6, house_slug: 'readyhouse', status: 'always_on', date: '2099-12-31', catalogue_ready: true, url: 'https://readyhouse.example/auctions' };
  const readyB = { id: 7, house_slug: 'readyhouse', status: 'upcoming', date: '2026-07-01', catalogue_ready: false, url: 'https://readyhouse.example/auctions' };
  // Retired house → skipped.
  const retired = { id: 8, house_slug: 'retiredco', status: 'upcoming', date: '2026-07-01', catalogue_ready: false, url: 'https://retiredco.example/auctions' };
  // always_on rows are the realign pass's job, never this one's.
  const alwaysOnNotReady = { id: 9, house_slug: 'bondwolfe', status: 'always_on', date: '2099-12-31', catalogue_ready: false, url: 'https://www.bondwolfe.com/auctions/properties/' };

  const rows = [mchugh, mchughWww, bondwolfe, merged, past, readyA, readyB, retired, alwaysOnNotReady];
  const out = pickCatalogueReadyRescues({ rows, houseRoots: ROOTS, retiredHouses: RETIRED, todayStr: TODAY });
  const ids = out.map(r => r.id).sort((a, b) => a - b);

  assert(ids.includes(1), 'rescues the mchughandco dated row (URL == canonical root, future date, no ready row)');
  assert(ids.includes(2), 'www/trailing-slash variant of root still matches (normaliseUrl both sides)');
  assert(!ids.includes(3), 'bespoke per-auction URL (bondwolfe marketing page) NOT rescued — guardrail alert covers it');
  assert(!ids.includes(4), 'merged rows never rescued');
  assert(!ids.includes(5), 'past-dated rows never rescued');
  assert(!ids.includes(6) && !ids.includes(7), 'house with an existing ready row untouched');
  assert(!ids.includes(8), 'retired house skipped');
  assert(!ids.includes(9), 'always_on rows left to the realign pass');
  assert(JSON.stringify(ids) === JSON.stringify([1, 2]), `exactly the two safe rescues (got ${JSON.stringify(ids)})`);

  // repairedSlugs: a slug fixed by the realign pass this run is skipped.
  const out2 = pickCatalogueReadyRescues({ rows: [mchugh], houseRoots: ROOTS, retiredHouses: RETIRED, repairedSlugs: new Set(['mchughandco']), todayStr: TODAY });
  assert(out2.length === 0, 'slug repaired by the always_on realign pass this run is skipped');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
