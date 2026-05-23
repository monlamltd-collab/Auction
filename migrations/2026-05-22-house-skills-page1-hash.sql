-- migrations/2026-05-22-house-skills-page1-hash.sql
-- Page-1 content-hash gate support.
-- Stores an md5 of catalogue page 1's rawHTML for changeTracking-incompatible
-- paginated houses (currently Pattinson). The nightly pass hashes page 1 with
-- a single ~1-credit rawHtml scrape and, when it matches this stored value,
-- skips the full multi-page extract — the only cheap unchanged-check available
-- to houses that crash under Firecrawl's native changeTracking.
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS catalogue_page1_hash TEXT;
