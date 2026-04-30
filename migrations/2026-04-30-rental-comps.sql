-- 2026-04-30: Rental comps storage (rollout #7 Phase 1).
--
-- Two tables:
--   postcode_rentals — one row per scraped listing (the data)
--   postcode_rental_freshness — when each (postcode, source) was last
--     scraped, plus the result of that scrape (the cadence ledger)
--
-- Initial sources: spareroom, onthemarket. openrent deferred (their
-- search endpoints reject plain GET; needs Firecrawl with JS rendering).
--
-- Idempotent: CREATE IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS public.postcode_rentals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  postcode     TEXT NOT NULL,            -- canonical: uppercase with single space
  source       TEXT NOT NULL,            -- 'spareroom' | 'onthemarket' | 'openrent'
  source_id    TEXT NOT NULL,            -- listing id from the source
  url          TEXT,                      -- detail-page URL when known
  rent_pcm     INT,                       -- monthly rent in £
  beds         INT,                       -- nullable — not always available (OTM bulk)
  property_type TEXT,                     -- 'flat' | 'house' | 'room' | 'studio' | etc
  is_room_share BOOLEAN NOT NULL DEFAULT FALSE,  -- true for SpareRoom rooms
  area_label   TEXT,                      -- raw location text from the listing
  scraped_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency key. A listing might appear in multiple postcode searches
  -- (radius overlap) — same source_id should resolve to one row, with
  -- scraped_at refreshed and any new postcode appended via separate
  -- (postcode, source_id) pair if the listing is genuinely re-located.
  UNIQUE (source, source_id, postcode)
);

CREATE INDEX IF NOT EXISTS idx_postcode_rentals_postcode
  ON public.postcode_rentals(postcode);
CREATE INDEX IF NOT EXISTS idx_postcode_rentals_postcode_beds
  ON public.postcode_rentals(postcode, beds)
  WHERE beds IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_postcode_rentals_scraped_at
  ON public.postcode_rentals(scraped_at DESC);

-- Cadence ledger — per (postcode, source) tuple, when did we last scrape
-- and what happened? The orchestrator selects rows where
-- last_scraped_at < now() - 30 days as candidates for the next run.
CREATE TABLE IF NOT EXISTS public.postcode_rental_freshness (
  postcode        TEXT NOT NULL,
  source          TEXT NOT NULL,
  last_scraped_at TIMESTAMPTZ NOT NULL,
  listings_found  INT  NOT NULL DEFAULT 0,
  status          TEXT NOT NULL,    -- 'ok' | 'no_match' | 'http_error' | 'parse_error'
  last_error      TEXT,
  PRIMARY KEY (postcode, source)
);

CREATE INDEX IF NOT EXISTS idx_postcode_rental_freshness_due
  ON public.postcode_rental_freshness(last_scraped_at);

-- RLS: read public, writes service_role only.
ALTER TABLE public.postcode_rentals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS postcode_rentals_read ON public.postcode_rentals;
CREATE POLICY postcode_rentals_read ON public.postcode_rentals FOR SELECT USING (true);

ALTER TABLE public.postcode_rental_freshness ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS postcode_rental_freshness_read ON public.postcode_rental_freshness;
CREATE POLICY postcode_rental_freshness_read ON public.postcode_rental_freshness FOR SELECT USING (true);

COMMENT ON TABLE public.postcode_rentals IS
'Scraped rental listings indexed by postcode. Multi-source (SpareRoom, OnTheMarket, …). Used for postcode-level rent medians + per-lot yield estimates. Refreshed monthly per (postcode, source) — see postcode_rental_freshness for cadence.';
COMMENT ON TABLE public.postcode_rental_freshness IS
'Per (postcode, source) ledger of last scrape + result. The orchestrator skips postcodes scraped within the last 30 days unless ?force=true.';
