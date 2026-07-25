#!/usr/bin/env node
/**
 * Fleet Coverage Baseline (read-only)
 * ==================================
 * Task 0 of fleet-coverage-robustness plan.
 *
 * Inventories active houses from code (HOUSE_ROOTS − RETIRED_HOUSES) and,
 * when Supabase credentials are present, joins auction_calendar + lots to
 * produce freeze-baseline cohorts for next-sale discovery work.
 *
 * Modes:
 *   node scripts/fleet-coverage-baseline.mjs              # code + DB if env set
 *   node scripts/fleet-coverage-baseline.mjs --code-only  # no DB
 *   node scripts/fleet-coverage-baseline.mjs --json       # machine-readable
 *   node scripts/fleet-coverage-baseline.mjs --horizon-days 56
 *
 * Requires for DB mode: SUPABASE_URL + SUPABASE_SERVICE_KEY
 * Never writes to the database.
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HOUSE_ROOTS,
  RETIRED_HOUSES,
  AUCTION_DISCOVERY,
} from '../lib/houses.js';
import { AH_PLATFORM_SLUGS } from '../lib/pipeline/ah-resolver.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const codeOnly = args.includes('--code-only');
const save = args.includes('--save');
const horizonIdx = args.indexOf('--horizon-days');
const HORIZON_DAYS = horizonIdx >= 0 ? Number(args[horizonIdx + 1]) || 56 : 56;

const ROLLING_URL_RE =
  /current|available|search|listings|properties-for-auction|for-sale|catalogue|online|auction-listings|lot-list/i;

function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildCodeInventory() {
  const allRoots = Object.keys(HOUSE_ROOTS).sort();
  const active = allRoots.filter((s) => !RETIRED_HOUSES.has(s));
  const retiredInRoots = allRoots.filter((s) => RETIRED_HOUSES.has(s));
  const catB = Object.keys(AUCTION_DISCOVERY).sort();
  const ahAll = [...AH_PLATFORM_SLUGS].sort();
  const ahActive = ahAll.filter((s) => active.includes(s));
  const rollingUrlHints = active.filter((s) => ROLLING_URL_RE.test(HOUSE_ROOTS[s] || ''));
  const coveredByWatcherFamily = new Set([...catB, ...ahActive]);
  const activeUnwatched = active.filter((s) => !coveredByWatcherFamily.has(s));

  return {
    generated_at: new Date().toISOString(),
    house_roots_total: allRoots.length,
    retired_set_size: RETIRED_HOUSES.size,
    retired_in_roots_n: retiredInRoots.length,
    retired_in_roots: retiredInRoots,
    active_n: active.length,
    active_slugs: active,
    auction_discovery_n: catB.length,
    auction_discovery: catB,
    ah_platform_total: ahAll.length,
    ah_platform_active_n: ahActive.length,
    ah_platform_active: ahActive,
    rolling_url_hint_n: rollingUrlHints.length,
    rolling_url_hints: rollingUrlHints,
    active_covered_by_catb_or_ah_n: active.filter((s) => coveredByWatcherFamily.has(s)).length,
    active_not_covered_by_catb_or_ah_n: activeUnwatched.length,
    active_not_covered_by_catb_or_ah: activeUnwatched,
  };
}

function classifyCalendarHouse(row, {
  today,
  horizonEnd,
  retiredSet,
  activeSet,
}) {
  const slug = row.house_slug;
  const retired = retiredSet.has(slug);
  const inActiveRoots = activeSet.has(slug);
  const alwaysOn = Number(row.always_on_n || 0) > 0;
  const upcomingReal = Number(row.upcoming_real_n || 0) > 0;
  const upcomingReady = Number(row.upcoming_ready_n || 0) > 0;
  const upcoming8w = Number(row.upcoming_8w_n || 0) > 0;
  const available = Number(row.available_n || 0);
  const seen7 = Number(row.avail_seen_7d || 0);

  let cohort;
  if (upcomingReady) cohort = 'trad_ready_upcoming';
  else if (upcomingReal) cohort = 'trad_upcoming_not_ready';
  else if (alwaysOn && seen7 > 0) cohort = 'mmoa_fresh';
  else if (alwaysOn && available > 0) cohort = 'mmoa_stale_available';
  else if (alwaysOn) cohort = 'mmoa_no_available';
  else if (!upcomingReal) cohort = 'calendar_dark';
  else cohort = 'other';

  return {
    house_slug: slug,
    retired,
    in_active_roots: inActiveRoots,
    cohort,
    always_on_n: Number(row.always_on_n || 0),
    upcoming_real_n: Number(row.upcoming_real_n || 0),
    upcoming_ready_n: Number(row.upcoming_ready_n || 0),
    upcoming_8w_n: Number(row.upcoming_8w_n || 0),
    nearest_upcoming: row.nearest_upcoming || null,
    has_ready_always_on: !!row.has_ready_always_on,
    available_n: available,
    avail_null_date: Number(row.avail_null_date || 0),
    avail_seen_7d: seen7,
    avail_seen_30d: Number(row.avail_seen_30d || 0),
    last_seen: row.last_seen || null,
    horizon_days: HORIZON_DAYS,
    horizon_end: horizonEnd,
    today,
  };
}

async function pageSelect(supabase, table, columns, {
  orderBy = null,
  filters = [],
  pageSize = 1000,
  maxRows = 200000,
} = {}) {
  const rows = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = from + pageSize - 1;
    let q = supabase.from(table).select(columns).range(from, to);
    if (orderBy) q = q.order(orderBy, { ascending: true });
    for (const f of filters) q = f(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} page ${from}-${to}: ${error.message}`);
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function buildDbBaseline(code) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return {
      db: false,
      reason: 'Missing SUPABASE_URL / SUPABASE_SERVICE_KEY',
    };
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const today = isoDate();
  const horizonEnd = addDays(today, HORIZON_DAYS);
  const activeSet = new Set(code.active_slugs);
  const retiredSet = new Set([
    ...RETIRED_HOUSES,
    ...code.retired_in_roots,
  ]);

  // Lightweight per-table pulls, then aggregate in process. Avoids needing SQL RPC.
  const calRows = await pageSelect(
    supabase,
    'auction_calendar',
    'id, house_slug, status, date, catalogue_ready, url',
    { orderBy: 'house_slug' },
  );

  // lots can be large — only fields needed for freshness/date gaps; cap sanity.
  const lotRows = await pageSelect(
    supabase,
    'lots',
    'house, status, auction_date, last_seen_at',
    {
      orderBy: 'house',
      filters: [(q) => q.eq('status', 'available')],
      pageSize: 1000,
      maxRows: 100000,
    },
  );

  const calBy = new Map();
  for (const r of calRows) {
    if (!r.house_slug) continue;
    if (!calBy.has(r.house_slug)) {
      calBy.set(r.house_slug, {
        house_slug: r.house_slug,
        always_on_n: 0,
        upcoming_real_n: 0,
        upcoming_ready_n: 0,
        upcoming_8w_n: 0,
        nearest_upcoming: null,
        has_ready_always_on: false,
        upcoming_detail: [],
      });
    }
    const g = calBy.get(r.house_slug);
    const status = r.status || '';
    const date = r.date ? String(r.date).slice(0, 10) : null;
    const ready = r.catalogue_ready === true;
    if (status === 'always_on') {
      g.always_on_n += 1;
      if (ready) g.has_ready_always_on = true;
    }
    const realUpcoming =
      status === 'upcoming' && date && date >= today && date < '2090-01-01';
    if (realUpcoming) {
      g.upcoming_real_n += 1;
      if (ready) g.upcoming_ready_n += 1;
      if (date <= horizonEnd) g.upcoming_8w_n += 1;
      if (!g.nearest_upcoming || date < g.nearest_upcoming) g.nearest_upcoming = date;
      g.upcoming_detail.push({
        date,
        catalogue_ready: ready,
        url: r.url || null,
      });
    }
  }

  const lotBy = new Map();
  const sevenAgo = Date.now() - 7 * 86400000;
  const thirtyAgo = Date.now() - 30 * 86400000;
  for (const r of lotRows) {
    const house = (r.house || '').toLowerCase();
    if (!house) continue;
    if (!lotBy.has(house)) {
      lotBy.set(house, {
        available_n: 0,
        avail_null_date: 0,
        avail_real_upcoming: 0,
        avail_sentinel: 0,
        avail_seen_7d: 0,
        avail_seen_30d: 0,
        last_seen: null,
      });
    }
    const g = lotBy.get(house);
    g.available_n += 1;
    const ad = r.auction_date ? String(r.auction_date).slice(0, 10) : null;
    if (!ad) g.avail_null_date += 1;
    else if (ad.startsWith('2099')) g.avail_sentinel += 1;
    else if (ad >= today && ad < '2090-01-01') g.avail_real_upcoming += 1;
    const ls = r.last_seen_at ? Date.parse(r.last_seen_at) : 0;
    if (ls && ls >= sevenAgo) g.avail_seen_7d += 1;
    if (ls && ls >= thirtyAgo) g.avail_seen_30d += 1;
    if (r.last_seen_at && (!g.last_seen || r.last_seen_at > g.last_seen)) {
      g.last_seen = r.last_seen_at;
    }
  }

  const allSlugs = new Set([...calBy.keys(), ...lotBy.keys(), ...code.active_slugs]);
  const classified = [];
  for (const slug of [...allSlugs].sort()) {
    const c = calBy.get(slug) || {
      house_slug: slug,
      always_on_n: 0,
      upcoming_real_n: 0,
      upcoming_ready_n: 0,
      upcoming_8w_n: 0,
      nearest_upcoming: null,
      has_ready_always_on: false,
    };
    const l = lotBy.get(slug) || {
      available_n: 0,
      avail_null_date: 0,
      avail_real_upcoming: 0,
      avail_sentinel: 0,
      avail_seen_7d: 0,
      avail_seen_30d: 0,
      last_seen: null,
    };
    const row = classifyCalendarHouse(
      { ...c, ...l },
      { today, horizonEnd, retiredSet, activeSet },
    );
    classified.push(row);
  }

  const cohorts = {};
  for (const row of classified) {
    const key = row.cohort;
    if (!cohorts[key]) {
      cohorts[key] = {
        n: 0,
        active_n: 0,
        retired_n: 0,
        avail_sum: 0,
        seen7_sum: 0,
        null_date_sum: 0,
        slugs_active: [],
        top_active: [],
      };
    }
    const g = cohorts[key];
    g.n += 1;
    g.avail_sum += row.available_n;
    g.seen7_sum += row.avail_seen_7d;
    g.null_date_sum += row.avail_null_date;
    if (row.retired) g.retired_n += 1;
    if (row.in_active_roots && !row.retired) {
      g.active_n += 1;
      g.slugs_active.push(row.house_slug);
    }
  }
  for (const g of Object.values(cohorts)) {
    g.slugs_active.sort();
    g.top_active = classified
      .filter((r) => r.in_active_roots && !r.retired && cohorts[r.cohort] === g)
      .sort((a, b) => b.available_n - a.available_n || a.house_slug.localeCompare(b.house_slug))
      .slice(0, 25)
      .map((r) => ({
        slug: r.house_slug,
        available_n: r.available_n,
        avail_seen_7d: r.avail_seen_7d,
        avail_null_date: r.avail_null_date,
        nearest_upcoming: r.nearest_upcoming,
        upcoming_ready_n: r.upcoming_ready_n,
      }));
  }

  // Active-root scored population metrics (the ones that matter for the plan).
  const activeRows = classified.filter((r) => r.in_active_roots && !r.retired);
  const activeWithReadyUpcoming = activeRows.filter((r) => r.upcoming_ready_n > 0);
  const activeWithUpcoming8w = activeRows.filter((r) => r.upcoming_8w_n > 0);
  const activeMmoaFresh = activeRows.filter((r) => r.cohort === 'mmoa_fresh');
  const activeMmoaStale = activeRows.filter((r) => r.cohort === 'mmoa_stale_available');
  const activeMmoaEmpty = activeRows.filter((r) => r.cohort === 'mmoa_no_available');
  const activeDark = activeRows.filter((r) => r.cohort === 'calendar_dark');
  const activeTradNotReady = activeRows.filter((r) => r.cohort === 'trad_upcoming_not_ready');

  // Watcher config intersection
  const catB = new Set(code.auction_discovery);
  const ah = new Set(code.ah_platform_active);
  const catBHealth = code.auction_discovery.map((slug) => {
    const row = activeRows.find((r) => r.house_slug === slug) || classified.find((r) => r.house_slug === slug);
    return {
      slug,
      cohort: row?.cohort || 'missing',
      upcoming_ready_n: row?.upcoming_ready_n || 0,
      upcoming_8w_n: row?.upcoming_8w_n || 0,
      nearest_upcoming: row?.nearest_upcoming || null,
      available_n: row?.available_n || 0,
      avail_seen_7d: row?.avail_seen_7d || 0,
    };
  });

  const totals = {
    available_lots: activeRows.reduce((s, r) => s + r.available_n, 0),
    available_null_date: activeRows.reduce((s, r) => s + r.avail_null_date, 0),
    available_seen_7d: activeRows.reduce((s, r) => s + r.avail_seen_7d, 0),
    calendar_houses: calBy.size,
    always_on_houses: [...calBy.values()].filter((c) => c.always_on_n > 0).length,
    upcoming_real_houses: [...calBy.values()].filter((c) => c.upcoming_real_n > 0).length,
    upcoming_ready_houses: [...calBy.values()].filter((c) => c.upcoming_ready_n > 0).length,
    upcoming_8w_houses: [...calBy.values()].filter((c) => c.upcoming_8w_n > 0).length,
  };

  const denominator = activeRows.length || 1;
  const scores = {
    // Continuity: share of active houses fresh OR with ready upcoming target.
    populate_proxy_pct: Math.round(
      (
        (activeMmoaFresh.length + activeWithReadyUpcoming.length) /
        denominator
      ) * 1000,
    ) / 10,
    trad_ready_upcoming_pct_of_active:
      Math.round((activeWithReadyUpcoming.length / denominator) * 1000) / 10,
    mmoa_fresh_pct_of_active:
      Math.round((activeMmoaFresh.length / denominator) * 1000) / 10,
    stale_or_empty_mmoa_pct_of_active:
      Math.round(((activeMmoaStale.length + activeMmoaEmpty.length) / denominator) * 1000) / 10,
    // Traditional intelligence gap: active houses with NO real upcoming date spine.
    no_real_upcoming_pct_of_active:
      Math.round(
        (activeRows.filter((r) => r.upcoming_real_n === 0).length / denominator) * 1000,
      ) / 10,
  };

  const upcomingByHouse = {};
  for (const [slug, c] of calBy) {
    if (c.upcoming_detail?.length) {
      upcomingByHouse[slug] = c.upcoming_detail
        .slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }
  }

  return {
    db: true,
    today,
    horizon_days: HORIZON_DAYS,
    horizon_end: horizonEnd,
    totals,
    scores,
    cohorts,
    active_cohort_counts: {
      trad_ready_upcoming: activeWithReadyUpcoming.length,
      trad_upcoming_not_ready: activeTradNotReady.length,
      mmoa_fresh: activeMmoaFresh.length,
      mmoa_stale_available: activeMmoaStale.length,
      mmoa_no_available: activeMmoaEmpty.length,
      calendar_dark: activeDark.length,
      active_total: activeRows.length,
    },
    gaps: {
      active_dark: activeDark.map((r) => r.house_slug),
      active_trad_not_ready: activeTradNotReady.map((r) => r.house_slug),
      active_mmoa_stale_top: activeMmoaStale
        .slice()
        .sort((a, b) => b.available_n - a.available_n)
        .slice(0, 25)
        .map((r) => ({
          slug: r.house_slug,
          available_n: r.available_n,
          avail_null_date: r.avail_null_date,
          last_seen: r.last_seen,
        })),
      active_mmoa_empty_sample: activeMmoaEmpty.map((r) => r.house_slug).slice(0, 40),
      catb_without_ready_upcoming: catBHealth.filter((h) => h.upcoming_ready_n === 0),
      active_ah_without_ready_upcoming: code.ah_platform_active
        .map((slug) => activeRows.find((r) => r.house_slug === slug))
        .filter((r) => r && r.upcoming_ready_n === 0)
        .map((r) => ({
          slug: r.house_slug,
          cohort: r.cohort,
          available_n: r.available_n,
          avail_seen_7d: r.avail_seen_7d,
        })),
    },
    catb_health: catBHealth,
    upcoming_by_house: upcomingByHouse,
    // Keep full classified rows for --save JSON, not for CLI spam.
    houses: classified,
  };
}

function printHuman(report) {
  const { code, db } = report;
  console.log(`Fleet coverage baseline @ ${report.generated_at}`);
  console.log('─'.repeat(64));
  console.log('CODE');
  console.log(`  HOUSE_ROOTS:           ${code.house_roots_total}`);
  console.log(`  Active (not retired):  ${code.active_n}`);
  console.log(`  Retired in roots:      ${code.retired_in_roots_n}`);
  console.log(`  AUCTION_DISCOVERY:     ${code.auction_discovery_n} → ${code.auction_discovery.join(', ')}`);
  console.log(`  AH platform active:    ${code.ah_platform_active_n}`);
  console.log(`  Covered catB∪AH:       ${code.active_covered_by_catb_or_ah_n}`);
  console.log(`  Active NOT covered:    ${code.active_not_covered_by_catb_or_ah_n}`);
  console.log(`  Rolling URL hints:     ${code.rolling_url_hint_n}`);

  if (!db?.db) {
    console.log('\nDB: skipped (' + (db?.reason || 'n/a') + ')');
    return;
  }

  console.log('\nDB (active roots only where noted)');
  console.log(`  today / horizon:       ${db.today} / ${db.horizon_days}d → ${db.horizon_end}`);
  console.log(`  calendar houses:       ${db.totals.calendar_houses}`);
  console.log(`  always_on houses:      ${db.totals.always_on_houses}`);
  console.log(`  real upcoming houses:  ${db.totals.upcoming_real_houses}`);
  console.log(`  ready upcoming houses: ${db.totals.upcoming_ready_houses}`);
  console.log(`  upcoming ≤ horizon:    ${db.totals.upcoming_8w_houses}`);
  console.log(`  available lots (active rows sum): ${db.totals.available_lots}`);
  console.log(`  available null dates:  ${db.totals.available_null_date}`);
  console.log(`  available seen 7d:     ${db.totals.available_seen_7d}`);

  console.log('\nACTIVE COHORTS');
  for (const [k, v] of Object.entries(db.active_cohort_counts)) {
    console.log(`  ${k.padEnd(26)} ${v}`);
  }

  console.log('\nSCORES (proxies — not final fleet metric module)');
  for (const [k, v] of Object.entries(db.scores)) {
    console.log(`  ${k.padEnd(34)} ${v}%`);
  }

  console.log('\nGAPS');
  console.log(`  active calendar_dark:          ${db.gaps.active_dark.join(', ') || '—'}`);
  console.log(`  active trad not ready:         ${db.gaps.active_trad_not_ready.join(', ') || '—'}`);
  console.log('  catB without ready upcoming:');
  for (const h of db.gaps.catb_without_ready_upcoming) {
    console.log(`    - ${h.slug}: cohort=${h.cohort} avail=${h.available_n} seen7=${h.avail_seen_7d} near=${h.nearest_upcoming}`);
  }
  console.log('  top stale mmoa (available>0, seen7=0):');
  for (const h of db.gaps.active_mmoa_stale_top.slice(0, 12)) {
    console.log(`    - ${h.slug}: avail=${h.available_n} nullDate=${h.avail_null_date}`);
  }
}

async function main() {
  const code = buildCodeInventory();
  let db = { db: false, reason: codeOnly ? '--code-only' : 'not run' };
  if (!codeOnly) {
    try {
      db = await buildDbBaseline(code);
    } catch (e) {
      db = { db: false, reason: e.message || String(e) };
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    plan: 'fleet-coverage-robustness Task 0',
    code,
    db,
  };

  if (save) {
    const outDir = join(__dirname, 'output');
    mkdirSync(outDir, { recursive: true });
    const stamp = isoDate();
    const outPath = join(outDir, `fleet-coverage-baseline-${stamp}.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    report.saved_to = outPath;
  }

  if (jsonOut) {
    // Drop ultra-verbose houses array from stdout unless saved.
    const slim = {
      ...report,
      db: report.db?.db
        ? { ...report.db, houses: undefined, houses_n: report.db.houses?.length }
        : report.db,
    };
    console.log(JSON.stringify(slim, null, 2));
  } else {
    printHuman(report);
    if (report.saved_to) console.log(`\nSaved: ${report.saved_to}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
