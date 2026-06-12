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
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Freshness + repair tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
