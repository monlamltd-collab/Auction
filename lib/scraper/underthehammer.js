// ═══════════════════════════════════════════════════════════════
// lib/scraper/underthehammer.js — Under The Hammer JSON-API branch.
//
// underthehammer.com is a Next.js SPA: the catalogue page ships an empty
// shell and hydrates every card from `/api/properties`. Rendering it and
// handing the markdown to the AI extractor produced ~9 lots of 161 and
// died outright whenever the AI quota was exhausted (the house sat at
// `last_probe_result='error'` with 0 live lots from 2026-06-13).
//
// The site's own data source is a plain, server-fetchable JSON endpoint —
// HTTP 200 from a datacenter IP with the project's standard headers, no
// Cloudflare, no auth. This module consumes it directly, modelled on
// lib/scraper/allsop.js: a self-contained producer of already-normalised
// `rawLots`, dispatched from scrape-stage.js on `paginateAs:'underthehammer_api'`,
// bypassing Crawlee / Firecrawl / Gemini entirely. Zero credits, one fetch.
//
// ── The anti-leak contract ─────────────────────────────────────────────
// The endpoint returns the WHOLE book — currently 285 records of which only
// 161 are live (106 sold, 16 unsold, 2 withdrawn, all past-dated). A naive
// consumer would ship 124 ended lots as `available`. Two independent gates
// stop that:
//   1. `status === 'upcoming'` — the source's own lifecycle field.
//   2. `auction.endDate` (a.k.a. `auctionEndsAt`) is today or later.
// Both must pass. Gate 2 exists because the `status=upcoming` query param is
// a server-side convenience we do not trust to survive an upstream change;
// gate 1 exists because a sold lot can still carry a future end date (one
// does today). Anything else is simply not emitted — the post-auction sweeps
// own lifecycle reconciliation for lots that have already been persisted.
//
// ── Detail URL ─────────────────────────────────────────────────────────
// The lot page is /property/{id}, NOT /for-auction/{id}. Verified 2026-07-21
// by clicking a card in a real browser render (the cards are router-push
// handlers, not anchors, so this cannot be read off the static HTML). The
// recall sentinel in recall-sentinels.js matches the same form.
// ═══════════════════════════════════════════════════════════════

import { normaliseScrapedLot } from '../types/lot.js';
import { fetchPage } from './http.js';
import { setLastExtractorUsed, setLastScrapeEngine } from './state.js';

const API_BASE = 'https://www.underthehammer.com/api/properties';

// Canonical catalogue endpoint. `status=upcoming` is the server-side narrowing
// (161 of 285 today); the client-side gates below are the guarantee.
export const UTH_CATALOGUE_URL = `${API_BASE}?top=200&skip=0&status=upcoming&sortBy=most-recent`;

const PAGE_SIZE = 200;
const MAX_API_PAGES = 15;          // 3,000 records — far beyond any plausible book
const MAX_IMAGES_PER_LOT = 8;      // mirrors image-extract.js MAX_IMAGES_PER_LOT

// Lifecycle values the source uses. Only 'upcoming' is live; 'sold' | 'unsold' |
// 'withdrawn' are all ended and must never reach the lots table as available.
const LIVE_STATUS = 'upcoming';

/** Collapse the newlines the source embeds in `address.street` ("93 Doncaster Lane\nWoodlands"). */
function cleanText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/** Strip the HTML the source stores in `description` and collapse whitespace. */
function htmlToText(html) {
  return cleanText(
    String(html == null ? '' : html)
      .replace(/<\s*br\s*\/?>/gi, ' ')
      .replace(/<\/\s*p\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&pound;/gi, '£')
      .replace(/&#39;|&rsquo;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&#\d+;/g, ' ')
  );
}

/** ISO date (YYYY-MM-DD) for the lot's auction, or '' when the source omits it. */
export function auctionDateIso(property) {
  const raw = property?.auction?.endDate || property?.auctionEndsAt || '';
  const iso = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
}

/**
 * True when a property is a CURRENT lot — live per the source's own status AND
 * dated today or later. Both gates must pass; see the anti-leak contract above.
 *
 * @param {object} property - raw API record
 * @param {string} todayIso - YYYY-MM-DD, injected so the gate is testable
 */
export function isCurrentUnderTheHammerLot(property, todayIso) {
  if (!property || property.status !== LIVE_STATUS) return false;
  const iso = auctionDateIso(property);
  if (!iso) return false;
  return iso >= todayIso;
}

/**
 * Map one API record to the raw snake_case shape `normaliseScrapedLot` expects.
 * Pure — no network, no clock.
 */
export function mapUnderTheHammerProperty(property) {
  const a = property?.address || {};
  // Full postal address: street, town, postcode. The source's `title` is only
  // "street, outward-code" ("30 Princes Street, DL4"), which loses the town and
  // the inward code — the site's own cards render exactly the join below.
  const address = [cleanText(a.street), cleanText(a.city), cleanText(a.county), cleanText(a.postCode)]
    .filter(Boolean)
    .filter((part, i, arr) => arr.indexOf(part) === i)
    .join(', ');

  const guide = (typeof property?.guidePrice === 'number' && property.guidePrice > 0)
    ? `£${property.guidePrice.toLocaleString('en-GB')}`
    : '';

  const images = Array.isArray(property?.images)
    ? property.images.filter(u => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, MAX_IMAGES_PER_LOT)
    : [];

  // Bullets are a CURATED fact list, deliberately NOT the source narrative.
  // normaliseLotStatuses (lib/scraper/validation.js) re-greps bullets for
  // /\bSOLD\b/ and demotes any 'available' lot that matches — 5 of today's 161
  // live descriptions contain the word "sold" in prose ("sold with vacant
  // possession"), which would silently hide them. The narrative still reaches
  // the DB via `description`, which that check does not read.
  const bullets = [
    cleanText(property?.type),
    typeof property?.bedrooms === 'number' && property.bedrooms > 0 ? `${property.bedrooms} bedrooms` : '',
    typeof property?.bathrooms === 'number' && property.bathrooms > 0 ? `${property.bathrooms} bathrooms` : '',
    cleanText(property?.tenure),
    cleanText(property?.occupied_status),
    property?.epc_rating && !/ask agent/i.test(property.epc_rating) ? `EPC ${cleanText(property.epc_rating)}` : '',
    cleanText(property?.council_tax_band) ? `Council tax band ${cleanText(property.council_tax_band)}` : '',
    cleanText(property?.completion_timescale) ? `Completion ${cleanText(property.completion_timescale)}` : '',
  ].filter(Boolean);

  return {
    // The source publishes no lot numbers (the site renders none) — null is the
    // honest value. Dedup is on `url`, which is stable and id-derived.
    lot_number: null,
    address,
    guide_price: guide,
    detail_url: property?.id ? `https://www.underthehammer.com/property/${property.id}` : '',
    image_url: images[0] || '',
    images,
    bedrooms: typeof property?.bedrooms === 'number' && property.bedrooms > 0 ? property.bedrooms : null,
    tenure: cleanText(property?.tenure),
    property_type: cleanText(property?.type),
    description: htmlToText(property?.description),
    bullets,
    // Only current lots are ever mapped, so 'available' is always correct here.
    // Guarded by isCurrentUnderTheHammerLot at the single call site below.
    lot_status: 'available',
    auction_date: auctionDateIso(property),
  };
}

/**
 * Filter → map → normalise. Pure (clock injected), so the 100%-recall and
 * no-ended-leak guarantees are unit-testable without the network.
 *
 * @returns {Array<object>} canonical app-side lots (already through normaliseScrapedLot)
 */
export function extractUnderTheHammerLots(properties, { todayIso, catalogueUrl = UTH_CATALOGUE_URL } = {}) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const lots = [];
  const seen = new Set();
  for (const property of (Array.isArray(properties) ? properties : [])) {
    if (!isCurrentUnderTheHammerLot(property, today)) continue;
    if (property.id) {
      if (seen.has(property.id)) continue;
      seen.add(property.id);
    }
    const raw = mapUnderTheHammerProperty(property);
    const lot = normaliseScrapedLot(raw, {
      house: 'underthehammer',
      catalogueUrl,
      extractionSource: 'underthehammer-api',
    });
    if (!lot) continue;
    // normaliseScrapedLot carries the hero image only; the API hands us the whole
    // gallery, so pass it through directly rather than making multi-image-sweep
    // render 161 SPA detail pages for data we already hold.
    if (raw.images.length) lot.images = raw.images;
    lots.push(lot);
  }
  return lots;
}

/**
 * Fetch the whole catalogue, paginating on `skip` until the endpoint's own
 * `totalCount` is satisfied. Returns the raw API records.
 */
export async function fetchUnderTheHammerProperties(baseUrl = UTH_CATALOGUE_URL, deps = {}) {
  const _fetchPage = deps.fetchPage || fetchPage;
  const all = [];
  let total = null;

  for (let page = 0; page < MAX_API_PAGES; page++) {
    const skip = page * PAGE_SIZE;
    let pageUrl;
    try {
      const u = new URL(baseUrl);
      u.searchParams.set('top', String(PAGE_SIZE));
      u.searchParams.set('skip', String(skip));
      pageUrl = u.toString();
    } catch {
      pageUrl = `${API_BASE}?top=${PAGE_SIZE}&skip=${skip}&status=upcoming&sortBy=most-recent`;
    }

    let body;
    try {
      body = await _fetchPage(pageUrl);
    } catch (e) {
      console.log(`underthehammer: API page skip=${skip} failed: ${e.message}`);
      break;
    }

    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      console.log(`underthehammer: API page skip=${skip} was not JSON (${e.message})`);
      break;
    }

    const batch = Array.isArray(json?.properties) ? json.properties : [];
    if (typeof json?.totalCount === 'number') total = json.totalCount;
    all.push(...batch);
    console.log(`underthehammer: API skip=${skip} → ${batch.length} records (${all.length}/${total ?? '?'})`);

    if (batch.length < PAGE_SIZE) break;
    if (total != null && all.length >= total) break;
  }

  return all;
}

/**
 * Scrape-stage entry point. Returns already-normalised lots, or [] on failure —
 * never throws (scrape-stage treats 0 lots as a regression and alerts).
 */
export async function scrapeUnderTheHammer(baseUrl = UTH_CATALOGUE_URL, deps = {}) {
  try {
    const properties = await fetchUnderTheHammerProperties(baseUrl, deps);
    if (properties.length === 0) {
      console.log('underthehammer: API returned no records');
      return [];
    }
    const lots = extractUnderTheHammerLots(properties, {
      todayIso: deps.todayIso || new Date().toISOString().slice(0, 10),
      catalogueUrl: baseUrl,
    });
    const ended = properties.length - lots.length;
    console.log(`underthehammer: ${lots.length} current lots from ${properties.length} API records (${ended} ended/past-dated dropped)`);
    setLastScrapeEngine('http');
    setLastExtractorUsed('api');
    return lots;
  } catch (e) {
    console.log(`underthehammer: scrape failed: ${e.message}`);
    return [];
  }
}
