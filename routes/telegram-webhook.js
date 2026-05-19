// routes/telegram-webhook.js
// ═══════════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK — inbound callback_query receiver
// ═══════════════════════════════════════════════════════════════
//
// When Simon taps a button on an actionable card, Telegram POSTs a JSON
// update to this endpoint. We validate the secret token header (set when
// the webhook is registered with Telegram), dispatch the callback_data to
// lib/pipeline/telegram-actions.js, then ack the spinner + edit the card
// in-place to show the outcome.
//
// One-off setup: register the webhook URL with Telegram. See
// scripts/register-telegram-webhook.mjs.

import { Router } from 'express';
import { log } from '../lib/logging.js';
import { answerCallbackQuery, editMessageText } from '../lib/telegram.js';
import { handleCallbackData } from '../lib/pipeline/telegram-actions.js';

const router = Router();

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

router.post('/telegram/webhook', async (req, res) => {
  // Validate the secret-token header. Telegram sends this on every callback
  // when the webhook was registered with `secret_token`. Without a configured
  // secret on our side we refuse all traffic — open webhooks are footguns.
  if (!WEBHOOK_SECRET) {
    log.warn('telegram-webhook: TELEGRAM_WEBHOOK_SECRET not set — refusing');
    return res.status(503).json({ ok: false, error: 'webhook not configured' });
  }
  const provided = req.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (provided !== WEBHOOK_SECRET) {
    log.warn('telegram-webhook: invalid secret token', { provided_len: provided.length });
    return res.status(401).json({ ok: false, error: 'invalid secret' });
  }

  const update = req.body || {};
  const cbq = update.callback_query;

  // We only handle callback_query updates — Telegram also delivers messages
  // and edits but we don't act on them.
  if (!cbq) {
    return res.json({ ok: true });
  }

  const callbackData = cbq.data || '';
  const callbackId = cbq.id;
  const messageId = cbq.message?.message_id;
  const originalText = cbq.message?.text || '';

  let result;
  try {
    result = await handleCallbackData(callbackData);
  } catch (err) {
    log.error('telegram-webhook: handler threw', { err: err.message });
    result = { ok: false, summary: `error: ${err.message}` };
  }

  // Ack the spinner first (must happen within 30s or Telegram shows "loading…").
  await answerCallbackQuery(callbackId, result.ok ? `✓ ${result.summary}` : `✗ ${result.summary}`);

  // Edit the original message in-place so Simon sees the outcome without
  // scrolling back. Strip the buttons (an action has been taken).
  if (messageId && originalText) {
    const marker = result.ok ? '✓ Done' : '✗ Failed';
    const newText = `${originalText}\n\n<b>${marker}:</b> ${escapeHtml(result.summary)}`;
    await editMessageText(messageId, newText, []);  // empty buttons = strip keyboard
  }

  // Always 200 to Telegram so it doesn't retry — we've handled (or logged) it.
  return res.json({ ok: true });
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export default router;
