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
const { findAuctionDateInBullets, parseAuctionDateFromBullet } = await import('../lib/utils.js');

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

// findAuctionDateInBullets — locks the contract for persist-lots.js's auction-date
// resolution. Replaced an inline regex during the LT-* fix-up cycle; if a future
// edit silently re-inlines the parser or drops the helper, these tests catch it.
console.log('\nfindAuctionDateInBullets');
{
  // EIG timed-auction format — the exact format the prior inline regex handled.
  const eigTimed = findAuctionDateInBullets(['Auction Ends: 22/04/2026']);
  assert(eigTimed === '2026-04-22', 'EIG "Auction Ends: DD/MM/YYYY" → ISO YYYY-MM-DD');

  // EIG white-label with full date — pattern 2. Year must be honoured even when
  // `today` is later in the year (proves pattern 3's negative lookahead works
  // and we don't fall through to "next May" resolution).
  const fullDate = findAuctionDateInBullets(
    ['20 May 2026 LIVE ONLINE AUCTION'],
    '2026-09-01',
  );
  assert(fullDate === '2026-05-20', 'full-date bullet honours its year (no rollover to next year)');

  // EIG white-label without year — pattern 3. Resolves to next occurrence ≥ today.
  const noYearFuture = findAuctionDateInBullets(
    ['20 May LIVE ONLINE AUCTION'],
    '2026-01-15',
  );
  assert(noYearFuture === '2026-05-20', 'no-year bullet resolves to current-year May when still upcoming');

  const noYearPast = findAuctionDateInBullets(
    ['20 May LIVE ONLINE AUCTION'],
    '2026-09-01',
  );
  assert(noYearPast === '2027-05-20', 'no-year bullet rolls to next year when current-year date is past');

  // First-match-wins: bullets are usually ordered with the most relevant first.
  const multi = findAuctionDateInBullets(
    ['Reserve £150,000', 'Auction Ends: 03/06/2026', 'Vacant possession'],
  );
  assert(multi === '2026-06-03', 'returns first parseable date in the array');

  // Defensive guards.
  assert(findAuctionDateInBullets(null) === null, 'null bullets → null');
  assert(findAuctionDateInBullets(undefined) === null, 'undefined bullets → null');
  assert(findAuctionDateInBullets('not an array') === null, 'string bullets → null (non-array)');
  assert(findAuctionDateInBullets([]) === null, 'empty array → null');
  assert(findAuctionDateInBullets(['no date here at all']) === null, 'unmatched bullet → null');

  // parseAuctionDateFromBullet directly — non-string input must not throw.
  assert(parseAuctionDateFromBullet(null) === null, 'parseAuctionDateFromBullet(null) safe');
  assert(parseAuctionDateFromBullet(123) === null, 'parseAuctionDateFromBullet(number) safe');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
