-- Migration: add enrichment_manifest to lots table
-- =================================================
-- Adds a per-lot JSONB manifest that tracks what the enrichment pipeline
-- attempted for each external source (EPC, flood, Land Registry, geocoding,
-- fundability), whether it succeeded, was skipped, or failed, plus scoring
-- provenance to prevent yield double-count.
--
-- Run this BEFORE deploying the code that writes the manifest. The column
-- defaults to {} so existing lots remain valid without backfill — the manifest
-- populates naturally on the next scrape.
--
-- Apply via Supabase SQL editor or `supabase db push`.

BEGIN;

ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS enrichment_manifest JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_lots_manifest_gin
  ON lots USING GIN (enrichment_manifest);

COMMIT;

-- Verify (optional):
-- SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_name = 'lots' AND column_name = 'enrichment_manifest';
-- SELECT indexname FROM pg_indexes WHERE tablename = 'lots' AND indexname = 'idx_lots_manifest_gin';
