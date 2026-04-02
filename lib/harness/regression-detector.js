// ═══════════════════════════════════════════════════════════════
// REGRESSION DETECTOR — Statistical change detection per-house
// ═══════════════════════════════════════════════════════════════

/**
 * Detect regressions by comparing current batch against historical baseline.
 *
 * @param {string} slug - House slug
 * @param {{ lots: object[], batchQuality: number, fieldCoverage: object }} currentBatch - Validated batch from data-contract
 * @param {{ averageLotCount?: number, imageCoverage?: number, fieldCoverage?: object, rollingLotCounts?: number[], rollingImageCoverage?: number[] }} baseline - From house_skills
 * @returns {{ verdict: string, reasons: string[], severity: string }}
 */
export function detectRegression(slug, currentBatch, baseline = {}) {
  const reasons = [];
  let worstSeverity = 'info';

  const currentLotCount = currentBatch.lots?.length || 0;
  const avgLotCount = baseline.averageLotCount || 0;
  const prevImageCoverage = baseline.imageCoverage || 0;

  // ── Lot count regression ──
  if (avgLotCount > 5) {
    const ratio = currentLotCount / avgLotCount;
    if (ratio < 0.5) {
      reasons.push(`Lot count drop ${Math.round((1 - ratio) * 100)}%: ${currentLotCount} vs avg ${avgLotCount}`);
      worstSeverity = 'error';
    } else if (ratio < 0.8) {
      reasons.push(`Lot count decline ${Math.round((1 - ratio) * 100)}%: ${currentLotCount} vs avg ${avgLotCount}`);
      if (worstSeverity !== 'error') worstSeverity = 'warning';
    }
  }

  // ── Image coverage regression ──
  if (prevImageCoverage > 30) {
    const currentImageCoverage = currentBatch.fieldCoverage?.imageUrl || 0;
    const drop = prevImageCoverage - currentImageCoverage;
    if (drop > 30) {
      reasons.push(`Image coverage drop ${drop}pp: ${currentImageCoverage}% vs baseline ${prevImageCoverage}%`);
      if (worstSeverity !== 'error') worstSeverity = 'warning';
    }
  }

  // ── Field coverage regression ──
  if (baseline.fieldCoverage && currentBatch.fieldCoverage) {
    for (const [field, prevPct] of Object.entries(baseline.fieldCoverage)) {
      if (prevPct < 30) continue; // don't flag fields that were already low
      const currentPct = currentBatch.fieldCoverage[field] || 0;
      const drop = prevPct - currentPct;
      if (drop > 40) {
        reasons.push(`Field '${field}' coverage drop ${drop}pp: ${currentPct}% vs ${prevPct}%`);
        if (worstSeverity !== 'error') worstSeverity = 'warning';
      }
    }
  }

  // ── New zeros: field was always present, now missing ──
  if (baseline.fieldCoverage && currentBatch.fieldCoverage) {
    for (const [field, prevPct] of Object.entries(baseline.fieldCoverage)) {
      if (prevPct > 80 && (currentBatch.fieldCoverage[field] || 0) === 0) {
        reasons.push(`Field '${field}' completely lost (was ${prevPct}% coverage)`);
        if (worstSeverity !== 'error') worstSeverity = 'warning';
      }
    }
  }

  // Determine verdict
  let verdict = 'healthy';
  if (worstSeverity === 'error') verdict = 'regression';
  else if (worstSeverity === 'warning') verdict = 'degraded';

  return { verdict, reasons, severity: worstSeverity };
}
