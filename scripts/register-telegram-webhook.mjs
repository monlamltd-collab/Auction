#!/usr/bin/env node
// scripts/register-telegram-webhook.mjs
// One-off setup: register our /telegram/webhook endpoint with Telegram so
// callback_query updates arrive at the Express app.
//
// Usage:
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
//     node scripts/register-telegram-webhook.mjs https://your-app.up.railway.app
//
// Re-running is idempotent — Telegram replaces the previous webhook URL.

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const baseUrl = process.argv[2];

if (!token || !secret || !baseUrl) {
  console.error('Usage: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/register-telegram-webhook.mjs https://your-app.com');
  process.exit(1);
}

const webhookUrl = `${baseUrl.replace(/\/+$/, '')}/telegram/webhook`;

const resp = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ['callback_query'],   // we only care about button taps
  }),
});

const result = await resp.json();
if (resp.ok && result.ok) {
  console.log('✓ Webhook registered:', webhookUrl);
  console.log('  Description:', result.description);
} else {
  console.error('✗ setWebhook failed:', result);
  process.exit(1);
}
