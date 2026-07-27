// lib/pipeline/watcher-horizon.js
// Pure horizon health for auction-watcher (Task 5).
// Decides whether a house still needs next-sale refresh.

import { isRealCalendarDate } from './calendar-entries.js';

export const DEFAULT_HORIZON_DAYS = 56; // 8 weeks
export const DEFAULT_MAX_UPSERTS = 3;
/** Nearest sale inside this window must be ready (or freshly verified) or we refresh. */
export const DEFAULT_NEAR_READY_DAYS = 21;
/** Not-ready upcoming rows older than this force refresh even if later sales are ready. */
export const DEFAULT_STALE_NOT_READY_DAYS = 7;

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(aIso, bIso) {
  const a = new Date(`${aIso}T00:00:00.000Z`).getTime();
  const b = new Date(`${bIso}T00:00:00.000Z`).getTime();
  return Math.floor((b - a) / 86400000);
}

/**
 * Summarise upcoming calendar spine for one house.
 *
 * @param {Array<{url?:string,date?:string|null,catalogue_ready?:boolean,status?:string,updated_at?:string|null}>} rows
 * @param {{ todayIso?: string, horizonDays?: number, nearReadyDays?: number, staleNotReadyDays?: number }} [opts]
 * @returns {{
 *   hasAnyUpcoming: boolean,
 *   hasReady: boolean,
 *   hasReadyInHorizon: boolean,
 *   nearestDate: string|null,
 *   nearestReady: boolean|null,
 *   nearestInNearWindow: boolean,
 *   staleNotReady: boolean,
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
  const nearReadyDays = opts.nearReadyDays ?? DEFAULT_NEAR_READY_DAYS;
  const staleNotReadyDays = opts.staleNotReadyDays ?? DEFAULT_STALE_NOT_READY_DAYS;
  const horizonEnd = addDays(todayIso, horizonDays);
  const nearReadyEnd = addDays(todayIso, nearReadyDays);
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
  const nearestRow = upcoming[0] || null;
  const nearestDate = nearestRow ? String(nearestRow.date).slice(0, 10) : null;
  const nearestReady = nearestRow ? nearestRow.catalogue_ready === true : null;
  const nearestInNearWindow =
    !!nearestDate && isRealCalendarDate(nearestDate) && nearestDate <= nearReadyEnd;

  let staleNotReady = false;
  for (const r of upcoming) {
    if (r.catalogue_ready === true) continue;
    const updatedRaw = r.updated_at ? String(r.updated_at) : '';
    const updatedDay = updatedRaw.length >= 10 ? updatedRaw.slice(0, 10) : null;
    if (!updatedDay || !isRealCalendarDate(updatedDay)) continue;
    if (daysBetween(updatedDay, todayIso) >= staleNotReadyDays) {
      staleNotReady = true;
      break;
    }
  }

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
    // Ready sales exist but all outside horizon — still OK for medium term
    // unless the nearest (beyond) sale is somehow not ready — handled below.
    needsRefresh = false;
    reasons.push('ready_beyond_horizon');
  } else {
    needsRefresh = false;
    reasons.push('healthy_horizon');
  }

  // Multi-sale trap (Savills class): later sales ready must NOT hide a near
  // nearest sale that is still catalogue_ready=false.
  if (nearestInNearWindow && nearestReady === false) {
    needsRefresh = true;
    if (!reasons.includes('nearest_not_ready')) reasons.push('nearest_not_ready');
  }

  // Zombie not-ready rows (e.g. Savills Jul 28 last touched in March).
  if (staleNotReady) {
    needsRefresh = true;
    if (!reasons.includes('stale_not_ready')) reasons.push('stale_not_ready');
  }

  return {
    hasAnyUpcoming: upcoming.length > 0,
    hasReady: ready.length > 0,
    hasReadyInHorizon: readyInHorizon.length > 0,
    nearestDate,
    nearestReady,
    nearestInNearWindow,
    staleNotReady,
    count: upcoming.length,
    readyCount: ready.length,
    inHorizonCount: inHorizon.length,
    needsRefresh,
    reasons,
    horizonDays,
    horizonEnd,
    nearReadyDays,
    nearReadyEnd,
    staleNotReadyDays,
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
