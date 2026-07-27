// lib/pipeline/coverage-digest.js — Daily enrichment-coverage summary.
//
// Reads field/enrichment coverage across the full lots inventory and emits
// a Telegram-friendly digest of how well each external data source is
// hydrating.
//
// Percentages = lots with the data ÷ total lots (entire table), not a
// recent sample. Pagination walks the full inventory so PostgREST's
// default 1000-row cap cannot deflate numerators.
//
// Persists a daily snapshot to coverage_snapshots so day-over-day deltas
// can be reported. Gracefully handles a missing coverage_snapshots table
// (insert/select errors are logged but don't break the digest).

const PAGE_SIZE = 1000;
// Soft safety cap so a runaway table cannot hang the 09:00 job forever.
// ~100k lots ≫ current fleet size; raise if inventory grows past this.
const MAX_LOTS_SCANNED = 100_000;

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
 * Build a coverage digest from the lots table (full inventory).
 * @param {object} supabase - Supabase client
 * @returns {Promise<{ totalLots, coverage, deltas, snapshotWritten, worstHouses, scope }>}
 */
export async function buildCoverageDigest(supabase) {
  // Page through the full lots table in 1000-row chunks. PostgREST silently
  // caps .select() at db-max-rows (default 1000) regardless of .limit(), so
  // a single unpaginated query would only count the first page while
  // count:'exact' reflects the true total — deflating every percentage.
  const rows = [];
  let totalCount = null;

  for (let from = 0; from < MAX_LOTS_SCANNED; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, MAX_LOTS_SCANNED) - 1;
    let pageData, pageError, pageCount;

    // Retry each page up to 3 times on transient Supabase failures (e.g. 522).
    for (let attempt = 1; attempt <= 3; attempt++) {
      ({ data: pageData, error: pageError, count: pageCount } = await supabase
        .from('lots')
        .select('house, enrichment_manifest, image_url, postcode, est_gross_yield', { count: 'exact' })
        .order('id', { ascending: true })
        .range(from, to));
      if (!pageError) break;
      if (attempt < 3) {
        console.warn(`coverage-digest: page ${from}-${to} failed (attempt ${attempt}/3): ${pageError.message} — retrying in 10s`);
        await new Promise(r => setTimeout(r, 10_000));
      }
    }

    if (pageError) {
      return {
        error: pageError.message,
        totalLots: 0,
        coverage: {},
        deltas: {},
        snapshotWritten: false,
        worstHouses: [],
        scope: 'all_lots',
      };
    }

    if (totalCount === null) totalCount = pageCount;
    const pageRows = pageData || [];
    rows.push(...pageRows);

    // Short page → end of data. Also stop once we've covered the true total.
    if (pageRows.length < PAGE_SIZE) break;
    if (totalCount != null && rows.length >= totalCount) break;
  }

  if (totalCount != null && rows.length < totalCount && rows.length >= MAX_LOTS_SCANNED) {
    console.warn(
      `coverage-digest: hit MAX_LOTS_SCANNED=${MAX_LOTS_SCANNED}; inventory has ${totalCount}. Percentages use scanned rows only.`
    );
  }

  // Prefer exact table count as denominator. If the scan was truncated by
  // MAX_LOTS_SCANNED, fall back to scanned length so we never inflate % by
  // counting coverage we did not observe.
  const scanned = rows.length;
  const tableTotal = totalCount ?? scanned;
  const denominator = scanned < tableTotal && scanned >= MAX_LOTS_SCANNED ? scanned : tableTotal;
  const coverage = computeCoverage(rows, denominator);

  const yesterday = await loadYesterdaySnapshot(supabase);
  const deltas = yesterday ? computeDeltas(coverage, yesterday) : {};

  const snapshotWritten = await writeTodaysSnapshot(supabase, {
    totalLots: denominator,
    coverage,
  });
  const worstHouses = computeWorstHouses(rows, 5);

  return {
    totalLots: denominator,
    coverage,
    deltas,
    snapshotWritten,
    worstHouses,
    scope: 'all_lots',
    scannedLots: scanned,
    tableTotal,
  };
}


/**
 * Rank houses by missing image+postcode coverage.
 * Only includes houses with >= minLots so tiny samples don't dominate.
 */
export function computeWorstHouses(rows, limit = 5, minLots = 8) {
  const by = new Map();
  for (const r of rows || []) {
    const h = (r.house || '').toLowerCase() || '_unknown';
    let g = by.get(h);
    if (!g) {
      g = { house: h, n: 0, noImage: 0, noPostcode: 0 };
      by.set(h, g);
    }
    g.n++;
    if (!r.image_url) g.noImage++;
    if (!r.postcode) g.noPostcode++;
  }
  return [...by.values()]
    .filter(g => g.n >= minLots)
    .map(g => ({
      house: g.house,
      lots: g.n,
      image_pct: Math.round(((g.n - g.noImage) / g.n) * 1000) / 10,
      postcode_pct: Math.round(((g.n - g.noPostcode) / g.n) * 1000) / 10,
      gap: (g.noImage + g.noPostcode) / (2 * g.n),
    }))
    .sort((a, b) => b.gap - a.gap || b.lots - a.lots)
    .slice(0, limit);
}

function computeCoverage(rows, total) {
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
  const denominator = (total ?? rows.length) || 1;
  // Empty inventory → report 0%, not 100% via denominator fallback of 1.
  if ((total ?? rows.length) === 0) {
    return {
      epc_pct: 0,
      flood_pct: 0,
      land_registry_pct: 0,
      geocode_pct: 0,
      fundability_pct: 0,
      image_pct: 0,
      postcode_pct: 0,
      yield_pct: 0,
    };
  }
  const pct = (n) => Math.round((n / denominator) * 1000) / 10; // 1 decimal place
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
    return `<b>Daily coverage digest</b>\nNo lots in inventory.`;
  }
  const c = digest.coverage;
  const d = digest.deltas || {};
  const fmt = (val, key) => {
    const dv = d[key];
    const sign = dv == null ? '' : dv > 0 ? ` (+${dv})` : dv < 0 ? ` (${dv})` : ' (=)';
    return `${val.toFixed(1)}%${sign}`;
  };
  const lines = [
    `<b>📊 Auction Brain — coverage digest</b>`,
    `Total lots: <b>${digest.totalLots}</b>`,
    `<i>% of all lots with each field</i>`,
    ``,
    `🖼  Image: ${fmt(c.image_pct, 'image_pct')}`,
    `📍 Postcode: ${fmt(c.postcode_pct, 'postcode_pct')}`,
    `🌐 Geocode: ${fmt(c.geocode_pct, 'geocode_pct')}`,
    `⚡ EPC: ${fmt(c.epc_pct, 'epc_pct')}`,
    `🌊 Flood: ${fmt(c.flood_pct, 'flood_pct')}`,
    `🏛 Land Registry: ${fmt(c.land_registry_pct, 'land_registry_pct')}`,
    `💰 Fundability: ${fmt(c.fundability_pct, 'fundability_pct')}`,
    `📈 Yield: ${fmt(c.yield_pct, 'yield_pct')}`,
  ];
  const worst = digest.worstHouses || [];
  if (worst.length) {
    lines.push('', '<b>Weakest houses (image / postcode)</b>');
    for (const w of worst) {
      lines.push(`• ${escapeHtml(w.house)} — ${w.lots} lots · img ${w.image_pct}% · pc ${w.postcode_pct}%`);
    }
  }
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Compute internal helpers exported for testing.
export {
  computeCoverage,
  computeDeltas,
  isPositive,
  POSITIVE_STATUSES,
  PAGE_SIZE,
  MAX_LOTS_SCANNED,
};
