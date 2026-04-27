// lib/pipeline/quality-regression.js — Per-house, per-field coverage regression detection
//
// COVERAGE_FIX_PLAN.md rollout #4 (alert side). Stores the last N coverage
// snapshots per house in `house_skills.field_coverage_history` and fires
// `extractor_<field>_regression` alerts when the current scrape drops more
// than DROP_THRESHOLD_PCT below the previous one on any tracked field.
//
// Design choice: relative-to-previous, not blanket SLAs.
//   The plan suggested fixed thresholds (image ≥ 95%, UPRN ≥ 80%, etc.)
//   which would fire constantly for houses with structural gaps (Charles
//   Darrow image=17%, every house at 0% UPRN). Comparing to each house's
//   own previous scrape catches real regressions without false-positive
//   noise. See coverage-baseline.json for the data behind that decision.

const HISTORY_LIMIT = 5;          // ringbuffer depth — last N cycles per house
const DROP_THRESHOLD_PCT = 10;    // % point drop that triggers an alert
const MIN_LOTS_FOR_ALERT = 5;     // suppress on tiny batches where 1 missing lot warps the %

const TRACKED_FIELDS = [
  { key: 'image_pct',    alertType: 'extractor_image_regression',    label: 'image_url' },
  { key: 'price_pct',    alertType: 'extractor_price_regression',    label: 'price' },
  { key: 'postcode_pct', alertType: 'extractor_postcode_regression', label: 'postcode' },
  { key: 'uprn_pct',     alertType: 'extractor_uprn_regression',     label: 'uprn' },
  { key: 'epc_pct',      alertType: 'extractor_epc_regression',      label: 'epc_rating' },
];

/**
 * Pure regression detector. Compares a new coverage entry against the most
 * recent stored entry and returns the list of fields that regressed.
 *
 * @param {object|null} previous - previous coverage entry (or null if fresh house)
 * @param {object} current - this scrape's coverage entry
 * @returns {Array<{ alertType, label, previous_pct, current_pct, drop_pct }>}
 */
export function detectFieldRegressions(previous, current) {
  if (!previous || !current) return [];
  if (typeof current.total_lots !== 'number' || current.total_lots < MIN_LOTS_FOR_ALERT) return [];
  const out = [];
  for (const field of TRACKED_FIELDS) {
    const prev = previous[field.key];
    const curr = current[field.key];
    if (typeof prev !== 'number' || typeof curr !== 'number') continue;
    const drop = prev - curr;
    if (drop >= DROP_THRESHOLD_PCT) {
      out.push({
        alertType: field.alertType,
        label: field.label,
        previous_pct: prev,
        current_pct: curr,
        drop_pct: Math.round(drop * 10) / 10,
      });
    }
  }
  return out;
}

/**
 * Append a coverage entry into a history JSONB blob (ringbuffer of HISTORY_LIMIT).
 * Pure — caller persists the returned object.
 *
 * @param {object|null} existingHistory - { history: [{...}, ...] } or null
 * @param {object} entry - new coverage entry (must include scraped_at)
 * @returns {{ history: Array<object> }}
 */
export function appendCoverageHistory(existingHistory, entry) {
  const prev = (existingHistory && Array.isArray(existingHistory.history))
    ? existingHistory.history
    : [];
  const next = [...prev, entry].slice(-HISTORY_LIMIT);
  return { history: next };
}

/**
 * Read the most recent coverage entry from a history blob.
 * @param {object|null} history
 * @returns {object|null}
 */
export function latestCoverage(history) {
  if (!history || !Array.isArray(history.history) || history.history.length === 0) return null;
  return history.history[history.history.length - 1];
}

// Exported for tests + auditing.
export const _internals = { HISTORY_LIMIT, DROP_THRESHOLD_PCT, MIN_LOTS_FOR_ALERT, TRACKED_FIELDS };
