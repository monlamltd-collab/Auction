-- ═══════════════════════════════════════════════════════════════
-- First-Contact Maximisation + Data Richness — Phase A
-- ═══════════════════════════════════════════════════════════════
-- Adds:
--   • field_sources JSONB    — per-field provenance ({beds:'epc', tenure:'os-places',...})
--   • uprn TEXT              — Unique Property Reference Number from OS Places API
--   • property_key TEXT      — generated postcode|first-line-address fingerprint
--   • lot_history table      — price/status/bullet/image snapshots over time
--
-- Non-destructive: all additions, no column drops, no data rewrites beyond
-- the generated property_key backfill (constant-time on ~5k rows).

-- ── 1. field_sources: which source filled each field on a lot ──
ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS field_sources JSONB DEFAULT '{}'::jsonb;

-- ── 2. uprn: stable property identifier from OS Places ──
ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS uprn TEXT;

CREATE INDEX IF NOT EXISTS idx_lots_uprn ON lots(uprn) WHERE uprn IS NOT NULL;

-- ── 3. property_key: derived fingerprint, lets us spot the same property across houses ──
-- Format: lower(postcode)|lower(first comma-separated address segment)
-- Example: "ex18 7dp|former post office" for the Chulmleigh stags lot.
-- A row with no postcode AND no address contributes "|" — exclude from index.
ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS property_key TEXT
  GENERATED ALWAYS AS (
    lower(coalesce(postcode, '')) || '|' || lower(split_part(coalesce(address, ''), ',', 1))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_lots_property_key ON lots(property_key)
  WHERE property_key <> '|';

-- ── 4. lot_history: append-only price/status snapshots ──
-- Captures the state of a lot at every scrape that produces a change.
-- Used for: price-drop alerts, time-on-market analytics, STC/withdrawn transitions.
-- One row per (lot, scrape) event, not per scrape — only inserted when
-- price / status / bullets-count / image changes from the previous snapshot.
CREATE TABLE IF NOT EXISTS lot_history (
  id BIGSERIAL PRIMARY KEY,
  lot_id UUID REFERENCES lots(id) ON DELETE CASCADE,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  price INTEGER,
  price_text TEXT,
  status TEXT,
  sold_price INTEGER,
  bullets_count INTEGER,
  image_count INTEGER,
  -- Compact fingerprint of the snapshot for quick "did anything change?" comparison
  snapshot_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_lot_history_lot ON lot_history(lot_id, scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_lot_history_price_changes ON lot_history(lot_id, price)
  WHERE price IS NOT NULL;

ALTER TABLE lot_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON lot_history FOR ALL USING (true) WITH CHECK (true);

-- ── 5. os_places_cache: postcode-keyed cache of OS Places API responses ──
-- OS Places has a 100k/month free tier — we don't need to burn it
-- re-querying the same address every scrape. Cache by full address string,
-- 90-day TTL (UPRNs are very stable; only changes on demolition/new build).
CREATE TABLE IF NOT EXISTS os_places_cache (
  address_key TEXT PRIMARY KEY,         -- normalised "address|postcode"
  uprn TEXT,
  full_address TEXT,
  postcode TEXT,
  classification_code TEXT,             -- e.g. 'RD' (residential dwelling), 'CR' (retail)
  lat NUMERIC(9,6),
  lng NUMERIC(9,6),
  match_score NUMERIC(4,2),             -- OS Places confidence (0-1)
  raw_response JSONB,                   -- full API response for forensics
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_os_places_cache_uprn ON os_places_cache(uprn) WHERE uprn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_os_places_cache_fetched ON os_places_cache(fetched_at);

ALTER TABLE os_places_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON os_places_cache FOR ALL USING (true) WITH CHECK (true);
