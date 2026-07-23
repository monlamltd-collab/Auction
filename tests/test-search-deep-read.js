/**
 * search-deep-read — pure helper tests for the stage-2 AI search pass.
 *
 * Locks the contract between the route and the deep-read verdict:
 *   • buildDeepSummaries — full-context per-lot payload, [i] index mapping
 *   • applyDeepVerdict   — bounds-checked, deduped, order-preserving, null on junk
 *   • isSemanticQuery    — deep read only when narrative can change the answer
 */
import {
  buildDeepSummaries, applyDeepVerdict, isSemanticQuery,
  DEEP_READ_SEARCHTEXT_CHARS, DEEP_READ_NARRATIVE_CHARS, DEEP_READ_MIN_LOTS,
} from '../lib/search-deep-read.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); pass++; }
  else { console.error(`  FAIL: ${msg}`); fail++; }
}

const lot = (over = {}) => ({
  _house: 'bondwolfe', lot: 12, address: '1 High St, Birmingham B1 1AA', price: 150000,
  score: 6, propType: 'house', tenure: 'Freehold', beds: 4, status: 'available',
  _searchText: 'S'.repeat(2000), description: 'N'.repeat(3000),
  dealSignals: ['hmo'], units: 3, dealType: 'Title Split', ...over,
});

console.log('buildDeepSummaries — payload shape + budgets');
{
  const s = buildDeepSummaries([lot(), lot({ address: '2 Low Rd', description: null })]);
  assert(s.includes('[0] bondwolfe L12: 1 High St'), 'index [0] + house + address present');
  assert(s.includes('[1] bondwolfe L12: 2 Low Rd'), 'index [1] maps second lot');
  assert(s.includes('HMO') && s.includes('3units') && s.includes('Deal:Title Split'), 'deal meta surfaced');
  const dataLen = (s.match(/DATA: (S+)/) || ['', ''])[1].length;
  const narrLen = (s.match(/NARRATIVE: (N+)/) || ['', ''])[1].length;
  assert(dataLen === DEEP_READ_SEARCHTEXT_CHARS, `search_text capped at ${DEEP_READ_SEARCHTEXT_CHARS} (got ${dataLen})`);
  assert(narrLen === DEEP_READ_NARRATIVE_CHARS, `narrative capped at ${DEEP_READ_NARRATIVE_CHARS} (got ${narrLen})`);
  assert(s.includes('no narrative captured'), 'missing narrative flagged, not blank');
  assert(buildDeepSummaries([]) === '', 'empty list → empty payload');
}

console.log('applyDeepVerdict — mapping discipline');
{
  const lots = [lot({ lot: 1 }), lot({ lot: 2 }), lot({ lot: 3 })];
  const kept = applyDeepVerdict(lots, [2, 0]);
  assert(kept.length === 2 && kept[0].lot === 3 && kept[1].lot === 1, 'order preserved (model ranks best-first)');
  assert(applyDeepVerdict(lots, [1, 1, 1]).length === 1, 'duplicate indices deduped');
  assert(applyDeepVerdict(lots, [5, -1, 99]) === null, 'all out-of-bounds → null (keep stage-1)');
  assert(applyDeepVerdict(lots, [1.5, 'x', 2]).length === 1, 'non-integer indices skipped');
  assert(applyDeepVerdict(lots, []) === null, 'empty verdict → null (keep stage-1)');
  assert(applyDeepVerdict(lots, null) === null, 'null verdict → null');
  assert(applyDeepVerdict(null, [0]) === null, 'null lots → null');
}

console.log('isSemanticQuery — deep read only when text can change the answer');
{
  assert(isSemanticQuery({ concepts: ['hmo_conversion'], freeText: [], softFilters: {} }) === true, 'concept → semantic');
  assert(isSemanticQuery({ concepts: [], freeText: ['annexe'], softFilters: {} }) === true, 'free text → semantic');
  assert(isSemanticQuery({ concepts: [], freeText: [], softFilters: { vacant: true } }) === true, 'soft filter → semantic');
  assert(isSemanticQuery({ concepts: [], freeText: [], softFilters: {} }) === false, 'pure structured query → NOT semantic (skip pass 2)');
  assert(isSemanticQuery(null) === false, 'null parse → not semantic');
}

console.log('constants sane');
{
  assert(DEEP_READ_MIN_LOTS >= 2 && DEEP_READ_MIN_LOTS <= 10, `min-lots threshold sensible (${DEEP_READ_MIN_LOTS})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
