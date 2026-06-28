// lib/rentals/index.js — Rental-comp scraper orchestrator (rollout #7).
//
// Sources: SpareRoom, OnTheMarket (plain HTTP), OpenRent (Firecrawl —
// their search page is JS-rendered and rejects bare GETs).
//
// Cadence: monthly. A (postcode, source) tuple is eligible for re-scrape
// when last_scraped_at < now() - 30 days, or never scraped.
//
// Volume: ~500 active-auction postcodes × 3 sources × 1 page each ≈ 1.5k
// fetches/month. SpareRoom + OTM are plain HTTP; OpenRent costs ~50
// Firecrawl credits/day under the daily-50 drain limit (a small fraction
// of monthly Firecrawl headroom).
//
// Dependencies injected via initRentals() to keep the module testable.

import { scrapeSpareRoom } from './spareroom.js';
import { scrapeOnTheMarket } from './onthemarket.js';
import { scrapeOpenRent } from './openrent.js';
import { log } from '../logging.js';
import { fireAlert } from '../harness/alert-router.js';

const SOURCES = {
  spareroom: scrapeSpareRoom,
  onthemarket: scrapeOnTheMarket,
  openrent: scrapeOpenRent,
};

const FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── Sanity-filter bounds ───────────────────────────────────────────────
// Scrapers occasionally pick up a £-string that isn't a real monthly rent —
// a deposit reference, a fee, a sibling card's price after a layout change.
// These bounds catch the silent-corruption tail. Values cover the realistic
// UK rental range; anything outside is almost certainly a parse artefact.
const MIN_RENT_PCM = 200;     // bedsit/room floor — flag below this
const MAX_RENT_PCM = 20000;   // central London penthouse ceiling
const MAX_BEDS = 10;          // anything > 10 bed is HMO/commercial misclass

// ─── Regression-alert thresholds ────────────────────────────────────────
// When a (postcode, source) historically returned ≥5 listings and a new
// scrape comes back with ≤1, that's a strong "extractor broke" signal.
// Tuned conservatively to avoid alerting on genuine empty postcodes.
const REGRESSION_PREV_MIN = 5;
const REGRESSION_NEW_MAX = 1;

let supabase = null;

export function initRentals({ supabase: sb } = {}) {
  supabase = sb;
}

/**
 * Sanity-filter listings to drop implausible rents and bed counts. Pure
 * function — exported for tests.
 *
 * @param {Array} listings - raw scraper output
 * @returns {{ kept: Array, rejected: Array }}
 */
export function applySanityFilters(listings) {
  const kept = [];
  const rejected = [];
  for (const l of listings) {
    const rent = Number(l.rent_pcm);
    if (!Number.isFinite(rent) || rent < MIN_RENT_PCM || rent > MAX_RENT_PCM) {
      rejected.push({ listing: l, reason: 'rent_out_of_range' });
      continue;
    }
    if (l.beds != null && Number(l.beds) > MAX_BEDS) {
      rejected.push({ listing: l, reason: 'beds_too_high' });
      continue;
    }
    kept.push(l);
  }
  return { kept, rejected };
}

/**
 * Scrape rental listings for a single postcode from one source.
 * Idempotent: re-running on the same (postcode, source) refreshes
 * scraped_at on existing rows and inserts new ones.
 *
 * @param {string} postcode - canonical postcode (e.g. "SW1A 1AA")
 * @param {string} source - 'spareroom' | 'onthemarket'
 * @returns {Promise<{ status, listingsFound, error? }>}
 */
export async function scrapeRentalsForPostcode(postcode, source) {
  const fn = SOURCES[source];
  if (!fn) return { status: 'unknown_source', listingsFound: 0 };
  if (!postcode || typeof postcode !== 'string') {
    return { status: 'invalid_postcode', listingsFound: 0 };
  }

  // Look up the previous freshness row before scraping. Used after the
  // scrape to detect coverage regressions (e.g. previously had 12
  // listings, now has 0 — extractor likely broke).
  const prevListingsFound = await readPrevListingsFound(postcode, source);

  let result;
  try {
    result = await fn(postcode);
  } catch (err) {
    log.warn('rental-scrape failed', { source, postcode, err: err.message });
    await recordFreshness(postcode, source, {
      status: 'http_error',
      listingsFound: 0,
      lastError: err.message,
    });
    await maybeFireRegressionAlert(postcode, source, prevListingsFound, 0, 'http_error');
    return { status: 'http_error', listingsFound: 0, error: err.message };
  }

  if (!result || !Array.isArray(result.listings)) {
    await recordFreshness(postcode, source, {
      status: 'parse_error',
      listingsFound: 0,
      lastError: 'no listings array returned',
    });
    return { status: 'parse_error', listingsFound: 0 };
  }

  // OpenRent's Firecrawl-backed scraper can short-circuit when credits
  // are exhausted, the API key is missing, or the upstream is down. Record
  // those distinctly from "no_match" so monitoring shows the real reason.
  if (result.skipped) {
    await recordFreshness(postcode, source, {
      status: 'circuit_open',
      listingsFound: 0,
      lastError: result.skipped,
    });
    return { status: 'circuit_open', listingsFound: 0, skipped: result.skipped };
  }

  const rawListings = result.listings;
  if (rawListings.length === 0) {
    await recordFreshness(postcode, source, { status: 'no_match', listingsFound: 0 });
    await maybeFireRegressionAlert(postcode, source, prevListingsFound, 0, 'no_match');
    return { status: 'no_match', listingsFound: 0 };
  }

  // Sanity-filter implausible rents/beds. Catches the silent-corruption
  // tail (deposit references, sibling-card bleed, OCR-style misparse).
  const { kept: listings, rejected } = applySanityFilters(rawListings);

  // If MORE than half the listings were rejected, the parser is probably
  // broken in a new way. Log loudly so it surfaces in production logs even
  // before the regression alert fires (which needs a prior baseline).
  if (rejected.length > 0 && rejected.length >= listings.length) {
    log.warn('rental-scrape: bulk sanity rejection', {
      source, postcode,
      kept: listings.length,
      rejected: rejected.length,
      sampleReasons: rejected.slice(0, 3).map(r => r.reason),
    });
  }

  if (listings.length === 0) {
    // Everything was filtered out — treat like no_match for freshness, but
    // emit a distinct sub-status so the postcode rotates back through the
    // queue and we know via logs that data WAS there but unusable.
    await recordFreshness(postcode, source, {
      status: 'no_match',
      listingsFound: 0,
      lastError: `all ${rejected.length} listings failed sanity check`,
    });
    await maybeFireRegressionAlert(postcode, source, prevListingsFound, 0, 'sanity_filtered_out');
    return { status: 'no_match', listingsFound: 0 };
  }

  // Upsert rows. ON CONFLICT (source, source_id, postcode) refreshes
  // scraped_at + rent (rents drift while listings stay live).
  if (supabase) {
    try {
      const rows = listings
        .filter(l => l.source_id && l.rent_pcm > 0)
        .map(l => ({
          postcode,
          source,
          source_id: String(l.source_id),
          url: l.url || null,
          rent_pcm: Math.round(l.rent_pcm),
          beds: typeof l.beds === 'number' ? l.beds : null,
          property_type: l.property_type || null,
          is_room_share: !!l.is_room_share,
          area_label: l.area_label || null,
          scraped_at: new Date().toISOString(),
        }));
      if (rows.length > 0) {
        const { error } = await supabase
          .from('postcode_rentals')
          .upsert(rows, { onConflict: 'source,source_id,postcode' });
        if (error) throw error;
      }
      await recordFreshness(postcode, source, {
        status: 'ok',
        listingsFound: rows.length,
      });
      await maybeFireRegressionAlert(postcode, source, prevListingsFound, rows.length, 'ok');
    } catch (err) {
      log.warn('rental-upsert failed', { source, postcode, err: err.message });
      await recordFreshness(postcode, source, {
        status: 'parse_error',
        listingsFound: 0,
        lastError: err.message,
      });
      await maybeFireRegressionAlert(postcode, source, prevListingsFound, 0, 'parse_error');
      return { status: 'parse_error', listingsFound: 0, error: err.message };
    }
  }

  return { status: 'ok', listingsFound: listings.length };
}

/**
 * Drain stale (postcode, source) tuples — anything not scraped in the
 * last 30 days, plus brand-new postcodes we've never tried. Limit caps
 * one drain run; the daily cron picks up where it left off.
 *
 * @param {object} opts
 * @param {number} [opts.limit=20] - max scrape calls per drain
 * @param {string[]} [opts.postcodes] - explicit list (overrides freshness check)
 * @param {boolean} [opts.force=false] - ignore freshness, scrape regardless
 */
export async function drainStaleRentals({ limit = 20, postcodes, force = false } = {}) {
  if (!supabase) return { attempted: 0, ok: 0, errors: 0 };

  let candidates;
  if (Array.isArray(postcodes) && postcodes.length > 0) {
    // Explicit list — fan out per source for each postcode.
    candidates = [];
    for (const pc of postcodes) {
      for (const source of Object.keys(SOURCES)) {
        candidates.push({ postcode: pc, source });
      }
    }
  } else {
    candidates = await selectStaleCandidates({ limit, force });
  }

  let ok = 0;
  let errors = 0;
  let skipped = 0;
  for (const { postcode, source } of candidates.slice(0, limit)) {
    const r = await scrapeRentalsForPostcode(postcode, source);
    if (r.status === 'ok' || r.status === 'no_match') ok++;
    else if (r.status === 'circuit_open') skipped++;
    else errors++;
    // Polite gap between calls — different sources are independent
    // hosts so 250ms is generous.
    await new Promise(r => setTimeout(r, 250));
  }
  log.info('drain-stale-rentals done', { attempted: candidates.length, ok, errors, skipped });
  return { attempted: candidates.length, ok, errors, skipped };
}

// ── Internal helpers ─────────────────────────────────────────────────

async function selectStaleCandidates({ limit, force }) {
  // Strategy — CURRENT lots only (what users see as biddable):
  //   1. Pool = postcodes on `available` lots whose auction is still upcoming
  //      (auction_date >= today) OR not yet dated (auction_date IS NULL).
  //      We deliberately EXCLUDE sold/stc/unsold and past-auction lots — those
  //      are long gone and not worth the nightly drain budget (owner directive:
  //      don't waste effort enriching lots no longer presented as current).
  //   2. Expand each postcode to (postcode, source) tuples.
  //   3. Drop tuples scraped within the freshness window unless force=true;
  //      never-scraped tuples (lastMs=0) sort first so the backlog drains.
  const today = new Date().toISOString().slice(0, 10);
  const { data: lotRows } = await supabase
    .from('lots').select('postcode')
    .not('postcode', 'is', null)
    .eq('status', 'available')
    .or(`auction_date.gte.${today},auction_date.is.null`)
    .order('auction_date', { ascending: true, nullsFirst: false })
    .limit(4000);
  const uniquePostcodes = [...new Set((lotRows || []).map(r => r.postcode))];
  if (uniquePostcodes.length === 0) return [];

  // Pull existing freshness rows, batched — the active-lot pool can be
  // thousands of postcodes, too many for a single .in() URL.
  const freshMap = new Map(); // key: `${postcode}|${source}` → ms
  const FRESH_CHUNK = 500;
  for (let i = 0; i < uniquePostcodes.length; i += FRESH_CHUNK) {
    const slice = uniquePostcodes.slice(i, i + FRESH_CHUNK);
    const { data: freshRows } = await supabase
      .from('postcode_rental_freshness')
      .select('postcode, source, last_scraped_at')
      .in('postcode', slice);
    for (const r of freshRows || []) {
      freshMap.set(`${r.postcode}|${r.source}`, Date.parse(r.last_scraped_at));
    }
  }

  const now = Date.now();
  const out = [];
  for (const postcode of uniquePostcodes) {
    for (const source of Object.keys(SOURCES)) {
      const key = `${postcode}|${source}`;
      const last = freshMap.get(key) || 0;
      if (force || (now - last) > FRESHNESS_MS) {
        out.push({ postcode, source, lastMs: last });
      }
    }
  }
  // Soonest-due first (oldest scrape first)
  out.sort((a, b) => a.lastMs - b.lastMs);
  return out.slice(0, limit * 2); // small over-cap so caller can choose
}

// Read the previous listings_found from postcode_rental_freshness so the
// regression-alert hook can compare. Returns null if no prior row or no
// supabase client (e.g. unit tests).
async function readPrevListingsFound(postcode, source) {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from('postcode_rental_freshness')
      .select('listings_found, status')
      .eq('postcode', postcode)
      .eq('source', source)
      .maybeSingle();
    if (!data) return null;
    // Only treat 'ok'/'no_match' baselines as comparable. A previous
    // 'circuit_open' / 'http_error' tells us nothing about typical capture.
    if (data.status !== 'ok' && data.status !== 'no_match') return null;
    return Number(data.listings_found) || 0;
  } catch {
    return null;
  }
}

// Fire a pipeline alert when a (postcode, source) tuple drops from a
// healthy baseline to ≤1 listings. Dedup is handled inside fireAlert.
// shouldAlert is exported for tests.
export function shouldFireRegression(prev, current) {
  if (prev == null) return false;                 // no baseline to compare
  if (prev < REGRESSION_PREV_MIN) return false;   // baseline too thin to trust
  if (current > REGRESSION_NEW_MAX) return false; // still healthy
  return true;
}

async function maybeFireRegressionAlert(postcode, source, prev, current, status) {
  if (!shouldFireRegression(prev, current)) return;
  try {
    await fireAlert({
      type: 'rental_extractor_regression',
      severity: 'warning',
      house: source,        // re-use the house slot for the source name — fits the alert schema
      message: `Rental capture regression: ${source} on ${postcode} dropped from ${prev} → ${current} listings (status=${status})`,
      meta: { postcode, source, prev_listings_found: prev, current_listings_found: current, status },
    });
  } catch (e) {
    log.warn('rental regression alert failed to fire', { postcode, source, err: e.message });
  }
}

async function recordFreshness(postcode, source, { status, listingsFound, lastError }) {
  if (!supabase) return;
  try {
    await supabase.from('postcode_rental_freshness').upsert({
      postcode,
      source,
      last_scraped_at: new Date().toISOString(),
      listings_found: listingsFound,
      status,
      last_error: lastError || null,
    }, { onConflict: 'postcode,source' });
  } catch (err) {
    log.warn('rental-freshness write failed', { postcode, source, err: err.message });
  }
}
