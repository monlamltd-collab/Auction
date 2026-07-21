// routes/analyse.js — Analyse catalogue route (extracted from server.js)
import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { supabase } from '../lib/supabase.js';
import { validateUserFromReq, safeCompare, getClientIP } from '../lib/auth.js';
import { validateUrl, safeFetch } from '../lib/security.js';
import { log, sseWrite } from '../lib/logging.js';
import { resolveEffectiveTier, getCacheTTL, RATE_LIMIT_PER_DAY, FREE_SCAN_LIMIT, stripAIFields, HEADERS } from '../lib/config.js';
import { getAuctionDateForUrl } from '../lib/calendar.js';
import { detectAuctionHouse, getHouseDisplayName, HOUSE_DISPLAY_NAMES, rewriteUrl } from '../lib/houses.js';
import { normaliseUrl } from '../lib/utils.js';
import {
  scrapeRenderedPage, scrapeAllsopApi, extractAllsopLotsFromJson, scrapeUnderTheHammer,
  extractLotsWithAI, extractLotsFromPdf, isPdfUrl,
  enrichLotsFromLotPages, normaliseLotStatuses,
  getLastScrapeEngine, getLastAITier,
  cacheLotDetail, withTier,
} from '../lib/scraper.js';
import { getLastExtractorUsed } from '../lib/scraper/state.js';
import { extractCatalogueListing, extractLotDetailFirecrawl } from '../lib/pipeline/firecrawl-extract.js';
import { resolveEngineForHouse } from '../lib/pipeline/engine-decision.js';
import { ENGINES } from '../lib/scraper/engine-router.js';
import { renderAndExtractWithCrawlee } from '../lib/pipeline/crawlee-extract.js';
import { htmlToRecognitionMarkdown } from '../lib/scraper/html-to-markdown.js';
import { getExtractionTier } from '../lib/scraper/extraction-tier.js';
import { houseRecogniser } from '../lib/scraper/house-recognisers.js';
import { enrichLots } from '../lib/enrichment.js';
import { enrichLotsWithFundability } from '../lib/fundability.js';
import { qualityGate, analyseLot, upsertToLotsTable, logActivityEvent } from '../lib/analysis.js';
import { LOTS_SELECT, dbRowToLot, normaliseScrapedLot } from '../lib/types/lot.js';
import { getLotsForCatalogue } from '../lib/pipeline/lot-lookup.js';
import { enrichBatch } from '../lib/harness/enrichment-engine.js';

const router = Router();

// ── Config constants ──
const RATE_LIMIT = RATE_LIMIT_PER_DAY;

// ═══════════════════════════════════════════════════════════════
// API: ANALYSE CATALOGUE
// ═══════════════════════════════════════════════════════════════
// asyncHandler: the pre-SSE section (auth, rate limits, cache lookup) runs
// outside the handler's try/catch — a rejection there previously hung the
// request (Phase 5).
router.post('/api/analyse', asyncHandler(async (req, res) => {
  const { url, budget, email } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });

  // ── Validate URL to prevent SSRF ──
  const urlCheck = await validateUrl(url);
  if (!urlCheck.ok) return res.status(400).json({ error: urlCheck.error });

  // ── Check user is signed up (token-based auth with email fallback) ──
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'signup_required', message: 'Please sign up to use the analyser' });

  // ── Tier info (centralised via resolveEffectiveTier) ──
  const userTier = resolveEffectiveTier(user);
  const scanCount = user.analyses_count || 0;

  // ── Rate limiting (admin bypass with ADMIN_SECRET header) ──
  // Keyed on the USER first (Phase 5): IP alone false-429s offices/CGNAT
  // sharing an address AND is trivially evaded by rotating IPs. The route
  // requires sign-in, so the user id is always available; the rate_limits
  // key column is text, so a `u:<id>` key shares the table + RPC. IP keeps
  // a looser 3× ceiling as a mass-account backstop.
  const isAdmin = process.env.ADMIN_SECRET && safeCompare(req.headers['x-admin-secret'], process.env.ADMIN_SECRET);
  const ip = getClientIP(req);
  const today = new Date().toISOString().slice(0, 10);

  const countFor = async (key) => {
    // Atomic upsert+increment via RPC, fallback to a read if not deployed
    try {
      const { data: n } = await supabase.rpc('increment_rate_limit', { p_ip: key, p_date: today });
      return n ?? 0;
    } catch {
      const { data: rateRow } = await supabase
        .from('rate_limits')
        .select('requests')
        .eq('ip', key)
        .eq('date', today)
        .single();
      return rateRow?.requests ?? 0;
    }
  };

  const userRequests = await countFor(`u:${user.id}`);
  const ipRequests = await countFor(ip);

  if (!isAdmin && (userRequests >= RATE_LIMIT || ipRequests >= RATE_LIMIT * 3)) {
    return res.status(429).json({
      error: 'rate_limited',
      message: `Daily limit reached (${RATE_LIMIT} analyses per day). Try again tomorrow.`
    });
  }

  // ── Check cache (metadata only — lot data comes from lots table) ──
  const normalisedUrl = normaliseUrl(url);
  const { data: cached } = await supabase
    .from('cached_analyses')
    .select('house, url, total_lots, title_splits, top_picks, under_100k, avg_yield, dev_potential, vacant_count, expires_at')
    .eq('url', normalisedUrl)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (cached) {
    console.log(`Cache hit for ${normalisedUrl} — reading lots from lots table`);
    const cachedSlug = HOUSE_DISPLAY_NAMES[cached.house]
      ? cached.house
      : Object.entries(HOUSE_DISPLAY_NAMES).find(([k, v]) => v === cached.house)?.[0] || cached.house;
    const cachedDisplayName = HOUSE_DISPLAY_NAMES[cachedSlug] || cached.house;
    const isPremium = userTier === 'premium';

    // Read fresh lot data from lots table (single source of truth). Move 2:
    // dual-read helper; no auctionId resolved here, legacy path fires. The
    // helper returns rows unordered — sort client-side to preserve the
    // pre-Move-2 score-desc ordering (nulls last).
    const { data: lotRows } = await getLotsForCatalogue(supabase, {
      house: cached.house,
      catalogueUrl: normalisedUrl,
      select: LOTS_SELECT,
    });
    const sortedLotRows = (lotRows || []).slice().sort((a, b) => {
      if (a.score == null && b.score == null) return 0;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    });

    const freshLots = sortedLotRows.map(dbRowToLot);
    const gatedLots = isPremium ? freshLots : stripAIFields(freshLots);

    // Recompute summary stats from fresh data
    const lotsWithPrice = freshLots.filter(l => l.price && l.price > 0);
    const yieldsArr = freshLots.map(l => l.estGrossYield).filter(y => y && y > 0);

    return res.json({
      house: cachedDisplayName,
      houseSlug: cachedSlug,
      recognised: cachedSlug !== 'unknown',
      totalLots: freshLots.length,
      titleSplits: freshLots.filter(l => l.titleSplit).length,
      topPicks: freshLots.filter(l => l.score >= 3).length,
      under100k: lotsWithPrice.filter(l => l.price < 100000).length,
      avgYield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
      devPotential: freshLots.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
      vacantCount: freshLots.filter(l => l.vacant === true).length,
      lots: gatedLots,
      cached: true,
      blurred: !isPremium,
      scansUsed: scanCount,
      scanLimit: FREE_SCAN_LIMIT,
    });
  }

  // Rate counter already incremented atomically above (pre-cache check)
  // For cached responses, the count was bumped but that's acceptable (prevents cache-probe abuse)

  // ── Fresh analysis — stream progress via SSE ──
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'API key not configured' });

  // Set up SSE stream
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Cost-amplification guard (Phase 5): without this, N opened-and-dropped
  // SSE connections each ran the FULL scrape → AI-extract → per-lot-fetch
  // pipeline to completion for an audience of nobody. Checked at phase
  // boundaries — mid-library aborts aren't feasible, but the boundaries
  // bracket the expensive stages.
  let clientGone = false;
  res.on('close', () => { clientGone = true; });
  const abortIfGone = (stage) => {
    if (!clientGone) return false;
    log.info('analyse: client disconnected — aborting', { stage, url });
    try { res.end(); } catch { /* already closed */ }
    return true;
  };

  try {
    if (abortIfGone('pre-scrape')) return;
    const house = detectAuctionHouse(url);
    const rewritten = await rewriteUrl(url, house);
    const scrapeUrl = rewritten.baseUrl;
    const displayNameEarly = getHouseDisplayName(house, url);

    console.log(`House: ${house}, URL: ${scrapeUrl}, isApi: ${rewritten.isApi}, preferPuppeteer: ${!!rewritten.preferPuppeteer}`);
    sseWrite(res, 'phase', { step: 'connecting', house: displayNameEarly });

    // Validate URL first (skip for sites that block server-side fetches)
    if (!rewritten.preferPuppeteer) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        // safeFetch re-validates every redirect hop — the initial validateUrl
        // (above) only checked the first host, so a 302 to an internal address
        // would otherwise slip through native fetch's redirect-following.
        const testResp = await safeFetch(url, { headers: HEADERS, signal: controller.signal });
        clearTimeout(timeout);
        if (!testResp.ok) {
          sseWrite(res, 'error', { message: `That URL returned an error (${testResp.status}). It may not be a catalogue page, or the catalogue hasn't been published yet.` });
          return res.end();
        }
      } catch (e) {
        sseWrite(res, 'error', { message: "Couldn't reach that URL. Check it's a valid catalogue page." });
        return res.end();
      }
    }

    let pages;
    let rawLots = [];

    sseWrite(res, 'phase', { step: 'scraping' });

    const onExtract = (batch, totalBatches, lotsFound) => {
      sseWrite(res, 'extract', { batch, totalBatches, lotsFound });
    };

    // ── PDF catalogues — send directly to Gemini ──
    if (isPdfUrl(url)) {
      log.info('pdf_detected', { url, house });
      rawLots = await extractLotsFromPdf(url);
    } else if (rewritten.paginateAs === 'allsop_api') {
      // Allsop API: parse JSON directly (no Gemini needed)
      pages = await scrapeAllsopApi(rewritten.baseUrl);
      sseWrite(res, 'scrape', { pages: pages.length });
      if (pages.length > 0) {
        sseWrite(res, 'phase', { step: 'extracting' });
        rawLots = extractAllsopLotsFromJson(pages);
      }
    } else if (rewritten.paginateAs === 'underthehammer_api') {
      // Under The Hammer JSON API — mirrors the cron path (lib/pipeline/scrape-stage.js)
      // so the on-demand route can't drift. Returns already-normalised lots,
      // filtered to the live book.
      sseWrite(res, 'phase', { step: 'extracting' });
      rawLots = await scrapeUnderTheHammer(rewritten.baseUrl);
      sseWrite(res, 'scrape', { pages: 1, lots: rawLots.length });
    } else if (houseRecogniser(house)?.staticCatalogue) {
      // ── Static-HTTP catalogue (SSR houses, e.g. BTG/sdl) ──
      // Plain HTTP keeps the inline "Guide Price: £X" a browser render would
      // hydrate away (see lib/analysis.js for the cron-side rationale). Same
      // turndown→recogniser path, mirrored here so the on-demand path doesn't
      // drift from cron (house-recognisers.js header).
      sseWrite(res, 'phase', { step: 'extracting' });
      const rec = houseRecogniser(house);
      const resp = await safeFetch(scrapeUrl, { headers: HEADERS });
      const html = await resp.text();
      const md = htmlToRecognitionMarkdown(html, scrapeUrl);
      const map = rec.recogniseFromMarkdown(md);
      rawLots = [...(map?.values?.() || [])]
        .map(l => normaliseScrapedLot(l, { house, catalogueUrl: scrapeUrl, extractionSource: 'static-recognition' }))
        .filter(Boolean);
      sseWrite(res, 'scrape', { pages: 1, lots: rawLots.length });
      console.log(`Static HTTP catalogue for ${house}: ${rawLots.length} lots`);
    } else {
      // ── Engine router (conservative on the latency-sensitive user path) ──
      // Crawlee runs here only for a house already PROMOTED to it, or as the
      // zero-credit failover when Firecrawl is exhausted (better a slower
      // answer than none). Never shadow-compare here — migration/evaluation
      // happens on the cron path (lib/analysis.js).
      sseWrite(res, 'phase', { step: 'extracting' });
      let engineSkill = null;
      try {
        const { data } = await supabase
          .from('house_skills')
          .select('preferred_engine, engine_locked, engine_stats')
          .eq('slug', house)
          .maybeSingle();
        engineSkill = data || null;
      } catch { /* fall back to Firecrawl if the lookup fails */ }
      const { engine: chosenEngine } = resolveEngineForHouse({
        house, rewritten, catalogueUrl: scrapeUrl, engineSkill,
      });

      try {
        if (chosenEngine === ENGINES.CRAWLEE) {
          // Recogniser houses keep full recall via the turndown bridge (Phase 3).
          const rec = houseRecogniser(house);
          console.log(`Engine router: ${house} → crawlee (on-demand)${rec ? ' +recogniser' : ''}`);
          const cr = await renderAndExtractWithCrawlee(scrapeUrl, house, {
            // Hard cap: local sequential renders inside an SSE request must
            // stay bounded (Pattinson's 84-page cap is a cron-path budget).
            maxPages: Math.min(rec?.maxPages || 25, 25),
            recogniseFromMarkdown: rec?.recogniseFromMarkdown,
            recallSentinelPattern: rec?.recallSentinelPattern,
            tier: getExtractionTier(engineSkill, house),
            onExtract,
          });
          rawLots = cr.lots || [];
          sseWrite(res, 'scrape', { pages: cr.renderedPages.length, lots: rawLots.length });
          console.log(`Crawlee+Gemini for ${house}: ${rawLots.length} lots`);
        } else {
          // ── Firecrawl JSON extract — handles pagination natively ──
          // forceExtract=true: /analyse is user-initiated, bypass changeTracking
          // short-circuit so the response always reflects the live catalogue.
          const result = await extractCatalogueListing(scrapeUrl, house, {
            paginateAs: rewritten.paginateAs,
            maxPages: 25,
            forceExtract: true,
          });
          rawLots = result.lots || [];
          sseWrite(res, 'scrape', { pages: 1, lots: rawLots.length });
          console.log(`Firecrawl extract for ${house}: ${rawLots.length} lots`);
        }

        // Gemini fallback if Firecrawl JSON returned nothing useful.
        if (rawLots.length === 0) {
          console.log(`Firecrawl extract returned 0 lots for ${house}; falling back to Gemini`);
          const renderOpts = {};
          if (rewritten.waitFor) renderOpts.waitFor = rewritten.waitFor;
          if (rewritten.actions) renderOpts.actions = rewritten.actions;
          const rendered = await scrapeRenderedPage(scrapeUrl, house, renderOpts);
          if (rendered && rendered.html) {
            const renderedPages = [{ page: 1, html: rendered.html, markdown: rendered.markdown }];
            rawLots = await extractLotsWithAI(renderedPages, house, onExtract, scrapeUrl) || [];
            console.log(`Gemini fallback for ${house}: ${rawLots.length} lots`);
          }
        }
      } catch (err) {
        log.error('Catalogue extraction failed', { house, error: err.message });
        sseWrite(res, 'error', { message: 'Scraping engine unavailable — please try again in a moment.' });
        return res.end();
      }
    }

    if (pages && pages.length === 0 && rawLots.length === 0) {
      sseWrite(res, 'error', { message: "Couldn't find any content on that page." });
      return res.end();
    }

    if (rawLots.length === 0) {
      sseWrite(res, 'error', { message: "Couldn't find any auction lots. Make sure you're linking to the catalogue page, not the auction house homepage." });
      return res.end();
    }

    if (abortIfGone('post-extraction')) return;

    sseWrite(res, 'phase', { step: 'scoring', lots: rawLots.length });

    const analysed = rawLots.map(lot => analyseLot(lot)).sort((a, b) => b.score - a.score);

    // ── Enrich with Land Registry + rental yields (also resolves lot URLs) ──
    console.log('Starting Land Registry + rental yield enrichment...');
    sseWrite(res, 'phase', { step: 'enriching', lots: analysed.length });
    await enrichLots(analysed, house, url, (done, total) => {
      sseWrite(res, 'enrich', { postcodes: done, total });
    });

    if (abortIfGone('post-enrich')) return;

    // ── Unified lot-page enrichment: single fetch per lot extracts all missing data ──
    // (address, image, tenure, leaseLength, condition, beds, propType)
    // Fan-out capped on this latency-sensitive user path (Phase 5) — the
    // 80-fetch default belongs to the cron budget. Deferred lots persist
    // with catalogue data; the overnight cycle gap-fills them.
    await enrichLotsFromLotPages(analysed, { maxDetailFetches: 30 });

    if (abortIfGone('post-lot-pages')) return;

    // ── Harness enrichment: gap-filling, cross-lot inference, cache carry-forward ──
    // Move 2: dual-read helper; no auctionId resolved here, legacy path fires.
    const { data: prevLotRows } = await getLotsForCatalogue(supabase, {
      house,
      catalogueUrl: normalisedUrl,
      select: LOTS_SELECT,
    });
    const harnessResult = enrichBatch(analysed, house, {
      previousCache: (prevLotRows || []).map(dbRowToLot),
    });
    const enrichedAnalysed = harnessResult.lots;
    if (harnessResult.stats.enriched > 0) {
      console.log(`HARNESS (manual): ${house}: enriched ${harnessResult.stats.enriched} lots (${harnessResult.stats.fieldsImproved.join(', ')})`);
    }
    // Re-score after enrichment fills gaps (e.g. tenure, beds may affect score)
    for (const lot of enrichedAnalysed) {
      const rescored = analyseLot(lot);
      Object.assign(lot, rescored);
    }

    // ── Fundability badges — fire-and-forget, never blocks pipeline ──
    try {
      await enrichLotsWithFundability(enrichedAnalysed);
    } catch (e) {
      console.warn('Fundability enrichment failed (non-fatal):', e.message);
    }

    // ── Cache results ──
    const displayName = getHouseDisplayName(house, url);
    const auctionDate = await getAuctionDateForUrl(normalisedUrl);
    const expiresAt = new Date(Date.now() + getCacheTTL(house, auctionDate)).toISOString();

    // Log unknown house successes for future house addition
    if (house === 'unknown' && enrichedAnalysed.length >= 3) {
      log.info('NEW_HOUSE_CANDIDATE', { hostname: new URL(url).hostname, lots: enrichedAnalysed.length, url });
    }

    // Check if catalogue data actually changed before invalidating preset cache
    const { data: prevCached } = await supabase
      .from('cached_analyses')
      .select('total_lots, top_picks, title_splits')
      .eq('url', normalisedUrl)
      .single();

    // ── Quality gate — validate batch before caching ──
    // prevLotRows already fetched above for enrichBatch
    const qg = qualityGate(enrichedAnalysed, house, prevCached, (prevLotRows || []).map(dbRowToLot));
    // For manual analyses, log but don't reject — user explicitly asked for this
    if (qg.alerts.length > 0) {
      for (const a of qg.alerts) sseWrite(res, 'warn', { message: a });
    }

    const lotsWithPrice = enrichedAnalysed.filter(l => l.price && l.price > 0);
    const yieldsArr = enrichedAnalysed.map(l => l.estGrossYield).filter(y => y && y > 0);

    const catalogueChanged = !prevCached
      || prevCached.total_lots !== enrichedAnalysed.length
      || prevCached.top_picks !== enrichedAnalysed.filter(l => l.score >= 3).length
      || prevCached.title_splits !== enrichedAnalysed.filter(l => l.titleSplit).length;

    await supabase.from('cached_analyses').upsert({
      url: normalisedUrl,
      house: house,
      total_lots: enrichedAnalysed.length,
      title_splits: enrichedAnalysed.filter(l => l.titleSplit).length,
      top_picks: enrichedAnalysed.filter(l => l.score >= 3).length,
      under_100k: lotsWithPrice.filter(l => l.price < 100000).length,
      avg_yield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
      dev_potential: enrichedAnalysed.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
      vacant_count: enrichedAnalysed.filter(l => l.vacant === true).length,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      last_scraped_at: new Date().toISOString(),
      scraped_with: getLastScrapeEngine(),
    extracted_with: getLastExtractorUsed(),
    ai_tier: getLastAITier(),
    }, { onConflict: 'url' });

    // ── Upsert individual lots to lots table (single source of truth) ──
    normaliseLotStatuses(enrichedAnalysed); // Normalize before write — canonical statuses only
    await upsertToLotsTable(enrichedAnalysed, house, url, {
      scrapedWith: getLastScrapeEngine(),
      extractedWith: getLastExtractorUsed(),
    });

    // ── Update user count ──
    await supabase.from('users')
      .update({ analyses_count: (user.analyses_count || 0) + 1 })
      .eq('id', user.id);

    // Log activity event
    logActivityEvent('analysis', { house: displayName, url: normalisedUrl, lots_found: enrichedAnalysed.length }, user?.email, getClientIP(req));

    const updatedScanCount = (user.analyses_count || 0) + 1;

    const isPremium = userTier === 'premium';
    const gatedAnalysed = isPremium ? enrichedAnalysed : stripAIFields(enrichedAnalysed);
    sseWrite(res, 'done', {
      house: displayName,
      houseSlug: house,
      recognised: house !== 'unknown',
      totalLots: enrichedAnalysed.length,
      titleSplits: enrichedAnalysed.filter(l => l.titleSplit).length,
      topPicks: enrichedAnalysed.filter(l => l.score >= 3).length,
      under100k: lotsWithPrice.filter(l => l.price < 100000).length,
      avgYield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
      devPotential: enrichedAnalysed.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
      vacantCount: enrichedAnalysed.filter(l => l.vacant === true).length,
      lots: gatedAnalysed,
      cached: false,
      blurred: !isPremium,
      scansUsed: updatedScanCount,
      scanLimit: FREE_SCAN_LIMIT,
    });
    return res.end();
  } catch (err) {
    log.error('Analysis SSE error', { error: err.message });
    sseWrite(res, 'error', { message: 'Analysis failed' });
    return res.end();
  }
}));

// ═══════════════════════════════════════════════════════════════
// POST /api/lot — single-URL on-demand detail-page analysis
// ═══════════════════════════════════════════════════════════════
// Body: { url: string }
// Returns: { lot, house, displayName, source }
//   - source: 'cache'|'http'|'firecrawl' indicating where the HTML came from
// Uses DETAIL_EXTRACTORS for the detected house, then runs the lot through
// enrichLots (EPC/flood/Land Registry/yield) before responding. Persists
// to lot_details cache so subsequent requests for the same URL are free.
router.post('/api/lot', asyncHandler(async (req, res) => {
  return withTier('on-demand', async () => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });

    const urlCheck = await validateUrl(url);
    if (!urlCheck.ok) return res.status(400).json({ error: urlCheck.error || 'invalid URL' });

    const house = detectAuctionHouse(url);
    if (!house || house === 'unknown') return res.status(400).json({ error: 'Could not detect auction house from URL' });

    // Detail extract — render (Crawlee/Puppeteer/HTTP via scrapeRenderedPage)
    // + Gemini is now PRIMARY. Firecrawl's extractLotDetailFirecrawl is kept in
    // place (dead, per directive) but no longer called here: under
    // FIRECRAWL_CF_BYPASS_ONLY its extractDetail call throws, so it was already
    // a guaranteed no-op for these non-stealth detail pages. scrapeRenderedPage
    // short-circuits its own FC tier in CF-bypass-only mode.
    let detail = null;
    try {
      const rendered = await scrapeRenderedPage(url, house);
      if (rendered?.html) {
        const lots = await extractLotsWithAI([{ page: 1, html: rendered.html, markdown: rendered.markdown }], house, null, url) || [];
        if (lots[0]) detail = lots[0];
      }
    } catch (renderErr) {
      console.warn(`/api/lot: render+Gemini detail failed (${renderErr.message})`);
    }
    if (!detail) {
      return res.status(503).json({ error: 'Lot detail temporarily unavailable — please try again shortly.' });
    }

    // Build a lot object — fall back to URL-only if extractor returned nothing
    const lot = {
      house,
      url,
      lot: detail.lot ?? null,
      address: detail.address || '',
      postcode: detail.postcode || null,
      price: detail.price || null,
      priceText: detail.priceText || null,
      bullets: detail.bullets || [],
      images: detail.images || [],
      imageUrl: detail.imageUrl || (detail.images?.[0] || null),
      tenure: detail.tenure || null,
      leaseLength: detail.leaseLength || null,
      propType: detail.propType || null,
      beds: detail.beds ?? null,
      vacant: detail.vacant ?? null,
      viewingDates: detail.viewingDates || [],
    };

    // Score it
    Object.assign(lot, analyseLot(lot));

    // Optionally enrich with EPC/flood/comps/yield (free APIs)
    try {
      await enrichLots([lot], house, lot.url);
    } catch (e) {
      log.warn('on-demand /api/lot enrichLots failed (non-fatal)', { error: e.message });
    }

    // Persist extracted_data to lot_details cache. The HTML field is no
    // longer captured (Firecrawl JSON extract returns structured data only),
    // so cacheLotDetail is called with an empty html string.
    try {
      await cacheLotDetail(lot.url, house, '', detail || {}, 'firecrawl-json');
    } catch { /* non-fatal */ }

    return res.json({
      lot,
      house,
      displayName: getHouseDisplayName(house, url),
      source: 'firecrawl-json',
    });
  } catch (err) {
    log.error('/api/lot error', { error: err.message });
    return res.status(500).json({ error: 'Internal error' });
  }
  }); // end withTier
}));

export default router;
