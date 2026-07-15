// tests/test-anon-gating.js — anonymous all-lots gating + HMO teaser.
//
// The browse grid (/api/all-lots) is free for everyone, but the AI analysis
// layer requires signup. Since 2026-07-14 the HMO *classification* is a
// deliberate teaser: logged-out users see the deal type (badge/tag/filter) to
// advertise the deals, while the premium detail stays gated. This test pins
// both the teaser and the premium-leak guard (statedIncomePa/incomeKind and
// the richer dealSignals must never reach anonymous callers).

import { applyAnonTeaserGate } from '../lib/config.js';

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}

// A signed-in HMO lot as the mapper would emit it (the Pembroke shape).
function hmoLot() {
  return {
    address: '3 Pembroke Avenue, Bristol, BS11 9SJ',
    price: 330000,
    dealType: 'HMO',
    dealSignals: ['hmo', 'investment-valuation', 'income-stated'],
    statedIncomePa: 47700,
    incomeKind: 'passing',
    score: 5.5,
    opps: ['Extension/HMO potential', 'Freehold', '14.5% GIY', 'HMO', 'Investment valuation candidate', 'Producing £47,700 pa'],
    risks: [],
    scoreBreakdown: [{ signal: '14.5% GIY', pts: 2.5 }],
    condition: 'good',
    vacant: false,
    titleSplit: false,
    estGrossYield: 14.5,
  };
}

function standardLot() {
  return {
    address: '5 Plain Road, Hull, HU1 1AA',
    price: 60000,
    dealType: 'Refurb',
    dealSignals: [],
    statedIncomePa: null,
    incomeKind: null,
    score: 2,
    opps: ['Needs modernisation', 'Freehold'],
    risks: ['Flood risk'],
    scoreBreakdown: [{ signal: 'Needs modernisation', pts: 2 }],
    condition: 'needs work',
    vacant: null,
    titleSplit: false,
    estGrossYield: null,
  };
}

// A title-split lot whose hmo signal is absent — must NOT become an HMO teaser.
function titleSplitLot() {
  const l = standardLot();
  l.dealType = 'Title Split';
  l.dealSignals = ['title-split'];
  l.titleSplit = true;
  return l;
}

console.log('anon-gating: HMO teaser reveals the classification');
{
  const l = applyAnonTeaserGate(hmoLot());
  check(l.dealType === 'HMO', `HMO deal type preserved for the dropdown/badge (got ${l.dealType})`);
  check(JSON.stringify(l.opps) === JSON.stringify(['HMO']), `single "+ HMO" teaser tag on the card (got ${JSON.stringify(l.opps)})`);
  check(JSON.stringify(l.dealSignals) === JSON.stringify(['hmo']), `dealSignals reduced to the hmo label only (got ${JSON.stringify(l.dealSignals)})`);
  check(l.anonGated === true, 'anonGated flag set for the frontend signup prompt');
}

console.log('anon-gating: HMO teaser still gates the premium detail (leak guard)');
{
  const l = applyAnonTeaserGate(hmoLot());
  check(l.statedIncomePa === null, `passing income figure stripped (got ${l.statedIncomePa})`);
  check(l.incomeKind === null, `income kind stripped (got ${l.incomeKind})`);
  check(!l.dealSignals.includes('investment-valuation'), 'investment-valuation thesis NOT revealed anonymously');
  check(!l.dealSignals.includes('income-stated'), 'income-stated NOT revealed anonymously');
  check(l.score === null, 'AI score gated');
  check(l.estGrossYield === null, 'yield gated');
  check(l.condition === null, 'condition gated');
  check(!l.opps.some(o => /valuation|GIY|Producing|Freehold/.test(o)), `premium opps chips removed (got ${JSON.stringify(l.opps)})`);
}

console.log('anon-gating: non-HMO deal types stay fully gated');
{
  const l = applyAnonTeaserGate(standardLot());
  check(l.dealType === null, `Refurb deal type gated (got ${l.dealType})`);
  check(l.opps.length === 0, 'no teaser tags on a non-HMO lot');
  check(l.dealSignals.length === 0, 'no dealSignals leaked on a non-HMO lot');
  check(l.score === null && l.estGrossYield === null && l.condition === null, 'score/yield/condition all gated');
}
{
  const l = applyAnonTeaserGate(titleSplitLot());
  check(l.dealType === null, `Title Split is NOT promoted to an HMO teaser (got ${l.dealType})`);
  check(l.titleSplit === null, 'title-split flag gated');
  check(l.dealSignals.length === 0, 'title-split signal not leaked');
}

console.log('anon-gating: teaser also fires from the hmo signal when deal_type differs');
{
  // e.g. a lot the classifier labelled Development but that also carries the
  // hmo signal — the dropdown filter matches on either, so the teaser should
  // still surface it as HMO.
  const l = hmoLot();
  l.dealType = 'Development';
  const gated = applyAnonTeaserGate(l);
  check(gated.dealType === 'HMO', `hmo signal promotes the teaser even when dealType was Development (got ${gated.dealType})`);
}

if (failures > 0) {
  console.error(`\ntest-anon-gating: FAIL — ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\ntest-anon-gating: all assertions passed.');
