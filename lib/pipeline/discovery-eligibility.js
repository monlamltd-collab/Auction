// lib/pipeline/discovery-eligibility.js
// Pure eligibility for discoverAndUpdateCalendar (Task 4).
// No I/O — callers load calendar rows / homepage watch / class inputs.

import { classifyHouseForDiscovery } from './house-class.js';
import { getUpcomingHorizon, DEFAULT_HORIZON_DAYS } from './watcher-horizon.js';
import { isRealCalendarDate } from './calendar-entries.js';

export const DEFAULT_RECHECK_DAYS = 7;
export const DEFAULT_NEAR_SALE_DAYS = 14;
export const DEFAULT_DARK_BUDGET = 25;
export const DEFAULT_RECHECK_BUDGET = 10;
/** Extra dark/unhealthy slots reserved so VIP houses never starve under budget. */
export const DEFAULT_VIP_BUDGET = 5;
/** VIP houses recheck more often than the fleet default. */
export const VIP_RECHECK_DAYS = 3;

/**
 * Must-cover traditional houses — never miss nearest sale / stay dark without
 * elevated priority. Keep short; not a second HOUSE_ROOTS.
 */
export const VIP_MUST_COVER_HOUSES = Object.freeze([
  'savills',
  'allsop',
  'btgeddisons',
  'knightfrank',
  'bondwolfe',
  'suttonkersh',
  'buttersjohnbee',
]);

export function isVipMustCoverHouse(slug) {
  return VIP_MUST_COVER_HOUSES.includes(String(slug || '').toLowerCase());
}

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
 * Decide whether AI root discovery should run for one house this pass.
 *
 * @param {object} input
 * @param {string} input.slug
 * @param {import('./house-class.js').ClassifyInput} [input.classifyInput]
 * @param {Array} [input.calendarRows]
 * @param {string|null} [input.lastDiscoveryAt] ISO timestamp or date of last AI discovery attempt
 * @param {boolean} [input.handledByWatcherThisCycle]
 * @param {string} [input.todayIso]
 * @param {number} [input.horizonDays]
 * @param {number} [input.recheckDays]
 * @param {number} [input.nearSaleDays]
 * @param {boolean} [input.force]
 * @param {boolean} [input.vip] force VIP treatment
 */
export function evaluateDiscoveryEligibility(input = {}) {
  const slug = String(input.slug || '').toLowerCase();
  const todayIso = input.todayIso || new Date().toISOString().slice(0, 10);
  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const baseRecheckDays = input.recheckDays ?? DEFAULT_RECHECK_DAYS;
  const nearSaleDays = input.nearSaleDays ?? DEFAULT_NEAR_SALE_DAYS;
  const vip = input.vip === true || isVipMustCoverHouse(slug);
  const recheckDays = vip ? Math.min(baseRecheckDays, VIP_RECHECK_DAYS) : baseRecheckDays;
  const reasons = [];
  if (vip) reasons.push('vip_must_cover');

  const classifyInput = {
    slug,
    ...(input.classifyInput || {}),
    calendarRows: input.classifyInput?.calendarRows || input.calendarRows || [],
    todayIso,
  };
  const classification = classifyHouseForDiscovery(classifyInput);

  if (classification.class === 'retired' || input.classifyInput?.retired) {
    return {
      eligible: false,
      priority: 0,
      bucket: 'retired',
      reasons: ['retired'],
      classification,
      horizon: getUpcomingHorizon([], { todayIso, horizonDays }),
      vip,
      slug,
      lastDiscoveryAt: input.lastDiscoveryAt || null,
    };
  }

  if (!classification.needsNextSaleWatch) {
    return {
      eligible: false,
      priority: 0,
      bucket: 'no_watch',
      reasons: ['needs_next_sale_watch_false', ...classification.reasons],
      classification,
      horizon: getUpcomingHorizon(classifyInput.calendarRows, { todayIso, horizonDays }),
      vip,
      slug,
      lastDiscoveryAt: input.lastDiscoveryAt || null,
    };
  }

  if (input.handledByWatcherThisCycle) {
    return {
      eligible: false,
      priority: 0,
      bucket: 'watcher_handled',
      reasons: ['handled_by_watcher_this_cycle'],
      classification,
      horizon: getUpcomingHorizon(classifyInput.calendarRows, { todayIso, horizonDays }),
      vip,
      slug,
      lastDiscoveryAt: input.lastDiscoveryAt || null,
    };
  }

  if (input.force) {
    return {
      eligible: true,
      priority: 100,
      bucket: 'force',
      reasons: ['force', ...(vip ? ['vip_must_cover'] : [])],
      classification,
      horizon: getUpcomingHorizon(classifyInput.calendarRows, { todayIso, horizonDays }),
      vip,
      slug,
      lastDiscoveryAt: input.lastDiscoveryAt || null,
    };
  }

  const horizon = getUpcomingHorizon(classifyInput.calendarRows, { todayIso, horizonDays });
  const dark = !horizon.hasAnyUpcoming;
  const unhealthy = horizon.needsRefresh;

  // Recency of last discovery attempt (prefer metadata when present)
  let lastAt = null;
  if (input.lastDiscoveryAt) {
    const raw = String(input.lastDiscoveryAt);
    lastAt = raw.length >= 10 ? raw.slice(0, 10) : null;
  }
  const daysSinceLast = lastAt && isRealCalendarDate(lastAt)
    ? daysBetween(lastAt, todayIso)
    : Infinity;
  const recheckDue = daysSinceLast >= recheckDays;

  const nearest = horizon.nearestDate;
  const nearSale =
    !!nearest &&
    isRealCalendarDate(nearest) &&
    nearest >= todayIso &&
    nearest <= addDays(todayIso, nearSaleDays);

  if (dark) {
    reasons.push('dark_no_upcoming');
    // Higher priority for clear traditional classes
    let priority = 80;
    if (classification.class === 'traditional_rotating') priority = 95;
    else if (classification.class === 'traditional_static') priority = 90;
    else if (classification.class === 'unknown') priority = 70;
    if (vip) priority = Math.max(priority, 98);
    return {
      eligible: true,
      priority,
      bucket: 'dark',
      reasons: [...reasons, ...classification.reasons],
      classification,
      horizon,
      vip,
      slug,
      lastDiscoveryAt: input.lastDiscoveryAt || null,
    };
  }

  if (unhealthy) {
    reasons.push('unhealthy_horizon');
    let priority = 75;
    if (horizon.reasons?.includes('nearest_not_ready')) priority = Math.max(priority, 85);
    if (horizon.reasons?.includes('stale_not_ready')) priority = Math.max(priority, 82);
    if (vip) priority = Math.max(priority, 96);
    return {
      eligible: true,
      priority,
      bucket: 'unhealthy',
      reasons: [...reasons, ...horizon.reasons, ...classification.reasons],
      classification,
      horizon,
      vip,
      slug,
      lastDiscoveryAt: input.lastDiscoveryAt || null,
    };
  }

  // Healthy horizon: still allow additional-sale search on cadence or near sale
  if (nearSale && recheckDue) {
    reasons.push('near_sale_recheck');
    return {
      eligible: true,
      priority: vip ? 70 : 55,
      bucket: 'recheck',
      reasons: [...reasons, `nearest=${nearest}`, `days_since_last=${daysSinceLast}`],
      classification,
      horizon,
      vip,
      slug,
      lastDiscoveryAt: input.lastDiscoveryAt || null,
    };
  }
  if (recheckDue && horizon.count < 2) {
    // only one sale on books — look for next-after-next weekly
    reasons.push('single_sale_weekly_recheck');
    return {
      eligible: true,
      priority: vip ? 65 : 50,
      bucket: 'recheck',
      reasons: [...reasons, `count=${horizon.count}`, `days_since_last=${daysSinceLast}`],
      classification,
      horizon,
      vip,
      slug,
      lastDiscoveryAt: input.lastDiscoveryAt || null,
    };
  }
  if (recheckDue && nearSale) {
    reasons.push('cadence_and_near');
    return {
      eligible: true,
      priority: vip ? 68 : 52,
      bucket: 'recheck',
      reasons,
      classification,
      horizon,
      vip,
      slug,
      lastDiscoveryAt: input.lastDiscoveryAt || null,
    };
  }

  reasons.push('healthy_horizon_skip');
  if (!recheckDue) reasons.push('recheck_not_due');
  return {
    eligible: false,
    priority: 0,
    bucket: 'healthy_skip',
    reasons,
    classification,
    horizon,
    vip,
    slug,
    lastDiscoveryAt: input.lastDiscoveryAt || null,
  };
}

/**
 * Select ranked slugs under budget caps.
 *
 * @param {Array<object>} evaluations outputs of evaluateDiscoveryEligibility
 * @param {{ darkBudget?: number, recheckBudget?: number, maxTotal?: number, vipBudget?: number }} [opts]
 */
export function selectDiscoveryTargets(evaluations = [], opts = {}) {
  const darkBudget = opts.darkBudget ?? DEFAULT_DARK_BUDGET;
  const recheckBudget = opts.recheckBudget ?? DEFAULT_RECHECK_BUDGET;
  const vipBudget = opts.vipBudget ?? DEFAULT_VIP_BUDGET;
  const maxTotal = opts.maxTotal ?? darkBudget + recheckBudget + vipBudget;

  const eligible = evaluations
    .filter((e) => e && e.eligible)
    .slice()
    .sort((a, b) => {
      // Forced work retains precedence. Otherwise attempt age is primary so a
      // continuously eligible lower-priority house cannot starve indefinitely.
      if ((a.bucket === 'force') !== (b.bucket === 'force')) return a.bucket === 'force' ? -1 : 1;
      const aLast = a.lastDiscoveryAt ? String(a.lastDiscoveryAt) : '';
      const bLast = b.lastDiscoveryAt ? String(b.lastDiscoveryAt) : '';
      if (aLast !== bLast) return aLast.localeCompare(bLast);
      // VIP unhealthy/dark before ordinary peers at equal age
      if (!!a.vip !== !!b.vip) return a.vip ? -1 : 1;
      if (b.priority !== a.priority) return b.priority - a.priority;
      return String(a.slug || '').localeCompare(String(b.slug || ''));
    });

  const chosen = [];
  let darkUsed = 0;
  let recheckUsed = 0;
  let vipExtraUsed = 0;

  for (const e of eligible) {
    if (chosen.length >= maxTotal) break;
    const bucket = e.bucket;
    if (bucket === 'dark' || bucket === 'unhealthy' || bucket === 'force') {
      if (bucket === 'force') {
        chosen.push(e);
        continue;
      }
      if (darkUsed < darkBudget) {
        darkUsed += 1;
        chosen.push(e);
        continue;
      }
      // VIP overflow: never starve must-cover houses when ordinary dark is full
      if (e.vip && vipExtraUsed < vipBudget) {
        vipExtraUsed += 1;
        chosen.push(e);
        continue;
      }
      continue;
    }
    if (bucket === 'recheck') {
      if (recheckUsed >= recheckBudget) {
        if (e.vip && vipExtraUsed < vipBudget) {
          vipExtraUsed += 1;
          chosen.push(e);
        }
        continue;
      }
      recheckUsed += 1;
      chosen.push(e);
      continue;
    }
    // unknown buckets: count against dark budget cautiously
    if (darkUsed >= darkBudget) {
      if (e.vip && vipExtraUsed < vipBudget) {
        vipExtraUsed += 1;
        chosen.push(e);
      }
      continue;
    }
    darkUsed += 1;
    chosen.push(e);
  }

  return {
    selected: chosen,
    darkUsed,
    recheckUsed,
    vipExtraUsed,
    eligibleCount: eligible.length,
    totalEvaluated: evaluations.length,
  };
}
