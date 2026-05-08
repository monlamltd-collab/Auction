// ═══════════════════════════════════════════════════════════════
// LAND REGISTRY — UK HOUSE PRICE INDEX (HPI) QUERIES
// ═══════════════════════════════════════════════════════════════
// Reads from the bulk-loaded `hmlr_hpi` Supabase table (refreshed monthly
// by scripts/refresh-hmlr-hpi.mjs). Provides area-level price-trend
// signals (12-month % change, sales volume, average price by property
// type) for an auction lot, keyed by Local Authority District.
//
// Postcode → LAD lookup uses the existing postcodes-io client.
// HPI publishes ~1,200 areas; querying is essentially free once loaded.

let supabase = null;

export function initHpi({ supabase: sb } = {}) {
  if (sb) supabase = sb;
}

// Tiny in-process cache. HPI changes monthly — once-per-month TTL is plenty.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map(); // key → { at, value }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
}

/**
 * Look up the most recent HPI row for an area, plus the row from 12 months
 * earlier (for an explicit YoY anchor when the publisher's `change_12m`
 * column is missing or stale).
 *
 * @param {object} opts
 * @param {string} [opts.areaCode] — ONS code, e.g. "E09000007" (preferred)
 * @param {string} [opts.areaName] — Fallback by name match, e.g. "Camden"
 * @returns {Promise<{ status: string, latest?: object, yoy?: number, sample?: object }>}
 *   status: 'ok' | 'no_match' | 'no_input' | 'db_error'
 */
export async function queryHPI({ areaCode = null, areaName = null } = {}) {
  if (!supabase) return { status: 'db_error', error: 'supabase not initialised' };
  if (!areaCode && !areaName) return { status: 'no_input' };

  const cacheKey = areaCode ? `code:${areaCode}` : `name:${areaName.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Pull last 13 months so we can derive YoY ourselves if needed.
  let q = supabase
    .from('hmlr_hpi')
    .select('month, area_code, area_name, area_type, average_price, index_value, change_1m, change_12m, sales_volume, detached_price, semi_price, terraced_price, flat_price')
    .order('month', { ascending: false })
    .limit(13);

  if (areaCode) {
    q = q.eq('area_code', areaCode);
  } else {
    q = q.ilike('area_name', areaName);
  }

  const { data, error } = await q;
  if (error) {
    return { status: 'db_error', error: error.message };
  }
  if (!data || data.length === 0) {
    const result = { status: 'no_match' };
    cacheSet(cacheKey, result);
    return result;
  }

  const latest = data[0];
  const yearAgo = data.find(r => {
    const months = monthDiff(new Date(r.month), new Date(latest.month));
    return months === 12;
  });

  let yoy = latest.change_12m != null ? Number(latest.change_12m) : null;
  if (yoy == null && yearAgo && latest.average_price && yearAgo.average_price) {
    yoy = ((latest.average_price - yearAgo.average_price) / yearAgo.average_price) * 100;
  }

  const result = {
    status: 'ok',
    latest,
    yoy: yoy != null ? Number(yoy.toFixed(2)) : null,
    sample: data.length,
  };
  cacheSet(cacheKey, result);
  return result;
}

function monthDiff(earlier, later) {
  return (later.getFullYear() - earlier.getFullYear()) * 12 + (later.getMonth() - earlier.getMonth());
}

// Test-only hook
export function _clearHpiCacheForTest() {
  cache.clear();
}
