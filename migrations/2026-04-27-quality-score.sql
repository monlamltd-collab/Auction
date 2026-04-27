-- ═══════════════════════════════════════════════════════════════
-- Per-lot quality score + per-house coverage regression detection
-- (COVERAGE_FIX_PLAN.md rollout #4)
-- ═══════════════════════════════════════════════════════════════
-- Adds two storage layers:
--   • lots.quality_score / lots.quality_issues — per-lot completeness signal
--     for frontend filter/sort and post-deploy auditing.
--   • house_skills.field_coverage_history — JSONB ringbuffer of recent
--     per-field coverage stats. Drives relative-to-previous regression
--     alerts (a house that drops 10+ points scrape-over-scrape on any
--     critical field fires a targeted alert via the harness).
--
-- Why relative-to-previous instead of blanket SLAs:
--   The plan suggested blanket thresholds (image ≥ 95%, UPRN ≥ 80%, etc.),
--   but baseline data shows those would fire constantly for houses with
--   structural gaps (Charles Darrow at 17.6% image is real; every house at
--   0% UPRN is structural). Relative deltas catch real regressions without
--   the false-positive noise. See coverage-baseline.json.
--
-- Idempotent — safe to re-run.

-- 1. Per-lot quality score (0-100)
ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS quality_score INTEGER;

-- 2. Per-lot issue list — array of short codes like ["no_image","poa_price"]
ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS quality_issues JSONB DEFAULT '[]'::jsonb;

-- Index supports "show me low-quality lots" filtering on the frontend.
-- Partial index keeps it small — high-quality lots dominate.
CREATE INDEX IF NOT EXISTS idx_lots_low_quality
  ON lots(quality_score)
  WHERE quality_score IS NOT NULL AND quality_score < 70;

-- 3. Per-house field coverage history — last N cycles per house.
-- Shape: { history: [{ scraped_at, total_lots, image_pct, price_pct,
--   postcode_pct, uprn_pct, epc_pct }, ...] }
-- Keeps last 5 entries; older ones trimmed by the persist hook.
ALTER TABLE house_skills
  ADD COLUMN IF NOT EXISTS field_coverage_history JSONB DEFAULT '{"history":[]}'::jsonb;
