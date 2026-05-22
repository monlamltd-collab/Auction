// lib/pipeline/telegram-backlog.js
// ═══════════════════════════════════════════════════════════════
// BACKLOG DIGEST — surface stale unresolved pipeline_alerts as cards
// ═══════════════════════════════════════════════════════════════
//
// The homepage-watch cycle sends actionable cards for what it found in THIS
// cycle. Anything that fired alerts on prior days but never got resolved sits
// in pipeline_alerts.resolved=false and goes unseen.
//
// This module queries those old alerts and re-surfaces them as Telegram cards
// so Simon can clear the backlog from his phone. Designed to be invoked from
// a daily cron in server.js.

import { HOUSE_DISPLAY_NAMES } from '../houses.js';

// Alert event_types we know how to render as actionable cards. Anything else
// stays in the table for human review via /api/admin or SQL.
const ACTIONABLE_TYPES = new Set([
  'house_url_drift_detected',
  'house_merger_suspected',
  'house_domain_parked',
  'house_no_longer_auction',
  'house_no_catalogue_found',
  'house_homepage_unreachable',
  'healing_failed',
]);

const MAX_CARDS_PER_DIGEST = 20;
const STALE_AFTER_HOURS = 24;       // skip alerts from the last cycle to avoid duplicates

// Alert types where a verified catalogue URL is the fix — these cards get a
// "reply with the correct URL" hint (routes/telegram-webhook.js handles it).
const URL_FIXABLE_TYPES = new Set([
  'healing_failed',
  'house_merger_suspected',
  'house_url_drift_detected',
  'house_no_catalogue_found',
]);
const VERIFIED_URL_HINT = '💬 Reply to this message with the correct catalogue URL.';

/**
 * Build + send a backlog digest of unresolved actionable alerts.
 * @returns {Promise<{sent: number, total: number}>}
 */
export async function sendBacklogDigest(supabase, deps = {}) {
  if (!supabase || !deps.sendActionableCard) {
    return { sent: 0, total: 0, reason: 'missing deps' };
  }
  const cutoff = new Date(Date.now() - STALE_AFTER_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase.from('pipeline_alerts')
    .select('id, event_type, house, message, meta, created_at')
    .eq('resolved', false)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    deps.log?.warn?.('telegram-backlog: query failed', { err: error.message });
    return { sent: 0, total: 0, error: error.message };
  }

  const actionable = (data || []).filter(a => ACTIONABLE_TYPES.has(a.event_type));
  if (actionable.length === 0) {
    deps.log?.info?.('telegram-backlog: nothing to surface');
    return { sent: 0, total: 0 };
  }

  // Header so Simon knows this is the backlog, not today's cycle.
  if (deps.sendTelegram) {
    try {
      await deps.sendTelegram(
        `<b>📋 Backlog digest — ${actionable.length} unresolved alert${actionable.length === 1 ? '' : 's'}</b>\n` +
        `Showing up to ${MAX_CARDS_PER_DIGEST}. Tap a button on each card to resolve.`,
      );
    } catch { /* silent */ }
  }

  let sent = 0;
  for (const alert of actionable.slice(0, MAX_CARDS_PER_DIGEST)) {
    const card = buildBacklogCardForAlert(alert);
    if (!card) continue;
    try {
      const sendResult = await deps.sendActionableCard(card.message, card.buttons);
      sent++;
      // Store the Telegram message_id so a reply to this card (with a
      // verified URL) can be matched back to the alert.
      if (sendResult?.messageId) {
        try {
          await supabase.from('pipeline_alerts')
            .update({ telegram_message_id: sendResult.messageId })
            .eq('id', alert.id);
        } catch (err) {
          deps.log?.warn?.('telegram-backlog: message_id store failed', { id: alert.id, err: err.message });
        }
      }
    } catch (err) {
      deps.log?.warn?.('telegram-backlog: card send failed', { id: alert.id, err: err.message });
    }
  }
  deps.log?.info?.(`telegram-backlog: sent ${sent} cards (${actionable.length} actionable, ${data.length} total open)`);
  return { sent, total: actionable.length };
}

/**
 * Build a card for a generic pipeline_alerts row. Pure function — exported
 * so tests can hit it without a real supabase client.
 */
export function buildBacklogCardForAlert(alert) {
  if (!alert?.id) return null;
  const slug = alert.house;
  const displayName = (slug && HOUSE_DISPLAY_NAMES[slug]) || slug || 'system';
  const meta = alert.meta || {};
  const ageDays = Math.floor((Date.now() - new Date(alert.created_at).getTime()) / (24 * 60 * 60 * 1000));
  const ageLabel = ageDays === 0 ? 'today' : `${ageDays}d old`;

  const hasCandidateUrl = !!(meta.to || meta.candidate_url || meta.new_url || meta.newUrl);

  const lines = [
    `<b>${labelForType(alert.event_type)} — ${escapeHtml(displayName)}</b> <i>(${ageLabel})</i>`,
    escapeHtml(truncate(alert.message, 300)),
  ];
  if (slug && URL_FIXABLE_TYPES.has(alert.event_type)) {
    lines.push(VERIFIED_URL_HINT);
  }

  const row1 = [];
  if (hasCandidateUrl) row1.push({ label: '✅ Apply candidate', callback_data: `accept:${alert.id}` });
  if (slug) row1.push({ label: '↻ Re-heal', callback_data: `rerun:${alert.id}` });

  const row2 = [
    { label: '⏸ Snooze 7d', callback_data: `snooze:${alert.id}` },
    { label: '✗ Dismiss', callback_data: `dismiss:${alert.id}` },
  ];

  const buttons = row1.length ? [row1, row2] : [row2];
  return { message: lines.join('\n'), buttons };
}

function labelForType(t) {
  switch (t) {
    case 'house_url_drift_detected':   return '🔀 URL drift';
    case 'house_merger_suspected':     return '🏷 Possible merger';
    case 'house_domain_parked':        return '💀 Parked';
    case 'house_no_longer_auction':    return '❓ No longer auction';
    case 'house_no_catalogue_found':   return '📭 No catalogue';
    case 'house_homepage_unreachable': return '📡 Unreachable';
    case 'healing_failed':             return '⚠ Heal failed';
    default:                           return '⚠ Alert';
  }
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
