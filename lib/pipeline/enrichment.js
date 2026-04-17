// lib/pipeline/enrichment.js — Modular enrichment service
// Split from scorer.js: scoring is pure (no deps), enrichment is agentic (external APIs).
// Interface: enrich(lots, house, url), backfillImages(lots, house, url), addFundability(lots), coverage(lots)

import { scoreEvent } from './types.js';

export class EnrichmentService {
  /**
   * @param {object} opts
   * @param {Function} opts.enrichLots - EPC, flood, Land Registry enrichment
   * @param {Function} opts.enrichLotsFromLotPages - Per-lot-page enrichment (tenure, beds)
   * @param {Function} opts.enrichLotsWithFundability - BridgeMatch fundability badges
   * @param {Function} opts.backfillImagesWithFirecrawl - Image backfill via Firecrawl
   * @param {Function} opts.backfillImagesWithPuppeteer - Image backfill via Puppeteer
   * @param {import('../resource-budget.js').ResourceBudget} opts.budget - Resource budget instance
   */
  constructor({ enrichLots, enrichLotsFromLotPages, enrichLotsWithFundability,
                backfillImagesWithFirecrawl, backfillImagesWithPuppeteer, budget }) {
    this._enrichLots = enrichLots;
    this._enrichLotsFromLotPages = enrichLotsFromLotPages;
    this._enrichLotsWithFundability = enrichLotsWithFundability;
    this._backfillImagesWithFirecrawl = backfillImagesWithFirecrawl;
    this._backfillImagesWithPuppeteer = backfillImagesWithPuppeteer;
    this._budget = budget;
  }

  /**
   * Core enrichment: EPC, flood risk, Land Registry, lot-page data.
   * @returns {{ epc: number, flood: number }} counts of enriched lots
   */
  async enrich(lots, house, url) {
    const results = { epc: 0, flood: 0 };

    try {
      await this._enrichLots(lots, house, url);
      results.epc = lots.filter(l => l.epcRating).length;
      results.flood = lots.filter(l => l.floodRisk != null).length;

      scoreEvent(house, {
        event: 'enrich_complete',
        epc: results.epc,
        flood: results.flood,
        total: lots.length,
      });
    } catch (err) {
      scoreEvent(house, {
        event: 'enrich_error',
        error: err.message,
      });
    }

    // Lot-page enrichment (tenure, beds from individual lot pages)
    try {
      await this._enrichLotsFromLotPages(lots);
    } catch (err) {
      scoreEvent(house, {
        event: 'enrich_lot_pages_error',
        error: err.message,
      });
    }

    return results;
  }

  /**
   * Image backfill: Firecrawl first, then Puppeteer for remaining gaps.
   * @returns {{ before: number, after: number, total: number }}
   */
  async backfillImages(lots, house, url) {
    const missing = lots.filter(l => !l.imageUrl).length;
    if (missing === 0) return { before: lots.length, after: lots.length, total: lots.length };

    const before = lots.length - missing;

    // Pass 1: Firecrawl
    if (this._budget.canUseFirecrawl()) {
      try {
        await this._backfillImagesWithFirecrawl(url, lots, house);
      } catch (err) {
        scoreEvent(house, { event: 'image_backfill_fc_error', error: err.message });
      }
    }

    // Pass 2: Puppeteer for remaining
    const stillMissing = lots.filter(l => !l.imageUrl).length;
    if (stillMissing > 0 && this._budget.hasPuppeteer()) {
      try {
        await this._backfillImagesWithPuppeteer(url, lots, house);
      } catch (err) {
        scoreEvent(house, { event: 'image_backfill_pup_error', error: err.message });
      }
    }

    const after = lots.filter(l => l.imageUrl).length;

    scoreEvent(house, {
      event: 'image_backfill_complete',
      before,
      after,
      total: lots.length,
    });

    return { before, after, total: lots.length };
  }

  /**
   * Add fundability badges from BridgeMatch lender matching.
   */
  async addFundability(lots) {
    try {
      await this._enrichLotsWithFundability(lots);
    } catch {
      // Non-fatal — fundability is supplementary
    }
  }

  /**
   * Compute field coverage percentages for a batch of lots.
   */
  coverage(lots) {
    if (!lots || lots.length === 0) return {};
    const fields = ['address', 'price', 'imageUrl', 'url', 'beds', 'tenure', 'epcRating'];
    const cov = {};
    for (const f of fields) {
      const filled = lots.filter(l => l[f] != null && l[f] !== '' && l[f] !== 0).length;
      cov[f] = Math.round((filled / lots.length) * 100);
    }
    return cov;
  }
}
