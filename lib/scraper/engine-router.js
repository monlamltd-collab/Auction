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
//   3. Default — Firecrawl, the safe incumbent, when no policy exists.
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
  FIRECRAWL: 'firecrawl',   // Firecrawl render + server-side JSON extract (incumbent default)
  CRAWLEE: 'crawlee',       // Crawlee render + Gemini extract (cheap, self-hosted)
  PDF_GEMINI: 'pdf-gemini', // PDF download → Gemini Pro extract
});

// Engines the adaptive tuner is allowed to choose between for a normal
// HTML catalogue. API / PDF are decided structurally, not learned.
export const SELECTABLE_ENGINES = Object.freeze([ENGINES.FIRECRAWL, ENGINES.CRAWLEE]);

// Escalation ladder — when an engine under-recalls mid-run, climb to the next
// more capable engine. Firecrawl is the top of what we run today; 'bright-data'
// is reserved for the future managed-unblocker tier (see docs).
const ESCALATION_LADDER = Object.freeze({
  [ENGINES.CRAWLEE]: ENGINES.FIRECRAWL,
  [ENGINES.FIRECRAWL]: null, // already the most capable engine we operate
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
    hasMarkdownRecogniser = false,
    botProtected = false,
    crawleeAvailable = false,
    firecrawlAvailable = true,
  } = ctx;

  const avail = { crawleeAvailable, firecrawlAvailable };

  // 1. Manual lock — operator escape hatch, always wins (even over structure).
  if (manualEngine) {
    return resolveAvailability(manualEngine, 'manual-lock', avail);
  }

  // 2. Structured API consumer (Allsop) — never render, never extract.
  if (isApi) {
    return { engine: ENGINES.API, reason: 'structured-api' };
  }

  // 3. PDF catalogue — Gemini Pro, no browser engine applies.
  if (isPdf) {
    return { engine: ENGINES.PDF_GEMINI, reason: 'pdf-catalogue' };
  }

  // 4. House depends on Firecrawl's markdown for its recall recogniser
  //    (Pattinson, John Pye, McHugh, Mark Jenkinson, Maggs, Hollis Morgan).
  //    Crawlee's markdown is a different shape — these must stay on Firecrawl.
  if (hasMarkdownRecogniser) {
    return resolveAvailability(ENGINES.FIRECRAWL, 'markdown-recogniser-dependency', avail);
  }

  // 5. Bot-protected — Firecrawl is the best anti-bot engine we run today
  //    (managed-unblocker tier is future work). Never hand these to Crawlee.
  if (botProtected) {
    return resolveAvailability(ENGINES.FIRECRAWL, 'bot-protected', avail);
  }

  // 6. Learned policy — the profiler/tuner verdict for this house.
  if (preferredEngine && SELECTABLE_ENGINES.includes(preferredEngine)) {
    return resolveAvailability(preferredEngine, 'learned-policy', avail);
  }

  // 7. Default — Firecrawl, the safe incumbent, until a policy is learned.
  return resolveAvailability(ENGINES.FIRECRAWL, 'default', avail);
}

// Resolve the desired engine against current availability. If the desired
// engine can't run right now, degrade to the next viable one and annotate the
// reason so the manifest records why. Never silently no-ops.
function resolveAvailability(desired, reason, { crawleeAvailable, firecrawlAvailable }) {
  if (desired === ENGINES.CRAWLEE && !crawleeAvailable) {
    if (firecrawlAvailable) return { engine: ENGINES.FIRECRAWL, reason: `${reason}+crawlee-unavailable` };
    return { engine: 'puppeteer', reason: `${reason}+crawlee-and-firecrawl-unavailable` };
  }
  if (desired === ENGINES.FIRECRAWL && !firecrawlAvailable) {
    if (crawleeAvailable) return { engine: ENGINES.CRAWLEE, reason: `${reason}+firecrawl-unavailable` };
    return { engine: 'puppeteer', reason: `${reason}+firecrawl-and-crawlee-unavailable` };
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
