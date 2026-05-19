// lib/telegram.js — Telegram bot client for self-healing reports + interactive cards
//
// Two send modes:
//   - sendNotification(message)               — fire-and-forget text
//   - sendActionableCard(message, buttons)    — text + inline_keyboard so Simon
//                                                can tap actions from his phone
//
// Inbound callbacks (button taps) are handled at routes/telegram-webhook.js,
// which forwards them to lib/pipeline/telegram-actions.js for dispatch.

import { log } from './logging.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;
const MAX_BODY = 4000; // Telegram caps sendMessage at 4096 chars; leave headroom

export function isConfigured() {
  return !!(BOT_TOKEN && CHAT_ID);
}

/**
 * Send an HTML-formatted message to the configured chat.
 * Returns true on success, false on miss (no env, network error, non-2xx).
 * Never throws — heal sessions must never crash on a Telegram outage.
 */
export async function sendNotification(message) {
  return _sendMessage(message, null).then(r => !!r);
}

/**
 * Send an actionable card: HTML message + a grid of inline-keyboard buttons.
 * Each button's `callback_data` is sent back to the webhook when tapped.
 *
 * @param {string} message - HTML-formatted message body (auto-truncated)
 * @param {Array<Array<{label: string, callback_data: string}>>} buttons - rows of buttons
 * @returns {Promise<{ok: boolean, messageId?: number}>}
 */
export async function sendActionableCard(message, buttons) {
  const inline_keyboard = (buttons || [])
    .filter(row => Array.isArray(row) && row.length)
    .map(row => row.map(b => ({
      text: b.label,
      callback_data: String(b.callback_data).slice(0, 64), // Telegram's hard limit
    })));
  const result = await _sendMessage(message, inline_keyboard.length ? { inline_keyboard } : null);
  return { ok: !!result, messageId: result?.message_id };
}

/**
 * Edit an existing message's text + keyboard (used after a callback so Simon
 * sees a confirmation in-place). Silent if not configured.
 */
export async function editMessageText(messageId, message, buttons = null) {
  if (!isConfigured() || !messageId) return false;
  const inline_keyboard = buttons
    ? buttons.map(row => row.map(b => ({ text: b.label, callback_data: String(b.callback_data).slice(0, 64) })))
    : undefined;
  try {
    const body = {
      chat_id: CHAT_ID,
      message_id: messageId,
      text: String(message).slice(0, MAX_BODY),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    };
    if (inline_keyboard) body.reply_markup = { inline_keyboard };
    const res = await fetch(`${API}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      log.warn('Telegram editMessageText failed', { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    log.warn('Telegram editMessageText error', { err: err.message });
    return false;
  }
}

/**
 * Acknowledge a callback_query (stops the spinner on the user's button tap).
 * Telegram requires this within 30s of the callback or it shows "loading…".
 */
export async function answerCallbackQuery(callbackQueryId, text = '') {
  if (!isConfigured() || !callbackQueryId) return false;
  try {
    const res = await fetch(`${API}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text ? text.slice(0, 200) : undefined,
      }),
    });
    return res.ok;
  } catch (err) {
    log.warn('Telegram answerCallbackQuery error', { err: err.message });
    return false;
  }
}

// ── Internal: shared sendMessage call. Returns the Telegram message object on
//    success (so callers can capture message_id) or null on failure. ──
async function _sendMessage(message, inline_keyboard_obj) {
  if (!isConfigured()) {
    log.info('Telegram not configured — skipping notification');
    return null;
  }
  try {
    const body = {
      chat_id: CHAT_ID,
      text: String(message).slice(0, MAX_BODY),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    };
    if (inline_keyboard_obj) body.reply_markup = inline_keyboard_obj;
    const res = await fetch(`${API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      log.warn('Telegram sendMessage failed', { status: res.status, err: err.slice(0, 200) });
      return null;
    }
    const data = await res.json();
    return data?.result || null;
  } catch (err) {
    log.warn('Telegram sendMessage error', { err: err.message });
    return null;
  }
}

/**
 * Send a heal-report in the format from auction-self-healing skill §5.
 * @param {object} report
 * @param {string} report.slug          — house slug being healed
 * @param {string} report.cause         — classified cause from §2 CLASSIFY table
 * @param {number} report.confidence    — 0.0–1.0
 * @param {string} report.action        — one-line summary of what was done
 * @param {string} report.verify        — e.g. "27 lots scraped (expected ~31)"
 * @param {string} [report.decision]    — what is needed from the user; default "none"
 * @param {string[]} [report.evidence]  — bullet points (URLs, banner text, etc.); cap 8
 * @param {string[]} [report.commits]   — sha1 list; default "none"
 */
export async function sendHealReport({ slug, cause, confidence, action, verify, decision, evidence, commits }) {
  const lines = [
    `<b>🩺 Heal: ${escapeHtml(slug)}</b>`,
    `<b>Cause:</b> ${escapeHtml(cause)} (confidence ${(confidence ?? 0).toFixed(2)})`,
    `<b>Action taken:</b> ${escapeHtml(action || 'none')}`,
    `<b>Verify:</b> ${escapeHtml(verify || 'n/a')}`,
    `<b>Decision needed:</b> ${escapeHtml(decision || 'none')}`,
  ];
  if (Array.isArray(evidence) && evidence.length) {
    lines.push('<b>Evidence:</b>');
    for (const e of evidence.slice(0, 8)) lines.push(`- ${escapeHtml(e)}`);
  }
  lines.push(
    `<b>Commits:</b> ${Array.isArray(commits) && commits.length ? commits.map(escapeHtml).join(', ') : 'none'}`,
  );
  return sendNotification(lines.join('\n'));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
