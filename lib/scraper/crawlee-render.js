// ═══════════════════════════════════════════════════════════════
// lib/scraper/crawlee-render.js — Crawlee multi-page renderer.
//
// The Crawlee analogue of rendering.js::scrapePageWithFirecrawl: render
// page 1, detect pagination, render pages 2..N, return the same
// [{ page, html, markdown }] shape the Gemini extractor consumes.
//
// Lives in its own file (not crawlee.js) so crawlee.js stays the dormant
// single-URL adapter, mirroring how rendering.js owns the multi-page
// wrapper over firecrawl.js. Crawlee yields HTML only (no markdown) —
// extractLotsWithAI falls back to stripHtml when markdown is absent
// (extraction.js:123-127), so that's intentional, not a gap.
//
// Page cap is MAX_PUPPETEER_PAGES (Railway memory protection), not
// MAX_PAGES, because Crawlee drives a local Chromium like the Puppeteer
// tier.
// ═══════════════════════════════════════════════════════════════

import { MAX_PUPPETEER_PAGES } from '../config.js';
import { setLastScrapeEngine } from './state.js';
import { scrapeWithCrawlee } from './crawlee.js';
import { detectTotalPages, buildPageUrl } from './pagination.js';

export async function scrapeAllPagesWithCrawlee(url, house, { maxPages } = {}) {
  const first = await scrapeWithCrawlee(url);
  if (!first || !first.html) return [];
  // Stamp provenance the moment a render succeeds, matching rendering.js.
  setLastScrapeEngine('crawlee');
  const pages = [{ page: 1, html: first.html, markdown: undefined }];

  const totalPages = detectTotalPages(first.html, url, house);
  const cap = Math.min(totalPages, maxPages || MAX_PUPPETEER_PAGES);
  if (cap > 1) {
    console.log(`[CRAWLEE-PAGINATION] ${house}: ${totalPages} pages detected, loading up to ${cap}`);
    for (let p = 2; p <= cap; p++) {
      const pageUrl = buildPageUrl(url, p, house);
      try {
        const r = await scrapeWithCrawlee(pageUrl);
        if (r && r.html && r.html.length > 500) {
          pages.push({ page: p, html: r.html, markdown: undefined });
        } else {
          console.log(`Crawlee: page ${p} empty for ${house}, stopping`);
          break;
        }
      } catch (err) {
        console.log(`Crawlee: page ${p} failed for ${house}: ${err.message}`);
        break;
      }
    }
  }
  return pages;
}
