-- migrations/2026-05-12-normalise-calendar-url.sql
--
-- Normalises `auction_calendar.url` to match the JS-side `normaliseUrl()` in
-- lib/utils.js so that `lots.catalogue_url` joins reliably to calendar rows.
--
-- Why: a diagnostic against prod on 2026-05-12 showed 50.5% of `lots` rows
-- fail the (house_slug, url) join against `auction_calendar` purely because
-- one side has a trailing slash / mixed case / `www.` prefix that the other
-- doesn't. This migration:
--   1. Adds a BEFORE-INSERT-OR-UPDATE trigger so future writes are always
--      stored in canonical form.
--   2. Backfills existing rows in place. Diagnostic confirmed no
--      (normalised_url, date) collisions across the existing 268 rows.
--
-- Normalisation = lowercase + strip trailing slashes + force https:// +
-- strip leading `www.`. Matches lib/utils.js:18 exactly.
--
-- Idempotent: trigger uses CREATE OR REPLACE; backfill UPDATE is a no-op on
-- already-normalised rows.

CREATE OR REPLACE FUNCTION normalise_calendar_url() RETURNS trigger AS $$
BEGIN
  IF NEW.url IS NOT NULL THEN
    NEW.url := lower(
      rtrim(
        regexp_replace(NEW.url, '^https?://(www\.)?', 'https://', 'i'),
        '/'
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalise_calendar_url ON auction_calendar;
CREATE TRIGGER trg_normalise_calendar_url
  BEFORE INSERT OR UPDATE OF url ON auction_calendar
  FOR EACH ROW EXECUTE FUNCTION normalise_calendar_url();

-- Backfill existing rows. Pre-check confirmed 0 collisions on (url, date).
UPDATE auction_calendar
SET url = lower(rtrim(regexp_replace(url, '^https?://(www\.)?', 'https://', 'i'), '/'))
WHERE url IS NOT NULL
  AND url != lower(rtrim(regexp_replace(url, '^https?://(www\.)?', 'https://', 'i'), '/'));
