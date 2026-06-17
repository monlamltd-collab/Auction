// lib/pipeline/liveness.js — per-house liveness / silent-failure predicate.
//
// Pure, dependency-free on purpose: shared by the persistence layer
// (house-skills.js), the admin QA report, and the freshness digest without
// dragging the Supabase client into the digest's pure formatter.
//
// The ghost-lot blind spot (2026-06-17): a house's DB lots persist from prior
// runs, so total-lots-in-DB and house_skills.status both keep reading "healthy"
// long after the crawler has died. The honest liveness question is per-RUN: did
// the MOST RECENT scheduled run extract anything?

/**
 * A "silent scraper failure": the house still has a feed (lots persisted from
 * prior runs → average_lot_count / last_lot_count > 0) AND its most recent
 * scheduled run extracted zero (last_probe_result === 'error', the outcome
 * stamped when a scrape returns 0 lots or throws before persist).
 *
 * Deliberately NOT flagged:
 *   - a brand-new / genuinely empty house with no feed returning 0 lots
 *   - a house never run since last_extracted_count landed (last_probe_result null)
 *   - a changeTracking skip ('same') — the page is confirmed unchanged, i.e. live
 *
 * @param {{average_lot_count?:number,last_lot_count?:number,last_probe_result?:string}} skill
 * @returns {boolean}
 */
export function isSilentScraperFailure(skill) {
  if (!skill) return false;
  const hasFeed = (skill.average_lot_count || 0) > 0 || (skill.last_lot_count || 0) > 0;
  if (!hasFeed) return false;
  return skill.last_probe_result === 'error';
}
