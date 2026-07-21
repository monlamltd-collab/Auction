// ═══════════════════════════════════════════════════════════════
// HOUSE HEALTH — Per-house health tracking + circuit breakers
// ═══════════════════════════════════════════════════════════════

let _supabase = null;

// In-memory health state: slug → HealthSnapshot
const _healthMap = new Map();

const CIRCUIT_THRESHOLDS = {
  closed: 40,     // health > 40 → normal scraping
  halfOpen: 20,   // health 20-40 → probe only
  // health < 20 → open (skip entirely)
};
const AUTO_RECOVERY_MS = 24 * 60 * 60 * 1000; // 24h before open → half-open

/**
 * Initialize house health from Supabase house_skills table.
 */
export async function initHouseHealth(supabase) {
  _supabase = supabase;
  if (!_supabase) return;

  try {
    const { data: skills } = await _supabase
      .from('house_skills')
      .select('slug, status, last_lot_count, average_lot_count, image_coverage, health_score, circuit_state, consecutive_failures, last_success_at, rolling_lot_counts, rolling_image_coverage, circuit_opened_at');

    if (skills) {
      for (const skill of skills) {
        _healthMap.set(skill.slug, {
          health: skill.health_score ?? 100,
          status: skill.status || 'healthy',
          circuitBreaker: skill.circuit_state || 'closed',
          consecutiveFailures: skill.consecutive_failures || 0,
          lastSuccessAt: skill.last_success_at ? new Date(skill.last_success_at) : null,
          averageLotCount: skill.average_lot_count || 0,
          imageCoverage: skill.image_coverage || 0,
          rollingLotCounts: skill.rolling_lot_counts || [],
          rollingImageCoverage: skill.rolling_image_coverage || [],
          circuitOpenedAt: skill.circuit_opened_at ? new Date(skill.circuit_opened_at) : null,
        });
      }
    }
    console.log(`HOUSE-HEALTH: Loaded health for ${_healthMap.size} houses`);
  } catch (e) {
    console.warn('HOUSE-HEALTH: Failed to load baselines:', e.message);
  }
}

/**
 * Update health for a house after a scrape attempt.
 * @param {string} slug
 * @param {{ lots?: { lots: object[], batchQuality: number }, regression?: { verdict: string }, gate?: { decision: string }, extractionMethod?: string }} scrapeResult
 * @returns {{ health: number, status: string, circuitBreaker: string }}
 */
export function updateHealth(slug, scrapeResult = {}) {
  const current = _healthMap.get(slug) || {
    health: 100, status: 'healthy', circuitBreaker: 'closed',
    consecutiveFailures: 0, lastSuccessAt: null,
    averageLotCount: 0, imageCoverage: 0,
    rollingLotCounts: [], rollingImageCoverage: [],
    circuitOpenedAt: null,
  };

  const lotCount = scrapeResult.lots?.lots?.length || 0;
  const batchQuality = scrapeResult.lots?.batchQuality || 0;
  const regressionVerdict = scrapeResult.regression?.verdict || 'healthy';
  const gateDecision = scrapeResult.gate?.decision || 'cache';
  const extractionMethod = scrapeResult.extractionMethod || 'unknown';

  // ── AI-OUTAGE GATE: a scrape that COULDN'T run is not a house failure. ──
  // When the AI stack goes quota-dead, every AI-dependent house returns 0 lots
  // at once. Counting that as a consecutive failure trips the circuit breaker
  // and takes healthy houses OUT of the scrape rotation fleet-wide: on
  // 2026-07-15 it opened 46 circuits in one event, and after a manual SQL reset
  // 40 of them re-tripped within 4 days. The zero says nothing about the house —
  // only about our own extractor — so it is a NON-EVENT here: health, circuit
  // state and the failure counter are all left exactly as they were.
  //
  // This cannot mask real breakage: a house with a deterministic recogniser
  // still extracts during an AI outage, so it never reaches this branch with 0
  // lots; and when the AI is UP, a zero is attributed to the house as before.
  // Logged (never silent) so an outage-suppressed zero stays observable.
  if (scrapeResult.aiUnavailable && lotCount === 0) {
    console.log(`HOUSE-HEALTH: ${slug} — 0 lots while the AI stack was unavailable; not counted as a failure (health ${current.health}, circuit ${current.circuitBreaker} unchanged)`);
    return {
      health: current.health,
      status: current.status,
      circuitBreaker: current.circuitBreaker,
      skipped: 'ai_unavailable',
    };
  }

  // ── Calculate health score (0-100) ──
  let health = 50; // base

  // Lot count vs baseline: ±30 points
  if (current.averageLotCount > 5) {
    const ratio = lotCount / current.averageLotCount;
    if (ratio >= 0.8) health += 30;
    else if (ratio >= 0.5) health += 15;
    else if (ratio >= 0.2) health -= 10;
    else health -= 30;
  } else if (lotCount > 0) {
    health += 20; // no baseline yet, having lots is good
  }

  // Image coverage: ±20 points
  const imgCoverage = scrapeResult.lots?.fieldCoverage?.imageUrl || 0;
  if (imgCoverage >= 70) health += 20;
  else if (imgCoverage >= 40) health += 10;
  else if (imgCoverage >= 10) health += 0;
  else health -= 10;

  // Extraction method: DOM=+20, Gemini=+10, failed=0
  if (extractionMethod === 'dom') health += 20;
  else if (extractionMethod === 'gemini' || extractionMethod === 'ai') health += 10;

  // Consecutive failures: -15 per (max -45)
  // cache_warn counts as 0.5 failure — after 4 consecutive warns (=2.0),
  // the manager's rule-based healing (consecutiveFailures >= 2) triggers automatically
  if (lotCount === 0 || gateDecision === 'reject') {
    current.consecutiveFailures++;
  } else if (gateDecision === 'cache_warn') {
    current.consecutiveFailures += 0.5;
  } else {
    current.consecutiveFailures = 0;
    current.lastSuccessAt = new Date();
  }
  health -= Math.min(current.consecutiveFailures * 15, 45);

  // Days since last success: -5 per day (max -25)
  if (current.lastSuccessAt) {
    const daysSince = (Date.now() - current.lastSuccessAt.getTime()) / (24 * 60 * 60 * 1000);
    health -= Math.min(Math.floor(daysSince) * 5, 25);
  }

  // Clamp
  health = Math.max(0, Math.min(100, Math.round(health)));

  // ── Update rolling averages (keep last 5) ──
  current.rollingLotCounts = [...current.rollingLotCounts, lotCount].slice(-5);
  current.rollingImageCoverage = [...current.rollingImageCoverage, imgCoverage].slice(-5);

  // Update averages
  if (lotCount > 0) {
    current.averageLotCount = Math.round(
      current.rollingLotCounts.filter(c => c > 0).reduce((a, b) => a + b, 0) /
      Math.max(1, current.rollingLotCounts.filter(c => c > 0).length)
    );
    current.imageCoverage = Math.round(
      current.rollingImageCoverage.reduce((a, b) => a + b, 0) / current.rollingImageCoverage.length
    );
  }

  // ── Circuit breaker logic ──
  let circuitBreaker = 'closed';
  if (health <= CIRCUIT_THRESHOLDS.halfOpen) {
    circuitBreaker = 'open';
    if (!current.circuitOpenedAt) current.circuitOpenedAt = new Date();
  } else if (health <= CIRCUIT_THRESHOLDS.closed) {
    circuitBreaker = 'half-open';
    current.circuitOpenedAt = null;
  } else {
    circuitBreaker = 'closed';
    current.circuitOpenedAt = null;
  }

  // Auto-recovery: after 24h in open → move to half-open for a probe
  if (circuitBreaker === 'open' && current.circuitOpenedAt) {
    const elapsed = Date.now() - current.circuitOpenedAt.getTime();
    if (elapsed >= AUTO_RECOVERY_MS) {
      circuitBreaker = 'half-open';
    }
  }

  // Determine status
  let status = 'healthy';
  if (health < 20) status = 'broken';
  else if (health < 50) status = 'degraded';

  // Store
  current.health = health;
  current.status = status;
  current.circuitBreaker = circuitBreaker;
  _healthMap.set(slug, current);

  // Persist async (fire-and-forget)
  _persistHealth(slug, current);

  return { health, status, circuitBreaker };
}

/**
 * Get current health snapshot for a house.
 */
export function getHealth(slug) {
  return _healthMap.get(slug) || {
    health: 100, status: 'unknown', circuitBreaker: 'closed',
    consecutiveFailures: 0, averageLotCount: 0, imageCoverage: 0,
  };
}

/**
 * Get all house health snapshots.
 */
export function getAllHealth() {
  const result = {};
  for (const [slug, h] of _healthMap) {
    result[slug] = {
      health: h.health,
      status: h.status,
      circuitBreaker: h.circuitBreaker,
      consecutiveFailures: h.consecutiveFailures,
      averageLotCount: h.averageLotCount,
      imageCoverage: h.imageCoverage,
      lastSuccessAt: h.lastSuccessAt?.toISOString() || null,
    };
  }
  return result;
}

/**
 * Check if the circuit breaker is open (i.e. the cron should skip scraping).
 *
 * This is the ONLY gate the cron scrape consults (lib/analysis.js), so it also
 * owns circuit AUTO-RECOVERY. updateHealth() computes the 24h open→half-open
 * promotion, but it only runs AFTER a scrape attempt — and an open circuit is
 * skipped BEFORE scraping, so for a skipped house updateHealth() never runs and
 * the promotion never fires. That deadlocked ~117 houses (open since the
 * 2026-06-13 Crawlee cutover): skipped forever, recoverable only by a manual
 * /api/admin/rescrape (ignoreCircuit). We therefore apply the same 24h promotion
 * HERE, at the skip decision: a circuit open >= AUTO_RECOVERY_MS is granted one
 * half-open trial scrape, and its clock is reset NOW so a failed trial backs off
 * another 24h instead of retrying every pass. The trial's updateHealth() then
 * closes the circuit on success or re-opens it on failure; truly-dead houses
 * re-trip and are taken out of rotation by the dormancy sweep.
 */
export function isCircuitOpen(slug) {
  const h = _healthMap.get(slug);
  if (!h || h.circuitBreaker !== 'open') return false;

  // A missing circuitOpenedAt (legacy rows) reads as elapsed=now → grants a
  // trial rather than deadlocking permanently.
  const openedMs = h.circuitOpenedAt ? new Date(h.circuitOpenedAt).getTime() : 0;
  if (Date.now() - openedMs >= AUTO_RECOVERY_MS) {
    h.circuitBreaker = 'half-open'; // allow one trial scrape this pass
    h.circuitOpenedAt = new Date();  // reset backoff window (24h from now)
    _healthMap.set(slug, h);
    _persistHealth(slug, h);         // survive a restart mid-backoff
    return false;
  }
  return true;
}

/**
 * Manually set circuit state (for manager).
 */
export function setCircuitState(slug, state) {
  const h = _healthMap.get(slug);
  if (h) {
    h.circuitBreaker = state;
    if (state === 'open') h.circuitOpenedAt = new Date();
    else h.circuitOpenedAt = null;
    _healthMap.set(slug, h);
    _persistHealth(slug, h);
  }
}

/**
 * Get baseline data for regression detection.
 */
export function getBaseline(slug) {
  const h = _healthMap.get(slug);
  if (!h) return {};
  return {
    averageLotCount: h.averageLotCount,
    imageCoverage: h.imageCoverage,
    rollingLotCounts: h.rollingLotCounts,
    rollingImageCoverage: h.rollingImageCoverage,
  };
}

async function _persistHealth(slug, h) {
  if (!_supabase) return;
  try {
    await _supabase.from('house_skills')
      .update({
        health_score: h.health,
        circuit_state: h.circuitBreaker,
        consecutive_failures: h.consecutiveFailures,
        last_success_at: h.lastSuccessAt?.toISOString() || null,
        rolling_lot_counts: h.rollingLotCounts,
        rolling_image_coverage: h.rollingImageCoverage,
        status: h.status,
        circuit_opened_at: h.circuitOpenedAt?.toISOString() || null,
      })
      .eq('slug', slug);
  } catch (e) {
    console.warn(`HOUSE-HEALTH: Failed to persist health for ${slug}:`, e.message);
  }
}
