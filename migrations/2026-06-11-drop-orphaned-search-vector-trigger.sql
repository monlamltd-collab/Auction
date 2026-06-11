-- rebuild-lots.sql dropped lots.search_vector (search uses search_text ILIKE,
-- not tsvector) but left the trigger behind. The trigger fires on every
-- INSERT/UPDATE OF search_text and throws `record "new" has no field
-- "search_vector"`, failing EVERY lot upsert (observed in production
-- 2026-06-11: "0/104 lots upserted" across all houses). Drop the orphans.
-- Applied to production via Supabase MCP 2026-06-11 (drop_orphaned_search_vector_trigger).
DROP TRIGGER IF EXISTS lots_search_vector_trigger ON public.lots;
DROP FUNCTION IF EXISTS lots_search_vector_update();
