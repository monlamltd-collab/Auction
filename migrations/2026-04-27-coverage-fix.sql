-- ═══════════════════════════════════════════════════════════════
-- Coverage Fix — Phase 1 (rollout #1 + #2 in COVERAGE_FIX_PLAN.md)
-- ═══════════════════════════════════════════════════════════════
-- Adds the storage layer for the two next-session fixes:
--   1. Detail-page merge with field_sources stamping (no schema change —
--      reuses the existing lots.field_sources JSONB column)
--   2. Re-enrichment of returning lots + retry queue
--
-- New objects:
--   • enrichment_retry_queue table  — backs off transient enrichment
--                                     failures (circuit_open, timeout,
--                                     api_error, no_match) for later retry
--   • Helper indexes on lots(image_url, uprn, enriched_at)  — so the
--     gap-filler cron can find missing-field lots without a full scan
--
-- Idempotent — safe to re-run.

-- ── 1. enrichment_retry_queue ──
-- One row per (lot, field, reason). Cron drains by next_retry_at.
-- Exponential backoff: attempts grows from 1 → 5; next_retry_at advances
-- by 1h * 2^(attempts-1) on failure. Removed on success or after 5 attempts.
CREATE TABLE IF NOT EXISTS enrichment_retry_queue (
  id BIGSERIAL PRIMARY KEY,
  lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  field TEXT NOT NULL,                     -- 'image_url', 'uprn', 'price', 'epc_rating', etc.
  reason TEXT NOT NULL,                    -- 'circuit_open', 'timeout', 'api_error', 'no_match', 'detail_fetch_failed'
  source TEXT,                             -- which subsystem queued this ('os-places', 'detail-page', 'epc', ...)
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  first_queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
  UNIQUE (lot_id, field)                   -- one open retry per (lot, field)
);

CREATE INDEX IF NOT EXISTS idx_retry_queue_due
  ON enrichment_retry_queue(next_retry_at)
  WHERE attempts < 5;

CREATE INDEX IF NOT EXISTS idx_retry_queue_lot
  ON enrichment_retry_queue(lot_id);

ALTER TABLE enrichment_retry_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON enrichment_retry_queue
  FOR ALL USING (true) WITH CHECK (true);

-- ── 2. Indexes on lots — speed up the gap-filler cron ──
-- The hygiene wave already runs queries like
--   SELECT ... FROM lots WHERE image_url IS NULL ORDER BY last_seen_at DESC LIMIT 300
-- A partial index on the IS NULL predicate keeps that query off a seq scan
-- once the table grows beyond a few thousand rows.
CREATE INDEX IF NOT EXISTS idx_lots_image_null
  ON lots(last_seen_at DESC)
  WHERE image_url IS NULL;

CREATE INDEX IF NOT EXISTS idx_lots_uprn_null
  ON lots(last_seen_at DESC)
  WHERE uprn IS NULL;

CREATE INDEX IF NOT EXISTS idx_lots_enriched_stale
  ON lots(enriched_at NULLS FIRST, last_seen_at DESC);

-- ── 3. Additional images — JSONB array of up to ~8 detail-page images ──
-- Detail-page extractors already harvest multiple images per lot but only
-- the primary url ends up in image_url. This column stores the full list
-- so the gallery / second-image-on-hover features can use them without
-- another round of scraping. COVERAGE_FIX_PLAN.md fix #5.
ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS images JSONB;
