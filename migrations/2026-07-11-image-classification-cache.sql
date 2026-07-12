-- Per-image-URL classification cache for the vision image-quality filter.
--
-- A given image URL's verdict (property_photo / floor_plan / logo / banner / …)
-- is intrinsic to the image, so once classified we never pay the vision model
-- (gemini-2.5-flash-lite via OpenRouter) for that URL again — across re-scrapes,
-- re-onboarding, or images shared between houses. image-classify was ~99% of
-- flash-lite spend, so this cache is the main saving.
--
-- Only AFFIRMATIVE verdicts are written — never the fail-open 'unknown' (that's
-- a transient "couldn't see the image", not a judgement). Read/write is in
-- lib/pipeline/image-quality-filter.js. Idempotent; safe to re-run.

CREATE TABLE IF NOT EXISTS image_classifications (
  url          TEXT PRIMARY KEY,
  verdict      TEXT NOT NULL,
  confidence   TEXT,
  is_primary   BOOLEAN,
  reason       TEXT,
  model        TEXT,
  classified_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days')
);

CREATE INDEX IF NOT EXISTS idx_image_classifications_expires ON image_classifications(expires_at);

ALTER TABLE image_classifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role full access" ON image_classifications
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
