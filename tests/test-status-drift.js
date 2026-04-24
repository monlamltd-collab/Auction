// tests/test-status-drift.js — pure unit tests for the drift scheduler helper.
// No DB, no auth, no imports of lib/auth.js — so no process.exit(0) needed.

import { pickNextHouseForDrift } from '../lib/pipeline/drift-scheduler.js';

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log('Test: pickNextHouseForDrift');

// 1. No candidates → null
assert(
  'empty map returns null',
  pickNextHouseForDrift({}, {}),
  null,
);

// 2. Single candidate → that one
assert(
  'single candidate returns itself',
  pickNextHouseForDrift({ allsop: [1, 2] }, {}),
  'allsop',
);

// 3. Never-checked house wins over a recently-checked one
{
  const now = new Date().toISOString();
  assert(
    'never-checked beats recently-checked',
    pickNextHouseForDrift(
      { allsop: [1], savills: [1] },
      { allsop: now /* savills missing */ },
    ),
    'savills',
  );
}

// 4. Oldest last_drift_checked_at wins when both have values
{
  const older = '2026-01-01T00:00:00.000Z';
  const newer = '2026-04-20T00:00:00.000Z';
  assert(
    'oldest timestamp wins',
    pickNextHouseForDrift(
      { allsop: [1], savills: [1] },
      { allsop: newer, savills: older },
    ),
    'savills',
  );
}

// 5. Ties broken alphabetically (deterministic across runs + deploys)
assert(
  'tie broken alphabetically when both never checked',
  pickNextHouseForDrift(
    { savills: [1], allsop: [1] },
    {},
  ),
  'allsop',
);

// 6. Null value is treated same as missing entry (never-checked)
{
  const now = new Date().toISOString();
  assert(
    'null last-checked treated as never-checked',
    pickNextHouseForDrift(
      { allsop: [1], savills: [1] },
      { allsop: now, savills: null },
    ),
    'savills',
  );
}

// 7. Three-way — oldest wins, not alphabetical
{
  assert(
    'oldest wins across three candidates',
    pickNextHouseForDrift(
      { allsop: [1], savills: [1], sdl: [1] },
      {
        allsop:  '2026-04-20T00:00:00.000Z',
        savills: '2026-04-10T00:00:00.000Z', // oldest
        sdl:     '2026-04-15T00:00:00.000Z',
      },
    ),
    'savills',
  );
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All status-drift tests passed!');
