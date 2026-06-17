/**
 * Tests for (a) parseLotArray — truncation-tolerant JSON parsing for AI
 * extraction output (production 2026-06-11: responses cut at the maxTokens
 * ceiling lost whole batches), and (b) the freshness-digest Telegram
 * formatter (the automated replacement for the operator's morning SQL).
 *
 * Run: node tests/test-freshness-and-repair.js
 */

import { parseLotArray } from '../lib/scraper/extraction.js';
import { formatFreshnessDigestForTelegram } from '../lib/pipeline/freshness-digest.js';
import { isSilentScraperFailure } from '../lib/pipeline/liveness.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log('Test 1: parseLotArray — intact JSON parses strictly');
{
  const { lots, repaired } = parseLotArray('Here you go: [{"lot":1,"address":"1 High St"},{"lot":2,"address":"2 Low Rd"}]');
  assert(lots.length === 2 && repaired === false, `2 lots, not repaired (got ${lots.length}, repaired=${repaired})`);
}

console.log('\nTest 2: parseLotArray — truncated mid-object salvages complete lots');
{
  // Cut off exactly like the production failure: mid-property of lot 3.
  const truncated = '[{"lot":1,"address":"1 High St","price":100000},{"lot":2,"address":"2 Low Rd","price":90000},{"lot":3,"address":"3 Mid';
  const { lots, repaired } = parseLotArray(truncated);
  assert(lots.length === 2 && repaired === true, `salvaged the 2 complete lots (got ${lots.length}, repaired=${repaired})`);
  assert(lots[1].price === 90000, 'salvaged lot fields intact');
}

console.log('\nTest 3: parseLotArray — truncated after a complete object + comma');
{
  const truncated = '[{"lot":1,"address":"1 High St"},';
  const { lots, repaired } = parseLotArray(truncated);
  assert(lots.length === 1 && repaired === true, `trailing comma handled (got ${lots.length})`);
}

console.log('\nTest 4: parseLotArray — garbage and empties yield []');
{
  assert(parseLotArray('no json here').lots.length === 0, 'no array → []');
  assert(parseLotArray('').lots.length === 0, 'empty → []');
  assert(parseLotArray('[]').lots.length === 0, 'empty array → []');
}

console.log('\nTest 5: freshness digest formatter');
{
  const text = formatFreshnessDigestForTelegram({
    date: '2026-06-12',
    total: 12322,
    buckets: { fresh1d: 470, d1to7: 51, d7to14: 1733, stale14plus: 10068 },
    newToday: 255,
    backlogInWindow: 242,
    backlogEscaped: 0,
    extractionCalls: 473,
    hallucinationsBlocked: 2,
    extractionFailures: 0,
    crawlerRestarts: 0,
  });
  assert(/Catalogue freshness — 2026-06-12/.test(text), 'header with date');
  assert(/12,322/.test(text), 'total formatted');
  assert(/\+255 new in 24h/.test(text), 'new lots line');
  assert(/fresh <24h:\s+470\s+\(4%\)/.test(text), 'fresh bucket with percentage');
  assert(/473 extraction calls/.test(text), 'engine vitals');
  assert(/2 hallucinations blocked/.test(text), 'hallucination count shown when non-zero');
  assert(!/extraction failures/.test(text), 'zero counts omitted');
  assert(/242 awaiting sweep/.test(text), 'backlog line');
  assert(!/older than the 30d sweep window/.test(text), 'escaped-backlog warning omitted at zero');
  assert(/no silent scraper failures/.test(text), 'all-clear liveness line when none');
}

console.log('\nTest 6: silent-failure detection (the ghost-lot blind spot)');
{
  // Feed present (lots persist from prior runs) but the last run extracted 0 →
  // silent failure. This is what the DB-lot-count health check missed.
  assert(isSilentScraperFailure({ average_lot_count: 120, last_probe_result: 'error', last_extracted_count: 0 }) === true,
    'feed + last run errored → silent failure');
  assert(isSilentScraperFailure({ last_lot_count: 80, last_probe_result: 'error' }) === true,
    'last_lot_count feed + error → silent failure');
  // Healthy / non-failure cases.
  assert(isSilentScraperFailure({ average_lot_count: 120, last_probe_result: 'changed', last_extracted_count: 120 }) === false,
    'last run extracted lots → not a failure');
  assert(isSilentScraperFailure({ average_lot_count: 120, last_probe_result: 'same' }) === false,
    'changeTracking skip (unchanged) → not a failure');
  assert(isSilentScraperFailure({ average_lot_count: 0, last_probe_result: 'error' }) === false,
    'no feed (genuinely empty/new house) → not a silent failure');
  assert(isSilentScraperFailure({ average_lot_count: 120, last_probe_result: null }) === false,
    'never run since migration (null) → not flagged');
  assert(isSilentScraperFailure(null) === false, 'null skill → false');
  // Dormant houses (known between-auctions/defunct) legitimately extract 0 / all
  // terminal — they must NOT show up as silent failures even with a feed + error.
  assert(isSilentScraperFailure({ average_lot_count: 19, last_probe_result: 'error', dormant: true }) === false,
    'dormant house with feed + error → not a silent failure');
  assert(isSilentScraperFailure({ average_lot_count: 19, last_probe_result: 'error', dormant: false }) === true,
    'same house NOT dormant → still a silent failure (flag is the only difference)');
}

console.log('\nTest 7: freshness digest formatter lists silent failures');
{
  const text = formatFreshnessDigestForTelegram({
    date: '2026-06-17',
    total: 12000,
    buckets: { fresh1d: 100, d1to7: 0, d7to14: 0, stale14plus: 11900 },
    newToday: 0, backlogInWindow: 0, backlogEscaped: 0,
    extractionCalls: 50, hallucinationsBlocked: 0, extractionFailures: 6, crawlerRestarts: 0,
    silentFailures: [
      { slug: 'halls', name: 'Halls', lastGood: '2026-06-14T08:00:00Z' },
      { slug: 'tcpa', name: 'Town & Country', lastGood: null },
    ],
  });
  assert(/🛑 Silent scraper failures \(2\)/.test(text), 'silent-failure header with count');
  assert(/Halls \(last good extract 2026-06-14\)/.test(text), 'names a failing house with last-good date');
  assert(/Town & Country/.test(text), 'lists second failing house');
  assert(!/no silent scraper failures/.test(text), 'all-clear line suppressed when failures exist');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Freshness + repair tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
