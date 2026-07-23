-- 2026-07-22 (follow-up to 2026-07-22-retire-lots-rpc.sql):
-- let retire_lots retire the caller's in-play status set, not just 'available'.
--
-- WHY:
-- retire_lots was written for the ghost sweep, which only ever fetches
-- status='available' rows, so hardcoding `AND status = 'available'` was exactly
-- right there. The persist-lots prune is the RPC's second caller and it is NOT
-- available-only: its candidate filter is
--     IN_PLAY = {'available', 'stc', 'unsold'}   (lib/pipeline/prune-from-snapshot.js)
-- because a lot that went STC or unsold and then vanished from the catalogue is
-- just as gone as an available one.
--
-- Routing the prune through the 2-arg RPC unchanged would have silently halved
-- it. Measured on lot_events (writer='persist-lots.prune-vanished') at the time
-- of writing — 256 recorded prune flips:
--     available 120 | stc 116 | unsold 20
-- i.e. 53% of real prune flips are NOT 'available'. Those lots would have stayed
-- in play, re-qualified as candidates on every subsequent scrape, and never
-- retired — the same never-retires-anything failure mode the original RPC was
-- written to fix, just moved to a different status.
--
-- SHAPE: the status set is a parameter, defaulting to ARRAY['available'] so the
-- guard is unchanged for every existing caller. The ghost sweep keeps calling
-- with 2 args and keeps its available-only guard with no code change.
--
-- DROP-then-CREATE rather than CREATE OR REPLACE: adding a defaulted 3rd
-- parameter makes a NEW function signature, so a plain CREATE would leave both
-- the 2-arg and 3-arg versions resolvable from a 2-arg call. Postgres resolves
-- that ambiguity by erroring, which would break the deployed ghost sweep. One
-- function, one signature. Runs in a transaction, so no window where the
-- function is missing.
--
-- Idempotent: safe to re-run.

DROP FUNCTION IF EXISTS public.retire_lots(UUID[], JSONB);

CREATE OR REPLACE FUNCTION public.retire_lots(
  p_ids UUID[],
  p_manifest_patch JSONB DEFAULT '{}'::jsonb,
  p_allowed_statuses TEXT[] DEFAULT ARRAY['available']::text[]
)
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH retired AS (
    UPDATE lots
    SET status = 'withdrawn',
        enrichment_manifest = COALESCE(enrichment_manifest, '{}'::jsonb)
                              || COALESCE(p_manifest_patch, '{}'::jsonb)
    WHERE id = ANY(p_ids)
      AND status = ANY(COALESCE(NULLIF(p_allowed_statuses, '{}'), ARRAY['available']::text[]))
    RETURNING 1
  )
  SELECT COUNT(*)::INT FROM retired;
$$;

-- Service-role only — this is a writer, mirroring refund_ai_search.
REVOKE ALL ON FUNCTION public.retire_lots(UUID[], JSONB, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retire_lots(UUID[], JSONB, TEXT[]) FROM anon;
REVOKE ALL ON FUNCTION public.retire_lots(UUID[], JSONB, TEXT[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.retire_lots(UUID[], JSONB, TEXT[]) TO service_role;

COMMENT ON FUNCTION public.retire_lots IS
'Retires lots: status -> withdrawn, MERGING the given patch (e.g. {removed_reason, removed_at}) into enrichment_manifest rather than replacing it. Only rows currently in p_allowed_statuses (default {available}) are touched, so a concurrent sale is never clobbered. Returns rows actually updated. Callers: daily ghost sweep (default guard) and the persist-lots vanished-lot prune (available/stc/unsold).';
