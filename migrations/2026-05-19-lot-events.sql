-- migrations/2026-05-19-lot-events.sql
--
-- Append-only event stream for lot lifecycle. Sits alongside lot_history
-- and lot_status_history during the migration window — all three keep
-- writing until consumers have migrated. Don't drop the older tables.
--
-- Why an event stream: lot_history is snapshot-style (full row at every
-- change) and lot_status_history only captures status transitions from
-- the persist-lots upsert path (gaps for post-auction-sweep and
-- phantom-lot-sweep). Consumers (saved-search alerts, weekly digest,
-- frontend "what's new") currently re-derive events by diffing snapshots,
-- which scales badly and produces inconsistent answers across consumers.
-- lot_events is the single source of truth — every status / price /
-- price_status / sold_price change emits a typed row.
--
-- Event types — six, deliberately small:
--   lot_first_seen           — first time a URL hits `lots`
--   lot_status_changed       — `lots.status` transitions (covers
--                              sold/unsold/withdrawn/stc/available/
--                              extraction_failure). Detail in new_value.
--   lot_price_changed        — numeric `lots.price` changes (guide moves)
--   lot_price_status_changed — `lots.price_status` changes (poa/tba/etc.)
--                              Kept separate from status because consumers
--                              care about price_status moves (poa→guide is
--                              a buying signal) that don't touch status.
--   lot_sold_price_set       — `lots.sold_price` populated or changes
--   lot_vanished             — in-play lot absent from latest scrape.
--                              Inference, paired with the lot_status_changed
--                              → withdrawn that prune-vanished also emits.
--
-- source JSONB shape (all keys mandatory):
--   { scrape_id, scraper_version, house, writer }
-- scrape_id may be null (non-scrape writers — post-auction-sweep, etc.).
-- writer names the code path (e.g. 'persist-lots.upsert',
-- 'post-auction-sweep.persistOutcome', 'phantom-lot-sweep.markFailure',
-- 'persist-lots.prune-vanished') so we can audit per-writer behaviour
-- without parsing scraper_version.
--
-- Idempotent: CREATE … IF NOT EXISTS throughout. Safe to re-run.

CREATE TABLE IF NOT EXISTS lot_events (
  id          BIGSERIAL    PRIMARY KEY,
  lot_id      UUID         NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  event_type  TEXT         NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  detected_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  source      JSONB        NOT NULL
);

-- Drop any prior version before re-adding so the file stays re-runnable
-- after a vocabulary tweak. Pattern matches migrations/2026-04-28-price-status.sql.
ALTER TABLE lot_events
  DROP CONSTRAINT IF EXISTS lot_events_type_check;

ALTER TABLE lot_events
  ADD CONSTRAINT lot_events_type_check
  CHECK (event_type IN (
    'lot_first_seen',
    'lot_status_changed',
    'lot_price_changed',
    'lot_price_status_changed',
    'lot_sold_price_set',
    'lot_vanished'
  ));

-- "What happened to this lot?" — primary per-lot access pattern.
CREATE INDEX IF NOT EXISTS idx_lot_events_lot
  ON lot_events (lot_id, detected_at DESC);

-- "Show me all sold/withdrawn events in the last hour" — saved-search
-- alerts and frontend feeds. event_type cardinality is six so this is
-- a fast bitmap-friendly slice.
CREATE INDEX IF NOT EXISTS idx_lot_events_type
  ON lot_events (event_type, detected_at DESC);

-- "Per-house activity" — pairs with scrape_health_daily so consumers can
-- distinguish "no events because nothing changed" from "no events because
-- the scraper is broken".
CREATE INDEX IF NOT EXISTS idx_lot_events_house
  ON lot_events ((source->>'house'), detected_at DESC);

ALTER TABLE lot_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON lot_events;
CREATE POLICY "Service role full access" ON lot_events
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE lot_events IS
  'Append-only event stream for lot lifecycle changes. Co-exists with lot_history and lot_status_history during consumer migration. Emitted by every writer that mutates lots.status / lots.price / lots.price_status / lots.sold_price (persist-lots upsert, persist-lots prune-vanished, post-auction-sweep, phantom-lot-sweep).';

COMMENT ON COLUMN lot_events.detected_at IS
  'When we noticed the change, not necessarily when it happened at source. For lot_sold this can lag the actual hammer fall by up to the post-auction-sweep cooldown.';

COMMENT ON COLUMN lot_events.source IS
  'JSONB { scrape_id (uuid|null), scraper_version (text), house (slug), writer (code-path text) }. All four keys mandatory at the application layer; the database enforces only NOT NULL on the whole object.';
