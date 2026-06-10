-- Analytics Snapshots table
-- Run this in Supabase SQL Editor to create the table for time-series admin charts

CREATE TABLE IF NOT EXISTS analytics_snapshots (
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

CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_snapshots(date);

ALTER TABLE analytics_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON analytics_snapshots FOR ALL USING (true) WITH CHECK (true);
