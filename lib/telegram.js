// lib/telegram.js — Telegram bot client for self-healing reports
//
// Used by the auction-self-healing skill's REPORT phase when:
// - CLASSIFY confidence < 0.75
// - VERIFY produced < 80% of expected lots
// - A merger was detected but the new owner is not a tracked slug
// - cause = 'unknown' or 'genuine_zero' (decided to do nothing)
// - Any rollback or revert happened
//
// Without this module the skill's "Telegram + stop" hard rule was paper-only.
// Ported from ContentBrain/lib/telegram.js, ESM + log.info/warn/error style,
// trimmed to the heal-report use case (no buttons, no media, no callbacks).

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
  if (!isConfigured()) {
    log.info('Telegram not configured — skipping notification');
    return false;
  }
  try {
    const res = await fetch(`${API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message.slice(0, MAX_BODY),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      log.warn('Telegram sendMessage failed', { status: res.status, err: err.slice(0, 200) });
      return false;
    }
    return true;
  } catch (err) {
    log.warn('Telegram sendMessage error', { err: err.message });
    return false;
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
