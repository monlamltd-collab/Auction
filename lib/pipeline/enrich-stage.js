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
import { supabase } from '../supabase.js';
import { lookupAddress } from '../os-places.js';
import { lookupPostcode } from '../postcodes-io.js';
import { setField } from '../quality/field-source.js';
import { createManifest, recordOsPlaces, recordPostcodesIo } from '../enrichment-manifest.js';

const OS_PLACES_CONCURRENCY = 4;

// Statuses that are worth retrying — the address might match later (transient
// failure) or might match once the address text gets canonicalised by a later
// pass (no_match). 'cache_hit_no_match' is excluded because the cache layer
// is already absorbing the cost — re-attempting wouldn't change anything
// until the negative cache expires.
const OS_PLACES_RETRY_STATUSES = new Set(['circuit_open', 'timeout', 'api_error', 'no_match']);

/**
 * Detect first-contact lots by checking which URLs are already in lots table.
 * Stamps `_isFirstContact = true` on lots whose URL has never been persisted.
 *
 * Tolerates a missing supabase client (returns all lots flagged as first-contact)
 * — tests + offline runs still get the depth boost.
 */
async function flagFirstContact(lots, house) {
  if (!lots || !lots.length) return;
  if (!supabase) {
    for (const l of lots) l._isFirstContact = true;
    return;
  }
  const urls = lots.map(l => l.url).filter(Boolean);
  if (!urls.length) return;
  try {
    const { data } = await supabase
      .from('lots')
      .select('url')
      .eq('house', (house || '').toLowerCase())
      .in('url', urls);
    const known = new Set((data || []).map(r => r.url));
    for (const l of lots) {
      if (l.url && !known.has(l.url)) l._isFirstContact = true;
    }
  } catch (err) {
    // DB hiccup is non-fatal — fall back to "treat unknown as first-contact"
    console.warn(`first-contact detection failed (treating all as new): ${err.message}`);
    for (const l of lots) l._isFirstContact = true;
  }
}

/**
 * Run OS Places lookup against every lot that still needs a UPRN
 * (concurrency-capped). Stamps uprn / lat / lng / canonical address with
 * 'os-places' provenance and records a manifest entry on each lot.
 *
 * Targeting (COVERAGE_FIX_PLAN.md fix #2 — replaces _isFirstContact gating):
 *   • First-contact lots (no DB row yet) — same as before, kitchen-sink pass.
 *   • Returning lots with `lot.uprn` still null — re-attempt every cycle.
 *     Cache hits cost nothing; live calls are cheap (100k/month free tier);
 *     so the trade-off is heavily in favour of recovery over conservation.
 */
async function runOsPlacesPass(lots) {
  const targets = lots.filter(l =>
    (l._isFirstContact || !l.uprn) && (l.address || '').length >= 5,
  );
  if (!targets.length) return;

  for (let i = 0; i < targets.length; i += OS_PLACES_CONCURRENCY) {
    const batch = targets.slice(i, i + OS_PLACES_CONCURRENCY);
    await Promise.allSettled(batch.map(async lot => {
      try {
        const result = await lookupAddress(lot);
        if (!result) return;

        // Manifest entry — captures status whether or not we got a hit.
        // Use lot._enrichment (the canonical name persisted by persist-lots.js:178);
        // initialise via createManifest() to match lib/enrichment.js:917 pattern.
        if (!lot._enrichment) lot._enrichment = createManifest();
        recordOsPlaces(lot._enrichment, {
          status: result.status,
          uprn: result.uprn || null,
          matchScore: result.matchScore ?? null,
          httpStatus: result.httpStatus ?? null,
        });

        // Scrape-time enqueue: lots don't have a DB id yet, so we stash the
        // retry intent on the lot and let persistStage flush it after upsert.
        // COVERAGE_FIX_PLAN.md fix #4 — without this, transient failures had
        // to wait for the next hygiene wave (~6h) to be queued.
        if (OS_PLACES_RETRY_STATUSES.has(result.status)) {
          lot._osPlacesRetry = {
            reason: result.status,
            error: result.error || null,
          };
        }

        if (result.status === 'ok' || result.status === 'cache_hit') {
          if (result.uprn) setField(lot, 'uprn', result.uprn, 'os-places');
          if (result.fullAddress && (!lot.address || lot.address.length < result.fullAddress.length)) {
            setField(lot, 'address', result.fullAddress, 'os-places');
          }
          // Stamp under public column names so field_sources keys match the
          // DB schema. Mirror to lot._lat/_lng for back-compat with
          // lib/enrichment.js:988 + persist-lots.js:174 which still read
          // the underscore form (will be retired in Phase D).
          if (result.lat != null) {
            setField(lot, 'lat', result.lat, 'os-places');
            lot._lat = result.lat;
          }
          if (result.lng != null) {
            setField(lot, 'lng', result.lng, 'os-places');
            lot._lng = result.lng;
          }
          if (result.classificationCode) {
            setField(lot, 'os_classification', result.classificationCode, 'os-places');
          }
          recordPostcodesIo(lot._enrichment, { status: 'skipped_not_needed' });
        } else if ((result.status === 'no_match' || result.status === 'low_confidence')
                   && lot.postcode
                   && (!lot.lat || !lot.lng)) {
          // OS Places couldn't pin the lot, but if we have a postcode we can
          // still get postcode-centroid lat/lng from postcodes.io. UPRN stays
          // null (only OS Places gives that), but the lat/lng unblocks radius
          // search, EPC-by-postcode, and Land-Registry-by-postcode flows.
          // COVERAGE_FIX_PLAN.md fix #5 (Phase 1).
          await runPostcodesIoFallback(lot);
        } else {
          recordPostcodesIo(lot._enrichment, {
            status: lot.postcode ? 'skipped_not_needed' : 'skipped_no_postcode',
          });
        }
      } catch (err) {
        console.warn(`OS Places lookup error (${lot.url}): ${err.message}`);
      }
    }));
  }
}

/**
 * postcodes.io fallback — runs only after OS Places returned no_match /
 * low_confidence and we have a postcode. Stamps lat/lng with 'postcodes-io'
 * provenance. Never sets uprn (postcodes.io doesn't have it).
 */
async function runPostcodesIoFallback(lot) {
  try {
    const result = await lookupPostcode(lot.postcode);
    if (!result) {
      recordPostcodesIo(lot._enrichment, { status: 'api_error' });
      return;
    }
    recordPostcodesIo(lot._enrichment, { status: result.status });
    if (result.status !== 'ok') return;

    if (result.lat != null && lot.lat == null) {
      setField(lot, 'lat', result.lat, 'postcodes-io');
      lot._lat = result.lat;
    }
    if (result.lng != null && lot.lng == null) {
      setField(lot, 'lng', result.lng, 'postcodes-io');
      lot._lng = result.lng;
    }
  } catch (err) {
    recordPostcodesIo(lot._enrichment, { status: 'api_error' });
    console.warn(`postcodes.io fallback error (${lot.url}): ${err.message}`);
  }
}

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

  // ── First-contact detection (Phase A) ──
  // Lots whose URL hasn't been seen before get the kitchen-sink treatment:
  // forced detail-page fetch even on rich catalogues + OS Places UPRN lookup.
  await flagFirstContact(lots, house);
  const firstContactCount = lots.filter(l => l._isFirstContact).length;
  if (firstContactCount > 0) {
    console.log(`AUTO: ${house}: ${firstContactCount}/${lots.length} lots are first-contact — running deep extraction`);
  }

  // ── Primary enrichment: EPC, flood, tenure ──
  await deps.enrichLots(lots, house, url);

  // ── Unified lot-page enrichment: single fetch per lot ──
  // First-contact lots are flagged; enrichLotsFromLotPages honours the flag
  // by treating them as forced targets even if the catalogue had every field.
  await deps.enrichLotsFromLotPages(lots);

  // ── OS Places: stamp UPRN + canonical address on every new lot ──
  // Runs after lot-page enrichment so the address field has had a chance to
  // be improved from the detail page before we hand it to OS Places.
  try {
    await runOsPlacesPass(lots);
  } catch (e) {
    console.warn('OS Places pass failed (non-fatal):', e.message);
  }

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

  // ── Image quality filter: reject logos, banners, stock photos ──
  // Runs on every lot that has images, using Gemini Flash vision.
  // Replaces the old hero_image_bleed self-healing pattern — junk
  // is rejected at the boundary instead of detected post-persist.
  if (process.env.GEMINI_API_KEY) {
    try {
      const { filterImages } = await import('./image-quality-filter.js');
      let filtered = 0;
      for (const lot of lots) {
        const allUrls = [lot.imageUrl, ...(lot.images || [])].filter(Boolean);
        if (allUrls.length === 0) continue;
        const { keep, discard, primary } = await filterImages(allUrls);
        if (discard.length > 0) {
          filtered += discard.length;
          lot.images = keep;
          lot.imageUrl = primary;
        }
      }
      if (filtered > 0) console.log(`AUTO: ${house}: image quality filter discarded ${filtered} non-property images`);
    } catch (e) {
      console.warn(`Image quality filter failed (non-fatal): ${e.message}`);
    }
  }

  // ── Fundability badges — fire-and-forget, never blocks pipeline ──
  try {
    await enrichLotsWithFundability(lots);
  } catch (e) {
    console.warn('Fundability enrichment failed (non-fatal):', e.message);
  }

  return { lots };
}
