-- ═══════════════════════════════════════════════
-- BRIDGEMATCH LEADS TABLE
-- Run this in the Supabase SQL Editor
-- Adds lead capture for the bridging validation tool
-- ═══════════════════════════════════════════════

-- 5. LEADS (from bridging validation tool)
CREATE TABLE leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  
  -- Investor contact
  investor_name text NOT NULL,
  investor_email text NOT NULL,
  investor_phone text,
  contact_pref text DEFAULT 'email',  -- 'call' or 'email'
  
  -- Regulatory
  is_regulated boolean DEFAULT false,
  occupancy text,  -- 'investment' or 'owner_occupied'
  
  -- Deal data (from the validation tool)
  property_price integer,          -- pence-free integer
  loan_amount integer,
  ltv_percent numeric(5,2),
  works_budget integer,
  matching_lenders integer,
  property_type text,              -- 'resi', 'comm', 'semi'
  property_address text,           -- from URL params if available
  deposit_range text,              -- '<25k', '25-50k', '50-100k', '100k+'
  experience_level text,           -- 'first_time', '1_to_3', '4_plus'
  
  -- Source tracking
  source text DEFAULT 'bridgematch_lite',  -- which tool generated the lead
  auction_house text,
  auction_url text,
  
  -- Full analysis snapshot
  deal_data_json jsonb,
  
  -- Lead management
  status text DEFAULT 'new',       -- new, contacted, referred, converted, dead
  referred_to text,                -- broker name/company
  referral_date timestamptz,
  outcome_notes text,
  proc_fee_earned numeric(10,2),
  
  -- Consent
  consent_given boolean DEFAULT true,
  consent_timestamp timestamptz DEFAULT now()
);

CREATE INDEX idx_leads_email ON leads(investor_email);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_created ON leads(created_at DESC);
CREATE INDEX idx_leads_regulated ON leads(is_regulated);

-- Enable RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access" ON leads FOR ALL USING (true) WITH CHECK (true);
