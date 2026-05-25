// contracts/lot.contract.js — Pinned LOT type contract.
//
// Source of truth: lib/types/lot.js (LOT_COLUMNS, dbRowToLot).
// Pin policy: bump LOT_SCHEMA_VERSION when LOT_COLUMNS or LOT_APP_FIELDS
//   changes in any way (additive or breaking). The CI harness
//   (contracts/check.js) enforces this — modifying either set without a
//   version bump fails the build.
// See contracts/README.md for the bump procedure.

export const LOT_SCHEMA_VERSION = '1.0.0';

// Snake-case DB columns the app's standard lot SELECT pulls.
// Mirrors LOT_COLUMNS in lib/types/lot.js. Additive changes (new columns)
// require a version bump; removals/renames fail the CI gate outright.
export const LOT_COLUMNS_PINNED = Object.freeze([
  'house', 'lot_number', 'url', 'catalogue_url', 'address', 'postcode',
  'lat', 'lng', 'price', 'price_text', 'price_status', 'prop_type', 'beds',
  'tenure', 'lease_length', 'sqft', 'condition', 'image_url', 'images',
  'floor_plan_url', 'bullets', 'units', 'auction_date', 'status',
  'sold_price', 'epc_rating', 'epc_score', 'epc_date', 'epc_floor_area_sqm',
  'epc_floor_area_sqft', 'epc_works_cost_mid', 'epc_works_summary',
  'flood_zone', 'flood_risk', 'street_avg', 'street_sales',
  'street_sales_count', 'below_market', 'est_monthly_rent',
  'est_annual_rent', 'est_gross_yield', 'score', 'score_breakdown', 'opps',
  'risks', 'deal_type', 'vacant', 'title_split', 'search_text',
  'enrichment_manifest', 'value_estimate', 'last_seen_at', 'quality_score',
  'quality_issues',
]);

// camelCase app-side keys emitted by dbRowToLot in lib/types/lot.js.
// Includes the closed underscore-prefixed legacy set (see lib/types/lot.js
// header for the rationale). Consumers read these by literal string key.
export const LOT_APP_FIELDS_PINNED = Object.freeze([
  'lot', 'address', 'postcode', 'url',
  'price', 'priceText', 'priceStatus',
  'propType', 'beds', 'tenure', 'leaseLength', 'sqft', 'condition',
  'imageUrl', 'images', 'floorPlanUrl', 'bullets', 'units',
  'status', 'soldPrice',
  'epcRating', 'epcScore', 'epcDate', 'epcFloorAreaSqm', 'epcFloorAreaSqft',
  'epcWorksCostMid', 'epcWorksSummary',
  'floodZone', 'floodRiskLevel',
  'streetAvg', 'streetSales', 'streetSalesCount',
  'belowMarket', 'estMonthlyRent', 'estAnnualRent', 'estGrossYield',
  'score', 'scoreBreakdown', 'opps', 'risks', 'dealType',
  'vacant', 'titleSplit',
  'valueEstimate',
  'qualityScore', 'qualityIssues',
  'enrichedAt', 'rawText',
  '_dbId', '_house', '_catalogueUrl', '_sourceUrl', '_auctionDate',
  '_searchText', '_lastSeenAt', '_enrichment',
]);
