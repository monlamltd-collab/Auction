// lib/pipeline/firecrawl-extract.js — Firecrawl-native extraction pipeline.
//
// Single unified function — extractCatalogueWithBackfill — handles:
//   • Single-page catalogues (maxPages = 1) via /v2/scrape
//   • Paginated catalogues (maxPages > 1) via /v2/batch/scrape with maxConcurrency
//   • SPA recall fallback via per-detail-page /v2/scrape with DETAIL_SCHEMA, when
//     detailUrlPattern + buildDetailUrl are provided
//
// Replaces the previous extractTwoPass + parsePattinsonLotCard + parseJohnPyeLotCard
// pattern. Detail-page backfill is the playbook-recommended approach for closing
// recall gaps (see docs/firecrawl-extractor-playbook.md "The recall problem").
//
// Feature-flagged via USE_FIRECRAWL_EXTRACT env var.

import {
  extractCatalogue,
  extractDetail,
  batchExtractCatalogues,
  batchExtractDetails,
  pollBatchJob,
  mapSiteUrls,
  agentExtract,
} from '../scraper/firecrawl.js';
import { CATALOGUE_SCHEMA } from '../scraper/lot-schema.js';
import { detectAuctionHouse, HOUSE_ROOTS, HOUSE_DISPLAY_NAMES } from '../houses.js';

const USE_FIRECRAWL_EXTRACT = process.env.USE_FIRECRAWL_EXTRACT === 'true';

export function isFirecrawlExtractEnabled() {
  return USE_FIRECRAWL_EXTRACT;
}

// ── Lot normalisation ─────────────────────────────────────────────────────

function parsePrice(str) {
  if (!str) return null;
  const m = str.replace(/,/g, '').match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

function normaliseLot(raw, house, catalogueUrl) {
  const price = parsePrice(raw.guide_price);
  return {
    address: raw.address || '',
    lotNumber: raw.lot_number || null,
    price,
    priceStr: raw.guide_price || '',
    beds: raw.bedrooms || null,
    tenure: raw.tenure || '',
    imageUrl: raw.image_url || '',
    url: raw.detail_url || '',
    bullets: raw.description ? [raw.description] : [],
    propType: raw.property_type || '',
    lotStatus: raw.lot_status || '',
    auctionDate: raw.auction_date || '',
    house,
    catalogueUrl,
    _extractionSource: 'firecrawl-json',
  };
}

// Convert a DETAIL_SCHEMA result into the standard lot shape, used for backfill
// when the listing-page JSON misses a lot.
function normaliseDetailLot(raw, house, detailUrl, idHint) {
  const price = parsePrice(raw.guide_price);
  const imageUrl = (raw.image_urls && raw.image_urls[0]) || '';
  return {
    address: raw.address || '',
    lotNumber: raw.lot_number || null,
    price,
    priceStr: raw.guide_price || '',
    beds: raw.bedrooms || null,
    tenure: raw.tenure || '',
    imageUrl,
    url: detailUrl,
    bullets: raw.description ? [raw.description] : [],
    propType: raw.property_type || '',
    lotStatus: raw.lot_status || 'available',
    auctionDate: raw.auction_date || '',
    house,
    catalogueUrl: detailUrl,
    _extractionSource: 'firecrawl-detail-backfill',
    _backfillIdHint: idHint,
  };
}

// ── Pagination URL builders ───────────────────────────────────────────────

const PAGINATION_PATTERNS = {
  savills_pages: (baseUrl, page) => `${baseUrl}/page-${page}`,
  sdl_pages: (baseUrl, page) => {
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}page=${page}`;
  },
  query_page: (baseUrl, page) => {
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}page=${page}`;
  },
  pattinson_p: (baseUrl, page) => {
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}p=${page}`;
  },
};

// ── Batch helpers ─────────────────────────────────────────────────────────

const BATCH_SUBMIT_BACKOFF = [2000, 4000, 8000];

async function pollUntilComplete(jobId, { pollIntervalMs = 5000, timeoutMs = 600000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await pollBatchJob(jobId);
    if (status.status === 'completed') return status;
    if (status.status === 'failed' || status.status === 'cancelled') {
      throw new Error(`Firecrawl batch job ${jobId} ${status.status}`);
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`Firecrawl batch job ${jobId} timed out after ${timeoutMs}ms`);
}

async function submitWithRetry(submitFn, label) {
  for (let attempt = 0; attempt <= BATCH_SUBMIT_BACKOFF.length; attempt++) {
    try {
      return await submitFn();
    } catch (err) {
      const retryable = /UND_ERR_SOCKET|fetch failed|timeout|abort|5\d\d/i.test(err.message + (err.cause?.code || ''));
      if (!retryable || attempt === BATCH_SUBMIT_BACKOFF.length) throw err;
      const delay = BATCH_SUBMIT_BACKOFF[attempt];
      console.log(`Firecrawl ${label} submit attempt ${attempt + 1} failed (${err.cause?.code || err.message}), retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`Firecrawl ${label} submit: exhausted retries`);
}

// ── Unified catalogue extraction ──────────────────────────────────────────
//
// Single page (maxPages = 1):
//   /v2/scrape with JSON+markdown+changeTracking, optional per-detail-page backfill.
//
// Paginated (maxPages > 1):
//   /v2/batch/scrape across all pages with maxConcurrency, optional per-detail
//   backfill per page.
//
// Backfill:
//   When detailUrlPattern + buildDetailUrl are provided, parse missed IDs from
//   each page's markdown and call extractDetail for each. Closes the JSON-schema
//   recall gap on SPA-heavy sites without bespoke markdown parsers.

export async function extractCatalogueWithBackfill(url, house, options = {}) {
  const {
    maxPages = 1,
    paginateAs = 'query_page',
    buildPageUrl: customBuildPageUrl = null,
    detailUrlPattern = null,
    buildDetailUrl = null,
    changeTracking = true,
    forceExtract = false,
    maxConcurrency = 10,
    backfillCap = null,
    fcTimeout = 120000,
    pollIntervalMs = 5000,
    pollTimeoutMs = 600000,
    validatePage1 = null,
  } = options;

  const buildPageUrl = customBuildPageUrl || PAGINATION_PATTERNS[paginateAs] || PAGINATION_PATTERNS.query_page;
  const pageUrls = [];
  for (let p = 1; p <= maxPages; p++) {
    pageUrls.push(p === 1 ? url : buildPageUrl(url, p));
  }

  // ── Pass 1: scrape all pages ──
  let pageResults;
  if (maxPages === 1) {
    const r = await extractCatalogue(pageUrls[0], { changeTracking, fcTimeout });
    if (changeTracking && r.changeStatus === 'same' && !forceExtract) {
      return { skipped: true, reason: 'unchanged', changeStatus: 'same', lots: [] };
    }
    pageResults = [{
      url: pageUrls[0],
      lots: r.lots || [],
      markdown: r.markdown || '',
      changeStatus: r.changeStatus,
      totalLots: r.totalLots,
      auctionDate: r.auctionDate,
    }];
  } else {
    console.log(`AUTO: ${house} batch-scraping ${pageUrls.length} pages (maxConcurrency: ${maxConcurrency})`);
    const { jobId } = await submitWithRetry(
      () => batchExtractCatalogues(pageUrls, { changeTracking, maxConcurrency }),
      'catalogue-batch',
    );
    const status = await pollUntilComplete(jobId, { pollIntervalMs, timeoutMs: pollTimeoutMs });
    console.log(`AUTO: ${house} batch ${jobId} completed: ${status.completed}/${status.total} pages, ${status.creditsUsed} credits`);

    pageResults = (status.results || []).map(r => ({
      url: r.url,
      lots: r.lots || [],
      markdown: r.markdown || '',
      changeStatus: r.changeStatus,
      totalLots: r.totalLots,
      auctionDate: r.auctionDate,
      statusCode: r.statusCode,
      error: r.error,
    }));

    // Reorder by submitted page index (batch-scrape may complete out of order).
    const indexBySubmittedUrl = new Map(pageUrls.map((u, i) => [u, i]));
    pageResults.sort((a, b) => {
      const ai = indexBySubmittedUrl.get(a.url) ?? 999;
      const bi = indexBySubmittedUrl.get(b.url) ?? 999;
      return ai - bi;
    });

    // Page 1 changeTracking short-circuit (preserves existing catalogue-level optimisation).
    const page1 = pageResults[0];
    if (changeTracking && page1?.changeStatus === 'same' && !forceExtract) {
      console.log(`AUTO: ${house} unchanged (changeTracking on page 1) — skipping`);
      return { skipped: true, reason: 'unchanged', changeStatus: 'same', lots: [] };
    }
  }

  // Page 1 validation hook (catches degraded SPA renders).
  if (validatePage1 && pageResults[0]) {
    const valid = validatePage1(pageResults[0]);
    if (!valid) {
      console.log(`AUTO: ${house} page 1 validation failed — aborting`);
      return { skipped: false, lots: [], auctionDate: null, totalLots: null };
    }
  }

  // ── Pass 2: collect JSON lots + identify missing IDs across all pages ──
  const allLots = [];
  let totalMdIds = 0;
  let totalJsonIds = 0;
  let pagesWithErrors = 0;

  // Per-detail-URL → { id, idHint, pageUrl } so we can place backfilled lots back
  // into a useful catalogueUrl context.
  const missingDetails = new Map();

  for (const page of pageResults) {
    if (page.error) {
      pagesWithErrors++;
      console.log(`AUTO: ${house} ${page.url}: page error (${page.error}) — skipping`);
      continue;
    }

    const jsonLots = page.lots.map(lot => normaliseLot(lot, house, page.url));
    allLots.push(...jsonLots);
    totalJsonIds += jsonLots.length;

    if (!detailUrlPattern || !buildDetailUrl) continue;

    const md = page.markdown || '';
    const mdMatches = [...md.matchAll(detailUrlPattern)];
    const mdIds = [...new Set(mdMatches.map(m => m[1]))];
    totalMdIds += mdIds.length;

    const idRegex = new RegExp(detailUrlPattern.source);
    const jsonIdSet = new Set();
    for (const lot of jsonLots) {
      const m = (lot.url || '').match(idRegex);
      if (m) jsonIdSet.add(m[1]);
    }

    let pageMissingIds = mdIds.filter(id => !jsonIdSet.has(id));
    if (backfillCap !== null && pageMissingIds.length > backfillCap) {
      console.log(`AUTO: ${house} ${page.url}: ${pageMissingIds.length} missing exceeds cap ${backfillCap}`);
      pageMissingIds = pageMissingIds.slice(0, backfillCap);
    }
    if (pageMissingIds.length === 0) continue;

    console.log(`AUTO: ${house} ${page.url}: ${jsonLots.length} JSON / ${mdIds.length} markdown / queueing ${pageMissingIds.length} for backfill`);
    for (const id of pageMissingIds) {
      const detailUrl = buildDetailUrl(id);
      if (!missingDetails.has(detailUrl)) {
        missingDetails.set(detailUrl, { id, pageUrl: page.url });
      }
    }
  }

  // ── Pass 3: batch-scrape all missing detail pages in one job ──
  let totalBackfilled = 0;
  if (missingDetails.size > 0) {
    const detailUrls = [...missingDetails.keys()];
    console.log(`AUTO: ${house} batch-scraping ${detailUrls.length} detail pages for backfill (maxConcurrency: ${maxConcurrency})`);

    try {
      const { jobId } = await submitWithRetry(
        () => batchExtractDetails(detailUrls, { maxConcurrency }),
        'detail-batch',
      );
      const status = await pollUntilComplete(jobId, { pollIntervalMs, timeoutMs: pollTimeoutMs });
      console.log(`AUTO: ${house} detail-batch ${jobId} completed: ${status.completed}/${status.total} details, ${status.creditsUsed} credits`);

      for (const r of status.results || []) {
        if (r.error) continue;
        const detail = r.json || null;
        if (!detail || !detail.address) continue;
        const meta = missingDetails.get(r.url);
        if (!meta) continue;
        allLots.push(normaliseDetailLot(detail, house, r.url, meta.id));
        totalBackfilled++;
      }
    } catch (err) {
      console.log(`AUTO: ${house} detail-batch failed: ${err.message} — accepting partial result`);
    }
  }

  const summary = `${pageResults.length} pages, ${allLots.length} lots`
    + (totalBackfilled ? `, ${totalBackfilled} backfilled` : '')
    + (totalMdIds ? `, ${totalJsonIds}/${totalMdIds} JSON-recall` : '')
    + (pagesWithErrors ? `, ${pagesWithErrors} page errors` : '');
  console.log(`AUTO: ${house} ${summary}`);

  return {
    skipped: false,
    lots: allLots,
    auctionDate: pageResults[0]?.auctionDate || null,
    totalLots: pageResults[0]?.totalLots || null,
    backfillCount: totalBackfilled,
    pageErrors: pagesWithErrors,
  };
}

// ── Backward-compat wrappers ──────────────────────────────────────────────
//
// extractCatalogueNative and extractPaginatedCatalogue are thin wrappers around
// extractCatalogueWithBackfill. They preserve the old signatures so callers in
// analysis.js don't need restructuring during the transition.

export async function extractCatalogueNative(url, house, options = {}) {
  return extractCatalogueWithBackfill(url, house, { ...options, maxPages: 1 });
}

export async function extractPaginatedCatalogue(baseUrl, house, options = {}) {
  const { paginateAs = 'query_page', maxPages = 25, ...rest } = options;
  return extractCatalogueWithBackfill(baseUrl, house, { ...rest, maxPages, paginateAs });
}

// ── Catalogue URL discovery (unchanged) ───────────────────────────────────

export async function discoverCatalogueUrl(house) {
  const root = HOUSE_ROOTS[house];
  if (!root) return null;

  const hostname = new URL(root).origin;
  const links = await mapSiteUrls(hostname, 'auction lots catalogue upcoming properties for sale');

  const candidates = links
    .filter(l => {
      const u = (typeof l === 'string' ? l : l.url || '').toLowerCase();
      return /lot|propert|catalogue|upcoming|for-sale|current/i.test(u);
    })
    .map(l => typeof l === 'string' ? l : l.url);

  return candidates[0] || null;
}

// ── Agent extraction (unchanged; deprecated /v2/extract migration deferred) ──

export async function extractWithAgent(url, house, options = {}) {
  const prompt = `Extract all property auction lots from this website. Navigate through any pagination, search results, or tabs to find all available lots. For each lot extract: lot number, full address with postcode, guide price, property type, bedrooms, tenure, image URL, detail page URL, brief description, and lot status (available/sold/withdrawn).`;

  const data = await agentExtract(
    url,
    prompt,
    CATALOGUE_SCHEMA,
    { timeout: options.timeout || 300000 },
  );

  const rawLots = data?.lots || (Array.isArray(data) ? data : []);
  const lots = rawLots.map(lot => normaliseLot(lot, house, url));

  console.log(`AUTO: ${house} agent extract: ${lots.length} lots`);
  return {
    skipped: false,
    lots,
    auctionDate: data?.auction_date || null,
    totalLots: data?.total_lots || null,
  };
}
