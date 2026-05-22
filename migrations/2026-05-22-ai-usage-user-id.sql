-- migrations/2026-05-22-ai-usage-user-id.sql
--
-- Per-user attribution on ai_usage. The table already logs every AI call
-- (lib/ai-provider.js logAICost, fire-and-forget) with provider / model /
-- tokens / est_cost / task_type — but with no link to the user who triggered
-- the call. Without user_id you can see total daily spend but cannot answer
-- "how much has user X cost" or rate-limit / bill per user — the foundation a
-- paid API tier needs.
--
-- user_id is nullable: pipeline / cron / harness AI calls have no user and
-- correctly leave it NULL. Only user-facing endpoints (smart-search today)
-- populate it. ON DELETE SET NULL keeps historic cost rows intact when a
-- user account is removed.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS. Safe to re-run.

ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- "What has this user cost?" — per-user cost rollups for billing / quota.
CREATE INDEX IF NOT EXISTS idx_ai_usage_user
  ON ai_usage (user_id, created_at DESC);

COMMENT ON COLUMN ai_usage.user_id IS
  'The user who triggered this AI call (FK users.id). NULL for pipeline / cron / harness calls that have no user context. Populated by user-facing endpoints — smart-search passes callAI({ userId }).';
