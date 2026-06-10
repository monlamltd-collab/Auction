// lib/pipeline/persist-lots.js — Upsert lots to Supabase with merge-safe field preservation
import { supabase } from '../supabase.js';
import { normaliseUrl, findAuctionDateInBullets } from '../utils.js';
import { createHash } from 'node:crypto';
import { canonicaliseHouseSlug, getHouseDisplayName } from '../houses.js';
import { getLotsForCatalogue } from './lot-lookup.js';
import { writeSnapshot, getLatestSnapshot, buildLotUrlSet } from './snapshots.js';
import { selectPruneCandidatesFromSnapshot, detectScrapeRegression } from './prune-from-snapshot.js';
import {
  LOT_EVENT_TYPES,
  buildLotEvent,
  buildVanishedEvent,
  diffLotEvents,
  insertLotEvents,
} from './lot-events.js';
import {
  PIPELINE_EVENT_TYPES,
  emitPipelineEvent,
} from './pipeline-events.js';

const JUNK_LOT_PATTERN = /^(I'd like to|Property search|Popular|Auction Dates|Register to bid|Information|\dBid Basket|Cookie|Privacy)/i;

// ── Auction-calendar cache (URL index + house index) ───────────────────
// upsertToLotsTable() runs once per house per scrape cycle. Before this
// cache, each call fetched the whole auction_calendar table (~237 rows)
// just to find one matching URL — 173 houses × 237 rows = ~41k row reads
// per full cycle. Cache the indices for 5 minutes so a single full cycle
// reads it once. Calendar-mutating callers (the auction-watcher) invalidate
// via _invalidateCalendarCache() so brand-new auction entries don't have
// to wait out the TTL.
//
// Move 2 / Follow-up E (single-cal fallback): when a lot's catalogue_url
// doesn't match any calendar URL (the url_mismatch cohort — landwood,
// mccartneys, buttersjohnbee, etc), but the house has EXACTLY ONE calendar
// row, attribute the lot to that row. This is safe (no ambiguity) and
// covers the scraper-side-redirect cases without changing the scraper.
//
// Move 2 / Follow-up F (always-on fallback): generalised version of the
// single-cal rule for houses that have ONE always_on row PLUS one or more
// specific-date rows. The always_on row is the conceptual "rolling /
// umbrella" auction for that house — a safe attribution when the URL
// doesn't match any specific-date row.
//
// Houses with multiple always_on rows (sdl umbrella post-PR-#32) get NO
// fallback — attribution would be ambiguous.
const CAL_CACHE_TTL_MS = 5 * 60 * 1000;
let _calCache = null;          // { urlMap: Map<normalisedUrl,{date,id}>, houseMap: Map<house_slug, [{date,id,status}]> }
let _calCacheBuiltAt = 0;

async function getCalendarDateMap() {
  const now = Date.now();
  if (_calCache && (now - _calCacheBuiltAt) < CAL_CACHE_TTL_MS) {
    return _calCache;
  }
  const urlMap = new Map();
  const houseMap = new Map();
  try {
    const { data } = await supabase
      .from('auction_calendar')
      .select('id, house_slug, url, date, status')
      .order('date', { ascending: true });
    for (const r of data || []) {
      const k = normaliseUrl(r.url);
      // Earliest date wins for a given URL — order ASC means the first
      // .set() call is also the earliest, and re-set is a no-op only if
      // we use Map.has() guard. Use it.
      if (k && !urlMap.has(k)) urlMap.set(k, { date: r.date, id: r.id });
      if (r.house_slug) {
        if (!houseMap.has(r.house_slug)) houseMap.set(r.house_slug, []);
        houseMap.get(r.house_slug).push({ date: r.date, id: r.id, status: r.status || null });
      }
    }
  } catch { /* non-fatal — empty maps */ }
  _calCache = { urlMap, houseMap };
  _calCacheBuiltAt = now;
  return _calCache;
}

/**
 * Resolve a (house, catalogueUrl) pair to a calendar entry.
 *
 * Lookup order:
 *  1. URL match against the calendar's normalised URL index — exact key.
 *  2. House has EXACTLY ONE calendar row → use it (Follow-up E).
 *  3. House has MULTIPLE rows but EXACTLY ONE is `status='always_on'` →
 *     use the always_on row (Follow-up F). The always_on row is the
 *     rolling/umbrella auction for the house; safer fallback than a
 *     specific-date row when the URL doesn't match.
 *
 * Houses with multiple always_on rows (sdl umbrella) get NO fallback —
 * attribution would be ambiguous.
 *
 * Pure-ish: takes the cached calendar map (built by getCalendarDateMap)
 * + (house, catalogueUrl) and returns the entry. Exported for tests.
 */
export function resolveCalendarEntry(calMap, house, catalogueUrl) {
  if (!calMap) return null;
  const direct = calMap.urlMap?.get(normaliseUrl(catalogueUrl)) || null;
  if (direct) return direct;
  if (!house || !calMap.houseMap) return null;
  const rows = calMap.houseMap.get(house);
  if (!rows || rows.length === 0) return null;
  // Single-cal fallback (Follow-up E)
  if (rows.length === 1) return rows[0];
  // Always-on fallback (Follow-up F): exactly one always_on row → use it.
  const alwaysOnRows = rows.filter(r => r.status === 'always_on');
  if (alwaysOnRows.length === 1) return alwaysOnRows[0];
  return null;
}

/**
 * Drop the cached calendar map — call this after writing to
 * auction_calendar so the next upsert sees the fresh state without
 * waiting out the TTL.
 */
export function _invalidateCalendarCache() {
  _calCache = null;
  _calCacheBuiltAt = 0;
}

// ═══════════════════════════════════════════════════════════════
// Pure helpers — exported so tests can verify them in isolation.
// ═══════════════════════════════════════════════════════════════

/**
 * Compute a stable 16-char SHA-1 fingerprint of a lot's price/status state.
 * Used to detect "did anything meaningful change?" between scrapes — drives
 * append-only inserts to the lot_history table.
 *
 * Fields included: price, status, sold_price, bullets_count, image_count.
 * A bullets text edit that doesn't change the count won't trigger a snapshot;
 * that's intentional — we don't want to store every typo fix as history.
 *
 * @param {object} row - { price, status, sold_price, bullets_count, image_count }
 * @returns {string} 16-char hex
 */
export function computeSnapshotHash(row) {
  const fingerprint = [
    row.price ?? '',
    row.status ?? '',
    row.sold_price ?? '',
    row.bullets_count ?? 0,
    row.image_count ?? 0,
  ].join('|');
  return createHash('sha1').update(fingerprint).digest('hex').slice(0, 16);
}

/**
 * Deep-merge field_sources maps: prior stamps survive when the current run
 * didn't re-stamp the same field. New stamps win on key collision.
 *
 *   merge({beds:'epc'}, {tenure:'os-places'}) → {beds:'epc', tenure:'os-places'}
 *   merge({beds:'epc'}, {beds:'gemini-detail'}) → {beds:'gemini-detail'}
 *   merge(null, {beds:'epc'}) → {beds:'epc'}
 *
 * @param {object|null|undefined} existing - prior provenance (from DB)
 * @param {object|null|undefined} current  - this scrape's provenance
 * @returns {object} merged map (always a fresh object — no mutation)
 */
export function mergeFieldSources(existing, current) {
  const e = (existing && typeof existing === 'object') ? existing : {};
  const c = (current && typeof current === 'object') ? current : {};
  return { ...e, ...c };
}


// Build a complete natural-language snapshot of a lot for search.
// Everything goes in — the intelligence is in the QUERY strategy, not the storage.
// Structured queries (price, tenure, beds) hit formal columns via SQL.
// This blob is searched only for things that don't map to columns.
function buildSearchText(lot) {
  const parts = [];

  if (lot.address) parts.push(lot.address);
  if (lot.postcode) parts.push(lot.postcode);

  const typeDesc = [lot.beds ? `${lot.beds} bed` : '', lot.propType || '', lot.tenure || ''].filter(Boolean).join(' ');
  if (typeDesc) parts.push(typeDesc);
  if (lot.sqft) parts.push(`${lot.sqft} sqft`);
  if (lot.leaseLength) parts.push(`${lot.leaseLength} year lease`);
  if (lot.units && lot.units > 1) parts.push(`${lot.units} units`);
  if (lot.condition) parts.push(lot.condition);
  if (lot.vacant) parts.push('Vacant possession');
  if (lot.dealType) parts.push(lot.dealType);
  if (lot.price) parts.push(`Guide £${lot.price.toLocaleString()}`);
  if (lot.streetAvg) parts.push(`Street avg £${lot.streetAvg.toLocaleString()}`);
  if (lot.belowMarket) parts.push(`${lot.belowMarket}% below market value`);
  if (lot.estGrossYield) parts.push(`Yield ${lot.estGrossYield}%`);
  if (lot.titleSplit) parts.push('Title split potential');
  if (lot.epcRating) parts.push(`EPC ${lot.epcRating}`);
  if (lot.floodRiskLevel) parts.push(`Flood risk ${lot.floodRiskLevel}`);
  if (lot.opps && lot.opps.length) parts.push(lot.opps.join('. '));
  if (lot.risks && lot.risks.length) parts.push(lot.risks.join('. '));
  if (lot.bullets && lot.bullets.length) parts.push(lot.bullets.join('. '));
  if (lot.scoreBreakdown && lot.scoreBreakdown.length) {
    const labels = lot.scoreBreakdown.map(s => typeof s === 'string' ? s : (s.label || s.reason || '')).filter(Boolean);
    if (labels.length) parts.push(labels.join('. '));
  }

  return parts.join('. ').substring(0, 4000) || null;
}

/**
 * Derive a structured price_status value from the loose signals on a lot.
 *
 * Vocabulary (matches the CHECK constraint in migrations/2026-04-28-price-status.sql
 * and the backfill SQL in the same file — KEEP THE TWO IN SYNC):
 *   guide        — price present, normal listing.
 *   poa          — "price on application", intentional withhold (not a gap).
 *   tba          — "TBA / TBC / to be advised", intentional placeholder.
 *   starting_bid — only an opening bid published (auctioneer didn't set guide).
 *   sold         — auction over, sold_price recorded.
 *   withdrawn    — pulled from the sale.
 *   unknown      — genuine gap; no recognisable signal.
 *
 * Priority order (most specific first) — picks the FIRST matching branch:
 *   sold → withdrawn → poa → tba → starting_bid → guide → unknown
 *
 * Pure helper. Exported for direct unit testing — see tests/test-coverage-fix.js.
 */
function derivePriceStatus(lot) {
  if (!lot || typeof lot !== 'object') return 'unknown';

  const status = (lot.status || '').toLowerCase();
  const priceText = lot.priceText || '';
  const hasPrice = typeof lot.price === 'number' && lot.price > 0;
  const hasSoldPrice = typeof lot.soldPrice === 'number' && lot.soldPrice > 0;

  if (status === 'sold' && hasSoldPrice) return 'sold';
  if (status === 'withdrawn') return 'withdrawn';

  if (priceText && /poa|on application/i.test(priceText) && !hasPrice) return 'poa';
  if (priceText && /tba|tbc|to be advised|to be confirmed/i.test(priceText) && !hasPrice) return 'tba';
  if (priceText && /starting\s*bid|opening\s*bid|minimum\s*opening/i.test(priceText)) return 'starting_bid';

  if (hasPrice) return 'guide';
  return 'unknown';
}

/**
 * Upsert lots to the lots table with merge-safe field preservation.
 * Never overwrites existing non-null with null. Handles status history tracking.
 *
 * @param {Array} enrichedLots - Scored/enriched lot objects
 * @param {string} house - House slug
 * @param {string} catalogueUrl - Source catalogue URL
 * @param {object} metadata - { extractedWith, scrapedWith }
 */
async function upsertToLotsTable(enrichedLots, house, catalogueUrl, metadata = {}) {
  if (!supabase || !enrichedLots || enrichedLots.length === 0) return;
  // Slug canonicalisation — every persist must land under the canonical slug,
  // never a display name or case variant. Without this guard the same house
  // could appear under 'Lextons'/'lextons' (case split, found 2026-04-25) or
  // 'venmore'/'Venmore Auctions' (display-name leak, found 2026-05-05 with
  // 412 stranded lots across 11 houses). canonicaliseHouseSlug returns null
  // for unrecognised inputs — refuse the persist rather than store garbage.
  const _originalHouse = house;
  house = canonicaliseHouseSlug(house);
  if (!house) {
    console.warn(`LOTS: refusing to persist ${enrichedLots.length} lots — unrecognised house "${_originalHouse}"`);
    return;
  }
  if (house !== String(_originalHouse).toLowerCase()) {
    console.warn(`LOTS: normalised house "${_originalHouse}" → "${house}" (caller passed display name; please fix the upstream call site)`);
  }
  try {
    const now = new Date().toISOString();

    // Hero-image bleed guard: if the same image_url appears on >=3 distinct
    // addresses in this batch, the extractor grabbed a page-level hero image
    // (e.g. company logo / homepage banner) and applied it to every card.
    // Drop those bleed image_urls so backfill can populate per-lot images on
    // the next pass instead of cementing a wrong image. Discovered 2026-04-25
    // — lextons (40 lots / 1 image), philliparnold (12/1), driversnorris (8/1),
    // walkersingleton (9/1) all hit by this.
    const HERO_BLEED_THRESHOLD = 3;
    const imgCounts = new Map();
    for (const lot of enrichedLots) {
      if (!lot.imageUrl || !lot.address) continue;
      const k = lot.imageUrl;
      if (!imgCounts.has(k)) imgCounts.set(k, new Set());
      imgCounts.get(k).add(lot.address.trim().toLowerCase());
    }
    const bleedImgs = new Set(
      [...imgCounts.entries()]
        .filter(([, addrs]) => addrs.size >= HERO_BLEED_THRESHOLD)
        .map(([img]) => img),
    );
    if (bleedImgs.size > 0) {
      let stripped = 0;
      for (const lot of enrichedLots) {
        if (lot.imageUrl && bleedImgs.has(lot.imageUrl)) {
          lot.imageUrl = null;
          stripped++;
        }
      }
      console.warn(`LOTS: ${house}: hero-image bleed detected (${bleedImgs.size} bleed URL(s)); stripped imageUrl from ${stripped} lots — backfill will retry`);
    }

    // Look up auction date + id from calendar for this catalogue URL.
    // Backed by an in-process cache (urlMap + houseMap) with 5-min TTL —
    // see getCalendarDateMap() at the top of this module.
    //
    // Resolution order (resolveCalendarEntry): URL match first, then
    // single-calendar-row house fallback. The fallback catches scraper-
    // side url-mismatch cases (landwood, mccartneys, buttersjohnbee) where
    // the scraper produces a URL the calendar can't match directly.
    let catalogueAuctionDate = null;
    let catalogueAuctionId = null;
    try {
      const calMap = await getCalendarDateMap();
      const entry = resolveCalendarEntry(calMap, house, catalogueUrl);
      catalogueAuctionDate = entry?.date || null;
      catalogueAuctionId = entry?.id || null;
    } catch { /* non-fatal */ }

    // Build lot rows
    const rows = [];
    for (const lot of enrichedLots) {
      const addr = (lot.address || '').trim();
      if (!addr || addr.length < 5) continue;
      if (JUNK_LOT_PATTERN.test(addr)) continue;

      let lotUrl = lot.url || null;
      if (!lotUrl) {
        lotUrl = `__synthetic__${house}__${addr.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 80)}__${lot.price || 0}`;
      }

      // Per-lot auction date from bullets takes priority over catalogue date.
      // Handles EIG timed-auction "Auction Ends: DD/MM/YYYY" plus EIG white-label
      // "20 May 2026 LIVE ONLINE AUCTION" / "MAY LIVE ONLINE AUCTION" formats.
      // See lib/utils.js#findAuctionDateInBullets (and parseAuctionDateFromBullet)
      // for the full pattern list.
      const bulletDate = findAuctionDateInBullets(lot.bullets);
      const lotAuctionDate = bulletDate || catalogueAuctionDate;

      rows.push({
        house,
        // auctioneer: human-readable house name for display (house stays the slug).
        auctioneer: getHouseDisplayName(house) || null,
        lot_number: lot.lot || null,
        url: lotUrl,
        catalogue_url: normaliseUrl(catalogueUrl),
        // Move 2: FK to auction_calendar(id). NULL when no calendar row
        // matches (url_mismatch cohort). The merge logic below preserves a
        // previously-stamped auction_id when the new lookup misses, so this
        // is forward-stable across URL rotations.
        auction_id: catalogueAuctionId,
        address: addr,
        postcode: lot.postcode || null,
        price: (typeof lot.price === 'number' && lot.price > 0) ? lot.price : null,
        price_text: lot.priceText || null,
        prop_type: lot.propType || null,
        beds: (typeof lot.beds === 'number') ? lot.beds : null,
        tenure: lot.tenure || null,
        lease_length: (typeof lot.leaseLength === 'number') ? lot.leaseLength : null,
        sqft: (typeof lot.sqft === 'number') ? lot.sqft : null,
        condition: lot.condition || null,
        // Persist guard: if the extractor put the lot's own detail-page URL in
        // image_url (a known LLM fallback when no thumbnail was found, observed on
        // cliveemson 2026-05-09), treat as missing rather than persist a URL that
        // points to HTML, not an image. Lets the existing
        // backfillImagesFromLotPages() pass pick the row up on its next run.
        image_url: (lot.imageUrl && lot.imageUrl === lot.url) ? null : (lot.imageUrl || null),
        // floor_plans[] (lean rebuild). Same self-URL guard as image_url — a
        // plan that points back to the detail page is an LLM fallback, not a
        // real plan. Prefer an enrich-supplied floorPlans array; else wrap the
        // single legacy floorPlanUrl.
        floor_plans: Array.isArray(lot.floorPlans) && lot.floorPlans.length
          ? lot.floorPlans
          : ((lot.floorPlanUrl && lot.floorPlanUrl !== lot.url) ? [lot.floorPlanUrl] : []),
        // images[] — now written (post image-quality-filter, which runs in
        // enrich-stage.js before persist). Junk is rejected at the boundary, so
        // what lands here is property photos / floor plans only.
        images: Array.isArray(lot.images) ? lot.images : [],
        bullets: lot.bullets || [],
        units: lot.units || 0,
        auction_date: lotAuctionDate,
        status: lot.status || 'available',
        epc_rating: lot.epcRating || null,
        epc_score: (typeof lot.epcScore === 'number') ? lot.epcScore : null,
        // epc_floor_area_sqm → floor_area_sqm (lean rebuild).
        floor_area_sqm: (typeof lot.floorAreaSqm === 'number') ? lot.floorAreaSqm
          : ((typeof lot.epcFloorAreaSqm === 'number') ? lot.epcFloorAreaSqm : null),
        value_estimate: lot.valueEstimate || null,
        flood_zone: (typeof lot.floodZone === 'number') ? lot.floodZone : null,
        flood_risk: lot.floodRiskLevel || null,
        // street_avg → comparable_price (lean rebuild). street_sales dropped.
        comparable_price: (typeof lot.comparablePrice === 'number') ? lot.comparablePrice
          : ((typeof lot.streetAvg === 'number') ? lot.streetAvg : null),
        street_sales_count: (typeof lot.streetSalesCount === 'number') ? lot.streetSalesCount : null,
        below_market: (typeof lot.belowMarket === 'number') ? lot.belowMarket : null,
        est_monthly_rent: (typeof lot.estMonthlyRent === 'number') ? lot.estMonthlyRent : null,
        // est_annual_rent dropped — derived on read (est_monthly_rent * 12).
        est_gross_yield: (typeof lot.estGrossYield === 'number') ? lot.estGrossYield : null,
        score: (typeof lot.score === 'number') ? lot.score : null,
        score_breakdown: lot.scoreBreakdown || [],
        opps: lot.opps || [],
        risks: lot.risks || [],
        deal_type: lot.dealType || null,
        vacant: lot.vacant || null,
        title_split: lot.titleSplit || null,
        last_seen_at: now,
        // Prefer public lat/lng (stamped by os-places via setField); fall
        // back to underscore-prefixed legacy form written by lib/enrichment.js
        // geocode pass. See loose-thread LT-2.
        lat: (typeof lot.lat === 'number') ? lot.lat : ((typeof lot._lat === 'number') ? lot._lat : null),
        lng: (typeof lot.lng === 'number') ? lot.lng : ((typeof lot._lng === 'number') ? lot._lng : null),
        enriched_at: lot.enrichedAt || null,
        search_text: buildSearchText(lot),
        enrichment_manifest: lot._enrichment || null,
        // Phase A: first-contact maximisation —
        // uprn captured from OS Places enrichment; field_sources is the sparse
        // per-field provenance map (only fields written via setField appear here).
        uprn: lot.uprn || null,
        field_sources: lot._fieldSources || {},
        // Note: first_seen_at deliberately omitted — uses column default (now()) on INSERT,
        // and is not overwritten on conflict UPDATE.
        // Note: property_key is a generated column, never assigned directly.
      });
    }

    if (rows.length === 0) return;

    // Emit one scrape_seen per upsert batch — captures "the scraper produced
    // N candidates for this house+catalogue". Read by scrape_health_24h /
    // dormant_sources views. Per-batch (not per-lot) to keep cardinality
    // bounded — a single full pass produces ~100 events not 16,000.
    emitPipelineEvent({
      source: 'persist-lots.upsert',
      eventType: PIPELINE_EVENT_TYPES.SCRAPE_SEEN,
      auctionId: catalogueAuctionId,
      eventData: {
        house,
        candidate_count: rows.length,
        catalogue_url: normaliseUrl(catalogueUrl),
        extracted_with: metadata.extractedWith || null,
        scraped_with: metadata.scrapedWith || null,
      },
    }).catch(() => { /* observability never blocks the primary write */ });

    // Fetch existing lots with ALL fields so we can merge without data loss.
    // Move 2: use the dual-read helper but deliberately pass NO auctionId — we
    // want to find ALL existing lots for this catalogue, including legacy
    // rows whose auction_id hasn't been backfilled yet. Once the backfill is
    // clean and NOT NULL is enforced, this can switch to the auction_id path.
    const { data: existingLots } = await getLotsForCatalogue(supabase, {
      house,
      catalogueUrl,
    });

    const existingMap = new Map((existingLots || []).map(l => [l.url, l]));

    // ── Merge: never overwrite existing non-null with null ──
    // Fields that should ALWAYS be overwritten (even with null) when the scraper provides them:
    // enrichment_manifest is authoritative per-scrape — it reflects THIS run's outcome,
    // not a cumulative history. Treat it as always-fresh.
    // quality_score / quality_issues are always-fresh per scrape — they
    // reflect THIS run's state, not a cumulative max. If a prior scrape
    // saw a UPRN and this scrape didn't, the lot's score should drop;
    // preserving the old score would lie about completeness. The
    // underlying field values (uprn, image_url, etc.) still merge under
    // the never-overwrite-with-null rule below.
    const ALWAYS_OVERWRITE = new Set(['last_seen_at', 'search_text', 'enrichment_manifest']);
    // field_sources is merged (deep), not overwritten — see special-case below.
    // Fields that represent identity/structure (always take new value):
    const IDENTITY_FIELDS = new Set(['house', 'url', 'catalogue_url']);

    let preserved = 0;
    for (const row of rows) {
      const existing = existingMap.get(row.url);
      if (!existing) continue; // new lot, no merge needed

      // field_sources: deep-merge so prior run's stamps survive when this run
      // didn't re-stamp the same field. New stamps win on key collision.
      row.field_sources = mergeFieldSources(existing.field_sources, row.field_sources);

      // Merge: for each field, keep existing value if new value is null/empty
      for (const [key, newVal] of Object.entries(row)) {
        if (IDENTITY_FIELDS.has(key) || ALWAYS_OVERWRITE.has(key)) continue;
        if (key === 'id' || key === 'first_seen_at' || key === 'created_at') continue;

        const oldVal = existing[key];
        const newIsEmpty = newVal === null || newVal === undefined;
        const oldHasValue = oldVal !== null && oldVal !== undefined;

        // Never replace non-null with null
        if (newIsEmpty && oldHasValue) {
          row[key] = oldVal;
          preserved++;
        }

        // For JSONB arrays (bullets, opps, risks, score_breakdown, street_sales):
        // keep existing if new is an empty array and old has content
        if (Array.isArray(newVal) && newVal.length === 0 && Array.isArray(oldVal) && oldVal.length > 0) {
          row[key] = oldVal;
          preserved++;
        }
      }

      // Carry forward enriched_at if we preserved enrichment data
      if (!row.enriched_at && existing.enriched_at) {
        row.enriched_at = existing.enriched_at;
      }
    }

    if (preserved > 0) {
      console.log(`LOTS: ${house}: preserved ${preserved} existing field values from DB (would have been wiped)`);
    }

    // Upsert in batches of 50.
    //
    // Conflict key is `url` ALONE — not `(house, url)` — because the same lot
    // URL can appear in multiple house catalogues (e.g. an Auction House UK
    // lot listed by both /devonandcornwall and /southwest regional branches,
    // or a Bamboo lot listed by both Hunters and Rendells). Keying on
    // (house, url) created visible cross-house duplicates on the frontend.
    // The 2026-05-07 dedup migration collapsed historical dupes and swapped
    // the unique constraint to UNIQUE(url).
    const BATCH_SIZE = 50;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('lots')
        .upsert(batch, { onConflict: 'url' });
      if (error) {
        console.warn(`LOTS: Batch upsert error for ${house}: ${error.message}`);
      } else {
        upserted += batch.length;
      }
    }

    // Move 3 Phase 3a/3b: persist a catalogue_snapshots row + use the
    // previous snapshot for the snapshot-diff prune path below.
    //
    // Order matters: we fetch the previous snapshot BEFORE writeSnapshot
    // runs (otherwise the "latest" snapshot would be the one we just wrote).
    // The same prevSnapshot is reused for the prune diff to avoid a
    // duplicate round-trip.
    //
    // Both calls are best-effort — failure is logged but never propagates.
    // Skipped entirely when auction_id is unresolved (url_mismatch cohort).
    const prevSnapshot = catalogueAuctionId
      ? await getLatestSnapshot(supabase, catalogueAuctionId)
      : null;
    // Capture the snapshot row id so lot_events can carry it in source.scrape_id —
    // each event then links back to the exact scrape that produced it. Null when
    // auctionId is unresolved (url_mismatch cohort) or the insert failed.
    const snapshotResult = await writeSnapshot(supabase, {
      auctionId: catalogueAuctionId,
      rows,
      extractedWith: metadata.extractedWith || null,
      scrapedWith: metadata.scrapedWith || null,
      prevSnapshot,
    });
    const scrapeId = snapshotResult?.id || null;

    // Record status changes in history table
    // ── lot_events: emit per-field change events (the consolidated source of
    // truth). lot_history + lot_status_history were archived to *_archive in
    // the 2026-06-04 lot_events-completion migration; this is now the sole
    // change-tracking write. lot_first_seen fires for brand-new URLs (before is
    // null), lot_status_changed / lot_price_changed for transitions. Non-fatal:
    // lot_events is observability and must never block the primary lot write.
    try {
      // Re-fetch ids — the upsert may have created new rows not in existingMap.
      const { data: persistedRows } = await supabase
        .from('lots')
        .select('id, url, price, status')
        .eq('house', house)
        .eq('catalogue_url', normaliseUrl(catalogueUrl));

      if (persistedRows && persistedRows.length > 0) {
        const eventSource = {
          scrape_id: scrapeId,
          scraper_version: metadata.extractedWith || metadata.scrapedWith || 'unknown',
          house,
          writer: 'persist-lots.upsert',
        };
        const lotEvents = [];
        for (const r of persistedRows) {
          const existing = existingMap.get(r.url);
          const before = existing ? { status: existing.status, price: existing.price } : null;
          const after = { status: r.status, price: r.price };
          lotEvents.push(...diffLotEvents({ lotId: r.id, before, after, source: eventSource }));
        }
        if (lotEvents.length > 0) {
          const result = await insertLotEvents(lotEvents);
          console.log(`LOTS: ${house}: ${result.inserted}/${lotEvents.length} lot_events inserted`);
        }
      }
    } catch (err) {
      // Non-fatal: lot_events is observability, not the source of truth
      console.warn(`LOTS: lot_events emission failed for ${house}: ${err.message}`);
    }

    // ── Prune vanished lots ──
    // Mark in-play lots whose URL was absent from THIS scrape as 'withdrawn'.
    //
    // Snapshot-diff path (Move 3 Phase 3b): prev.lot_url_set vs current
    // gives an exact vanished set with no heuristics over the live lots table.
    // Brand-new auctions (no prevSnapshot yet) skip pruning safely — they
    // accumulate a snapshot on first scrape and prune correctly next cycle.
    try {
      if (!prevSnapshot || prevSnapshot.lot_count <= 0 || !Array.isArray(prevSnapshot.lot_url_set)) {
        // No prior snapshot — skip prune for this cycle.
      } else {
        const currentUrlSet = buildLotUrlSet(rows);
        const r = selectPruneCandidatesFromSnapshot({
          prevUrlSet: prevSnapshot.lot_url_set,
          currentUrlSet,
          existingLots: existingLots || [],
          now,
        });
        const reg = detectScrapeRegression({ prevCount: r.prevCount, currentCount: r.currentCount });
        const candidates = r.candidates;
        const ratio = r.ratio;
        const prevCount = r.prevCount;
        const scrapedCount = r.currentCount;
        // Only honour the regression gate when there are candidates to prune —
        // a stable catalogue with ratio < 0.5 but no vanishes (e.g. just status
        // updates) shouldn't trigger the alert.
        const blockedByRatio = reg.severe && candidates.length > 0;
        const regressionReason = reg.reason;
      if (blockedByRatio) {
        console.warn(`LOTS: ${house}: prune SKIPPED — ratio ${ratio.toFixed(2)} < 0.5 (held ${candidates.length} candidates, reason=${regressionReason})`);
        await supabase.from('pipeline_alerts').insert({
          event_type: 'prune_skipped_low_ratio',
          severity: 'warning',
          house,
          message: `Prune skipped: scraped ${scrapedCount}/${prevCount} (${Math.round(ratio * 100)}%). ${candidates.length} would-be-pruned lots held under 50% ratio gate.`,
          meta: { ratio, prevCount, scrapedCount, candidateCount: candidates.length, catalogue_url: normaliseUrl(catalogueUrl), source: 'snapshot_diff', reason: regressionReason },
        });
      } else if (candidates.length > 0) {
        const stamp = { removed_reason: 'vanished_from_catalogue', removed_at: now };
        const ids = candidates.map(c => c.id);
        const BATCH = 100;
        let pruned = 0;
        for (let i = 0; i < ids.length; i += BATCH) {
          const idBatch = ids.slice(i, i + BATCH);
          const { error: pruneErr } = await supabase
            .from('lots')
            .update({ status: 'withdrawn', enrichment_manifest: stamp })
            .in('id', idBatch);
          if (pruneErr) {
            console.warn(`LOTS: prune update error for ${house}: ${pruneErr.message}`);
          } else {
            pruned += idBatch.length;
          }
        }
        if (pruned > 0) {
          // ── Emit lot_events for prune-vanished ──
          // Per design (migration 2026-05-19-lot-events.sql): both events fire.
          //   lot_vanished      — the absence signal (inference)
          //   lot_status_changed — the resulting state flip (status → withdrawn)
          // Consumers filter by event_type. Non-fatal — wrapped to never block.
          try {
            const pruneSource = {
              scrape_id: scrapeId,
              scraper_version: metadata.extractedWith || metadata.scrapedWith || 'unknown',
              house,
              writer: 'persist-lots.prune-vanished',
            };
            const pruneEvents = [];
            for (const c of candidates) {
              const vanished = buildVanishedEvent({ lotId: c.id, oldStatus: c.status, source: pruneSource });
              if (vanished) pruneEvents.push(vanished);
              const flip = buildLotEvent({
                lotId: c.id,
                eventType: LOT_EVENT_TYPES.STATUS_CHANGED,
                oldValue: { status: c.status ?? null },
                newValue: { status: 'withdrawn' },
                source: pruneSource,
              });
              if (flip) pruneEvents.push(flip);
            }
            if (pruneEvents.length > 0) {
              const result = await insertLotEvents(pruneEvents);
              console.log(`LOTS: ${house}: ${result.inserted}/${pruneEvents.length} prune lot_events inserted`);
            }
          } catch (pruneEventsErr) {
            console.warn(`LOTS: prune lot_events emission failed for ${house}: ${pruneEventsErr.message}`);
          }

          console.log(`LOTS: ${house}: pruned ${pruned} vanished lots → withdrawn`);
        }
      }
      } // end else (has prevSnapshot)
    } catch (err) {
      // Non-fatal: prune is hygiene, not the source of truth
      console.warn(`LOTS: prune pass failed for ${house}: ${err.message}`);
    }

    // Emit one scrape_persisted per upsert batch — counterpart to scrape_seen,
    // proves the catalogue actually wrote rows. Drives scrape_health_24h
    // success-rate and dormant_sources last-seen.
    emitPipelineEvent({
      source: 'persist-lots.upsert',
      eventType: PIPELINE_EVENT_TYPES.SCRAPE_PERSISTED,
      auctionId: catalogueAuctionId,
      eventData: {
        house,
        persisted_count: upserted,
        candidate_count: rows.length,
        catalogue_url: normaliseUrl(catalogueUrl),
        extracted_with: metadata.extractedWith || null,
        scraped_with: metadata.scrapedWith || null,
      },
    }).catch(() => {});

    console.log(`LOTS: ✓ ${house}: ${upserted}/${rows.length} lots upserted`);
  } catch (err) {
    // Emit scrape_failed for whole-batch errors so dormant_sources can
    // distinguish "no events because the source has no auctions" from
    // "no events because the writer threw".
    emitPipelineEvent({
      source: 'persist-lots.upsert',
      eventType: PIPELINE_EVENT_TYPES.SCRAPE_FAILED,
      eventData: {
        house,
        catalogue_url: normaliseUrl(catalogueUrl),
        candidate_count: enrichedLots?.length || 0,
        error: err.message,
      },
    }).catch(() => {});
    console.warn(`LOTS: Failed to upsert lots for ${house}: ${err.message}`);
  }
}

export { JUNK_LOT_PATTERN, buildSearchText, upsertToLotsTable, derivePriceStatus };
// computeSnapshotHash and mergeFieldSources are already exported above where they're defined.
