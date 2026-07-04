-- migrations/2026-07-04-dedupe-host-variant-lots.sql
-- APPLIED TO PROD 2026-07-04 (owner-approved; deleted exactly 1,800 rows).
--
-- One-off cleanup of www/bare host-variant duplicate rows, companion to
-- canonicaliseLotUrl (2026-07-03 duplicate-lots fixes, PR #158). lots.url is
-- the unique conflict key; before canonicalisation two scrape paths rendering
-- on different hosts minted two rows per lot — verified live on the Auction
-- House franchise: the same lot as auctionhouse.co.uk/... (seen 07-03 12:09,
-- pre-fix) and www.auctionhouse.co.uk/... (seen 07-04 00:55, post-fix
-- canonical). 574 such pairs were being SERVED as duplicates.
--
-- Keep-newest rule (mirrors the applied 2026-07-03 draft's precedent): the
-- more-recently-seen twin is the canonical identity that scrapes keep
-- re-confirming; the older twin would never be re-seen again. lot_events for
-- deleted ids are intentionally retained (no FK).

-- Count first (was 1,800):
-- select count(*) from lots a
-- join lots b on a.id <> b.id and a.house_slug = b.house_slug
--   and replace(a.url,'://www.','://') = replace(b.url,'://www.','://') and a.url <> b.url
-- where (b.last_seen_at > a.last_seen_at or (b.last_seen_at = a.last_seen_at and b.id > a.id));

delete from lots
where id in (
  select a.id
  from lots a
  join lots b on a.id <> b.id
    and a.house_slug = b.house_slug
    and replace(a.url, '://www.', '://') = replace(b.url, '://www.', '://')
    and a.url <> b.url
  where (b.last_seen_at > a.last_seen_at
     or (b.last_seen_at = a.last_seen_at and b.id > a.id))
);
