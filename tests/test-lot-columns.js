// tests/test-lot-columns.js — The GATE RULE, enforced.
//
// A column exists on `lots` (and in the LOT_COLUMNS select contract) only if
// it is one of:
//   • displayed — rendered to the investor in public/app.js
//   • scoring   — feeds analyseLot() (lib/pipeline/scoring.js) or fundability
//   • system    — required infrastructure (keys, provenance, search, recency)
//
// Everything else is derived-on-read or does not exist. This test fails the
// build if LOT_COLUMNS drifts from that rule, if a banned/dead column sneaks
// back in, or if the pinned contract falls out of sync with the mapper.
//
// Source of truth: lib/types/lot.js (LOT_COLUMNS). Schema: migrations/rebuild-lots.sql.

import { LOT_COLUMNS } from '../lib/types/lot.js';
import { LOT_COLUMNS_PINNED } from '../contracts/lot.contract.js';

let failures = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

// ── The gate: every kept column, with its justification ──────────────────────
// reason ∈ {displayed, scoring, system}. A column with no entry here is a
// gate violation — you must justify it or remove it.
const GATE = {
  // System infrastructure
  id: 'system',                   // DB UUID -> lot._dbId; shareable lot URL + ?lot= drawer deep-link
  house: 'system',                // canonical slug / join key
  url: 'system',                  // detail link + upsert conflict key
  catalogue_url: 'system',        // source catalogue
  search_text: 'system',          // ILIKE search blob
  enrichment_manifest: 'system',  // per-scrape observability (no silent failures)
  last_seen_at: 'system',         // active-feed recency gate
  lat: 'system',                  // map + radius search
  lng: 'system',

  // Displayed to the investor
  auctioneer: 'displayed',
  lot_number: 'displayed',
  address: 'displayed',
  postcode: 'displayed',
  price_text: 'displayed',
  price_status: 'displayed', // drives the Nil Reserve badge + price-coverage gap accounting
  lease_length: 'displayed',
  image_url: 'displayed',
  images: 'displayed',
  floor_plans: 'displayed',
  auction_date: 'displayed',
  status: 'displayed',
  epc_rating: 'displayed',
  epc_score: 'displayed',
  flood_zone: 'displayed',
  comparable_price: 'displayed',
  street_sales_count: 'displayed',
  below_market: 'displayed',
  score_breakdown: 'displayed',
  deal_type: 'displayed',
  value_estimate: 'displayed',

  // Feeds score / fundability (also displayed, but the scoring tie is why it stays)
  price: 'scoring',
  prop_type: 'scoring',
  beds: 'scoring',
  tenure: 'scoring',
  sqft: 'scoring',
  condition: 'scoring',
  bullets: 'scoring',
  units: 'scoring',
  floor_area_sqm: 'scoring',
  flood_risk: 'scoring',
  est_monthly_rent: 'scoring',
  est_gross_yield: 'scoring',
  score: 'scoring',
  opps: 'scoring',
  risks: 'scoring',
  vacant: 'scoring',
  title_split: 'scoring',
};

// Columns that MUST NOT reappear — removed by the lean rebuild
// (migrations/rebuild-lots.sql). Renamed-away names included so a rename
// regression is also caught.
const BANNED = new Set([
  'raw_text', 'search_vector', 'est_annual_rent', 'epc_date',
  'epc_floor_area_sqft', 'epc_floor_area_sqm', 'epc_works_cost_mid',
  'epc_works_summary', 'os_classification', 'extracted_with', 'scraped_with',
  'quality_score', 'quality_issues', 'street_sales', 'street_avg',
  'floor_plan_url', 'sold_price',
  // price_status was dropped in the 3.0.0 lean rebuild but REINSTATED in 3.1.0
  // as a live price-intent column (2026-06-12) — see contracts/lot.contract.js.
]);

const VALID_REASONS = new Set(['displayed', 'scoring', 'system']);

console.log('LOT_COLUMNS gate rule:');

// 1. Every selected column is justified by the gate.
for (const col of LOT_COLUMNS) {
  const reason = GATE[col];
  check(VALID_REASONS.has(reason), `"${col}" is ${reason || 'UNJUSTIFIED'} (displayed | scoring | system)`);
}

// 2. No banned/dead column is present.
for (const col of LOT_COLUMNS) {
  check(!BANNED.has(col), `"${col}" is not a banned/dropped column`);
}

// 3. The GATE table has no stale entries (a column removed from LOT_COLUMNS
//    should be removed from the gate too, so this stays a live contract).
const colSet = new Set(LOT_COLUMNS);
for (const col of Object.keys(GATE)) {
  check(colSet.has(col), `gate entry "${col}" still corresponds to a real column`);
}

// 4. The pinned CI contract matches the mapper's column list exactly.
check(
  JSON.stringify([...LOT_COLUMNS].sort()) === JSON.stringify([...LOT_COLUMNS_PINNED].sort()),
  'LOT_COLUMNS matches contracts/lot.contract.js LOT_COLUMNS_PINNED',
);

if (failures > 0) {
  console.error(`\ntest-lot-columns: FAIL — ${failures} gate violation(s).`);
  process.exit(1);
}
console.log('\ntest-lot-columns: PASS');
