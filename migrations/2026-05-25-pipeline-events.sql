-- migrations/2026-05-25-pipeline-events.sql
--
-- Pipeline lifecycle observability stream — sibling table to lot_events.
--
-- Why a separate table from lot_events:
--   - lot_events tracks per-lot field changes (lot_id NOT NULL, old/new
--     diff payload, lot_* vocabulary). Consumers: saved-search alerts,
--     "what's new" feeds.
--   - pipeline_events tracks pipeline lifecycle (scrape outcomes,
--     enrichment outcomes including circuit state transitions). lot_id is
--     NULL-able because some events refer to scrapes that never persisted
--     a lot, and circuit_open events have no lot at all. Consumers:
--     ops dashboards, scrape_health_24h / enrichment_health views.
--
--   Squashing these into one table would either (a) weaken the
--   lot_events.lot_id NOT NULL guarantee or (b) split a coherent
--   vocabulary across multiple writer styles. Two clean contracts is
--   the right model.
--
-- Contract (pinned from this migration onward):
--   - Producer wrapper: lib/pipeline/pipeline-events.js
--   - event_type values: see CHECK constraint below. Additive-only —
--     new values may be added, existing values must NEVER be renamed
--     or removed.
--   - event_data JSONB shape per event_type: documented in
--     audit/observability-views.md. Existing keys must not be renamed,
--     retyped, or made required after the fact. New optional keys allowed.
--   - source TEXT identifies the writer code-path (e.g.
--     'os-places.lookupAddress', 'persist-lots.upsert'). Free-form but
--     should remain stable enough to be groupable.
--
-- Idempotent: CREATE … IF NOT EXISTS throughout. Safe to re-run.

CREATE TABLE IF NOT EXISTS pipeline_events (
  event_id   BIGSERIAL    PRIMARY KEY,
  lot_id     UUID         NULL REFERENCES lots(id) ON DELETE SET NULL,
  auction_id UUID         NULL REFERENCES auction_calendar(id) ON DELETE SET NULL,
  source     TEXT         NOT NULL,
  event_type TEXT         NOT NULL,
  event_data JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Drop any prior version of the CHECK so the file stays re-runnable
-- after a vocabulary extension. Pattern matches migrations/2026-05-19-lot-events.sql.
ALTER TABLE pipeline_events
  DROP CONSTRAINT IF EXISTS pipeline_events_type_check;

ALTER TABLE pipeline_events
  ADD CONSTRAINT pipeline_events_type_check
  CHECK (event_type IN (
    -- Scrape lifecycle (per-lot or per-batch)
    'scrape_seen',                  -- scraper observed a lot in source (pre-persist)
    'scrape_persisted',             -- lot was upserted into `lots`
    'scrape_failed',                -- scraper failed for a lot / batch
    -- Enrichment lifecycle — UPRN/OS Places only at v1; new enrichers
    -- will add their own event_type values additively (e.g. enrich_epc_ok)
    'enrich_uprn_ok',               -- OS Places returned a valid UPRN (live or cache_hit)
    'enrich_uprn_fail',             -- OS Places call failed or returned no usable result
    'enrich_uprn_circuit_open',     -- circuit breaker transitioned from closed -> open
    'enrich_uprn_circuit_closed'    -- circuit breaker transitioned from open -> closed
    -- NOTE: lot_disappeared is intentionally NOT in this set. That concept
    -- lives in lot_events.lot_vanished — its semantics are per-lot field
    -- change, not pipeline lifecycle.
  ));

-- "What happened to this lot in the pipeline?" — primary per-lot access pattern
-- (covers re-scrape history + enrichment outcomes).
CREATE INDEX IF NOT EXISTS idx_pipeline_events_lot
  ON pipeline_events (lot_id, created_at DESC)
  WHERE lot_id IS NOT NULL;

-- "Show me all enrich_uprn_circuit_open events in the last 24 h" — feeds
-- the enrichment_health view. event_type cardinality is small (~7) so this
-- is a fast bitmap-friendly slice.
CREATE INDEX IF NOT EXISTS idx_pipeline_events_type
  ON pipeline_events (event_type, created_at DESC);

-- "Per-source activity" — feeds scrape_health_24h / dormant_sources views.
CREATE INDEX IF NOT EXISTS idx_pipeline_events_source
  ON pipeline_events (source, created_at DESC);

-- "Per-auction view" — supports drilling down by auction_calendar entry.
CREATE INDEX IF NOT EXISTS idx_pipeline_events_auction
  ON pipeline_events (auction_id, created_at DESC)
  WHERE auction_id IS NOT NULL;

ALTER TABLE pipeline_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON pipeline_events;
CREATE POLICY "Service role full access" ON pipeline_events
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE pipeline_events IS
  'Append-only pipeline lifecycle event stream. Sibling to lot_events: lot_events tracks per-lot field changes (lot_id NOT NULL, old/new diff payload); pipeline_events tracks scrape and enrichment outcomes (lot_id may be NULL, single event_data payload). Pinned contract: see audit/observability-views.md.';

COMMENT ON COLUMN pipeline_events.lot_id IS
  'Optional — events about scrapes that never persisted a lot, or events about pipeline-wide state (circuit transitions), have NULL lot_id.';

COMMENT ON COLUMN pipeline_events.source IS
  'Code-path that emitted the event (e.g. ''os-places.lookupAddress'', ''persist-lots.upsert'', ''autoAnalyseAll''). Free-form text but should remain stable enough to be groupable per emitter.';

COMMENT ON COLUMN pipeline_events.event_data IS
  'Event-specific JSONB payload. Shape per event_type is part of the pinned contract — see audit/observability-views.md. Additive-only evolution: new optional keys allowed, no renames or type changes.';
