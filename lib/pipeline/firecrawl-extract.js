// lib/pipeline/firecrawl-extract.js — Firecrawl-native extraction pipeline
// Feature-flagged via USE_FIRECRAWL_EXTRACT env var.
// Replaces: probe + DOM extractor + Gemini fallback with a single JSON schema call.

import { extractCatalogue, extractDetail, mapSiteUrls, agentExtract } from '../scraper/firecrawl.js';
import { CATALOGUE_SCHEMA } from '../scraper/lot-schema.js';
import { detectAuctionHouse, HOUSE_ROOTS, HOUSE_DISPLAY_NAMES } from '../houses.js';

const USE_FIRECRAWL_EXTRACT = process.env.USE_FIRECRAWL_EXTRACT === 'true';

export function isFirecrawlExtractEnabled() {
  return USE_FIRECRAWL_EXTRACT;
}

export async function extractCatalogueNative(url, house, options = {}) {
  const result = await extractCatalogue(url, {
    changeTracking: true,
    includeHtml: options.includeHtml || false,
    waitFor: options.waitFor,
    timeout: options.timeout,
  });

  if (result.changeStatus === 'same' && !options.forceExtract) {
    return { skipped: true, reason: 'unchanged', changeStatus: 'same', lots: [] };
  }

  const lots = result.lots.map(lot => normaliseLot(lot, house, url));

  return {
    skipped: false,
    lots,
    auctionDate: result.auctionDate,
    totalLots: result.totalLots,
    changeStatus: result.changeStatus,
    html: result.html,
  };
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

function parsePrice(str) {
  if (!str) return null;
  const m = str.replace(/,/g, '').match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

// Paginated extraction — scrapes page by page using JSON schema extraction.
// Used for houses like Savills (page-N URLs), SDL (?page=N), etc.
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
};

export async function extractPaginatedCatalogue(baseUrl, house, options = {}) {
  const { paginateAs = 'query_page', maxPages = 25 } = options;
  const buildPageUrl = PAGINATION_PATTERNS[paginateAs] || PAGINATION_PATTERNS.query_page;

  const allLots = [];
  let page = 1;
  let totalLots = null;
  let auctionDate = null;

  while (page <= maxPages) {
    const pageUrl = page === 1 ? baseUrl : buildPageUrl(baseUrl, page);
    console.log(`AUTO: ${house} page ${page}: extracting ${pageUrl}`);

    try {
      const result = await extractCatalogue(pageUrl, {
        changeTracking: page === 1,
        timeout: options.timeout || 130000,
      });

      if (page === 1) {
        if (result.changeStatus === 'same' && !options.forceExtract) {
          console.log(`AUTO: ${house} unchanged (changeTracking) — skipping`);
          return { skipped: true, reason: 'unchanged', lots: [] };
        }
        auctionDate = result.auctionDate;
        totalLots = result.totalLots;
      }

      const pageLots = result.lots.map(lot => normaliseLot(lot, house, pageUrl));

      if (pageLots.length === 0) {
        console.log(`AUTO: ${house} page ${page}: 0 lots — stopping`);
        break;
      }

      allLots.push(...pageLots);
      console.log(`AUTO: ${house} page ${page}: ${pageLots.length} lots (total: ${allLots.length})`);
      page++;
    } catch (err) {
      console.log(`AUTO: ${house} page ${page} failed: ${err.message} — stopping`);
      break;
    }
  }

  console.log(`AUTO: ${house} paginated total: ${allLots.length} lots from ${page - 1} pages`);
  return { skipped: false, lots: allLots, auctionDate, totalLots };
}

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

// Two-pass extraction for SPAs where JSON schema extraction has low recall.
// Pass 1: extract JSON lots + markdown per page. Parse markdown for detail URLs
//         as ground truth (the rendered page always shows every lot card).
// Pass 2: for lots found in markdown but missing from JSON, parse the lot card
//         data directly from the markdown text (no extra API calls).
export async function extractTwoPass(baseUrl, house, config = {}) {
  const {
    maxPages = 84,
    buildPageUrl = (base, p) => `${base}?p=${p}`,
    detailUrlPattern = /\/property\/(\d+)/g,
    buildDetailUrl = (id) => `https://www.pattinson.co.uk/property/${id}`,
    parseLotFromMarkdown = parsePattinsonLotCard,
    pageGapMs = 1500,
    fcTimeout = 120000,
    clientTimeout = 150000,
    validatePage1 = null,
  } = config;

  const BACKOFF = [2000, 4000, 8000];
  const allLots = [];
  let auctionDate = null;
  let totalLots = null;
  let mdBackfillCount = 0;

  for (let page = 1; page <= maxPages; page++) {
    const pageUrl = page === 1 ? baseUrl : buildPageUrl(baseUrl, page);
    console.log(`AUTO: ${house} two-pass page ${page}/${maxPages}: ${pageUrl}`);

    let result;
    for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
      try {
        result = await extractCatalogue(pageUrl, { fcTimeout, clientTimeout });
        break;
      } catch (err) {
        const retryable = /fetch failed|socket|timeout|abort|UND_ERR|5\d\d/i.test(err.message);
        if (!retryable || attempt === BACKOFF.length) {
          console.log(`AUTO: ${house} page ${page} failed after ${attempt + 1} attempts: ${err.message}`);
          throw err;
        }
        const delay = BACKOFF[attempt];
        console.log(`AUTO: ${house} page ${page} attempt ${attempt + 1} failed (${err.message}), retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    if (page === 1) {
      auctionDate = result.auctionDate;
      totalLots = result.totalLots;
      if (validatePage1) {
        const valid = validatePage1(result);
        if (!valid) {
          console.log(`AUTO: ${house} page 1 validation failed — aborting`);
          return { skipped: false, lots: [], auctionDate, totalLots };
        }
      }
    }

    const jsonLots = result.lots.map(lot => normaliseLot(lot, house, pageUrl));

    const md = result.markdown || '';
    const mdMatches = [...md.matchAll(detailUrlPattern)];
    const mdIds = [...new Set(mdMatches.map(m => m[1]))];

    const jsonIdSet = new Set();
    for (const lot of jsonLots) {
      const idRegex = new RegExp(detailUrlPattern.source);
      const urlMatch = (lot.url || '').match(idRegex);
      if (urlMatch) jsonIdSet.add(urlMatch[1]);
    }

    const missedIds = mdIds.filter(id => !jsonIdSet.has(id));

    if (missedIds.length > 0) {
      console.log(`AUTO: ${house} page ${page}: ${jsonLots.length} JSON, ${mdIds.length} markdown, ${missedIds.length} missed — parsing markdown`);
      const mdLotMap = parseLotFromMarkdown(md, detailUrlPattern, buildDetailUrl);
      for (const id of missedIds) {
        const parsed = mdLotMap.get(id);
        if (parsed && parsed.address) {
          const backfilled = normaliseLot(parsed, house, pageUrl);
          backfilled._extractionSource = 'firecrawl-markdown-backfill';
          jsonLots.push(backfilled);
          mdBackfillCount++;
        }
      }
    } else {
      console.log(`AUTO: ${house} page ${page}: ${jsonLots.length} JSON, ${mdIds.length} markdown — no gaps`);
    }

    allLots.push(...jsonLots);

    if (page < maxPages) await new Promise(r => setTimeout(r, pageGapMs));
  }

  console.log(`AUTO: ${house} two-pass total: ${allLots.length} lots from ${maxPages} pages (${mdBackfillCount} markdown-backfilled)`);
  return { skipped: false, lots: allLots, auctionDate, totalLots };
}

// Parse Pattinson lot cards from catalogue page markdown.
// Markdown structure per lot card (before its /property/{id} link):
//   [images...] Starting Bid\\ \\ £N\\ \\ Xd Xh left (date)\\ \\ type\\ \\ address\\ ...parking](url)
// We split by /property/ links and parse the text block preceding each.
export function parsePattinsonLotCard(markdown, detailUrlPattern, buildDetailUrl) {
  const lotMap = new Map();
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

    lotMap.set(id, {
      address,
      guide_price: price,
      property_type: typeAndBeds,
      bedrooms: beds,
      tenure: '',
      image_url: imageUrl,
      detail_url: buildDetailUrl(id),
      description: '',
      lot_status: 'available',
    });
  }

  return lotMap;
}

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
