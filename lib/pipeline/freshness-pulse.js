// lib/pipeline/freshness-pulse.js — Hourly catalogue-change pulse.
//
// Phase 2 of the freshness workstream. The daily 03:00 pass caps staleness at
// ~24h; the attempt floor (scheduling.js) caps it at 48h — but neither gives
// "new lots visible within ~an hour of release". This pulse does: every hour
// (outside the overnight batch window) it runs autoAnalyseOne on each eligible
// house. autoAnalyseOne's own Crawlee page-1 hash gate (lib/analysis.js —
// md5(page-1 html) vs house_skills.catalogue_page1_hash) makes each call a
// cheap probe: unchanged catalogue → render + hash + 'same', no extraction,
// no AI spend; changed catalogue → the full extract IS the targeted rescrape,
// so detection and remediation are one step and can never disagree on hashing.
//
// Deliberately NOT built on homepage-watch: that layer is Firecrawl-based and
// currently returns 'unreachable' for 168/218 houses (FC decommissioned), and
// a homepage is a weak proxy for "the catalogue changed" anyway. The catalogue
// page itself is the signal.
//
// Cost model: a 'same' pulse is one local Chromium render (no credits, no AI).
// A 'changed' pulse runs the full extract that the 03:00 pass would have run
// anyway — the pulse only moves it earlier, so marginal AI cost ≈ 0. Excluded
// from pulsing: Firecrawl-preferring houses (stealth/credit cost — e.g.
// symondsandsampson burns ~5 credits/scrape) and PDF catalogues (no page-1
// hash gate on that path → every pulse would be a full AI extract).
//
// All I/O is injected via `deps` so the module is unit-testable and free of
// circular imports (server.js wires the real autoAnalyseOne etc.).

const HOUR_MS = 60 * 60 * 1000;

// Re-pulse spacing per house. 50min (not 60) so an hourly tick with jitter
// never skips a house that is genuinely due.
const PULSE_MIN_INTERVAL_MS = 50 * 60 * 1000;

// Flap damper: if a pulse already triggered a FULL extract for a house
// recently, don't re-pulse it yet. Protects against raw-HTML-volatile pages
// (rotating banners, embedded timestamps) hash-churning into an extract every
// hour. A genuinely twice-updated catalogue is re-detected after the damp
// window — and the daily pass remains the backstop.
export function flapDampMs() {
  const h = parseFloat(process.env.FRESHNESS_PULSE_FLAP_HOURS || '');
  return (Number.isFinite(h) && h > 0 ? h : 3) * HOUR_MS;
}

// Houses never pulsed, beyond the automatic engine/PDF filters. Seeded with
// the known stealth house; extend via env (comma-separated slugs).
const BUILTIN_SKIP = ['symondsandsampson'];
export function pulseSkipSlugs() {
  const env = (process.env.FRESHNESS_PULSE_SKIP || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return new Set([...BUILTIN_SKIP, ...env]);
}

function pulseConcurrency() {
  const n = parseInt(process.env.FRESHNESS_PULSE_CONCURRENCY || '', 10);
  // Default 2 — below the Crawlee pool's maxConcurrency 3, leaving a render
  // slot free for on-demand user analyses.
  return Number.isFinite(n) && n > 0 ? n : 2;
}

function houseTimeoutMs() {
  return parseInt(process.env.CRAWLEE_HOUSE_TIMEOUT_MS || '600000');
}

/**
 * Pure candidate selection (exported for tests). One auction per house
 * (soonest date), minus every house the pulse must not touch. Returns the
 * kept candidates plus per-reason skip counts so the pulse log states what
 * was excluded and why — no silent truncation.
 *
 * @param {{
 *   auctions: Array<{house?: string, url: string, date?: string}>,
 *   skillBySlug: Map<string, object>,        // house_skills rows
 *   retiredSlugs: Set<string>,
 *   skipSlugs: Set<string>,
 *   detectHouse: (url: string) => string,
 *   isCircuitOpen: (slug: string) => boolean,
 *   isPdfUrl: (url: string) => boolean,
 *   state: { lastPulsedAt: Map<string,number>, lastChangedAt: Map<string,number> },
 *   nowMs: number,
 *   minIntervalMs?: number,
 *   dampMs?: number,
 * }} p
 * @returns {{ candidates: Array<{slug: string, url: string, engineSkill: object|null}>, skips: Record<string, number> }}
 */
export function selectPulseCandidates({
  auctions, skillBySlug, retiredSlugs, skipSlugs, detectHouse, isCircuitOpen,
  isPdfUrl, state, nowMs, minIntervalMs = PULSE_MIN_INTERVAL_MS, dampMs = flapDampMs(),
}) {
  // One auction per slug — soonest date wins (mirrors the daily pass's
  // per-house lookahead ordering; the pulse only needs the current catalogue).
  const bySlug = new Map();
  for (const a of auctions) {
    const slug = detectHouse(a.url);
    if (!slug) continue;
    const prev = bySlug.get(slug);
    if (!prev || String(a.date || '9999') < String(prev.date || '9999')) bySlug.set(slug, a);
  }

  const skips = {
    retired: 0, dormant: 0, circuit_open: 0, engine_firecrawl: 0,
    pdf: 0, skip_list: 0, recently_pulsed: 0, flap_damped: 0,
  };
  const candidates = [];
  for (const [slug, auction] of bySlug) {
    if (retiredSlugs.has(slug)) { skips.retired++; continue; }
    if (skipSlugs.has(slug)) { skips.skip_list++; continue; }
    const skill = skillBySlug.get(slug) || null;
    if (skill?.dormant === true) { skips.dormant++; continue; }
    // Open circuit → broken house; hourly probes would only churn error
    // outcomes. Left to the circuit's own 24h trial (#150) and the daily pass.
    // NB isCircuitOpen (post-#150) may promote a >24h circuit to half-open as
    // a side effect — that IS the designed trial, so letting it through here
    // is correct, not accidental.
    if (isCircuitOpen(slug)) { skips.circuit_open++; continue; }
    // Firecrawl-preferring houses cost credits per scrape — daily pass only.
    const engineLocked = skill?.engine_locked || null;
    const preferred = skill?.preferred_engine || null;
    if (engineLocked === 'firecrawl' || (!engineLocked && preferred === 'firecrawl')) {
      skips.engine_firecrawl++; continue;
    }
    // PDF catalogues bypass the page-1 hash gate → every pulse would be a
    // full AI extract. Daily pass only.
    if (isPdfUrl(auction.url)) { skips.pdf++; continue; }
    const pulsedAt = state.lastPulsedAt.get(slug) || 0;
    if (nowMs - pulsedAt < minIntervalMs) { skips.recently_pulsed++; continue; }
    const changedAt = state.lastChangedAt.get(slug) || 0;
    if (nowMs - changedAt < dampMs) { skips.flap_damped++; continue; }
    candidates.push({ slug, url: auction.url, engineSkill: skill });
  }
  return { candidates, skips };
}

// Module-level default state: survives across ticks within one worker
// process; a restart simply re-pulses everything once, which is harmless.
const _defaultState = {
  running: false,
  lastPulsedAt: new Map(),
  lastChangedAt: new Map(),
};

function createSemaphore(max) {
  let active = 0;
  const queue = [];
  return {
    async acquire() {
      if (active < max) { active++; return; }
      await new Promise(resolve => queue.push(resolve));
      active++;
    },
    release() {
      active--;
      if (queue.length > 0) queue.shift()();
    },
  };
}

/**
 * Run one freshness pulse. All I/O injected:
 * @param {{
 *   getCalendarAuctions: () => Promise<Array>,
 *   autoAnalyseOne: (url: string, opts: object) => Promise<any>,
 *   isAutoAnalysisRunning: () => boolean,
 *   isCircuitOpen: (slug: string) => boolean,
 *   isPdfUrl: (url: string) => boolean,
 *   detectHouse: (url: string) => string,
 *   retiredSlugs: Set<string>,
 *   fetchSkills: () => Promise<Array<object>>,   // house_skills rows
 * }} deps
 * @param {{ state?: object, concurrency?: number, timeoutMs?: number, nowMs?: number }} [opts]
 * @returns {Promise<{skipped: string|null, candidates: number, same: number, changed: number, errors: number, skips: object}>}
 */
export async function runFreshnessPulse(deps, opts = {}) {
  const state = opts.state || _defaultState;
  if (process.env.FRESHNESS_PULSE_DISABLED === 'true') {
    return { skipped: 'disabled', candidates: 0, same: 0, changed: 0, errors: 0, skips: {} };
  }
  // Never pulse under the daily full pass — a house must not be scraped by
  // both concurrently — and never overlap a previous still-running pulse.
  if (deps.isAutoAnalysisRunning()) {
    console.log('PULSE: skipped — full auto-analysis pass is running');
    return { skipped: 'full_pass_running', candidates: 0, same: 0, changed: 0, errors: 0, skips: {} };
  }
  if (state.running) {
    console.log('PULSE: skipped — previous pulse still running');
    return { skipped: 'pulse_running', candidates: 0, same: 0, changed: 0, errors: 0, skips: {} };
  }
  state.running = true;
  const started = Date.now();
  try {
    const nowMs = opts.nowMs || Date.now();
    const [auctions, skillRows] = await Promise.all([
      deps.getCalendarAuctions(),
      deps.fetchSkills(),
    ]);
    const skillBySlug = new Map((skillRows || []).map(r => [r.slug, r]));
    const { candidates, skips } = selectPulseCandidates({
      auctions: auctions || [],
      skillBySlug,
      retiredSlugs: deps.retiredSlugs,
      skipSlugs: pulseSkipSlugs(),
      detectHouse: deps.detectHouse,
      isCircuitOpen: deps.isCircuitOpen,
      isPdfUrl: deps.isPdfUrl,
      state,
      nowMs,
    });

    let same = 0, changed = 0, errors = 0;
    const timeoutMs = opts.timeoutMs || houseTimeoutMs();
    const sem = createSemaphore(opts.concurrency || pulseConcurrency());
    await Promise.allSettled(candidates.map(async (c) => {
      await sem.acquire();
      try {
        // Stamp BEFORE the attempt so an error path can't re-pulse the same
        // house within the window.
        state.lastPulsedAt.set(c.slug, nowMs);
        let outcome = null;
        await Promise.race([
          deps.autoAnalyseOne(c.url, {
            engineSkill: c.engineSkill,
            onOutcome: (o) => { outcome = o; },
          }),
          new Promise((_, reject) => setTimeout(() =>
            reject(new Error(`pulse house timeout (${Math.round(timeoutMs / 1000)}s)`)), timeoutMs)),
        ]);
        if (outcome === 'changed') {
          changed++;
          state.lastChangedAt.set(c.slug, nowMs);
          console.log(`PULSE: ${c.slug} — catalogue CHANGED, full extract ran`);
        } else if (outcome === 'same') {
          same++;
        } else {
          errors++;
        }
      } catch (e) {
        errors++;
        console.warn(`PULSE: ${c.slug} failed: ${e.message}`);
      } finally {
        sem.release();
      }
    }));

    const skipSummary = Object.entries(skips).filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`).join(' ') || 'none';
    console.log(`PULSE: done in ${Math.round((Date.now() - started) / 1000)}s — ${candidates.length} pulsed (${changed} changed, ${same} same, ${errors} errors); skips: ${skipSummary}`);
    return { skipped: null, candidates: candidates.length, same, changed, errors, skips };
  } finally {
    state.running = false;
  }
}
