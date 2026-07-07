// tests/test-recall-gate.js — THE 100% COMMANDMENT recall gate.
// A scrape below sentinel parity must surface as a queryable coverage BUG
// (type 'recall_below_100', error/warning), never a silent info pass.

import { recallGateVerdict, recallGateAlert, RECALL_ERROR_FLOOR, RECALL_TOLERANCE } from '../lib/pipeline/recall-gate.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

console.log('\nrecallGateVerdict: parity vs gap');
{
  const full = recallGateVerdict({ recall: 1.0, lots: 174, sentinelLots: 174 });
  assert(full.atParity && !full.isGap && full.severity === 'info', '100% recall → parity, info, no gap');

  // 99% on a big house is within the sentinel-noise tolerance → parity.
  const near = recallGateVerdict({ recall: 0.99, lots: 172, sentinelLots: 174 });
  assert(near.atParity && !near.isGap, '99% (within 2% tolerance) → parity');

  // bondwolfe: 137/174 = 79% → a real gap, and below the error floor → ERROR.
  const bw = recallGateVerdict({ recall: 137 / 174, lots: 137, sentinelLots: 174 });
  assert(bw.isGap && bw.severity === 'error' && bw.missing === 37, "79% → gap, error, 37 lots missing");

  // 90% → a gap but above the error floor → WARNING (below 100% but close).
  const mid = recallGateVerdict({ recall: 0.90, lots: 90, sentinelLots: 100 });
  assert(mid.isGap && mid.severity === 'warning' && mid.missing === 10, '90% → gap, warning, 10 missing');

  // Exactly at the 85% error floor → warning (>= floor), not error.
  const atFloor = recallGateVerdict({ recall: 0.85, lots: 85, sentinelLots: 100 });
  assert(atFloor.isGap && atFloor.severity === 'warning', '85% (== floor) → warning');
  const belowFloor = recallGateVerdict({ recall: 0.84, lots: 84, sentinelLots: 100 });
  assert(belowFloor.severity === 'error', '84% (< floor) → error');
}

console.log('\nrecallGateVerdict: unmeasurable (no sentinel)');
{
  const none = recallGateVerdict({ recall: null, lots: 10, sentinelLots: 0 });
  assert(none.measurable === false && !none.isGap, 'null recall → unmeasurable, not a gap');
}

console.log('\nrecallGateAlert: payload shape');
{
  const gapAlert = recallGateAlert({ house: 'bondwolfe', recall: 137 / 174, lots: 137, sentinelLots: 174, engine: 'crawlee', reason: 'auto' });
  assert(gapAlert.type === 'recall_below_100', 'gap → type recall_below_100');
  assert(gapAlert.severity === 'error', 'bondwolfe gap → error severity');
  assert(/COVERAGE GAP/.test(gapAlert.message) && /37 lot/.test(gapAlert.message), 'message names the gap + missing count');
  assert(gapAlert.meta.gate === '100pct' && gapAlert.meta.missing === 37, 'meta carries gate tag + missing count');

  const okAlert = recallGateAlert({ house: 'cliveemson', recall: 1.0, lots: 170, sentinelLots: 170, engine: 'crawlee' });
  assert(okAlert.type === 'recall_diagnostic' && okAlert.severity === 'info', 'parity → low-noise recall_diagnostic info');
}

console.log('\nconstants sane');
{
  assert(RECALL_ERROR_FLOOR > 0 && RECALL_ERROR_FLOOR < 1, `error floor in (0,1): ${RECALL_ERROR_FLOOR}`);
  assert(RECALL_TOLERANCE >= 0 && RECALL_TOLERANCE < 0.1, `tolerance small: ${RECALL_TOLERANCE}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
