// ═══════════════════════════════════════════════════════════════
// OS PLACES API CLIENT — Address → UPRN + canonical address
// ═══════════════════════════════════════════════════════════════
// Wraps OS Data Hub's Places API (https://api.os.uk/search/places/v1).
// Used during first-contact enrichment to stamp every brand-new lot
// with its UPRN, canonical address, classification, and lat/lng.
//
// Free-tier budget: 100,000 transactions/month on the OS Data Hub
// Premium plan (which has a free tier — confusing naming, but yes).
// At ~5,000 lots/month with first-contact-only gating, we use < 5%.
//
// Cache: postcode-keyed Supabase table os_places_cache, 90-day TTL.
// UPRNs are very stable (only change on demolition/new build).
//
// Circuit breaker: 3 consecutive failures → 10-minute pause.
//
// Manifest statuses (recorded into enrichment_manifest.os_places):
//   'ok'                    — match found, fresh from API
//   'cache_hit'             — positive match served from os_places_cache
//   'cache_hit_no_match'    — negative result served from os_places_cache
//                             (saves an API call when re-attempting an address
//                             that recently returned no_match)
//   'no_match'              — API responded with empty results (cached for
//                             NEGATIVE_CACHE_TTL_DAYS to suppress hammering)
//   'low_confidence'        — match returned but score < 0.3 (rejected)
//   'skipped_no_address'    — lot has no address text to query
//   'skipped_no_creds'      — OS_DATA_HUB_KEY not set
//   'circuit_open'          — breaker tripped
//   'api_error'             — non-2xx
//   'timeout'               — request exceeded budget

import { supabase } from './supabase.js';
import { emitPipelineEvent, PIPELINE_EVENT_TYPES } from './pipeline/pipeline-events.js';

const OS_API_BASE = 'https://api.os.uk/search/places/v1';
const FIND_TIMEOUT_MS = 6000;
const CACHE_TTL_DAYS = 90;
// Negative cache TTL — addresses that don't match OS Places almost always
// continue not to match (rural "Land at..." plots, off-grid plots, demolished
// buildings). 1 day is short enough that a real address that briefly failed
// gets retried tomorrow but long enough that we don't hammer the API every
// time the auction-house scrape runs. COVERAGE_FIX_PLAN.md fix #3.
const NEGATIVE_CACHE_TTL_DAYS = 1;
const MIN_GAP_MS = 100; // OS Data Hub allows 600 req/min — 100ms is well clear

let _lastCallAt = 0;

class CircuitBreaker {
  constructor(name, { maxFailures = 3, resetMs = 600000, onTransition } = {}) {
    this.name = name;
    this.maxFailures = maxFailures;
    this.resetMs = resetMs;
    this.failures = 0;
    this.openedAt = 0;
    this._onTransition = onTransition || null; // (newState, reason) => void
  }
  // Pure observability read — does NOT mutate state. Use this from anything
  // that just wants to know "is the breaker currently tripped?" (status
  // endpoints, retry-queue drain pre-checks, manifest stamps). Calling the
  // mutating isOpen() from those paths would silently half-open the breaker
  // as a side effect of the read, then re-trip it on the next live call,
  // bypassing graduated backoff.
  peekOpen() {
    if (this.failures < this.maxFailures) return false;
    return Date.now() - this.openedAt <= this.resetMs;
  }
  isOpen() {
    if (this.failures < this.maxFailures) return false;
    if (Date.now() - this.openedAt > this.resetMs) {
      console.log(`Circuit breaker [${this.name}] half-open — retrying`);
      this.failures = 0;
      // Transition: open → closed (auto-reset after resetMs)
      if (this._onTransition) {
        try { this._onTransition('closed', 'auto_reset'); } catch { /* observability is best-effort */ }
      }
      return false;
    }
    return true;
  }
  recordFailure() {
    const wasOpen = this.failures >= this.maxFailures;
    this.failures++;
    if (this.failures >= this.maxFailures && !wasOpen) {
      this.openedAt = Date.now();
      console.warn(`Circuit breaker [${this.name}] OPEN — pausing for ${this.resetMs / 1000}s`);
      // Transition: closed → open (failure threshold crossed)
      if (this._onTransition) {
        try { this._onTransition('open', 'failure_threshold'); } catch { /* observability is best-effort */ }
      }
    }
  }
  recordSuccess() {
    const wasOpen = this.failures >= this.maxFailures;
    this.failures = 0;
    // Transition: open → closed (only when transitioning from actually-open)
    if (wasOpen && this._onTransition) {
      try { this._onTransition('closed', 'success'); } catch { /* observability is best-effort */ }
    }
  }
}

// Emit pipeline_events on circuit transitions so the enrichment_health view
// can show open/close history without scraping process logs.
const osBreaker = new CircuitBreaker('os-places', {
  onTransition: (newState, reason) => {
    emitPipelineEvent({
      source: 'os-places.CircuitBreaker',
      eventType: newState === 'open'
        ? PIPELINE_EVENT_TYPES.ENRICH_UPRN_CIRCUIT_OPEN
        : PIPELINE_EVENT_TYPES.ENRICH_UPRN_CIRCUIT_CLOSED,
      eventData: { reason, breaker: 'os-places' },
    }).catch(() => { /* never fail a real call due to observability */ });
  },
});

// Test-only hook to reset breaker state between tests
export function _resetCircuitForTest() {
  osBreaker.failures = 0;
  osBreaker.openedAt = 0;
}

function normaliseAddressKey(address, postcode) {
  const a = (address || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/,+/g, ',');
  const p = (postcode || '').trim().toUpperCase().replace(/\s+/g, ' ');
  return `${a}|${p}`;
}

async function rateLimit() {
  const wait = MIN_GAP_MS - (Date.now() - _lastCallAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastCallAt = Date.now();
}

// Map a lookupAddress result to a pipeline_events row and emit it.
// Best-effort — caller must not await this in a way that could fail the lookup.
// `lotId` is optional; null when the caller hasn't persisted the lot yet.
function emitLookupOutcome(result, { lotId = null, addressKey = null } = {}) {
  if (!result) return;
  // skipped_no_address / skipped_no_creds: no real call attempted, but log
  // for completeness so enrichment_health can distinguish "no config" from
  // "broken upstream".
  const isOk =
    result.status === 'ok' ||
    result.status === 'cache_hit';
  const isFail =
    result.status === 'api_error' ||
    result.status === 'timeout' ||
    result.status === 'no_match' ||
    result.status === 'low_confidence' ||
    result.status === 'cache_hit_no_match' ||
    result.status === 'skipped_no_creds' ||
    result.status === 'skipped_no_address' ||
    result.status === 'circuit_open';
  if (!isOk && !isFail) return;
  emitPipelineEvent({
    source: 'os-places.lookupAddress',
    eventType: isOk
      ? PIPELINE_EVENT_TYPES.ENRICH_UPRN_OK
      : PIPELINE_EVENT_TYPES.ENRICH_UPRN_FAIL,
    lotId,
    eventData: {
      status: result.status,
      uprn: result.uprn || null,
      matchScore: result.matchScore ?? null,
      httpStatus: result.httpStatus ?? null,
      addressKey,
    },
  }).catch(() => { /* observability never fails callers */ });
}

/**
 * Look up an address in OS Places API.
 *
 * Strategy:
 *   1. Cache hit (90-day TTL) → return cached
 *   2. Cache miss → call OS Places /find with full address text
 *   3. Reject low-confidence matches (score < 0.3) — better to return null
 *      than to stamp a wrong UPRN
 *   4. Persist successful matches to os_places_cache
 *
 * @param {object} lot - { address, postcode } at minimum
 * @returns {Promise<{ status, uprn, fullAddress, classificationCode, lat, lng, matchScore } | null>}
 */
export async function lookupAddress(lot) {
  const address = lot?.address;
  const postcode = lot?.postcode;
  const lotId = lot?.id ?? null;

  if (!address || address.length < 5) {
    const result = { status: 'skipped_no_address' };
    emitLookupOutcome(result, { lotId });
    return result;
  }

  const cacheKey = normaliseAddressKey(address, postcode);

  // ── Cache lookup — runs BEFORE the breaker + creds checks ──
  // A cached UPRN is a static property fact; serve it regardless of upstream
  // health. The prior order (breaker first) made every cached UPRN unreachable
  // during an outage — the exact failure mode documented in
  // audit/2026-05-25-uprn-rca.md (2,269 cached rows, 0 hits for weeks).
  if (supabase) {
    try {
      const { data: cached } = await supabase
        .from('os_places_cache')
        .select('*')
        .eq('address_key', cacheKey)
        .single();

      if (cached) {
        const ageDays = (Date.now() - new Date(cached.fetched_at).getTime()) / 86400000;
        // Positive results live for CACHE_TTL_DAYS (90); negatives cached only
        // for NEGATIVE_CACHE_TTL_DAYS (1) so a transient API hiccup doesn't
        // freeze a real lot's UPRN out for three months.
        const ttlDays = cached.uprn ? CACHE_TTL_DAYS : NEGATIVE_CACHE_TTL_DAYS;
        if (ageDays < ttlDays) {
          if (cached.uprn) {
            const r = {
              status: 'cache_hit',
              uprn: cached.uprn,
              fullAddress: cached.full_address,
              classificationCode: cached.classification_code,
              lat: cached.lat,
              lng: cached.lng,
              matchScore: cached.match_score,
            };
            emitLookupOutcome(r, { lotId, addressKey: cacheKey });
            return r;
          }
          // Negative cache hit — address has no UPRN and we tried recently.
          // Distinct status so callers can see this in the manifest (helps us
          // measure how often the cache saves a live API call).
          const r = { status: 'cache_hit_no_match' };
          emitLookupOutcome(r, { lotId, addressKey: cacheKey });
          return r;
        }
      }
    } catch { /* cache miss is fine */ }
  }

  // ── Live API call required from here on ──
  if (!process.env.OS_DATA_HUB_KEY) {
    const r = { status: 'skipped_no_creds' };
    emitLookupOutcome(r, { lotId, addressKey: cacheKey });
    return r;
  }

  if (osBreaker.isOpen()) {
    const r = { status: 'circuit_open' };
    emitLookupOutcome(r, { lotId, addressKey: cacheKey });
    return r;
  }

  // ── Live API call ──
  await rateLimit();

  // OS Places /find takes a free-text query; passing address + postcode
  // gives the matcher both clues. minmatch=0.4 filters obvious mismatches
  // server-side. maxresults=1 — we only want the top hit.
  const query = postcode ? `${address}, ${postcode}` : address;
  const params = new URLSearchParams({
    query,
    maxresults: '1',
    minmatch: '0.4',
    output_srs: 'WGS84', // returns lat/lng instead of OS National Grid eastings/northings
    key: process.env.OS_DATA_HUB_KEY,
  });
  const url = `${OS_API_BASE}/find?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FIND_TIMEOUT_MS);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      // 401/403 typically means missing/invalid key or API not enabled on the project
      if (resp.status === 401 || resp.status === 403) {
        console.warn(`OS Places ${resp.status} — check OS_DATA_HUB_KEY and that "Places" is enabled on the project`);
      }
      osBreaker.recordFailure();
      const r = { status: 'api_error', httpStatus: resp.status };
      emitLookupOutcome(r, { lotId, addressKey: cacheKey });
      return r;
    }

    osBreaker.recordSuccess();
    const data = await resp.json();
    const result = data?.results?.[0]?.DPA;

    if (!result) {
      // Cache the negative — addresses that don't match almost always continue
      // not to match. Stored as a row with uprn=null + short TTL (see the
      // cache-lookup branch above). Without this, the gap-filler in
      // enrichment-wave.js Pass 5 hammers the API every cycle for the same
      // unmatched land lots. COVERAGE_FIX_PLAN.md fix #3.
      if (supabase) {
        try {
          await supabase.from('os_places_cache').upsert({
            address_key: cacheKey,
            uprn: null,
            full_address: null,
            postcode: postcode || null,
            classification_code: null,
            lat: null,
            lng: null,
            match_score: null,
            raw_response: { negative: true },
            fetched_at: new Date().toISOString(),
          }, { onConflict: 'address_key' });
        } catch { /* non-fatal — worst case we re-query next cycle */ }
      }
      const r = { status: 'no_match' };
      emitLookupOutcome(r, { lotId, addressKey: cacheKey });
      return r;
    }

    // OS Places match score is in MATCH (0-1). Reject anything < 0.3 — it's
    // better to return no UPRN than to stamp the wrong one.
    const score = parseFloat(result.MATCH || '0');
    if (score < 0.3) {
      const r = { status: 'low_confidence', matchScore: score };
      emitLookupOutcome(r, { lotId, addressKey: cacheKey });
      return r;
    }

    const out = {
      status: 'ok',
      uprn: String(result.UPRN || ''),
      fullAddress: result.ADDRESS || null,
      classificationCode: result.CLASSIFICATION_CODE || null,
      lat: typeof result.LAT === 'number' ? result.LAT : parseFloat(result.LAT) || null,
      lng: typeof result.LNG === 'number' ? result.LNG : parseFloat(result.LNG) || null,
      matchScore: score,
    };

    // ── Persist to cache (best-effort) ──
    if (supabase && out.uprn) {
      try {
        await supabase.from('os_places_cache').upsert({
          address_key: cacheKey,
          uprn: out.uprn,
          full_address: out.fullAddress,
          postcode: postcode || null,
          classification_code: out.classificationCode,
          lat: out.lat,
          lng: out.lng,
          match_score: out.matchScore,
          raw_response: result,
          fetched_at: new Date().toISOString(),
        }, { onConflict: 'address_key' });
      } catch (err) {
        console.warn(`OS Places cache write failed: ${err.message}`);
      }
    }

    emitLookupOutcome(out, { lotId, addressKey: cacheKey });
    return out;
  } catch (err) {
    if (err.name === 'AbortError') {
      osBreaker.recordFailure();
      const r = { status: 'timeout' };
      emitLookupOutcome(r, { lotId, addressKey: cacheKey });
      return r;
    }
    osBreaker.recordFailure();
    console.warn(`OS Places API error: ${err.message}`);
    const r = { status: 'api_error', error: err.message };
    emitLookupOutcome(r, { lotId, addressKey: cacheKey });
    return r;
  }
}

/**
 * Direct UPRN lookup — given a known UPRN, fetch the canonical address.
 * Useful for refreshing stale records or hydrating UPRNs that were
 * captured by other means.
 */
export async function lookupByUprn(uprn) {
  if (!uprn) return { status: 'skipped_no_uprn' };
  if (!process.env.OS_DATA_HUB_KEY) return { status: 'skipped_no_creds' };
  if (osBreaker.isOpen()) return { status: 'circuit_open' };

  await rateLimit();
  const params = new URLSearchParams({
    uprn: String(uprn),
    output_srs: 'WGS84',
    key: process.env.OS_DATA_HUB_KEY,
  });
  const url = `${OS_API_BASE}/uprn?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FIND_TIMEOUT_MS);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      osBreaker.recordFailure();
      return { status: 'api_error', httpStatus: resp.status };
    }
    osBreaker.recordSuccess();
    const data = await resp.json();
    const result = data?.results?.[0]?.DPA;
    if (!result) return { status: 'no_match' };

    return {
      status: 'ok',
      uprn: String(result.UPRN),
      fullAddress: result.ADDRESS || null,
      classificationCode: result.CLASSIFICATION_CODE || null,
      lat: parseFloat(result.LAT) || null,
      lng: parseFloat(result.LNG) || null,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      osBreaker.recordFailure();
      return { status: 'timeout' };
    }
    osBreaker.recordFailure();
    return { status: 'api_error', error: err.message };
  }
}

export function getCircuitStatus() {
  // peekOpen() not isOpen() — observability must be side-effect-free.
  return {
    open: osBreaker.peekOpen(),
    failures: osBreaker.failures,
    openedAt: osBreaker.openedAt,
  };
}
