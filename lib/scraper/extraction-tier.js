// ═══════════════════════════════════════════════════════════════
// lib/scraper/extraction-tier.js — per-house extraction-model tier policy.
//
// The Gemini/OpenRouter extractor runs Flash-Lite ('fast') for known houses
// and Pro ('capable') for unknown/PDF. Flash-Lite is the right default for
// cooperative, card-structured platform houses — but production telemetry
// (recall_diagnostic, 2026-06-12) showed a long tail of dense houses where
// it loses 30–40% of lots. Cost is a non-issue (extraction spend is single-
// digit dollars/month, and free strong models exist on OpenRouter), so the
// product ethos — recall is sacred — says: route the weak-recall houses to a
// stronger model, automatically, off the recall we already measure.
//
// This module is the pure decision core. State lives in
// house_skills.engine_stats._extraction (a rolling EWMA of extraction recall
// + the resolved tier), folded in alongside the engine-router stats — no new
// column, no parallel system. analysis.js reads getExtractionTier() before a
// Crawlee+Gemini run and records the outcome with recordExtractionRecall().
// ═══════════════════════════════════════════════════════════════

// Below this rolling recall a 'fast'-tier house is promoted to 'capable'.
const WEAK_RECALL = parseFloat(process.env.EXTRACTION_WEAK_RECALL || '0.70');
// A 'capable' house only drops back to 'fast' once rolling recall clears this
// (hysteresis), AND only when demotion is explicitly allowed — see ALLOW_DEMOTE.
const STRONG_RECALL = parseFloat(process.env.EXTRACTION_STRONG_RECALL || '0.90');
// Minimum recorded runs before the policy will move a house — one unlucky run
// on a volatile catalogue must not flip the tier.
const MIN_RUNS = parseInt(process.env.EXTRACTION_TIER_MIN_RUNS || '3');
// EWMA weight on the latest recall (0–1). Higher = more reactive.
const EWMA_ALPHA = parseFloat(process.env.EXTRACTION_RECALL_EWMA_ALPHA || '0.4');
// Auto-demotion is OFF by default: a high recall measured AT 'capable' does not
// prove 'fast' would also hold, so demoting risks re-dropping lots (recall is
// sacred). Promotion is sticky-up; reset via engine_locked / a fresh A/B / by
// clearing engine_stats._extraction. Opt in to hysteresis demotion if desired.
const ALLOW_DEMOTE = /^(1|true|yes)$/i.test(process.env.EXTRACTION_TIER_ALLOW_DEMOTE || '');

/**
 * Pure tier decision from a rolling recall summary.
 * @param {{ewma:number|null, runs:number, currentTier:string}} state
 * @returns {'fast'|'capable'}
 */
export function decideExtractionTier({ ewma, runs, currentTier } = {}) {
  const tier = currentTier === 'capable' ? 'capable' : 'fast';
  if (ewma == null || runs < MIN_RUNS) return tier; // not enough evidence — hold
  if (tier === 'fast' && ewma < WEAK_RECALL) return 'capable'; // weak house → stronger model
  if (tier === 'capable' && ALLOW_DEMOTE && ewma >= STRONG_RECALL) return 'fast'; // recovered
  return tier;
}

/**
 * Fold one extraction run's recall into the rolling _extraction record and
 * re-resolve the tier. A null recall (no sentinel for this house) leaves the
 * record untouched — we only steer houses we can actually measure.
 *
 * @param {object|null} ext - prior engine_stats._extraction (or null)
 * @param {number|null} recall - this run's recall (0–1) or null
 * @param {{at?:string|null}} [opts]
 * @returns {{ewma:number, runs:number, lastRecall:number, tier:string, changedAt:string|null}}
 */
export function recordExtractionRecall(ext, recall, { at = null } = {}) {
  const prev = ext || { ewma: null, runs: 0, lastRecall: null, tier: 'fast', changedAt: null };
  if (recall == null || Number.isNaN(recall)) return prev; // no signal — unchanged
  const ewma = prev.ewma == null ? recall : (EWMA_ALPHA * recall + (1 - EWMA_ALPHA) * prev.ewma);
  const runs = (prev.runs || 0) + 1;
  const tier = decideExtractionTier({ ewma, runs, currentTier: prev.tier });
  return {
    ewma: Math.round(ewma * 1000) / 1000,
    runs,
    lastRecall: recall,
    tier,
    changedAt: tier !== (prev.tier || 'fast') ? (at || new Date().toISOString()) : (prev.changedAt || null),
  };
}

/**
 * The tier the extractor should use for this house RIGHT NOW, derived from
 * accumulated history. Unknown houses are always 'capable' (no history to
 * trust); known houses default 'fast' unless the policy promoted them.
 * @param {object|null} engineSkill - the house_skills row
 * @param {string} house
 * @returns {'fast'|'capable'}
 */
export function getExtractionTier(engineSkill, house) {
  if (house === 'unknown') return 'capable';
  const t = engineSkill?.engine_stats?._extraction?.tier;
  return t === 'capable' ? 'capable' : 'fast';
}

export const _thresholds = { WEAK_RECALL, STRONG_RECALL, MIN_RUNS, EWMA_ALPHA, ALLOW_DEMOTE };
