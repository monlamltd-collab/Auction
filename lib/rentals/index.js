// lib/rentals/index.js — Rental-comp scraper orchestrator (rollout #7).
//
// Sources: SpareRoom, OnTheMarket. OpenRent deferred (their search
// endpoints reject plain GET; needs Firecrawl with JS rendering).
//
// Cadence: monthly. A (postcode, source) tuple is eligible for re-scrape
// when last_scraped_at < now() - 30 days, or never scraped.
//
// Volume: ~500 active-auction postcodes × 2 sources × 1 page each = ~1k
// fetches/month, well under any sensible rate limit. All plain HTTP, zero
// Firecrawl credits.
//
// Dependencies injected via initRentals() to keep the module testable.

import { scrapeSpareRoom } from './spareroom.js';
import { scrapeOnTheMarket } from './onthemarket.js';
import { log } from '../logging.js';

const SOURCES = {
  spareroom: scrapeSpareRoom,
  onthemarket: scrapeOnTheMarket,
};

const FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let supabase = null;

export function initRentals({ supabase: sb } = {}) {
  supabase = sb;
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

  const listings = result.listings;
  if (listings.length === 0) {
    await recordFreshness(postcode, source, { status: 'no_match', listingsFound: 0 });
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
    } catch (err) {
      log.warn('rental-upsert failed', { source, postcode, err: err.message });
      await recordFreshness(postcode, source, {
        status: 'parse_error',
        listingsFound: 0,
        lastError: err.message,
      });
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
  for (const { postcode, source } of candidates.slice(0, limit)) {
    const r = await scrapeRentalsForPostcode(postcode, source);
    if (r.status === 'ok' || r.status === 'no_match') ok++;
    else errors++;
    // Polite gap between calls — different sources are independent
    // hosts so 250ms is generous.
    await new Promise(r => setTimeout(r, 250));
  }
  log.info('drain-stale-rentals done', { attempted: candidates.length, ok, errors });
  return { attempted: candidates.length, ok, errors };
}

// ── Internal helpers ─────────────────────────────────────────────────

async function selectStaleCandidates({ limit, force }) {
  // Strategy:
  //   1. Postcodes appearing on at least one upcoming-auction lot
  //      (auction_date >= today). These are the high-value targets.
  //   2. For each such postcode, expand to (postcode, source) tuples.
  //   3. Filter out tuples scraped within the freshness window unless
  //      force=true.
  const today = new Date().toISOString().slice(0, 10);
  const { data: lotPostcodes } = await supabase
    .from('lots')
    .select('postcode')
    .not('postcode', 'is', null)
    .gte('auction_date', today)
    .limit(2000);
  const uniquePostcodes = [...new Set((lotPostcodes || []).map(r => r.postcode))];
  if (uniquePostcodes.length === 0) return [];

  // Pull existing freshness rows for these postcodes
  const { data: freshRows } = await supabase
    .from('postcode_rental_freshness')
    .select('postcode, source, last_scraped_at')
    .in('postcode', uniquePostcodes);
  const freshMap = new Map(); // key: `${postcode}|${source}` → ms
  for (const r of freshRows || []) {
    freshMap.set(`${r.postcode}|${r.source}`, Date.parse(r.last_scraped_at));
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
