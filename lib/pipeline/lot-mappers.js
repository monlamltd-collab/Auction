// lib/pipeline/lot-mappers.js — DB row ↔ frontend lot object mappers + LOTS_SELECT constant

// ── Standard lots select columns for DB queries ──
export const LOTS_SELECT = 'house, lot_number, url, catalogue_url, address, postcode, price, price_text, prop_type, beds, tenure, lease_length, sqft, condition, image_url, bullets, units, auction_date, status, sold_price, epc_rating, epc_score, epc_date, flood_zone, flood_risk, street_avg, street_sales, street_sales_count, below_market, est_monthly_rent, est_annual_rent, est_gross_yield, score, score_breakdown, opps, risks, deal_type, vacant, title_split, search_text, enrichment_manifest, last_seen_at';

/**
 * Create a dbRowToLot function with injected extractPostcode dependency.
 * @param {{ extractPostcode: Function }} deps
 * @returns {Function}
 */
export function createDbRowToLot(deps) {
  return function dbRowToLot(dbRow) {
    return {
      lot: dbRow.lot_number, address: dbRow.address, postcode: dbRow.postcode || deps.extractPostcode(dbRow.address),
      price: dbRow.price, priceText: dbRow.price_text, propType: dbRow.prop_type, beds: dbRow.beds,
      tenure: dbRow.tenure, leaseLength: dbRow.lease_length, sqft: dbRow.sqft, condition: dbRow.condition,
      imageUrl: dbRow.image_url, bullets: dbRow.bullets || [], units: dbRow.units || 0,
      status: dbRow.status || 'available', soldPrice: dbRow.sold_price,
      epcRating: dbRow.epc_rating, epcScore: dbRow.epc_score, epcDate: dbRow.epc_date,
      floodZone: dbRow.flood_zone, floodRiskLevel: dbRow.flood_risk,
      streetAvg: dbRow.street_avg, streetSales: dbRow.street_sales, streetSalesCount: dbRow.street_sales_count,
      belowMarket: dbRow.below_market, estMonthlyRent: dbRow.est_monthly_rent,
      estAnnualRent: dbRow.est_annual_rent, estGrossYield: dbRow.est_gross_yield,
      score: dbRow.score != null ? dbRow.score : 0, scoreBreakdown: dbRow.score_breakdown || [],
      opps: dbRow.opps || [], risks: dbRow.risks || [], dealType: dbRow.deal_type,
      vacant: dbRow.vacant, titleSplit: dbRow.title_split, url: dbRow.url, enrichedAt: dbRow.enriched_at,
      rawText: dbRow.raw_text || null,
      _enrichment: dbRow.enrichment_manifest || null,
      _dbId: dbRow.id, _house: dbRow.house, _catalogueUrl: dbRow.catalogue_url,
      _lastSeenAt: dbRow.last_seen_at || null,
    };
  };
}

/**
 * Convert DB row to frontend-ready camelCase lot (for API responses).
 * Pure function — no dependencies.
 */
export function dbRowToFrontendLot(r) {
  return {
    _house: r.house, lot: r.lot_number, url: r.url, _sourceUrl: r.catalogue_url,
    address: r.address, postcode: r.postcode, price: r.price, priceText: r.price_text,
    propType: r.prop_type, beds: r.beds, tenure: r.tenure, leaseLength: r.lease_length,
    sqft: r.sqft, condition: r.condition, imageUrl: r.image_url, bullets: r.bullets || [],
    units: r.units || 0, _auctionDate: r.auction_date, status: r.status, soldPrice: r.sold_price,
    epcRating: r.epc_rating, epcScore: r.epc_score, epcDate: r.epc_date,
    floodZone: r.flood_zone, floodRiskLevel: r.flood_risk, streetAvg: r.street_avg,
    streetSales: r.street_sales, streetSalesCount: r.street_sales_count,
    belowMarket: r.below_market, estMonthlyRent: r.est_monthly_rent,
    estAnnualRent: r.est_annual_rent,
    estGrossYield: r.est_gross_yield != null ? parseFloat(r.est_gross_yield) : null,
    score: r.score != null ? parseFloat(r.score) : null, scoreBreakdown: r.score_breakdown || [],
    opps: r.opps || [], risks: r.risks || [], dealType: r.deal_type,
    vacant: r.vacant, titleSplit: r.title_split,
    _searchText: r.search_text || '',
    _enrichment: r.enrichment_manifest || null,
    _lastSeenAt: r.last_seen_at || null,
  };
}
