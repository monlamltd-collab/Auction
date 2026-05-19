-- migrations/2026-05-19-scrape-health-view.sql
--
-- Per-house-per-day scrape health, derived from catalogue_snapshots.
-- catalogue_snapshots has been writer-only since 2026-05-13 — this is its
-- first reader.
--
-- Pairs with lot_events: if no events fired for a house today, this view
-- tells you whether it's "nothing actually changed" (scraper healthy,
-- changeTracking short-circuited at ~1 credit) or "scraper broke"
-- (failed_runs > 0, last_successful_run stale).
--
-- "unchanged" counts as success because Firecrawl changeTracking
-- short-circuiting at ~1 credit is the *expected* steady-state behaviour —
-- it means the page hashed clean, not that the scrape failed.
--
-- Day buckets use Europe/London because the UK auction window is what
-- consumers care about; a 2am UTC scrape belongs to the previous business
-- day in a London-centric dashboard.
--
-- Limitation flagged in the COMMENT: houses without a catalogue_url →
-- auction_id mapping (long-tail evergreen sites) are absent from this
-- view. Falling back to lots.last_seen_at aggregations for those is
-- separate work — track in pipeline_alerts if it bites.
--
-- Idempotent: CREATE OR REPLACE VIEW.

CREATE OR REPLACE VIEW scrape_health_daily AS
SELECT
  ac.house_slug                                                          AS house,
  (cs.scraped_at AT TIME ZONE 'Europe/London')::date                     AS day,
  COUNT(*)                                                               AS scrape_runs,
  COUNT(*) FILTER (WHERE cs.scrape_status = 'failed')                    AS failed_runs,
  COALESCE(SUM(cs.lot_count) FILTER (WHERE cs.scrape_status = 'full'), 0) AS lots_seen,
  ROUND(
    COUNT(*) FILTER (WHERE cs.scrape_status IN ('full', 'unchanged'))::numeric
    / NULLIF(COUNT(*), 0),
    3
  )                                                                      AS parse_success_rate,
  MAX(cs.scraped_at) FILTER (WHERE cs.scrape_status IN ('full', 'unchanged'))
                                                                         AS last_successful_run,
  MAX(cs.scraped_at)                                                     AS last_run
FROM catalogue_snapshots cs
JOIN auction_calendar ac ON ac.id = cs.auction_id
GROUP BY ac.house_slug, (cs.scraped_at AT TIME ZONE 'Europe/London')::date;

COMMENT ON VIEW scrape_health_daily IS
  'Per-house-per-day scrape health derived from catalogue_snapshots. parse_success_rate counts full+unchanged as success (unchanged means the page hashed clean under Firecrawl changeTracking, not that the scrape failed). Day buckets in Europe/London timezone. Houses without a catalogue_url → auction_id mapping (evergreen long-tail sites) are absent — track separately via pipeline_alerts or lots.last_seen_at aggregations if needed.';
