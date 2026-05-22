-- 2026-05-22: Telegram card → alert correlation
--
-- The heal bot sends actionable cards (heal-failed, possible-merger, etc.)
-- to Telegram. The operator can now REPLY to one of those cards with a
-- human-verified catalogue URL. To apply that URL we must match the inbound
-- reply back to the alert it answers — Telegram gives us the replied-to
-- message_id, so we store it on the alert row when the card is sent.
--
-- Written by lib/pipeline/{homepage-watch,telegram-backlog}.js when a card
-- is sent; read by lib/pipeline/telegram-actions.js when a reply arrives.

ALTER TABLE pipeline_alerts
  ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT;

-- Partial index — only alerts that were surfaced as a card carry an id.
CREATE INDEX IF NOT EXISTS idx_pipeline_alerts_telegram_message_id
  ON pipeline_alerts (telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;
