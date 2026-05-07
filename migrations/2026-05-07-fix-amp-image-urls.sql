-- migrations/2026-05-07-fix-amp-image-urls.sql
--
-- Backfill HTML-entity-encoded ampersands in image_url. Source bug was in
-- lib/scraper/lot-detail.js where the raw regex `<img[^>]+src="([^"]+)"`
-- captured attribute values verbatim — including HTML entities. Bamboo
-- whitelabel houses (Hunters, Rendells, Stags, Carter Jonas, Allwales,
-- Hammertime…) emit Next.js _next/image URLs whose query separators are
-- HTML-escaped, so the stored value contained literal `&amp;` and the
-- browser couldn't load the image.
--
-- Forward-fix: `decodeHtmlEntities()` helper added in the same commit.
-- This migration cleans up rows already in the DB.
--
-- Idempotent: re-running is a no-op once `&amp;` has been removed.
--
-- Reversible: trivial — just put `&amp;` back via the inverse REPLACE,
-- but no reason to.
--
-- Apply via Supabase MCP apply_migration. Don't run via psql directly.

UPDATE lots
SET image_url = REPLACE(image_url, '&amp;', '&')
WHERE image_url IS NOT NULL
  AND image_url LIKE '%&amp;%';

-- Other entities that might also have leaked in via the same regex path.
-- These are rarer in image URLs but cheap to clean up while we're here.
UPDATE lots
SET image_url = REPLACE(REPLACE(image_url, '&quot;', '"'), '&#x2F;', '/')
WHERE image_url IS NOT NULL
  AND (image_url LIKE '%&quot;%' OR image_url LIKE '%&#x2F;%');
