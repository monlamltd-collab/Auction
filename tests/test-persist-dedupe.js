// tests/test-persist-dedupe.js — regression for the production write error
// `ON CONFLICT DO UPDATE command cannot affect row a second time`.
//
// The lots upsert conflicts on `url` alone. A single scrape can surface the
// same lot URL twice (pagination overlap, a lot listed under two sections). Two
// rows sharing a url in ONE upsert statement makes Postgres fail the whole
// 50-row batch, silently dropping those lots. dedupeRowsByUrl collapses them
// (keeping the LAST occurrence) before batching.

// Stub Supabase creds so lib/supabase.js constructs its client at import time
// (persist-lots.js imports it). The dedupe helper under test touches no DB.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const { dedupeRowsByUrl } = await import('../lib/pipeline/persist-lots.js');

console.log('Test 1: duplicate URLs collapse to one row, keeping the LAST occurrence');
{
  const rows = [
    { url: 'https://x/a', beds: 1 },
    { url: 'https://x/b', beds: 2 },
    { url: 'https://x/a', beds: 3 },   // later occurrence of /a — should win
  ];
  const out = dedupeRowsByUrl(rows);
  assert(out.length === 2, `2 rows after dedup (got ${out.length})`);
  const a = out.find(r => r.url === 'https://x/a');
  assert(a && a.beds === 3, `kept the LAST /a (beds 3, got ${a && a.beds})`);
}

console.log('\nTest 2: every distinct URL survives exactly once (keep-last puts a repeat in its later slot)');
{
  const rows = [
    { url: 'https://x/a' }, { url: 'https://x/b' }, { url: 'https://x/c' },
    { url: 'https://x/b' }, // dup — kept at its LAST position
  ];
  const out = dedupeRowsByUrl(rows);
  assert(out.length === 3, `3 distinct URLs (got ${out.length})`);
  assert(new Set(out.map(r => r.url)).size === 3, 'all three URLs present, each once');
  // Order isn't functionally significant downstream (URL set + counts); keep-last
  // yields a,c,b for this input.
  assert(out.map(r => r.url).join(',') === 'https://x/a,https://x/c,https://x/b',
    `keep-last order (got ${out.map(r => r.url).join(',')})`);
}

console.log('\nTest 3: no duplicates -> array is unchanged in length and order');
{
  const rows = [{ url: 'https://x/a' }, { url: 'https://x/b' }];
  const out = dedupeRowsByUrl(rows);
  assert(out.length === 2, 'length unchanged');
  assert(out[0].url === 'https://x/a' && out[1].url === 'https://x/b', 'order unchanged');
}

console.log('\nTest 4: rows without a url are all kept (null conflict key does not collide)');
{
  const rows = [
    { url: 'https://x/a' },
    { url: null, beds: 1 },
    { beds: 2 },              // no url key at all
    { url: 'https://x/a' },   // dup of /a
  ];
  const out = dedupeRowsByUrl(rows);
  // one /a + two url-less rows = 3
  assert(out.length === 3, `url-less rows preserved, /a collapsed (got ${out.length})`);
  assert(out.filter(r => !r.url).length === 2, 'both url-less rows kept');
}

console.log('\nTest 5: a collapse is noted on the surviving row\'s enrichment_manifest');
{
  const rows = [
    { url: 'https://x/a', beds: 1, enrichment_manifest: { data_hygiene: [] } },
    { url: 'https://x/a', beds: 2, enrichment_manifest: { data_hygiene: [] } }, // dup, kept (last)
  ];
  const out = dedupeRowsByUrl(rows);
  assert(out.length === 1, `collapsed to 1 (got ${out.length})`);
  const notes = out[0].enrichment_manifest.data_hygiene;
  assert(notes.length === 1 && notes[0].kind === 'duplicate_url_collapsed' && notes[0].field === 'url',
    `collapse noted on survivor (got ${JSON.stringify(notes)})`);
}

console.log('\nTest 6: dedup is a no-op-safe when rows carry no manifest');
{
  const out = dedupeRowsByUrl([{ url: 'https://x/a' }, { url: 'https://x/a' }]);
  assert(out.length === 1, 'still collapses without a manifest (no crash)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
