-- migrations/2026-05-13-catalogue-snapshots.sql
--
-- Move 3 Phase 3a — persist the canonical lot-URL set returned by each
-- successful scrape, indexed by auction. Future phases will use these to
-- derive prune candidates, recall metrics, and time-travel debug views.
-- This phase is writer-only: rows accumulate, nothing reads them yet.
--
-- Storage cost (rough): ~268 auctions × adaptive cadence (averaging ~12h
-- per house under steady state) × ~50 URLs avg × ~80 chars = ~85 KB/day,
-- ~31 MB/year. Cheap.
--
-- Dependencies:
--   - Move 2 (auction_id FK on lots) — snapshots are indexed by auction_id.
--   - PR #24 (calendar URL normalisation) — auction_calendar.id is stable
--     across scrape cycles even when the URL gets normalised in place.
--
-- ON DELETE CASCADE: if an auction_calendar row is deleted (e.g. by the
-- 30-day-stale cleanup in lib/analysis.js), its snapshots go with it.
-- Snapshots are derived from the auction, not standalone records.

CREATE TABLE IF NOT EXISTS catalogue_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES auction_calendar(id) ON DELETE CASCADE,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lot_url_set TEXT[] NOT NULL DEFAULT '{}',
  lot_count INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  scrape_status TEXT NOT NULL CHECK (scrape_status IN ('full', 'unchanged', 'partial', 'failed')),
  extracted_with TEXT,
  scraped_with TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Most lookups will be "latest snapshot(s) for this auction" — DESC index.
CREATE INDEX IF NOT EXISTS idx_snapshots_auction
  ON catalogue_snapshots (auction_id, scraped_at DESC);

-- For "did anything actually change" lookups — match by content hash.
CREATE INDEX IF NOT EXISTS idx_snapshots_content_hash
  ON catalogue_snapshots (content_hash);
