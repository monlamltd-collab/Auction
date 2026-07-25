// lib/pipeline/watcher-horizon.js
// Pure horizon health for auction-watcher (Task 5).
// Decides whether a house still needs next-sale refresh.

import { isRealCalendarDate } from './calendar-entries.js';

export const DEFAULT_HORIZON_DAYS = 56; // 8 weeks
export const DEFAULT_MAX_UPSERTS = 3;

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Summarise upcoming calendar spine for one house.
 *
 * @param {Array<{url?:string,date?:string|null,catalogue_ready?:boolean,status?:string}>} rows
 * @param {{ todayIso?: string, horizonDays?: number }} [opts]
 * @returns {{
 *   hasAnyUpcoming: boolean,
 *   hasReady: boolean,
 *   hasReadyInHorizon: boolean,
 *   nearestDate: string|null,
 *   count: number,
 *   readyCount: number,
 *   inHorizonCount: number,
 *   needsRefresh: boolean,
 *   reasons: string[],
 * }}
 */
export function getUpcomingHorizon(rows, opts = {}) {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const horizonDays = opts.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const horizonEnd = addDays(todayIso, horizonDays);
  const reasons = [];

  const upcoming = (rows || []).filter((r) => {
    if (!r) return false;
    if (r.status && r.status !== 'upcoming') return false;
    const date = r.date ? String(r.date).slice(0, 10) : null;
    return isRealCalendarDate(date) && date >= todayIso;
  });

  upcoming.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const ready = upcoming.filter((r) => r.catalogue_ready === true);
  const inHorizon = upcoming.filter((r) => String(r.date).slice(0, 10) <= horizonEnd);
  const readyInHorizon = inHorizon.filter((r) => r.catalogue_ready === true);
  const nearestDate = upcoming.length ? String(upcoming[0].date).slice(0, 10) : null;

  let needsRefresh = false;
  if (upcoming.length === 0) {
    needsRefresh = true;
    reasons.push('no_upcoming');
  } else if (readyInHorizon.length === 0 && ready.length === 0) {
    needsRefresh = true;
    reasons.push('upcoming_not_ready');
  } else if (readyInHorizon.length === 0 && inHorizon.length > 0) {
    needsRefresh = true;
    reasons.push('horizon_not_ready');
  } else if (readyInHorizon.length === 0 && ready.length > 0) {
    // Ready sales exist but all outside horizon — still OK for medium term.
    needsRefresh = false;
    reasons.push('ready_beyond_horizon');
  } else {
    needsRefresh = false;
    reasons.push('healthy_horizon');
  }

  return {
    hasAnyUpcoming: upcoming.length > 0,
    hasReady: ready.length > 0,
    hasReadyInHorizon: readyInHorizon.length > 0,
    nearestDate,
    count: upcoming.length,
    readyCount: ready.length,
    inHorizonCount: inHorizon.length,
    needsRefresh,
    reasons,
    horizonDays,
    horizonEnd,
  };
}

/**
 * Pick up to K acceptable future catalogue entries for upsert.
 * Prefer dated future, then undated. Never past-dated.
 *
 * @param {Array<{url:string,date?:string|null}>} entries
 * @param {{ todayIso?: string, max?: number, isFutureFn?: (d:string)=>boolean }} [opts]
 */
export function pickHorizonUpserts(entries, opts = {}) {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const max = opts.max ?? DEFAULT_MAX_UPSERTS;
  const isFuture = opts.isFutureFn || ((d) => !!d && String(d).slice(0, 10) >= todayIso);

  const acceptable = (entries || []).filter((e) => e?.url && (!e.date || isFuture(e.date)));
  const dated = acceptable
    .filter((e) => e.date)
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const undated = acceptable.filter((e) => !e.date);

  // Prefer distinct URLs; keep soonest dates first.
  const out = [];
  const seenUrl = new Set();
  for (const e of [...dated, ...undated]) {
    const key = String(e.url).trim();
    if (seenUrl.has(key)) continue;
    seenUrl.add(key);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}
