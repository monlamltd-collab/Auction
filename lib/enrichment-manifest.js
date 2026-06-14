// ═══════════════════════════════════════════════════════════════
// ENRICHMENT MANIFEST — Per-lot observability layer
// ═══════════════════════════════════════════════════════════════
// Every lot carries a manifest recording what the pipeline attempted
// for each external data source, whether it succeeded, skipped, or
// failed, and the resulting provenance. This collapses silent-failure
// bugs into a single visible layer — "empty" and "unknown" become
// distinct, debuggable states.
//
// All recorder functions mutate the manifest in place and return it.
// All are pure (no I/O) — safe to call from any pipeline stage.

// ── Status vocabularies (kept as plain string unions for JSONB flexibility) ──
export const EPC_STATUSES = Object.freeze([
  'ok',                          // matched, rating extracted
  'cache_hit',                   // prior enrichment_cache row satisfied the query
  'no_match_with_address',       // address complete, API responded, matcher found nothing → alertable
  'skipped_incomplete_address',  // no street number / street words — matcher can't even try
  'skipped_no_postcode',         // no postcode extracted
  'skipped_no_creds',            // EPC_API_EMAIL / EPC_API_KEY missing
  'api_empty_for_postcode',      // API responded with zero records for the postcode
  'circuit_open',                // breaker tripped after repeated failures
  'api_error',                   // non-2xx response
  'timeout',                     // request exceeded budget
]);

export const FLOOD_STATUSES = Object.freeze([
  'ok',
  'cache_hit',
  'no_postcode',
  'geocode_failed',
  'circuit_open',
  'api_error',
]);

export const LR_STATUSES = Object.freeze([
  'ok',                // ≥1 comp returned
  'ok_no_comps',       // API responded cleanly with zero sales in this postcode
  'cache_hit',
  'no_postcode',
  'circuit_open',
  'api_error',
]);

export const GEOCODE_STATUSES = Object.freeze([
  'ok',
  'cache_hit',
  'no_postcode',
  'api_error',
  'no_coords',
]);

export const FUNDABILITY_STATUSES = Object.freeze([
  'api_ok',
  'cache_hit',
  'api_timeout',
  'api_error',
  'zero_price',
  'sent_incomplete',
]);

export const OS_PLACES_STATUSES = Object.freeze([
  'ok',                    // matched with score >= 0.3
  'cache_hit',             // served from os_places_cache
  'cache_hit_no_match',    // negative result served from os_places_cache (cached no-UPRN; os-places.js:336). Was missing → recordOsPlaces threw on every cached negative lookup, spamming "unknown status" errors fleet-wide and blocking persist on first-contact-heavy houses (allsop: 431/431 first-contact → all threw → 0 persisted, 2026-06-14).
  'no_match',              // API responded with empty results
  'low_confidence',        // match returned but score < 0.3 (rejected)
  'skipped_no_address',    // lot has no address text to query
  'skipped_no_creds',      // OS_DATA_HUB_KEY missing
  'circuit_open',          // breaker tripped
  'api_error',             // non-2xx
  'timeout',               // request exceeded budget
]);

export const POSTCODES_IO_STATUSES = Object.freeze([
  'ok',                    // postcode validated, lat/lng returned
  'no_match',              // 404 — postcode not live
  'invalid_format',        // input couldn't be parsed as a UK postcode
  'circuit_open',          // breaker tripped
  'api_error',             // non-2xx, non-404
  'timeout',               // request exceeded budget
  'skipped_no_postcode',   // lot has no postcode to query
  'skipped_not_needed',    // OS Places already gave us a UPRN — no fallback ran
]);

export const YIELD_SOURCES = Object.freeze(['scoring', 'enrichment']);

// Reasons a yield / below-market scoring slot was deliberately skipped
// rather than left open. "skipped_block_lot" covers Allsop RI/RP/CI
// references and any lot with units > 1 — per-unit comps and rents
// don't apply to a whole-block sale, so firing those signals on the
// total guide produces nonsense (yield ≈ 0%, below_market ≈ -5000%).
export const SCORING_SKIP_REASONS = Object.freeze([
  'skipped_block_lot',
]);

export const POST_AUCTION_STATUSES = Object.freeze([
  'status_updated',         // re-fetch found a definitive new status (sold/unsold/withdrawn/stc)
  'no_change',              // re-fetch succeeded but source still shows the old status
  'url_dead',               // detail page 404/410 — source removed the listing
  'fetch_failed',           // network/timeout/anti-bot — try again next sweep
]);

export const MULTI_IMAGE_STATUSES = Object.freeze([
  'gallery_added',          // detail-page yielded 3+ images, lot.images now populated
  'gallery_partial',        // 1-2 images found (better than nothing, still not a gallery)
  'no_images_found',        // detail page returned 0 images
  'url_dead',               // detail page 404/410
  'fetch_failed',           // network/timeout/anti-bot
]);

// HMLR bulk-loaded datasets — read from Supabase tables refreshed monthly.
// No external API calls; failure modes are limited to no-data and db_error.
export const HPI_STATUSES = Object.freeze([
  'ok',
  'no_match',          // district name not present in hmlr_hpi
  'no_input',          // no admin_district resolved for the postcode
  'db_error',
]);

// EPC recommendations — extends the EPC enrichment to fetch the per-certificate
// /recommendations/{lmkKey} endpoint and aggregate "deferred capex".
export const EPC_RECOMMENDATIONS_STATUSES = Object.freeze([
  'ok',                    // ≥1 recommendation parsed
  'cache_hit',             // memoised by lmk_key
  'empty',                 // certificate has zero recommendations
  'skipped_no_lmk_key',    // matched EPC record didn't carry an lmk-key
  'skipped_not_matched',   // no EPC match in the parent lookup
  'api_error',             // non-2xx
  'timeout',
  'circuit_open',
]);

// Rule-based value estimator (lib/pipeline/value-estimator.js) — recorded
// per lot so we can audit anchor source / confidence distribution.
export const VALUE_ESTIMATE_STATUSES = Object.freeze([
  'ok',                    // estimate produced
  'no_anchor',             // no street comp + no HPI fallback → null estimate
  'skipped',               // not attempted (e.g. lot type out of scope)
]);

export const COMPANIES_STATUSES = Object.freeze([
  'ok',
  'no_match',          // postcode has no corporate / overseas owners on file
  'no_postcode',
  'db_error',
]);

// Title-register surfacing — matches a lot's address to a corporate /
// overseas-owned title (free hmlr_corporate_owners data) and captures the
// title number + registered proprietor. The title register proper is a
// paid HMLR product; this covers the subset that is corporately owned.
export const TITLE_REGISTER_STATUSES = Object.freeze([
  'ok',          // address matched a single corporate/overseas-owned title
  'no_match',    // no confident address match — `reason` carries the detail
  'no_postcode', // lot has no usable postcode to query
  'db_error',    // hmlr_corporate_owners query failed
]);

// ── Factory ──
export function createManifest() {
  return {
    scraped_at: null,
    enriched_at: null,
    extract: {
      strategy: null,      // 'dom' | 'ai' | 'dom+ai'
      ai_tier: null,       // 'flash-lite' | 'pro' | null
      field_coverage: {},  // { address: true, price: false, ... }
    },
    epc: null,
    epc_recommendations: null,
    flood: null,
    land_registry: null,
    geocode: null,
    fundability: null,
    os_places: null,
    postcodes_io: null,
    post_auction_rescrape: null,
    multi_image_sweep: null,
    hpi: null,
    companies: null,
    title_register: null,
    value_estimate: null,
    scoring: {
      yield_scored_by: null,
      below_market_scored_by: null,
      signals_fired: [],
    },
  };
}

// ── Recorders ──
export function recordScraped(manifest, { at, method, hash } = {}) {
  manifest.scraped_at = at || new Date().toISOString();
  if (method) manifest.extract.scrape_method = method;
  if (hash) manifest.extract.scrape_hash = hash;
  return manifest;
}

export function markEnriched(manifest) {
  manifest.enriched_at = new Date().toISOString();
  return manifest;
}

export function recordExtract(manifest, { strategy, aiTier, fieldCoverage } = {}) {
  if (strategy !== undefined) manifest.extract.strategy = strategy;
  if (aiTier !== undefined) manifest.extract.ai_tier = aiTier;
  if (fieldCoverage && typeof fieldCoverage === 'object') {
    manifest.extract.field_coverage = { ...manifest.extract.field_coverage, ...fieldCoverage };
  }
  return manifest;
}

export function recordEpc(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordEpc: status is required');
  if (!EPC_STATUSES.includes(entry.status)) {
    throw new Error(`recordEpc: unknown status "${entry.status}"`);
  }
  manifest.epc = { ...entry };
  return manifest;
}

export function recordFlood(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordFlood: status is required');
  if (!FLOOD_STATUSES.includes(entry.status)) {
    throw new Error(`recordFlood: unknown status "${entry.status}"`);
  }
  manifest.flood = { ...entry };
  return manifest;
}

export function recordLandRegistry(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordLandRegistry: status is required');
  if (!LR_STATUSES.includes(entry.status)) {
    throw new Error(`recordLandRegistry: unknown status "${entry.status}"`);
  }
  manifest.land_registry = { ...entry };
  return manifest;
}

export function recordGeocode(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordGeocode: status is required');
  if (!GEOCODE_STATUSES.includes(entry.status)) {
    throw new Error(`recordGeocode: unknown status "${entry.status}"`);
  }
  manifest.geocode = { ...entry };
  return manifest;
}

export function recordFundability(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordFundability: status is required');
  if (!FUNDABILITY_STATUSES.includes(entry.status)) {
    throw new Error(`recordFundability: unknown status "${entry.status}"`);
  }
  manifest.fundability = { ...entry };
  return manifest;
}

export function recordOsPlaces(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordOsPlaces: status is required');
  if (!OS_PLACES_STATUSES.includes(entry.status)) {
    throw new Error(`recordOsPlaces: unknown status "${entry.status}"`);
  }
  manifest.os_places = { ...entry };
  return manifest;
}

export function recordPostcodesIo(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordPostcodesIo: status is required');
  if (!POSTCODES_IO_STATUSES.includes(entry.status)) {
    throw new Error(`recordPostcodesIo: unknown status "${entry.status}"`);
  }
  manifest.postcodes_io = { ...entry, recorded_at: new Date().toISOString() };
  return manifest;
}

export function recordYieldScoring(manifest, { scoredBy, signal } = {}) {
  if (scoredBy && !YIELD_SOURCES.includes(scoredBy)) {
    throw new Error(`recordYieldScoring: unknown source "${scoredBy}"`);
  }
  // First writer wins — preserves provenance and prevents double-count
  if (manifest.scoring.yield_scored_by === null && scoredBy) {
    manifest.scoring.yield_scored_by = scoredBy;
  }
  if (signal && !manifest.scoring.signals_fired.includes(signal)) {
    manifest.scoring.signals_fired.push(signal);
  }
  return manifest;
}

export function recordBelowMarketScoring(manifest) {
  if (manifest.scoring.below_market_scored_by === null) {
    manifest.scoring.below_market_scored_by = 'enrichment';
  }
  return manifest;
}

/**
 * Close the yield-scoring slot without firing a yield signal — used when
 * the lot's shape makes per-unit yield meaningless (e.g. block sale,
 * portfolio, commercial investment). Mirrors recordYieldScoring(): first
 * writer wins, so a later genuine score won't overwrite the skip reason.
 */
export function recordYieldSkipped(manifest, reason) {
  if (!reason) throw new Error('recordYieldSkipped: reason is required');
  if (!SCORING_SKIP_REASONS.includes(reason)) {
    throw new Error(`recordYieldSkipped: unknown reason "${reason}"`);
  }
  if (manifest.scoring.yield_scored_by === null) {
    manifest.scoring.yield_scored_by = reason;
  }
  return manifest;
}

/**
 * Close the below-market slot without firing a below-market signal.
 * Same shape as recordYieldSkipped — keeps single-source-of-truth gating
 * via canScoreBelowMarket().
 */
export function recordBelowMarketSkipped(manifest, reason) {
  if (!reason) throw new Error('recordBelowMarketSkipped: reason is required');
  if (!SCORING_SKIP_REASONS.includes(reason)) {
    throw new Error(`recordBelowMarketSkipped: unknown reason "${reason}"`);
  }
  if (manifest.scoring.below_market_scored_by === null) {
    manifest.scoring.below_market_scored_by = reason;
  }
  return manifest;
}

export function recordPostAuctionRescrape(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordPostAuctionRescrape: status is required');
  if (!POST_AUCTION_STATUSES.includes(entry.status)) {
    throw new Error(`recordPostAuctionRescrape: unknown status "${entry.status}" — expected one of ${POST_AUCTION_STATUSES.join(', ')}`);
  }
  manifest.post_auction_rescrape = { ...entry, recorded_at: new Date().toISOString() };
  return manifest;
}

export function recordMultiImageSweep(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordMultiImageSweep: status is required');
  if (!MULTI_IMAGE_STATUSES.includes(entry.status)) {
    throw new Error(`recordMultiImageSweep: unknown status "${entry.status}" — expected one of ${MULTI_IMAGE_STATUSES.join(', ')}`);
  }
  manifest.multi_image_sweep = { ...entry, recorded_at: new Date().toISOString() };
  return manifest;
}

export function recordHpi(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordHpi: status is required');
  if (!HPI_STATUSES.includes(entry.status)) {
    throw new Error(`recordHpi: unknown status "${entry.status}"`);
  }
  manifest.hpi = { ...entry };
  return manifest;
}

export function recordEpcRecommendations(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordEpcRecommendations: status is required');
  if (!EPC_RECOMMENDATIONS_STATUSES.includes(entry.status)) {
    throw new Error(`recordEpcRecommendations: unknown status "${entry.status}"`);
  }
  manifest.epc_recommendations = { ...entry, recorded_at: new Date().toISOString() };
  return manifest;
}

export function recordValueEstimate(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordValueEstimate: status is required');
  if (!VALUE_ESTIMATE_STATUSES.includes(entry.status)) {
    throw new Error(`recordValueEstimate: unknown status "${entry.status}"`);
  }
  manifest.value_estimate = { ...entry, recorded_at: new Date().toISOString() };
  return manifest;
}

export function recordCompanies(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordCompanies: status is required');
  if (!COMPANIES_STATUSES.includes(entry.status)) {
    throw new Error(`recordCompanies: unknown status "${entry.status}"`);
  }
  manifest.companies = { ...entry };
  return manifest;
}

export function recordTitleRegister(manifest, entry) {
  if (!entry || !entry.status) throw new Error('recordTitleRegister: status is required');
  if (!TITLE_REGISTER_STATUSES.includes(entry.status)) {
    throw new Error(`recordTitleRegister: unknown status "${entry.status}"`);
  }
  manifest.title_register = { ...entry };
  return manifest;
}

/**
 * True when the yield-scoring slot is still open — scorers should
 * consult this before adding yield points so we only score once.
 */
export function canScoreYield(manifest) {
  return manifest.scoring.yield_scored_by === null;
}

/**
 * True when the below-market scoring slot is still open. enrichLots()
 * is invoked twice per cycle (hygiene wave Pass 3 + Pass 7) on
 * overlapping lot sets — without this gate the +1/+2 below-market
 * points were being added twice. The score column is clamped to 10
 * so the duplication was invisible at the column level, but
 * scoreBreakdown ended up with two identical "X% below market" rows.
 */
export function canScoreBelowMarket(manifest) {
  return manifest.scoring.below_market_scored_by === null;
}

// ── Batch-level summary for the quality gate ──
// Counts each status across all lots' manifests so harness rules can
// distinguish "EPC down" from "this batch genuinely has no EPC data".
export function summariseBatch(lots) {
  const tally = () => ({});
  const summary = {
    total: Array.isArray(lots) ? lots.length : 0,
    with_manifest: 0,
    epc: tally(),
    flood: tally(),
    land_registry: tally(),
    geocode: tally(),
    fundability: tally(),
  };
  if (!Array.isArray(lots) || lots.length === 0) return summary;

  for (const lot of lots) {
    const m = lot._enrichment;
    if (!m) continue;
    summary.with_manifest++;
    for (const source of ['epc', 'flood', 'land_registry', 'geocode', 'fundability']) {
      const entry = m[source];
      if (!entry || !entry.status) continue;
      summary[source][entry.status] = (summary[source][entry.status] || 0) + 1;
    }
  }
  return summary;
}

// ── Per-source alert evaluator ──
// Returns an array of alert specs the caller can feed to fireAlert.
// Rules by source:
//   • {source}_creds_missing — binary (any lot with the "missing creds" status)
//   • {source}_matcher_weak  — EPC only: complete address + API responded + no match
//                              rate ≥ 0.5 across ≥ 5 attempts. Indicates the matcher
//                              or address format is failing rather than coverage gap.
//   • {source}_api_unhealthy — (api_error + timeout + circuit_open) / attempts ≥ 0.5
//                              across ≥ 5 attempts where a call was actually made.
const UNHEALTHY_STATUSES = Object.freeze({
  epc: new Set(['api_error', 'timeout', 'circuit_open']),
  flood: new Set(['api_error', 'circuit_open']),
  land_registry: new Set(['api_error', 'circuit_open']),
  geocode: new Set(['api_error']),
  fundability: new Set(['api_timeout', 'api_error']),
});

const ATTEMPT_STATUSES = Object.freeze({
  epc: new Set(['ok', 'cache_hit', 'no_match_with_address', 'api_empty_for_postcode', 'api_error', 'timeout', 'circuit_open']),
  flood: new Set(['ok', 'cache_hit', 'api_error', 'circuit_open']),
  land_registry: new Set(['ok', 'ok_no_comps', 'cache_hit', 'api_error', 'circuit_open']),
  geocode: new Set(['ok', 'cache_hit', 'api_error', 'no_coords']),
  fundability: new Set(['api_ok', 'cache_hit', 'api_timeout', 'api_error']),
});

const CREDS_MISSING_STATUS = Object.freeze({
  epc: 'skipped_no_creds',
  // Other sources have no cred requirement — left undefined.
});

const DEFAULT_MIN_ATTEMPTS = 5;
const DEFAULT_UNHEALTHY_THRESHOLD = 0.5;

/**
 * @param {object} summary - Output of summariseBatch
 * @param {string} house - House slug for alert house field
 * @param {object} [opts]
 * @param {number} [opts.minAttempts=5]
 * @param {number} [opts.unhealthyThreshold=0.5]
 * @returns {Array<{ type, severity, house, message, meta }>}
 */
export function deriveAlerts(summary, house, opts = {}) {
  const minAttempts = opts.minAttempts ?? DEFAULT_MIN_ATTEMPTS;
  const threshold = opts.unhealthyThreshold ?? DEFAULT_UNHEALTHY_THRESHOLD;
  const alerts = [];

  for (const source of ['epc', 'flood', 'land_registry', 'geocode', 'fundability']) {
    const counts = summary[source] || {};

    // Rule 1: creds missing (only defined for EPC)
    const credsStatus = CREDS_MISSING_STATUS[source];
    if (credsStatus && (counts[credsStatus] || 0) > 0) {
      alerts.push({
        type: `${source}_creds_missing`,
        severity: 'error',
        house,
        message: `${source.toUpperCase()} credentials not configured — ${counts[credsStatus]} lots skipped`,
        meta: { source, counts },
      });
    }

    // Compute attempts + unhealthy counts
    let attempts = 0;
    let unhealthy = 0;
    for (const [status, n] of Object.entries(counts)) {
      if (ATTEMPT_STATUSES[source].has(status)) attempts += n;
      if (UNHEALTHY_STATUSES[source].has(status)) unhealthy += n;
    }

    // Rule 2: EPC matcher weakness — complete address + API responded + no match
    if (source === 'epc') {
      const matchAttempts = (counts.ok || 0) + (counts.cache_hit || 0) + (counts.no_match_with_address || 0);
      const misses = counts.no_match_with_address || 0;
      if (matchAttempts >= minAttempts && (misses / matchAttempts) >= threshold) {
        alerts.push({
          type: 'epc_matcher_weak',
          severity: 'warning',
          house,
          message: `EPC matcher found no record for ${misses}/${matchAttempts} lots with complete addresses (≥${Math.round(threshold * 100)}% miss rate)`,
          meta: { source: 'epc', matchAttempts, misses, counts },
        });
      }
    }

    // Rule 3: API unhealthy
    if (attempts >= minAttempts && (unhealthy / attempts) >= threshold) {
      alerts.push({
        type: `${source}_api_unhealthy`,
        severity: 'warning',
        house,
        message: `${source.toUpperCase()} API failing: ${unhealthy}/${attempts} calls errored (≥${Math.round(threshold * 100)}% failure rate)`,
        meta: { source, attempts, unhealthy, counts },
      });
    }
  }

  return alerts;
}
