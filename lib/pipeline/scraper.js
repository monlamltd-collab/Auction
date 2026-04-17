// lib/pipeline/scraper.js — Modular scrape service
// Interface: scrape(url, house, opts) → { html, method, hash, images, pages }
// Emits structured events the harness can inspect for targeted repair.

import { createHash } from 'crypto';
import { ScrapeError, scrapeEvent } from './types.js';

let _deps = null;

export function initModularScraper(deps) {
  _deps = deps;
}

/**
 * Scrape a catalogue URL using the three-tier fallback.
 * Returns structured result with method used and content hash.
 *
 * @param {string} url - Catalogue URL to scrape
 * @param {string} house - House slug
 * @param {object} opts - { waitFor, actions, formats }
 * @returns {{ html: string, method: string, hash: string, images: string[], statusCode: number }}
 */
export async function scrape(url, house, opts = {}) {
  const startMs = Date.now();
  let html = '';
  let method = '';
  let images = [];
  let statusCode = 200;

  // Tier 1: Firecrawl
  if (_deps.FIRECRAWL_API_KEY && !_deps.isFcCreditExhausted() && !_deps.FIRECRAWL_SKIP.has(house)) {
    try {
      const fcResult = await _deps.scrapeWithFirecrawl(url, {
        formats: ['rawHtml', ...(opts.formats || [])],
        ...(opts.waitFor && { waitFor: opts.waitFor }),
        ...(opts.actions && { actions: opts.actions }),
      });
      html = fcResult.html || '';
      images = fcResult.images || [];
      method = 'firecrawl';
      statusCode = 200;

      scrapeEvent(house, {
        event: 'scrape_success',
        method,
        url,
        htmlLength: html.length,
        imageCount: images.length,
        durationMs: Date.now() - startMs,
      });
    } catch (err) {
      scrapeEvent(house, {
        event: 'scrape_tier_fallback',
        failedMethod: 'firecrawl',
        reason: err.message,
        statusCode: err.statusCode,
        url,
      });
      // Fall through to Tier 2
    }
  }

  // Tier 2: Puppeteer
  if (!html && _deps.puppeteer) {
    try {
      const rendered = await _deps.scrapeRenderedPage(url, house, opts);
      html = rendered.html || '';
      images = rendered.images || [];
      method = 'puppeteer';

      scrapeEvent(house, {
        event: 'scrape_success',
        method,
        url,
        htmlLength: html.length,
        imageCount: images.length,
        durationMs: Date.now() - startMs,
      });
    } catch (err) {
      scrapeEvent(house, {
        event: 'scrape_tier_fallback',
        failedMethod: 'puppeteer',
        reason: err.message,
        url,
      });
    }
  }

  // Tier 3: Plain HTTP
  if (!html) {
    try {
      html = await _deps.fetchPage(url);
      method = 'http';

      scrapeEvent(house, {
        event: 'scrape_success',
        method,
        url,
        htmlLength: html.length,
        imageCount: 0,
        durationMs: Date.now() - startMs,
      });
    } catch (err) {
      scrapeEvent(house, {
        event: 'scrape_all_tiers_failed',
        url,
        lastError: err.message,
        durationMs: Date.now() - startMs,
      });

      throw new ScrapeError(`All scrape tiers failed for ${house}`, {
        house,
        url,
        method: 'all',
        inner: err,
      });
    }
  }

  // Validate: non-trivial content
  if (html.length < 500) {
    scrapeEvent(house, {
      event: 'scrape_thin_content',
      method,
      url,
      htmlLength: html.length,
    });

    throw new ScrapeError(`Scrape returned thin content (${html.length} chars) for ${house}`, {
      house,
      url,
      method,
      statusCode,
    });
  }

  const hash = createHash('md5').update(html).digest('hex');

  return { html, method, hash, images, statusCode };
}

/**
 * Scrape multiple pages (pagination-aware).
 * Returns array of page results.
 */
export async function scrapePages(baseUrl, house, { maxPages = 25, paginateAs, waitFor, actions } = {}) {
  const results = [];
  const opts = {};
  if (waitFor) opts.waitFor = waitFor;
  if (actions) opts.actions = actions;

  const first = await scrape(baseUrl, house, opts);
  results.push({ page: 1, ...first });

  if (paginateAs && maxPages > 1) {
    const totalDetected = _deps.detectTotalPages?.(first.html, baseUrl, house) || 1;
    const cap = Math.min(totalDetected, maxPages);

    for (let p = 2; p <= cap; p++) {
      try {
        const pageUrl = _deps.buildPageUrl(baseUrl, p, house);
        const pageResult = await scrape(pageUrl, house, opts);
        results.push({ page: p, ...pageResult });

        scrapeEvent(house, {
          event: 'scrape_page',
          page: p,
          totalPages: cap,
          lotEstimate: null,
        });
      } catch (err) {
        scrapeEvent(house, {
          event: 'scrape_page_failed',
          page: p,
          reason: err.message,
        });
        break;
      }
    }
  }

  return results;
}
