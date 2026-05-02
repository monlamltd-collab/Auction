// lib/rentals/openrent.js — Rental scraper for openrent.co.uk.
//
// OpenRent rejects plain GET on its search results page (returns a JS shell
// with no usable listings). It needs a rendered DOM. We use Firecrawl
// (primary scraper, per Auction conventions) with `waitFor` to let the
// listing cards hydrate, then parse the rendered HTML with JSDOM.
//
// Strategy — selector-free parsing:
//   OpenRent's class names (.pli, .pim-pricing, etc.) churn whenever they
//   redesign. Instead of pinning to a class, we scan for any <a> whose
//   href matches /\/\d+/?$/ — listing detail pages live at /123456/ — then
//   walk up to a parent that also contains a price string like "£X pcm".
//   This survives most A/B tests and class renames.
//
// Cost: 1 Firecrawl credit per (postcode) call. Volume is bounded by the
// daily drain limit (50 postcodes/day default → ≤50 credits/day). With the
// 15,000/month budget, OpenRent costs ~10% of monthly cap if drained daily.
//
// If FIRECRAWL_API_KEY is missing or credits are exhausted, this scraper
// returns { listings: [] } with status='circuit_open' surfaced via the
// orchestrator — no exception, no manifest noise.

import { JSDOM } from 'jsdom';
import { scrapeWithFirecrawl, isFcCreditExhausted, isFcTemporarilyDown, FIRECRAWL_API_KEY } from '../scraper.js';

/**
 * Scrape rentals for a postcode from OpenRent.
 * @param {string} postcode - canonical postcode (e.g. "BS1 5HX")
 * @returns {Promise<{ listings: Array, areaLabel?: string, skipped?: string }>}
 */
export async function scrapeOpenRent(postcode) {
  const url = buildSearchUrl(postcode);
  if (!url) return { listings: [] };

  // Firecrawl gating — match the rest of the project's conventions:
  // Firecrawl primary, no Puppeteer fallback for rentals (low priority,
  // not worth the Railway memory). Skip gracefully.
  if (!FIRECRAWL_API_KEY) return { listings: [], skipped: 'firecrawl_no_key' };
  if (isFcCreditExhausted()) return { listings: [], skipped: 'firecrawl_credits_exhausted' };
  if (isFcTemporarilyDown()) return { listings: [], skipped: 'firecrawl_temporarily_down' };

  let html;
  try {
    const result = await scrapeWithFirecrawl(url, {
      formats: ['rawHtml'],
      // Listing cards hydrate on first paint; 1.5s is enough on a warm
      // request without paying for a full network-idle wait.
      waitFor: 1500,
    });
    html = result.html || '';
  } catch (err) {
    // Don't propagate — orchestrator records api_error in manifest.
    return { listings: [], skipped: `firecrawl_error:${err.message.slice(0, 80)}` };
  }

  if (!html) return { listings: [] };

  return parseOpenRentHtml(html, postcode);
}

// Exported for tests — pure function, no I/O.
export function parseOpenRentHtml(html, postcode) {
  let dom;
  try {
    dom = new JSDOM(html);
  } catch {
    return { listings: [] };
  }
  const doc = dom.window.document;

  // Selector-free pass: find every <a> linking to a numeric listing id.
  // OpenRent canonical detail URLs are /123456/ or /123456 (some redirect
  // to slugged variants like /123456-2-bed-flat-london).
  const links = [...doc.querySelectorAll('a[href]')];
  const seen = new Set();
  const listings = [];

  for (const a of links) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\/(\d{5,9})(?:[\/\-]|$)/);
    if (!m) continue;
    const sourceId = m[1];
    if (seen.has(sourceId)) continue;

    // Walk up the DOM tree (max 6 hops) to find a parent block that
    // contains both this link AND a price string. Two boundary guards
    // prevent borrowing a price from a sibling card:
    //   1. Hard cap: textContent > 600 chars → we've left the card.
    //   2. Growth jump: if a single hop multiplies the text by > 3×
    //      AND the new size is > 150 chars, we crossed into a layout
    //      wrapper aggregating other listings.
    // Without these, a priceless card silently borrows the next card's £.
    let card = a;
    let cardText = '';
    let prevLen = 0;
    let foundCard = false;
    for (let hop = 0; hop < 6; hop++) {
      cardText = (card.textContent || '').trim();
      if (cardText.length > 600) break;
      if (hop > 0 && cardText.length > 150 && cardText.length > prevLen * 3) break;
      if (/£\s*[\d,]+/.test(cardText)) { foundCard = true; break; }
      prevLen = cardText.length;
      if (!card.parentElement) break;
      card = card.parentElement;
    }
    if (!foundCard) continue;

    const rentPcm = parseRent(cardText);
    if (!Number.isFinite(rentPcm) || rentPcm <= 0) continue;

    const beds = parseBeds(cardText);
    const propType = detectPropertyType(cardText);

    seen.add(sourceId);
    listings.push({
      source_id: sourceId,
      url: `https://www.openrent.co.uk/${sourceId}/`,
      rent_pcm: rentPcm,
      beds,
      property_type: propType,
      // propType encodes the share semantics (set to 'room' when the
      // card mentions "house share" or "room") — use that directly
      // rather than a second regex pass.
      is_room_share: propType === 'room',
      area_label: postcode,
    });

    // Bound work — search-result pages typically show ~25 listings; if a
    // page crams in 200, something's off and we cap to keep parse time low.
    if (listings.length >= 60) break;
  }

  return { listings, areaLabel: postcode };
}

// Search URL — OpenRent's `area?term=` endpoint accepts a postcode token
// and renders results filtered to the immediate area. `within=0` means
// "exactly in this postcode area" (no radius widening).
function buildSearchUrl(postcode) {
  if (!postcode || typeof postcode !== 'string') return null;
  const cleaned = postcode.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}$/.test(cleaned)) return null;
  const term = encodeURIComponent(cleaned);
  return `https://www.openrent.co.uk/properties-to-rent/area?term=${term}&within=0&isLive=true`;
}

// Match SpareRoom's parser: take the LOWER bound of any range, convert
// pw → pcm via × 52 / 12, ignore non-pcm/non-pw matches.
function parseRent(text) {
  if (!text) return null;
  const t = text.replace(/&pound;|&#163;/gi, '£');
  // Find all £-prefixed numbers near a "pcm" or "pw" suffix. We scan a
  // 40-char window after each £ for the period token to avoid grabbing
  // unrelated prices (e.g. deposit, fees) elsewhere in the card.
  const rents = [];
  for (const m of t.matchAll(/£\s*([\d,]+)\s*(?:to|-)?\s*(?:£\s*[\d,]+)?\s*([a-z]{0,4})/gi)) {
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    const tail = (m[2] || '').toLowerCase();
    // Look ahead in a small window for "pcm" or "pw" if tail didn't catch it
    const window = t.slice(m.index, m.index + 60).toLowerCase();
    const isPw = /\bpw\b/.test(window) && !/\bpcm\b/.test(window);
    const isPcm = /\bpcm\b/.test(window) || /per\s*month/.test(window);
    if (!isPw && !isPcm) continue;
    rents.push(isPw ? Math.round(n * 52 / 12) : n);
  }
  if (rents.length === 0) return null;
  return Math.min(...rents);
}

function parseBeds(text) {
  if (!text) return null;
  // OpenRent titles look like "2 Bed Flat", "Studio", "1 Bed House Share"
  if (/\bstudio\b/i.test(text)) return 0;
  const m = text.match(/(\d+)\s*(?:bed|bedroom)\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0 && n < 30) return n;
  }
  return null;
}

function detectPropertyType(text) {
  const t = text.toLowerCase();
  if (/\bstudio\b/.test(t)) return 'studio';
  if (/\bhouse\s*share\b|\broom\b/.test(t)) return 'room';
  if (/\bhouse\b/.test(t)) return 'house';
  if (/\bbungalow\b/.test(t)) return 'bungalow';
  if (/\bflat\b|\bapartment\b/.test(t)) return 'flat';
  return null;
}
