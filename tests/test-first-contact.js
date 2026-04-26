// tests/test-first-contact.js — locks the contract for snapshot_hash + field_sources merge.
//
// These two helpers underpin Phase A's first-contact pipeline:
//  - computeSnapshotHash decides whether lot_history gets an append-only row
//    (rerun-stable when nothing changed; differs when meaningful fields change).
//  - mergeFieldSources keeps prior provenance stamps alive when this run
//    didn't re-stamp the same field, while letting fresh stamps win.
//
// We exercise the helpers directly — no Supabase needed — but stub env vars
// before importing in case the module graph touches lib/supabase.js (the same
// shim used in tests/test-os-places.js).

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { computeSnapshotHash, mergeFieldSources } = await import('../lib/pipeline/persist-lots.js');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

console.log('\ncomputeSnapshotHash');
{
  const row = { price: 250000, status: 'available', sold_price: null, bullets_count: 4, image_count: 1 };
  const h1 = computeSnapshotHash(row);
  const h2 = computeSnapshotHash({ ...row });
  assert(h1 === h2, 'stable across identical inputs');
  assert(typeof h1 === 'string' && h1.length === 16, 'returns 16-char hex string');

  const dropped = computeSnapshotHash({ ...row, price: 225000 });
  assert(dropped !== h1, 'differs when price changes (drives price-drop alerts)');

  const moreBullets = computeSnapshotHash({ ...row, bullets_count: 5 });
  assert(moreBullets !== h1, 'differs when bullets_count changes');

  const sold = computeSnapshotHash({ ...row, status: 'sold', sold_price: 240000 });
  assert(sold !== h1, 'differs when status flips to sold');

  // Null/undefined handling — bullets_count + image_count default to 0 so a
  // freshly-minted lot still gets a deterministic hash.
  const sparse = computeSnapshotHash({ price: 100000, status: 'available' });
  assert(typeof sparse === 'string' && sparse.length === 16, 'tolerates missing bullets_count/image_count');
}

console.log('\nmergeFieldSources');
{
  const merged = mergeFieldSources({ beds: 'epc' }, { tenure: 'os-places' });
  assert(merged.beds === 'epc' && merged.tenure === 'os-places',
    'prior stamps survive when current run did not re-stamp');

  const collision = mergeFieldSources({ beds: 'epc' }, { beds: 'gemini-detail' });
  assert(collision.beds === 'gemini-detail', 'current run wins on key collision');

  const fromNothing = mergeFieldSources(null, { beds: 'epc' });
  assert(fromNothing.beds === 'epc', 'tolerates null prior (first-contact lots)');

  const fromBoth = mergeFieldSources(undefined, undefined);
  assert(typeof fromBoth === 'object' && fromBoth !== null && Object.keys(fromBoth).length === 0,
    'returns empty object when both inputs are missing');

  // No mutation — both inputs must be left untouched.
  const a = { beds: 'epc' };
  const b = { tenure: 'os-places' };
  mergeFieldSources(a, b);
  assert(!('tenure' in a) && !('beds' in b), 'does not mutate either input');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
