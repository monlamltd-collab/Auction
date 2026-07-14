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

// Wall-clock budget for the lot-page (detail) enrichment phase. A house whose
// detail site hangs a fetch (mchughandco.com 2026-06-13 — hung past the 15s
// per-fetch timeout, never returning) would otherwise block persist forever and
// the house silently delivers ZERO despite 100% recall. Cap the phase: on
// timeout we proceed to persist with the recogniser's catalogue data (the
// in-flight enrichment keeps running harmlessly, mutating lots in place).
const LOT_PAGE_ENRICH_BUDGET_MS = parseInt(process.env.LOT_PAGE_ENRICH_BUDGET_MS || '90000', 10);

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

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
// Supabase/PostgREST puts an `.in()` list in the GET query string, so a single
// lookup of every scraped URL overflows the URL-length limit for a dense house
// (purplebricksgoto alone has ~2,900 available lots → HTTP 414). Batch the
// membership check so each request stays well under the limit.
const FIRST_CONTACT_URL_BATCH = 200;

// `db` is injectable so the batching + fail-closed behaviour can be unit-tested
// with a mock client; production callers pass nothing and get the module client.
export async function flagFirstContact(lots, house, db = supabase) {
  if (!lots || !lots.length) return;
  if (!db) {
    for (const l of lots) l._isFirstContact = true;
    return;
  }
  const urls = lots.map(l => l.url).filter(Boolean);
  if (!urls.length) return;

  const houseSlug = (house || '').toLowerCase();
  // URLs already persisted (not first-contact). We also add URLs whose
  // membership we COULDN'T determine — a lookup error means we fail CLOSED
  // (treat as known), because failing OPEN flags the whole catalogue as
  // first-contact and re-runs vision image classification on every image every
  // cycle. That silent full-catalogue reclassification was the flash-lite
  // cost blow-out this guards against; an over-large `.in()` returns
  // `{ data: null, error }` (no throw), so the previous `{ data }`-only
  // destructure silently produced an empty known-set → everything "new".
  const known = new Set();

  for (let i = 0; i < urls.length; i += FIRST_CONTACT_URL_BATCH) {
    const batch = urls.slice(i, i + FIRST_CONTACT_URL_BATCH);
    let data = null;
    let error = null;
    try {
      ({ data, error } = await db
        .from('lots')
        .select('url')
        .eq('house', houseSlug)
        .in('url', batch));
    } catch (err) {
      error = err;
    }
    if (error) {
      // Fail closed: record the reason (silent failures are banned) and treat
      // this batch as already-seen so a DB hiccup can't trigger a full-
      // catalogue image reclassification.
      console.warn(`first-contact lookup failed for ${batch.length} ${houseSlug} URLs (treating as known): ${error.message}`);
      for (const u of batch) known.add(u);
      continue;
    }
    for (const r of (data || [])) known.add(r.url);
  }

  for (const l of lots) {
    if (l.url && !known.has(l.url)) l._isFirstContact = true;
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
          // os_classification dropped in the lean rebuild — no longer stamped.
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
  // Non-fatal: enrichment must NEVER abort the scrape before persist — a throw
  // here previously discarded a house's entire catalogue (mchughandco 2026-06-13:
  // extracted 271 lots at 100% recall, persisted 0). The recogniser already gives
  // us catalogue-quality data; persist it even if enrichment partially fails, and
  // the next cycle / hygiene wave fills the gaps.
  try {
    await deps.enrichLots(lots, house, url);
  } catch (e) {
    console.warn(`AUTO: ${house}: primary enrichment failed (non-fatal): ${e.message}`);
  }

  // ── Unified lot-page enrichment: single fetch per lot ──
  // First-contact lots are flagged; enrichLotsFromLotPages honours the flag
  // by treating them as forced targets even if the catalogue had every field.
  try {
    await withTimeout(deps.enrichLotsFromLotPages(lots), LOT_PAGE_ENRICH_BUDGET_MS, 'lot-page enrichment');
  } catch (e) {
    console.warn(`AUTO: ${house}: lot-page enrichment failed/timed out (non-fatal): ${e.message}`);
  }

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
    // Pass 2: Puppeteer for any remaining misses — retired no-op since
    // 2026-05-08; callers may no longer wire it into deps (2026-06-12
    // incident: iamsold/halls all-tiers failure), so guard before calling.
    const stillMissing = lots.length - afterFc;
    if (stillMissing > 0 && deps.puppeteer && typeof deps.backfillImagesWithPuppeteer === 'function') {
      await deps.backfillImagesWithPuppeteer(url, lots, house);
    }
    const afterPup = lots.filter(l => l.imageUrl).length;
    console.log(`AUTO: ${house}: image backfill: ${preBackfillImgs}/${lots.length} before → ${afterFc} after Firecrawl → ${afterPup} after Puppeteer (${lots.length - afterPup} still missing)`);
  } else if (stillNoImg > 0) {
    console.log(`AUTO: ${house}: ${stillNoImg}/${lots.length} lots missing images (not in PUPPETEER_IMAGE_HOUSES — no backfill)`);
  }

  // ── Image quality filter: reject logos, banners, stock photos ──
  // Vision classification via OpenRouter (ai-provider.callVisionAI) or legacy
  // direct Gemini — runs when EITHER key is set (not just GEMINI_API_KEY, which
  // is the dead free tier; OpenRouter is the live paid path).
  // Only FIRST-CONTACT lots are classified: re-scrapes skip lots vetted on a
  // prior pass, so we don't re-pay vision cost+latency for the whole catalogue
  // every cycle (a dense house = hundreds of sequential calls = minutes + $).
  // Bounded concurrency keeps the first-contact batch fast (callVisionAI is
  // itself rate-limited, so this mainly overlaps the image fetches).
  if (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY) {
    try {
      const { filterImages } = await import('./image-quality-filter.js');
      const targets = lots.filter(l => l._isFirstContact && [l.imageUrl, ...(l.images || [])].filter(Boolean).length > 0);
      let filtered = 0;
      const CONCURRENCY = 6;
      for (let i = 0; i < targets.length; i += CONCURRENCY) {
        await Promise.all(targets.slice(i, i + CONCURRENCY).map(async (lot) => {
          const allUrls = [lot.imageUrl, ...(lot.images || [])].filter(Boolean);
          const { keep, discard, primary } = await filterImages(allUrls);
          if (discard.length > 0) {
            filtered += discard.length;
            lot.images = keep;
            lot.imageUrl = primary;
          }
        }));
      }
      if (filtered > 0) console.log(`AUTO: ${house}: image quality filter discarded ${filtered} non-property images (${targets.length} first-contact lots checked)`);
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
