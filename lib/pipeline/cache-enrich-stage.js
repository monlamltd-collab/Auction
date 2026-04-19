// lib/pipeline/cache-enrich-stage.js — Cache-hit enrichment stage
// When a house already has a fresh cache with lots, this stage progressively
// backfills missing data (images, Allsop URLs) without re-scraping the catalogue.
//
// Inputs:  { auction, normalisedUrl, cachedLots, cachedTotalLots }
// Outputs: { action: 'skipped'|'enriched', updated: boolean }
//
// Image backfill cascade (each pass only runs if previous still left gaps):
//   1. Allsop API enrichment (Allsop-specific: broken URLs + images)
//   2. HTTP backfill from catalogue page
//   3. Deep backfill from individual lot pages (fetchLotPage)
//   4. Firecrawl rendered backfill (for PUPPETEER_IMAGE_HOUSES)
//   5. Puppeteer rendered backfill (fallback)
//
// Dependencies injected via `deps` to keep this module pure.

import { HOUSE_DISPLAY_NAMES, PUPPETEER_IMAGE_HOUSES } from '../houses.js';

/**
 * @param {object} ctx - Pipeline context
 * @param {object} ctx.auction - Auction calendar entry { house, url, ... }
 * @param {string} ctx.normalisedUrl - Normalised URL for DB lookups
 * @param {Array}  ctx.cachedLots - Lots loaded from DB (already mapped via dbRowToFrontendLot)
 * @param {number} ctx.cachedTotalLots - Total lots from cached_analyses row
 * @param {object} deps - Injected dependencies
 * @param {function} deps.rewriteUrl
 * @param {function} deps.scrapeAllsopApi
 * @param {function} deps.enrichAllsopLots
 * @param {function} deps.backfillImages - HTTP-based catalogue page image backfill
 * @param {function} deps.backfillImagesFromLotPages - Per-lot-page deep backfill
 * @param {function} deps.backfillImagesWithFirecrawl
 * @param {function} deps.backfillImagesWithPuppeteer
 * @param {function} deps.normaliseLotStatuses
 * @param {function} deps.upsertToLotsTable
 * @param {string|undefined} deps.FIRECRAWL_API_KEY
 * @param {function} deps.isFcCreditExhausted
 * @param {object|null} deps.puppeteer
 * @returns {Promise<{ action: string, updated: boolean }>}
 */
export async function cacheEnrichStage(ctx, deps) {
  const { auction, normalisedUrl, cachedLots, cachedTotalLots } = ctx;
  const house = auction.house;
  let needsUpdate = false;

  // ── Pass 1: Allsop-specific URL fix + API enrichment ──
  if (house === 'allsop') {
    const enriched = await _enrichAllsop(auction, cachedLots, deps);
    if (enriched) needsUpdate = true;
  }

  // ── Pass 2–5: Image backfill cascade ──
  const imageResult = await _backfillImageCascade(auction, cachedLots, deps);
  if (imageResult.gained > 0) needsUpdate = true;

  // ── Persist if anything changed ──
  if (needsUpdate) {
    deps.normaliseLotStatuses(cachedLots);
    await deps.upsertToLotsTable(cachedLots, house, auction.url, {
      scrapedWith: 'cache-enrichment',
    });
    console.log(`AUTO: ✓ ${house} — synced enriched lots to lots table`);
  } else {
    console.log(`AUTO: ✓ ${house} already cached (${cachedTotalLots} lots)`);
  }

  return { action: needsUpdate ? 'enriched' : 'skipped', updated: needsUpdate };
}

// ── Allsop: fix broken lot URLs and enrich with API data (including images) ──
async function _enrichAllsop(auction, lots, deps) {
  const brokenUrls = lots.filter(l => l.url && /allsop\.co\.uk\/lot\/\d+/i.test(l.url)).length;
  const missingImages = lots.filter(l => !l.imageUrl).length;

  if (brokenUrls === 0 && missingImages === 0) return false;

  try {
    const rewritten = await deps.rewriteUrl(auction.url, 'allsop');
    if (!rewritten?.isApi) return false;

    const pages = await deps.scrapeAllsopApi(rewritten.baseUrl);
    if (pages.length === 0) return false;

    deps.enrichAllsopLots(lots, pages);
    for (const lot of lots) {
      if (lot.reference) {
        lot.url = `https://www.allsop.co.uk/lot-overview/lot/${lot.reference}`;
      }
    }
    const newImagesGained = missingImages - lots.filter(l => !l.imageUrl).length;
    console.log(`AUTO: ✓ ${auction.house} — fixed ${brokenUrls} broken URLs, gained ${newImagesGained} images`);
    return true;
  } catch (e) {
    console.log(`AUTO: Allsop URL fix failed: ${e.message}`);
    return false;
  }
}

// ── Image backfill cascade: HTTP → lot pages → Firecrawl → Puppeteer ──
async function _backfillImageCascade(auction, lots, deps) {
  let totalGained = 0;
  const house = auction.house;

  const missingBefore = lots.filter(l => !l.imageUrl).length;
  if (missingBefore === 0) return { gained: 0 };

  // Pass 2: HTTP backfill from catalogue page
  const lotsWithUrl = lots.filter(l => l.url && !l.imageUrl).length;
  if (lotsWithUrl > 0) {
    const updated = await deps.backfillImages(auction.url, lots);
    if (updated) {
      const gained = updated.filter(l => l.imageUrl).length;
      totalGained += gained;
      console.log(`AUTO: ✓ ${house} — HTTP backfill got ${gained} images`);
    }

    // Pass 3: Deep backfill from individual lot pages
    const stillMissing = lots.filter(l => l.url && !l.imageUrl).length;
    if (stillMissing > 0) {
      const deepFilled = await deps.backfillImagesFromLotPages(lots);
      if (deepFilled > 0) totalGained += deepFilled;
    }
  }

  // Pass 4–5: Rendered backfill (Firecrawl then Puppeteer)
  const stillNoImages = lots.filter(l => !l.imageUrl).length;
  const houseSlug = Object.entries(HOUSE_DISPLAY_NAMES).find(([k, v]) => v === house)?.[0] || house;

  if (stillNoImages > 0 && PUPPETEER_IMAGE_HOUSES.has(houseSlug)) {
    console.log(`AUTO: ${house} — ${stillNoImages} lots still missing images, trying rendered backfill...`);

    // Pass 4: Firecrawl
    if (deps.FIRECRAWL_API_KEY && !deps.isFcCreditExhausted()) {
      const gained = await deps.backfillImagesWithFirecrawl(auction.url, lots, houseSlug);
      totalGained += gained;
    }

    // Pass 5: Puppeteer
    const afterFc = lots.filter(l => !l.imageUrl).length;
    if (afterFc > 0 && deps.puppeteer) {
      const gained = await deps.backfillImagesWithPuppeteer(auction.url, lots, houseSlug);
      totalGained += gained;
    }
  }

  return { gained: totalGained };
}
