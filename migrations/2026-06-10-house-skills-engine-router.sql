-- migrations/2026-06-10-house-skills-engine-router.sql
-- Best-engine-first router support (see docs/ENGINE-ROUTER.md).
--
-- The pipeline now selects the best scraping engine per house by scored
-- trade-off (recall → reliability → cost) rather than a fixed Firecrawl-first
-- order. Three additive, nullable columns back the hybrid router:
--
--   preferred_engine  — the learned policy. Seeded by the onboarding profiler,
--                       refined by the adaptive feedback loop. NULL = "no policy
--                       yet, use the deterministic default (Firecrawl)".
--                       One of: 'firecrawl' | 'crawlee' | 'api' | 'pdf-gemini'.
--   engine_locked     — manual override. When set, always wins over the learned
--                       policy and the profiler (operator escape hatch). NULL =
--                       not locked.
--   engine_stats      — per-engine rolling outcome rollup used by the tuner:
--                       { "<engine>": { runs, successes, recallSum, recallRuns,
--                                       creditSum, lastRunAt } }. JSONB so the
--                       set of engines can grow (bright-data, etc.) without a
--                       migration. Defaults to '{}'.
--
-- All three are nullable / defaulted so existing rows keep working unchanged and
-- the router falls back to Firecrawl until a policy is written. Idempotent.

ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS preferred_engine TEXT;
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS engine_locked    TEXT;
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS engine_stats     JSONB DEFAULT '{}'::jsonb;
