// ═══════════════════════════════════════════════════════════════
// lib/scraper/state.js — Shared module state for the scraper slices
//
// Owns the mutable state that was previously declared at the top of
// lib/scraper.js. As scraper logic gets sliced into focused files
// (firecrawl.js, puppeteer.js, lot-detail.js, etc.) every slice imports
// the getters/setters here so there is a single source of truth.
//
// CRITICAL: initState() must be called (via initScraper() in the façade)
// before any scraping function runs. Pre-init access returns sensible
// defaults so module load doesn't throw.
// ═══════════════════════════════════════════════════════════════

import { AsyncLocalStorage } from 'async_hooks';

// ── Tier context for Firecrawl credit accounting ──
// Wrap a code path with withTier(tier, fn) and any scrapeWithFirecrawl
// calls inside (including async/awaited and nested) record their credit
// spend against that tier. Concurrency-safe via AsyncLocalStorage.
const _tierStore = new AsyncLocalStorage();
export function withTier(tier, fn) {
  return _tierStore.run({ tier }, fn);
}
export function currentTier() {
  return _tierStore.getStore()?.tier || 'unknown';
}

// ── Shared resource budget (set via initState) ──
/** @type {import('../resource-budget.js').ResourceBudget | null} */
let _budget = null;
export function getBudget() { return _budget; }

// ── Injected dependencies (set via initState) ──
let _callAI = null;
let _creditExhaustedRef = { get: () => false, set: () => {} };
let _creditExhaustedAtRef = { set: () => {} };
let _apiCallCountRef = { get: () => 0, inc: () => {} };
let _extractPostcode = null;

export function getCallAI() { return _callAI; }
export function getCreditExhausted() { return _creditExhaustedRef.get(); }
export function setCreditExhausted(v) { _creditExhaustedRef.set(v); }
export function setCreditExhaustedAt(v) { _creditExhaustedAtRef.set(v); }
export function getApiCallCount() { return _apiCallCountRef.get(); }
export function incApiCallCount() { _apiCallCountRef.inc(); }
export function getExtractPostcode() { return _extractPostcode; }

// ── Legacy live-binding exports — preserve `export let` semantics across re-exports.
// Callers imported these directly from lib/scraper.js before the split; the façade
// re-exports them from here so the live-binding contract is unchanged.
export let FIRECRAWL_API_KEY = '';
export let FIRECRAWL_SKIP = new Set();

// ── Scrape engine + AI tier tracking ──
let _lastScrapeEngine = 'http';
let _lastAITier = null;
export function getLastScrapeEngine() { return _lastScrapeEngine; }
export function setLastScrapeEngine(v) { _lastScrapeEngine = v; }
export function getLastAITier() { return _lastAITier; }
export function setLastAITier(v) { _lastAITier = v; }

// ═══════════════════════════════════════════════════════════════
// initState — single seam for wiring runtime dependencies
// ═══════════════════════════════════════════════════════════════
export function initState({
  budget,
  callAI,
  getCreditExhausted: getCE,
  setCreditExhausted: setCE,
  setCreditExhaustedAt: setCEAt,
  getApiCallCount: getApiCount,
  incApiCallCount: incApiCount,
  extractPostcode,
} = {}) {
  if (budget) {
    _budget = budget;
    FIRECRAWL_API_KEY = _budget.fcKey;
    FIRECRAWL_SKIP = _budget.skipSet;
  }
  if (callAI) _callAI = callAI;
  if (getCE) _creditExhaustedRef = { get: getCE, set: setCE };
  if (setCEAt) _creditExhaustedAtRef = { set: setCEAt };
  if (getApiCount) _apiCallCountRef = { get: getApiCount, inc: incApiCount };
  if (extractPostcode) _extractPostcode = extractPostcode;
}
