// lib/pipeline/extractor.js — Modular extraction service
// Interface: extract(html, house, baseUrl, images) → { lots, strategy, aiLotCount, fieldCoverage }
//
// Legacy fallback for the rare case where the upstream Firecrawl JSON path
// returns 0 lots. AI-only (Gemini). The DOM-extraction step was retired
// 2026-05-08 as part of the Firecrawl-only migration — see
// lib/pipeline/firecrawl-extract.js for the primary path.

import { ExtractError, extractEvent } from './types.js';
import { stampSourceIfEmpty } from '../quality/field-source.js';
import { unwrapProxyImageUrl } from '../scraper/validation.js';

// Fields stamped with extractor provenance. We only stamp the columns that
// downstream code reads back (filtering, scoring, search, fundability) — no
// point claiming provenance for transient internal flags. Detail-page and
// OS Places stamps run later and overwrite where they actually contributed.
const EXTRACTOR_STAMPABLE_FIELDS = [
  'address', 'postcode', 'price', 'priceText', 'propType', 'beds',
  'tenure', 'leaseLength', 'sqft', 'condition', 'imageUrl', 'units',
  'vacant', 'titleSplit', 'dealType',
];

function stampExtractorProvenance(lots, source) {
  for (const lot of lots) {
    for (const field of EXTRACTOR_STAMPABLE_FIELDS) {
      stampSourceIfEmpty(lot, field, source);
    }
  }
}

let _deps = null;

export function initModularExtractor(deps) {
  _deps = deps;
}

/**
 * Extract lots from HTML via Gemini AI fallback. The primary catalogue path
 * is Firecrawl JSON extract (see lib/pipeline/firecrawl-extract.js); this
 * function is the legacy AI-only fallback when Firecrawl returns 0 lots.
 *
 * @param {string} html - Raw HTML content
 * @param {string} house - House slug
 * @param {string} baseUrl - Base URL for resolving relative links
 * @returns {{ lots: object[], strategy: string, aiLotCount: number, fieldCoverage: object }}
 */
export async function extract(html, house, baseUrl /* , images */) {
  const startMs = Date.now();
  let lots = [];
  let strategy = 'none';
  let aiLotCount = 0;

  if (_deps.isCreditExhausted?.()) {
    extractEvent(house, {
      event: 'extract_skipped_credit_exhausted',
      htmlLength: html.length,
    });
  } else {
    try {
      const pages = [{ page: 1, html, markdown: '' }];
      const aiLots = await _deps.extractLotsWithAI(pages, house, null, baseUrl);
      aiLotCount = aiLots ? aiLots.length : 0;

      if (aiLots && aiLots.length > 0) {
        for (const lot of aiLots) {
          if (lot && lot.imageUrl) lot.imageUrl = unwrapProxyImageUrl(lot.imageUrl);
        }
        lots = aiLots;
        strategy = 'ai';
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
      });
    }
  }

  if (lots.length === 0) {
    extractEvent(house, {
      event: 'extract_zero_lots',
      aiLotCount,
      htmlLength: html.length,
      durationMs: Date.now() - startMs,
    });

    throw new ExtractError(`Zero lots extracted for ${house}`, {
      house,
      strategy,
      lotCount: 0,
    });
  }

  const fieldCoverage = computeFieldCoverage(lots);

  extractEvent(house, {
    event: 'extract_complete',
    lotCount: lots.length,
    strategy,
    aiLotCount,
    fieldCoverage,
    durationMs: Date.now() - startMs,
  });

  // ── Stamp extraction provenance onto each lot ──
  const aiTier = _deps.getLastAITier?.() || null;
  for (const lot of lots) {
    if (!lot._extractStrategy) lot._extractStrategy = strategy;
    if (!lot._extractAiTier && aiTier) lot._extractAiTier = aiTier;
    if (!lot._extractFieldCoverage) lot._extractFieldCoverage = fieldCoverage;
  }

  stampExtractorProvenance(lots, 'gemini-catalogue');

  return { lots, strategy, aiLotCount, fieldCoverage };
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
