-- Migration: per-user likes / analysed flag and saved deal-stacking scenarios
-- ============================================================================
-- Adds two user-scoped tables that back the new deal-stacking persistence:
--   * user_lot_actions    — one row per (user, lot) with liked / analysed / stacks flags
--   * user_deal_scenarios — many named scenarios per (user, lot) holding inputs+results
--
-- Lots are referenced by (house, lot_url) directly, NOT via a FK to the lots
-- table. That keeps saved scenarios alive after a lot rolls off the active
-- catalogue and avoids cascade churn during nightly catalogue rotation.
--
-- Apply via Supabase SQL editor or `supabase db push`.

BEGIN;

-- ─── user_lot_actions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_lot_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  house text NOT NULL,
  lot_url text NOT NULL,
  liked boolean NOT NULL DEFAULT false,
  analysed boolean NOT NULL DEFAULT false,
  stacks boolean NOT NULL DEFAULT false,
  analysed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, house, lot_url)
);

CREATE INDEX IF NOT EXISTS idx_user_lot_actions_user
  ON user_lot_actions(user_id);

CREATE INDEX IF NOT EXISTS idx_user_lot_actions_user_liked
  ON user_lot_actions(user_id) WHERE liked = true;

CREATE INDEX IF NOT EXISTS idx_user_lot_actions_user_analysed
  ON user_lot_actions(user_id) WHERE analysed = true;

-- ─── user_deal_scenarios ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_deal_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  house text NOT NULL,
  lot_url text NOT NULL,
  name text NOT NULL,
  inputs jsonb NOT NULL,
  results jsonb NOT NULL,
  stacks boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_deal_scenarios_user_lot
  ON user_deal_scenarios(user_id, house, lot_url);

CREATE INDEX IF NOT EXISTS idx_user_deal_scenarios_user_stacks
  ON user_deal_scenarios(user_id) WHERE stacks = true;

-- ─── updated_at triggers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_user_lot_actions ON user_lot_actions;
CREATE TRIGGER trg_touch_user_lot_actions
  BEFORE UPDATE ON user_lot_actions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_user_deal_scenarios ON user_deal_scenarios;
CREATE TRIGGER trg_touch_user_deal_scenarios
  BEFORE UPDATE ON user_deal_scenarios
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Match the project pattern: RLS on, service role gets full access. The
-- server uses the service-role Supabase client, so direct anon/authenticated
-- PostgREST traffic is denied by default (no permissive policy for those roles).
ALTER TABLE user_lot_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_deal_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON user_lot_actions;
CREATE POLICY "Service role full access"
  ON user_lot_actions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON user_deal_scenarios;
CREATE POLICY "Service role full access"
  ON user_deal_scenarios FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

COMMIT;

-- Verify (optional):
-- SELECT tablename FROM pg_tables WHERE tablename IN ('user_lot_actions','user_deal_scenarios');
-- SELECT indexname FROM pg_indexes WHERE tablename IN ('user_lot_actions','user_deal_scenarios');
