-- migrations/2026-07-04-lots-description.sql
--
-- Lot narrative capture (feat/lot-narrative). The 2026-07-04 audit found the
-- portfolio storing under ~50 chars of narrative per lot (Bond Wolfe: 16 —
-- synthetic tags like "3 bedroom", "Vacant") while the source lot pages carry
-- 300–2,500 chars of real description. New column `lots.description` stores
-- the source site's narrative, populated by:
--   • catalogue/detail extraction passthrough (normaliseScrapedLot / detail pass)
--   • the daily narrative sweep (lib/pipeline/narrative-sweep.js)
--
-- Also republishes get_active_lots with l.description in the select. Body is
-- the LIVE definition pulled from the database on 2026-07-04 (Phase-2a
-- house_slug rename + 2026-06-25 l.id + 2026-07-03 unsold-sentinel guard +
-- 2026-07-04 portfolio-freshness 7-day window) with ONLY l.description added.
-- Do not regenerate from older migration files. Idempotent.

ALTER TABLE lots ADD COLUMN IF NOT EXISTS description text;

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
