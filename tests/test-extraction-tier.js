/**
 * Tests for the per-house extraction-tier auto-promotion policy
 * (lib/scraper/extraction-tier.js): weak-recall houses get bumped from the
 * Flash-Lite 'fast' tier to the stronger 'capable' tier, off the rolling
 * recall we already measure, with min-runs guarding and sticky-up promotion.
 *
 * Run: node tests/test-extraction-tier.js
 */

import {
  decideExtractionTier,
  recordExtractionRecall,
  getExtractionTier,
  _thresholds,
} from '../lib/scraper/extraction-tier.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log('Thresholds:', JSON.stringify(_thresholds));

console.log('\nTest 1: decideExtractionTier holds below MIN_RUNS');
{
  assert(decideExtractionTier({ ewma: 0.2, runs: 1, currentTier: 'fast' }) === 'fast', 'one weak run does not promote');
  assert(decideExtractionTier({ ewma: null, runs: 10, currentTier: 'fast' }) === 'fast', 'null ewma holds');
}

console.log('\nTest 2: decideExtractionTier promotes a settled weak house');
{
  assert(decideExtractionTier({ ewma: 0.55, runs: 3, currentTier: 'fast' }) === 'capable', 'weak recall over MIN_RUNS → capable');
  assert(decideExtractionTier({ ewma: 0.85, runs: 5, currentTier: 'fast' }) === 'fast', 'healthy recall stays fast');
}

console.log('\nTest 3: promotion is sticky-up (no auto-demote by default)');
{
  assert(decideExtractionTier({ ewma: 0.99, runs: 20, currentTier: 'capable' }) === 'capable', 'capable house stays capable even at high recall');
}

console.log('\nTest 4: recordExtractionRecall — null recall leaves the record untouched');
{
  const prev = { ewma: 0.5, runs: 4, lastRecall: 0.5, tier: 'capable', changedAt: 't' };
  assert(recordExtractionRecall(prev, null) === prev, 'no signal → identity');
}

console.log('\nTest 5: recordExtractionRecall — a run of weak recall flips fast→capable');
{
  let ext = null;
  for (let i = 0; i < 3; i++) ext = recordExtractionRecall(ext, 0.4, { at: `t${i}` });
  assert(ext.runs === 3, `runs accumulated (got ${ext.runs})`);
  assert(ext.ewma < _thresholds.WEAK_RECALL, `ewma below weak floor (got ${ext.ewma})`);
  assert(ext.tier === 'capable', `promoted to capable (got ${ext.tier})`);
  assert(ext.changedAt === 't2', `changedAt stamped at the promoting run (got ${ext.changedAt})`);
}

console.log('\nTest 6: recordExtractionRecall — once capable, a recovery keeps it capable');
{
  let ext = { ewma: 0.4, runs: 5, lastRecall: 0.4, tier: 'capable', changedAt: 't' };
  for (let i = 0; i < 4; i++) ext = recordExtractionRecall(ext, 0.97, { at: `r${i}` });
  assert(ext.tier === 'capable', `still capable after recovery (got ${ext.tier})`);
  assert(ext.ewma > 0.85, `ewma climbed with the recovery (got ${ext.ewma})`);
}

console.log('\nTest 7: a healthy house is never promoted');
{
  let ext = null;
  for (let i = 0; i < 8; i++) ext = recordExtractionRecall(ext, 0.95, { at: `h${i}` });
  assert(ext.tier === 'fast', `healthy house stays fast (got ${ext.tier})`);
  assert(ext.changedAt === null, 'no tier change recorded');
}

console.log('\nTest 8: getExtractionTier resolution');
{
  assert(getExtractionTier(null, 'unknown') === 'capable', 'unknown house → capable');
  assert(getExtractionTier(null, 'astleys') === 'fast', 'no skill → fast default');
  assert(getExtractionTier({ engine_stats: { _extraction: { tier: 'capable' } } }, 'astleys') === 'capable', 'stored capable honoured');
  assert(getExtractionTier({ engine_stats: { _extraction: { tier: 'fast' } } }, 'astleys') === 'fast', 'stored fast honoured');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Extraction-tier tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
