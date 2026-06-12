/**
 * Tests for the hallucination guards in lib/scraper/extraction.js
 * (2026-06-11 incident: 107 fabricated lots — "45 Sample Avenue, Manchester",
 * "789 Demo Road, Leeds" — reached the live table because the model invents
 * example lots when handed near-empty page content).
 *
 * Guard 1: content floor — batches below MIN_EXTRACTION_CONTENT_CHARS are
 *          never sent to the model.
 * Guard 2: grounding — extracted lots with zero trace in the source content
 *          are dropped, and a whole-batch fabrication fires an
 *          ai_hallucination_blocked alert.
 *
 * Run: node tests/test-hallucination-guard.js
 */

import { initState } from '../lib/scraper/state.js';
import { extractLotsWithAI, isLotGrounded } from '../lib/scraper/extraction.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const norm = (s) => s.toLowerCase().replace(/\s+/g, '');

console.log('Test 1: isLotGrounded — fabricated lots have no trace');
{
  const content = norm('Welcome to our site. We use cookies. No results found for your search. Contact us on 0151 000 0000.');
  assert(isLotGrounded({ address: '123 Example Street, Liverpool, L1 1AA' }, content) === false, 'invented lot is ungrounded');
  assert(isLotGrounded({ address: '45 Sample Avenue, Manchester, M1 2BB' }, content) === false, 'second invented lot is ungrounded');
  assert(isLotGrounded({ address: '' }, content) === false, 'empty address is ungrounded');
}

console.log('\nTest 2: isLotGrounded — real lots leave traces');
{
  const page = norm('Lot 7: 14 Hillside Avenue, Sunderland SR4 7QP — Guide £75,000. Three bed terrace.');
  assert(isLotGrounded({ address: '14 Hillside Avenue, Sunderland, SR4 7QP' }, page) === true, 'postcode match grounds the lot');
  const noPcPage = norm('Lot 3 — Rose Cottage, Hillside Avenue, Sunderland. Guide on application.');
  assert(isLotGrounded({ address: 'Rose Cottage, Hillside Avenue, Sunderland' }, noPcPage) === true, 'token matches ground the lot without a postcode');
  // Generic street-type words alone must NOT count as evidence.
  const genericPage = norm('Find property for sale. Street view available. Road map. Avenue of options.');
  assert(isLotGrounded({ address: '99 Street Road Avenue' }, genericPage) === false, 'generic tokens alone do not ground a lot');
}

console.log('\nTest 3: content floor — near-empty pages never reach the model');
{
  let aiCalls = 0;
  initState({ callAI: async () => { aiCalls++; return '[]'; } });
  const pages = [{ page: 1, html: '<html><body>We use cookies.</body></html>' }];
  const lots = await extractLotsWithAI(pages, 'somehouse', null, 'https://x.test/cat');
  assert(aiCalls === 0, `model never called on tiny content (calls=${aiCalls})`);
  assert(lots.length === 0, 'no lots from a skipped batch');
}

console.log('\nTest 4: grounding drops a fully fabricated batch + fires the alert');
{
  const fabricated = JSON.stringify([
    { lot: 1, address: '123 Example Street, Liverpool, L1 1AA', price: 100000 },
    { lot: 2, address: '45 Sample Avenue, Manchester, M1 2BB', price: 150000 },
  ]);
  initState({ callAI: async () => fabricated });
  const alerts = [];
  // Real-looking page content, comfortably above the floor, containing NONE
  // of the fabricated addresses.
  const filler = 'Auction catalogue navigation, terms and conditions, viewing arrangements, buyer fees apply. '.repeat(12);
  const pages = [{ page: 1, html: `<html><body>${filler}</body></html>` }];
  const lots = await extractLotsWithAI(pages, 'somehouse', null, 'https://x.test/cat', { fireAlert: async (a) => { alerts.push(a); } });
  assert(lots.length === 0, `fabricated lots all dropped (got ${lots.length})`);
  assert(alerts.some(a => a.type === 'ai_hallucination_blocked'), 'ai_hallucination_blocked alert fired');
}

console.log('\nTest 5: grounded lots pass through untouched');
{
  const real = JSON.stringify([
    { lot: 7, address: '14 Hillside Avenue, Sunderland, SR4 7QP', price: 75000, tenure: 'Freehold', beds: 3 },
  ]);
  initState({ callAI: async () => real });
  const filler = 'Forthcoming auction lots listed below with guide prices and viewing times. '.repeat(8);
  const pages = [{ page: 1, html: `<html><body>${filler} Lot 7: 14 Hillside Avenue, Sunderland SR4 7QP — Guide £75,000.</body></html>` }];
  const alerts = [];
  const lots = await extractLotsWithAI(pages, 'somehouse', null, 'https://x.test/cat', { fireAlert: async (a) => { alerts.push(a); } });
  assert(lots.length === 1, `real lot kept (got ${lots.length})`);
  assert(lots[0].address.includes('Hillside Avenue'), 'address intact');
  assert(!alerts.some(a => a.type === 'ai_hallucination_blocked'), 'no hallucination alert for a grounded batch');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Hallucination guard tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
