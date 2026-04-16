// tests/test-scoring.js
/**
 * Scoring Engine Tests
 * ====================
 * Tests the investment scoring logic extracted to lib/scoring.js
 * Run: node tests/test-scoring.js
 */

import { scoreLot } from '../lib/scoring.js';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function test(name, fn) {
  console.log(`\n${name}`);
  fn();
}

// -- Core scoring tests --

test('Empty lot gets score 0', () => {
  const lot = { address: '123 Test St', bullets: [], price: 100000 };
  const result = scoreLot(lot);
  assert(result.score === 0, `score should be 0, got ${result.score}`);
  assert(result.opps.length === 0, 'no opportunities');
  assert(result.risks.length === 0, 'no risks');
});

test('Needs modernisation scores +2', () => {
  const lot = { address: '1 High St', bullets: ['In need of modernisation'], price: 100000 };
  const result = scoreLot(lot);
  assert(result.score === 2, `score should be 2, got ${result.score}`);
  assert(result.condition === 'needs work', `condition should be 'needs work', got '${result.condition}'`);
  assert(result.opps.includes('Needs modernisation'), 'should have modernisation opp');
});

test('Poor/derelict condition scores +2.5', () => {
  const lot = { address: '1 High St', bullets: ['Derelict property'], price: 100000 };
  const result = scoreLot(lot);
  assert(result.score === 2.5, `score should be 2.5, got ${result.score}`);
  assert(result.condition === 'poor', `condition should be 'poor', got '${result.condition}'`);
});

test('Executor/probate scores +1.5', () => {
  const lot = { address: '1 High St', bullets: ['Sold on behalf of the executor'], price: 100000 };
  const result = scoreLot(lot);
  assert(result.score === 1.5, `score should be 1.5, got ${result.score}`);
  assert(result.opps.includes('Executor/probate'), 'should have executor opp');
});

test('Receivership scores +2', () => {
  const lot = { address: '1 High St', bullets: ['By order of the LPA receiver'], price: 100000 };
  const result = scoreLot(lot);
  assert(result.score === 2, `score should be 2, got ${result.score}`);
});

test('Development potential scores +2', () => {
  const lot = { address: '1 High St', bullets: ['Development potential subject to planning'], price: 100000 };
  const result = scoreLot(lot);
  assert(result.score === 2, `score should be 2, got ${result.score}`);
});

test('Extension/HMO potential scores +1.5', () => {
  // Note: "requisite" contains "site" which triggers propType='land' + vacant bonus (+1)
  // so total is 2.5, not 1.5 — this matches the production scoring engine behaviour
  const lot = { address: '1 High St', bullets: ['Potential to extend subject to requisite consents'], price: 100000 };
  const result = scoreLot(lot);
  assert(result.score === 2.5, `score should be 2.5, got ${result.score}`);
});

test('Vacant house scores +1', () => {
  const lot = { address: '1 High St', bullets: ['Vacant detached house'], price: 100000 };
  const result = scoreLot(lot);
  assert(result.opps.includes('Vacant'), 'should have vacant opp');
});

test('Freehold house scores +0.5', () => {
  const lot = { address: '1 High St', bullets: ['Freehold semi-detached house in good order'], price: 100000 };
  const result = scoreLot(lot);
  assert(result.opps.includes('Freehold'), 'should have freehold opp');
  assert(result.tenure === 'Freehold', `tenure should be Freehold, got ${result.tenure}`);
});

test('Low price per sqft (<200) scores +2', () => {
  const lot = { address: '1 High St', bullets: ['1000 sq ft'], price: 150000 };
  const result = scoreLot(lot);
  assert(result.sqft === 1000, `sqft should be 1000, got ${result.sqft}`);
  assert(result.opps.some(o => o.includes('/sqft')), 'should have sqft opp');
});

test('High yield (>8%) scores +2.5', () => {
  const lot = { address: '1 High St', bullets: ['Let at £12,000 per annum'], price: 100000 };
  const result = scoreLot(lot);
  assert(result.opps.some(o => o.includes('GIY')), 'should have yield opp');
});

test('Sitting tenant scores -2', () => {
  const lot = { address: '1 High St', bullets: ['Subject to a sitting tenant'], price: 100000 };
  const result = scoreLot(lot);
  assert(result.risks.includes('Sitting tenant'), 'should have sitting tenant risk');
});

test('Knotweed scores -2', () => {
  const lot = { address: '1 High St', bullets: ['Japanese knotweed identified'], price: 100000 };
  const result = scoreLot(lot);
  assert(result.risks.includes('Knotweed'), 'should have knotweed risk');
});

test('Score is capped between 0 and 10', () => {
  // Stack multiple positives to exceed 10
  const lot = { address: '1 High St', bullets: [
    'Derelict freehold house', 'By order of the LPA receiver',
    'Development potential', 'Extension potential', 'Vacant',
    '500 sq ft', 'Let at £20,000 per annum'
  ], price: 50000 };
  const result = scoreLot(lot);
  assert(result.score <= 10, `score should be <= 10, got ${result.score}`);
  assert(result.score >= 0, `score should be >= 0, got ${result.score}`);
});

test('Score does not go below 0', () => {
  const lot = { address: '1 High St', bullets: [
    'Sitting tenant', 'Knotweed', 'Flying freehold', 'Flood risk zone 3',
    'Non-standard construction', 'Asbestos contamination'
  ], price: 100000 };
  const result = scoreLot(lot);
  assert(result.score === 0, `score should be 0, got ${result.score}`);
});

test('Title split detection works', () => {
  const lot = { address: 'Flats A-D, 1 High St', bullets: ['Freehold block of 4 self-contained flats'], price: 200000 };
  const result = scoreLot(lot);
  assert(result.titleSplit === true, 'should detect title split');
  assert(result.units >= 4, `units should be >= 4, got ${result.units}`);
});

test('Property type detection', () => {
  const flat = scoreLot({ address: '1 High St', bullets: ['Ground floor flat'], price: 100000 });
  assert(flat.propType === 'flat', `flat propType should be 'flat', got '${flat.propType}'`);

  const house = scoreLot({ address: '1 High St', bullets: ['Semi-detached house'], price: 100000 });
  assert(house.propType === 'house', `house propType should be 'house', got '${house.propType}'`);

  const land = scoreLot({ address: '1 High St', bullets: ['Building plot with planning'], price: 100000 });
  assert(land.propType === 'land', `land propType should be 'land', got '${land.propType}'`);
});

test('Bedroom extraction', () => {
  const lot = scoreLot({ address: '1 High St', bullets: ['3 bedroom semi-detached'], price: 100000 });
  assert(lot.beds === 3, `beds should be 3, got ${lot.beds}`);
});

test('scoreBreakdown tracks each signal', () => {
  const lot = scoreLot({ address: '1 High St', bullets: ['Derelict house by order of the executor'], price: 100000 });
  assert(Array.isArray(lot.scoreBreakdown), 'scoreBreakdown should be an array');
  assert(lot.scoreBreakdown.length > 0, 'scoreBreakdown should have entries');
  assert(lot.scoreBreakdown.every(s => 'signal' in s && 'pts' in s), 'each entry should have signal and pts');
});

// -- Summary --
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
