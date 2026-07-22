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
import { recallGateAlert } from './recall-gate.js';
import { unwrapProxyImageUrl, IMG_EXTENSIONS, IMG_PATH_HINTS } from '../scraper/validation.js';
import { normaliseScrapedLot } from '../types/lot.js';
import { setLastExtractorUsed } from '../scraper/state.js';
import { parseAuctionDateFromBullet, parseSavillsAuctionSlug, SAVILLS_MONTHS } from '../utils.js';

// ── Lot normalisation ─────────────────────────────────────────────────────

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

// EIG white-label CMS (Hollis Morgan, Maggs & Allen, McHugh, fssproperty)
// embeds the catalogue's own navigation state into every lot card href:
//   /property-details/{id}/{slug}?page=1&bid=11&showstc=on&orderby=lot_no+asc&extra_2!=501,502
// The path uniquely identifies the lot; the query string is purely filter
// state that varies by which catalogue page the card was rendered on. Because
// `lots.url` has a unique constraint, the same property appears multiple times
// — once per catalogue-filter context — and breaks dedup / upsert.
//
// IMPORTANT: must NOT be a blanket `split('?')[0]` — many other auction
// houses use `?id=N` style URLs where the query string IS the canonical
// identifier (countrywide, futureauctions, sharpesauctions, venmore, etc.).
// Stripping `?` for those collapses every lot to the same path-only URL.
// So we delete only the known EIG navigation params and leave others intact.
// `searchToken` is the EIG OAS per-request signed token that tcpa (and other OAS
// deployments) append to every lot link on the search page; it changes each
// scrape and is NOT part of the lot identity, so strip it to keep lots.url stable.
const EIG_CATALOGUE_PARAMS = ['page', 'bid', 'showstc', 'orderby', 'extra_2', 'extra_2!', 'searchToken'];
export function stripEigCatalogueParams(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const u = new URL(rawUrl);
    for (const p of EIG_CATALOGUE_PARAMS) u.searchParams.delete(p);
    // URL.toString() drops a trailing `?` when searchParams is empty.
    return u.toString();
  } catch {
    // Not a parseable absolute URL (e.g. relative path). Apply the same
    // surgical strip via regex on the substring after `?`.
    const qIdx = rawUrl.indexOf('?');
    if (qIdx === -1) return rawUrl;
    const path = rawUrl.slice(0, qIdx);
    const params = new URLSearchParams(rawUrl.slice(qIdx + 1));
    for (const p of EIG_CATALOGUE_PARAMS) params.delete(p);
    const remaining = params.toString();
    return remaining ? `${path}?${remaining}` : path;
  }
}

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

// Scrape-time lot normalisation now lives in lib/types/lot.js as
// `normaliseScrapedLot`. The helpers above (looksLikeRealAddress,
// PLACEHOLDER_PHRASES, UK_POSTCODE_RE, stripEigCatalogueParams) remain
// here because (a) they're consumed by the validation pipeline + the
// detail-page normaliser further down this file, and (b)
// `tests/test-address-validation.js` imports `looksLikeRealAddress`
// directly from this module. lib/types/lot.js has its own inlined
// copies to stay leaf-level.

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
// Pattinson rebuilt its React SPA (structure_drift → 0 lots since mid-June): the
// old recogniser split on a literal `parking](…/property/{id})` anchor that the
// new template no longer emits. Rewritten 2026-07-08 to be template-robust —
// match each whole card link `[{content}](…/property/{id})` (the lazy inner stops
// at the property-url close, skipping nested `![img](cdn)` links) and read the
// fields off the content lines (price, beds/type, postcode-bearing address). The
// card carries a photo gallery (`…/property-images/{id}/…`); the first is the lead.
export function recognisePattinsonLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;
  const unescape = (s) => String(s || '').replace(/\\(.)/g, '$1');
  const UK_PC = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i;
  const CARD_RE = /\[([\s\S]*?)\]\(https:\/\/(?:www\.)?pattinson\.co\.uk\/property\/(\d+)\)/gi;
  for (const m of markdown.matchAll(CARD_RE)) {
    const content = m[1] || '';
    const id = m[2];
    if (lots.has(id)) continue;

    const lines = content.split(/\n+/).map(l => unescape(l).replace(/\s+/g, ' ').trim()).filter(Boolean);
    // Address — the line carrying a UK postcode (and a comma).
    const address = lines.find(l => UK_PC.test(l) && l.includes(',')) || '';
    if (!address || address.length < 5) continue;

    const priceLine = lines.find(l => /^£[\d,]+$/.test(l)) || lines.find(l => /£[\d,]+/.test(l)) || '';
    const guide_price = (priceLine.match(/£[\d,]+/) || [''])[0];

    // "1 bed apartment" / "3 bed house" — beds + type descriptor.
    const tbLine = lines.find(l => /^\d+\s*bed/i.test(l)) || '';
    const bedrooms = tbLine ? parseInt(tbLine.match(/^(\d+)/)[1], 10) : null;
    const tw = tbLine.toLowerCase();
    const property_type = /flat|apartment|maisonette|studio/.test(tw) ? 'flat'
      : /bungalow/.test(tw) ? 'bungalow'
      : /house|terrace|semi|detached/.test(tw) ? 'house'
      : /land|plot/.test(tw) ? 'land'
      : /commercial|office|retail|industrial/.test(tw) ? 'commercial' : '';

    const imgMatch = content.match(/!\[[^\]]*\]\((https:\/\/[^)]*property-images\/\d+\/[^)]+)\)/i);
    const image_url = imgMatch ? imgMatch[1] : '';

    let lot_status = 'available';
    if (/\bwithdrawn\b/i.test(content)) lot_status = 'withdrawn';
    else if (/\bunsold\b|\bnot\s*sold\b/i.test(content)) lot_status = 'unsold';
    else if (/\bsold\b/i.test(content)) lot_status = 'sold';

    const bullets = [];
    if (bedrooms) bullets.push(`${bedrooms} bedroom`);

    lots.set(id, {
      lot_number: null,
      address,
      guide_price,
      property_type,
      bedrooms,
      tenure: '',
      image_url,
      detail_url: `https://www.pattinson.co.uk/property/${id}`,
      description: '',
      bullets,
      lot_status,
    });
  }
  return lots;
}

// ── John Pye ───────────────────────────────────────────────────────────────
//
// Rebuilt 2026-07-21. The old recogniser split the markdown on `\n- {CAPS}`
// and read the block's FIRST LINE as the title. johnpye.co.uk/properties/ now
// runs an Avada/Fusion post-card grid where every card opens with an EMPTY
// anchor (`-   [](…/auctions/{slug}/)`) and the title sits on the NEXT line —
// so the old split produced 2 blocks for the whole page and recovered 2
// garbage "lots" (the page <title> and the words "Auction Location"), both
// emitted as status='available'. 0 real lots, 2 fabricated.
//
// New shape, per card, in the turndown markdown:
//
//   -   [](https://www.johnpye.co.uk/auctions/{slug}/)
//       {TITLE — status prefix – descriptors – address+postcode – price}
//       [](…/{slug}/)
//       [![](…image…)](…/{slug}/)
//       [](…/{slug}/)
//       {DESCRIPTION — same fields, hyphen-separated}
//       [View Property](…/{slug}/)   ← or [Preview Auction](…) for timed lots
//       {contact line}
//       {BUTTON LABEL — "For Sale By Private Treaty" /
//                       "For Sale by Private Treaty - UNDER OFFER" / "To Let" /
//                       "Auction Ends | Thursday 30th Jul | 11:00am"}
//
// Cards are therefore delimited by RUNS of same-slug lot links, not by list
// markers. The grid is rendered twice on the page (desktop + small-screen
// variants) — dedupe by slug keeps the first copy.
//
// Anti-leak contract: the listing mixes live stock with SSTC / Under Offer
// stock, and the "under offer" marker is sometimes ONLY on the button label
// (e.g. `/auctions/10040-2/` has a clean title but a "…- UNDER OFFER" button),
// so status is read from the WHOLE card, never the title alone. The
// serviced-offices "To Let" card is a lettings listing and is dropped.

// Category / navigation slugs that share the lot URL shapes but are not lots.
const JP_NON_LOT_SLUGS = new Set([
  'general-auctions', 'vehicle-auctions', 'police-auctions', 'insolvency-auctions',
  'properties', 'business-for-sale', 'upcoming-auctions', 'live-auctions',
  'auction-locations', 'locations',
]);

// Link labels that are chrome, not lot text.
const JP_NOISE_LINE = /^(view property|preview auction|view details|view lot|register|sign in|toggle navigation|search for:|read more|more \+)\s*$/i;

const JP_UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
const JP_WORD_NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// Split a card title/description on " – " / " — " / " - " separators only
// (spaced dashes). Unspaced hyphens inside "Semi-Detached" / "Stoke-On-Trent"
// must survive.
function jpSegments(line) {
  return String(line || '').split(/\s+[–—-]+\s+/).map(s => s.trim()).filter(Boolean);
}

export function recogniseJohnPyeLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;

  // Detail pages live at /auctions/{slug}/; the listing itself is /properties/
  // and historically linked either scheme — accept both and rebuild the
  // detail_url with whichever prefix the markdown actually used.
  const linkRe = /https?:\/\/(?:www\.)?johnpye\.co\.uk\/(auctions|properties)\/([a-z0-9][a-z0-9-]*)\/?/gi;
  const hits = [];
  for (const m of markdown.matchAll(linkRe)) {
    hits.push({ prefix: m[1].toLowerCase(), slug: m[2].toLowerCase(), index: m.index });
  }
  if (hits.length === 0) return lots;

  // Consecutive same-slug links = one card. The card's text runs from its
  // first link to the first link of the next card.
  const runs = [];
  for (const h of hits) {
    const last = runs[runs.length - 1];
    if (last && last.slug === h.slug) continue;
    runs.push({ slug: h.slug, prefix: h.prefix, start: h.index });
  }

  for (let i = 0; i < runs.length; i++) {
    const { slug, prefix } = runs[i];
    if (JP_NON_LOT_SLUGS.has(slug)) continue;
    if (lots.has(slug)) continue;

    // Back up to the start of the line the first link sits on, so the list
    // marker (and any text before the link on that line) is included.
    const lineStart = markdown.lastIndexOf('\n', runs[i].start) + 1;
    const blockEnd = i + 1 < runs.length ? runs[i + 1].start : markdown.length;
    const block = markdown.slice(lineStart, blockEnd);

    // Text lines: drop images, unwrap links to their label, strip list markers.
    const lines = block
      .split('\n')
      .map(l => l
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')      // images
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // links → label
        .replace(/^\s*[-*+]\s+/, '')                // list marker
        .replace(/\s+/g, ' ')
        .trim())
      .filter(l => l.length >= 3 && !JP_NOISE_LINE.test(l));
    if (lines.length === 0) continue;

    const title = lines[0];
    // The contact boilerplate repeats on every card — never treat it as prose.
    const body = lines.slice(1).filter(l => !/to view or submit an offer/i.test(l));
    const description = body.find(l => l !== title) || '';

    // ── Lettings listings are not lots ──
    const isRental = /\bto\s+(?:rent|let)\b/i.test(title)
      || lines.some(l => /^to\s+(?:rent|let)\b/i.test(l));
    if (isRental) continue;

    // ── Status: read the WHOLE card (title, description, button label) ──
    const statusHay = [title, ...body].join(' | ');
    let lotStatus = 'available';
    if (/\bwithdrawn\b/i.test(statusHay)) lotStatus = 'withdrawn';
    else if (/\bpostponed\b/i.test(statusHay)) lotStatus = 'postponed';
    else if (/\bsstc\b|sold\s+subject\s+to\s+contract|\bunder\s+offer\b|\bsold\b|\breserved\b/i.test(statusHay)) lotStatus = 'sold';

    // ── Address: the title/description segment carrying the postcode ──
    let address = '';
    for (const src of [title, description]) {
      const seg = jpSegments(src).find(s => JP_UK_POSTCODE.test(s));
      if (seg) { address = seg.replace(/\s*[,–—-]\s*$/, '').trim(); break; }
    }
    if (!address) {
      // No postcode anywhere — fall back to the longest title segment that
      // isn't a status label or a price, so a real address still has a chance
      // of surviving normaliseScrapedLot rather than being silently dropped.
      const cand = jpSegments(title)
        .filter(s => !/^(sstc|sold|under offer|withdrawn|postponed|reserved|available|for sale|for sale by|coming soon)\b/i.test(s))
        .filter(s => !/£/.test(s) && !/^(guide|asking)\s+price/i.test(s))
        .sort((a, b) => b.length - a.length)[0];
      address = (cand || '').trim();
    }
    if (!address || address.length < 6) continue;

    // ── Price ──
    let priceStr = '';
    const priceHay = [title, ...body].join(' | ');
    const labelled = priceHay.match(/(Guide Price|Asking Price|Offers?\s+In\s+Excess\s+Of|Offers?\s+Over|Price)\s*:?\s*(£\s?[\d,]+)(\+?)/i);
    if (labelled) priceStr = `${labelled[1]} ${labelled[2].replace(/\s+/g, '')}${labelled[3]}`.replace(/\s+/g, ' ');
    if (!priceStr) {
      const bare = priceHay.match(/£\s?[\d,]{4,}\+?/);
      if (bare) priceStr = bare[0].replace(/\s+/g, '');
    }

    // ── Auction date — "Auction Ends | Thursday 30th Jul | 11:00am" ──
    let auctionDate = '';
    const endsLine = lines.find(l => /auction\s+ends/i.test(l));
    if (endsLine) auctionDate = parseAuctionDateFromBullet(endsLine) || '';

    // ── Beds ──
    let beds = null;
    const bedsMatch = `${title} | ${description}`.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)[\s-]*bed(?:room)?s?\b/i);
    if (bedsMatch) {
      const n = parseInt(bedsMatch[1], 10);
      beds = Number.isNaN(n) ? (JP_WORD_NUMS[bedsMatch[1].toLowerCase()] || null) : n;
    }

    // ── Property type ──
    let propType = '';
    const lower = `${title} ${description}`.toLowerCase();
    if (/serviced offices|industrial unit|industrial warehouse|warehouse|factory|industrial building|storey offices|care facility|hostel|hotel|social club|retail|shop|public house/.test(lower)) propType = 'commercial';
    else if (/\b(land|plots?|sites?|building plots?|freehold land titles?)\b/.test(lower)) propType = 'land';
    else if (/\b(flats?|apartments?|maisonettes?|studios?)\b/.test(lower)) propType = 'flat';
    else if (/\bbungalows?\b/.test(lower)) propType = 'bungalow';
    else if (/\bhouses?\b/.test(lower)) propType = 'house';

    // ── Image — the card's own banner, never the site logo ──
    let imageUrl = '';
    for (const m of block.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
      if (/logo|jpa-master|sprite|placeholder/i.test(m[1])) continue;
      imageUrl = m[1];
      break;
    }

    const bullets = body.filter(l => l !== description).slice(0, 4);
    if (description) bullets.unshift(description);

    lots.set(slug, {
      lot_number: null,
      address,
      guide_price: priceStr,
      property_type: propType,
      bedrooms: beds,
      tenure: '',
      image_url: imageUrl,
      detail_url: `https://www.johnpye.co.uk/${prefix}/${slug}/`,
      description,
      bullets,
      auction_date: auctionDate,
      lot_status: lotStatus,
    });
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
  const chunks = markdown.split(/\]\(https:\/\/(?:www\.)?mchughandco\.com\/lot\/details\/(\d+)\)/);

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

// Nesbits (Portsmouth chartered surveyors/auctioneers) lists its auction lots
// on /auctions as IMAGE-ONLY anchors — `[![](img)](/property/{slug}/{id}/)` —
// so the listing markdown carries no inline address/price text and the JSON/
// Gemini extractor returns 0 (verified 2026-06-13: live 23 Jun auction, ~6
// lots, delivered NONE). Every lot's data (guide price, auction date, beds)
// lives on its detail page, which the pipeline's first-contact deep-fetch
// already pulls. So this recogniser just HARVESTS the lot URLs and seeds the
// address from the URL slug; the detail pass fills the rest.
//
// Slug shape: `villiers-road-southsea-po5-2hg` → street/area words + a UK
// postcode as the final two hyphen tokens (outcode `po5` + incode `2hg`).
// Requiring a postcode-ending slug AND a numeric id filters out non-lot
// /property/ nav links (e.g. /property/for-sale/).
export function recogniseNesbitsLotsFromMarkdown(markdown) {
  const lots = new Map();
  const re = /https?:\/\/(?:www\.)?nesbits\.co\.uk\/property\/([a-z0-9-]+)\/(\d+)\/?/gi;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const slug = m[1];
    const id = m[2];
    if (lots.has(id)) continue;
    const address = addressFromNesbitsSlug(slug);
    if (!address) continue; // no postcode in slug → not a lot URL, skip
    lots.set(id, {
      lot_number: null,
      address,
      guide_price: '',
      property_type: '',
      bedrooms: null,
      tenure: '',
      image_url: '',
      detail_url: `https://www.nesbits.co.uk/property/${slug}/${id}/`,
      description: '',
      lot_status: 'available',
    });
  }
  return lots;
}

// Turn a Nesbits property slug into a seed address. Returns '' when the slug
// has no trailing UK postcode (so callers can reject non-lot links).
//   'villiers-road-southsea-po5-2hg' → 'Villiers Road Southsea, PO5 2HG'
function addressFromNesbitsSlug(slug) {
  const parts = (slug || '').split('-').filter(Boolean);
  if (parts.length < 3) return '';
  const incode = parts[parts.length - 1];      // e.g. 2hg
  const outcode = parts[parts.length - 2];     // e.g. po5 / po12
  if (!/^\d[a-z]{2}$/i.test(incode)) return '';
  if (!/^[a-z]{1,2}\d{1,2}[a-z]?$/i.test(outcode)) return '';
  const postcode = `${outcode.toUpperCase()} ${incode.toUpperCase()}`;
  const words = parts.slice(0, -2);
  if (words.length === 0) return '';
  const street = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return `${street}, ${postcode}`;
}

// Bond Wolfe (major West-Midlands auctioneer, hundreds of lots/sale) runs a
// WordPress catalogue whose lots load via a "Load more" button (admin-ajax) —
// not in the initial HTML and not via ?page=N. The Crawlee render clicks
// "Load more" to exhaustion (lib/scraper/crawlee.js CLICK_TO_LOAD_SELECTORS), so
// every PropertyCard lands in the rendered HTML → turndown markdown. The site is
// behind Cloudflare with a JS-injected ajax nonce, so a plain-HTTP API consumer
// is impossible (HTTP 403/"-1"); the rendered browser path is the only way in.
// Each card becomes one markdown link wrapping: an image, an `##### {address}`
// heading, the type tagline, type/vacancy badges, a `#### £{guide}` heading and
// "Auction: {date}", closed by `](/auctions/properties/{id}-{town}/)`. Images
// are real (EIG-AMS CDN, cdn.eigpropertyauctions.co.uk). Verified live
// 2026-06-13: 88 lots, ~100% address/postcode/image coverage.
export function recogniseBondwolfeLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;
  const unescape = (s) => String(s || '').replace(/\\(.)/g, '$1');
  // Anchor each card's close on the LOT url (/auctions/properties/{id}-...): the
  // nested image link ![alt](cdn…) closes on a cdn URL, so the lazy content
  // capture correctly skips it and stops at the lot link.
  const CARD_RE = /\[([\s\S]*?)\]\((https?:\/\/(?:www\.)?bondwolfe\.com\/auctions\/properties\/(\d+)-[^)]*)\)/gi;
  for (const m of markdown.matchAll(CARD_RE)) {
    const content = m[1] || '';
    const detailUrl = m[2];
    const id = m[3];
    if (!id || lots.has(id)) continue;

    // Address — the first heading that isn't the £-price heading.
    let address = '';
    for (const h of content.matchAll(/#{2,6}\s+([^\n]+)/g)) {
      const t = unescape(h[1]).replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
      if (t && !/£|guide price/i.test(t)) { address = t; break; }
    }
    if (!address || address.length < 5) continue;

    const imgMatch = content.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/);
    const image_url = imgMatch ? imgMatch[1] : '';

    const priceMatch = content.match(/£\s*([\d,]+)/);
    const guide_price = priceMatch ? `£${priceMatch[1]}` : '';

    const blob = content.toLowerCase();
    const property_type = /commercial|retail|office|industrial|mixed use/.test(blob) ? 'commercial'
      : /residential|bedroom|flat|house|bungalow|terrace|maisonette|\bland\b|\bplot\b/.test(blob) ? 'residential' : '';
    const bedMatch = content.match(/(\d+)\s*bed/i);
    const bedrooms = bedMatch ? parseInt(bedMatch[1], 10) : null;

    // Status — the upcoming-catalogue listing is available lots; only downgrade
    // on an explicit badge AND when no guide price is shown (available lots
    // always carry a guide). This mirrors the AuctionHouse recogniser and never
    // persists a sold/withdrawn lot as available (the 2026-06-13 failure mode).
    let lot_status = 'available';
    if (!guide_price) {
      if (/\bwithdrawn\b|\bpostponed\b/i.test(content)) lot_status = 'withdrawn';
      else if (/\bunsold\b|\bnot\s*sold\b|\bpassed\b/i.test(content)) lot_status = 'unsold';
      else if (/\bsold\b/i.test(content)) lot_status = 'sold';
    }

    const bullets = [];
    if (bedrooms) bullets.push(`${bedrooms} bedroom`);
    if (/vacant/i.test(content)) bullets.push('Vacant');

    lots.set(id, {
      lot_number: null,
      address,
      guide_price,
      property_type,
      bedrooms,
      tenure: '',
      image_url,
      detail_url: detailUrl,
      description: '',
      bullets,
      lot_status,
    });
  }
  return lots;
}

// Purplebricks / GOTO Properties (gotoproperties.co.uk) — EIG OAS platform,
// SERVER-RENDERED. `?pagesize=5000` ships the WHOLE catalogue (~2,867 lots) in
// one static fetch WITH inline addresses/prices. Forcing a browser render broke
// it (0 lots since mid-June → circuit open) — the same failure mode as
// btgeddisons, so it's fetched via plain HTTP (staticCatalogue) and parsed here.
// Each card: `[![Primary Lot Photo](cdn.eig…)](…/lot/details/{id})` then
// `[ ### {address} ](…/lot/details/{id})` then `#### **{descriptor}**` and
// `#### Minimum Opening Bid: **£N**`. Anchor on the address link (the H3 inside
// the lot-detail link); the image link precedes it, price/descriptor follow.
export function recognisePurplebricksGotoLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;
  const unescape = (s) => String(s || '').replace(/\\(.)/g, '$1');
  const ADDR_RE = /\[\s*###\s+([^\]]+?)\s*\]\(https?:\/\/(?:www\.)?purplebricks\.gotoproperties\.co\.uk\/lot\/details\/(\d+)\)/gi;
  const ms = [...markdown.matchAll(ADDR_RE)];
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    const id = m[2];
    if (lots.has(id)) continue;
    const address = unescape(m[1]).replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
    if (!address || address.length < 5) continue;

    // Image: the EIG CDN photo sits between the PREVIOUS card's address link and
    // this one — so scope the look-back to that window and take the last match.
    const prevEnd = i > 0 ? ms[i - 1].index + ms[i - 1][0].length : 0;
    const before = markdown.slice(prevEnd, m.index);
    const imgs = [...before.matchAll(/!\[[^\]]*\]\((https:\/\/cdn\.eigpropertyauctions\.co\.uk\/[^\s)]+)\)/g)];
    const image_url = imgs.length ? imgs[imgs.length - 1][1] : '';

    // Forward block (this address link → next card) holds descriptor + price.
    const blockEnd = (i + 1 < ms.length) ? ms[i + 1].index : Math.min(markdown.length, m.index + 2500);
    const block = markdown.slice(m.index, blockEnd);

    const pm = block.match(/(?:Minimum Opening Bid|Guide Price|Starting Bid)[^£]*\*\*\s*(£[\d,]+\+?)/i) || block.match(/£\s*([\d,]{3,})/);
    const guide_price = pm ? (pm[1].startsWith('£') ? pm[1] : `£${pm[1]}`) : '';

    const descMatch = block.match(/####\s*\*{0,2}\s*([^\n*][^\n]*?)\s*\*{0,2}\s*\n/);
    const descriptor = descMatch ? unescape(descMatch[1]).trim() : '';
    const blob = (descriptor + ' ' + block).toLowerCase();
    const property_type = /\b(flat|apartment|maisonette|studio)\b/.test(blob) ? 'flat'
      : /\bbungalow\b/.test(blob) ? 'bungalow'
      : /\b(house|terrace|semi-detached|detached)\b/.test(blob) ? 'house'
      : /\b(land|plot|building plot|\bsite\b)\b/.test(blob) ? 'land'
      : /\b(commercial|office|retail|industrial|warehouse)\b/.test(blob) ? 'commercial' : '';
    const bedMatch = blob.match(/(\d+)\s*bed(?:room)?/i);
    const bedrooms = bedMatch ? parseInt(bedMatch[1], 10) : null;

    // Status — listing is available lots; downgrade only on an explicit badge.
    let lot_status = 'available';
    if (/\bwithdrawn\b/i.test(block)) lot_status = 'withdrawn';
    else if (/\bunsold\b|\bnot\s*sold\b/i.test(block)) lot_status = 'unsold';
    else if (/\bsold\b/i.test(descriptor)) lot_status = 'sold';

    const bullets = [];
    if (descriptor) bullets.push(descriptor);
    if (bedrooms) bullets.push(`${bedrooms} bedroom`);

    lots.set(id, {
      lot_number: null,
      address,
      guide_price,
      property_type,
      bedrooms,
      tenure: '',
      image_url,
      detail_url: `https://purplebricks.gotoproperties.co.uk/lot/details/${id}`,
      description: descriptor,
      bullets,
      lot_status,
    });
  }
  return lots;
}

// ═══════════════════════════════════════════════════════════════════════════
// EIG "Online Auction System" (OAS) — shared current-auction recogniser.
//
// ~25 houses run on the EIG OAS: {sub}.eigonlineauctions.com/search, custom
// domains (auction.paulfosh.com, www.landwoodpropertyauctions.com), branch
// subdomains (eastmidlands.townandcountrypropertyauctions.co.uk) and the
// eigpropertyauctions.co.uk/live-stream/auction/{name} embeds. All share:
//   • lot links   /lot/details/{id}   (id NUMERIC or a UUID; may carry
//                                       ?searchToken=… and live on a subdomain)
//   • images      https://cdn.eigpropertyauctions.co.uk/ams/images/{tenant}/…
//   • a per-card LIVE↔ENDED discriminator (verified live 2026-07-08):
//        ENDED → "Auction Ended - DD/MM/YYYY" + "Result: Sold|Unsold|Withdrawn|Postponed"
//        LIVE  → "Available" | "Buy It Now - Available Until: <future>" |
//                "End Time <future>" | "Guide Price" | "Current Bid" + a future date
//
// THE SCOPING PROBLEM this solves: /search returns the FULL ARCHIVE (paulfosh
// "1-50 of 5,223") behind a SIGNED token — raw ?Order=/?auctionId=/?status=
// params are ignored (tested), so we cannot ask the server for "current only".
// Extracting the page naively ships thousands of ENDED lots as live. This
// recogniser is the guard: it emits ONLY live lots (drops every ended card AND
// any card whose parsed auction date is already past), and stamps each live lot
// with its REAL future auction date — so nothing ended can reach get_active_lots
// (which trusts status='available' + auction_date >= today). Paired with the
// live-boundary pagination stop in lib/analysis.js so we never fetch the whole
// archive. Registered for the cluster via resolvePlatformRecogniser().
//
// Card layout VARIES by OAS theme, so this segments by the raw /lot/details/{id}
// URL (present inside the gallery link too, whose text contains `]` and defeats a
// link-bracket regex) and parses each card's block + the image gallery that
// precedes its anchor. Returns Map<id, rawLot> in the normaliseScrapedLot shape.
const EIG_LOT_URL_RE = /\/lot\/details\/([A-Za-z0-9][A-Za-z0-9-]{2,})/g;
const EIG_LOT_URL_ONE = /(https?:\/\/[^\s)]*?\/lot\/details\/[A-Za-z0-9][A-Za-z0-9-]{2,})/;
const EIG_CDN_IMG_RE = /!\[[^\]]*\]\((https:\/\/cdn\.eigpropertyauctions\.co\.uk\/[^\s)]+)\)/g;
const EIG_UK_PC_RE = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/;
// Ended markers (structural, not prose). "View Result" + "Result:" appear ONLY on
// concluded lots (live lots render "View Details"/"View Lot" and no result). The
// `[\s#*]*` tolerance spans the markdown noise between "Result:" and the status
// word (headings + bold: `#### Result:` / `#### **Unsold**`), which the earlier
// regex missed → landwood ended lots leaked through as live (lot 170612).
const EIG_ENDED_RE = /Auction Ended|View Result|Result:[\s#*]*(?:Sold|Unsold|Withdrawn|Postponed|Not\s*Sold)|\b(?:Under Offer|Sale Agreed)\b/i;
const EIG_MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

// Parse a DD/MM/YYYY or "9th July 2026" date out of a card block → ISO or ''.
function eigParseDate(text) {
  let m = String(text || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = String(text || '').match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (m) { const mo = EIG_MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) return `${m[3]}-${mo}-${String(m[1]).padStart(2, '0')}`; }
  return '';
}

/**
 * Shared EIG OAS recogniser — returns ONLY currently-live lots (drops ended).
 * @param {string} markdown - recognition markdown (htmlToRecognitionMarkdown)
 * @param {string} [todayIso] - 'YYYY-MM-DD' (injectable for tests; defaults today)
 * @returns {Map<string, object>} keyed by lot id, in the normaliseScrapedLot shape
 */
export function recogniseEigOasLotsFromMarkdown(markdown, todayIso) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const clean = (s) => String(s || '').replace(/\\(.)/g, '$1').replace(/\*\*/g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

  // Ordered first-index of every distinct lot id (raw URL match — catches the
  // gallery-link occurrence that a [text](url) regex misses).
  const firstIdx = new Map();
  for (const m of markdown.matchAll(EIG_LOT_URL_RE)) { if (!firstIdx.has(m[1])) firstIdx.set(m[1], m.index); }
  if (!firstIdx.size) return lots;
  const ordered = [...firstIdx.entries()].sort((a, b) => a[1] - b[1]);

  // ── Card boundaries: header-to-header, NOT anchor-to-anchor. ──
  // CRITICAL (fixed 2026-07-21): EIG renders a card's metadata header
  // ("### Lot 136 | End Time - 24/07/2026 13:00") ABOVE that card's lot anchor.
  // Slicing anchor[i] → anchor[i+1] therefore handed every card the FOLLOWING
  // card's end-date, status badge and lot number, and left the LAST card of a
  // catalogue with no date at all (→ the 2099-12-31 sentinel). An off-by-one
  // across all ~26 EIG-OAS houses: higginsdrysdale read 0 live because its one
  // genuinely-live lot inherited the next card's "Auction Ended".
  // Each block now starts at the card's OWN header (only when that header sits
  // after the previous anchor and close enough to be this card's, never an
  // earlier one) and stops before the NEXT card's header, so a card owns exactly
  // its own metadata. Themes that emit no "Lot N" header fall back to the
  // original anchor slicing byte-for-byte.
  const headerIdxs = [...markdown.matchAll(/^#{1,6}\s*Lot\s+\d+\b[^\n]*$/gim)].map(m => m.index);
  const HEADER_LOOKBACK = 2000; // a card's own header sits just above its anchor
  const ownHeaderFor = (prevAnchor, start) => {
    let found = -1;
    for (const idx of headerIdxs) {
      if (idx > start) break;
      if (idx > prevAnchor && start - idx <= HEADER_LOOKBACK) found = idx;
    }
    return found;
  };
  const nextHeaderAfter = (pos) => { for (const idx of headerIdxs) { if (idx > pos) return idx; } return -1; };

  for (let i = 0; i < ordered.length; i++) {
    const [id, start] = ordered[i];
    const prevAnchor = i > 0 ? ordered[i - 1][1] : -1;
    const nextAnchor = i + 1 < ordered.length ? ordered[i + 1][1] : Math.min(markdown.length, start + 4000);
    const ownHeader = ownHeaderFor(prevAnchor, start);
    const nextHeader = nextHeaderAfter(start);
    const cardStart = ownHeader >= 0 ? ownHeader : start;
    const end = (nextHeader >= 0 && nextHeader < nextAnchor) ? nextHeader : nextAnchor;
    const block = markdown.slice(cardStart, end);
    const backWindow = markdown.slice(i > 0 ? ordered[i - 1][1] : 0, start); // gallery precedes the anchor
    const flat = block.replace(/\s+/g, ' ');

    // ── LIVE↔ENDED guard #1: explicit ended markers → drop. ──
    if (EIG_ENDED_RE.test(flat)) continue;

    // ── LIVE↔ENDED guard #2: a parsed date already in the past → drop. ──
    // (A live lot always ends in the future; a past date means the auction closed
    //  even if the ended badge wasn't captured.) No date → keep (rely on #1).
    const auctionDate = eigParseDate(flat);
    if (auctionDate && auctionDate < today) continue;

    // Address — a heading with a UK postcode, else the first postcode-bearing
    // line that isn't obviously a status/price/lot-meta line.
    let address = '';
    for (const hm of block.matchAll(/^#{2,4}\s*(.+)$/gm)) { const t = clean(hm[1]); if (EIG_UK_PC_RE.test(t)) { address = t; break; } }
    if (!address) {
      const line = block.split('\n').map(clean).filter(Boolean)
        .find(l => EIG_UK_PC_RE.test(l) && l.length < 140 && !/\b(lot\s*\d|auction|guide|current bid|buy it now|available until|bedroom|bathroom)\b/i.test(l));
      if (line) address = line;
    }
    if (!address || address.length < 6) continue; // no trustworthy address → skip

    // Guide / buy-it-now / current-bid price.
    const pm = flat.match(/(?:Guide(?:\s*Price)?|Buy\s*it\s*Now|Starting\s*Bid|Current\s*Bid|Opening\s*Bid)[^£]{0,25}£\s*([\d,]{3,})/i)
      || flat.match(/£\s*([\d,]{4,})/);
    const guide_price = pm ? `£${pm[1].replace(/[^\d,]/g, '')}` : '';

    // ── LIVE↔ENDED guard #3: require a POSITIVE live signal. ──
    // Absence of an ended badge is NOT enough — some OAS themes render a concluded
    // lot as a bare address + description with no badge (landwood /lot/details/170612:
    // no date, no price, no status → it is NOT live). A genuinely-live lot always
    // carries a future auction date OR an explicit live-status token OR a guide
    // price. Requiring one of those makes "live" affirmative, closing the leak
    // while preserving recall (every live card observed has ≥1 of these).
    const hasFutureDate = auctionDate && auctionDate >= today;
    const hasLiveToken = /\b(?:Available|Buy\s*it\s*Now|Guide\s*Price|Current\s*Bid|Starting\s*Bid|Opening\s*Bid|For\s*Sale|End\s*Time|Auction\s*Ends|Available\s*Until|Bidding\s*Opens?)\b/i.test(flat);
    if (!hasFutureDate && !hasLiveToken && !guide_price) continue;

    // Image — first real EIG-CDN photo (skip logos/oas-chrome/svg). Gallery sits
    // in the backward window; fall back to the forward block.
    const isPhoto = (u) => /\/auction\/\d+\/\d+_web/i.test(u) && !/logo|\/oas\/|\.svg/i.test(u);
    let image_url = '';
    for (const im of backWindow.matchAll(EIG_CDN_IMG_RE)) { if (isPhoto(im[1])) { image_url = im[1].split('?')[0]; break; } }
    if (!image_url) for (const im of block.matchAll(EIG_CDN_IMG_RE)) { if (isPhoto(im[1])) { image_url = im[1].split('?')[0]; break; } }

    // Beds / tenure / property type / lot number / bullets.
    const bedM = flat.match(/(\d{1,2})\s*bed(?:room)?/i);
    const bedrooms = bedM ? parseInt(bedM[1], 10) : null;
    const tenure = /\bfreehold\b/i.test(flat) ? (/\bshare of freehold\b/i.test(flat) ? 'Share of Freehold' : 'Freehold')
      : /\bleasehold\b/i.test(flat) ? 'Leasehold' : '';
    const blob = flat.toLowerCase();
    const property_type = /\b(flat|apartment|maisonette|studio)\b/.test(blob) ? 'flat'
      : /\bbungalow\b/.test(blob) ? 'bungalow'
      : /\b(house|terrace|semi-detached|detached|cottage)\b/.test(blob) ? 'house'
      : /\b(land|plot|building plot|\bsite\b|paddock)\b/.test(blob) ? 'land'
      : /\b(commercial|office|retail|industrial|warehouse|garage|workshop)\b/.test(blob) ? 'commercial' : '';
    const lnM = flat.match(/\bLot\s+(\d+)\b/i);
    const bullets = [...block.matchAll(/^[-*]\s+(.+)$/gm)].map(b => clean(b[1])).filter(b => b && b.length > 2 && !/^\[/.test(b)).slice(0, 8);

    // Clean detail URL: keep host + path, drop the (signed, per-scrape) query.
    const urlM = block.match(EIG_LOT_URL_ONE);
    const detail_url = urlM ? urlM[1].split('?')[0] : '';

    lots.set(id, {
      lot_number: lnM ? lnM[1] : null,
      address,
      guide_price,
      property_type,
      bedrooms,
      tenure,
      image_url,
      detail_url,
      description: bullets[0] || '',
      bullets,
      lot_status: 'available',
      auction_date: auctionDate || '',
    });
  }
  return lots;
}

// ── Future Property Auctions — classic ASP site, fully server-rendered ──
// A rolling timed-online catalogue (749 entries, all `Available`) paginated by
// `?offset=N` in steps of 21. The house had NO recogniser and depended on the AI
// extractor (quota-dead most of the month), so it went dark despite a healthy,
// complete, static catalogue.
//
// Card shape (turndown markdown) — the type heading is a reliable 1:1 anchor
// (21 ids = 21 headings = 21 address links on every page):
//     [
//     Lot 2
//     £230,000 *OPENING BID*
//     ![](http://…/upload/43917_…_IMG_00.jpg)      ← photo, served over HTTP
//     ](…/property_details.asp?id=14509279)
//     #### [2 Bedroom  Flat](…/property_details.asp?id=14509279)   ← ANCHOR
//     [12 Leslie Place, Flat 2, Stockbridge, Edinburgh](https://maps.google.com/…)
//     -   **Timed Online Auction** - 16 Jul 2026
//
// So price / lot-number / photo sit BEFORE the anchor and address / auction-date
// AFTER it. The address is only ever the text of a maps.google.com link.
//
// Photos are served over plain HTTP; the frontend is HTTPS-only and
// routes/search.js::isValidImageUrl strips `http://`, so they are upgraded here —
// the documented `mixed_content_http_images` class this house hit in April.
const FPA_HEAD_RE = /^#{3,4}\s*\[([^\]]+)\]\((https?:\/\/[^)]*property_details\.asp\?id=(\d+))\)/gmi;
const FPA_MAPS_ADDR_RE = /\[([^\]]+)\]\(https?:\/\/maps\.google\.com[^)]*\)/i;
const FPA_IMG_RE = /!\[[^\]]*\]\((https?:\/\/[^\s)]*\/upload\/[^\s)]+)\)/gi;
const FPA_MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

export function recogniseFutureAuctionsLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;
  const clean = (s) => String(s || '').replace(/\\+/g, '').replace(/\*\*/g, '')
    .replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

  const heads = [...markdown.matchAll(FPA_HEAD_RE)];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const id = h[3];
    if (lots.has(id)) continue;

    // Price / lot number / photo precede the anchor; address / date follow it.
    const preStart = i > 0 ? heads[i - 1].index + heads[i - 1][0].length : 0;
    const pre = markdown.slice(preStart, h.index);
    const post = markdown.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : Math.min(markdown.length, h.index + 1600));
    // `pre` also holds the PREVIOUS lot's tail (its address, date and links), so it
    // must never feed classification — "Land & Plot" was being typed as a `flat`
    // because the preceding lot's address contained "Flat 2, Stockbridge". Only the
    // heading + this lot's own trailing block describe THIS lot.
    const own = (h[1] + ' ' + post).replace(/\s+/g, ' ');

    const am = post.match(FPA_MAPS_ADDR_RE);
    const address = am ? clean(am[1]) : '';
    if (!address || address.length < 6) continue;

    // The LAST match in `pre` belongs to THIS lot — the previous lot's tail carries
    // only its address, date and links, never a Lot number, price or photo.
    const lotNums = [...pre.matchAll(/\bLot\s+(\d+[A-Za-z]?)\b/gi)];
    const prices = [...pre.matchAll(/£\s*([\d,]{3,})/g)];
    const imgs = [...pre.matchAll(FPA_IMG_RE)];
    const guide_price = prices.length ? `£${prices[prices.length - 1][1]}` : '';
    const image_url = imgs.length ? imgs[imgs.length - 1][1].replace(/^http:\/\//i, 'https://') : '';

    // "**Timed Online Auction** - 16 Jul 2026"
    let auction_date = '';
    const dm = post.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (dm) { const mo = FPA_MONTHS[dm[2].slice(0, 3).toLowerCase()]; if (mo) auction_date = `${dm[3]}-${mo}-${String(dm[1]).padStart(2, '0')}`; }

    const lot_status = /\bWithdrawn\b/i.test(own) ? 'withdrawn'
      : /\bUnder Offer\b/i.test(own) ? 'stc'
      : /\bSold\b/i.test(own) ? 'sold'
      : 'available';

    // The heading IS the property type ("2 Bedroom Flat", "Land & Plot"). Classify
    // from it ALONE: including the surrounding text mis-typed "Land & Plot" as a
    // flat, because the preceding lot's address read "…Flat 2, Stockbridge…".
    const typeText = clean(h[1]);
    const blob = typeText.toLowerCase();
    const property_type = /\b(land|plot|site|ground)\b/.test(blob) ? 'land'
      : /\b(flat|apartment|maisonette|studio)\b/.test(blob) ? 'flat'
      : /\bbungalow\b/.test(blob) ? 'bungalow'
      : /\b(commercial|office|retail|shop|industrial)\b/.test(blob) ? 'commercial'
      : /\b(house|terrace|semi|detached|cottage)\b/.test(blob) ? 'house' : '';
    const bedM = typeText.match(/(\d{1,2})\s*bed(?:room)?/i);

    lots.set(id, {
      lot_number: lotNums.length ? lotNums[lotNums.length - 1][1] : null,
      address,
      guide_price,
      property_type,
      bedrooms: bedM ? parseInt(bedM[1], 10) : null,
      tenure: /\bfreehold\b/i.test(own) ? 'Freehold' : /\bleasehold\b/i.test(own) ? 'Leasehold' : '',
      image_url,
      detail_url: h[2],
      description: typeText,
      bullets: typeText ? [typeText] : [],
      lot_status,
      auction_date,
    });
  }
  return lots;
}

// ═══════════════════════════════════════════════════════════════════════════
// Bamboo Auctions platform — shared recogniser ({house}.bambooauctions.com)
//
// ~8 houses run on Bamboo (hunters, lsk, rendells, 247propertyauctions, webbers,
// howkinsandharrison, hawkesford, fisherGerman). It's a Next.js SSR app: a plain
// HTTP fetch returns every card, so none of these houses need a browser render —
// yet none had a recogniser, so they all leaned on the AI extractor and went dark
// whenever the AI quota died.
//
// Each card is ONE big link whose TEXT holds the content and whose URL closes it:
//   [
//   ![{address}](…/_next/image?url=…cdn.bambooauctions.com%2Fproperty%2Fimg%2F…)  ← photo
//   Traditional                                                    ← sale type
//   SOLD                     |  Ends in / 12d / 3h / 30m / 36s     ← STATUS vs countdown
//   ### {address}
//   {short address}
//   ![{house} logo](…bamboo-cdn…)                                  ← LOGO — must be skipped
//   £100,000
//   Land
//   ](https://{house}.bambooauctions.com/property/{slug-id})       ← anchor
//
// ANTI-LEAK: most Bamboo cards are SOLD-prior (howkinsandharrison 18 of 20,
// rendells 13 of 14). The AI extractor infers status and smears them as
// `available`; this parses the badge deterministically so a sold lot is never
// persisted as live.
// Capture the WHOLE url, then derive the id with the SAME pattern the platform
// recall sentinel uses (detectPlatformSentinel → /\/property\/([a-z0-9_-]{6,})/gi),
// so the recogniser's Map keys line up with the sentinel's ids in crawlee-extract's
// recovery merge. Slugs may contain a DOT ("…-bodwen-st.-austell-cornwall-123") —
// an id-shaped anchor class stops at the dot, the closing `)` then never matches,
// and the whole card is silently dropped (webbers lost 3 of 19 that way).
const BAMBOO_ANCHOR_RE = /\]\((https:\/\/[^)\s]*?\.bambooauctions\.com\/property\/[^)\s]+)\)/gi;
const BAMBOO_ID_RE = /\/property\/([a-z0-9_-]{6,})/i;
const BAMBOO_IMG_RE = /!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g;

export function recogniseBambooLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;
  const clean = (s) => String(s || '').replace(/\\+/g, '').replace(/\*\*/g, '')
    .replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

  const anchors = [...markdown.matchAll(BAMBOO_ANCHOR_RE)];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const id = (a[1].match(BAMBOO_ID_RE) || [])[1];
    if (!id || lots.has(id)) continue;
    // The card's content PRECEDES its closing anchor.
    const start = i === 0 ? 0 : anchors[i - 1].index + anchors[i - 1][0].length;
    const block = markdown.slice(start, a.index);
    const flat = block.replace(/\s+/g, ' ');

    // Address. The `### heading` is often only a SHORT TITLE ("The Downs") while the
    // plain line immediately after it carries the full postal address ("The Downs,
    // Newton Abbot, TQ12 6AF"). Prefer whichever bears a UK postcode — picking the
    // heading blindly made normaliseScrapedLot reject 18 of hunters' 20 lots as
    // non-addresses (a silent 90% recall loss).
    const hM = block.match(/^###\s+(.+)$/m);
    const heading = hM ? clean(hM[1]) : '';
    let subline = '';
    if (hM) {
      const after = block.slice(hM.index + hM[0].length);
      for (const line of after.split('\n')) {
        const t = clean(line);
        if (!t || /^!\[/.test(line.trim()) || /^#{1,6}\s/.test(line) || /^[£\\-]/.test(t)) continue;
        subline = t;
        break;
      }
    }
    const hasPc = (s) => EIG_UK_PC_RE.test(s);
    const address = hasPc(subline) ? subline
      : hasPc(heading) ? heading
      : (subline.length > heading.length ? subline : heading);
    if (!address || address.length < 5) continue;

    // Status badge. `Ends in` (a live countdown) or `Accepting Offers` = available.
    const lot_status = /\bSOLD\b/i.test(flat) ? 'sold'
      : /\bWithdrawn\b/i.test(flat) ? 'withdrawn'
      : /\bUnsold\b/i.test(flat) ? 'unsold'
      : /Auction\s+Ended|\bEnded\b/i.test(flat) ? 'unsold'
      : 'available';

    const pM = flat.match(/£\s*([\d,]{3,})/);
    const guide_price = pM ? `£${pM[1]}` : '';

    // Photo = the first image whose ALT is not the house logo. Bamboo renders the
    // agent's logo as a second image inside every card (alt "{house} logo").
    let image_url = '';
    for (const im of block.matchAll(BAMBOO_IMG_RE)) {
      if (/\blogo\s*$/i.test(im[1] || '')) continue;
      image_url = im[2];
      break;
    }

    const blob = flat.toLowerCase();
    const property_type = /\b(flat|apartment|maisonette)\b/.test(blob) ? 'flat'
      : /\bbungalow\b/.test(blob) ? 'bungalow'
      : /\bland\b/.test(blob) ? 'land'
      : /\b(commercial|office|retail|industrial)\b/.test(blob) ? 'commercial'
      : /\b(house|terrace|semi|detached|residential)\b/.test(blob) ? 'house' : '';
    const bedM = flat.match(/(\d{1,2})\s*bed(?:room)?/i);

    lots.set(id, {
      lot_number: null, // Bamboo cards carry no lot number
      address,
      guide_price,
      property_type,
      bedrooms: bedM ? parseInt(bedM[1], 10) : null,
      tenure: /\bfreehold\b/i.test(flat) ? 'Freehold' : /\bleasehold\b/i.test(flat) ? 'Leasehold' : '',
      image_url,
      detail_url: a[1],
      description: '',
      bullets: [],
      lot_status,
    });
  }
  return lots;
}

// ── Sutton Kersh — own PHP gallery, fully server-rendered, plain HTTP ──
// The catalogue paginates 16-per-page by default, but `?perPage=all` returns the
// WHOLE current auction (97 lots, 211KB) in ONE static fetch. The house had no
// recogniser and leaned on the AI extractor, so it went dark whenever the AI
// quota died — a deterministic parse removes that dependency entirely.
//
// Card shape (turndown markdown):
//   [![](…/image_crop.php?filename=…_web_medium.jpg…)](…/properties/lot/{id}/)  ← photo
//   ![Video Tour](…)  ×
//   # [{address}\\
//   ](…/properties/lot/{id}/)                                                   ← H1 anchor
//   ## [Guide Price: £225,000+ \*](…/properties/lot/{id}/)
//   **Lot: 1**
//   VACANT RESIDENTIAL                                                          ← descriptor
//
// The current-auction page includes SOLD-prior + WITHDRAWN lots, so status is
// parsed per card — a sold lot must never persist as `available`.
const SK_CARD_RE = /^#\s+\[([^\]]+)\]\((https?:\/\/(?:www\.)?suttonkersh\.co\.uk\/properties\/lot\/(\d+)\/?)\)/gm;
const SK_IMG_RE = /!\[[^\]]*\]\((https?:\/\/(?:www\.)?suttonkersh\.co\.uk\/image_crop\.php\?[^\s)]+)\)/g;

export function recogniseSuttonKershLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;
  // Drop backslashes outright (keeping the char they escape): the H1 link text ends
  // with turndown's `\\` hard-break idiom followed by a NEWLINE, and a `/\\(.)/`
  // unescape leaves a stray `\` behind because `.` never matches `\n`. Addresses and
  // descriptors never legitimately contain a backslash.
  const clean = (s) => String(s || '').replace(/\\+/g, '').replace(/\*\*/g, '')
    .replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

  const ms = [...markdown.matchAll(SK_CARD_RE)];
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    const id = m[3];
    if (lots.has(id)) continue;
    const address = clean(m[1]);
    if (!address || address.length < 6) continue;

    const blockEnd = (i + 1 < ms.length) ? ms[i + 1].index : Math.min(markdown.length, m.index + 2000);
    const block = markdown.slice(m.index, blockEnd);
    const flat = block.replace(/\s+/g, ' ');

    // Status — SOLD-prior / withdrawn lots sit alongside available ones.
    const lot_status = /\bWithdrawn\b/i.test(flat) ? 'withdrawn'
      : /\bSold\b/i.test(flat) ? 'sold'
      : 'available';

    const pm = flat.match(/Guide Price:\s*(£[\d,]+)/i);
    const guide_price = pm ? pm[1] : '';

    // Photo sits in the link immediately BEFORE the H1 anchor.
    const prevEnd = i > 0 ? ms[i - 1].index + ms[i - 1][0].length : 0;
    const before = markdown.slice(prevEnd, m.index);
    const imgs = [...before.matchAll(SK_IMG_RE)];
    const image_url = imgs.length ? imgs[imgs.length - 1][1] : '';

    const lnM = flat.match(/\bLot:\s*(\d+[A-Za-z]?)\b/i);
    // Descriptor line after `**Lot: N**` (e.g. "VACANT RESIDENTIAL").
    const dM = block.match(/\*\*Lot:\s*[\dA-Za-z]+\*\*\s*\n+\s*([^\n[*]{3,80})/);
    const descriptor = dM ? clean(dM[1]) : '';
    const blob = flat.toLowerCase();
    const property_type = /\b(flat|apartment|maisonette|studio)\b/.test(blob) ? 'flat'
      : /\bbungalow\b/.test(blob) ? 'bungalow'
      : /\b(land|plot|site)\b/.test(blob) ? 'land'
      : /\b(commercial|office|retail|shop|industrial)\b/.test(blob) ? 'commercial'
      : /\b(house|terrace|semi|detached|residential)\b/.test(blob) ? 'house' : '';
    const bedM = flat.match(/(\d{1,2})\s*bed(?:room)?/i);

    lots.set(id, {
      lot_number: lnM ? lnM[1] : null,
      address,
      guide_price,
      property_type,
      bedrooms: bedM ? parseInt(bedM[1], 10) : null,
      tenure: /\bfreehold\b/i.test(flat) ? 'Freehold' : /\bleasehold\b/i.test(flat) ? 'Leasehold' : '',
      image_url,
      detail_url: m[2],
      description: descriptor,
      bullets: descriptor ? [descriptor] : [],
      lot_status,
    });
  }
  return lots;
}

// ── Sequence / Connells branch catalogues — ONE shared static HTML template ──
// Bagshaws Residential, Fox & Sons and William H Brown (Norwich) are all Sequence
// (Connells group) auction branches, and all three serve the SAME hand-maintained
// table-layout XHTML page (no CMS, no JS, ~20KB). Each branch lists only ITS OWN
// regional lots out of the group's shared national sale, hosted on
// barnardmarcusauctions.co.uk:
//   /auctions/{DD-month-YYYY}/{lotId}/
// The lot-id namespaces are disjoint per branch (verified 2026-07-22: zero URL
// overlap in `lots` across the three slugs and barnardmarcus itself), so these are
// genuinely distinct catalogues — NOT duplicate brand-fronts of the kind retired in
// RETIRED_HOUSES. Barnard Marcus's own catalogue is the London sale and shares no
// lot with them.
//
// All three had NO recogniser and depended entirely on the AI extractor, which is
// the `ai_only_freshness_rot` failure mode: the last good AI pass got most lots,
// every pass since produced junk rows (address-less, url = the catalogue root, the
// page LOGO as the image, or a lot fabricated from the office address in the page
// footer), so the real lots aged out of get_active_lots' 7-day freshness window and
// the houses went dark. One plain-HTTP fetch parses all of them deterministically.
//
// Recall verified against the live pages 2026-07-22, counted as SURVIVORS of
// normaliseScrapedLot (not regex hits): foxandsons 21/21, bagshaws 23/23,
// williamhbrownnorwich 19/19 — 100% of each house's recall sentinel.
//
// Card shape (turndown markdown) — thumbnail block first, then a text block per
// lot, both linking to the SAME lot URL:
//   [![](…/images/auctions/2026/july26/261.jpg)](…/auctions/28-july-2026/707824/)
//   …
//   **[Lot 261](…/auctions/28-july-2026/707824/)**\\
//   8, Lime Avenue, DERBY,\\
//   Derbyshire,\\
//   DE1 1TU\\
//   Guide: £185,000
//
// Three things the parse must get right:
//   1. STATUS — a sold lot carries `**Sold Prior**` where the guide line would
//      be (lot 274 on the 28 Jul 2026 sale). It must never persist as available.
//   2. AUCTION DATE — the sale date is in the lot URL slug (`28-july-2026`).
//      Stamping it is what makes the house expire correctly: the house's only
//      auction_calendar row is a `2099-12-31` always_on placeholder, which would
//      otherwise keep every lot "live" forever after the hammer falls.
//   3. BROKEN ANCHOR — one lot's text link is `href="link"` (a hand-editing
//      typo). Its thumbnail link is intact, and the thumbnail's basename IS the
//      lot number (`257.jpg` → Lot 257), so the URL + photo are recovered from
//      there rather than dropping the lot.
const SEQ_LOT_ANCHOR_RE = /\*\*\[\s*Lot\s+(\d+[A-Za-z]?)\s*\]\(([^)\s]*)\)\*\*/gi;
// Thumbnail: a linked image. Kept only when the link target is a lot URL, which
// excludes the page logo / award / Sequence footer images.
const SEQ_THUMB_RE = /\[!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)\]\((https?:\/\/[^\s)]+)\)/g;
// Sequence-group lot URL: /auctions/{DD-month-YYYY}/{id}/ — host-agnostic so the
// group's other landing hosts keep working. Group 1 = date slug, 2 = lot id.
const SEQ_LOT_URL_RE = /\/auctions\/(\d{1,2}-[a-z]+-\d{4})\/(\d{3,})\/?(?:[?#]|$)/i;
// Status annotations replace the guide line on a non-live card. The vocabulary
// spans every phrasing seen across the three branches ("Sold Prior", "Withdrawn",
// "Under Offer", "Sale Agreed", "Not Sold"), because a status line that isn't
// recognised falls through to the address and the lot ships as `available`.
const SEQ_STATUS_LINE_RE = /^\**\s*(sold|withdrawn|postponed|unsold|available|not\s+sold|under\s+offer|sale\s+agreed)\b/i;
const SEQ_GUIDE_LINE_RE = /^\**\s*guide\b/i;

// '28-july-2026' → '2026-07-28'. '' when the slug isn't a real date.
function sequenceSlugDate(slug) {
  const m = /^(\d{1,2})-([a-z]{3,9})-(\d{4})$/i.exec(slug || '');
  if (!m) return '';
  const mo = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }[m[2].slice(0, 3).toLowerCase()];
  const day = parseInt(m[1], 10);
  if (!mo || !(day >= 1 && day <= 31)) return '';
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parse a Sequence/Connells branch catalogue page (Bagshaws Residential,
 * Fox & Sons, William H Brown Norwich — one shared template) into raw lots,
 * keyed by the Sequence lot id (the recall sentinel's capture group) so the
 * Crawlee recovery/corroboration path can match them. Falls back to `lot-{n}`
 * when a lot has no resolvable URL, so a lot is never silently dropped.
 *
 * A card whose sale date has PASSED is dropped outright. These "Current Auction"
 * pages keep stale cards around after a sale, and a dropped card is the only
 * correct outcome — do NOT "keep it with its real past date and let a downstream
 * gate hide it", which was tried and reverted 2026-07-22:
 *   - `get_active_lots` does gate on `auction_date >= current_date - 1`, but
 *     `lib/sitemap.js` uses an **OR** (`auction_date.gte.today` OR
 *     `last_seen_at.gte.7d`), so a re-seen past-dated `available` row lands in
 *     the LIVE sitemap cohort and gets submitted to Google as a live listing.
 *   - It could never be retired either: `ghost-sweep` only flips lots UNSEEN for
 *     7+ days, and a card still on the page is re-seen every scrape, so it is
 *     re-stamped `available` forever. Inside `post-auction-sweep`'s 30-day
 *     window the two fight — sweep sets sold/unsold, the next scrape reverts it.
 *   - The "dropping reads as a false recall regression" argument does not apply:
 *     the recall gate runs on the Crawlee and Firecrawl paths only, and these
 *     three houses run the `staticCatalogue` path, which never evaluates it.
 * Stamping the real date on the lots we DO keep is still what makes these houses
 * expire; their auction_calendar row is a 2099-12-31 always_on placeholder that
 * would otherwise keep every lot live forever.
 *
 * @param {string} markdown
 * @param {string} [todayIso] - 'YYYY-MM-DD' (injectable for tests; defaults today)
 * @returns {Map<string, object>}
 */
export function recogniseSequenceBranchLotsFromMarkdown(markdown, todayIso) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;
  const today = todayIso || new Date().toISOString().slice(0, 10);

  const clean = (s) => String(s || '')
    .replace(/\\+/g, '').replace(/\*\*/g, '')
    .replace(/\s+/g, ' ').replace(/\s*,[\s,]*/g, ', ').replace(/[,\s]+$/, '').trim();

  // Thumbnail indexes: by lot id (from the link) and by lot number (from the
  // image basename). The second is what rescues a lot whose text anchor broke.
  const thumbById = new Map();
  const thumbByLotNo = new Map();
  const dateSlugCounts = new Map();
  for (const m of markdown.matchAll(SEQ_THUMB_RE)) {
    const [, imgUrl, href] = m;
    const lm = SEQ_LOT_URL_RE.exec(href);
    if (!lm) continue;
    dateSlugCounts.set(lm[1], (dateSlugCounts.get(lm[1]) || 0) + 1);
    if (!thumbById.has(lm[2])) thumbById.set(lm[2], { imgUrl, href });
    const base = (imgUrl.split('?')[0].split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '').toLowerCase();
    if (base && !thumbByLotNo.has(base)) thumbByLotNo.set(base, { imgUrl, href });
  }
  // Page-level sale date — the slug most lot links agree on.
  let pageDateSlug = '';
  let best = 0;
  for (const [slug, n] of dateSlugCounts) if (n > best) { best = n; pageDateSlug = slug; }
  const pageAuctionDate = sequenceSlugDate(pageDateSlug);

  const anchors = [...markdown.matchAll(SEQ_LOT_ANCHOR_RE)];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const lotNumber = a[1];
    const bodyStart = a.index + a[0].length;
    // The whole card is ONE markdown paragraph — stop at the blank line (or at
    // the next lot anchor, whichever comes first) so an address can never bleed
    // across cards.
    const para = markdown.indexOf('\n\n', bodyStart);
    let end = para === -1 ? markdown.length : para;
    if (i + 1 < anchors.length) end = Math.min(end, anchors[i + 1].index);
    const block = markdown.slice(bodyStart, end);

    const thumb = thumbByLotNo.get(lotNumber.toLowerCase()) || null;
    const anchorOk = SEQ_LOT_URL_RE.test(a[2] || '');
    const detailUrl = anchorOk ? a[2] : (thumb && SEQ_LOT_URL_RE.test(thumb.href) ? thumb.href : '');
    const lm = detailUrl ? SEQ_LOT_URL_RE.exec(detailUrl) : null;
    const id = lm ? lm[2] : `lot-${lotNumber}`;
    if (lots.has(id)) continue;
    const imageUrl = (lm && thumbById.get(lm[2])?.imgUrl) || thumb?.imgUrl || '';

    // ── Live boundary: the sale date is in the lot URL slug (28-july-2026). ──
    // A card left up after its sale is stale page furniture, not a live lot. See
    // the header comment for why hiding it downstream instead does not work.
    const slugDate = lm ? sequenceSlugDate(lm[1]) : '';
    const auctionDate = slugDate || pageAuctionDate;
    if (auctionDate && auctionDate < today) continue;

    // `\\` + newline is turndown's <br> (see lib/scraper/html-to-markdown.js).
    const lines = block.split(/\\+\s*\n\s*/).map(s => s.trim()).filter(Boolean);
    const addressLines = [];
    let guideLine = '';
    let statusLine = '';
    for (const line of lines) {
      if (!guideLine && SEQ_GUIDE_LINE_RE.test(line)) { guideLine = line; continue; }
      if (!statusLine && SEQ_STATUS_LINE_RE.test(line)) { statusLine = line; continue; }
      // Hard stop at any markdown link/image: a card without a guide line must
      // never absorb the following photo row into its address. The paragraph
      // bound above usually gets there first, but this page is hand-edited and
      // a removed blank line would otherwise smear one card into the next.
      if (/^!\[|^\[|\]\(/.test(line)) break;
      addressLines.push(line);
    }
    const address = clean(addressLines.join(', '));
    if (!address || address.length < 6) continue;

    // "Guide: £185,000" → "£185,000". Tolerant of a mangled currency glyph
    // (the page declares UTF-8 but is hand-edited) — anchor on the digits.
    const gm = guideLine ? guideLine.match(/guide[^\d]{0,20}([\d][\d,]{2,})/i) : null;
    const guide_price = gm ? `£${gm[1]}` : '';

    // Order matters: `unsold` / `not sold` MUST be tested before `sold`, because
    // /\bsold\b/ also matches inside "not sold" and would flip an unsold lot to
    // sold. Anything unrecognised stays `available`.
    const st = statusLine.toLowerCase();
    const lot_status = /withdrawn|postponed/.test(st) ? 'withdrawn'
      : /\bunsold\b|\bnot\s+sold\b/.test(st) ? 'unsold'
        : /\bsold\b|\bunder\s+offer\b|\bsale\s+agreed\b/.test(st) ? 'sold'
          : 'available';

    // Coarse type from the address line — the cards carry no type field, but
    // "Plot adj", "Development site" and "Flat 12" are reliable in this template.
    const blob = address.toLowerCase();
    const property_type = /\b(?:development site|building plot|plot|land|paddock)\b/.test(blob) ? 'land'
      : /\b(?:flat|apartment|maisonette)\b/.test(blob) ? 'flat'
        : /\bbungalow\b/.test(blob) ? 'bungalow'
          : '';

    lots.set(id, {
      lot_number: lotNumber,
      address,
      guide_price,
      property_type,
      bedrooms: null,
      tenure: '',
      image_url: imageUrl,
      detail_url: detailUrl,
      description: '',
      // Deliberately NO bullets. The status text is already carried by
      // `lot_status`, and persist-lots resolves the sale date as
      // `bulletDate || _auctionDate || calendarDate` — bullets FIRST — while
      // parseAuctionDateFromBullet matches any bare "DD Month YYYY". A
      // hand-typed status line like "Postponed to 15 September 2026" would
      // therefore silently override the authoritative URL-slug date this whole
      // parse depends on. Redundant signal, real hazard: dropped.
      bullets: [],
      auction_date: auctionDate,
      lot_status,
    });
  }
  return lots;
}

// ── Savills — two-tier Joomla site, fully server-rendered, plain HTTP ──
// /upcoming-auctions is a CALENDAR (auction dates + "N properties for sale" +
// a "View catalogue" link each). The lots live one hop deeper on the dated
// catalogue /auctions/{d[--d]-month-year-{auctionId}} — and that auctionId
// ROTATES every sale, so a pinned calendar URL rots. resolveSavillsCatalogueUrl
// re-derives the live set from the calendar on every scrape.
//
// The catalogue defaults to ~10 lots/page across ~29 pages, but the page size is
// a PATH segment: /page-{n}/quantity-{n}. quantity-100 collapses 288 lots into 3
// static fetches (7.8MB at quantity-500 vs 3.3MB at quantity-100 — the smaller
// pages keep both the 25s fetch timeout and peak RSS well inside budget).
//
// The house had NO recogniser and leaned on the AI extractor, so it went dark
// whenever the AI quota died (500 lots historically → 0 live). Its recall
// sentinel was ALSO broken — the `(?=$|[/?#])` lookahead never matched a lot URL
// inside markdown's `](…)` or HTML's `href="…"`, so recall silently read 0 and
// the gap was never flagged (fixed in recall-sentinels.js).
//
// Card shape (turndown markdown, one `<li class="lot" id="lot-{id}">` each):
//   [![{addr} 2](…/resized/images/w650/lots/…jpeg)](…/auctions/{auc}/{slug}-{id}) ← gallery (×N)
//   1/23                                                                          ← image count
//   Lot 1
//   Guide Price £400,000
//   Your Bid £0
//   Sold Prior                        ← ONLY on sold/withdrawn lots (see anti-leak)
//   [{full address}](…/auctions/{auc}/{slug}-{id})                                ← address anchor
//   -   To be offered on Tuesday 28 July
//   -   {bullets…}
//   Cancel proxy bid [Full details](…/auctions/{auc}/{slug}-{id})                 ← card terminator
//
// Two shapes the parser must survive:
//   • SECTION DIVIDERS — pseudo-lots ("Lot 0", empty address anchor, bullets like
//     "Commercial Section / Lots 200-299"). Their address link is `[](url)`, which
//     the anchor regex rejects; their "Full details" link still closes the card so
//     the divider's "Lot 0 / Guide Price TBA" can never bleed into the next lot.
//   • SOLD PRIOR / WITHDRAWN PRIOR lots sit inline with available ones (9 of 288
//     on the 28–29 July 2026 sale) — status is read from the zone between
//     "Your Bid" and the address anchor so they never persist as `available`.
const SAV_LOT_HREF = 'https?:\\/\\/(?:www\\.)?auctions\\.savills\\.co\\.uk\\/auctions\\/([a-z0-9-]+)\\/([a-z0-9-]*?-(\\d{4,6}))';
// Text link (leading char is not '!' — excludes the image link's inner ![…]).
const SAV_TEXT_LINK = new RegExp(`\\[([^\\]\\n!][^\\]\\n]{0,240})\\]\\((${SAV_LOT_HREF})\\)`, 'gi');
const SAV_IMG_LINK = new RegExp(`\\[!\\[[^\\]]*\\]\\((https?:[^)\\s]+)\\)\\]\\((${SAV_LOT_HREF})\\)`, 'gi');
const SAV_PAGE_SIZE = 100;

/**
 * Tier-1 drill: read the Savills auction CALENDAR and return one page target per
 * upcoming sale. Every currently-published sale is included (the 28–29 July 2026
 * catalogue carried 287 lots while three later sales already carried 19 more —
 * scraping only the soonest would ship 94% and breach the 100% rule).
 *
 * Page targets are derived from the calendar's own "N properties for sale"
 * count: ceil(N / 100) fetches + one headroom page, so the walk can never
 * silently truncate. When the count is absent (Savills omits it on smaller
 * sales) a single quantity-500 page is used instead.
 *
 * Kept on the CALENDAR rather than a pinned catalogue URL because the dated
 * auction id rotates every sale — a stale auction_calendar row must not pin us
 * to a finished auction.
 *
 * @param {string} _baseUrl - incoming catalogue/calendar URL (ignored; the
 *                            calendar is canonical and any pinned dated URL is
 *                            a rotation risk)
 * @param {function(string):Promise<string>} fetchPage - plain-HTTP fetcher (injected)
 * @param {string} [todayIso] - 'YYYY-MM-DD'
 * @returns {Promise<Array<{url:string, auctionDateIso:string}>|null>} null if no upcoming sale
 */
export async function resolveSavillsCatalogueUrl(_baseUrl, fetchPage, todayIso) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  let html;
  try { html = await fetchPage('https://auctions.savills.co.uk/upcoming-auctions'); } catch { return null; }

  // The calendar renders one `upcoming-calendar__row` per sale; the property
  // count precedes the "View catalogue" href inside that row, so split on the
  // row boundary and read each block independently (a global regex pairing
  // count→href across rows would mis-attribute when a count is missing).
  const rows = html.split(/class="upcoming-calendar__row"/i).slice(1);
  const seen = new Set();
  const auctions = [];
  for (const row of rows) {
    const hrefM = /href="(https?:\/\/(?:www\.)?auctions\.savills\.co\.uk\/auctions\/([a-z0-9-]+))"/i.exec(row);
    if (!hrefM) continue;
    const slug = hrefM[2].toLowerCase();
    if (seen.has(slug)) continue;
    const info = parseSavillsAuctionSlug(slug);
    if (!info || info.endIso < today) continue;   // finished sale still on the page
    seen.add(slug);
    const countM = /auction_properties[^>]*>\s*([\d,]+)\s*propert/i.exec(row);
    auctions.push({
      base: `https://auctions.savills.co.uk/auctions/${slug}`,
      endIso: info.endIso,
      count: countM ? parseInt(countM[1].replace(/,/g, ''), 10) : null,
    });
  }
  if (!auctions.length) return null;
  auctions.sort((a, b) => a.endIso.localeCompare(b.endIso));

  const targets = [];
  for (const a of auctions) {
    if (!a.count) {
      // Count unavailable — one wide page still covers any realistic sale
      // (Savills' largest historical catalogue is ~500 lots).
      targets.push({ url: `${a.base}/page-1/quantity-500`, auctionDateIso: a.endIso });
      continue;
    }
    const pages = Math.ceil(a.count / SAV_PAGE_SIZE) + 1;  // +1 headroom: never truncate
    for (let p = 1; p <= pages; p++) {
      targets.push({ url: `${a.base}/page-${p}/quantity-${SAV_PAGE_SIZE}`, auctionDateIso: a.endIso });
    }
  }
  return targets;
}

/**
 * Tier-2 recogniser: parse a Savills dated-catalogue page into raw lots, keyed
 * by lot id. Anchors on the address text link, reads lot number / guide price /
 * status from the preceding block and the photo from the card's own gallery
 * (bound by lot id, so a neighbouring card's image can never bleed).
 * Verified 287/287 on the 28–29 July 2026 sale + 19/19 across the three later
 * sales, live, 2026-07-21.
 */
export function recogniseSavillsLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;
  const clean = (s) => String(s || '').replace(/\\(.)/g, '$1').replace(/\*\*/g, '')
    .replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

  const anchors = [...markdown.matchAll(SAV_TEXT_LINK)];
  let cardStart = 0;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const end = a.index + a[0].length;
    const address = clean(a[1]);
    // "Full details" is the card's terminator, not its address — consuming it
    // as the boundary is what keeps a section divider's fields out of the next
    // real lot.
    if (/^full details$/i.test(address) || address.length < 6 || lots.has(a[5])) {
      cardStart = end;
      continue;
    }
    const id = a[5];
    const head = markdown.slice(cardStart, a.index);
    // Bullets run from the address anchor to the card's next link (its own
    // "Full details"), so they can never absorb the following card's gallery.
    const tail = markdown.slice(end, (i + 1 < anchors.length)
      ? Math.min(anchors[i + 1].index, end + 3000)
      : Math.min(markdown.length, end + 3000));

    // Anti-leak: the status badge sits between the bid block and the address.
    // Scoping the search there stops an address or bullet containing "sold"
    // from flipping an available lot, and stops a sold lot reading available.
    const statusZone = head.includes('Your Bid') ? head.slice(head.lastIndexOf('Your Bid')) : '';
    const lot_status = /\bwithdrawn\b/i.test(statusZone) ? 'withdrawn'
      : /\bsold\b/i.test(statusZone) ? 'sold'
      : 'available';

    // LAST occurrence wins: a preceding section divider contributes an earlier,
    // non-owned "Lot 0 / Guide Price TBA" pair when its own card was skipped.
    const priceMs = [...head.matchAll(/Guide Price\s*(£[\d,]+|TBA|No Reserve)/gi)];
    const rawPrice = priceMs.length ? priceMs[priceMs.length - 1][1] : '';
    const guide_price = /^(?:TBA|No Reserve)$/i.test(rawPrice) ? '' : rawPrice;
    const numMs = [...head.matchAll(/(?:^|\n)\s*Lot\s+(\d{1,4}[A-Za-z]?)\s*(?=\n|$)/g)];

    let image_url = '';
    for (const im of head.matchAll(SAV_IMG_LINK)) {
      if (im[5] === id) { image_url = im[1]; break; }
    }

    const bullets = [...tail.matchAll(/(?:^|\n)\s*-\s+(.{2,300}?)\s*(?=\n|$)/g)]
      .map(b => clean(b[1]).replace(/^\*+|\*+$/g, '').trim())
      .filter(b => b.length > 1 && !b.startsWith('!['));

    // Two-day sales list both days' lots on one page; the per-lot "To be offered
    // on …" bullet says which. Accept it ONLY when it names one of the slug's
    // own sale days (a viewing/"sold prior on" date must never become the
    // auction date); otherwise fall back to the sale's LAST day so a still-live
    // lot is never hidden a day early.
    const slugInfo = parseSavillsAuctionSlug(a[3]);
    let auction_date = slugInfo ? slugInfo.endIso : '';
    if (slugInfo) {
      const dm = /to be offered(?:\s+on)?[^.\n]{0,40}?\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})/i.exec(bullets.join(' | '));
      const hit = dm && slugInfo.days.find(d => d.day === parseInt(dm[1], 10) && d.month === SAVILLS_MONTHS[dm[2].toLowerCase()]);
      if (hit) auction_date = `${slugInfo.year}-${String(hit.month).padStart(2, '0')}-${String(hit.day).padStart(2, '0')}`;
    }

    const blob = `${address} ${bullets.join(' ')}`.toLowerCase();
    const property_type = /\b(flat|apartment|maisonette|studio)\b/.test(blob) ? 'flat'
      : /\bbungalow\b/.test(blob) ? 'bungalow'
      : /\b(land|plot|site|paddock)\b/.test(blob) ? 'land'
      : /\b(commercial|office|retail|shop|industrial|warehouse)\b/.test(blob) ? 'commercial'
      : /\b(house|terrace|semi-detached|detached|residential|cottage)\b/.test(blob) ? 'house' : '';
    const bedM = /\b(one|two|three|four|five|six|\d{1,2})\s*bed(?:room)?/i.exec(blob);
    const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

    lots.set(id, {
      lot_number: numMs.length ? numMs[numMs.length - 1][1] : null,
      address,
      guide_price,
      property_type,
      bedrooms: bedM ? (WORD_NUM[bedM[1].toLowerCase()] || parseInt(bedM[1], 10) || null) : null,
      tenure: /\bfreehold\b/i.test(blob) ? 'Freehold' : /\bleasehold\b/i.test(blob) ? 'Leasehold' : '',
      image_url,
      // Savills renders lot hrefs on http://; the site serves https and the
      // frontend blocks mixed content, so canonicalise at the source.
      detail_url: a[2].replace(/^http:/i, 'https:'),
      description: bullets.join('. '),
      bullets,
      lot_status,
      auction_date,
    });
    cardStart = end;
  }
  return lots;
}

// ── Edward Mellor — two-tier WordPress site, plain HTTP (no Cloudflare) ──
// The catalogue root (/auction/) 301s to the /auctions/ LANDING page, which lists
// only auction DATES (no lots). The lots live one hop deeper on the soonest
// upcoming dated sub-page /auctions/{DDmmmYYYY} (e.g. /auctions/22jul2026),
// fully server-rendered as /property-for-sale/{id} cards. resolveEdwardMellor-
// CatalogueUrl does the drill (landing → soonest upcoming date); this recogniser
// parses that dated page. Only the soonest date carries lots — later upcoming
// dates are empty until ~weeks before, so "soonest upcoming only" = the full
// currently-available set. Went dark mid-June: the pipeline scraped the lot-less
// landing → 0 lots (Gemini fallback then 429'd on the dead free tier).
//
// Card shape (turndown markdown):
//   [![{addr}]({/search/images/{imgid}/…})]({/property-for-sale/{id}})   ← image link
//   LOT\ TBC                                                              ← lot number
//   [{full address}]({/property-for-sale/{id}})                          ← text link (anchor)
//   {beds}\n{baths}\n{receptions}                                        ← icon-stripped counts
//   Guide Price[](#)\ £{price}
//   AVAILABLE                                                            ← status badge
const EM_MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Tier-1 drill: fetch the stable Edward Mellor landing page and return the
 * soonest upcoming dated-auction catalogue URL (the tier-2 page that holds lots).
 *
 * @param {string} baseUrl - landing/catalogue URL (redirects to /auctions/ are followed by fetchPage)
 * @param {function(string):Promise<string>} fetchPage - plain-HTTP fetcher (injected)
 * @param {string} [todayIso] - 'YYYY-MM-DD'
 * @returns {Promise<{ url: string, auctionDateIso: string } | null>} null if no upcoming auction
 */
export async function resolveEdwardMellorCatalogueUrl(baseUrl, fetchPage, todayIso) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  let html;
  try { html = await fetchPage(baseUrl); } catch { return null; }
  const seen = new Set();
  const dated = [];
  for (const m of html.matchAll(/\/auctions\/(\d{2})([a-z]{3})(\d{4})/gi)) {
    const path = `/auctions/${m[1]}${m[2].toLowerCase()}${m[3]}`;
    if (seen.has(path)) continue;
    seen.add(path);
    const mon = EM_MONTHS[m[2].toLowerCase()];
    if (!mon) continue;
    dated.push({ iso: `${m[3]}-${mon}-${m[1]}`, url: `https://edwardmellor.co.uk${path}` });
  }
  const upcoming = dated.filter(d => d.iso >= today).sort((a, b) => a.iso.localeCompare(b.iso));
  if (!upcoming.length) return null;
  return { url: upcoming[0].url, auctionDateIso: upcoming[0].iso };
}

/**
 * Tier-2 recogniser: parse an Edward Mellor dated-auction page into raw lots.
 * Anchors on the full-address text link `[addr](…/property-for-sale/{id})`
 * (deduped by id), reads beds/price/status from the forward block and the photo
 * from the image link just before it. Verified 48/48 live (2026-07-08).
 */
export function recogniseEdwardMellorLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;
  const clean = (s) => String(s || '').replace(/\\(.)/g, '$1').replace(/\*\*/g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  // Text link only (leading char is not '!' — excludes the image link's inner).
  const TEXT_LINK = /\[([^\]\n!][^\]\n]{4,180})\]\(https:\/\/(?:www\.)?edwardmellor\.co\.uk\/property-for-sale\/(\d+)\)/g;
  let m;
  while ((m = TEXT_LINK.exec(markdown)) !== null) {
    const address = clean(m[1]);
    const id = m[2];
    if (!address || address.length < 5 || lots.has(id)) continue;
    const idx = m.index;
    const linkEnd = idx + m[0].length;

    // Forward block: link → card separator (* * *) or ~450 chars.
    let after = markdown.slice(linkEnd, linkEnd + 450);
    const sep = after.search(/\*\s\*\s\*/);
    if (sep >= 0) after = after.slice(0, sep);

    // beds = first standalone integer between the address and "Guide Price"
    // (the counts block is beds / baths / receptions).
    const gpIdx = after.search(/Guide Price/i);
    const preGuide = gpIdx >= 0 ? after.slice(0, gpIdx) : after;
    const bedM = preGuide.match(/(?:^|\n)\s*(\d{1,2})\s*(?:\n|$)/);
    const bedrooms = bedM ? parseInt(bedM[1], 10) : null;

    const priceM = after.match(/£\s*([\d,]+)/);
    const guide_price = priceM ? `£${priceM[1]}` : '';

    const statusM = after.match(/\n\s*(AVAILABLE|SOLD\s*PRIOR|SOLD|WITHDRAWN|UNSOLD|POSTPONED|UNDER\s*OFFER|RESERVED)\b/i);
    const statusRaw = statusM ? statusM[1].toUpperCase().replace(/\s+/g, ' ') : '';
    let lot_status = 'available';
    if (/WITHDRAWN|POSTPONED/.test(statusRaw)) lot_status = 'withdrawn';
    else if (/SOLD/.test(statusRaw)) lot_status = 'sold';
    else if (/UNSOLD/.test(statusRaw)) lot_status = 'unsold';

    // Lot number: "LOT\ TBC" or "LOT\ 123" just before the card links.
    const before = markdown.slice(Math.max(0, idx - 60), idx);
    const lotM = before.match(/OT\\?\s*\n?\s*([0-9]+|TBC)\s*\n/i);
    const lot_number = (lotM && lotM[1].toUpperCase() !== 'TBC') ? lotM[1] : null;

    // Photo: nearest /search/images/ image link before this text link.
    const imgWindow = markdown.slice(Math.max(0, idx - 300), idx + 60);
    const imgs = [...imgWindow.matchAll(/!\[[^\]]*\]\((https:\/\/(?:www\.)?edwardmellor\.co\.uk\/search\/images\/\d+\/[^)\s]+)\)/gi)];
    const image_url = imgs.length ? imgs[imgs.length - 1][1] : '';

    const bullets = [];
    if (bedrooms) bullets.push(`${bedrooms} bedroom`);

    lots.set(id, {
      lot_number,
      address,
      guide_price,
      property_type: '',
      bedrooms,
      tenure: '',
      image_url,
      detail_url: `https://edwardmellor.co.uk/property-for-sale/${id}`,
      description: '',
      bullets,
      lot_status,
      auction_date: '',
    });
  }
  return lots;
}

// Property Solvers (online unconditional auctions) renders its whole catalogue
// on one /auction-property-for-sale/ page (~121 lots) — Gemini token-limits to
// ~48% (58/121, 2026-06-14). The lot links ARE all in the markdown though, so a
// deterministic recogniser recovers the rest. Each lot block:
//   [![{address}]({image})]({lot-url})
//   ### [{address}]({lot-url})
//   £{guide} Guide Price
//   {description} … [More Details]({lot-url})
// The lot URL is auctions.propertysolvers.co.uk/auction-property-for-sale/{slug}/
// (slug = the recall-sentinel id). property_type/beds come from the first-contact
// deep-fetch; the recogniser just guarantees address+price+image+url for all lots.
export function recognisePropertysolversLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;
  // The `### [address](lot-url)` heading is the one-per-lot anchor.
  const HEADING_RE = /###\s*\[([^\]]+)\]\((https?:\/\/[^)]*\/auction-property-for-sale\/([a-z0-9-]+)\/?)\)/gi;
  let m;
  while ((m = HEADING_RE.exec(markdown)) !== null) {
    const address = (m[1] || '').replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
    const detailUrl = m[2];
    const slug = m[3];
    if (!slug || lots.has(slug) || !address || address.length < 5) continue;

    // Price — the `£{amount} Guide Price` line sits just after the heading.
    const tail = markdown.slice(m.index, m.index + 700);
    const priceM = tail.match(/£\s*([\d,]+)/);
    const guide_price = priceM ? `£${priceM[1]}` : '';

    // Image — the linked card image (`![..](img)](lot-url)`) sits just BEFORE the heading.
    const head = markdown.slice(Math.max(0, m.index - 400), m.index);
    const imgM = head.match(/!\[[^\]]*\]\((https?:\/\/[^)]+\.(?:jpe?g|png|webp)[^)\s]*)\)/i);
    const image_url = imgM ? imgM[1] : '';

    // Status — the listing is live auction lots; downgrade only on an explicit
    // badge AND no guide (mirrors the AuctionHouse recogniser).
    let lot_status = 'available';
    if (!guide_price) {
      const lower = tail.toLowerCase();
      if (/\bwithdrawn\b|\bpostponed\b/.test(lower)) lot_status = 'withdrawn';
      else if (/\bunsold\b|\bnot\s*sold\b/.test(lower)) lot_status = 'unsold';
      else if (/\bsold\b/.test(lower)) lot_status = 'sold';
    }

    lots.set(slug, {
      lot_number: null,
      address,
      guide_price,
      property_type: '',
      bedrooms: null,
      tenure: '',
      image_url,
      detail_url: detailUrl,
      description: '',
      bullets: [],
      lot_status,
    });
  }
  return lots;
}

// Auction House London (auctionhouselondon.co.uk) rebuilt on a Next.js + EIG-AMS
// (account 20) frontend that is NOT the auctionhouse.co.uk franchise template, so
// AH_CARD_RE (numeric /lot/details/{id} + "Property for Auction" alt) matches
// nothing here. Each card renders as:
//   [![{address}]({eig-cdn image})
//   LOT {n}
//   Guide Price: £{amount}+
//   ](…/lot/{address-slug}-{numericId})
//   {Type}{Tenure}
//   {address}
//   {description}
// The whole catalogue (~96 lots) sits on one /current-auction page, so the AI
// JSON extract can token-undercount it — this deterministic recogniser recovers
// every card. The trailing numeric id is the unique lot id (recall-sentinel key).
// NB no trailing-window capture group: a fixed `[\s\S]{0,300}` after the lot URL
// would consume the NEXT card's opening `[![` and make the regex skip every other
// lot. Instead slice the trailing block forward (non-consuming) inside the loop.
// Inner is `[^\[\]]*?` (no brackets) NOT `[\s\S]*?`: the dense page has a header
// logo `[![Auction House London](logo.png)](/…)` before lot 1, and a greedy
// inner would bridge that logo straight to lot 1's URL — stealing the logo as the
// image and burying the real address. Forbidding brackets confines each match to
// one card (a new card's `[![` or the logo link's own `]` breaks a false bridge).
const AHL_CARD_RE = /\[!\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*(?:LOT\s+([A-Za-z]?\d{1,4}[A-Za-z]?)\s*)?([^\[\]]*?)\]\((https:\/\/auctionhouselondon\.co\.uk\/lot\/[a-z0-9-]+?-(\d+))\)/gi;
const AHL_TENURE_RE = /(Share of Freehold|Freehold|Leasehold|Commonhold|Heritable)\s*$/i;
const AHL_WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// Auction House London shows the sale date only in the page header ("All Lots for
// 24th-25th June 2026"), NOT per-lot. The /current-auction calendar rows are stale
// (the rolling URL is reused each monthly sale), so without parsing this the lots
// inherit a past calendar date and never go live. Use the LAST day of a range
// (lots stay live through the final auction day).
function ahlAuctionDate(markdown) {
  const block = (markdown.match(/All Lots for\s+([^|<\n]{6,40}?20\d\d)/i) || [])[1] || '';
  if (!block) return '';
  let day, monName, year;
  let m = block.match(/(\d{1,2})(?:st|nd|rd|th)?\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(20\d\d)/);
  if (m) { day = m[2]; monName = m[3]; year = m[4]; }
  else { m = block.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(20\d\d)/); if (m) { day = m[1]; monName = m[2]; year = m[3]; } }
  if (!m) return '';
  const MO = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const mo = MO[monName.slice(0, 3).toLowerCase()];
  if (!mo) return '';
  return `${year}-${String(mo).padStart(2, '0')}-${String(parseInt(day, 10)).padStart(2, '0')}`;
}

export function recogniseAuctionHouseLondonLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;

  const auctionDate = ahlAuctionDate(markdown);
  AHL_CARD_RE.lastIndex = 0;
  let m;
  while ((m = AHL_CARD_RE.exec(markdown)) !== null) {
    const address = (m[1] || '').replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
    const imageUrl = m[2] || '';
    const lotNumber = (m[3] || '').toUpperCase();
    const inner = m[4] || '';
    const detailUrl = m[5];
    const id = m[6];
    const trailing = markdown.slice(m.index + m[0].length, m.index + m[0].length + 300);
    if (!id || lots.has(id) || !address || address.length < 5) continue;

    // Guide price lives inside the image-link block ("Guide Price: £375,000+").
    const priceM = inner.match(/£\s*([\d,]+)/);
    const guide_price = priceM ? `£${priceM[1]}` : '';

    // Status — pre-auction lots show a guide; downgrade only on an explicit badge
    // with no guide so a sold/withdrawn lot never persists as available.
    let lot_status = 'available';
    if (!guide_price) {
      const low = inner.toLowerCase();
      if (/\bwithdrawn\b|\bpostponed\b/.test(low)) lot_status = 'withdrawn';
      else if (/\bsold\s*prior\b|\bsold\b/.test(low)) lot_status = 'sold';
      else if (/\bunsold\b|\bnot\s*sold\b|\bpassed\b/.test(low)) lot_status = 'unsold';
    }

    // Trailing block: "{Type}{Tenure}\n\n{address}\n\n{description}".
    const lines = trailing.split(/\n+/).map(s => s.replace(/\\(.)/g, '$1').trim()).filter(Boolean);
    let tenure = '';
    let property_type = '';
    let description = '';
    for (const line of lines) {
      if (line.startsWith('[') || line.startsWith('!') || /^next viewing/i.test(line)) continue;
      const tm = line.match(AHL_TENURE_RE);
      if (tm && !tenure) {
        tenure = tm[1];
        property_type = ahPropType(line.replace(AHL_TENURE_RE, '').trim());
        continue;
      }
      if (!description && line.length > 12 && line.toLowerCase() !== address.toLowerCase() && !/^lot\s/i.test(line)) {
        description = line;
      }
    }

    // Bedrooms from the description ("Three Bedroom …"); "Room" ≠ bedroom.
    let bedrooms = null;
    const bedM = description.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+bed(?:room)?s?\b/i);
    if (bedM) { const t = bedM[1].toLowerCase(); bedrooms = AHL_WORD_NUM[t] || parseInt(t, 10) || null; }

    const bullets = [];
    if (property_type) bullets.push(property_type);
    if (tenure) bullets.push(tenure);
    if (description) bullets.push(description);

    lots.set(id, {
      lot_number: lotNumber || null,
      address,
      guide_price,
      property_type: property_type || '',
      bedrooms,
      tenure,
      image_url: imageUrl,
      detail_url: detailUrl,
      description,
      bullets,
      lot_status,
      auction_date: auctionDate,
    });
  }
  return lots;
}

// BTG Eddisons (the SDL-network catalogue scraped under the `sdl` slug — HOUSE_ROOTS.sdl
// points at btgeddisonspropertyauctions.com) rebuilt its listing template
// (structure_drift 2026-06-14: 0 lots since ~31 May, the old extractor matched nothing).
// The new page is server-rendered + paginated (448 lots, ~9/page) but `?page=1&limit=500`
// returns the whole catalogue in one fetch. Each card in turndown markdown:
//   [{address}](…/properties/{id}/for-auction-{location})
//   ![]({asta image})
//   {n} / {m}                  (image carousel counter)
//   {Single Lot Auction|…}     (auction-type label)
//   [{address}](… same url …)  (repeated text link)
// No guide price in the listing — the per-lot detail fetch fills it. The lot id ends
// in a -DDMMYY auction-date suffix (…-160626 = 16 Jun 2026) which we parse for auction_date.
const BTG_CARD_RE = /\[([^\]\n]{6,})\]\((https?:\/\/(?:www\.)?btgeddisonspropertyauctions\.com\/properties\/([a-z0-9_-]+?)\/for-auction[a-z-]*)\)/gi;

export function recogniseBtgEddisonsLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;

  BTG_CARD_RE.lastIndex = 0;
  let m;
  while ((m = BTG_CARD_RE.exec(markdown)) !== null) {
    const address = (m[1] || '').replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
    const detailUrl = m[2];
    const id = m[3];
    if (!id || !address || address.length < 6) continue;

    // Card window: from this link to the NEXT lot link, so price/image bind to THIS lot.
    const rest = markdown.slice(m.index + m[0].length);
    const nextM = rest.match(/\]\(https?:\/\/(?:www\.)?btgeddisonspropertyauctions\.com\/properties\/[a-z0-9_-]+?\/for-auction/i);
    const card = rest.slice(0, nextM ? nextM.index : Math.min(rest.length, 1200));

    // Guide price ("Guide Price: £595,000+") renders inside the card. Tolerate
    // markdown emphasis / dash separators between the label and the figure
    // (turndown often bolds the price: "Guide Price* **£595,000+**"), the same
    // way the EIG recogniser does — purely additive, still anchored on the
    // "Guide Price" label so a stray £-figure (fees etc.) can't masquerade as one.
    const priceM = card.match(/Guide\s*Price[\s:*_\\–—-]*£\s*([\d,]+)/i);
    const guide_price = priceM ? `£${priceM[1]}` : '';

    // Image — accept ONLY a property photo bound to this lot (asta artnr_{idPrefix}/_pictures/).
    // Each card also carries an estate-agent logo under a DIFFERENT artnr; matching by the
    // lot id prefix rejects the logo (and any neighbour's photo). Where the listing lazy-loads
    // the photo (logo only in the static markup) image stays empty — the per-lot detail fetch
    // and the image quality filter fill/clean it on later cycles.
    const idPrefix = id.replace(/-\d{6}$/, '').replace(/[^a-z0-9_]/gi, '');
    let image_url = '';
    if (idPrefix) {
      const propImg = card.match(new RegExp('!\\[[^\\]]*\\]\\((https?://[^)\\s]*artnr_' + idPrefix + '\\/_pictures\\/[^)\\s]*\\.(?:jpe?g|png|webp)[^)\\s]*)\\)', 'i'));
      if (propImg) image_url = propImg[1];
    }

    // Auction date from the trailing -DDMMYY suffix in the lot id.
    let auction_date = '';
    const dm = id.match(/-(\d{2})(\d{2})(\d{2})$/);
    if (dm) {
      const day = +dm[1], mon = +dm[2], yr = 2000 + +dm[3];
      if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
        auction_date = `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    // BTG renders each lot's link TWICE (an image link, then the address text
    // link); the "Guide Price: £X" and the property photo live in only ONE of
    // the two card windows. So rather than skip a repeat id, merge in any field
    // the first occurrence missed — otherwise the first (price-less) window wins
    // and every lot persists with no guide price (the post-rebuild regression:
    // catalogue price coverage 92%→16%). Merge is additive — a field is filled
    // only when currently empty — so single-occurrence pages and the synthetic
    // test fixtures are unaffected.
    const existing = lots.get(id);
    if (existing) {
      if (!existing.guide_price && guide_price) existing.guide_price = guide_price;
      if (!existing.image_url && image_url) existing.image_url = image_url;
      continue;
    }

    lots.set(id, {
      lot_number: null,
      address,
      guide_price,
      property_type: '',
      bedrooms: null,
      tenure: '',
      image_url,
      detail_url: detailUrl,
      description: '',
      bullets: [],
      lot_status: 'available',
      auction_date,
    });
  }
  return lots;
}

// Charles Darrow — independent Devon/Cornwall auctioneer on their own ASP.NET
// site (charlesdarrow.co.uk). NOT the BTG Eddisons network — Charles Darrow was
// wrongly folded into the `sdl`→`btgeddisons` slug and is carved out as its own
// house (de-conflation 2026-06-21). The /Auctions/ grid is AJAX-hydrated into
// #resultsControl; a browser render (Crawlee) materialises the cards, then
// turndown produces the recognition markdown this parses. Verified live
// 2026-06-21 (htmlToRecognitionMarkdown of /Auctions/). Each lot card:
//   [ ![]( …ImageServer.aspx?I={id}_{n}.jpg… )   (real property photo)
//     ![Auction Lot: …]( …/property icon.png )   (placeholder icon — rejected)
//     VIEW PROPERTY
//   ](…/propertyInfo/{id}/for-sale/{type-slug}/{location})
//   # Auction Lot: {descriptive title}
//   # {types}
//   # {town, county}
//   Type: {types}\
//   Location: {town, county}\
//   FH Price: £185,000 Guide Price\        (LH Price for leasehold)
//   Ref: CD-{ref}
//   -   For Sale by Public Auction 25/6/26  (auction date — d/m/yy or dd/mm/yyyy)
//   -   {feature bullets…}
//   [VIEW DETAILS](…/propertyInfo/{id}/…)
// The lot's propertyInfo link renders TWICE per card (image-wrapper link, then
// VIEW DETAILS) — keyed by numeric id so the repeat is a no-op. No guide price
// in the lot id; auction_date comes from the "Public Auction {date}" bullet.
const CD_CARD_RE = /\]\((https?:\/\/(?:www\.)?charlesdarrow\.co\.uk\/propertyInfo\/(\d+)\/for-sale\/[^)\s]*)\)/gi;

export function recogniseCharlesDarrowLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;

  CD_CARD_RE.lastIndex = 0;
  let m;
  while ((m = CD_CARD_RE.exec(markdown)) !== null) {
    const detailUrl = m[1];
    const id = m[2];
    if (!id || lots.has(id)) continue;

    // Card window: the descriptive headings + Type/Location/Price/Ref block and
    // the bullet list sit AFTER this link (the image-wrapper link comes first),
    // up to the NEXT propertyInfo link. Bound the window there so price/date/
    // image bind to THIS lot.
    const rest = markdown.slice(m.index + m[0].length);
    const nextM = rest.match(/\]\(https?:\/\/(?:www\.)?charlesdarrow\.co\.uk\/propertyInfo\/\d+\/for-sale\//i);
    const card = rest.slice(0, nextM ? nextM.index : Math.min(rest.length, 2000));

    // Address: the "# Auction Lot: {title}" heading (a rich descriptive title),
    // plus the "Location: {town, county}" value when it adds a place. Auction
    // lots here have no street number in the catalogue, so the title + location
    // is the most address-like, validation-passing signal.
    const clean = (s) => (s || '').replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/^,\s*/, '').trim();
    const titleM = card.match(/^#\s*(?:Auction Lot:\s*)?(.+?)\s*$/im);
    const title = clean(titleM ? titleM[1] : '');
    const locM = card.match(/Location:\s*([^\n\\]+)/i);
    const location = clean(locM ? locM[1] : '');
    let address = title;
    if (location && !address.toLowerCase().includes(location.toLowerCase())) {
      address = address ? `${address}, ${location}` : location;
    }
    if (!address || address.length < 6) continue;

    // Guide price: "FH Price: £185,000 Guide Price" / "LH Price: £…". Anchor on
    // the Price label so a stray £-figure (rent/turnover in a bullet) can't win.
    const priceM = card.match(/(?:FH|LH)\s*Price:\s*£\s*([\d,]+)/i);
    const guide_price = priceM ? `£${priceM[1]}` : '';

    // Tenure from the FH/LH price prefix.
    let tenure = '';
    if (priceM) tenure = /^FH/i.test(priceM[0]) ? 'Freehold' : 'Leasehold';

    // Property type from the "Type:" line (drops the trailing ", Auctions" tag).
    const typeM = card.match(/Type:\s*([^\n\\]+)/i);
    const property_type = clean((typeM ? typeM[1] : '').replace(/,?\s*Auctions\s*$/i, ''));

    // Auction date from "…Public Auction {d/m/yy|dd/mm/yyyy}". Two-digit years
    // are 20xx (these are upcoming sales). Tolerate the site's occasional
    // "Pubic Auction" typo (observed live) by matching on "Auction {date}".
    let auction_date = '';
    const dateM = card.match(/Pub(?:l)?ic Auction\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
    if (dateM) {
      const day = +dateM[1], mon = +dateM[2];
      let yr = +dateM[3];
      if (yr < 100) yr += 2000;
      if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
        auction_date = `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    // Image: the ImageServer photo whose `I={id}_…` prefix matches the lot id —
    // rejects the "property icon.png" placeholder and any neighbour's photo.
    // The photo renders in the image-wrapper block that comes BEFORE this
    // (wrapper-link-close) match, so look in a small look-BACK window as well as
    // the forward card. Matching by the lot id is what keeps neighbours out.
    // Empty image is fine: the multi-image sweep + detail fetch fill it later.
    let image_url = '';
    const lookBack = markdown.slice(Math.max(0, m.index - 600), m.index);
    const imgRe = new RegExp('!\\[[^\\]]*\\]\\((https?://[^)\\s]*ImageServer\\.aspx\\?[^)\\s]*I=' + id + '_[^)\\s]*)\\)', 'i');
    const imgM = (lookBack + card).match(imgRe);
    if (imgM) image_url = imgM[1];

    // Bullets: the "- " feature list inside the card window.
    const bullets = [...card.matchAll(/^[-*]\s+(.+?)\s*$/gim)]
      .map(b => clean(b[1]))
      .filter(b => b && b.length > 2 && !/^Ref:/i.test(b))
      .slice(0, 12);
    const description = bullets[0] || '';

    lots.set(id, {
      lot_number: null,
      address,
      guide_price,
      property_type,
      bedrooms: null,
      tenure,
      image_url,
      detail_url: detailUrl,
      description,
      bullets,
      lot_status: 'available',
      auction_date,
    });
  }
  return lots;
}

// SDL Property Auctions (sdlauctions) — a MAJOR UK auctioneer now operating under
// the BTG Eddisons brand but still trading its own catalogue at sdlauctions.co.uk.
// Photos sit on the SAME property-world platform as BTG Eddisons
// (https://*.property-world.co.uk/.../artnr_{id}/_pictures/…), so this mirrors
// recogniseBtgEddisonsLotsFromMarkdown. Verified live 2026-06-22: the /search/
// grid is AJAX-hydrated (WordPress theme `searchProperty()` POSTs to
// /wp-content/themes/sdl-auctions/library/property-functions.php with func=ajaxProp),
// so a plain fetch of /search/ returns 0 cards — the catalogue must be rendered
// (Crawlee turndown bridge → htmlToRecognitionMarkdown) for the recogniser to see
// lots. Each rendered card in markdown:
//   [\n](…/property/{id}/{type}-for-auction-{town}/)   (image-wrapper link, empty text)
//   [{Type} in {Town}](… same url …)                   (title text link)
//   -   {beds}                                          (optional bare number)
//   -   {full address with postcode}
//   -   Guide price\*
//   -   £{N}+ (plus fees)
//   -   **Auction date:**\\
//       {Nth Mon YYYY} at HH.MMam
//   ![]( …partner/agent LOGO… )                        (estate-agent logo — rejected)
//   [Find out more](… same url …)
// The lot id is NUMERIC in the URL (/property/50931/…). The REAL property photo is
// lazy-loaded in a <style>.lazy-{id}{background-image:…artnr_…/_pictures/…} block
// that turndown strips, so the ONLY ![] image surviving into markdown is the
// estate-agent partner logo (…/artnr_{GUID}/_pictures/{Agent}.jpg) — which we
// reject (image stays empty; the multi-image sweep + detail fetch fill it later,
// exactly like the BTG/Charles Darrow lazy-photo case). The lot link renders
// THREE times per card; keyed by numeric id so the repeats are no-ops (merge any
// field a later occurrence adds). Months parsed from the "Auction date:" line.
const SDL_CARD_RE = /\[[^\]]*\]\((https?:\/\/(?:www\.)?sdlauctions\.co\.uk\/property\/(\d+)\/[^)\s]*)\)/gi;
const SDL_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function recogniseSdlAuctionsLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;

  const clean = (s) => (s || '').replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

  SDL_CARD_RE.lastIndex = 0;
  let m;
  while ((m = SDL_CARD_RE.exec(markdown)) !== null) {
    const detailUrl = m[1];
    const id = m[2];
    if (!id) continue;

    // Card window: from this lot link to the NEXT lot link (any id), so the
    // address/price/date/image bind to THIS lot. The lot link repeats 3× within a
    // card (image-wrapper, title, "Find out more"); bound on the next DIFFERENT id.
    const rest = markdown.slice(m.index + m[0].length);
    let nextIdx = rest.length;
    const nre = /\[[^\]]*\]\(https?:\/\/(?:www\.)?sdlauctions\.co\.uk\/property\/(\d+)\//gi;
    let nm;
    while ((nm = nre.exec(rest)) !== null) {
      if (nm[1] !== id) { nextIdx = nm.index; break; }
    }
    const card = rest.slice(0, Math.min(nextIdx, 2200));

    // Address: the first bullet line carrying a UK postcode (skips the bare
    // bedrooms-count bullet and the "Guide price"/price/auction-date bullets).
    let address = '';
    for (const bm of card.matchAll(/^[-*]\s+(.+?)\s*$/gim)) {
      const line = clean(bm[1]);
      if (UK_POSTCODE_RE.test(line)) { address = line; break; }
    }
    // Fallback: the "{Type} in {Town}" title text link gives a town when no
    // postcode-bearing address bullet rendered.
    if (!address) {
      const titleM = card.match(/\[([^\]\n]{4,}?\sin\s[^\]\n]+?)\]\(https?:\/\/(?:www\.)?sdlauctions\.co\.uk\/property\/\d+\//i);
      address = clean(titleM ? titleM[1] : '');
    }
    if (!address || address.length < 6) continue;

    // Guide price: "£{N}+ (plus fees)" sits on the bullet after "Guide price*".
    // Anchor on the Guide-price label first; fall back to the "£N+ (plus fees)"
    // shape so a stray £-figure can't masquerade as the guide.
    let guide_price = '';
    const labelM = card.match(/Guide\s*price[\s:*_\\]*\s*[\r\n-]*\s*£\s*([\d,]+)/i);
    if (labelM) guide_price = `£${labelM[1]}`;
    else {
      const feesM = card.match(/£\s*([\d,]+)\+?\s*\(plus fees\)/i);
      if (feesM) guide_price = `£${feesM[1]}`;
    }

    // Property type + town from the "[{Type} in {Town}]" title text link.
    let property_type = '';
    const typeM = card.match(/\[([^\]\n]+?)\s+in\s+[^\]\n]+?\]\(https?:\/\/(?:www\.)?sdlauctions\.co\.uk\/property\/\d+\//i);
    if (typeM) property_type = clean(typeM[1]);

    // Auction date: "**Auction date:**\\  24th Jun 2026 at 10.00am".
    let auction_date = '';
    const dateM = card.match(/Auction date:[\s*\\_]*\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\s+(\d{4})/i);
    if (dateM) {
      const day = +dateM[1];
      const mon = SDL_MONTHS[dateM[2].slice(0, 3).toLowerCase()];
      const yr = +dateM[3];
      if (mon && day >= 1 && day <= 31) {
        auction_date = `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    // Image — the lazy-loaded property photo (artnr_{timestampId}/_pictures/) is
    // stripped with the <style> block, so the only ![] image in the card is the
    // estate-AGENT partner logo. Reject it: image stays empty and the multi-image
    // sweep + detail fetch fill it later (same lazy-photo handling as the BTG
    // Eddisons recogniser). The partner logo and the real property photo BOTH live
    // under property-world …/artnr_{X}/_pictures/, so the filename is not a reliable
    // discriminator (some logos have numeric names, e.g. 1735918725669.jpg). What
    // DOES distinguish them is the artnr shape: real property photos use the
    // property-world TIMESTAMP id ({12 digits}sq_{token}, same as BTG Eddisons);
    // estate-agent partner logos use a GUID artnr (8-4-4-…). Accept only the
    // timestamp-artnr photo so any GUID-artnr partner logo is rejected.
    let image_url = '';
    const propImg = card.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]*property-world\.co\.uk\/[^)\s]*\/artnr_\d{12}sq_[a-z0-9]+\/_pictures\/[^)\s]*\.(?:jpe?g|png|webp)[^)\s]*)\)/i);
    if (propImg) image_url = propImg[1];

    const existing = lots.get(id);
    if (existing) {
      if (!existing.guide_price && guide_price) existing.guide_price = guide_price;
      if (!existing.image_url && image_url) existing.image_url = image_url;
      if (!existing.auction_date && auction_date) existing.auction_date = auction_date;
      if (!existing.property_type && property_type) existing.property_type = property_type;
      continue;
    }

    lots.set(id, {
      lot_number: null,
      address,
      guide_price,
      property_type,
      bedrooms: null,
      tenure: '',
      image_url,
      detail_url: detailUrl,
      description: '',
      bullets: [],
      lot_status: 'available',
      auction_date,
    });
  }
  return lots;
}

// Clive Emson — independent land & property auctioneer, JS-rendered SPA
// (rewriteUrl sets preferPuppeteer; served via Crawlee → turndown). The
// /properties/ catalogue lists the CURRENT auction's lots; each lot card is a
// single multi-line markdown link whose href IS the detail page:
//
//   [](https://maps.google.com/maps?q={lat},{lng}&...)        <- per-lot map pin (empty anchor)
//
//   [LOT {N}
//
//   ### {HEADLINE — a property-type description, not a street address}
//
//   {Town} - {County}
//
//   {AVAILABLE AT|SOLD|POSTPONED|WITHDRAWN AFTER|UNSOLD}**£{amount}**
//
//   ](https://www.cliveemson.co.uk/properties/{auc}/{lot}/)[Add to bookmarks](javascript:addBookmark('{auc}','{lot}','L',false);)
//
// Two quirks the recogniser absorbs (verified live against auction 266 on
// 2026-06-22 via htmlToRecognitionMarkdown of /properties/, 150/150 lots):
//   • Every card renders TWICE — a "grid" link to /properties/{auc}/{lot}/ and
//     a "list" link to a MALFORMED /properties/properties/{auc}/{lot}/ (the
//     site's own double-prefix bug). The URL pattern tolerates the optional
//     second `properties/` so each occurrence matches at ITS OWN boundary
//     (otherwise the body regex jumps the unmatched double-prefix link into the
//     next card). We key by {lot}, keep the first (grid) parse, and ALWAYS emit
//     a clean URL rebuilt from {auc}/{lot} — so the double prefix never reaches
//     lots.url (it had leaked there before this recogniser existed).
//   • No listing thumbnail survives turndown (photos are lazy-loaded), so
//     image_url is '' — the multi-image sweep fills the gallery off the
//     now-correct detail URL. The OLD failure mode stored the Google-Maps pin
//     as lots.url, so the sweep fetched a map and every gallery stayed empty.
//
// The recall sentinel is /cliveemson\.co\.uk\/properties\/\d+\/(\d+)/gi
// (capture = {lot}); the Map is keyed by {lot} so the crawlee-extract merge
// (idOf) lines up. auction_date is parsed once from the page header
// ("## Wednesday 17th June 2026, 11:00 AM") — Clive Emson never carried a real
// auction date before, so lots sat on the 2099-12-31 sentinel.
const CLIVEEMSON_CARD_RE = /\[LOT\s+([\w/]+)\s*\n+#+\s*([^\n]+)\n+([\s\S]*?)\]\(https?:\/\/(?:www\.)?cliveemson\.co\.uk\/properties\/(?:properties\/)?(\d+)\/(\d+)\/?\)/gi;
const CLIVEEMSON_MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const CLIVEEMSON_STATUS_LINE_RE = /^(AVAILABLE|SOLD|POSTPONED|WITHDRAWN|UNSOLD|RESERVED|UNDER\s+OFFER|P\/AVAILABLE)\b/i;

// Auction date from the catalogue header ("## Wednesday 17th June 2026, ...").
function cliveEmsonAuctionDate(markdown) {
  const m = markdown.match(/##\s*\w+day\s+(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  if (!m) return '';
  const mon = CLIVEEMSON_MONTHS[m[2].toLowerCase()];
  if (!mon) return '';
  return `${m[3]}-${String(mon).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
}

// Best-effort property type from the lot headline (downstream enrichment refines).
function cliveEmsonPropType(headline) {
  const s = (headline || '').toLowerCase();
  if (/\b(flats?|apartments?|maisonettes?|studios?)\b/.test(s)) return 'flat';
  if (/\bbungalows?\b/.test(s)) return 'bungalow';
  if (/\b(acres?|land|plots?|sites?|woodlands?|paddocks?|pasture|grazing|development)\b/.test(s)) return 'land';
  if (/\b(commercial|shops?|retail|offices?|investment|premises|warehouses?|industrial|units?|mixed[\s-]?use|garages?)\b/.test(s)) return 'commercial';
  if (/\b(houses?|cottages?|terraces?|semi|detached|dwellings?|homes?)\b/.test(s)) return 'house';
  return '';
}

export function recogniseCliveEmsonLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;

  const auction_date = cliveEmsonAuctionDate(markdown);

  CLIVEEMSON_CARD_RE.lastIndex = 0;
  let m;
  while ((m = CLIVEEMSON_CARD_RE.exec(markdown)) !== null) {
    const lotLabel = (m[1] || '').trim();
    const headline = (m[2] || '').replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim();
    const rest = m[3] || '';
    const auc = m[4];
    const lotId = m[5]; // sentinel capture group — keep the Map keyed by this
    // First (grid) occurrence wins; the malformed list duplicate is skipped.
    if (!lotId || lots.has(lotId)) continue;

    // Address = the "Town - County" location line: the first body line that
    // isn't the status/price line. The full street address lives on the detail
    // page (first-contact fetch + OS Places refine it later).
    const lines = rest.split(/\n+/).map(s => s.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim()).filter(Boolean);
    let address = '';
    for (const line of lines) {
      if (CLIVEEMSON_STATUS_LINE_RE.test(line)) continue;
      if (/^£/.test(line) || /Add to bookmarks/i.test(line) || line.startsWith('[')) continue;
      address = line;
      break;
    }
    // A terse location ("Ryde - IOW", <12 chars, no digit) would be dropped by
    // normaliseScrapedLot's looksLikeRealAddress min-length — qualify it with
    // the headline so every advertised lot survives (the 100%-coverage rule).
    if (address && address.length < 12 && !/\d/.test(address) && headline) address = `${headline}, ${address}`;
    else if (!address && headline) address = headline;

    // Status from the body (headline is captured separately, so its words can't
    // leak in). Negative markers win over the implicit "available" default.
    const su = rest.toUpperCase();
    let lot_status = 'available';
    if (/\bWITHDRAWN\b/.test(su)) lot_status = 'withdrawn';
    else if (/\bPOSTPONED\b/.test(su)) lot_status = 'postponed';
    else if (/\bUNSOLD\b/.test(su)) lot_status = 'unsold';
    else if (/\bSOLD\b/.test(su)) lot_status = 'sold';

    const priceM = rest.match(/£\s*([\d,]+)/);
    const guide_price = priceM ? `£${priceM[1]}` : '';

    lots.set(lotId, {
      lot_number: /^\d+$/.test(lotLabel) ? Number(lotLabel) : (lotLabel || null),
      address,
      guide_price,
      property_type: cliveEmsonPropType(headline),
      bedrooms: null,
      tenure: '',
      image_url: '', // lazy-loaded on the listing — multi-image sweep fills it
      detail_url: `https://www.cliveemson.co.uk/properties/${auc}/${lotId}/`,
      description: headline,
      bullets: headline ? [headline] : [],
      lot_status,
      auction_date,
    });
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
    const addrMatches = [...block.matchAll(/\[([^\]\n][^\]]*)\]\(https:\/\/(?:www\.)?markjenkinson\.co\.uk\/property\/[a-z0-9_]+\)/gi)];
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

// Maggs & Allen's `/search-auction/?auction={N}` view renders ~30 listing
// cards in a stable per-lot markdown block:
//
//   **LOT 1**
//
//   [optional !\[SOLD\](...) overlay images, one per badge instance]
//
//   ## [\<address>](https://www.maggsandallen.co.uk/property-details/{id}/{path})
//
//   ## [\*Guide Price £\<amount>+](\<same url>)
//
//   - \<bullet 1 — typically "DD Mon LIVE ONLINE AUCTION">
//   - \<bullet 2>
//   - ...
//
//   [Full\\
//   Details](\<same url>)
//
// The JSON extractor recovers most lots when the page is "clean", but drops
// any lot that's preceded by SOLD-overlay images (it interprets the badges as
// the card header and gives up). It also drops the "LOT TBC" entries used for
// the next auction's preview. Verified 2026-05-11 against /?auction=3 (24
// JSON lots out of 38 total_lots stated; the recogniser recovers Lot 6
// "SOLD PRIOR" + Lots 10/13/16/22/24/31 + several LOT TBC entries).
export function recogniseMaggsLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;

  // Split on **LOT N** / **LOT TBC** markers. Element 0 is the page preamble
  // (header / nav); thereafter pairs of [marker, block-content].
  const parts = markdown.split(/\*\*LOT\s+(\d+|TBC)\*\*/i);

  for (let i = 1; i + 1 < parts.length; i += 2) {
    const lotMarker = parts[i].trim();
    const block = parts[i + 1];
    if (!block) continue;

    // First `## [<addr>](<.../property-details/{id}/<path>>)` heading after
    // any leading SOLD-overlay images. The id is the canonical lot identifier.
    const linkMatch = block.match(/##\s*\[([^\]]+)\]\((https:\/\/(?:www\.)?maggsandallen\.co\.uk\/property-details\/(\d+)\/[^)]+)\)/);
    if (!linkMatch) continue;

    const id = linkMatch[3];
    if (lots.has(id)) continue;

    // Firecrawl markdown escapes wrapped whitespace as `\ \ ` between commas.
    // Collapse those + any internal multi-space to a single space.
    const address = linkMatch[1]
      .replace(/\\(\s)/g, '$1')
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*/g, ', ')
      .trim();

    // Strip EIG catalogue-navigation params (page=, bid=, orderby=, etc.)
    // — see stripEigCatalogueParams() for the rationale. lots.url has a
    // unique constraint; dirty URLs from the catalogue's filter state cause
    // duplicates across catalogue pages.
    const detailUrl = stripEigCatalogueParams(linkMatch[2]);

    // Guide price — the next `## [\*Guide Price £<amount>+](...)` heading.
    const priceMatch = block.match(/##\s*\[\\?\*?Guide Price\s+(£[\d,]+\+?)/i);
    const guidePrice = priceMatch ? priceMatch[1] : '';

    // Bullets — `- <text>` lines between the price heading and the
    // "[Full Details]" link (or the next LOT marker if the link is missing).
    const bulletsZone = block.split(/\[Full[\s\\]*Details\]|\*\*LOT\s+/i)[0] || '';
    const bullets = [...bulletsZone.matchAll(/^\s*-\s+(.+?)$/gm)]
      .map(m => m[1].trim())
      .filter(b => b && !/^!\[/.test(b) && b.length > 2);
    const bulletStr = bullets.join(' ');

    // Status: SOLD overlay images appear in the block BEFORE the address
    // heading. "SOLD PRIOR" also shows up in the first bullet on those lots.
    const preAddress = block.slice(0, block.indexOf(linkMatch[0]));
    const hasSoldOverlay = /!\[SOLD\]\([^)]*sold[^)]*\)/i.test(preAddress);
    let lotStatus = 'available';
    if (hasSoldOverlay || /\bSOLD\s+PRIOR\b/i.test(bulletStr)) lotStatus = 'sold';
    else if (/\bWITHDRAWN\b/i.test(bulletStr)) lotStatus = 'withdrawn';
    else if (/\bPOSTPONED\b/i.test(bulletStr)) lotStatus = 'postponed';

    // Property-type hint from bullets — best-effort, downstream enrichment
    // refines it.
    const lower = bulletStr.toLowerCase();
    let propType = '';
    if (/\b(flat|apartment|maisonette|studio)\b/.test(lower)) propType = 'flat';
    else if (/\bbungalow\b/.test(lower)) propType = 'bungalow';
    else if (/\b(house|terrace|semi-detached|detached|townhouse)\b/.test(lower)) propType = 'house';
    else if (/\b(land|plot|site|building plot|development)\b/.test(lower)) propType = 'land';
    else if (/\b(commercial|office|retail|industrial|warehouse|shop|mixed[\s-]?use)\b/.test(lower)) propType = 'commercial';

    const bedMatch = bulletStr.match(/\b(\d+)\s*[-\s]?\s*bed(?:room)?s?\b/i);
    const bedrooms = bedMatch ? parseInt(bedMatch[1], 10) : null;

    lots.set(id, {
      lot_number: lotMarker === 'TBC' ? null : Number(lotMarker),
      address,
      guide_price: guidePrice,
      property_type: propType,
      bedrooms,
      tenure: '',
      image_url: '',
      detail_url: detailUrl,
      description: bullets[0] || '',
      bullets,
      lot_status: lotStatus,
    });
  }

  return lots;
}

// Hollis Morgan markdown recogniser. Used as a recall fallback when Firecrawl
// JSON extract drops lots on https://www.hollismorgan.co.uk/search-auction/.
// Hollis Morgan runs its own CMS — NOT EIG white-label — and its lot card
// shape is distinct from Maggs:
//
//   ![View Full Details for <title>](image.jpg)
//   ![Bedrooms](...)**4**![Bathrooms](...)**2**![Reception](...)**1**   (optional, icon counts unreliable on dev sites)
//
//   #### Lot N  (or #### Lot TBC)
//
//   ### <address with postcode>
//
//   #### **<price>**                                  (one bold group)
//   — or —
//   #### **<price prefix>** **<£amount +++>**         (two bold groups; prefix like "Auction Guide Price", "Offers Invited")
//
//   - bullet 1
//   - bullet 2
//   ...
//
//   [SHOW ME MORE](https://www.hollismorgan.co.uk/property-details/<id>/<area>/<city>/<slug>?page=1)
//
// Detail URL contains the canonical property-details id, matching the
// existing RECALL_SENTINELS regex for hollismorgan.
// Verified 2026-05-11 against /search-auction/ (118 lot markers found).
export function recogniseHollisMorganLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;

  // Split on `#### Lot N` / `#### Lot TBC` headings. Element 0 is preamble;
  // thereafter pairs of [marker, block-content].
  const parts = markdown.split(/####\s*Lot\s+(\d+|TBC)\b/i);

  for (let i = 1; i + 1 < parts.length; i += 2) {
    const lotMarker = parts[i].trim();
    const block = parts[i + 1];
    if (!block) continue;

    // Address: the next `### <addr>` heading after the Lot marker.
    const addrMatch = block.match(/^###\s+(.+?)$/m);
    if (!addrMatch) continue;
    const address = addrMatch[1]
      .replace(/\\(\s)/g, '$1')
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*/g, ', ')
      .trim();

    // Detail URL: `[SHOW ME MORE](https://www.hollismorgan.co.uk/property-details/<id>/...)`.
    // Without an ID we can't safely merge with the JSON extract — skip the lot.
    // Host is www-optional: the Crawlee-rendered DOM emits bare-host hrefs
    // (2026-06-13 incident — recovery matched 0 while the host-less sentinel
    // counted 73).
    const urlMatch = block.match(/\[SHOW ME MORE\]\((https:\/\/(?:www\.)?hollismorgan\.co\.uk\/property-details\/(\d+)\/[^)]+)\)/i);
    if (!urlMatch) continue;
    const id = urlMatch[2];
    if (lots.has(id)) continue;
    // Strip the EIG catalogue navigation params (page=, bid=, showstc=,
    // orderby=, extra_2!=) that the EIG white-label CMS embeds into every
    // lot card href. See stripEigCatalogueParams() for the rationale.
    const detailUrl = stripEigCatalogueParams(urlMatch[1]);

    // Guide price — find the first `####` heading line AFTER the address that
    // contains a £ amount. Handles "#### **£X +++**" and "#### **<prefix>** **£X +++**".
    const afterAddr = block.slice(addrMatch.index + addrMatch[0].length);
    let guidePrice = '';
    const priceLineMatch = afterAddr.match(/####\s+(.+?)(?:\r?\n|$)/);
    if (priceLineMatch) {
      const amountMatch = priceLineMatch[1].match(/£[\d,]+(?:\s*\+{1,3})?/);
      if (amountMatch) guidePrice = amountMatch[0].replace(/\s+/g, ' ').trim();
    }

    // Bullets — `- <text>` lines between the price heading and `[SHOW ME MORE]`
    // (or the next `#### Lot ` marker if the link is missing).
    const bulletsZone = block.split(/\[SHOW ME MORE\]|####\s*Lot\s+/i)[0] || '';
    const bullets = [...bulletsZone.matchAll(/^\s*-\s+(.+?)$/gm)]
      .map(m => m[1].trim())
      .filter(b => b && !/^!\[/.test(b) && b.length > 2);
    const bulletStr = bullets.join(' ');

    // Property-type hint from bullets — icon counts unreliable on dev sites
    // (saw "41 bedrooms" for development land), so we ignore them.
    const lower = bulletStr.toLowerCase();
    let propType = '';
    if (/\b(flat|apartment|maisonette|studio)\b/.test(lower)) propType = 'flat';
    else if (/\bbungalow\b/.test(lower)) propType = 'bungalow';
    else if (/\bhmo\b/.test(lower)) propType = 'house';
    else if (/\b(house|terrace|semi[-\s]?detached|detached|townhouse)\b/.test(lower)) propType = 'house';
    else if (/\b(land|plot|site|building plot|development)\b/.test(lower)) propType = 'land';
    else if (/\b(commercial|office|retail|industrial|warehouse|shop|mixed[\s-]?use|nightclub)\b/.test(lower)) propType = 'commercial';

    const bedMatch = bulletStr.match(/\b(\d+)\s*[-\s]?\s*bed(?:room)?s?\b/i);
    const bedrooms = bedMatch ? parseInt(bedMatch[1], 10) : null;

    // Status. Hollis doesn't render SOLD overlays in the search-auction view
    // — default available unless a bullet says otherwise.
    let lotStatus = 'available';
    if (/\bSOLD\b/i.test(bulletStr)) lotStatus = 'sold';
    else if (/\bWITHDRAWN\b/i.test(bulletStr)) lotStatus = 'withdrawn';
    else if (/\bPOSTPONED\b/i.test(bulletStr)) lotStatus = 'postponed';

    // Hero image: the card photo URL embeds the property id
    // (`/resize/<id>/0/480....jpg`) but renders BEFORE the `#### Lot N`
    // heading — i.e. it lands in the PREVIOUS split block — so look it up in
    // the full markdown by id instead of the block.
    const imgMatch = markdown.match(new RegExp(`https://(?:www\\.)?hollismorgan\\.co\\.uk/resize/${id}/[^\\s)]+`, 'i'));

    lots.set(id, {
      lot_number: lotMarker.toUpperCase() === 'TBC' ? null : Number(lotMarker),
      address,
      guide_price: guidePrice,
      property_type: propType,
      bedrooms,
      tenure: '',
      image_url: imgMatch ? imgMatch[0] : '',
      detail_url: detailUrl,
      description: bullets[0] || '',
      bullets,
      lot_status: lotStatus,
    });
  }

  return lots;
}

// ── AuctionHouse / EIG platform recogniser ────────────────────────────────
// The Auction House UK franchise network (auctionhouse.co.uk/{region}/...) runs
// ~33 regional sites off ONE template, each rendering its ENTIRE catalogue on a
// single search-results page (London = 848 lots, one page, no pagination). The
// Gemini extractor only pulls a token-limited slice (~105/848), so recall
// collapsed once Firecrawl (server-side JSON extract over the whole page) went
// away. This deterministic recogniser parses every card from the turndown
// markdown — full recall, zero LLM cost — and serves the whole platform family
// via resolvePlatformRecogniser() (no per-region entry needed).
//
// Card shape (verified live 2026-06-13 against /london/auction/search-results):
//   [ ![Property for Auction in {region} - {ADDRESS}]({IMG})
//     Lot {N}
//     \*Guide | {PRICE} (plus fees)         // "£X+", "£X - £Y", or "No Reserve"
//     {BEDS} Bed {TYPE}                     // or a type-only line (land/commercial)
//     {ADDRESS}
//   ]({DETAIL_URL})                         // /{region}/auction/lot/{id} OR
//                                           // online…/lot/redirect/{id}
const AH_CARD_RE = new RegExp(
  '!\\[Property for Auction[^\\]]*?\\s-\\s([^\\]]+?)\\]\\((https?:\\/\\/[^)]+)\\)' + // 1=address(alt) 2=image
  '([\\s\\S]*?)' +                                                                   // 3=body
  '\\]\\((https?:\\/\\/[^)]*\\/(?:auction\\/lot|lot\\/(?:redirect|details))\\/(\\d+))\\)', // 4=detailUrl 5=id
  'gi',
);

function ahPropType(typeText) {
  const t = (typeText || '').toLowerCase();
  if (/\b(flat|apartment|maisonette|studio|penthouse)\b/.test(t)) return 'flat';
  if (/\bbungalow\b/.test(t)) return 'house';
  if (/\b(house|terrace|terraced|detached|cottage|town\s?house|villa|lodge|mews)\b/.test(t)) return 'house';
  if (/\b(commercial|shop|office|retail|industrial|warehouse|pub|hotel|restaurant|premises|unit)\b/.test(t)) return 'commercial';
  if (/\b(land|plot|site|garage|ground\s?rent|parking)\b/.test(t)) return 'land';
  return ''; // "Property For Sale" / unknown → let downstream inference/enrichment decide
}

export function recogniseAuctionHouseLotsFromMarkdown(markdown) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;

  for (const m of markdown.matchAll(AH_CARD_RE)) {
    const address = (m[1] || '')
      .replace(/\\(.)/g, '$1')      // un-escape markdown (\, \*, \| etc.)
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*/g, ', ')
      .trim();
    const imageUrl = m[2] || '';
    const body = m[3] || '';
    const detailUrl = stripEigCatalogueParams(m[4] || '');
    const id = m[5];
    if (!id || !address || address.length < 5) continue;
    if (lots.has(id)) continue;

    // Lot number can carry a letter suffix/prefix ("10A", "180B", "A04") — the
    // column is text, so keep the whole token rather than truncating to digits.
    const lotMatch = body.match(/\bLot\s+([A-Z]?\d{1,4}[A-Z]{0,2})\b/i);
    const priceMatch = body.match(/Guide\s*\|\s*(.+?)\s*\(plus fees\)/i);
    const guidePrice = priceMatch ? priceMatch[1].replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim() : '';

    // Status. Available lots show "*Guide | … (plus fees)"; non-available lots
    // replace that line with a status word ("Withdrawn", "Postponed", "Sold",
    // "Sold Prior", "Sold After", "Sold £X"). Parse it deterministically off the
    // card so we never persist a sold/withdrawn lot as available (the 2026-06-13
    // status-fabrication failure mode). Guide price present ⇒ available wins.
    let lotStatus = 'available';
    if (!guidePrice) {
      if (/\bWithdrawn\b/i.test(body)) lotStatus = 'withdrawn';
      else if (/\bPostponed\b/i.test(body)) lotStatus = 'withdrawn';
      else if (/\b(?:Unsold|Not\s*Sold|Passed|No\s*Sale)\b/i.test(body)) lotStatus = 'unsold';
      else if (/\bSold\b/i.test(body)) lotStatus = 'sold';
    }

    const bedMatch = body.match(/\b(\d+)\s+Bed\b[^\n]*/i);
    const bedrooms = bedMatch ? parseInt(bedMatch[1], 10) : null;
    // Type line: "{N} Bed {Type}" when beds are present, else a bare-type line
    // ("Commercial Property", "Land"). Addresses always carry a comma; type
    // lines never do — that cleanly separates the type line from the repeated
    // address without a brittle keyword-anchored regex.
    const TYPE_WORDS = /\b(?:House|Flat|Apartment|Maisonette|Studio|Bungalow|Land|Plot|Site|Garage|Property|Premises|Unit|Shop|Office|Commercial|Retail|Warehouse|Industrial|Terrace|Terraced|Detached)\b/i;
    let typeText = '';
    if (bedMatch) {
      typeText = bedMatch[0].replace(/^\d+\s+Bed\s*/i, '').trim();
    } else {
      for (const line of body.split(/\n+/).map(s => s.trim())) {
        if (line.length < 3 || line.length > 45 || line.includes(',')) continue;
        if (/Guide|plus fees|Sold|Withdrawn|Postponed|Reserve|^Lot\b/i.test(line)) continue;
        if (TYPE_WORDS.test(line)) { typeText = line; break; }
      }
    }

    lots.set(id, {
      lot_number: lotMatch ? lotMatch[1].toUpperCase() : null,
      address,
      guide_price: guidePrice,
      property_type: ahPropType(typeText),
      bedrooms,
      tenure: '',
      image_url: imageUrl,
      detail_url: detailUrl,
      description: typeText || '',
      bullets: [],
      lot_status: lotStatus,
    });
  }

  return lots;
}

// ── Pagination URL builders ───────────────────────────────────────────────

export const PAGINATION_PATTERNS = {
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

// A paginated catalogue has ended once the last EMPTY_PAGE_RUN scraped pages
// all came back with zero lots and no error. An error page is inconclusive
// (could be a transient Firecrawl failure), so it never triggers an early
// stop. Auction catalogues paginate contiguously, so a run of empty pages is
// a reliable end-of-catalogue signal. Exported for unit tests.
export const EMPTY_PAGE_RUN = 3;
export function catalogueEndReached(pageResults) {
  if (pageResults.length < EMPTY_PAGE_RUN) return false;
  return pageResults
    .slice(-EMPTY_PAGE_RUN)
    .every(p => p && !p.error && p.lots.length === 0);
}

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
    let r;
    try {
      r = await extractCatalogue(pageUrls[0], { changeTracking, fcTimeout });
    } catch (err) {
      // Firecrawl unavailable (incl. the CF-bypass-only gate) — degrade to 0
      // lots so autoAnalyseOne falls through to the Crawlee/Gemini scrape-stage
      // instead of throwing out of the whole pipeline. Mirrors the multi-page
      // path's per-page catch below.
      console.log(`AUTO: ${house} ${pageUrls[0]} failed: ${err.message}`);
      r = { lots: [], markdown: '', changeStatus: null, totalLots: null, auctionDate: null };
    }
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
    console.log(`AUTO: ${house} scraping up to ${pageUrls.length} pages (maxConcurrency: ${maxConcurrency})`);
    const t0 = Date.now();

    // Scrape one page → normalised page-result object (never throws).
    const scrapePage = async (pageUrl) => {
      try {
        const r = await extractCatalogue(pageUrl, { changeTracking, fcTimeout });
        return {
          url: pageUrl,
          lots: r.lots || [],
          markdown: r.markdown || '',
          changeStatus: r.changeStatus,
          totalLots: r.totalLots,
          auctionDate: r.auctionDate,
        };
      } catch (err) {
        console.log(`AUTO: ${house} ${pageUrl} failed: ${err.message}`);
        return { url: pageUrl, lots: [], markdown: '', error: err.message };
      }
    };

    // Page 1 first: scrape it alone so changeTracking can short-circuit the
    // whole catalogue BEFORE we pay for pages 2..N. "Page 1 unchanged ⇒
    // catalogue unchanged" is the same proxy the old catalogue-level
    // short-circuit relied on — this just stops paying for the rest first.
    const page1 = await scrapePage(pageUrls[0]);
    if (changeTracking && page1?.changeStatus === 'same' && !forceExtract) {
      console.log(`AUTO: ${house} unchanged (changeTracking on page 1) — skipping ${pageUrls.length - 1} more pages`);
      return { skipped: true, reason: 'unchanged', changeStatus: 'same', lots: [] };
    }

    // Page 1 changed (or changeTracking off) — fan out pages 2..N in batches,
    // stopping once the catalogue clearly ends (a run of empty pages = no
    // more lots). Saves the empty-page extracts on houses whose maxPages cap
    // exceeds the real catalogue length (e.g. Pattinson, maxPages 84).
    pageResults = [page1];
    for (let start = 1; start < pageUrls.length; start += maxConcurrency) {
      const batch = pageUrls.slice(start, start + maxConcurrency);
      const batchResults = await Promise.all(batch.map(scrapePage));
      pageResults.push(...batchResults);
      if (catalogueEndReached(pageResults)) {
        console.log(`AUTO: ${house} pagination stopped early — catalogue ends before page ${pageUrls.length}`);
        break;
      }
    }
    const elapsed = Date.now() - t0;
    const succeeded = pageResults.filter(p => p && !p.error).length;
    console.log(`AUTO: ${house} ${succeeded}/${pageResults.length} pages scraped in ${(elapsed / 1000).toFixed(1)}s`);
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

    const jsonLotsRaw = page.lots.map(lot => normaliseScrapedLot(lot, { house, catalogueUrl: page.url }));
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
      const jsonIdRegex = new RegExp(recallSentinelPattern.source, recallSentinelPattern.flags.replace('g', ''));
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
            const normalised = normaliseScrapedLot(lot, { house, catalogueUrl: page.url, extractionSource: 'firecrawl-markdown-recognition' });
            // normaliseScrapedLot returns null on placeholder addresses; respect
            // that even for markdown-recognised lots.
            if (!normalised) { totalRejectedAddress++; continue; }
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

    // Deduplicate by lot URL — pagination loops (same lots on multiple pages)
    // waste Firecrawl credits and produce duplicate rows. Keep first occurrence.
    const seenUrls = new Set();
    const dedupedLots = allLots.filter(lot => {
      const url = lot?.url;
      if (!url) return false; // drop lots without URLs
      if (seenUrls.has(url)) return false;
      seenUrls.add(url);
      return true;
    });
    const dupesDropped = allLots.length - dedupedLots.length;
    if (dupesDropped > 0) {
      console.log(`AUTO: ${house} dedup: dropped ${dupesDropped} duplicate URLs across pages`);
    }

  // Persist recall metric to pipeline_alerts so we can rank houses by recall ratio
  // over time. Stdout-only logs roll off Railway's 500-line buffer in hours;
  // this gives us a Supabase-queryable history for self-healing remediation.
  if (totalMdIds > 0) {
    const ratio = (totalJsonIds + totalRecognised) / totalMdIds;
    // THE 100% COMMANDMENT — recall gate. Below sentinel parity fires
    // 'recall_below_100' (error/warning), not a perpetual 'info'. (2026-07-07)
    fireAlert(recallGateAlert({
      house, recall: ratio, lots: totalJsonIds + totalRecognised,
      sentinelLots: totalMdIds, engine: 'firecrawl', recognised: totalRecognised,
      extra: { jsonIds: totalJsonIds, mdIds: totalMdIds, pages: pageResults.length },
    })).catch(err => console.warn(`AUTO: ${house} recall gate alert failed: ${err.message}`));
  }

  // Stamp extractor provenance on the success path so persistence records
  // extracted_with='firecrawl-json' (previously defaulted to 'unknown' because
  // this module never touched state.js). Only stamp when lots were produced —
  // the skipped/empty returns above persist nothing.
  if (dedupedLots.length > 0) setLastExtractorUsed('firecrawl-json');

  return {
      skipped: false,
      lots: dedupedLots,
      auctionDate: pageResults[0]?.auctionDate || null,
      totalLots: pageResults[0]?.totalLots || null,
      pageErrors: pagesWithErrors,
      jsonExtracted: totalJsonIds,
      markdownRecognised: totalRecognised,
      rejectedPlaceholderAddress: totalRejectedAddress,
      dupesDropped,
      // Recall vs the house's sentinel (markdown lot IDs seen vs extracted),
      // exposed so the engine-parity gate can compare this incumbent result
      // against a Crawlee+Gemini challenger. null when no sentinel was given.
      recall: totalMdIds > 0 ? (totalJsonIds + totalRecognised) / totalMdIds : null,
      sentinelLots: totalMdIds,
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

  // Description → bullets (legacy display/signal path) + description (canonical
  // narrative field, persisted to lots.description).
  if (raw.description && typeof raw.description === 'string') {
    const desc = raw.description.trim();
    if (desc.length > 3 && desc.length < 4000) {
      out.bullets = [desc];
      if (desc.length >= 20) out.description = desc;
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
  const lots = rawLots.map(lot => normaliseScrapedLot(lot, { house, catalogueUrl: url }));

  console.log(`AUTO: ${house} agent extract: ${lots.length} lots`);
  return {
    skipped: false,
    lots,
    auctionDate: data?.auction_date || null,
    totalLots: data?.total_lots || null,
  };
}
