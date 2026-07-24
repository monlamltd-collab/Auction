/**
 * Sale-format + lifecycle helpers for search API/UI.
 *
 * Two orthogonal dimensions:
 *  - sale_format: traditional | mmoa | unknown
 *  - lifecycle:   live | passed_in_play | finished
 *
 * Calendar always_on / 2099-12-31 sentinel = Modern Method / continuous
 * catalogues. Never treat the sentinel as a real auction day.
 *
 * Spec: AuctionBrain-Landing/docs/lot-lifecycle-filters.md
 */

export const SENTINEL_AUCTION_DATE = '2099-12-31';
export const SENTINEL_CUTOFF = '2098-01-01'; // anything after is treated as placeholder
export const REAL_DATE_BEFORE = '2090-01-01';

/** @param {string|Date|null|undefined} d */
export function toDateString(d) {
  if (d == null || d === '') return null;
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** @param {string|null|undefined} d */
export function isSentinelDate(d) {
  const s = toDateString(d);
  return !!s && s > SENTINEL_CUTOFF;
}

/** @param {string|null|undefined} d */
export function isRealAuctionDate(d) {
  const s = toDateString(d);
  return !!s && s < REAL_DATE_BEFORE;
}

/**
 * Null out calendar/lot placeholders. Idempotent.
 * @param {string|null|undefined} d
 */
export function effectiveAuctionDate(d) {
  const s = toDateString(d);
  if (!s || isSentinelDate(s)) return null;
  return s;
}

/**
 * @param {object} input
 * @param {string|null} [input.auctionDate] raw or effective
 * @param {string|null} [input.calendarStatus] auction_calendar.status
 * @param {string|null} [input.calendarType]
 * @param {string|null} [input.lotStatus]
 */
export function deriveSaleFormat(input = {}) {
  const calStatus = String(input.calendarStatus || '').toLowerCase();
  const calType = String(input.calendarType || '').toLowerCase();
  if (calStatus === 'always_on') return 'mmoa';
  if (/continuous|rolling|modern.?method|timed.?online|online.?only/.test(calType)) return 'mmoa';
  if (isSentinelDate(input.auctionDate)) return 'mmoa';

  if (isRealAuctionDate(input.auctionDate)) return 'traditional';

  // Null/unknown date: if still available and recently seen it's usually
  // continuous stock; without calendar status stay conservative as unknown
  // so servers can still expose it under Live via mmoa OR unknown chips.
  if (input.lotStatus === 'available' && input.assumeAvailableNullIsMmoa) return 'mmoa';
  if (!toDateString(input.auctionDate)) return 'unknown';
  return 'unknown';
}

/**
 * @param {object} lot
 * @param {string} today YYYY-MM-DD
 * @returns {'live'|'passed_in_play'|'finished'|'other'}
 */
export function deriveLifecycle(lot, today) {
  const status = lot.status || 'available';
  if (status === 'sold' || status === 'withdrawn') return 'finished';

  const format = lot._saleFormat || lot.saleFormat || 'unknown';
  const date = effectiveAuctionDate(lot._auctionDate ?? lot.auctionDate ?? lot.auction_date);

  if (format === 'mmoa') {
    // Continuous — inventory time, not gavel day
    if (status === 'available' || status === 'stc') return 'live';
    if (status === 'unsold') return 'passed_in_play'; // rare for mmoa but keep searchable
    return 'other';
  }

  // Traditional (and unknown with a real date)
  if (date) {
    if (date >= today) {
      if (status === 'available' || status === 'stc') return 'live';
      if (status === 'unsold') return 'live'; // still listed pre/during day? keep discoverable
      return 'other';
    }
    // date passed
    if (status === 'available' || status === 'unsold' || status === 'stc') return 'passed_in_play';
    return 'finished';
  }

  // No usable date
  if (status === 'available' || status === 'stc') return 'live'; // undated continuous-like
  if (status === 'unsold') return 'passed_in_play';
  return 'other';
}

/**
 * Attach _saleFormat + _lifecycle onto API lot objects (mutates).
 * @param {object[]} lots
 * @param {object} opts
 * @param {Map<string, {status?:string, type?:string, date?:string}>} [opts.calendarByUrl]
 * @param {string} [opts.today]
 */
export function enrichLotsWithSaleFormat(lots, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const calMap = opts.calendarByUrl || new Map();

  for (const lot of lots) {
    const catUrl = lot._sourceUrl || lot.catalogue_url || lot.catalogueUrl || '';
    // calendars keyed by normalised URL in the caller
    const cal = calMap.get(catUrl) || calMap.get(lot._sourceUrlNorm) || null;

    const rawDate = lot._auctionDate ?? lot.auction_date ?? null;
    if (isSentinelDate(rawDate)) {
      lot._auctionDate = null;
      lot._sentinelDateCleared = true;
    }

    lot._saleFormat = deriveSaleFormat({
      auctionDate: rawDate,
      calendarStatus: cal?.status,
      calendarType: cal?.type,
      lotStatus: lot.status,
      // Collapse undated available stock into mmoa for product chips when
      // calendar couldn't be joined — matches ~always_on catalogue reality.
      assumeAvailableNullIsMmoa: !cal && (lot.status === 'available' || !lot.status) && !isRealAuctionDate(rawDate),
    });

    lot._lifecycle = deriveLifecycle(lot, today);
    lot._auctionPassed = !!(
      isRealAuctionDate(lot._auctionDate) && lot._auctionDate < today
    );
  }
  return lots;
}

/**
 * Human labels for cards / filters.
 */
export function saleFormatLabel(format) {
  if (format === 'mmoa') return 'Modern Method';
  if (format === 'traditional') return 'Auction date';
  return null;
}

export function lifecyclePill(lot, today) {
  const life = lot._lifecycle || deriveLifecycle(lot, today || new Date().toISOString().slice(0, 10));
  const format = lot._saleFormat || 'unknown';
  const status = lot.status || 'available';

  if (life === 'finished') {
    if (status === 'withdrawn') return { text: 'Withdrawn', kind: 'finished' };
    return { text: format === 'mmoa' ? 'Sold · Modern Method' : 'Sold', kind: 'finished' };
  }
  if (life === 'passed_in_play') {
    if (status === 'unsold') return { text: 'Unsold', kind: 'passed' };
    if (status === 'stc') return { text: 'Passed · under offer', kind: 'passed' };
    return { text: 'Passed · still listed', kind: 'passed' };
  }
  if (life === 'live') {
    if (format === 'mmoa') return { text: 'Modern Method · Available', kind: 'mmoa' };
    if (status === 'stc') return { text: 'Under offer', kind: 'live' };
    return { text: 'Upcoming', kind: 'live' };
  }
  return null;
}
