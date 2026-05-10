-- migrations/2026-05-10-value-estimate.sql
--
-- Rule-based Value Estimator output — the composer in
-- lib/pipeline/value-estimator.js writes one JSONB blob per lot:
--
--   {
--     estimate:          172500,
--     low: 162000, high: 183000,
--     confidence:        'high' | 'medium' | 'low',
--     breakdown: {
--       anchor:          188000,
--       anchor_source:   'street_psqft' | 'street_median' | 'area_avg',
--       condition_pct:   -10,
--       condition_signals: ['Needs modernisation'],
--       epc_works_deduction: 5500,
--       epc_works_count: 3,
--       comp_count:      7,
--       comp_window_months: 36,
--       hpi_age_adjusted: true,
--       formula_text:    'Based on 7 comparable sales in BS5 ...',
--       caps_hit:        []        -- e.g. ['negative_floor']
--     },
--     generated_at:      '2026-05-10T...'
--   }
--
-- Computed during enrichment-wave Pass 3 from data already on the lot
-- (street_avg, hpi_avg_price, opps[], risks[], epc_floor_area_sqft,
-- epc_works_cost_mid). Pure function — no API calls, no AI cost.
--
-- GIN index supports ad-hoc filtering ("show me high-confidence lots
-- with anchor_source=street_psqft below estimate") in admin tools.
--
-- Idempotent. Apply via Supabase MCP `apply_migration`.

ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS value_estimate JSONB;

CREATE INDEX IF NOT EXISTS lots_value_estimate_gin_idx
  ON lots USING GIN (value_estimate);
