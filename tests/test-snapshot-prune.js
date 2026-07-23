/**
 * Pure-function tests for the Move 3 Phase 3b snapshot-diff prune logic.
 *
 * Run: node tests/test-snapshot-prune.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  selectPruneCandidatesFromSnapshot,
  detectScrapeRegression,
  flipPruneCandidates,
  PRUNE_RETIRE_STATUSES,
  _internals,
} from '../lib/pipeline/prune-from-snapshot.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-05-13T12:00:00Z');

// Build a stub existingLot with sensible defaults for the in_play + past-grace tests.
function lot(url, overrides = {}) {
  return {
    id: `id-${url}`,
    url,
    status: 'available',
    last_seen_at: new Date(NOW.getTime() - 10 * DAY).toISOString(), // 10 days ago, past 7-day grace
    ...overrides,
  };
}

console.log('Test 1: vanished URLs in_play + past grace → candidates');
{
  const prev = ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'];
  const current = ['https://a.com/2']; // 1 and 3 vanished
  const existing = [lot('https://a.com/1'), lot('https://a.com/2'), lot('https://a.com/3')];
  const r = selectPruneCandidatesFromSnapshot({ prevUrlSet: prev, currentUrlSet: current, existingLots: existing, now: NOW });
  assert(r.candidates.length === 2, `2 candidates (got ${r.candidates.length})`);
  const ids = r.candidates.map(c => c.id).sort();
  assert(ids.join(',') === 'id-https://a.com/1,id-https://a.com/3', 'right ids picked');
  assert(r.vanishedCount === 2, 'vanishedCount = 2');
  assert(r.prevCount === 3, 'prevCount = 3');
  assert(r.currentCount === 1, 'currentCount = 1');
  assert(Math.abs(r.ratio - (1/3)) < 1e-9, `ratio ≈ 1/3 (got ${r.ratio})`);
}

console.log('\nTest 2: vanished URL with terminal status → NOT a candidate');
{
  const prev = ['https://a.com/1', 'https://a.com/2'];
  const current = [];
  const existing = [
    lot('https://a.com/1', { status: 'withdrawn' }),
    lot('https://a.com/2', { status: 'sold' }),
  ];
  const r = selectPruneCandidatesFromSnapshot({ prevUrlSet: prev, currentUrlSet: current, existingLots: existing, now: NOW });
  assert(r.candidates.length === 0, 'no candidates (both already terminal)');
  assert(r.vanishedCount === 2, 'vanishedCount still 2 (raw diff count)');
}

console.log('\nTest 3: vanished URL within grace window → NOT a candidate');
{
  const prev = ['https://a.com/1'];
  const current = [];
  const existing = [
    lot('https://a.com/1', { last_seen_at: new Date(NOW.getTime() - 3 * DAY).toISOString() }), // 3 days ago, within 7d grace
  ];
  const r = selectPruneCandidatesFromSnapshot({ prevUrlSet: prev, currentUrlSet: current, existingLots: existing, now: NOW });
  assert(r.candidates.length === 0, 'within grace → not pruned');
}

console.log('\nTest 4: vanished URL with custom grace → respects override');
{
  const prev = ['https://a.com/1'];
  const current = [];
  const existing = [
    lot('https://a.com/1', { last_seen_at: new Date(NOW.getTime() - 3 * DAY).toISOString() }),
  ];
  // 1-day grace → 3-day-old lot is past it
  const r = selectPruneCandidatesFromSnapshot({ prevUrlSet: prev, currentUrlSet: current, existingLots: existing, now: NOW, graceMs: 1 * DAY });
  assert(r.candidates.length === 1, 'custom 1d grace → 3d-old lot is past grace → pruned');
}

console.log('\nTest 5: vanished URL not in existingLots → silently skipped');
{
  // prevSnapshot had a URL, but the lot was somehow deleted from the lots table.
  // We can't act on a lot we can't find — just skip.
  const prev = ['https://a.com/1', 'https://a.com/2'];
  const current = [];
  const existing = [lot('https://a.com/2')]; // /1 not in existing
  const r = selectPruneCandidatesFromSnapshot({ prevUrlSet: prev, currentUrlSet: current, existingLots: existing, now: NOW });
  assert(r.candidates.length === 1, 'only /2 candidate (the one we have a lot for)');
  assert(r.candidates[0].url === 'https://a.com/2', 'right one');
  assert(r.vanishedCount === 2, 'vanishedCount = 2 (the URL diff, regardless of lot availability)');
}

console.log('\nTest 6: empty prev → no candidates, ratio = 1');
{
  const r = selectPruneCandidatesFromSnapshot({ prevUrlSet: [], currentUrlSet: ['https://a.com/1'], existingLots: [], now: NOW });
  assert(r.candidates.length === 0, 'no candidates');
  assert(r.prevCount === 0, 'prevCount = 0');
  assert(r.ratio === 1, 'ratio = 1 (no prior to compare)');
}

console.log('\nTest 7: identical prev and current → no candidates');
{
  const urls = ['https://a.com/1', 'https://a.com/2'];
  const r = selectPruneCandidatesFromSnapshot({ prevUrlSet: urls, currentUrlSet: urls, existingLots: urls.map(u => lot(u)), now: NOW });
  assert(r.candidates.length === 0, 'no diff → no candidates');
  assert(r.vanishedCount === 0, 'vanishedCount = 0');
  assert(r.ratio === 1, 'ratio = 1');
}

console.log('\nTest 8: currentUrlSet accepts Set or Array');
{
  const prev = ['https://a.com/1', 'https://a.com/2'];
  const current = new Set(['https://a.com/2']);
  const existing = [lot('https://a.com/1'), lot('https://a.com/2')];
  const r = selectPruneCandidatesFromSnapshot({ prevUrlSet: prev, currentUrlSet: current, existingLots: existing, now: NOW });
  assert(r.candidates.length === 1, 'Set input works the same as Array');
}

console.log('\nTest 9: lot with no last_seen_at → skipped (defensive)');
{
  const prev = ['https://a.com/1'];
  const current = [];
  const existing = [lot('https://a.com/1', { last_seen_at: null })];
  const r = selectPruneCandidatesFromSnapshot({ prevUrlSet: prev, currentUrlSet: current, existingLots: existing, now: NOW });
  assert(r.candidates.length === 0, 'no last_seen_at → not pruned (defensive)');
}

console.log('\nTest 10: detectScrapeRegression — total collapse');
{
  const r = detectScrapeRegression({ prevCount: 50, currentCount: 0 });
  assert(r.severe === true, 'severe = true');
  assert(r.reason === 'current_count_collapsed', 'reason = current_count_collapsed');
}

console.log('\nTest 11: detectScrapeRegression — ratio below gate');
{
  const r = detectScrapeRegression({ prevCount: 100, currentCount: 30 }); // ratio 0.3, default gate 0.5
  assert(r.severe === true, 'severe = true');
  assert(r.reason === 'ratio_below_gate', 'reason = ratio_below_gate');
  assert(r.ratio === 0.3, 'ratio = 0.3');
}

console.log('\nTest 12: detectScrapeRegression — healthy scrape');
{
  const r = detectScrapeRegression({ prevCount: 100, currentCount: 95 });
  assert(r.severe === false, 'severe = false');
  assert(r.reason === null, 'reason = null');
  assert(r.ratio === 0.95, 'ratio = 0.95');
}

console.log('\nTest 13: detectScrapeRegression — empty prev → not regression');
{
  const r = detectScrapeRegression({ prevCount: 0, currentCount: 50 });
  assert(r.severe === false, 'new auction → no regression signal');
  assert(r.ratio === 1, 'ratio defaults to 1 when prev=0');
}

console.log('\nTest 14: detectScrapeRegression — custom gate');
{
  const r70 = detectScrapeRegression({ prevCount: 100, currentCount: 70, ratioGate: 0.8 });
  assert(r70.severe === true, '70/100 < 0.8 → severe');
  const r90 = detectScrapeRegression({ prevCount: 100, currentCount: 90, ratioGate: 0.8 });
  assert(r90.severe === false, '90/100 ≥ 0.8 → not severe');
}

console.log('\nTest 15: integration — pipeline of (selectCandidates → detectRegression)');
{
  // Simulate a healthy delta scrape: 100 prev, 95 current, 5 vanished, all past grace.
  const prevUrls = Array.from({ length: 100 }, (_, i) => `https://a.com/lot/${i}`);
  const currentUrls = prevUrls.slice(0, 95);
  const existing = prevUrls.map(u => lot(u));
  const r = selectPruneCandidatesFromSnapshot({ prevUrlSet: prevUrls, currentUrlSet: currentUrls, existingLots: existing, now: NOW });
  const reg = detectScrapeRegression({ prevCount: r.prevCount, currentCount: r.currentCount });
  assert(r.candidates.length === 5, '5 vanished candidates');
  assert(reg.severe === false, '95% retention → not regression → safe to prune');
}

console.log('\nTest 16: integration — broken scrape returns 0, regression gate blocks prune');
{
  const prevUrls = Array.from({ length: 50 }, (_, i) => `https://a.com/lot/${i}`);
  const currentUrls = [];
  const existing = prevUrls.map(u => lot(u));
  const r = selectPruneCandidatesFromSnapshot({ prevUrlSet: prevUrls, currentUrlSet: currentUrls, existingLots: existing, now: NOW });
  const reg = detectScrapeRegression({ prevCount: r.prevCount, currentCount: r.currentCount });
  assert(r.candidates.length === 50, '50 vanished candidates');
  assert(reg.severe === true, 'total collapse → severe → caller should skip prune + alert');
  assert(reg.reason === 'current_count_collapsed', 'reason = current_count_collapsed');
}

console.log('\nTest 17: _internals exported for visibility');
{
  assert(_internals.DEFAULT_GRACE_MS === 7 * DAY, 'grace = 7d');
  assert(_internals.DEFAULT_RATIO_GATE === 0.5, 'ratio gate = 0.5');
  assert(_internals.IN_PLAY.has('available'), 'in_play has available');
  assert(_internals.IN_PLAY.has('stc'), 'in_play has stc');
  assert(_internals.IN_PLAY.has('unsold'), 'in_play has unsold');
  assert(!_internals.IN_PLAY.has('sold'), 'in_play does NOT have sold');
}

// ── flipPruneCandidates: the retire_lots flip loop ──
// The prune used to run its own batch .update({ enrichment_manifest: stamp }),
// which REPLACED the manifest (destroying paid OS Places / EPC / scoring
// provenance on every pruned lot) and credited `pruned += idBatch.length`
// whether or not any row moved. It now calls the retire_lots RPC, which merges
// server-side and returns the real count. These tests pin both.

console.log('\nTest 18: flipPruneCandidates — batches, and counts the RPC\'s rows, not the batch size');
{
  const candidates = Array.from({ length: 250 }, (_, i) => lot(`https://a.com/${i}`));
  const seen = [];
  const r = await flipPruneCandidates({
    candidates,
    batchSize: 100,
    flipLots: async (ids) => { seen.push(ids.length); return ids.length; },
  });
  assert(seen.join(',') === '100,100,50', `batched 100/100/50 (got ${seen.join(',')})`);
  assert(r.pruned === 250, `pruned = 250 (got ${r.pruned})`);
  assert(r.flipped.length === 250, 'every candidate reported flipped');
  assert(r.failedBatches === 0 && r.failedLots === 0, 'no failures');
}

console.log('\nTest 19: flipPruneCandidates — pruned reflects rows ACTUALLY updated (partial flip)');
{
  // A lot sold between candidate selection and the flip: the RPC's status guard
  // skips it, so it returns 8 for a 10-id batch. The old code would have said 10.
  const candidates = Array.from({ length: 10 }, (_, i) => lot(`https://a.com/${i}`));
  const r = await flipPruneCandidates({
    candidates, batchSize: 10, flipLots: async () => 8,
  });
  assert(r.pruned === 8, `pruned = 8, not the batch size 10 (got ${r.pruned})`);
}

console.log('\nTest 20: flipPruneCandidates — failed batch is not counted and emits no flipped lots');
{
  const candidates = Array.from({ length: 20 }, (_, i) => lot(`https://a.com/${i}`));
  const warnings = [];
  const r = await flipPruneCandidates({
    candidates,
    batchSize: 10,
    flipLots: async (ids) => {
      if (ids.includes('id-https://a.com/0')) throw new Error('db down');
      return ids.length;
    },
    onBatchFailure: (why) => warnings.push(why),
  });
  assert(r.pruned === 10, `only the surviving batch counted (got ${r.pruned})`);
  assert(r.failedBatches === 1 && r.failedLots === 10, 'failed batch tallied separately');
  assert(!r.flipped.some(c => c.id === 'id-https://a.com/0'),
    'no lot_events would be emitted for the failed batch (event integrity)');
  assert(r.flipped.some(c => c.id === 'id-https://a.com/15'), 'later batch still processed after a failure');
  assert(warnings.length === 1 && warnings[0] === 'db down', 'failure surfaced to the caller, not swallowed');
}

console.log('\nTest 21: flipPruneCandidates — RPC returning 0 rows is a failure, not a success');
{
  const candidates = [lot('https://a.com/1'), lot('https://a.com/2')];
  const warnings = [];
  const r = await flipPruneCandidates({
    candidates, batchSize: 100, flipLots: async () => 0, onBatchFailure: (w) => warnings.push(w),
  });
  assert(r.pruned === 0, 'nothing counted');
  assert(r.flipped.length === 0, 'no events for a flip that never landed');
  assert(r.failedLots === 2 && warnings.length === 1, 'zero-row flip reported as a failed batch');
}

console.log('\nTest 22: flipPruneCandidates — no candidates → no RPC calls');
{
  let calls = 0;
  const r = await flipPruneCandidates({ candidates: [], flipLots: async () => { calls++; return 0; } });
  assert(calls === 0 && r.pruned === 0 && r.flipped.length === 0, 'empty candidate list is a no-op');
}

// ── The status-guard drift guard ──
// retire_lots was written for the ghost sweep and hardcoded `status='available'`.
// The prune retires the wider IN_PLAY set: at the time of the switch, 53% of
// real prune flips were stc/unsold (lot_events, writer=persist-lots.prune-vanished:
// available 120, stc 116, unsold 20). Passing the RPC's available-only default
// would have silently stopped retiring those lots forever, so the prune passes
// its own status set. If IN_PLAY ever widens, this must travel with it.
console.log('\nTest 23: PRUNE_RETIRE_STATUSES matches IN_PLAY exactly');
{
  const sent = [...PRUNE_RETIRE_STATUSES].sort();
  const selected = [..._internals.IN_PLAY].sort();
  assert(sent.join(',') === selected.join(','),
    `the statuses sent to retire_lots equal the statuses selected as candidates (sent ${sent.join(',')} / selects ${selected.join(',')})`);
  assert(sent.includes('stc') && sent.includes('unsold'),
    'stc + unsold are retirable — the available-only default would strand them');
  assert(!sent.includes('sold'), 'sold is never retirable');
}

console.log('\nTest 24: retire_lots migration parameterises the status guard');
{
  // Cheap schema guard, in the spirit of test-ghost-sweep Test 9: the code above
  // passes p_allowed_statuses, so the shipped function must accept it. If the
  // follow-up migration is reverted or never applied, the prune silently falls
  // back to available-only and half its flips vanish with no error anywhere.
  const raw = readFileSync(
    fileURLToPath(new URL('../migrations/2026-07-22-retire-lots-allowed-statuses.sql', import.meta.url)),
    'utf8',
  );
  // Strip `--` comments — the header prose quotes the old hardcoded guard.
  // Normalise line endings first: on a CRLF checkout the trailing \r sits
  // between the comment and end-of-string, so a `$`-anchored strip silently
  // matches nothing and the prose leaks into the assertions.
  const sql = raw.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
  assert(/p_allowed_statuses\s+TEXT\[\]/i.test(sql), 'migration declares p_allowed_statuses TEXT[]');
  assert(/status\s*=\s*ANY\s*\(/i.test(sql), 'guard is status = ANY(...), not a hardcoded literal');
  assert(!/AND\s+status\s*=\s*'available'/i.test(sql), 'no leftover hardcoded available-only guard');
  assert(/DROP FUNCTION IF EXISTS public\.retire_lots\(UUID\[\], JSONB\)/i.test(sql),
    'drops the 2-arg version so a 2-arg call can never be ambiguous');
  assert(/GRANT EXECUTE ON FUNCTION public\.retire_lots\(UUID\[\], JSONB, TEXT\[\]\) TO service_role/i.test(sql),
    're-grants execute to service_role (DROP revokes it)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
