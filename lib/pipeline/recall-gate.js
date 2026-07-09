// ═══════════════════════════════════════════════════════════════
// lib/pipeline/recall-gate.js — enforcement of THE 100% COMMANDMENT.
//
// The moat is Coverage: every available lot for every house must reach the UI.
// A scrape that lands below the house's recall sentinel has LEFT LOTS BEHIND —
// that is a BUG, not a "good enough". This module turns a per-scrape recall
// figure into a queryable, severity-graded coverage-gap verdict so a house at
// 79% is surfaced as loudly as a crashed feature, not tolerated silently.
//
// It does NOT soften the target. The only tolerance is a small band that
// absorbs sentinel MEASUREMENT noise (±1 lot on tiny catalogues, an image the
// renderer lazy-loaded a beat late) — the aim is still 100%.
// ═══════════════════════════════════════════════════════════════

// Below this, a gap is a major coverage failure (error). Between here and the
// tolerance band it's a real but smaller gap (warning). Env-tunable; the
// defaults match the historical CRAWLEE_RECALL_FLOOR so nothing regresses.
export const RECALL_ERROR_FLOOR = parseFloat(process.env.RECALL_GATE_ERROR_FLOOR || '0.85');
// Sentinel-noise absorber ONLY — recall at/above (1 - tolerance) counts as parity.
export const RECALL_TOLERANCE = parseFloat(process.env.RECALL_GATE_TOLERANCE || '0.02');

/**
 * Grade a scrape's recall against the 100% commandment.
 * @param {object} a
 * @param {number|null} a.recall        - extractedLots / sentinelLots, or null if no sentinel
 * @param {number} a.lots               - lots actually captured
 * @param {number} a.sentinelLots       - lots the sentinel advertises
 * @param {number} [a.tolerance]
 * @param {number} [a.errorFloor]
 * @returns {{ measurable:boolean, atParity:boolean, missing:number,
 *             severity:'info'|'warning'|'error', isGap:boolean }}
 */
export function recallGateVerdict({ recall, lots = 0, sentinelLots = 0, tolerance = RECALL_TOLERANCE, errorFloor = RECALL_ERROR_FLOOR } = {}) {
  if (recall == null) {
    // No sentinel → recall unmeasurable. Not a pass and not a gap; the fleet
    // should still aim to give every house a sentinel (separate work).
    return { measurable: false, atParity: false, missing: 0, severity: 'info', isGap: false };
  }
  const atParity = recall >= (1 - tolerance);
  const missing = Math.max(0, Math.round(sentinelLots) - Math.round(lots));
  const severity = atParity ? 'info' : (recall < errorFloor ? 'error' : 'warning');
  return { measurable: true, atParity, missing, severity, isGap: !atParity };
}

/**
 * Build the fireAlert payload for a recall verdict. At parity → the existing
 * low-noise 'recall_diagnostic' (info). Below parity → 'recall_below_100', an
 * error/warning a human (or a dashboard query on pipeline_alerts) can act on.
 */
export function recallGateAlert({ house, recall, lots = 0, sentinelLots = 0, reason = '', engine = 'crawlee', recognised = 0, dormant = false, extra = {} }) {
  const v = recallGateVerdict({ recall, lots, sentinelLots });
  // A dormant house (between-auctions / retired) legitimately shows only ended
  // lots, so a low-recall reading there is EXPECTED — the 100% commandment is
  // about live lots, and a dormant house has none to leave behind. Never raise
  // it as a coverage-gap alarm: keep it an informational recall_diagnostic.
  const isGap = v.isGap && !dormant;
  const severity = isGap ? v.severity : 'info';
  const pct = recall == null ? 'n/a' : Math.round(recall * 100) + '%';
  return {
    type: isGap ? 'recall_below_100' : 'recall_diagnostic',
    severity,
    house,
    message: (isGap
      ? `COVERAGE GAP — ${house} recall ${pct}: ${lots}/${sentinelLots}, ${v.missing} lot(s) left behind vs sentinel (${reason || engine}). The 100% commandment: below-parity is a bug to close, not a partial success.`
      : `${engine} recall ${pct}: ${lots}/${sentinelLots}${reason ? ` (${reason})` : ''}`) + (dormant ? ' [dormant]' : ''),
    meta: { engine, recall, lots, sentinelLots, missing: v.missing, recognised, reason, gate: '100pct', dormant, ...extra },
  };
}
