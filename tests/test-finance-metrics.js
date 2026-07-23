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

if (failures > 0) {
  console.error(`\ntest-finance-metrics: FAIL — ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\ntest-finance-metrics: all assertions passed.');
