-- 2026-07-07: Atomic AI-search counter refund.
--
-- The daily quota (increment_ai_search) is bumped BEFORE the AI call to keep
-- the check race-safe. But if the search then fails for a reason that isn't
-- the user's fault (no AI provider key, provider quota-dead, DB error), the
-- user was silently charged one of their daily searches for nothing
-- (2026-07-07 audit). This function refunds that charge.
--
-- Only decrements when the row is still on the SAME day as the charge (so a
-- refund can't leak across a midnight reset) and floors at 0 so it can never
-- go negative. Row-locked like the increment, so refund/increment serialise.
--
-- Idempotent: CREATE OR REPLACE re-runs are no-ops.

CREATE OR REPLACE FUNCTION public.refund_ai_search(
  p_user_id UUID,
  p_today DATE
)
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH refunded AS (
    UPDATE users
    SET ai_searches_today = GREATEST(0, ai_searches_today - 1)
    WHERE id = p_user_id
      AND ai_searches_date = p_today
      AND ai_searches_today > 0
    RETURNING ai_searches_today
  )
  SELECT COALESCE(
    (SELECT ai_searches_today FROM refunded),
    (SELECT ai_searches_today FROM users WHERE id = p_user_id)
  )::INT;
$$;

-- Service-role only, mirroring increment_ai_search.
REVOKE ALL ON FUNCTION public.refund_ai_search(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_ai_search(UUID, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.refund_ai_search(UUID, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refund_ai_search(UUID, DATE) TO service_role;

COMMENT ON FUNCTION public.refund_ai_search IS
'Atomic, floor-at-0, same-day-only decrement of users.ai_searches_today. Refunds a quota charge when a search fails for a non-user-fault reason.';
