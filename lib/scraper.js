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

// Puppeteer instance + scrape primitives moved to ./scraper/puppeteer.js
import { puppeteer, acquirePage, extractWithDOM } from './scraper/puppeteer.js';
export {
  puppeteer, acquirePage, getBrowser,
  scrapeWithPuppeteer, hasPuppeteer, extractWithDOM,
} from './scraper/puppeteer.js';

// ── initScraper — thin wrapper around initState (state lives in scraper/state.js) ──
export function initScraper(opts) {
  initState(opts);
}

// Firecrawl primitive + 18 budget delegation getters/setters moved to ./scraper/firecrawl.js
export {
  scrapeWithFirecrawl,
  getFirecrawlStatus, getFcCreditsUsed, isFcCreditExhausted, getFcExhaustedAt,
  isFcTemporarilyDown, getFcDownAt, getFcConsecutive5xx, getFcFallbackCount,
  getFcErrorCount, getFcRequestCount, getFcLastError, getFcLastErrorAt,
  setFcCreditExhausted, setFcExhaustedAt, setFcCreditsUsed, setFcTemporarilyDown,
  setFcDownAt, setFcConsecutive5xx,
} from './scraper/firecrawl.js';
import { scrapeWithFirecrawl } from './scraper/firecrawl.js';

// ── Image URL validation — moved to ./scraper/validation.js ──
export { IMG_EXTENSIONS, IMG_CDN_DOMAINS, isValidImageUrl } from './scraper/validation.js';

// scrapeRenderedPage + scrapePageWithFirecrawl moved to ./scraper/rendering.js
import { scrapeRenderedPage } from './scraper/rendering.js';
export { scrapeRenderedPage, scrapePageWithFirecrawl } from './scraper/rendering.js';

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

// Allsop JSON API branch moved to ./scraper/allsop.js
export { scrapeAllsopApi, extractAllsopLotsFromJson, enrichAllsopLots } from './scraper/allsop.js';

// detectTotalPages + buildPageUrl moved to ./scraper/pagination.js
export { detectTotalPages, buildPageUrl } from './scraper/pagination.js';

// Puppeteer scrape primitives (acquirePage, getBrowser, scrapeWithPuppeteer)
// moved to ./scraper/puppeteer.js — re-exported at the top of this file.

// AI extraction (Gemini) + PDF extraction moved to ./scraper/extraction.js
export {
  HOUSE_EXTRACTION_HINTS,
  extractLotsWithAI,
  isPdfUrl,
  extractLotsFromPdf,
} from './scraper/extraction.js';


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

// extractWithDOM, hasPuppeteer + the puppeteer re-export moved to ./scraper/puppeteer.js
