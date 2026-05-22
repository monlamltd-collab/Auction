-- migrations/2026-05-22-ai-usage-user-id.sql
--
-- Per-user attribution on ai_usage.
--
-- ai_usage is defined in schema.sql (section 10) but was never applied to
-- the production database — verified 2026-05-22: the table was absent, so
-- lib/ai-provider.js logAICost has been silently no-op-ing every AI cost
-- log (the fire-and-forget .then() swallowed the "relation does not exist"
-- error). This migration therefore CREATES the table — with user_id built
-- in — and also ALTERs, so it is correct whether ai_usage is missing
-- entirely or already exists without the column.
--
-- Why user_id: cost was only ever tracked globally. Per-user attribution is
-- the foundation a paid API tier needs — billing and rate-limiting cannot
-- work without it. user_id is nullable: pipeline / cron / harness AI calls
-- have no user and correctly leave it NULL; only user-facing endpoints
-- (smart-search today) populate it. ON DELETE SET NULL keeps historic cost
-- rows intact when a user account is removed.
--
-- Idempotent: CREATE / ALTER / INDEX ... IF NOT EXISTS; DROP POLICY IF
-- EXISTS before CREATE POLICY. Safe to re-run.

CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  est_cost NUMERIC(10,6) DEFAULT 0,
  task_type TEXT,
  duration_ms INTEGER,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- For any database where ai_usage already exists without user_id.
ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_created  ON ai_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user     ON ai_usage (user_id, created_at DESC);

-- RLS: identical posture to every other table in schema.sql — the server
-- writes via the service role; the table is not exposed to anon clients.
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON ai_usage;
CREATE POLICY "Service role full access" ON ai_usage FOR ALL USING (true) WITH CHECK (true);

COMMENT ON COLUMN ai_usage.user_id IS
  'The user who triggered this AI call (FK users.id). NULL for pipeline / cron / harness calls that have no user context. Populated by user-facing endpoints — smart-search passes callAI({ userId }).';
