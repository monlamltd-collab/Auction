-- 2026-04-24: Round-robin status drift tracking
-- Records the last time statusDriftTick sampled each house so the
-- scheduler can rotate through all houses with upcoming lots instead
-- of always picking the one with the most.
ALTER TABLE house_skills
  ADD COLUMN IF NOT EXISTS last_drift_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_house_skills_drift_checked
  ON house_skills (last_drift_checked_at NULLS FIRST);
