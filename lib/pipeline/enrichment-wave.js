// lib/pipeline/enrichment-wave.js — Multi-pass data hygiene: price hunt, postcode rescue, enrichment, lot-page deep fill, UPRN/retry drain
import { supabase } from '../supabase.js';
import { lookupAddress, getCircuitStatus } from '../os-places.js';
import { createManifest, recordOsPlaces, recordEpc, recordValueEstimate } from '../enrichment-manifest.js';
import { enqueueRetry, drainRetryQueue } from './retry-queue.js';
import { fetchEPCByPostcode, matchEPCToLot, getCircuitBreakers } from '../enrichment.js';
import { estimateValue } from './value-estimator.js';
import { dbRowToLot } from '../types/lot.js';

const OS_PLACES_TRANSIENT = new Set(['circuit_open', 'timeout', 'api_error']);

/**
 * Extract price from raw HTML text using progressive pattern matching.
 * @param {string} text - Stripped HTML text
 * @returns {{ price: number|null, priceText: string|null }|null}
 */
export function extractPriceFromText(text) {
  const patterns = [
    /(?:guide\s*price|starting\s*bid|minimum\s*opening\s*bid|reserve\s*price|current\s*bid)[^£]{0,30}£([\d,]+)/i,
    /£([\d,]+)\s*(?:guide|starting|plus|reserve|\+)/i,
    /(?:price|sold\s*(?:for|at|price))[^£]{0,20}£([\d,]+)/i,
    /£([\d,]+)\s*[-–]\s*£([\d,]+)/i, // range — take lower
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const p = parseInt(m[1].replace(/,/g, ''), 10);
      if (p >= 500 && p <= 50000000) return { price: p, priceText: null };
    }
  }
  // Fallback: any standalone £ amount
  const allPrices = [...text.matchAll(/£([\d,]+)/g)]
    .map(m => parseInt(m[1].replace(/,/g, ''), 10))
    .filter(p => p >= 1000 && p <= 50000000);
  if (allPrices.length === 1) return { price: allPrices[0], priceText: null };
  if (allPrices.length > 1) {
    const nonFee = allPrices.filter(p => p >= 5000);
    if (nonFee.length > 0) return { price: nonFee[0], priceText: null };
  }
  // Detect explicit no-price
  if (/\b(?:price on application|p\.?o\.?a\.?|to be advised|t\.?b\.?a\.?|refer to auctioneer|contact.*for.*price|price available on request|offers? invited|no guide|by negotiation)\b/i.test(text)) {
    return { price: null, priceText: 'POA' };
  }
  return null;
}

/**
 * Run multi-pass data hygiene wave:
 * Pass 1 — Price hunter (lot-page fetch for priceless lots)        [Firecrawl-eligible]
 * Pass 2 — Postcode rescue (lot-page enrichment for missing postcodes) [Firecrawl-eligible]
 * Pass 3 — Full enrichment (comps, yield, EPC, flood)              [free APIs only]
 * Pass 4 — Lot-page deep enrichment (tenure, condition, beds, images) [Firecrawl-eligible]
 *
 * When `opts.freeOnly` is true, only Pass 3 runs — used by the 30-min continuous
 * enrichment tick to keep DB hot without burning Firecrawl credits between
 * overnight full passes.
 *
 * @param {object} deps - Injected dependencies
 * @param {Function} deps.fetchLotPage
 * @param {Function} deps.enrichLotsFromLotPages
 * @param {Function} deps.enrichLots
 * @param {Function} deps.normaliseLotStatuses
 * @param {Function} deps.extractPostcode
 * @param {Function} deps.analyseLot
 * @param {Function} deps.upsertToLotsTable
 * @param {Function} deps.upsertLotGroups
 * @param {object} [opts]
 * @param {boolean} [opts.freeOnly=false] - skip Firecrawl-eligible passes
 * @param {boolean} [opts.drainRetries=true] - run the enrichment_retry_queue drain pass;
 *   set false for the 30-min continuous tick (drain runs on its own twice-daily schedule)
 */
export async function runEnrichmentWave(deps, opts = {}) {
  const {
    fetchLotPage, enrichLotsFromLotPages, enrichLots,
    normaliseLotStatuses, extractPostcode, analyseLot,
    upsertToLotsTable, upsertLotGroups,
  } = deps;
  const freeOnly = !!opts.freeOnly;

  const stats = { lotPageFetched: 0, pricesFound: 0, pricesPoa: 0, postcodeFixed: 0, enriched: 0, lotPageEnriched: 0 };
  console.log(`HYGIENE: Starting at ${new Date().toISOString()}${freeOnly ? ' [free-only mode]' : ''}...`);

  // ═══ PASS 1: Price Hunter — fetch lot pages for every lot missing price ═══
  // Price is the #1 non-negotiable. 500 per cycle — Firecrawl budget has headroom.
  if (freeOnly) {
    console.log('HYGIENE [price]: skipped (free-only mode)');
  } else {
  const { data: pricelessLots } = await supabase
    .from('lots')
    .select('*')
    .or('price.is.null,price.eq.0')
    .not('url', 'like', '__synthetic__%')
    .is('price_text', null) // skip lots already confirmed POA
    .order('last_seen_at', { ascending: false })
    .limit(500);

  if (pricelessLots && pricelessLots.length > 0) {
    console.log(`HYGIENE [price]: ${pricelessLots.length} lots missing prices...`);
    for (let i = 0; i < pricelessLots.length; i += 5) {
      if (i > 0) await new Promise(r => setTimeout(r, 300));
      const batch = pricelessLots.slice(i, i + 5);
      await Promise.allSettled(batch.map(async (dbRow) => {
        try {
          const result = await fetchLotPage(dbRow.url, { house: dbRow.house });
          if (!result) return;
          stats.lotPageFetched++;
          const text = result.html.replace(/<[^>]+>/g, ' ')
            .replace(/&#163;/g, '£').replace(/&pound;/g, '£')
            .replace(/&#8364;/g, '€').replace(/&euro;/g, '€')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ').toLowerCase();
          const extracted = extractPriceFromText(text);
          const update = {};
          if (extracted) {
            if (extracted.price) { update.price = extracted.price; stats.pricesFound++; }
            if (extracted.priceText) { update.price_text = extracted.priceText; stats.pricesPoa++; }
          }
          // Capture raw_text while we have the page
          if (!dbRow.raw_text) {
            const rawText = result.html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (rawText.length > 50) update.raw_text = rawText.slice(0, 10000);
          }
          if (Object.keys(update).length > 0) {
            await supabase.from('lots').update(update).eq('id', dbRow.id);
          }
        } catch { /* retry next cycle */ }
      }));
    }
    console.log(`HYGIENE [price]: ✓ ${stats.pricesFound} found, ${stats.pricesPoa} POA`);
  }
  } // end Pass 1 (freeOnly gate)

  // ═══ PASS 2: Postcode rescue — lot-page fetch for lots with no postcode ═══
  if (freeOnly) {
    console.log('HYGIENE [postcode]: skipped (free-only mode)');
  } else {
  const { data: noPostcodeLots } = await supabase
    .from('lots')
    .select('*')
    .is('postcode', null)
    .not('url', 'like', '__synthetic__%')
    .order('last_seen_at', { ascending: false })
    .limit(300);

  if (noPostcodeLots && noPostcodeLots.length > 0) {
    console.log(`HYGIENE [postcode]: ${noPostcodeLots.length} lots missing postcodes...`);
    const lotObjs = noPostcodeLots.map(dbRowToLot);
    await enrichLotsFromLotPages(lotObjs, 3);
    for (const lot of lotObjs) {
      if (!lot.postcode && lot.address) {
        lot.postcode = extractPostcode(lot.address);
        if (lot.postcode) stats.postcodeFixed++;
      }
    }
    await upsertLotGroups(lotObjs, 'hygiene-postcode');
    console.log(`HYGIENE [postcode]: ✓ ${stats.postcodeFixed} postcodes recovered`);
  }
  } // end Pass 2 (freeOnly gate)

  // ═══ PASS 3: Full enrichment — comps, yield, EPC, flood for lots with postcode but missing data ═══
  const { data: needsEnrichment } = await supabase
    .from('lots')
    .select('*')
    .not('postcode', 'is', null)
    .or('enriched_at.is.null,epc_rating.is.null,flood_risk.is.null,street_avg.is.null,est_gross_yield.is.null')
    .order('last_seen_at', { ascending: false })
    .limit(500);

  if (needsEnrichment && needsEnrichment.length > 0) {
    console.log(`HYGIENE [enrich]: ${needsEnrichment.length} lots have postcode but missing EPC/flood/comps/yield...`);
    const groups = {};
    for (const row of needsEnrichment) {
      // Move 2: prefer auction_id as the grouping key (rotation-proof). Fall
      // back to (house, catalogue_url) for rows that haven't been backfilled.
      // The fallback key is namespaced so it can't collide with a UUID.
      const key = row.auction_id || `url:${row.house}|${row.catalogue_url}`;
      if (!groups[key]) groups[key] = { house: row.house, catalogueUrl: row.catalogue_url, auctionId: row.auction_id || null, rows: [] };
      groups[key].rows.push(row);
    }

    for (const [, group] of Object.entries(groups)) {
      try {
        const lotObjs = group.rows.map(dbRowToLot);
        // Re-analyse unscored lots only.
        //   - `score == null` (the never-scored marker) is the right gate;
        //     `score === 0` ALSO fires for legitimately-scored zero-point lots
        //     and re-derives every field from bullets, clobbering persisted
        //     detail-page values (tenure, condition, vacant, dealType, beds).
        //   - When we DO re-score, only promote fields that the lot doesn't
        //     already have. analyseLot reinitialises opps/risks/bullets, so a
        //     wholesale Object.assign would also nuke any opps already added
        //     by enrichLots earlier in this wave.
        for (const lot of lotObjs) {
          if (lot.score == null && (!lot.scoreBreakdown || lot.scoreBreakdown.length === 0)) {
            const analysed = analyseLot(lot);
            // Always take score + scoreBreakdown — that's the point of running.
            lot.score = analysed.score;
            lot.scoreBreakdown = analysed.scoreBreakdown;
            // Only fill structured fields where the persisted lot is empty.
            for (const f of ['propType', 'beds', 'tenure', 'condition', 'vacant', 'dealType']) {
              if (lot[f] == null || lot[f] === '') lot[f] = analysed[f];
            }
            // Merge — don't replace — the signal arrays.
            lot.opps = [...new Set([...(lot.opps || []), ...(analysed.opps || [])])];
            lot.risks = [...new Set([...(lot.risks || []), ...(analysed.risks || [])])];
          }
          // Condition inference from bullets
          if (!lot.condition && lot.bullets && lot.bullets.length > 0) {
            const t = lot.bullets.join(' ').toLowerCase();
            if (/derelict|dilapidated|fire damage/.test(t)) lot.condition = 'poor';
            else if (/modernis|refurbishment|renovation|updating|in need of|improvement|requires? (?:updating|work|repair)|fixer.upper/.test(t)) lot.condition = 'needs work';
            else if (/good order|good decorative|well maintained|recently refurbished|good condition/.test(t)) lot.condition = 'good';
          }
        }
        // enrichLots does: Land Registry comps, yield calc, EPC lookup, flood check
        await enrichLots(lotObjs, group.house, group.catalogueUrl);
        // Rule-based value estimator — pure function over the now-enriched lot.
        // Zero AI cost, <100ms per lot. Records its outcome in the manifest.
        for (const lot of lotObjs) {
          try {
            const ve = estimateValue(lot);
            if (ve) {
              lot.valueEstimate = ve;
              if (lot._enrichment) {
                recordValueEstimate(lot._enrichment, {
                  status: 'ok',
                  confidence: ve.confidence,
                  anchor_source: ve.breakdown.anchor_source,
                  comp_count: ve.breakdown.comp_count,
                });
              }
            } else if (lot._enrichment) {
              recordValueEstimate(lot._enrichment, { status: 'no_anchor' });
            }
          } catch (e) {
            console.warn(`value-estimator failed for lot ${lot._dbId || lot.url}: ${e.message}`);
          }
        }
        normaliseLotStatuses(lotObjs);
        await upsertToLotsTable(lotObjs, group.house, group.catalogueUrl, { scrapedWith: 'hygiene-enrich' });
        stats.enriched += lotObjs.length;
        console.log(`HYGIENE [enrich]: ✓ ${group.house}: ${lotObjs.length} lots`);
      } catch (e) {
        console.warn(`HYGIENE [enrich]: Failed for ${group.house}: ${e.message}`);
      }
    }
  }

  // ═══ PASS 4: Lot-page deep enrichment — tenure, condition, beds, vacant, images ═══
  if (freeOnly) {
    console.log('HYGIENE [lot-page]: skipped (free-only mode)');
  } else {
  const { data: needsLotPage } = await supabase
    .from('lots')
    .select('*')
    .not('url', 'like', '__synthetic__%')
    .or('tenure.is.null,condition.is.null,beds.is.null,image_url.is.null,prop_type.is.null,vacant.is.null')
    .order('last_seen_at', { ascending: false })
    .limit(300);

  if (needsLotPage && needsLotPage.length > 0) {
    console.log(`HYGIENE [lot-page]: ${needsLotPage.length} lots need deep enrichment from lot pages...`);
    const lotObjs = needsLotPage.map(dbRowToLot);
    try {
      await enrichLotsFromLotPages(lotObjs, 3);
      await upsertLotGroups(lotObjs, 'hygiene-lotpage');
      stats.lotPageEnriched += lotObjs.length;
      console.log(`HYGIENE [lot-page]: ✓ ${lotObjs.length} lots enriched`);
    } catch (e) {
      console.warn(`HYGIENE [lot-page]: Failed: ${e.message}`);
    }
  }
  } // end Pass 4 (freeOnly gate)

  // ═══ PASS 5: UPRN gap-filler — re-attempt OS Places for any lot still missing a UPRN ═══
  // Replaces the first-contact-only gating in lib/pipeline/enrich-stage.js
  // (COVERAGE_FIX_PLAN.md fix #2 — re-enrichment of returning lots).
  // Cache absorbs hits cheaply; transient failures (circuit_open / timeout /
  // api_error) get queued for exponential-backoff retry instead of waiting
  // for the next catalogue scrape to rediscover the gap.
  stats.uprnRecovered = 0;
  stats.uprnQueued = 0;
  const { data: noUprnLots } = await supabase
    .from('lots')
    .select('id, url, address, postcode, field_sources, enrichment_manifest')
    .is('uprn', null)
    .not('address', 'is', null)
    .order('last_seen_at', { ascending: false })
    .limit(200);

  if (noUprnLots && noUprnLots.length > 0) {
    console.log(`HYGIENE [uprn]: ${noUprnLots.length} lots missing UPRN — running OS Places...`);
    const OS_BATCH = 4;
    for (let i = 0; i < noUprnLots.length; i += OS_BATCH) {
      if (i > 0) await new Promise(r => setTimeout(r, 200));
      const batch = noUprnLots.slice(i, i + OS_BATCH);
      await Promise.allSettled(batch.map(async (row) => {
        try {
          const result = await lookupAddress({ address: row.address, postcode: row.postcode });
          if (!result) return;

          const update = {};
          const fieldSources = (row.field_sources && typeof row.field_sources === 'object') ? { ...row.field_sources } : {};
          const manifest = (row.enrichment_manifest && typeof row.enrichment_manifest === 'object')
            ? row.enrichment_manifest
            : createManifest();
          recordOsPlaces(manifest, {
            status: result.status,
            uprn: result.uprn || null,
            matchScore: result.matchScore ?? null,
            httpStatus: result.httpStatus ?? null,
          });
          update.enrichment_manifest = manifest;

          if ((result.status === 'ok' || result.status === 'cache_hit') && result.uprn) {
            update.uprn = result.uprn;
            fieldSources.uprn = 'os-places';
            if (result.fullAddress && (!row.address || row.address.length < result.fullAddress.length)) {
              update.address = result.fullAddress;
              fieldSources.address = 'os-places';
            }
            if (result.lat != null) { update.lat = result.lat; fieldSources.lat = 'os-places'; }
            if (result.lng != null) { update.lng = result.lng; fieldSources.lng = 'os-places'; }
            if (result.classificationCode) { update.os_classification = result.classificationCode; fieldSources.os_classification = 'os-places'; }
            update.field_sources = fieldSources;
            stats.uprnRecovered++;
          } else if (OS_PLACES_TRANSIENT.has(result.status) || result.status === 'no_match') {
            // Queue for retry: a transient failure (network / circuit) we
            // expect to clear, OR a no_match that may resolve once the
            // address gets canonicalised by another pass.
            await enqueueRetry(supabase, {
              lotId: row.id,
              field: 'uprn',
              reason: result.status,
              source: 'os-places',
              error: result.error || null,
            });
            stats.uprnQueued++;
          }

          if (Object.keys(update).length > 0) {
            await supabase.from('lots').update(update).eq('id', row.id);
          }
        } catch (err) {
          console.warn(`HYGIENE [uprn]: lookup error for ${row.id}: ${err.message}`);
        }
      }));
    }
    console.log(`HYGIENE [uprn]: ✓ ${stats.uprnRecovered} UPRNs recovered, ${stats.uprnQueued} queued for retry`);
  }

  // ═══ PASS 6: Drain retry queue — pick up due rows from prior failures ═══
  // Field-specific handlers (drainUprnRow / drainEpcRow). Single-pass per
  // cycle — exhausted rows (attempts >= 5) are excluded by the index and
  // simply rot in the table until manually pruned.
  //
  // Per-field handlers live below as inner functions so they share the
  // `supabase` closure without becoming a separate module.

  async function drainUprnRow(row) {
    // Don't burn an attempt if OS Places' breaker is open — the lookup
    // would return 'circuit_open' instantly without contacting the API.
    if (getCircuitStatus().open) return 'defer';

    const { data: lotRow } = await supabase
      .from('lots')
      .select('id, address, postcode, uprn, field_sources, enrichment_manifest')
      .eq('id', row.lot_id)
      .maybeSingle();
    if (!lotRow) return 'give_up'; // lot deleted — stop chasing it
    if (lotRow.uprn) return 'ok';   // some other path filled it
    if (!lotRow.address) return 'retry';

    const result = await lookupAddress({ address: lotRow.address, postcode: lotRow.postcode });
    if (!result) return 'retry';
    // Defer if the breaker tripped during this drain (race: pre-check
    // passed but the lookup itself overflowed the failure threshold).
    if (result.status === 'circuit_open') return 'defer';

    if ((result.status === 'ok' || result.status === 'cache_hit') && result.uprn) {
      // Build field_sources + update payload field-by-field so we never
      // serialise an undefined into the row.
      const fieldSources = (lotRow.field_sources && typeof lotRow.field_sources === 'object')
        ? { ...lotRow.field_sources }
        : {};
      fieldSources.uprn = 'os-places';
      const update = { uprn: result.uprn };
      if (result.lat != null) { update.lat = result.lat; fieldSources.lat = 'os-places'; }
      if (result.lng != null) { update.lng = result.lng; fieldSources.lng = 'os-places'; }
      if (result.classificationCode) {
        update.os_classification = result.classificationCode;
        fieldSources.os_classification = 'os-places';
      }
      if (result.fullAddress && (!lotRow.address || lotRow.address.length < result.fullAddress.length)) {
        update.address = result.fullAddress;
        fieldSources.address = 'os-places';
      }
      update.field_sources = fieldSources;
      await supabase.from('lots').update(update).eq('id', lotRow.id);
      return 'ok';
    }
    return 'retry';
  }

  async function drainEpcRow(row) {
    // Defer when the EPC breaker is open — same anti-burn logic as UPRN.
    // getCircuitBreakers().epc returns 'open' | 'half-open' | 'closed'.
    if (getCircuitBreakers().epc === 'open') return 'defer';

    const { data: lotRow } = await supabase
      .from('lots')
      .select('id, address, postcode, epc_rating, enrichment_manifest')
      .eq('id', row.lot_id)
      .maybeSingle();
    if (!lotRow) return 'give_up';
    if (lotRow.epc_rating) return 'ok';        // some other pass filled it
    if (!lotRow.postcode) return 'give_up';    // can't query EPC without postcode

    const epcResult = await fetchEPCByPostcode(lotRow.postcode);
    if (epcResult.status === 'circuit_open') return 'defer';
    if (['skipped_no_creds', 'api_error', 'timeout'].includes(epcResult.status)) return 'retry';
    if (!epcResult.records || epcResult.records.length === 0) return 'give_up';

    const match = matchEPCToLot(epcResult.records, lotRow.address);
    if (!match) return 'give_up';   // records exist but address fuzzy-match fails
                                    // The matcher's strictness is the next phase
                                    // — give_up here means "wait until the matcher
                                    // is upgraded; don't keep retrying the same data".

    const update = { epc_rating: match.epcRating };
    if (typeof match.epcScore === 'number') update.epc_score = match.epcScore;
    if (match.epcDate) update.epc_date = match.epcDate;
    // Update the manifest to reflect the recovery.
    const manifest = (lotRow.enrichment_manifest && typeof lotRow.enrichment_manifest === 'object')
      ? lotRow.enrichment_manifest
      : createManifest();
    recordEpc(manifest, {
      status: 'ok',
      rating: match.epcRating,
      score: match.epcScore,
      date: match.epcDate,
      floorAreaSqm: match.epcFloorAreaSqm,
      floorAreaSqft: match.epcFloorAreaSqft,
      addressCompleteness: 'full',
      matchConfidence: match._matchConfidence,
    });
    update.enrichment_manifest = manifest;
    await supabase.from('lots').update(update).eq('id', lotRow.id);
    return 'ok';
  }

  // ═══ PASS 7: EPC manifest backfill — oldest-first ═══
  // The 4,969 lots with no enrichment_manifest.epc entry are starved by
  // Pass 3 (LIMIT 500 by last_seen_at DESC means only the freshest get
  // attempted; the long tail is invisible until something else changes).
  // This pass orders ASC and filters on `NOT (manifest ? 'epc')` so the
  // long tail finally gets a turn. Resi-only — land/commercial are
  // structurally without EPCs and noise the wave.
  stats.epcBackfillAttempted = 0;
  stats.epcBackfillOk = 0;
  try {
    const { data: epcBackfillRows } = await supabase
      .from('lots')
      .select('*')
      .not('postcode', 'is', null)
      .is('epc_rating', null)
      .in('prop_type', ['house', 'flat'])
      .or('enrichment_manifest.is.null,enrichment_manifest.eq.{}')
      .order('last_seen_at', { ascending: true })
      .limit(200);

    if (epcBackfillRows && epcBackfillRows.length > 0) {
      console.log(`HYGIENE [epc-backfill]: ${epcBackfillRows.length} resi lots with no EPC manifest entry, attempting...`);
      // Group by (house, catalogue_url) so enrichLots can batch by postcode
      // without crossing house contexts.
      const groups = {};
      for (const row of epcBackfillRows) {
        const key = `${row.house}|${row.catalogue_url}`;
        if (!groups[key]) groups[key] = { house: row.house, catalogueUrl: row.catalogue_url, rows: [] };
        groups[key].rows.push(row);
      }
      for (const [, group] of Object.entries(groups)) {
        try {
          const lotObjs = group.rows.map(dbRowToLot);
          await enrichLots(lotObjs, group.house, group.catalogueUrl);
          normaliseLotStatuses(lotObjs);
          await upsertToLotsTable(lotObjs, group.house, group.catalogueUrl, { scrapedWith: 'hygiene-epc-backfill' });
          stats.epcBackfillAttempted += lotObjs.length;
          stats.epcBackfillOk += lotObjs.filter(l => l.epcRating).length;
        } catch (err) {
          console.warn(`HYGIENE [epc-backfill]: ${group.house}: ${err.message}`);
        }
      }
      console.log(`HYGIENE [epc-backfill]: ✓ ${stats.epcBackfillOk}/${stats.epcBackfillAttempted} EPCs recovered`);
    }
  } catch (err) {
    console.warn(`HYGIENE [epc-backfill]: failed (non-fatal): ${err.message}`);
  }

  stats.retriesAttempted = 0;
  stats.retriesOk = 0;
  stats.retriesDeferred = 0;
  // Skip the retry drain on every 30-min tick — it runs on its own twice-daily
  // schedule (03:05 and 13:00 UK) via drainHygieneRetries() in server.js.
  if (opts.drainRetries !== false) {
    try {
      const drain = await drainRetryQueue(supabase, {
        limit: 100,
        attemptFn: async (row) => {
          if (row.field === 'uprn') return await drainUprnRow(row);
          if (row.field === 'epc_rating') return await drainEpcRow(row);
          return 'give_up'; // unknown field — drop instead of rotting
        },
      });
      stats.retriesAttempted = drain.attempted;
      stats.retriesOk = drain.ok;
      stats.retriesDeferred = drain.deferred;
      if (drain.attempted > 0) {
        console.log(`HYGIENE [retry-drain]: ${drain.attempted} attempted — ${drain.ok} ok, ${drain.retried} retried, ${drain.gaveUp} given up, ${drain.deferred} deferred`);
      }
    } catch (err) {
      console.warn(`HYGIENE [retry-drain]: failed: ${err.message}`);
    }
  }

  // ═══ Summary ═══
  const { count: remainingNoPrice } = await supabase.from('lots').select('*', { count: 'exact', head: true }).or('price.is.null,price.eq.0').is('price_text', null);
  const { count: remainingNoPostcode } = await supabase.from('lots').select('*', { count: 'exact', head: true }).is('postcode', null).not('url', 'like', '__synthetic__%');
  const { count: remainingNoEnrich } = await supabase.from('lots').select('*', { count: 'exact', head: true }).is('enriched_at', null).not('postcode', 'is', null);
  const { count: remainingNoUprn } = await supabase.from('lots').select('*', { count: 'exact', head: true }).is('uprn', null).not('postcode', 'is', null);
  console.log(`HYGIENE: Complete — prices:${stats.pricesFound}found/${stats.pricesPoa}poa, postcodes:${stats.postcodeFixed}fixed, enriched:${stats.enriched}, lotPages:${stats.lotPageEnriched}, uprns:${stats.uprnRecovered}recovered/${stats.uprnQueued}queued, retries:${stats.retriesOk}/${stats.retriesAttempted}`);
  console.log(`HYGIENE: Remaining gaps — no price:${remainingNoPrice || 0}, no postcode:${remainingNoPostcode || 0}, no enrichment:${remainingNoEnrich || 0}, no uprn:${remainingNoUprn || 0}`);
}

/**
 * Standalone retry-queue drain — runs independently of the main hygiene wave.
 * Scheduled twice daily (03:05 and 13:00 UK) rather than every 30 minutes,
 * so enrichment_retry_queue updates don't contribute to the continuous DB load.
 * Batches deletes to reduce per-row round-trips.
 */
export async function drainHygieneRetries() {
  try {
    // Inline drainUprnRow / drainEpcRow — mirrors the logic in runEnrichmentWave
    // but self-contained so this function can be called without the full deps bundle.
    async function attemptRow(row) {
      if (row.field === 'uprn') {
        const circuit = getCircuitStatus();
        if (circuit.state === 'open') return 'defer';
        const { data: lotRow } = await supabase
          .from('lots')
          .select('id, address, postcode, uprn, enrichment_manifest, field_sources')
          .eq('id', row.lot_id)
          .maybeSingle();
        if (!lotRow) return 'give_up';
        if (lotRow.uprn) return 'ok';
        if (!lotRow.postcode) return 'give_up';
        const result = await lookupAddress(lotRow.postcode, lotRow.address);
        if (result.status === 'circuit_open') return 'defer';
        if (OS_PLACES_TRANSIENT.has(result.status)) return 'retry';
        if (result.status !== 'ok' || !result.uprn) return 'give_up';
        const manifest = (lotRow.enrichment_manifest && typeof lotRow.enrichment_manifest === 'object')
          ? lotRow.enrichment_manifest : createManifest();
        recordOsPlaces(manifest, { status: 'ok', uprn: result.uprn, lat: result.lat, lng: result.lng });
        const update = {
          uprn: result.uprn,
          lat: result.lat ?? lotRow.lat,
          lng: result.lng ?? lotRow.lng,
          enrichment_manifest: manifest,
        };
        const fieldSources = lotRow.field_sources && typeof lotRow.field_sources === 'object'
          ? { ...lotRow.field_sources } : {};
        fieldSources.uprn = 'os-places-retry';
        update.field_sources = fieldSources;
        await supabase.from('lots').update(update).eq('id', lotRow.id);
        return 'ok';
      }
      if (row.field === 'epc_rating') {
        if (getCircuitBreakers().epc === 'open') return 'defer';
        const { data: lotRow } = await supabase
          .from('lots')
          .select('id, address, postcode, epc_rating, enrichment_manifest')
          .eq('id', row.lot_id)
          .maybeSingle();
        if (!lotRow) return 'give_up';
        if (lotRow.epc_rating) return 'ok';
        if (!lotRow.postcode) return 'give_up';
        const epcResult = await fetchEPCByPostcode(lotRow.postcode);
        if (epcResult.status === 'circuit_open') return 'defer';
        if (['skipped_no_creds', 'api_error', 'timeout'].includes(epcResult.status)) return 'retry';
        if (!epcResult.records || epcResult.records.length === 0) return 'give_up';
        const match = matchEPCToLot(epcResult.records, lotRow.address);
        if (!match) return 'give_up';
        const manifest = (lotRow.enrichment_manifest && typeof lotRow.enrichment_manifest === 'object')
          ? lotRow.enrichment_manifest : createManifest();
        recordEpc(manifest, { status: 'ok', rating: match.epcRating, score: match.epcScore, date: match.epcDate, floorAreaSqm: match.epcFloorAreaSqm, floorAreaSqft: match.epcFloorAreaSqft, addressCompleteness: 'full', matchConfidence: match._matchConfidence });
        const update = { epc_rating: match.epcRating, enrichment_manifest: manifest };
        if (typeof match.epcScore === 'number') update.epc_score = match.epcScore;
        if (match.epcDate) update.epc_date = match.epcDate;
        await supabase.from('lots').update(update).eq('id', lotRow.id);
        return 'ok';
      }
      return 'give_up';
    }

    const drain = await drainRetryQueue(supabase, { limit: 200, attemptFn: attemptRow });
    console.log(`RETRY-DRAIN: ${drain.attempted} attempted — ${drain.ok} ok, ${drain.retried} retried, ${drain.gaveUp} given up, ${drain.deferred} deferred`);
    return drain;
  } catch (err) {
    console.warn(`RETRY-DRAIN: failed: ${err.message}`);
    return { attempted: 0, ok: 0, retried: 0, gaveUp: 0, deferred: 0 };
  }
}
