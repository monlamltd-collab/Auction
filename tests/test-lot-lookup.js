/**
 * Pure-function tests for the dual-read helper at lib/pipeline/lot-lookup.js.
 * Uses a stubbed Supabase client that records the chained query so tests can
 * assert which read path was taken (auction_id vs legacy (house, catalogue_url)).
 *
 * Run: node tests/test-lot-lookup.js
 */

import {
  getLotsForCatalogue,
  getLotsForCatalogues,
  _partitionCatalogues,
} from '../lib/pipeline/lot-lookup.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// ── Stub Supabase ─────────────────────────────────────────────────────
// Records each .from/.select/.eq/.in call. Resolves to { data, error } shape
// when awaited so callers see the real Supabase contract.
function makeStubSupabase({ rows = [], error = null } = {}) {
  const queries = [];
  let current = null;
  const builder = {
    from(table) {
      current = { table, select: null, eqs: [], ins: [] };
      queries.push(current);
      return builder;
    },
    select(cols) {
      current.select = cols;
      return builder;
    },
    eq(col, val) {
      current.eqs.push([col, val]);
      return builder;
    },
    in(col, vals) {
      current.ins.push([col, vals]);
      return builder;
    },
    then(resolve) {
      // Awaiting the builder resolves to { data, error } — match Supabase contract.
      resolve({ data: rows, error });
    },
  };
  return { builder, queries };
}

console.log('Test 1: getLotsForCatalogue with auctionId → prefers auction_id path');
{
  const { builder, queries } = makeStubSupabase({ rows: [{ id: 'a' }] });
  await getLotsForCatalogue(builder, {
    house: 'allsop',
    catalogueUrl: 'https://allsop.co.uk/auctions/may-2026',
    auctionId: 'aaaa-bbbb-cccc',
  });
  assert(queries.length === 1, 'one query issued');
  assert(queries[0].table === 'lots', 'queried lots table');
  assert(queries[0].select === '*', 'default select is *');
  assert(queries[0].eqs.length === 1, 'only one .eq() call (the auction_id one)');
  assert(queries[0].eqs[0][0] === 'auction_id', 'eq column is auction_id');
  assert(queries[0].eqs[0][1] === 'aaaa-bbbb-cccc', 'eq value is the auction id');
}

console.log('\nTest 2: getLotsForCatalogue without auctionId → legacy (house, catalogue_url) path');
{
  const { builder, queries } = makeStubSupabase({ rows: [{ id: 'a' }] });
  await getLotsForCatalogue(builder, {
    house: 'allsop',
    catalogueUrl: 'https://www.allsop.co.uk/auctions/may-2026/',
  });
  assert(queries.length === 1, 'one query issued');
  assert(queries[0].eqs.length === 2, 'two .eq() calls (house + catalogue_url)');
  const eqMap = Object.fromEntries(queries[0].eqs);
  assert(eqMap.house === 'allsop', 'house eq set');
  assert(eqMap.catalogue_url === 'https://allsop.co.uk/auctions/may-2026', `catalogue_url normalised (got ${eqMap.catalogue_url})`);
}

console.log('\nTest 3: getLotsForCatalogue treats null/undefined auctionId as legacy');
{
  for (const id of [null, undefined, '']) {
    const { builder, queries } = makeStubSupabase();
    await getLotsForCatalogue(builder, {
      house: 'allsop',
      catalogueUrl: 'https://allsop.co.uk/x',
      auctionId: id,
    });
    assert(queries[0].eqs.length === 2, `falsy id (${id === '' ? "''" : id}) → legacy path`);
  }
}

console.log('\nTest 4: getLotsForCatalogue passes select string through');
{
  const { builder, queries } = makeStubSupabase();
  await getLotsForCatalogue(builder, {
    house: 'allsop',
    catalogueUrl: 'https://allsop.co.uk/x',
    select: 'id, house, catalogue_url',
  });
  assert(queries[0].select === 'id, house, catalogue_url', 'select string forwarded');
}

console.log('\nTest 5: _partitionCatalogues — partitions, dedups, skips null/missing');
{
  const out = _partitionCatalogues([
    { url: 'https://A.com/x/', auctionId: 'id-1' },
    { url: 'https://b.com/y', auctionId: 'id-2' },
    { url: 'https://c.com/z' },                           // no id → URL bucket
    { url: 'HTTPS://B.com/y', auctionId: 'id-2' },        // dup id
    { url: 'https://c.com/z' },                           // dup URL (post-normalise)
    null,                                                  // ignored
    { url: '', auctionId: 'id-3' },                       // ignored — no URL
    { url: 'https://d.com/w' },                           // distinct URL
  ]);
  assert(out.auctionIds.length === 2, `2 distinct auction_ids (got ${out.auctionIds.length})`);
  assert(out.auctionIds.includes('id-1') && out.auctionIds.includes('id-2'), 'both ids present');
  assert(out.urls.length === 2, `2 distinct URLs (got ${out.urls.length})`);
  assert(out.urls.includes('https://c.com/z'), 'c.com/z in URL bucket');
  assert(out.urls.includes('https://d.com/w'), 'd.com/w in URL bucket');
  assert(!out.urls.some(u => u.toLowerCase() !== u), 'all URLs normalised to lower-case');
}

console.log('\nTest 6: _partitionCatalogues — empty / null input');
{
  const e1 = _partitionCatalogues([]);
  assert(e1.auctionIds.length === 0 && e1.urls.length === 0, 'empty array → empty buckets');
  const e2 = _partitionCatalogues(null);
  assert(e2.auctionIds.length === 0 && e2.urls.length === 0, 'null input → empty buckets');
  const e3 = _partitionCatalogues(undefined);
  assert(e3.auctionIds.length === 0 && e3.urls.length === 0, 'undefined input → empty buckets');
}

console.log('\nTest 7: getLotsForCatalogues — mixed has-id / no-id issues two queries');
{
  const { builder, queries } = makeStubSupabase({ rows: [{ id: 'a' }, { id: 'b' }] });
  await getLotsForCatalogues(builder, [
    { url: 'https://a.com/x', auctionId: 'id-1' },
    { url: 'https://b.com/y' },
  ]);
  assert(queries.length === 2, 'two queries issued (auction_id + catalogue_url)');
  const inBuckets = queries.map(q => q.ins[0][0]);
  assert(inBuckets.includes('auction_id'), 'one query uses .in(auction_id)');
  assert(inBuckets.includes('catalogue_url'), 'other uses .in(catalogue_url)');
}

console.log('\nTest 8: getLotsForCatalogues — all have ids → only auction_id query');
{
  const { builder, queries } = makeStubSupabase();
  await getLotsForCatalogues(builder, [
    { url: 'https://a.com/x', auctionId: 'id-1' },
    { url: 'https://b.com/y', auctionId: 'id-2' },
  ]);
  assert(queries.length === 1, 'one query issued');
  assert(queries[0].ins[0][0] === 'auction_id', 'in column = auction_id');
  assert(queries[0].ins[0][1].length === 2, '2 ids in the .in() array');
}

console.log('\nTest 9: getLotsForCatalogues — none have ids → only catalogue_url query');
{
  const { builder, queries } = makeStubSupabase();
  await getLotsForCatalogues(builder, [
    { url: 'https://A.com/X/' },
    { url: 'https://b.com/y' },
  ]);
  assert(queries.length === 1, 'one query issued');
  assert(queries[0].ins[0][0] === 'catalogue_url', 'in column = catalogue_url');
  assert(queries[0].ins[0][1].includes('https://a.com/x'), 'URL normalised to lower-case + no trailing slash');
}

console.log('\nTest 10: getLotsForCatalogues — empty input → empty result, no queries');
{
  const { builder, queries } = makeStubSupabase();
  const r = await getLotsForCatalogues(builder, []);
  assert(queries.length === 0, 'no queries for empty input');
  assert(Array.isArray(r.data) && r.data.length === 0, 'data = []');
  assert(r.error === null, 'error = null');
}

console.log('\nTest 11: getLotsForCatalogues — dedups rows by id across both queries');
{
  // Stub returns the same row id from both queries (the row's auction_id and catalogue_url
  // both match — possible during the dual-read window).
  let callCount = 0;
  const builder = {
    from() { return builder; },
    select() { return builder; },
    in() { return builder; },
    eq() { return builder; },
    then(resolve) {
      callCount++;
      // First call returns rows [{id:'a'}, {id:'b'}]; second returns [{id:'b'}, {id:'c'}].
      // After dedup: a, b, c.
      if (callCount === 1) resolve({ data: [{ id: 'a' }, { id: 'b' }], error: null });
      else resolve({ data: [{ id: 'b' }, { id: 'c' }], error: null });
    },
  };
  const r = await getLotsForCatalogues(builder, [
    { url: 'https://a.com/x', auctionId: 'id-1' },
    { url: 'https://b.com/y' },
  ]);
  assert(r.data.length === 3, `dedup'd to 3 rows (got ${r.data.length})`);
  const ids = r.data.map(x => x.id).sort();
  assert(ids.join(',') === 'a,b,c', `ids = a,b,c (got ${ids.join(',')})`);
}

console.log('\nTest 12: getLotsForCatalogues — surfaces first error across queries');
{
  let callCount = 0;
  const builder = {
    from() { return builder; },
    select() { return builder; },
    in() { return builder; },
    eq() { return builder; },
    then(resolve) {
      callCount++;
      if (callCount === 1) resolve({ data: [{ id: 'a' }], error: null });
      else resolve({ data: null, error: { message: 'boom' } });
    },
  };
  const r = await getLotsForCatalogues(builder, [
    { url: 'https://a.com/x', auctionId: 'id-1' },
    { url: 'https://b.com/y' },
  ]);
  assert(r.error && r.error.message === 'boom', 'error from second query surfaced');
  assert(r.data.length === 1, 'partial data still returned');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
