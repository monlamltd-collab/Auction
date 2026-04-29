-- 2026-04-30: Atomic AI-search counter increment for authenticated users.
--
-- Replaces the read-then-check-then-write pattern in routes/search.js
-- (~line 401), which let two concurrent requests both pass the limit
-- check at counter=N and both write N+1 — silently exceeding the daily
-- quota by one per concurrent burst.
--
-- The function does check + increment in a single UPDATE with a WHERE
-- clause that requires the post-increment value to stay <= limit.
-- Postgres acquires a row lock on the user row, so concurrent calls
-- serialise. If a second caller arrives at counter=limit, its WHERE
-- clause no longer matches → no rows updated → allowed=false.
--
-- Daily reset: if ai_searches_date IS DISTINCT FROM p_today, the row
-- is treated as zero before the bump (via the CASE in SET).
--
-- Idempotent: CREATE OR REPLACE re-runs are no-ops.

CREATE OR REPLACE FUNCTION public.increment_ai_search(
  p_user_id UUID,
  p_today DATE,
  p_limit INT
)
RETURNS TABLE (searches_used INT, allowed BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bumped AS (
    UPDATE users
    SET
      ai_searches_today = CASE
        WHEN ai_searches_date IS DISTINCT FROM p_today THEN 1
        ELSE ai_searches_today + 1
      END,
      ai_searches_date = p_today
    WHERE id = p_user_id
      AND (
        ai_searches_date IS DISTINCT FROM p_today  -- new day, always allow
        OR ai_searches_today < p_limit              -- under limit
      )
    RETURNING ai_searches_today
  )
  SELECT
    COALESCE(
      (SELECT ai_searches_today FROM bumped),
      (SELECT ai_searches_today FROM users WHERE id = p_user_id)
    )::INT AS searches_used,
    EXISTS (SELECT 1 FROM bumped) AS allowed;
$$;

-- Restrict to service-role only (no anon/authenticated direct call —
-- this is invoked from the Express server with the service key).
REVOKE ALL ON FUNCTION public.increment_ai_search(UUID, DATE, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_ai_search(UUID, DATE, INT) FROM anon;
REVOKE ALL ON FUNCTION public.increment_ai_search(UUID, DATE, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_ai_search(UUID, DATE, INT) TO service_role;

COMMENT ON FUNCTION public.increment_ai_search IS
'Atomic check-and-increment of users.ai_searches_today. Returns (searches_used, allowed). When allowed=false, the caller should respond 429.';
