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

-- Republish get_active_lots() with the three new columns so the browse-grid
-- path (which reads the RPC, not LOTS_SELECT) carries the signal fields too.
-- Rebuilt from the LIVE definition captured 2026-07-13 (incl. the 7-day
-- freshness window and unsold-sentinel guard) + deal_signals /
-- stated_income_pa / income_kind after title_split. Do NOT rebuild this from
-- an older migration file — always from the live definition.
CREATE OR REPLACE FUNCTION public.get_active_lots()
 RETURNS json
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(json_agg(row_to_json(t)), '[]'::json)
  from (
    select l.id,
           l.house_slug as house,
           l.auctioneer, l.lot_number, l.url, l.catalogue_url, l.address, l.postcode, l.lat, l.lng,
           l.price, l.price_text, l.prop_type, l.beds, l.tenure, l.lease_length, l.sqft, l.condition,
           l.image_url, l.images, l.floor_plans, l.bullets, l.description, l.units, l.auction_date, l.status,
           l.epc_rating, l.epc_score, l.floor_area_sqm, l.flood_zone, l.flood_risk,
           l.comparable_price, l.street_sales_count, l.below_market, l.est_monthly_rent, l.est_gross_yield,
           l.value_estimate, l.score, l.score_breakdown, l.opps, l.risks, l.deal_type, l.vacant, l.title_split,
           l.deal_signals, l.stated_income_pa, l.income_kind,
           l.last_seen_at
    from lots l
    -- Freshness window tightened 21d -> 7d (2026-07-04 portfolio-freshness pass):
    -- with the freshness stack live (hourly pulse + 48h attempt floor), a lot
    -- unconfirmed for a week is stale, not fresh. Also: an 'available' lot whose
    -- auction is past is a status-transition failure, never a live offer -- the
    -- 1-day grace covers day-of-auction lots and timezone slop.
    where ((l.status = 'available'
            and l.last_seen_at > now() - interval '7 days'
            and (l.auction_date is null or l.auction_date >= current_date - 1))
        or (l.status = 'unsold'    and l.auction_date > now() - interval '30 days'
                                   and l.auction_date <= now())
        or (l.status = 'unsold'    and l.auction_date > now()
                                   and l.last_seen_at > now() - interval '7 days'))
  ) t;
$function$;
