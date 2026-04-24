// lib/pipeline/scorer.js — Pure scoring function
// No external deps, no network calls, no enrichment.
// Enrichment is now in ./enrichment.js (EnrichmentService).

import { scoreEvent } from './types.js';

/**
 * Score an array of raw lots using the provided analyseLot function.
 * Pure: no side effects beyond the scoring computation.
 *
 * @param {object[]} rawLots - Lots from extraction
 * @param {Function} analyseLot - Scoring function (from lib/analysis.js)
 * @param {string} [house] - House slug (for event emission)
 * @returns {{ lots: object[], avgScore: number, errors: object[] }}
 */
export function scoreLots(rawLots, analyseLot, house) {
  const startMs = Date.now();
  const scored = [];
  const errors = [];

  for (let i = 0; i < rawLots.length; i++) {
    try {
      const lot = analyseLot(rawLots[i]);
      scored.push(lot);
    } catch (err) {
      errors.push({ lotIndex: i, lotNumber: rawLots[i]?.lot, error: err.message });
      if (house) {
        scoreEvent(house, {
          event: 'score_lot_error',
          lotIndex: i,
          lotNumber: rawLots[i]?.lot,
          error: err.message,
        });
      }
      // Include the raw lot with score 0 rather than dropping it
      scored.push({ ...rawLots[i], score: 0, opps: [], risks: [] });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const avgScore = scored.length > 0
    ? Math.round((scored.reduce((s, l) => s + (l.score || 0), 0) / scored.length) * 10) / 10
    : 0;

  if (house) {
    scoreEvent(house, {
      event: 'score_complete',
      lotCount: scored.length,
      avgScore,
      scoringErrors: errors.length,
      durationMs: Date.now() - startMs,
    });
  }

  return { lots: scored, avgScore, errors };
}

// Legacy default export for backward compat with old initModularScorer pattern
let _deps = null;

export function initModularScorer(deps) {
  _deps = deps;
}

/**
 * Legacy score() function — wraps scoreLots + enrichment for backward compat.
 * New code should use scoreLots() + EnrichmentService separately.
 */
export async function score(rawLots, house, url) {
  const { lots: scored, avgScore, errors } = scoreLots(rawLots, _deps.analyseLot, house);

  // Legacy enrichment path retained for score() callers — new code should use EnrichmentService
  const enrichmentResults = { epc: 0, flood: 0, images: 0, fundability: 0 };

  try {
    await _deps.enrichLots(scored, house, url);
    enrichmentResults.epc = scored.filter(l => l.epcRating).length;
    enrichmentResults.flood = scored.filter(l => l.floodRisk != null).length;
  } catch {}

  try { await _deps.enrichLotsFromLotPages(scored); } catch {}

  const missingImages = scored.filter(l => !l.imageUrl).length;
  if (missingImages > 0) {
    try {
      if (_deps.FIRECRAWL_API_KEY && !_deps.isFcCreditExhausted()) {
        await _deps.backfillImagesWithFirecrawl(url, scored, house);
      }
      const stillMissing = scored.filter(l => !l.imageUrl).length;
      if (stillMissing > 0 && _deps.puppeteer) {
        await _deps.backfillImagesWithPuppeteer(url, scored, house);
      }
      enrichmentResults.images = scored.filter(l => l.imageUrl).length;
    } catch {}
  }

  try {
    await _deps.enrichLotsWithFundability(scored);
    enrichmentResults.fundability = scored.filter(l => l.fundability).length;
  } catch {}

  const fieldCoverage = {};
  for (const f of ['address', 'price', 'imageUrl', 'url', 'beds', 'tenure', 'epcRating']) {
    const filled = scored.filter(l => l[f] != null && l[f] !== '' && l[f] !== 0).length;
    fieldCoverage[f] = Math.round((filled / scored.length) * 100);
  }

  return { lots: scored, avgScore, fieldCoverage, enrichmentResults };
}
