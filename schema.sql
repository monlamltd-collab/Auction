-- ═══════════════════════════════════════════════
-- BRIDGEMATCH SUPABASE SCHEMA
-- Run this in the Supabase SQL Editor
-- ═══════════════════════════════════════════════

-- 1. CACHED ANALYSES
-- Stores analysis results per catalogue URL
CREATE TABLE cached_analyses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  url text NOT NULL UNIQUE,
  house text,
  total_lots integer,
  title_splits integer,
  top_picks integer,
  lots jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  scraped_with text,
  extracted_with text,
  last_scraped_at timestamptz,
  content_hash text
);

CREATE INDEX idx_cached_url ON cached_analyses(url);
CREATE INDEX idx_cached_expires ON cached_analyses(expires_at);

-- 2. RATE LIMITING
-- Tracks requests per IP per day
CREATE TABLE rate_limits (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ip text NOT NULL,
  date date DEFAULT CURRENT_DATE,
  requests integer DEFAULT 1,
  UNIQUE(ip, date)
);

CREATE INDEX idx_rate_ip_date ON rate_limits(ip, date);

-- 3. USERS (email signups)
-- Gated access to the analyser
CREATE TABLE users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  session_token text,
  created_at timestamptz DEFAULT now(),
  last_login timestamptz DEFAULT now(),
  analyses_count integer DEFAULT 0
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_session_token ON users(session_token);

-- 4. ANALYTICS SNAPSHOTS
-- Daily snapshots of system health for time-series charts
CREATE TABLE analytics_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date date NOT NULL UNIQUE,
  total_lots integer DEFAULT 0,
  image_coverage_pct integer DEFAULT 0,
  lots_by_house jsonb DEFAULT '{}',
  engine_breakdown jsonb DEFAULT '{}',
  healthy_houses integer DEFAULT 0,
  degraded_houses integer DEFAULT 0,
  broken_houses integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_analytics_date ON analytics_snapshots(date);

-- 5. HOUSE SKILLS
-- Per-house scraping skill tracking — persists what works for each auction house
CREATE TABLE house_skills (
  slug text PRIMARY KEY,
  house text NOT NULL,
  catalogue_url text,
  extractor text,
  last_verified timestamptz,
  last_lot_count integer DEFAULT 0,
  average_lot_count integer DEFAULT 0,
  image_coverage integer DEFAULT 0,
  requires_puppeteer boolean DEFAULT false,
  requires_firecrawl boolean DEFAULT false,
  pagination_pattern text DEFAULT 'none',
  notes text DEFAULT '',
  status text DEFAULT 'healthy',
  last_diff jsonb,               -- per-scrape diff: { lots_added, lots_removed, lots_changed, images_gained, images_lost, status_changes, timestamp }
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_skills_status ON house_skills(status);

-- 6. PROCESSED WEBHOOK EVENTS
-- Idempotency table for Stripe webhook deduplication
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-cleanup: delete events older than 7 days (Stripe retries max 72 hours)
-- Cleanup is handled in application code (server.js) after webhook processing

-- 7. PIPELINE ALERTS
-- Tracks pipeline failures, regressions, and coverage drops for admin alerting
CREATE TABLE IF NOT EXISTS pipeline_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,          -- 'auto_analyse_failure', 'discovery_miss', 'image_coverage_drop', 'extractor_regression', 'status_drift', 'quality_gate_ended_lot_ratio', 'quality_gate_calendar_date_sanity'
  severity TEXT NOT NULL DEFAULT 'warning',  -- 'warning' or 'error'
  house TEXT,                        -- auction house slug (null for system-wide alerts)
  message TEXT NOT NULL,
  meta JSONB DEFAULT '{}'::jsonb,    -- structured alert metadata (samples, coverage stats, drift details)
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_pipeline_alerts_resolved ON pipeline_alerts(resolved, created_at DESC);

-- 8. Enable Row Level Security (required by Supabase)
ALTER TABLE cached_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

ALTER TABLE analytics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE house_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_alerts ENABLE ROW LEVEL SECURITY;

-- 9. Policies — allow server (service_role) full access
CREATE POLICY "Service role full access" ON cached_analyses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON rate_limits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON analytics_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON house_skills FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON processed_webhook_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON pipeline_alerts FOR ALL USING (true) WITH CHECK (true);

-- 10. AI USAGE TRACKING
-- Per-call token usage and cost estimates for AI provider monitoring
CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  est_cost NUMERIC(10,6) DEFAULT 0,
  task_type TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage(provider, created_at DESC);
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON ai_usage FOR ALL USING (true) WITH CHECK (true);

-- 11. SAVED SEARCHES
CREATE TABLE IF NOT EXISTS saved_searches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_saved_searches_user ON saved_searches(user_id);
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON saved_searches FOR ALL USING (true) WITH CHECK (true);

-- 12. UNSOLD LOT ALERTS
CREATE TABLE IF NOT EXISTS unsold_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filters JSONB NOT NULL DEFAULT '{}',
  frequency TEXT NOT NULL DEFAULT 'daily',
  active BOOLEAN DEFAULT TRUE,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
CREATE INDEX idx_unsold_alerts_active ON unsold_alerts(active, last_sent_at);
ALTER TABLE unsold_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON unsold_alerts FOR ALL USING (true) WITH CHECK (true);

-- 13. ONBOARDING FIELDS ON USERS
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS experience_level TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS budget_max INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS interests TEXT[] DEFAULT '{}';

-- 14. HARNESS: house_skills health tracking additions
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS health_score INTEGER DEFAULT 100;
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS circuit_state TEXT DEFAULT 'closed';
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0;
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS rolling_lot_counts INTEGER[] DEFAULT '{}';
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS rolling_image_coverage INTEGER[] DEFAULT '{}';
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS enrichment_stats JSONB DEFAULT '{}';
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS healing_cooldown_until TIMESTAMPTZ;
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS healing_attempts INTEGER DEFAULT 0;
ALTER TABLE house_skills ADD COLUMN IF NOT EXISTS circuit_opened_at TIMESTAMPTZ;

-- 15. HARNESS: discovery_candidates table
CREATE TABLE IF NOT EXISTS discovery_candidates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  name TEXT,
  source TEXT NOT NULL,
  confidence NUMERIC(3,2),
  platform_family TEXT,
  est_lots INTEGER,
  gem_score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  reject_reason TEXT,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  evaluated_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_discovery_status ON discovery_candidates(status);
ALTER TABLE discovery_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON discovery_candidates FOR ALL USING (true) WITH CHECK (true);

-- 16. HARNESS: manager_cycles audit table
CREATE TABLE IF NOT EXISTS manager_cycles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cycle_number INTEGER NOT NULL,
  duration_ms INTEGER,
  actions_taken JSONB DEFAULT '[]',
  actions_skipped JSONB DEFAULT '[]',
  health_summary JSONB DEFAULT '{}',
  effectiveness_score NUMERIC(3,2) DEFAULT 0,
  budget_used JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_manager_cycles_created ON manager_cycles(created_at DESC);
ALTER TABLE manager_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON manager_cycles FOR ALL USING (true) WITH CHECK (true);

-- 17. LOTS TABLE
-- Primary data store for individual auction lots (single source of truth)
CREATE TABLE IF NOT EXISTS lots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  house TEXT NOT NULL,
  lot_number TEXT,
  url TEXT NOT NULL,
  catalogue_url TEXT NOT NULL,
  address TEXT NOT NULL,
  postcode TEXT,
  price INTEGER,
  price_text TEXT,
  prop_type TEXT,
  beds INTEGER,
  tenure TEXT,
  lease_length INTEGER,
  sqft INTEGER,
  condition TEXT,
  image_url TEXT,
  bullets JSONB DEFAULT '[]',
  units INTEGER DEFAULT 0,
  auction_date DATE,
  status TEXT DEFAULT 'available',
  sold_price INTEGER,
  epc_rating TEXT,
  epc_score INTEGER,
  epc_date DATE,
  flood_zone INTEGER,
  flood_risk TEXT,
  street_avg INTEGER,
  street_sales JSONB,
  street_sales_count INTEGER,
  below_market NUMERIC(5,2),
  est_monthly_rent INTEGER,
  est_annual_rent INTEGER,
  est_gross_yield NUMERIC(5,2),
  score NUMERIC(4,1),
  score_breakdown JSONB DEFAULT '[]',
  opps JSONB DEFAULT '[]',
  risks JSONB DEFAULT '[]',
  deal_type TEXT,
  vacant BOOLEAN,
  title_split BOOLEAN,
  raw_text TEXT,
  search_text TEXT,
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', COALESCE(search_text, ''))) STORED,
  extracted_with TEXT,
  scraped_with TEXT,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  enriched_at TIMESTAMPTZ,
  lat NUMERIC(9,6),
  lng NUMERIC(9,6),
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  enrichment_manifest JSONB DEFAULT '{}'::jsonb,
  UNIQUE(house, url)
);

CREATE INDEX IF NOT EXISTS idx_lots_catalogue_url ON lots(catalogue_url);
CREATE INDEX IF NOT EXISTS idx_lots_status ON lots(status);
CREATE INDEX IF NOT EXISTS idx_lots_auction_date ON lots(auction_date);
CREATE INDEX IF NOT EXISTS idx_lots_score ON lots(score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_lots_house ON lots(house);
CREATE INDEX IF NOT EXISTS idx_lots_last_seen_at ON lots(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_lots_search_vector ON lots USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_lots_manifest_gin ON lots USING GIN(enrichment_manifest);

ALTER TABLE lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON lots FOR ALL USING (true) WITH CHECK (true);

-- 18. LOT STATUS HISTORY
-- Tracks status changes (available → sold, available → unsold, etc.)
CREATE TABLE IF NOT EXISTS lot_status_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lot_id UUID REFERENCES lots(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lot_status_history_lot ON lot_status_history(lot_id, created_at DESC);
ALTER TABLE lot_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON lot_status_history FOR ALL USING (true) WITH CHECK (true);

-- 19. INCREMENT_RATE_LIMIT RPC
-- Atomically upserts the rate_limits row for (ip, date) and returns the new request count.
-- Called by routes/analyse.js to enforce per-IP daily rate limits without a read-then-write race.
CREATE OR REPLACE FUNCTION increment_rate_limit(p_ip TEXT, p_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_requests INTEGER;
BEGIN
  INSERT INTO rate_limits (ip, date, requests)
  VALUES (p_ip, p_date, 1)
  ON CONFLICT (ip, date)
  DO UPDATE SET requests = rate_limits.requests + 1
  RETURNING requests INTO v_requests;
  RETURN v_requests;
END;
$$;

-- =============================================================================
-- user_lot_actions — per-user likes / analysed / stacks flags for a lot
-- user_deal_scenarios — saved deal-stacking scenarios per (user, lot)
-- Lots are referenced by (house, lot_url); see migrations/2026-04-25-user-lot-data.sql
-- =============================================================================
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
CREATE INDEX IF NOT EXISTS idx_user_lot_actions_user ON user_lot_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_lot_actions_user_liked ON user_lot_actions(user_id) WHERE liked = true;
CREATE INDEX IF NOT EXISTS idx_user_lot_actions_user_analysed ON user_lot_actions(user_id) WHERE analysed = true;

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
CREATE INDEX IF NOT EXISTS idx_user_deal_scenarios_user_lot ON user_deal_scenarios(user_id, house, lot_url);
CREATE INDEX IF NOT EXISTS idx_user_deal_scenarios_user_stacks ON user_deal_scenarios(user_id) WHERE stacks = true;
