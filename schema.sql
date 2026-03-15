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
  event_type TEXT NOT NULL,          -- 'auto_analyse_failure', 'discovery_miss', 'image_coverage_drop', 'extractor_regression'
  severity TEXT NOT NULL DEFAULT 'warning',  -- 'warning' or 'error'
  house TEXT,                        -- auction house slug (null for system-wide alerts)
  message TEXT NOT NULL,
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
