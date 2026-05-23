/**
 * Pure-function tests for matchTitleByAddress / extractRegisteredOwner —
 * the address matcher behind LR title surfacing. The matcher is
 * deliberately conservative: a wrong title stamped on a lot is worse than
 * none, so ambiguous and low-confidence inputs must not match.
 *
 * Run: node tests/test-title-matcher.js
 */

import { matchTitleByAddress, extractRegisteredOwner } from '../lib/land-registry-companies.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

function row(title, address, proprietors, dataset) {
  return {
    title_number: title,
    property_address: address,
    proprietors: proprietors || [],
    dataset: dataset || 'ccod',
  };
}

console.log('Test 1: exact address match → matched with title + owner');
{
  const rows = [
    row('ABC123', '12 HIGH STREET, ANYTOWN, AB1 2CD', [{ name: 'ACME PROPERTY LTD' }]),
    row('XYZ999', '7 LOW ROAD, ANYTOWN, AB1 2CD', [{ name: 'OTHER CO LTD' }]),
  ];
  const m = matchTitleByAddress('12 High Street, Anytown, AB1 2CD', rows);
  assert(m.matched === true, 'matched');
  assert(m.row && m.row.title_number === 'ABC123', 'correct title number');
  assert(m.registeredOwner === 'ACME PROPERTY LTD', 'correct registered owner');
}

console.log('\nTest 2: multiple proprietors → owner names joined');
{
  const rows = [row('T1', '5 OAK LANE, TOWN, OK1 1AA', [{ name: 'CO ONE LTD' }, { name: 'CO TWO LTD' }])];
  const m = matchTitleByAddress('5 Oak Lane, Town, OK1 1AA', rows);
  assert(m.matched === true && m.registeredOwner === 'CO ONE LTD & CO TWO LTD', 'two owners joined with &');
}

console.log('\nTest 3: no owner rows for the postcode → no_owner_rows');
{
  const m = matchTitleByAddress('12 High Street', []);
  assert(m.matched === false && m.reason === 'no_owner_rows', 'empty rows → no_owner_rows');
}

console.log('\nTest 4: lot has no address → no_address');
{
  const m = matchTitleByAddress('', [row('T1', '12 HIGH STREET', [{ name: 'X LTD' }])]);
  assert(m.matched === false && m.reason === 'no_address', 'blank address → no_address');
}

console.log('\nTest 5: no leading house number (flat) → no_house_number');
{
  const rows = [row('T1', '12 HIGH STREET, TOWN', [{ name: 'X LTD' }])];
  const m = matchTitleByAddress('Flat 2, High Street, Town', rows);
  assert(m.matched === false && m.reason === 'no_house_number', 'flat address → no_house_number');
}

console.log('\nTest 6: different street, same number → no_match');
{
  const rows = [row('T1', '12 LOW ROAD, TOWN, LR1 1AA', [{ name: 'X LTD' }])];
  const m = matchTitleByAddress('12 High Street, Town, LR1 1AA', rows);
  assert(m.matched === false && m.reason === 'no_match', 'number matches but street does not → no_match');
}

console.log('\nTest 7: ambiguous — two titles at the same number+street → rejected');
{
  const rows = [
    row('T1', '12 HIGH STREET, TOWN', [{ name: 'CO A LTD' }]),
    row('T2', '12 HIGH STREET, TOWN', [{ name: 'CO B LTD' }]),
  ];
  const m = matchTitleByAddress('12 High Street, Town', rows);
  assert(m.matched === false && m.reason === 'ambiguous', 'two matches → ambiguous, not stamped');
}

console.log('\nTest 8: house-number substring is not a match (12 vs 120)');
{
  const rows = [row('T1', '120 HIGH STREET, TOWN', [{ name: 'X LTD' }])];
  const m = matchTitleByAddress('12 High Street, Town', rows);
  assert(m.matched === false, '"12" must not match "120"');
}

console.log('\nTest 9: case + punctuation + whitespace insensitive');
{
  const rows = [row('T1', '34a   queen’s road, the city', [{ name: 'q ltd' }])];
  const m = matchTitleByAddress('34A Queen’s Road, The City', rows);
  assert(m.matched === true && m.row.title_number === 'T1', 'matches across case/punctuation/whitespace');
}

console.log('\nTest 10: extractRegisteredOwner edge cases');
{
  assert(extractRegisteredOwner({ proprietors: [{ name: 'SOLO LTD' }] }) === 'SOLO LTD', 'single proprietor');
  assert(extractRegisteredOwner({ proprietors: [] }) === null, 'empty proprietors → null');
  assert(extractRegisteredOwner({}) === null, 'missing proprietors → null');
  assert(extractRegisteredOwner({ proprietors: [{ name: 'A' }, { name: '' }, { name: 'B' }] }) === 'A & B',
    'blank names filtered out');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
