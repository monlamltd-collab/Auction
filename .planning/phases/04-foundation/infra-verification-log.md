# Infrastructure Verification Log

Phase 04-foundation, Plan 01: Infrastructure readiness checks.

## INFR-01: Supabase Plan Tier

- **Verified:** 2026-03-22
- **Plan:** Free tier
- **Limits:** 500MB DB, 2GB bandwidth, 50K MAU
- **Assessment:** PASS -- sufficient for current scale (free-first model, low initial traffic)
- **Action needed:** None. Monitor as traffic grows post-launch.

## INFR-02: Stripe Active Subscriptions

- **Verified:** 2026-03-22
- **Active subscribers:** 0
- **Cancellations needed:** None
- **DB update needed:** No -- no rows match `tier = 'premium' AND stripe_subscription_id IS NOT NULL`
- **Assessment:** PASS -- safe to set STRIPE_ENABLED=false without orphaning any billing
- **Unblocks:** CRIT-1 blocker in STATE.md resolved

## INFR-03: Railway Capacity Baseline (30-day metrics)

- **Verified:** 2026-03-22
- **CPU:** ~0 vCPU baseline, spikes to 3-6 vCPU during scraping
- **Memory:** 200-400MB baseline, spikes to 1-1.5GB during scraping
- **Requests:** Low volume, mostly 2xx, occasional 4xx
- **Response time:** p50 near 0ms, p95/p99 spikes to 10-20s on AI endpoints
- **Error rate:** Occasional spikes to 10-40% (likely during heavy scrape batches)
- **OOM kills:** None observed in 30-day window
- **Tier:** Hobby tier (free/starter level, "Scale and grow - Upgrade to Pro" banner visible)
- **Assessment:** PASS -- no OOM kills, memory headroom exists. Scraping spikes are expected and transient. Monitor if free-first traffic significantly increases baseline load.
- **Unblocks:** Railway capacity concern in STATE.md resolved -- no upgrade needed at current scale
