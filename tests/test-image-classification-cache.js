// tests/test-image-classification-cache.js — the per-URL image_classifications
// cache in lib/pipeline/image-quality-filter.js. Verifies: (1) a cache hit
// short-circuits the vision call; (2) a real verdict is written; (3) the
// fail-open 'unknown' returns are NEVER cached (the regression guard against
// re-creating the hollismorgan CDN-403 poisoning); (4) a cache-read error
// degrades to a live classify.
//
// Offline-safe: Supabase .from() is monkeypatched and global.fetch is stubbed,
// so no network/API key is needed.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

// Dynamic import AFTER the env vars are set — a static import would be hoisted
// above the assignments and supabase.js would throw "supabaseUrl is required".
const { supabase } = await import('../lib/supabase.js');

// ── Controllable Supabase stub (shared singleton — same instance the filter imports) ──
let _cacheHit = null;     // data returned by select(...).maybeSingle()
let _upserts = [];        // rows passed to upsert()
let _readThrows = false;  // simulate a DB read failure
function installSupabaseStub() {
  supabase.from = () => {
    const q = {
      select: () => { if (_readThrows) throw new Error('db down'); return q; },
      eq: () => q,
      maybeSingle: async () => ({ data: _cacheHit, error: null }),
      upsert: (row) => { _upserts.push(row); return Promise.resolve({ error: null }); },
    };
    return q;
  };
}
installSupabaseStub();

const { classifyImage, __resetImageFilterBreakerForTest } = await import('../lib/pipeline/image-quality-filter.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const realFetch = global.fetch;
function reset() { _cacheHit = null; _upserts = []; _readThrows = false; __resetImageFilterBreakerForTest(); installSupabaseStub(); }

// Returns a fetch stub: image fetch → bytes; openrouter call → the given content.
function visionStub(content, counter) {
  return async (url) => {
    if (counter) counter.n++;
    if (String(url).includes('openrouter.ai')) {
      return { ok: true, json: async () => ({ choices: [{ message: { content } }], model: 'google/gemini-2.5-flash-lite', usage: {} }) };
    }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8), headers: { get: () => 'image/jpeg' } };
  };
}

console.log('Test 1: cache hit returns the stored verdict with no vision call');
{
  reset();
  process.env.OPENROUTER_API_KEY = 'test-key';
  _cacheHit = { verdict: 'property_photo', confidence: 'high', reason: 'cached', is_primary: true };
  const counter = { n: 0 };
  global.fetch = async () => { counter.n++; throw new Error('should not be called on a cache hit'); };
  const r = await classifyImage('https://x.invalid/cached.jpg');
  global.fetch = realFetch;
  assert(r && r.verdict === 'property_photo' && r.reason === 'cached', 'returns the cached verdict');
  assert(counter.n === 0, `no network on a cache hit (got ${counter.n} fetches)`);
  assert(_upserts.length === 0, 'no re-write on a cache hit');
}

console.log('\nTest 2: cache miss + real verdict is written through');
{
  reset();
  process.env.OPENROUTER_API_KEY = 'test-key';
  global.fetch = visionStub('{"verdict":"logo","confidence":"high","reason":"company logo","is_primary":false}');
  const r = await classifyImage('https://x.invalid/logo.png');
  global.fetch = realFetch;
  assert(r && r.verdict === 'logo', `returns the parsed verdict (got ${r && r.verdict})`);
  assert(_upserts.length === 1, `cached exactly once (got ${_upserts.length})`);
  assert(_upserts[0] && _upserts[0].verdict === 'logo' && _upserts[0].image_url === 'https://x.invalid/logo.png' && !!_upserts[0].model, 'cache row has url+verdict+model');
}

console.log('\nTest 3 (CRITICAL): an unparseable response fails open and is NOT cached');
{
  reset();
  process.env.OPENROUTER_API_KEY = 'test-key';
  global.fetch = visionStub('not json at all, just prose');
  const r = await classifyImage('https://x.invalid/weird.jpg');
  global.fetch = realFetch;
  assert(r && r.verdict === 'unknown', 'fails open to unknown');
  assert(_upserts.length === 0, 'fail-open unknown is NOT cached (no poisoning)');
}

console.log('\nTest 4 (CRITICAL): quota-cooldown returns unknown and is NOT cached');
{
  reset();
  process.env.OPENROUTER_API_KEY = 'test-key';
  global.fetch = async () => { throw new Error('[429] You exceeded your current quota'); };
  await classifyImage('https://x.invalid/a.jpg'); // trips the breaker (fail-open, not cached)
  const r = await classifyImage('https://x.invalid/b.jpg'); // breaker open → cooldown path
  global.fetch = realFetch;
  assert(r && r.verdict === 'unknown' && /cooldown/.test(r.reason), 'cooldown returns unknown');
  assert(_upserts.length === 0, 'neither the 429 nor the cooldown verdict is cached');
}

console.log('\nTest 5: a cache-read error degrades to a live classify');
{
  reset();
  process.env.OPENROUTER_API_KEY = 'test-key';
  _readThrows = true; // getCachedClassification select() throws → treated as a miss
  const counter = { n: 0 };
  global.fetch = visionStub('{"verdict":"property_photo","confidence":"high","reason":"front shot","is_primary":true}', counter);
  const r = await classifyImage('https://x.invalid/c.jpg');
  global.fetch = realFetch;
  assert(r && r.verdict === 'property_photo', 'classifies live when the cache read fails');
  assert(counter.n > 0, 'the vision path ran (cache miss)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
