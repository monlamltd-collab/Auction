-- migrations/2026-05-23-resolve-ah-false-positive-drift.sql
--
-- Resolve the 33 false-positive house_url_drift_detected alerts on
-- auctionhouse.co.uk regional siblings.
--
-- Root cause: lib/pipeline/homepage-watch.js stripped each configured URL
-- to its origin (`homepageOf()`) before calling extractHomepage. For every
-- AH regional slug the origin is https://www.auctionhouse.co.uk/ — the
-- NATIONAL landing page — which always advertises `/national` as the current
-- catalogue. Every regional slug therefore looked "drifted to /national",
-- 30+ structural false positives per cycle.
--
-- Fix (shipped this same PR): lib/pipeline/ah-resolver.js fetches
-- https://www.auctionhouse.co.uk/auction/future-auction-dates once per cycle
-- and uses the per-region catalogue links as the source of truth for every
-- AH platform slug. The /national false positive is no longer producible.
--
-- This script marks the existing backlog resolved so the next homepage-watch
-- cycle starts from a clean slate.

UPDATE pipeline_alerts
SET resolved = true,
    resolved_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'resolution_note',
      'false-positive: homepage-watch consulted auctionhouse.co.uk national root for regional sibling; fixed by ah-resolver future-auction-dates source-of-truth'
    )
WHERE event_type = 'house_url_drift_detected'
  AND resolved = false
  AND house LIKE 'auctionhouse%';
