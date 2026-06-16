/**
 * Enrichment Manifest Test Suite
 * ==============================
 * Tests the per-lot enrichment manifest module: recorders, batch
 * summarisation, and alert derivation.
 *
 * Run: node tests/test-manifest.js
 */

import {
  createManifest,
  recordScraped,
  markEnriched,
  recordExtract,
  recordEpc,
  recordEpcRecommendations,
  recordFlood,
  recordLandRegistry,
  recordGeocode,
  recordFundability,
  recordYieldScoring,
  recordBelowMarketScoring,
  canScoreYield,
  summariseBatch,
  deriveAlerts,
  EPC_STATUSES,
  EPC_RECOMMENDATIONS_STATUSES,
  FLOOD_STATUSES,
  LR_STATUSES,
  GEOCODE_STATUSES,
  FUNDABILITY_STATUSES,
} from '../lib/enrichment-manifest.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

function assertThrows(fn, pattern, msg) {
  try { fn(); assert(false, `${msg} (expected throw)`); }
  catch (e) { assert(pattern.test(e.message), `${msg} — threw: ${e.message}`); }
}

// ─── Factory ───
console.log('\n── createManifest ──');
{
  const m = createManifest();
  assert(m.scraped_at === null, 'scraped_at starts null');
  assert(m.enriched_at === null, 'enriched_at starts null');
  assert(m.extract.strategy === null, 'extract.strategy starts null');
  assert(m.epc === null, 'epc starts null');
  assert(m.flood === null, 'flood starts null');
  assert(m.land_registry === null, 'land_registry starts null');
  assert(m.geocode === null, 'geocode starts null');
  assert(m.fundability === null, 'fundability starts null');
  assert(m.scoring.yield_scored_by === null, 'scoring.yield_scored_by starts null');
  assert(Array.isArray(m.scoring.signals_fired), 'scoring.signals_fired is array');
  assert(m.scoring.signals_fired.length === 0, 'signals_fired starts empty');
}

// ─── recordScraped + markEnriched ───
console.log('\n── recordScraped / markEnriched ──');
{
  const m = createManifest();
  recordScraped(m, { at: '2026-04-23T10:00:00Z', method: 'firecrawl', hash: 'abc123' });
  assert(m.scraped_at === '2026-04-23T10:00:00Z', 'scraped_at set');
  assert(m.extract.scrape_method === 'firecrawl', 'scrape_method captured');
  assert(m.extract.scrape_hash === 'abc123', 'scrape_hash captured');

  markEnriched(m);
  assert(typeof m.enriched_at === 'string' && m.enriched_at.endsWith('Z'), 'enriched_at set to ISO string');
}

// ─── recordExtract ───
console.log('\n── recordExtract ──');
{
  const m = createManifest();
  recordExtract(m, { strategy: 'dom', aiTier: null, fieldCoverage: { address: true, price: false } });
  assert(m.extract.strategy === 'dom', 'strategy recorded');
  assert(m.extract.ai_tier === null, 'ai_tier recorded');
  assert(m.extract.field_coverage.address === true, 'field_coverage.address');
  assert(m.extract.field_coverage.price === false, 'field_coverage.price');

  // Merge behaviour — adding new fields doesn't wipe old ones
  recordExtract(m, { fieldCoverage: { tenure: true } });
  assert(m.extract.field_coverage.address === true, 'prior address preserved');
  assert(m.extract.field_coverage.tenure === true, 'new tenure added');
}

// ─── EPC recorder ───
console.log('\n── recordEpc ──');
{
  const m = createManifest();
  recordEpc(m, { status: 'ok', rating: 'D', score: 60, floorAreaSqm: 65, addressCompleteness: 'full' });
  assert(m.epc.status === 'ok', 'status=ok');
  assert(m.epc.rating === 'D', 'rating stored');
  assert(m.epc.floorAreaSqm === 65, 'floorAreaSqm stored');
  assert(m.epc.addressCompleteness === 'full', 'addressCompleteness stored');

  assertThrows(() => recordEpc(m, {}), /status is required/, 'rejects missing status');
  assertThrows(() => recordEpc(m, { status: 'bogus' }), /unknown status/, 'rejects unknown status');
  // Verify every documented status is accepted
  for (const s of EPC_STATUSES) {
    recordEpc(m, { status: s });
    assert(m.epc.status === s, `accepts documented status: ${s}`);
  }
}

// ─── EPC recommendations recorder (regression: skipped_no_creds) ───
console.log('\n── recordEpcRecommendations ──');
{
  const m = createManifest();
  recordEpcRecommendations(m, { status: 'ok', count: 3 });
  assert(m.epc_recommendations.status === 'ok', 'status=ok stored');

  assertThrows(() => recordEpcRecommendations(m, {}), /status is required/, 'rejects missing status');
  assertThrows(() => recordEpcRecommendations(m, { status: 'bogus' }), /unknown status/, 'rejects unknown status');

  // Regression (2026-06-16): the producer returns 'skipped_no_creds' when
  // EPC_API_TOKEN is unset; it was missing from EPC_RECOMMENDATIONS_STATUSES so the
  // recorder threw "unknown status" and aborted the entire EPC/Flood hygiene wave.
  recordEpcRecommendations(m, { status: 'skipped_no_creds' });
  assert(m.epc_recommendations.status === 'skipped_no_creds', 'accepts skipped_no_creds (regression)');

  // Every documented status must be accepted (keeps the allowlist + producer in sync).
  for (const s of EPC_RECOMMENDATIONS_STATUSES) {
    recordEpcRecommendations(m, { status: s });
    assert(m.epc_recommendations.status === s, `accepts documented status: ${s}`);
  }
}

// ─── Flood / LR / Geocode / Fundability basic round-trip ───
console.log('\n── flood / LR / geocode / fundability ──');
{
  const m = createManifest();
  recordFlood(m, { status: 'ok', zone: 2, source: 'EA_WFS', level: 'Medium' });
  assert(m.flood.zone === 2, 'flood zone stored');

  recordLandRegistry(m, { status: 'ok', compsFound: 12, compsUsed: 8 });
  assert(m.land_registry.compsFound === 12, 'LR compsFound stored');

  recordGeocode(m, { status: 'ok', lat: 51.5, lng: -0.1 });
  assert(m.geocode.lat === 51.5, 'geocode lat stored');

  // Regression (2026-06-16): 'timeout' was missing from FLOOD/LR/GEOCODE allowlists
  // → recordFlood threw "unknown status" and aborted the enrichment wave's flood
  // batch. Iterate each allowlist so the const stays in sync with the recorder.
  recordFlood(m, { status: 'timeout' });
  assert(m.flood.status === 'timeout', 'recordFlood accepts timeout (regression)');
  for (const s of FLOOD_STATUSES) { recordFlood(m, { status: s }); assert(m.flood.status === s, `flood accepts: ${s}`); }
  for (const s of LR_STATUSES) { recordLandRegistry(m, { status: s }); assert(m.land_registry.status === s, `LR accepts: ${s}`); }
  for (const s of GEOCODE_STATUSES) { recordGeocode(m, { status: s }); assert(m.geocode.status === s, `geocode accepts: ${s}`); }

  recordFundability(m, {
    status: 'api_ok',
    lender_count: 12,
    inputs_derived: ['works_cost', 'gdv'],
    confidence: 'medium',
    response_time_ms: 42,
  });
  assert(m.fundability.lender_count === 12, 'fundability lender_count stored');
  assert(m.fundability.confidence === 'medium', 'fundability confidence stored');

  for (const s of FLOOD_STATUSES) { recordFlood(m, { status: s }); assert(m.flood.status === s, `flood status: ${s}`); }
  for (const s of LR_STATUSES) { recordLandRegistry(m, { status: s }); assert(m.land_registry.status === s, `LR status: ${s}`); }
  for (const s of GEOCODE_STATUSES) { recordGeocode(m, { status: s }); assert(m.geocode.status === s, `geocode status: ${s}`); }
  for (const s of FUNDABILITY_STATUSES) { recordFundability(m, { status: s }); assert(m.fundability.status === s, `fundability status: ${s}`); }
}

// ─── Yield scoring — first-writer-wins + canScoreYield ───
console.log('\n── recordYieldScoring ──');
{
  const m = createManifest();
  assert(canScoreYield(m) === true, 'canScoreYield true when empty');

  recordYieldScoring(m, { scoredBy: 'scoring', signal: '8.5% GIY' });
  assert(m.scoring.yield_scored_by === 'scoring', 'first write: scoring');
  assert(m.scoring.signals_fired.includes('8.5% GIY'), 'signal recorded');
  assert(canScoreYield(m) === false, 'canScoreYield false after first write');

  // Second writer must NOT overwrite
  recordYieldScoring(m, { scoredBy: 'enrichment', signal: 'Est. 9% yield' });
  assert(m.scoring.yield_scored_by === 'scoring', 'second write does not overwrite provenance');
  assert(m.scoring.signals_fired.length === 2, 'but new signal still appended');

  // Duplicate signal — not added twice
  recordYieldScoring(m, { signal: 'Est. 9% yield' });
  assert(m.scoring.signals_fired.length === 2, 'duplicate signal not re-added');

  assertThrows(() => recordYieldScoring(m, { scoredBy: 'bogus' }), /unknown source/, 'rejects unknown source');
}

console.log('\n── recordBelowMarketScoring ──');
{
  const m = createManifest();
  recordBelowMarketScoring(m);
  assert(m.scoring.below_market_scored_by === 'enrichment', 'below_market_scored_by set');
  recordBelowMarketScoring(m);
  assert(m.scoring.below_market_scored_by === 'enrichment', 'idempotent (does not reset)');
}

// ─── summariseBatch ───
console.log('\n── summariseBatch ──');
{
  const lots = [
    { _enrichment: (() => { const m = createManifest(); recordEpc(m, { status: 'ok' }); return m; })() },
    { _enrichment: (() => { const m = createManifest(); recordEpc(m, { status: 'ok' }); return m; })() },
    { _enrichment: (() => { const m = createManifest(); recordEpc(m, { status: 'skipped_no_creds' }); return m; })() },
    { _enrichment: (() => { const m = createManifest(); recordEpc(m, { status: 'no_match_with_address' }); return m; })() },
    {}, // lot without manifest
  ];
  const s = summariseBatch(lots);
  assert(s.total === 5, 'total counts all lots');
  assert(s.with_manifest === 4, 'with_manifest counts only lots with manifest');
  assert(s.epc.ok === 2, 'EPC ok count');
  assert(s.epc.skipped_no_creds === 1, 'EPC skipped_no_creds count');
  assert(s.epc.no_match_with_address === 1, 'EPC no_match_with_address count');
  assert(s.flood.ok === undefined, 'flood has no entries');

  const empty = summariseBatch([]);
  assert(empty.total === 0, 'empty batch total=0');
  assert(empty.with_manifest === 0, 'empty batch with_manifest=0');

  const nullCase = summariseBatch(null);
  assert(nullCase.total === 0, 'null input handled');
}

// ─── deriveAlerts ───
console.log('\n── deriveAlerts: EPC creds missing ──');
{
  const summary = summariseBatch([
    { _enrichment: (() => { const m = createManifest(); recordEpc(m, { status: 'skipped_no_creds' }); return m; })() },
  ]);
  const alerts = deriveAlerts(summary, 'test-house');
  const credsAlert = alerts.find(a => a.type === 'epc_creds_missing');
  assert(credsAlert !== undefined, 'fires epc_creds_missing on any skipped_no_creds');
  assert(credsAlert.house === 'test-house', 'house populated');
  assert(credsAlert.severity === 'error', 'severity=error for config issue');
}

console.log('\n── deriveAlerts: EPC matcher weak ──');
{
  // 3 matched, 7 no_match_with_address → 70% miss rate on 10 attempts
  const lots = [];
  for (let i = 0; i < 3; i++) lots.push({ _enrichment: (() => { const m = createManifest(); recordEpc(m, { status: 'ok' }); return m; })() });
  for (let i = 0; i < 7; i++) lots.push({ _enrichment: (() => { const m = createManifest(); recordEpc(m, { status: 'no_match_with_address' }); return m; })() });
  const alerts = deriveAlerts(summariseBatch(lots), 'test-house');
  const matcherAlert = alerts.find(a => a.type === 'epc_matcher_weak');
  assert(matcherAlert !== undefined, 'fires epc_matcher_weak at 70% miss rate');
  assert(matcherAlert.meta.matchAttempts === 10, 'matchAttempts correctly counted');
  assert(matcherAlert.meta.misses === 7, 'misses correctly counted');
}

console.log('\n── deriveAlerts: below minAttempts threshold ──');
{
  // 1 ok, 2 no_match — only 3 attempts, below minAttempts=5
  const lots = [
    { _enrichment: (() => { const m = createManifest(); recordEpc(m, { status: 'ok' }); return m; })() },
    { _enrichment: (() => { const m = createManifest(); recordEpc(m, { status: 'no_match_with_address' }); return m; })() },
    { _enrichment: (() => { const m = createManifest(); recordEpc(m, { status: 'no_match_with_address' }); return m; })() },
  ];
  const alerts = deriveAlerts(summariseBatch(lots), 'test-house');
  assert(alerts.find(a => a.type === 'epc_matcher_weak') === undefined, 'no matcher_weak below minAttempts');
}

console.log('\n── deriveAlerts: API unhealthy (EPC) ──');
{
  // 2 ok, 8 api_error → 80% failure on 10 attempts
  const lots = [];
  for (let i = 0; i < 2; i++) lots.push({ _enrichment: (() => { const m = createManifest(); recordEpc(m, { status: 'ok' }); return m; })() });
  for (let i = 0; i < 8; i++) lots.push({ _enrichment: (() => { const m = createManifest(); recordEpc(m, { status: 'api_error' }); return m; })() });
  const alerts = deriveAlerts(summariseBatch(lots), 'test-house');
  const apiAlert = alerts.find(a => a.type === 'epc_api_unhealthy');
  assert(apiAlert !== undefined, 'fires epc_api_unhealthy on high error rate');
  assert(apiAlert.meta.unhealthy === 8, 'unhealthy count correct');
  assert(apiAlert.meta.attempts === 10, 'attempts count correct');
}

console.log('\n── deriveAlerts: API unhealthy (fundability) ──');
{
  const lots = [];
  for (let i = 0; i < 1; i++) lots.push({ _enrichment: (() => { const m = createManifest(); recordFundability(m, { status: 'api_ok' }); return m; })() });
  for (let i = 0; i < 9; i++) lots.push({ _enrichment: (() => { const m = createManifest(); recordFundability(m, { status: 'api_timeout' }); return m; })() });
  const alerts = deriveAlerts(summariseBatch(lots), 'test-house');
  assert(alerts.find(a => a.type === 'fundability_api_unhealthy') !== undefined, 'fires fundability_api_unhealthy');
}

console.log('\n── deriveAlerts: API unhealthy (LR) excludes ok_no_comps from unhealthy ──');
{
  // 5 ok_no_comps (genuine data condition, NOT infrastructure failure) + 1 api_error → should not alert
  const lots = [];
  for (let i = 0; i < 5; i++) lots.push({ _enrichment: (() => { const m = createManifest(); recordLandRegistry(m, { status: 'ok_no_comps' }); return m; })() });
  for (let i = 0; i < 1; i++) lots.push({ _enrichment: (() => { const m = createManifest(); recordLandRegistry(m, { status: 'api_error' }); return m; })() });
  const alerts = deriveAlerts(summariseBatch(lots), 'test-house');
  assert(alerts.find(a => a.type === 'land_registry_api_unhealthy') === undefined, '1/6 failure does not alert');
}

console.log('\n── deriveAlerts: healthy batch produces no alerts ──');
{
  const lots = [];
  for (let i = 0; i < 10; i++) {
    lots.push({
      _enrichment: (() => {
        const m = createManifest();
        recordEpc(m, { status: 'ok' });
        recordFlood(m, { status: 'ok' });
        recordLandRegistry(m, { status: 'ok' });
        recordFundability(m, { status: 'api_ok' });
        return m;
      })(),
    });
  }
  const alerts = deriveAlerts(summariseBatch(lots), 'test-house');
  assert(alerts.length === 0, 'healthy batch produces no alerts');
}

// ─── Summary ───
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
