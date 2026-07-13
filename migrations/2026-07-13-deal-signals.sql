-- 2026-07-13 — Deal-signal identifier layer (Phase 2).
-- Multi-label deal archetypes alongside the single-label deal_type:
--   deal_signals     jsonb    — array of stable slugs, e.g. ["hmo",
--                               "investment-valuation", "income-stated"].
--                               Written by analyseLot (lib/pipeline/scoring.js
--                               → lib/pipeline/deal-signals.js) on every
--                               scoring pass.
--   stated_income_pa integer  — rental income stated in the listing text,
--                               normalised to £/annum (pcm×12, pw×52).
--   income_kind      text     — 'passing' (achieved rent) | 'potential'
--                               (appraised). NULL when no income stated.
-- Contract bump: LOT_SCHEMA_VERSION 3.3.0 → 3.4.0.

ALTER TABLE lots ADD COLUMN IF NOT EXISTS deal_signals jsonb;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS stated_income_pa integer;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS income_kind text;

COMMENT ON COLUMN lots.deal_signals IS 'Multi-label deal archetype slugs from lib/pipeline/deal-signals.js (hmo, investment-valuation, income-stated, title-split, short-lease, mixed-use, cash-buyers-only, planning-granted, regulated-tenancy, holiday-let)';
COMMENT ON COLUMN lots.stated_income_pa IS 'Listing-stated rental income normalised to £/annum';
COMMENT ON COLUMN lots.income_kind IS 'passing = achieved rent stated; potential = appraised/expected rent';
