/**
 * Pure-function tests for the Move 3 Phase 3b snapshot-diff prune logic.
 *
 * Run: node tests/test-snapshot-prune.js
 */

import {
  selectPruneCandidatesFromSnapshot,
  detectScrapeRegression,
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
