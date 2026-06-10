// ═══════════════════════════════════════════════════════════════
// lib/pipeline/crawlee-extract.js — Crawlee render → Gemini extract.
//
// The Crawlee analogue of the Firecrawl catalogue path: render every
// page with Crawlee, then extract lots with the existing Gemini
// extractor (extractLotsWithAI, which stamps setLastExtractorUsed('gemini')
// internally — so persistence records scraped_with='crawlee',
// extracted_with='gemini' with no extra wiring).
//
// Also computes recall (distinct sentinel IDs seen in the rendered HTML
// vs lots actually extracted) so the parity gate has a challenger recall
// to compare against the Firecrawl incumbent. Pure-ish: deps injected for
// testability, real implementations as defaults.
// ═══════════════════════════════════════════════════════════════

import { recallRatio } from '../scraper/engine-router.js';
import { scrapeAllPagesWithCrawlee } from '../scraper/crawlee-render.js';
import { extractLotsWithAI } from '../scraper/extraction.js';

/**
 * @param {string} scrapeUrl
 * @param {string} house
 * @param {object} [opts]
 * @param {number} [opts.maxPages]
 * @param {RegExp} [opts.recallSentinelPattern] - global regex, capture group 1 = lot id
 * @param {Function} [opts.onExtract] - progress callback passed to extractLotsWithAI
 * @param {object} [deps] - { scrapeAllPagesWithCrawlee, extractLotsWithAI }
 * @returns {Promise<{ lots, recall, sentinelLots, renderedPages }>}
 */
export async function renderAndExtractWithCrawlee(scrapeUrl, house, opts = {}, deps = {}) {
  const { maxPages, recallSentinelPattern, onExtract } = opts;
  const _render = deps.scrapeAllPagesWithCrawlee || scrapeAllPagesWithCrawlee;
  const _extract = deps.extractLotsWithAI || extractLotsWithAI;

  const pages = await _render(scrapeUrl, house, { maxPages });
  if (!pages.length) return { lots: [], recall: null, sentinelLots: 0, renderedPages: [] };

  const lots = (await _extract(pages, house, onExtract || null, scrapeUrl)) || [];

  // Recall against the house's sentinel: distinct lot IDs advertised in the
  // rendered HTML vs lots we actually extracted. Null when no sentinel given.
  let sentinelLots = 0;
  let recall = null;
  if (recallSentinelPattern) {
    const ids = new Set();
    for (const p of pages) {
      for (const m of String(p.html || '').matchAll(recallSentinelPattern)) {
        if (m[1]) ids.add(m[1]);
      }
    }
    sentinelLots = ids.size;
    recall = recallRatio({ extractedLots: lots.length, sentinelLots });
  }

  return { lots, recall, sentinelLots, renderedPages: pages };
}
