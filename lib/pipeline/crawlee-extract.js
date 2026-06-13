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
import { countSentinelIds } from '../scraper/recall-sentinels.js';
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
 * @param {'fast'|'capable'} [opts.tier] - extraction model tier (extraction-tier policy)
 * @param {Function} [opts.onExtract] - progress callback passed to extractLotsWithAI
 * @param {object} [deps] - test seams
 * @returns {Promise<{ lots, recall, sentinelLots, renderedPages, recognised }>}
 */
export async function renderAndExtractWithCrawlee(scrapeUrl, house, opts = {}, deps = {}) {
  const { maxPages, paginateAs, prefetchedPage1, deadlineAt, recallSentinelPattern, recogniseFromMarkdown, onExtract, tier } = opts;
  const _render = deps.scrapeAllPagesWithCrawlee || scrapeAllPagesWithCrawlee;
  const _extract = deps.extractLotsWithAI || extractLotsWithAI;
  const _toMarkdown = deps.htmlToRecognitionMarkdown || htmlToRecognitionMarkdown;

  const pages = await _render(scrapeUrl, house, { maxPages, paginateAs, prefetchedPage1, deadlineAt });
  if (!pages.length) return { lots: [], recall: null, sentinelLots: 0, renderedPages: [], recognised: 0 };

  // Bridge HTML → markdown for EVERY Crawlee page so the Gemini extractor sees
  // IMAGES (and links). The fallback when markdown is absent — stripHtml — DELETES
  // every <img> tag (validation.js), so non-recogniser Crawlee houses were
  // extracting with zero images: fleet image coverage fell to ~54% after the
  // Firecrawl→Crawlee transition (auctionhouselondon/suttonkersh/philliparnold at
  // 0%). Firecrawl fed Gemini markdown-with-images; this makes Crawlee match it.
  // The renderer (crawlee.js) already scrolls + materialises data-src→src, so the
  // srcs in this markdown are real. Recogniser houses additionally use it for the
  // markdown recovery + recall denominator below.
  for (const p of pages) { if (p.markdown == null) p.markdown = _toMarkdown(p.html, p.url || scrapeUrl); }

  const lots = (await _extract(pages, house, onExtract || null, scrapeUrl, { tier })) || [];

  // ── Markdown recognition recovery (Phase 3) ──
  // Recover lots the Gemini extractor missed by reading the turndown markdown.
  // Mirrors lib/pipeline/firecrawl-extract.js's JSON+markdown merge.
  let recognised = 0;
  if (recogniseFromMarkdown && recallSentinelPattern) {
    // Preserve flags minus 'g' (a global regex used with .match keeps lastIndex
    // state); markjenkinson's sentinel needs 'i'.
    const jsonIdRegex = new RegExp(recallSentinelPattern.source, recallSentinelPattern.flags.replace('g', ''));
    const idOf = (lot) => (lot.url || '').match(jsonIdRegex)?.[1];
    const haveIds = new Set(lots.map(idOf).filter(Boolean));
    const haveKeys = new Set(lots.map(addrKey));
    let statusCorrected = 0;
    let imagesFilled = 0;
    for (const p of pages) {
      const md = p.markdown || '';
      const mdIds = new Set([...md.matchAll(recallSentinelPattern)].map(m => m[1]).filter(Boolean));
      if (!mdIds.size) continue;
      const recoveredMap = recogniseFromMarkdown(md);
      if (!recoveredMap || typeof recoveredMap.get !== 'function' || recoveredMap.size === 0) continue;

      // ── Corroboration: the recogniser parses status badges (and the hero
      // image) off the page deterministically; the AI extractor INFERS them
      // and, on overlay-heavy pages, smears SOLD/STC onto available lots
      // (Maggs 2026-05-11 and 2026-06-13: page showed 31 available / 6 sold,
      // extractor persisted 0 available → get_active_lots hid the house).
      // Where both saw the same lot id, the recogniser's parse wins.
      for (const lot of lots) {
        const rec = recoveredMap.get(idOf(lot));
        if (!rec) continue;
        if (rec.lot_status && lot.status !== rec.lot_status) { lot.status = rec.lot_status; statusCorrected++; }
        if (!lot.imageUrl && rec.image_url) { lot.imageUrl = rec.image_url; imagesFilled++; }
      }

      const missing = [...mdIds].filter(id => !haveIds.has(id));
      for (const id of missing) {
        const lot = recoveredMap.get(id);
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
    if (statusCorrected > 0 || imagesFilled > 0) {
      console.log(`AUTO: ${house} — recogniser corroboration: ${statusCorrected} status(es), ${imagesFilled} image(s) adopted from markdown`);
    }
    if (recognised > 0) console.log(`AUTO: ${house} — Crawlee markdown recognised ${recognised} extra lots`);
  }

  // Recall against the house's sentinel: distinct lot IDs advertised vs lots
  // extracted + recognised. Use the turndown markdown when available; otherwise
  // strip <script>/<style> from the HTML first so sentinel matches inside inline
  // JSON / analytics don't inflate the denominator (which would make Crawlee's
  // recall look falsely low vs Firecrawl's markdown-based recall). (review F11)
  let sentinelLots = 0;
  let recall = null;
  if (recallSentinelPattern) {
    sentinelLots = countSentinelIds(pages, recallSentinelPattern, { preferMarkdown: !!recogniseFromMarkdown });
    recall = recallRatio({ extractedLots: lots.length, sentinelLots });
  }

  return { lots, recall, sentinelLots, renderedPages: pages, recognised };
}
