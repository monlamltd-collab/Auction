// ═══════════════════════════════════════════════════════════════
// lib/scraper.js — Scraping infrastructure extracted from server.js
// Firecrawl, Puppeteer, image backfill, AI extraction, PDF, pagination
// ═══════════════════════════════════════════════════════════════

import { JSDOM } from 'jsdom';
import { log } from './logging.js';
import { HEADERS, TIMEOUT, MAX_PAGES, MAX_PUPPETEER_PAGES, MAX_LOTS_PER_SCRAPE } from './config.js';
import { DOM_EXTRACTORS, UNIVERSAL_DOM_EXTRACTOR, extractWithJSDOM, setLastExtractorUsed } from './extractors/index.js';
import { PUPPETEER_IMAGE_HOUSES, getProfile } from './houses.js';
import { supabase } from './supabase.js';
import { createHash } from 'crypto';
import { extractLotDetail } from './extractors/details/runner.js';
import { detectSourceStatus } from './harness/sub-agents.js';
import { setField } from './quality/field-source.js';

// ── Shared state: see lib/scraper/state.js ──
// Phase 1 of the lib/scraper.js → lib/scraper/* split: state lives in state.js,
// this file routes its reads/writes through getters/setters. Function bodies
// will migrate out in subsequent phases.
import {
  initState,
  withTier,
  currentTier,
  getBudget,
  getCallAI,
  getCreditExhausted,
  setCreditExhausted,
  setCreditExhaustedAt,
  incApiCallCount,
  getExtractPostcode,
  getLastScrapeEngine,
  setLastScrapeEngine,
  getLastAITier,
  setLastAITier,
} from './scraper/state.js';

// Re-export public API symbols that callers import from './lib/scraper.js'.
export { withTier, currentTier, getBudget, getLastScrapeEngine, setLastScrapeEngine, getLastAITier, setLastAITier };
export { FIRECRAWL_API_KEY, FIRECRAWL_SKIP } from './scraper/state.js';

// Internal references for functions whose definitions have moved into ./scraper/* slices.
// Re-exported above; imported here so the surviving function bodies in this file can call them.
import { fetchPage } from './scraper/http.js';
import { stripHtml } from './scraper/validation.js';
import { detectTotalPages, buildPageUrl } from './scraper/pagination.js';

// Plausibility band for prices recovered from detail pages — rejects extractor
// noise like £15 (a fee line). Bounds match the existing guard in
// extractPriceFromText (lib/pipeline/enrichment-wave.js) and the inline check
// the universal regex used before this file gained setField stamping.
// Don't tighten without checking real auction data: the lower band catches
// parking spaces / garages / cheap land, the upper band catches central-London
// commercial. The £5k-£10m suggestion in COVERAGE_FIX_PLAN.md was a sketch,
// not a measurement — sticking with the existing band until we have real
// histograms to reason from.
const DETAIL_PRICE_MIN = 1000;
const DETAIL_PRICE_MAX = 50000000;
function isPlausiblePrice(p) {
  return typeof p === 'number' && Number.isFinite(p) && p >= DETAIL_PRICE_MIN && p <= DETAIL_PRICE_MAX;
}

let puppeteer = null;
try { puppeteer = (await import('puppeteer')).default; } catch {}

// ── initScraper — thin wrapper around initState (state lives in scraper/state.js) ──
export function initScraper(opts) {
  initState(opts);
}

// ── Budget delegation getters/setters — route through state.js's getBudget() ──
// Safe pre-init: return defaults if budget not yet wired (avoids NPE during module load).
export function getFirecrawlStatus() { return getBudget()?.getFirecrawlStatus() ?? { creditsUsed: 0, creditExhausted: false, exhaustedAt: 0, fallbackCount: 0, errorCount: 0, requestCount: 0, temporarilyDown: false, downAt: 0, consecutive5xx: 0, lastError: null, lastErrorAt: null, monthlyBudget: 0 }; }
export function getFcCreditsUsed() { return getBudget()?.getFcCreditsUsed() ?? 0; }
export function isFcCreditExhausted() { return getBudget()?.isFcCreditExhausted() ?? false; }
export function getFcExhaustedAt() { return getBudget()?.getFcExhaustedAt() ?? 0; }
export function isFcTemporarilyDown() { return getBudget()?.isFcTemporarilyDown() ?? false; }
export function getFcDownAt() { return getBudget()?.getFcDownAt() ?? 0; }
export function getFcConsecutive5xx() { return getBudget()?.getFcConsecutive5xx() ?? 0; }
export function getFcFallbackCount() { return getBudget()?.getFcFallbackCount() ?? 0; }
export function getFcErrorCount() { return getBudget()?.getFcErrorCount() ?? 0; }
export function getFcRequestCount() { return getBudget()?.getFcRequestCount() ?? 0; }
export function getFcLastError() { return getBudget()?.getFcLastError() ?? null; }
export function getFcLastErrorAt() { return getBudget()?.getFcLastErrorAt() ?? null; }
export function setFcCreditExhausted(v) { getBudget()?.setFcCreditExhausted(v); }
export function setFcExhaustedAt(v) { getBudget()?.setFcExhaustedAt(v); }
export function setFcCreditsUsed(v) { getBudget()?.setFcCreditsUsed(v); }
export function setFcTemporarilyDown(v) { getBudget()?.setFcTemporarilyDown(v); }
export function setFcDownAt(v) { getBudget()?.setFcDownAt(v); }
export function setFcConsecutive5xx(v) { getBudget()?.setFcConsecutive5xx(v); }

export async function scrapeWithFirecrawl(url, options = {}) {
  if (!getBudget().fcKey) throw new Error('FIRECRAWL_API_KEY not set');
  if (!getBudget().canUseFirecrawl()) {
    if (getBudget().isFcCreditExhausted()) throw new Error('Firecrawl credits exhausted');
    throw new Error('Firecrawl temporarily down');
  }

  const formats = options.formats || ['markdown', 'rawHtml'];
  const body = {
    url,
    formats,
  };
  if (options.waitFor) body.waitFor = options.waitFor;
  if (options.actions) body.actions = options.actions;

  const doFetch = async () => {
    const resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getBudget().fcKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (resp.status === 402 || resp.status === 429) {
      getBudget().recordFcError(resp.status, new Error(`Firecrawl ${resp.status}: credits/rate exhausted`));
      throw new Error(`Firecrawl ${resp.status}: credits/rate exhausted`);
    }

    if (resp.status >= 500) {
      getBudget().recordFcError(resp.status, new Error(`Firecrawl ${resp.status}: server error`));
      throw new Error(`Firecrawl ${resp.status}: server error`);
    }

    if (!resp.ok) throw new Error(`Firecrawl ${resp.status}: ${await resp.text().catch(() => 'unknown')}`);

    getBudget().recordFcSuccess();
    const data = await resp.json();
    if (!data.success) throw new Error(`Firecrawl returned success=false: ${data.error || 'unknown'}`);

    getBudget().recordFcRequest(currentTier());
    return {
      html: data.data?.rawHtml || data.data?.html || '',
      markdown: data.data?.markdown || '',
      sourceURL: data.data?.metadata?.sourceURL || url,
      images: data.data?.images || [],
    };
  };

  // 1 retry on 5xx/timeout with 2s backoff
  try {
    return await getBudget().rateLimitedFc(doFetch);
  } catch (err) {
    if (/5\d\d|timeout|abort/i.test(err.message)) {
      console.log(`Firecrawl: retrying after error: ${err.message}`);
      await new Promise(r => setTimeout(r, 2000));
      try {
        return await getBudget().rateLimitedFc(doFetch);
      } catch (retryErr) {
        getBudget().recordFcError(0, retryErr);
        throw retryErr;
      }
    }
    getBudget().recordFcError(0, err);
    throw err;
  }
}

// ── Image URL validation — moved to ./scraper/validation.js ──
export { IMG_EXTENSIONS, IMG_CDN_DOMAINS, isValidImageUrl } from './scraper/validation.js';

// ═══════════════════════════════════════════════════════════════
// CORE SCRAPING FUNCTIONS
// ═══════════════════════════════════════════════════════════════

// Per-house Firecrawl overrides — used when a site needs a longer wait,
// captcha pre-actions, or selector-based readiness instead of the default
// 3s wait + scroll/lazy-image actions. Keep the map small; broad changes
// belong in scrapeRenderedPage's default path.
const HOUSE_SCRAPE_OVERRIDES = {};

export async function scrapeRenderedPage(url, house, options = {}) {
  // Tier 1: Firecrawl (if available and not skipped/exhausted)
  if (getBudget().canUseFirecrawl() && !getBudget().isSkipped(house)) {
      try {
        const override = HOUSE_SCRAPE_OVERRIDES[house] || {};
        const fcActions = [
          // House-specific pre-actions (e.g. captcha bypass) run first
          ...(override.preActions || []),
          // Scroll down in stages to trigger intersection observers for lazy-loaded content
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1500 },
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1500 },
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1500 },
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1000 },
          // Force lazy-loaded images: swap data-src/data-lazy-src to src
          { type: 'executeJavascript', script: `document.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]').forEach(img => { const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original'); if (src && !img.getAttribute('src')?.startsWith('http')) img.setAttribute('src', src); });` },
          { type: 'wait', milliseconds: 500 },
          // Scroll back to top to capture any fixed-position images
          { type: 'scroll', direction: 'up' },
          { type: 'scroll', direction: 'up' },
          { type: 'scroll', direction: 'up' },
          { type: 'scroll', direction: 'up' },
        ];
        const result = await scrapeWithFirecrawl(url, {
          waitFor: options.waitFor || override.waitFor || 3000,
          actions: options.actions || fcActions,
          formats: ['markdown', 'rawHtml', 'images'],
        });
        if (result.html && result.html.length > 500) {
          console.log(`Firecrawl: got ${result.html.length} chars for ${house}`);
          setLastScrapeEngine('firecrawl');
          return result;
        }
        console.log(`Firecrawl: empty/short response for ${house}, falling back`);
      } catch (err) {
        console.log(`Firecrawl failed for ${house}: ${err.message}, falling back`);
        getBudget().recordFcFallback();
      }
  }

  // Tier 2: Puppeteer (if available)
  if (puppeteer) {
    try {
      const page = await acquirePage();
      try {
        await page.setUserAgent(HEADERS['User-Agent']);
        await page.setViewport({ width: 1280, height: 900 });
        await page.setRequestInterception(true);
        page.on('request', req => {
          const type = req.resourceType();
          if (['image', 'font', 'media'].includes(type)) req.abort();
          else req.continue();
        });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, options.waitFor || 3000));
        await page.evaluate(async () => {
          for (let i = 0; i < 15; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 500)); }
          window.scrollTo(0, 0);
        });
        await new Promise(r => setTimeout(r, 2000));
        const html = await page.content();
        const sourceURL = page.url();
        setLastScrapeEngine('puppeteer');
        return { html, sourceURL };
      } finally {
        await page.close();
      }
    } catch (err) {
      console.log(`Puppeteer fallback failed for ${house}: ${err.message}`);
    }
  }

  // Tier 3: Plain HTTP (last resort)
  try {
    const html = await fetchPage(url);
    setLastScrapeEngine('http');
    return { html, sourceURL: url };
  } catch (err) {
    throw new Error(`All scraping methods failed for ${url}: ${err.message}`);
  }
}

export async function scrapePageWithFirecrawl(url, house) {
  const result = await scrapeRenderedPage(url, house);
  if (!result.html) return [];
  const pages = [{ page: 1, html: result.html, markdown: result.markdown }];

  // Detect total pages from first page HTML
  const totalPages = detectTotalPages(result.html, url, house);
  if (totalPages > 1) {
    const pageCap = Math.min(totalPages, MAX_PUPPETEER_PAGES);
    console.log(`[PAGINATION] ${house}: ${totalPages} pages detected, loading up to ${pageCap}`);
    for (let p = 2; p <= pageCap; p++) {
      if (!getBudget().canUseFirecrawl()) { console.log(`Firecrawl: unavailable at page ${p}, stopping`); break; }
      const pageUrl = buildPageUrl(url, p, house);
      try {
        const pageResult = await scrapeRenderedPage(pageUrl, house);
        if (pageResult.html && pageResult.html.length > 500) {
          pages.push({ page: p, html: pageResult.html, markdown: pageResult.markdown });
        } else {
          console.log(`Firecrawl: page ${p} empty for ${house}, stopping`);
          break;
        }
      } catch (err) {
        console.log(`Firecrawl: page ${p} failed for ${house}: ${err.message}`);
        break;
      }
    }
  }
  return pages;
}

// ═══════════════════════════════════════════════════════════════
// IMAGE BACKFILL — Firecrawl
// ═══════════════════════════════════════════════════════════════

export async function backfillImagesWithFirecrawl(catalogueUrl, lots, house) {
  try {
    const result = await scrapeRenderedPage(catalogueUrl, house, {
      actions: [
        // Aggressive scrolling to trigger all lazy-load observers
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1000 },
        // Force lazy-loaded images: swap data-src to src
        { type: 'executeJavascript', script: `document.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]').forEach(img => { const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original'); if (src && !img.getAttribute('src')?.startsWith('http')) img.setAttribute('src', src); });` },
        { type: 'wait', milliseconds: 1000 },
        { type: 'scroll', direction: 'up' },
        { type: 'scroll', direction: 'up' },
        { type: 'scroll', direction: 'up' },
        { type: 'scroll', direction: 'up' },
      ],
    });
    if (!result.html) return 0;

    const dom = new JSDOM(result.html, { url: catalogueUrl });
    const { document } = dom.window;

    // Build href->image map from the rendered page
    const skip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|loading|cookie|emoji/i;
    const hrefImageMap = {};
    const links = document.querySelectorAll('a[href]');
    for (const link of links) {
      const rawHref = link.getAttribute('href') || '';
      let absHref;
      try { absHref = new URL(rawHref, catalogueUrl).href; } catch { absHref = rawHref; }
      if (!rawHref || rawHref === '#') continue;
      if (hrefImageMap[rawHref] || hrefImageMap[absHref]) continue;

      let imgSrc = '';
      let img = link.querySelector('img');
      if (!img) {
        let el = link;
        for (let depth = 0; depth < 5; depth++) {
          el = el.parentElement;
          if (!el) break;
          img = el.querySelector('img');
          if (img) break;
        }
      }
      if (img) {
        imgSrc = img.getAttribute('src') || img.getAttribute('data-src')
          || img.getAttribute('data-lazy-src') || img.getAttribute('data-original')
          || (img.getAttribute('srcset') ? img.getAttribute('srcset').split(',')[0].trim().split(/\s+/)[0] : '');
      }
      if (!imgSrc || imgSrc.startsWith('data:') || imgSrc.length < 10 || skip.test(imgSrc)) continue;
      hrefImageMap[rawHref] = imgSrc;
      hrefImageMap[absHref] = imgSrc;
    }

    // Match images to lots via href->image map
    let updated = 0;
    for (const lot of lots) {
      if (lot.imageUrl) continue;
      const imgSrc = hrefImageMap[lot.url];
      if (imgSrc) {
        let imgUrl = imgSrc;
        if (!/^https?:\/\//i.test(imgUrl)) {
          try { imgUrl = new URL(imgUrl, catalogueUrl).href; } catch {}
        }
        lot.imageUrl = imgUrl;
        updated++;
      }
    }

    // Fallback: use Firecrawl's images array + JSDOM-extracted images for remaining imageless lots
    const allPageImages = [];
    // Collect images from JSDOM parsing
    const allImgs = document.querySelectorAll('img[src], img[data-src]');
    const skipFc = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|favicon|banner|advert/i;
    for (const img of allImgs) {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (src && src.length > 20 && !src.startsWith('data:') && !skipFc.test(src)) {
        let abs = src;
        if (!/^https?:\/\//i.test(abs)) { try { abs = new URL(abs, catalogueUrl).href; } catch { continue; } }
        allPageImages.push(abs);
      }
    }
    // Also add Firecrawl's images array
    if (result.images && result.images.length > 0) {
      for (const img of result.images) {
        if (img && img.length > 20 && /^https?:\/\//i.test(img) && !skipFc.test(img)) allPageImages.push(img);
      }
    }
    // Deduplicate
    const uniquePageImages = [...new Set(allPageImages)];
    if (uniquePageImages.length > 0) {
      const usedImgs = new Set(lots.filter(l => l.imageUrl).map(l => l.imageUrl));
      const available = uniquePageImages.filter(i => !usedImgs.has(i));
      // Try lot number matching first
      for (const lot of lots) {
        if (lot.imageUrl) continue;
        const lotNum = String(lot.lot || lot.lotNumber || '').replace(/\D/g, '');
        if (lotNum) {
          const match = available.find(img => !usedImgs.has(img) && (
            img.includes(`/${lotNum}/`) || img.includes(`/${lotNum}.`) || img.includes(`-${lotNum}.`)
            || img.includes(`_${lotNum}.`) || img.includes(`lot${lotNum}`)
          ));
          if (match) { lot.imageUrl = match; usedImgs.add(match); updated++; }
        }
      }
      // Position-based matching for remaining
      const stillMissing = lots.filter(l => !l.imageUrl);
      const unusedImgs = available.filter(i => !usedImgs.has(i));
      if (stillMissing.length > 0 && unusedImgs.length >= stillMissing.length * 0.3) {
        let idx = 0;
        for (const lot of stillMissing) {
          if (idx >= unusedImgs.length) break;
          lot.imageUrl = unusedImgs[idx++];
          updated++;
        }
      }
    }
    // Image dedup guard — same as extractWithJSDOM harness
    if (lots.length >= 3) {
      const imgCounts = {};
      for (const lot of lots) {
        if (lot.imageUrl) imgCounts[lot.imageUrl] = (imgCounts[lot.imageUrl] || 0) + 1;
      }
      for (const [img, count] of Object.entries(imgCounts)) {
        if (count > lots.length * 0.5) {
          console.log(`[IMG-BACKFILL] ${house}: stripped duplicate image on ${count}/${lots.length} lots: ${img.substring(0, 80)}`);
          for (const lot of lots) {
            if (lot.imageUrl === img) { lot.imageUrl = null; updated--; }
          }
        }
      }
      if (updated < 0) updated = 0;
    }
    dom.window.close();
    console.log(`Firecrawl image backfill for ${house}: ${updated}/${lots.length} lots got images`);
    return updated;
  } catch (err) {
    log.warn('Firecrawl image backfill error', { house, catalogueUrl, error: err.message });
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════
// PAGE FETCHING & PAGINATION
// ═══════════════════════════════════════════════════════════════

// fetchPage moved to ./scraper/http.js; scrapeAllPages moved to ./scraper/pagination.js
export { fetchPage } from './scraper/http.js';
export { scrapeAllPages } from './scraper/pagination.js';

// Allsop JSON API pagination
export async function scrapeAllsopApi(baseUrl) {
  const pages = [];
  for (let pg = 1; pg <= MAX_PAGES; pg++) {
    const pageUrl = baseUrl.replace(/page=\d+/, `page=${pg}`);
    try {
      const html = await fetchPage(pageUrl);
      if (html.length < 100 || html.includes('"data":[]') || html.includes('"template":"404"')) {
        console.log(`Allsop API: page ${pg} empty, stopping`);
        break;
      }
      pages.push({ page: pg, html });
      console.log(`Allsop API: got ${html.length} chars from page ${pg}`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.log(`Allsop API: page ${pg} failed: ${e.message}`);
      break;
    }
  }
  return pages;
}

// Parse Allsop JSON API pages directly into lot objects (bypasses Gemini entirely)
export function extractAllsopLotsFromJson(pages) {
  setLastExtractorUsed('api');
  const lots = [];
  const seen = new Set();
  for (const p of pages) {
    try {
      const json = JSON.parse(p.html);
      const results = json?.data?.results || json?.results || [];
      for (const item of results) {
        const ref = item.reference || '';
        if (seen.has(ref) && ref) continue;
        if (ref) seen.add(ref);

        // Address — allsop_address is most complete, fall back to address1+postcode
        const address = (item.allsop_address ||
          [item.address1, item.address2, item.address3, item.county, item.postcode].filter(Boolean).join(', ')
        ).trim();
        if (!address || address.length < 3) continue;

        // Lot number — API doesn't provide lot numbers, use positional
        const lotNum = lots.length + 1;

        // Price — numeric string like "19117000.00" or null
        let price = null;
        const priceText = item.price || item.price_description || '';
        const pm = String(priceText).replace(/,/g, '').match(/(\d+)/);
        if (pm) price = parseInt(pm[1]);

        // URL — construct from reference
        const slug = (address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')).substring(0, 60);
        const url = ref ? `https://www.allsop.co.uk/lot-overview/${slug}/${ref}`
                       : `https://www.allsop.co.uk/find-a-property/`;

        // Image — S3 bucket pattern
        let imageUrl = '';
        const imgId = item.image_file_id;
        if (imgId) {
          imageUrl = `https://as-prod-bau-object-storage.s3.eu-west-2.amazonaws.com/image_cache/${imgId}---auto--.jpg`;
        }

        // Bullets — property types, status, byline
        const bullets = [];
        if (item.property_types && item.property_types.length > 0) {
          bullets.push(item.property_types.join(', '));
        }
        if (item.sales_status && item.sales_status !== 'For Sale') {
          bullets.push(item.sales_status.toUpperCase());
        }
        if (item.price_description) bullets.push(item.price_description);
        if (item.department) bullets.push(item.department === 'RES' ? 'Residential' : item.department === 'COM' ? 'Commercial' : item.department);

        lots.push({
          lot: lotNum,
          address,
          price,
          url,
          imageUrl: imageUrl || undefined,
          bullets,
          reference: ref,
          allsopPropertyId: item.allsop_property_id || item.property_id,
          propType: (item.property_types || [])[0] || undefined,
        });
      }
    } catch (e) {
      console.log(`Allsop JSON parse error on page ${p.page}: ${e.message}`);
    }
  }
  console.log(`Allsop direct JSON extraction: ${lots.length} lots from ${pages.length} pages`);
  return lots;
}

// Enrich Allsop lots with reference and image data from raw API JSON
export function enrichAllsopLots(lots, pages) {
  // Parse all API results from raw JSON pages
  const apiItems = [];
  for (const p of pages) {
    try {
      const json = JSON.parse(p.html);
      const results = json?.data?.results || [];
      apiItems.push(...results);
    } catch {}
  }
  if (apiItems.length === 0) return;

  // Build lookup by postcode (most reliable match field)
  const byPostcode = {};
  for (const item of apiItems) {
    const pc = (item.postcode || '').trim().toUpperCase();
    if (pc) {
      if (!byPostcode[pc]) byPostcode[pc] = [];
      byPostcode[pc].push(item);
    }
  }

  // Track which API items have been matched to prevent double-matching
  const usedApiIds = new Set();

  let matched = 0;
  for (const lot of lots) {
    let match = null;

    // Strategy 1: Match by postcode (most reliable)
    const pcMatch = (lot.address || '').match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
    if (pcMatch) {
      // Normalise postcode: "EC4A3DQ" -> "EC4A 3DQ"
      const rawPc = pcMatch[0].toUpperCase().replace(/\s+/g, '');
      const lotPc = rawPc.slice(0, -3) + ' ' + rawPc.slice(-3);
      const candidates = (byPostcode[lotPc] || byPostcode[rawPc] || []).filter(c => !usedApiIds.has(c.property_id));
      // If only one property at this postcode, it's a match
      match = candidates.length === 1 ? candidates[0] : null;
      // If multiple, try matching by address text
      if (!match && candidates.length > 1) {
        const lotAddr = (lot.address || '').toLowerCase();
        match = candidates.find(c => {
          const apiAddr = (c.allsop_address || c.address1 || '').toLowerCase();
          return lotAddr.includes(apiAddr.split(',')[0]) || apiAddr.includes(lotAddr.split(',')[0]);
        });
      }
    }

    // Strategy 2: Fuzzy address match across ALL API items (for lots without postcodes)
    if (!match) {
      const lotAddr = (lot.address || '').toLowerCase().replace(/[,.\s]+/g, ' ').trim();
      if (lotAddr.length > 5) {
        // Extract street number + name for matching
        const streetMatch = lotAddr.match(/(\d+[a-z]?)\s+(\w+)/);
        if (streetMatch) {
          const streetNum = streetMatch[1];
          const streetWord = streetMatch[2];
          match = apiItems.find(c => {
            if (usedApiIds.has(c.property_id)) return false;
            const apiAddr = (c.allsop_address || c.address1 || '').toLowerCase();
            return apiAddr.includes(streetNum) && apiAddr.includes(streetWord);
          });
        }
        // Try matching by first significant word in both addresses
        if (!match) {
          match = apiItems.find(c => {
            if (usedApiIds.has(c.property_id)) return false;
            const apiAddr = (c.allsop_address || c.address1 || '').toLowerCase().replace(/[,.\s]+/g, ' ').trim();
            // Both addresses must share at least the first meaningful segment
            const lotFirst = lotAddr.split(' ').filter(w => w.length > 2).slice(0, 3).join(' ');
            const apiFirst = apiAddr.split(' ').filter(w => w.length > 2).slice(0, 3).join(' ');
            return lotFirst.length > 5 && apiFirst.length > 5 &&
              (lotAddr.includes(apiFirst) || apiAddr.includes(lotFirst));
          });
        }
      }
    }

    if (match) {
      usedApiIds.add(match.property_id);
      lot.reference = match.reference;
      lot.allsopPropertyId = match.allsop_property_id;
      lot.imageFileId = match.image_file_id;
      // Construct image URL from image_file_id
      if (match.image_file_id && !lot.imageUrl) {
        lot.imageUrl = `https://as-prod-bau-object-storage.s3.eu-west-2.amazonaws.com/image_cache/${match.image_file_id}---auto--.jpg`;
      }
      matched++;
    }
  }
  console.log(`Allsop enrichment: matched ${matched}/${lots.length} lots with API data`);
}

// detectTotalPages + buildPageUrl moved to ./scraper/pagination.js
export { detectTotalPages, buildPageUrl } from './scraper/pagination.js';

// ═══════════════════════════════════════════════════════════════
// PUPPETEER SCRAPING (for JS-rendered sites)
// ═══════════════════════════════════════════════════════════════
let browserInstance = null;
let browserUseCount = 0;
const BROWSER_MAX_USES = 10;
const MAX_CONCURRENT_PAGES = 3;
let activePagesCount = 0;

export async function acquirePage() {
  if (!puppeteer) throw new Error('Puppeteer not available');
  // Wait for a slot if at max concurrency
  while (activePagesCount >= MAX_CONCURRENT_PAGES) {
    await new Promise(r => setTimeout(r, 500));
  }
  activePagesCount++;
  let browser, page;
  try {
    browser = await getBrowser();
    page = await browser.newPage();
  } catch (err) {
    activePagesCount = Math.max(0, activePagesCount - 1);
    throw new Error(`Puppeteer page creation failed: ${err.message}`);
  }
  const origClose = page.close.bind(page);
  page.close = async () => { activePagesCount = Math.max(0, activePagesCount - 1); return origClose(); };
  return page;
}

export async function getBrowser() {
  if (!puppeteer) throw new Error('Puppeteer not available');
  // Restart browser after N uses to prevent memory bloat
  if (browserInstance && browserUseCount >= BROWSER_MAX_USES) {
    console.log(`Puppeteer: recycling browser after ${browserUseCount} uses`);
    try { await browserInstance.close(); } catch (e) { /* ignore */ }
    browserInstance = null;
    browserUseCount = 0;
  }
  if (browserInstance && browserInstance.isConnected()) {
    browserUseCount++;
    return browserInstance;
  }
  browserInstance = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
    ],
  });
  browserUseCount = 1;
  return browserInstance;
}

export async function scrapeWithPuppeteer(url, house) {
  const pages = [];
  try {
    const page = await acquirePage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.setViewport({ width: 1280, height: 900 });

    // Block images/fonts/media to speed up loading
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) req.abort();
      else req.continue();
    });

    console.log(`Puppeteer: loading ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

    // Wait a bit more for dynamic content to render
    await new Promise(r => setTimeout(r, 3000));

    // Scroll down to trigger lazy loading
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 800));
      }
      window.scrollTo(0, 0);
    });

    await new Promise(r => setTimeout(r, 2000));

    const html = await page.content();
    pages.push({ page: 1, html });
    console.log(`Puppeteer: got ${html.length} chars from page 1`);

    // Check for pagination and scrape more pages
    const totalPages = detectTotalPages(html, url, house);
    const puppeteerPageCap = Math.min(totalPages, MAX_PUPPETEER_PAGES);
    for (let pg = 2; pg <= puppeteerPageCap; pg++) {
      try {
        const pageUrl = buildPageUrl(url, pg, house);
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));

        // Scroll to trigger lazy loading
        await page.evaluate(async () => {
          for (let i = 0; i < 3; i++) {
            window.scrollBy(0, window.innerHeight);
            await new Promise(r => setTimeout(r, 600));
          }
        });
        await new Promise(r => setTimeout(r, 1500));

        const pgHtml = await page.content();
        if (pgHtml.length > 2000) {
          pages.push({ page: pg, html: pgHtml });
          console.log(`Puppeteer: got ${pgHtml.length} chars from page ${pg}`);
        } else { break; }
      } catch (e) {
        console.log(`Puppeteer: page ${pg} failed: ${e.message}`);
        break;
      }
    }
    if (totalPages > MAX_PUPPETEER_PAGES) console.log(`${house} pagination cap reached at ${MAX_PUPPETEER_PAGES} pages`);

    await page.close();
  } catch (err) {
    console.error(`Puppeteer scrape failed: ${err.message}`);
  }
  return pages;
}

// ═══════════════════════════════════════════════════════════════
// AI EXTRACTION (Gemini)
// ═══════════════════════════════════════════════════════════════

// One-line structural hints for known houses
export const HOUSE_EXTRACTION_HINTS = {
  // Static HTML / SKIP_PUPPETEER houses (always reach Claude)
  allsop:        'Allsop API returns JSON with properties array. Each has address, guide_price, lot_number, slug, features, auction_type fields.',
  knightfrank:   'EIG auction platform. Lots in cards/rows with lot number, address, guide price, and detail links under knightfrankauctions.com.',
  paulfosh:      'EIG online auction platform (paulfosh.eigonlineauctions.com). Lot panels with lot number, address, guide price, images, and detail links.',
  cottons:       'EIG embed auction platform. Lot containers with lot number, address, guide/sold price, images, and lot detail links with lid= parameter.',
  dedmangray:    'EIG embed platform (tenant 33). Table-based layout with table.lotdetails, td.lotnum, td.lottag (address), td.lotimagecol img, and Guide Price text.',
  barnettross:   'PHP table layout. table.auction-archive-table with tr rows: td (lot number), td.address, td (location), td.guide (price). Row onclick has /property.php?id= URL.',
  philliparnold: 'Auction catalogue cards with lot number, address, guide price, property type, and detail URLs under philliparnoldauctions.co.uk.',
  bidx1:         'Online auction platform. Lot cards with lot number, address, guide price, property type, closing date, and detail links under bidx1.com.',
  edwardmellor:  'Auction lots listed with lot number, full address, guide price, tenure, bedrooms, and detail page links.',
  bradleyhall:   'Property cards on auction.bradleyhall.co.uk with lot number, address, guide price, and search result links.',
  connectuk:     'https://connectukgroup.co.uk/auctions/',
  auctionestates:'Lot cards with lot number, address, guide price, property type, tenure, and detail page URLs.',
  landwood:      'EIG OAS platform (tenant 188) in LIST view. Lot panels (.lot-panel) with h3.list-address, .list-guideprice strong, img.list-image, and /lot/details/ links.',
  loveitts:      'Auction catalogue with lot number, address, guide price, property description, tenure, and links.',
  hunters:       'Bamboo Auctions platform (hunters.bambooauctions.com). React SPA with property cards showing title, address, guide price, bedrooms, property type, and detail links.',
  // preferPuppeteer houses (Claude fallback when DOM extraction fails)
  network:            'Network Auctions. EIG platform. Lot divs with class current-lots-single, lot-number span, guide-price paragraph, and detail links.',
  pattinson:          'Pattinson React SPA. Property cards with lot number, address, starting/current bid price, and auction detail links.',
  savills:            'Savills auctions. Lot cards with lot number, address, guide price, tenure, property type, and detail links on auctions.savills.co.uk.',
  sdl:                'BTG Eddisons Property Auctions (formerly SDL). Tailwind property-card divs with lot number, address, guide price, auction type/date, and links to /properties/ detail pages.',
  bondwolfe:          'Bond Wolfe auctions. Lot listings with lot number, address, guide price, property type, tenure, and detail page links.',
  barnardmarcus:      'Barnard Marcus auctions. Property cards with lot number, address, guide price, property type, and detail links.',
  auctionhouselondon: 'Auction House London. Lot listings with lot number, address, guide price, property type, tenure, and detail links.',
  cliveemson:         'Clive Emson land and property auctions. Lots with lot number, address, guide price, property type, acreage, tenure, and links.',
  strettons:          'Strettons auctions. Commercial/residential lot cards with lot number, address, guide price, property type, and detail links.',
  acuitus:            'Acuitus commercial auctions. Lot listings with lot number, address, guide price, yield, tenant info, and detail links.',
  hollismorgan:       'Hollis Morgan auctions. Lot cards with lot number, address, guide price, property type, tenure, and detail links.',
  maggsandallen:      'Maggs & Allen auctions. Lot listings with lot number, address, guide price, property type, and detail page URLs.',
  mchughandco:        'EIG OAS platform. Lot panels (.lot-panel) with h4.grid-address, .grid-guideprice b, img.grid-img, and /lot/details/ links. Large catalogue (200+ lots).',
  auctionhouse:       'Auction House UK. Lot listings with lot number, address, guide price, property type, auction date, and detail links.',
  probateauction:     'Probate Auction. WordPress site. Lots in div.property-list-card containers within a div.property-list-grid. Each card has a Swiper image gallery, lot number, address, guide price (e.g. 280,000+), description paragraph, and a "Property Details" link.',
  countrywide:        'Countrywide/Sutton Kersh. Bootstrap cards div.property-gallery with h2.property-gallery__title (guide price), h3.property-gallery__address (full address), and image in div.property-gallery__image.',
  venmore:            'Venmore Auctions Liverpool. Cards in div.property-strip-block with lot number, address in span.f-body-copy, guide price in span.p-text-green, and detail links to Property-Details?property_reference=X.',
  tcpa:               'Town & Country Property Auctions. EIG platform. Cards in div.lot-panel with span.lot-address, span.price, time.text-success for auction end, and EIG CDN images.',
  futureauctions:     'Future Property Auctions. ASP site. Cards are a[href*="property_details.asp"] with lot numbers, addresses with postcodes, opening bid prices, and images from /upload/ directory.',
  kivells:            'Kivells Devon/Cornwall. Tailwind site. Cards in div.bg-listing-item-background with h2 address, h3 price, and images from /media/Properties/.',
  firstforauctions:   'First For Auctions. EIG platform. Cards in div.lot-panel with h4.grid-address, guide price in div.grid-guideprice b, and EIG CDN images.',
  harmanhealy:        'Harman Healy. EIG platform. Cards with [data-lot-item-toggle] or lot-panel divs, [data-address-searchable] for address, guide price in text.',
  seelauctions:       'Seel & Co Cardiff. EIG platform. Cards are a[href*="/lot/details/"] with h4 address, Guide Price text, and EIG CDN images.',
  robinsonhall:       'Robinson & Hall. WordPress/Elementor + EIG. Cards in article.ae-post-item with a.ae-element-custom-field (address), .guide-price (price), and EIG CDN images.',
  astleys:            'Astleys Swansea. EIG platform (astleys.eigonlineauctions.com). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  henrysykes:         'Henry Sykes Auctions. EIG platform (onlineauctions.henrysykes.co.uk). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  clarkesimpson:      'Clarke & Simpson. EIG platform (clarke-simpson.eigonlineauctions.com). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  durrants:           'Durrants Norfolk/Suffolk. EIG platform (auctions.durrants.com). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  dawsons:            'Dawsons South Wales. EIG platform (dawsonsproperty.co.uk). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  goldings:           'Goldings Ipswich. EIG platform (goldingsauctions.co.uk). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  auctionhousescotland: 'Auction House Scotland. Auction House UK network (auctionhouse.co.uk/scotland). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  austingray:         'Austin Gray / Auction House Sussex & Hampshire. Auction House UK network (auctionhouse.co.uk/sussexandhampshire). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  // Batch 4 (March 2026)
  auctionhousedevon:       'Auction House Devon & Cornwall. Auction House UK network (auctionhouse.co.uk/devonandcornwall). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  auctionhouseeastmidlands:'Auction House East Midlands. Auction House UK network (auctionhouse.co.uk/eastmidlands). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  auctionhousewestmidlands:'Auction House West Midlands. Auction House UK network (auctionhouse.co.uk/westmidlands). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  auctionhouseessex:       'Auction House Essex. Auction House UK network (auctionhouse.co.uk/essex). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  auctionhousemanchester:  'Auction House Manchester. Auction House UK network (auctionhouse.co.uk/manchester). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  romanway:                'Roman Way Auctions. EIG platform (romanway.eigonlineauctions.com). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  hammerprice:             'Hammer Price Auctions. EIG platform (hammerprice.eigonlineauctions.com). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  // Regional/independent houses (batch 6, March 2026)
  underthehammer:          'Under The Hammer. Next.js React SPA (underthehammer.com). Property cards at /for-auction/properties with title, address, guide price, bedrooms, property type, images on blob.core.windows.net, and detail links to /for-auction/slug.',
  lsk:                     'Lacy Scott & Knight Suffolk. Bamboo Auctions platform (lacyscottandknight.bambooauctions.com). React SPA with property cards showing title, address, guide price, bedrooms, property type, and detail links. Same structure as Hunters.',
  // GOTO Properties platform (EIG-based)
  purplebricksgoto:        'Purplebricks via GOTO Properties. EIG platform (purplebricks.gotoproperties.co.uk). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, img.list-image, and /lot/details/ links. Paginated search with pagesize=48.',
  // Verified EIG subdomains (April 2026)
  groundrentauctions:      'Ground Rent Auctions. EIG platform (groundrentauctions.eigonlineauctions.com). Specialist ground rent lots. Standard EIG lot-panel cards.',
  benjaminstevens:         'Benjamin Stevens Auctions. EIG platform (online.benjaminstevensauctions.co.uk). Standard EIG lot-panel cards.',
  // New houses from own websites (April 2026)
  auctionhammermidlands:   'Auction Hammer Midlands. WordPress/Elementor site. Lot cards with LOT number heading (h4), address, guide price (plus fees), bedrooms/bathrooms/receptions counts, and property images.',
  sharpesauctions:         'Sharpes Auctions Bradford. PHP site. Lot cards with class products_table_items_lotnumber for lot number, guide price (plus fees), property images in products_table_thumb, and address links.',
  jjmorris:                'JJ Morris Pembrokeshire. Property Jungle platform. Card-based layout with address, guide price, bedrooms/bathrooms, property images with lazy loading, and More Details links.',
  rendells:                'Rendells Devon. Bamboo Auctions platform (rendells.bambooauctions.com). Next.js SPA with __NEXT_DATA__ JSON. Property cards with title, address, guide price, image, auction type. Same structure as Hunters.',
  pearsonferrier:          'Pearson Ferrier Manchester. WordPress + PropertyHive plugin. Lot cards in .propertyhive wrapper with .property class, .property__address, .property__price, .property__rooms, .flag-lot (lot number badge).',
};

export async function extractLotsWithAI(pages, house, onProgress, catalogueUrl) {
  setLastExtractorUsed('gemini');
  const extractionTier = house === 'unknown' ? 'capable' : 'fast';
  setLastAITier(extractionTier);
  const allLots = [];
  const seenLots = new Set();
  const batchSize = 3;
  for (let i = 0; i < pages.length; i += batchSize) {
    if (getCreditExhausted()) { console.log('Skipping remaining batches -- API rate limited'); break; }
    if (allLots.length >= MAX_LOTS_PER_SCRAPE) { console.log(`${house} lots cap reached at ${MAX_LOTS_PER_SCRAPE}`); break; }
    const batch = pages.slice(i, i + batchSize);
    // Prefer markdown for AI extraction when available (Gemini handles it natively)
    const strippedBatch = batch.map(p => ({
      page: p.page,
      content: (p.markdown && p.markdown.length > 200) ? p.markdown : stripHtml(p.html),
      usedMarkdown: !!(p.markdown && p.markdown.length > 200)
    }));
    const totalStrippedLen = strippedBatch.reduce((sum, p) => sum + p.content.length, 0);
    const mdCount = strippedBatch.filter(p => p.usedMarkdown).length;
    const hint = HOUSE_EXTRACTION_HINTS[house];
    console.log(`Batch ${Math.floor(i/batchSize)+1}: ${strippedBatch.length} page(s), ${totalStrippedLen} chars${mdCount > 0 ? ` (${mdCount} from markdown)` : ' after stripping'}, tier: ${extractionTier}`);
    const prompt = `You are extracting property auction lot data from a UK auction house catalogue (${house}).
${hint ? `\nStructure hint: ${hint}\n` : ''}
Below are ${strippedBatch.length} page(s) of catalogue content. Extract EVERY auction lot you find.

For each lot, return a JSON object with these fields:
- lot: number (the lot number)
- address: string (full address including postcode)
- price: number or null (guide price in pounds, null if TBA/not stated)
- url: string (detail page URL if found, empty string if not)
- tenure: string or null -- one of "Freehold", "Leasehold", "Share of Freehold", or null. Look for: freehold, leasehold, share of freehold, flying freehold, long leasehold, years remaining/unexpired. If not explicitly stated, infer from context (e.g. "125 year lease" = Leasehold, ground rent mentioned = Leasehold). Only return null if there is genuinely no indication.
- beds: number or null -- number of bedrooms. Extract from descriptions like "3 bed", "three bedroom", "studio" (=0). For multi-unit properties, total beds across all units. null if not stated.
- status: string -- one of "available", "sold", "unsold", "stc", "withdrawn". Default "available" if not stated. "unsold" means the auction took place but the lot did not sell (no bids met the reserve). Look for: SOLD, STC, Sale Agreed, Withdrawn, Under Offer, Prior to Auction, UNSOLD, Not Sold, Passed, No Sale.
- bullets: array of strings (key features/description points - condition, sq ft, special circumstances etc)

Return ONLY a JSON array of lot objects, no other text. If a page has no lots, return an empty array.

Important:
- Extract the COMPLETE address including postcode
- Guide prices may be shown as "Guide Price X" or "Guide X" or just "X"
- Tenure is a PRIORITY field -- always look for it in the description, legal pack summary, and property details
- Beds is a PRIORITY field -- always look for bedroom count in the title, description, or property details. "2/3 bed" should return 3 (maximum). "Studio" = 0.
- Status field: check for sold/STC/withdrawn markers, badges, labels, or overlays on the lot listing. "Unsold" or "Not Sold" or "Passed" means the auction happened but the lot didn't sell -- these are distinct from "available" (not yet auctioned).
- Bullet points include things like: property type, condition, sq ft, vacant/tenanted, executor sale, development potential, completion terms
- Include ALL lots, even commercial ones or land

${strippedBatch.map(p => `=== PAGE ${p.page} ===\n${p.content}`).join('\n\n')}

Return ONLY the JSON array:`;
    try {
      incApiCallCount();
      const text = await getCallAI()(prompt, { tier: extractionTier, maxTokens: 16000, taskType: 'extraction' });
      log.info('ai_extraction', { house, tier: extractionTier, batch: Math.floor(i/batchSize)+1 });
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const lots = JSON.parse(jsonMatch[0]);
        for (const lot of lots) {
          if (!lot.lot) continue;
          // Deduplicate by lot number AND by normalised address
          const addrKey = (lot.address || '').toLowerCase().replace(/[\s,]+/g, ' ').trim();
          if (seenLots.has(lot.lot) || (addrKey.length > 10 && seenLots.has(addrKey))) continue;
          seenLots.add(lot.lot);
          if (addrKey.length > 10) seenLots.add(addrKey);
          allLots.push({
            lot: lot.lot, address: lot.address || '',
            price: lot.price || null,
            priceText: lot.price ? `\u00A3${lot.price.toLocaleString()}` : 'TBA',
            url: lot.url || '', bullets: lot.bullets || [],
            status: lot.status || 'available',
          });
        }
      }
      if (onProgress) onProgress(Math.floor(i/batchSize)+1, Math.ceil(pages.length/batchSize), allLots.length);
    } catch (err) {
      console.error(`Gemini extraction failed for batch starting at page ${batch[0].page}:`, err.message);
      if (err.status === 429 || /quota|rate.limit|resource.exhausted/i.test(err.message)) {
        setCreditExhausted(true);
        setCreditExhaustedAt(Date.now());
        console.error('Gemini API rate limited -- stopping all extraction');
        break;
      }
    }
  }
  // Resolve relative URLs to absolute using the catalogue URL as base
  if (catalogueUrl) {
    for (const lot of allLots) {
      if (lot.url && !/^https?:\/\//i.test(lot.url)) {
        try { lot.url = new URL(lot.url, catalogueUrl).href; } catch {}
      }
    }
  }
  return allLots;
}

// ═══════════════════════════════════════════════════════════════
// PDF EXTRACTION
// ═══════════════════════════════════════════════════════════════
export function isPdfUrl(url) {
  return /\.pdf(\?|$|#)/i.test(url) || /content-type=application\/pdf/i.test(url);
}

export async function extractLotsFromPdf(url) {
  log.info('pdf_download', { url });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let pdfBuffer;
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`PDF download failed: HTTP ${resp.status}`);
    pdfBuffer = Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    clearTimeout(timeout);
    throw new Error(`Couldn't download PDF: ${e.message}`);
  }

  const pdfBase64 = pdfBuffer.toString('base64');
  const sizeMB = (pdfBuffer.length / 1024 / 1024).toFixed(1);
  log.info('pdf_loaded', { sizeMB, bytes: pdfBuffer.length });

  // Gemini supports PDFs up to 20MB inline
  if (pdfBuffer.length > 20 * 1024 * 1024) {
    throw new Error('PDF is too large (over 20MB). Try a smaller catalogue.');
  }

  const allLots = [];
  const seenLots = new Set();

  const prompt = `You are extracting property auction lot data from a UK auction house catalogue PDF.

Extract EVERY auction lot you find in this PDF document.

For each lot, return a JSON object with these fields:
- lot: number (the lot number)
- address: string (full address including postcode)
- price: number or null (guide price in pounds, null if TBA/not stated)
- url: string (empty string -- PDFs don't have lot URLs)
- tenure: string or null -- one of "Freehold", "Leasehold", "Share of Freehold", or null.
- beds: number or null -- number of bedrooms.
- status: string -- one of "available", "sold", "unsold", "stc", "withdrawn". Default "available".
- bullets: array of strings (key features/description points)

Return ONLY a JSON array of lot objects, no other text.

Important:
- Extract the COMPLETE address including postcode
- Tenure is a PRIORITY field
- Beds is a PRIORITY field
- Include ALL lots, even commercial ones or land
- Do NOT include terms & conditions, legal text, or non-lot pages

Return ONLY the JSON array:`;

  try {
    // PDFs always use Gemini capable tier (callAI forces Gemini when pdfBase64 is provided)
    const text = await getCallAI()(prompt, { tier: 'capable', maxTokens: 32000, pdfBase64, taskType: 'extraction' });
    log.info('ai_pdf_extraction', { tier: 'capable' });
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const lots = JSON.parse(jsonMatch[0]);
      for (const lot of lots) {
        if (lot.lot && !seenLots.has(lot.lot)) {
          seenLots.add(lot.lot);
          allLots.push({
            lot: lot.lot, address: lot.address || '',
            price: lot.price || null,
            priceText: lot.price ? `\u00A3${lot.price.toLocaleString()}` : 'TBA',
            url: '', bullets: lot.bullets || [],
            status: lot.status || 'available',
          });
        }
      }
    }
    log.info('pdf_extracted', { lots: allLots.length });
  } catch (err) {
    log.error('pdf_extraction_failed', { error: err.message });
    throw new Error(`PDF extraction failed: ${err.message}`);
  }

  return allLots;
}

// stripHtml + normaliseLotStatuses moved to ./scraper/validation.js
export { stripHtml, normaliseLotStatuses } from './scraper/validation.js';


// ═══════════════════════════════════════════════════════════════
// HTTP-BASED IMAGE BACKFILL
// ═══════════════════════════════════════════════════════════════
export async function backfillImages(catalogueUrl, lots) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const resp = await fetch(catalogueUrl, { headers: HEADERS, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const html = await resp.text();
    const resolvedBase = resp.url || catalogueUrl;

    // Also fix relative lot URLs while we're at it
    for (const lot of lots) {
      if (lot.url && !/^https?:\/\//i.test(lot.url)) {
        try { lot.url = new URL(lot.url, resolvedBase).href; } catch {}
      }
    }

    // Helper: resolve a src to absolute URL, skip non-property images
    const resolveImg = (src) => {
      if (!src || src.startsWith('data:') || src.length < 10
        || /\.svg|icon|logo|facebook|linkedin|twitter|spacer|pixel|badge/i.test(src)) return null;
      if (/^https?:\/\//i.test(src)) return src;
      try { return new URL(src, resolvedBase).href; } catch { return null; }
    };

    // Strategy 1: Build href->image map from <a href>...<img src> (image inside link)
    const hrefImgMap = {};
    const linkImgRe = /<a[^>]+href="([^"]+)"[^>]*>[^]*?<img[^>]+(?:src|data-src|data-lazy-src)="([^"]+)"/gi;
    let m;
    while ((m = linkImgRe.exec(html)) !== null) {
      const href = m[1];
      const src = resolveImg(m[2]);
      if (src && !hrefImgMap[href]) hrefImgMap[href] = src;
    }
    // Also match <a href>...background-image:url(...) patterns
    const linkBgRe = /<a[^>]+href="([^"]+)"[^>]*>[^]*?background(?:-image)?:\s*url\(['"]?([^'")\s]+)/gi;
    while ((m = linkBgRe.exec(html)) !== null) {
      const href = m[1];
      const src = resolveImg(m[2]);
      if (src && !hrefImgMap[href]) hrefImgMap[href] = src;
    }

    // Strategy 2: Collect ALL property-like image URLs (both absolute and relative)
    const allImages = [];
    const imgRe = /<img[^>]+(?:src|data-src|data-lazy-src)="([^"]+)"/gi;
    while ((m = imgRe.exec(html)) !== null) {
      const src = resolveImg(m[1]);
      if (src) allImages.push(src);
    }
    // Also collect background-image URLs
    const bgRe = /background(?:-image)?:\s*url\(['"]?([^'")\s]+)/gi;
    while ((m = bgRe.exec(html)) !== null) {
      const src = resolveImg(m[1]);
      if (src) allImages.push(src);
    }
    // Also collect srcset first entries
    const srcsetRe = /srcset="([^"]+)"/gi;
    while ((m = srcsetRe.exec(html)) !== null) {
      const first = m[1].split(',')[0].trim().split(/\s+/)[0];
      const src = resolveImg(first);
      if (src) allImages.push(src);
    }

    // Strategy 3: Proximity matching
    const imgPositions = [];
    const imgPosRe = /<img[^>]+(?:src|data-src|data-lazy-src)="([^"]+)"/gi;
    while ((m = imgPosRe.exec(html)) !== null) {
      const src = resolveImg(m[1]);
      if (src) imgPositions.push({ pos: m.index, src });
    }

    let updated = 0;
    for (const lot of lots) {
      if (lot.imageUrl) continue;
      if (!lot.url) continue;
      let imgSrc = null;

      // Strategy 1: direct href match (try multiple URL variants)
      const urlVariants = [lot.url];
      try { urlVariants.push(new URL(lot.url).pathname); } catch {}
      if (lot.url.startsWith('http://')) urlVariants.push(lot.url.replace('http://', 'https://'));
      else if (lot.url.startsWith('https://')) urlVariants.push(lot.url.replace('https://', 'http://'));
      for (const v of urlVariants) {
        if (hrefImgMap[v]) { imgSrc = hrefImgMap[v]; break; }
      }

      // Strategy 2: match by numeric ID found ANYWHERE in the lot URL path
      if (!imgSrc) {
        try {
          const path = new URL(lot.url).pathname;
          const ids = path.match(/\d{4,}/g) || [];
          for (const id of ids) {
            imgSrc = allImages.find(src => src.includes('/' + id + '/') || src.includes('/' + id + '.') || src.includes('-' + id + '.') || src.includes('/' + id + '_'));
            if (imgSrc) break;
          }
        } catch {}
      }

      // Strategy 3: proximity
      if (!imgSrc) {
        for (const v of urlVariants) {
          const pos = html.indexOf(v);
          if (pos === -1) continue;
          let best = null, bestDist = 2000;
          for (const ip of imgPositions) {
            const dist = Math.abs(ip.pos - pos);
            if (dist < bestDist) { bestDist = dist; best = ip.src; }
          }
          if (best) { imgSrc = best; break; }
        }
      }

      if (imgSrc) {
        lot.imageUrl = imgSrc;
        updated++;
      }
    }
    // Strategy 4: Position-based matching for URL-less lots
    const urlLessLots = lots.filter(l => !l.imageUrl && !l.url);
    if (urlLessLots.length > 0 && allImages.length > 0) {
      const seen = new Set();
      const uniqueImages = allImages.filter(img => { if (seen.has(img)) return false; seen.add(img); return true; });
      if (uniqueImages.length >= urlLessLots.length * 0.3) {
        let posMatched = 0;
        for (let i = 0; i < urlLessLots.length && i < uniqueImages.length; i++) {
          urlLessLots[i].imageUrl = uniqueImages[i];
          posMatched++;
        }
        updated += posMatched;
        if (posMatched > 0) console.log(`Image backfill position-match for URL-less lots: ${posMatched}/${urlLessLots.length}`);
      }
    }

    console.log(`Image backfill for ${catalogueUrl.substring(0, 60)}: ${updated}/${lots.filter(l => !l.imageUrl).length + updated} matched`);
    return updated > 0 ? lots : null;
  } catch (err) {
    log.warn('Image backfill error', { catalogueUrl, error: err.message });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// LOT-DETAIL CACHE (Phase 3)
// ═══════════════════════════════════════════════════════════════
// Per-URL cache of fetched lot detail pages with 30-day TTL.
// fetchLotPage() checks here first to avoid re-fetching unchanged pages
// every cycle. Detail pages change much less than catalogue pages, so
// the cache hit rate is high and the Firecrawl savings are significant.

export async function getCachedLotDetail(url) {
  try {
    const { data, error } = await supabase
      .from('lot_details')
      .select('html, html_hash, extracted_data, source, fetched_at, expires_at')
      .eq('url', url)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null; // never block the pipeline on cache failure
  }
}

export async function cacheLotDetail(url, house, html, extractedData, source) {
  try {
    const html_hash = createHash('sha256').update(html || '').digest('hex');
    await supabase.from('lot_details').upsert({
      url, house, html, html_hash,
      extracted_data: extractedData || null,
      source,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
    }, { onConflict: 'url' });
  } catch { /* never block on cache failure */ }
}

// ═══════════════════════════════════════════════════════════════
// FIRECRAWL LOT-PAGE FETCHER
// ═══════════════════════════════════════════════════════════════
// opts.skipCache=true to force a fresh fetch (bypasses lot_details cache).
// Returns { html, url, source } or null. `source` is one of 'cache'|'http'|'firecrawl'.
export async function fetchLotPage(url, opts = {}) {
  // Cache check (skip if explicitly bypassed)
  if (!opts.skipCache) {
    const cached = await getCachedLotDetail(url);
    if (cached && cached.html) {
      return { html: cached.html, url, source: 'cache', extractedData: cached.extracted_data };
    }
  }

  // Try plain HTTP first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, { headers: HEADERS, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    if (resp.ok) {
      const html = await resp.text();
      const visibleText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (visibleText.length > 500) {
        const result = { html, url: resp.url || url, source: 'http' };
        if (opts.house) cacheLotDetail(url, opts.house, html, null, 'http');
        return result;
      }
    }
  } catch { /* timeout or network error */ }

  // Firecrawl fallback
  if (getBudget().canUseFirecrawl()) {
    try {
      const fcResult = await scrapeWithFirecrawl(url, { formats: ['rawHtml'] });
      if (fcResult.html && fcResult.html.length > 100) {
        const result = { html: fcResult.html, url: fcResult.sourceURL || url, source: 'firecrawl' };
        if (opts.house) cacheLotDetail(url, opts.house, fcResult.html, null, 'firecrawl');
        return result;
      }
    } catch { /* Firecrawl failed */ }
  }

  return null;
}

// Deep image backfill -- standalone version for image-only passes
export async function backfillImagesFromLotPages(lots, concurrency = 5) {
  const missing = lots.filter(l => l.url && !l.imageUrl && /^https?:\/\//i.test(l.url));
  if (missing.length === 0) return 0;
  const capped = missing.slice(0, 50);
  const junk = /logo|icon|nav|sprite|\.svg|placeholder|no-image|modal\.png|_NYC\.|_LCC\.|_BMDC\.|council|utilit|cardwell|badge|spacer|pixel|facebook|twitter|1x1|gavel|backdrop|generic[_-]?image|coming[_-]?soon/i;
  let filled = 0, fcUsed = 0;
  for (let i = 0; i < capped.length; i += concurrency) {
    if (i > 0) await new Promise(r => setTimeout(r, 500));
    const batch = capped.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(async (lot) => {
      try {
        const result = await fetchLotPage(lot.url, { house: lot.house });
        if (!result) return;
        if (result.source === 'firecrawl') fcUsed++;
        // Detect ended/sold/unsold/withdrawn/stc from the detail page while we
        // already have the HTML — avoids waiting for the next drift rotation.
        // Only upgrade from 'available' → terminal; don't overwrite an explicit
        // terminal state already set by the catalogue-level extractor.
        try {
          const src = detectSourceStatus(result.html);
          if (src !== 'available' && (!lot.status || lot.status === 'available')) lot.status = src;
        } catch { /* non-fatal */ }
        const imgRe = /<img[^>]+(?:src|data-src|data-lazy-src|data-original)="([^"]+)"/gi;
        let m;
        while ((m = imgRe.exec(result.html)) !== null) {
          const src = m[1];
          if (!src || src.length <= 20 || src.startsWith('data:')) continue;
          let imgUrl = src;
          if (!/^https?:\/\//i.test(imgUrl)) {
            try { imgUrl = new URL(imgUrl, result.url || lot.url).href; } catch { continue; }
          }
          if (junk.test(imgUrl)) continue;
          lot.imageUrl = imgUrl; filled++;
          break;
        }
      } catch { /* skip */ }
    }));
  }
  if (filled > 0) console.log(`Image backfill (lot pages): ${filled}/${missing.length}${fcUsed > 0 ? ` (${fcUsed} via Firecrawl)` : ''}`);
  return filled;
}

// ═══════════════════════════════════════════════════════════════
// UNIFIED LOT-PAGE ENRICHMENT
// ═══════════════════════════════════════════════════════════════
// Honours per-house EXTRACTION_PROFILE:
//   'never-deep'  → returns 0 immediately (e.g. Allsop, API-rich)
//   'gap-fill'    → only lots missing a key field are targets (default)
//   'always-deep' → every lot is a target (up to maxPerCycle); listed
//                   overwriteFields are nulled before extraction so the
//                   detail-page value replaces the catalogue value
//
// Back-compat: legacy callers pass a number as the second arg (concurrency).
export async function enrichLotsFromLotPages(lots, opts = {}) {
  if (typeof opts === 'number') opts = { concurrency: opts };
  const concurrency = opts.concurrency || 5;

  const addrIsDescription = a => /^A\s+(one|two|three|four|five|six|\d+)\s+(bed|studio)/i.test(a);
  const isGapFillTarget = (l) => (
    !l.address || l.address.trim().length < 5
    || addrIsDescription(l.address || '')
    || !l.postcode
    || !l.imageUrl
    || !l.tenure
    || !l.condition
    || !l.beds
    || !l.price
    || l.vacant == null
    || !l.propType || l.propType === 'other' || l.propType === 'unknown'
    || (l.tenure === 'Leasehold' && !l.leaseLength)
  );

  // Apply per-lot profile policy
  const targets = [];
  const profileCounts = {}; // track maxPerCycle per house
  for (const l of lots) {
    if (!l.url || !/^https?:\/\//i.test(l.url)) continue;
    const profile = getProfile(l.house || opts.house);

    // First-contact override: brand-new lots always get the deep treatment,
    // even on 'never-deep' rich-API houses or fully-populated cards. We don't
    // null any catalogue fields — first-contact is additive, not replacement.
    if (l._isFirstContact) {
      targets.push(l);
      continue;
    }

    // Per-field staleness for never-deep houses (COVERAGE_FIX_PLAN.md fix #2):
    // even rich-API houses sometimes return null fields on a re-scrape (API
    // hiccup, partial response). Don't punish returning lots with permanent
    // gaps — let gap-fill recover them from the lot page.
    //
    // MONITORING: this opens up Firecrawl-eligible fetches for any returning
    // Allsop lot with a gap. Watch /api/cost-monitor on the first cycle after
    // deploy — if Allsop suddenly accounts for a meaningful share of credits,
    // tighten isGapFillTarget here (e.g. only re-target when price OR address
    // is null, not the full set).
    if (profile.policy === 'never-deep') {
      if (isGapFillTarget(l)) targets.push(l);
      continue;
    }

    if (profile.policy === 'always-deep') {
      const cap = profile.maxPerCycle || Infinity;
      const used = profileCounts[l.house || opts.house || 'unknown'] || 0;
      if (used >= cap) continue;
      profileCounts[l.house || opts.house || 'unknown'] = used + 1;

      // Null out overwrite fields so the field-by-field gap-fill logic refills them
      const overwrite = profile.overwriteFields || [];
      for (const field of overwrite) l[field] = null;

      targets.push(l);
      continue;
    }

    // gap-fill (default)
    if (isGapFillTarget(l)) targets.push(l);
  }
  if (targets.length === 0) return 0;

  targets.sort((a, b) => (!a.beds ? 0 : 1) - (!b.beds ? 0 : 1));

  const junk = /logo|icon|nav|sprite|\.svg|placeholder|no-image|modal\.png|_NYC\.|_LCC\.|_BMDC\.|council|utilit|cardwell|badge|spacer|pixel|facebook|twitter|1x1|gavel|backdrop|generic[_-]?image|coming[_-]?soon/i;

  let fcUsed = 0;
  const stats = { address: 0, image: 0, tenure: 0, condition: 0, beds: 0, leaseLength: 0, propType: 0 };

  for (let i = 0; i < targets.length; i += concurrency) {
    if (i > 0) await new Promise(r => setTimeout(r, 500));
    const batch = targets.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(async (lot) => {
      try {
        const result = await fetchLotPage(lot.url, { house: lot.house });
        if (!result) return;
        if (result.source === 'firecrawl') fcUsed++;
        const html = result.html;

        // Ended/sold/unsold/withdrawn/stc detection — upgrade from 'available'
        // to a terminal status while the detail HTML is in hand. Mirrors what
        // auditStatusDrift does, just at scrape time so we don't wait for the
        // next drift rotation.
        try {
          const src = detectSourceStatus(html);
          if (src !== 'available' && (!lot.status || lot.status === 'available')) lot.status = src;
        } catch { /* non-fatal */ }

        // ── Per-house structured extractor pass (Phase 4) ──
        // If a DETAIL_EXTRACTORS entry exists for this house, run it first and
        // merge the result into the lot. Field-level merge respects existing
        // values (gap-fill) — overwrite already happened upstream in
        // enrichLotsFromLotPages's overwriteFields nulling.
        try {
          const detail = extractLotDetail(html, lot.house, lot.url);
          if (detail) {
            // setField stamps lot._fieldSources['<field>'] = 'dom-detail' so the
            // downstream lots.field_sources JSONB column shows that the value
            // came from the per-house detail extractor rather than the
            // catalogue card. See COVERAGE_FIX_PLAN.md fix #1.
            if (detail.address && (!lot.address || lot.address.length < 5)) {
              setField(lot, 'address', detail.address, 'dom-detail');
              stats.address++;
            }
            if (detail.postcode && !lot.postcode) setField(lot, 'postcode', detail.postcode, 'dom-detail');
            if (Array.isArray(detail.images) && detail.images.length > 0) {
              if (!lot.imageUrl) {
                setField(lot, 'imageUrl', detail.imageUrl || detail.images[0], 'dom-detail');
                stats.image++;
              }
              if (!lot.images || lot.images.length < detail.images.length) lot.images = detail.images;
            }
            if (detail.tenure && !lot.tenure) { setField(lot, 'tenure', detail.tenure, 'dom-detail'); stats.tenure++; }
            if (detail.propType && (!lot.propType || lot.propType === 'other' || lot.propType === 'unknown')) {
              setField(lot, 'propType', detail.propType, 'dom-detail');
              stats.propType++;
            }
            if (detail.beds != null && !lot.beds) { setField(lot, 'beds', detail.beds, 'dom-detail'); stats.beds++; }
            // Price gets a plausibility check before promotion — the catalogue
            // null was a known unknown, but a £15 detail-page hit is worse than
            // staying null because it'd silently corrupt yield + scoring.
            if (detail.price && !lot.price && isPlausiblePrice(detail.price)) {
              setField(lot, 'price', detail.price, 'dom-detail');
            }
            if (detail.priceText && !lot.priceText) setField(lot, 'priceText', detail.priceText, 'dom-detail');
            if (detail.vacant != null && lot.vacant == null) setField(lot, 'vacant', detail.vacant, 'dom-detail');
            if (Array.isArray(detail.bullets) && detail.bullets.length > 0 && (!lot.bullets || lot.bullets.length === 0)) lot.bullets = detail.bullets;
            if (Array.isArray(detail.viewingDates) && detail.viewingDates.length > 0) lot.viewingDates = detail.viewingDates;
          }
        } catch (e) {
          // Per-house extractor failure is non-fatal — fall through to universal logic
        }

        const text = html.replace(/<[^>]+>/g, ' ')
          .replace(/&#163;/g, '£').replace(/&pound;/g, '£')
          .replace(/&#8364;/g, '€').replace(/&euro;/g, '€')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ').toLowerCase();

        // Address
        const addrLooksLikeDescription = lot.address && /^A\s+(one|two|three|four|five|six|\d+)\s+(bed|studio)/i.test(lot.address);
        if (!lot.address || lot.address.trim().length < 5 || addrLooksLikeDescription) {
          let address = '';
          const ogMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
                           html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
          if (ogMatch) address = ogMatch[1].trim();
          if (!address) {
            const h1Match = html.match(/<h1[^>]*>([^<]{10,})<\/h1>/i);
            if (h1Match) address = h1Match[1].trim();
          }
          if (!address) {
            const h2Match = html.match(/<h2[^>]*>([^<]{10,})<\/h2>/i);
            if (h2Match) address = h2Match[1].trim();
          }
          if (!address) {
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) address = titleMatch[1].replace(/\s*[-|].*$/, '').trim();
          }
          if (address) {
            address = address.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
            address = address.replace(/^Lot\s+\d+\s*[-\u2013\u2014]\s*/i, '').trim();
          }
          if (address && address.length >= 5) { setField(lot, 'address', address, 'detail-page'); stats.address++; }
        }

        // Image
        if (!lot.imageUrl) {
          const imgRe = /<img[^>]+(?:src|data-src|data-lazy-src|data-original)="([^"]+)"/gi;
          let m;
          while ((m = imgRe.exec(html)) !== null) {
            const src = m[1];
            if (!src || src.length <= 20 || src.startsWith('data:')) continue;
            let imgUrl = src;
            if (!/^https?:\/\//i.test(imgUrl)) {
              try { imgUrl = new URL(imgUrl, result.url || lot.url).href; } catch { continue; }
            }
            if (junk.test(imgUrl)) continue;
            setField(lot, 'imageUrl', imgUrl, 'detail-page'); stats.image++;
            break;
          }
        }

        // Raw text capture (for Gemini fuzzy search)
        if (!lot.rawText) {
          const rawText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (rawText.length > 50) lot.rawText = rawText.slice(0, 10000);
        }

        // Tenure
        if (!lot.tenure) {
          if (/share of freehold|share\s+of\s+the\s+freehold/.test(text)) { setField(lot, 'tenure', 'Share of Freehold', 'detail-page'); stats.tenure++; }
          else if (/flying freehold/.test(text)) { setField(lot, 'tenure', 'Freehold', 'detail-page'); stats.tenure++; }
          else if (/\bfreehold\b/.test(text) && !/leasehold/.test(text)) { setField(lot, 'tenure', 'Freehold', 'detail-page'); stats.tenure++; }
          else if (/\bleasehold\b|long\s+lease|lease\s+remaining|\byears?\s+(?:remaining|unexpired|left)\b|\b\d+\s*(?:year|yr)\s*lease\b/.test(text)) { setField(lot, 'tenure', 'Leasehold', 'detail-page'); stats.tenure++; }
          if (lot.tenure === 'Freehold' && lot.propType === 'house' && !(lot.opps || []).includes('Freehold') && !(lot.scoreBreakdown || []).some(s => s.signal === 'Freehold house')) {
            lot.score = (lot.score || 0) + 0.5;
            lot.opps = lot.opps || []; lot.opps.push('Freehold');
            lot.scoreBreakdown = lot.scoreBreakdown || [];
            lot.scoreBreakdown.push({ signal: 'Freehold house', pts: 0.5 });
            lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
          }
        }

        // Lease length
        if (lot.tenure === 'Leasehold' && !lot.leaseLength) {
          const leaseMatch = text.match(/\b(\d{2,4})\s*(?:year|yr)s?\s*(?:remaining|unexpired|left|lease)\b/) ||
                             text.match(/lease\s*(?:length|term|remaining)?\s*:?\s*(\d{2,4})\s*(?:year|yr)s?\b/) ||
                             text.match(/\b(\d{2,4})\s*(?:year|yr)\s*lease\b/) ||
                             text.match(/(?:approx(?:imately)?|circa|c\.?)\s*(\d{2,4})\s*(?:year|yr)s?\s*(?:remaining|unexpired|left)?\b/) ||
                             text.match(/(?:term|length)\s*(?:of)?\s*(\d{2,4})\s*(?:year|yr)s?\b/) ||
                             text.match(/(\d{2,4})\s*(?:year|yr)s?\s*(?:from|commencing|starting)\s*\d{4}/);
          if (leaseMatch) {
            const years = parseInt(leaseMatch[1], 10);
            if (years >= 1 && years <= 999) { setField(lot, 'leaseLength', years, 'detail-page'); stats.leaseLength++; }
          }
          if (!lot.leaseLength) {
            const fromMatch = text.match(/(\d{2,4})\s*(?:year|yr)s?\s*(?:from|commencing|starting|dated)\s*(\d{4})/);
            if (fromMatch) {
              const total = parseInt(fromMatch[1], 10);
              const startYear = parseInt(fromMatch[2], 10);
              const remaining = total - (new Date().getFullYear() - startYear);
              if (remaining >= 1 && remaining <= 999) { setField(lot, 'leaseLength', remaining, 'detail-page'); stats.leaseLength++; }
            }
          }
        }

        // Condition
        if (!lot.condition) {
          if (/\b(?:derelict|uninhabitable|severe(?:ly)?\s+dilapidated|structurally?\s+(?:unsound|unsafe)|condemned)\b/.test(text)) {
            setField(lot, 'condition', 'derelict', 'detail-page'); stats.condition++;
          } else if (/\b(?:poor\s+condition|very\s+poor|badly?\s+(?:damaged|deteriorated)|significant(?:ly)?\s+(?:dated|tired)|extensive\s+(?:refurb|renovation|works?\s+required))\b/.test(text)) {
            setField(lot, 'condition', 'poor', 'detail-page'); stats.condition++;
          } else if (/\b(?:need(?:s|ing)\s+(?:modernis|refurb|renovation|updating|improvement)|in\s+need\s+of\s+(?:modernis|refurb|renovation)|(?:requires?|requiring)\s+(?:modernis|refurb|renovation|updating)|(?:tired|dated|worn)\s+(?:condition|decor|throughout))\b/.test(text)) {
            setField(lot, 'condition', 'needs modernisation', 'detail-page'); stats.condition++;
          } else if (/\b(?:good\s+(?:condition|order|decorative)|well\s+(?:maintained|presented|kept)|recently\s+(?:refurb|renovated|decorated|updated))\b/.test(text)) {
            setField(lot, 'condition', 'good', 'detail-page'); stats.condition++;
          }
          if (lot.condition === 'needs modernisation' && !(lot.opps || []).includes('Needs modernisation') && !(lot.scoreBreakdown || []).some(s => s.signal === 'Needs modernisation')) {
            lot.score = (lot.score || 0) + 2.0;
            lot.opps = lot.opps || []; lot.opps.push('Needs modernisation');
            lot.scoreBreakdown = lot.scoreBreakdown || [];
            lot.scoreBreakdown.push({ signal: 'Needs modernisation', pts: 2.0 });
            lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
          } else if ((lot.condition === 'poor' || lot.condition === 'derelict') && !(lot.opps || []).includes('Poor condition') && !(lot.scoreBreakdown || []).some(s => /Poor.*condition/i.test(s.signal))) {
            lot.score = (lot.score || 0) + 2.5;
            lot.opps = lot.opps || []; lot.opps.push('Poor condition');
            lot.scoreBreakdown = lot.scoreBreakdown || [];
            lot.scoreBreakdown.push({ signal: 'Poor/derelict condition', pts: 2.5 });
            lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
          }
        }

        // Beds
        if (!lot.beds) {
          const variantMatch = text.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*[-\s]?bed/i);
          const standardMatch = text.match(/\b(\d{1,2})\s*(?:[-\s])?(?:bed(?:room)?s?|double\s+bed(?:room)?s?)\b/i);
          const studioMatch = /\bstudio\s*(?:flat|apartment)?\b/i.test(text);
          if (variantMatch) {
            const n = Math.max(parseInt(variantMatch[1], 10), parseInt(variantMatch[2], 10));
            if (n >= 1 && n <= 20) { setField(lot, 'beds', n, 'detail-page'); stats.beds++; }
          } else if (standardMatch) {
            const n = parseInt(standardMatch[1], 10);
            if (n >= 1 && n <= 20) { setField(lot, 'beds', n, 'detail-page'); stats.beds++; }
          } else if (studioMatch) {
            setField(lot, 'beds', 0, 'detail-page'); stats.beds++;
          }
        }

        // Property type
        if (!lot.propType || lot.propType === 'other' || lot.propType === 'unknown') {
          if (/\b(?:flat|apartment|maisonette|studio\s+flat|penthouse)\b/.test(text)) { setField(lot, 'propType', 'flat', 'detail-page'); stats.propType++; }
          else if (/\b(?:terraced|semi[- ]detached|detached\s+house|end[- ]terrace|mid[- ]terrace|town\s*house|cottage|villa|lodge)\b/.test(text)) { setField(lot, 'propType', 'house', 'detail-page'); stats.propType++; }
          else if (/\bbungalow\b/.test(text)) { setField(lot, 'propType', 'house', 'detail-page'); stats.propType++; }
          else if (/\b(?:land|plot|garage|parking\s+space|storage\s+unit)\b/.test(text)) { setField(lot, 'propType', 'land', 'detail-page'); stats.propType++; }
          else if (/\b(?:shop|retail|office|warehouse|industrial|commercial|pub|hotel|restaurant)\b/.test(text)) { setField(lot, 'propType', 'commercial', 'detail-page'); stats.propType++; }
        }

        // Price — gate on plausibility band so a £15 fee or a £900M phone
        // number doesn't get promoted onto a real lot. See COVERAGE_FIX_PLAN.md.
        if (!lot.price) {
          const priceMatch = text.match(/(?:guide\s*price|starting\s*bid|reserve\s*price|price|asking)[^\u00A3]*\u00A3([\d,]+)/i)
            || text.match(/\u00A3([\d,]+)\s*(?:guide|starting|reserve|plus)/i);
          if (priceMatch) {
            const p = parseInt(priceMatch[1].replace(/,/g, ''), 10);
            if (isPlausiblePrice(p)) {
              setField(lot, 'price', p, 'detail-page');
              if (!stats.price) stats.price = 0;
              stats.price++;
            }
          }
        }

        // Vacant
        if (lot.vacant == null) {
          if (/\b(?:vacant\s+possession|sold\s+with\s+vacant|\bvp\b|vacant\s+property|with\s+vacant|currently\s+vacant|unoccupied)\b/.test(text)) {
            setField(lot, 'vacant', true, 'detail-page');
            if (!stats.vacant) stats.vacant = 0; stats.vacant++;
          } else if (/\b(?:(?:currently\s+)?(?:let|tenanted|rented|occupied)|tenant\s+in\s+situ|subject\s+to\s+tenanc|assured\s+shorthold|sitting\s+tenant|(?:rental|current)\s+income)\b/.test(text)) {
            setField(lot, 'vacant', false, 'detail-page');
            if (!stats.vacant) stats.vacant = 0; stats.vacant++;
          }
        }

        // Postcode re-extraction from newly fetched address
        if (!lot.postcode && lot.address && getExtractPostcode()) {
          const pc = getExtractPostcode()(lot.address);
          if (pc) setField(lot, 'postcode', pc, 'detail-page');
        }

      } catch { /* timeout or network error -- skip */ }
    }));
  }

  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  if (total > 0) {
    const parts = Object.entries(stats).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(' ');
    const bedCoverage = lots.filter(l => l.beds != null).length;
    console.log(`Lot-page enrichment: ${targets.length} pages fetched, ${total} fields filled -- ${parts}${fcUsed > 0 ? ` (${fcUsed} via Firecrawl)` : ''} | beds coverage: ${bedCoverage}/${lots.length} (${Math.round(bedCoverage/lots.length*100)}%)`);
  }
  return total;
}

// ═══════════════════════════════════════════════════════════════
// PUPPETEER IMAGE BACKFILL
// ═══════════════════════════════════════════════════════════════
export async function backfillImagesWithPuppeteer(catalogueUrl, lots, house) {
  let page;
  try {
    page = await acquirePage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['font', 'media'].includes(type)) req.abort();
      else req.continue();
    });

    await page.goto(catalogueUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000));
    await page.evaluate(async () => {
      for (let i = 0; i < 15; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 500));
      }
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 2000));

    const domLots = await extractWithDOM(page, house);
    if (!domLots || domLots.length === 0) {
      console.log(`Puppeteer image backfill: DOM extractor returned 0 lots for ${house}`);
      return 0;
    }

    const lotMap = {};
    for (const dl of domLots) {
      if (dl.lot) lotMap[dl.lot] = { imageUrl: dl.imageUrl, url: dl.url };
    }

    let updated = 0;
    for (const lot of lots) {
      const match = lotMap[lot.lot];
      if (!match) continue;
      if (!lot.imageUrl && match.imageUrl) { lot.imageUrl = match.imageUrl; updated++; }
      if ((!lot.url || lot.url === '') && match.url) lot.url = match.url;
    }

    console.log(`Puppeteer image backfill for ${house}: ${updated}/${lots.length} lots got images (DOM found ${domLots.length} lots)`);
    return updated;
  } catch (err) {
    log.warn('Puppeteer image backfill error', { house, catalogueUrl, error: err.message });
    return 0;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function extractWithDOM(page, house) {
  let lots = null;

  const extractor = DOM_EXTRACTORS[house];
  if (extractor) {
    try {
      const result = await page.evaluate(extractor);
      if (Array.isArray(result) && result.length > 0) {
        console.log(`DOM extractor for ${house}: found ${result.length} lots directly`);
        lots = result;
      }
    } catch (err) {
      log.warn('DOM extractor error', { house, error: err.message });
    }
  }

  if (!lots) {
    try {
      const result = await page.evaluate(UNIVERSAL_DOM_EXTRACTOR);
      if (Array.isArray(result) && result.length > 0) {
        console.log(`Universal DOM extractor for ${house}: found ${result.length} lots`);
        lots = result;
      }
    } catch (err) {
      log.warn('Universal DOM extractor error', { house, error: err.message });
    }
  }

  if (!lots) {
    console.log(`All DOM extractors for ${house}: found 0 lots, falling back to Claude`);
    return null;
  }

  const rawUrls = lots.map(l => l.url || '');

  const baseUrl = page.url();
  for (const lot of lots) {
    if (lot.url && !/^https?:\/\//i.test(lot.url)) {
      try { lot.url = new URL(lot.url, baseUrl).href; } catch {}
    }
    if (lot.detailUrl && !/^https?:\/\//i.test(lot.detailUrl)) {
      try { lot.detailUrl = new URL(lot.detailUrl, baseUrl).href; } catch {}
    }
    if (lot.imageUrl && !/^https?:\/\//i.test(lot.imageUrl)) {
      try { lot.imageUrl = new URL(lot.imageUrl, baseUrl).href; } catch {}
    }
  }

  // Image extraction pass
  try {
    const hrefImageMap = await page.evaluate(() => {
      const map = {};
      const skip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|loading|cookie|emoji/i;
      const links = document.querySelectorAll('a[href]');
      for (const link of links) {
        const rawHref = link.getAttribute('href') || '';
        const absHref = link.href;
        if (!rawHref || rawHref === '#') continue;
        if (map[rawHref] || map[absHref]) continue;

        let imgSrc = '';
        let img = link.querySelector('img');
        if (!img) {
          let el = link;
          for (let depth = 0; depth < 5; depth++) {
            el = el.parentElement;
            if (!el) break;
            img = el.querySelector('img');
            if (img) break;
          }
        }
        if (img) {
          imgSrc = img.getAttribute('src') || img.dataset.src
            || img.getAttribute('data-lazy-src') || img.getAttribute('data-original')
            || (img.srcset ? img.srcset.split(',')[0].trim().split(/\s+/)[0] : '');
        }

        if (!imgSrc || imgSrc.startsWith('data:')) {
          let el = link;
          for (let depth = 0; depth < 5; depth++) {
            el = el.parentElement;
            if (!el) break;
            const bgEls = el.querySelectorAll('[style*="background"]');
            for (const bgEl of bgEls) {
              const style = bgEl.getAttribute('style') || '';
              const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?([^'")\s]+)/i);
              if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
                imgSrc = bgMatch[1];
                break;
              }
            }
            if (imgSrc && !imgSrc.startsWith('data:')) break;
          }
        }

        if (!imgSrc || imgSrc.startsWith('data:') || imgSrc.length < 10 || skip.test(imgSrc)) continue;
        map[rawHref] = imgSrc;
        map[absHref] = imgSrc;
      }
      return map;
    });
    if (hrefImageMap && Object.keys(hrefImageMap).length > 0) {
      for (let i = 0; i < lots.length; i++) {
        if (lots[i].imageUrl) continue;
        const imgSrc = hrefImageMap[rawUrls[i]] || hrefImageMap[lots[i].url];
        if (imgSrc) {
          let imgUrl = imgSrc;
          if (!/^https?:\/\//i.test(imgUrl)) {
            try { imgUrl = new URL(imgUrl, baseUrl).href; } catch {}
          }
          lots[i].imageUrl = imgUrl;
        }
      }
      console.log(`Image extraction for ${house}: ${lots.filter(l => l.imageUrl).length}/${lots.length} lots got images`);
    }
  } catch (err) {
    log.warn('Image extraction error', { house, error: err.message });
  }

  for (const lot of lots) {
    if (lot.imageUrl && !/^https?:\/\//i.test(lot.imageUrl)) {
      try { lot.imageUrl = new URL(lot.imageUrl, baseUrl).href; } catch {}
    }
  }

  // Post-processing: filter out non-property images
  const imgBlocklist = /logo|icon|placeholder|no-image|default|blank|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|noimage|favicon|banner|advert|sponsor|newsletter|widget|thumb_generic|modal\.png|_NYC\.|_LCC\.|_BMDC\.|Unit[ie]*d?_?Utilit|Cardwells|themes\/.*assets\/images\/|download_\(\d+\)\.|watchLIVEauction|property-top-image|auc2-logo|gavel|backdrop|generic[_-]?image|auction[_-]?house[_-]?(?:logo|image)|coming[_-]?soon/i;
  const imgDomainBlock = /flannels|kirklees|rdw\b|council\.gov|\.gov\.uk\/|googleads|doubleclick|analytics|hotjar|intercom|crisp\.chat|tawk\.to|zendesk|hubspot|mailchimp|sendgrid/i;
  // Note: Maggs/Hollis resize-only filter removed in detail-extraction refactor.
  for (const lot of lots) {
    if (!lot.imageUrl) continue;
    if (imgBlocklist.test(lot.imageUrl) || imgDomainBlock.test(lot.imageUrl)) {
      lot.imageUrl = undefined;
    }
  }

  return lots;
}

// Export puppeteer reference for server.js to check availability
export function hasPuppeteer() { return !!puppeteer; }
export { puppeteer };
