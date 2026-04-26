-- ═══════════════════════════════════════════════════════════════
-- Add os_classification column — Phase A loose-thread fix LT-3
-- ═══════════════════════════════════════════════════════════════
-- OS Places returns a CLASSIFICATION_CODE for every UPRN match
-- (e.g. 'RD' = Residential Dwelling, 'CR' = Retail, 'PS' = Public
-- Service). The enrich-stage pass was stamping it on lot._osClassification
-- but no DB column existed to receive it. This migration adds the column
-- so we can filter by property class downstream (residential vs commercial
-- vs mixed-use).
--
-- Index is partial (only non-null values) — most rows are residential
-- dwellings; we only care about the index when the user explicitly
-- filters out those.

ALTER TABLE lots ADD COLUMN IF NOT EXISTS os_classification TEXT;

CREATE INDEX IF NOT EXISTS idx_lots_os_classification ON lots(os_classification)
  WHERE os_classification IS NOT NULL;
