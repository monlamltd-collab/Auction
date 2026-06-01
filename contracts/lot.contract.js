// contracts/lot.contract.js — Pinned LOT type contract.
//
// Source of truth: lib/types/lot.js (LOT_COLUMNS, dbRowToLot).
// Pin policy: bump LOT_SCHEMA_VERSION when LOT_COLUMNS or LOT_APP_FIELDS
//   changes in any way (additive or breaking). The CI harness
//   (contracts/check.js) enforces this — modifying either set without a
//   version bump fails the build.
// See contracts/README.md for the bump procedure.

// 2.0.0 — lean rebuild (migrations/rebuild-lots.sql, 2026-06-01). Breaking:
// dropped raw_text, search_vector, est_annual_rent, epc_date,
// epc_floor_area_sqft, epc_works_cost_mid, epc_works_summary,
// os_classification, extracted_with, scraped_with, quality_score,
// quality_issues, street_sales; renamed street_avg→comparable_price,
// epc_floor_area_sqm→floor_area_sqm, floor_plan_url→floor_plans;
// added auctioneer, created_at. (field_sources→sources rename deferred.)
export const LOT_SCHEMA_VERSION = '2.0.0';

// Snake-case DB columns the app's standard lot SELECT pulls.
// Mirrors LOT_COLUMNS in lib/types/lot.js. Additive changes (new columns)
// require a version bump; removals/renames fail the CI gate outright.
export const LOT_COLUMNS_PINNED = Object.freeze([
  'house', 'auctioneer', 'lot_number', 'url', 'catalogue_url', 'address',
  'postcode', 'lat', 'lng', 'price', 'price_text', 'price_status', 'prop_type',
  'beds', 'tenure', 'lease_length', 'sqft', 'condition', 'image_url', 'images',
  'floor_plans', 'bullets', 'units', 'auction_date', 'status', 'sold_price',
  'epc_rating', 'epc_score', 'floor_area_sqm', 'flood_zone', 'flood_risk',
  'comparable_price', 'street_sales_count', 'below_market', 'est_monthly_rent',
  'est_gross_yield', 'score', 'score_breakdown', 'opps', 'risks', 'deal_type',
  'vacant', 'title_split', 'search_text', 'enrichment_manifest',
  'value_estimate', 'last_seen_at',
]);

// camelCase app-side keys emitted by dbRowToLot in lib/types/lot.js.
// Includes the closed underscore-prefixed legacy set (see lib/types/lot.js
// header for the rationale). Consumers read these by literal string key.
// streetAvg / floorPlanUrl / epcFloorAreaSqm / estAnnualRent are retained as
// back-compat aliases over the renamed/derived columns.
export const LOT_APP_FIELDS_PINNED = Object.freeze([
  'lot', 'address', 'postcode', 'url',
  'price', 'priceText', 'priceStatus',
  'propType', 'beds', 'tenure', 'leaseLength', 'sqft', 'condition',
  'imageUrl', 'images', 'floorPlans', 'floorPlanUrl', 'bullets', 'units',
  'status', 'soldPrice',
  'epcRating', 'epcScore', 'floorAreaSqm', 'epcFloorAreaSqm',
  'floodZone', 'floodRiskLevel',
  'comparablePrice', 'streetAvg', 'streetSalesCount',
  'belowMarket', 'estMonthlyRent', 'estAnnualRent', 'estGrossYield',
  'score', 'scoreBreakdown', 'opps', 'risks', 'dealType',
  'vacant', 'titleSplit',
  'valueEstimate', 'auctioneer',
  'enrichedAt',
  '_dbId', '_house', '_catalogueUrl', '_sourceUrl', '_auctionDate',
  '_searchText', '_lastSeenAt', '_enrichment',
]);
