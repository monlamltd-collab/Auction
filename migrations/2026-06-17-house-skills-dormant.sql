-- 2026-06-17-house-skills-dormant.sql
--
-- Dormant-house flag for EIG (and any) houses that are between auctions /
-- effectively defunct — their catalogue shows only ended lots (sold/stc/
-- withdrawn), so the standard breakage alerts (zero_lots_no_heal,
-- extractor_regression, recall_diagnostic) and the silent-failure liveness
-- degrade are FALSE ALARMS on them.
--
-- This is an operator/evidence-set flag, NOT auto-inferred from extraction —
-- because internal data can't safely distinguish "dormant" from "we under-
-- extracted and missed the live lots" (lot9 2026-06-17: extracted 4/33, missed
-- 2 live lots — flagging it dormant would have masked a real recall bug). The
-- flag only DOWNGRADES alert severity to info + skips the health-degrade; it
-- never silences a house. It auto-clears the moment a scrape sees a live
-- (available/unsold) lot, so a relaunch re-activates monitoring.
--
-- Defaults false, so every un-flagged house behaves exactly as before.
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS dormant BOOLEAN DEFAULT false;
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS dormant_since TIMESTAMPTZ;

COMMENT ON COLUMN house_skills.dormant IS
  'House is known between-auctions/defunct (catalogue all-terminal). Downgrades breakage alerts to info + skips the liveness health-degrade. Auto-clears when a live (available/unsold) lot is next extracted.';
