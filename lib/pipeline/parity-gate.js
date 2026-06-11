// ═══════════════════════════════════════════════════════════════
// lib/pipeline/parity-gate.js — Product-integrity parity gate.
//
// The product of this tool is clean, COMPLETE per-lot data — the
// information investors use to decide and to unearth opportunities. So a
// cheaper engine (Crawlee+Gemini) is only allowed to displace the
// incumbent (Firecrawl) for a house when it preserves the product, not
// merely the lot count. This gate is the enforcement of that ethos.
//
// It composes three existing measures (no rewrites):
//   • recall parity  — shouldDemote() (engine-router.js), STRICT, tol 0:
//                      the challenger must lose no lots vs the sentinel.
//   • product quality — validateBatch() (data-contract.js) batchQuality:
//                      per-lot field completeness must not drop.
//   • field regression — detectFieldRegressions() (quality-regression.js):
//                      no tracked field (image, price, …) may regress.
//
// promote = recall-parity AND quality-parity AND no-field-regression.
// Anything less keeps the incumbent. Pure: returns an auditable verdict,
// performs no I/O. The caller persists the verdict and acts on `promote`.
// ═══════════════════════════════════════════════════════════════

import { shouldDemote } from '../scraper/engine-router.js';
import { validateBatch } from '../harness/data-contract.js';
import { computeBatchCoverage } from '../quality/lot-quality.js';
import { detectFieldRegressions } from './quality-regression.js';

/**
 * @param {object} args
 * @param {{ lots: object[], recall: number|null }} args.incumbent  - Firecrawl result
 * @param {{ lots: object[], recall: number|null }} args.challenger - Crawlee+Gemini result
 * @param {string} args.house
 * @param {number} [args.minLots=5] - below this the incumbent has too little signal to judge
 * @returns {{ promote, reason, recallVerdict, qualityOk, noRegression, regressions,
 *             incBatchQuality, chBatchQuality, incRecall, chRecall, incLots, chLots }}
 */
export function evaluateParity({ incumbent, challenger, house, minLots = 5 } = {}) {
  const incLots = incumbent?.lots || [];
  const chLots = challenger?.lots || [];

  // 1. Recall parity (strict — the challenger must lose no lots).
  const recallVerdict = shouldDemote({
    incumbentRecall: incumbent?.recall,
    challengerRecall: challenger?.recall,
    incumbentLots: incLots.length,
    challengerLots: chLots.length,
    minLots,
    tolerance: 0,
  });

  // 2. Per-lot product completeness must not drop.
  const incBatch = validateBatch(incLots, house, {});
  const chBatch = validateBatch(chLots, house, {});
  const qualityOk = chBatch.batchQuality >= incBatch.batchQuality;

  // 3. No tracked field (image, price, …) may regress vs the incumbent.
  // computeBatchCoverage returns null on an empty batch; detectFieldRegressions
  // tolerates nulls and small batches (returns []), so this is safe either way.
  const incCov = computeBatchCoverage(incLots);
  const chCov = computeBatchCoverage(chLots);
  const regressions = detectFieldRegressions(incCov, chCov);
  const noRegression = regressions.length === 0;

  const promote = recallVerdict.demote && qualityOk && noRegression;

  const reason = promote
    ? 'product-parity-passed'
    : [
        recallVerdict.demote ? null : `recall:${recallVerdict.reason}`,
        qualityOk ? null : `quality:${chBatch.batchQuality}<${incBatch.batchQuality}`,
        noRegression ? null : `field-regression:${regressions.map(r => r.label).join(',')}`,
      ].filter(Boolean).join(' | ');

  return {
    promote,
    reason,
    recallVerdict,
    qualityOk,
    noRegression,
    regressions,
    incBatchQuality: incBatch.batchQuality,
    chBatchQuality: chBatch.batchQuality,
    incRecall: incumbent?.recall ?? null,
    chRecall: challenger?.recall ?? null,
    incLots: incLots.length,
    chLots: chLots.length,
  };
}
