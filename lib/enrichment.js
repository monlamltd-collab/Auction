// ═══════════════════════════════════════════════════════════════
// ENRICHMENT MODULE — Property data enrichment pipeline
// Extracted from server.js
// ═══════════════════════════════════════════════════════════════

import {
  createManifest,
  markEnriched,
  recordScraped,
  recordExtract,
  recordGeocode,
  recordEpc,
  recordEpcRecommendations,
  recordFlood,
  recordLandRegistry,
  recordYieldScoring,
  recordBelowMarketScoring,
  recordYieldSkipped,
  recordBelowMarketSkipped,
  recordHpi,
  recordCompanies,
  recordTitleRegister,
  canScoreYield,
  canScoreBelowMarket,
} from './enrichment-manifest.js';

// Property types that represent a whole-block / portfolio sale. Per-unit
// rent estimates and single-property street comps are nonsensical here —
// guard the below-market and yield branches and stamp the manifest so the
// gates stay closed across later enrichment passes.
const BLOCK_LOT_PROP_TYPES = new Set(['block_sale', 'portfolio', 'commercial_block']);
function isBlockLot(lot) {
  if (lot && BLOCK_LOT_PROP_TYPES.has(lot.propType)) return true;
  if (lot && typeof lot.units === 'number' && lot.units > 1) return true;
  return false;
}
import { queryHPI } from './land-registry-hpi.js';
import { summariseOwnersByPostcode, queryOwnersByPostcode, matchTitleByAddress } from './land-registry-companies.js';
import { bulkLookupPostcodes } from './postcodes-io.js';

// ── Injected dependencies (set via initEnrichment) ──
let supabase = null;

/**
 * Classify an address for EPC matchability.
 *   full    — has a street number AND at least one street word (matcher can run)
 *   partial — has one but not the other
 *   none    — neither
 */
function assessAddressCompleteness(address) {
  if (!address || typeof address !== 'string') return 'none';
  const cleaned = address.trim();
  const hasNumber = /(^|\s)\d+[a-z]?\b/i.test(cleaned);
  // Count words after the first number, excluding the postcode
  const afterNumber = cleaned.replace(/^\d+[a-z]?\s+/i, '').replace(/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/i, '').trim();
  const streetWords = afterNumber.split(/[\s,]+/).filter(w => w.length > 1);
  const hasStreet = streetWords.length > 0;
  if (hasNumber && hasStreet) return 'full';
  if (hasNumber || hasStreet) return 'partial';
  return 'none';
}

// Exported only for tests
export { assessAddressCompleteness as _assessAddressCompleteness };

export function initEnrichment({ supabase: sb } = {}) {
  if (sb) supabase = sb;
}

// ═══════════════════════════════════════════════════════════════
// ADDRESS PARSING
// ═══════════════════════════════════════════════════════════════
export function extractPostcode(address) {
  if (!address) return null;
  const m = address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
  return m ? m[0].toUpperCase().replace(/\s+/g, ' ') : null;
}

export function extractStreet(address) {
  if (!address) return null;
  // Try to pull street name from address (between number and town/postcode)
  const m = address.match(/\d+[a-z]?\s+(.+?)(?:,|\s+[A-Z]{1,2}\d)/i);
  return m ? m[1].trim().toUpperCase() : null;
}

// ═══════════════════════════════════════════════════════════════
// LAND REGISTRY ENRICHMENT
// ═══════════════════════════════════════════════════════════════
// Reads from the bulk-loaded `hmlr_ppd` Supabase table (refreshed monthly
// by scripts/refresh-hmlr-ppd.mjs). Replaces the live SPARQL endpoint at
// landregistry.data.gov.uk/landregistry/query — same shape, same
// 3-year window, same 30-row cap, but served from Postgres.

const PPD_TYPE_LABEL = { D: 'Detached', S: 'Semi-Detached', T: 'Terraced', F: 'Flat/Maisonette', O: 'Other' };

/**
 * Query Land Registry for recent sales at a postcode.
 * @returns {{ status: string, data: Array, failed: boolean }}
 *   status: 'ok' | 'ok_no_comps' | 'no_postcode' | 'api_error'
 *   failed: retained for backwards compat with circuit-breaker caller
 */
export async function queryLandRegistry(postcode) {
  if (!postcode) return { status: 'no_postcode', data: [], failed: false };
  const sanitised = postcode.replace(/[^A-Z0-9 ]/gi, '').trim().toUpperCase();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/.test(sanitised)) {
    return { status: 'no_postcode', data: [], failed: false };
  }
  if (!supabase) {
    return { status: 'api_error', data: [], failed: true };
  }
  const cutoff = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const { data, error } = await supabase
      .from('hmlr_ppd')
      .select('paon, saon, street, town, postcode, price, transfer_date, ppd_category, property_type')
      .eq('postcode', sanitised)
      .gte('transfer_date', cutoff)
      .order('transfer_date', { ascending: false })
      .limit(30);

    if (error) {
      console.warn(`PPD query error for ${postcode}: ${error.message}`);
      return { status: 'api_error', data: [], failed: true };
    }

    const results = (data || []).map(r => ({
      address: [r.saon, r.paon, r.street].filter(Boolean).join(', '),
      town: r.town || '',
      postcode: r.postcode || '',
      price: r.price || 0,
      date: r.transfer_date || '',
      category: r.ppd_category === 'B' ? 'Additional Price Paid entry' : 'Standard Price Paid entry',
      propertyType: PPD_TYPE_LABEL[r.property_type] || r.property_type || '',
    }));
    return { status: results.length > 0 ? 'ok' : 'ok_no_comps', data: results, failed: false };
  } catch (e) {
    console.log(`PPD query failed for ${postcode}: ${e.message}`);
    return { status: 'api_error', data: [], failed: true };
  }
}

// ═══════════════════════════════════════════════════════════════
// VOA RENTAL ESTIMATES (local authority averages by beds)
// Monthly rent in £ — source: VOA Private Rental Market Statistics 2024/25
// Format: { area_keyword: { 0: studio, 1: 1bed, 2: 2bed, 3: 3bed, 4: 4bed+ } }
// ═══════════════════════════════════════════════════════════════
const VOA_RENTS = {
  // London boroughs
  'london': { 0: 1200, 1: 1500, 2: 1800, 3: 2200, 4: 2800 },
  'westminster': { 0: 1600, 1: 2000, 2: 2800, 3: 3800, 4: 5000 },
  'camden': { 0: 1400, 1: 1800, 2: 2400, 3: 3200, 4: 4000 },
  'islington': { 0: 1350, 1: 1750, 2: 2300, 3: 3000, 4: 3800 },
  'hackney': { 0: 1200, 1: 1550, 2: 2000, 3: 2600, 4: 3200 },
  'tower hamlets': { 0: 1300, 1: 1650, 2: 2100, 3: 2700, 4: 3400 },
  'southwark': { 0: 1200, 1: 1550, 2: 2000, 3: 2600, 4: 3200 },
  'lambeth': { 0: 1150, 1: 1500, 2: 1900, 3: 2500, 4: 3100 },
  'lewisham': { 0: 1000, 1: 1300, 2: 1600, 3: 2000, 4: 2500 },
  'greenwich': { 0: 1000, 1: 1300, 2: 1600, 3: 2000, 4: 2500 },
  'newham': { 0: 950, 1: 1250, 2: 1550, 3: 1900, 4: 2400 },
  'barking': { 0: 850, 1: 1100, 2: 1400, 3: 1700, 4: 2100 },
  'croydon': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'ealing': { 0: 1000, 1: 1300, 2: 1650, 3: 2100, 4: 2600 },
  'brent': { 0: 1050, 1: 1350, 2: 1700, 3: 2200, 4: 2700 },
  'haringey': { 0: 1100, 1: 1400, 2: 1800, 3: 2300, 4: 2800 },
  'waltham forest': { 0: 950, 1: 1250, 2: 1550, 3: 1950, 4: 2400 },
  'enfield': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'hounslow': { 0: 950, 1: 1200, 2: 1500, 3: 1900, 4: 2400 },
  'redbridge': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'hillingdon': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'barnet': { 0: 1000, 1: 1300, 2: 1650, 3: 2100, 4: 2600 },
  'bromley': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'wandsworth': { 0: 1200, 1: 1550, 2: 2000, 3: 2600, 4: 3200 },
  'richmond': { 0: 1100, 1: 1450, 2: 1850, 3: 2400, 4: 3000 },
  'kingston': { 0: 1000, 1: 1300, 2: 1650, 3: 2100, 4: 2600 },
  'merton': { 0: 1000, 1: 1300, 2: 1650, 3: 2100, 4: 2600 },
  'sutton': { 0: 850, 1: 1100, 2: 1400, 3: 1750, 4: 2100 },
  // Major cities & regions
  'manchester': { 0: 700, 1: 850, 2: 1050, 3: 1300, 4: 1600 },
  'birmingham': { 0: 600, 1: 750, 2: 900, 3: 1100, 4: 1400 },
  'liverpool': { 0: 500, 1: 600, 2: 750, 3: 900, 4: 1100 },
  'leeds': { 0: 600, 1: 700, 2: 850, 3: 1050, 4: 1300 },
  'sheffield': { 0: 500, 1: 600, 2: 750, 3: 900, 4: 1100 },
  'bristol': { 0: 750, 1: 900, 2: 1100, 3: 1400, 4: 1700 },
  'newcastle': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'nottingham': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1200 },
  'leicester': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1200 },
  'coventry': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1200 },
  'cardiff': { 0: 600, 1: 700, 2: 850, 3: 1050, 4: 1300 },
  'swansea': { 0: 450, 1: 550, 2: 650, 3: 800, 4: 1000 },
  'edinburgh': { 0: 700, 1: 850, 2: 1050, 3: 1350, 4: 1700 },
  'glasgow': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1250 },
  'reading': { 0: 750, 1: 950, 2: 1200, 3: 1500, 4: 1800 },
  'oxford': { 0: 800, 1: 1000, 2: 1300, 3: 1600, 4: 2000 },
  'cambridge': { 0: 800, 1: 1000, 2: 1300, 3: 1600, 4: 2000 },
  'brighton': { 0: 750, 1: 950, 2: 1200, 3: 1500, 4: 1800 },
  'southampton': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'portsmouth': { 0: 550, 1: 700, 2: 850, 3: 1050, 4: 1300 },
  'bournemouth': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'exeter': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'plymouth': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'bath': { 0: 700, 1: 850, 2: 1100, 3: 1400, 4: 1700 },
  'york': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'chester': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'norwich': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1200 },
  'ipswich': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'stoke': { 0: 400, 1: 500, 2: 600, 3: 750, 4: 950 },
  'derby': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'wolverhampton': { 0: 450, 1: 550, 2: 700, 3: 850, 4: 1050 },
  'walsall': { 0: 450, 1: 550, 2: 700, 3: 850, 4: 1050 },
  'sunderland': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'middlesbrough': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'bradford': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'hull': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'blackburn': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'burnley': { 0: 375, 1: 450, 2: 550, 3: 675, 4: 850 },
  'clitheroe': { 0: 425, 1: 525, 2: 650, 3: 800, 4: 1000 },
  // Regional fallbacks
  'south east': { 0: 750, 1: 950, 2: 1200, 3: 1500, 4: 1800 },
  'south west': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'east midlands': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'west midlands': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1250 },
  'north west': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'north east': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'yorkshire': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'east': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'wales': { 0: 475, 1: 575, 2: 700, 3: 875, 4: 1050 },
  'scotland': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1200 },
  // Default UK fallback
  '_default': { 0: 550, 1: 675, 2: 825, 3: 1025, 4: 1275 },
};

// Rent inflation factors — VOA baseline values are from mid-2024, apply uplifts for 2026 market
const RENT_UPLIFT = { bristol: 1.25, bath: 1.20, london: 1.10, _default: 1.10 };

export function estimateMonthlyRent(address, beds, units) {
  const a = (address || '').toLowerCase();
  // Multi-unit: estimate per-unit rent then multiply
  // For blocks, derive per-unit bed count from total beds / units, or default to 2
  const perUnitBeds = (units && units >= 2)
    ? (beds != null && beds <= 10 ? Math.max(1, Math.round(beds / units)) : 2)
    : (beds ?? 2);
  const unitCount = (units && units >= 2) ? units : 1;
  const clampedBeds = Math.min(Math.max(perUnitBeds, 0), 4);
  // Try specific towns/cities first, then regions
  for (const [key, rents] of Object.entries(VOA_RENTS)) {
    if (key === '_default') continue;
    if (a.includes(key)) {
      const base = rents[clampedBeds];
      const uplift = RENT_UPLIFT[key] || RENT_UPLIFT._default;
      return Math.round(base * uplift * unitCount);
    }
  }
  const base = VOA_RENTS._default[clampedBeds];
  return Math.round(base * RENT_UPLIFT._default * unitCount);
}

// ─── Comps lookup tunables ─────────────────────────────────────────────
// Hard recency cutoff — listings older than this are ignored. Codebase
// preference is binary cutoffs over soft decay (mirrors the LR comps
// 3-year filter at lib/enrichment.js:~100).
const COMPS_RECENCY_MONTHS = 6;
// Minimum listings for a tier to qualify. Below this, the median is too
// noisy to trust and we fall through to the next tier.
const MIN_COMP_SAMPLE = 3;

/**
 * Extract the postcode district (e.g. "BS1 4AB" → "BS1"; "EC1A 1BB" →
 * "EC1A"). Returns '' for nulls / non-strings / postcodes that don't
 * match the canonical UK shape. Pure — exported for tests.
 */
export function getPostcodeDistrict(pc) {
  if (!pc || typeof pc !== 'string') return '';
  const m = pc.toUpperCase().match(/^([A-Z]{1,2}\d[A-Z\d]?)\s\d[A-Z]{2}$/);
  return m ? m[1] : '';
}

/**
 * Map a lot's prop_type to the set of postcode_rentals.property_type
 * values that count as comps. Bungalows price like houses; studios
 * price like flats. Returns null when the prop_type has no rental
 * comparables (commercial / land / garage / other). Pure — exported
 * for tests.
 */
export function compsTypesForLot(propType) {
  if (propType === 'house' || propType === 'bungalow') return ['house', 'bungalow'];
  if (propType === 'flat') return ['flat', 'studio'];
  return null;
}

function recencyCutoffIso() {
  const d = new Date();
  d.setMonth(d.getMonth() - COMPS_RECENCY_MONTHS);
  return d.toISOString();
}

/**
 * HMO detection from a lot's text fields. Matches the keyword set
 * already used in scoring.js (\\bhmo\\b, house share) plus a few common
 * variants (multi-let, let by the room, Article 4). Pure — exported
 * for tests.
 *
 * Note: HMO is NOT the same as a multi-unit block (units >= 2). A
 * "block of 4 flats" rents as 4 × whole-flat rate; an HMO rents as
 * N × per-room rate. This boolean drives that branch in
 * estimateMonthlyRentSmart.
 */
export function isHmoLot({ title, bullets, opps } = {}) {
  const text = [
    title,
    Array.isArray(bullets) ? bullets.join(' ') : '',
    Array.isArray(opps) ? opps.join(' ') : '',
  ].filter(Boolean).join(' ').toLowerCase();
  if (!text) return false;
  return /\bhmo\b|house\s*share|multi[\s-]?let|let\s*by\s*the\s*room|article\s*4/.test(text);
}

/**
 * Postcode-comp-aware monthly rent estimate. Queries postcode_rentals
 * for live scrapes and falls back to the static VOA table when comps
 * are too thin to be reliable.
 *
 * Decides between two query paths:
 *   - HMO branch: when isHmoLot() matches AND beds >= 1, queries
 *     is_room_share=TRUE listings and multiplies median × beds. Falls
 *     through to non-HMO tiers if HMO comps are thin.
 *   - Non-HMO branch: queries is_room_share=FALSE listings, multiplies
 *     median × units (whole-property × block size for title-splits).
 *
 * Non-HMO tier order (best → fallback):
 *   1. Same FULL postcode + same beds + matching property_type   → 'comps_unit_typed'
 *   2. Same FULL postcode + matching property_type (any beds)    → 'comps_unit'
 *   3. Same DISTRICT (BS1 *) + matching property_type + beds     → 'comps_district_typed'
 *   4. Same DISTRICT (BS1 *) + matching property_type (any beds) → 'comps_district'
 *   5. Static estimateMonthlyRent                                → 'static'
 *
 * HMO tier order (only when isHmoLot && beds >= 1):
 *   H1. Same FULL postcode + is_room_share=TRUE   → 'comps_hmo_unit'
 *   H2. Same DISTRICT       + is_room_share=TRUE   → 'comps_hmo_district'
 *
 * Every tier carries a 6-month recency cutoff. Property-type filter
 * includes NULLs because OnTheMarket doesn't extract type — excluding
 * nulls would drop an entire source.
 *
 * Returns: { rent: number, source: <tier name>, sample: number, postcode? }
 */
export async function estimateMonthlyRentSmart({
  address, beds, units, postcode, propType,
  title, bullets, opps,
}) {
  const unitCount = (units && units >= 2) ? units : 1;
  const staticRent = estimateMonthlyRent(address, beds, units);

  if (!supabase || !postcode) {
    return { rent: staticRent, source: 'static', sample: 0 };
  }

  // Lots with no rental analogue (commercial, land, garage, other) skip
  // comps entirely — pricing dynamics are too different from residential.
  const allowedTypes = compsTypesForLot(propType);
  if (!allowedTypes) {
    return { rent: staticRent, source: 'static', sample: 0 };
  }

  const district = getPostcodeDistrict(postcode);
  const cutoff = recencyCutoffIso();
  const typeFilter = `property_type.in.(${allowedTypes.join(',')}),property_type.is.null`;
  const useBeds = (typeof beds === 'number' && beds >= 0 && beds <= 10);

  try {
    // ── HMO branch ─────────────────────────────────────────────────────
    // HMO income = median(room_rate) × beds. We hit this branch only when
    // the lot's text strongly signals HMO AND we have a bed count to
    // multiply by. If both HMO tiers come back thin we fall through to
    // non-HMO tiers — better to use whole-property comps × 1 than static
    // when room-share data is sparse.
    const isHmo = isHmoLot({ title, bullets, opps }) && (beds || 0) >= 1;
    if (isHmo) {
      // HMO Tier 1: same FULL postcode, room-shares only
      const { data: hmoUnit, error: hmoUnitErr } = await supabase
        .from('postcode_rentals')
        .select('rent_pcm')
        .eq('postcode', postcode)
        .eq('is_room_share', true)
        .gte('scraped_at', cutoff)
        .gt('rent_pcm', 0);
      if (hmoUnitErr) throw hmoUnitErr;
      if (hmoUnit && hmoUnit.length >= MIN_COMP_SAMPLE) {
        const med = median(hmoUnit.map(r => r.rent_pcm));
        return {
          rent: Math.round(med * beds),
          source: 'comps_hmo_unit',
          sample: hmoUnit.length,
          postcode,
        };
      }

      // HMO Tier 2: same DISTRICT, room-shares only
      if (district) {
        const { data: hmoDistrict, error: hmoDistrictErr } = await supabase
          .from('postcode_rentals')
          .select('rent_pcm')
          .like('postcode', `${district} %`)
          .eq('is_room_share', true)
          .gte('scraped_at', cutoff)
          .gt('rent_pcm', 0);
        if (hmoDistrictErr) throw hmoDistrictErr;
        if (hmoDistrict && hmoDistrict.length >= MIN_COMP_SAMPLE) {
          const med = median(hmoDistrict.map(r => r.rent_pcm));
          return {
            rent: Math.round(med * beds),
            source: 'comps_hmo_district',
            sample: hmoDistrict.length,
            postcode,
          };
        }
      }
      // Otherwise: fall through to whole-property comps below.
    }

    // ── Non-HMO branch ────────────────────────────────────────────────
    // Tier definitions in priority order. Each is (scope, bedsExact).
    const tiers = [
      { source: 'comps_unit_typed',     scope: 'unit',     bedsExact: true  },
      { source: 'comps_unit',            scope: 'unit',     bedsExact: false },
      { source: 'comps_district_typed', scope: 'district', bedsExact: true  },
      { source: 'comps_district',        scope: 'district', bedsExact: false },
    ];

    for (const tier of tiers) {
      // Skip beds-exact tiers if we don't have a bed count to match on.
      if (tier.bedsExact && !useBeds) continue;
      // Skip district tiers if we couldn't extract a district from the
      // postcode (malformed input).
      if (tier.scope === 'district' && !district) continue;

      let q = supabase
        .from('postcode_rentals')
        .select('rent_pcm')
        .or(typeFilter)
        .eq('is_room_share', false)
        .gte('scraped_at', cutoff)
        .gt('rent_pcm', 0);

      if (tier.scope === 'unit') q = q.eq('postcode', postcode);
      else q = q.like('postcode', `${district} %`);
      if (tier.bedsExact) q = q.eq('beds', beds);

      const { data, error } = await q;
      if (error) throw error;
      if (data && data.length >= MIN_COMP_SAMPLE) {
        const med = median(data.map(r => r.rent_pcm));
        return {
          rent: Math.round(med * unitCount),
          source: tier.source,
          sample: data.length,
          postcode,
        };
      }
    }
  } catch (err) {
    // Fall through to static — never let a comps query block enrichment.
    console.warn(`estimateMonthlyRentSmart query failed for ${postcode}: ${err.message}`);
  }

  return { rent: staticRent, source: 'static', sample: 0 };
}

function median(nums) {
  if (!nums || nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ═══════════════════════════════════════════════════════════════
// LOT URL CONSTRUCTION
// ═══════════════════════════════════════════════════════════════
export function buildLotUrl(lot, house, sourceUrl) {
  // If Claude already extracted a URL, use it
  if (lot.url && lot.url.startsWith('http')) return lot.url;

  switch (house) {
    case 'savills':
      // Savills lot pages: /auctions/auction-name/lot-number
      if (sourceUrl.includes('savills.co.uk')) {
        const base = sourceUrl.replace(/\/page-\d+.*/, '');
        return `${base}?lot=${lot.lot}`;
      }
      break;
    case 'allsop':
      // Allsop: lot overview pages use the property reference
      if (lot.reference) return `https://www.allsop.co.uk/lot-overview/lot/${lot.reference}`;
      return `https://www.allsop.co.uk/find-a-property/`;
    case 'sdl':
      // BTG Eddisons (formerly SDL): property pages are /properties/{id}/for-auction-{slug}
      if (lot.url && lot.url.startsWith('http')) return lot.url;
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.btgeddisonspropertyauctions.com${lot.url}`;
      }
      if (lot.propertyId) {
        return `https://www.btgeddisonspropertyauctions.com/properties/${lot.propertyId}/`;
      }
      break;
    case 'bondwolfe':
      // Bond Wolfe: /auctions/properties/{id}-property-auction-{location}/
      if (lot.propertyId) {
        return `https://www.bondwolfe.com/auctions/properties/${lot.propertyId}/`;
      }
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.bondwolfe.com${lot.url}`;
      }
      break;
    case 'network':
      // Network Auctions: individual lot pages
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.networkauctions.co.uk${lot.url}`;
      }
      break;
    case 'barnardmarcus':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.barnardmarcusauctions.co.uk${lot.url}`;
      }
      break;
    case 'auctionhouselondon':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://auctionhouselondon.co.uk${lot.url}`;
      }
      break;
    case 'cliveemson':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.cliveemson.co.uk${lot.url}`;
      }
      break;
    case 'strettons':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.strettons.co.uk${lot.url}`;
      }
      break;
    case 'acuitus':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.acuitus.co.uk${lot.url}`;
      }
      break;
    case 'auctionhouse':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.auctionhouse.co.uk${lot.url}`;
      }
      break;
    case 'hollismorgan':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.hollismorgan.co.uk${lot.url}`;
      }
      break;
    case 'maggsandallen':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.maggsandallen.co.uk${lot.url}`;
      }
      break;
    case 'mchughandco':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.mchughandco.com${lot.url}`;
      }
      break;
    case 'knightfrank':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.knightfrankauctions.com${lot.url}`;
      }
      break;
    case 'pattinson':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.pattinson.co.uk${lot.url}`;
      }
      break;
    case 'bidx1':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://bidx1.com${lot.url}`;
      }
      break;
    case 'philliparnold':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.philliparnoldauctions.co.uk${lot.url}`;
      }
      break;
    case 'edwardmellor':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.edwardmellor.co.uk${lot.url}`;
      }
      break;
    case 'paulfosh':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://paulfosh.eigonlineauctions.com${lot.url}`;
      }
      break;
    case 'cottons':
      // EIG embed lot links are like ?lid=329469&ClientID=26&src=40
      if (lot.url && lot.url.includes('lid=')) {
        return `https://www.cottons.co.uk/current-auction.htm${lot.url}`;
      }
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.cottons.co.uk${lot.url}`;
      }
      break;
    case 'dedmangray':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.dedmangray.co.uk${lot.url}`;
      }
      break;
    case 'barnettross':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.barnettross.co.uk${lot.url}`;
      }
      break;
    case 'bradleyhall':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.bradleyhall.co.uk${lot.url}`;
      }
      break;
    case 'connectuk':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.connectukauctions.co.uk${lot.url}`;
      }
      break;
    case 'auctionestates':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.auctionestates.co.uk${lot.url}`;
      }
      break;
    case 'landwood':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.landwoodpropertyauctions.com${lot.url}`;
      }
      break;
    case 'loveitts':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.loveitts.co.uk${lot.url}`;
      }
      break;
    case 'hunters':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://hunters.bambooauctions.com${lot.url}`;
      }
      break;
    case '247propertyauctions':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://247auction.bambooauctions.com${lot.url}`;
      }
      break;
    // ── New houses ──
    case 'probateauction':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://probate.auction${lot.url}`;
      }
      break;
    case 'countrywide':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.countrywidepropertyauctions.co.uk${lot.url}`;
      }
      break;
    case 'venmore':
      if (lot.url && !lot.url.startsWith('http')) {
        return `https://www.venmoreauctions.co.uk/${lot.url.replace(/^\//, '')}`;
      }
      break;
    case 'tcpa':
      // TCPA URLs are already absolute (regional subdomains)
      break;
    case 'futureauctions':
      if (lot.url && !lot.url.startsWith('http')) {
        return `https://www.futurepropertyauctions.co.uk/${lot.url.replace(/^\//, '')}`;
      }
      break;
    case 'kivells':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.kivells.com${lot.url}`;
      }
      break;
    case 'firstforauctions':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://online.firstforauctions.co.uk${lot.url}`;
      }
      break;
    case 'harmanhealy':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.harman-healy.co.uk${lot.url}`;
      }
      break;
    case 'seelauctions':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://online.seelauctions.co.uk${lot.url}`;
      }
      break;
    case 'robinsonhall':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://robinsonandhallauctions.co.uk${lot.url}`;
      }
      break;
    // ── New EIG houses (March 2026 batch) ──
    case 'astleys':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://astleys.eigonlineauctions.com${lot.url}`;
      }
      break;
    case 'henrysykes':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://onlineauctions.henrysykes.co.uk${lot.url}`;
      }
      break;
    case 'clarkesimpson':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://clarke-simpson.eigonlineauctions.com${lot.url}`;
      }
      break;
    case 'durrants':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://durrants.com${lot.url}`;
      }
      break;
    case 'dawsons':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.dawsonsproperty.co.uk${lot.url}`;
      }
      break;
    case 'goldings':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.goldingsauctions.co.uk${lot.url}`;
      }
      break;
    case 'auctionhousescotland':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.auctionhouse.co.uk${lot.url}`;
      }
      break;
    case 'austingray':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.auctionhouse.co.uk${lot.url}`;
      }
      break;
    // ── New houses (March 2026 batch 2) ──
    case 'agentsproperty':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.agentspropertyauction.com${lot.url}`;
      }
      break;
    case 'andrewcraig':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.andrewcraig.co.uk${lot.url}`;
      }
      break;
    case 'buttersjohnbee':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.buttersjohnbee.com${lot.url}`;
      }
      break;
    case 'brownco':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://brownandco.eigonlineauctions.com${lot.url}`;
      }
      break;
    case 'cheffins':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.cheffins.co.uk${lot.url}`;
      }
      break;
    case 'fssproperty':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.fssproperty.co.uk${lot.url}`;
      }
      break;
    case 'iamsold':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.iamsold.co.uk${lot.url}`;
      }
      break;
  }
  // Fallback: if no lot-specific URL, link to the source catalogue page
  return lot.url || sourceUrl || '';
}

// ═══════════════════════════════════════════════════════════════
// ENRICHMENT: Circuit Breaker (shared pattern for external APIs)
// ═══════════════════════════════════════════════════════════════
class CircuitBreaker {
  constructor(name, { maxFailures = 3, resetMs = 600000 } = {}) {
    this.name = name;
    this.maxFailures = maxFailures;
    this.resetMs = resetMs;
    this.failures = 0;
    this.openedAt = 0;
  }
  isOpen() {
    if (this.failures < this.maxFailures) return false;
    if (Date.now() - this.openedAt > this.resetMs) {
      console.log(`Circuit breaker [${this.name}] half-open — retrying`);
      this.failures = 0;
      return false;
    }
    return true;
  }
  recordFailure() {
    this.failures++;
    if (this.failures >= this.maxFailures) {
      this.openedAt = Date.now();
      console.warn(`Circuit breaker [${this.name}] OPEN — ${this.maxFailures} consecutive failures, pausing for ${this.resetMs / 1000}s`);
    }
  }
  recordSuccess() { this.failures = 0; }
  get status() { return this.isOpen() ? 'open' : this.failures > 0 ? 'half-open' : 'closed'; }
}

const epcBreaker = new CircuitBreaker('EPC', { maxFailures: 3, resetMs: 600000 });
const floodBreaker = new CircuitBreaker('Flood', { maxFailures: 3, resetMs: 600000 });
const lrBreaker = new CircuitBreaker('LandRegistry', { maxFailures: 5, resetMs: 300000 });

export function getCircuitBreakers() {
  return { epc: epcBreaker.status, flood: floodBreaker.status, landRegistry: lrBreaker.status };
}

// ═══════════════════════════════════════════════════════════════
// ENRICHMENT: EPC API
// ═══════════════════════════════════════════════════════════════

// EPC API credentials check (logged once at startup)
let _epcWarningLogged = false;
const EPC_API_EMAIL = process.env.EPC_API_EMAIL || '';
const EPC_API_KEY = process.env.EPC_API_KEY || '';
if (!EPC_API_EMAIL || !EPC_API_KEY) {
  console.warn('WARNING: EPC_API_EMAIL or EPC_API_KEY not set — EPC enrichment will be skipped');
  _epcWarningLogged = true;
}

let _lastEPCCallTime = 0;

/**
 * Fetch EPC records for a postcode from the MHCLG Open Data Communities API.
 * @returns {Promise<{ status: string, records: Array|null }>}
 *   status: 'ok' | 'skipped_no_creds' | 'skipped_no_postcode' |
 *           'circuit_open' | 'api_error' | 'timeout' | 'api_empty_for_postcode'
 * Rate limited to 500ms between calls.
 */
export async function fetchEPCByPostcode(postcode) {
  if (!EPC_API_EMAIL || !EPC_API_KEY) return { status: 'skipped_no_creds', records: null };
  if (!postcode) return { status: 'skipped_no_postcode', records: null };
  if (epcBreaker.isOpen()) return { status: 'circuit_open', records: null };

  // Rate limit: 500ms between consecutive calls
  const now = Date.now();
  const elapsed = now - _lastEPCCallTime;
  if (elapsed < 500) {
    await new Promise(r => setTimeout(r, 500 - elapsed));
  }
  _lastEPCCallTime = Date.now();

  try {
    const encoded = encodeURIComponent(postcode.trim());
    const url = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encoded}&size=5000`;
    const authToken = Buffer.from(EPC_API_EMAIL + ':' + EPC_API_KEY).toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${authToken}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`EPC API ${response.status} for ${postcode}`);
      epcBreaker.recordFailure();
      return { status: 'api_error', records: null };
    }

    const data = await response.json();
    const rows = data.rows || data.results || data;
    epcBreaker.recordSuccess();
    if (!Array.isArray(rows)) return { status: 'api_error', records: null };
    return { status: rows.length > 0 ? 'ok' : 'api_empty_for_postcode', records: rows };
  } catch (e) {
    if (e.name === 'AbortError') {
      console.warn(`EPC API timeout for ${postcode}`);
      epcBreaker.recordFailure();
      return { status: 'timeout', records: null };
    }
    console.warn(`EPC API error for ${postcode}: ${e.message}`);
    epcBreaker.recordFailure();
    return { status: 'api_error', records: null };
  }
}

// ═══════════════════════════════════════════════════════════════
// EPC RECOMMENDATIONS — per-certificate /recommendations/{lmkKey}
// ═══════════════════════════════════════════════════════════════
// Returns the recommended improvements + indicative costs for a given
// EPC certificate. Free API, same Basic-auth client, same circuit breaker.
//
// Cost parsing: HMG returns costs as strings like "£3,300 - £6,500" or
// "£100" or sometimes "£100 +". We parse to a numeric mid-point (or upper-
// bound + 10% if open-ended). Sum of mid-points → "deferred capex" feeding
// lib/pipeline/value-estimator.js.
//
// Improvement-id → category mapping (small fixed enum). Anything not
// covered falls into 'other'.

const EPC_REC_CATEGORY_MAP = {
  // Glazing
  '1': 'lighting',           // Low energy lighting
  '2': 'cavity_wall_insulation',
  '3': 'cavity_wall_insulation',
  '5': 'loft_insulation',
  '6': 'flat_roof_insulation',
  '7': 'room_in_roof_insulation',
  '8': 'hot_water_cylinder_insulation',
  '9': 'draught_proofing',
  '11': 'heating_controls',
  '12': 'heating_controls',
  '13': 'boiler',
  '15': 'boiler',
  '16': 'heat_pump',
  '17': 'biomass_boiler',
  '20': 'solar_water_heating',
  '21': 'solar_pv',
  '22': 'wind_turbine',
  '23': 'mechanical_ventilation',
  '24': 'single_glazing',     // Replace single glazed windows
  '26': 'single_glazing',     // Replace primary single-glazed
  '27': 'single_glazing',
  '28': 'cavity_wall_insulation',
  '29': 'cavity_wall_insulation',
  '30': 'external_wall_insulation',
  '31': 'internal_wall_insulation',
  '32': 'high_performance_external_doors',
  '33': 'floor_insulation',
};

function epcRecCategory(improvementId) {
  if (!improvementId) return 'other';
  const id = String(improvementId).trim();
  return EPC_REC_CATEGORY_MAP[id] || 'other';
}

/**
 * Parse an EPC indicative_cost string into a numeric £ mid-point.
 *   "£3,300 - £6,500"  → 4900
 *   "£100"             → 100
 *   "£500 +"           → 550   (10% open-ended uplift)
 *   ""                 → null
 */
export function parseEpcIndicativeCost(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/[£,\s]/g, '').toLowerCase();
  if (!cleaned) return null;
  const range = cleaned.match(/^(\d+)-(\d+)/);
  if (range) {
    const lo = parseInt(range[1], 10);
    const hi = parseInt(range[2], 10);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo) return Math.round((lo + hi) / 2);
  }
  const openEnded = cleaned.match(/^(\d+)\+$/);
  if (openEnded) {
    const v = parseInt(openEnded[1], 10);
    return Number.isFinite(v) ? Math.round(v * 1.1) : null;
  }
  const single = cleaned.match(/^(\d+)/);
  if (single) {
    const v = parseInt(single[1], 10);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/**
 * Fetch EPC recommendations for a single certificate (lmk-key).
 * @returns {Promise<{ status: string, items?: Array, totalCostMid?: number }>}
 *   status: 'ok' | 'empty' | 'circuit_open' | 'api_error' | 'timeout' | 'skipped_no_lmk_key'
 */
export async function fetchEPCRecommendations(lmkKey) {
  if (!EPC_API_EMAIL || !EPC_API_KEY) return { status: 'skipped_no_creds' };
  if (!lmkKey) return { status: 'skipped_no_lmk_key' };
  if (epcBreaker.isOpen()) return { status: 'circuit_open' };

  // Same 500ms rate limit as the search endpoint — they share the breaker.
  const now = Date.now();
  const elapsed = now - _lastEPCCallTime;
  if (elapsed < 500) await new Promise(r => setTimeout(r, 500 - elapsed));
  _lastEPCCallTime = Date.now();

  try {
    const encoded = encodeURIComponent(lmkKey);
    const url = `https://epc.opendatacommunities.org/api/v1/domestic/recommendations/${encoded}`;
    const authToken = Buffer.from(EPC_API_EMAIL + ':' + EPC_API_KEY).toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: { 'Authorization': `Basic ${authToken}`, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      epcBreaker.recordFailure();
      return { status: 'api_error' };
    }

    const data = await response.json();
    const rows = data.rows || data.results || [];
    epcBreaker.recordSuccess();

    if (!Array.isArray(rows) || rows.length === 0) return { status: 'empty', items: [], totalCostMid: 0 };

    const items = [];
    let totalCostMid = 0;
    for (const r of rows) {
      const id = r['improvement-id'] || r.improvementId || r['improvement-id-text'];
      const summary = r['improvement-summary-text'] || r.improvementSummaryText
                      || r['improvement-descr-text'] || r.improvementDescrText
                      || r['improvement-item'] || '';
      const cost = parseEpcIndicativeCost(r['indicative-cost'] || r.indicativeCost);
      const cat = epcRecCategory(id);
      items.push({ id: String(id || ''), category: cat, summary: String(summary).slice(0, 280), cost_mid: cost });
      if (cost && cost > 0) totalCostMid += cost;
    }
    return { status: 'ok', items, totalCostMid };
  } catch (e) {
    if (e.name === 'AbortError') {
      epcBreaker.recordFailure();
      return { status: 'timeout' };
    }
    epcBreaker.recordFailure();
    return { status: 'api_error' };
  }
}

// ═══════════════════════════════════════════════════════════════
// ENRICHMENT: Flood Zone Lookup (Postcodes.io + EA)
// ═══════════════════════════════════════════════════════════════

let _lastEACallTime = 0;
const EA_RATE_LIMIT_MS = 200;

/**
 * Geocode a postcode via Postcodes.io, then check EA flood zones.
 * @returns {Promise<{ status: string, floodZone?: string, floodRiskLevel?: string, floodData?: object, lat?: number, lon?: number }>}
 *   status: 'ok' | 'no_postcode' | 'circuit_open' | 'geocode_failed' | 'api_error'
 */
export async function fetchFloodZone(postcode) {
  if (!postcode) return { status: 'no_postcode' };
  if (floodBreaker.isOpen()) return { status: 'circuit_open' };

  try {
    // Step 1: Geocode via Postcodes.io
    const encoded = encodeURIComponent(postcode.trim());
    const geoController = new AbortController();
    const geoTimeout = setTimeout(() => geoController.abort(), 5000);

    const geoRes = await fetch(`https://api.postcodes.io/postcodes/${encoded}`, {
      signal: geoController.signal,
    });
    clearTimeout(geoTimeout);

    if (!geoRes.ok) {
      console.warn(`Postcodes.io ${geoRes.status} for ${postcode}`);
      return { status: 'geocode_failed' };
    }

    const geoData = await geoRes.json();
    const lat = geoData?.result?.latitude;
    const lon = geoData?.result?.longitude;
    if (!lat || !lon) {
      console.warn(`Postcodes.io no coords for ${postcode}`);
      return { status: 'geocode_failed' };
    }

    // Step 2: Check EA Flood Monitoring API with proper point-in-polygon
    // The old WFS endpoints at environment.data.gov.uk/spatialdata/ were
    // decommissioned in May 2026. This replaces them with the still-live
    // flood-monitoring API that returns flood alert/warning area polygons.
    const { checkFloodRisk } = await import('./flood-lookup.js');
    const result = await checkFloodRisk(lat, lon);

    if (result.status === 'ok') {
      floodBreaker.recordSuccess();
      // Map flood-monitoring proximity to approximate planning zones.
      // This is a proxy — upgrade to proper Zone 1/2/3 when the Flood Map
      // for Planning GeoPackage dataset is available for local queries.
      const zone = result.floodRiskLevel === 'High' ? '3' : result.floodRiskLevel === 'Medium' ? '2' : null;
      return {
        status: 'ok',
        floodZone: zone,
        floodRiskLevel: result.floodRiskLevel,
        floodData: { source: result.source, note: result.note },
        lat,
        lon,
      };
    } else {
      floodBreaker.recordFailure();
      return { status: result.status, floodZone: null, floodRiskLevel: null, floodData: { source: result.source, error: result.note }, lat, lon };
    }
  } catch (e) {
    console.warn(`fetchFloodZone error for ${postcode}: ${e.message}`);
    floodBreaker.recordFailure();
    return { status: 'api_error' };
  }
}

// ═══════════════════════════════════════════════════════════════
// ENRICHMENT: EPC Address Matching
// ═══════════════════════════════════════════════════════════════

// Common street suffixes to normalise (Road→rd, Street→st, etc.) — hoisted for performance
const EPC_SUFFIX_MAP = { road: 'rd', street: 'st', avenue: 'ave', drive: 'dr', lane: 'ln', close: 'cl', crescent: 'cres', terrace: 'ter', place: 'pl', court: 'ct', gardens: 'gdns', grove: 'gr', way: 'wy', park: 'pk' };

/**
 * Match EPC records to a specific lot address.
 * Returns { epcRating, epcScore, epcDate, _matchConfidence } or null if no confident match.
 */
export function matchEPCToLot(epcRecords, lotAddress) {
  if (!epcRecords || !epcRecords.length || !lotAddress) return null;

  function normalise(addr) {
    return (addr || '')
      .toLowerCase()
      .replace(/\b(flat|apartment|unit|apt|ground\s+floor|first\s+floor|second\s+floor)\b/gi, '')
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Phase 4: extract every numeric token (with optional sub-letter) instead
  // of just the first one. A lot address like "Flat 3, 22 High St" used to
  // return "3" via the old single-match extractor; the EPC record stored as
  // "22 High Street, Flat 3" returned "22"; numbers didn't match → no EPC.
  // Now we return ['3','22'] and accept any pairwise overlap below.
  function extractAllNumbers(addr) {
    const out = [];
    const numRe = /\b(\d+[a-z]?)\b/gi;
    let m;
    while ((m = numRe.exec(addr)) !== null) out.push(m[1].toLowerCase());
    return out;
  }

  function extractStreetWords(addr) {
    const cleaned = addr
      .replace(/^\d+[a-z]?\s+/i, '')
      .replace(/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/i, '') // remove postcode
      .replace(/\b\d+[a-z]?\b/g, '')                          // strip all remaining numbers
      .trim();
    return cleaned.split(/\s+/).filter(Boolean).slice(0, 4).map(w => EPC_SUFFIX_MAP[w] || w);
  }

  function streetMatchScore(wordsA, wordsB) {
    if (!wordsA.length || !wordsB.length) return 0;
    let matched = 0;
    for (const w of wordsA) {
      if (wordsB.includes(w)) matched++;
    }
    // Score: proportion of the shorter street name that matched
    return matched / Math.min(wordsA.length, wordsB.length);
  }

  const normLot = normalise(lotAddress);
  const lotNumbers = extractAllNumbers(normLot);
  const lotStreetWords = extractStreetWords(normLot);

  if (!lotStreetWords.length) return null;

  // Phase 3: street-only fallback for named-building addresses ("Rose
  // Cottage, High Street", "The Old Mill, Park Lane"). When the lot has
  // no numeric prefix, require a stricter street match (≥0.75 vs the
  // normal 0.5) AND insist the EPC record also have no number — so we
  // don't pair "Rose Cottage" with "1 High Street". Adds ~250 resi lots
  // by analysis of the no_match_with_address gap.
  const streetOnlyMode = lotNumbers.length === 0;
  const STREET_THRESHOLD = streetOnlyMode ? 0.75 : 0.5;

  let bestMatch = null;
  let bestDate = '';
  let bestStreetScore = 0;

  for (const rec of epcRecords) {
    const epcAddr = normalise(
      [rec.address1 || rec.address || '', rec.address2 || '', rec.address3 || ''].join(' ')
    );

    const epcNumbers = extractAllNumbers(epcAddr);

    // Phase 4 number-match: any-of-many overlap, instead of single-token equality.
    // streetOnlyMode requires both sides to be numberless.
    if (streetOnlyMode) {
      if (epcNumbers.length > 0) continue;
    } else {
      if (epcNumbers.length === 0) continue;
      const overlap = lotNumbers.some(n => epcNumbers.includes(n));
      if (!overlap) continue;
    }

    const epcStreetWords = extractStreetWords(epcAddr);
    const score = streetMatchScore(lotStreetWords, epcStreetWords);

    if (score < STREET_THRESHOLD) continue;

    const rating = (rec['current-energy-rating'] || rec.currentEnergyRating || '').toUpperCase();
    const epcScore = parseInt(rec['current-energy-efficiency'] || rec.currentEnergyEfficiency || '0', 10);
    const date = rec['lodgement-date'] || rec.lodgementDate || '';

    if (!/^[A-G]$/.test(rating)) continue;
    if (epcScore < 1 || epcScore > 100) continue;

    const epcBeds = parseInt(rec['number-habitable-rooms'] || rec.numberHabitableRooms || rec['number-heated-rooms'] || rec.numberHeatedRooms || '0', 10);
    // TOTAL_FLOOR_AREA is in square metres; store sqm raw and provide sqft conversion
    const floorAreaSqm = parseFloat(rec['total-floor-area'] || rec.totalFloorArea || '0');
    const floorAreaSqft = floorAreaSqm > 0 ? Math.round(floorAreaSqm * 10.7639) : null;

    // Prefer: higher street match score, then most recent date
    if (!bestMatch || score > bestStreetScore || (score === bestStreetScore && date > bestDate)) {
      bestMatch = {
        epcRating: rating,
        epcScore: epcScore,
        epcDate: date,
        epcBeds: (epcBeds >= 1 && epcBeds <= 20) ? epcBeds : null,
        epcFloorAreaSqm: (floorAreaSqm > 0 && floorAreaSqm < 10000) ? floorAreaSqm : null,
        epcFloorAreaSqft: (floorAreaSqft && floorAreaSqft < 100000) ? floorAreaSqft : null,
        epcLmkKey: rec['lmk-key'] || rec.lmkKey || null,
        _matchConfidence: score,
      };
      bestDate = date;
      bestStreetScore = score;
    }
  }

  return bestMatch;
}

// ═══════════════════════════════════════════════════════════════
// ENRICHMENT: Land Registry + Rental Yield per lot
// ═══════════════════════════════════════════════════════════════
export async function enrichLots(lots, house, sourceUrl, onProgress) {
  // ── Initialise per-lot enrichment manifest (observability layer) ──
  for (const lot of lots) {
    if (!lot._enrichment) lot._enrichment = createManifest();
    // Record scrape provenance — _scrapedAt and _scrapeMethod are stamped by
    // the scrape stage onto each raw lot. Fall back to now() if absent (e.g.
    // lots that came through a legacy path or were injected directly).
    recordScraped(lot._enrichment, {
      at: lot._scrapedAt || new Date().toISOString(),
      method: lot._scrapeMethod || null,
      hash: lot._scrapeHash || null,
    });
    // Record extraction provenance — _extractStrategy and _extractFieldCoverage
    // are stamped by extractor.js onto each lot after DOM/AI extraction.
    if (lot._extractStrategy) {
      recordExtract(lot._enrichment, {
        strategy: lot._extractStrategy,
        aiTier: lot._extractAiTier || null,
        fieldCoverage: lot._extractFieldCoverage || {},
      });
    }
  }

  // Group lots by postcode to avoid duplicate queries
  const postcodeMap = {};
  for (const lot of lots) {
    lot.url = buildLotUrl(lot, house, sourceUrl);
    const pc = extractPostcode(lot.address);
    lot.postcode = pc;
    if (pc && !postcodeMap[pc]) postcodeMap[pc] = [];
    if (pc) postcodeMap[pc].push(lot);
  }

  const postcodes = Object.keys(postcodeMap);
  console.log(`Enriching ${lots.length} lots across ${postcodes.length} unique postcodes...`);

  // ── Geocode postcodes via postcodes.io (free, bulk, no API key) ──
  let geocodeBatchFailed = false;
  try {
    for (let i = 0; i < postcodes.length; i += 100) {
      const batch = postcodes.slice(i, i + 100);
      const geoResp = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: batch }),
      });
      if (geoResp.ok) {
        const geoData = await geoResp.json();
        for (const item of (geoData.result || [])) {
          if (item.result) {
            const pc = item.query.toUpperCase().replace(/\s+/g, ' ');
            const lotsForPc = postcodeMap[pc] || postcodeMap[item.query] || [];
            for (const lot of lotsForPc) {
              lot._lat = item.result.latitude;
              lot._lng = item.result.longitude;
            }
          }
        }
      } else {
        geocodeBatchFailed = true;
      }
    }
    const geocoded = lots.filter(l => l._lat).length;
    if (geocoded > 0) console.log(`Geocoded ${geocoded}/${lots.length} lots`);
  } catch (geoErr) {
    console.warn('Geocoding failed (non-fatal):', geoErr.message);
    geocodeBatchFailed = true;
  }

  // Record per-lot geocode outcome in manifest
  for (const lot of lots) {
    if (!lot.postcode) {
      recordGeocode(lot._enrichment, { status: 'no_postcode' });
    } else if (lot._lat && lot._lng) {
      recordGeocode(lot._enrichment, { status: 'ok', lat: lot._lat, lng: lot._lng });
    } else if (geocodeBatchFailed) {
      recordGeocode(lot._enrichment, { status: 'api_error' });
    } else {
      recordGeocode(lot._enrichment, { status: 'no_coords' });
    }
  }

  // Query Land Registry for each unique postcode (with persistent cache + circuit breaker)
  const LR_CONCURRENCY = 5;
  const lrCache = {};
  const lrStatusByPostcode = {};  // per-postcode LR outcome for manifest
  let enrichDone = 0;
  let lrCacheHits = 0;

  // Check Supabase cache for LR data first
  if (supabase && postcodes.length > 0) {
    try {
      const { data: cached } = await supabase
        .from('enrichment_cache')
        .select('postcode, lr_data')
        .in('postcode', postcodes)
        .not('lr_data', 'is', null);
      if (cached) {
        for (const row of cached) {
          lrCache[row.postcode] = row.lr_data;
          lrStatusByPostcode[row.postcode] = 'cache_hit';
          lrCacheHits++;
        }
      }
    } catch { /* cache miss — proceed with API */ }
  }

  const uncachedPostcodes = postcodes.filter(pc => !lrCache[pc]);
  if (lrCacheHits > 0) console.log(`LR cache: ${lrCacheHits} hits, ${uncachedPostcodes.length} to fetch`);

  let lrBreakerSkipped = false;
  for (let i = 0; i < uncachedPostcodes.length; i += LR_CONCURRENCY) {
    if (lrBreaker.isOpen()) {
      console.warn('LR circuit breaker open — skipping remaining postcodes');
      lrBreakerSkipped = true;
      // Mark remaining uncached postcodes as circuit_open
      for (let j = i; j < uncachedPostcodes.length; j++) {
        lrStatusByPostcode[uncachedPostcodes[j]] = 'circuit_open';
      }
      break;
    }
    const batch = uncachedPostcodes.slice(i, i + LR_CONCURRENCY);
    const results = await Promise.all(batch.map(async (pc) => {
      const result = await queryLandRegistry(pc);
      if (result.failed) {
        lrBreaker.recordFailure();
      } else if (result.data.length > 0) {
        lrBreaker.recordSuccess();
      }
      return result;
    }));
    batch.forEach((pc, idx) => {
      lrCache[pc] = results[idx].data;
      lrStatusByPostcode[pc] = results[idx].status;
    });
    enrichDone += batch.length;
    if (onProgress) onProgress(lrCacheHits + enrichDone, postcodes.length);
    if (i + LR_CONCURRENCY < uncachedPostcodes.length) await new Promise(r => setTimeout(r, 200));
  }

  // Persist LR results to Supabase cache (update only lr_data columns, preserve EPC/flood)
  if (supabase && uncachedPostcodes.length > 0) {
    try {
      const toStore = uncachedPostcodes.filter(pc => lrCache[pc] && lrCache[pc].length > 0);
      let stored = 0;
      for (const pc of toStore) {
        try {
          // Try update first (row may exist from EPC/flood enrichment)
          const { data: updated } = await supabase.from('enrichment_cache')
            .update({ lr_data: lrCache[pc], lr_expires_at: null })
            .eq('postcode', pc)
            .select('postcode');
          if (!updated || updated.length === 0) {
            // Row doesn't exist yet — insert with LR data only
            await supabase.from('enrichment_cache').insert({
              postcode: pc, lr_data: lrCache[pc], lr_expires_at: null,
              cached_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            });
          }
          stored++;
        } catch { /* individual write failure — continue */ }
      }
      if (stored > 0) console.log(`LR cache: stored ${stored} postcodes (permanent)`);
    } catch (e) {
      console.warn('LR cache write failed (non-fatal):', e.message);
    }
  }

  // Enrich each lot
  for (const lot of lots) {
    const pc = lot.postcode;
    const sales = lrCache[pc] || [];

    // Record Land Registry outcome per lot in manifest
    if (!pc) {
      recordLandRegistry(lot._enrichment, { status: 'no_postcode' });
    } else {
      const lrStatus = lrStatusByPostcode[pc] || (lrBreakerSkipped ? 'circuit_open' : 'api_error');
      recordLandRegistry(lot._enrichment, {
        status: lrStatus,
        compsFound: sales.length,
      });
    }

    // Street sales data — kept on the lot row for back-compat / scoring,
    // and also fanned out to the postcode_sales table for cross-lot comps
    // (rollout #6). The lot-level JSONB stays for now; future phases may
    // retire it once consumers migrate to the table.
    lot.streetSales = sales.slice(0, 10).map(s => ({
      address: s.address,
      price: s.price,
      date: s.date,
      type: s.propertyType,
    }));

    // Upsert ALL sales (not just the lot-level top 10) into postcode_sales.
    // ON CONFLICT idempotent on (postcode, address, sold_date, sold_price).
    // Best-effort: a write failure here doesn't block scoring.
    if (supabase && pc && sales.length > 0) {
      try {
        const rows = sales
          .filter(s => s.address && s.price > 0 && s.date)
          .map(s => ({
            postcode: pc,
            address: s.address,
            sold_price: Math.round(s.price),
            sold_date: s.date,
            property_type: s.propertyType || null,
            source: 'land-registry',
          }));
        if (rows.length > 0) {
          await supabase
            .from('postcode_sales')
            .upsert(rows, {
              onConflict: 'postcode,address,sold_date,sold_price',
              ignoreDuplicates: true,
            });
        }
      } catch (err) {
        console.warn(`postcode_sales upsert failed for ${pc}: ${err.message}`);
      }
    }

    // Calculate street average (last 3 years) — type-aware with IQR outlier exclusion
    const allSales = sales.filter(s => s.price > 0);
    // Try type-matched comps first (flat vs flat, house vs house)
    const typeMap = { flat: /flat|maisonette/i, house: /terraced|semi|detached/i, bungalow: /bungalow/i };
    const typePattern = typeMap[lot.propType];
    const typedSales = typePattern ? allSales.filter(s => typePattern.test(s.propertyType || '')) : [];
    // Use typed comps if we have 2+, otherwise fall back to all sales
    let relevantSales = typedSales.length >= 2 ? typedSales : allSales;
    // IQR-based outlier exclusion (only with 4+ comps to have meaningful quartiles)
    if (relevantSales.length >= 4) {
      const prices = relevantSales.map(s => s.price).sort((a, b) => a - b);
      const q1 = prices[Math.floor(prices.length * 0.25)];
      const q3 = prices[Math.floor(prices.length * 0.75)];
      const iqr = q3 - q1;
      const lower = q1 - 1.5 * iqr;
      const upper = q3 + 1.5 * iqr;
      const filtered = relevantSales.filter(s => s.price >= lower && s.price <= upper);
      if (filtered.length >= 2) relevantSales = filtered; // Only apply if we keep enough comps
    }
    if (relevantSales.length > 0) {
      const avg = Math.round(relevantSales.reduce((s, x) => s + x.price, 0) / relevantSales.length);
      lot.streetAvg = avg;
      lot.streetSalesCount = relevantSales.length;
      lot._compType = typedSales.length >= 2 ? 'matched' : 'all'; // Signal comp quality
      // Record comp count in manifest so downstream consumers can tell
      // "filtered comp set was small" from "LR returned nothing"
      if (lot._enrichment.land_registry) {
        lot._enrichment.land_registry.compsUsed = relevantSales.length;
      }

      // Bargain score: how far below street average is the guide price?
      // Only score for residential — street comps are house sales, meaningless for land/garage/commercial.
      // Block / portfolio lots are skipped entirely: their guide is the
      // total for many units, so dividing by single-property comps yields
      // discount values like -4969% (Lakeshore: £9.5M block / £190k flat
      // comp). Stamp the manifest so the gate stays closed across later
      // passes and no spurious "Nx above market avg" risk is added.
      // Gated on canScoreBelowMarket(): hygiene wave Pass 3 + Pass 7 both
      // call enrichLots() on overlapping lots; without the gate, the +1/+2
      // points were added twice and showed up as duplicate entries in
      // scoreBreakdown (the score column is clamped to 10 so the column
      // value hid the duplication, but the breakdown surfaced it).
      if (isBlockLot(lot)) {
        recordBelowMarketSkipped(lot._enrichment, 'skipped_block_lot');
      } else {
        const compReliable = ['house', 'bungalow', 'flat'].includes(lot.propType);
        if (lot.price && avg > 0) {
          const discount = ((avg - lot.price) / avg) * 100;
          lot.belowMarket = Math.round(discount);
          const eligible = canScoreBelowMarket(lot._enrichment);
          if (compReliable && discount > 20 && eligible) {
            lot.score += 2;
            lot.scoreBreakdown = lot.scoreBreakdown || [];
            lot.scoreBreakdown.push({ signal: `${lot.belowMarket}% below market`, pts: 2 });
            lot.opps.push(`${lot.belowMarket}% below market`);
            recordBelowMarketScoring(lot._enrichment);
          } else if (compReliable && discount > 10 && eligible) {
            lot.score += 1;
            lot.scoreBreakdown = lot.scoreBreakdown || [];
            lot.scoreBreakdown.push({ signal: `${lot.belowMarket}% below market`, pts: 1 });
            lot.opps.push(`${lot.belowMarket}% below market`);
            recordBelowMarketScoring(lot._enrichment);
          } else if (discount < -10) {
            lot.risks.push(`${Math.abs(lot.belowMarket)}% above market avg`);
          }
          lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
        }
      }
    } else {
      lot.streetAvg = null;
      lot.streetSalesCount = 0;
    }

    // Rental yield estimate — only for property types that generate rental income.
    // Uses postcode_rentals comps when available, falls back to the static
    // VOA keyword table when comps are too thin. Source recorded in the
    // manifest for downstream observability (rollout #7).
    // Block / portfolio lots are excluded: the rent estimate is per-unit
    // (one flat) but the price is whole-block, so the yield comes out
    // ≈ 0.2% (Lakeshore: £900/mo × 12 / £9.5M). Stamp the manifest so
    // canScoreYield() returns false on later passes.
    if (isBlockLot(lot)) recordYieldSkipped(lot._enrichment, 'skipped_block_lot');
    const yieldEligible = !isBlockLot(lot) && ['house', 'bungalow', 'flat', 'commercial'].includes(lot.propType);
    let monthlyRent = 0;
    let rentSource = 'none';
    let rentSample = 0;
    if (yieldEligible) {
      const r = await estimateMonthlyRentSmart({
        address: lot.address,
        beds: lot.beds,
        units: lot.units,
        postcode: lot.postcode,
        propType: lot.propType,
        // For HMO detection — lot's free-text fields. estimateMonthlyRent-
        // Smart routes HMO-shaped lots to a per-room comps query before
        // the whole-property tier loop.
        title: lot.title,
        bullets: lot.bullets,
        opps: lot.opps,
      });
      monthlyRent = r.rent;
      rentSource = r.source;
      rentSample = r.sample;
    }
    lot.estMonthlyRent = monthlyRent || null;
    lot._rentSource = rentSource;
    lot._rentSample = rentSample;
    lot._rentMultiUnit = lot.units >= 2; // Flag multi-unit rent estimates for frontend
    lot.estAnnualRent = monthlyRent ? monthlyRent * 12 : null;
    if (lot.price && lot.price > 0 && lot.estAnnualRent) {
      lot.estGrossYield = Math.round((lot.estAnnualRent / lot.price) * 1000) / 10;
      // Flag unrealistic yields — typically caused by very low guide prices
      if (lot.estGrossYield > 30) {
        lot._yieldEstimateWarning = true;
        if (!lot.risks) lot.risks = [];
        if (!lot.risks.some(r => /yield.*unrealistic|verify.*rent/i.test(r))) {
          lot.risks.push('Yield estimate unrealistic — verify actual achievable rent');
        }
      }
      // Gate yield scoring on manifest so scoring stage and enrichment stage
      // never both score yield for the same lot (previously caused double-count
      // invisible until score-capped at 10).
      if (yieldEligible && !lot._yieldEstimateWarning && canScoreYield(lot._enrichment)) {
        if (lot.estGrossYield > 8) {
          lot.score += 2.5;
          lot.scoreBreakdown = lot.scoreBreakdown || [];
          lot.scoreBreakdown.push({ signal: `Est. ${lot.estGrossYield}% yield`, pts: 2.5 });
          lot.opps.push(`Est. ${lot.estGrossYield}% yield`);
          recordYieldScoring(lot._enrichment, { scoredBy: 'enrichment', signal: `Est. ${lot.estGrossYield}% yield` });
        } else if (lot.estGrossYield > 6) {
          lot.score += 1.5;
          lot.scoreBreakdown = lot.scoreBreakdown || [];
          lot.scoreBreakdown.push({ signal: `Est. ${lot.estGrossYield}% yield`, pts: 1.5 });
          lot.opps.push(`Est. ${lot.estGrossYield}% yield`);
          recordYieldScoring(lot._enrichment, { scoredBy: 'enrichment', signal: `Est. ${lot.estGrossYield}% yield` });
        }
      }
      lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
    }
  }


  // ── HMLR Bulk Datasets — HPI trend + corporate / overseas owners ──
  // Reads from Supabase tables refreshed monthly (hmlr_hpi,
  // hmlr_corporate_owners). Pure DB lookups — fast, no external API.
  // Non-scoring: stamps lot fields and manifest only. Scoring integration
  // is deferred to a follow-up once we have a baseline of populated data.
  try {
    const hmlrPostcodes = postcodes.filter(Boolean);
    if (hmlrPostcodes.length > 0 && supabase) {
      // One bulk postcodes.io call to resolve admin_district per postcode.
      // The earlier inline geocode pass only kept lat/lng — we need the
      // district name to match HPI's RegionName/area_name column.
      const districtMap = await bulkLookupPostcodes(hmlrPostcodes);
      const hpiCache = new Map(); // district name → HPI result

      for (const pc of hmlrPostcodes) {
        const dInfo = districtMap.get(pc);
        const district = dInfo?.status === 'ok' ? dInfo.district : null;

        let hpi = { status: 'no_input' };
        if (district) {
          if (!hpiCache.has(district)) {
            hpiCache.set(district, await queryHPI({ areaName: district }));
          }
          hpi = hpiCache.get(district);
        }

        const owners = await summariseOwnersByPostcode(pc);
        // Title-register surfacing — raw corporate/overseas owner rows for
        // this postcode, address-matched per lot below. A separate query
        // from the summary above keeps the existing companies path untouched.
        const titleRows = await queryOwnersByPostcode(pc);

        for (const lot of postcodeMap[pc]) {
          if (hpi.status === 'ok' && hpi.latest) {
            lot.hpi12mChange = hpi.yoy;
            lot.hpiAvgPrice = hpi.latest.average_price;
            lot.hpiAreaName = hpi.latest.area_name;
            recordHpi(lot._enrichment, {
              status: 'ok',
              areaName: hpi.latest.area_name,
              areaCode: hpi.latest.area_code,
              latestMonth: hpi.latest.month,
              yoy: hpi.yoy,
            });
          } else {
            recordHpi(lot._enrichment, { status: hpi.status });
          }

          if (owners.status === 'ok') {
            lot.hasUkCorporateOwners = owners.hasUkCorporate;
            lot.hasOverseasOwners = owners.hasOverseas;
            lot.overseasCountryCounts = owners.countryCounts;
            recordCompanies(lot._enrichment, {
              status: 'ok',
              hasUkCorporate: owners.hasUkCorporate,
              hasOverseas: owners.hasOverseas,
              countries: Object.keys(owners.countryCounts).slice(0, 5),
            });
          } else {
            recordCompanies(lot._enrichment, { status: owners.status });
          }

          // Title-register surfacing — match this lot's address to a
          // corporate/overseas-owned title at its postcode and stamp the
          // title number + registered proprietor into the manifest. Every
          // outcome is recorded — ok / no_match (+reason) / no_postcode /
          // db_error — so a missing title is never a silent gap.
          if (titleRows.status === 'db_error') {
            recordTitleRegister(lot._enrichment, { status: 'db_error' });
          } else if (titleRows.status === 'no_postcode') {
            recordTitleRegister(lot._enrichment, { status: 'no_postcode' });
          } else {
            const tm = matchTitleByAddress(lot.address, [
              ...(titleRows.ccod || []), ...(titleRows.ocod || []),
            ]);
            if (tm.matched) {
              recordTitleRegister(lot._enrichment, {
                status: 'ok',
                title_number: tm.row.title_number,
                registered_owner: tm.registeredOwner,
                dataset: tm.row.dataset,
              });
            } else {
              recordTitleRegister(lot._enrichment, { status: 'no_match', reason: tm.reason });
            }
          }
        }
      }
    }
  } catch (hmlrErr) {
    console.warn(`HMLR enrichment pass failed: ${hmlrErr.message}`);
  }


  // ── EPC & Flood Risk Enrichment (best-effort, never blocks pipeline) ──
  try {
    const ENRICH_CONCURRENCY = 3;
    const enrichmentPostcodes = postcodes.filter(Boolean);
    console.log(`EPC/Flood enrichment: processing ${enrichmentPostcodes.length} postcodes...`);

    // Clean expired cache entries once per enrichLots cycle
    if (supabase) {
      try {
        await supabase.from('enrichment_cache').delete().lt('expires_at', new Date().toISOString()).is('lr_data', null);
      } catch (cleanErr) {
        // Non-fatal
      }
    }

    for (let i = 0; i < enrichmentPostcodes.length; i += ENRICH_CONCURRENCY) {
      const batch = enrichmentPostcodes.slice(i, i + ENRICH_CONCURRENCY);

      const results = await Promise.allSettled(batch.map(async (pc) => {
        // API-layer outcomes (records/data + a status for the manifest)
        let epcOutcome = { status: 'api_error', records: null };
        let floodOutcome = { status: 'api_error' };

        // Check cache first
        if (supabase) {
          try {
            const { data: cached } = await supabase
              .from('enrichment_cache')
              .select('*')
              .eq('postcode', pc)
              .gt('expires_at', new Date().toISOString())
              .single();

            if (cached) {
              epcOutcome = { status: 'cache_hit', records: cached.epc_data };
              floodOutcome = {
                status: 'cache_hit',
                floodZone: cached.flood_zone,
                floodRiskLevel: cached.flood_zone === "3" ? "High" : cached.flood_zone === "2" ? "Medium" : "Low",
                floodData: cached.flood_data,
                lat: parseFloat(cached.lat),
                lon: parseFloat(cached.lon),
              };
              return { pc, epcOutcome, floodOutcome };
            }
          } catch (cacheErr) {
            // Cache miss or table not ready — proceed with API calls
          }
        }

        // Cache miss — fetch from APIs
        const [epcSettled, floodSettled] = await Promise.allSettled([
          fetchEPCByPostcode(pc),
          fetchFloodZone(pc),
        ]);

        if (epcSettled.status === 'fulfilled' && epcSettled.value) {
          epcOutcome = epcSettled.value;
        }
        if (floodSettled.status === 'fulfilled' && floodSettled.value) {
          floodOutcome = floodSettled.value;
        }

        // Store in cache (only useful data — don't cache errors/skips)
        const hasEpcData = epcOutcome.records && epcOutcome.records.length >= 0 && ['ok', 'api_empty_for_postcode'].includes(epcOutcome.status);
        const hasFloodData = floodOutcome.status === 'ok';
        if (supabase && (hasEpcData || hasFloodData)) {
          try {
            await supabase.from('enrichment_cache').upsert({
              postcode: pc,
              epc_data: hasEpcData ? epcOutcome.records : null,
              flood_zone: hasFloodData ? floodOutcome.floodZone : null,
              flood_data: hasFloodData ? floodOutcome.floodData : null,
              lat: hasFloodData ? floodOutcome.lat : null,
              lon: hasFloodData ? floodOutcome.lon : null,
              cached_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            }, { onConflict: 'postcode' });
          } catch (upsertErr) {
            // Cache write failure is non-fatal
            console.warn(`enrichment_cache upsert failed for ${pc}: ${upsertErr.message}`);
          }
        }

        return { pc, epcOutcome, floodOutcome };
      }));

      // Apply enrichment data + record manifest per lot
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { pc, epcOutcome, floodOutcome } = result.value;
        const lotsForPc = postcodeMap[pc] || [];

        for (const lot of lotsForPc) {
          // ── EPC matching + manifest recording ──
          const addrCompleteness = assessAddressCompleteness(lot.address);
          const epcApiStatus = epcOutcome.status;
          const hasRecords = Array.isArray(epcOutcome.records) && epcOutcome.records.length > 0;

          if (['skipped_no_creds', 'circuit_open', 'api_error', 'timeout', 'skipped_no_postcode'].includes(epcApiStatus)) {
            // API-layer failure — pass through as the lot's outcome
            recordEpc(lot._enrichment, { status: epcApiStatus, addressCompleteness: addrCompleteness });
            // Stash retry intent for transient failures so the retry-queue
            // drain in enrichment-wave.js Pass 6 can re-attempt later.
            // 'circuit_open' burned 27% of all lots in the EPC baseline —
            // by far the biggest single fixable cause of EPC gaps. See
            // coverage-baseline.json + the EPC manifest breakdown query.
            // 'skipped_no_creds' and 'skipped_no_postcode' aren't retried —
            // they won't change without external action (env vars / postcode
            // recovery in a different pass).
            if (['circuit_open', 'api_error', 'timeout'].includes(epcApiStatus)) {
              lot._epcRetry = { reason: epcApiStatus };
            }
          } else if (epcApiStatus === 'api_empty_for_postcode' || (hasRecords === false && epcApiStatus !== 'cache_hit')) {
            recordEpc(lot._enrichment, { status: 'api_empty_for_postcode', addressCompleteness: addrCompleteness });
          } else if (addrCompleteness !== 'full') {
            // API responded with records but this lot's address is too partial to match
            recordEpc(lot._enrichment, { status: 'skipped_incomplete_address', addressCompleteness: addrCompleteness });
          } else {
            // Attempt match on full address
            const epcMatch = hasRecords ? matchEPCToLot(epcOutcome.records, lot.address) : null;
            if (epcMatch) {
              lot.epcRating = epcMatch.epcRating;
              lot.epcScore = epcMatch.epcScore;
              lot.epcDate = epcMatch.epcDate;
              // EPC-sourced floor area persisted separately from lots.sqft
              // so we never lose provenance — sqft can come from listing
              // text, manual entry, or this EPC fallback. Rollout #6.
              lot.epcFloorAreaSqm = epcMatch.epcFloorAreaSqm || null;
              lot.epcFloorAreaSqft = epcMatch.epcFloorAreaSqft || null;
              // Fill beds from EPC if not already extracted
              if (!lot.beds && epcMatch.epcBeds) {
                lot.beds = epcMatch.epcBeds;
                lot._bedsSource = 'epc';
              }
              // Fill sqft from EPC if DOM extractor didn't capture it
              if (!lot.sqft && epcMatch.epcFloorAreaSqft) {
                lot.sqft = epcMatch.epcFloorAreaSqft;
                lot._sqftSource = 'epc';
              }
              recordEpc(lot._enrichment, {
                status: epcApiStatus === 'cache_hit' ? 'cache_hit' : 'ok',
                rating: epcMatch.epcRating,
                score: epcMatch.epcScore,
                date: epcMatch.epcDate,
                floorAreaSqm: epcMatch.epcFloorAreaSqm,
                floorAreaSqft: epcMatch.epcFloorAreaSqft,
                addressCompleteness: 'full',
                matchConfidence: epcMatch._matchConfidence,
              });
              // ── EPC RECOMMENDATIONS — fetch once per matched certificate ──
              // Free API, same Basic-auth client, ~150ms per call. Skipped
              // when the matched record carried no lmk-key (rare).
              if (epcMatch.epcLmkKey) {
                try {
                  const recsOut = await fetchEPCRecommendations(epcMatch.epcLmkKey);
                  if (recsOut.status === 'ok' || recsOut.status === 'empty') {
                    lot.epcWorksCostMid = recsOut.totalCostMid || 0;
                    lot.epcWorksSummary = recsOut.items || [];
                    recordEpcRecommendations(lot._enrichment, {
                      status: recsOut.status,
                      count: (recsOut.items || []).length,
                      total_cost_mid: recsOut.totalCostMid || 0,
                      lmk_key: epcMatch.epcLmkKey,
                    });
                  } else {
                    recordEpcRecommendations(lot._enrichment, { status: recsOut.status, lmk_key: epcMatch.epcLmkKey });
                  }
                } catch (recErr) {
                  console.warn(`EPC recommendations failed for ${epcMatch.epcLmkKey}: ${recErr.message}`);
                  recordEpcRecommendations(lot._enrichment, { status: 'api_error', lmk_key: epcMatch.epcLmkKey });
                }
              } else {
                recordEpcRecommendations(lot._enrichment, { status: 'skipped_no_lmk_key' });
              }
            } else {
              // Records existed, address was complete, matcher found nothing — the alertable case
              recordEpc(lot._enrichment, { status: 'no_match_with_address', addressCompleteness: 'full' });
              recordEpcRecommendations(lot._enrichment, { status: 'skipped_not_matched' });
            }
          }

          // MEES regulatory risk for poor EPC ratings
          if (lot.epcRating && /^[EFG]$/i.test(lot.epcRating)) {
            if (!lot.risks) lot.risks = [];
            if (!lot.risks.some(r => /MEES|EPC.*unlettable|cannot.*legally.*let/i.test(r))) {
              const rating = lot.epcRating.toUpperCase();
              if (/^[FG]$/i.test(rating)) {
                lot.risks.push(`EPC ${rating} — cannot legally let without upgrading (MEES regs)`);
              } else {
                lot.risks.push(`EPC E — at risk under tightening MEES regulations`);
              }
            }
          }

          // ── Flood zone + coordinates + manifest ──
          if (floodOutcome.status === 'ok' || floodOutcome.status === 'cache_hit') {
            lot.floodZone = floodOutcome.floodZone;
            lot.floodRiskLevel = floodOutcome.floodRiskLevel;
            if (floodOutcome.lat != null) lot._lat = floodOutcome.lat;
            if (floodOutcome.lon != null) lot._lng = floodOutcome.lon;
            recordFlood(lot._enrichment, {
              status: floodOutcome.status,
              zone: floodOutcome.floodZone,
              level: floodOutcome.floodRiskLevel,
              source: floodOutcome.floodData?.source,
            });
          } else {
            recordFlood(lot._enrichment, { status: floodOutcome.status });
          }

          lot.enrichedAt = new Date().toISOString();
          markEnriched(lot._enrichment);
        }
      }
    }

    const epcCount = lots.filter(l => l.epcRating).length;
    const floodCount = lots.filter(l => l.floodZone).length;
    const bedsCount = lots.filter(l => l.beds != null).length;
    const bedsFromEpc = lots.filter(l => l._bedsSource === 'epc').length;
    const sqftFromEpc = lots.filter(l => l._sqftSource === 'epc').length;
    console.log(`EPC/Flood enrichment done: ${epcCount} lots with EPC, ${floodCount} lots with flood zone, beds: ${bedsCount}/${lots.length} (${Math.round(bedsCount/lots.length*100)}%${bedsFromEpc ? ', ' + bedsFromEpc + ' from EPC' : ''}${sqftFromEpc ? `, ${sqftFromEpc} sqft from EPC` : ''})`);
  } catch (enrichErr) {
    console.warn(`EPC/Flood enrichment failed (non-fatal): ${enrichErr.message}`);
  }

  // ── Final manifest cleanup: any lot that didn't get an EPC/flood entry
  // (e.g. had no postcode, or the enrichment block threw) gets the correct
  // skipped status so the manifest never has null entries for sources the
  // pipeline was responsible for.
  for (const lot of lots) {
    if (!lot._enrichment) continue;
    if (!lot._enrichment.epc) {
      recordEpc(lot._enrichment, {
        status: lot.postcode ? 'skipped_incomplete_address' : 'skipped_no_postcode',
        addressCompleteness: assessAddressCompleteness(lot.address),
      });
    }
    if (!lot._enrichment.flood) {
      recordFlood(lot._enrichment, { status: lot.postcode ? 'api_error' : 'no_postcode' });
    }
    markEnriched(lot._enrichment);
  }

  // Re-sort by score after enrichment
  lots.sort((a, b) => b.score - a.score);
  console.log(`Enrichment complete. ${Object.values(lrCache).flat().length} total Land Registry sales found.`);
  return lots;
}
// ═══════════════════════════════════════════════════════════════
// ENRICHMENT CACHE TABLE INIT
// ═══════════════════════════════════════════════════════════════
export async function ensureEnrichmentCacheTable() {
  if (!supabase) return;
  try {
    // Check if table exists by attempting a simple query
    const { error } = await supabase.from('enrichment_cache').select('postcode').limit(1);
    if (error && error.code === '42P01') {
      // Table doesn't exist — create via raw SQL using rpc
      console.log('Creating enrichment_cache table...');
      const { error: createErr } = await supabase.rpc('exec_sql', {
        sql: `
          CREATE TABLE IF NOT EXISTS enrichment_cache (
            postcode TEXT PRIMARY KEY,
            epc_data JSONB,
            flood_zone TEXT,
            flood_data JSONB,
            lat NUMERIC(9,6),
            lon NUMERIC(9,6),
            lr_data JSONB,
            lr_expires_at TIMESTAMPTZ,
            cached_at TIMESTAMPTZ DEFAULT NOW(),
            expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
          );
          CREATE INDEX IF NOT EXISTS idx_enrichment_expires ON enrichment_cache(expires_at);
        `
      });
      if (createErr) {
        console.warn('enrichment_cache table creation via rpc failed (create manually in Supabase dashboard):', createErr.message);
        console.log(`SQL to run manually:
CREATE TABLE IF NOT EXISTS enrichment_cache (
  postcode TEXT PRIMARY KEY,
  epc_data JSONB,
  flood_zone TEXT,
  flood_data JSONB,
  lat NUMERIC(9,6),
  lon NUMERIC(9,6),
  lr_data JSONB,
  lr_expires_at TIMESTAMPTZ,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);
CREATE INDEX IF NOT EXISTS idx_enrichment_expires ON enrichment_cache(expires_at);
ALTER TABLE enrichment_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON enrichment_cache FOR ALL USING (true) WITH CHECK (true);`);
      } else {
        console.log('enrichment_cache table created successfully');
      }
    } else if (!error) {
      console.log('enrichment_cache table exists');
      // Migrate: add LR columns if missing
      try {
        await supabase.rpc('exec_sql', {
          sql: `ALTER TABLE enrichment_cache ADD COLUMN IF NOT EXISTS lr_data JSONB; ALTER TABLE enrichment_cache ADD COLUMN IF NOT EXISTS lr_expires_at TIMESTAMPTZ;`
        });
      } catch { /* columns may already exist or rpc unavailable */ }
    }
  } catch (e) {
    console.warn('enrichment_cache table check failed:', e.message);
  }
}
