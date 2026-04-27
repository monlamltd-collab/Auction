// ═══════════════════════════════════════════════════════════════
// lib/scraper/rendering.js — The three-tier scrape orchestrator.
//
// scrapeRenderedPage is the entry point used everywhere upstream
// (pipeline scrape stage, image backfill, lot-detail enrichment).
// It cascades Firecrawl → Puppeteer → plain HTTP and stamps
// state.lastScrapeEngine so the manifest can record which tier
// produced the response.
//
// scrapePageWithFirecrawl is the multi-page wrapper that calls the
// orchestrator once per page detected. It lives here (not in
// firecrawl.js) so the rendering slice owns the orchestrator and
// every caller that needs the fallback chain.
// ═══════════════════════════════════════════════════════════════

import { HEADERS, MAX_PUPPETEER_PAGES } from '../config.js';
import { getBudget, setLastScrapeEngine } from './state.js';
import { scrapeWithFirecrawl } from './firecrawl.js';
import { puppeteer, acquirePage } from './puppeteer.js';
import { fetchPage } from './http.js';
import { detectTotalPages, buildPageUrl } from './pagination.js';

// Per-house Firecrawl overrides — used when a site needs a longer wait,
// captcha pre-actions, or selector-based readiness instead of the default
// 3s wait + scroll/lazy-image actions. Keep the map small; broad changes
// belong in scrapeRenderedPage's default path.
const HOUSE_SCRAPE_OVERRIDES = {};

export async function scrapeRenderedPage(url, house, options = {}) {
  // Tier 1: Firecrawl (if available and not skipped/exhausted)
  if (getBudget().canUseFirecrawl() && !getBudget().isSkipped(house)) {
      try {
        const override = HOUSE_SCRAPE_OVERRIDES[house] || {};
        const fcActions = [
          // House-specific pre-actions (e.g. captcha bypass) run first
          ...(override.preActions || []),
          // Scroll down in stages to trigger intersection observers for lazy-loaded content
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1500 },
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1500 },
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1500 },
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1000 },
          // Force lazy-loaded images: swap data-src/data-lazy-src to src
          { type: 'executeJavascript', script: `document.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]').forEach(img => { const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original'); if (src && !img.getAttribute('src')?.startsWith('http')) img.setAttribute('src', src); });` },
          { type: 'wait', milliseconds: 500 },
          // Scroll back to top to capture any fixed-position images
          { type: 'scroll', direction: 'up' },
          { type: 'scroll', direction: 'up' },
          { type: 'scroll', direction: 'up' },
          { type: 'scroll', direction: 'up' },
        ];
        const result = await scrapeWithFirecrawl(url, {
          waitFor: options.waitFor || override.waitFor || 3000,
          actions: options.actions || fcActions,
          formats: ['markdown', 'rawHtml', 'images'],
        });
        if (result.html && result.html.length > 500) {
          console.log(`Firecrawl: got ${result.html.length} chars for ${house}`);
          setLastScrapeEngine('firecrawl');
          return result;
        }
        console.log(`Firecrawl: empty/short response for ${house}, falling back`);
      } catch (err) {
        console.log(`Firecrawl failed for ${house}: ${err.message}, falling back`);
        getBudget().recordFcFallback();
      }
  }

  // Tier 2: Puppeteer (if available)
  if (puppeteer) {
    try {
      const page = await acquirePage();
      try {
        await page.setUserAgent(HEADERS['User-Agent']);
        await page.setViewport({ width: 1280, height: 900 });
        await page.setRequestInterception(true);
        page.on('request', req => {
          const type = req.resourceType();
          if (['image', 'font', 'media'].includes(type)) req.abort();
          else req.continue();
        });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, options.waitFor || 3000));
        await page.evaluate(async () => {
          for (let i = 0; i < 15; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 500)); }
          window.scrollTo(0, 0);
        });
        await new Promise(r => setTimeout(r, 2000));
        const html = await page.content();
        const sourceURL = page.url();
        setLastScrapeEngine('puppeteer');
        return { html, sourceURL };
      } finally {
        await page.close();
      }
    } catch (err) {
      console.log(`Puppeteer fallback failed for ${house}: ${err.message}`);
    }
  }

  // Tier 3: Plain HTTP (last resort)
  try {
    const html = await fetchPage(url);
    setLastScrapeEngine('http');
    return { html, sourceURL: url };
  } catch (err) {
    throw new Error(`All scraping methods failed for ${url}: ${err.message}`);
  }
}

export async function scrapePageWithFirecrawl(url, house) {
  const result = await scrapeRenderedPage(url, house);
  if (!result.html) return [];
  const pages = [{ page: 1, html: result.html, markdown: result.markdown }];

  // Detect total pages from first page HTML
  const totalPages = detectTotalPages(result.html, url, house);
  if (totalPages > 1) {
    const pageCap = Math.min(totalPages, MAX_PUPPETEER_PAGES);
    console.log(`[PAGINATION] ${house}: ${totalPages} pages detected, loading up to ${pageCap}`);
    for (let p = 2; p <= pageCap; p++) {
      if (!getBudget().canUseFirecrawl()) { console.log(`Firecrawl: unavailable at page ${p}, stopping`); break; }
      const pageUrl = buildPageUrl(url, p, house);
      try {
        const pageResult = await scrapeRenderedPage(pageUrl, house);
        if (pageResult.html && pageResult.html.length > 500) {
          pages.push({ page: p, html: pageResult.html, markdown: pageResult.markdown });
        } else {
          console.log(`Firecrawl: page ${p} empty for ${house}, stopping`);
          break;
        }
      } catch (err) {
        console.log(`Firecrawl: page ${p} failed for ${house}: ${err.message}`);
        break;
      }
    }
  }
  return pages;
}
