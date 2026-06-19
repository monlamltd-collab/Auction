-- 2026-06-19: self-hosted homepage-watch change detection.
-- Replaces Firecrawl changeTracking (git-diff) with a content hash computed
-- in-process (lib/scraper/homepage-audit.js). One sha256 of the normalised
-- homepage markdown, per house. NULL on first sight ⇒ BASELINE; equal ⇒
-- 'same' short-circuit; differs ⇒ 'changed'.
ALTER TABLE house_homepage_watch
  ADD COLUMN IF NOT EXISTS last_content_hash TEXT;
