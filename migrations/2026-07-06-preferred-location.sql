-- 2026-07-06 — Preferred investment location on users.
-- Stores { input: 'Bristol' | 'BS1', radius: 10 } captured by the onboarding
-- location step. The frontend applies it as the default town/postcode +
-- radius filter on load, so the lot list opens scoped to the user's
-- investment area on any device. preferred_regions (region multi-select)
-- already exists; this adds the precise town/postcode preference.
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_location JSONB;
