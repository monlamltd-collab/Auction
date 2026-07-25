// lib/pipeline/house-class.js
// Pure classification for next-sale discovery eligibility.
// Task 1 of fleet-coverage-robustness: no I/O, no DB writes.
//
// Consumers (later tasks):
//   - discoverAndUpdateCalendar eligibility
//   - auction-watcher / platform family enrolment
//   - fleet-coverage metric denominators
//
// Invariant: pure always_on / rolling houses should NOT be forced through
// expensive next-sale AI discovery unless signals say they actually rotate
// dated sales.

/** @typedef {'retired'|'mmoa'|'traditional_rotating'|'traditional_static'|'unknown'} HouseDiscoveryClass */

/**
 * @typedef {object} CalendarRowLite
 * @property {string} [status]
 * @property {string|null} [date]
 * @property {string|null} [url]
 * @property {boolean|null} [catalogue_ready]
 */

/**
 * @typedef {object} HomepageWatchLite
 * @property {string|null} [last_next_auction_date]
 * @property {string|null} [last_extracted_catalogue_url]
 * @property {string|null} [prev_next_auction_date]
 */

/**
 * @typedef {object} ClassifyInput
 * @property {string} slug
 * @property {string|null|undefined} [rootUrl]
 * @property {CalendarRowLite[]} [calendarRows]
 * @property {object|null|undefined} [discoveryConfig] AUCTION_DISCOVERY[slug]
 * @property {{ eig?: boolean, ah?: boolean }} [platformHints]
 * @property {HomepageWatchLite|null|undefined} [homepageWatch]
 * @property {boolean} [retired]
 * @property {string} [todayIso] YYYY-MM-DD for tests
 */

const SENTINEL_PREFIX = '2098'; // match sale-format / persist threshold ideology
const ROLLING_URL_RE =
  /current|available|[?&]search=|\/search(?:[-/?]|$)|search-auction|listings|properties-for-auction|for-sale|catalogue|online|auction-listings|lot-list|property-search/i;

/**
 * Real traditional auction date (not null, not always_on sentinel).
 * @param {string|null|undefined} date
 */
export function isRealFutureOrDatedSale(date, todayIso) {
  if (!date) return false;
  const d = String(date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  if (d > SENTINEL_PREFIX) return false; // 2099-style markers
  // "has ever been scheduled" counts for class even if past — indicates rotating sales.
  return true;
}

export function isRealUpcomingDate(date, todayIso) {
  if (!isRealFutureOrDatedSale(date, todayIso)) return false;
  const today = todayIso || new Date().toISOString().slice(0, 10);
  return String(date).slice(0, 10) >= today;
}

export function looksLikeRollingRootUrl(url) {
  if (!url) return false;
  return ROLLING_URL_RE.test(String(url));
}

function normaliseHomepageDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // leave non-ISO as truthy "present" signal via original string wrapper
  return s;
}

/**
 * Classify whether a house needs active next-sale watching.
 *
 * Conservative defaults:
 * - retired → no watch
 * - explicit AUCTION_DISCOVERY / AH / EIG hints → traditional_rotating, watch
 * - any real (non-sentinel) calendar upcoming/past dated rows → rotating
 * - only always_on + rolling root + no homepage next-date history → mmoa, no watch
 * - homepage next-date changing / present against always_on → promote to rotating watch
 * - otherwise unknown with low-rate opportunistic watch (caller budgets this)
 *
 * @param {ClassifyInput} input
 * @returns {{
 *   class: HouseDiscoveryClass,
 *   needsNextSaleWatch: boolean,
 *   reasons: string[],
 *   signals: {
 *     hasAlwaysOn: boolean,
 *     hasRealDatedCalendar: boolean,
 *     hasRealUpcoming: boolean,
 *     rollingRoot: boolean,
 *     homepageNextDate: string|null,
 *     platform: string|null,
 *   }
 * }}
 */
export function classifyHouseForDiscovery(input = {}) {
  const slug = String(input.slug || '').toLowerCase();
  const reasons = [];
  const todayIso = input.todayIso || new Date().toISOString().slice(0, 10);
  const rows = Array.isArray(input.calendarRows) ? input.calendarRows : [];
  const rootUrl = input.rootUrl || null;
  const hints = input.platformHints || {};
  const hw = input.homepageWatch || null;

  const hasAlwaysOn = rows.some((r) => (r?.status || '') === 'always_on');
  const datedRows = rows.filter((r) => isRealFutureOrDatedSale(r?.date, todayIso));
  const hasRealDatedCalendar = datedRows.length > 0;
  const hasRealUpcoming = datedRows.some((r) => isRealUpcomingDate(r?.date, todayIso));
  const rollingRoot = looksLikeRollingRootUrl(rootUrl);
  const homepageNextDate = normaliseHomepageDate(hw?.last_next_auction_date);
  const prevHomepageNextDate = normaliseHomepageDate(hw?.prev_next_auction_date);
  const homepageDateChanging =
    !!homepageNextDate &&
    !!prevHomepageNextDate &&
    homepageNextDate !== prevHomepageNextDate;

  let platform = null;
  if (hints.ah) platform = 'ah';
  else if (hints.eig) platform = 'eig';
  else if (input.discoveryConfig?.platform) platform = String(input.discoveryConfig.platform);

  const signals = {
    hasAlwaysOn,
    hasRealDatedCalendar,
    hasRealUpcoming,
    rollingRoot,
    homepageNextDate: homepageNextDate || null,
    platform,
  };

  // 1) Retired
  if (input.retired === true) {
    reasons.push('retired');
    return {
      class: 'retired',
      needsNextSaleWatch: false,
      reasons,
      signals,
    };
  }

  // 2) Explicit discovery config or known rotating platforms
  if (input.discoveryConfig) {
    reasons.push('explicit_auction_discovery_config');
    return {
      class: 'traditional_rotating',
      needsNextSaleWatch: true,
      reasons,
      signals,
    };
  }
  if (hints.ah) {
    reasons.push('ah_platform_family');
    return {
      class: 'traditional_rotating',
      needsNextSaleWatch: true,
      reasons,
      signals,
    };
  }
  if (hints.eig || platform === 'eig-whitelabel' || platform === 'eig') {
    reasons.push('eig_whitelabel_family');
    return {
      class: 'traditional_rotating',
      needsNextSaleWatch: true,
      reasons,
      signals,
    };
  }

  // 3) Calendar already carries real sale dates → rotating
  if (hasRealDatedCalendar) {
    reasons.push(hasRealUpcoming ? 'calendar_has_real_upcoming' : 'calendar_has_real_dated_history');
    return {
      class: 'traditional_rotating',
      needsNextSaleWatch: true,
      reasons,
      signals,
    };
  }

  // 4) Homepage next-date evidence promotes always_on out of pure MMOA
  if (homepageDateChanging) {
    reasons.push('homepage_next_auction_date_changing');
    return {
      class: 'traditional_rotating',
      needsNextSaleWatch: true,
      reasons,
      signals,
    };
  }
  if (homepageNextDate && hasAlwaysOn) {
    // A stable displayed next date on an always_on house is still a sell signal:
    // watch, but class as rotating so metric doesn't treat it as pure MMOA forever.
    reasons.push('homepage_next_auction_date_present_on_always_on');
    return {
      class: 'traditional_rotating',
      needsNextSaleWatch: true,
      reasons,
      signals,
    };
  }

  // 5) Pure always_on rolling stock
  if (hasAlwaysOn && rollingRoot) {
    reasons.push('always_on_with_rolling_root');
    return {
      class: 'mmoa',
      needsNextSaleWatch: false,
      reasons,
      signals,
    };
  }
  if (hasAlwaysOn && !hasRealDatedCalendar && !homepageNextDate) {
    // always_on without rolling URL hint still usually continuous; keep off AI watch
    // unless unknown signals appear. Conservative: mmoa, no watch.
    reasons.push('always_on_only_no_date_signals');
    return {
      class: 'mmoa',
      needsNextSaleWatch: false,
      reasons,
      signals,
    };
  }

  // 6) Static root catalogue with no always_on and no dates — traditional static
  // (Cat A) continuity via calendar-sync; no rotating next-sale watch unless dark.
  if (!hasAlwaysOn && !hasRealDatedCalendar && rootUrl && !rollingRoot) {
    reasons.push('static_root_no_dated_calendar');
    return {
      class: 'traditional_static',
      // dark static houses still need occasional discovery of a first catalogue date/url
      needsNextSaleWatch: true,
      reasons,
      signals,
    };
  }

  // 7) Unknown leftovers — opportunistic low-rate watch (caller budgets)
  reasons.push('unclassified');
  return {
    class: 'unknown',
    needsNextSaleWatch: true,
    reasons,
    signals,
  };
}

/**
 * Convenience reducer over many houses.
 * @param {ClassifyInput[]} inputs
 */
export function summariseDiscoveryClasses(inputs = []) {
  const out = {
    total: 0,
    byClass: {},
    needsWatch: 0,
    noWatch: 0,
  };
  for (const input of inputs) {
    const r = classifyHouseForDiscovery(input);
    out.total += 1;
    out.byClass[r.class] = (out.byClass[r.class] || 0) + 1;
    if (r.needsNextSaleWatch) out.needsWatch += 1;
    else out.noWatch += 1;
  }
  return out;
}
