// ═══════════════════════════════════════════════════════════════
// lib/scraper/symondsandsampson.js — Symonds & Sampson CF-stealth branch.
//
// auctions.symondsandsampson.co.uk sits behind Cloudflare, which 403s our
// datacenter IP on every engine EXCEPT Firecrawl's residential `proxy:'stealth'`
// (verified 2026-06-14). This module is the bespoke scrape path for that house,
// modelled on lib/scraper/allsop.js: a self-contained producer of normalised
// `rawLots`, dispatched from scrape-stage.js on `paginateAs:'symondsandsampson_stealth'`
// and bypassing Crawlee / Firecrawl-JSON / Gemini entirely.
//
// Two tiers (the lot listing is one navigation hop from the stable URL):
//   1. Events page (stable URL) → lists every forthcoming auction `event`,
//      each as a dated `[View Event](…/event/{slug})` link. The slug changes
//      monthly (property-auction-jun2026-digbyhall, …-jul2026-merleyhouse, …).
//   2. The SOONEST upcoming event page → lists the lots as
//      `/property/{id}/{postcode}/{town}/{slug}` links.
//
// Why only the soonest event: the events page itself states "Lots are usually
// listed approximately 6 weeks prior to the auction date", so later events
// carry no lots yet — the soonest event is the complete set of currently
// available lots. (Unsold-from-past lots live on a separate ?eventdate=past
// view and are a deliberate follow-up, not part of this available-set pass.)
//
// Credit budget: ~5 stealth credits per scrape × 2 tiers = ~10/cycle against a
// 1,000/mo allowance — hence "soonest event only", never a per-event fan-out.
// ═══════════════════════════════════════════════════════════════

import { scrapeWithFirecrawl } from './firecrawl.js';
import { normaliseScrapedLot } from '../types/lot.js';

const EVENTS_PAGE = 'https://auctions.symondsandsampson.co.uk/events/property-auction/symonds-and-sampson-property-auctions?eventdate=upcoming';

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

// Lot URL on an event page: /property/{id}/{outward-postcode}/{town}/{tail…}
// e.g. /property/dwr00073d/bh19/swanage/quarry-close/flat/1-bedroom
// This regex is also the recall sentinel (see recall-sentinels.js).
const PROPERTY_URL_RE = /https?:\/\/auctions\.symondsandsampson\.co\.uk\/property\/([a-z0-9]+)\/([a-z0-9]+)\/([a-z0-9-]+)\/([a-z0-9/-]+)/gi;

// Markdown escaping + whitespace cleanup, mirroring the propertysolvers recogniser.
function cleanText(s) {
  return (s || '')
    .replace(/\\(.)/g, '$1')      // unescape markdown (\, \-, \. …)
    .replace(/\*\*/g, '')          // strip bold markers
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

// Generic call-to-action link text that is NOT an address.
const CTA_RE = /^(view|add to|read more|bid|register|enquire|download|more details?|see details?)/i;

// Bare section/nav headings on the events & event pages that are NOT addresses.
// A page heading "Properties" otherwise bled into lot 1's address (verified
// against the live 19 Jun 2026 Digby Hall event, 2026-06-15) — anchored exact
// match so real addresses that merely contain these words are unaffected.
const GENERIC_HEADING_RE = /^(properties|property|lots?|search(?:\s+results?)?|results?|auctions?|current|upcoming|forthcoming|for sale|to let|filter|sort by|home)$/i;

function isRealAddressText(s) {
  const t = cleanText(s);
  if (!t || t.length < 5) return false;
  if (CTA_RE.test(t)) return false;
  if (GENERIC_HEADING_RE.test(t)) return false;
  return /[a-z]/i.test(t);
}

function titleCaseSlug(slug) {
  return (slug || '')
    .split('-')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Outward-postcode segment from the URL ('bh19' → 'BH19'). The full postcode
// (with inward code) only appears in the heading address when present.
function formatOutwardPostcode(seg) {
  return (seg || '').toUpperCase();
}

const TYPE_WORDS = new Set([
  'flat', 'house', 'bungalow', 'land', 'cottage', 'maisonette', 'commercial',
  'detached', 'semi-detached', 'terraced', 'farm', 'barn', 'studio', 'apartment',
  'building', 'plot', 'garage', 'office', 'retail', 'mixed-use',
]);

// Derive a best-effort address + property type + beds from the URL segments
// when the markdown gives no usable heading/link text.
function deriveFromUrl(town, tail, outwardPc) {
  const segs = (tail || '').split('/').filter(Boolean);
  let propType = '';
  let beds = null;
  const streetSegs = [];
  for (const seg of segs) {
    const bedM = seg.match(/^(\d+)-bed(room)?s?$/);
    if (bedM) { beds = parseInt(bedM[1], 10); continue; }
    if (TYPE_WORDS.has(seg)) { if (!propType) propType = titleCaseSlug(seg); continue; }
    streetSegs.push(seg);
  }
  const street = titleCaseSlug(streetSegs[0] || '');
  const townName = titleCaseSlug(town);
  const address = [street, townName, formatOutwardPostcode(outwardPc)].filter(Boolean).join(', ');
  return { address, propType, beds };
}

/**
 * Pick the soonest upcoming auction event from the events-page markdown.
 * Pairs each `#### … {DD} {Month} {YYYY}` date heading with the `[View Event]`
 * link that follows it (~230 chars later), keeps those with date >= today, and
 * returns the earliest.
 *
 * @param {string} markdown - events-page stealth markdown
 * @param {string} todayIso - 'YYYY-MM-DD'
 * @returns {{ eventUrl: string, auctionDateIso: string } | null}
 */
export function pickSoonestEvent(markdown, todayIso) {
  if (!markdown || typeof markdown !== 'string') return null;
  const BLOCK_RE = /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})[\s\S]{0,400}?\[View Event\]\((https?:\/\/[^)]*\/event\/[^)\s]+)\)/gi;
  let m;
  let best = null;
  while ((m = BLOCK_RE.exec(markdown)) !== null) {
    const day = m[1].padStart(2, '0');
    const mon = MONTHS[m[2].toLowerCase()];
    const year = m[3];
    if (!mon) continue;
    const iso = `${year}-${mon}-${day}`;
    const eventUrl = m[4];
    if (iso >= todayIso && (!best || iso < best.auctionDateIso)) {
      best = { eventUrl, auctionDateIso: iso };
    }
  }
  return best;
}

/**
 * Parse an event-page markdown into raw (snake_case, recogniser-shape) lots.
 * Anchors on the `/property/{id}/{pc}/{town}/{slug}` URL so it catches a lot
 * however it is wrapped (text link, image link, or bare), deduping by id.
 *
 * @param {string} markdown - event-page stealth markdown
 * @param {string} auctionDateIso - 'YYYY-MM-DD' applied to every lot in the event
 * @returns {Map<string, object>} keyed by lot id
 */
export function extractSymondsLotsFromMarkdown(markdown, auctionDateIso) {
  const lots = new Map();
  if (!markdown || typeof markdown !== 'string') return lots;

  // A lot's URL recurs (card image link, heading text link, "View Property"
  // CTA), and the image-wrapped link often appears BEFORE the heading that
  // carries the address. So collect every occurrence per lot id first, then
  // keep the best address (a real heading/link-text beats a URL-derived one)
  // and the first non-empty price/image across all of them.
  const acc = new Map();
  PROPERTY_URL_RE.lastIndex = 0;
  let m;
  while ((m = PROPERTY_URL_RE.exec(markdown)) !== null) {
    const id = m[1];
    const idx = m.index;
    const before = markdown.slice(Math.max(0, idx - 260), idx);
    const after = markdown.slice(idx, idx + 700);

    // Real address at this occurrence: a `[address](thisUrl)` text link wrapping
    // the URL, else the nearest `###`/`####` heading above it. '' for a CTA/image link.
    let realAddr = '';
    const linkM = before.match(/\[([^\]\n]{5,180})\]\(\s*$/);
    if (linkM && isRealAddressText(linkM[1])) realAddr = cleanText(linkM[1]);
    if (!realAddr) {
      const headings = [...before.matchAll(/#{2,4}\s*([^\n#][^\n]*?)\s*$/gm)];
      const lastHeading = headings.length ? headings[headings.length - 1][1] : '';
      if (isRealAddressText(lastHeading)) realAddr = cleanText(lastHeading);
    }

    const priceM = after.match(/£\s*([\d,]+)/);
    const price = priceM ? `£${priceM[1]}` : '';

    const imgWindow = markdown.slice(Math.max(0, idx - 500), idx + 200);
    const imgM = imgWindow.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+\.(?:jpe?g|png|webp)[^)\s]*)\)/i);
    const image = imgM ? imgM[1] : '';

    if (!acc.has(id)) {
      acc.set(id, {
        detailUrl: m[0],
        derived: deriveFromUrl(m[3], m[4], m[2]),
        realAddr,
        guide_price: price,
        image_url: image,
        statusText: after.toLowerCase(),
      });
    } else {
      const r = acc.get(id);
      if (!r.realAddr && realAddr) r.realAddr = realAddr;
      if (!r.guide_price && price) r.guide_price = price;
      if (!r.image_url && image) r.image_url = image;
    }
  }

  for (const [id, r] of acc) {
    const address = r.realAddr || r.derived.address;
    if (!address || address.length < 5) continue;

    // Status — upcoming-event lots are live; downgrade only on an explicit badge
    // with no guide (mirrors the propertysolvers recogniser).
    let lot_status = 'available';
    if (!r.guide_price) {
      const lower = r.statusText;
      if (/\bwithdrawn\b|\bpostponed\b/.test(lower)) lot_status = 'withdrawn';
      else if (/\bsold\s*prior\b|\bsold\b/.test(lower)) lot_status = 'sold';
      else if (/\bunsold\b|\bnot\s*sold\b/.test(lower)) lot_status = 'unsold';
    }

    const bullets = [];
    if (r.derived.propType) bullets.push(r.derived.propType);
    if (r.derived.beds) bullets.push(`${r.derived.beds} bedroom`);

    lots.set(id, {
      lot_number: null,
      address,
      guide_price: r.guide_price,
      property_type: r.derived.propType || '',
      bedrooms: r.derived.beds || null,
      tenure: '',
      image_url: r.image_url,
      detail_url: r.detailUrl,
      description: '',
      bullets,
      lot_status,
      auction_date: auctionDateIso || '',
    });
  }
  return lots;
}

/**
 * Scrape symondsandsampson via two stealth Firecrawl fetches and return
 * normalised rawLots (the same canonical shape scrape-stage hands to enrichStage).
 *
 * @param {string} [catalogueUrl] - stored catalogue URL; events page is used as the
 *   stable entry point. An explicit /event/ URL is honoured directly (skips tier 1).
 * @param {{ todayIso?: string }} [opts]
 * @returns {Promise<Array>} normalised lots (possibly empty)
 */
export async function scrapeSymondsAndSampson(catalogueUrl, opts = {}) {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);

  // If a specific event URL was supplied, scrape it directly; otherwise resolve
  // the soonest upcoming event from the stable events page (tier 1).
  let eventUrl;
  let auctionDateIso = '';
  if (catalogueUrl && /\/event\//.test(catalogueUrl)) {
    eventUrl = catalogueUrl;
  } else {
    const eventsRes = await scrapeWithFirecrawl(EVENTS_PAGE, { proxy: 'stealth' });
    const picked = pickSoonestEvent(eventsRes?.markdown || '', todayIso);
    if (!picked) {
      console.log('symondsandsampson: no upcoming event found in events-page markdown');
      return [];
    }
    eventUrl = picked.eventUrl;
    auctionDateIso = picked.auctionDateIso;
    console.log(`symondsandsampson: soonest event ${eventUrl} (${auctionDateIso})`);
  }

  // Tier 2 — scrape the event page and parse its lots.
  const eventRes = await scrapeWithFirecrawl(eventUrl, { proxy: 'stealth' });
  const rawMap = extractSymondsLotsFromMarkdown(eventRes?.markdown || '', auctionDateIso);
  console.log(`symondsandsampson: parsed ${rawMap.size} lots from ${eventUrl}`);

  const lots = [];
  for (const raw of rawMap.values()) {
    const lot = normaliseScrapedLot(raw, {
      house: 'symondsandsampson',
      catalogueUrl: eventUrl,
      extractionSource: 'firecrawl-stealth',
    });
    if (lot) lots.push(lot);
  }
  return lots;
}
