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
import { htmlToRecognitionMarkdown } from '../scraper/html-to-markdown.js';
import { normaliseScrapedLot } from '../types/lot.js';

const addrKey = (lot) => `${lot.lot}|${(lot.address || '').toLowerCase().replace(/[\s,]+/g, ' ').trim()}`;

/**
 * @param {string} scrapeUrl
 * @param {string} house
 * @param {object} [opts]
 * @param {number} [opts.maxPages]
 * @param {RegExp} [opts.recallSentinelPattern] - global regex, capture group 1 = lot id
 * @param {Function} [opts.recogniseFromMarkdown] - per-house markdown recogniser (Phase 3).
 *   When supplied, each page's HTML is converted to markdown (turndown) and the recogniser
 *   recovers lots the Gemini extractor missed — mirroring the Firecrawl JSON+markdown merge.
 * @param {Function} [opts.onExtract] - progress callback passed to extractLotsWithAI
 * @param {object} [deps] - test seams
 * @returns {Promise<{ lots, recall, sentinelLots, renderedPages, recognised }>}
 */
export async function renderAndExtractWithCrawlee(scrapeUrl, house, opts = {}, deps = {}) {
  const { maxPages, recallSentinelPattern, recogniseFromMarkdown, onExtract } = opts;
  const _render = deps.scrapeAllPagesWithCrawlee || scrapeAllPagesWithCrawlee;
  const _extract = deps.extractLotsWithAI || extractLotsWithAI;
  const _toMarkdown = deps.htmlToRecognitionMarkdown || htmlToRecognitionMarkdown;

  const pages = await _render(scrapeUrl, house, { maxPages });
  if (!pages.length) return { lots: [], recall: null, sentinelLots: 0, renderedPages: [], recognised: 0 };

  // Bridge HTML → markdown so the recogniser (and the recall denominator) see
  // the same shape Firecrawl produces. Only when a recogniser is in play.
  // Note: this also switches the Gemini extractor's input for these pages from
  // stripHtml(html) to markdown (extraction.js prefers markdown >200 chars) —
  // intentional: markdown is what the Firecrawl path feeds Gemini too.
  if (recogniseFromMarkdown) {
    for (const p of pages) { if (p.markdown == null) p.markdown = _toMarkdown(p.html, p.url || scrapeUrl); }
  }

  const lots = (await _extract(pages, house, onExtract || null, scrapeUrl)) || [];

  // ── Markdown recognition recovery (Phase 3) ──
  // Recover lots the Gemini extractor missed by reading the turndown markdown.
  // Mirrors lib/pipeline/firecrawl-extract.js's JSON+markdown merge.
  let recognised = 0;
  if (recogniseFromMarkdown && recallSentinelPattern) {
    // Preserve flags minus 'g' (a global regex used with .match keeps lastIndex
    // state); markjenkinson's sentinel needs 'i'.
    const jsonIdRegex = new RegExp(recallSentinelPattern.source, recallSentinelPattern.flags.replace('g', ''));
    const haveIds = new Set(lots.map(l => (l.url || '').match(jsonIdRegex)?.[1]).filter(Boolean));
    const haveKeys = new Set(lots.map(addrKey));
    for (const p of pages) {
      const md = p.markdown || '';
      const mdIds = new Set([...md.matchAll(recallSentinelPattern)].map(m => m[1]).filter(Boolean));
      const missing = [...mdIds].filter(id => !haveIds.has(id));
      if (!missing.length) continue;
      const recoveredMap = recogniseFromMarkdown(md);
      for (const id of missing) {
        const lot = recoveredMap?.get?.(id);
        if (!lot || !lot.address) continue;
        const norm = normaliseScrapedLot(lot, { house, catalogueUrl: p.url || scrapeUrl, extractionSource: 'crawlee-markdown-recognition' });
        if (!norm) continue;
        const key = addrKey(norm);
        if (haveKeys.has(key)) continue;
        haveKeys.add(key); haveIds.add(id);
        lots.push(norm);
        recognised++;
      }
    }
    if (recognised > 0) console.log(`AUTO: ${house} — Crawlee markdown recognised ${recognised} extra lots`);
  }

  // Recall against the house's sentinel: distinct lot IDs advertised (markdown
  // when we have it, else HTML) vs lots extracted + recognised.
  let sentinelLots = 0;
  let recall = null;
  if (recallSentinelPattern) {
    const ids = new Set();
    for (const p of pages) {
      const src = (recogniseFromMarkdown && p.markdown) ? p.markdown : String(p.html || '');
      for (const m of src.matchAll(recallSentinelPattern)) { if (m[1]) ids.add(m[1]); }
    }
    sentinelLots = ids.size;
    recall = recallRatio({ extractedLots: lots.length, sentinelLots });
  }

  return { lots, recall, sentinelLots, renderedPages: pages, recognised };
}
