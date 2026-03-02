-- ═══════════════════════════════════════════════
-- SMART SEARCH CACHE — Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS smart_search_cache (
  query_key TEXT PRIMARY KEY,
  results JSONB NOT NULL,
  report TEXT,
  sources JSONB,
  source_urls TEXT[] DEFAULT '{}',
  stale_urls TEXT[] DEFAULT '{}',
  total_searched INTEGER,
  sold_filter TEXT DEFAULT 'all',
  cached_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '1 hour')
);

ALTER TABLE smart_search_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON smart_search_cache FOR ALL USING (true) WITH CHECK (true);

-- Add tier column to users table for premium gating (Phase 4)
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'free';
