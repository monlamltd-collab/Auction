// lib/types/lot.js — Canonical Lot data contract.
//
// Single source of truth for:
//   - the columns the app reads from `public.lots`,
//   - the camelCase app-side lot shape consumers see,
//   - the transforms between scraper output → DB row → app object.
//
// This module is intentionally a leaf — no imports from lib/pipeline/, lib/harness/,
// lib/analysis.js, or any route. Helpers it needs are either inlined here or
// imported from lib/scraper/validation.js (also leaf-level).
//
// ═══ Naming rules ═══════════════════════════════════════════════════════════
//
// DB boundary: snake_case (Postgres / Supabase convention).
// App code:    camelCase, NO underscore prefix.
//
// Underscore-prefixed fields (`_dbId`, `_house`, `_auctionDate`, ...) are a
// LEGACY convention from the old `dbRowToFrontendLot` that public/app.js
// reads directly by string key. They are preserved verbatim here so the
// frontend keeps working without UI edits. They are RESERVED for internal
// metadata — provenance, observability, DB-internal identifiers — and NOT
// for user-facing lot attributes.
//
// Closed set of allowed underscore-prefixed fields:
//   _dbId             — primary key (lots.id)
//   _house            — house slug (lots.house) — frontend reads this
//   _catalogueUrl     — catalogue URL (lots.catalogue_url) — internal alias
//   _sourceUrl        — catalogue URL (lots.catalogue_url) — frontend alias
//   _auctionDate      — auction date (lots.auction_date) — frontend reads this
//   _searchText       — search-index payload (lots.search_text)
//   _lastSeenAt       — observability stamp (lots.last_seen_at)
//   _enrichment       — manifest JSONB blob (lots.enrichment_manifest)
//   _extractionSource — scraper provenance stamp set by normaliseScrapedLot
//
// New lot fields MUST use bare camelCase. Do NOT add to the underscore set.
//
// ═══ Field-name disputes resolved here ══════════════════════════════════════
//
// lot_number  →  app field is `lot`        (NOT lotNumber)
// guide_price →  app fields are `price` (numeric) + `priceText` (original)
// detail_url  →  app field is `url`
// bedrooms    →  app field is `beds`
// property_type → app field is `propType`
// lot_status  →  app field is `status` (the `lot_` prefix is dropped)
// auction_date → app field is `_auctionDate` (legacy underscore, see above)
//
// The pre-existing `normaliseLot()` in lib/pipeline/firecrawl-extract.js used
// different names mid-pipeline (`lotNumber`, `priceStr`, `lotStatus`,
// `auctionDate` without underscore). `normaliseScrapedLot()` exported below
// emits the canonical names directly, so there's ONE transformation step
// from raw scrape → app shape rather than two.
//
// ═══ Migration status ═══════════════════════════════════════════════════════
//
// This module REPLACES:
//   - lib/pipeline/lot-mappers.js (LOTS_SELECT, createDbRowToLot, dbRowToFrontendLot)
//   - the normaliseLot() half of lib/pipeline/firecrawl-extract.js
//
// Those two files carry deprecation banners pointing here. Consumers will be
// migrated to this module in Task 3 of the lot-contract consolidation. Until
// then, both paths co-exist — DO NOT delete the originals before all callers
// are migrated.

import { unwrapProxyImageUrl } from '../scraper/validation.js';
import { derivePriceStatus } from '../quality/lot-quality.js';

// ─── Inlined helper ────────────────────────────────────────────────────────
//
// Mirrors lib/enrichment.js:73 `extractPostcode`. Inlined to keep this module
// leaf-level. Keep behaviour in lock-step with the enrichment-side version.
function extractPostcode(address) {
  if (!address) return null;
  const m = address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
  return m ? m[0].toUpperCase().replace(/\s+/g, ' ') : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// DB COLUMN MANIFEST
// ═══════════════════════════════════════════════════════════════════════════
//
// Canonical list of `public.lots` columns the app routinely reads. Every name
// here was verified against information_schema on the live project on
// 2026-05-25. Identical to the previous lot-mappers.js LOTS_SELECT — kept
// intact deliberately so this consolidation is a pure refactor, not a
// behaviour change.
//
// LEAN REBUILD (migrations/rebuild-lots.sql, 2026-06-01): the lots table was
// stripped to columns that are displayed to the investor OR feed
// score/fundability OR are required system infrastructure (the "gate rule",
// enforced by tests/test-lot-columns.js). Renames carried data:
//   street_avg → comparable_price · epc_floor_area_sqm → floor_area_sqm ·
//   floor_plan_url → floor_plans (text→array). (field_sources kept as-is;
//   its →sources rename is deferred with the lot_events migration.)
// Dropped: raw_text, search_vector, est_annual_rent (derived), epc_date,
//   epc_floor_area_sqft (derived), epc_works_cost_mid, epc_works_summary,
//   os_classification, extracted_with, scraped_with, quality_score,
//   quality_issues, street_sales.
// DEFERRED (still present): sold_price — coupled to the lot_events /
//   post-auction-sweep machinery; removed in a later pass. (price_status is
//   now a first-class select column — it drives price-coverage gap accounting
//   and the Nil Reserve badge, 2026-06-12.)
//
// Live DB columns intentionally OMITTED from this select set:
//   id, enriched_at, first_seen_at, created_at, sources, uprn, property_key,
//   auction_id. They exist but aren't part of the standard API-rendering
//   contract; callers that need them expand their `.select()` explicitly.

export const LOT_COLUMNS = Object.freeze([
  'house:house_slug',   // Phase 2a: read the renamed slug column, keep the JS key `house` (PostgREST alias)
  'auctioneer',
  'lot_number',
  'url',
  'catalogue_url',
  'address',
  'postcode',
  'lat',
  'lng',
  'price',
  'price_text',
  'price_status',
  'prop_type',
  'beds',
  'tenure',
  'lease_length',
  'sqft',
  'condition',
  'image_url',
  'images',
  'floor_plans',
  'bullets',
  'units',
  'auction_date',
  'status',
  'epc_rating',
  'epc_score',
  'floor_area_sqm',
  'flood_zone',
  'flood_risk',
  'comparable_price',
  'street_sales_count',
  'below_market',
  'est_monthly_rent',
  'est_gross_yield',
  'score',
  'score_breakdown',
  'opps',
  'risks',
  'deal_type',
  'vacant',
  'title_split',
  'search_text',
  'enrichment_manifest',
  'value_estimate',
  'last_seen_at',
]);

// String form for `supabase.from('lots').select(LOTS_SELECT)`.
export const LOTS_SELECT = LOT_COLUMNS.join(', ');

// ═══════════════════════════════════════════════════════════════════════════
// FIELD-NAME CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════
//
// Source-of-truth string keys for fields that historically shifted name
// across the pipeline. Reference these instead of hardcoding strings so a
// future rename is mechanical.

export const FIELD_LOT_NUMBER = 'lot';            // NOT 'lotNumber'
export const FIELD_PRICE = 'price';                // numeric (parsed)
export const FIELD_PRICE_TEXT = 'priceText';       // original string e.g. "Guide £250,000+"
export const FIELD_PROP_TYPE = 'propType';         // NOT 'property_type'
export const FIELD_STATUS = 'status';              // NOT 'lotStatus'
export const FIELD_BEDS = 'beds';                  // NOT 'bedrooms'
export const FIELD_URL = 'url';                    // NOT 'detail_url'
export const FIELD_IMAGE_URL = 'imageUrl';
export const FIELD_HOUSE = '_house';                // legacy underscore prefix preserved for public/app.js
export const FIELD_SOURCE_URL = '_sourceUrl';       // legacy underscore prefix preserved for public/app.js
export const FIELD_AUCTION_DATE = '_auctionDate';   // legacy underscore prefix preserved for public/app.js
export const FIELD_EXTRACTION_SOURCE = '_extractionSource';

// ═══════════════════════════════════════════════════════════════════════════
// DB ROW → CANONICAL APP LOT
// ═══════════════════════════════════════════════════════════════════════════
//
// Consolidates the two legacy mappers:
//   - createDbRowToLot()  (factory variant with injected extractPostcode)
//   - dbRowToFrontendLot() (pure variant)
//
// Output is the UNION of both legacy mappers' fields, so existing internal
// consumers AND frontend API consumers keep working unchanged after Task 3
// migrates them here.
//
// Reconciliation choices made:
//   - `_catalogueUrl` and `_sourceUrl` both emitted (same value). The legacy
//     internal mapper used the former; the frontend mapper used the latter.
//     Both consumers keep their reads.
//   - `score`: returns `parseFloat(...)` or null (was `0` in the internal
//     variant, parseFloat-or-null in the frontend variant). Going with the
//     frontend behaviour because (a) null is a more correct "missing" marker
//     than 0, which is a valid score, and (b) downstream `lot.score || ...`
//     guards still work because both are falsy.
//   - `estGrossYield`: parseFloat'd (the internal variant returned the raw
//     Supabase NUMERIC string, which broke arithmetic for any consumer that
//     skipped its own parseFloat).
//   - `images`: included for all consumers (was only emitted by the frontend
//     variant). Internal consumers gain access; existing behaviour preserved.
//   - `_dbId`, `enrichedAt`, `rawText`: emitted unconditionally. They will be
//     undefined unless the caller's select expanded beyond LOTS_SELECT to
//     include id / enriched_at / raw_text. This matches pre-consolidation
//     behaviour for both legacy mappers.

export function dbRowToLot(row) {
  if (!row) return null;
  return {
    // ── Lot identity ──
    lot: row.lot_number,
    address: row.address,
    postcode: row.postcode || extractPostcode(row.address),
    url: row.url,

    // ── Pricing ──
    price: row.price,
    priceText: row.price_text,
    priceStatus: row.price_status,

    // ── Property attributes ──
    propType: row.prop_type,
    beds: row.beds,
    tenure: row.tenure,
    leaseLength: row.lease_length,
    sqft: row.sqft,
    condition: row.condition,
    imageUrl: row.image_url,
    images: Array.isArray(row.images) ? row.images : [],
    // floor_plan_url → floor_plans[] (lean rebuild). Emit floorPlans (canonical)
    // plus floorPlanUrl = first plan, for back-compat with public/app.js.
    floorPlans: Array.isArray(row.floor_plans) ? row.floor_plans : [],
    floorPlanUrl: (Array.isArray(row.floor_plans) && row.floor_plans[0]) || null,
    bullets: row.bullets || [],
    units: row.units || 0,

    // ── Status ──
    status: row.status || 'available',

    // ── EPC ──
    epcRating: row.epc_rating,
    epcScore: row.epc_score,
    // epc_floor_area_sqm → floor_area_sqm (lean rebuild). Emit floorAreaSqm
    // (canonical) plus epcFloorAreaSqm for back-compat with existing readers.
    floorAreaSqm: row.floor_area_sqm ?? null,
    epcFloorAreaSqm: row.floor_area_sqm ?? null,

    // ── Flood ──
    floodZone: row.flood_zone,
    floodRiskLevel: row.flood_risk,

    // ── Comparables ──
    // street_avg → comparable_price (lean rebuild). Emit comparablePrice
    // (canonical) plus streetAvg for back-compat with public/app.js.
    comparablePrice: row.comparable_price,
    streetAvg: row.comparable_price,
    streetSalesCount: row.street_sales_count,

    // ── Estimates ──
    belowMarket: row.below_market,
    estMonthlyRent: row.est_monthly_rent,
    // est_annual_rent dropped — derived on read from the monthly figure.
    estAnnualRent: (typeof row.est_monthly_rent === 'number') ? row.est_monthly_rent * 12 : null,
    estGrossYield: row.est_gross_yield != null ? parseFloat(row.est_gross_yield) : null,

    // ── Scoring ──
    score: row.score != null ? parseFloat(row.score) : null,
    scoreBreakdown: row.score_breakdown || [],
    opps: row.opps || [],
    risks: row.risks || [],
    dealType: row.deal_type,

    // ── Flags ──
    vacant: row.vacant,
    titleSplit: row.title_split,

    // ── Value estimate ──
    valueEstimate: row.value_estimate || null,

    // ── Display name ──
    // auctioneer: human-readable house name (lean rebuild). `house` stays the
    // canonical slug; this is the label shown to investors.
    auctioneer: row.auctioneer || null,

    // ── Legacy internal-mapper-only field (undefined under canonical LOTS_SELECT) ──
    enrichedAt: row.enriched_at,

    // ── Internal metadata (closed underscore set — see header) ──
    _dbId: row.id,
    _house: row.house,
    _catalogueUrl: row.catalogue_url,
    _sourceUrl: row.catalogue_url,
    _auctionDate: row.auction_date,
    _searchText: row.search_text || '',
    _lastSeenAt: row.last_seen_at || null,
    _enrichment: row.enrichment_manifest || null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CANONICAL APP LOT → DB ROW
// ═══════════════════════════════════════════════════════════════════════════
//
// Inverse of dbRowToLot. Reads camelCase, returns a snake_case object
// suitable for `supabase.from('lots').upsert(...)`.
//
// Skips fields whose values are `undefined` — the caller controls which
// columns to touch via the input object's key set. Upserting with
// `{ price: undefined }` would clobber an existing price.

export function lotToDbRow(lot) {
  if (!lot) return null;
  const out = {};
  const set = (col, val) => { if (val !== undefined) out[col] = val; };

  // ── Identity / location ──
  set('house', lot._house);
  set('auctioneer', lot.auctioneer);
  set('lot_number', lot.lot);
  set('url', lot.url);
  set('catalogue_url', lot._sourceUrl ?? lot._catalogueUrl);
  set('address', lot.address);
  set('postcode', lot.postcode);
  set('lat', lot.lat);
  set('lng', lot.lng);

  // ── Pricing ──
  set('price', lot.price);
  set('price_text', lot.priceText);

  // ── Property attributes ──
  set('prop_type', lot.propType);
  set('beds', lot.beds);
  set('tenure', lot.tenure);
  set('lease_length', lot.leaseLength);
  set('sqft', lot.sqft);
  set('condition', lot.condition);
  set('image_url', lot.imageUrl);
  set('images', lot.images);
  // floor_plan_url → floor_plans[] (lean rebuild). Accept either a floorPlans
  // array or a legacy single floorPlanUrl.
  if (lot.floorPlans !== undefined) set('floor_plans', lot.floorPlans);
  else if (lot.floorPlanUrl !== undefined) set('floor_plans', lot.floorPlanUrl ? [lot.floorPlanUrl] : null);
  set('bullets', lot.bullets);
  set('units', lot.units);

  // ── Date / status ──
  set('auction_date', lot._auctionDate);
  set('status', lot.status);

  // ── EPC ──
  set('epc_rating', lot.epcRating);
  set('epc_score', lot.epcScore);
  // epc_floor_area_sqm → floor_area_sqm (lean rebuild). epc_date,
  // epc_floor_area_sqft, epc_works_* dropped.
  set('floor_area_sqm', lot.floorAreaSqm ?? lot.epcFloorAreaSqm);

  // ── Flood ──
  set('flood_zone', lot.floodZone);
  set('flood_risk', lot.floodRiskLevel);

  // ── Comparables / estimates ──
  // street_avg → comparable_price (lean rebuild). street_sales,
  // est_annual_rent dropped.
  set('comparable_price', lot.comparablePrice ?? lot.streetAvg);
  set('street_sales_count', lot.streetSalesCount);
  set('below_market', lot.belowMarket);
  set('est_monthly_rent', lot.estMonthlyRent);
  set('est_gross_yield', lot.estGrossYield);

  // ── Scoring ──
  set('score', lot.score);
  set('score_breakdown', lot.scoreBreakdown);
  set('opps', lot.opps);
  set('risks', lot.risks);
  set('deal_type', lot.dealType);

  // ── Flags / freeform ──
  set('vacant', lot.vacant);
  set('title_split', lot.titleSplit);
  set('value_estimate', lot.valueEstimate);
  set('search_text', lot._searchText);

  // ── Observability ──
  // enrichment_manifest kept (per-scrape outcomes); quality_score/issues and
  // raw_text dropped in the lean rebuild.
  set('enrichment_manifest', lot._enrichment);

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCRAPE-TIME NORMALISATION
// ═══════════════════════════════════════════════════════════════════════════
//
// Replaces normaliseLot() from lib/pipeline/firecrawl-extract.js. Same
// validation + parsing logic, but emits the canonical app-side shape
// directly (camelCase, matching dbRowToLot's output where applicable) so
// the persist layer can read either a freshly-scraped lot or a DB-loaded
// lot with the same field names.
//
// Returns null for lots whose address fails `looksLikeRealAddress` validation
// — callers must filter nulls and log the rejection counter.

const UK_POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

// Phrases the LLM has historically confused for addresses — property-type
// descriptors, banner text, viewing-button labels, status labels. Lots
// whose `address` matches one of these are extraction failures, not real
// lots; they pollute property_key dedup and the lots table generally.
const PLACEHOLDER_ADDRESS_PATTERNS = [
  /^(?:a\s+)?(?:one|two|three|four|five|six)\s+bed(?:room)?\b/i,
  /^\d\s*bed(?:room)?\s+(?:house|flat|apartment|maisonette|bungalow|terrace)/i,
  /virtual\s+viewing/i,
  /sold\s+prior\s+to\s+auction/i,
  /national\s+online\s+auction/i,
  /click\s+to\s+view/i,
  /^(?:lot|property)\s+\d+\s*$/i,
  /^view\s+(?:property|details|lot)/i,
  /^bidding\s+(?:now\s+)?open/i,
  /^add\s+to\s+(?:calendar|favourites|favorites|shortlist|saved|watchlist)\b/i,
  /^(?:share|email|print|download)\s+(?:this\s+)?(?:property|lot|listing|page)?\b/i,
  /^register(?:\s+(?:to\s+bid|here|now|interest))?\s*$/i,
  /^save\s+(?:property|search|lot)\b/i,
  /^enquire\s+(?:now|about)?\b/i,
  /^looking\s+to\s+bid\b/i,
  /^(?:next|upcoming|future)\s+auction\b/i,
];

// EIG white-label CMS embeds catalogue nav state into every lot card href.
// The path uniquely identifies the lot; the query string is filter state
// that varies by which catalogue page the card was rendered on. Strip ONLY
// these known nav params — many other houses use `?id=N` style URLs where
// the query string IS the canonical identifier (countrywide,
// futureauctions, sharpesauctions, venmore, etc.). Stripping `?` wholesale
// for those collapses every lot to the same path-only URL.
const EIG_CATALOGUE_PARAMS = ['page', 'bid', 'showstc', 'orderby', 'extra_2', 'extra_2!'];

function stripEigCatalogueParams(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const u = new URL(rawUrl);
    for (const p of EIG_CATALOGUE_PARAMS) u.searchParams.delete(p);
    return u.toString();
  } catch {
    const qIdx = rawUrl.indexOf('?');
    if (qIdx === -1) return rawUrl;
    const path = rawUrl.slice(0, qIdx);
    const params = new URLSearchParams(rawUrl.slice(qIdx + 1));
    for (const p of EIG_CATALOGUE_PARAMS) params.delete(p);
    const remaining = params.toString();
    return remaining ? `${path}?${remaining}` : path;
  }
}

/**
 * True if `addr` looks like a real postal address. False for placeholder
 * text, banners, property-type descriptors, button labels.
 *
 * Rules, in order:
 *   1. < 6 chars → too short.
 *   2. Contains a UK postcode → strong positive, accept.
 *   3. Matches a known placeholder pattern → reject.
 *   4. No digit AND length < 12 → too vague (e.g. "A street").
 *   5. Otherwise → accept tentatively. OS Places enrichment may
 *      correct/null malformed real addresses downstream.
 */
export function looksLikeRealAddress(addr) {
  if (!addr || typeof addr !== 'string') return false;
  const trimmed = addr.trim();
  if (trimmed.length < 6) return false;
  if (UK_POSTCODE_RE.test(trimmed)) return true;
  if (PLACEHOLDER_ADDRESS_PATTERNS.some(rx => rx.test(trimmed))) return false;
  if (!/\d/.test(trimmed) && trimmed.length < 12) return false;
  return true;
}

function parsePrice(str) {
  if (!str) return null;
  const m = str.replace(/,/g, '').match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

/**
 * Normalise a raw scraper-emitted lot into the canonical app-side shape.
 *
 * @param {object} raw - Raw lot from Firecrawl JSON extract or markdown recogniser.
 *   Expected keys: lot_number, address, guide_price, property_type, bedrooms,
 *   tenure, image_url, detail_url, description, lot_status, auction_date,
 *   bullets (recogniser-only).
 * @param {object} ctx - Scrape context.
 * @param {string} ctx.house - Canonical house slug.
 * @param {string} ctx.catalogueUrl - Catalogue page the lot was scraped from.
 * @param {string} [ctx.extractionSource='firecrawl-json'] - Provenance label.
 *   Set to 'firecrawl-markdown' for recogniser-returned lots, etc.
 * @returns {object|null} Canonical lot object, or null if address validation
 *   fails (caller must filter nulls + log the rejection count).
 */
export function normaliseScrapedLot(raw, { house, catalogueUrl, extractionSource = 'firecrawl-json' } = {}) {
  if (!raw || !looksLikeRealAddress(raw.address)) return null;
  const price = parsePrice(raw.guide_price);
  // Bullets policy: prefer recogniser-supplied array (typically 5–7 rich
  // bullets per lot); fall back to wrapping `description` in a single-
  // element array when only the JSON extractor ran. All downstream
  // consumers (validation status/lease checks, persist search-text join,
  // scoring signal regex) treat bullets as Array<string> via `.join(...)`,
  // so multi-element arrays are strictly richer signal.
  const bullets = Array.isArray(raw.bullets) && raw.bullets.length > 0
    ? raw.bullets
    : (raw.description ? [raw.description] : []);

  return {
    address: raw.address.trim(),
    lot: raw.lot_number || null,
    price,
    priceText: raw.guide_price || '',
    // Stamp the structured price status at the single funnel every in-memory
    // scraped lot passes through, so coverage/quality see it without a
    // derive-on-read fallback (dbRowToLot carries the persisted value).
    priceStatus: derivePriceStatus({ price, priceText: raw.guide_price || '', status: raw.lot_status || '' }),
    beds: raw.bedrooms || null,
    tenure: raw.tenure || '',
    imageUrl: unwrapProxyImageUrl(raw.image_url || ''),
    url: stripEigCatalogueParams(raw.detail_url || ''),
    bullets,
    propType: raw.property_type || '',
    status: raw.lot_status || '',
    _house: house,
    _catalogueUrl: catalogueUrl,
    _sourceUrl: catalogueUrl,
    _auctionDate: raw.auction_date || '',
    _extractionSource: extractionSource,
  };
}
