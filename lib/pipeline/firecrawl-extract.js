// lib/pipeline/firecrawl-extract.js — Firecrawl-native catalogue extraction.
//
// One unified function — extractCatalogueListing — handles single-page and
// multi-page (paginated) catalogues using direct /v2/scrape calls only.
//
// Recall strategy:
//
// 1. CATALOGUE_PROMPT (lib/scraper/lot-schema.js) tells Firecrawl's JSON
//    extractor to return EVERY card. Empirically this lifts a polite-prompt
//    baseline of ~50% to ~70-80% on dense SPAs.
//
// 2. For houses where the LLM still misses cards, an optional per-house
//    `recogniseFromMarkdown(markdown, ...)` function reads the SAME markdown
//    Firecrawl already returned in the response and recovers the missed lots.
//    This is recognition, not extraction — Firecrawl did the rendering, the
//    anti-bot bypass, the SPA hydration; we're just reading the clean text
//    output it produced.
//
//    NB: this is markdown text processing, NOT DOM/HTML extraction. The old
//    JSDOM-based extractors in lib/extractors/houses/ are the anti-pattern we
//    retired. Recognising data from Firecrawl's own markdown output is
//    Firecrawl-at-the-heart by definition.
//
// Why no /v2/batch/scrape: empirically (verified 2026-05-04 against Pattinson),
// the batch endpoint applies CATALOGUE_PROMPT less effectively than direct
// /v2/scrape — same prompt, ~half the recall. Direct /v2/scrape with an
// in-process concurrency limiter gives both recall and speed.
//
// Why no detail-page backfill: ~840 extra Firecrawl calls per Pattinson cycle
// to recover what's already in the markdown Firecrawl returned. Wasteful.
//
// Feature-flagged via USE_FIRECRAWL_EXTRACT env var.

import { extractCatalogue, mapSiteUrls, agentExtract } from '../scraper/firecrawl.js';
import { CATALOGUE_SCHEMA } from '../scraper/lot-schema.js';
import { HOUSE_ROOTS } from '../houses.js';

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

// ── Markdown recognisers (per-house, optional) ────────────────────────────
//
// These functions read the markdown Firecrawl already returned (NOT raw HTML,
// NOT DOM) and recover lots that the JSON extractor missed. Each recogniser
// returns a Map keyed by detail-page ID (string), with values shaped like the
// CATALOGUE_SCHEMA item type so they merge cleanly with JSON-extracted lots.
//
// Recognisers are wired in per-house via the `recogniseFromMarkdown` option
// (see lib/analysis.js). They only fire for houses where the LLM has been
// observed to under-extract; the default path is JSON-only.

// Pattinson lot cards in Firecrawl's markdown follow a stable shape, ending
// with a `parking](https://www.pattinson.co.uk/property/{id})` link. We split
// on that boundary, then read price + type + address from the lines preceding
// the link. Verified against Pattinson's listing page on 2026-05-04.
export function recognisePattinsonLotsFromMarkdown(markdown) {
  const lots = new Map();
  const chunks = markdown.split(/parking\]\(https:\/\/www\.pattinson\.co\.uk\/property\/(\d+)\)/);

  for (let i = 0; i + 1 < chunks.length; i += 2) {
    const text = chunks[i];
    const id = chunks[i + 1];
    const lines = text.split(/\\\\\s*\n\s*/).map(l => l.replace(/\\\\/g, '').trim()).filter(Boolean);

    const priceIdx = lines.findIndex(l => /^£[\d,]+/.test(l));
    if (priceIdx === -1) continue;

    const price = lines[priceIdx];
    const typeAndBeds = lines[priceIdx + 2] || '';
    const address = lines[priceIdx + 3] || '';

    const bedsMatch = typeAndBeds.match(/^(\d+)\s*bed/i);
    const beds = bedsMatch ? parseInt(bedsMatch[1]) : null;

    const firstImage = text.match(/!\[.*?\]\((https:\/\/[^)]+)\)/);
    const imageUrl = firstImage ? firstImage[1] : '';

    lots.set(id, {
      address,
      guide_price: price,
      property_type: typeAndBeds,
      bedrooms: beds,
      tenure: '',
      image_url: imageUrl,
      detail_url: `https://www.pattinson.co.uk/property/${id}`,
      description: '',
      lot_status: 'available',
    });
  }

  return lots;
}

// John Pye lots in Firecrawl's markdown appear as bullet items
// `- {Title}` followed by a `[View Property](/auctions/{slug}/)` link. The
// title carries status, address, price, and property descriptors — typically
// chained with em-dashes. Postcode anchors the address parse.
export function recogniseJohnPyeLotsFromMarkdown(markdown) {
  const lots = new Map();
  const blocks = markdown.split(/\n-\s+(?=[A-Z0-9])/);

  for (const block of blocks) {
    const slugMatch = block.match(/\/auctions\/([\w-]+)/);
    if (!slugMatch) continue;
    const slug = slugMatch[1];
    if (lots.has(slug)) continue;

    const firstLine = (block.split('\n')[0] || '').trim();

    let lotStatus = 'available';
    let titleClean = firstLine;
    const statusPrefix = /^(SSTC|Coming Soon|Sold|Withdrawn|Postponed|Reserved|Under Offer|For Sale by Auction|For Sale by Private Treaty|For Sale by Online Auction|For Sale Subject To Auction T&C[’']s|For Sale by Auction T&C[’']s|Offers Invited|Industrial Unit|Auction Ends)\s*[–—\-]\s*/i;
    for (let pass = 0; pass < 4; pass++) {
      const m = titleClean.match(statusPrefix);
      if (!m) break;
      const s = m[1].toLowerCase();
      if (s.includes('sstc') || s === 'sold' || s === 'under offer' || s === 'reserved') lotStatus = 'sold';
      else if (s === 'withdrawn') lotStatus = 'withdrawn';
      else if (s === 'postponed') lotStatus = 'postponed';
      titleClean = titleClean.slice(m[0].length);
    }

    let priceStr = '';
    const priceMatches = firstLine.match(/£[\d,]+/g);
    if (priceMatches) priceStr = priceMatches[priceMatches.length - 1];
    if (!priceStr) {
      const blockPrice = block.slice(0, 2000).match(/(?:Asking Price|Guide Price|Offers In Excess of)[\s:–—\-]*£([\d,]+)/i);
      if (blockPrice) priceStr = '£' + blockPrice[1];
    }

    let address = titleClean;
    const postcodeMatch = address.match(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i);
    if (postcodeMatch) {
      address = address.slice(0, postcodeMatch.index + postcodeMatch[0].length).trim();
      const dashIdx = address.search(/\s+[–—\-]\s+/);
      if (dashIdx > 0) {
        const before = address.slice(0, dashIdx);
        const after = address.slice(dashIdx).replace(/^\s+[–—\-]\s+/, '');
        const afterHasPostcode = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i.test(after);
        const isDescriptor = before.length < 70 && /\b(bedroom|bed|storey|detached|semi|terrace|flat|apartment|house|bungalow|studio|maisonette|offices?|industrial|commercial|land|plot|site|building|warehouse|factory|basement|ground floor|first floor)\b/i.test(before);
        if (afterHasPostcode && isDescriptor) address = after;
      }
    } else {
      address = address
        .replace(/\s+[–—\-]\s+(Asking Price|Guide Price|Offers In Excess|£[\d,]+).*$/i, '')
        .trim();
    }

    let beds = null;
    const bedsMatch = block.slice(0, 1500).match(/(\d+|One|Two|Three|Four|Five|Six)\s*[bB]ed(?:room)?/i);
    if (bedsMatch) {
      const wordToNum = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
      const n = parseInt(bedsMatch[1]);
      beds = isNaN(n) ? (wordToNum[bedsMatch[1].toLowerCase()] || null) : n;
    }

    let propType = '';
    const lower = (firstLine + ' ' + block.slice(0, 1500)).toLowerCase();
    if (/serviced offices|industrial unit|warehouse|factory|industrial buildings|two storey offices|care facility|hostel|hotel|social club/.test(lower)) propType = 'commercial';
    else if (/\b(land|plot|site|building plot|freehold land titles)\b/.test(lower)) propType = 'land';
    else if (/\b(flat|apartment|maisonette|studio)\b/.test(lower)) propType = 'flat';
    else if (/\bbungalow\b/.test(lower)) propType = 'bungalow';
    else if (/\bhouse\b/.test(lower)) propType = 'house';

    const imgMatch = block.match(/!\[.*?\]\((https:\/\/[^)]+)\)/);
    const imageUrl = imgMatch ? imgMatch[1] : '';

    if (address && address.length > 5) {
      lots.set(slug, {
        address,
        guide_price: priceStr,
        property_type: propType,
        bedrooms: beds,
        tenure: '',
        image_url: imageUrl,
        detail_url: `https://www.johnpye.co.uk/auctions/${slug}/`,
        description: '',
        lot_status: lotStatus,
      });
    }
  }

  return lots;
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

// ── Unified catalogue extraction ──────────────────────────────────────────

export async function extractCatalogueListing(url, house, options = {}) {
  const {
    maxPages = 1,
    paginateAs = 'query_page',
    buildPageUrl: customBuildPageUrl = null,
    changeTracking = true,
    forceExtract = false,
    maxConcurrency = 10,
    fcTimeout = 120000,
    validatePage1 = null,
    // Optional: regex with one capture group used for recall logging only.
    // e.g. /\/property\/(\d+)/g — counts how many distinct IDs appear in the
    // page markdown so we can spot recall regressions in the AUTO log lines.
    recallSentinelPattern = null,
    // Optional: per-house function that reads Firecrawl's markdown output and
    // returns a Map<id, lotData> of lots recognised from text. Called per page
    // ONLY for IDs that are present in the markdown but missing from the JSON
    // extraction — used to recover under-extracted lots without extra Firecrawl
    // calls. Signature: (markdown: string) => Map<string, CatalogueLotShape>.
    recogniseFromMarkdown = null,
  } = options;

  const buildPageUrl = customBuildPageUrl || PAGINATION_PATTERNS[paginateAs] || PAGINATION_PATTERNS.query_page;
  const pageUrls = [];
  for (let p = 1; p <= maxPages; p++) {
    pageUrls.push(p === 1 ? url : buildPageUrl(url, p));
  }

  // ── Pass 1: scrape all pages via direct /v2/scrape ──
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
    // Concurrency-limited /v2/scrape calls. See file header for why we don't
    // use /v2/batch/scrape.
    console.log(`AUTO: ${house} scraping ${pageUrls.length} pages (maxConcurrency: ${maxConcurrency})`);
    const t0 = Date.now();

    pageResults = new Array(pageUrls.length);
    let nextIdx = 0;
    const worker = async () => {
      while (true) {
        const i = nextIdx++;
        if (i >= pageUrls.length) return;
        try {
          const r = await extractCatalogue(pageUrls[i], { changeTracking, fcTimeout });
          pageResults[i] = {
            url: pageUrls[i],
            lots: r.lots || [],
            markdown: r.markdown || '',
            changeStatus: r.changeStatus,
            totalLots: r.totalLots,
            auctionDate: r.auctionDate,
          };
        } catch (err) {
          console.log(`AUTO: ${house} ${pageUrls[i]} failed: ${err.message}`);
          pageResults[i] = { url: pageUrls[i], lots: [], markdown: '', error: err.message };
        }
      }
    };
    const workers = Array.from({ length: Math.min(maxConcurrency, pageUrls.length) }, worker);
    await Promise.all(workers);
    const elapsed = Date.now() - t0;
    const succeeded = pageResults.filter(p => !p.error).length;
    console.log(`AUTO: ${house} ${succeeded}/${pageUrls.length} pages scraped in ${(elapsed / 1000).toFixed(1)}s`);

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

  // ── Pass 2: collect JSON lots; for any house with a markdown recogniser,
  //          recover lots that the JSON extractor missed by reading the
  //          markdown Firecrawl already returned.
  const allLots = [];
  let totalMdIds = 0;
  let totalJsonIds = 0;
  let totalRecognised = 0;
  let pagesWithErrors = 0;

  for (const page of pageResults) {
    if (page.error) {
      pagesWithErrors++;
      console.log(`AUTO: ${house} ${page.url}: page error (${page.error}) — skipping`);
      continue;
    }

    const jsonLots = page.lots.map(lot => normaliseLot(lot, house, page.url));
    allLots.push(...jsonLots);
    totalJsonIds += jsonLots.length;

    if (recallSentinelPattern) {
      const md = page.markdown || '';
      const mdIds = new Set([...md.matchAll(recallSentinelPattern)].map(m => m[1]));
      totalMdIds += mdIds.size;
    }

    // Recognition fallback: read Firecrawl's own markdown output for IDs the
    // JSON extractor missed. No extra Firecrawl calls — we already paid for
    // the markdown when we paid for the JSON.
    if (recogniseFromMarkdown && recallSentinelPattern) {
      const md = page.markdown || '';
      const mdIds = new Set([...md.matchAll(recallSentinelPattern)].map(m => m[1]));
      const jsonIdRegex = new RegExp(recallSentinelPattern.source);
      const jsonIds = new Set(
        jsonLots.map(l => (l.url || '').match(jsonIdRegex)?.[1]).filter(Boolean)
      );
      const missingIds = [...mdIds].filter(id => !jsonIds.has(id));
      if (missingIds.length > 0) {
        const recognised = recogniseFromMarkdown(md);
        let recoveredOnThisPage = 0;
        for (const id of missingIds) {
          const lot = recognised.get(id);
          if (lot && lot.address) {
            const normalised = normaliseLot(lot, house, page.url);
            normalised._extractionSource = 'firecrawl-markdown-recognition';
            allLots.push(normalised);
            recoveredOnThisPage++;
            totalRecognised++;
          }
        }
        if (recoveredOnThisPage > 0) {
          console.log(`AUTO: ${house} ${page.url}: ${jsonLots.length} JSON + ${recoveredOnThisPage} recognised from markdown (${missingIds.length} missing)`);
        }
      }
    }
  }

  const summary = `${pageResults.length} pages, ${allLots.length} lots`
    + (totalRecognised ? ` (${totalJsonIds} JSON + ${totalRecognised} recognised from markdown)` : '')
    + (totalMdIds ? `, ${totalJsonIds + totalRecognised}/${totalMdIds} recall` : '')
    + (pagesWithErrors ? `, ${pagesWithErrors} page errors` : '');
  console.log(`AUTO: ${house} ${summary}`);

  return {
    skipped: false,
    lots: allLots,
    auctionDate: pageResults[0]?.auctionDate || null,
    totalLots: pageResults[0]?.totalLots || null,
    pageErrors: pagesWithErrors,
    jsonExtracted: totalJsonIds,
    markdownRecognised: totalRecognised,
  };
}

// ── Backward-compat wrappers ──────────────────────────────────────────────
//
// extractCatalogueNative and extractPaginatedCatalogue preserve the old
// signatures so callers in analysis.js don't need restructuring.
// extractCatalogueWithBackfill is also kept as an alias for the same reason —
// despite the name, it no longer does backfill (see file header for the why).

export async function extractCatalogueNative(url, house, options = {}) {
  return extractCatalogueListing(url, house, { ...options, maxPages: 1 });
}

export async function extractPaginatedCatalogue(baseUrl, house, options = {}) {
  const { paginateAs = 'query_page', maxPages = 25, ...rest } = options;
  return extractCatalogueListing(baseUrl, house, { ...rest, maxPages, paginateAs });
}

export const extractCatalogueWithBackfill = extractCatalogueListing;

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
