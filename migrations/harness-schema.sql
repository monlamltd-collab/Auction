-- ═══════════════════════════════════════════════════════════════
-- HARNESS SCHEMA MIGRATION
-- Adds health tracking to house_skills + discovery_candidates + manager_cycles
-- Run this in the Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. house_skills additions (health + enrichment tracking)
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

-- 2. discovery_candidates table
CREATE TABLE IF NOT EXISTS discovery_candidates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  name TEXT,
  source TEXT NOT NULL,            -- 'link_harvest', 'directory', 'ai_search', 'ecosystem'
  confidence NUMERIC(3,2),         -- 0.00-1.00
  platform_family TEXT,            -- 'eig', 'sdl', 'auction_hammer', 'custom'
  est_lots INTEGER,
  gem_score INTEGER DEFAULT 0,     -- "rare gems" discovery value score
  status TEXT DEFAULT 'pending',   -- 'pending', 'evaluating', 'approved', 'rejected', 'active'
  reject_reason TEXT,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  evaluated_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ       -- don't re-evaluate rejected candidates until this date
);

CREATE INDEX IF NOT EXISTS idx_discovery_status ON discovery_candidates(status);
ALTER TABLE discovery_candidates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON discovery_candidates FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. manager_cycles table (audit trail for autonomous actions)
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
DO $$ BEGIN
  CREATE POLICY "Service role full access" ON manager_cycles FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
