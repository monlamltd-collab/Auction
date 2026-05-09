// lib/pipeline/coverage-digest.js — Daily enrichment-coverage summary.
//
// Reads enrichment_manifest distribution across lots seen in the last 7
// days and emits a Telegram-friendly digest of how well each external
// data source is hydrating.
//
// Persists a daily snapshot to coverage_snapshots so day-over-day deltas
// can be reported. Gracefully handles a missing coverage_snapshots table
// (insert/select errors are logged but don't break the digest).

const RECENT_DAYS = 7;
const RECENT_LOT_LIMIT = 5000;

// Statuses that count as "we got the data" (positive outcomes). Anything
// else (skipped, no_match, api_error, circuit_open, timeout) counts as
// not-covered for the purpose of the digest. The pipeline already alerts
// on individual failure modes — this digest is for at-a-glance coverage.
const POSITIVE_STATUSES = new Set(['ok', 'cache_hit', 'api_ok', 'ok_no_comps']);

function isPositive(entry) {
  if (!entry) return false;
  const s = entry.status || (typeof entry === 'string' ? entry : null);
  return POSITIVE_STATUSES.has(s);
}

/**
 * Build a coverage digest from the lots table.
 * @param {object} supabase - Supabase client
 * @returns {Promise<{ totalLots, since, coverage, deltas, snapshotWritten }>}
 */
export async function buildCoverageDigest(supabase) {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('lots')
    .select('enrichment_manifest, image_url, postcode, est_gross_yield')
    .gte('last_seen_at', since)
    .limit(RECENT_LOT_LIMIT);

  if (error) {
    return { error: error.message, since, totalLots: 0, coverage: {}, deltas: {}, snapshotWritten: false };
  }

  const rows = data || [];
  const total = rows.length;
  const coverage = computeCoverage(rows);

  const yesterday = await loadYesterdaySnapshot(supabase);
  const deltas = yesterday ? computeDeltas(coverage, yesterday) : {};

  const snapshotWritten = await writeTodaysSnapshot(supabase, { totalLots: total, coverage });

  return { totalLots: total, since, coverage, deltas, snapshotWritten };
}

function computeCoverage(rows) {
  const counts = {
    epc: 0, flood: 0, landRegistry: 0, geocode: 0,
    fundability: 0, image: 0, postcode: 0, yield: 0,
  };
  for (const r of rows) {
    if (r.image_url) counts.image++;
    if (r.postcode) counts.postcode++;
    if (r.est_gross_yield != null) counts.yield++;

    const m = r.enrichment_manifest;
    if (!m || typeof m !== 'object') continue;
    if (isPositive(m.epc)) counts.epc++;
    if (isPositive(m.flood)) counts.flood++;
    if (isPositive(m.land_registry || m.landRegistry)) counts.landRegistry++;
    if (isPositive(m.geocode)) counts.geocode++;
    if (isPositive(m.fundability)) counts.fundability++;
  }
  const total = rows.length || 1;
  const pct = (n) => Math.round((n / total) * 1000) / 10; // 1 decimal place
  return {
    epc_pct: pct(counts.epc),
    flood_pct: pct(counts.flood),
    land_registry_pct: pct(counts.landRegistry),
    geocode_pct: pct(counts.geocode),
    fundability_pct: pct(counts.fundability),
    image_pct: pct(counts.image),
    postcode_pct: pct(counts.postcode),
    yield_pct: pct(counts.yield),
  };
}

function computeDeltas(today, yesterday) {
  const out = {};
  for (const k of Object.keys(today)) {
    const yk = yesterday[k];
    if (typeof yk === 'number') {
      out[k] = Math.round((today[k] - yk) * 10) / 10;
    }
  }
  return out;
}

async function loadYesterdaySnapshot(supabase) {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const { data, error } = await supabase
      .from('coverage_snapshots')
      .select('*')
      .eq('date', yesterday)
      .maybeSingle();
    if (error) {
      // Most likely cause: coverage_snapshots migration not yet applied.
      // Don't crash the digest — just skip the delta.
      console.warn('coverage-digest: yesterday snapshot read failed:', error.message);
      return null;
    }
    return data || null;
  } catch (e) {
    console.warn('coverage-digest: yesterday snapshot threw:', e?.message || e);
    return null;
  }
}

async function writeTodaysSnapshot(supabase, { totalLots, coverage }) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { error } = await supabase
      .from('coverage_snapshots')
      .upsert({
        date: today,
        total_lots: totalLots,
        epc_pct: coverage.epc_pct,
        flood_pct: coverage.flood_pct,
        land_registry_pct: coverage.land_registry_pct,
        geocode_pct: coverage.geocode_pct,
        fundability_pct: coverage.fundability_pct,
        image_pct: coverage.image_pct,
        postcode_pct: coverage.postcode_pct,
        yield_pct: coverage.yield_pct,
      }, { onConflict: 'date' });
    if (error) {
      console.warn('coverage-digest: snapshot write failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('coverage-digest: snapshot write threw:', e?.message || e);
    return false;
  }
}

/**
 * Format a digest object for Telegram (HTML-safe). Pure function.
 */
export function formatDigestForTelegram(digest) {
  if (digest.error) {
    return `<b>Daily coverage digest — ERROR</b>\n${escapeHtml(digest.error)}`;
  }
  if (digest.totalLots === 0) {
    return `<b>Daily coverage digest</b>\nNo lots seen in last ${RECENT_DAYS}d.`;
  }
  const c = digest.coverage;
  const d = digest.deltas || {};
  const fmt = (val, key) => {
    const dv = d[key];
    const sign = dv == null ? '' : dv > 0 ? ` (+${dv})` : dv < 0 ? ` (${dv})` : ' (=)';
    return `${val.toFixed(1)}%${sign}`;
  };
  return [
    `<b>📊 Auction Brain — coverage digest</b>`,
    `Lots in last ${RECENT_DAYS}d: <b>${digest.totalLots}</b>`,
    ``,
    `🖼  Image: ${fmt(c.image_pct, 'image_pct')}`,
    `📍 Postcode: ${fmt(c.postcode_pct, 'postcode_pct')}`,
    `🌐 Geocode: ${fmt(c.geocode_pct, 'geocode_pct')}`,
    `⚡ EPC: ${fmt(c.epc_pct, 'epc_pct')}`,
    `🌊 Flood: ${fmt(c.flood_pct, 'flood_pct')}`,
    `🏛 Land Registry: ${fmt(c.land_registry_pct, 'land_registry_pct')}`,
    `💰 Fundability: ${fmt(c.fundability_pct, 'fundability_pct')}`,
    `📈 Yield: ${fmt(c.yield_pct, 'yield_pct')}`,
  ].join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Compute internal helpers exported for testing.
export { computeCoverage, computeDeltas, isPositive, POSITIVE_STATUSES };
