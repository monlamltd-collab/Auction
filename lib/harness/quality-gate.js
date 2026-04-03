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
  const currentLots = batch?.lots?.length || 0;
  const cachedLots = currentCache?.total_lots || 0;
  const batchQuality = batch?.batchQuality || 0;
  const verdict = regression?.verdict || 'healthy';

  // Rule 1: Regression verdict is 'regression' AND existing cache has >3x the lots → reject
  if (verdict === 'regression' && currentCache && cachedLots > 0 && cachedLots > currentLots * 3) {
    const reason = `Regression detected: ${currentLots} lots vs cached ${cachedLots} (${regression.reasons?.join('; ')})`;
    _fireGateAlert(slug, 'reject', reason);
    return { decision: 'reject', reason };
  }

  // Rule 2: Batch quality below 0.45 → reject
  if (batchQuality < 0.45 && currentLots > 0) {
    const reason = `Batch quality too low: ${batchQuality.toFixed(2)} (threshold: 0.45)`;
    _fireGateAlert(slug, 'reject', reason);
    return { decision: 'reject', reason };
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

function _fireGateAlert(slug, decision, reason) {
  // Fire-and-forget — don't await to avoid blocking
  fireAlert({
    type: `quality_gate_${decision}`,
    severity: decision === 'reject' ? 'warning' : 'info',
    house: slug,
    message: reason,
  }).catch(() => {});
}
