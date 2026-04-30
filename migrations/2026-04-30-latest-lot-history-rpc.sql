-- 2026-04-30: latest_lot_history_hashes RPC (review #9).
--
-- Replaces the buggy `.limit(lotIds.length * 2)` query in
-- lib/pipeline/persist-lots.js — that limit is a row cap, not a
-- per-lot cap, so on busy catalogues the most-recent snapshot for a
-- lot can fall outside the window. When that happens the change-
-- detection code sees no prior hash, treats the lot as first-contact,
-- and writes a duplicate snapshot. With 276k+ rows in lot_history
-- the bug is now real (avg 27 history rows per lot, max 130).
--
-- DISTINCT ON gives us exactly one row per lot_id — the row with the
-- highest scraped_at. Backed by idx_lot_history_lot
-- (lot_id, scraped_at DESC), this is index-only, O(N_lots × log).
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.latest_lot_history_hashes(p_lot_ids UUID[])
RETURNS TABLE (lot_id UUID, snapshot_hash TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (lot_id) lot_id, snapshot_hash
  FROM lot_history
  WHERE lot_id = ANY(p_lot_ids)
  ORDER BY lot_id, scraped_at DESC;
$$;

REVOKE ALL ON FUNCTION public.latest_lot_history_hashes(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.latest_lot_history_hashes(UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.latest_lot_history_hashes(UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.latest_lot_history_hashes(UUID[]) TO service_role;

COMMENT ON FUNCTION public.latest_lot_history_hashes IS
'For each lot_id in p_lot_ids, returns the snapshot_hash of the most recent lot_history row. Used by persist-lots.js change-detection to decide whether a new snapshot is needed.';
