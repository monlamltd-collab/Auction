// lib/pipeline/persist-lots.js — Upsert lots to Supabase with merge-safe field preservation
import { supabase } from '../supabase.js';
import { normaliseUrl, findAuctionDateInBullets } from '../utils.js';
import { createHash } from 'node:crypto';

const JUNK_LOT_PATTERN = /^(I'd like to|Property search|Popular|Auction Dates|Register to bid|Information|\dBid Basket|Cookie|Privacy)/i;

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
  // Slug normalisation — house must always be lowercase. Without this guard
  // the same house can appear under both 'Lextons' and 'lextons', producing
  // duplicate cards on the frontend (one per slug-case variant). Discovered
  // 2026-04-25 — lextons had 31/31 split.
  house = (house || '').toLowerCase();
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

    // Look up auction date from calendar for this catalogue URL
    let catalogueAuctionDate = null;
    try {
      const normCatUrl = normaliseUrl(catalogueUrl);
      const { data: calRows } = await supabase
        .from('auction_calendar')
        .select('url, date')
        .order('date', { ascending: true });
      if (calRows) {
        for (const r of calRows) {
          if (normaliseUrl(r.url) === normCatUrl) { catalogueAuctionDate = r.date; break; }
        }
      }
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
        lot_number: lot.lot || null,
        url: lotUrl,
        catalogue_url: normaliseUrl(catalogueUrl),
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
        image_url: lot.imageUrl || null,
        bullets: lot.bullets || [],
        units: lot.units || 0,
        auction_date: lotAuctionDate,
        status: lot.status || 'available',
        sold_price: (typeof lot.soldPrice === 'number') ? lot.soldPrice : null,
        epc_rating: lot.epcRating || null,
        epc_score: (typeof lot.epcScore === 'number') ? lot.epcScore : null,
        epc_date: lot.epcDate || null,
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
    const ALWAYS_OVERWRITE = new Set(['last_seen_at', 'scraped_with', 'extracted_with', 'search_text', 'enrichment_manifest']);
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

    // Upsert in batches of 50
    const BATCH_SIZE = 50;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('lots')
        .upsert(batch, { onConflict: 'house,url' });
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
        // Pull most recent snapshot per lot in one query for change detection
        const lotIds = persistedRows.map(r => r.id);
        const { data: prevSnapshots } = await supabase
          .from('lot_history')
          .select('lot_id, snapshot_hash')
          .in('lot_id', lotIds)
          .order('scraped_at', { ascending: false })
          .limit(lotIds.length * 2);
        const latestHashByLot = new Map();
        for (const s of (prevSnapshots || [])) {
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

    console.log(`LOTS: ✓ ${house}: ${upserted}/${rows.length} lots upserted`);
  } catch (err) {
    console.warn(`LOTS: Failed to upsert lots for ${house}: ${err.message}`);
  }
}

export { JUNK_LOT_PATTERN, buildSearchText, upsertToLotsTable };
