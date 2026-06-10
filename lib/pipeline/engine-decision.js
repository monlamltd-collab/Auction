// ═══════════════════════════════════════════════════════════════
// lib/pipeline/engine-decision.js — The single seam where the router
// is consulted.
//
// chooseEngine() (engine-router.js) is pure; this module is the thin
// I/O-aware wrapper that gathers a house's live signals and hands them
// to it. Every call site (cron autoAnalyseOne, on-demand routes/analyse,
// legacy scrape-stage) goes through resolveEngineForHouse() so the
// override ladder is defined in exactly one place and can never drift
// between paths.
//
// Config progression (dormant → allowlist → default) lives in
// isCrawleeEnabled(): crawlee is uninstalled today (hasCrawlee() false →
// router degrades to Firecrawl), then an allowlist, then the global
// default flip. See docs/ENGINE-ROUTER.md.
// ═══════════════════════════════════════════════════════════════

import { chooseEngine } from '../scraper/engine-router.js';
import { hasCrawlee } from '../scraper/crawlee.js';
import { isPdfUrl } from '../scraper/extraction.js';
import { getBudget } from '../scraper/state.js';

// Is Crawlee permitted for this house right now? The destination is
// CRAWLEE_DEFAULT=true (every non-override house); until then a
// comma-separated CRAWLEE_HOUSES allowlist scopes the first migration.
// Read fresh each call so env changes (and tests) take effect immediately.
export function isCrawleeEnabled(house) {
  if (process.env.CRAWLEE_DEFAULT === 'true') return true;
  const set = (process.env.CRAWLEE_HOUSES || '').split(',').map(s => s.trim()).filter(Boolean);
  return set.includes(house);
}

// Shadow mode (default ON): a Crawlee-eligible house runs both engines and
// keeps serving Firecrawl until the parity gate promotes it. Set
// CRAWLEE_SHADOW=false to let a manually-promoted house run live.
export function isShadowMode() {
  return process.env.CRAWLEE_SHADOW !== 'false';
}

/**
 * Resolve the engine for a house from its live signals.
 * @param {object} args
 * @param {string} args.house
 * @param {object} args.rewritten - rewriteUrl() result ({ paginateAs, isApi, blocked, ... })
 * @param {string} [args.catalogueUrl]
 * @param {object} [args.engineSkill] - { preferred_engine, engine_locked } from house_skills
 * @param {boolean} [args.hasMarkdownRecogniser] - true for the 6 Firecrawl-markdown recogniser houses
 * @param {boolean} [args.botProtected]
 * @param {object} [deps] - test seams: { hasCrawlee, isPdfUrl, canUseFirecrawl }
 * @returns {{ engine: string, reason: string }}
 */
export function resolveEngineForHouse({
  house,
  rewritten = {},
  catalogueUrl,
  engineSkill = {},
  hasMarkdownRecogniser = false,
  botProtected = false,
} = {}, deps = {}) {
  const _hasCrawlee = deps.hasCrawlee || hasCrawlee;
  const _isPdfUrl = deps.isPdfUrl || isPdfUrl;
  const _canUseFirecrawl = deps.canUseFirecrawl || (() => getBudget()?.canUseFirecrawl?.() ?? true);

  return chooseEngine({
    manualEngine: engineSkill?.engine_locked || null,
    preferredEngine: engineSkill?.preferred_engine || null,
    isApi: rewritten?.paginateAs === 'allsop_api' || rewritten?.isApi === true,
    isPdf: catalogueUrl ? _isPdfUrl(catalogueUrl) : false,
    hasMarkdownRecogniser,
    botProtected: botProtected || rewritten?.blocked === true,
    crawleeAvailable: _hasCrawlee() && isCrawleeEnabled(house),
    firecrawlAvailable: _canUseFirecrawl(),
  });
}
