// tests/test-image-classification-cache.js — the follow-up saving to the
// flash-lite fix: a per-image-URL classification cache so a given image is
// never sent to the vision model twice (image-classify was ~99% of flash-lite
// spend). Contract:
//   • A cache HIT returns the stored verdict and makes NO vision call.
//   • A cache MISS classifies once, then writes the verdict back.
//   • Only AFFIRMATIVE verdicts are cached — 'unknown' (fail-open transient
//     failure) is never written, so it is retried next time.
//
// Offline-safe: a mock `db` is injected and global.fetch is stubbed, so no
// network, API key, or real Supabase is touched.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = 'test-key';            // route through the OpenRouter vision path
delete process.env.IMAGE_CLASSIFICATION_CACHE;          // ensure the cache is ON

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const { filterImages, classifyImage } = await import('../lib/pipeline/image-quality-filter.js');

// Mock supabase client for the `image_classifications` table. Supports the two
// shapes the cache uses: `.select(...).in('url', urls).gt(...)` (read, thenable)
// and `.upsert(row, opts)` (write, returns a promise). Rows live in `store`.
function mockDb() {
  const store = new Map();
  return {
    store,
    from() {
      let selUrls = null;
      const q = {
        select() { return q; },
        in(_col, urls) { selUrls = urls; return q; },
        gt() { return q; },
        upsert(row) { store.set(row.url, row); return Promise.resolve({ error: null }); },
        then(res, rej) {
          const data = (selUrls || []).filter(u => store.has(u)).map(u => {
            const r = store.get(u);
            return { url: u, verdict: r.verdict, confidence: r.confidence, is_primary: r.is_primary, reason: r.reason };
          });
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
}

// Stub fetch: OpenRouter POST → configurable verdict (counted); anything else
// (the image fetch) → a fake JPEG, unless the URL contains 'bad' → HTTP 403.
let visionCalls = 0;
let visionVerdict = '{"verdict":"property_photo","confidence":"high","reason":"exterior","is_primary":true}';
const origFetch = global.fetch;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('openrouter.ai')) {
    visionCalls++;
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        model: 'google/gemini-2.5-flash-lite',
        choices: [{ message: { content: visionVerdict } }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      }),
    };
  }
  if (u.includes('bad')) return { ok: false, status: 403, headers: { get: () => 'image/jpeg' }, text: async () => '' };
  return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
};

try {
  console.log('Test 1: a cache MISS classifies once and writes the verdict back');
  {
    const db = mockDb();
    const r = await filterImages(['https://cdn.test/a.jpg'], { db });
    assert(visionCalls === 1, `vision called once on miss (got ${visionCalls})`);
    assert(r.keep.includes('https://cdn.test/a.jpg'), 'property_photo is kept');
    assert(db.store.has('https://cdn.test/a.jpg'), 'verdict written to cache');
    assert(db.store.get('https://cdn.test/a.jpg').verdict === 'property_photo', 'cached verdict is property_photo');
  }

  console.log('\nTest 2: a cache HIT reuses the verdict with NO vision call');
  {
    const db = mockDb();
    await filterImages(['https://cdn.test/b.jpg'], { db });   // warm the cache (vision call #2)
    const before = visionCalls;
    const r = await filterImages(['https://cdn.test/b.jpg'], { db });   // now a hit
    assert(visionCalls === before, `no additional vision call on hit (before ${before}, after ${visionCalls})`);
    assert(r.keep.includes('https://cdn.test/b.jpg'), 'cached property_photo still kept');
  }

  console.log('\nTest 3: classifyImage single-URL path also hits the cache');
  {
    const db = mockDb();
    await classifyImage('https://cdn.test/c.jpg', { db });    // miss → classify + write
    const before = visionCalls;
    const v = await classifyImage('https://cdn.test/c.jpg', { db });   // hit
    assert(visionCalls === before, `single-URL cache hit makes no vision call (before ${before}, after ${visionCalls})`);
    assert(v._cached === true && v.verdict === 'property_photo', 'returns the cached verdict');
  }

  console.log("\nTest 4: 'unknown' (transient failure) is NEVER cached");
  {
    const db = mockDb();
    const r1 = await filterImages(['https://cdn.test/bad.jpg'], { db });   // image fetch 403 → unknown
    assert(!db.store.has('https://cdn.test/bad.jpg'), 'unknown verdict not written to cache');
    assert(r1.keep.includes('https://cdn.test/bad.jpg'), "unknown fails open (kept)");
    const before = visionCalls;
    await filterImages(['https://cdn.test/bad.jpg'], { db });    // still a miss → retried
    assert(visionCalls >= before, 'a previously-unknown URL is retried, not served from cache');
  }
} finally {
  global.fetch = origFetch;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
