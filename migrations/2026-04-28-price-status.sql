-- ═══════════════════════════════════════════════════════════════
-- lots.price_status — structured pricing intent (vs price_text heuristic)
-- ═══════════════════════════════════════════════════════════════
-- Replaces the scattered "does price_text match /poa|tba/?" pattern with
-- a single normalised column. Lets quality-regression alerts denominator-
-- out POA / TBA / sold / withdrawn lots from price_pct so houses with
-- legitimately high POA fractions don't fire false-positive regressions.
-- See the trimmed price-status plan (~2-hour scope, distinct from the
-- "another chat" 1-day full overhaul that was over-spec'd).
--
-- Vocabulary (matches derivePriceStatus in lib/pipeline/persist-lots.js):
--   guide         — price present, normal listing.
--   poa           — "price on application" — intentional withhold, not a gap.
--   tba           — "to be advised / TBC" — same.
--   starting_bid  — only an opening bid published (auctioneer didn't set guide).
--   sold          — auction over with sold_price.
--   withdrawn     — pulled from the sale.
--   unknown       — genuine gap; no recognisable signal.
--
-- The CHECK constraint catches accidental drift (typos, future renames).
-- Idempotent — safe to re-run.

ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS price_status TEXT;

-- Drop any prior version of the constraint before re-adding (lets the file
-- be re-run after a vocabulary tweak without manual intervention).
ALTER TABLE lots
  DROP CONSTRAINT IF EXISTS lots_price_status_check;

ALTER TABLE lots
  ADD CONSTRAINT lots_price_status_check
  CHECK (price_status IS NULL OR price_status IN
    ('guide','poa','tba','starting_bid','sold','withdrawn','unknown'));

-- Partial index supports "real price gaps only" queries — the regression
-- alerts and price-coverage report both filter on this set.
CREATE INDEX IF NOT EXISTS idx_lots_price_status_actionable
  ON lots(price_status)
  WHERE price_status IN ('guide','starting_bid','unknown');

-- ── Backfill historical rows from existing price_text + status ──
-- Same priority order the runtime helper uses (most specific first).
-- The runtime version lives in lib/pipeline/persist-lots.js::derivePriceStatus.
-- If you change one, change the other — the test in tests/test-coverage-fix.js
-- locks both behaviours, but only the runtime path is asserted directly.
UPDATE lots SET price_status = 'sold'
  WHERE price_status IS NULL
    AND status = 'sold'
    AND sold_price IS NOT NULL;

UPDATE lots SET price_status = 'withdrawn'
  WHERE price_status IS NULL
    AND status = 'withdrawn';

UPDATE lots SET price_status = 'poa'
  WHERE price_status IS NULL
    AND price IS NULL
    AND price_text IS NOT NULL
    AND price_text ~* 'poa|on application';

UPDATE lots SET price_status = 'tba'
  WHERE price_status IS NULL
    AND price IS NULL
    AND price_text IS NOT NULL
    AND price_text ~* 'tba|tbc|to be advised|to be confirmed';

UPDATE lots SET price_status = 'starting_bid'
  WHERE price_status IS NULL
    AND price_text IS NOT NULL
    AND price_text ~* 'starting\s*bid|opening\s*bid|minimum\s*opening';

UPDATE lots SET price_status = 'guide'
  WHERE price_status IS NULL
    AND price IS NOT NULL
    AND price > 0;

UPDATE lots SET price_status = 'unknown'
  WHERE price_status IS NULL;
