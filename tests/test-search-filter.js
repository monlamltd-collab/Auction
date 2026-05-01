// tests/test-search-filter.js — locks the contract for the town-search
// predicate added in `public/town-match.js`. Regression for the Bristol bug
// where searching "Bristol" returned only 2 lots because the filter only
// matched against `address` and missed lots that store the city in `postcode`
// (e.g. "Property, BS16 7JQ").

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'public', 'town-match.js'), 'utf8');

// Run the IIFE in a sandbox with a fake `window`. The module attaches itself
// to `window.AB_townMatch` as it does in the browser.
const sandbox = { window: {}, module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { townMatchesLot, getPostcodeArea, TOWN_POSTCODE_PREFIXES } = sandbox.window.AB_townMatch;

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

console.log('\ntownMatchesLot: Bristol bug regression');
{
  const town = 'Bristol';
  // The literal-address case (the only one that worked before the fix).
  assert(townMatchesLot({ address: '12 Whitehouse Road, Bristol, BS1 5HX', postcode: 'BS1 5HX' }, town),
    'matches lot with "Bristol" in address');

  // The bug: postcode-only match must now succeed.
  assert(townMatchesLot({ address: 'Property, Somewhere', postcode: 'BS16 7JQ' }, town),
    'matches lot with BS postcode and no town in address');
  assert(townMatchesLot({ address: 'Plot 4, Industrial Estate, BS3 4AA', postcode: 'BS3 4AA' }, town),
    'matches lot when town is absent and postcode starts with BS');

  // Negative — different region must not match.
  assert(!townMatchesLot({ address: 'Manchester city centre', postcode: 'M1 2AB' }, town),
    'rejects M1 lot when searching Bristol');
  assert(!townMatchesLot({ address: 'Leeds city centre', postcode: 'LS1 4AB' }, town),
    'rejects LS1 lot when searching Bristol');
}

console.log('\ntownMatchesLot: other major cities');
{
  assert(townMatchesLot({ address: 'X', postcode: 'M14 5AB' }, 'Manchester'), 'Manchester → M area');
  assert(townMatchesLot({ address: 'X', postcode: 'L1 8JQ' }, 'Liverpool'), 'Liverpool → L area');
  assert(townMatchesLot({ address: 'X', postcode: 'LS6 4BA' }, 'Leeds'), 'Leeds → LS area');
  assert(townMatchesLot({ address: 'X', postcode: 'B12 3CD' }, 'Birmingham'), 'Birmingham → B area');
  assert(townMatchesLot({ address: 'X', postcode: 'NE1 4AB' }, 'Newcastle'), 'Newcastle → NE area');
  assert(!townMatchesLot({ address: 'X', postcode: 'ME1 4AB' }, 'Manchester'),
    'Manchester (M) does NOT match ME (Maidstone) — area-code, not letter-prefix');
}

console.log('\ntownMatchesLot: edge cases');
{
  assert(townMatchesLot({ address: 'anywhere' }, ''), 'empty town matches everything');
  assert(townMatchesLot({ address: 'anywhere' }, '   '), 'whitespace town matches everything');
  assert(!townMatchesLot({ address: 'anywhere', postcode: 'BS1 5HX' }, 'NotARealTown'),
    'unknown town with no address hit returns false');
  assert(townMatchesLot({ address: 'BS1 5HX premises', postcode: '' }, 'Bristol'),
    'falls back to address-extracted area when postcode field is empty');
  assert(getPostcodeArea('bs16 7jq') === 'BS', 'getPostcodeArea is case-insensitive');
  assert(getPostcodeArea('') === '', 'getPostcodeArea handles empty input');
  assert(getPostcodeArea('not-a-postcode') === '', 'getPostcodeArea rejects non-postcodes');
  assert(typeof TOWN_POSTCODE_PREFIXES.bristol !== 'undefined' && TOWN_POSTCODE_PREFIXES.bristol[0] === 'BS',
    'bristol → BS in lookup table');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
