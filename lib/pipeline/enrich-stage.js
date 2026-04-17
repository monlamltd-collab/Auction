// lib/pipeline/enrich-stage.js — Scoring + enrichment stage
// Takes raw lots from the scrape stage, scores them, and runs all enrichment
// passes (EPC/flood/tenure, image backfill, fundability badges).
//
// Inputs:  { rawLots, house, url }
// Outputs: { lots }  (scored + enriched, sorted by score desc)
//
// Dependencies injected via `deps` to keep this module pure.

import { PUPPETEER_IMAGE_HOUSES } from '../houses.js';
import { enrichLotsWithFundability } from '../fundability.js';

/**
 * @param {object} ctx - Pipeline context
 * @param {Array} ctx.rawLots - Unscored lots from scrape stage
 * @param {string} ctx.house - Detected house slug
 * @param {string} ctx.url - Original catalogue URL
 * @param {object} deps - Injected dependencies
 * @param {function} deps.analyseLot - Scoring function (raw → scored lot)
 * @param {function} deps.enrichLots - EPC/flood/tenure enrichment
 * @param {function} deps.enrichLotsFromLotPages - Unified lot-page enrichment
 * @param {function} deps.backfillImagesWithFirecrawl
 * @param {function} deps.backfillImagesWithPuppeteer
 * @param {string|undefined} deps.FIRECRAWL_API_KEY
 * @param {function} deps.isFcCreditExhausted
 * @param {object|null} deps.puppeteer
 * @returns {Promise<{ lots: Array }>}
 */
export async function enrichStage(ctx, deps) {
  const { rawLots, house, url } = ctx;

  // ── Score and sort ──
  let lots = rawLots.map(lot => deps.analyseLot(lot)).sort((a, b) => b.score - a.score);

  // ── Primary enrichment: EPC, flood, tenure ──
  await deps.enrichLots(lots, house, url);

  // ── Unified lot-page enrichment: single fetch per lot ──
  await deps.enrichLotsFromLotPages(lots);

  // ── Rendered page backfill for JS-rendered sites ──
  const preBackfillImgs = lots.filter(l => l.imageUrl).length;
  const stillNoImg = lots.length - preBackfillImgs;
  if (stillNoImg > 0 && PUPPETEER_IMAGE_HOUSES.has(house)) {
    // Pass 1: Firecrawl (with executeJavascript to force lazy-load + images format)
    if (deps.FIRECRAWL_API_KEY && !deps.isFcCreditExhausted()) {
      await deps.backfillImagesWithFirecrawl(url, lots, house);
    }
    const afterFc = lots.filter(l => l.imageUrl).length;
    // Pass 2: Puppeteer for any remaining misses
    const stillMissing = lots.length - afterFc;
    if (stillMissing > 0 && deps.puppeteer) {
      await deps.backfillImagesWithPuppeteer(url, lots, house);
    }
    const afterPup = lots.filter(l => l.imageUrl).length;
    console.log(`AUTO: ${house}: image backfill: ${preBackfillImgs}/${lots.length} before → ${afterFc} after Firecrawl → ${afterPup} after Puppeteer (${lots.length - afterPup} still missing)`);
  } else if (stillNoImg > 0) {
    console.log(`AUTO: ${house}: ${stillNoImg}/${lots.length} lots missing images (not in PUPPETEER_IMAGE_HOUSES — no backfill)`);
  }

  // ── Fundability badges — fire-and-forget, never blocks pipeline ──
  try {
    await enrichLotsWithFundability(lots);
  } catch (e) {
    console.warn('Fundability enrichment failed (non-fatal):', e.message);
  }

  return { lots };
}
