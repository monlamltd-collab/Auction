// routes/telegram-webhook.js
// ═══════════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK — inbound callback_query + message receiver
// ═══════════════════════════════════════════════════════════════
//
// Two kinds of inbound update are handled:
//   • callback_query — Simon tapped a button on an actionable card. The
//     callback_data is dispatched to lib/pipeline/telegram-actions.js, then
//     the card is edited in-place to show the outcome.
//   • message (a reply) — Simon replied to a card with a human-verified
//     catalogue URL. The reply is matched to its alert via the replied-to
//     message_id and the URL is applied (catalogue fix or merger).
//
// The secret-token header is validated on every request. One-off setup:
// register the webhook URL with Telegram — see
// scripts/register-telegram-webhook.mjs (allowed_updates must include both
// 'callback_query' and 'message').

import { Router } from 'express';
import { log } from '../lib/logging.js';
import { answerCallbackQuery, editMessageText, sendNotification } from '../lib/telegram.js';
import { handleCallbackData, handleVerifiedUrlReply } from '../lib/pipeline/telegram-actions.js';
import { supabase } from '../lib/supabase.js';
import { HOUSE_DISPLAY_NAMES } from '../lib/houses.js';

const router = Router();

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

router.post('/telegram/webhook', async (req, res) => {
  // Validate the secret-token header. Telegram sends this on every update
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

  // ── Inbound message: a reply carrying a human-verified catalogue URL ──
  if (update.message) {
    await handleInboundMessage(update.message, res);
    return;
  }

  // ── Inbound callback_query: a button tap on an actionable card ──
  const cbq = update.callback_query;
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

// ═══════════════════════════════════════════════════════════════
// Inbound message — a reply to an alert card with a verified URL.
// ═══════════════════════════════════════════════════════════════
async function handleInboundMessage(msg, res) {
  // Only act on replies — a plain message has no card to apply a URL to.
  // (The "reply with a URL" hint lives on the cards themselves.)
  if (!msg.reply_to_message) {
    return res.json({ ok: true });
  }
  // Only accept replies from the configured chat.
  if (CHAT_ID && String(msg.chat?.id) !== String(CHAT_ID)) {
    log.warn('telegram-webhook: reply from unexpected chat — ignoring', { chat: msg.chat?.id });
    return res.json({ ok: true });
  }

  const replyToMessageId = msg.reply_to_message.message_id;
  const cardText = msg.reply_to_message.text || '';

  let result;
  try {
    result = await handleVerifiedUrlReply({ replyToMessageId, text: msg.text || '' });
  } catch (err) {
    log.error('telegram-webhook: verified-url handler threw', { err: err.message });
    result = { ok: false, summary: `error: ${err.message}` };
  }

  // Ack Telegram with a fast 200 — the rest runs after the response.
  res.json({ ok: true });

  // Surface the outcome. On success, edit the card in-place and strip its
  // buttons (the alert is resolved). On failure, leave the card and its
  // Snooze/Dismiss buttons intact and send a separate note.
  try {
    if (result.ok && cardText) {
      await editMessageText(
        replyToMessageId,
        `${cardText}\n\n<b>✓ URL applied:</b> ${escapeHtml(result.summary)}`,
        [],
      );
    } else {
      await sendNotification(`${result.ok ? '✓' : '✗'} ${escapeHtml(result.summary)}`);
    }
  } catch (err) {
    log.warn('telegram-webhook: outcome notification failed', { err: err.message });
  }

  // A heal-apply queues a verification re-scrape — run it in the background.
  if (result.ok && result.rescrape) {
    void verifyHealedUrl(result.rescrape);
  }
}

// Re-scrape a freshly-applied catalogue URL and report the lot count back to
// Telegram. Runs in the background, after the webhook has already replied.
async function verifyHealedUrl({ slug, url }) {
  const name = HOUSE_DISPLAY_NAMES[slug] || slug;
  try {
    // Lazy import — analysis.js is heavy and already loaded by the server;
    // a lazy import keeps this route module's import graph cycle-free.
    const { autoAnalyseOne } = await import('../lib/analysis.js');
    await autoAnalyseOne(url, { forceFresh: true });
  } catch (err) {
    log.warn('telegram-webhook: verification re-scrape failed', { slug, err: err.message });
    await sendNotification(`⚠ <b>${escapeHtml(name)}</b>: applied your URL but the re-scrape errored — ${escapeHtml(err.message)}`);
    return;
  }

  let count = null;
  try {
    const { count: c } = await supabase
      .from('lots')
      .select('id', { count: 'exact', head: true })
      .ilike('house', slug);
    if (Number.isInteger(c)) count = c;
  } catch { /* silent — the re-scrape itself succeeded */ }

  if (count === 0) {
    await sendNotification(`⚠ <b>${escapeHtml(name)}</b>: applied your URL but the re-scrape found <b>0 lots</b> — please double-check the link.`);
  } else if (count != null) {
    await sendNotification(`✓ <b>${escapeHtml(name)}</b>: re-scraped after your URL fix — <b>${count}</b> lots.`);
  } else {
    await sendNotification(`✓ <b>${escapeHtml(name)}</b>: re-scraped after your URL fix.`);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export default router;
