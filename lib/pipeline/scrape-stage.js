// lib/pipeline/scrape-stage.js — Catalogue scraping stage
// Fetches raw lots from a catalogue URL using the appropriate strategy:
// allsop_api, savills_pages, sdl_pages, pugh_pages, generic paginated,
// static+AI fallback, DOM→Gemini merge.
//
// Inputs:  { house, url, scrapeUrl, rewritten }
// Outputs: { rawLots }  (empty array if nothing found)
//          Side-effect: triggers self-healing + regression alert when 0 lots
//
// Dependencies injected via `deps` to keep this module pure.

import { JSDOM } from 'jsdom';
import { supabase } from '../supabase.js';
import { MAX_LOTS_PER_SCRAPE, SKIP_PUPPETEER } from '../config.js';
import { HOUSE_DISPLAY_NAMES } from '../houses.js';
import { emitPipelineEvent } from './types.js';

/**
 * @param {object} ctx - Pipeline context
 * @param {string} ctx.house - Detected house slug
 * @param {string} ctx.url - Original catalogue URL
 * @param {string} ctx.scrapeUrl - Rewritten/normalised URL for scraping
 * @param {object} ctx.rewritten - Output of rewriteUrl() (paginateAs, preferPuppeteer, waitFor, actions, baseUrl)
 * @param {object} deps - Injected dependencies
 * @param {function} deps.scrapeAllsopApi
 * @param {function} deps.extractAllsopLotsFromJson
 * @param {function} deps.scrapeRenderedPage
 * @param {function} deps.extractWithJSDOM
 * @param {function} deps.detectTotalPages
 * @param {function} deps.buildPageUrl
 * @param {function} deps.fetchPage
 * @param {function} deps.scrapeAllPages
 * @param {function} deps.extractLotsWithAI
 * @param {function} deps.isFcCreditExhausted
 * @param {function} deps.isCreditExhausted - Gemini credit exhaustion check
 * @param {object|null} deps.puppeteer
 * @param {function} deps.healBrokenHouse
 * @returns {Promise<{ rawLots: Array }>}
 */
export async function scrapeStage(ctx, deps) {
  const { house, url, scrapeUrl, rewritten } = ctx;
  const creditExhausted = deps.isCreditExhausted();
  let rawLots = [];

  if (rewritten.paginateAs === 'allsop_api') {
    const pages = await deps.scrapeAllsopApi(rewritten.baseUrl);
    if (pages.length > 0) {
      rawLots = deps.extractAllsopLotsFromJson(pages);
    }

  } else if (rewritten.paginateAs === 'countrywide_pages') {
    rawLots = await _scrapeCountrywidePages(ctx, deps);

  } else if (rewritten.preferPuppeteer) {
    // JS-rendered sites: Firecrawl+JSDOM (primary), Puppeteer (fallback)
    if (deps.isFcCreditExhausted()) console.log(`AUTO: Firecrawl credits exhausted, will use Puppeteer fallback for ${house}`);

    if (rewritten.paginateAs === 'savills_pages') {
      rawLots = await _scrapeSavillsPages(ctx, deps);

    } else if (rewritten.paginateAs === 'sdl_pages') {
      rawLots = await _scrapeSdlPages(ctx, deps);

    } else if (rewritten.paginateAs === 'pugh_pages') {
      rawLots = await _scrapePughPages(ctx, deps);

    } else {
      rawLots = await _scrapeGenericPaginated(ctx, deps, creditExhausted);
    }

  } else {
    // Non-preferPuppeteer path: static HTTP + Gemini (skip Gemini when exhausted)
    rawLots = await _scrapeStaticPath(ctx, deps, creditExhausted);
  }

  // ── 0-lot regression detection + self-healing ──
  if (rawLots.length === 0) {
    console.log(`AUTO: ${house}: 0 lots found, skipping cache`);
    await _handleZeroLots(house, url);
  }

  // ── Stamp scrape provenance onto each raw lot ──
  // These fields are picked up by enrichLots() when it initialises the manifest,
  // so the manifest gets accurate scraped_at / scrape_method without coupling
  // scrape-stage to the manifest module directly.
  const scrapedAt = new Date().toISOString();
  const scrapeMethod = deps.getLastScrapeEngine ? deps.getLastScrapeEngine() : null;
  for (const lot of rawLots) {
    if (!lot._scrapedAt) lot._scrapedAt = scrapedAt;
    if (!lot._scrapeMethod) lot._scrapeMethod = scrapeMethod;
  }

  return { rawLots };
}

// ── Savills paginated scraping ──
async function _scrapeSavillsPages({ house, scrapeUrl }, deps) {
  const rawLots = [];
  const firstResult = await deps.scrapeRenderedPage(scrapeUrl, house);
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

  const firstPageLots = deps.extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
  if (firstPageLots && firstPageLots.length > 0) rawLots.push(...firstPageLots);
  const maxPages = Math.min(totalPages, 50);
  for (let p = 2; p <= maxPages; p++) {
    if (deps.isFcCreditExhausted() && !deps.puppeteer) { console.log(`AUTO: No scraping engine available at page ${p}`); break; }
    try {
      const pageResult = await deps.scrapeRenderedPage(`${scrapeUrl}/page-${p}`, house);
      const pageLots = deps.extractWithJSDOM(pageResult.html, house, `${scrapeUrl}/page-${p}`, pageResult.images);
      if (pageLots && pageLots.length > 0) rawLots.push(...pageLots);
    } catch (e) {
      console.log(`AUTO: Page ${p} failed: ${e.message}`);
    }
  }
  console.log(`AUTO: Savills total: ${rawLots.length} lots from ${maxPages} pages`);
  return rawLots;
}

// ── SDL paginated scraping ──
async function _scrapeSdlPages({ house, scrapeUrl }, deps) {
  const rawLots = [];
  const firstResult = await deps.scrapeRenderedPage(scrapeUrl, house);
  const sdlTotalPages = deps.detectTotalPages(firstResult.html, scrapeUrl, house);
  console.log(`AUTO: SDL detected ${sdlTotalPages} pages`);

  const firstLots = deps.extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
  if (firstLots && firstLots.length > 0) rawLots.push(...firstLots);
  console.log(`AUTO: SDL Page 1: ${firstLots ? firstLots.length : 0} lots`);
  const sdlMaxPages = Math.min(sdlTotalPages, 20);
  for (let p = 2; p <= sdlMaxPages; p++) {
    const sep = scrapeUrl.includes('?') ? '&' : '?';
    const pageUrl = `${scrapeUrl}${sep}page=${p}`;
    try {
      const pageResult = await deps.scrapeRenderedPage(pageUrl, house);
      const pageLots = deps.extractWithJSDOM(pageResult.html, house, pageUrl, pageResult.images);
      if (pageLots && pageLots.length > 0) {
        rawLots.push(...pageLots);
        console.log(`AUTO: SDL Page ${p}: ${pageLots.length} lots`);
      } else {
        console.log(`AUTO: SDL Page ${p}: 0 lots — stopping`);
        break;
      }
    } catch (e) { console.log(`AUTO: SDL Page ${p} failed: ${e.message}`); break; }
  }
  console.log(`AUTO: SDL total: ${rawLots.length} lots`);
  return rawLots;
}

// ── Pugh paginated scraping (server-rendered, plain HTTP) ──
async function _scrapePughPages({ house, scrapeUrl }, deps) {
  const rawLots = [];
  console.log(`AUTO: Loading paginated Pugh catalogue (plain HTTP)...`);
  const pughHtml1 = await deps.fetchPage(scrapeUrl);
  const pughPage1Lots = deps.extractWithJSDOM(pughHtml1, house, scrapeUrl);
  if (pughPage1Lots && pughPage1Lots.length > 0) rawLots.push(...pughPage1Lots);
  console.log(`AUTO: Pugh Page 1: ${pughPage1Lots ? pughPage1Lots.length : 0} lots`);

  const pughTotalPages = deps.detectTotalPages(pughHtml1, scrapeUrl, house);
  const pughMaxPages = Math.min(pughTotalPages, 65);
  for (let p = 2; p <= pughMaxPages; p++) {
    if (rawLots.length >= MAX_LOTS_PER_SCRAPE) { console.log(`AUTO: Pugh lot cap at ${rawLots.length}`); break; }
    const pageUrl = deps.buildPageUrl(scrapeUrl, p, house);
    try {
      const pageHtml = await deps.fetchPage(pageUrl);
      const pageLots = deps.extractWithJSDOM(pageHtml, house, pageUrl);
      if (pageLots && pageLots.length > 0) {
        rawLots.push(...pageLots);
        if (p % 10 === 0) console.log(`AUTO: Pugh Page ${p}: ${pageLots.length} lots (total: ${rawLots.length})`);
      } else {
        console.log(`AUTO: Pugh Page ${p}: 0 lots — stopping`);
        break;
      }
      await new Promise(r => setTimeout(r, 200));
    } catch (e) { console.log(`AUTO: Pugh Page ${p} failed: ${e.message}`); break; }
  }
  console.log(`AUTO: Pugh total: ${rawLots.length} lots`);
  return rawLots;
}

// ── Countrywide paginated scraping (two regional catalogues: SK + SW) ──
async function _scrapeCountrywidePages({ house, scrapeUrl }, deps) {
  const rawLots = [];
  const BASE = 'https://www.countrywidepropertyauctions.co.uk/search.php';
  const regions = ['SK', 'SW'];

  for (const region of regions) {
    const regionUrl = `${BASE}?auction_location=${region}&auction_date=current`;
    console.log(`AUTO: ${house}: scraping region ${region}...`);

    try {
      const html1 = await deps.fetchPage(regionUrl);
      const page1Lots = deps.extractWithJSDOM(html1, house, regionUrl);
      if (page1Lots && page1Lots.length > 0) rawLots.push(...page1Lots);
      console.log(`AUTO: ${house} ${region} Page 1: ${page1Lots ? page1Lots.length : 0} lots`);

      // Detect total pages from pagination links (page=N)
      const dom = new JSDOM(html1, { url: regionUrl });
      let totalPages = 1;
      const pageLinks = dom.window.document.querySelectorAll('a[href*="page="]');
      for (const a of pageLinks) {
        const m = a.getAttribute('href')?.match(/page=(\d+)/);
        if (m) totalPages = Math.max(totalPages, parseInt(m[1]));
      }
      dom.window.close();

      const maxPages = Math.min(totalPages, 10);
      for (let p = 2; p <= maxPages; p++) {
        if (rawLots.length >= MAX_LOTS_PER_SCRAPE) break;
        const pageUrl = `${regionUrl}&page=${p}`;
        try {
          const pageHtml = await deps.fetchPage(pageUrl);
          const pageLots = deps.extractWithJSDOM(pageHtml, house, pageUrl);
          if (pageLots && pageLots.length > 0) {
            rawLots.push(...pageLots);
            console.log(`AUTO: ${house} ${region} Page ${p}: ${pageLots.length} lots`);
          } else {
            console.log(`AUTO: ${house} ${region} Page ${p}: 0 lots — stopping`);
            break;
          }
          await new Promise(r => setTimeout(r, 200));
        } catch (e) {
          console.log(`AUTO: ${house} ${region} Page ${p} failed: ${e.message}`);
          break;
        }
      }
    } catch (e) {
      console.log(`AUTO: ${house} ${region} failed: ${e.message}`);
    }
  }

  // Deduplicate by address (some lots appear in both regions)
  const seen = new Set();
  const deduped = [];
  for (const lot of rawLots) {
    const key = (lot.address || '').trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      deduped.push(lot);
    }
  }

  console.log(`AUTO: ${house} total: ${deduped.length} lots (${rawLots.length} before dedup)`);
  return deduped;
}

// ── Generic auto-paginating extraction ──
async function _scrapeGenericPaginated({ house, scrapeUrl, rewritten }, deps, creditExhausted) {
  let rawLots = [];
  const scrapeOpts = {};
  if (rewritten.waitFor) scrapeOpts.waitFor = rewritten.waitFor;
  if (rewritten.actions) scrapeOpts.actions = rewritten.actions;
  const firstResult = await deps.scrapeRenderedPage(scrapeUrl, house, scrapeOpts);
  const domLots = deps.extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
  if (domLots && domLots.length >= 3) {
    rawLots.push(...domLots);
    console.log(`AUTO: ${house} Page 1: ${domLots.length} lots`);

    const detectedPages = deps.detectTotalPages(firstResult.html, scrapeUrl, house);
    if (detectedPages > 1) {
      const PAGE_CAPS = { probateauction: 12, auctionhouselondon: 10 };
      const pageCap = PAGE_CAPS[house] || 25;
      const maxPages = Math.min(detectedPages, pageCap);
      console.log(`AUTO: ${house}: detected ${detectedPages} pages, loading up to ${maxPages}`);
      for (let p = 2; p <= maxPages; p++) {
        if (rawLots.length >= MAX_LOTS_PER_SCRAPE) { console.log(`AUTO: ${house}: lot cap reached at ${rawLots.length}`); break; }
        const pageUrl = deps.buildPageUrl(scrapeUrl, p, house);
        try {
          const pageResult = await deps.scrapeRenderedPage(pageUrl, house, scrapeOpts);
          const pageLots = deps.extractWithJSDOM(pageResult.html, house, pageUrl, pageResult.images);
          if (pageLots && pageLots.length > 0) {
            rawLots.push(...pageLots);
            console.log(`AUTO: ${house} Page ${p}: ${pageLots.length} lots`);
          } else { console.log(`AUTO: ${house} Page ${p}: 0 lots — stopping`); break; }
        } catch (e) {
          console.log(`AUTO: ${house} Page ${p} failed: ${e.message}`);
          break;
        }
      }
    }
    if (rawLots.length > MAX_LOTS_PER_SCRAPE) {
      console.log(`AUTO: ${house}: capping ${rawLots.length} lots to ${MAX_LOTS_PER_SCRAPE}`);
      rawLots = rawLots.slice(0, MAX_LOTS_PER_SCRAPE);
    }
    console.log(`AUTO: ${house} total: ${rawLots.length} lots`);
  } else if (!creditExhausted) {
    // Fall back to Claude extraction
    const renderedPages = [{ page: 1, html: firstResult.html, markdown: firstResult.markdown }];
    rawLots = await deps.extractLotsWithAI(renderedPages, house, null, scrapeUrl);
    console.log(`AUTO: ${house}: ${rawLots.length} lots via Claude fallback`);

    // DOM→Gemini merge
    if (rawLots.length > 0 && firstResult.html) {
      rawLots = _domGeminiMerge(rawLots, firstResult.html, house, scrapeUrl, firstResult.images, deps);
    }
  } else {
    console.log(`AUTO: ${house}: DOM extractor found <3 lots and Gemini exhausted — skipping AI fallback`);
  }
  return rawLots;
}

// ── Non-preferPuppeteer: static HTTP + Gemini ──
async function _scrapeStaticPath({ house, url, scrapeUrl }, deps, creditExhausted) {
  let rawLots = [];
  if (!creditExhausted) {
    const pages = await deps.scrapeAllPages(scrapeUrl, house);
    if (pages && pages.length > 0) rawLots = await deps.extractLotsWithAI(pages, house, null, scrapeUrl);
  } else {
    console.log(`AUTO: ${house}: Gemini exhausted — skipping static+AI path, trying DOM fallback`);
  }
  // Rendered page fallback if static scraping found nothing.
  // SKIP_PUPPETEER is now the module-scope export at the top of this file.
  if (rawLots.length === 0 && !SKIP_PUPPETEER.includes(house)) {
    try {
      const rendered = await deps.scrapeRenderedPage(url, house);
      if (rendered.html) {
        const renderedLots = deps.extractWithJSDOM(rendered.html, house, url, rendered.images);
        if (renderedLots && renderedLots.length > 0) {
          rawLots = renderedLots;
        } else if (!creditExhausted) {
          const renderedPages = [{ page: 1, html: rendered.html, markdown: rendered.markdown }];
          rawLots = await deps.extractLotsWithAI(renderedPages, house, null, scrapeUrl);
          // DOM→Gemini merge for this fallback path too
          if (rawLots.length > 0) {
            rawLots = _domGeminiMerge(rawLots, rendered.html, house, url, rendered.images, deps);
          }
        } else {
          console.log(`AUTO: ${house}: DOM extractor found 0 lots and Gemini exhausted — no extraction possible`);
        }
      }
    } catch (err) {
      console.log(`AUTO: Rendered scraping fallback failed for ${house}: ${err.message}`);
    }
  }
  return rawLots;
}

// ── DOM→Gemini merge: re-run DOM extractor to harvest URLs + images ──
// Gemini loses URLs/images because it works on stripped text.
// DOM extractors capture URLs and images from the HTML structure.
// Merge by lot number to get best of both worlds.
function _domGeminiMerge(rawLots, html, house, baseUrl, images, deps) {
  const domHarvest = deps.extractWithJSDOM(html, house, baseUrl, images);
  if (!domHarvest || domHarvest.length === 0) {
    console.log(`AUTO: ${house}: DOM→Gemini merge: DOM harvest returned 0 lots — no merge possible (${rawLots.length} Gemini lots, ${rawLots.filter(l => !l.imageUrl).length} missing images)`);
    return rawLots;
  }

  const domByLot = {};
  for (const d of domHarvest) {
    if (d.lot) domByLot[d.lot] = d;
  }
  let urlsByLot = 0, imgsByLot = 0, urlsByPos = 0, imgsByPos = 0;
  for (const lot of rawLots) {
    const dom = domByLot[lot.lot];
    if (!dom) continue;
    if (!lot.url && dom.url) { lot.url = dom.url; urlsByLot++; }
    if (!lot.imageUrl && dom.imageUrl) { lot.imageUrl = dom.imageUrl; imgsByLot++; }
  }
  // Also try position-based merge if lot numbers didn't match
  if (urlsByLot === 0 && imgsByLot === 0 && domHarvest.length >= rawLots.length * 0.5) {
    for (let i = 0; i < rawLots.length && i < domHarvest.length; i++) {
      if (!rawLots[i].url && domHarvest[i].url) { rawLots[i].url = domHarvest[i].url; urlsByPos++; }
      if (!rawLots[i].imageUrl && domHarvest[i].imageUrl) { rawLots[i].imageUrl = domHarvest[i].imageUrl; imgsByPos++; }
    }
  }

  const totalLots = rawLots.length;
  const withImg = rawLots.filter(l => l.imageUrl).length;
  const domWithImg = domHarvest.filter(l => l.imageUrl).length;
  console.log(`AUTO: ${house}: DOM→Gemini merge: ${totalLots} lots, DOM harvested ${domHarvest.length} (${domWithImg} with images). Matched by lot#: ${urlsByLot} URLs/${imgsByLot} imgs, by position: ${urlsByPos} URLs/${imgsByPos} imgs. Final: ${withImg}/${totalLots} have images, ${totalLots - withImg} missing`);

  return rawLots;
}

// ── 0-lot regression: alert + self-healing ──
async function _handleZeroLots(house, url) {
  try {
    const { data: prevSkill } = await supabase.from('house_skills').select('last_lot_count').eq('slug', house).maybeSingle();
    if (prevSkill && prevSkill.last_lot_count > 0) {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'extractor_regression',
        severity: 'error',
        house,
        message: `${HOUSE_DISPLAY_NAMES[house] || house} returned 0 lots (previously had ${prevSkill.last_lot_count})`
      });
      console.log(`ALERT: Extractor regression for ${house} (0 lots, was ${prevSkill.last_lot_count})`);

      // ── Self-healing: try to find a new catalogue URL ──
      console.log(`HEAL: Triggering self-healing for ${house} (was ${prevSkill.last_lot_count} lots, now 0)`);
      emitPipelineEvent({ module: 'scrape', house, action: 'self_heal_triggered', previousLots: prevSkill.last_lot_count });
    }
  } catch (alertErr) { console.warn('ALERT: Failed to record extractor regression:', alertErr.message); }
}
