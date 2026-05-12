// lib/pipeline/persist-lots.js — Upsert lots to Supabase with merge-safe field preservation
import { supabase } from '../supabase.js';
import { normaliseUrl, findAuctionDateInBullets } from '../utils.js';
import { createHash } from 'node:crypto';
import { computeLotQuality } from '../quality/lot-quality.js';
import { canonicaliseHouseSlug } from '../houses.js';

const JUNK_LOT_PATTERN = /^(I'd like to|Property search|Popular|Auction Dates|Register to bid|Information|\dBid Basket|Cookie|Privacy)/i;

// ── Auction-calendar URL→date cache ────────────────────────────────────
// upsertToLotsTable() runs once per house per scrape cycle. Before this
// cache, each call fetched the whole auction_calendar table (~237 rows)
// just to find one matching URL — 173 houses × 237 rows = ~41k row reads
// per full cycle. Cache the URL→date map for 5 minutes so a single full
// cycle reads it once. Calendar-mutating callers (the auction-watcher)
// invalidate via _invalidateCalendarCache() so brand-new auction entries
// don't have to wait out the TTL.
const CAL_CACHE_TTL_MS = 5 * 60 * 1000;
let _calCache = null;          // Map<normalisedUrl, isoDateString>
let _calCacheBuiltAt = 0;

async function getCalendarDateMap() {
  const now = Date.now();
  if (_calCache && (now - _calCacheBuiltAt) < CAL_CACHE_TTL_MS) {
    return _calCache;
  }
  const map = new Map();
  try {
    const { data } = await supabase
      .from('auction_calendar')
      .select('url, date')
      .order('date', { ascending: true });
    for (const r of data || []) {
      const k = normaliseUrl(r.url);
      // Earliest date wins for a given URL — order ASC means the first
      // .set() call is also the earliest, and re-set is a no-op only if
      // we use Map.has() guard. Use it.
      if (k && !map.has(k)) map.set(k, r.date);
    }
  } catch { /* non-fatal — empty map */ }
  _calCache = map;
  _calCacheBuiltAt = now;
  return map;
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

/**
 * Select lots that should be pruned ('withdrawn') because they vanished from
 * the latest catalogue scrape. Pure function — no I/O, easy to unit-test.
 *
 * Why this exists: persistence is purely additive. Without pruning, a lot that
 * was on bid=10 but is absent from bid=11 stays in `lots` indefinitely with
 * status='available', polluting the active feed (`get_active_lots()` returns
 * any in-play status within the last 21 days).
 *
 * Gating: 50% ratio guard + 7-day grace prevent false positives from
 * transient extractor failures (e.g. Maggs went 27 → 0 lots on 2026-05-10 —
 * ratio 0/27 = 0% blocks the prune correctly).
 *
 * prevCount counts in-play rows only (available/stc/unsold). Counting every
 * historical row would inflate the denominator over time on stable catalogue
 * URLs (each past cycle leaves behind `ended`/`sold` rows), drifting the ratio
 * toward zero and tripping the gate even when only 1–2 actual stale lots
 * existed (edwardmellor 4/179 + cottons 4/46, 2026-05-12).
 *
 * @param {Array<{id, url, status, last_seen_at}>} existingLots
 *   Rows currently in DB for this (house, catalogue_url).
 * @param {Set<string>} scrapedUrls
 *   URLs returned by THIS scrape.
 * @param {Date|string} now
 *   Reference timestamp (test injection).
 * @param {object} [opts]
 * @param {number} [opts.graceMs=7d]
 * @param {number} [opts.ratioGate=0.5]
 * @returns {{candidates:Array, ratio:number, blockedByRatio:boolean,
 *            prevCount:number, scrapedCount:number}}
 */
export function selectPruneCandidates(existingLots, scrapedUrls, now, opts = {}) {
  const graceMs = opts.graceMs ?? (7 * 24 * 60 * 60 * 1000);
  const ratioGate = opts.ratioGate ?? 0.5;
  const list = Array.isArray(existingLots) ? existingLots : [];
  const urls = scrapedUrls instanceof Set ? scrapedUrls : new Set(scrapedUrls || []);
  const inPlay = new Set(['available', 'stc', 'unsold']);
  const prevCount = list.filter(l => l && inPlay.has(l.status)).length;
  const scrapedCount = urls.size;
  const ratio = prevCount > 0 ? scrapedCount / prevCount : 1;
  const nowMs = (typeof now === 'string' ? new Date(now) : (now || new Date())).getTime();
  const cutoffMs = nowMs - graceMs;
  const candidates = list.filter(l => {
    if (!l || !l.id || !l.url) return false;
    if (urls.has(l.url)) return false;
    if (!inPlay.has(l.status)) return false;
    if (!l.last_seen_at) return false;
    return new Date(l.last_seen_at).getTime() < cutoffMs;
  });
  return {
    candidates,
    ratio,
    blockedByRatio: candidates.length > 0 && ratio < ratioGate,
    prevCount,
    scrapedCount,
  };
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

    // Look up auction date from calendar for this catalogue URL.
    // Backed by an in-process URL→date Map with 5-min TTL — see
    // getCalendarDateMap() at the top of this module.
    let catalogueAuctionDate = null;
    try {
      const calMap = await getCalendarDateMap();
      catalogueAuctionDate = calMap.get(normaliseUrl(catalogueUrl)) || null;
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

      // Structured price intent (POA / TBA / sold / etc.) — derived first so
      // computeLotQuality below can prefer the explicit status over its own
      // priceText regex fallback. See derivePriceStatus above.
      const priceStatus = derivePriceStatus(lot);
      lot.priceStatus = priceStatus;

      // Per-lot quality (rollout #4) — computed at persist time from the
      // exact field set we're about to write. Pure helper, see
      // lib/quality/lot-quality.js.
      const quality = computeLotQuality(lot);

      rows.push({
        house,
        lot_number: lot.lot || null,
        url: lotUrl,
        catalogue_url: normaliseUrl(catalogueUrl),
        address: addr,
        postcode: lot.postcode || null,
        price: (typeof lot.price === 'number' && lot.price > 0) ? lot.price : null,
        price_text: lot.priceText || null,
        price_status: priceStatus,
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
        // images JSONB column exists (migration 2026-04-27-coverage-fix.sql)
        // but is intentionally NOT written here — held until the gallery /
        // hover-secondary frontend ships, so we don't accumulate junk-filtered
        // images in production with no consumer. COVERAGE_FIX_PLAN.md fix #5.
        bullets: lot.bullets || [],
        units: lot.units || 0,
        auction_date: lotAuctionDate,
        status: lot.status || 'available',
        sold_price: (typeof lot.soldPrice === 'number') ? lot.soldPrice : null,
        epc_rating: lot.epcRating || null,
        epc_score: (typeof lot.epcScore === 'number') ? lot.epcScore : null,
        epc_date: lot.epcDate || null,
        epc_floor_area_sqm: (typeof lot.epcFloorAreaSqm === 'number') ? lot.epcFloorAreaSqm : null,
        epc_floor_area_sqft: (typeof lot.epcFloorAreaSqft === 'number') ? lot.epcFloorAreaSqft : null,
        epc_works_cost_mid: (typeof lot.epcWorksCostMid === 'number') ? lot.epcWorksCostMid : null,
        epc_works_summary: Array.isArray(lot.epcWorksSummary) ? lot.epcWorksSummary : null,
        value_estimate: lot.valueEstimate || null,
        flood_zone: (typeof lot.floodZone === 'number') ? lot.floodZone : null,
        flood_risk: lot.floodRiskLevel || null,
        street_avg: (typeof lot.streetAvg === 'number') ? lot.streetAvg : null,
        street_sales: lot.streetSales || null,
        street_sales_count: (typeof lot.streetSalesCount === 'number') ? lot.streetSalesCount : null,
        below_market: (typeof lot.belowMarket === 'number') ? lot.belowMarket : null,
        est_monthly_rent: (typeof lot.estMonthlyRent === 'number') ? lot.estMonthlyRent : null,
        est_annual_rent: (typeof lot.estAnnualRent === 'number') ? lot.estAnnualRent : null,
        est_gross_yield: (typeof lot.estGrossYield === 'number') ? lot.estGrossYield : null,
        score: (typeof lot.score === 'number') ? lot.score : null,
        score_breakdown: lot.scoreBreakdown || [],
        opps: lot.opps || [],
        risks: lot.risks || [],
        deal_type: lot.dealType || null,
        vacant: lot.vacant || null,
        title_split: lot.titleSplit || null,
        raw_text: lot.rawText || null,
        extracted_with: metadata.extractedWith || null,
        scraped_with: metadata.scrapedWith || null,
        last_seen_at: now,
        // Prefer public lat/lng (stamped by os-places via setField); fall
        // back to underscore-prefixed legacy form written by lib/enrichment.js
        // geocode pass. See loose-thread LT-2.
        lat: (typeof lot.lat === 'number') ? lot.lat : ((typeof lot._lat === 'number') ? lot._lat : null),
        lng: (typeof lot.lng === 'number') ? lot.lng : ((typeof lot._lng === 'number') ? lot._lng : null),
        os_classification: lot.os_classification || null,
        enriched_at: lot.enrichedAt || null,
        search_text: buildSearchText(lot),
        enrichment_manifest: lot._enrichment || null,
        // Phase A: first-contact maximisation —
        // uprn captured from OS Places enrichment; field_sources is sparse
        // provenance map (only fields written via setField helper appear here).
        uprn: lot.uprn || null,
        field_sources: lot._fieldSources || {},
        // Per-lot quality (rollout #4) — see lib/quality/lot-quality.js.
        // quality_score is 0-100; quality_issues is a short-code array
        // suitable for frontend tooltips and audit queries.
        quality_score: quality.score,
        quality_issues: quality.issues,
        // Note: first_seen_at deliberately omitted — uses column default (now()) on INSERT,
        // and is not overwritten on conflict UPDATE.
        // Note: property_key is a generated column, never assigned directly.
      });
    }

    if (rows.length === 0) return;

    // Fetch existing lots with ALL fields so we can merge without data loss
    const { data: existingLots } = await supabase
      .from('lots')
      .select('*')
      .eq('house', house)
      .eq('catalogue_url', normaliseUrl(catalogueUrl));

    const existingMap = new Map((existingLots || []).map(l => [l.url, l]));

    // Detect status changes for history tracking
    const statusChanges = [];

    // Phase A: first-contact lots get flagged for the lot_history snapshot pass
    // (a lot is "first contact" if its URL doesn't appear in existingMap).
    const firstContactUrls = new Set();
    for (const row of rows) {
      if (!existingMap.has(row.url)) firstContactUrls.add(row.url);
    }

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
    const ALWAYS_OVERWRITE = new Set(['last_seen_at', 'scraped_with', 'extracted_with', 'search_text', 'enrichment_manifest', 'quality_score', 'quality_issues', 'price_status']);
    // field_sources is merged (deep), not overwritten — see special-case below.
    // Fields that represent identity/structure (always take new value):
    const IDENTITY_FIELDS = new Set(['house', 'url', 'catalogue_url']);

    let preserved = 0;
    for (const row of rows) {
      const existing = existingMap.get(row.url);
      if (!existing) continue; // new lot, no merge needed

      // field_sources: deep-merge so prior run's stamps survive when this
      // run didn't re-stamp the same field. New stamps win on key collision.
      row.field_sources = mergeFieldSources(existing.field_sources, row.field_sources);

      // Track status changes before merge
      if (existing.status && existing.status !== row.status) {
        statusChanges.push({
          lot_id: existing.id,
          old_status: existing.status,
          new_status: row.status,
          source: 'scrape',
        });
      }

      // Merge: for each field, keep existing value if new value is null/empty
      for (const [key, newVal] of Object.entries(row)) {
        if (IDENTITY_FIELDS.has(key) || ALWAYS_OVERWRITE.has(key)) continue;
        if (key === 'id' || key === 'first_seen_at' || key === 'search_vector') continue;

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

    // Record status changes in history table
    if (statusChanges.length > 0) {
      const { error: histErr } = await supabase
        .from('lot_status_history')
        .insert(statusChanges);
      if (histErr) console.warn(`LOTS: Status history insert error: ${histErr.message}`);
      else console.log(`LOTS: ${statusChanges.length} status changes recorded for ${house}`);
    }

    // ── Phase A: lot_history snapshot for new + changed lots ──
    // Append-only snapshot table — captures price/status/bullets/image at every
    // scrape that produces a meaningful change. Used downstream for price-drop
    // alerts, time-on-market analytics, STC/withdrawn transitions.
    //
    // Insert when: (a) lot is brand new (firstContactUrls), OR
    // (b) snapshot_hash differs from the most recent prior snapshot for this lot.
    try {
      // Re-fetch ids — the upsert may have created new rows that weren't in existingMap
      const { data: persistedRows } = await supabase
        .from('lots')
        .select('id, url, price, status, bullets, image_url, sold_price, price_text')
        .eq('house', house)
        .eq('catalogue_url', normaliseUrl(catalogueUrl));

      if (persistedRows && persistedRows.length > 0) {
        // Pull the most-recent snapshot_hash per lot via the
        // latest_lot_history_hashes RPC. The previous client-side
        // approach used `.limit(lotIds.length * 2)` which is a global
        // row cap, not a per-lot cap — on busy catalogues with many
        // history rows per lot, the latest row for some lots could
        // fall outside the window, leaving them with prevHash=undefined,
        // which the change-detection treated as first-contact and wrote
        // duplicate snapshots. (Review item #9, fixed 2026-04-30.)
        const lotIds = persistedRows.map(r => r.id);
        const { data: prevSnapshots } = await supabase
          .rpc('latest_lot_history_hashes', { p_lot_ids: lotIds });
        const latestHashByLot = new Map();
        for (const s of (prevSnapshots || [])) {
          // RPC returns at most one row per lot — no de-dup guard needed
          // but kept defensively in case the function signature drifts.
          if (!latestHashByLot.has(s.lot_id)) latestHashByLot.set(s.lot_id, s.snapshot_hash);
        }

        const snapshots = [];
        for (const r of persistedRows) {
          const bulletsCount = Array.isArray(r.bullets) ? r.bullets.length : 0;
          const imageCount = r.image_url ? 1 : 0;
          // snapshot_hash captures all fields that meaningfully change for a lot.
          // Stable across reruns when nothing changed → idempotent inserts.
          const snapshotHash = computeSnapshotHash({
            price: r.price,
            status: r.status,
            sold_price: r.sold_price,
            bullets_count: bulletsCount,
            image_count: imageCount,
          });

          const isFirstContact = firstContactUrls.has(r.url);
          const prevHash = latestHashByLot.get(r.id);
          const changed = isFirstContact || prevHash !== snapshotHash;
          if (!changed) continue;

          snapshots.push({
            lot_id: r.id,
            scraped_at: now,
            price: r.price,
            price_text: r.price_text,
            status: r.status,
            sold_price: r.sold_price,
            bullets_count: bulletsCount,
            image_count: imageCount,
            snapshot_hash: snapshotHash,
          });
        }

        if (snapshots.length > 0) {
          const SNAP_BATCH = 200;
          let snapInserted = 0;
          for (let i = 0; i < snapshots.length; i += SNAP_BATCH) {
            const batch = snapshots.slice(i, i + SNAP_BATCH);
            const { error: snapErr } = await supabase.from('lot_history').insert(batch);
            if (snapErr) {
              console.warn(`LOTS: lot_history insert error for ${house}: ${snapErr.message}`);
            } else {
              snapInserted += batch.length;
            }
          }
          const newCount = firstContactUrls.size;
          console.log(`LOTS: ${house}: ${snapInserted} lot_history snapshots written (${newCount} first-contact, ${snapInserted - newCount} changed)`);
        }
      }
    } catch (err) {
      // Non-fatal: history is observability, not the source of truth
      console.warn(`LOTS: lot_history snapshot pass failed for ${house}: ${err.message}`);
    }

    // ── Prune vanished lots ──
    // Mark in-play lots whose URL was absent from THIS scrape as 'withdrawn'.
    // Pure decision lives in selectPruneCandidates(); the I/O happens here.
    // Without this step, a lot present in bid=10 but absent from bid=11 stays
    // 'available' forever and pollutes get_active_lots() — the root cause of
    // "loads of old lots still showing" reported 2026-05-10 for Hollis Morgan.
    try {
      const scrapedUrls = new Set(rows.map(r => r.url));
      const { candidates, ratio, blockedByRatio, prevCount, scrapedCount } =
        selectPruneCandidates(existingLots || [], scrapedUrls, now);
      if (blockedByRatio) {
        console.warn(`LOTS: ${house}: prune SKIPPED — ratio ${ratio.toFixed(2)} < 0.5 (held ${candidates.length} candidates)`);
        await supabase.from('pipeline_alerts').insert({
          event_type: 'prune_skipped_low_ratio',
          severity: 'warning',
          house,
          message: `Prune skipped: scraped ${scrapedCount}/${prevCount} (${Math.round(ratio * 100)}%). ${candidates.length} would-be-pruned lots held under 50% ratio gate.`,
          meta: { ratio, prevCount, scrapedCount, candidateCount: candidates.length, catalogue_url: normaliseUrl(catalogueUrl) },
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
          const histRows = candidates.map(c => ({
            lot_id: c.id, old_status: c.status, new_status: 'withdrawn', source: 'prune',
          }));
          const { error: histErr } = await supabase.from('lot_status_history').insert(histRows);
          if (histErr) console.warn(`LOTS: prune lot_status_history error for ${house}: ${histErr.message}`);
          console.log(`LOTS: ${house}: pruned ${pruned} vanished lots → withdrawn`);
        }
      }
    } catch (err) {
      // Non-fatal: prune is hygiene, not the source of truth
      console.warn(`LOTS: prune pass failed for ${house}: ${err.message}`);
    }

    console.log(`LOTS: ✓ ${house}: ${upserted}/${rows.length} lots upserted`);
  } catch (err) {
    console.warn(`LOTS: Failed to upsert lots for ${house}: ${err.message}`);
  }
}

export { JUNK_LOT_PATTERN, buildSearchText, upsertToLotsTable, derivePriceStatus };
// selectPruneCandidates and computeSnapshotHash and mergeFieldSources are
// already exported above where they're defined.
