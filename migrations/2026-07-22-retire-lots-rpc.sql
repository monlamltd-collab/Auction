-- 2026-07-22: Atomic, manifest-preserving lot retirement.
--
-- WHY THIS EXISTS (bug found 2026-07-22, while retiring 386 duplicate lots by
-- hand in PR #205):
--
-- ghost-sweep built its retirement patch as top-level columns:
--     { status: 'withdrawn', removed_reason: reason, removed_at: now }
-- but `lots` has NO removed_reason and NO removed_at column. PostgREST rejected
-- every flip:
--     "Could not find the 'removed_at' column of 'lots' in the schema cache"
-- so the sweep retired NOTHING in production — stale lots kept being served.
--
-- We are deliberately NOT adding removed_reason/removed_at as columns. That
-- provenance already has an established home: the persist-lots prune writes it
-- INSIDE `enrichment_manifest` (persist-lots.js), 673 rows carry it there
-- today, and docs/CRAWLEE-TRIAL-RUNBOOK.md queries
-- `enrichment_manifest->>'removed_reason'`. Adding columns would fork the same
-- fact across two homes and silently halve every existing provenance query.
-- ghost-sweep's own header already said it "mirrors the prune" — the bug was
-- that the code diverged from its stated design. This restores that.
--
-- But the prune REPLACES the manifest (`enrichment_manifest: stamp`), and that
-- is not safe to copy at sweep scale: all 3,710 current sweep candidates carry
-- a populated manifest (avg 9.3 keys — 2,000 with paid OS Places lookups,
-- 1,932 with EPC). A wholesale overwrite would destroy that provenance, and
-- ghost lots frequently come BACK (lot-URL identity churn is the main cause),
-- so re-enrichment would re-pay for OS Places lookups (£0.01 each; the free
-- trial is exhausted). It would also violate the "silent failures banned"
-- rule, whose whole record lives in enrichment_manifest.
--
-- So the merge (`||`) happens server-side, per row, in one statement — which a
-- PostgREST batch .update() cannot express (it applies one literal value to
-- every row in the batch).
--
-- Guards on status='available' so a lot another process moved to 'sold'
-- between the sweep's fetch and its flip is never clobbered.
--
-- Idempotent: CREATE OR REPLACE re-runs are no-ops. Adds no columns.

CREATE OR REPLACE FUNCTION public.retire_lots(
  p_ids UUID[],
  p_manifest_patch JSONB DEFAULT '{}'::jsonb
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
      AND status = 'available'
    RETURNING 1
  )
  SELECT COUNT(*)::INT FROM retired;
$$;

-- Service-role only — this is a writer, mirroring refund_ai_search.
REVOKE ALL ON FUNCTION public.retire_lots(UUID[], JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retire_lots(UUID[], JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.retire_lots(UUID[], JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.retire_lots(UUID[], JSONB) TO service_role;

COMMENT ON FUNCTION public.retire_lots IS
'Retires available lots: status -> withdrawn, MERGING the given patch (e.g. {removed_reason, removed_at}) into enrichment_manifest rather than replacing it. Returns rows actually updated. Used by the daily ghost sweep.';
