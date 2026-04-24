// lib/pipeline/extractor.js — Modular extraction service
// Interface: extract(html, house, baseUrl, images) → { lots: Lot[], strategy, selectorMatched, domLotCount, aiLotCount }
// Emits structured events so the harness knows exactly what failed.

import { ExtractError, extractEvent } from './types.js';

let _deps = null;

export function initModularExtractor(deps) {
  _deps = deps;
}

/**
 * Extract lots from HTML using DOM → AI fallback with full diagnostics.
 *
 * @param {string} html - Raw HTML content
 * @param {string} house - House slug
 * @param {string} baseUrl - Base URL for resolving relative links
 * @param {string[]} images - Firecrawl image array (if available)
 * @returns {{ lots: object[], strategy: string, domLotCount: number, aiLotCount: number, selectorMatched: string|null, fieldCoverage: object }}
 */
export async function extract(html, house, baseUrl, images = []) {
  const startMs = Date.now();
  let lots = [];
  let strategy = 'none';
  let domLotCount = 0;
  let aiLotCount = 0;
  let selectorMatched = null;

  // ── Step 1: DOM extraction ──
  try {
    const domLots = _deps.extractWithJSDOM(html, house, baseUrl, images);
    domLotCount = domLots ? domLots.length : 0;

    if (domLots && domLots.length >= 3) {
      lots = domLots;
      strategy = 'dom';
      selectorMatched = _deps.getLastExtractorUsed?.() || 'dom-house';

      extractEvent(house, {
        event: 'extract_dom_success',
        lotCount: domLotCount,
        selector: selectorMatched,
        durationMs: Date.now() - startMs,
      });
    } else {
      // DOM returned too few lots — this is the key diagnostic
      extractEvent(house, {
        event: 'extract_dom_insufficient',
        lotCount: domLotCount,
        selector: selectorMatched,
        threshold: 3,
        htmlLength: html.length,
      });
    }
  } catch (err) {
    extractEvent(house, {
      event: 'extract_dom_error',
      error: err.message,
      selector: selectorMatched,
    });
  }

  // ── Step 2: AI fallback (if DOM found < 3) ──
  if (lots.length < 3 && !_deps.isCreditExhausted?.()) {
    try {
      const pages = [{ page: 1, html, markdown: '' }];
      const aiLots = await _deps.extractLotsWithAI(pages, house, null, baseUrl);
      aiLotCount = aiLots ? aiLots.length : 0;

      if (aiLots && aiLots.length > 0) {
        // DOM→AI merge: re-run DOM to harvest URLs + images
        const domHarvest = _deps.extractWithJSDOM(html, house, baseUrl, images);
        if (domHarvest && domHarvest.length > 0) {
          const merged = mergeDomai(aiLots, domHarvest);
          extractEvent(house, {
            event: 'extract_dom_ai_merge',
            aiLots: aiLotCount,
            domHarvestLots: domHarvest.length,
            urlsMerged: merged.urlsMerged,
            imgsMerged: merged.imgsMerged,
          });
        }

        lots = aiLots;
        strategy = domLotCount > 0 ? 'dom+ai' : 'ai';

        extractEvent(house, {
          event: 'extract_ai_success',
          lotCount: aiLotCount,
          strategy,
          durationMs: Date.now() - startMs,
        });
      }
    } catch (err) {
      extractEvent(house, {
        event: 'extract_ai_error',
        error: err.message,
        domLotCount,
      });
    }
  }

  // ── Step 3: Validate result ──
  if (lots.length === 0) {
    extractEvent(house, {
      event: 'extract_zero_lots',
      domLotCount,
      aiLotCount,
      htmlLength: html.length,
      durationMs: Date.now() - startMs,
    });

    throw new ExtractError(`Zero lots extracted for ${house}`, {
      house,
      strategy,
      lotCount: 0,
      selector: selectorMatched,
    });
  }

  // Field coverage analysis
  const fieldCoverage = computeFieldCoverage(lots);

  extractEvent(house, {
    event: 'extract_complete',
    lotCount: lots.length,
    strategy,
    domLotCount,
    aiLotCount,
    fieldCoverage,
    durationMs: Date.now() - startMs,
  });

  // ── Stamp extraction provenance onto each lot ──
  // Picked up by enrichLots() when it initialises the manifest, so the manifest
  // gets extract_strategy and extract_field_coverage without coupling this module
  // to enrichment-manifest directly.
  const aiTier = _deps.getLastAITier?.() || null;
  for (const lot of lots) {
    if (!lot._extractStrategy) lot._extractStrategy = strategy;
    if (!lot._extractAiTier && aiTier) lot._extractAiTier = aiTier;
    if (!lot._extractFieldCoverage) lot._extractFieldCoverage = fieldCoverage;
  }

  return { lots, strategy, domLotCount, aiLotCount, selectorMatched, fieldCoverage };
}

// ── DOM→AI merge logic (extracted for reuse) ──

function mergeDomai(aiLots, domHarvest) {
  const byLot = {};
  for (const d of domHarvest) { if (d.lot) byLot[d.lot] = d; }

  let urlsMerged = 0;
  let imgsMerged = 0;

  for (const lot of aiLots) {
    const d = byLot[lot.lot];
    if (d) {
      if (!lot.url && d.url) { lot.url = d.url; urlsMerged++; }
      if (!lot.imageUrl && d.imageUrl) { lot.imageUrl = d.imageUrl; imgsMerged++; }
    }
  }

  // Position-based fallback
  if (urlsMerged === 0 && imgsMerged === 0 && domHarvest.length >= aiLots.length * 0.5) {
    for (let i = 0; i < aiLots.length && i < domHarvest.length; i++) {
      if (!aiLots[i].url && domHarvest[i].url) { aiLots[i].url = domHarvest[i].url; urlsMerged++; }
      if (!aiLots[i].imageUrl && domHarvest[i].imageUrl) { aiLots[i].imageUrl = domHarvest[i].imageUrl; imgsMerged++; }
    }
  }

  return { urlsMerged, imgsMerged };
}

// ── Field coverage computation ──

function computeFieldCoverage(lots) {
  if (lots.length === 0) return {};
  const fields = ['address', 'price', 'imageUrl', 'url', 'beds', 'tenure'];
  const coverage = {};
  for (const f of fields) {
    const filled = lots.filter(l => l[f] != null && l[f] !== '' && l[f] !== 0).length;
    coverage[f] = Math.round((filled / lots.length) * 100);
  }
  return coverage;
}
