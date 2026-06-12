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
const { mergeFieldSources, derivePriceStatus } = await import('../lib/pipeline/persist-lots.js');
const { _internals, enqueueRetry, drainRetryQueue, markRetryDone } = await import('../lib/pipeline/retry-queue.js');
const { computeLotQuality, computeBatchCoverage, ISSUE_CODES } = await import('../lib/quality/lot-quality.js');
const { detectFieldRegressions, appendCoverageHistory, latestCoverage, _internals: regrInternals } = await import('../lib/pipeline/quality-regression.js');

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

  // Locks the bug-fix contract: enqueueRetry treats reason='circuit_open'
  // as defer (no attempts++). Production observed 411 OS Places rows
  // exhausted via repeated scrape-time enqueues during a tripped breaker
  // — pre-fix, every scrape's failed enqueue ticked attempts up.
  const { NON_STRIKE_REASONS } = _internals;
  assert(NON_STRIKE_REASONS instanceof Set,
    'NON_STRIKE_REASONS exported as a Set (callers can introspect)');
  assert(NON_STRIKE_REASONS.has('circuit_open'),
    'circuit_open is non-strike: enqueueRetry must NOT increment attempts');
  assert(!NON_STRIKE_REASONS.has('api_error') && !NON_STRIKE_REASONS.has('timeout') && !NON_STRIKE_REASONS.has('no_match'),
    'real failures (api_error, timeout, no_match) DO strike — they tried and failed');
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

// ═══════════════════════════════════════════════════════════════════════
// Rollout #4 — per-lot quality + coverage regression detection
// ═══════════════════════════════════════════════════════════════════════

// ── computeLotQuality — score is bounded, issues are documented codes ──
console.log('\ncomputeLotQuality: score + issues');
{
  // Fully-populated lot scores 100 with no issues.
  const full = {
    imageUrl: 'https://x/img.jpg',
    price: 195000,
    postcode: 'SW1A 1AA',
    address: '12 High Street, London',
    uprn: '100021533445',
    epcRating: 'C',
    tenure: 'Freehold',
    beds: 3,
  };
  const fullQ = computeLotQuality(full);
  assert(fullQ.score === 100, `fully populated lot scores 100 (got ${fullQ.score})`);
  assert(fullQ.issues.length === 0, 'fully populated lot has no issues');

  // Empty lot scores 0 with all field codes flagged.
  const empty = computeLotQuality({});
  assert(empty.score === 0, `empty lot scores 0 (got ${empty.score})`);
  assert(empty.issues.includes('no_image') && empty.issues.includes('no_price') &&
         empty.issues.includes('no_postcode') && empty.issues.includes('no_address'),
    'empty lot lists every gap');

  // POA price gets half-credit + a distinct code (not 'no_price').
  const poa = computeLotQuality({ ...full, price: null, priceText: 'POA' });
  assert(poa.issues.includes('poa_price'), 'POA price flagged with poa_price');
  assert(!poa.issues.includes('no_price'), 'POA is NOT flagged as no_price');
  assert(poa.score < fullQ.score && poa.score > fullQ.score - 25,
    'POA gets half the price weight (12-13pt drop, not full 25)');

  // beds=0 (studio) is valid — must NOT be flagged.
  const studio = computeLotQuality({ ...full, beds: 0 });
  assert(!studio.issues.includes('no_beds'), 'beds=0 (studio) is valid, not flagged');
  assert(studio.score === fullQ.score, 'studio retains full beds weight');

  // Score is clamped to [0, 100].
  const overflow = computeLotQuality({ ...full, priceText: 'POA' }); // POA adds bonus
  assert(overflow.score >= 0 && overflow.score <= 100, 'score clamped to 0-100');

  // null/undefined/non-object lot returns a defined shape (defensive).
  const nullQ = computeLotQuality(null);
  assert(nullQ && typeof nullQ.score === 'number' && Array.isArray(nullQ.issues),
    'null input returns a defined { score, issues } shape');

  // ISSUE_CODES list is frozen so callers can validate against it.
  assert(Object.isFrozen(ISSUE_CODES), 'ISSUE_CODES is frozen (immutable contract)');
  assert(ISSUE_CODES.includes('no_image') && ISSUE_CODES.includes('poa_price'),
    'ISSUE_CODES includes the documented codes');
}

// ── computeBatchCoverage — aggregate field coverage for the alert path ──
console.log('\ncomputeBatchCoverage: per-field aggregate');
{
  const lots = [
    { imageUrl: 'a', price: 1, postcode: 'X1', uprn: '1', epcRating: 'C' },
    { imageUrl: 'b', price: 2, postcode: 'X2', uprn: '2', epcRating: null },
    { imageUrl: 'c', price: null, postcode: null, uprn: null, epcRating: null },
    { imageUrl: null, price: 4, postcode: 'X4', uprn: '4', epcRating: 'D' },
  ];
  const cov = computeBatchCoverage(lots);
  assert(cov.total_lots === 4, 'total_lots reflects array length');
  assert(cov.image_pct === 75, 'image: 3/4 = 75%');
  assert(cov.price_pct === 75, 'price: 3/4 = 75%');
  assert(cov.postcode_pct === 75, 'postcode: 3/4 = 75%');
  assert(cov.uprn_pct === 75, 'uprn: 3/4 = 75%');
  assert(cov.epc_pct === 50, 'epc: 2/4 = 50%');

  assert(computeBatchCoverage([]) === null, 'empty batch returns null (avoid misleading 0% record)');
  assert(computeBatchCoverage(null) === null, 'null batch returns null');
}

// ── detectFieldRegressions — relative-to-previous, not blanket ──
console.log('\ndetectFieldRegressions: relative-to-previous semantics');
{
  const { DROP_THRESHOLD_PCT, MIN_LOTS_FOR_ALERT } = regrInternals;

  const previous = {
    total_lots: 100,
    image_pct: 100, price_pct: 95, postcode_pct: 90, uprn_pct: 50, epc_pct: 40,
  };

  // No regression: same coverage.
  const same = detectFieldRegressions(previous, { ...previous });
  assert(same.length === 0, 'no regression when coverage is unchanged');

  // Real regression: image drops 100 → 60 (40pp).
  const imgDrop = detectFieldRegressions(previous, {
    ...previous, image_pct: 60,
  });
  assert(imgDrop.length === 1 && imgDrop[0].label === 'image_url',
    'image drop fires extractor_image_regression');
  assert(imgDrop[0].drop_pct === 40, 'reports the actual drop magnitude');

  // Below threshold: 5pp drop is noise, not an alert.
  const minorDrop = detectFieldRegressions(previous, {
    ...previous, image_pct: 95,
  });
  assert(minorDrop.length === 0,
    `${DROP_THRESHOLD_PCT}pp threshold suppresses minor noise`);

  // Tiny batch: regression suppressed (one missing lot warps the %).
  const tinyBatch = detectFieldRegressions(previous, {
    total_lots: 2, image_pct: 0, price_pct: 0, postcode_pct: 0, uprn_pct: 0, epc_pct: 0,
  });
  assert(tinyBatch.length === 0,
    `batches under ${MIN_LOTS_FOR_ALERT} lots don't fire (too noisy)`);

  // Multiple field drops: each fires its own alert.
  const multi = detectFieldRegressions(previous, {
    ...previous, image_pct: 50, postcode_pct: 60,
  });
  assert(multi.length === 2, 'each regressed field fires its own alert');
  const types = multi.map(m => m.alertType).sort();
  assert(types.includes('extractor_image_regression') &&
         types.includes('extractor_postcode_regression'),
    'alerts use field-specific types');

  // No previous → no regressions (fresh house).
  assert(detectFieldRegressions(null, previous).length === 0,
    'no previous entry → no regressions (fresh house)');
}

// ── appendCoverageHistory + latestCoverage — ringbuffer semantics ──
console.log('\nappendCoverageHistory: ringbuffer of last 5');
{
  const { HISTORY_LIMIT } = regrInternals;
  let h = null;
  for (let i = 0; i < HISTORY_LIMIT + 3; i++) {
    h = appendCoverageHistory(h, { scraped_at: `2026-04-27T${String(i).padStart(2, '0')}:00:00Z`, total_lots: 100 });
  }
  assert(h.history.length === HISTORY_LIMIT,
    `history capped at ${HISTORY_LIMIT} entries (oldest entries trimmed)`);
  assert(h.history[h.history.length - 1].scraped_at.endsWith(':00:00Z'),
    'newest entry is at the tail');
  assert(latestCoverage(h) === h.history[h.history.length - 1],
    'latestCoverage returns the tail entry');
  assert(latestCoverage(null) === null, 'latestCoverage tolerates null history');
  assert(latestCoverage({ history: [] }) === null, 'latestCoverage tolerates empty array');

  // Pure: doesn't mutate the input blob.
  const inputBlob = { history: [{ scraped_at: 'x' }] };
  appendCoverageHistory(inputBlob, { scraped_at: 'y' });
  assert(inputBlob.history.length === 1, 'appendCoverageHistory does not mutate input');
}

// ═══════════════════════════════════════════════════════════════════════
// price_status — structured pricing intent
// ═══════════════════════════════════════════════════════════════════════

console.log('\nderivePriceStatus: priority order + edge cases');
{
  // sold: STATUS-ONLY keying. The old `soldPrice` gate made this branch
  // unreachable at runtime (nothing in the codebase produces lot.soldPrice;
  // prod has no sold_price column) and re-upserts of sold lots contradicted
  // the migration backfill (Fable review 2026-06-12 #2).
  assert(derivePriceStatus({ status: 'sold', soldPrice: 285000 }) === 'sold',
    'sold + soldPrice → sold');
  assert(derivePriceStatus({ status: 'sold' }) === 'sold',
    'sold WITHOUT soldPrice → sold (status-only keying)');
  assert(derivePriceStatus({ status: 'unsold' }) === 'sold',
    'unsold → sold (auction concluded; the guide is gone)');
  assert(derivePriceStatus({ status: 'sold', priceText: 'SOLD - unreserved' }) === 'sold',
    'sold beats the nil-reserve text ("SOLD - unreserved" is a sold lot)');

  // withdrawn: status only — sold_price irrelevant.
  assert(derivePriceStatus({ status: 'withdrawn' }) === 'withdrawn',
    'withdrawn status → withdrawn (regardless of price)');
  // withdrawn beats POA when both signals present (priority).
  assert(derivePriceStatus({ status: 'withdrawn', priceText: 'POA' }) === 'withdrawn',
    'withdrawn beats poa (priority order)');

  // POA detection — only when there is no price (a withhold, not a quote).
  assert(derivePriceStatus({ priceText: 'POA' }) === 'poa', 'POA priceText → poa');
  assert(derivePriceStatus({ priceText: 'Price on application' }) === 'poa',
    '"Price on application" → poa (case insensitive)');
  // POA with a real price: the price wins, status is guide.
  assert(derivePriceStatus({ price: 250000, priceText: 'POA' }) === 'guide',
    'POA priceText with real price → guide (price beats text)');

  // TBA family.
  assert(derivePriceStatus({ priceText: 'TBA' }) === 'tba', 'TBA → tba');
  assert(derivePriceStatus({ priceText: 'TBC' }) === 'tba', 'TBC → tba');
  assert(derivePriceStatus({ priceText: 'To be advised' }) === 'tba', 'To be advised → tba');

  // starting_bid — applies even when price is set (it's the only published number).
  assert(derivePriceStatus({ price: 50000, priceText: 'Starting bid' }) === 'starting_bid',
    'starting bid signal wins over guide even when price present');
  assert(derivePriceStatus({ priceText: 'Opening bid £50k' }) === 'starting_bid',
    'opening bid → starting_bid');

  // guide: the common case.
  assert(derivePriceStatus({ price: 195000 }) === 'guide', 'price only → guide');

  // Nil Reserve — a real, positive state (sells to highest bid), only when
  // there's no numeric guide. The pugh false-alarm class (2026-06-12).
  assert(derivePriceStatus({ priceText: 'Nil Reserve' }) === 'nil_reserve', 'Nil Reserve → nil_reserve');
  assert(derivePriceStatus({ priceText: 'No Reserve' }) === 'nil_reserve', 'No Reserve → nil_reserve');
  assert(derivePriceStatus({ priceText: 'Unreserved' }) === 'nil_reserve', 'Unreserved → nil_reserve');
  assert(derivePriceStatus({ price: 80000, priceText: 'Guide £80,000, Nil Reserve' }) === 'guide',
    'a guide price with Nil Reserve keeps guide (number wins; badge derived separately)');

  // unknown: genuinely missing.
  assert(derivePriceStatus({}) === 'unknown', 'empty lot → unknown');
  assert(derivePriceStatus(null) === 'unknown', 'null lot → unknown (defensive)');
  assert(derivePriceStatus({ price: 0 }) === 'unknown', 'zero price → unknown (not guide)');
}

console.log('\ncomputeLotQuality: priceStatus-aware scoring');
{
  // POA via structured status — half-credit, distinct issue code, no false 'no_price'.
  const poaLot = { priceStatus: 'poa', address: '12 High St', postcode: 'SW1A 1AA' };
  const poaQ = computeLotQuality(poaLot);
  assert(poaQ.issues.includes('poa_price'), 'priceStatus=poa → poa_price code');
  assert(!poaQ.issues.includes('no_price'), 'priceStatus=poa NEVER also gets no_price');

  // TBA gets its own code, distinct from POA.
  const tbaQ = computeLotQuality({ priceStatus: 'tba', address: '12 High St' });
  assert(tbaQ.issues.includes('tba_price') && !tbaQ.issues.includes('poa_price'),
    'priceStatus=tba → tba_price (not poa_price)');

  // sold + withdrawn DON'T dock the score — full credit, status flag only.
  const soldQ = computeLotQuality({ priceStatus: 'sold', soldPrice: 250000, address: '12 High St' });
  const guideQ = computeLotQuality({ price: 250000, priceStatus: 'guide', address: '12 High St' });
  assert(soldQ.issues.includes('sold_price'), 'priceStatus=sold → sold_price code');
  assert(soldQ.score === guideQ.score,
    'priceStatus=sold scores same as guide (status, not failure)');

  // Nil Reserve — full credit (a complete, correct, positive state), tagged
  // 'nil_reserve', NEVER 'no_price'. This is the scanner fix for the pugh
  // false-alarm class.
  const nilQ = computeLotQuality({ priceStatus: 'nil_reserve', address: '12 High St', postcode: 'SW1A 1AA' });
  assert(nilQ.issues.includes('nil_reserve'), 'priceStatus=nil_reserve → nil_reserve code');
  assert(!nilQ.issues.includes('no_price'), 'priceStatus=nil_reserve NEVER also gets no_price');
  assert(nilQ.score === computeLotQuality({ price: 250000, address: '12 High St', postcode: 'SW1A 1AA' }).score,
    'nil_reserve scores same as a real guide (full price credit)');
  // And via the priceText fallback for lots scraped before price_status existed.
  const nilFallback = computeLotQuality({ priceText: 'Nil Reserve', address: '12 High St' });
  assert(nilFallback.issues.includes('nil_reserve') && !nilFallback.issues.includes('no_price'),
    'fallback: priceText="Nil Reserve" → nil_reserve, not no_price');

  // Fallback: a lot without priceStatus still gets POA half-credit via the
  // priceText regex — backwards-compatible for old lots.
  const legacy = computeLotQuality({ priceText: 'POA', address: '12 High St' });
  assert(legacy.issues.includes('poa_price'),
    'fallback: priceText="POA" without priceStatus still flagged poa_price');

  // ISSUE_CODES extended with the new vocabulary.
  assert(ISSUE_CODES.includes('tba_price') &&
         ISSUE_CODES.includes('sold_price') &&
         ISSUE_CODES.includes('withdrawn_price') &&
         ISSUE_CODES.includes('nil_reserve') &&
         ISSUE_CODES.includes('starting_bid'),
    'ISSUE_CODES extended with status-class price codes (incl. nil_reserve, starting_bid)');
}

console.log('\ncomputeBatchCoverage: price denominator excludes intentional withholds');
{
  // 4 lots: 3 priced (guide), 1 POA. Old behaviour: price_pct = 75% (POA counted as miss).
  // New behaviour: POA dropped from BOTH numerator and denominator → price_pct = 100%.
  const lots = [
    { price: 100000, priceStatus: 'guide' },
    { price: 200000, priceStatus: 'guide' },
    { price: 300000, priceStatus: 'guide' },
    { priceStatus: 'poa' },
  ];
  const cov = computeBatchCoverage(lots);
  assert(cov.price_pct === 100, `POA-only gap → price_pct=100% (got ${cov.price_pct})`);
  assert(cov.total_lots === 4, 'total_lots still counts everything (POA included in batch size)');

  // sold/withdrawn/nil_reserve/starting_bid also denominator-out.
  const mixed = [
    { price: 100000, priceStatus: 'guide' },
    { priceStatus: 'sold', soldPrice: 99000 },
    { priceStatus: 'withdrawn' },
    { priceStatus: 'tba' },
    { priceStatus: 'nil_reserve' },
    { priceStatus: 'starting_bid' },
  ];
  const mixedCov = computeBatchCoverage(mixed);
  assert(mixedCov.price_pct === 100,
    'all non-guide statuses (incl. nil_reserve, starting_bid) denominator-out → price_pct=100%');

  // A real gap (priceStatus='unknown' or null) DOES count.
  const realGap = [
    { price: 100000, priceStatus: 'guide' },
    { price: 200000, priceStatus: 'guide' },
    { priceStatus: 'unknown' },
    { /* no priceStatus, no price */ },
  ];
  const gapCov = computeBatchCoverage(realGap);
  assert(gapCov.price_pct === 50, `genuine 50% gap reported as 50% (got ${gapCov.price_pct})`);

  // Edge: all lots are not-a-gap. Avoid divide-by-zero — return 100% (nothing to fail).
  const allPoa = [{ priceStatus: 'poa' }, { priceStatus: 'tba' }];
  const allPoaCov = computeBatchCoverage(allPoa);
  assert(allPoaCov.price_pct === 100,
    'all-POA batch → 100% price_pct (no eligible denominator)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
