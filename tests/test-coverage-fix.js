// tests/test-coverage-fix.js — locks the contracts introduced by
// COVERAGE_FIX_PLAN.md fixes #1 + #2:
//
//   • Detail-page provenance stamping via setField — promoted detail values
//     write a field_sources entry that survives merge with prior provenance.
//   • Retry-queue backoff math — exponential (1h → 2h → 4h → 8h → 16h),
//     capped at 24h. nextRetryAt produces an ISO timestamp in the future.
//
// Pure helpers, no Supabase. Stub env vars before importing in case the
// module graph touches lib/supabase.js (same shim used elsewhere in tests/).

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { setField, setFieldIfEmpty, getFieldSources, stampSource, stampSourceIfEmpty } = await import('../lib/quality/field-source.js');
const { mergeFieldSources } = await import('../lib/pipeline/persist-lots.js');
const { _internals, enqueueRetry, drainRetryQueue, markRetryDone } = await import('../lib/pipeline/retry-queue.js');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// ── setField — provenance stamping ─────────────────────────────────────
console.log('\nsetField: detail-page provenance');
{
  const lot = { address: '' };
  setField(lot, 'imageUrl', 'https://cdn/img.jpg', 'detail-page');
  assert(lot.imageUrl === 'https://cdn/img.jpg', 'sets the value');
  assert(getFieldSources(lot).imageUrl === 'detail-page', 'stamps the source');

  // Multiple stamps on the same lot — _fieldSources accumulates, doesn't
  // replace the whole object.
  setField(lot, 'price', 195000, 'detail-page');
  setField(lot, 'tenure', 'Freehold', 'dom-detail');
  const sources = getFieldSources(lot);
  assert(sources.imageUrl === 'detail-page' && sources.price === 'detail-page' && sources.tenure === 'dom-detail',
    'multiple stamps coexist with their own sources');

  // setField MUST accept boolean false and zero — without this the studio
  // (beds=0) and "occupied" (vacant=false) branches in scraper.js would
  // silently drop their values. This is a regression I almost shipped.
  const lot2 = {};
  setField(lot2, 'vacant', false, 'detail-page');
  setField(lot2, 'beds', 0, 'detail-page');
  assert(lot2.vacant === false, 'accepts boolean false');
  assert(lot2.beds === 0, 'accepts numeric zero (studios)');
  assert(getFieldSources(lot2).vacant === 'detail-page' && getFieldSources(lot2).beds === 'detail-page',
    'stamps source for falsy-but-valid values');

  // null/undefined/empty string MUST be no-ops — preserves whatever was there.
  const lot3 = { address: 'real address', _fieldSources: { address: 'dom' } };
  setField(lot3, 'address', null, 'detail-page');
  setField(lot3, 'address', undefined, 'detail-page');
  setField(lot3, 'address', '   ', 'detail-page');
  assert(lot3.address === 'real address' && lot3._fieldSources.address === 'dom',
    'null/undefined/whitespace inputs preserve prior value AND prior source');
}

// ── setFieldIfEmpty — guards higher-precedence stamps ─────────────────
console.log('\nsetFieldIfEmpty: respects existing values');
{
  const lot = { beds: 3, _fieldSources: { beds: 'dom' } };
  setFieldIfEmpty(lot, 'beds', 4, 'bullets-parser');
  assert(lot.beds === 3 && lot._fieldSources.beds === 'dom',
    'existing value preserved (DOM beats bullets-parser)');

  const lot2 = {};
  setFieldIfEmpty(lot2, 'tenure', 'Freehold', 'bullets-parser');
  assert(lot2.tenure === 'Freehold' && lot2._fieldSources.tenure === 'bullets-parser',
    'fills when empty');
}

// ── mergeFieldSources × setField — round-trip through persist ─────────
console.log('\nmergeFieldSources: detail-page stamps survive re-scrape');
{
  // Scenario: previous scrape stamped price=dom from the catalogue card.
  // This scrape's detail page promoted imageUrl=detail-page. The persisted
  // field_sources column must end up with both stamps.
  const lot = {};
  setField(lot, 'imageUrl', 'https://cdn/img2.jpg', 'detail-page');
  const merged = mergeFieldSources({ price: 'dom' }, lot._fieldSources);
  assert(merged.price === 'dom' && merged.imageUrl === 'detail-page',
    'detail-page stamp survives merge with prior dom stamp');

  // Detail-page wins on collision — newer information replaces older.
  const collision = mergeFieldSources({ imageUrl: 'dom' }, { imageUrl: 'detail-page' });
  assert(collision.imageUrl === 'detail-page', 'current run wins on collision');
}

// ── Retry queue: backoff math ─────────────────────────────────────────
console.log('\nretry-queue: exponential backoff math');
{
  const { backoffMs, BASE_BACKOFF_MS, MAX_BACKOFF_MS, MAX_ATTEMPTS, nextRetryAt } = _internals;

  assert(backoffMs(1) === BASE_BACKOFF_MS, 'attempt 1 → 1h backoff');
  assert(backoffMs(2) === BASE_BACKOFF_MS * 2, 'attempt 2 → 2h backoff');
  assert(backoffMs(3) === BASE_BACKOFF_MS * 4, 'attempt 3 → 4h backoff');
  assert(backoffMs(4) === BASE_BACKOFF_MS * 8, 'attempt 4 → 8h backoff');
  assert(backoffMs(5) === BASE_BACKOFF_MS * 16, 'attempt 5 → 16h backoff');

  // Cap kicks in once 2^(n-1) * 1h would exceed 24h. With BASE=1h,
  // attempt 6 would be 32h → must clamp to 24h.
  assert(backoffMs(6) === MAX_BACKOFF_MS, 'attempt 6 capped at 24h');
  assert(backoffMs(99) === MAX_BACKOFF_MS, 'arbitrarily-high attempt still capped');

  // Defensive: 0/negative attempts shouldn't blow up; treat as attempt 1.
  assert(backoffMs(0) === BASE_BACKOFF_MS, 'attempt 0 normalised to base backoff');
  assert(backoffMs(-3) === BASE_BACKOFF_MS, 'negative attempts normalised to base backoff');

  // nextRetryAt produces an ISO timestamp ~backoff-ms in the future.
  const start = Date.now();
  const ts = nextRetryAt(1);
  const delta = new Date(ts).getTime() - start;
  assert(delta >= BASE_BACKOFF_MS - 1000 && delta <= BASE_BACKOFF_MS + 1000,
    'nextRetryAt(1) is ~1h in the future');
  assert(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(ts), 'nextRetryAt returns ISO8601 string');

  assert(MAX_ATTEMPTS === 5, 'MAX_ATTEMPTS frozen at 5 (matches partial index in migration)');

  // Defer backoff is a fixed window covering OS Places' 10-min breaker reset
  // plus a buffer. Locked here so a refactor that drops it back to attempt-1
  // backoff (which is also 1h, just by coincidence) can't quietly regress.
  const { DEFER_BACKOFF_MS } = _internals;
  assert(DEFER_BACKOFF_MS === 15 * 60 * 1000, 'DEFER_BACKOFF_MS = 15 minutes (covers OS Places 10-min breaker + buffer)');
  assert(DEFER_BACKOFF_MS < BASE_BACKOFF_MS, 'defer is shorter than retry: a deferred row should re-enter the drain before a retried one');
}

// ── stampSource — used by extractor.js for catalogue-path provenance ──
console.log('\nstampSource: dense provenance from extractor');
{
  // Catalogue extraction has populated some fields. stampSource marks every
  // non-empty field with the extractor source. Detail-page / OS Places stamps
  // run later and overwrite where they actually contribute.
  const lot = { address: '12 High St', price: 195000, beds: 3, tenure: '' };
  stampSource(lot, 'address', 'dom');
  stampSource(lot, 'price', 'dom');
  stampSource(lot, 'beds', 'dom');
  stampSource(lot, 'tenure', 'dom');           // empty string — no-op
  stampSource(lot, 'leaseLength', 'dom');      // undefined — no-op

  const sources = getFieldSources(lot);
  assert(sources.address === 'dom' && sources.price === 'dom' && sources.beds === 'dom',
    'stamps populated fields');
  assert(!('tenure' in sources), 'skips empty-string fields');
  assert(!('leaseLength' in sources), 'skips undefined fields');

  // Subsequent stamp wins — order is "extractor → detail-page → OS Places",
  // so the latest stamp reflects the most authoritative source.
  stampSource(lot, 'address', 'os-places');
  assert(getFieldSources(lot).address === 'os-places', 'newer stamp wins');
}

// ── stampSourceIfEmpty — preserves prior stamps from earlier merge stages ──
console.log('\nstampSourceIfEmpty: preserves prior stamps');
{
  // The dom+ai pipeline scenario: mergeDomai stamps url=dom for fields it
  // contributed, then the catch-all stampExtractorProvenance walks every
  // populated field with 'gemini-catalogue'. Without if-empty semantics, the
  // second pass would overwrite mergeDomai's correct stamp. This test locks
  // that contract — if a future refactor switches the catch-all back to
  // unconditional stampSource, the dom+ai accuracy regression is caught here.
  const lot = { url: 'https://x', imageUrl: 'https://y', address: '12 High St' };
  // mergeDomai-equivalent: stamp 'dom' for the merged fields.
  stampSourceIfEmpty(lot, 'url', 'dom');
  stampSourceIfEmpty(lot, 'imageUrl', 'dom');
  // catch-all: try to claim 'gemini-catalogue' for every populated field.
  stampSourceIfEmpty(lot, 'url', 'gemini-catalogue');
  stampSourceIfEmpty(lot, 'imageUrl', 'gemini-catalogue');
  stampSourceIfEmpty(lot, 'address', 'gemini-catalogue');
  const sources = getFieldSources(lot);
  assert(sources.url === 'dom', 'mergeDomai-stamped url survives catch-all');
  assert(sources.imageUrl === 'dom', 'mergeDomai-stamped imageUrl survives catch-all');
  assert(sources.address === 'gemini-catalogue', 'unstamped field gets the catch-all source');

  // Empty/missing values are still skipped (same contract as stampSource).
  const lot2 = { tenure: '' };
  stampSourceIfEmpty(lot2, 'tenure', 'gemini-catalogue');
  stampSourceIfEmpty(lot2, 'beds', 'gemini-catalogue');
  assert(!getFieldSources(lot2).tenure, 'empty string skipped');
  assert(!getFieldSources(lot2).beds, 'undefined skipped');
}

// ── retry-queue export shape ─────────────────────────────────────────
// Wiring sanity: persist-stage.js + enrichment-wave.js import these by name.
// A typo in the module would break production silently — this test catches
// it without needing a Supabase round-trip.
console.log('\nretry-queue: public API shape');
{
  assert(typeof enqueueRetry === 'function', 'enqueueRetry exported as function');
  assert(typeof drainRetryQueue === 'function', 'drainRetryQueue exported as function');
  assert(typeof markRetryDone === 'function', 'markRetryDone exported as function');

  // No-op when supabase is null/undefined — safe to call from offline tests.
  let threw = false;
  try { await enqueueRetry(null, { lotId: 'x', field: 'uprn', reason: 'no_match' }); }
  catch { threw = true; }
  assert(!threw, 'enqueueRetry tolerates null supabase (test-friendly)');

  try { await markRetryDone(null, 'x', 'uprn'); } catch { threw = true; }
  assert(!threw, 'markRetryDone tolerates null supabase');

  // drainRetryQueue with no supabase or no attemptFn returns a zero-shape
  // result rather than throwing — the hygiene wave wraps it in try/catch but
  // an explicit "no work" return is cleaner than relying on the catch.
  const drained = await drainRetryQueue(null, { limit: 10, attemptFn: async () => 'ok' });
  assert(drained && drained.attempted === 0 && drained.ok === 0,
    'drainRetryQueue returns zero stats when supabase is null');
  // 'deferred' must be in the zero-state shape — callers (enrichment-wave Pass 6)
  // read drain.deferred to log breaker-driven defers separately from retries.
  // Locks the bug-fix contract: a refactor that strips the field gets caught.
  assert('deferred' in drained && drained.deferred === 0,
    'drainRetryQueue zero-state shape includes deferred:0');
  assert('retried' in drained && 'gaveUp' in drained,
    'all four outcome counters in the zero-state shape');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
