// lib/pipeline/multi-image-sweep.js
//
// Daily sweep that fills out lot.images galleries for active inventory.
//
// Catalogue scrapes capture a single image_url per lot. The frontend
// supports a multi-image carousel (lot.images array) and the detail-page
// fetch on first contact populates it — but lots that pre-date the carousel
// (or lots where first-contact enrichment didn't fire cleanly) stay stuck
// at a single image forever. This sweep chips through them at 50/day so the
// gallery quietly fills out over a few months.
//
// Cooldown: 14 days between attempts on the same lot. A lot we've already
// tried and got 0 images for stays cooled down — no point retrying daily.
//
// Budget: capped at SWEEP_BATCH_LIMIT lots per run + the global daily
// Firecrawl ceiling (FIRECRAWL_DAILY_BUDGET, default 8000) which trips
// canUseFirecrawl() upstream. Worst case ~50 credits/day = ~1,500/month.

import { supabase } from '../supabase.js';
import { fetchLotPage } from '../scraper/lot-detail.js';
// extractLotDetail (JSDOM detail extractor) retired 2026-05-08. The sweep
// now relies on the regex-based extractImagesFromHtml fallback alone.
import { fireAlert } from '../harness/alert-router.js';
import { recordMultiImageSweep } from '../enrichment-manifest.js';
import { log } from '../logging.js';

// Tunables. History: 50 (too slow, 213-day backlog) → 1000 (2026-05-08, too
// expensive — the "most fetches are free HTTP" assumption was wrong: with 215
// mostly-JS-rendered houses, Firecrawl-fallback rate is ~30–60%, so a 1000-lot
// run was burning ~300–600 credits/day). 200 keeps the backlog cadence at ~4
// weeks while capping the worst-case Firecrawl spend at ~120 credits/day from
// this sweep. Raise carefully and only after confirming the HTTP-vs-Firecrawl
// ratio in production (BUDGET-FC hourly log).
const SWEEP_BATCH_LIMIT = 200;             // soft ceiling — wall-clock is the actual guard
const SWEEP_FETCH_POOL = 1500;             // pull this many candidate rows from the DB
const SWEEP_WALL_CLOCK_MS = 30 * 60_000;   // hard cap — bail at 30 minutes, next run resumes
const SWEEP_COOLDOWN_DAYS = 14;
const PER_FETCH_TIMEOUT_MS = 30000;
const FETCH_GAP_MS = 500;
const MIN_IMAGES_TARGET = 3;
const MAX_IMAGES_PER_LOT = 8;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Round-robin selection across houses so a single big-catalogue auction
// can't starve smaller houses out of the daily sweep. Reuses the same
// helper post-auction-sweep already exports — single source of truth so
// fairness behaviour stays identical across both sweeps.
import { fairShareByHouse } from './post-auction-sweep.js';

const JUNK_IMG = /(logo|icon|sprite|favicon|placeholder|avatar|spinner|loading|google|facebook|twitter|x-icon|linkedin|youtube|instagram|pinterest|whatsapp|telegram|gravatar|emoji|button|arrow|chevron|caret|hamburger|burger|close|cross|tick|cookie|consent|advertisement|sponsor|track(?:er|ing)?|pixel|beacon|stripe|paypal|trustpilot|trusted|gdpr|disclaimer|google-analytics|gtag|recaptcha)/i;

const IMG_RE = /<img[^>]+(?:src|data-src|data-lazy-src|data-original)="([^"]+)"/gi;

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function extractImagesFromHtml(html, baseUrl) {
  const out = [];
  const seen = new Set();
  let m;
  while ((m = IMG_RE.exec(html)) !== null) {
    const raw = m[1];
    if (!raw || raw.length <= 20 || raw.startsWith('data:')) continue;
    let url = decodeHtmlEntities(raw);
    if (!/^https?:\/\//i.test(url)) {
      try { url = new URL(url, baseUrl).href; } catch { continue; }
    }
    if (JUNK_IMG.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_IMAGES_PER_LOT) break;
  }
  return out;
}

function zeroStats() {
  return {
    eligible: 0, fetched: 0,
    galleryAdded: 0, galleryPartial: 0, noImagesFound: 0,
    urlDead: 0, fetchFailed: 0, totalImagesAdded: 0,
  };
}

export async function sweepMultiImages() {
  const startedAt = Date.now();
  const cooldownCutoff = new Date(Date.now() - SWEEP_COOLDOWN_DAYS * 86400000).toISOString();

  // Current-auction lots FIRST. Investors browse UPCOMING auctions, so those
  // are the galleries that matter. The sweep was oldest-first by
  // `first_seen_at`, which buried the ~4,400 upcoming empty-gallery lots
  // (2026-06-17) behind a large past-auction backlog they never cleared at
  // 200/day. Tier 1 pulls upcoming lots soonest-auction-first; Tier 2 only
  // tops up with the past/undated backlog if Tier 1 underfills the pool.
  // Postgres-side filter on JSONB-array null/empty keeps the query cheap;
  // the final cooldown gate runs client-side.
  const today = new Date(Date.now()).toISOString().slice(0, 10);

  const tier1 = await supabase
    .from('lots')
    .select('id, house, url, images, image_url, auction_date, enrichment_manifest')
    .in('status', ['available', 'unsold'])
    .not('url', 'is', null)
    .or(`images.is.null,images.eq.[]`)
    .gte('auction_date', today)
    .order('auction_date', { ascending: true })
    .limit(SWEEP_FETCH_POOL);

  if (tier1.error) {
    log.error('multi-image-sweep: candidate query failed', { err: tier1.error.message });
    return zeroStats();
  }

  let rawCandidates = tier1.data || [];

  if (rawCandidates.length < SWEEP_FETCH_POOL) {
    // Backlog top-up: past or undated lots, oldest-first (the original order).
    const tier2 = await supabase
      .from('lots')
      .select('id, house, url, images, image_url, auction_date, enrichment_manifest')
      .in('status', ['available', 'unsold'])
      .not('url', 'is', null)
      .or(`images.is.null,images.eq.[]`)
      .or(`auction_date.is.null,auction_date.lt.${today}`)
      .order('first_seen_at', { ascending: true })
      .limit(SWEEP_FETCH_POOL - rawCandidates.length);
    if (tier2.error) {
      log.warn('multi-image-sweep: backlog top-up query failed (continuing with upcoming only)', { err: tier2.error.message });
    } else {
      rawCandidates = rawCandidates.concat(tier2.data || []);
    }
  }

  if (rawCandidates.length === 0) {
    log.info('multi-image-sweep: no candidates with empty/null images');
    return zeroStats();
  }

  // Cooldown + image-count filter. Doing it here rather than in SQL because
  // JSONB-array introspection through PostgREST is awkward and the filter
  // logic is cheap on this small set.
  const eligibleAll = [];
  for (const lot of rawCandidates) {
    const currentCount = Array.isArray(lot.images) ? lot.images.length : 0;
    if (currentCount >= MIN_IMAGES_TARGET) continue;
    const lastSweep = lot.enrichment_manifest?.multi_image_sweep?.recorded_at;
    if (lastSweep && lastSweep > cooldownCutoff) continue;
    eligibleAll.push(lot);
  }

  if (eligibleAll.length === 0) {
    log.info('multi-image-sweep: candidates all under cooldown');
    return zeroStats();
  }

  // Fair-share so a single big house (e.g. tcpa) can't dominate the run
  // and starve smaller houses of their gallery backfill.
  const eligible = fairShareByHouse(eligibleAll, SWEEP_BATCH_LIMIT);
  log.info('multi-image-sweep: starting', { pool: rawCandidates.length, eligibleAfterCooldown: eligibleAll.length, scheduled: eligible.length });
  const stats = { ...zeroStats(), eligible: eligible.length, wallClockBailed: false };

  for (const lot of eligible) {
    if (Date.now() - startedAt > SWEEP_WALL_CLOCK_MS) {
      stats.wallClockBailed = true;
      log.warn('multi-image-sweep: wall-clock budget reached — stopping early', {
        elapsedSec: Math.round((Date.now() - startedAt) / 1000),
        processedSoFar: stats.fetched + stats.urlDead + stats.fetchFailed,
        skipped: eligible.length - (stats.fetched + stats.urlDead + stats.fetchFailed),
      });
      break;
    }
    let fetchResult;
    try {
      fetchResult = await Promise.race([
        fetchLotPage(lot.url, { house: lot.house, skipCache: false }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('per-fetch timeout')), PER_FETCH_TIMEOUT_MS)),
      ]);
    } catch (err) {
      stats.fetchFailed++;
      await persistOutcome(lot, { status: 'fetch_failed', error: err.message, images: [] });
      await sleep(FETCH_GAP_MS);
      continue;
    }

    stats.fetched++;

    if (!fetchResult || !fetchResult.html) {
      stats.urlDead++;
      await persistOutcome(lot, { status: 'url_dead', images: [] });
      await sleep(FETCH_GAP_MS);
      continue;
    }

    // Generic regex-based image extractor — replaced the per-house DOM
    // detail extractor pass on 2026-05-08 with the wider Firecrawl-only
    // migration. extractImagesFromHtml is good enough for the sweep's
    // best-effort gallery backfill.
    const images = extractImagesFromHtml(fetchResult.html, fetchResult.url || lot.url);

    if (images.length === 0) {
      stats.noImagesFound++;
      await persistOutcome(lot, { status: 'no_images_found', images: [] });
    } else if (images.length < MIN_IMAGES_TARGET) {
      stats.galleryPartial++;
      stats.totalImagesAdded += images.length;
      await persistOutcome(lot, { status: 'gallery_partial', images, imageCount: images.length });
    } else {
      stats.galleryAdded++;
      stats.totalImagesAdded += images.length;
      await persistOutcome(lot, { status: 'gallery_added', images, imageCount: images.length });
    }

    await sleep(FETCH_GAP_MS);
  }

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  log.info('multi-image-sweep: complete', { elapsedSec, ...stats });

  await fireAlert({
    type: 'multi_image_sweep',
    severity: 'info',
    house: null,
    message: `Multi-image sweep: ${stats.fetched}/${stats.eligible} fetched, ${stats.galleryAdded} galleries added, ${stats.galleryPartial} partial, ${stats.noImagesFound} no images, ${stats.urlDead} dead, ${stats.fetchFailed} failed (+${stats.totalImagesAdded} images total)`,
    meta: { ...stats, elapsedSec },
  }).catch(err => log.warn('multi-image-sweep: fireAlert failed', { err: err.message }));

  return stats;
}

async function persistOutcome(lot, outcome) {
  const manifest = lot.enrichment_manifest || {};
  recordMultiImageSweep(manifest, {
    status: outcome.status,
    image_count: outcome.imageCount ?? null,
    error: outcome.error ?? null,
  });

  const update = { enrichment_manifest: manifest };

  if (outcome.images && outcome.images.length > 0) {
    update.images = outcome.images;
    // Bump primary image_url if it was missing — gives the carousel its
    // first frame on lots that previously had nothing.
    if (!lot.image_url || lot.image_url.length < 10) {
      update.image_url = outcome.images[0];
    }
  }

  const { error } = await supabase.from('lots').update(update).eq('id', lot.id);
  if (error) {
    log.warn('multi-image-sweep: lot update failed', { id: lot.id, err: error.message });
  }
}
