// ═══════════════════════════════════════════════════════════════
// lib/scraper.js — Thin re-export façade.
//
// Public API for callers (server.js, routes/*). Implementation lives
// in lib/scraper/* slices. Add new scrape logic to a slice, not here.
// ═══════════════════════════════════════════════════════════════

import { initState } from './scraper/state.js';

export function initScraper(opts) {
  initState(opts);
}

export {
  withTier, currentTier, getBudget,
  getLastScrapeEngine, setLastScrapeEngine,
  getLastAITier, setLastAITier,
  FIRECRAWL_API_KEY, FIRECRAWL_SKIP,
} from './scraper/state.js';

export { fetchPage } from './scraper/http.js';
export {
  IMG_EXTENSIONS, IMG_CDN_DOMAINS, isValidImageUrl,
  stripHtml, normaliseLotStatuses,
} from './scraper/validation.js';
export {
  detectTotalPages, buildPageUrl, scrapeAllPages,
} from './scraper/pagination.js';

export {
  scrapeWithFirecrawl,
  getFirecrawlStatus, getFcCreditsUsed, isFcCreditExhausted, getFcExhaustedAt,
  isFcTemporarilyDown, getFcDownAt, getFcConsecutive5xx, getFcFallbackCount,
  getFcErrorCount, getFcRequestCount, getFcLastError, getFcLastErrorAt,
  setFcCreditExhausted, setFcExhaustedAt, setFcCreditsUsed, setFcTemporarilyDown,
  setFcDownAt, setFcConsecutive5xx,
} from './scraper/firecrawl.js';

export {
  puppeteer, acquirePage, getBrowser,
  scrapeWithPuppeteer, hasPuppeteer, extractWithDOM,
} from './scraper/puppeteer.js';

export {
  scrapeRenderedPage, scrapePageWithFirecrawl,
} from './scraper/rendering.js';

export {
  scrapeAllsopApi, extractAllsopLotsFromJson, enrichAllsopLots,
} from './scraper/allsop.js';

export {
  HOUSE_EXTRACTION_HINTS,
  extractLotsWithAI,
  isPdfUrl,
  extractLotsFromPdf,
} from './scraper/extraction.js';

export {
  backfillImagesWithFirecrawl,
  backfillImages,
  backfillImagesFromLotPages,
  backfillImagesWithPuppeteer,
} from './scraper/image-backfill.js';

export {
  isPlausiblePrice,
  getCachedLotDetail,
  cacheLotDetail,
  fetchLotPage,
  enrichLotsFromLotPages,
} from './scraper/lot-detail.js';
