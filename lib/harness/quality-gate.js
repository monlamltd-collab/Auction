// ═══════════════════════════════════════════════════════════════
// QUALITY GATE — Batch-level gate before caching
// ═══════════════════════════════════════════════════════════════

import { fireAlert } from './alert-router.js';

/**
 * Evaluate whether a scrape result should be cached or rejected.
 *
 * @param {string} slug - House slug
 * @param {{ lots: object[], batchQuality: number, fieldCoverage: object }} batch - Validated batch from data-contract
 * @param {{ verdict: string, reasons: string[], severity: string }} regression - From regression-detector
 * @param {{ total_lots?: number, lots?: object[] } | null} currentCache - Existing cached data
 * @returns {{ decision: string, reason: string }}
 *   decision: 'cache' | 'cache_warn' | 'reject' | 'cache_partial'
 */
export function evaluateGate(slug, batch, regression, currentCache) {
  const lots = batch?.lots ?? [];
  const currentLots = lots.length;
  const cachedLots = currentCache?.total_lots || 0;
  const batchQuality = batch?.batchQuality || 0;
  const fieldCoverage = batch?.fieldCoverage ?? {};
  const verdict = regression?.verdict || 'healthy';

  // Rule 0a: Minimum lot count — warn if below 3, but accept (a house with 1 lot genuinely has 1 lot)
  if (currentLots < 1) {
    const reason = `No lots found`;
    _fireGateAlert(slug, 'reject', reason);
    return { pass: false, decision: 'reject', reason, lotCount: currentLots, minimum: 1 };
  }
  if (currentLots < 3) {
    const reason = `Low lot count: ${currentLots} lot(s) — proceeding with warning`;
    _fireGateAlert(slug, 'cache_warn', reason);
    return { decision: 'cache_warn', reason, lotCount: currentLots, minimum: 1 };
  }

  // Rule 0b: Core field coverage — warn if low, but don't reject. Missing prices/addresses
  // are an extraction quality issue, not a reason to discard real lots. Enrichment can backfill.
  const addressCoverage = fieldCoverage.address ?? 0;
  const priceCoverage = fieldCoverage.price ?? 0;
  if (addressCoverage < 60 || priceCoverage < 60) {
    const reason = `Core field coverage low: address=${addressCoverage}%, price=${priceCoverage}% — proceeding with warning`;
    _fireGateAlert(slug, 'cache_warn', reason);
    // Don't return early — continue to other checks but record the warning
  }

  // Rule 1: Regression verdict — warn but keep the data, flag the regression
  if (verdict === 'regression' && currentCache && cachedLots > 0 && cachedLots > currentLots * 3) {
    const reason = `Regression detected: ${currentLots} lots vs cached ${cachedLots} (${regression.reasons?.join('; ')}) — proceeding with warning`;
    _fireGateAlert(slug, 'cache_warn', reason);
    return { decision: 'cache_warn', reason };
  }

  // Rule 2: Batch quality below 0.45 — warn instead of reject
  if (batchQuality < 0.45 && currentLots > 0) {
    const reason = `Low batch quality: ${batchQuality.toFixed(2)} (threshold: 0.45) — proceeding with warning`;
    _fireGateAlert(slug, 'cache_warn', reason);
    return { decision: 'cache_warn', reason };
  }

  // Rule 3: Batch quality 0.45-0.60 → cache with warning
  if (batchQuality < 0.60 && batchQuality >= 0.45) {
    const reason = `Marginal batch quality: ${batchQuality.toFixed(2)}`;
    _fireGateAlert(slug, 'cache_warn', reason);
    return { decision: 'cache_warn', reason };
  }

  // Rule 4: Degraded regression → cache with warning
  if (verdict === 'degraded') {
    const reason = `Degraded: ${regression.reasons?.join('; ')}`;
    _fireGateAlert(slug, 'cache_warn', reason);
    return { decision: 'cache_warn', reason };
  }

  // Rule 5: No cache exists yet — always cache (first run)
  if (!currentCache || cachedLots === 0) {
    return { decision: 'cache', reason: 'First cache or empty previous cache' };
  }

  // Default: cache normally
  return { decision: 'cache', reason: 'Quality acceptable' };
}

// ═══════════════════════════════════════════════════════════════
// ENDED-LOT RATIO GATE
// ═══════════════════════════════════════════════════════════════
// If >80% of extracted lots have a terminal status (sold, unsold,
// withdrawn, stc, "Auction Ended"), the catalogue is stale and
// shouldn't pollute the directory with dead lots.
//
// Returns { flagged: boolean, ratio: number, endedCount: number, total: number }

const ENDED_STATUSES = /^(?:sold|unsold|stc|withdrawn)$/i;
const ENDED_BULLET_RE = /\bAuction\s*Ended\b|\bSOLD\b|\bUNSOLD\b|\bWITHDRAWN\b|\bSTC\b|\bSALE.?AGREED\b|\bNO.?SALE\b|\bPASSED\b|\bEXCHANGED\b/i;

export function checkEndedLotRatio(slug, lots, { threshold = 0.8 } = {}) {
  if (!lots || lots.length < 5) return { flagged: false, ratio: 0, endedCount: 0, total: lots?.length || 0 };

  let endedCount = 0;
  for (const lot of lots) {
    // Check status field
    if (lot.status && ENDED_STATUSES.test(lot.status)) { endedCount++; continue; }
    // Check bullets for "Auction Ended" etc
    const bulletStr = (lot.bullets || []).join(' ');
    if (ENDED_BULLET_RE.test(bulletStr)) { endedCount++; continue; }
  }

  const ratio = endedCount / lots.length;
  const flagged = ratio > threshold;

  if (flagged) {
    _fireGateAlert(slug, 'ended_lot_ratio', `${Math.round(ratio * 100)}% of lots (${endedCount}/${lots.length}) have ended/sold status — catalogue likely stale`);
  }

  return { flagged, ratio: Math.round(ratio * 100) / 100, endedCount, total: lots.length };
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR DATE SANITY
// ═══════════════════════════════════════════════════════════════
// Flags two anomalies:
// 1. Single date applied to >100 lots (suspicious bulk date assignment)
// 2. Non-always_on house whose lots span multiple distinct auction dates
//    (suggests stale lots from previous auctions leaking through)
//
// Returns { flagged: boolean, flags: string[], dateCounts: object }

export function checkCalendarDateSanity(slug, lots, { isAlwaysOn = false, maxLotsPerDate = 100 } = {}) {
  if (!lots || lots.length === 0) return { flagged: false, flags: [], dateCounts: {} };

  // Count lots per auction date
  const dateCounts = {};
  for (const lot of lots) {
    const d = lot.auctionDate || lot._auctionDate || lot.auction_date || null;
    const key = d ? String(d).slice(0, 10) : '_no_date';
    dateCounts[key] = (dateCounts[key] || 0) + 1;
  }

  const flags = [];
  const datesWithLots = Object.keys(dateCounts).filter(k => k !== '_no_date');

  // Flag 1: Single date applied to >100 lots
  for (const [date, count] of Object.entries(dateCounts)) {
    if (date !== '_no_date' && count > maxLotsPerDate) {
      flags.push(`Date ${date} applied to ${count} lots (max ${maxLotsPerDate})`);
    }
  }

  // Flag 2: Non-always_on house spans multiple auction dates
  if (!isAlwaysOn && datesWithLots.length > 1) {
    flags.push(`Non-always_on house has lots spanning ${datesWithLots.length} distinct dates: ${datesWithLots.sort().join(', ')}`);
  }

  const flagged = flags.length > 0;
  if (flagged) {
    _fireGateAlert(slug, 'calendar_date_sanity', flags.join('; '));
  }

  return { flagged, flags, dateCounts };
}

function _fireGateAlert(slug, decision, reason) {
  // Fire-and-forget — don't await to avoid blocking
  fireAlert({
    type: `quality_gate_${decision}`,
    severity: decision === 'reject' ? 'warning' : 'info',
    house: slug,
    message: reason,
  }).catch(() => {});
}
