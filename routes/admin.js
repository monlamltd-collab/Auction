// routes/admin.js — Admin/diagnostic routes extracted from server.js
import { Router } from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { supabase } from '../lib/supabase.js';
import { safeCompare, rateLimit, getClientIP, validateUserFromReq } from '../lib/auth.js';
import { log } from '../lib/logging.js';
import { MAX_PUPPETEER_PAGES, MAX_LOTS_PER_SCRAPE, MAX_AUCTIONS_PER_HOUSE } from '../lib/config.js';
import { HOUSE_ROOTS, PUPPETEER_IMAGE_HOUSES, detectAuctionHouse, HOUSE_DISPLAY_NAMES } from '../lib/houses.js';
import { DOM_EXTRACTORS, extractWithJSDOM } from '../lib/extractors/index.js';
import {
  scrapeRenderedPage, backfillImages, backfillImagesFromLotPages,
  backfillImagesWithFirecrawl, backfillImagesWithPuppeteer,
  getFirecrawlStatus, getFcCreditsUsed, isFcCreditExhausted, isFcTemporarilyDown,
  FIRECRAWL_API_KEY, FIRECRAWL_SKIP, puppeteer, normaliseLotStatuses,
  scrapeWithFirecrawl,
} from '../lib/scraper.js';
import {
  autoAnalyseAll, autoAnalyseOne, analyseLot,
  dbRowToLot, dbRowToFrontendLot, LOTS_SELECT,
  upsertToLotsTable, saveDailySnapshot,
  logActivityEvent, runEnrichmentWave, isEnrichmentWaveRunning,
  isAutoAnalysisRunning,
  getCreditExhausted, getApiCallCount, getHashHitCount, getServerStartTime,
} from '../lib/analysis.js';
import { getAICostSummary } from '../lib/ai-provider.js';
import { enrichLots, getCircuitBreakers } from '../lib/enrichment.js';
import { normaliseUrl } from '../lib/utils.js';
import { getAuctionCalendar, getCalendarAuctions } from '../lib/calendar.js';
import { validateBatch } from '../lib/harness/data-contract.js';
import { getAllHealth } from '../lib/harness/house-health.js';
import { getDiscoveryQueue, approveCandidate, getDiscoveryBudget } from '../lib/harness/house-discovery.js';
import { getEnrichmentReport } from '../lib/harness/enrichment-engine.js';
import { runManagerCycle, getManagerReport, setManagerConfig, getManagerConfig } from '../lib/harness/manager.js';
import { watchAuctionCalendar, watchOne } from '../lib/pipeline/auction-watcher.js';
import { BROKEN_EXTRACTORS } from './analyse.js';
import { invalidateAllLotsCache } from './search.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

router.get('/api/cache-status', async (req, res) => {
  // Require admin auth to prevent internal state leakage
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('house, url, total_lots, title_splits, top_picks, under_100k, avg_yield, dev_potential, vacant_count, created_at, expires_at, scraped_with, extracted_with, ai_tier, last_scraped_at')
      .order('house');

    const allAuctions = await getCalendarAuctions();
    const ready = allAuctions.filter(a => a.catalogueReady);
    const cachedUrls = new Set((cached || []).map(c => normaliseUrl(c.url)));

    const now = new Date().toISOString();
    const activeCached = (cached || []).filter(c => c.expires_at > now);
    const expiredCached = (cached || []).filter(c => c.expires_at <= now);
    const totalLots = (cached || []).reduce((s, c) => s + (c.total_lots || 0), 0);
    const activeLots = activeCached.reduce((s, c) => s + (c.total_lots || 0), 0);
    const expiredLots = expiredCached.reduce((s, c) => s + (c.total_lots || 0), 0);
    const missingRaw = ready.filter(a => !cachedUrls.has(normaliseUrl(a.url)));
    // Dedup missing entries by house+date so each auction appears once, not once per lot URL
    const missingMap = new Map();
    for (const a of missingRaw) {
      const key = `${a.house}::${a.date}`;
      if (!missingMap.has(key)) missingMap.set(key, a);
    }
    const missing = [...missingMap.values()];

    res.json({
      summary: {
        totalCached: (cached || []).length,
        activeCached: activeCached.length,
        expiredCached: expiredCached.length,
        totalReady: ready.length,
        totalLots,
        activeLots,
        expiredLots,
        missingCount: missing.length,
      },
      cached: (cached || []).map(c => ({ ...c, _expired: c.expires_at <= now })),
      missing: missing.map(a => ({ house: a.house, url: a.url, date: a.date, status: a.status || 'upcoming' })),
    });
  } catch (e) {
    log.error('Cache status error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/refresh-cache', async (req, res) => {
  const { secret } = req.body || {};
  if (!process.env.ADMIN_SECRET || !safeCompare(secret, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  res.json({ message: 'Auto-analysis triggered. Check server logs for progress.' });
  // Run async — don't block the response
  autoAnalyseAll().catch(e => console.error('Manual refresh failed:', e));
});

// Admin: backfill images for all cached catalogues (no AI tokens used)
router.post('/api/admin/backfill-images', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    // Get active catalogues (metadata only)
    const { data: activeCats } = await supabase
      .from('cached_analyses')
      .select('url, house')
      .gt('expires_at', new Date().toISOString());

    if (!activeCats || activeCats.length === 0) return res.json({ message: 'No cached catalogues found', results: [] });

    const results = [];
    for (const entry of activeCats) {
      // Read lots from lots table
      const { data: lotRows } = await supabase
        .from('lots')
        .select(LOTS_SELECT)
        .eq('catalogue_url', entry.url);
      const lots = (lotRows || []).map(dbRowToFrontendLot);
      const missingImages = lots.filter(l => !l.imageUrl).length;
      if (missingImages === 0) {
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing: 0, gained: 0, status: 'skipped — all have images' });
        continue;
      }

      let gained = 0;

      // Step 1: Plain HTTP backfill from catalogue page (works for server-rendered sites)
      const lotsWithUrl = lots.filter(l => l.url && !l.imageUrl).length;
      if (lotsWithUrl > 0) {
        const updated = await backfillImages(entry.url, lots);
        if (updated) {
          gained += updated.filter(l => l.imageUrl).length - (lots.length - missingImages);
        }
        // Step 2: Deep backfill from individual lot pages
        const stillMissing = lots.filter(l => l.url && !l.imageUrl).length;
        if (stillMissing > 0) {
          const deepGained = await backfillImagesFromLotPages(lots);
          gained += deepGained;
        }
      }

      // Step 3: Rendered backfill — try both engines for best coverage
      const stillNoImages = lots.filter(l => !l.imageUrl).length;
      if (stillNoImages > 0 && PUPPETEER_IMAGE_HOUSES.has(entry.house)) {
        // Pass 1: Firecrawl
        if (FIRECRAWL_API_KEY && !isFcCreditExhausted()) {
          gained += await backfillImagesWithFirecrawl(entry.url, lots, entry.house);
        }
        // Pass 2: Puppeteer for remaining
        const afterFc = lots.filter(l => !l.imageUrl).length;
        if (afterFc > 0 && puppeteer) {
          gained += await backfillImagesWithPuppeteer(entry.url, lots, entry.house);
        }
      }

      if (gained > 0) {
        // Write enriched lots back to lots table
        normaliseLotStatuses(lots);
        await upsertToLotsTable(lots, entry.house, entry.url, { scrapedWith: 'image-backfill' });
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing: missingImages, gained, status: 'updated' });
      } else {
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing: missingImages, gained: 0, status: 'no matches found' });
      }
    }

    const totalGained = results.reduce((s, r) => s + r.gained, 0);
    res.json({ message: `Backfill complete. ${totalGained} images added across ${activeCats.length} catalogues.`, results });
  } catch (err) {
    log.error('Image backfill error', { error: err.message });
    res.status(500).json({ error: 'Image backfill failed. Check server logs.' });
  }
});

// Admin-only: clear cached analyses to force re-scrape
// Admin-only diagnostic: fetch any URL via Firecrawl and return rawHtml +
// markdown + image count. For self-healing extractor diagnostics — when
// curl returns a JS-shell, this gives the real rendered DOM. Costs 1
// Firecrawl credit per call.
router.post('/api/admin/firecrawl-probe', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const { url, waitFor, withMarkdown = false, withImages = true } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url (string) is required' });
  }
  try {
    const formats = ['rawHtml'];
    if (withImages) formats.push('images');
    if (withMarkdown) formats.push('markdown');
    const result = await scrapeWithFirecrawl(url, {
      formats,
      waitFor: typeof waitFor === 'number' ? waitFor : 2000,
    });
    res.json({
      url: result.sourceURL || url,
      htmlLength: (result.html || '').length,
      html: result.html || '',
      markdown: withMarkdown ? (result.markdown || '') : undefined,
      images: withImages ? (result.images || []) : undefined,
      imageCount: (result.images || []).length,
    });
  } catch (err) {
    log.warn('Firecrawl probe failed', { url, err: err.message });
    res.status(502).json({ error: `Firecrawl probe failed: ${err.message}` });
  }
});

// Admin: run the "Human-Eye" visual auditor in-process. Returns findings
// JSON (and optionally writes alerts). See scripts/visual-audit.mjs.
router.post('/api/admin/visual-audit', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const { runAudit, writeAlerts } = await import('../scripts/visual-audit.mjs');
    const writeAlertsFlag = req.body?.writeAlerts !== false; // default true
    const result = await runAudit();
    let alertsWritten = 0;
    if (writeAlertsFlag) alertsWritten = await writeAlerts(result.findings);
    res.json({
      scannedRows: result.scannedRows,
      ms: result.ms,
      findingCount: result.findings.length,
      findings: result.findings,
      alertsWritten,
    });
  } catch (err) {
    log.warn('Visual audit failed', { err: err.message });
    res.status(500).json({ error: `Visual audit failed: ${err.message}` });
  }
});

router.post('/api/admin/clear-cache', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const house = req.body?.house;
    let query;
    if (house) {
      query = supabase.from('cached_analyses').delete().eq('house', house);
    } else {
      query = supabase.from('cached_analyses').delete().neq('url', '');
    }
    const { data, error } = await query.select();
    if (error) throw error;

    const cleared = data ? data.length : 0;
    const houses = data ? [...new Set(data.map(r => r.house))].filter(Boolean) : [];
    // Invalidate the in-memory /api/all-lots cache so the API reflects the
    // delete immediately rather than waiting for the 10-min TTL.
    invalidateAllLotsCache();
    log.info('Cache cleared', { house: house || 'ALL', cleared });
    res.json({
      message: house
        ? `Cache cleared for ${house}. ${cleared} entries deleted. Next autoAnalyseAll will re-scrape.`
        : `All cache cleared. ${cleared} entries deleted. Next autoAnalyseAll will re-scrape.`,
      cleared, houses,
    });
  } catch (err) {
    log.error('Cache clear error', { error: err.message });
    res.status(500).json({ error: 'Cache clear failed' });
  }
});

// Admin-only: rescrape a specific house (clear cache + trigger immediate re-analysis)
router.post('/api/admin/rescrape', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const { house } = req.body || {};
  if (!house) return res.status(400).json({ error: 'house slug is required' });

  try {
    // 1. Delete cached data for this house
    const { data: deleted } = await supabase
      .from('cached_analyses')
      .delete()
      .eq('house', house)
      .select('url');
    const cleared = deleted ? deleted.length : 0;

    // 2. Find calendar URLs for this house to re-scrape
    const calendar = await getAuctionCalendar();
    const urls = calendar
      .filter(a => a.houseSlug === house || (a.house || '').toLowerCase().replace(/[^a-z]/g, '') === house)
      .map(a => a.url)
      .filter(Boolean);

    // Fallback to HOUSE_ROOTS if no calendar entries
    if (urls.length === 0 && HOUSE_ROOTS[house]) {
      urls.push(HOUSE_ROOTS[house]);
    }

    if (urls.length === 0) {
      return res.json({ message: `Cache cleared (${cleared} entries) but no URLs found to rescrape for ${house}`, cleared, urls: [] });
    }

    // 3. Trigger re-analysis in background (don't block response)
    res.json({ message: `Rescraping ${house}: cleared ${cleared} cached entries, now analysing ${urls.length} URL(s)`, cleared, urls });

    for (const url of urls) {
      try {
        await autoAnalyseOne(url);
      } catch (err) {
        log.error('Rescrape autoAnalyseOne error', { house, url, error: err.message });
      }
    }
    // Invalidate the in-memory /api/all-lots cache so fresh scrape results
    // (or a blocked=true outcome with no upsert) propagate to the API
    // immediately rather than waiting for the 10-min TTL.
    invalidateAllLotsCache();
    log.info('Rescrape complete', { house, urls: urls.length });
  } catch (err) {
    log.error('Rescrape error', { house, error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Rescrape failed: ' + err.message });
  }
});

// Admin-only: GET broken extractors list
router.get('/api/admin/broken-extractors', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  res.json({
    broken: [...BROKEN_EXTRACTORS],
    count: BROKEN_EXTRACTORS.size,
  });
});

// Admin-only: POST enable/disable broken extractors
router.post('/api/admin/broken-extractors', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { house, action, reason } = req.body || {};
  if (!house || !action) {
    return res.status(400).json({ error: 'house and action (disable|enable) are required' });
  }

  if (action === 'disable') {
    BROKEN_EXTRACTORS.add(house);
    console.log(`BROKEN: Disabled extractor for ${house}${reason ? ': ' + reason : ''}`);

    // Persist to Supabase house_skills
    try {
      await supabase.from('house_skills')
        .update({ status: 'broken', notes: reason || 'Auto-disabled by audit' })
        .eq('slug', house);
    } catch (err) { console.warn('BROKEN: Failed to persist disable:', err.message); }

    // Pipeline alert
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'extractor_broken',
        severity: 'error',
        house,
        message: `Extractor disabled for ${HOUSE_DISPLAY_NAMES[house] || house}: ${reason || 'manual disable'}`,
      });
    } catch (err) { console.warn('BROKEN: Failed to send alert:', err.message); }

    res.json({ message: `Extractor for ${house} disabled`, broken: [...BROKEN_EXTRACTORS] });

  } else if (action === 'enable') {
    BROKEN_EXTRACTORS.delete(house);
    console.log(`BROKEN: Re-enabled extractor for ${house}`);

    // Persist to Supabase house_skills
    try {
      await supabase.from('house_skills')
        .update({ status: 'healthy', notes: 'Re-enabled after fix' })
        .eq('slug', house);
    } catch (err) { console.warn('BROKEN: Failed to persist enable:', err.message); }

    // Pipeline alert
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'extractor_fixed',
        severity: 'info',
        house,
        message: `Extractor re-enabled for ${HOUSE_DISPLAY_NAMES[house] || house}`,
      });
    } catch (err) { console.warn('BROKEN: Failed to send alert:', err.message); }

    res.json({ message: `Extractor for ${house} re-enabled`, broken: [...BROKEN_EXTRACTORS] });

  } else {
    res.status(400).json({ error: 'action must be "disable" or "enable"' });
  }
});

// Admin-only: test DOM extractor on a URL (diagnostics)
router.post('/api/admin/test-extractor', rateLimit(60000, 5), async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  const house = req.body.house || detectAuctionHouse(url);

  try {
    // Use Firecrawl+JSDOM (primary) or Puppeteer (fallback) to render the page
    const result = await scrapeRenderedPage(url, house);
    const html = result.html;
    const dom = new JSDOM(html, { url });
    const { document } = dom.window;

    // Check which CSS selectors match on the rendered page
    const test = sel => document.querySelectorAll(sel).length;
    const selectorMatches = {
      '.property-card': test('.property-card'), '.lot-card': test('.lot-card'),
      '.lot': test('.lot'), '.lot-panel': test('.lot-panel'),
      '.property-list-card': test('.property-list-card'), '.search-result': test('.search-result'),
      'article': test('article'), '.current-lots-single': test('.current-lots-single'),
      '.lot-item': test('.lot-item'), '[class*="property"]': test('[class*="property"]'),
      '[class*="lot"]': test('[class*="lot"]'), 'img[src]': test('img[src]'),
      'img[data-src]': test('img[data-src]'), '.swiper-slide img': test('.swiper-slide img'),
      '[data-mainpic]': test('[data-mainpic]'),
    };

    const pageTitle = document.title || '';
    dom.window.close();

    // Run the actual DOM extractor via JSDOM (pass Firecrawl images if available)
    const lots = extractWithJSDOM(html, house, url, result?.images);
    const hasImages = lots ? lots.filter(l => l.imageUrl).length : 0;
    const hasUrls = lots ? lots.filter(l => l.url && l.url !== '').length : 0;

    res.json({
      house, url, pageTitle,
      hasExtractor: !!DOM_EXTRACTORS[house],
      lotCount: lots ? lots.length : 0,
      lotsWithImages: hasImages,
      lotsWithUrls: hasUrls,
      sampleLots: lots ? lots.slice(0, 3) : [],
      selectorMatches,
      scrapedWith: FIRECRAWL_API_KEY && !isFcCreditExhausted() && !FIRECRAWL_SKIP.has(house) ? 'firecrawl' : (puppeteer ? 'puppeteer' : 'http'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, house });
  }
});

// Admin-only: analyse all catalogue-ready auctions
router.post('/api/analyse-all', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Trigger auto-analysis and wait for it to complete
  try {
    const result = await autoAnalyseAll();
    res.json(result);
  } catch (e) {
    log.error('Refresh cache error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Scrape only houses that have never been cached — much lighter than autoAnalyseAll
router.post('/api/analyse-new', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    // Get all catalogue-ready auctions
    const allAuctions = await getCalendarAuctions();
    const ready = allAuctions.filter(a => a.catalogueReady);

    // Get already-cached URLs
    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('url');
    const cachedUrls = new Set((cached || []).map(c => normaliseUrl(c.url)));

    // Filter to only uncached
    const uncached = ready.filter(a => !cachedUrls.has(normaliseUrl(a.url)));

    // Dedup by house
    const byHouse = new Map();
    for (const a of uncached) {
      if (!byHouse.has(a.house)) byHouse.set(a.house, a);
    }
    const toScrape = [...byHouse.values()];

    log.info(`ANALYSE-NEW: ${toScrape.length} uncached houses to scrape (${ready.length} total ready, ${cachedUrls.size} cached)`);
    res.json({
      message: `Scraping ${toScrape.length} new houses in background`,
      houses: toScrape.map(a => a.house),
      total: toScrape.length,
    });

    // Run in background — process in parallel batches for speed
    // With probe skip for uncached houses, each only does 1 Firecrawl call.
    // Gemini rate limit is 15 RPM but DOM-extractor houses don't need Gemini.
    const CONCURRENCY = 5;
    let done = 0, failed = 0;
    for (let i = 0; i < toScrape.length; i += CONCURRENCY) {
      const batch = toScrape.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (auction, idx) => {
          const n = i + idx + 1;
          console.log(`ANALYSE-NEW: [${n}/${toScrape.length}] ${auction.house} — ${auction.url}`);
          await autoAnalyseOne(auction.url);
          return auction.house;
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') { done++; }
        else { failed++; console.error(`ANALYSE-NEW: ✗ failed: ${r.reason?.message || r.reason}`); }
      }
      // Brief pause between batches (autoAnalyseOne has its own Gemini rate limiting)
      if (i + CONCURRENCY < toScrape.length) await new Promise(r => setTimeout(r, 1000));
    }
    console.log(`ANALYSE-NEW COMPLETE: ${done} succeeded, ${failed} failed out of ${toScrape.length}`);
  } catch (e) {
    log.error('Analyse-new error', { error: e.message });
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ═══════════════════════════════════════════════════════════════
router.get('/admin', (req, res) => {
  res.sendFile(join(__dirname, '..', 'admin.html'));
});

// ═══════════════════════════════════════════════════════════════
// CATCH-ALL
// ═══════════════════════════════════════════════════════════════
router.get('/welcome', (req, res) => {
  res.sendFile(join(__dirname, '..', 'welcome.html'));
});

// ═══════════════════════════════════════════════════════════════
// LEGAL PAGES
// ═══════════════════════════════════════════════════════════════
router.get('/privacy', (req, res) => {
  res.sendFile(join(__dirname, '..', 'privacy.html'));
});
router.get('/terms', (req, res) => {
  res.sendFile(join(__dirname, '..', 'terms.html'));
});

// ═══════════════════════════════════════════════════════════════
// BRIDGEMATCH LITE
// ═══════════════════════════════════════════════════════════════
router.get('/check', (req, res) => {
  if (process.env.UMAMI_WEBSITE_ID) {
    try {
      let html = readFileSync(join(__dirname, '..', 'bridgematch-lite.html'), 'utf-8');
      html = html.replace('data-website-id=""', `data-website-id="${process.env.UMAMI_WEBSITE_ID}"`);
      return res.type('html').send(html);
    } catch (e) { /* fall through to sendFile */ }
  }
  res.sendFile(join(__dirname, '..', 'bridgematch-lite.html'));
});

router.get('/api/admin/daily-stats', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data: events } = await supabase
      .from('activity_events')
      .select('action, detail, user_email')
      .gte('created_at', since);

    const rows = events || [];
    const analyses = rows.filter(r => r.action === 'analysis').length;
    const smart_searches = rows.filter(r => r.action === 'smart_search').length;
    const leads = rows.filter(r => r.action === 'lead_submit').length;
    const unique_users = new Set(rows.filter(r => r.user_email).map(r => r.user_email)).size;

    res.json({ analyses, smart_searches, leads, unique_users, total_events: rows.length });
  } catch (e) {
    log.error('Daily stats error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Per-house skill files (health dashboard) ──
router.get('/api/skills', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const { data, error } = await supabase.from('house_skills').select('*').order('slug');
    if (error) throw error;
    const skills = data || [];
    const healthy = skills.filter(s => s.status === 'healthy').length;
    const degraded = skills.filter(s => s.status === 'degraded').length;
    const broken = skills.filter(s => s.status === 'broken').length;
    res.json({ skills, summary: { total: skills.length, healthy, degraded, broken } });
  } catch (e) {
    log.error('Skills endpoint error', { error: e.message });
    res.json({ skills: [], summary: { total: 0, healthy: 0, degraded: 0, broken: 0 } });
  }
});

// ── AI cost monitoring endpoint ──
router.get('/api/admin/ai-costs', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const summary = getAICostSummary();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    let byModel = [];
    const { data, error } = await supabase
      .from('ai_usage')
      .select('provider, model, tokens_in, tokens_out, est_cost')
      .gte('created_at', todayStart.toISOString());
    if (!error && data) {
      const groups = {};
      for (const row of data) {
        const key = `${row.provider}/${row.model}`;
        if (!groups[key]) groups[key] = { provider: row.provider, model: row.model, calls: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
        groups[key].calls++;
        groups[key].tokens_in += row.tokens_in || 0;
        groups[key].tokens_out += row.tokens_out || 0;
        groups[key].cost += parseFloat(row.est_cost) || 0;
      }
      byModel = Object.values(groups);
    }
    res.json({
      dailyTotal: summary.dailyCostTotal,
      budget: summary.budget,
      budgetExceeded: summary.budgetExceeded,
      callCount: summary.callCount,
      provider: summary.provider,
      byModel,
    });
  } catch (err) {
    console.error('AI costs endpoint error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Consolidated system health endpoint ──
router.get('/api/admin/system-health', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    // 1. Broken extractors
    const brokenExtractors = [...BROKEN_EXTRACTORS];

    // 2. AI costs
    const aiSummary = getAICostSummary();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    let byModel = {};
    const { data: aiData } = await supabase
      .from('ai_usage')
      .select('provider, model, tokens_in, tokens_out, est_cost')
      .gte('created_at', todayStart.toISOString());
    if (aiData) {
      for (const row of aiData) {
        const key = `${row.provider}/${row.model}`;
        if (!byModel[key]) byModel[key] = { calls: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
        byModel[key].calls++;
        byModel[key].tokens_in += row.tokens_in || 0;
        byModel[key].tokens_out += row.tokens_out || 0;
        byModel[key].cost += parseFloat(row.est_cost) || 0;
      }
    }
    const aiCosts = {
      dailyTotal: aiSummary.dailyCostTotal,
      budget: aiSummary.budget,
      overBudget: aiSummary.budgetExceeded,
      byModel,
      callCount: aiSummary.callCount,
    };

    // 3. Coverage — per-house lot counts and image coverage
    const [{ data: cachedMeta }, { data: lotRows }, { data: skills }] = await Promise.all([
      supabase.from('cached_analyses').select('house, expires_at, created_at'),
      supabase.from('lots').select('house, image_url, beds'),
      supabase.from('house_skills').select('slug, status, last_scraped'),
    ]);

    const skillMap = {};
    if (skills) {
      for (const s of skills) skillMap[s.slug] = s;
    }

    const now = new Date();
    const houseMap = {};
    let totalLots = 0;
    let totalImages = 0;
    let totalLotsForImg = 0;

    // Build house metadata from cached_analyses (staleness, last scraped)
    if (cachedMeta) {
      for (const row of cachedMeta) {
        const slug = row.house;
        if (!houseMap[slug]) {
          houseMap[slug] = { slug, displayName: HOUSE_DISPLAY_NAMES[slug] || slug, lotCount: 0, imageCoverage: 0, bedCoverage: 0, status: 'active', lastScraped: null, _imgCount: 0, _lotCount: 0, _bedCount: 0, _hasExpiredCache: false };
        }
        const h = houseMap[slug];
        if (row.created_at && (!h.lastScraped || row.created_at > h.lastScraped)) {
          h.lastScraped = row.created_at;
        }
        if (row.expires_at && new Date(row.expires_at) < now) {
          h._hasExpiredCache = true;
        }
      }
    }

    // Build lot coverage from lots table
    if (lotRows) {
      for (const lot of lotRows) {
        const slug = lot.house;
        if (!houseMap[slug]) {
          houseMap[slug] = { slug, displayName: HOUSE_DISPLAY_NAMES[slug] || slug, lotCount: 0, imageCoverage: 0, bedCoverage: 0, status: 'active', lastScraped: null, _imgCount: 0, _lotCount: 0, _bedCount: 0, _hasExpiredCache: false };
        }
        const h = houseMap[slug];
        h.lotCount++;
        h._lotCount++;
        totalLots++;
        totalLotsForImg++;
        if (lot.image_url) { h._imgCount++; totalImages++; }
        if (lot.beds != null) { h._bedCount++; }
      }
    }

    // Mark stale only if cache expired AND no lots (evaluated after both loops)
    for (const h of Object.values(houseMap)) {
      if (h._hasExpiredCache && h.lotCount === 0) h.status = 'stale';
    }

    const houses = Object.values(houseMap).map(h => {
      const skill = skillMap[h.slug];
      if (skill && skill.status === 'broken') h.status = 'broken';
      if (skill && skill.last_scraped) h.lastScraped = skill.last_scraped;
      h.imageCoverage = h._lotCount > 0 ? Math.round(h._imgCount / h._lotCount * 100) : 0;
      h.bedCoverage = h._lotCount > 0 ? Math.round(h._bedCount / h._lotCount * 100) : 0;
      delete h._imgCount;
      delete h._bedCount;
      delete h._lotCount;
      delete h._hasExpiredCache;
      return h;
    });

    const activeHouses = houses.filter(h => h.status === 'active').length;
    const staleHouses = houses.filter(h => h.status === 'stale').length;

    const coverage = {
      houses,
      totalHouses: houses.length,
      activeHouses,
      staleHouses,
      totalLots,
      avgImageCoverage: totalLotsForImg > 0 ? Math.round(totalImages / totalLotsForImg * 100) : 0,
      avgBedCoverage: totalLots > 0 ? Math.round(houses.reduce((s, h) => s + (h.bedCoverage * h.lotCount / 100), 0) / totalLots * 100) : 0,
      lowBedCoverageHouses: houses.filter(h => h.lotCount > 5 && h.bedCoverage < 50).map(h => ({ slug: h.slug, lots: h.lotCount, bedCoverage: h.bedCoverage + '%' })),
    };

    // 4. Pipeline health
    const pipeline = {
      firecrawl: {
        status: isFcCreditExhausted() ? 'exhausted' : isFcTemporarilyDown() ? 'down' : 'ok',
        creditsUsed: getFcCreditsUsed(),
        creditBudget: getFirecrawlStatus().monthlyBudget,
        exhausted: isFcCreditExhausted(),
      },
      gemini: {
        status: getCreditExhausted() ? 'exhausted' : 'ok',
        exhausted: getCreditExhausted(),
        provider: process.env.AI_PROVIDER || 'gemini',
      },
      puppeteer: {
        status: puppeteer ? 'available' : 'unavailable',
        available: !!puppeteer,
      },
      autoAnalyse: {
        running: isAutoAnalysisRunning(),
        lastRun: null,
        nextRun: null,
      },
    };

    res.json({ brokenExtractors, aiCosts, coverage, pipeline });
  } catch (err) {
    console.error('System health endpoint error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Missing images admin endpoint ──
router.get('/api/admin/missing-images', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }

  try {
    const houseFilter = req.query.house || '';
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    // Query lots table for lots missing images (from active catalogues)
    let lotQuery = supabase
      .from('lots')
      .select('house, lot_number, address, catalogue_url, auction_date, image_url')
      .or('image_url.is.null,image_url.eq.');

    if (houseFilter) {
      lotQuery = lotQuery.ilike('house', `%${houseFilter}%`);
    }

    // Filter to active catalogues at DB level + apply limit
    const { data: activeCats } = await supabase
      .from('cached_analyses')
      .select('url')
      .gte('expires_at', new Date().toISOString());
    const activeUrls = (activeCats || []).map(c => c.url);
    if (activeUrls.length > 0) {
      lotQuery = lotQuery.in('catalogue_url', activeUrls);
    }
    lotQuery = lotQuery.limit(2000);

    const { data: missingRows, error } = await lotQuery;
    if (error) throw error;

    const missingLots = [];
    const houseCounts = {};

    for (const row of (missingRows || [])) {
      missingLots.push({
        house: row.house,
        lotNumber: row.lot_number || null,
        address: row.address || '',
        catalogueUrl: row.catalogue_url,
        auctionDate: row.auction_date || null,
      });
      houseCounts[row.house] = (houseCounts[row.house] || 0) + 1;
    }

    // Apply pagination
    const paginated = missingLots.slice(offset, offset + limit);

    res.json({
      total: missingLots.length,
      houses: Object.keys(houseCounts).length,
      houseCounts,
      offset,
      limit,
      results: paginated,
    });
  } catch (e) {
    log.error('Missing images endpoint error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/cost-monitor', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const { data: cached } = await supabase.from('cached_analyses').select('house, expires_at');
    const now = new Date();
    const houses = cached || [];
    const freshCount = houses.filter(h => h.expires_at && new Date(h.expires_at) > now).length;
    const SKIP_PUPPETEER_LIST = ['philliparnold','knightfrank'];
    res.json({
      weeklyEstimate: {
        geminiApiCalls: getApiCallCount(),
        estimatedCost: 0,
        creditExhausted: getCreditExhausted(),
        lastResetAt: getServerStartTime()
      },
      cacheStats: {
        totalHouses: houses.length,
        housesWithFreshCache: freshCount,
        housesWithStaleCache: houses.length - freshCount,
        contentHashHits: getHashHitCount()
      },
      firecrawl: {
        enabled: !!FIRECRAWL_API_KEY,
        ...getFirecrawlStatus(),
        skipHouses: [...FIRECRAWL_SKIP],
      },
      puppeteerSkipList: SKIP_PUPPETEER_LIST,
      puppeteerAvailable: !!puppeteer,
      lookaheadLimit: MAX_AUCTIONS_PER_HOUSE,
      pageCapLimit: MAX_PUPPETEER_PAGES,
      lotsCapLimit: MAX_LOTS_PER_SCRAPE
    });
  } catch (e) {
    log.error('Cost monitor error', { error: e.message });
    res.status(500).json({ error: 'Cost monitor failed. Check server logs.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Admin: run auction-watcher on demand
// ═══════════════════════════════════════════════════════════════
// Body (optional):
//   { secret, slug?: string, force?: boolean }
// If `slug` is provided, watches only that Cat B house. Otherwise all.
// `force=true` bypasses the "already has upcoming entry" early-exit.
// Returns { results: [...] } from the watcher.
router.post('/api/admin/run-watcher', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  try {
    const { slug, force } = req.body || {};
    if (slug) {
      const r = await watchOne(slug, { force: !!force });
      return res.json({ ok: true, result: r });
    }
    const r = await watchAuctionCalendar({ force: !!force });
    return res.json({ ok: true, ...r });
  } catch (e) {
    log.error('run-watcher error', { error: e.message });
    return res.status(500).json({ error: 'Watcher failed', detail: e.message });
  }
});

router.get('/api/quality-report', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    // Get cache metadata (no lots JSONB) and lots from lots table
    const [{ data: cached }, { data: lotRows }] = await Promise.all([
      supabase.from('cached_analyses').select('house, url, expires_at, created_at, content_hash'),
      supabase.from('lots').select(LOTS_SELECT),
    ]);

    const now = new Date();
    const report = { houses: [], issues: [], summary: {} };
    let totalLots = 0, housesWithZero = 0, staleHouses = 0;

    // Group cache metadata by house
    const cacheByHouse = {};
    for (const row of (cached || [])) {
      const h = row.house || 'unknown';
      if (!cacheByHouse[h]) cacheByHouse[h] = { urls: [], isStale: true, created_at: null };
      cacheByHouse[h].urls.push(row.url);
      const isStale = row.expires_at && new Date(row.expires_at) < now;
      if (!isStale) cacheByHouse[h].isStale = false;
      if (!cacheByHouse[h].created_at || (row.created_at && new Date(row.created_at) > new Date(cacheByHouse[h].created_at))) {
        cacheByHouse[h].created_at = row.created_at;
      }
    }

    // Group lots by house
    const lotsByHouse = {};
    for (const row of (lotRows || [])) {
      const h = row.house || 'unknown';
      if (!lotsByHouse[h]) lotsByHouse[h] = [];
      lotsByHouse[h].push(row);
    }

    // Merge: all houses from cache metadata + any houses only in lots table
    const allHouses = new Set([...Object.keys(cacheByHouse), ...Object.keys(lotsByHouse)]);

    for (const house of allHouses) {
      const cache = cacheByHouse[house] || { urls: [], isStale: true, created_at: null };
      const rows = lotsByHouse[house] || [];
      const lots = rows.map(dbRowToFrontendLot);
      const isStale = cache.isStale;
      const ageHours = cache.created_at ? Math.round((now - new Date(cache.created_at)) / 3600000) : null;

      const withImage = lots.filter(l => l.imageUrl).length;
      const imgCoverage = lots.length ? Math.round((withImage / lots.length) * 100) : 0;

      totalLots += lots.length;
      if (lots.length === 0) housesWithZero++;
      if (isStale) staleHouses++;

      let fieldCoverage = null;
      try {
        ({ fieldCoverage } = validateBatch(lots, house));
      } catch (_e) { /* non-fatal */ }

      const entry = { house, lots: lots.length, images: withImage, imgCoverage, ageHours, stale: !!isStale, fieldCoverage };
      report.houses.push(entry);

      if (lots.length === 0) report.issues.push({ severity: 'critical', house, msg: 'Zero lots — extractor may be broken' });
      if (imgCoverage < 30 && lots.length > 0) report.issues.push({ severity: 'warn', house, msg: `Low image coverage: ${imgCoverage}%` });
      if (isStale) report.issues.push({ severity: 'info', house, msg: `Cache stale (${ageHours}h old)` });
    }

    report.summary = { totalHouses: allHouses.size, totalLots, housesWithZero, staleHouses };
    res.json(report);
  } catch (e) {
    log.error('Quality report error', { error: e.message });
    res.status(500).json({ error: 'Quality report failed. Check server logs.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// HARNESS ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════

router.get('/api/house-health', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(getAllHealth());
});

router.get('/api/discovery/candidates', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const candidates = await getDiscoveryQueue();
  res.json({ candidates, budget: getDiscoveryBudget() });
});

router.post('/api/discovery/approve', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  const ok = await approveCandidate(url);
  res.json({ approved: ok });
});

router.get('/api/enrichment/report', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const house = req.query.house || null;
  // Get lots from lots table to generate report
  if (house) {
    const { data: lotRows } = await supabase.from('lots')
      .select(LOTS_SELECT)
      .eq('house', house);
    if (lotRows && lotRows.length > 0) {
      return res.json(getEnrichmentReport(lotRows.map(dbRowToFrontendLot), house));
    }
  }
  res.json({ message: 'Provide ?house=slug for per-house report' });
});

router.get('/api/manager/report', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const report = getManagerReport();
  res.json(report || { message: 'No manager cycle has run yet' });
});

router.post('/api/manager/cycle', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const report = await runManagerCycle();
  res.json(report);
});

router.post('/api/manager/config', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { config } = req.body || {};
  if (!config) return res.status(400).json({ error: 'config object required' });
  const updated = setManagerConfig(config);
  res.json(updated);
});

router.get('/api/harness/status', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const health = getAllHealth();
  const healthCounts = { healthy: 0, degraded: 0, broken: 0 };
  for (const h of Object.values(health)) {
    if (h.status === 'broken') healthCounts.broken++;
    else if (h.status === 'degraded') healthCounts.degraded++;
    else healthCounts.healthy++;
  }
  res.json({
    health: healthCounts,
    houses: Object.keys(health).length,
    manager: getManagerReport() || { message: 'No cycle yet' },
    managerConfig: getManagerConfig(),
    discoveryBudget: getDiscoveryBudget(),
  });
});

// ── Pipeline Alerts API endpoint ──
router.get('/api/admin/alerts', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const { data: active } = await supabase
      .from('pipeline_alerts')
      .select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(50);

    const { data: recent } = await supabase
      .from('pipeline_alerts')
      .select('*')
      .eq('resolved', true)
      .order('resolved_at', { ascending: false })
      .limit(20);

    res.json({ active: active || [], recent: recent || [] });
  } catch (e) {
    log.error('Alerts endpoint error', { error: e.message });
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// ── Data Freshness API endpoint ──
router.get('/api/admin/freshness', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const { data: houses } = await supabase
      .from('house_skills')
      .select('slug, house, status, last_verified, last_lot_count, image_coverage, last_diff')
      .order('house');

    res.json({ houses: houses || [] });
  } catch (e) {
    log.error('Freshness endpoint error', { error: e.message });
    res.status(500).json({ error: 'Failed to fetch freshness data' });
  }
});

// ── Umami Cloud API helpers ──
async function fetchUmamiStats(startAt, endAt) {
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  const apiKey = process.env.UMAMI_API_KEY;
  if (!websiteId || !apiKey) return null;
  try {
    const res = await fetch(
      `https://api.umami.is/v1/websites/${websiteId}/stats?startAt=${startAt}&endAt=${endAt}`,
      { headers: { 'x-umami-api-key': apiKey, 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    log.warn('Umami stats API error', { error: e.message });
    return null;
  }
}

async function fetchUmamiMetrics(startAt, endAt, type) {
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  const apiKey = process.env.UMAMI_API_KEY;
  if (!websiteId || !apiKey) return [];
  try {
    const res = await fetch(
      `https://api.umami.is/v1/websites/${websiteId}/metrics?startAt=${startAt}&endAt=${endAt}&type=${type}`,
      { headers: { 'x-umami-api-key': apiKey, 'Accept': 'application/json' } }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    log.warn('Umami metrics API error', { error: e.message });
    return [];
  }
}

// ── Analytics API endpoint ──
router.get('/api/admin/analytics', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endAt = Date.now();
    const startAt = endAt - days * 24 * 60 * 60 * 1000;

    const [snapshots, umamiStats, umamiReferrers, activityEvents] = await Promise.all([
      supabase.from('analytics_snapshots').select('*').gte('date', since).order('date', { ascending: true }),
      fetchUmamiStats(startAt, endAt),
      fetchUmamiMetrics(startAt, endAt, 'referrer'),
      supabase.from('activity_events').select('action, detail, created_at, user_email')
        .gte('created_at', new Date(startAt).toISOString())
        .order('created_at', { ascending: true }),
    ]);

    res.json({
      snapshots: snapshots.data || [],
      umami: umamiStats,
      referrers: umamiReferrers,
      events: activityEvents.data || [],
    });
  } catch (e) {
    log.error('Analytics endpoint error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Seed today's snapshot on demand ──
router.post('/api/admin/seed-snapshot', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    await saveDailySnapshot();
    res.json({ ok: true, message: 'Snapshot saved' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Re-enrich lots with missing data ──
router.post('/api/admin/re-enrich', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const limit = Math.min(req.body?.limit || 200, 500);
    const house = req.body?.house || null; // optional: target specific house
    const dryRun = req.body?.dryRun !== false;

    console.log(`RE-ENRICH: Starting (limit=${limit}, house=${house || 'all'}, dryRun=${dryRun})...`);

    // Find lots needing enrichment: no enriched_at, or no score and recently seen
    let query = supabase
      .from('lots')
      .select('*')
      .or('enriched_at.is.null,score.is.null')
      .order('last_seen_at', { ascending: false })
      .limit(limit);
    if (house) query = query.eq('house', house);

    const { data: lots, error: lotsErr } = await query;
    if (lotsErr) throw new Error(`Failed to fetch lots: ${lotsErr.message}`);
    if (!lots || lots.length === 0) return res.json({ enriched: 0, message: 'No lots need enrichment' });

    // Group by house + catalogue_url for batch processing
    const groups = {};
    for (const lot of lots) {
      const key = `${lot.house}|${lot.catalogue_url}`;
      if (!groups[key]) groups[key] = { house: lot.house, catalogueUrl: lot.catalogue_url, lots: [] };
      groups[key].lots.push(lot);
    }

    if (dryRun) {
      const perHouse = {};
      for (const lot of lots) perHouse[lot.house] = (perHouse[lot.house] || 0) + 1;
      const gaps = {
        noScore: lots.filter(l => l.score == null).length,
        noEnrichedAt: lots.filter(l => !l.enriched_at).length,
        noPostcode: lots.filter(l => !l.postcode).length,
        noStreetAvg: lots.filter(l => l.street_avg == null).length,
        noYield: lots.filter(l => l.est_gross_yield == null).length,
        noCondition: lots.filter(l => !l.condition).length,
        noEpc: lots.filter(l => !l.epc_rating).length,
      };
      return res.json({ dryRun: true, found: lots.length, perHouse, gaps, message: 'POST with { "dryRun": false } to execute' });
    }

    let totalEnriched = 0;
    for (const [, group] of Object.entries(groups)) {
      try {
        // Convert DB rows back to in-memory lot format (includes postcode extraction + metadata)
        const lotObjs = group.lots.map(dbRowToLot);

        // Re-analyse lots that have no score (rebuilds scoring from scratch)
        const needsAnalysis = lotObjs.filter(l => l.score === 0 && (!l.scoreBreakdown || l.scoreBreakdown.length === 0));
        for (let i = 0; i < needsAnalysis.length; i++) {
          const reanalysed = analyseLot(needsAnalysis[i]);
          Object.assign(needsAnalysis[i], reanalysed);
        }

        // Run enrichLots for street comps, yield, EPC, flood
        await enrichLots(lotObjs, group.house, group.catalogueUrl);

        // Write enriched data back to lots table
        normaliseLotStatuses(lotObjs);
        await upsertToLotsTable(lotObjs, group.house, group.catalogueUrl, {
          scrapedWith: 're-enrich',
        });
        totalEnriched += lotObjs.length;
        console.log(`RE-ENRICH: ✓ ${group.house}: ${lotObjs.length} lots re-enriched`);
      } catch (groupErr) {
        console.warn(`RE-ENRICH: Failed for ${group.house}: ${groupErr.message}`);
      }
    }

    console.log(`RE-ENRICH: Complete — ${totalEnriched}/${lots.length} lots enriched`);
    res.json({ enriched: totalEnriched, total: lots.length, groups: Object.keys(groups).length });
  } catch (e) {
    console.error('RE-ENRICH: Failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Manual trigger for enrichment waves ──
router.post('/api/admin/enrich-waves', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  if (isEnrichmentWaveRunning()) return res.json({ ok: false, message: 'Enrichment wave already running' });
  runEnrichmentWave().catch(e => console.error('Manual enrichment wave failed:', e.message));
  res.json({ ok: true, message: 'Enrichment wave started in background' });
});

// ── Lightweight event tracking for client-only actions ──
router.post('/api/track/event', rateLimit(60000, 60), async (req, res) => {
  const { action, detail } = req.body || {};
  const allowed = ['deal_stacking', 'csv_export', 'bridgematch_open', 'lot_view', 'paywall_hit'];
  if (!action || !allowed.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const user = await validateUserFromReq(req).catch(() => null);
  logActivityEvent(action, detail || {}, user?.email || null, getClientIP(req));
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
// INTEL — single fat endpoint powering the admin dashboard's
// Intel / Lots & Houses / Billing tabs. Returns user activity,
// search patterns, lot pipeline, house performance, and billing
// signals in one round-trip so the admin UI doesn't N+1.
// ═══════════════════════════════════════════════════════════════
router.get('/api/admin/intel', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }

  try {
    const now = new Date();
    const day = 24 * 60 * 60 * 1000;
    const sinceISO = (msAgo) => new Date(now.getTime() - msAgo).toISOString();
    const since30d = sinceISO(30 * day);
    const since7d  = sinceISO(7 * day);
    const since24h = sinceISO(day);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    // Run all reads in parallel — small data volumes mean this is trivially fast.
    const [
      usersAllRes,
      eventsRes,
      lotsRecentRes,
      statusHistoryRes,
      newLotsTodayRes,
      lotsByHouseRes,
      titleSplitsRes,
      vacantResRes,
      derelictRes,
      topScoredRes,
      emailSignupsRes,
      leadsRes,
      auctionsUpcomingRes,
      alertsCountRes,
      cachedAnalysesRes,
    ] = await Promise.all([
      // All users for tier/funnel/timeseries
      supabase.from('users')
        .select('id, email, tier, tier_expires_at, trial_started_at, trial_expires_at, trial_used, stripe_subscription_id, supabase_auth_id, created_at, last_login, ai_searches_today, ai_searches_date, onboarding_complete'),
      // Last 30 days of activity events (grouping/funnel/search intel)
      supabase.from('activity_events')
        .select('id, action, detail, user_email, created_at')
        .gte('created_at', since30d)
        .order('created_at', { ascending: false })
        .limit(2000),
      // Lots seen in last 7d for status-pipeline counts
      supabase.from('lots')
        .select('id, house, lot_number, address, price, status, score, est_gross_yield, prop_type, vacant, title_split, deal_type, last_seen_at, first_seen_at, sold_price')
        .gte('last_seen_at', since7d)
        .limit(8000),
      // Lot status changes in last 7d for pipeline view
      supabase.from('lot_status_history')
        .select('lot_id, old_status, new_status, changed_at')
        .gte('changed_at', since7d)
        .limit(20000),
      // New lots today (cheap aggregate)
      supabase.from('lots').select('id', { count: 'exact', head: true }).gte('first_seen_at', todayStart),
      // Lots per house (active in last 7d) — count by house client-side from lotsRecentRes; this is just an extra aggregate
      supabase.from('lots').select('house', { count: 'exact', head: true }),
      // Title splits, vacant resi, derelict counts — high-value inventory categories
      supabase.from('lots').select('id', { count: 'exact', head: true }).eq('title_split', true).gte('last_seen_at', since7d),
      supabase.from('lots').select('id', { count: 'exact', head: true }).eq('vacant', true).gte('last_seen_at', since7d),
      supabase.from('lots').select('id', { count: 'exact', head: true }).gte('score', 7).gte('last_seen_at', since7d),
      // Top-scored lots in market right now
      supabase.from('lots')
        .select('id, house, lot_number, address, price, score, est_gross_yield, prop_type, deal_type, image_url')
        .gte('last_seen_at', since7d)
        .order('score', { ascending: false, nullsFirst: false })
        .limit(10),
      // Landing page email signups
      supabase.from('email_signups').select('id, email, created_at, source').order('created_at', { ascending: false }).limit(500),
      // Bridging leads
      supabase.from('leads').select('id, name, email, property_price, loan_amount, created_at, source').order('created_at', { ascending: false }).limit(50),
      // Upcoming auctions
      supabase.from('auction_calendar').select('house, date, lots').gte('date', todayStart).lte('date', new Date(now.getTime() + 30 * day).toISOString()),
      // Open pipeline_alerts count (separately because 6800+ rows)
      supabase.from('pipeline_alerts').select('id', { count: 'exact', head: true }).eq('resolved', false),
      // Cached analyses for house freshness (already used elsewhere — duplicate read but cheap)
      supabase.from('cached_analyses').select('house, total_lots, last_scraped_at, expires_at, scraped_with, extracted_with').order('last_scraped_at', { ascending: false }).limit(200),
    ]);

    const allUsers = usersAllRes.data || [];
    const events = eventsRes.data || [];
    const lots = lotsRecentRes.data || [];
    const statusHistory = statusHistoryRes.data || [];
    const topScored = topScoredRes.data || [];
    const emailSignups = emailSignupsRes.data || [];
    const leads = leadsRes.data || [];
    const upcoming = auctionsUpcomingRes.data || [];
    const cached = cachedAnalysesRes.data || [];

    // ── USERS ──
    const totalUsers = allUsers.length;
    const dau = new Set(events.filter(e => e.created_at >= since24h && e.user_email).map(e => e.user_email)).size;
    const wau = new Set(events.filter(e => e.created_at >= since7d && e.user_email).map(e => e.user_email)).size;
    const mau = new Set(events.filter(e => e.user_email).map(e => e.user_email)).size;

    // Signup timeline (last 30 days, by date)
    const signupBuckets = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * day);
      const key = d.toISOString().slice(0, 10);
      signupBuckets[key] = 0;
    }
    for (const u of allUsers) {
      if (!u.created_at) continue;
      const key = u.created_at.slice(0, 10);
      if (key in signupBuckets) signupBuckets[key]++;
    }
    const signupsTimeseries = Object.entries(signupBuckets).map(([date, count]) => ({ date, count }));

    // Tier breakdown — uses resolveEffectiveTier-style logic inline (paid/trial/free)
    const tierBreakdown = { paid: 0, trial: 0, free: 0, anon: 0 };
    for (const u of allUsers) {
      const expired = u.tier_expires_at && new Date(u.tier_expires_at) < now;
      if (u.stripe_subscription_id && !expired) tierBreakdown.paid++;
      else if (u.trial_expires_at && new Date(u.trial_expires_at) > now) tierBreakdown.trial++;
      else tierBreakdown.free++;
    }
    tierBreakdown.anon = totalUsers; // total signed-in baseline; anon traffic isn't auth-tracked

    // Sign-in method — supabase_auth_id non-null and tied to OAuth provider info isn't captured here,
    // but we can split "has OAuth-style id" vs "magic-link only" as a proxy.
    // (Supabase doesn't expose provider in our user row, so we just count magic vs total.)
    const signInMethod = {
      total: allUsers.filter(u => u.supabase_auth_id).length,
      // True provider breakdown would require a Supabase auth.users join — leave as note
    };

    // ── FUNNEL (last 30d) ──
    const usersWith30dActivity = new Set(events.filter(e => e.user_email).map(e => e.user_email));
    const usersWithSearch = new Set(events.filter(e => e.action === 'smart_search' && e.user_email).map(e => e.user_email));
    const searchCounts = {};
    for (const e of events) {
      if (e.action === 'smart_search' && e.user_email) {
        searchCounts[e.user_email] = (searchCounts[e.user_email] || 0) + 1;
      }
    }
    const usersWithRepeat = Object.values(searchCounts).filter(c => c >= 2).length;
    const paid = tierBreakdown.paid + tierBreakdown.trial;
    const funnel = {
      signedUp: totalUsers,
      activatedAnyAction: usersWith30dActivity.size,
      firstSearch: usersWithSearch.size,
      repeatSearch: usersWithRepeat,
      converted: paid,
    };

    // ── SEARCH INTEL ──
    const searchQueryCounts = {};
    const searchQueryNoResults = {};
    for (const e of events) {
      if (e.action !== 'smart_search') continue;
      const q = e.detail?.query || e.detail?.q || null;
      if (!q || typeof q !== 'string') continue;
      const norm = q.trim().toLowerCase().slice(0, 80);
      searchQueryCounts[norm] = (searchQueryCounts[norm] || 0) + 1;
      const resultCount = e.detail?.results ?? e.detail?.result_count ?? null;
      if (resultCount === 0) searchQueryNoResults[norm] = (searchQueryNoResults[norm] || 0) + 1;
    }
    const topQueries = Object.entries(searchQueryCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([query, count]) => ({ query, count }));
    const noResults = Object.entries(searchQueryNoResults)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([query, count]) => ({ query, count }));

    // ── FEATURES ──
    const featureBreakdown = {};
    for (const e of events) {
      if (!e.action) continue;
      featureBreakdown[e.action] = featureBreakdown[e.action] || { total: 0, last7d: 0, last24h: 0, mostRecent: null };
      featureBreakdown[e.action].total++;
      if (e.created_at >= since7d) featureBreakdown[e.action].last7d++;
      if (e.created_at >= since24h) featureBreakdown[e.action].last24h++;
      if (!featureBreakdown[e.action].mostRecent || e.created_at > featureBreakdown[e.action].mostRecent) {
        featureBreakdown[e.action].mostRecent = e.created_at;
      }
    }

    // ── LOT PIPELINE TODAY ──
    const newToday = newLotsTodayRes.count || 0;
    const todaysStatus = statusHistory.filter(h => h.changed_at >= todayStart);
    const endedToday   = todaysStatus.filter(h => ['ended', 'sold', 'withdrawn', 'unsold'].includes(h.new_status)).length;
    const soldToday    = todaysStatus.filter(h => h.new_status === 'sold').length;
    const withdrawnToday = todaysStatus.filter(h => h.new_status === 'withdrawn').length;
    const unsoldToday  = todaysStatus.filter(h => h.new_status === 'unsold').length;

    // Title splits / vacant / high-score counts
    const lotInventory = {
      total: lots.length,
      titleSplits: titleSplitsRes.count || 0,
      vacant: vacantResRes.count || 0,
      highScore: derelictRes.count || 0, // score >=7 — rebadge as "top picks" in UI
      newToday, endedToday, soldToday, withdrawnToday, unsoldToday,
    };

    // ── HOUSE LEAGUE TABLE ──
    // Build from cached_analyses (canonical lot counts) + recent lots count
    const houseLotsRecent = {};
    for (const l of lots) houseLotsRecent[l.house] = (houseLotsRecent[l.house] || 0) + 1;
    const houseAvgScore = {};
    const houseScoreSum = {};
    for (const l of lots) {
      if (l.score == null) continue;
      houseScoreSum[l.house] = (houseScoreSum[l.house] || 0) + l.score;
      houseAvgScore[l.house] = (houseAvgScore[l.house] || 0) + 1;
    }
    const houseLeague = (cached || [])
      .filter(c => c.house)
      .map(c => ({
        house: c.house,
        cachedLots: c.total_lots || 0,
        recentLots: houseLotsRecent[c.house] || 0,
        avgScore: houseAvgScore[c.house] ? +(houseScoreSum[c.house] / houseAvgScore[c.house]).toFixed(2) : null,
        lastScrapedAt: c.last_scraped_at,
        scraper: c.scraped_with || '?',
        extractor: c.extracted_with || '?',
        upcomingDate: upcoming.find(u => u.house?.toLowerCase().includes(c.house))?.date || null,
      }))
      .sort((a, b) => (b.cachedLots || 0) - (a.cachedLots || 0));

    // ── BILLING SIGNALS ──
    // Free users hitting their AI cap today
    const todayDateKey = todayStart.slice(0, 10);
    const hittingCap = allUsers.filter(u =>
      (u.tier === 'free' || !u.tier) &&
      u.ai_searches_date === todayDateKey &&
      (u.ai_searches_today || 0) >= 3 // FREE_AI_SEARCH_LIMIT default
    ).length;
    const paywallHits = events.filter(e => e.action === 'paywall_hit').length;

    // Trial-active users + their activity in last 7d
    const trialActive = allUsers.filter(u => u.trial_expires_at && new Date(u.trial_expires_at) > now);
    const trialActivity = trialActive.map(u => {
      const recentEvents = events.filter(e => e.user_email === u.email);
      const trialEndsIn = Math.ceil((new Date(u.trial_expires_at) - now) / day);
      return {
        email: u.email,
        trialEndsInDays: trialEndsIn,
        eventsLast30d: recentEvents.length,
        lastAction: recentEvents[0]?.action || null,
        lastActionAt: recentEvents[0]?.created_at || null,
      };
    });

    // Recent signups + first action
    const recentSignups = allUsers
      .filter(u => u.created_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 10)
      .map(u => {
        const userEvents = events.filter(e => e.user_email === u.email).sort((a, b) => a.created_at.localeCompare(b.created_at));
        return {
          email: u.email,
          signedUpAt: u.created_at,
          firstAction: userEvents[0]?.action || null,
          firstActionAt: userEvents[0]?.created_at || null,
          totalEvents: userEvents.length,
        };
      });

    // Top users by activity
    const userEventCounts = {};
    for (const e of events) {
      if (!e.user_email) continue;
      userEventCounts[e.user_email] = (userEventCounts[e.user_email] || 0) + 1;
    }
    const topUsers = Object.entries(userEventCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([email, count]) => ({ email, count }));

    res.json({
      generatedAt: now.toISOString(),
      users: {
        total: totalUsers,
        dau, wau, mau,
        signupsTimeseries,
        tierBreakdown,
        signInMethod,
        recentSignups,
        topUsers,
      },
      funnel,
      searches: { topQueries, noResults },
      features: featureBreakdown,
      lots: {
        ...lotInventory,
        topScored: topScored.slice(0, 10),
      },
      houses: { leagueTable: houseLeague, upcoming: upcoming.slice(0, 30) },
      billing: {
        paid: tierBreakdown.paid,
        trial: tierBreakdown.trial,
        free: tierBreakdown.free,
        hittingCap,
        paywallHits,
        trialActivity,
        emailSignupsTotal: emailSignups.length,
        emailSignupsLast7d: emailSignups.filter(s => s.created_at >= since7d).length,
        leadsTotal: leads.length,
        leadsLast7d: leads.filter(l => l.created_at >= since7d).length,
        recentLeads: leads.slice(0, 10),
      },
      ops: {
        openAlerts: alertsCountRes.count || 0,
      },
    });
  } catch (e) {
    log.error('Intel endpoint error', { error: e.message, stack: e.stack });
    res.status(500).json({ error: 'Intel query failed', detail: e.message });
  }
});

// ── Stale alert cleanup — archive resolved/old pipeline_alerts ──
// Currently 6,800+ unresolved alerts most of which are noise from temporary
// scraper failures that have long since resolved themselves.
router.post('/api/admin/alerts/cleanup', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  const olderThanDays = Math.max(1, Math.min(365, parseInt(req.body?.olderThanDays) || 7));
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from('pipeline_alerts')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('resolved', false)
      .lt('created_at', cutoff)
      .select('id');
    if (error) throw error;
    res.json({ ok: true, archived: data?.length || 0, olderThanDays });
  } catch (e) {
    log.error('Alert cleanup error', { error: e.message });
    res.status(500).json({ error: 'Cleanup failed', detail: e.message });
  }
});

export default router;
