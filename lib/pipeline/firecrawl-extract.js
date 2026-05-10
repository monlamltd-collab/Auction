// lib/pipeline/firecrawl-extract.js — Firecrawl-native catalogue extraction.
//
// The single primary catalogue + detail-page extraction path. The DOM-extractor
// system that lived in lib/extractors/ was retired 2026-05-08; what was once
// called "the anti-pattern we retired" is now actually retired.
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
// Why no /v2/batch/scrape: empirically (verified 2026-05-04 against Pattinson),
// the batch endpoint applies CATALOGUE_PROMPT less effectively than direct
// /v2/scrape — same prompt, ~half the recall. Direct /v2/scrape with an
// in-process concurrency limiter gives both recall and speed.
//
// Why no detail-page backfill: ~840 extra Firecrawl calls per Pattinson cycle
// to recover what's already in the markdown Firecrawl returned. Wasteful.

import { extractCatalogue, extractDetail, mapSiteUrls, agentExtract } from '../scraper/firecrawl.js';
import { CATALOGUE_SCHEMA } from '../scraper/lot-schema.js';
import { HOUSE_ROOTS } from '../houses.js';
import { fireAlert } from '../harness/alert-router.js';
import { unwrapProxyImageUrl, IMG_EXTENSIONS, IMG_PATH_HINTS } from '../scraper/validation.js';

// ── Lot normalisation ─────────────────────────────────────────────────────

function parsePrice(str) {
  if (!str) return null;
  const m = str.replace(/,/g, '').match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

// Phrases the LLM has historically confused for addresses — property-type
// descriptors, banner text, viewing-button labels, status labels. Lots whose
// `address` matches one of these are extraction failures, not real lots; they
// pollute property_key dedup and the lots table generally. See plan
// 2026-05-05 (address-extraction failures plan) for the diagnosis.
const PLACEHOLDER_PHRASES = [
  // "A three bedroom semi-detached house" / "Three bedroom mid-terrace house"
  // (with or without leading "A", with or without trailing descriptor)
  /^(?:a\s+)?(?:one|two|three|four|five|six)\s+bed(?:room)?\b/i,
  // "3 Bedroom House" / "2 bed flat"
  /^\d\s*bed(?:room)?\s+(?:house|flat|apartment|maisonette|bungalow|terrace)/i,
  // Viewing / status / banner labels
  /virtual\s+viewing/i,
  /sold\s+prior\s+to\s+auction/i,
  /national\s+online\s+auction/i,
  /click\s+to\s+view/i,
  /^(?:lot|property)\s+\d+\s*$/i,
  /^view\s+(?:property|details|lot)/i,
  /^bidding\s+(?:now\s+)?open/i,
  // Widget / modal titles the LLM occasionally treats as lot addresses
  // (Bond Wolfe 2026-05-08 — "Add to calendar" Bootstrap modal title was
  // ingested as a phantom land lot; image came from a sibling video embed).
  /^add\s+to\s+(?:calendar|favourites|favorites|shortlist|saved|watchlist)\b/i,
  /^(?:share|email|print|download)\s+(?:this\s+)?(?:property|lot|listing|page)?\b/i,
  /^register(?:\s+(?:to\s+bid|here|now|interest))?\s*$/i,
  /^save\s+(?:property|search|lot)\b/i,
  /^enquire\s+(?:now|about)?\b/i,
  /^looking\s+to\s+bid\b/i,
  /^(?:next|upcoming|future)\s+auction\b/i,
];

const UK_POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

// Returns true if `addr` looks like a real postal address. False for placeholder
// text, banners, property-type descriptors, button labels.
//
// Rules, in order:
//   1. < 6 chars → too short to be a real address.
//   2. Contains a UK postcode → strong positive, accept.
//   3. Matches a known placeholder pattern → reject.
//   4. No digit AND length < 12 → too short / too vague (e.g. "A street").
//   5. Otherwise → accept tentatively. (OS Places enrichment may correct/null
//      malformed real addresses downstream.)
export function looksLikeRealAddress(addr) {
  if (!addr || typeof addr !== 'string') return false;
  const trimmed = addr.trim();
  if (trimmed.length < 6) return false;
  if (UK_POSTCODE_RE.test(trimmed)) return true;
  if (PLACEHOLDER_PHRASES.some(rx => rx.test(trimmed))) return false;
  if (!/\d/.test(trimmed) && trimmed.length < 12) return false;
  return true;
}

// normaliseLot returns null for lots whose address fails validation. Callers
// (the listing-collection loop) filter nulls out and increment the rejection
// counter for logging.
function normaliseLot(raw, house, catalogueUrl) {
  if (!looksLikeRealAddress(raw.address)) return null;
  const price = parsePrice(raw.guide_price);
  return {
    address: raw.address.trim(),
    lotNumber: raw.lot_number || null,
    price,
    priceStr: raw.guide_price || '',
    beds: raw.bedrooms || null,
    tenure: raw.tenure || '',
    imageUrl: unwrapProxyImageUrl(raw.image_url || ''),
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

// McHugh & Co runs on the EIG platform but on their own domain. The lot
// list page is ~500 KB with 200+ lot blocks inline — the JSON extractor
// silently caps short on dense pages. Each lot follows a stable structure:
//
//   ![](https://cdn.eigpropertyauctions.co.uk/.../web_medium...)
//   ](https://www.mchughandco.com/lot/details/{ID})
//
//   [Watch](https://www.mchughandco.com/account/login)
//
//   ### Lot {N} \|   End Time - **DD/MM/YYYY HH:MM**
//
//   #### {ADDRESS WITH POSTCODE}
//
//   {Tenure} {Type} {Possession status}
//
//   * * *
//
//   Guide Price\* **£{N}+**
//
// We split on the link-closing `](.../lot/details/{ID})` boundary, then
// parse the trailing block for ###/####/£ markers. Verified against
// lots 1, 2, 3 of the live May 2026 auction (180761, 179205, 171400).
export function recogniseMcHughLotsFromMarkdown(markdown) {
  const lots = new Map();
  const chunks = markdown.split(/\]\(https:\/\/www\.mchughandco\.com\/lot\/details\/(\d+)\)/);

  // chunks[0] = preamble — also contains the photo gallery for Lot 1
  // chunks[1] = first ID  (terminates Lot 1's photo link)
  // chunks[2] = Lot 1 textual content + Lot 2's photo gallery
  // chunks[3] = second ID (terminates Lot 2's photo link)
  // chunks[4] = Lot 2 textual content + Lot 3's photo gallery
  //
  // For each lot at index i (id = chunks[i]):
  //   - photos are in the PRECEDING block (chunks[i-1]) — that block ends
  //     with `](.../lot/details/{id})`, the closing of the photo link
  //   - textual content (### Lot N, #### address, etc.) is in chunks[i+1]
  for (let i = 1; i + 1 < chunks.length; i += 2) {
    const id = chunks[i];
    if (lots.has(id)) continue;
    const photoBlock = chunks[i - 1] || '';
    const block = chunks[i + 1];

    // Lot number from "### Lot N"
    const lotMatch = block.match(/###\s*Lot\s*(\d+)/i);
    const lotNumber = lotMatch ? parseInt(lotMatch[1]) : null;

    // Address — first H4 immediately after "### Lot N"
    const addrMatch = block.match(/####\s*([^\n]+)/);
    const address = addrMatch ? addrMatch[1].trim().replace(/\\$/, '').trim() : '';

    // Property descriptor sits between #### address and the * * * separator
    const descMatch = block.match(/####\s*[^\n]+\n+([^\n]+)/);
    const descriptor = descMatch ? descMatch[1].trim() : '';

    // Guide Price — the **£N+** token after "Guide Price"
    let guidePrice = '';
    const priceMatch = block.match(/Guide Price\\?\*?\s*\*\*\s*(£[\d,]+\+?)\s*\*\*/i);
    if (priceMatch) guidePrice = priceMatch[1];

    // First image — EIG CDN, web_medium variant. Pull from the PRECEDING
    // chunk (which holds this lot's photo gallery, terminated by `](id)`).
    const imgMatch = photoBlock.match(/!\[\]\((https:\/\/cdn\.eigpropertyauctions\.co\.uk\/[^\s)]+)\)/);
    const imageUrl = imgMatch ? imgMatch[1] : '';

    // Property type derived from descriptor line
    const lower = descriptor.toLowerCase();
    let propType = '';
    if (/\b(flat|apartment|maisonette|studio)\b/.test(lower)) propType = 'flat';
    else if (/\bbungalow\b/.test(lower)) propType = 'bungalow';
    else if (/\b(house|terrace|semi-detached|detached)\b/.test(lower)) propType = 'house';
    else if (/\b(land|plot|site|building plot)\b/.test(lower)) propType = 'land';
    else if (/\b(commercial|office|retail|industrial|warehouse)\b/.test(lower)) propType = 'commercial';

    // Status — McHugh marks results inline (e.g. "Sold Prior", "Withdrawn")
    let lotStatus = 'available';
    if (/\bsold\b/i.test(descriptor) || /\bsold\s+prior\b/i.test(block.slice(0, 600))) lotStatus = 'sold';
    else if (/\bwithdrawn\b/i.test(descriptor)) lotStatus = 'withdrawn';
    else if (/\bpostponed\b/i.test(descriptor)) lotStatus = 'postponed';

    if (address && address.length > 5) {
      lots.set(id, {
        lot_number: lotNumber,
        address,
        guide_price: guidePrice,
        property_type: propType,
        bedrooms: null,
        tenure: descriptor.match(/\b(freehold|leasehold)\b/i)?.[1]?.toLowerCase() || '',
        image_url: imageUrl,
        detail_url: `https://www.mchughandco.com/lot/details/${id}`,
        description: descriptor,
        lot_status: lotStatus,
      });
    }
  }

  return lots;
}

// Mark Jenkinson runs three concurrent auctions on per-event URLs
// (/auction/{datestamp_token}). Each catalogue page lists 10–170 lot
// blocks in a stable layout — the JSON extractor under-counted (15/73
// observed) and mis-classified all surviving lots as "sold" because
// the page header reads "Multi-Lot Timed Auction" which the LLM read
// as a sale-completion marker.
//
// Per-lot block:
//   {3-digit lot number}\n\n
//   [![Property image](IMG_URL)](LOT_URL[/at/{...}])\n\n
//   [View Property](LOT_URL)\n\n
//   {auction-type label or "Withdrawn"/"Sold" etc}\n\n
//   [{ADDRESS}](LOT_URL)\n\n
//   {auction-type label again — duplicated by the page template}\n\n
//   {optional: Guide Price / Address Withheld blocks}
//
// The auction-type labels ("Multi-Lot Timed Auction", "Live Stream
// Auction") are layout decoration, not lot status. Real status
// markers appear when the lot is taken out of the auction:
// "Withdrawn", "Sold Prior", "Postponed", "Reserved".
//
// Verified against the 26 May 2026 catalogue (73 lots, 72 active +
// 1 withdrawn) on 2026-05-09.
export function recogniseMarkJenkinsonLotsFromMarkdown(markdown) {
  const lots = new Map();
  // Each lot starts with `[![Property image](...)]` (a wrapper around an
  // anchor to the lot's URL). Multi-Lot Timed pages prepend a 3-digit lot
  // number to that block; Live Stream pages don't. Splitting on the image
  // wrapper handles both layouts uniformly. The trailing block ends at
  // the start of the next image wrapper, or end-of-markdown.
  const blocks = markdown.split(/(?=\[!\[Property image\]\()/g);

  // Status markers that indicate the lot is NOT actively for sale.
  const inactiveStatusRe = /^(Withdrawn|Sold Prior|Postponed|Reserved|Sold|Under Offer|SSTC)$/i;

  for (const block of blocks) {
    // Token is the path segment after /property/, alphanumeric + underscore.
    // Strip any /at/<timestamp> suffix that the listing URL appends.
    const idMatch = block.match(/markjenkinson\.co\.uk\/property\/([a-z0-9_]+)/i);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (lots.has(id)) continue;

    // Lot number — Multi-Lot Timed pages emit a 3-digit prefix line right
    // before the image-link block. We look at the trailing 12 chars of the
    // text immediately preceding the block boundary to recover it. Live
    // Stream pages skip the prefix; lot_number stays null.
    const blockStart = markdown.indexOf(block);
    const before = markdown.slice(Math.max(0, blockStart - 12), blockStart);
    const lotMatch = before.match(/(\d{3})\s*$/);
    const lotNumber = lotMatch ? parseInt(lotMatch[1]) : null;

    // Address sits in `[ADDRESS](LOT_URL)` AFTER the [View Property] link.
    // The image link is also `[![...](IMG)](LOT_URL)` — we want the second
    // occurrence (the textual one), not the image-wrapping link.
    const addrMatches = [...block.matchAll(/\[([^\]\n][^\]]*)\]\(https:\/\/www\.markjenkinson\.co\.uk\/property\/[a-z0-9_]+\)/gi)];
    // Filter out "View Property" / image-bracket entries.
    const realAddrMatch = addrMatches.find(m => !/^View Property$/i.test(m[1].trim()) && !m[1].startsWith('!['));
    const address = realAddrMatch ? realAddrMatch[1].trim() : '';

    // Status — line between [View Property] link and the address link.
    let lotStatus = 'available';
    const statusZone = block.split(/\[View Property\]\([^)]+\)\s*/i)[1] || '';
    const candidateStatusLines = statusZone
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .slice(0, 3);
    for (const line of candidateStatusLines) {
      if (inactiveStatusRe.test(line)) {
        const lower = line.toLowerCase();
        if (lower.includes('withdrawn')) lotStatus = 'withdrawn';
        else if (lower.includes('postponed')) lotStatus = 'postponed';
        else lotStatus = 'sold';
        break;
      }
    }

    // Image — first asta.btgeddisonspropertyauctions.com URL in the block.
    const imgMatch = block.match(/!\[Property image\]\((https:\/\/asta\.btgeddisonspropertyauctions\.com\/[^)]+)\)/);
    const imageUrl = imgMatch ? imgMatch[1] : '';

    // Guide Price — appears as plain text "£<digits>+" or "£X to £Y" in
    // some blocks; not always present (some lots show "Guide Price On
    // Request" etc).
    let guidePrice = '';
    const priceMatch = block.match(/£[\d,]+(?:\s*(?:to|\-|–)\s*£[\d,]+)?(?:\s*plus)?/);
    if (priceMatch) guidePrice = priceMatch[0];

    if (address && address.length > 5) {
      lots.set(id, {
        lot_number: lotNumber,
        address,
        guide_price: guidePrice,
        property_type: '',
        bedrooms: null,
        tenure: '',
        image_url: imageUrl,
        detail_url: `https://www.markjenkinson.co.uk/property/${id}`,
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
  //          markdown Firecrawl already returned. Drop lots whose address
  //          is placeholder/banner text — see normaliseLot + looksLikeRealAddress.
  const allLots = [];
  let totalMdIds = 0;
  let totalJsonIds = 0;
  let totalRecognised = 0;
  let totalRejectedAddress = 0;
  let pagesWithErrors = 0;

  for (const page of pageResults) {
    if (page.error) {
      pagesWithErrors++;
      console.log(`AUTO: ${house} ${page.url}: page error (${page.error}) — skipping`);
      continue;
    }

    const jsonLotsRaw = page.lots.map(lot => normaliseLot(lot, house, page.url));
    const jsonLots = jsonLotsRaw.filter(Boolean);
    totalRejectedAddress += jsonLotsRaw.length - jsonLots.length;
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
            // normaliseLot returns null on placeholder addresses; respect that
            // even for markdown-recognised lots.
            if (!normalised) { totalRejectedAddress++; continue; }
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
    + (totalRejectedAddress ? `, ${totalRejectedAddress} lots dropped (placeholder address)` : '')
    + (pagesWithErrors ? `, ${pagesWithErrors} page errors` : '');
  console.log(`AUTO: ${house} ${summary}`);

  // Persist recall metric to pipeline_alerts so we can rank houses by recall ratio
  // over time. Stdout-only logs roll off Railway's 500-line buffer in hours;
  // this gives us a Supabase-queryable history for self-healing remediation.
  if (totalMdIds > 0) {
    const ratio = (totalJsonIds + totalRecognised) / totalMdIds;
    fireAlert({
      type: 'recall_diagnostic',
      severity: 'info',
      house,
      message: `Recall ${(ratio * 100).toFixed(0)}%: ${totalJsonIds + totalRecognised}/${totalMdIds}`,
      meta: {
        jsonIds: totalJsonIds,
        mdIds: totalMdIds,
        recognised: totalRecognised,
        ratio,
        pages: pageResults.length,
      },
    }).catch(err => console.warn(`AUTO: ${house} recall_diagnostic alert failed: ${err.message}`));
  }

  return {
    skipped: false,
    lots: allLots,
    auctionDate: pageResults[0]?.auctionDate || null,
    totalLots: pageResults[0]?.totalLots || null,
    pageErrors: pagesWithErrors,
    jsonExtracted: totalJsonIds,
    markdownRecognised: totalRecognised,
    rejectedPlaceholderAddress: totalRejectedAddress,
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

// ── Detail-page extraction ────────────────────────────────────────────────
//
// extractLotDetailFirecrawl replaces the JSDOM-based per-house detail
// extractors that lived in lib/extractors/details/. Returns an object
// shape-compatible with the legacy extractLotDetail():
//   { address, postcode, images[], imageUrl, bullets[], tenure, propType,
//     beds, price, priceText?, vacant?, viewingDates?, ... }
// Only fields actually present on the page are populated; missing fields
// are omitted, matching the legacy behaviour.

function isLikelyImage(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('data:')) return false;
  return IMG_EXTENSIONS.test(url) || IMG_PATH_HINTS.test(url);
}

function normalisePropType(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const t = raw.toLowerCase();
  if (/\b(?:flat|apartment|maisonette|studio|penthouse)\b/.test(t)) return 'flat';
  if (/\b(?:terrac|semi|detached|town\s*house|cottage|bungalow|villa|house)\b/.test(t)) return 'house';
  if (/\b(?:land|plot|garage|parking)\b/.test(t)) return 'land';
  if (/\b(?:shop|retail|office|warehouse|industrial|commercial|pub|hotel)\b/.test(t)) return 'commercial';
  return '';
}

function normaliseTenure(raw) {
  if (!raw || typeof raw !== 'string') return '';
  if (/share\s+of\s+freehold/i.test(raw)) return 'Share of Freehold';
  if (/leasehold/i.test(raw) && !/freehold/i.test(raw)) return 'Leasehold';
  if (/freehold/i.test(raw) && !/leasehold/i.test(raw)) return 'Freehold';
  return '';
}

function extractPostcodeFromAddress(addr) {
  if (!addr) return '';
  const m = addr.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  return m ? m[1].toUpperCase().replace(/\s+/g, ' ') : '';
}

export async function extractLotDetailFirecrawl(url, house, options = {}) {
  let raw;
  try {
    raw = await extractDetail(url, options);
  } catch (err) {
    console.log(`Firecrawl detail extract failed for ${house} ${url}: ${err.message}`);
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;

  const out = {};

  // Address + postcode
  if (raw.address && typeof raw.address === 'string') out.address = raw.address.trim();
  const pcFromField = raw.postcode || extractPostcodeFromAddress(out.address || '');
  if (pcFromField) out.postcode = pcFromField.toUpperCase().replace(/\s+/g, ' ');

  // Images — dedupe + filter junk + cap
  const rawImgs = Array.isArray(raw.image_urls) ? raw.image_urls : [];
  const seen = new Set();
  const images = [];
  for (const src of rawImgs) {
    if (!src || typeof src !== 'string') continue;
    let abs = unwrapProxyImageUrl(src);
    if (!/^https?:\/\//i.test(abs)) {
      try { abs = new URL(abs, url).href; } catch { continue; }
    }
    if (!isLikelyImage(abs) || seen.has(abs)) continue;
    seen.add(abs);
    images.push(abs);
    if (images.length >= 8) break;
  }
  if (images.length > 0) {
    out.images = images;
    out.imageUrl = images[0];
  }

  // Description → bullets
  if (raw.description && typeof raw.description === 'string') {
    const desc = raw.description.trim();
    if (desc.length > 3 && desc.length < 4000) {
      out.bullets = [desc];
    }
  }

  // Price
  if (raw.guide_price && typeof raw.guide_price === 'string') {
    const priceMatch = raw.guide_price.replace(/,/g, '').match(/(\d+)/);
    if (priceMatch) {
      const n = parseInt(priceMatch[1], 10);
      if (n >= 1000 && n <= 50000000) out.price = n;
    }
    if (/\b(?:p\.?o\.?a\.?|t\.?b\.?a\.?|on\s+application)\b/i.test(raw.guide_price)) {
      out.priceText = 'POA';
    }
  }

  // Tenure / propType / beds
  const tenure = normaliseTenure(raw.tenure || '');
  if (tenure) out.tenure = tenure;
  const propType = normalisePropType(raw.property_type || '');
  if (propType) out.propType = propType;
  if (typeof raw.bedrooms === 'number' && raw.bedrooms >= 0 && raw.bedrooms <= 20) {
    out.beds = raw.bedrooms;
  }

  // Auxiliary fields kept verbatim if present (used by enrichment-manifest)
  if (raw.epc_rating) out.epcRating = String(raw.epc_rating).trim();
  if (raw.epc_url) out.epcUrl = String(raw.epc_url).trim();
  if (raw.floor_plan_url) out.floorPlanUrl = String(raw.floor_plan_url).trim();
  if (raw.legal_pack_url) out.legalPackUrl = String(raw.legal_pack_url).trim();
  if (raw.lot_number != null) out.lot = raw.lot_number;
  if (raw.lot_status) out.lotStatus = String(raw.lot_status).toLowerCase();
  if (raw.auction_date) out.auctionDate = String(raw.auction_date);

  return out;
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
