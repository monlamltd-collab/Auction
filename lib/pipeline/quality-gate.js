// lib/pipeline/quality-gate.js — Lot batch quality validation (price, URL, coverage, regression)

/**
 * Validate a batch of lots before caching/persisting.
 * Pure function — no external dependencies.
 *
 * @param {Array} lots - Array of lot objects
 * @param {string} house - House slug
 * @param {object|null} prevCached - Previous cache entry { total_lots }
 * @param {Array|null} prevLots - Previous lots array
 * @returns {{ lots: Array, alerts: string[], rejected: boolean }}
 */
export function qualityGate(lots, house, prevCached, prevLots) {
  const alerts = [];
  const before = lots.length;

  // ── Guard 1: Price sanity — strip lots with implausible prices ──
  lots = lots.filter(lot => {
    if (!lot.price) return true; // no price is OK (many lots don't list one)
    if (lot.price < 1000) {
      alerts.push(`Stripped lot with implausible price £${lot.price}: "${(lot.address || '').substring(0, 50)}"`);
      return false;
    }
    if (lot.price > 50000000) {
      alerts.push(`Stripped lot with implausible price £${lot.price.toLocaleString()}: "${(lot.address || '').substring(0, 50)}"`);
      return false;
    }
    return true;
  });

  // ── Guard 2: URL validation — strip lots without a usable URL ──
  lots = lots.filter(lot => {
    if (!lot.url) return true; // missing URL is tolerated (Gemini-extracted lots often lack URLs)
    // Strip lots with javascript: or clearly broken URLs
    if (/^javascript:|^#|^mailto:|^void/i.test(lot.url)) {
      lot.url = ''; // clear the junk URL but keep the lot
    }
    return true;
  });

  // ── Guard 3: Minimum quality gate — reject batch if too sparse ──
  // At least 30% of lots must have either a price OR an image to be worth caching.
  // This catches catastrophic extraction failures where we get addresses only.
  if (lots.length >= 5) {
    const hasSubstance = lots.filter(l => l.price || l.imageUrl).length;
    const coverage = hasSubstance / lots.length;
    if (coverage < 0.3) {
      alerts.push(`QUALITY GATE FAIL: only ${Math.round(coverage * 100)}% of lots have a price or image (${hasSubstance}/${lots.length}). Batch rejected.`);
      return { lots, alerts, rejected: true };
    }
  }

  // ── Guard 4: Regression detection — compare against previous cache ──
  if (prevCached && prevCached.total_lots > 5) {
    // Lot count regression (already in autoAnalyseOne, now universal)
    if (lots.length < prevCached.total_lots * 0.5) {
      alerts.push(`LOT COUNT REGRESSION: ${prevCached.total_lots} → ${lots.length} (${Math.round(lots.length / prevCached.total_lots * 100)}%). Batch rejected.`);
      return { lots, alerts, rejected: true };
    }

    // Image coverage regression — if previous had >50% images and new has <20%, flag it
    if (Array.isArray(prevLots) && prevLots.length > 0) {
      const prevImgCount = prevLots.filter(l => l.imageUrl || l.image_url).length;
      const prevImgPct = prevImgCount / prevCached.total_lots;
      const newImgCount = lots.filter(l => l.imageUrl).length;
      const newImgPct = lots.length > 0 ? newImgCount / lots.length : 0;
      if (prevImgPct > 0.5 && newImgPct < 0.2) {
        alerts.push(`IMAGE COVERAGE REGRESSION: ${Math.round(prevImgPct * 100)}% → ${Math.round(newImgPct * 100)}% (${prevImgCount} → ${newImgCount})`);
        // Don't reject — images can be backfilled, but log the alert
      }
    }
  }

  const stripped = before - lots.length;
  if (stripped > 0) {
    alerts.push(`Cleaned ${stripped} lots with invalid data (${before} → ${lots.length})`);
  }

  // Log all alerts
  for (const a of alerts) {
    console.log(`[QUALITY] ${house}: ${a}`);
  }

  return { lots, alerts, rejected: false };
}
