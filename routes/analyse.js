// routes/analyse.js — Analyse catalogue route (extracted from server.js)
import { Router } from 'express';
import { JSDOM } from 'jsdom';
import { supabase } from '../lib/supabase.js';
import { validateUserFromReq, safeCompare, getClientIP } from '../lib/auth.js';
import { validateUrl } from '../lib/security.js';
import { log, sseWrite } from '../lib/logging.js';
import { resolveEffectiveTier, getCacheTTL, RATE_LIMIT_PER_DAY, FREE_SCAN_LIMIT, stripAIFields, HEADERS, MAX_LOTS_PER_SCRAPE } from '../lib/config.js';
import { detectAuctionHouse, getHouseDisplayName, HOUSE_DISPLAY_NAMES, rewriteUrl } from '../lib/houses.js';
import { normaliseUrl } from '../lib/utils.js';
import {
  scrapeRenderedPage, scrapeAllPages, scrapeAllsopApi, extractAllsopLotsFromJson,
  detectTotalPages, buildPageUrl, extractLotsWithAI, extractLotsFromPdf, isPdfUrl, fetchPage,
  enrichLotsFromLotPages, normaliseLotStatuses,
  getLastScrapeEngine, getLastAITier,
  fetchLotPage, cacheLotDetail,
} from '../lib/scraper.js';
import { extractLotDetail } from '../lib/extractors/details/runner.js';
import { extractWithJSDOM, DOM_EXTRACTORS, getLastExtractorUsed, setLastExtractorUsed } from '../lib/extractors/index.js';
import { enrichLots } from '../lib/enrichment.js';
import { enrichLotsWithFundability } from '../lib/fundability.js';
import { qualityGate, analyseLot, upsertToLotsTable, logActivityEvent, dbRowToFrontendLot, LOTS_SELECT } from '../lib/analysis.js';
import { enrichBatch } from '../lib/harness/enrichment-engine.js';

const router = Router();

// ── Config constants ──
const RATE_LIMIT = RATE_LIMIT_PER_DAY;

// ═══════════════════════════════════════════════════════════════
// BROKEN EXTRACTOR TRACKING (auto-populated by audit, persisted to Supabase)
// ═══════════════════════════════════════════════════════════════
const BROKEN_EXTRACTORS = new Set();

// Load broken extractors from Supabase on startup
async function loadBrokenExtractors() {
  try {
    const { data, error } = await supabase
      .from('house_skills')
      .select('slug')
      .eq('status', 'broken');
    if (error) { console.warn('BROKEN: Failed to load broken extractors:', error.message); return; }
    if (data) {
      for (const row of data) {
        BROKEN_EXTRACTORS.add(row.slug);
      }
      if (BROKEN_EXTRACTORS.size > 0) {
        console.log(`BROKEN: Loaded ${BROKEN_EXTRACTORS.size} broken extractors from Supabase: ${[...BROKEN_EXTRACTORS].join(', ')}`);
      }
    }
  } catch (err) {
    console.warn('BROKEN: Failed to load broken extractors:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// API: ANALYSE CATALOGUE
// ═══════════════════════════════════════════════════════════════
router.post('/api/analyse', async (req, res) => {
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
  const isAdmin = process.env.ADMIN_SECRET && safeCompare(req.headers['x-admin-secret'], process.env.ADMIN_SECRET);
  const ip = getClientIP(req);
  const today = new Date().toISOString().slice(0, 10);

  // Atomic rate limit check: upsert+increment in one call via RPC, fallback to select
  let currentRequests = 0;
  try {
    const { data: rateRow } = await supabase.rpc('increment_rate_limit', { p_ip: ip, p_date: today });
    currentRequests = rateRow ?? 0;
  } catch {
    // Fallback if RPC not yet deployed: read then write (non-atomic)
    const { data: rateRow } = await supabase
      .from('rate_limits')
      .select('requests')
      .eq('ip', ip)
      .eq('date', today)
      .single();
    currentRequests = rateRow?.requests ?? 0;
  }

  if (!isAdmin && currentRequests >= RATE_LIMIT) {
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

    // Read fresh lot data from lots table (single source of truth)
    const { data: lotRows } = await supabase
      .from('lots')
      .select(LOTS_SELECT)
      .eq('catalogue_url', normalisedUrl)
      .order('score', { ascending: false, nullsFirst: false });

    const freshLots = (lotRows || []).map(dbRowToFrontendLot);
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

  try {
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
        const testResp = await fetch(url, { headers: HEADERS, signal: controller.signal });
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
    } else if (rewritten.preferPuppeteer) {
      // JS-rendered sites: use Firecrawl+JSDOM (primary) or Puppeteer (fallback)
      console.log(`Scraping JS-rendered site for ${house} (Firecrawl primary, Puppeteer fallback)...`);

      try {
        // Paginated sites: build page URLs, scrape each with scrapeRenderedPage + extractWithJSDOM
        if (rewritten.paginateAs === 'savills_pages') {
          console.log(`Loading paginated Savills catalogue...`);
          const firstResult = await scrapeRenderedPage(scrapeUrl, house);
          // Detect total pages from first page HTML
          const dom = new JSDOM(firstResult.html, { url: scrapeUrl });
          const totalPages = (() => {
            const pageLinks = dom.window.document.querySelectorAll('a[href*="/page-"]');
            let max = 1;
            for (const a of pageLinks) {
              const m = a.textContent.trim().match(/^(\d+)$/);
              if (m) max = Math.max(max, parseInt(m[1]));
            }
            return max;
          })();
          dom.window.close();
          console.log(`Savills: detected ${totalPages} pages`);
          sseWrite(res, 'scrape', { pages: totalPages, lots: 0 });

          const firstPageLots = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
          if (firstPageLots && firstPageLots.length > 0) rawLots.push(...firstPageLots);
          sseWrite(res, 'scrape', { pages: totalPages, lots: rawLots.length });
          console.log(`Page 1: ${firstPageLots ? firstPageLots.length : 0} lots`);

          const maxPages = Math.min(totalPages, 50);
          for (let p = 2; p <= maxPages; p++) {
            try {
              const pageResult = await scrapeRenderedPage(`${scrapeUrl}/page-${p}`, house);
              const pageLots = extractWithJSDOM(pageResult.html, house, `${scrapeUrl}/page-${p}`, pageResult.images);
              if (pageLots && pageLots.length > 0) rawLots.push(...pageLots);
              console.log(`Page ${p}: ${pageLots ? pageLots.length : 0} lots`);
            } catch (e) {
              console.log(`Page ${p} failed: ${e.message}`);
            }
          }
          console.log(`Savills total: ${rawLots.length} lots from ${maxPages} pages via DOM extraction`);

        } else if (rewritten.paginateAs === 'sdl_pages') {
          console.log(`Loading paginated SDL catalogue...`);
          const firstResult = await scrapeRenderedPage(scrapeUrl, house);
          const sdlTotalPages = detectTotalPages(firstResult.html, scrapeUrl, house);
          console.log(`SDL: detected ${sdlTotalPages} pages`);

          const sdlFirstLots = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
          if (sdlFirstLots && sdlFirstLots.length > 0) rawLots.push(...sdlFirstLots);
          console.log(`SDL Page 1: ${sdlFirstLots ? sdlFirstLots.length : 0} lots`);

          const sdlMaxPages = Math.min(sdlTotalPages, 40);
          for (let p = 2; p <= sdlMaxPages; p++) {
            const sep = scrapeUrl.includes('?') ? '&' : '?';
            const pageUrl = `${scrapeUrl}${sep}page=${p}`;
            try {
              const pageResult = await scrapeRenderedPage(pageUrl, house);
              const pageLots = extractWithJSDOM(pageResult.html, house, pageUrl, pageResult.images);
              if (pageLots && pageLots.length > 0) {
                rawLots.push(...pageLots);
                console.log(`SDL Page ${p}: ${pageLots.length} lots`);
              } else {
                console.log(`SDL Page ${p}: 0 lots — stopping pagination`);
                break;
              }
            } catch (e) {
              console.log(`SDL Page ${p} failed: ${e.message}`);
              break;
            }
          }
          console.log(`SDL total: ${rawLots.length} lots via DOM extraction`);

        } else if (rewritten.paginateAs === 'pugh_pages') {
          // Pugh: server-rendered Laravel — plain HTTP + JSDOM (no Firecrawl needed)
          console.log(`Loading paginated Pugh catalogue (plain HTTP)...`);
          const pughHtml1 = await fetchPage(scrapeUrl);
          const pughPage1Lots = extractWithJSDOM(pughHtml1, house, scrapeUrl);
          if (pughPage1Lots && pughPage1Lots.length > 0) rawLots.push(...pughPage1Lots);
          console.log(`Pugh Page 1: ${pughPage1Lots ? pughPage1Lots.length : 0} lots`);

          // Detect total pages from first page HTML
          const pughTotalPages = detectTotalPages(pughHtml1, scrapeUrl, house);
          const pughMaxPages = Math.min(pughTotalPages, 65);
          console.log(`Pugh: detected ${pughTotalPages} pages, loading up to ${pughMaxPages}`);

          for (let p = 2; p <= pughMaxPages; p++) {
            const pageUrl = buildPageUrl(scrapeUrl, p, house);
            try {
              const pageHtml = await fetchPage(pageUrl);
              const pageLots = extractWithJSDOM(pageHtml, house, pageUrl);
              if (pageLots && pageLots.length > 0) {
                rawLots.push(...pageLots);
                if (p % 10 === 0) console.log(`Pugh Page ${p}: ${pageLots.length} lots (total so far: ${rawLots.length})`);
              } else {
                console.log(`Pugh Page ${p}: 0 lots — stopping pagination`);
                break;
              }
              await new Promise(r => setTimeout(r, 200));
            } catch (e) {
              console.log(`Pugh Page ${p} failed: ${e.message}`);
              break;
            }
          }
          console.log(`Pugh total: ${rawLots.length} lots via DOM extraction`);

        } else {
          // ── Generic extraction with auto-pagination ──
          console.log(`Loading ${scrapeUrl} for ${house}`);
          const analyseOpts = {};
          if (rewritten.waitFor) analyseOpts.waitFor = rewritten.waitFor;
          if (rewritten.actions) analyseOpts.actions = rewritten.actions;
          const firstResult = await scrapeRenderedPage(scrapeUrl, house, analyseOpts);

          const domLots = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
          if (domLots && domLots.length >= 3) {
            rawLots.push(...domLots);
            console.log(`${house} Page 1: ${domLots.length} lots via DOM extraction`);

            // Auto-detect pagination from HTML
            const detectedPages = detectTotalPages(firstResult.html, scrapeUrl, house);
            if (detectedPages > 1) {
              const maxPages = Math.min(detectedPages, 25);
              console.log(`${house}: detected ${detectedPages} pages, loading up to ${maxPages}`);

              for (let p = 2; p <= maxPages; p++) {
                if (rawLots.length >= MAX_LOTS_PER_SCRAPE) { console.log(`${house}: lot cap reached at ${rawLots.length}`); break; }
                const pageUrl = buildPageUrl(scrapeUrl, p, house);
                try {
                  const pageResult = await scrapeRenderedPage(pageUrl, house);
                  const pageLots = extractWithJSDOM(pageResult.html, house, pageUrl, pageResult.images);
                  if (pageLots && pageLots.length > 0) {
                    rawLots.push(...pageLots);
                    console.log(`${house} Page ${p}: ${pageLots.length} lots`);
                  } else {
                    console.log(`${house} Page ${p}: 0 lots — stopping pagination`);
                    break;
                  }
                } catch (e) {
                  console.log(`${house} Page ${p} failed: ${e.message}`);
                  break;
                }
              }
            }
            if (rawLots.length > MAX_LOTS_PER_SCRAPE) {
              console.log(`${house}: capping ${rawLots.length} lots to ${MAX_LOTS_PER_SCRAPE}`);
              rawLots = rawLots.slice(0, MAX_LOTS_PER_SCRAPE);
            }
            setLastExtractorUsed(DOM_EXTRACTORS[house] ? 'dom-house' : 'dom-generic');
            console.log(`${house} total: ${rawLots.length} lots via DOM extraction (no Claude needed)`);
          } else {
            // Fall back to Claude extraction
            if (domLots && domLots.length > 0) {
              console.log(`DOM extractor found only ${domLots.length} lots for ${house} (below threshold of 3), falling back to Claude`);
            }
            console.log(`Got ${firstResult.html.length} chars, sending to Claude...`);
            const renderedPages = [{ page: 1, html: firstResult.html, markdown: firstResult.markdown }];
            sseWrite(res, 'phase', { step: 'extracting' });
            rawLots = await extractLotsWithAI(renderedPages, house, onExtract, scrapeUrl);
            console.log(`Claude extracted ${rawLots.length} lots from rendered content`);

            // ── DOM→Gemini merge: harvest URLs + images from DOM, merge into Gemini lots ──
            if (rawLots.length > 0 && firstResult.html) {
              const domHarvest = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
              if (domHarvest && domHarvest.length > 0) {
                const domByLot = {};
                for (const d of domHarvest) { if (d.lot) domByLot[d.lot] = d; }
                let urlsMerged = 0, imgsMerged = 0;
                for (const lot of rawLots) {
                  const dom = domByLot[lot.lot];
                  if (!dom) continue;
                  if (!lot.url && dom.url) { lot.url = dom.url; urlsMerged++; }
                  if (!lot.imageUrl && dom.imageUrl) { lot.imageUrl = dom.imageUrl; imgsMerged++; }
                }
                if (urlsMerged === 0 && imgsMerged === 0 && domHarvest.length >= rawLots.length * 0.5) {
                  for (let i = 0; i < rawLots.length && i < domHarvest.length; i++) {
                    if (!rawLots[i].url && domHarvest[i].url) { rawLots[i].url = domHarvest[i].url; urlsMerged++; }
                    if (!rawLots[i].imageUrl && domHarvest[i].imageUrl) { rawLots[i].imageUrl = domHarvest[i].imageUrl; imgsMerged++; }
                  }
                }
                if (urlsMerged > 0 || imgsMerged > 0) {
                  console.log(`DOM→Gemini merge for ${house}: ${urlsMerged} URLs, ${imgsMerged} images`);
                }
              }
            }
          }
        }
      } catch (err) {
        log.error('JS-rendered scraping failed', { house, error: err.message });
        sseWrite(res, 'error', { message: 'Scraping engine unavailable — please try again in a moment.' });
        return res.end();
      }
    } else {
      // Standard static HTML scraping
      pages = await scrapeAllPages(scrapeUrl, house);
      sseWrite(res, 'scrape', { pages: pages ? pages.length : 0 });
      if (pages && pages.length > 0) {
        sseWrite(res, 'phase', { step: 'extracting' });
        rawLots = await extractLotsWithAI(pages, house, onExtract, scrapeUrl);
      }
      // Rendered page fallback if static scraping found nothing
      const SKIP_PUPPETEER = ['philliparnold','knightfrank'];
      if (rawLots.length === 0 && !SKIP_PUPPETEER.includes(house)) {
        console.log(`No lots from static HTML, trying rendered scraping for ${house}...`);
        try {
          const rendered = await scrapeRenderedPage(url, house);
          if (rendered.html) {
            const renderedLots = extractWithJSDOM(rendered.html, house, url, rendered.images);
            if (renderedLots && renderedLots.length > 0) {
              rawLots = renderedLots;
              console.log(`Rendered scraping got ${rawLots.length} lots via DOM extraction`);
            } else {
              const renderedPages = [{ page: 1, html: rendered.html, markdown: rendered.markdown }];
              sseWrite(res, 'phase', { step: 'extracting' });
              rawLots = await extractLotsWithAI(renderedPages, house, onExtract, scrapeUrl);
              console.log(`Claude extracted ${rawLots.length} lots from rendered content`);
              // DOM→Gemini merge
              if (rawLots.length > 0) {
                const domH = extractWithJSDOM(rendered.html, house, url, rendered.images);
                if (domH && domH.length > 0) {
                  const byLot = {}; for (const d of domH) { if (d.lot) byLot[d.lot] = d; }
                  let um = 0, im = 0;
                  for (const lot of rawLots) {
                    const d = byLot[lot.lot]; if (!d) continue;
                    if (!lot.url && d.url) { lot.url = d.url; um++; }
                    if (!lot.imageUrl && d.imageUrl) { lot.imageUrl = d.imageUrl; im++; }
                  }
                  if (um === 0 && im === 0 && domH.length >= rawLots.length * 0.5) {
                    for (let i = 0; i < rawLots.length && i < domH.length; i++) {
                      if (!rawLots[i].url && domH[i].url) { rawLots[i].url = domH[i].url; um++; }
                      if (!rawLots[i].imageUrl && domH[i].imageUrl) { rawLots[i].imageUrl = domH[i].imageUrl; im++; }
                    }
                  }
                  if (um > 0 || im > 0) console.log(`DOM→Gemini merge (fallback): ${um} URLs, ${im} images`);
                }
              }
            }
          }
        } catch (err) {
          console.log(`Rendered scraping fallback failed for ${house}: ${err.message}`);
        }
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

    sseWrite(res, 'phase', { step: 'scoring', lots: rawLots.length });

    const analysed = rawLots.map(lot => analyseLot(lot)).sort((a, b) => b.score - a.score);

    // ── Enrich with Land Registry + rental yields (also resolves lot URLs) ──
    console.log('Starting Land Registry + rental yield enrichment...');
    sseWrite(res, 'phase', { step: 'enriching', lots: analysed.length });
    await enrichLots(analysed, house, url, (done, total) => {
      sseWrite(res, 'enrich', { postcodes: done, total });
    });

    // ── Unified lot-page enrichment: single fetch per lot extracts all missing data ──
    // (address, image, tenure, leaseLength, condition, beds, propType)
    await enrichLotsFromLotPages(analysed);

    // ── Harness enrichment: gap-filling, cross-lot inference, cache carry-forward ──
    const { data: prevLotRows } = await supabase
      .from('lots')
      .select(LOTS_SELECT)
      .eq('catalogue_url', normalisedUrl);
    const harnessResult = enrichBatch(analysed, house, {
      previousCache: (prevLotRows || []).map(dbRowToFrontendLot),
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
    const expiresAt = new Date(Date.now() + getCacheTTL(house)).toISOString();

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
    const qg = qualityGate(enrichedAnalysed, house, prevCached, (prevLotRows || []).map(dbRowToFrontendLot));
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

    // Mark preset cache entries as partially stale (only the changed catalogue needs re-searching)
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
        console.log(`Marked ${affected.length} preset cache entries stale for: ${normalisedUrl}`);
      }
    }

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
});

// ═══════════════════════════════════════════════════════════════
// POST /api/lot — single-URL on-demand detail-page analysis
// ═══════════════════════════════════════════════════════════════
// Body: { url: string }
// Returns: { lot, house, displayName, source }
//   - source: 'cache'|'http'|'firecrawl' indicating where the HTML came from
// Uses DETAIL_EXTRACTORS for the detected house, then runs the lot through
// enrichLots (EPC/flood/Land Registry/yield) before responding. Persists
// to lot_details cache so subsequent requests for the same URL are free.
router.post('/api/lot', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });

    const urlCheck = validateUrl(url);
    if (!urlCheck.ok) return res.status(400).json({ error: urlCheck.error || 'invalid URL' });

    const house = detectAuctionHouse(url);
    if (!house || house === 'unknown') return res.status(400).json({ error: 'Could not detect auction house from URL' });

    // Fetch the lot page (cache → http → Firecrawl)
    const result = await fetchLotPage(url, { house });
    if (!result || !result.html) {
      return res.status(502).json({ error: 'Failed to fetch lot page' });
    }

    // Run the detail extractor
    const detail = extractLotDetail(result.html, house, result.url || url);

    // Build a lot object — fall back to URL-only if extractor returned nothing
    const lot = {
      house,
      url: result.url || url,
      lot: null,
      address: detail?.address || '',
      postcode: detail?.postcode || null,
      price: detail?.price || null,
      priceText: detail?.priceText || null,
      bullets: detail?.bullets || [],
      images: detail?.images || [],
      imageUrl: detail?.imageUrl || (detail?.images?.[0] || null),
      tenure: detail?.tenure || null,
      leaseLength: detail?.leaseLength || null,
      propType: detail?.propType || null,
      beds: detail?.beds ?? null,
      vacant: detail?.vacant ?? null,
      viewingDates: detail?.viewingDates || [],
    };

    // Score it
    Object.assign(lot, analyseLot(lot));

    // Optionally enrich with EPC/flood/comps/yield (free APIs)
    try {
      await enrichLots([lot], house, lot.url);
    } catch (e) {
      log.warn('on-demand /api/lot enrichLots failed (non-fatal)', { error: e.message });
    }

    // Persist extracted_data to lot_details cache so the structured payload
    // is reusable next time (avoids re-extraction even on cache hit).
    try {
      await cacheLotDetail(lot.url, house, result.html, detail || {}, result.source);
    } catch { /* non-fatal */ }

    return res.json({
      lot,
      house,
      displayName: getHouseDisplayName(house, url),
      source: result.source,
    });
  } catch (err) {
    log.error('/api/lot error', { error: err.message });
    return res.status(500).json({ error: 'Internal error' });
  }
});

export { BROKEN_EXTRACTORS, loadBrokenExtractors };
export default router;
