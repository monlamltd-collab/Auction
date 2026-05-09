-- migrations/2026-05-09-coverage-snapshots.sql
-- Daily snapshot of enrichment coverage percentages.
-- Used by lib/pipeline/coverage-digest.js to compute day-over-day deltas
-- in the daily Telegram digest.
--
-- Apply via Supabase MCP `apply_migration` after `confirm_cost` — single
-- new table, no impact on existing data.

CREATE TABLE IF NOT EXISTS coverage_snapshots (
  date date PRIMARY KEY,
  total_lots integer NOT NULL DEFAULT 0,
  epc_pct numeric(5,1) NOT NULL DEFAULT 0,
  flood_pct numeric(5,1) NOT NULL DEFAULT 0,
  land_registry_pct numeric(5,1) NOT NULL DEFAULT 0,
  geocode_pct numeric(5,1) NOT NULL DEFAULT 0,
  fundability_pct numeric(5,1) NOT NULL DEFAULT 0,
  image_pct numeric(5,1) NOT NULL DEFAULT 0,
  postcode_pct numeric(5,1) NOT NULL DEFAULT 0,
  yield_pct numeric(5,1) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE coverage_snapshots IS
  'Daily enrichment coverage percentages — written by the daily digest cron in server.js scheduleTick(). One row per day; primary key is date.';
