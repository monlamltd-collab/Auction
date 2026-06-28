// tests/test-retired-reconcile.js — Defends _retiredSlugsNeedingDormant, the
// pure core of reconcileRetiredHousesDormant(). Background: retiring a house was
// historically code-only (add to RETIRED_HOUSES in lib/houses.js), so the
// matching house_skills row kept dormant=false / circuit_state='closed' /
// status='healthy' and looked live to every monitor — the extraction-liveness
// !dormant gate, the Hermes deterministic rules (gate: circuit closed AND
// dormant=false), and health counts. The boot reconcile stamps dormant=true on
// retired slugs the DB still thinks are live; this test pins WHICH rows it picks.
import { _retiredSlugsNeedingDormant, RETIRED_HOUSES } from '../lib/houses.js';

let pass = 0, fail = 0;
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`✓ ${label}`); pass++; }
  else { console.log(`✗ ${label} — got ${a}, expected ${e}`); fail++; }
};

// Pick a real retired slug to build fixtures from, so the test tracks the set.
const retired = [...RETIRED_HOUSES];
if (retired.length < 2) { console.log('✗ expected RETIRED_HOUSES to be populated'); process.exit(1); }
const [r1, r2] = retired;

// A retired house sitting at dormant=false is exactly what we must flag.
eq('retired + dormant=false → flagged',
  _retiredSlugsNeedingDormant([{ slug: r1, dormant: false }]), [r1]);

// A retired house with NULL dormant (never stamped) is also flagged.
eq('retired + dormant=null → flagged',
  _retiredSlugsNeedingDormant([{ slug: r1, dormant: null }]), [r1]);

// Already dormant → left alone (idempotent: no needless writes).
eq('retired + dormant=true → skipped',
  _retiredSlugsNeedingDormant([{ slug: r1, dormant: true }]), []);

// A live (non-retired) house is never flagged, regardless of dormant state.
eq('non-retired house ignored',
  _retiredSlugsNeedingDormant([{ slug: 'allsop', dormant: false }]), []);

// Mixed batch: only the retired-and-not-yet-dormant rows come back.
eq('mixed batch picks only the ones needing it',
  _retiredSlugsNeedingDormant([
    { slug: r1, dormant: false },
    { slug: r2, dormant: true },
    { slug: 'allsop', dormant: false },
    { slug: 'bondwolfe', dormant: null },
  ]), [r1]);

// Robustness: empty / nullish / malformed input never throws.
eq('empty rows → empty', _retiredSlugsNeedingDormant([]), []);
eq('null rows → empty', _retiredSlugsNeedingDormant(null), []);
eq('rows with null entries are tolerated',
  _retiredSlugsNeedingDormant([null, { slug: r1, dormant: false }]), [r1]);

// lextons was added to RETIRED_HOUSES on 2026-06-27 — guard the regression.
eq('lextons is in the retired set', RETIRED_HOUSES.has('lextons'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
