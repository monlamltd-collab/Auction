#!/usr/bin/env node
/**
 * Diagnose why most `lots` rows don't match an `auction_calendar` row on
 * (house_slug, catalogue_url). Read-only. Writes a report to
 * scripts/output/auction-id-gap-report.md and a summary to stdout.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/diagnose-auction-id-gap.mjs
 *
 * Produces:
 *   - Per-house breakdown of distinct (house, catalogue_url) pairs in lots,
 *     with match status against auction_calendar
 *   - 20 sampled no-match lots with one-line diagnosis each
 *   - Cohort split of the no-match population (recency, status, root drift)
 *   - Explicit recommendation: proceed / fix-up first / stop
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseUrl } from '../lib/utils.js';
import { HOUSE_ROOTS } from '../lib/houses.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = resolve(__dirname, 'output', 'auction-id-gap-report.md');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Page through every (house, catalogue_url, status, last_seen_at, id) ────
async function fetchAllLotKeys() {
  const PAGE = 1000;
  const all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('lots')
      .select('id, house, catalogue_url, status, last_seen_at')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetch lots: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function fetchAllCalendarKeys() {
  const { data, error } = await supabase
    .from('auction_calendar')
    .select('id, house_slug, url, date, status')
    .order('date', { ascending: false });
  if (error) throw new Error(`fetch calendar: ${error.message}`);
  return data || [];
}

// ── Match analysis ────────────────────────────────────────────────────────
function indexCalendar(calRows) {
  // Build two indices: exact (slug|url) and normalised (slug|normaliseUrl(url))
  const exact = new Map();
  const norm = new Map();
  const bySlug = new Map();
  for (const row of calRows) {
    const slug = row.house_slug;
    const exactKey = `${slug}|${row.url}`;
    const normKey = `${slug}|${normaliseUrl(row.url)}`;
    if (!exact.has(exactKey)) exact.set(exactKey, []);
    exact.get(exactKey).push(row);
    if (!norm.has(normKey)) norm.set(normKey, []);
    norm.get(normKey).push(row);
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(row);
  }
  return { exact, norm, bySlug };
}

function classifyLot(lot, calIndex) {
  const slug = lot.house;
  const lotUrl = lot.catalogue_url || '';
  const lotUrlNorm = normaliseUrl(lotUrl);
  const exactKey = `${slug}|${lotUrl}`;
  const normKey = `${slug}|${lotUrlNorm}`;

  const exactHits = calIndex.exact.get(exactKey) || [];
  const normHits = calIndex.norm.get(normKey) || [];
  const slugHits = calIndex.bySlug.get(slug) || [];

  if (exactHits.length === 1) return { class: 'exact_unique', sample: exactHits[0] };
  if (exactHits.length > 1) return { class: 'exact_multi', sample: exactHits[0] };
  if (normHits.length >= 1) return { class: 'normalised_only', sample: normHits[0] };
  if (slugHits.length === 0) return { class: 'no_calendar_for_house', sample: null };
  return { class: 'url_mismatch', sample: slugHits[0] };
}

function isOldArchival(lot) {
  if (!lot.last_seen_at) return true;
  const ageMs = Date.now() - new Date(lot.last_seen_at).getTime();
  return ageMs > 30 * 24 * 60 * 60 * 1000; // > 30 days
}

function isLive(lot) {
  if (!lot.last_seen_at) return false;
  const ageMs = Date.now() - new Date(lot.last_seen_at).getTime();
  return ageMs < 7 * 24 * 60 * 60 * 1000; // < 7 days
}

function isInactiveStatus(lot) {
  const s = (lot.status || '').toLowerCase();
  return s === 'withdrawn' || s === 'sold' || s === 'archived' || s === 'unsold';
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching all lots…');
  const lots = await fetchAllLotKeys();
  console.log(`  ${lots.length} lots`);

  console.log('Fetching all auction_calendar rows…');
  const calRows = await fetchAllCalendarKeys();
  console.log(`  ${calRows.length} calendar rows`);

  const calIndex = indexCalendar(calRows);

  // Pair-level summary
  const pairKey = (l) => `${l.house}|${l.catalogue_url}`;
  const pairs = new Map(); // pairKey -> { house, url, lots:[], lotsCount, sampleLot, classification }
  for (const lot of lots) {
    const k = pairKey(lot);
    if (!pairs.has(k)) {
      pairs.set(k, { house: lot.house, url: lot.catalogue_url, lots: [], sampleLot: lot });
    }
    pairs.get(k).lots.push(lot);
  }

  for (const pair of pairs.values()) {
    pair.lotsCount = pair.lots.length;
    pair.classification = classifyLot(pair.sampleLot, calIndex);
    pair.recentLotsCount = pair.lots.filter(isLive).length;
    pair.archivalLotsCount = pair.lots.filter(isOldArchival).length;
    pair.inactiveLotsCount = pair.lots.filter(isInactiveStatus).length;
    pair.rootUrlNow = HOUSE_ROOTS[pair.house] || null;
    pair.rootDrifted = pair.rootUrlNow
      ? normaliseUrl(pair.rootUrlNow) !== normaliseUrl(pair.url)
      : null;
  }

  const pairsArr = Array.from(pairs.values());

  // ── Cohort tallies ─────────────────────────────────────────────────────
  const cohorts = {
    exact_unique: { pairs: 0, lots: 0 },
    exact_multi: { pairs: 0, lots: 0 },
    normalised_only: { pairs: 0, lots: 0 },
    no_calendar_for_house: { pairs: 0, lots: 0 },
    url_mismatch: { pairs: 0, lots: 0 },
  };
  for (const p of pairsArr) {
    const c = p.classification.class;
    cohorts[c].pairs += 1;
    cohorts[c].lots += p.lotsCount;
  }

  // No-match cohort split on the LOT level (12.7k rows)
  const noMatchLots = lots.filter((l) => {
    const c = classifyLot(l, calIndex).class;
    return c === 'no_calendar_for_house' || c === 'url_mismatch';
  });
  const split = {
    total: noMatchLots.length,
    live: noMatchLots.filter(isLive).length,
    archival: noMatchLots.filter(isOldArchival).length,
    inactiveStatus: noMatchLots.filter(isInactiveStatus).length,
    rootDriftedHouse: noMatchLots.filter((l) => {
      const root = HOUSE_ROOTS[l.house];
      return root && normaliseUrl(root) !== normaliseUrl(l.catalogue_url || '');
    }).length,
  };

  // ── 20 samples across ≥ 5 houses ───────────────────────────────────────
  const noMatchPairs = pairsArr.filter((p) =>
    p.classification.class === 'no_calendar_for_house' ||
    p.classification.class === 'url_mismatch' ||
    p.classification.class === 'normalised_only',
  );
  // Group by house, take 1-3 from each up to ~20
  const byHouse = new Map();
  for (const p of noMatchPairs) {
    if (!byHouse.has(p.house)) byHouse.set(p.house, []);
    byHouse.get(p.house).push(p);
  }
  const samples = [];
  const houseOrder = Array.from(byHouse.keys()).sort();
  let perHouseCap = 1;
  while (samples.length < 20 && perHouseCap <= 5) {
    for (const house of houseOrder) {
      if (samples.length >= 20) break;
      const taken = samples.filter((s) => s.house === house).length;
      if (taken < perHouseCap) {
        const candidate = byHouse.get(house)[taken];
        if (candidate) samples.push(candidate);
      }
    }
    perHouseCap += 1;
  }

  // ── Recommendation ─────────────────────────────────────────────────────
  let recommendation;
  const archivalPct = split.total ? (split.archival / split.total) * 100 : 0;
  const livePct = split.total ? (split.live / split.total) * 100 : 0;
  const normalisedPct = cohorts.normalised_only.lots / Math.max(1, lots.length) * 100;
  const rootDriftPct = split.total ? (split.rootDriftedHouse / split.total) * 100 : 0;

  if (archivalPct >= 80) {
    recommendation = {
      verdict: 'PROCEED',
      reason: `${archivalPct.toFixed(1)}% of no-match lots are old/archival (last_seen_at > 30d). Live cohort will rebuild via the writer stamping auction_id on fresh scrapes. Accept the low backfill.`,
    };
  } else if (normalisedPct >= 5) {
    recommendation = {
      verdict: 'FIX_UP_FIRST',
      reason: `${normalisedPct.toFixed(1)}% of lots would match if both sides were normalised. Normalise auction_calendar.url in-place before Move 2 to recover them.`,
    };
  } else if (rootDriftPct >= 30 && livePct >= 30) {
    recommendation = {
      verdict: 'FIX_UP_FIRST',
      reason: `${rootDriftPct.toFixed(1)}% of no-match are on houses whose HOUSE_ROOTS URL has rotated since the lot was persisted. Reconcile auction_calendar against HOUSE_ROOTS before Move 2.`,
    };
  } else {
    recommendation = {
      verdict: 'INVESTIGATE_FURTHER',
      reason: `Mixed signal: archival ${archivalPct.toFixed(1)}%, live ${livePct.toFixed(1)}%, root-drift ${rootDriftPct.toFixed(1)}%, normalisation-only ${normalisedPct.toFixed(1)}%. Pause and discuss before committing to a backfill strategy.`,
    };
  }

  // ── Write report ───────────────────────────────────────────────────────
  mkdirSync(dirname(REPORT_PATH), { recursive: true });

  const lines = [];
  lines.push('# auction_id backfill gap — diagnostic report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total lots: ${lots.length}`);
  lines.push(`Distinct (house, catalogue_url) pairs: ${pairsArr.length}`);
  lines.push(`Total auction_calendar rows: ${calRows.length}`);
  lines.push('');
  lines.push('## Recommendation');
  lines.push('');
  lines.push(`**${recommendation.verdict}** — ${recommendation.reason}`);
  lines.push('');
  lines.push('## Cohort summary (pair-level)');
  lines.push('');
  lines.push('| Class | Distinct pairs | Lots | % of lots |');
  lines.push('|---|---:|---:|---:|');
  for (const [k, v] of Object.entries(cohorts)) {
    const pct = (v.lots / lots.length * 100).toFixed(1);
    lines.push(`| ${k} | ${v.pairs} | ${v.lots} | ${pct}% |`);
  }
  lines.push('');
  lines.push('## No-match cohort split (lot-level)');
  lines.push('');
  lines.push('| Cohort | Lots | % of no-match |');
  lines.push('|---|---:|---:|');
  const pct = (n) => split.total ? (n / split.total * 100).toFixed(1) : '0.0';
  lines.push(`| Total no-match | ${split.total} | 100.0% |`);
  lines.push(`| ...live (last_seen_at < 7d) | ${split.live} | ${pct(split.live)}% |`);
  lines.push(`| ...archival (last_seen_at > 30d) | ${split.archival} | ${pct(split.archival)}% |`);
  lines.push(`| ...inactive status (sold/withdrawn/etc) | ${split.inactiveStatus} | ${pct(split.inactiveStatus)}% |`);
  lines.push(`| ...on a house with rotated HOUSE_ROOTS | ${split.rootDriftedHouse} | ${pct(split.rootDriftedHouse)}% |`);
  lines.push('');
  lines.push('## Per-house breakdown');
  lines.push('');
  lines.push('| House | Pairs | Lots | Match class | Recent (<7d) | Archival (>30d) | Inactive | Root drifted |');
  lines.push('|---|---:|---:|---|---:|---:|---:|:---:|');

  const byHouseAgg = new Map();
  for (const p of pairsArr) {
    if (!byHouseAgg.has(p.house)) {
      byHouseAgg.set(p.house, {
        house: p.house,
        pairs: 0,
        lots: 0,
        recent: 0,
        archival: 0,
        inactive: 0,
        rootDriftedPairs: 0,
        classes: new Set(),
      });
    }
    const h = byHouseAgg.get(p.house);
    h.pairs += 1;
    h.lots += p.lotsCount;
    h.recent += p.recentLotsCount;
    h.archival += p.archivalLotsCount;
    h.inactive += p.inactiveLotsCount;
    if (p.rootDrifted === true) h.rootDriftedPairs += 1;
    h.classes.add(p.classification.class);
  }
  const houseAggArr = Array.from(byHouseAgg.values()).sort((a, b) => b.lots - a.lots);
  for (const h of houseAggArr) {
    const cls = Array.from(h.classes).join(', ');
    const drift = h.rootDriftedPairs > 0 ? `${h.rootDriftedPairs}/${h.pairs}` : '0';
    lines.push(`| ${h.house} | ${h.pairs} | ${h.lots} | ${cls} | ${h.recent} | ${h.archival} | ${h.inactive} | ${drift} |`);
  }
  lines.push('');
  lines.push('## 20 sampled no-match pairs');
  lines.push('');
  for (const s of samples) {
    lines.push(`### ${s.house} — ${s.lotsCount} lots`);
    lines.push('');
    lines.push(`- **Lot's catalogue_url:** \`${s.url}\``);
    lines.push(`- **Class:** ${s.classification.class}`);
    if (s.classification.sample) {
      lines.push(`- **Closest calendar match:** \`${s.classification.sample.url}\` (date ${s.classification.sample.date})`);
    } else {
      lines.push(`- **Calendar rows for this slug:** 0`);
    }
    if (s.rootUrlNow) {
      lines.push(`- **HOUSE_ROOTS now:** \`${s.rootUrlNow}\`${s.rootDrifted ? ' (drifted)' : ''}`);
    }
    lines.push(`- **Recency split:** ${s.recentLotsCount} recent (<7d), ${s.archivalLotsCount} archival (>30d), ${s.inactiveLotsCount} inactive status`);
    lines.push('');
  }
  lines.push('---');
  lines.push(`Run: \`node scripts/diagnose-auction-id-gap.mjs\` (read-only, no DB writes).`);

  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');

  // ── stdout summary ─────────────────────────────────────────────────────
  console.log('');
  console.log('═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Total lots: ${lots.length}`);
  console.log(`Distinct pairs: ${pairsArr.length}`);
  console.log(`Calendar rows: ${calRows.length}`);
  console.log('');
  console.log('Cohort (lot-level):');
  for (const [k, v] of Object.entries(cohorts)) {
    const p = (v.lots / lots.length * 100).toFixed(1);
    console.log(`  ${k.padEnd(28)} ${String(v.lots).padStart(6)} (${p}%)`);
  }
  console.log('');
  console.log('No-match split:');
  console.log(`  live (<7d)            ${split.live} (${pct(split.live)}%)`);
  console.log(`  archival (>30d)       ${split.archival} (${pct(split.archival)}%)`);
  console.log(`  inactive status       ${split.inactiveStatus} (${pct(split.inactiveStatus)}%)`);
  console.log(`  root-drifted house    ${split.rootDriftedHouse} (${pct(split.rootDriftedHouse)}%)`);
  console.log('');
  console.log(`RECOMMENDATION: ${recommendation.verdict}`);
  console.log(`  ${recommendation.reason}`);
  console.log('');
  console.log(`Report written: ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
