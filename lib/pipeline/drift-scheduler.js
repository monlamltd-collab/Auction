// lib/pipeline/drift-scheduler.js — Pure helpers for round-robin drift sampling.
//
// The status-drift scheduler in server.js used to pick whichever house had
// the most upcoming lots each tick. That meant one or two high-volume houses
// monopolised sampling while others were never checked. These helpers let
// the scheduler pick the house whose drift data is stalest instead, falling
// back to alphabetical order for deterministic tie-breaking.
//
// Kept pure (no DB / no side effects) so it can be unit-tested without a
// Supabase connection.

/**
 * Pick the next house to sample for status drift.
 *
 * Preference order:
 *   1. Houses never checked (missing / null entry in lastCheckedMap).
 *   2. Houses with the oldest `last_drift_checked_at`.
 *   3. Alphabetical slug (stable tie-break).
 *
 * @param {object} houseLotMap    - { houseSlug: [lots...] } — candidates this tick.
 * @param {object} lastCheckedMap - { houseSlug: ISO timestamp string | null }.
 * @returns {string|null} slug of the house to sample, or null if none available.
 */
export function pickNextHouseForDrift(houseLotMap, lastCheckedMap = {}) {
  const candidates = Object.keys(houseLotMap || {});
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const ra = lastCheckedMap[a];
    const rb = lastCheckedMap[b];
    const ta = ra ? Date.parse(ra) : 0;
    const tb = rb ? Date.parse(rb) : 0;
    if (ta !== tb) return ta - tb;           // oldest / never-checked first
    return a.localeCompare(b);                // alphabetical tie-break
  });

  return candidates[0];
}
