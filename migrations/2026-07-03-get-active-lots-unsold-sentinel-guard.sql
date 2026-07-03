-- migrations/2026-07-03-get-active-lots-unsold-sentinel-guard.sql
--
-- Close the unsold-sentinel visibility loophole (2026-07-03 duplicate-lots
-- incident). The unsold branch read `auction_date > now() - interval '30 days'`,
-- meaning "unsold at an auction in the last 30 days" — but always_on houses
-- stamp the 2099-12-31 placeholder date, which satisfies that predicate FOREVER.
-- Every stale re-list an always_on house flipped to 'unsold' stayed on the live
-- board permanently (auctionhousescotland: the same plot visible 3× under
-- successive lot ids).
--
-- New rule, branch by date kind:
--   real past date    → unchanged: visible for 30 days after the auction.
--   future/sentinel   → the auction date is meaningless, so gate on the same
--                       last_seen_at < 21d recency the 'available' branch uses:
--                       visible while the house still lists it, retired when
--                       the scraper stops seeing it.
-- Measured at migration time: 731 sentinel-dated unsold rows were permanently
-- visible; 187 still seen <21d stay (live post-auction stock), 544 retire.
--
-- IMPORTANT: this body is the LIVE function definition pulled from the database
-- (Phase-2a `house_slug as house` rename + the 2026-06-25 `l.id` addition), with
-- ONLY the unsold-branch upper bound added. Do not regenerate from older
-- migration files. CREATE OR REPLACE makes it idempotent.

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
           l.image_url, l.images, l.floor_plans, l.bullets, l.units, l.auction_date, l.status,
           l.epc_rating, l.epc_score, l.floor_area_sqm, l.flood_zone, l.flood_risk,
           l.comparable_price, l.street_sales_count, l.below_market, l.est_monthly_rent, l.est_gross_yield,
           l.value_estimate, l.score, l.score_breakdown, l.opps, l.risks, l.deal_type, l.vacant, l.title_split,
           l.last_seen_at
    from lots l
    where ((l.status = 'available' and l.last_seen_at > now() - interval '21 days')
        or (l.status = 'unsold'    and l.auction_date > now() - interval '30 days'
                                   and l.auction_date <= now())
        or (l.status = 'unsold'    and l.auction_date > now()
                                   and l.last_seen_at > now() - interval '21 days'))
  ) t;
$function$;
