-- migrations/2026-05-23-lots-floor-plan-url.sql
-- Persist the floor_plan_url that Firecrawl already extracts.
-- `lib/scraper/lot-schema.js` asks Firecrawl for `floor_plan_url`, and
-- `lib/pipeline/firecrawl-extract.js:1132` writes it into `lot.floorPlanUrl`,
-- but until now the value never reached the database — so the frontend
-- couldn't surface it. Adding the column unlocks the gallery section in
-- the lot expanded panel (PR A3.2) and the photo-count badge (PR A3.3).
ALTER TABLE lots ADD COLUMN IF NOT EXISTS floor_plan_url TEXT;
