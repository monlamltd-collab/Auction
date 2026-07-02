/**
 * Adaptive scrape scheduling on Firecrawl changeStatus signal.
 *
 * Pure helpers (no I/O) for computing when a house is next eligible for a
 * full extract, plus a thin Supabase writer to persist the outcome. The
 * scheduler tick in server.js consults next_scrape_at before invoking
 * autoAnalyseOne; recordScrapeOutcome runs after a scrape lands.
 *
 * See migrations/2026-05-12-adaptive-scheduling.sql for the columns.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Backoff curve. Index = consecutive_same_count (clamped at MAX_BACKOFF_IDX).
// Tuned to: re-check volatile catalogues today (6h); cap at weekly (168h)
// so we still catch a stale-looking house at least once a week even when
// its hash hasn't changed.
const BACKOFF_HOURS = [6, 12, 24, 48, 96, 168];
const MAX_BACKOFF_IDX = BACKOFF_HOURS.length - 1;

// Hard freshness floor: never let a house go more than 7 days without a
// full extract regardless of how stable changeTracking thinks it is.
const FRESHNESS_FLOOR_MS = 7 * DAY_MS;

// On error, retry in 1h. Keeps consecutive_same_count untouched (preserve
// the prior cadence) — a transient Firecrawl glitch shouldn't reset the
// adaptive backoff for a known-stable house.
const ERROR_RETRY_MS = 1 * HOUR_MS;

// On 'changed', reset to the volatile interval. Counter resets to 0 too.
const CHANGED_INTERVAL_MS = BACKOFF_HOURS[0] * HOUR_MS;

/**
 * Map consecutive 'same' count to next-interval milliseconds.
 * Clamps to the weekly cap once count ≥ MAX_BACKOFF_IDX.
 */
export function intervalForCount(consecutiveSame) {
  const i = Math.max(0, Math.min(consecutiveSame ?? 0, MAX_BACKOFF_IDX));
  return BACKOFF_HOURS[i] * HOUR_MS;
}

/**
 * Compute the new house_skills state after a scrape.
 *
 * @param {object} prev - prior row fields: { consecutive_same_count, last_full_extract_at }
 * @param {'same'|'changed'|'error'} result
 * @param {Date|string} [now=new Date()]
 * @returns {{
 *   consecutive_same_count: number,
 *   last_probe_at: string,
 *   last_probe_result: 'same'|'changed'|'error',
 *   last_full_extract_at: string,
 *   next_scrape_at: string
 * }}
 */
export function computeScheduleUpdate(prev, result, now = new Date()) {
  const nowDate = typeof now === 'string' ? new Date(now) : now;
  const nowMs = nowDate.getTime();
  const prevCount = (prev && Number.isInteger(prev.consecutive_same_count))
    ? prev.consecutive_same_count
    : 0;
  const prevFullExtractAt = prev?.last_full_extract_at
    ? new Date(prev.last_full_extract_at)
    : null;

  let nextCount;
  let didFullExtract;
  let intervalMs;

  if (result === 'same') {
    nextCount = prevCount + 1;
    didFullExtract = false;
    intervalMs = intervalForCount(nextCount);
  } else if (result === 'changed') {
    nextCount = 0;
    didFullExtract = true;
    intervalMs = CHANGED_INTERVAL_MS;
  } else if (result === 'error') {
    nextCount = prevCount;
    didFullExtract = false;
    intervalMs = ERROR_RETRY_MS;
  } else {
    throw new Error(`computeScheduleUpdate: unknown result '${result}'`);
  }

  // Compute candidate next_scrape_at, then clamp to the freshness floor.
  let nextScrapeAtMs = nowMs + intervalMs;
  if (prevFullExtractAt) {
    const floorMs = prevFullExtractAt.getTime() + FRESHNESS_FLOOR_MS;
    if (floorMs < nextScrapeAtMs) nextScrapeAtMs = floorMs;
  }

  return {
    consecutive_same_count: nextCount,
    last_probe_at: nowDate.toISOString(),
    last_probe_result: result,
    // last_full_extract_at only advances on 'changed'; 'same' and 'error'
    // preserve the prior value (or stay null if first probe).
    last_full_extract_at: didFullExtract
      ? nowDate.toISOString()
      : (prevFullExtractAt ? prevFullExtractAt.toISOString() : null),
    next_scrape_at: new Date(nextScrapeAtMs).toISOString(),
  };
}

/**
 * Decide whether a scheduled scrape should fire now.
 * Used by scheduleTick before invoking autoAnalyseOne.
 */
export function isEligibleNow(houseSkill, now = new Date()) {
  if (!houseSkill || !houseSkill.next_scrape_at) return true;
  const nextMs = new Date(houseSkill.next_scrape_at).getTime();
  const nowMs = (typeof now === 'string' ? new Date(now) : now).getTime();
  return nowMs >= nextMs;
}

// ── Attempt floor ──────────────────────────────────────────────────
// FRESHNESS_FLOOR_MS above only clamps next_scrape_at inside
// computeScheduleUpdate — which runs AFTER a scrape attempt. A house that is
// never attempted (circuit-skipped, adaptive-deferred, dropped by a future
// bug) never reaches it, so that floor cannot cap staleness on its own —
// the same reachability flaw as the circuit breaker's auto-recovery
// (house-health.js, fixed 2026-06-28). This helper is the queue-side
// complement: _doAutoAnalyseAll boosts any house whose last ATTEMPT
// (last_probe_at, stamped on every outcome incl. 'error') is older than the
// floor, overriding the adaptive next_scrape_at gate. Attempt-keyed on
// purpose: broken houses stamp last_probe_at when tried, so the floor can't
// hot-loop on them — cost stays bounded by the circuit's 24h trial.

const DEFAULT_ATTEMPT_FLOOR_HOURS = 48;

export function attemptFloorHours() {
  const env = parseInt(process.env.FRESHNESS_FLOOR_HOURS || '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_ATTEMPT_FLOOR_HOURS;
}

/**
 * True when a house's last scrape ATTEMPT is older than the freshness floor
 * (default 48h, env FRESHNESS_FLOOR_HOURS). Null skill → false (nothing to
 * measure; the never-scraped boost in _doAutoAnalyseAll covers new houses).
 * Null last_probe_at on an existing row → true (row exists but never
 * attempted — exactly the state the floor exists to catch).
 */
export function isPastAttemptFloor(houseSkill, now = new Date(), floorHours = attemptFloorHours()) {
  if (!houseSkill) return false;
  if (!houseSkill.last_probe_at) return true;
  const nowMs = (typeof now === 'string' ? new Date(now) : now).getTime();
  const probeMs = new Date(houseSkill.last_probe_at).getTime();
  return nowMs - probeMs > floorHours * HOUR_MS;
}

/**
 * Pure set-diff for the silent-drop guardrail: which active houses never made
 * it into the scrape queue at all this pass. Deliberate exclusions (retired,
 * dormant) are removed; whatever remains was dropped by an UNINTENDED gate —
 * catalogue_ready=false (getCalendarAuctions filters .eq true), a missing
 * calendar row, or any future exclusion bug. Observing the assembled queue at
 * this single choke point catches every such mechanism, known or not.
 *
 * @param {{ rootSlugs: Iterable<string>, retiredSlugs: Set<string>,
 *           dormantSlugs: Set<string>, scheduledSlugs: Set<string> }} p
 * @returns {string[]} slugs silently excluded, sorted
 */
export function computeUnscheduledHouses({ rootSlugs, retiredSlugs, dormantSlugs, scheduledSlugs }) {
  const out = [];
  for (const slug of rootSlugs) {
    if (retiredSlugs.has(slug)) continue;
    if (dormantSlugs.has(slug)) continue;
    if (scheduledSlugs.has(slug)) continue;
    out.push(slug);
  }
  return out.sort();
}

/**
 * Persist a scrape outcome to house_skills. Thin wrapper around supabase.
 * Returns the patch that was applied (for logging).
 */
export async function recordScrapeOutcome(supabase, slug, result, now = new Date()) {
  if (!supabase || !slug) return null;
  const { data: prevRow } = await supabase
    .from('house_skills')
    .select('consecutive_same_count, last_full_extract_at')
    .eq('slug', slug)
    .maybeSingle();
  const patch = computeScheduleUpdate(prevRow || {}, result, now);
  const { error } = await supabase
    .from('house_skills')
    .update(patch)
    .eq('slug', slug);
  if (error) {
    console.warn(`scheduling: failed to record outcome for ${slug}: ${error.message}`);
    return null;
  }
  return patch;
}

/**
 * Reset the adaptive backoff for a slug. Called from /api/admin/heal so a
 * healing attempt starts from the volatile 6h cadence rather than whatever
 * the broken house had drifted to.
 */
export async function resetAdaptiveBackoff(supabase, slug) {
  if (!supabase || !slug) return;
  await supabase
    .from('house_skills')
    .update({
      consecutive_same_count: 0,
      next_scrape_at: null,
    })
    .eq('slug', slug);
}

// Exported for tests.
export const _internals = { BACKOFF_HOURS, FRESHNESS_FLOOR_MS, CHANGED_INTERVAL_MS, ERROR_RETRY_MS };
