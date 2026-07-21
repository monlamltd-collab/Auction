// ═══════════════════════════════════════════════════════════════
// lib/scraper/pattinson.js — Pattinson in-page paginated catalogue branch.
//
// pattinson.co.uk/auction/property-search is a Next.js + Payload CMS site
// behind Cloudflare. The catalogue is ~1,780 lots across 90 fixed pages of 20
// (`pageSize`/`limit`/`perPage`/`size`/`take`/`count` are all ignored — tested
// 2026-07-21), so the render path capped at MAX_PUPPETEER_PAGES=15 could only
// ever ship 300/1,783 ≈ 17%. Raising that global cap is not on the table (it is
// the fleet's memory guard) and 90 sequential Cloudflare-solving renders would
// blow the render deadline regardless.
//
// The fix is a bespoke scraper, modelled on lib/scraper/allsop.js and
// lib/scraper/underthehammer.js: a self-contained producer of already-normalised
// `rawLots`, dispatched from scrape-stage.js on `paginateAs:'pattinson_api'`,
// bypassing the Crawlee→Gemini extract path entirely. Zero AI, zero credits.
//
// ── Where the lots come from ───────────────────────────────────────────────
// The site's own client paginates by POSTing to /api/property/list-search and
// rendering the JSON. That endpoint IS the source of truth — richer and far
// smaller than the SSR HTML (66KB/page vs 1.5MB) and it carries the auction
// deadline, the sold flag and the whole image gallery as structured fields.
// It is NOT publicly reachable: a POST from a datacenter IP gets Cloudflare's
// 403 "Just a moment" interstitial, and the cf_clearance cookie is HttpOnly and
// fingerprint-bound so it cannot be lifted into a node fetch. So we render page
// 1 ONCE through Crawlee — clearing Cloudflare and leaving a warm session — and
// walk the endpoint from inside that page context. The walk itself lives in
// crawlee.js's host-gated IN_PAGE_PAGINATORS hook; this module owns what the
// records MEAN.
//
// (The dossier's earlier plan was to regex the fetched HTML. That still works
// but is strictly worse: 90 × 1.5MB in flight, no deadline field, no sold flag,
// and a card DOM with no clean per-card container. The JSON endpoint was found
// by watching what the client itself calls on a page-2 click — the earlier
// "no public JSON API" finding came from GET-probing guessed /api/… paths,
// which do 404; this one is a POST and needs the exact body.)
//
// ── The anti-leak contract ─────────────────────────────────────────────────
// The 1,783-record catalogue is NOT all live. On 2026-07-21 it carried 59
// records whose auction deadline had already passed (4 of them flagged sold) —
// Pattinson leaves an ended online auction in the search index for a while.
// Shipping those as `available` is the worst outcome available to this scraper,
// so two independent gates must BOTH pass:
//   1. `isSold !== true` — the source's own sale flag.
//   2. the auction `deadline` is absent, or strictly in the future.
// Gate 2 compares full timestamps, not dates: a lot that ended at 09:00 today
// is ended, and a date-only gate would ship it. Gate 1 exists because we do not
// want to depend on a single field; on the live feed all 4 sold records were
// also past-dated, so either gate alone would have held — which is the point.
//
// A missing deadline is LIVE, not ended: 28 records carry `isOnlineAuction:false`
// and no deadline — traditional (in-room) auction lots with a guide price.
// Verified on their detail pages: schema.org availability = InStock, canBid =
// true. Dropping them would be 28 lots of self-inflicted under-recall. They are
// emitted with an empty auction_date, which routes/search.js already handles
// (`auction_date.is.null` is inside the live filter, with a 14-day stale-synth
// fallback for lots that stop being re-seen).
//
// ── Why the headline never becomes a bullet ────────────────────────────────
// 646 of 1,783 headlines read "Being Sold via Secure Sale Online Bidding".
// normaliseLotStatuses (lib/scraper/validation.js) re-greps `bullets` for
// /\bSOLD\b/ and demotes any matching 'available' lot, so folding the headline
// into bullets would have marked 36% of the house sold. Bullets are curated
// structured facts only; the narrative goes to `description`, which that check
// does not read. normaliseScrapedLot falls `description` back INTO bullets when
// bullets is empty, so buildBullets guarantees at least one entry.
// ═══════════════════════════════════════════════════════════════

import { normaliseScrapedLot } from '../types/lot.js';
import { scrapeWithCrawlee } from './crawlee.js';
import { setLastExtractorUsed, setLastScrapeEngine } from './state.js';
import { fireAlert } from '../harness/alert-router.js';
import { recallGateAlert } from '../pipeline/recall-gate.js';

export const PATTINSON_CATALOGUE_URL = 'https://www.pattinson.co.uk/auction/property-search';

const MAX_IMAGES_PER_LOT = 8;   // mirrors image-extract.js MAX_IMAGES_PER_LOT

/** Collapse whitespace and strip a trailing comma the source leaves on some fields. */
function cleanText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * ISO date (YYYY-MM-DD) of the lot's auction deadline, or '' when the source
 * publishes none (traditional in-room lots).
 */
export function auctionDateIso(item) {
  const iso = String(item?.deadline || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
}

/**
 * True when a record is a CURRENT lot. Both gates must pass — see the
 * anti-leak contract in the file header.
 *
 * @param {object} item - raw /api/property/list-search record
 * @param {number} nowMs - epoch ms, injected so the gate is testable
 */
export function isCurrentPattinsonLot(item, nowMs) {
  if (!item || item.id == null) return false;
  if (item.isSold === true) return false;
  if (!item.deadline) return true;              // no online deadline → in-room lot, live
  const ends = Date.parse(item.deadline);
  if (!Number.isFinite(ends)) return false;     // unparseable date → do not guess, drop
  return ends > nowMs;
}

/**
 * Full postal address from the source's structured address object.
 * houseNameNumber joins the street with a SPACE, not a comma — the source
 * already embeds its own separator when it needs one ("First Floor Flat, " +
 * "29a Hastings Road"), and a bare number reads as "10 Linden Road".
 */
export function buildAddress(address) {
  const a = address || {};
  const line1 = [cleanText(a.houseNameNumber), cleanText(a.street)].filter(Boolean).join(' ').trim();
  return [line1, cleanText(a.locality), cleanText(a.city), cleanText(a.county), cleanText(a.postcode)]
    .map(part => part.replace(/,\s*$/, '').trim())
    .filter(Boolean)
    .filter((part, i, arr) => arr.findIndex(p => p.toLowerCase() === part.toLowerCase()) === i)
    .join(', ');
}

/**
 * Curated structured facts. NEVER the headline — see the file header.
 * Guaranteed non-empty so normaliseScrapedLot never falls the narrative back
 * into bullets (which normaliseLotStatuses would then read as a sold badge).
 */
export function buildBullets(item) {
  const parking = (Array.isArray(item?.parkingTypes) ? item.parkingTypes : [])
    .map(cleanText).filter(p => p && !/^none$/i.test(p));
  const tenure = cleanText(item?.tenure);
  const bullets = [
    cleanText(item?.propertyTypeName),
    item?.bedrooms > 0 ? `${item.bedrooms} bedroom${item.bedrooms === 1 ? '' : 's'}` : '',
    item?.bathrooms > 0 ? `${item.bathrooms} bathroom${item.bathrooms === 1 ? '' : 's'}` : '',
    item?.receptions > 0 ? `${item.receptions} reception${item.receptions === 1 ? '' : 's'}` : '',
    // 'Unknown' is the source's null, not a tenure. 'ShareOfFreehold' is real.
    tenure && !/^unknown$/i.test(tenure) ? tenure.replace(/([a-z])([A-Z])/g, '$1 $2') : '',
    parking.length ? `${parking.join(', ')} parking` : '',
    item?.hasGarden === true ? 'Garden' : '',
    item?.chainFree === true ? 'Chain free' : '',
  ].filter(Boolean);
  // Emptiness guard: salesDescription ("2 bed flat to buy in NE8") is present on
  // every record and — unlike the headline — carries no status vocabulary.
  if (bullets.length === 0 && cleanText(item?.salesDescription)) bullets.push(cleanText(item.salesDescription));
  return bullets;
}

/**
 * Map one API record to the raw snake_case shape `normaliseScrapedLot` expects.
 * Pure — no network, no clock.
 */
export function mapPattinsonItem(item) {
  const price = typeof item?.price === 'number' && item.price > 0 ? item.price : null;
  // priceDescription is the source's own label ("Starting Bid" / "Guide Price" /
  // "Offers Over"). Keeping it in priceText is what lets derivePriceStatus
  // classify these as `starting_bid` rather than mislabelling them as a guide.
  const label = cleanText(item?.priceDescription);
  const guide = price ? `${label ? `${label} ` : ''}£${price.toLocaleString('en-GB')}`.trim() : '';

  const gallery = (Array.isArray(item?.propertyImages) ? item.propertyImages : [])
    .map(p => (typeof p === 'string' ? p : p?.image))
    .filter(u => typeof u === 'string' && /^https?:\/\//i.test(u));
  const hero = (typeof item?.image === 'string' && /^https?:\/\//i.test(item.image)) ? item.image : gallery[0] || '';
  const images = [hero, ...gallery].filter(Boolean)
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .slice(0, MAX_IMAGES_PER_LOT);

  return {
    // The source publishes no lot numbers (its cards render none) — null is the
    // honest value. Dedup is on `url`, which is stable and id-derived.
    lot_number: null,
    address: buildAddress(item?.address),
    guide_price: guide,
    detail_url: item?.id != null ? `https://www.pattinson.co.uk/property/${item.id}` : '',
    image_url: hero,
    images,
    bedrooms: item?.bedrooms > 0 ? item.bedrooms : null,
    tenure: /^unknown$/i.test(cleanText(item?.tenure)) ? '' : cleanText(item?.tenure),
    property_type: cleanText(item?.propertyTypeName),
    // The marketing headline is the only prose the catalogue endpoint carries.
    // The daily narrative sweep replaces it with the full detail-page text.
    description: cleanText(item?.headline),
    bullets: buildBullets(item),
    // Only current records are ever mapped, so 'available' is always correct
    // here. Guarded by isCurrentPattinsonLot at the single call site below.
    lot_status: 'available',
    auction_date: auctionDateIso(item),
  };
}

/**
 * Filter → map → normalise. Pure (clock injected), so the recall and
 * no-ended-leak guarantees are unit-testable without the network.
 *
 * @returns {Array<object>} canonical app-side lots (already through normaliseScrapedLot)
 */
export function extractPattinsonLots(items, { nowMs, catalogueUrl = PATTINSON_CATALOGUE_URL } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const lots = [];
  const seen = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    if (!isCurrentPattinsonLot(item, now)) continue;
    const id = String(item.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const raw = mapPattinsonItem(item);
    const lot = normaliseScrapedLot(raw, {
      house: 'pattinson',
      catalogueUrl,
      extractionSource: 'pattinson-inpage-api',
    });
    if (!lot) continue;
    // normaliseScrapedLot carries the hero image only; the endpoint hands us the
    // whole gallery, so pass it through rather than making multi-image-sweep
    // render ~1,700 detail pages for data we already hold.
    if (raw.images.length) lot.images = raw.images;
    lots.push(lot);
  }
  return lots;
}

/**
 * Scrape-stage entry point. Returns already-normalised lots, or [] on failure —
 * never throws (scrape-stage treats 0 lots as a regression and alerts).
 *
 * @param {string} baseUrl - catalogue URL (rewriteUrl forces the canonical one)
 * @param {object} deps - injected for tests: { scrapeWithCrawlee, nowMs }
 */
export async function scrapePattinson(baseUrl = PATTINSON_CATALOGUE_URL, deps = {}) {
  const render = deps.scrapeWithCrawlee || scrapeWithCrawlee;
  try {
    const result = await render(baseUrl);
    const data = result?.inPageData;
    if (!data) {
      // The host-gated hook in crawlee.js did not run — a URL/host mismatch or a
      // render that fell through to another engine. Loud, not silent.
      console.log(`pattinson: render returned no inPageData for ${baseUrl} — in-page paginator did not run`);
      return [];
    }
    if (data.error) console.log(`pattinson: in-page walk reported "${data.error}" (stopped: ${data.stopped})`);
    if (!Array.isArray(data.items) || data.items.length === 0) {
      console.log(`pattinson: in-page walk returned no records (stopped: ${data.stopped})`);
      return [];
    }
    const lots = extractPattinsonLots(data.items, { nowMs: deps.nowMs, catalogueUrl: baseUrl });
    const ended = data.items.length - lots.length;
    console.log(`pattinson: ${lots.length} current lots from ${data.items.length}/${data.total ?? '?'} records across ${data.fetched}/${data.pageCount ?? '?'} pages (${ended} ended/rejected dropped)`);
    // ── THE 100% COMMANDMENT — walk-completeness gate ──
    // Bespoke scrapers bypass the crawlee recall gate, so a truncated walk (the
    // budget ran out, or a page 500'd mid-batch) would otherwise ship a partial
    // in silence. The source states its own denominator, so measure against it:
    // records WALKED vs records ADVERTISED. Ended lots are dropped downstream by
    // the anti-leak gate and are not a coverage miss, which is why this counts
    // records rather than emitted lots.
    fireAlert(recallGateAlert({
      house: 'pattinson',
      recall: data.total > 0 ? data.items.length / data.total : null,
      lots: data.items.length,
      sentinelLots: data.total || 0,
      reason: `in-page walk stopped: ${data.stopped}`,
      engine: 'crawlee-inpage',
      extra: { pagesFetched: data.fetched, pageCount: data.pageCount, currentLots: lots.length, endedDropped: ended, walkError: data.error || null },
    })).catch(() => {});
    setLastScrapeEngine('crawlee');
    setLastExtractorUsed('api');
    return lots;
  } catch (e) {
    console.log(`pattinson: scrape failed: ${e.message}`);
    return [];
  }
}
