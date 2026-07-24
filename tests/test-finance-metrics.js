// tests/test-finance-metrics.js — deterministic investor metrics
// (public/finance.js): SDLT port parity, net yield, ROCE, BRRR, max bid.
//
// The file attaches to globalThis when no window exists, so a bare import is
// enough — same loading trick the browser gets via a plain <script> tag.

import '../public/finance.js';
const F = globalThis.AB_finance;

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}
function approx(a, b, tol, msg) { check(Math.abs(a - b) <= tol, `${msg} (got ${a})`); }

console.log('finance: SDLT port parity (bridgematch-lite calcSDLT)');
check(F.sdlt(100000, 'england') === 5000, 'england £100k → £5,000');
check(F.sdlt(300000, 'england') === 17500, 'england £300k → £17,500');
check(F.sdlt(1000000, 'england') === 91250, 'england £1m → £91,250');
check(F.sdlt(200000, 'scotland') === 13100, 'scotland £200k → £13,100 (ADS+LBTT)');
check(F.sdlt(150000, 'wales') === 6000, 'wales £150k → £6,000');
check(F.sdlt(100000) === 5000, 'country defaults to england');

console.log('finance: postcode → tax country');
check(F.countryFromPostcode('EH1 1AA') === 'scotland', 'EH → scotland');
check(F.countryFromPostcode('G1 1AA') === 'scotland', 'G → scotland');
check(F.countryFromPostcode('CF10 1AA') === 'wales', 'CF → wales');
check(F.countryFromPostcode('LS1 4AB') === 'england', 'LS → england');
check(F.countryFromPostcode('') === 'england', 'missing postcode → england rates');

console.log('finance: net yield');
{
  const l = { price: 100000, estMonthlyRent: 1000, postcode: 'LS1 4AB' };
  // NOI = 12,000 × 0.8 − 350 = 9,250; true cost = 100,000 + 5,000 + 3,000
  approx(F.trueCost(l), 108000, 0, 'true cost £108,000');
  approx(F.noi(l), 9250, 0.01, 'NOI £9,250');
  approx(F.netYield(l), 8.565, 0.01, 'net yield ≈ 8.57%');
  check(F.netYield({ price: 100000, postcode: 'LS1' }) === null, 'no rent estimate → null, never fabricated');
  check(F.netYield({ estMonthlyRent: 1000 }) === null, 'no price → null');
}

console.log('finance: ROCE (cash-on-cash)');
{
  const l = { price: 100000, estMonthlyRent: 1000, postcode: 'LS1 4AB' };
  // interest = 75,000 × 5.5% = 4,125; cash in = 25,000 + 5,000 + 3,000
  approx(F.roce(l), (9250 - 4125) / 33000 * 100, 0.01, 'ROCE ≈ 15.53% (no works)');
  const refurb = { ...l, condition: 'needs work' };
  check(F.worksCost(refurb) === 20000, 'needs work → 20% works cost');
  approx(F.roce(refurb), (9250 - 4125) / 53000 * 100, 0.01, 'ROCE ≈ 9.67% with works in cash figure');
  check(F.roce({ price: 100000 }) === null, 'no rent → null');
  const negative = { price: 300000, estMonthlyRent: 800, postcode: 'LS1' };
  check(F.roce(negative) < 0, 'over-leveraged low-rent deal shows NEGATIVE roce (honest)');
}

console.log('finance: BRRR recycled %');
{
  const l = { price: 100000, estMonthlyRent: 1000, postcode: 'LS1 4AB', valueEstimate: { estimate: 150000, low: 130000, high: 170000, confidence: 'medium' } };
  const b = F.brrrRecycledPct(l);
  approx(b.pct, 112500 / 108000 * 100, 0.01, 'refi 75% × £150k over £108k in ≈ 104%');
  check(b.confidence === 'medium', 'confidence rides along from the value estimate');
  check(F.brrrRecycledPct({ price: 100000 }) === null, 'no value estimate → null');
}

console.log('finance: max bid for target yield');
check(F.maxBid({ estMonthlyRent: 1000 }, 8) === 150000, 'rent £1,000pcm at 8% target → £150,000');
check(F.maxBid({ estMonthlyRent: 1000 }, 0) === null, 'zero target → null');
check(F.maxBid({}, 8) === null, 'no rent → null');

console.log('finance: assumptions are surfaced');
{
  const s = F.describeAssumptions({ condition: 'poor', postcode: 'CF10 1AA' });
  check(s.includes('75% LTV') && s.includes('5.5%') && s.includes('wales') && s.includes('works 30%'),
    'tooltip names LTV, rate, tax country and condition-implied works');
}

console.log('finance: unrealistic token / extreme-BMV guides suppress % returns');
{
  // Your classic £1.5k guide on a £250k street.
  const token = {
    price: 1500,
    streetAvg: 250000,
    estMonthlyRent: 1100,
    postcode: 'LS1 4AB',
    estGrossYield: (1100 * 12 / 1500) * 100,
  };
  check(F.isUnrealisticGuide(token) === true, '£1.5k vs £250k street is unrealistic');
  check(F.guideDistortion(token).reason === 'guide_vs_street', 'reason = guide_vs_street');
  check(F.netYield(token) === null, 'net yield suppressed on token guide');
  check(F.roce(token) === null, 'ROCE suppressed on token guide');
  check(F.rankingGrossYield(token) === null, 'ranking gross yield null so sort sinks it');
  check(F.maxBid(token, 8) === null, 'max bid suppressed on token guide');
  check(F.brrrRecycledPct({ ...token, valueEstimate: { estimate: 250000, confidence: 'low' } }) === null,
    'BRRR suppressed on token guide');

  // Plausible deep discount (~40% below) must still compute — bought well, not a plot.
  const realBargain = {
    price: 150000,
    streetAvg: 250000,
    estMonthlyRent: 1100,
    postcode: 'LS1 4AB',
  };
  check(F.isUnrealisticGuide(realBargain) === false, '40% below street still eligible');
  check(F.netYield(realBargain) != null && F.netYield(realBargain) > 0, 'real bargain keeps net yield');
  check(F.roce(realBargain) != null, 'real bargain keeps ROCE');

  // Border at 70% below (ratio 0.30): £75k on £250k is still a house lever — allowed.
  const borderOk = { price: 75001, streetAvg: 250000, estMonthlyRent: 900, postcode: 'LS1' };
  check(F.isUnrealisticGuide(borderOk) === false, 'just under 70% below still allowed');
  const borderBad = { price: 75000, streetAvg: 250000, estMonthlyRent: 900, postcode: 'LS1' };
  check(F.isUnrealisticGuide(borderBad) === true, 'exactly 70% below / ratio 0.30 suppressed');

  // Tiny guide + whole-home rent fabricates giant yield even without comps.
  const noComp = { price: 5000, estMonthlyRent: 800, postcode: 'M1 1AA', estGrossYield: 192 };
  check(F.isUnrealisticGuide(noComp) === true, '£5k + whole-home rent with no comps still suppressed');

  // £20k with 100%+ yield (no sky-high street ratio) also suppressed via yield cap.
  const cheapFlat = { price: 20000, estMonthlyRent: 2050, postcode: 'M14 6YF', estGrossYield: 123, streetAvg: 53000 };
  check(F.isUnrealisticGuide(cheapFlat) === true, '£20k @ 123% yield suppressed even if only ~62% below street');
  check(F.rankingGrossYield(cheapFlat) === null, 'ranking yield null for 123% guide');

  // Land cheap with no rent stays flagged via street ratio.
  const landNoRent = { price: 2000, streetAvg: 300000, postcode: 'B1 1AA' };
  check(F.isUnrealisticGuide(landNoRent) === true, 'token guide vs street still flagged even without rent');
  check(F.netYield(landNoRent) === null, 'no rent → null net yield');
}

if (failures > 0) {
  console.error(`\ntest-finance-metrics: FAIL — ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\ntest-finance-metrics: all assertions passed.');
