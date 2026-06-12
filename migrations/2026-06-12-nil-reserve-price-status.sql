-- ═══════════════════════════════════════════════════════════════
-- 2026-06-12 — Nil Reserve price status + price_status backfill
-- ═══════════════════════════════════════════════════════════════
-- Two fixes:
--   1. Add 'nil_reserve' to the price_status vocabulary. A Nil Reserve lot
--      sells to the highest bid with no reserve — a real, investor-POSITIVE
--      state, not a missing guide. Counting it as a coverage gap was the bug
--      behind the "No Guide Price" false alarms (pugh: 25 of 26 flagged lots
--      were Nil Reserve, correctly captured).
--   2. Backfill. The runtime derivePriceStatus() helper was defined but never
--      wired into the upsert, so price_status went stale after the one-time
--      2026-04-28 backfill — every lot persisted since carries NULL. This
--      re-derives price_status for ALL NULL rows (the runtime path is now
--      wired in persist-lots.js, so new lots stay correct).
--
-- Idempotent — safe to re-run.
--
-- NOTE (applied 2026-06-12): production's lots table was a lean rebuild that
-- never received the 2026-04-28 price_status/sold_price columns, so this also
-- CREATES price_status. sold_price does not exist in prod, so the sold backfill
-- keys on status only.

-- ── 0. Ensure the column exists (lean-rebuild prod never had it) ──
ALTER TABLE lots ADD COLUMN IF NOT EXISTS price_status TEXT;

-- ── 1. Widen the CHECK constraint to include nil_reserve ──
ALTER TABLE lots DROP CONSTRAINT IF EXISTS lots_price_status_check;
ALTER TABLE lots
  ADD CONSTRAINT lots_price_status_check
  CHECK (price_status IS NULL OR price_status IN
    ('guide','poa','tba','starting_bid','nil_reserve','sold','withdrawn','unknown'));

-- ── 2. Backfill, most-specific-first (mirrors derivePriceStatus order) ──
UPDATE lots SET price_status = 'withdrawn'
  WHERE price_status IS NULL AND status = 'withdrawn';

-- sold_price column doesn't exist in lean-rebuild prod — key on status only.
UPDATE lots SET price_status = 'sold'
  WHERE price_status IS NULL AND status IN ('sold','unsold');

-- Nil Reserve before poa/tba/guide: it's the dominant intent when there's no
-- numeric guide.
UPDATE lots SET price_status = 'nil_reserve'
  WHERE price_status IS NULL
    AND (price IS NULL OR price = 0)
    AND price_text IS NOT NULL
    AND price_text ~* '\m(nil|no|without|zero)\s*reserve\M|\munreserved\M';

UPDATE lots SET price_status = 'poa'
  WHERE price_status IS NULL
    AND (price IS NULL OR price = 0)
    AND price_text IS NOT NULL
    AND price_text ~* 'poa|on application';

UPDATE lots SET price_status = 'tba'
  WHERE price_status IS NULL
    AND (price IS NULL OR price = 0)
    AND price_text IS NOT NULL
    AND price_text ~* 'tba|tbc|to be advised|to be confirmed';

UPDATE lots SET price_status = 'starting_bid'
  WHERE price_status IS NULL
    AND price_text IS NOT NULL
    AND price_text ~* 'starting\s*bid|opening\s*bid|minimum\s*opening';

UPDATE lots SET price_status = 'guide'
  WHERE price_status IS NULL AND price IS NOT NULL AND price > 0;

UPDATE lots SET price_status = 'unknown'
  WHERE price_status IS NULL;

-- Partial index supports "real price gaps only" queries (regression alerts +
-- price-coverage report filter on this set).
CREATE INDEX IF NOT EXISTS idx_lots_price_status_actionable
  ON lots(price_status)
  WHERE price_status IN ('guide','starting_bid','unknown');
