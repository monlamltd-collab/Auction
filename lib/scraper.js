// ═══════════════════════════════════════════════════════════════
// lib/scraper.js — Scraping infrastructure extracted from server.js
// Firecrawl, Puppeteer, image backfill, AI extraction, PDF, pagination
// ═══════════════════════════════════════════════════════════════

import { JSDOM } from 'jsdom';
import { log } from './logging.js';
import { HEADERS, TIMEOUT, MAX_PAGES, MAX_PUPPETEER_PAGES, MAX_LOTS_PER_SCRAPE } from './config.js';
import { DOM_EXTRACTORS, UNIVERSAL_DOM_EXTRACTOR, extractWithJSDOM, setLastExtractorUsed } from './extractors/index.js';
import { PUPPETEER_IMAGE_HOUSES } from './houses.js';
import { detectSourceStatus } from './harness/sub-agents.js';

// ── Shared state: see lib/scraper/state.js ──
// Phase 1 of the lib/scraper.js → lib/scraper/* split: state lives in state.js,
// this file routes its reads/writes through getters/setters. Function bodies
// will migrate out in subsequent phases.
import {
  initState,
  withTier,
  currentTier,
  getBudget,
  getCallAI,
  getCreditExhausted,
  setCreditExhausted,
  setCreditExhaustedAt,
  incApiCallCount,
  getExtractPostcode,
  getLastScrapeEngine,
  setLastScrapeEngine,
  getLastAITier,
  setLastAITier,
} from './scraper/state.js';

// Re-export public API symbols that callers import from './lib/scraper.js'.
export { withTier, currentTier, getBudget, getLastScrapeEngine, setLastScrapeEngine, getLastAITier, setLastAITier };
export { FIRECRAWL_API_KEY, FIRECRAWL_SKIP } from './scraper/state.js';

// Internal references for functions whose definitions have moved into ./scraper/* slices.
// Re-exported above; imported here so the surviving function bodies in this file can call them.
import { fetchPage } from './scraper/http.js';
import { stripHtml } from './scraper/validation.js';
import { detectTotalPages, buildPageUrl } from './scraper/pagination.js';

// Lot-detail enrichment moved to ./scraper/lot-detail.js
import { fetchLotPage } from './scraper/lot-detail.js';
export {
  isPlausiblePrice,
  getCachedLotDetail,
  cacheLotDetail,
  fetchLotPage,
  enrichLotsFromLotPages,
} from './scraper/lot-detail.js';

// Puppeteer instance + scrape primitives moved to ./scraper/puppeteer.js
import { puppeteer, acquirePage, extractWithDOM } from './scraper/puppeteer.js';
export {
  puppeteer, acquirePage, getBrowser,
  scrapeWithPuppeteer, hasPuppeteer, extractWithDOM,
} from './scraper/puppeteer.js';

// ── initScraper — thin wrapper around initState (state lives in scraper/state.js) ──
export function initScraper(opts) {
  initState(opts);
}

// Firecrawl primitive + 18 budget delegation getters/setters moved to ./scraper/firecrawl.js
export {
  scrapeWithFirecrawl,
  getFirecrawlStatus, getFcCreditsUsed, isFcCreditExhausted, getFcExhaustedAt,
  isFcTemporarilyDown, getFcDownAt, getFcConsecutive5xx, getFcFallbackCount,
  getFcErrorCount, getFcRequestCount, getFcLastError, getFcLastErrorAt,
  setFcCreditExhausted, setFcExhaustedAt, setFcCreditsUsed, setFcTemporarilyDown,
  setFcDownAt, setFcConsecutive5xx,
} from './scraper/firecrawl.js';
import { scrapeWithFirecrawl } from './scraper/firecrawl.js';

// ── Image URL validation — moved to ./scraper/validation.js ──
export { IMG_EXTENSIONS, IMG_CDN_DOMAINS, isValidImageUrl } from './scraper/validation.js';

// scrapeRenderedPage + scrapePageWithFirecrawl moved to ./scraper/rendering.js
import { scrapeRenderedPage } from './scraper/rendering.js';
export { scrapeRenderedPage, scrapePageWithFirecrawl } from './scraper/rendering.js';


// ═══════════════════════════════════════════════════════════════
// PAGE FETCHING & PAGINATION
// ═══════════════════════════════════════════════════════════════

// fetchPage moved to ./scraper/http.js; scrapeAllPages moved to ./scraper/pagination.js
export { fetchPage } from './scraper/http.js';
export { scrapeAllPages } from './scraper/pagination.js';

// Allsop JSON API branch moved to ./scraper/allsop.js
export { scrapeAllsopApi, extractAllsopLotsFromJson, enrichAllsopLots } from './scraper/allsop.js';

// detectTotalPages + buildPageUrl moved to ./scraper/pagination.js
export { detectTotalPages, buildPageUrl } from './scraper/pagination.js';

// Puppeteer scrape primitives (acquirePage, getBrowser, scrapeWithPuppeteer)
// moved to ./scraper/puppeteer.js — re-exported at the top of this file.

// AI extraction (Gemini) + PDF extraction moved to ./scraper/extraction.js
export {
  HOUSE_EXTRACTION_HINTS,
  extractLotsWithAI,
  isPdfUrl,
  extractLotsFromPdf,
} from './scraper/extraction.js';


// stripHtml + normaliseLotStatuses moved to ./scraper/validation.js
export { stripHtml, normaliseLotStatuses } from './scraper/validation.js';

// Image backfill (4 strategies) moved to ./scraper/image-backfill.js
export {
  backfillImagesWithFirecrawl,
  backfillImages,
  backfillImagesFromLotPages,
  backfillImagesWithPuppeteer,
} from './scraper/image-backfill.js';




// extractWithDOM, hasPuppeteer + the puppeteer re-export moved to ./scraper/puppeteer.js
