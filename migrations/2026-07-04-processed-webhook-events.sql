-- migrations/2026-07-04-processed-webhook-events.sql
--
-- Create the processed_webhook_events table (Phase 5 hardening). Discovered
-- during the Stripe idempotency fix: routes/stripe.js has read/written this
-- table since the webhook shipped, but it was NEVER created in prod — the
-- select and upsert both failed silently (no error handling), so webhook
-- idempotency has never actually worked. Harmless while Stripe is
-- hibernated; a double-grant bug the moment it wakes.
--
-- event_id is the PRIMARY KEY — the insert-first claim in routes/stripe.js
-- relies on the unique violation (23505) to reject concurrent duplicate
-- deliveries. Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  event_id     text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Service-role only (server-side writes); no RLS policies needed for anon.
ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;
