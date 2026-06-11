// ═══════════════════════════════════════════════════════════════
// lib/scraper/crawlee-render.js — Crawlee multi-page renderer.
//
// The Crawlee analogue of rendering.js::scrapePageWithFirecrawl: render
// page 1, detect pagination, render pages 2..N, return the same
// [{ page, html, markdown }] shape the Gemini extractor consumes.
//
// Lives in its own file (not crawlee.js) so crawlee.js stays the dormant
// single-URL adapter, mirroring how rendering.js owns the multi-page
// wrapper over firecrawl.js. Pages carry HTML only at this layer; for
// recogniser houses the downstream crawlee-extract.js fills markdown via
// the turndown bridge (lib/scraper/html-to-markdown.js), and for everyone
// else extractLotsWithAI falls back to stripHtml (extraction.js:123-127).
//
// Page cap is MAX_PUPPETEER_PAGES (Railway memory protection), not
// MAX_PAGES, because Crawlee drives a local Chromium like the Puppeteer
// tier.
// ═══════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import { MAX_PUPPETEER_PAGES } from '../config.js';
import { setLastScrapeEngine } from './state.js';
import { scrapeWithCrawlee } from './crawlee.js';
import { detectTotalPages, buildPageUrl } from './pagination.js';
import { PAGINATION_PATTERNS } from '../pipeline/firecrawl-extract.js';

const fingerprint = (html) => createHash('md5').update(String(html || '')).digest('hex');

/**
 * @param {string} url
 * @param {string} house
 * @param {object} [opts]
 * @param {number} [opts.maxPages] - hard page cap (registry maxPages or 25)
 * @param {string} [opts.paginateAs] - per-house pagination scheme key; uses the
 *   SAME builder as the Firecrawl path (PAGINATION_PATTERNS) so Pattinson gets
 *   `?p=N` not `?page=N`. Falls back to pagination.js buildPageUrl. (review F2)
 * @param {{html:string,sourceURL?:string}} [opts.prefetchedPage1] - page-1 HTML
 *   already rendered by the caller's change-gate probe, reused to avoid a second
 *   full render of page 1. (review F1/F12)
 * @param {number} [opts.deadlineAt] - epoch ms; stop adding pages once passed,
 *   so a multi-page render can't blow the house timeout and orphan. (review F1)
 */
export async function scrapeAllPagesWithCrawlee(url, house, { maxPages, paginateAs, prefetchedPage1, deadlineAt } = {}, deps = {}) {
  const _scrape = deps.scrapeWithCrawlee || scrapeWithCrawlee;
  const first = prefetchedPage1?.html ? prefetchedPage1 : await _scrape(url);
  if (!first || !first.html) return [];
  // Stamp provenance the moment a render succeeds, matching rendering.js.
  setLastScrapeEngine('crawlee');
  const pages = [{ page: 1, html: first.html, markdown: undefined }];

  const totalPages = detectTotalPages(first.html, url, house);
  // Memory guard: never exceed MAX_PUPPETEER_PAGES regardless of the registry's
  // per-house maxPages (Pattinson's 84 would otherwise defeat it). (review F10)
  const cap = Math.min(totalPages, maxPages || MAX_PUPPETEER_PAGES, MAX_PUPPETEER_PAGES);
  const build = (paginateAs && PAGINATION_PATTERNS[paginateAs]) || ((u, p) => buildPageUrl(u, p, house));
  const seen = new Set([fingerprint(first.html)]);
  if (cap > 1) {
    console.log(`[CRAWLEE-PAGINATION] ${house}: ${totalPages} pages detected, loading up to ${cap}${paginateAs ? ` (${paginateAs})` : ''}`);
    for (let p = 2; p <= cap; p++) {
      if (deadlineAt && Date.now() > deadlineAt) { console.log(`Crawlee: ${house} render deadline reached at page ${p}, stopping`); break; }
      const pageUrl = build(url, p);
      try {
        const r = await _scrape(pageUrl);
        if (!r || !r.html || r.html.length <= 500) { console.log(`Crawlee: page ${p} empty for ${house}, stopping`); break; }
        // Stop if a page is byte-identical to one already seen — a mis-paginated
        // URL (wrong scheme) silently returns page 1 over and over. (review F2)
        const fp = fingerprint(r.html);
        if (seen.has(fp)) { console.log(`Crawlee: page ${p} identical to a prior page for ${house} (pagination not advancing), stopping`); break; }
        seen.add(fp);
        pages.push({ page: p, html: r.html, markdown: undefined });
      } catch (err) {
        console.log(`Crawlee: page ${p} failed for ${house}: ${err.message}`);
        break;
      }
    }
  }
  return pages;
}
