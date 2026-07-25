# Diary — 2026-07-25 fleet coverage soak

## Deployed (main through latest — flags ON in code 2026-07-25)

Full Tasks 0–11 for automatic future-lot population / next-sale robustness.

## Production posture after owner approval (same day)

Defaults **ON** in code (no Railway CLI on host; change picks up on next deploy):

1. `LOT_DATE_CONSENSUS_LIFT_ENABLED` — default **on** (set `false` to observe-only)
2. `FLEET_COVERAGE_ALERTS_ENABLED` — default **on** (set `false` to silence Telegram)

Keep **off**:

- `AUTO_HEAL_ENABLED`
- `BACKLOG_DIGEST_ENABLED`

Lifecycle Step A applied in Supabase same day (view + 45-row traditional date backfill).

Success gates / ballasts: `docs/fleet-coverage-ops.md`.

## Lifecycle Step A — APPLIED 2026-07-25 (user approved)

Prod Supabase `pohrbfhftbprlfzsozyj`:

- `public.is_real_auction_date(date)` helper
- view `public.lot_search_state` (+ grants to anon/authenticated/service_role)
- traditional date backfill: **45** rows updated; **0** remaining safe candidates
- sentinel lots: **0**; passed_in_play bad_* invariants: **0**
- Live after apply: traditional **436**, MMOA fresh **8520**, passed_in_play **234**, finished **15484**

Package: AuctionBrain-Landing `docs/sql/2026-07-24_lot_search_state_step_a.sql`
