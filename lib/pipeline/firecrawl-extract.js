// lib/pipeline/firecrawl-extract.js — Firecrawl-native extraction pipeline
// Feature-flagged via USE_FIRECRAWL_EXTRACT env var.
// Replaces: probe + DOM extractor + Gemini fallback with a single JSON schema call.

import { extractCatalogue, mapSiteUrls, agentExtract } from '../scraper/firecrawl.js';
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
