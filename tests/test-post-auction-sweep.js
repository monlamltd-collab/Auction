/**
 * Post-auction-sweep — pure-function tests.
 *
 * Covers the fair-share round-robin so a single big-catalogue auction
 * (e.g. TCPA on 2026-04-29 with 227 lots) can't starve smaller houses
 * (Hollis Morgan, Cottons, etc.) out of the daily SWEEP_BATCH_LIMIT.
 *
 * The url_dead → unsold heuristic is exercised live once the cron fires
 * with the URL_DEAD_UNSOLD_DAYS env knob; the orchestration layer that
 * wires it up is checked by reading the source.
 *
 * Run: node tests/test-post-auction-sweep.js
 */

// Stub env vars before lib/supabase.js loads (post-auction-sweep imports it
// transitively; supabase-js throws "supabaseUrl is required" at module load
// otherwise). The orchestration layer is what needs the real client — the
// pure fair-share function we exercise here doesn't. Static ESM imports are
// hoisted, so we use a dynamic import() AFTER the env is set.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const { fairShareByHouse } = await import('../lib/pipeline/post-auction-sweep.js');

let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); pass++; }
  else { console.error(`  FAIL: ${msg}`); fail++; }
}

console.log('Test 1: empty / nullish input');
{
  assert(fairShareByHouse([], 100).length === 0, 'empty array → empty output');
  assert(fairShareByHouse(null, 100).length === 0, 'null → empty output');
  assert(fairShareByHouse(undefined, 100).length === 0, 'undefined → empty output');
}

console.log('\nTest 2: single house — preserves order, respects limit');
{
  const cands = Array.from({ length: 200 }, (_, i) => ({ id: 'a' + i, house: 'tcpa' }));
  const out = fairShareByHouse(cands, 100);
  assert(out.length === 100, 'capped at limit');
  assert(out[0].id === 'a0' && out[99].id === 'a99', 'preserves input order within house');
}

console.log('\nTest 3: TCPA-starvation regression — round-robin with one big house + many small');
{
  // Reproduces the production state on 2026-05-10: TCPA had 227 candidates,
  // Hollis Morgan / Cottons / etc. each had 16-38, and the old auction_date-DESC
  // ordering let TCPA consume the entire 100-lot budget.
  const cands = [
    ...Array.from({ length: 227 }, (_, i) => ({ id: 'tcpa-' + i, house: 'tcpa' })),
    ...Array.from({ length: 38 },  (_, i) => ({ id: 'hm-' + i,   house: 'hollismorgan' })),
    ...Array.from({ length: 16 },  (_, i) => ({ id: 'co-' + i,   house: 'cottons' })),
    ...Array.from({ length: 16 },  (_, i) => ({ id: 'al-' + i,   house: 'auctionhouselondon' })),
  ];
  const out = fairShareByHouse(cands, 100);
  assert(out.length === 100, 'fills budget exactly');
  const byHouse = out.reduce((acc, l) => { acc[l.house] = (acc[l.house] || 0) + 1; return acc; }, {});
  assert(byHouse.hollismorgan > 0, 'Hollis Morgan gets at least 1 slot');
  assert(byHouse.cottons > 0, 'Cottons gets at least 1 slot');
  assert(byHouse.auctionhouselondon > 0, 'Auction House London gets at least 1 slot');
  // The headline win: TCPA used to consume the entire 100-lot budget. After
  // round-robin it gets at most ~34 (16 from the first 16 rounds of 4-way
  // sharing, then 18 from the 2-way sharing after Cottons + AHL exhaust at
  // 16 each). Fair-share isn't strictly 100/N when houses have unequal
  // sizes — small ones drop out and their slots redistribute to the big ones.
  assert(byHouse.tcpa < 227, `TCPA no longer hogs all candidates — got ${byHouse.tcpa}`);
  assert(byHouse.tcpa <= 40, `TCPA capped well below its 227 — got ${byHouse.tcpa}`);
  assert(byHouse.cottons === 16 && byHouse.auctionhouselondon === 16,
    'small houses get fully drained when their candidates fit (no starvation)');
  assert(byHouse.hollismorgan >= 25,
    `Hollis Morgan no longer starved — got ${byHouse.hollismorgan} of 38`);
}

console.log('\nTest 4: small candidate pool — returns all without padding');
{
  const cands = [
    { id: 'a', house: 'h1' },
    { id: 'b', house: 'h2' },
    { id: 'c', house: 'h1' },
  ];
  const out = fairShareByHouse(cands, 100);
  assert(out.length === 3, 'returns all 3 when pool < limit');
  // Round-robin order: h1 first (a), h2 next (b), h1 again (c)
  assert(out[0].id === 'a' && out[1].id === 'b' && out[2].id === 'c',
    'round-robin order preserved');
}

console.log('\nTest 5: lot with missing house lands in __unknown__ bucket');
{
  const cands = [
    { id: '1' },                         // no house
    { id: '2', house: 'h1' },
    { id: '3', house: null },            // null house
    { id: '4', house: 'h1' },
  ];
  const out = fairShareByHouse(cands, 4);
  assert(out.length === 4, 'all 4 picked');
  // Both __unknown__ rows should appear; bucket counts roughly equal
  const unknownCount = out.filter(l => !l.house).length;
  assert(unknownCount === 2, 'unknown-house rows preserved (not dropped)');
}

console.log('\nTest 6: source wiring — url_dead → unsold heuristic in place');
{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', 'lib', 'pipeline', 'post-auction-sweep.js'), 'utf8');
  assert(/URL_DEAD_UNSOLD_THRESHOLD_DAYS/.test(src),
    'threshold constant declared');
  assert(/inferUnsold/.test(src),
    'inferUnsold flag computed in url_dead branch');
  assert(/process\.env\.URL_DEAD_UNSOLD_DAYS/.test(src),
    'env override hook for testing the threshold');
  assert(/'status_updated',\s*'url_dead'/.test(src),
    'persistOutcome accepts url_dead as a status-flipping outcome');
  assert(/->unsold \(url_dead\)/.test(src),
    'transition counter labels the heuristic separately from genuine source updates');
}

console.log('\nTest 7: wall-clock budget replaces tight row-count cap');
{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', 'lib', 'pipeline', 'post-auction-sweep.js'), 'utf8');
  assert(/SWEEP_WALL_CLOCK_MS\s*=\s*30 \* 60_000/.test(src),
    'wall-clock budget set to 30 minutes (the actual safety guard)');
  assert(/SWEEP_BATCH_LIMIT\s*=\s*1500/.test(src),
    'batch limit raised to 1500 — typical daily pool fits, no 4-day backlog');
  assert(/wallClockBailed/.test(src),
    'stats track wallClockBailed so dashboards can spot when the budget runs out');
  assert(/wall-clock budget reached/.test(src),
    'log entry when the loop bails early so the cause is debuggable');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
