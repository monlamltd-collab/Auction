-- migrations/2026-05-10-epc-works.sql
--
-- EPC Recommendations support — extends the existing EPC enrichment to
-- pull the per-certificate /recommendations/{lmkKey} endpoint from
-- epc.opendatacommunities.org (free API, same Basic-auth client).
--
-- Each recommendation carries an HMG-published `indicative_cost` (e.g.
-- "£3,300 - £6,500"), which we parse to a numeric mid-point. Summing
-- them gives a "deferred capex" figure — feeds the rule-based value
-- estimator (lib/pipeline/value-estimator.js) and the future paid
-- AI-lot-value-report.
--
--   epc_works_cost_mid  -- Sum of mid-point indicative costs across all
--                          recommendations attached to the matched EPC
--                          certificate. NULL if no EPC match or the
--                          recommendations endpoint returned empty.
--
--   epc_works_summary   -- JSONB array, one entry per recommendation:
--                          [{ id, label, cost_mid, summary }, ...]
--                          UI uses this to render category chips
--                          ("single glazing", "no loft insulation").
--
-- Idempotent. Apply via Supabase MCP `apply_migration`.

ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS epc_works_cost_mid INTEGER,
  ADD COLUMN IF NOT EXISTS epc_works_summary  JSONB;
