/**
 * Pure-function tests for lib/pipeline/snapshots.js (Move 3 Phase 3a).
 *
 * Run: node tests/test-snapshots.js
 */

import {
  buildLotUrlSet,
  computeContentHash,
  deriveScrapeStatus,
  writeSnapshot,
} from '../lib/pipeline/snapshots.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log('Test 1: buildLotUrlSet — normalises, dedups, sorts');
{
  const out = buildLotUrlSet([
    { url: 'https://EXAMPLE.com/lot/3/' },
    { url: 'https://example.com/lot/1' },
    { url: 'http://example.com/lot/2' },         // http → https
    { url: 'https://www.example.com/lot/3' },    // www. + dup of #1 after normalise
    { url: null },
    { url: '' },
    null,
  ]);
  assert(out.length === 3, `3 unique URLs (got ${out.length})`);
  assert(out[0] === 'https://example.com/lot/1', `sorted, first = lot/1 (got ${out[0]})`);
  assert(out[1] === 'https://example.com/lot/2', 'second = lot/2');
  assert(out[2] === 'https://example.com/lot/3', 'third = lot/3 (dedupped EXAMPLE.com + www. variants)');
}

console.log('\nTest 2: buildLotUrlSet — preserves synthetic URLs as-is');
{
  const out = buildLotUrlSet([
    { url: '__synthetic__allsop__1_high_street__250000' },
    { url: '__synthetic__allsop__1_high_street__250000' }, // dup
    { url: 'https://allsop.co.uk/lot/1' },
  ]);
  assert(out.length === 2, 'synthetic + real URL = 2 entries');
  assert(out.some(u => u.startsWith('__synthetic__')), 'synthetic preserved verbatim (no normalisation)');
}

console.log('\nTest 3: buildLotUrlSet — empty / null input');
{
  assert(buildLotUrlSet([]).length === 0, '[] → empty');
  assert(buildLotUrlSet(null).length === 0, 'null → empty');
  assert(buildLotUrlSet(undefined).length === 0, 'undefined → empty');
  assert(buildLotUrlSet([null, undefined, {}, { url: '' }]).length === 0, 'rows with no urls → empty');
}

console.log('\nTest 4: computeContentHash — deterministic + stable');
{
  const set = ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'];
  const h1 = computeContentHash(set);
  const h2 = computeContentHash(set);
  assert(h1 === h2, 'same input → same hash');
  assert(/^[0-9a-f]{64}$/.test(h1), `hex sha256 shape (got ${h1.slice(0, 16)}…)`);
}

console.log('\nTest 5: computeContentHash — different sets → different hashes');
{
  const a = computeContentHash(['https://a.com/1', 'https://a.com/2']);
  const b = computeContentHash(['https://a.com/1', 'https://a.com/3']);
  const c = computeContentHash([]);
  assert(a !== b, 'different sets differ');
  assert(a !== c, 'non-empty vs empty differ');
}

console.log('\nTest 6: computeContentHash — order-sensitive (buildLotUrlSet sorts first)');
{
  // The contract: buildLotUrlSet outputs sorted; computeContentHash hashes
  // verbatim. So callers MUST go through buildLotUrlSet for stable hashing.
  const sorted = computeContentHash(['a', 'b', 'c']);
  const reversed = computeContentHash(['c', 'b', 'a']);
  assert(sorted !== reversed, 'order matters for raw input (caller responsibility to sort)');
}

console.log('\nTest 7: deriveScrapeStatus — unchanged when hashes match');
{
  assert(deriveScrapeStatus('abc', 'abc') === 'unchanged', 'matching hashes → unchanged');
  assert(deriveScrapeStatus('abc', 'def') === 'full', 'different hashes → full');
  assert(deriveScrapeStatus('abc', null) === 'full', 'no previous → full');
  assert(deriveScrapeStatus('abc', undefined) === 'full', 'undefined previous → full');
  assert(deriveScrapeStatus('abc', '') === 'full', 'empty-string previous → full');
}

console.log('\nTest 8: writeSnapshot — skips entirely when auctionId is null');
{
  let inserts = 0;
  const stub = {
    from() { return stub; },
    select() { return stub; },
    eq() { return stub; },
    order() { return stub; },
    limit() { return stub; },
    maybeSingle() { return Promise.resolve({ data: null }); },
    insert() { inserts++; return Promise.resolve({ error: null }); },
  };
  const r = await writeSnapshot(stub, { auctionId: null, rows: [{ url: 'https://x.com/1' }] });
  assert(r.written === false, 'returns written=false');
  assert(r.hash === null, 'returns hash=null');
  assert(inserts === 0, 'no insert attempted');
}

console.log('\nTest 9: writeSnapshot — full path when hash differs from previous');
{
  let inserted = null;
  const stub = {
    from() { return stub; },
    select() { return stub; },
    eq() { return stub; },
    order() { return stub; },
    limit() { return stub; },
    maybeSingle() { return Promise.resolve({ data: { content_hash: 'oldhash' } }); },
    insert(payload) { inserted = payload; return Promise.resolve({ error: null }); },
  };
  const r = await writeSnapshot(stub, {
    auctionId: 'aid-1',
    rows: [{ url: 'https://x.com/1' }, { url: 'https://x.com/2' }],
    extractedWith: 'firecrawl-json',
    scrapedWith: 'firecrawl',
  });
  assert(r.written === true, 'written=true');
  assert(r.status === 'full', 'status=full (new hash differs from oldhash)');
  assert(inserted && inserted.auction_id === 'aid-1', 'auction_id set');
  assert(inserted.lot_count === 2, 'lot_count = 2');
  assert(inserted.lot_url_set.length === 2, 'lot_url_set has 2 entries');
  assert(inserted.scrape_status === 'full', 'inserted with status=full');
  assert(inserted.extracted_with === 'firecrawl-json', 'extracted_with passed through');
  assert(inserted.scraped_with === 'firecrawl', 'scraped_with passed through');
}

console.log('\nTest 10: writeSnapshot — unchanged status when hash matches previous');
{
  // Pre-compute the hash the writer will produce for [https://x.com/1]
  const expectedHash = computeContentHash(buildLotUrlSet([{ url: 'https://x.com/1' }]));
  let inserted = null;
  const stub = {
    from() { return stub; },
    select() { return stub; },
    eq() { return stub; },
    order() { return stub; },
    limit() { return stub; },
    maybeSingle() { return Promise.resolve({ data: { content_hash: expectedHash } }); },
    insert(payload) { inserted = payload; return Promise.resolve({ error: null }); },
  };
  const r = await writeSnapshot(stub, { auctionId: 'aid-1', rows: [{ url: 'https://x.com/1' }] });
  assert(r.status === 'unchanged', 'status=unchanged on hash match');
  assert(inserted.scrape_status === 'unchanged', 'inserted with status=unchanged');
}

console.log('\nTest 11: writeSnapshot — statusOverride wins');
{
  let inserted = null;
  const stub = {
    from() { return stub; },
    select() { return stub; },
    eq() { return stub; },
    order() { return stub; },
    limit() { return stub; },
    maybeSingle() { return Promise.resolve({ data: null }); },
    insert(payload) { inserted = payload; return Promise.resolve({ error: null }); },
  };
  const r = await writeSnapshot(stub, { auctionId: 'aid-1', rows: [], statusOverride: 'partial' });
  assert(r.status === 'partial', 'override returned');
  assert(inserted.scrape_status === 'partial', 'override persisted');
}

console.log('\nTest 12: writeSnapshot — insert error is non-fatal, returns written=false');
{
  const stub = {
    from() { return stub; },
    select() { return stub; },
    eq() { return stub; },
    order() { return stub; },
    limit() { return stub; },
    maybeSingle() { return Promise.resolve({ data: null }); },
    insert() { return Promise.resolve({ error: { message: 'boom' } }); },
  };
  const r = await writeSnapshot(stub, { auctionId: 'aid-1', rows: [{ url: 'https://x.com/1' }] });
  assert(r.written === false, 'written=false on insert error');
  assert(r.hash !== null, 'hash still computed and returned');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
