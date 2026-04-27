// lib/pipeline/persist-stage.js — Quality gate + persistence stage
// Validates the enriched lots against quality gates and the harness,
// then persists to cached_analyses, lots table, house_skills, and
// resolves pipeline alerts.
//
// Inputs:  { lots, house, url, normalisedUrl, rewritten, contentHash }
// Outputs: { persisted: boolean, catalogueChanged: boolean }
//          persisted=false when quality gate or harness rejects the batch
//
// Dependencies injected via `deps` to keep this module pure.

import { supabase } from '../supabase.js';
import { getCacheTTL } from '../config.js';
import { getAuctionDateForUrl } from '../calendar.js';
import { HOUSE_DISPLAY_NAMES } from '../houses.js';
import { getBaseline } from '../harness/house-health.js';
import { validateBatch } from '../harness/data-contract.js';
import { detectRegression } from '../harness/regression-detector.js';
import { evaluateGate, checkEndedLotRatio, checkCalendarDateSanity } from '../harness/quality-gate.js';
import { enrichBatch } from '../harness/enrichment-engine.js';
import { fireAlert } from '../harness/alert-router.js';
import { summariseBatch, deriveAlerts } from '../enrichment-manifest.js';
import { enqueueRetry } from './retry-queue.js';
import { computeBatchCoverage } from '../quality/lot-quality.js';
import { detectFieldRegressions, appendCoverageHistory, latestCoverage } from './quality-regression.js';

const LOTS_SELECT = 'lot_number,address,price,price_text,guide_price_text,prop_type,tenure,beds,url,image_url,bullets,opportunities,score,est_gross_yield,vacant,title_split,deal_type,status,condition,lease_length,sq_ft,price_per_sqft,epc_rating,flood_risk,fundability_badge,fundability_url';

/**
 * @param {object} ctx - Pipeline context
 * @param {Array} ctx.lots - Scored + enriched lots
 * @param {string} ctx.house - Detected house slug
 * @param {string} ctx.url - Original catalogue URL
 * @param {string} ctx.normalisedUrl - Normalised URL for DB lookups
 * @param {object} ctx.rewritten - Output of rewriteUrl()
 * @param {string|null} ctx.contentHash - From probe stage
 * @param {object} deps - Injected dependencies
 * @param {function} deps.qualityGate
 * @param {function} deps.dbRowToFrontendLot
 * @param {function} deps.upsertToLotsTable
 * @param {function} deps.updateHouseSkill
 * @param {function} deps.computeScrapeDiff
 * @param {function} deps.normaliseLotStatuses
 * @param {function} deps.getLastScrapeEngine
 * @param {function} deps.getLastExtractorUsed
 * @param {function} deps.getLastAITier
 * @param {function} deps.harnessUpdateHealth
 * @param {function} deps.harnessFireAlert
 * @param {function} deps.harnessResolveAlert
 * @returns {Promise<{ persisted: boolean, catalogueChanged: boolean }>}
 */
export async function persistStage(ctx, deps) {
  const { house, url, normalisedUrl, rewritten, contentHash } = ctx;
  let { lots } = ctx;

  const auctionDate = await getAuctionDateForUrl(normalisedUrl);
  const expiresAt = new Date(Date.now() + getCacheTTL(house, auctionDate)).toISOString();

  // ── Fetch previous data for comparison ──
  const [{ data: prevCached }, { data: prevLotRows }] = await Promise.all([
    supabase.from('cached_analyses').select('total_lots, top_picks, title_splits').eq('url', normalisedUrl).single(),
    supabase.from('lots').select(LOTS_SELECT).eq('catalogue_url', normalisedUrl),
  ]);
  const prevLots = (prevLotRows || []).map(deps.dbRowToFrontendLot);

  // ── Quality gate — reject bad batches before caching ──
  const qg = deps.qualityGate(lots, house, prevCached, prevLots);
  if (qg.rejected) {
    console.log(`AUTO: ⚠ ${house} quality gate REJECTED batch. Keeping old data.`);
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'quality_gate_reject',
        severity: 'warning',
        house,
        message: qg.alerts.join(' | '),
      });
    } catch (e) { /* non-fatal */ }
    return { persisted: false, catalogueChanged: false };
  }
  lots = qg.lots; // use cleaned lots

  // ── Harness: data contract validation + enrichment + regression detection + health update ──
  try {
    const harnessBaseline = getBaseline(house);
    const harnessValidated = validateBatch(lots, house, { averageLotCount: harnessBaseline.averageLotCount });
    const harnessEnriched = enrichBatch(lots, house, {
      previousCache: prevLots,
    });
    lots = harnessEnriched.lots;
    if (harnessEnriched.stats.enriched > 0) {
      console.log(`HARNESS: ${house}: enriched ${harnessEnriched.stats.enriched} lots (${harnessEnriched.stats.fieldsImproved.join(', ')})`);
    }
    const harnessRegression = detectRegression(house, harnessValidated, harnessBaseline);
    const harnessGate = evaluateGate(house, harnessValidated, harnessRegression, prevCached);
    if (harnessGate.decision === 'reject') {
      // Only true rejects now (0 lots) — all other former rejects are cache_warn
      console.log(`HARNESS: ${house} quality gate REJECTED — ${harnessGate.reason}. Keeping old data.`);
      return { persisted: false, catalogueChanged: false };
    }
    if (harnessGate.decision === 'cache_warn') {
      console.log(`HARNESS: ${house} quality gate WARN — ${harnessGate.reason}. Proceeding with persistence.`);
    }
    const harnessHealth = deps.harnessUpdateHealth(house, {
      lots: harnessValidated,
      regression: harnessRegression,
      gate: harnessGate,
      extractionMethod: deps.getLastExtractorUsed() || 'unknown',
    });
    if (harnessHealth.circuitBreaker === 'open') {
      deps.harnessFireAlert({ type: 'circuit_open', severity: 'error', house, message: `Health ${harnessHealth.health}/100` }).catch(() => {});
    }
    if (harnessRegression.verdict === 'healthy') {
      deps.harnessResolveAlert(house, 'extractor_regression').catch(() => {});
    }
  } catch (harnessErr) {
    console.warn(`HARNESS: ${house} harness processing failed (non-fatal):`, harnessErr.message);
  }

  // ── Enrichment manifest — fire per-source alerts based on batch outcomes ──
  // (EPC creds missing, matcher weak, API unhealthy, etc.)
  try {
    const manifestSummary = summariseBatch(lots);
    const manifestAlerts = deriveAlerts(manifestSummary, house);
    for (const alert of manifestAlerts) {
      fireAlert(alert).catch(() => { /* non-fatal */ });
    }
    if (manifestAlerts.length > 0) {
      console.log(`MANIFEST: ${house}: fired ${manifestAlerts.length} enrichment alerts (${manifestAlerts.map(a => a.type).join(', ')})`);
    }
  } catch (manifestErr) {
    console.warn(`MANIFEST: alert derivation failed for ${house} (non-fatal): ${manifestErr.message}`);
  }

  // ── Ended-lot ratio check — flag houses with >80% terminal lots ──
  try {
    const endedCheck = checkEndedLotRatio(house, lots);
    if (endedCheck.flagged) {
      console.log(`HARNESS: ${house} ended-lot ratio ${endedCheck.ratio * 100}% (${endedCheck.endedCount}/${endedCheck.total}) — catalogue likely stale`);
    }
  } catch (e) { /* non-fatal */ }

  // ── Calendar date sanity — flag bulk date or multi-date anomalies ──
  try {
    const isAlwaysOn = lots.some(l => {
      const d = l.auctionDate || l._auctionDate || l.auction_date;
      return !d; // always_on houses typically have no date
    }) && lots.every(l => !(l.auctionDate || l._auctionDate || l.auction_date));
    const dateCheck = checkCalendarDateSanity(house, lots, { isAlwaysOn });
    if (dateCheck.flagged) {
      console.log(`HARNESS: ${house} calendar date anomaly — ${dateCheck.flags.join('; ')}`);
    }
  } catch (e) { /* non-fatal */ }

  // ── Compute summary stats ──
  const lotsWithPrice = lots.filter(l => l.price && l.price > 0);
  const yieldsArr = lots.map(l => l.estGrossYield).filter(y => y && y > 0);
  const newTotalLots = lots.length;
  const newTopPicks = lots.filter(l => l.score >= 3).length;
  const newTitleSplits = lots.filter(l => l.titleSplit).length;

  const catalogueChanged = !prevCached
    || prevCached.total_lots !== newTotalLots
    || prevCached.top_picks !== newTopPicks
    || prevCached.title_splits !== newTitleSplits;

  // ── Upsert cached_analyses ──
  await supabase.from('cached_analyses').upsert({
    url: normalisedUrl,
    house: house,
    total_lots: newTotalLots,
    title_splits: newTitleSplits,
    top_picks: newTopPicks,
    under_100k: lotsWithPrice.filter(l => l.price < 100000).length,
    avg_yield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
    dev_potential: lots.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
    vacant_count: lots.filter(l => l.vacant === true).length,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    content_hash: contentHash || null,
    last_scraped_at: new Date().toISOString(),
    scraped_with: deps.getLastScrapeEngine(),
    extracted_with: deps.getLastExtractorUsed(),
    ai_tier: deps.getLastAITier(),
  }, { onConflict: 'url' });

  // ── Upsert individual lots to lots table ──
  deps.normaliseLotStatuses(lots);
  await deps.upsertToLotsTable(lots, house, url, {
    scrapedWith: deps.getLastScrapeEngine(),
    extractedWith: deps.getLastExtractorUsed(),
  });

  // ── Flush retry intents stamped during enrichment ──
  // enrich-stage stashes _osPlacesRetry / _epcRetry on lots whose OS Places
  // / EPC lookups hit a transient failure or no_match. Lots only get DB ids
  // during upsert, so we re-fetch them here and enqueue. Without this,
  // transient failures wait for the next hygiene wave (~6h) before any
  // record of the failure exists.
  try {
    const lotsNeedingRetry = lots.filter(l => (l._osPlacesRetry || l._epcRetry) && l.url);
    if (lotsNeedingRetry.length > 0) {
      // ── id lookup, chunked to stay under Supabase request size caps ──
      // A single .in() with 500+ urls can exceed PostgREST's URL length limit
      // (8KB default). 100 keeps us well clear even with long catalogue urls.
      const urls = lotsNeedingRetry.map(l => l.url);
      const URL_CHUNK = 100;
      const idByUrl = new Map();
      for (let i = 0; i < urls.length; i += URL_CHUNK) {
        const chunk = urls.slice(i, i + URL_CHUNK);
        const { data: idRows } = await supabase
          .from('lots')
          .select('id, url')
          .eq('house', house.toLowerCase())
          .in('url', chunk);
        for (const r of (idRows || [])) idByUrl.set(r.url, r.id);
      }

      // ── Parallel enqueue ──
      // Each lot can carry one OS-Places retry AND one EPC retry — flatten
      // both intents into a single allSettled batch to keep round-trips down.
      const enqueues = [];
      for (const lot of lotsNeedingRetry) {
        const lotId = idByUrl.get(lot.url);
        if (!lotId) continue;
        if (lot._osPlacesRetry) {
          enqueues.push(enqueueRetry(supabase, {
            lotId,
            field: 'uprn',
            reason: lot._osPlacesRetry.reason,
            source: 'os-places',
            error: lot._osPlacesRetry.error,
          }));
        }
        if (lot._epcRetry) {
          enqueues.push(enqueueRetry(supabase, {
            lotId,
            field: 'epc_rating',
            reason: lot._epcRetry.reason,
            source: 'epc',
            error: lot._epcRetry.error || null,
          }));
        }
      }
      await Promise.allSettled(enqueues);
    }
  } catch (retryErr) {
    console.warn(`PERSIST: retry-queue flush failed for ${house}: ${retryErr.message}`);
  }

  // ── Mark preset cache entries as partially stale ──
  if (catalogueChanged) {
    const { data: affected } = await supabase
      .from('smart_search_cache')
      .select('query_key, stale_urls')
      .contains('source_urls', [normalisedUrl]);
    if (affected && affected.length > 0) {
      for (const row of affected) {
        const updatedStale = [...new Set([...(row.stale_urls || []), normalisedUrl])];
        await supabase.from('smart_search_cache')
          .update({ stale_urls: updatedStale })
          .eq('query_key', row.query_key);
      }
      console.log(`AUTO: Marked ${affected.length} preset cache entries stale for: ${normalisedUrl}`);
    }
  }

  console.log(`AUTO: ✓ ${house}: ${newTotalLots} lots cached (${newTitleSplits} title splits, ${newTopPicks} top picks)${catalogueChanged ? ' [CHANGED]' : ' [unchanged]'}`);

  // ── Compute per-scrape diff summary ──
  const scrapeDiff = deps.computeScrapeDiff(prevLots, lots);
  try {
    await supabase.from('house_skills')
      .update({ last_diff: scrapeDiff })
      .eq('slug', house);
  } catch (diffErr) { console.warn(`DIFF: Failed to store diff for ${house}:`, diffErr.message); }

  // ── Skill tracking: persist to Supabase ──
  try {
    await deps.updateHouseSkill(house, {
      catalogueUrl: url,
      lotCount: newTotalLots,
      imageCoverage: lots.length > 0 ? Math.round(lots.filter(l => l.imageUrl).length / lots.length * 100) : 0,
      scrapedWith: deps.getLastScrapeEngine(),
      requiresPuppeteer: !!rewritten.preferPuppeteer,
    });
  } catch (skillErr) {
    console.warn(`SKILL: Failed to update skill for ${house}: ${skillErr.message}`);
  }

  // ── Per-field coverage regression detection (rollout #4) ──
  // Compute this scrape's per-field coverage, compare to the previous
  // entry stored in house_skills.field_coverage_history, and fire a
  // targeted alert per field that dropped ≥ DROP_THRESHOLD_PCT.
  // Self-calibrating: a house at 0% UPRN by structure won't fire alerts
  // until something *else* changes. Any alert here means a field that
  // worked last cycle has regressed — usually an extractor break.
  try {
    const currentCoverage = computeBatchCoverage(lots);
    if (currentCoverage) {
      currentCoverage.scraped_at = new Date().toISOString();

      const { data: skillRow } = await supabase
        .from('house_skills')
        .select('field_coverage_history')
        .eq('slug', house)
        .maybeSingle();

      const previous = latestCoverage(skillRow?.field_coverage_history);
      const regressions = detectFieldRegressions(previous, currentCoverage);

      // Append + trim to ringbuffer, persist back.
      const updatedHistory = appendCoverageHistory(skillRow?.field_coverage_history, currentCoverage);
      await supabase
        .from('house_skills')
        .update({ field_coverage_history: updatedHistory })
        .eq('slug', house);

      // Fire one alert per regressed field — keeps the alert lifecycle
      // (open → resolved by next clean scrape) trackable per-field.
      for (const r of regressions) {
        deps.harnessFireAlert({
          type: r.alertType,
          severity: 'warning',
          house,
          message: `${HOUSE_DISPLAY_NAMES[house] || house} ${r.label} coverage dropped ${r.drop_pct}pp (${r.previous_pct}% → ${r.current_pct}%)`,
          details: {
            field: r.label,
            previous_pct: r.previous_pct,
            current_pct: r.current_pct,
            drop_pct: r.drop_pct,
            total_lots: currentCoverage.total_lots,
          },
        }).catch(() => { /* non-fatal */ });
      }

      if (regressions.length > 0) {
        console.log(`COVERAGE: ${house} regressions: ${regressions.map(r => `${r.label} -${r.drop_pct}pp`).join(', ')}`);
      }
    }
  } catch (covErr) {
    console.warn(`COVERAGE: regression check failed for ${house} (non-fatal): ${covErr.message}`);
  }

  // ── Auto-resolve alerts: successful scrape clears existing alerts for this house ──
  try {
    await supabase.from('pipeline_alerts')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('house', house)
      .eq('resolved', false);
  } catch (resolveErr) { console.warn('ALERT: Failed to auto-resolve alerts:', resolveErr.message); }

  return { persisted: true, catalogueChanged };
}
