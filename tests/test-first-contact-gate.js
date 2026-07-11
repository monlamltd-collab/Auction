// tests/test-first-contact-gate.js — regression for the flash-lite cost blow-out.
//
// flagFirstContact() gates the vision image-quality filter: only lots whose URL
// is NOT already in the `lots` table are classified. The membership check used a
// single `.in('url', allUrls)` — for a dense house (purplebricksgoto ~2,900
// available lots) that GET query overflowed the URL-length limit → HTTP 414 →
// supabase returned `{ data: null, error }`. The code destructured only
// `{ data }`, so the error was swallowed, the known-set came back empty, and
// EVERY lot was flagged first-contact → every image re-classified on every
// scrape (image-classify was ~99% of flash-lite spend, ~$90/mo).
//
// Contract now:
//   • The lookup is BATCHED (≤200 URLs/request) so it never 414s.
//   • On a batch error we fail CLOSED (treat as already-known), never open.
//
// Offline-safe: uses a mock supabase client injected via the `db` param.

// Stub Supabase creds so lib/supabase.js can construct its client at import;
// the tests inject a mock `db` and never touch the real module client.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const { flagFirstContact } = await import('../lib/pipeline/enrich-stage.js');

// Mock supabase query builder. `knownUrls` are rows that exist in the DB;
// `errorOnBatch(batch)` may return an Error to simulate a failed lookup.
// Records every `.in()` batch size so we can assert batching happened.
function mockDb({ knownUrls = new Set(), errorOnBatch = () => null } = {}) {
  const batchSizes = [];
  return {
    batchSizes,
    from() {
      const q = {
        select() { return q; },
        eq() { return q; },
        in(_col, batch) {
          batchSizes.push(batch.length);
          const err = errorOnBatch(batch);
          if (err) return Promise.resolve({ data: null, error: err });
          const data = batch.filter(u => knownUrls.has(u)).map(u => ({ url: u }));
          return Promise.resolve({ data, error: null });
        },
      };
      return q;
    },
  };
}

const mkLots = (n, prefix = 'https://x.test/lot/') =>
  Array.from({ length: n }, (_, i) => ({ url: `${prefix}${i}`, house: 'x' }));

console.log('Test 1: a dense catalogue is looked up in ≤200-URL batches (never one giant .in())');
{
  const lots = mkLots(2900);
  const db = mockDb();
  await flagFirstContact(lots, 'x', db);
  assert(db.batchSizes.length === Math.ceil(2900 / 200), `15 batches for 2900 URLs (got ${db.batchSizes.length})`);
  assert(Math.max(...db.batchSizes) <= 200, `no batch exceeds 200 URLs (got max ${Math.max(...db.batchSizes)})`);
}

console.log('\nTest 2: only genuinely-new URLs are flagged first-contact');
{
  const lots = mkLots(300);
  // Half are already in the DB.
  const known = new Set(lots.slice(0, 150).map(l => l.url));
  const db = mockDb({ knownUrls: known });
  await flagFirstContact(lots, 'x', db);
  const flagged = lots.filter(l => l._isFirstContact).length;
  assert(flagged === 150, `150 new lots flagged, 150 known skipped (got ${flagged})`);
  assert(lots.slice(0, 150).every(l => !l._isFirstContact), 'known lots are NOT flagged');
  assert(lots.slice(150).every(l => l._isFirstContact), 'new lots ARE flagged');
}

console.log('\nTest 3: a failed lookup fails CLOSED — lots are NOT flagged (no reclassification storm)');
{
  const lots = mkLots(300);
  // Every batch errors, mimicking the 414 / transient DB failure.
  const db = mockDb({ errorOnBatch: () => new Error('414 Request-URI Too Large') });
  await flagFirstContact(lots, 'x', db);
  const flagged = lots.filter(l => l._isFirstContact).length;
  assert(flagged === 0, `zero lots flagged on lookup failure (got ${flagged}) — the old bug flagged all ${lots.length}`);
}

console.log('\nTest 4: a partial failure only fails closed for the failing batch');
{
  const lots = mkLots(400); // 2 batches: [0..200), [200..400)
  // Fail the FIRST batch only (contains lot/0..lot/199); second batch succeeds
  // and none of its URLs are known → those 200 should be flagged first-contact.
  const db = mockDb({ errorOnBatch: (batch) => (batch.includes('https://x.test/lot/0') ? new Error('boom') : null) });
  await flagFirstContact(lots, 'x', db);
  const flagged = lots.filter(l => l._isFirstContact).length;
  assert(flagged === 200, `only the healthy batch's 200 lots flagged (got ${flagged})`);
}

console.log('\nTest 5: no supabase client → all first-contact (offline/test depth boost preserved)');
{
  const lots = mkLots(5);
  await flagFirstContact(lots, 'x', null);
  assert(lots.every(l => l._isFirstContact), 'all flagged when db is null');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
