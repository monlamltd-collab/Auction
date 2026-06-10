-- ═══════════════════════════════════════════════
-- AUCTION CALENDAR TABLE
-- Run this in the Supabase SQL Editor
-- Replaces the hardcoded calendar in server.js
-- ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS auction_calendar (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  house text NOT NULL,
  house_slug text NOT NULL,
  logo text DEFAULT '🔨',
  date date NOT NULL,
  date_end date,
  title text NOT NULL,
  lots integer,
  url text NOT NULL,
  location text DEFAULT 'Online',
  type text DEFAULT 'Residential & Commercial',
  status text DEFAULT 'upcoming',
  catalogue_ready boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_cal_date ON auction_calendar(date);
CREATE INDEX idx_cal_house ON auction_calendar(house_slug);

ALTER TABLE auction_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON auction_calendar FOR ALL USING (true) WITH CHECK (true);
