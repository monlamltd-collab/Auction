// tests/test-openrent.js — locks the contract for the selector-free
// OpenRent parser. The live scraper hits Firecrawl; this test runs the
// PURE parsing function (parseOpenRentHtml) against a hand-crafted
// fixture that mimics OpenRent's listing-card shape. If OpenRent
// redesigns their class names, the parser keeps working — this test
// proves it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Stub env vars so the supabase shim doesn't error out when the module
// graph touches lib/scraper.js (which imports state).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { parseOpenRentHtml } = await import('../lib/rentals/openrent.js');

const html = readFileSync(join(here, 'fixtures', 'openrent-bs1.html'), 'utf8');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

console.log('\nparseOpenRentHtml: selector-free fixture');
const { listings, areaLabel } = parseOpenRentHtml(html, 'BS1 4AB');

assert(Array.isArray(listings), 'returns a listings array');
assert(areaLabel === 'BS1 4AB', 'area label echoes the postcode');

// Expected: ids 2156789, 2156790, 2156791 (pw → pcm), 2156792, 2156794.
// Skipped: 2156793 (no price), 2156795 (deposit only, no pcm/pw qualifier).
// Deduped: 2156789 only once.
const ids = listings.map(l => l.source_id).sort();
assert(JSON.stringify(ids) === JSON.stringify(['2156789', '2156790', '2156791', '2156792', '2156794']),
  `expected 5 listings (got ${ids.length}: ${ids.join(',')})`);

const byId = Object.fromEntries(listings.map(l => [l.source_id, l]));

console.log('\nparseOpenRentHtml: rent extraction');
assert(byId['2156789']?.rent_pcm === 1450, '2 bed flat → £1,450 pcm');
assert(byId['2156790']?.rent_pcm === 950, 'studio → £950 pcm');
// pw → pcm: 250 × 52 / 12 = 1083.33 → round to 1083
assert(byId['2156791']?.rent_pcm === 1083, '£250 pw → £1,083 pcm');
assert(byId['2156792']?.rent_pcm === 2200, '4 bed house → £2,200 pcm');
// Range "£1,200 to £1,400 pcm" → lower bound (1200)
assert(byId['2156794']?.rent_pcm === 1200, 'range price → lower bound (£1,200)');

console.log('\nparseOpenRentHtml: bed + property type');
assert(byId['2156789']?.beds === 2 && byId['2156789']?.property_type === 'flat',
  '2156789: 2 beds, flat');
assert(byId['2156790']?.beds === 0 && byId['2156790']?.property_type === 'studio',
  '2156790: studio (beds=0)');
assert(byId['2156791']?.beds === 3 && byId['2156791']?.property_type === 'room',
  '2156791: 3 bed house share → property_type=room');
assert(byId['2156791']?.is_room_share === true,
  '2156791: is_room_share true (house share + room type)');
assert(byId['2156792']?.beds === 4 && byId['2156792']?.property_type === 'house',
  '2156792: 4 beds, house');

console.log('\nparseOpenRentHtml: defensive cases');
assert(parseOpenRentHtml('', 'BS1 4AB').listings.length === 0,
  'empty HTML → empty listings');
assert(parseOpenRentHtml('<html><body><a href="/login">Login</a></body></html>', 'BS1 4AB').listings.length === 0,
  'no numeric listing links → empty listings');
assert(!byId['2156793'], 'listing without price was skipped');
assert(!byId['2156795'], 'deposit-only listing (no pcm/pw qualifier) was skipped');

// URL shape — every listing's url is canonical /{id}/ form
for (const l of listings) {
  assert(l.url === `https://www.openrent.co.uk/${l.source_id}/`,
    `${l.source_id}: canonical url`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
