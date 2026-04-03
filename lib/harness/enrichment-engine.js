// ═══════════════════════════════════════════════════════════════
// ENRICHMENT ENGINE — Proactive gap-filling (never overwrites good data)
// ═══════════════════════════════════════════════════════════════

import { fireAlert } from './alert-router.js';

// Fields safe to carry forward from previous cache
const CARRYFORWARD_FIELDS = ['tenure', 'beds', 'condition', 'leaseLength', 'sqft'];
// Fields NOT safe to carry forward (change between catalogues)
// price, status, imageUrl — excluded

/**
 * Check if a field value is "empty" (missing, blank, or placeholder).
 */
function isEmpty(val) {
  if (val === null || val === undefined) return true;
  if (typeof val === 'string' && (val.trim() === '' || val.toLowerCase() === 'unknown')) return true;
  if (typeof val === 'number' && val === 0) return true;
  return false;
}

/**
 * Extract beds from address string.
 * e.g., "3 Bed Semi" → 3, "Flat 4, 12 High Street" → null
 */
function extractBedsFromAddress(address) {
  if (!address) return null;
  const m = address.match(/(\d+)\s*(?:bed(?:room)?s?)/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Infer property type from address.
 */
function inferPropTypeFromAddress(address) {
  if (!address) return null;
  const lower = address.toLowerCase();
  if (/\bflat\b|\bapartment\b|\bmaisonette\b|\bstudio\b/.test(lower)) return 'flat';
  if (/\bdetached\b|\bsemi[\s-]?detached\b|\bterrace[d]?\b|\bbungalow\b|\bcottage\b/.test(lower)) return 'house';
  if (/\bland\b|\bplot\b/.test(lower)) return 'land';
  return null;
}

/**
 * Enrich a batch of lots by filling gaps — iron rule: never overwrite existing good data.
 *
 * @param {object[]} lots - Validated/normalized lots from data-contract
 * @param {string} house - House slug
 * @param {{ previousCache?: object[], maxLotPages?: number }} options
 * @returns {{ lots: object[], stats: { enriched: number, fieldsImproved: string[], unchanged: number, strategies: object } }}
 */
export function enrichBatch(lots, house, options = {}) {
  const previousCache = options.previousCache || [];
  const stats = {
    enriched: 0,
    fieldsImproved: [],
    unchanged: 0,
    strategies: { crossLot: 0, cacheCarry: 0, addressInfer: 0 },
  };

  if (!Array.isArray(lots) || lots.length === 0) {
    return { lots, stats };
  }

  // Build previous cache lookup by lot number
  const prevByLot = new Map();
  for (const pl of previousCache) {
    const key = pl.lot || pl.lotNumber;
    if (key) prevByLot.set(String(key), pl);
  }

  // ── Strategy 1: Cross-lot inference ──
  // If 80%+ of lots have a value, infer for blanks (with safety constraints)
  const tenureCounts = {};
  for (const lot of lots) {
    if (!isEmpty(lot.tenure)) {
      tenureCounts[lot.tenure] = (tenureCounts[lot.tenure] || 0) + 1;
    }
  }
  const dominantTenure = Object.entries(tenureCounts)
    .sort((a, b) => b[1] - a[1])[0];
  const tenureThreshold = lots.length * 0.8;

  for (const lot of lots) {
    let enrichedAny = false;
    const enrichedFields = lot._enrichedFields ? [...lot._enrichedFields] : [];

    // Cross-lot tenure inference (only for houses — flats are risky)
    if (isEmpty(lot.tenure) && dominantTenure && dominantTenure[1] >= tenureThreshold) {
      const propType = (lot.propType || '').toLowerCase();
      // Only infer freehold for houses, never for flats
      if (dominantTenure[0] === 'Freehold' && propType !== 'flat') {
        lot.tenure = dominantTenure[0];
        enrichedFields.push('tenure');
        enrichedAny = true;
        stats.strategies.crossLot++;
      }
    }

    // ── Strategy 2: Previous-cache merge (carry forward) ──
    const lotKey = String(lot.lot || lot.lotNumber || '');
    const prev = prevByLot.get(lotKey);
    if (prev) {
      for (const field of CARRYFORWARD_FIELDS) {
        if (isEmpty(lot[field]) && !isEmpty(prev[field])) {
          lot[field] = prev[field];
          enrichedFields.push(field);
          enrichedAny = true;
          stats.strategies.cacheCarry++;
        }
      }
    }

    // ── Strategy 3: Address-based inference ──
    if (lot.address) {
      // Beds from address
      if (isEmpty(lot.beds)) {
        const beds = extractBedsFromAddress(lot.address);
        if (beds && beds > 0 && beds <= 20) {
          lot.beds = beds;
          enrichedFields.push('beds');
          enrichedAny = true;
          stats.strategies.addressInfer++;
        }
      }

      // PropType from address
      if (isEmpty(lot.propType)) {
        const inferred = inferPropTypeFromAddress(lot.address);
        if (inferred) {
          lot.propType = inferred;
          enrichedFields.push('propType');
          enrichedAny = true;
          stats.strategies.addressInfer++;
        }
      }

      // Tenure from propType inference
      if (isEmpty(lot.tenure)) {
        const propType = (lot.propType || '').toLowerCase();
        if (propType === 'flat' || /\bflat\b/.test((lot.address || '').toLowerCase())) {
          lot.tenure = 'Leasehold';
          enrichedFields.push('tenure');
          enrichedAny = true;
          stats.strategies.addressInfer++;
        }
      }
    }

    // Tag enriched fields
    if (enrichedFields.length > 0) {
      lot._enrichedFields = [...new Set(enrichedFields)];
    }

    if (enrichedAny) {
      stats.enriched++;
      for (const f of enrichedFields) {
        if (!stats.fieldsImproved.includes(f)) stats.fieldsImproved.push(f);
      }
    } else {
      stats.unchanged++;
    }
  }

  return { lots, stats };
}

/**
 * Get enrichment report for a house (gap analysis).
 */
export function getEnrichmentReport(lots, house) {
  if (!Array.isArray(lots) || lots.length === 0) {
    return { house, totalLots: 0, gaps: {}, enrichedCount: 0 };
  }

  const fields = ['price', 'address', 'imageUrl', 'tenure', 'beds', 'url', 'propType', 'condition'];
  const gaps = {};
  for (const field of fields) {
    const missing = lots.filter(l => isEmpty(l[field])).length;
    gaps[field] = {
      missing,
      coverage: Math.round(((lots.length - missing) / lots.length) * 100),
    };
  }

  const enrichedCount = lots.filter(l => l._enrichedFields && l._enrichedFields.length > 0).length;

  return { house, totalLots: lots.length, gaps, enrichedCount };
}
