// ═══════════════════════════════════════════════════════════════
// lib/scraper/engine-router.js — Best-engine-first decision logic.
//
// The pipeline selects the best scraping engine *per house* by a scored
// trade-off (recall → reliability → cost), conditioned on the house's
// nature. This module is the pure decision core: no I/O, no DB, no
// network — every signal is passed in, every decision is returned as a
// plain object with a `reason`. The caller (rendering / extraction
// stage) supplies the signals and acts on the verdict.
//
// Design + rationale: docs/ENGINE-ROUTER.md
//
// The router is a hybrid:
//   1. Deterministic overrides — nature facts that don't change
//      (API available, PDF, markdown-recogniser dependency, bot
//      protection). These always win.
//   2. Learned policy — house_skills.preferred_engine, seeded by the
//      onboarding profiler and refined by the adaptive feedback loop.
//   3. Default — Crawlee, the only managed scraping engine. Firecrawl is
//      CF-bypass-only (proxy:'stealth', symondsandsampson scraper) and is
//      never selected by this router for scraping/extraction.
//
// Demotion to a cheaper engine uses STRICT RECALL PARITY: a challenger
// only displaces the incumbent when its recall is proven *equal or
// better* against the house's recall sentinel. Cost never beats recall.
// ═══════════════════════════════════════════════════════════════

// Engine identifiers — the primary catalogue-extraction strategy for a house.
// In-tier rendering fallback (firecrawl → puppeteer → http) still lives in
// rendering.js; the router decides the *primary* engine, not the fallback chain.
export const ENGINES = Object.freeze({
  API: 'api',               // structured JSON API consumer (Allsop)
  CRAWLEE: 'crawlee',       // Crawlee render + Gemini extract — the default scraper
  PDF_GEMINI: 'pdf-gemini', // PDF download → Gemini Pro extract
  FIRECRAWL: 'firecrawl',   // CF-bypass ONLY (proxy:'stealth'), reached via the
                            // symondsandsampson stealth scraper — NOT this router.
                            // Never selected here for scraping/extraction.
});

// Engines the adaptive tuner is allowed to choose between for a normal HTML
// catalogue. Crawlee is the only managed scraping engine now — Firecrawl was
// removed (it is CF-bypass-only). API / PDF are decided structurally, not learned.
export const SELECTABLE_ENGINES = Object.freeze([ENGINES.CRAWLEE]);

// Escalation ladder — when an engine under-recalls mid-run, climb to the next
// more capable engine. Crawlee is the top of what we run today; 'bright-data'
// is reserved for the future managed-unblocker tier (see docs). Firecrawl is
// NOT on the ladder — it is CF-bypass-only, not a scraping engine.
const ESCALATION_LADDER = Object.freeze({
  [ENGINES.CRAWLEE]: null, // top of the scraping ladder
});

// ═══════════════════════════════════════════════════════════════
// chooseEngine — the per-house verdict
// ═══════════════════════════════════════════════════════════════
//
// ctx (all signals injected — pure):
//   house              {string}  slug, for the reason string only
//   manualEngine       {string?} house_skills.engine_locked — wins if set
//   preferredEngine    {string?} house_skills.preferred_engine — learned policy
//   isApi              {boolean} rewriteUrl().isApi (Allsop)
//   isPdf              {boolean} isPdfUrl(catalogueUrl)
//   hasMarkdownRecogniser {boolean} HOUSE_OVERRIDES[house]?.recogniseFromMarkdown present
//   botProtected       {boolean} a challenge page / known anti-bot wall was detected
//   crawleeAvailable   {boolean} hasCrawlee()
//   firecrawlAvailable {boolean} budget.canUseFirecrawl()
//
// Returns { engine, reason }.
export function chooseEngine(ctx = {}) {
  const {
    manualEngine = null,
    preferredEngine = null,
    isApi = false,
    isPdf = false,
    botProtected = false,
    crawleeAvailable = false,
    // crawleeInstalled = the engine exists at all (hasCrawlee()), independent of
    // the allowlist. Used only for the zero-credit FAILOVER path: when Firecrawl
    // is exhausted, ANY house falls over to Crawlee rather than going unscraped
    // (Phase 3). Defaults to crawleeAvailable so callers that don't distinguish
    // keep their old behaviour. Proactive migration still uses crawleeAvailable.
    crawleeInstalled = crawleeAvailable,
    // crawleeIsDefault = CRAWLEE_DEFAULT=true: Crawlee is the MAIN engine for
    // every house without a structural override or learned/locked policy, with
    // Firecrawl as the fallback (the caller falls through to Firecrawl when a
    // Crawlee run yields 0 lots). This is the "promote Crawlee to main scraper"
    // switch — flip it off to revert to Firecrawl-first instantly.
    crawleeIsDefault = false,
    firecrawlAvailable = true,
  } = ctx;

  const avail = { crawleeAvailable, crawleeInstalled, firecrawlAvailable };

  // 1. Manual lock — operator escape hatch, always wins (even over structure).
  //    A lock is ABSOLUTE: if the locked engine can't run right now, degrade to
  //    the local puppeteer tier — never to another managed engine the operator
  //    explicitly didn't choose (e.g. a house locked to firecrawl because
  //    crawlee produced bad data must NOT fail over to crawlee on exhaustion).
  if (manualEngine) {
    if (manualEngine === ENGINES.FIRECRAWL && !firecrawlAvailable) {
      return { engine: 'puppeteer', reason: 'manual-lock+firecrawl-unavailable' };
    }
    if (manualEngine === ENGINES.CRAWLEE && !crawleeInstalled) {
      // Crawlee unavailable → local puppeteer tier, never Firecrawl (CF-bypass-only).
      return { engine: 'puppeteer', reason: 'manual-lock+crawlee-unavailable' };
    }
    return { engine: manualEngine, reason: 'manual-lock' };
  }

  // 2. Structured API consumer (Allsop) — never render, never extract.
  if (isApi) {
    return { engine: ENGINES.API, reason: 'structured-api' };
  }

  // 3. PDF catalogue — Gemini Pro, no browser engine applies.
  if (isPdf) {
    return { engine: ENGINES.PDF_GEMINI, reason: 'pdf-catalogue' };
  }

  // Note: markdown-recogniser houses are NO LONGER pinned to Firecrawl. The
  // Crawlee path is recogniser-aware (turndown HTML→markdown bridge, Phase 3),
  // so they follow normal policy and the parity gate decides migration.

  // 4. Bot-protected — Crawlee's fingerprint-suite hardening clears anti-bot-lite
  //    sites. Genuinely Cloudflare-walled houses (e.g. symondsandsampson) use the
  //    explicit stealth-Firecrawl scraper, routed by paginateAs BEFORE this router
  //    — never via a router verdict — so Firecrawl is never returned here.
  if (botProtected) {
    return resolveAvailability(ENGINES.CRAWLEE, 'bot-protected', avail);
  }

  // 5. Learned policy — the profiler/tuner verdict for this house.
  if (preferredEngine && SELECTABLE_ENGINES.includes(preferredEngine)) {
    return resolveAvailability(preferredEngine, 'learned-policy', avail);
  }

  // 6. Config default — CRAWLEE_DEFAULT=true keeps the explicit 'config-default'
  //    reason; functionally the same as the default below now that Crawlee is
  //    the only managed scraping engine.
  if (crawleeIsDefault && crawleeAvailable) {
    return resolveAvailability(ENGINES.CRAWLEE, 'config-default', avail);
  }

  // 7. Default — Crawlee, the only managed scraping engine (Firecrawl is
  //    CF-bypass-only and is never selected here).
  return resolveAvailability(ENGINES.CRAWLEE, 'default', avail);
}

// Resolve the desired engine against current availability. If the desired
// engine can't run right now, degrade to the next viable one and annotate the
// reason so the manifest records why. Never silently no-ops.
//
// Crawlee is the only managed scraping engine (Firecrawl is CF-bypass-only,
// reached via the stealth scraper, not this router). When Crawlee is desired but
// the house isn't allowlisted (crawleeAvailable=false) we STILL use it as long as
// it's installed — it's the only managed engine — and only drop to the local
// puppeteer render tier when Crawlee isn't installed at all.
function resolveAvailability(desired, reason, { crawleeAvailable, crawleeInstalled }) {
  if (desired === ENGINES.CRAWLEE && !crawleeAvailable) {
    if (crawleeInstalled) return { engine: ENGINES.CRAWLEE, reason: `${reason}+not-allowlisted` };
    return { engine: 'puppeteer', reason: `${reason}+crawlee-unavailable` };
  }
  return { engine: desired, reason };
}

// ═══════════════════════════════════════════════════════════════
// Recall maths — the safety valve
// ═══════════════════════════════════════════════════════════════

// Recall against a house's sentinel: how many of the lots the page advertises
// (sentinel matches in raw markdown/html) actually made it into the extract.
// Returns 0..1, or null when there's no sentinel signal to measure against.
export function recallRatio({ extractedLots, sentinelLots }) {
  if (!sentinelLots || sentinelLots <= 0) return null;
  return Math.max(0, Math.min(1, extractedLots / sentinelLots));
}

// STRICT RECALL PARITY (the operator-chosen policy).
// Should the cheaper `challenger` engine displace the `incumbent` for this
// house? Only when the challenger's recall is *equal or better* (tolerance 0 by
// default) AND it found at least as many lots AND there's enough signal to
// trust the comparison (incumbent saw >= minLots). Cost is never a factor here
// — it's the tie-breaker that only applies once recall is proven equal.
export function shouldDemote({
  incumbentRecall,
  challengerRecall,
  incumbentLots,
  challengerLots,
  minLots = 5,
  tolerance = 0,
} = {}) {
  if (incumbentRecall == null || challengerRecall == null) {
    return { demote: false, reason: 'insufficient-recall-signal' };
  }
  if (incumbentLots < minLots) {
    return { demote: false, reason: `too-few-lots-to-judge (${incumbentLots}<${minLots})` };
  }
  if (challengerLots < incumbentLots) {
    return { demote: false, reason: `challenger-found-fewer-lots (${challengerLots}<${incumbentLots})` };
  }
  if (challengerRecall + tolerance >= incumbentRecall) {
    return { demote: true, reason: `recall-parity (${fmt(challengerRecall)}>=${fmt(incumbentRecall)})` };
  }
  return { demote: false, reason: `recall-shortfall (${fmt(challengerRecall)}<${fmt(incumbentRecall)})` };
}

// In-run escalation: the current engine's recall fell below the floor — climb.
export function shouldEscalate({ recall, floor = 0.85 } = {}) {
  if (recall == null) return { escalate: false, reason: 'no-recall-signal' };
  if (recall < floor) return { escalate: true, reason: `recall-below-floor (${fmt(recall)}<${fmt(floor)})` };
  return { escalate: false, reason: 'recall-ok' };
}

// Next more-capable engine to try, or null at the top of the ladder.
export function escalationTarget(engine) {
  return ESCALATION_LADDER[engine] ?? null;
}

// ═══════════════════════════════════════════════════════════════
// Engine stats — the adaptive tuner's memory (pure reducers)
// ═══════════════════════════════════════════════════════════════

// Fold one run outcome into a house's engine_stats rollup. Pure: returns a new
// stats object, never mutates the input. `recall` may be null (no sentinel).
export function recordEngineOutcome(stats, engine, { success, recall = null, credits = 0, at = null } = {}) {
  const next = { ...(stats || {}) };
  const prev = next[engine] || { runs: 0, successes: 0, recallSum: 0, recallRuns: 0, creditSum: 0, lastRunAt: null };
  next[engine] = {
    runs: prev.runs + 1,
    successes: prev.successes + (success ? 1 : 0),
    recallSum: prev.recallSum + (recall == null ? 0 : recall),
    recallRuns: prev.recallRuns + (recall == null ? 0 : 1),
    creditSum: prev.creditSum + (credits || 0),
    lastRunAt: at || prev.lastRunAt,
  };
  return next;
}

// Derived per-engine scorecard from a stats rollup.
export function engineScore(statsForEngine) {
  const s = statsForEngine;
  if (!s || !s.runs) return { successRate: null, avgRecall: null, avgCredits: null, runs: 0 };
  return {
    successRate: s.successes / s.runs,
    avgRecall: s.recallRuns ? s.recallSum / s.recallRuns : null,
    avgCredits: s.runs ? s.creditSum / s.runs : null,
    runs: s.runs,
  };
}

function fmt(n) {
  return typeof n === 'number' ? n.toFixed(2) : String(n);
}
