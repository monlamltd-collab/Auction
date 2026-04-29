// ═══════════════════════════════════════════════════════════════
// POSTCODES.IO CLIENT — Postcode → lat/lng + admin codes
// ═══════════════════════════════════════════════════════════════
// Wraps https://api.postcodes.io — a free, no-auth UK postcode geocoder.
// Used as a fallback when OS Places returns 'no_match' or 'low_confidence'
// (or when we have a postcode but no UPRN — postcodes.io can still give
// us lat/lng even if OS Places can't pin the UPRN).
//
// What postcodes.io gives us that OS Places doesn't help with:
//   • Free, no API key required
//   • Works for *any* live UK postcode, even if the address text is
//     something OS Places can't match (e.g. "Land at the rear of...",
//     "Plot 5", "Storage Land")
//   • Bulk endpoint (POST /postcodes) for backfilling many at once
//
// What it DOESN'T give us:
//   • No UPRN — that's still OS Places exclusive
//   • No canonical street-level address — only postcode-centroid info
//
// COVERAGE_FIX_PLAN.md fix #5 (Phase 1 — postcodes.io fallback).

const POSTCODES_API_BASE = 'https://api.postcodes.io';
const FIND_TIMEOUT_MS = 4000;
const MIN_GAP_MS = 50; // No published rate limit; 50ms buffer ≈ 20 req/s soft cap

let _lastCallAt = 0;

class CircuitBreaker {
  constructor(name, { maxFailures = 3, resetMs = 600000 } = {}) {
    this.name = name;
    this.maxFailures = maxFailures;
    this.resetMs = resetMs;
    this.failures = 0;
    this.openedAt = 0;
  }
  // Pure observability read — see lib/os-places.js for the rationale.
  peekOpen() {
    if (this.failures < this.maxFailures) return false;
    return Date.now() - this.openedAt <= this.resetMs;
  }
  isOpen() {
    if (this.failures < this.maxFailures) return false;
    if (Date.now() - this.openedAt > this.resetMs) {
      console.log(`Circuit breaker [${this.name}] half-open — retrying`);
      this.failures = 0;
      return false;
    }
    return true;
  }
  recordFailure() {
    this.failures++;
    if (this.failures >= this.maxFailures) {
      this.openedAt = Date.now();
      console.warn(`Circuit breaker [${this.name}] OPEN — pausing for ${this.resetMs / 1000}s`);
    }
  }
  recordSuccess() { this.failures = 0; }
}

const breaker = new CircuitBreaker('postcodes-io');

// Test-only hook to reset breaker state between tests
export function _resetCircuitForTest() {
  breaker.failures = 0;
  breaker.openedAt = 0;
}

// Inject a custom fetch for tests — falls back to globalThis.fetch.
// Production callers should never set this; tests use it to stub responses.
let _fetchImpl = null;
export function _setFetchForTest(fn) { _fetchImpl = fn; }

async function rateLimit() {
  const wait = MIN_GAP_MS - (Date.now() - _lastCallAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastCallAt = Date.now();
}

function normalisePostcode(postcode) {
  if (!postcode) return null;
  const cleaned = String(postcode).trim().toUpperCase().replace(/\s+/g, ' ');
  // postcodes.io accepts both with and without space — normalise to with-space
  // form so the URL is canonical (helps any upstream caching).
  if (/^[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}$/.test(cleaned)) return cleaned;
  // Try to inject the space if missing (e.g. "SW1A1AA" → "SW1A 1AA")
  const compact = cleaned.replace(/\s/g, '');
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact)) {
    return compact.slice(0, -3) + ' ' + compact.slice(-3);
  }
  return null;
}

/**
 * Look up a postcode in postcodes.io.
 *
 * @param {string} postcode - UK postcode (any case, with or without space)
 * @returns {Promise<{ status, lat, lng, district, ward, region, country } | null>}
 *   Statuses:
 *     'ok'              — match found
 *     'no_match'        — postcode invalid or terminated (HTTP 404)
 *     'invalid_format'  — couldn't parse the input as a UK postcode
 *     'circuit_open'    — breaker tripped
 *     'api_error'       — non-2xx, non-404
 *     'timeout'         — request exceeded budget
 */
export async function lookupPostcode(postcode) {
  const normalised = normalisePostcode(postcode);
  if (!normalised) return { status: 'invalid_format' };

  if (breaker.isOpen()) return { status: 'circuit_open' };

  await rateLimit();

  const url = `${POSTCODES_API_BASE}/postcodes/${encodeURIComponent(normalised)}`;
  const fetchFn = _fetchImpl || globalThis.fetch;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FIND_TIMEOUT_MS);
    const resp = await fetchFn(url, { signal: controller.signal });
    clearTimeout(timer);

    if (resp.status === 404) {
      // 404 means the postcode is not live (terminated or never existed). NOT
      // a breaker-trip event — this is a definitive negative answer, not a
      // service problem. Don't increment failures.
      breaker.recordSuccess();
      return { status: 'no_match' };
    }
    if (!resp.ok) {
      breaker.recordFailure();
      return { status: 'api_error', httpStatus: resp.status };
    }

    breaker.recordSuccess();
    const data = await resp.json();
    const r = data?.result;
    if (!r) return { status: 'no_match' };

    return {
      status: 'ok',
      lat: typeof r.latitude === 'number' ? r.latitude : null,
      lng: typeof r.longitude === 'number' ? r.longitude : null,
      district: r.admin_district || null,
      ward: r.admin_ward || null,
      region: r.region || null,
      country: r.country || null,
      // Useful for future analytics — ONS LSOA + parish — but optional.
      lsoa: r.lsoa || null,
      parish: r.parish || null,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      breaker.recordFailure();
      return { status: 'timeout' };
    }
    breaker.recordFailure();
    return { status: 'api_error', error: err.message };
  }
}

/**
 * Bulk lookup — postcodes.io accepts up to 100 postcodes per POST.
 * Used by the one-shot backfill script for the ~3,619 lots that have a
 * postcode but no lat/lng. NOT used in the live enrichment pipeline,
 * which calls lookupPostcode one at a time per lot.
 *
 * @param {string[]} postcodes - up to 100 UK postcodes
 * @returns {Promise<Map<string, { lat, lng, district, ... } | null>>}
 *   keyed by the ORIGINAL input postcode (case + spacing preserved).
 */
export async function bulkLookupPostcodes(postcodes) {
  const out = new Map();
  if (!Array.isArray(postcodes) || postcodes.length === 0) return out;

  // Bucket into chunks of 100 (postcodes.io API limit).
  const fetchFn = _fetchImpl || globalThis.fetch;
  for (let i = 0; i < postcodes.length; i += 100) {
    const chunk = postcodes.slice(i, i + 100);
    const normalised = chunk.map(p => ({ original: p, normalised: normalisePostcode(p) }));
    const valid = normalised.filter(x => x.normalised);
    if (valid.length === 0) {
      for (const x of normalised) out.set(x.original, { status: 'invalid_format' });
      continue;
    }

    if (breaker.isOpen()) {
      for (const x of normalised) out.set(x.original, { status: 'circuit_open' });
      continue;
    }

    await rateLimit();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FIND_TIMEOUT_MS * 2);
      const resp = await fetchFn(`${POSTCODES_API_BASE}/postcodes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postcodes: valid.map(x => x.normalised) }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        breaker.recordFailure();
        for (const x of normalised) out.set(x.original, { status: 'api_error', httpStatus: resp.status });
        continue;
      }
      breaker.recordSuccess();
      const data = await resp.json();
      // result is an array of { query, result } where result may be null.
      const byQuery = new Map();
      for (const row of data?.result || []) byQuery.set(row.query, row.result);
      for (const { original, normalised: norm } of normalised) {
        if (!norm) { out.set(original, { status: 'invalid_format' }); continue; }
        const r = byQuery.get(norm);
        if (!r) { out.set(original, { status: 'no_match' }); continue; }
        out.set(original, {
          status: 'ok',
          lat: typeof r.latitude === 'number' ? r.latitude : null,
          lng: typeof r.longitude === 'number' ? r.longitude : null,
          district: r.admin_district || null,
          ward: r.admin_ward || null,
          region: r.region || null,
          country: r.country || null,
          lsoa: r.lsoa || null,
          parish: r.parish || null,
        });
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        breaker.recordFailure();
        for (const x of normalised) out.set(x.original, { status: 'timeout' });
      } else {
        breaker.recordFailure();
        for (const x of normalised) out.set(x.original, { status: 'api_error', error: err.message });
      }
    }
  }

  return out;
}

export function getCircuitStatus() {
  // peekOpen() not isOpen() — observability must be side-effect-free.
  return {
    open: breaker.peekOpen(),
    failures: breaker.failures,
    openedAt: breaker.openedAt,
  };
}
