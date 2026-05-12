-- 2026-05-12: Adaptive scheduling on changeStatus signal
--
-- Records the outcome of each scrape so the scheduler can back off on
-- stable catalogues. consecutive_same_count climbs every 'same' result and
-- resets to 0 on any 'changed' result. next_scrape_at is the wall-clock
-- when this house is next eligible for a scrape; the scheduler tick skips
-- houses whose next_scrape_at is in the future (unless forced).
--
-- Backoff curve (computed in lib/pipeline/scheduling.js::intervalForCount):
--   consecutive_same=0 → 6h
--   consecutive_same=1 → 12h
--   consecutive_same=2 → 24h
--   consecutive_same=3 → 48h
--   consecutive_same=4 → 96h
--   consecutive_same≥5 → 168h (weekly cap)
-- Freshness floor: never let next_scrape_at exceed last_full_extract_at + 7d.

ALTER TABLE house_skills
  ADD COLUMN IF NOT EXISTS last_probe_at TIMESTAMPTZ;

ALTER TABLE house_skills
  ADD COLUMN IF NOT EXISTS last_probe_result TEXT
    CHECK (last_probe_result IN ('same', 'changed', 'error'));

ALTER TABLE house_skills
  ADD COLUMN IF NOT EXISTS last_full_extract_at TIMESTAMPTZ;

ALTER TABLE house_skills
  ADD COLUMN IF NOT EXISTS consecutive_same_count INTEGER DEFAULT 0;

ALTER TABLE house_skills
  ADD COLUMN IF NOT EXISTS next_scrape_at TIMESTAMPTZ;

-- Partial index — only houses with a scheduled time are interesting.
CREATE INDEX IF NOT EXISTS idx_house_skills_next_scrape_at
  ON house_skills (next_scrape_at)
  WHERE next_scrape_at IS NOT NULL;
