// lib/pipeline/lot-date-consensus.js
// Task 8: majority lot auction dates → optional upcoming calendar backflow.

import { HOUSE_DISPLAY_NAMES } from '../houses.js';
import {
  isFutureIsoDate,
  isSanelyNearFutureDate,
} from '../utils/auction-date-parse.js';
import { isRealCalendarDate, upsertUpcomingCatalogue } from './calendar-entries.js';
import { setLastLotConsensusSummary } from './cycle-coordination.js';

export const DEFAULT_MIN_LOTS = 8;
export const DEFAULT_RATIO = 0.7;

/**
 * Compute majority date among lot-like objects.
 *
 * @param {Array<object>} lots
 * @param {{ todayIso?: string, minLots?: number, ratio?: number, catalogueUrl?: string|null }} [opts]
 */
export function computeLotDateConsensus(lots, opts = {}) {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const minLots = opts.minLots ?? DEFAULT_MIN_LOTS;
  const ratio = opts.ratio ?? DEFAULT_RATIO;
  const catalogueUrl = opts.catalogueUrl || null;

  const dates = [];
  for (const lot of lots || []) {
    const raw =
      lot?.auction_date ||
      lot?.auctionDate ||
      lot?._auctionDate ||
      lot?.date ||
      null;
    if (!raw) continue;
    const d = String(raw).slice(0, 10);
    if (!isRealCalendarDate(d)) continue;
    if (!isSanelyNearFutureDate(d, { todayIso })) continue;
    dates.push(d);
  }

  const total = (lots || []).length;
  const dated = dates.length;
  if (total < minLots || dated < minLots) {
    return {
      ok: false,
      reason: 'insufficient_lots',
      total,
      dated,
      majorityDate: null,
      majorityCount: 0,
      ratio: 0,
      catalogueUrl,
    };
  }

  const counts = new Map();
  for (const d of dates) counts.set(d, (counts.get(d) || 0) + 1);
  let best = null;
  let bestN = 0;
  for (const [d, n] of counts) {
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  const majRatio = dated > 0 ? bestN / dated : 0;
  if (!best || majRatio < ratio) {
    return {
      ok: false,
      reason: 'no_majority',
      total,
      dated,
      majorityDate: best,
      majorityCount: bestN,
      ratio: majRatio,
      catalogueUrl,
    };
  }

  if (!isFutureIsoDate(best, todayIso)) {
    return {
      ok: false,
      reason: 'majority_not_future',
      total,
      dated,
      majorityDate: best,
      majorityCount: bestN,
      ratio: majRatio,
      catalogueUrl,
    };
  }

  return {
    ok: true,
    reason: 'majority',
    total,
    dated,
    majorityDate: best,
    majorityCount: bestN,
    ratio: majRatio,
    catalogueUrl,
  };
}

/**
 * Should we lift consensus into calendar?
 * Pure: checks existing calendar rows for same date ready upcoming.
 */
export function shouldLiftConsensusToCalendar(consensus, calendarRows = [], opts = {}) {
  if (!consensus?.ok || !consensus.majorityDate) {
    return { lift: false, reason: consensus?.reason || 'no_consensus' };
  }
  if (!consensus.catalogueUrl || !String(consensus.catalogueUrl).startsWith('http')) {
    return { lift: false, reason: 'missing_catalogue_url' };
  }

  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const d = consensus.majorityDate;
  const existing = (calendarRows || []).filter((r) => {
    if (!r || r.status !== 'upcoming') return false;
    if (!isRealCalendarDate(r.date)) return false;
    return String(r.date).slice(0, 10) === d;
  });
  if (existing.some((r) => r.catalogue_ready === true && r.url === consensus.catalogueUrl)) {
    return { lift: false, reason: 'already_ready_same_url_date' };
  }
  if (existing.some((r) => r.catalogue_ready === true)) {
    return { lift: false, reason: 'already_ready_same_date' };
  }
  // Past majority shouldn't happen due to compute filter
  if (!isFutureIsoDate(d, todayIso)) return { lift: false, reason: 'not_future' };

  return {
    lift: true,
    reason: existing.length ? 'refresh_or_add_url' : 'new_date',
    date: d,
    url: consensus.catalogueUrl,
  };
}

export function isLotConsensusLiftEnabled(env = process.env) {
  // Default OFF until soak — plan Task 8/11. Set true to enable writers.
  const raw = env.LOT_DATE_CONSENSUS_LIFT_ENABLED;
  if (raw == null || raw === '') return false;
  return String(raw).toLowerCase() === 'true';
}

/**
 * After a successful scrape: maybe upsert calendar from lot majority date.
 *
 * @param {object} supabase
 * @param {{ slug: string, lots: object[], catalogueUrl: string, calendarRows?: object[], dryRun?: boolean, force?: boolean, todayIso?: string }} args
 */
export async function maybeLiftLotDateConsensus(supabase, args = {}) {
  const slug = args.slug;
  // force=true enables write path even when env flag is off (admin ops).
  const enabled = args.force === true || isLotConsensusLiftEnabled();
  // When feature is off, force dryRun so we only observe consensus quality.
  const dryRun = args.dryRun === true || !enabled;

  const consensus = computeLotDateConsensus(args.lots || [], {
    todayIso: args.todayIso,
    minLots: args.minLots,
    ratio: args.ratio,
    catalogueUrl: args.catalogueUrl || null,
  });

  let calendarRows = args.calendarRows;
  if (!calendarRows && supabase && slug) {
    try {
      const { data } = await supabase
        .from('auction_calendar')
        .select('url, date, status, catalogue_ready')
        .eq('house_slug', slug)
        .in('status', ['upcoming', 'always_on']);
      calendarRows = data || [];
    } catch {
      calendarRows = [];
    }
  }

  const decision = shouldLiftConsensusToCalendar(consensus, calendarRows, {
    todayIso: args.todayIso,
  });

  const result = {
    slug,
    consensus,
    decision,
    enabled,
    dryRun,
    upserted: false,
    action: null,
    reason: null,
  };

  if (!decision.lift) {
    result.reason = decision.reason;
    setLastLotConsensusSummary(result);
    return result;
  }

  const res = await upsertUpcomingCatalogue(supabase, {
    slug,
    url: decision.url,
    date: decision.date,
    title: `${decision.date} Auction`,
    catalogueReady: true,
    source: 'lot_consensus',
    houseName: HOUSE_DISPLAY_NAMES[slug] || slug,
    allowDateFallback: false,
    replaceSameHouseDate: true,
    invalidateCache: !dryRun,
    dryRun,
  });

  result.upserted = !!res.ok && res.action === 'upserted';
  result.action = res.action || null;
  result.reason = res.reason || decision.reason || null;

  setLastLotConsensusSummary(result);
  return result;
}
