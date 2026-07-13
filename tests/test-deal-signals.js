// tests/test-deal-signals.js — multi-label deal-archetype detection.
//
// Ground truth: 3 Pembroke Avenue, Bristol BS11 9SJ (hmox) — the motivating
// deal. A 6-bed freehold HMO whose bullets state the en-suite count and
// "producing £47,700 per annum", yet pre-3.4.0 classified deal_type='Standard'.
// These fixtures are the REAL production bullets for that lot.

import { detectDealSignals, extractStatedIncome, countEnsuites } from '../lib/pipeline/deal-signals.js';
import { analyseLot } from '../lib/pipeline/scoring.js';

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}

console.log('deal-signals: income extraction');
{
  const r = extractStatedIncome('a fully tenanted six bedroom hmo producing £47,700 per annum');
  check(r.statedIncomePa === 47700, `"producing £47,700 per annum" → 47700 (got ${r.statedIncomePa})`);
  check(r.incomeKind === 'passing', `…classified passing (got ${r.incomeKind})`);
}
{
  const r = extractStatedIncome('for buy to let purposes we would anticipate a rental of £1000 per calendar month');
  check(r.statedIncomePa === 12000, `"£1000 per calendar month" anticipated → 12000/yr (got ${r.statedIncomePa})`);
  check(r.incomeKind === 'potential', `…classified potential (got ${r.incomeKind})`);
}
{
  const r = extractStatedIncome('currently let at £700 pcm');
  check(r.statedIncomePa === 8400, `"let at £700 pcm" → 8400/yr (got ${r.statedIncomePa})`);
  check(r.incomeKind === 'passing', `…classified passing (got ${r.incomeKind})`);
}
{
  const r = extractStatedIncome('subject to a ground rent of £250 pa and service charge of £1,800 pa');
  check(r.statedIncomePa === null, `ground rent / service charge £-pa figures are NOT income (got ${r.statedIncomePa})`);
}
{
  const r = extractStatedIncome('let at £1,800 per month equating to £21,600 per annum');
  check(r.statedIncomePa === 21600, `monthly+annual duplicates normalise to the same figure (got ${r.statedIncomePa})`);
}

console.log('deal-signals: en-suite counting');
{
  check(countEnsuites('6 bedrooms, 3 ensuite bathrooms and 2 shared bathrooms', 6) === 3, 'Pembroke bullet → 3 en-suites');
  check(countEnsuites('five of the six bedrooms have en-suites', 6) === 5, '"five of the six bedrooms" → 5');
  check(countEnsuites('en-suite to all bedrooms', 6) === 6, '"en-suite to all bedrooms" + beds=6 → 6');
  check(countEnsuites('master bedroom with en-suite', 2) === 1, 'bare singular → 1');
  check(countEnsuites('no bathrooms mentioned here', 4) === 0, 'no mention → 0');
}

console.log('deal-signals: HMO + investment-valuation detection');
{
  // Pembroke row 252587fa (live catalogue row) — bullets only, no HMO keyword.
  const ds = detectDealSignals({
    text: 'freehold mid-terrace house. 6 bedrooms, 3 ensuite bathrooms and 2 shared bathrooms. communal kitchen and reception room. benefits from a large rear garden and bike storage.',
    beds: 6, propType: 'house', leaseLength: null, titleSplit: false,
  });
  check(ds.signals.includes('hmo'), 'Pembroke (bullets route): hmo detected via 6 beds + 3 en-suites');
  check(ds.signals.includes('investment-valuation'), 'Pembroke: investment-valuation candidate (6 beds)');
}
{
  // Pembroke row b4afc5ac (merged bullets) — keyword + stated income route.
  const ds = detectDealSignals({
    text: 'a fully tenanted six bedroom, five bathroom hmo let to working professionals producing £47,700 per annum',
    beds: 6, propType: 'house', leaseLength: null, titleSplit: false,
  });
  check(ds.signals.includes('hmo'), 'Pembroke (keyword route): hmo detected');
  check(ds.signals.includes('investment-valuation'), 'Pembroke: investment-valuation via passing income');
  check(ds.signals.includes('income-stated') && ds.statedIncomePa === 47700, `income-stated £47,700 (got ${ds.statedIncomePa})`);
}
{
  const ds = detectDealSignals({
    text: 'stunning six bedroom detached family home with en-suite to master, landscaped gardens',
    beds: 6, propType: 'house', leaseLength: null, titleSplit: false,
  });
  check(!ds.signals.includes('hmo'), '6-bed family home with one en-suite is NOT an HMO');
}
{
  const ds = detectDealSignals({
    text: 'two bedroom apartment with en-suite master bedroom, currently let at £850 pcm',
    beds: 2, propType: 'flat', leaseLength: null, titleSplit: false,
  });
  check(!ds.signals.includes('hmo'), '2-bed flat with en-suite + rent is NOT an HMO');
  check(ds.signals.includes('income-stated'), 'but its stated income IS captured');
}
{
  const ds = detectDealSignals({
    text: 'hotel in fy4, 14 letting rooms',
    beds: 14, propType: 'other', leaseLength: null, titleSplit: false,
  });
  check(!ds.signals.includes('hmo'), '14-room hotel (non-house propType) is NOT an HMO');
}

console.log('deal-signals: other archetypes');
{
  const ds = detectDealSignals({
    text: 'lease of approximately 62 years remaining. cash buyers only. subject to a regulated tenancy at a fair rent of £4,800 pa.',
    beds: 2, propType: 'flat', leaseLength: null, titleSplit: false,
  });
  check(ds.signals.includes('short-lease'), 'short-lease from "62 years remaining"');
  check(ds.signals.includes('cash-buyers-only'), 'cash-buyers-only detected');
  check(ds.signals.includes('regulated-tenancy'), 'regulated-tenancy detected');
}
{
  const ds = detectDealSignals({
    text: 'mixed use investment: ground floor shop with self-contained flat above. planning permission granted for extension.',
    beds: null, propType: 'commercial', leaseLength: null, titleSplit: true,
  });
  check(ds.signals.includes('mixed-use'), 'mixed-use detected');
  check(ds.signals.includes('planning-granted'), 'planning-granted detected');
  check(ds.signals.includes('title-split'), 'title-split slug mirrors analyseLot verdict');
}
{
  const ds = detectDealSignals({
    text: 'ideal holiday let or airbnb opportunity near the beach',
    beds: 3, propType: 'house', leaseLength: null, titleSplit: false,
  });
  check(ds.signals.includes('holiday-let'), 'holiday-let detected');
}

console.log('deal-signals: analyseLot integration (the Pembroke end-to-end)');
{
  const lot = analyseLot({
    address: '3 Pembroke Avenue, Bristol, Avon, BS11 9SJ',
    bullets: [
      'A fully tenanted six bedroom, five bathroom HMO let to working professionals producing £47,700 per annum',
      'Freehold mid-terrace house',
      '6 bedrooms, 3 ensuite bathrooms and 2 shared bathrooms',
    ],
    price: 330000, beds: 6, tenure: 'Freehold',
  });
  check(lot.dealType === 'HMO', `Pembroke dealType = HMO (got ${lot.dealType})`);
  check(lot.dealSignals.includes('hmo') && lot.dealSignals.includes('investment-valuation'), 'Pembroke dealSignals include hmo + investment-valuation');
  check(lot.statedIncomePa === 47700 && lot.incomeKind === 'passing', `Pembroke statedIncomePa 47700 passing (got ${lot.statedIncomePa} ${lot.incomeKind})`);
  check(lot.opps.includes('Investment valuation candidate'), 'opps carry the Investment valuation candidate chip');
  check(lot.opps.some(o => /14\.\d% GIY/.test(o)), `GIY scored from stated income (opps: ${lot.opps.join(', ')})`);
  check(lot.score >= 0 && lot.score <= 10, `score clamped 0-10 (got ${lot.score})`);
}
{
  // Description (narrative) must feed detection — the P0 fix. Same lot, but
  // the signal text arrives via description instead of bullets.
  const lot = analyseLot({
    address: '10 Example Street, Leeds, LS1 1AA',
    bullets: [],
    description: 'A fully licensed six bedroom HMO, fully let and producing £39,000 per annum.',
    price: 300000, beds: 6, tenure: 'Freehold',
  });
  check(lot.dealType === 'HMO', `description-only HMO detected (got ${lot.dealType})`);
  check(lot.statedIncomePa === 39000, `description-stated income captured (got ${lot.statedIncomePa})`);
}
{
  // Non-HMO regression guard: a plain refurb terrace keeps its deal type.
  const lot = analyseLot({
    address: '5 Plain Road, Hull, HU1 1AA',
    bullets: ['Two bedroom mid-terrace house in need of modernisation', 'Freehold'],
    price: 60000, beds: 2, tenure: 'Freehold',
  });
  check(lot.dealType === 'Refurb', `plain refurb terrace stays Refurb (got ${lot.dealType})`);
  check(!lot.dealSignals.includes('hmo'), 'no hmo signal on a 2-bed refurb');
}

if (failures > 0) {
  console.error(`\ntest-deal-signals: FAIL — ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\ntest-deal-signals: all assertions passed.');
