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
  expires_at timestamptz DEFAULT (now() + interval '7 days')
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
  created_at timestamptz DEFAULT now(),
  last_login timestamptz DEFAULT now(),
  analyses_count integer DEFAULT 0
);

CREATE INDEX idx_users_email ON users(email);

-- 4. Enable Row Level Security (required by Supabase)
ALTER TABLE cached_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 5. Policies — allow server (service_role) full access
CREATE POLICY "Service role full access" ON cached_analyses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON rate_limits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON users FOR ALL USING (true) WITH CHECK (true);
