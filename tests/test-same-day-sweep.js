/**
 * Same-day-sweep — locks the targeting invariants by source inspection.
 *
 * The orchestration layer (fetchLotPage + Supabase queries) is checked live
 * once the cron fires; the pure helper (todayUkDate) is exercised directly.
 * Source-level regex checks lock the bits that distinguish same-day-sweep
 * from post-auction-sweep — drop the 24h floor, exact-match today's date,
 * skip the url_dead → unsold inference. Drift on any of those and the
 * sweep loses its purpose.
 *
 * Run: node tests/test-same-day-sweep.js
 */

// Stub env vars before lib/supabase.js loads — same shim as the other tests.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); pass++; }
  else { console.error(`  FAIL: ${msg}`); fail++; }
}

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'lib', 'pipeline', 'same-day-sweep.js'), 'utf8');

console.log('Test 1: targeting — auction_date = today, no 24h floor');
{
  // post-auction-sweep uses `.gte(auction_date, ...).lte(auction_date, ...)`
  // to exclude today (MIN_AGE 24h). same-day-sweep MUST use exact-match on
  // today's date instead.
  assert(/\.eq\(['"]auction_date['"],\s*today\)/.test(src),
    "candidate query uses .eq('auction_date', today)");
  assert(!/POST_AUCTION_MIN_AGE_HOURS/.test(src),
    'no 24h MIN_AGE floor — that was the post-auction-sweep gap we are closing');
  assert(/\.in\(['"]status['"],\s*\[['"]available['"]\s*,\s*['"]unsold['"]\]\)/.test(src),
    "targets in-play statuses ('available', 'unsold')");
}

console.log('\nTest 2: no unsold inference on dead URLs');
{
  // post-auction-sweep infers 'unsold' when a URL goes dead 3+ days after the
  // auction. Same-day-sweep MUST NOT do that — today is far too early to draw
  // that conclusion. The url_dead branch updates last_seen_at only.
  assert(!/inferUnsold/.test(src),
    'no inferUnsold flag — that heuristic only makes sense post-auction');
  assert(!/URL_DEAD_UNSOLD/.test(src),
    'no url_dead threshold constants');
}

console.log('\nTest 3: budget tunables sized for daily one-shot');
{
  assert(/SWEEP_WALL_CLOCK_MS\s*=\s*15 \* 60_000/.test(src),
    'wall-clock budget = 15 minutes (half of post-auction-sweep)');
  assert(/SWEEP_COOLDOWN_HOURS\s*=\s*6/.test(src),
    'cooldown = 6 hours (shorter than post-auction-sweep) — daily one-shot');
  assert(/SWEEP_BATCH_LIMIT\s*=\s*500/.test(src),
    'batch limit = 500 — today\'s cohort is much smaller than 30-day backlog');
}

console.log('\nTest 4: status flip emits lot_events with same-day-sweep source');
{
  assert(/eventType:\s*LOT_EVENT_TYPES\.STATUS_CHANGED/.test(src),
    'emits lot_status_changed event');
  assert(/scraper_version:\s*['"]same-day-sweep['"]/.test(src),
    "source.scraper_version = 'same-day-sweep'");
  assert(/writer:\s*['"]same-day-sweep\.persistOutcome['"]/.test(src),
    "source.writer = 'same-day-sweep.persistOutcome'");
  assert(/scrape_id:\s*null/.test(src),
    'scrape_id is null (no catalogue scrape backs this writer)');
}

console.log('\nTest 5: timezone correctness — Europe/London for the date bucket');
{
  // Critical: this sweep runs in the UK evening, by which time UTC is the
  // next day. Comparing against UTC `new Date()` would target tomorrow's
  // auctions. todayUkDate() must use Europe/London.
  assert(/timeZone:\s*['"]Europe\/London['"]/.test(src),
    "todayUkDate uses { timeZone: 'Europe/London' }");
  assert(/en-CA/.test(src),
    "uses 'en-CA' locale (yields native YYYY-MM-DD format)");
}

console.log('\nTest 6: reuses fair-share from post-auction-sweep (no duplicate impl)');
{
  assert(/from ['"]\.\/post-auction-sweep\.js['"]/.test(src),
    'imports fairShareByHouse from post-auction-sweep.js');
  assert(/fairShareByHouse\(rawCandidates,\s*SWEEP_BATCH_LIMIT\)/.test(src),
    'applies fair-share to the candidate pool');
}

console.log('\nTest 7: fireAlert summary, info severity (hygiene, not failure)');
{
  assert(/type:\s*['"]same_day_sweep['"]/.test(src),
    "alert type = 'same_day_sweep'");
  assert(/severity:\s*['"]info['"]/.test(src),
    "severity = 'info' — hygiene event, not a failure");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
