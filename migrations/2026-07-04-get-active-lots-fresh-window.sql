-- ============================================================================
-- RECORD ONLY — DO NOT RE-APPLY.
-- Superseded by migrations/2026-07-13-deal-signals.sql, which redefines
-- get_active_lots with columns this body predates (description, deal_signals,
-- stated_income_pa, income_kind). Re-applying this file would DROP those
-- columns from the served feed.
-- ============================================================================
--
-- migrations/2026-07-04-get-active-lots-fresh-window.sql
-- APPLIED TO PROD 2026-07-04 (portfolio-freshness pass, owner-approved).
--
-- Tightens the served feed's freshness window 21d -> 7d and stops serving
-- past-dated 'available' lots:
--   * 21 days let a stalled house's ghost lots stay user-visible for three
--     weeks (the June scrape stall did exactly this). With the freshness stack
--     live (hourly pulse #155 + 48h attempt floor #154), any lot unconfirmed
--     for a week is stale, not fresh.
--   * An 'available' lot whose auction_date is past is a status-transition
--     failure (post-auction sweep gap — 265 found served), never a live offer.
--     The 1-day grace covers day-of-auction lots and date/timezone slop; a
--     LIVE lot with a mis-stamped past date (the PR #90 class) is protected
--     by the ghost sweep's double guard, not this filter — here it is simply
--     not shown until its date is corrected by the next scrape's re-stamp.
-- Unsold branches unchanged except the future-dated branch's last_seen guard
-- tightens 21d -> 7d to match (the 30d post-auction unsold branch is
-- date-bound by design — unsold lots stay browsable for a month).
--
-- Feed impact measured at apply time: 4,220 -> 2,580 served lots. The delta
-- was ghosts, host-variant duplicates (1,800 rows deleted the same day), and
-- >7d-unconfirmed rows — padding, not coverage. active_feed_collapse was
-- re-baselined accordingly (2026-07-04-hermes-feed-floor-rebaseline.sql).

create or replace function public.get_active_lots()
 returns json
 language sql
 stable
as $function$
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
    where ((l.status = 'available'
            and l.last_seen_at > now() - interval '7 days'
            and (l.auction_date is null or l.auction_date >= current_date - 1))
        or (l.status = 'unsold'    and l.auction_date > now() - interval '30 days'
                                   and l.auction_date <= now())
        or (l.status = 'unsold'    and l.auction_date > now()
                                   and l.last_seen_at > now() - interval '7 days'))
  ) t;
$function$;
