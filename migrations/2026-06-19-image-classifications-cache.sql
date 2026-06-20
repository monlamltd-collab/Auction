-- ═══════════════════════════════════════════════════════════════
-- image_classifications — per-URL, permanent vision-verdict cache.
-- ═══════════════════════════════════════════════════════════════
-- Makes lib/pipeline/image-quality-filter.js::classifyImage idempotent per
-- image URL: the OpenRouter vision call only fires on a genuine cache miss.
-- Survives lot churn (first-contact lots that fail to persist), expire-and-
-- return, and cross-lot image reuse. Read before any vision call; only REAL
-- verdicts are written (fail-open 'unknown' is never cached, so a one-off CDN
-- 403/timeout cannot permanently mis-flag a good image).
--
-- Permanent (no TTL): an image at a fixed URL doesn't change its subject. The
-- `model` column lets a prompt/model change be invalidated via
--   DELETE FROM image_classifications WHERE model <> '<current>';
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS image_classifications (
  image_url     TEXT PRIMARY KEY,
  model         TEXT,                  -- e.g. 'openrouter:google/gemini-2.5-flash-lite'
  verdict       TEXT NOT NULL,         -- property_photo|floor_plan|map|logo|banner|stock_photo|auction_sign|document
  confidence    TEXT,
  reason        TEXT,
  is_primary    BOOLEAN,
  classified_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_image_classifications_model ON image_classifications(model);

ALTER TABLE image_classifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'image_classifications'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON image_classifications
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
