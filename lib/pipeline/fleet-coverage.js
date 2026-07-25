// lib/pipeline/fleet-coverage.js
// Fleet house population coverage scoreboard (Improvement 5 / Task 2).
//
// Pure scoring over active non-retired house snapshots. Optional Supabase
// loader for scheduled digests. No migrations; no writers beyond alerts
// invoked by the caller.
//
// Population ≠ enrichment. This module answers:
//   "Will future lots for each active house keep appearing automatically?"
// using discovery class + calendar spine + lot freshness.

import {
  classifyHouseForDiscovery,
  isRealUpcomingDate,
} from './house-class.js';

export const DEFAULT_HORIZON_DAYS = 56; // 8 weeks
export const DEFAULT_FRESH_DAYS = 7;

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;');
}

/**
 * Derive calendar spine signals for one house.
 */
export function analyseHouseSpine(h, opts) {
  const today = opts.todayIso;
  const horizonEnd = opts.horizonEnd;
  const rows = Array.isArray(h.calendarRows) ? h.calendarRows : [];

  let hasAlwaysOn = false;
  let upcomingReal = 0;
  let upcomingReady = 0;
  let upcomingInHorizon = 0;
  let upcomingReadyInHorizon = 0;
  let nearestUpcoming = null;

  for (const r of rows) {
    const status = r?.status || '';
    const date = r?.date ? String(r.date).slice(0, 10) : null;
    const ready = r?.catalogue_ready === true;
    if (status === 'always_on') hasAlwaysOn = true;
    if (status === 'upcoming' && isRealUpcomingDate(date, today)) {
      upcomingReal += 1;
      if (ready) upcomingReady += 1;
      if (date <= horizonEnd) {
        upcomingInHorizon += 1;
        if (ready) upcomingReadyInHorizon += 1;
      }
      if (!nearestUpcoming || date < nearestUpcoming) nearestUpcoming = date;
    }
  }

  const availableN = Number(h.available_n || 0);
  const seen7 = Number(h.avail_seen_7d || 0);
  let fresh = seen7 > 0;
  if (h.avail_seen_7d != null) fresh = seen7 > 0;
  else if (opts.nowMs != null && h.last_seen_at) {
    const ls = Date.parse(h.last_seen_at);
    const freshMs = (opts.freshDays || DEFAULT_FRESH_DAYS) * 86400000;
    fresh = Number.isFinite(ls) && (opts.nowMs - ls <= freshMs);
  } else {
    fresh = false;
  }

  return {
    hasAlwaysOn,
    upcomingReal,
    upcomingReady,
    upcomingInHorizon,
    upcomingReadyInHorizon,
    nearestUpcoming,
    availableN,
    seen7,
    fresh,
    nullDates: Number(h.avail_null_date || 0),
  };
}

/**
 * Population health for one active house after classification + spine.
 */
export function scoreHousePopulation({ discoveryClass, spine, explainedMissReason = null }) {
  if (discoveryClass === 'mmoa') {
    if (spine.fresh) {
      return { credit: 1, dark: false, reason: null, detail: 'mmoa_fresh' };
    }
    if (spine.availableN > 0) {
      return { credit: 0, dark: true, reason: 'stale_scrape', detail: 'mmoa_stale_available' };
    }
    if (explainedMissReason) {
      return { credit: 1, dark: false, reason: null, detail: `mmoa_empty_explained:${explainedMissReason}` };
    }
    return { credit: 0, dark: true, reason: 'empty_mmoa', detail: 'mmoa_no_available' };
  }

  if (
    discoveryClass === 'traditional_rotating' ||
    discoveryClass === 'traditional_static' ||
    discoveryClass === 'unknown'
  ) {
    if (spine.upcomingReadyInHorizon > 0) {
      return { credit: 1, dark: false, reason: null, detail: 'trad_ready_horizon' };
    }
    if (spine.upcomingInHorizon > 0 && spine.upcomingReadyInHorizon === 0) {
      return { credit: 0, dark: true, reason: 'upcoming_not_ready', detail: 'trad_upcoming_not_ready' };
    }
    if (spine.upcomingReal > 0 && spine.upcomingInHorizon === 0) {
      if (spine.upcomingReady > 0) {
        return { credit: 1, dark: false, reason: null, detail: 'trad_ready_beyond_horizon' };
      }
      return { credit: 0, dark: true, reason: 'upcoming_not_ready', detail: 'trad_beyond_horizon_not_ready' };
    }
    if (explainedMissReason) {
      return { credit: 1, dark: false, reason: null, detail: `trad_explained:${explainedMissReason}` };
    }
    if (spine.hasAlwaysOn && spine.fresh) {
      return {
        credit: 1,
        dark: true,
        reason: 'discover_miss',
        detail: 'trad_class_but_mmoa_fresh_no_upcoming',
      };
    }
    if (spine.hasAlwaysOn && spine.availableN > 0) {
      return { credit: 0, dark: true, reason: 'stale_scrape', detail: 'trad_class_stale_available' };
    }
    return { credit: 0, dark: true, reason: 'no_upcoming_row', detail: 'trad_dark' };
  }

  return { credit: 0, dark: true, reason: 'unclassified', detail: `class:${discoveryClass}` };
}

/**
 * Build fleet coverage summary from house inputs.
 */
export function computeFleetCoverage(houses, options = {}) {
  const todayIso = options.todayIso || new Date().toISOString().slice(0, 10);
  const horizonDays = options.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const freshDays = options.freshDays ?? DEFAULT_FRESH_DAYS;
  const horizonEnd = addDays(todayIso, horizonDays);
  const darkLimit = options.darkLimit ?? 10;

  const active = (houses || []).filter((h) => h && h.slug && !h.retired);

  const counts = {
    active_total: active.length,
    mmoa_total: 0,
    mmoa_fresh: 0,
    mmoa_stale: 0,
    mmoa_empty: 0,
    trad_total: 0,
    trad_with_upcoming_horizon: 0,
    trad_with_ready_horizon: 0,
    trad_dark: 0,
    trad_explained_miss: 0,
    unknown_total: 0,
    credit_sum: 0,
  };

  const byClass = {};
  const darkHouses = [];
  const houseRows = [];

  for (const h of active) {
    const classified = classifyHouseForDiscovery({
      slug: h.slug,
      rootUrl: h.rootUrl,
      calendarRows: h.calendarRows,
      discoveryConfig: h.discoveryConfig,
      platformHints: h.platformHints,
      homepageWatch: h.homepageWatch,
      retired: false,
      todayIso,
    });
    const spine = analyseHouseSpine(h, {
      todayIso,
      horizonEnd,
      freshDays,
      nowMs: options.nowMs,
    });
    const pop = scoreHousePopulation({
      discoveryClass: classified.class,
      spine,
      explainedMissReason: h.explained_miss_reason || null,
    });

    byClass[classified.class] = (byClass[classified.class] || 0) + 1;
    counts.credit_sum += pop.credit;

    if (classified.class === 'mmoa') {
      counts.mmoa_total += 1;
      if (pop.detail === 'mmoa_fresh') counts.mmoa_fresh += 1;
      else if (pop.reason === 'stale_scrape') counts.mmoa_stale += 1;
      else counts.mmoa_empty += 1;
    } else if (
      classified.class === 'traditional_rotating' ||
      classified.class === 'traditional_static'
    ) {
      counts.trad_total += 1;
      if (spine.upcomingInHorizon > 0) counts.trad_with_upcoming_horizon += 1;
      if (spine.upcomingReadyInHorizon > 0) counts.trad_with_ready_horizon += 1;
      if (pop.detail?.startsWith('trad_explained')) counts.trad_explained_miss += 1;
      else if (
        pop.dark &&
        (pop.reason === 'no_upcoming_row' ||
          pop.reason === 'upcoming_not_ready' ||
          pop.reason === 'discover_miss')
      ) {
        counts.trad_dark += 1;
      }
    } else if (classified.class === 'unknown') {
      counts.unknown_total += 1;
    }

    const row = {
      slug: h.slug,
      class: classified.class,
      needsNextSaleWatch: classified.needsNextSaleWatch,
      reasons: classified.reasons,
      spine,
      credit: pop.credit,
      dark: pop.dark,
      dark_reason: pop.reason,
      detail: pop.detail,
      available_n: spine.availableN,
      avail_seen_7d: spine.seen7,
    };
    houseRows.push(row);

    if (pop.dark) {
      darkHouses.push({
        slug: h.slug,
        class: classified.class,
        reason: pop.reason || 'unclassified',
        detail: pop.detail,
        available_n: spine.availableN,
        avail_seen_7d: spine.seen7,
        nearest_upcoming: spine.nearestUpcoming,
        needsNextSaleWatch: classified.needsNextSaleWatch,
      });
    }
  }

  const reasonRank = {
    no_upcoming_row: 0,
    upcoming_not_ready: 1,
    discover_miss: 2,
    stale_scrape: 3,
    empty_mmoa: 4,
    unclassified: 5,
  };
  darkHouses.sort((a, b) => {
    const ra = reasonRank[a.reason] ?? 9;
    const rb = reasonRank[b.reason] ?? 9;
    if (ra !== rb) return ra - rb;
    if (b.available_n !== a.available_n) return b.available_n - a.available_n;
    return a.slug.localeCompare(b.slug);
  });

  const denom = counts.active_total || 1;
  const fleet_populate_score = clampPct((counts.credit_sum / denom) * 100);

  return {
    today: todayIso,
    horizon_days: horizonDays,
    horizon_end: horizonEnd,
    fresh_days: freshDays,
    active_total: counts.active_total,
    counts,
    byClass,
    scores: {
      fleet_populate_score,
      mmoa_fresh_pct: clampPct((counts.mmoa_fresh / denom) * 100),
      trad_ready_horizon_pct: clampPct((counts.trad_with_ready_horizon / denom) * 100),
      trad_dark_pct: clampPct((counts.trad_dark / denom) * 100),
      dark_house_pct: clampPct((darkHouses.length / denom) * 100),
    },
    dark_houses: darkHouses.slice(0, darkLimit),
    dark_houses_total: darkHouses.length,
    houses: houseRows,
  };
}

/**
 * Telegram HTML scoreboard. Escapes untrusted slugs.
 */
export function formatFleetCoverageForTelegram(digest) {
  const NL = '\n';
  if (digest?.error) {
    return `<b>Fleet coverage — ERROR</b>${NL}${escapeHtml(digest.error)}`;
  }
  if (!digest || !digest.active_total) {
    return `<b>Fleet coverage</b>${NL}No active houses in digest.`;
  }
  const c = digest.counts;
  const s = digest.scores;
  const lines = [
    `<b>AuctionBrain — fleet population</b>`,
    `Active houses: <b>${digest.active_total}</b>`,
    `Score: <b>${s.fleet_populate_score}%</b> · horizon ${digest.horizon_days}d`,
    ``,
    `MMOA: ${c.mmoa_total} total · fresh ${c.mmoa_fresh} · stale ${c.mmoa_stale} · empty ${c.mmoa_empty}`,
    `Trad: ${c.trad_total} total · ready<=horizon ${c.trad_with_ready_horizon} · dark ${c.trad_dark} · explained ${c.trad_explained_miss}`,
    `Unknown: ${c.unknown_total}`,
  ];
  const dark = digest.dark_houses || [];
  if (digest.dark_houses_total) {
    lines.push('', `<b>Dark / at-risk (${digest.dark_houses_total})</b>`);
    for (const d of dark) {
      lines.push(
        `• ${escapeHtml(d.slug)} — ${escapeHtml(d.reason)}` +
          (d.available_n ? ` · avail ${d.available_n}` : '') +
          (d.nearest_upcoming ? ` · near ${escapeHtml(d.nearest_upcoming)}` : ''),
      );
    }
    if (digest.dark_houses_total > dark.length) {
      lines.push(`… +${digest.dark_houses_total - dark.length} more`);
    }
  } else {
    lines.push('', 'Dark / at-risk: <b>none</b>');
  }
  return lines.join(NL);
}

export function isFleetCoverageAlertsEnabled(env = process.env) {
  return String(env.FLEET_COVERAGE_ALERTS_ENABLED || '').toLowerCase() === 'true';
}

/**
 * Score from prebuilt maps (pure orchestration).
 */
export async function buildFleetCoverageFromMaps(ctx = {}) {
  const houseRoots = ctx.houseRoots || {};
  const retired = new Set(ctx.retiredHouses || []);
  const discoveryConfigs = ctx.discoveryConfigs || {};
  const ah = new Set(ctx.ahSlugs || []);
  const calBy = ctx.calendarBySlug || {};
  const lotBy = ctx.lotsBySlug || {};
  const homepageBy = ctx.homepageBySlug || {};

  const houses = [];
  for (const [slug, rootUrl] of Object.entries(houseRoots)) {
    if (retired.has(slug)) continue;
    const lot = lotBy[slug] || {};
    houses.push({
      slug,
      rootUrl,
      retired: false,
      discoveryConfig: discoveryConfigs[slug] || null,
      platformHints: { ah: ah.has(slug) },
      calendarRows: calBy[slug] || [],
      homepageWatch: homepageBy[slug] || null,
      available_n: lot.available_n || 0,
      avail_seen_7d: lot.avail_seen_7d || 0,
      avail_null_date: lot.avail_null_date || 0,
      last_seen_at: lot.last_seen_at || null,
      explained_miss_reason: lot.explained_miss_reason || null,
    });
  }
  return computeFleetCoverage(houses, ctx.options || {});
}

/**
 * Load calendar + available-lot aggregates from Supabase and score the fleet.
 * Read-only.
 */
export async function buildFleetCoverageDigest(supabase, opts = {}) {
  if (!supabase) return { error: 'no supabase client', active_total: 0 };

  let HOUSE_ROOTS;
  let RETIRED_HOUSES;
  let AUCTION_DISCOVERY;
  let AH_PLATFORM_SLUGS;
  try {
    ({ HOUSE_ROOTS, RETIRED_HOUSES, AUCTION_DISCOVERY } = await import('../houses.js'));
    ({ AH_PLATFORM_SLUGS } = await import('./ah-resolver.js'));
  } catch (e) {
    return { error: `import failed: ${e.message}`, active_total: 0 };
  }

  const houseRoots = opts.houseRoots || HOUSE_ROOTS;
  const retired = opts.retiredHouses || RETIRED_HOUSES;
  const discoveryConfigs = opts.discoveryConfigs || AUCTION_DISCOVERY || {};
  const ahSlugs = opts.ahSlugs || AH_PLATFORM_SLUGS || [];

  async function page(table, columns, { orderBy = 'house_slug', eqStatus = null, maxRows = 100000 } = {}) {
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; from < maxRows; from += pageSize) {
      const to = from + pageSize - 1;
      let q = supabase.from(table).select(columns).range(from, to);
      if (orderBy) q = q.order(orderBy, { ascending: true });
      if (eqStatus) q = q.eq('status', eqStatus);
      let data;
      let error;
      for (let attempt = 1; attempt <= 3; attempt++) {
        ({ data, error } = await q);
        if (!error) break;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
      }
      if (error) throw new Error(`${table}: ${error.message}`);
      const pageRows = data || [];
      rows.push(...pageRows);
      if (pageRows.length < pageSize) break;
    }
    return rows;
  }

  try {
    const calRows = await page(
      'auction_calendar',
      'house_slug, status, date, catalogue_ready, url',
      { orderBy: 'house_slug' },
    );
    const lotRows = await page(
      'lots',
      'house, status, auction_date, last_seen_at',
      { orderBy: 'house', eqStatus: 'available' },
    );

    const calendarBySlug = {};
    for (const r of calRows) {
      if (!r.house_slug) continue;
      if (!calendarBySlug[r.house_slug]) calendarBySlug[r.house_slug] = [];
      calendarBySlug[r.house_slug].push(r);
    }

    const sevenAgo = Date.now() - 7 * 86400000;
    const lotsBySlug = {};
    for (const r of lotRows) {
      const house = (r.house || '').toLowerCase();
      if (!house) continue;
      if (!lotsBySlug[house]) {
        lotsBySlug[house] = {
          available_n: 0,
          avail_seen_7d: 0,
          avail_null_date: 0,
          last_seen_at: null,
        };
      }
      const g = lotsBySlug[house];
      g.available_n += 1;
      if (!r.auction_date) g.avail_null_date += 1;
      const ls = r.last_seen_at ? Date.parse(r.last_seen_at) : 0;
      if (ls && ls >= sevenAgo) g.avail_seen_7d += 1;
      if (r.last_seen_at && (!g.last_seen_at || r.last_seen_at > g.last_seen_at)) {
        g.last_seen_at = r.last_seen_at;
      }
    }

    const homepageBySlug = {};
    try {
      const hw = await page(
        'house_homepage_watch',
        'slug, last_next_auction_date, last_extracted_catalogue_url',
        { orderBy: 'slug', maxRows: 5000 },
      );
      for (const r of hw) {
        if (!r.slug) continue;
        homepageBySlug[r.slug] = {
          last_next_auction_date: r.last_next_auction_date || null,
          last_extracted_catalogue_url: r.last_extracted_catalogue_url || null,
        };
      }
    } catch {
      /* table optional */
    }

    return await buildFleetCoverageFromMaps({
      houseRoots,
      retiredHouses: retired,
      discoveryConfigs,
      ahSlugs,
      calendarBySlug,
      lotsBySlug,
      homepageBySlug,
      options: opts.computeOptions || {},
    });
  } catch (e) {
    return { error: e.message || String(e), active_total: 0 };
  }
}
