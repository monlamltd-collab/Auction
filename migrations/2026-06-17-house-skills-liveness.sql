-- 2026-06-17-house-skills-liveness.sql
--
-- Silent-scraper-failure / liveness signal.
--
-- Background: the daily health monitor reported "all clear, N houses healthy"
-- on the same run where 6+ houses were in zero_lots_no_heal. The health
-- surfaces count lots already in the DB (which persist from prior successful
-- runs) and read house_skills.status, which is only written inside persistStage
-- — a stage the zero-lot path returns BEFORE reaching. So a house's crawler can
-- be dead while it still looks healthy in the feed (the ghost-lot blind spot).
--
-- The timestamps that prove liveness already exist (2026-05-12-adaptive-scheduling):
--   last_probe_at        — most recent scheduled run (any outcome)
--   last_probe_result    — 'same' | 'changed' | 'error' for that run
--   last_full_extract_at — most recent run that actually extracted lots
--
-- The one missing piece is the COUNT extracted in the most recent run, distinct
-- from total-lots-in-DB. A silent failure = a house with a feed
-- (average_lot_count > 0) whose most recent run extracted zero
-- (last_probe_result='error' / last_extracted_count=0). NULL = never run since
-- this column landed, so it is NOT treated as a failure.
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS last_extracted_count INTEGER;

COMMENT ON COLUMN house_skills.last_extracted_count IS
  'Lots extracted in the most recent scheduled run, distinct from total lots in the feed. 0 + a feed (average_lot_count>0) = silent scraper failure. NULL = not yet recorded.';
