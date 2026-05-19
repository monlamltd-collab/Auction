// lib/pipeline/same-day-sweep.js
//
// Same-day status sweep. Counterpart to post-auction-sweep.js, sized for
// the auction day itself.
//
// post-auction-sweep waits 24h after auction_date before re-fetching ("give
// the source time to update its results page"). Most catalogues actually
// publish sold/withdrawn flags within hours of the gavel — the 24h floor
// means we miss those flips for ~a day. This sweep targets the gap: lots
// whose auction is *today*, fetched once in the evening UK time when most
// auctions have finished.
//
// Outcomes are identical to post-auction-sweep (status_updated / no_change /
// fetch_failed / url_dead). The daily post-auction-sweep still runs the
// next morning and catches anything this sweep missed because the source
// hadn't updated yet — two passes, same code path, different cadences.
//
// Cost: ~10 active houses × ~50 lots avg × 1 fetch/day ≈ 500 fetches/day,
// most are free plain-HTTP (Firecrawl only on fallback). Well under 1% of
// the 100k Firecrawl plan quota.
//
// Wired in as Tier 18 in server.js at 20:00 UK.

import { supabase } from '../supabase.js';
import { fetchLotPage } from '../scraper/lot-detail.js';
import { detectSourceStatus } from '../harness/sub-agents.js';
import { fireAlert } from '../harness/alert-router.js';
import { log } from '../logging.js';
import { LOT_EVENT_TYPES, buildLotEvent, insertLotEvents } from './lot-events.js';
import { fairShareByHouse } from './post-auction-sweep.js';

// Tunables — kept smaller than post-auction-sweep because the same-day
// cohort is much smaller (today's auctions only, not 30 days of backlog).
const SWEEP_BATCH_LIMIT = 500;
const SWEEP_FETCH_POOL = 2000;
const SWEEP_WALL_CLOCK_MS = 15 * 60_000;  // 15 min — shorter than post-auction's 30
const SWEEP_COOLDOWN_HOURS = 6;           // shorter than post-auction's 12 — daily one-shot
const FETCH_GAP_MS = 500;
const PER_FETCH_TIMEOUT_MS = 30000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Compute today's date string in Europe/London time. The auction_date column
 * stores naive YYYY-MM-DD strings tied to UK business day — comparing against
 * UTC `new Date()` would slip into tomorrow's bucket after 00:00 UTC (i.e.
 * during the UK auction evening itself), which is exactly when this sweep
 * runs. Use the London-localised date string instead.
 */
function todayUkDate() {
  // en-CA gives ISO-style YYYY-MM-DD natively.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

/**
 * Run a single same-day status sweep pass.
 *
 * @returns {Promise<{
 *   eligible: number, fetched: number,
 *   statusUpdated: number, noChange: number, urlDead: number, fetchFailed: number,
 *   transitions: Record<string, number>, wallClockBailed: boolean,
 * }>}
 */
export async function sweepSameDayStatuses() {
  const startedAt = Date.now();
  const today = todayUkDate();
  const cooldownCutoff = new Date(Date.now() - SWEEP_COOLDOWN_HOURS * 3600000).toISOString();

  // ── Find candidates ───────────────────────────────────────────────
  // Lots whose auction is today AND status is still available/unsold AND
  // we haven't re-fetched in the cooldown window.
  const { data: rawCandidates, error: queryErr } = await supabase
    .from('lots')
    .select('id, house, url, status, auction_date, last_seen_at')
    .in('status', ['available', 'unsold'])
    .not('url', 'is', null)
    .eq('auction_date', today)
    .lt('last_seen_at', cooldownCutoff)
    .order('house', { ascending: true })
    .limit(SWEEP_FETCH_POOL);

  if (queryErr) {
    log.error('same-day-sweep: candidate query failed', { err: queryErr.message });
    return { eligible: 0, fetched: 0, statusUpdated: 0, noChange: 0, urlDead: 0, fetchFailed: 0, transitions: {}, wallClockBailed: false };
  }
  if (!rawCandidates || rawCandidates.length === 0) {
    log.info('same-day-sweep: no candidates found', { today });
    return { eligible: 0, fetched: 0, statusUpdated: 0, noChange: 0, urlDead: 0, fetchFailed: 0, transitions: {}, wallClockBailed: false };
  }

  // Fair-share across houses so one big catalogue (e.g. a 200-lot date) can't
  // starve smaller houses out of the daily SWEEP_BATCH_LIMIT. Pure helper
  // re-used from post-auction-sweep.js — same correctness story.
  const candidates = fairShareByHouse(rawCandidates, SWEEP_BATCH_LIMIT);
  const houseCounts = candidates.reduce((acc, l) => { acc[l.house] = (acc[l.house] || 0) + 1; return acc; }, {});
  log.info('same-day-sweep: starting', { today, pool: rawCandidates.length, eligible: candidates.length, houseCounts });

  const stats = { eligible: candidates.length, fetched: 0, statusUpdated: 0, noChange: 0, urlDead: 0, fetchFailed: 0, wallClockBailed: false, transitions: {} };

  for (const lot of candidates) {
    if (Date.now() - startedAt > SWEEP_WALL_CLOCK_MS) {
      stats.wallClockBailed = true;
      log.warn('same-day-sweep: wall-clock budget reached — stopping early', {
        elapsedSec: Math.round((Date.now() - startedAt) / 1000),
        processedSoFar: stats.fetched + stats.urlDead + stats.fetchFailed,
        skipped: candidates.length - (stats.fetched + stats.urlDead + stats.fetchFailed),
      });
      break;
    }

    let fetchResult = null;
    try {
      fetchResult = await Promise.race([
        fetchLotPage(lot.url, { house: lot.house, skipCache: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('per-fetch timeout')), PER_FETCH_TIMEOUT_MS)),
      ]);
    } catch {
      stats.fetchFailed++;
      // Update last_seen_at to apply the cooldown — same as post-auction-sweep.
      // No status change on fetch failure: we don't know what happened.
      await supabase.from('lots').update({ last_seen_at: new Date().toISOString() }).eq('id', lot.id);
      await sleep(FETCH_GAP_MS);
      continue;
    }

    stats.fetched++;

    if (!fetchResult || !fetchResult.html) {
      // Detail URL is dead. Same-day-sweep does NOT infer 'unsold' here —
      // post-auction-sweep handles that after the 3-day threshold. Today
      // is too early to draw that conclusion.
      stats.urlDead++;
      await supabase.from('lots').update({ last_seen_at: new Date().toISOString() }).eq('id', lot.id);
      await sleep(FETCH_GAP_MS);
      continue;
    }

    const newStatus = detectSourceStatus(fetchResult.html);

    if (newStatus === lot.status) {
      stats.noChange++;
      await supabase.from('lots').update({ last_seen_at: new Date().toISOString() }).eq('id', lot.id);
    } else {
      stats.statusUpdated++;
      const key = `${lot.status}->${newStatus}`;
      stats.transitions[key] = (stats.transitions[key] || 0) + 1;

      const { error: updErr } = await supabase
        .from('lots')
        .update({ status: newStatus, last_seen_at: new Date().toISOString() })
        .eq('id', lot.id);

      if (updErr) {
        log.warn('same-day-sweep: lot update failed', { id: lot.id, err: updErr.message });
      } else {
        // ── Dual-write: emit lot_status_changed event ──
        // Non-fatal: lot_events is observability, never blocks the sweep.
        try {
          const ev = buildLotEvent({
            lotId: lot.id,
            eventType: LOT_EVENT_TYPES.STATUS_CHANGED,
            oldValue: { status: lot.status ?? null },
            newValue: { status: newStatus },
            source: {
              scrape_id: null,
              scraper_version: 'same-day-sweep',
              house: lot.house,
              writer: 'same-day-sweep.persistOutcome',
            },
          });
          if (ev) await insertLotEvents([ev]);
        } catch (e) {
          log.warn('same-day-sweep: lot_events emission failed', { id: lot.id, err: e.message });
        }
      }
    }

    await sleep(FETCH_GAP_MS);
  }

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  log.info('same-day-sweep: complete', { elapsedSec, ...stats });

  // ── Fire summary alert (info severity — hygiene, not a failure) ──
  await fireAlert({
    type: 'same_day_sweep',
    severity: 'info',
    house: null,
    message: `Same-day sweep: ${stats.fetched}/${stats.eligible} fetched, ${stats.statusUpdated} updated, ${stats.noChange} unchanged, ${stats.urlDead} dead URLs, ${stats.fetchFailed} fetch failures`,
    meta: { ...stats, elapsedSec, today },
  }).catch(err => log.warn('same-day-sweep: fireAlert failed', { err: err.message }));

  return stats;
}
