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
// buildings). COVERAGE_FIX_PLAN.md fix #3.
//
// Raised 1→14 days on 2026-06-13: the 1-day TTL re-fired EVERY genuine
// no-match DAILY, and with a large fraction of auction lots being unmatchable
// rural/land addresses that burned the OS Data Hub 100k/mo free quota on doomed
// lookups → 429 → the circuit breaker latched → UPRN coverage collapsed to ~12%
// (manifest: 8,419 live lots circuit_open, only 2 ok). Only GENUINE no-matches
// are negative-cached (429/timeout return api_error and are never cached), and
// a detail-fetch that refines the address changes the cache key (fresh lookup),
// so a longer TTL only suppresses re-querying addresses OS Places authoritatively
// has no record for — exactly the doomed calls we want to stop. 14 days still
// retries a genuinely-new-build address within a fortnight.
const NEGATIVE_CACHE_TTL_DAYS = 14;

// OS Data Hub Places API rate limits (Premium plan, 100k/mo free tier):
//   Published: 600 requests/minute. Per-second cap not publicly documented
//   but enforced via 429 once short-term burst exceeds ~10 RPS.
// Prior strategy (MIN_GAP_MS = 100 → theoretical 600 RPM with zero headroom)
// blew up on 2026-04-30 — bursty enrichment waves tripped per-minute
// throttling, the circuit breaker latched on 3 × 429, and the system never
// self-recovered (see audits/2026-05-25-uprn-rca.md).
// New strategy: token bucket with 50% safety margin against the published
// limit. 5 tokens/sec sustained = 300 RPM. Capacity 10 absorbs the natural
// burstiness of an enrichment wave (~10 lots at once).
const BUCKET_CAPACITY = 10;             // max tokens (max burst size)
const BUCKET_REFILL_PER_SEC = 5;        // sustained rate = 5 RPS = 300 RPM
const RATE_LIMITED_THRESHOLD_MS = 500;  // wait above this emits enrich_uprn_rate_limited

class TokenBucket {
  constructor({ capacity, refillPerSec }) {
    this.capacity = capacity;
    this.refillPerMs = refillPerSec / 1000;
    this.tokens = capacity;
    this.lastRefillAt = Date.now();
  }
  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefillAt;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefillAt = now;
  }
  /** Acquire one token, blocking until one is available. Returns wait time in ms. */
  async acquire() {
    this._refill();
    if (this.tokens >= 1) { this.tokens -= 1; return 0; }
    const waitMs = Math.ceil((1 - this.tokens) / this.refillPerMs);
    await new Promise(r => setTimeout(r, waitMs));
    this._refill();
    this.tokens = Math.max(0, this.tokens - 1);
    return waitMs;
  }
}

const osBucket = new TokenBucket({ capacity: BUCKET_CAPACITY, refillPerSec: BUCKET_REFILL_PER_SEC });

// Test-only hook to refill the bucket between tests.
export function _resetBucketForTest() {
  osBucket.tokens = osBucket.capacity;
  osBucket.lastRefillAt = Date.now();
}

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

// Acquire a token from the OS Places bucket. Cache hits never call this —
// they return before any live-call gate (see lookupAddress structure). When
// the bucket forces a wait beyond RATE_LIMITED_THRESHOLD_MS, emits a
// best-effort enrich_uprn_rate_limited event so dashboards can surface
// throttling pressure separately from circuit-breaker trips.
async function rateLimit({ lotId = null, addressKey = null } = {}) {
  const waited = await osBucket.acquire();
  if (waited >= RATE_LIMITED_THRESHOLD_MS) {
    emitPipelineEvent({
      source: 'os-places.TokenBucket',
      eventType: PIPELINE_EVENT_TYPES.ENRICH_UPRN_RATE_LIMITED,
      lotId,
      eventData: {
        waited_ms: waited,
        threshold_ms: RATE_LIMITED_THRESHOLD_MS,
        bucket_tokens: Math.floor(osBucket.tokens),
        bucket_capacity: osBucket.capacity,
        addressKey,
      },
    }).catch(() => { /* observability never fails callers */ });
  }
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
  // audits/2026-05-25-uprn-rca.md (2,269 cached rows, 0 hits for weeks).
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
  await rateLimit({ lotId, addressKey: cacheKey });

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

  // lookupByUprn doesn't have a lotId / addressKey to log; the rate_limited
  // event will still fire with null lot_id when the bucket forces a wait.
  await rateLimit({ addressKey: `uprn:${uprn}` });
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
