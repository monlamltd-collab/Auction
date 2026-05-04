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

// Parse John Pye lot cards from /properties/ markdown.
// Each lot is a `- {Title}` bullet followed by a banner image, description text
// and a [View Property](/auctions/{slug}/) link. Title carries status, address,
// price, property type. Postcode-anchored extraction handles prefix junk
// ("SSTC – For Sale by Private Treaty – ...", "2 Bedroom Flat – ...").
export function parseJohnPyeLotCard(markdown, _detailUrlPattern, buildDetailUrl) {
  const lotMap = new Map();
  // Bullets start with letter or digit (some lot titles start with house number)
  const blocks = markdown.split(/\n-\s+(?=[A-Z0-9])/);

  for (const block of blocks) {
    const slugMatch = block.match(/\/auctions\/([\w-]+)/);
    if (!slugMatch) continue;
    const slug = slugMatch[1];
    if (lotMap.has(slug)) continue;

    const firstLine = (block.split('\n')[0] || '').trim();

    // Strip status / transaction-type prefixes — may chain (e.g., "SSTC – For Sale by Private Treaty – Address")
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

    // Price: prefer last £-amount in title; fall back to block-level "Asking Price: £X"
    let priceStr = '';
    const priceMatches = firstLine.match(/£[\d,]+/g);
    if (priceMatches) priceStr = priceMatches[priceMatches.length - 1];
    if (!priceStr) {
      const blockPrice = block.slice(0, 2000).match(/(?:Asking Price|Guide Price|Offers In Excess of)[\s:–—\-]*£([\d,]+)/i);
      if (blockPrice) priceStr = '£' + blockPrice[1];
    }

    // Address: anchor on UK postcode if present (most reliable)
    let address = titleClean;
    const postcodeMatch = address.match(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i);
    if (postcodeMatch) {
      address = address.slice(0, postcodeMatch.index + postcodeMatch[0].length).trim();
      // Strip leading descriptor segment ("2 Bedroom Flat – ", "Three Bedroom Semi-Detached House – ")
      const dashIdx = address.search(/\s+[–—\-]\s+/);
      if (dashIdx > 0) {
        const before = address.slice(0, dashIdx);
        const after = address.slice(dashIdx).replace(/^\s+[–—\-]\s+/, '');
        const afterHasPostcode = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i.test(after);
        const isDescriptor = before.length < 70 && /\b(bedroom|bed|storey|detached|semi|terrace|flat|apartment|house|bungalow|studio|maisonette|offices?|industrial|commercial|land|plot|site|building|warehouse|factory|basement|ground floor|first floor)\b/i.test(before);
        if (afterHasPostcode && isDescriptor) address = after;
      }
    } else {
      // No postcode — light suffix strip only
      address = address
        .replace(/\s+[–—\-]\s+(Asking Price|Guide Price|Offers In Excess|£[\d,]+).*$/i, '')
        .trim();
    }

    // Bedrooms: scan first 1500 chars of block for "N bedroom" or "N bed"
    let beds = null;
    const bedsMatch = block.slice(0, 1500).match(/(\d+|One|Two|Three|Four|Five|Six)\s*[bB]ed(?:room)?/i);
    if (bedsMatch) {
      const wordToNum = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
      const n = parseInt(bedsMatch[1]);
      beds = isNaN(n) ? (wordToNum[bedsMatch[1].toLowerCase()] || null) : n;
    }

    // Property type: keyword scan over title + early block content
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
      lotMap.set(slug, {
        address,
        guide_price: priceStr,
        property_type: propType,
        bedrooms: beds,
        tenure: '',
        image_url: imageUrl,
        detail_url: buildDetailUrl(slug),
        description: '',
        lot_status: lotStatus,
      });
    }
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
