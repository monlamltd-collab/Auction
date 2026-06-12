// ═══════════════════════════════════════════════════════════════
// lib/scraper/extraction.js — AI extraction (Gemini) + PDF extraction.
//
// extractLotsWithAI is the Gemini-powered fallback when DOM extractors
// can't carry the load. It batches pages, applies house-specific
// structural hints, deduplicates by lot number + normalised address,
// and stamps tier/extractor provenance via state.js.
//
// extractLotsFromPdf handles the inline-PDF capable-tier path used for
// catalogue PDFs (e.g. SDL property packs). isPdfUrl is the cheap
// content-type check that routes URLs into this branch.
//
// HOUSE_EXTRACTION_HINTS lives here because it's only consumed by
// extractLotsWithAI's prompt builder.
// ═══════════════════════════════════════════════════════════════

import { log } from '../logging.js';
import { HEADERS, MAX_LOTS_PER_SCRAPE } from '../config.js';
import { setLastExtractorUsed } from './state.js';
import {
  getCallAI,
  getCreditExhausted,
  setCreditExhausted,
  setCreditExhaustedAt,
  incApiCallCount,
  setLastAITier,
} from './state.js';
import { stripHtml, isPlaceholderUrl } from './validation.js';
import { hasAIFallback } from '../ai-provider.js';
import { fireAlert } from '../harness/alert-router.js';

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
  landwood:      'EIG OAS platform (tenant 188) in LIST view. Lot panels (.lot-panel) with h3.list-address, .list-guideprice strong, img.list-image, and /lot/details/ links. IMAGE: every panel has an `img.list-image` element — extract its src (or data-src/data-lazy-src if lazy-loaded). Do NOT return null for image_url — these panels always carry a thumbnail.',
  loveitts:      'Auction catalogue with lot number, address, guide price, property description, tenure, and links.',
  hunters:       'Bamboo Auctions platform (hunters.bambooauctions.com). React SPA with property cards showing title, address, guide price, bedrooms, property type, and detail links.',
  // preferPuppeteer houses (Claude fallback when DOM extraction fails)
  network:            'Network Auctions. EIG platform. Lot divs with class current-lots-single, lot-number span, guide-price paragraph, and detail links.',
  pattinson:          'Pattinson React SPA. Property cards with lot number, address, starting/current bid price, and auction detail links.',
  savills:            'Savills auctions. Lot cards with lot number, address, guide price, tenure, property type, and detail links on auctions.savills.co.uk.',
  sdl:                'BTG Eddisons Property Auctions (formerly SDL). Tailwind property-card divs with lot number, address, guide price, auction type/date, and links to /properties/ detail pages. IMAGE: each card has an `<img>` thumbnail — extract its src; if the page is JS-rendered the URL may live in data-src or be wrapped behind a Next.js `_next/image?url=…` CDN path. Either is the valid image_url — do NOT return null.',
  bondwolfe:          'Bond Wolfe auctions. Lot listings with lot number, address, guide price, property type, tenure, and detail page links.',
  barnardmarcus:      'Barnard Marcus auctions. Property cards with lot number, address, guide price, property type, and detail links.',
  auctionhouselondon: 'Auction House London. Lot listings with lot number, address, guide price, property type, tenure, and detail links.',
  cliveemson:         'Clive Emson land and property auctions. Lots with lot number, address, guide price, property type, acreage, tenure, and links. IMAGE: each card has an `<img>` thumbnail pointing at `https://www.cliveemson.co.uk/Auc<N>/pics/<id>-...jpg` (note: `/Auc<N>/pics/`, not `/properties/<auc>/<lot>/`). If you cannot find a thumbnail, leave image_url null — DO NOT fall back to the lot detail page URL (/properties/<auc>/<lot>/), which is HTML, not an image.',
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
  // Image-coverage gap fixes (2026-05-08) — these houses had 0% or near-0% image_url coverage
  // before because their HTML structures weren\'t covered by a hint and Firecrawl native extract
  // was returning null without searching lazy-load attributes.
  walkersingleton:         'Walker Singleton Halifax. EIG-style listing site (onlinesales.walkersingleton.co.uk). Property cards with lot number, full UK address, guide price (£), property type, and detail-page links. IMAGE: each card has a thumbnail `<img>` — extract its src (or data-src if lazy-loaded). Always present; do NOT return null for image_url.',
  driversnorris:           'Drivers & Norris North London — listed on iamsold.co.uk under /estate-agent/drivers/. Property cards with full UK address (London postcodes), guide price, lot number, modern-method-of-auction tag, and /property/{hash} detail links. IMAGE: each card has an `<img>` thumbnail; the iamsold platform serves images via cloudfront.iamsold.co.uk — extract the src/data-src and keep the full CDN URL.',
  taylerandfletcher:       'Tayler & Fletcher Cotswolds. WordPress site (taylerandfletcher.co.uk/property-auctions/). Lot listings with lot number, address, guide price, and detail page links. IMAGE: each lot card has a thumbnail `<img>` — extract its src; lazy-load attrs (data-src) may also carry the URL.',
};

// ── Hallucination guards (2026-06-11 incident) ────────────────────────────
// 107 fabricated lots ("45 Sample Avenue, Manchester", "789 Demo Road…")
// reached the live table over several weeks: given a near-empty page (cookie
// wall / "no results" shell, stripping to 45–262 chars) plus a prompt that
// demands lots, the model INVENTS example data despite the return-[]
// instruction. Two layered defences:
//   1. Content floor — don't ask the model to extract from nothing.
//   2. Grounding — a lot must leave a trace in the content it allegedly came
//      from. Lenient on purpose (recall is sacred); zero trace = invention.
const MIN_EXTRACTION_CONTENT_CHARS = parseInt(process.env.MIN_EXTRACTION_CONTENT_CHARS || '600');

// Street-type words are too generic to count as evidence on their own.
const GENERIC_ADDRESS_TOKENS = new Set([
  'street', 'road', 'avenue', 'lane', 'drive', 'close', 'court', 'place',
  'boulevard', 'house', 'apartment', 'flat',
]);

/**
 * Is this lot evidenced in the (lowercased, whitespace-stripped) content it
 * was extracted from? Grounded when the address's postcode appears, or when
 * at least two address tokens — including one distinctive (non-street-type)
 * token — appear. Exported for tests.
 */
export function isLotGrounded(lot, normalisedContent) {
  const address = String(lot?.address || '');
  if (!address || !normalisedContent) return false;
  const pc = address.match(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i);
  if (pc && normalisedContent.includes(pc[0].toLowerCase().replace(/\s+/g, ''))) return true;
  const tokens = [...new Set(address.toLowerCase().match(/[a-z]{4,}/g) || [])];
  let hits = 0;
  let distinctiveHit = false;
  for (const t of tokens) {
    if (normalisedContent.includes(t)) {
      hits++;
      if (!GENERIC_ADDRESS_TOKENS.has(t)) distinctiveHit = true;
      if (hits >= 2 && distinctiveHit) return true;
    }
  }
  // Tiny addresses ("The Paddock") can only ever produce one token.
  return tokens.length === 1 && hits === 1 && distinctiveHit;
}

/**
 * Parse a (possibly truncated) JSON lot array out of model output.
 *
 * Big catalogues hit the maxTokens ceiling and the response is cut mid-array
 * — observed in production 2026-06-11 as `Expected ',' or '}' after property
 * value in JSON at position 40059` on auctionhousecoventry / cheffinstimed /
 * hollismorgan, losing the WHOLE batch. Salvage instead: cut back to the last
 * complete object and close the array, recovering every fully-emitted lot.
 *
 * Returns { lots, repaired } — lots is [] when nothing parseable. Exported
 * for tests.
 */
export function parseLotArray(text) {
  const raw = String(text || '');
  const strict = raw.match(/\[[\s\S]*\]/);
  if (strict) {
    try { return { lots: JSON.parse(strict[0]), repaired: false }; } catch { /* fall through to repair */ }
  }
  const start = raw.indexOf('[');
  if (start === -1) return { lots: [], repaired: false };
  // Walk back from the end to the last complete object boundary; closing the
  // array there yields valid JSON containing every lot the model finished.
  let tail = raw.slice(start);
  for (let cut = tail.lastIndexOf('}'); cut > 0; cut = tail.lastIndexOf('}', cut - 1)) {
    const candidate = tail.slice(0, cut + 1).replace(/,\s*$/, '') + ']';
    try {
      const lots = JSON.parse(candidate);
      if (Array.isArray(lots)) return { lots, repaired: true };
    } catch { /* try the previous object boundary */ }
  }
  return { lots: [], repaired: false };
}

export async function extractLotsWithAI(pages, house, onProgress, catalogueUrl, deps = {}) {
  const _fireAlert = deps.fireAlert || fireAlert;
  setLastExtractorUsed('gemini');
  // deps.tier lets the caller override the model tier per house — the
  // extraction-tier policy (lib/scraper/extraction-tier.js) promotes weak-recall
  // houses to 'capable' so a stronger model recovers the lots Flash-Lite drops.
  const extractionTier = deps.tier || (house === 'unknown' ? 'capable' : 'fast');
  setLastAITier(extractionTier);
  const allLots = [];
  const seenLots = new Set();
  const batchSize = 3;
  // Systemic-failure telemetry: count batches whose AI call THREW (vs returned
  // junk). When every attempted batch throws and zero lots come out, the cause
  // is wiring/provider/auth — not page content — and must be surfaced as a
  // pipeline alert, not just a console line. (2026-06-11: a missing callAI
  // injection threw on every batch fleet-wide and the only DB evidence was
  // 209 misleading "extractor_regression" alerts.)
  let batchFailures = 0;
  let lastBatchError = null;
  // The getCreditExhausted() flag is Gemini-specific. When a non-Gemini path is
  // configured (OpenRouter fallback / AI_PROVIDER override), a latched Gemini
  // flag must NOT stop extraction — callAI rolls over to the other provider.
  const geminiOnly = !hasAIFallback();
  for (let i = 0; i < pages.length; i += batchSize) {
    if (geminiOnly && getCreditExhausted()) { console.log('Skipping remaining batches -- API rate limited'); break; }
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
    // ── Hallucination guard 1: content floor ──
    // Near-empty pages (cookie walls, "no results" shells — observed at 45-262
    // chars) are the trigger for the model INVENTING example lots ("45 Sample
    // Avenue", "789 Demo Road" — 107 fabricated lots quarantined from the live
    // table on 2026-06-11). A real catalogue page strips to thousands of chars;
    // below the floor there is nothing to extract, so don't ask.
    if (totalStrippedLen < MIN_EXTRACTION_CONTENT_CHARS) {
      console.log(`Batch ${Math.floor(i/batchSize)+1}: ${totalStrippedLen} chars < ${MIN_EXTRACTION_CONTENT_CHARS} floor — skipping (nothing to extract)`);
      continue;
    }
    console.log(`Batch ${Math.floor(i/batchSize)+1}: ${strippedBatch.length} page(s), ${totalStrippedLen} chars${mdCount > 0 ? ` (${mdCount} from markdown)` : ' after stripping'}, tier: ${extractionTier}`);
    const prompt = `You are extracting property auction lot data from a UK auction house catalogue (${house}).
${hint ? `\nStructure hint: ${hint}\n` : ''}
Below are ${strippedBatch.length} page(s) of catalogue content. Extract EVERY auction lot you find.

For each lot, return a JSON object with these fields:
- lot: number (the lot number)
- address: string (full address including postcode)
- price: number or null (guide price in pounds, null if TBA/not stated)
- url: string (detail page URL if found, empty string if not)
- image_url: string or null -- the property's main photo URL (absolute https URL). Look for the lot card's thumbnail <img> src; markdown images appear as ![alt](url). Return the photo URL, NOT the detail-page link. null if there is genuinely no image.
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
      // Truncation-tolerant parse: salvage every complete lot from a response
      // cut off at the maxTokens ceiling instead of losing the whole batch.
      const { lots, repaired } = parseLotArray(text);
      if (repaired) {
        console.warn(`AI extraction: repaired truncated JSON for ${house} — salvaged ${lots.length} lot(s) from a cut-off response`);
      }
      if (lots.length > 0) {
        // ── Hallucination guard 2: grounding check ──
        // Every lot must be EVIDENCED in the page content it was extracted
        // from. A genuinely extracted address necessarily appears (at least in
        // part) in the source; a fabricated one ("123 Example Street, London,
        // E1 1AA") does not. Lenient on purpose — recall matters — but a lot
        // with zero trace in the source is not a lot, it's an invention.
        const groundingContent = strippedBatch.map(p => p.content).join('\n').toLowerCase().replace(/\s+/g, '');
        let droppedUngrounded = 0;
        const groundedLots = lots.filter(lot => {
          // Deterministic fabrication tell: a placeholder-domain lot URL
          // (example.com etc.) can never be real, even when the address tokens
          // happen to appear in the page (which defeats the grounding check —
          // 174 such lots reached production before 2026-06-12).
          if (isPlaceholderUrl(lot?.url)) { droppedUngrounded++; return false; }
          if (isLotGrounded(lot, groundingContent)) return true;
          droppedUngrounded++;
          return false;
        });
        if (droppedUngrounded > 0) {
          console.warn(`AI extraction: dropped ${droppedUngrounded}/${lots.length} ungrounded (hallucinated) lot(s) for ${house}`);
          if (groundedLots.length === 0 && lots.length > 0) {
            // The whole batch was fabricated — make it visible in the DB.
            const p = _fireAlert({
              type: 'ai_hallucination_blocked',
              severity: 'warning',
              house,
              message: `AI invented ${lots.length} lot(s) with no trace in the page content (${totalStrippedLen} chars); all dropped.`,
              meta: { invented: lots.length, contentChars: totalStrippedLen, sample: (lots[0]?.address || '').slice(0, 80) },
            });
            if (p && typeof p.catch === 'function') p.catch(() => {});
          }
        }
        for (const lot of groundedLots) {
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
            // The prompt asks for these but they were previously discarded \u2014
            // restoring them is what makes the Crawlee+Gemini product complete
            // (image/tenure/beds, not just address+price). PR #67 review F4.
            tenure: lot.tenure || null,
            beds: (typeof lot.beds === 'number') ? lot.beds : null,
            // Placeholder-domain images are model inventions — null them so the
            // image backfill can find the real photo (138 nulled in prod 2026-06-12).
            imageUrl: isPlaceholderUrl(lot.image_url || lot.imageUrl) ? undefined : (lot.image_url || lot.imageUrl || undefined),
          });
        }
      }
      if (onProgress) onProgress(Math.floor(i/batchSize)+1, Math.ceil(pages.length/batchSize), allLots.length);
    } catch (err) {
      batchFailures++;
      lastBatchError = err;
      console.error(`AI extraction failed for batch starting at page ${batch[0].page}:`, err.message);
      // Only latch the Gemini exhaustion flag / stop the run when Gemini is the
      // ONLY provider. With a fallback configured, callAI already tried every
      // provider before throwing, so latching here would wrongly halt the rest.
      if (geminiOnly && (err.status === 429 || /quota|rate.limit|resource.exhausted/i.test(err.message))) {
        setCreditExhausted(true);
        setCreditExhaustedAt(Date.now());
        console.error('Gemini API rate limited -- stopping all extraction');
        break;
      }
    }
  }
  // Every attempted batch threw and nothing was extracted → systemic failure.
  // fireAlert dedups per house:type (6h window) so a fleet-wide outage shows
  // up as one alert per house, not one per batch. Severity 'error' so the
  // admin panel separates this from content-shaped zero-lot regressions.
  if (batchFailures > 0 && allLots.length === 0) {
    try {
      const p = _fireAlert({
        type: 'ai_extraction_failure',
        severity: 'error',
        house,
        message: `AI extraction failed for ${house}: ${batchFailures} batch(es) threw, 0 lots extracted. Last error: ${lastBatchError?.message || 'unknown'}`,
        meta: { batches: batchFailures, lastError: lastBatchError?.message || null, tier: extractionTier, pages: pages.length },
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* alerting must never break extraction */ }
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
