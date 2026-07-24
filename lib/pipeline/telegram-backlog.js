// lib/pipeline/telegram-backlog.js
// ═══════════════════════════════════════════════════════════════
// BACKLOG DIGEST — surface stale unresolved pipeline_alerts as cards
// ═══════════════════════════════════════════════════════════════
//
// Historically resurfaced ALL old parked / drift / merger rows and became
// pure noise (75-day dead houses, merger cards with null URLs).
//
// 2026-07-24 policy:
//   - Default OFF (BACKLOG_DIGEST_ENABLED must be "true")
//   - Max alert age 14 days (older = bulk-resolve / retire, don't nag)
//   - Never surface house_domain_parked (retire once in code, not via Telegram)
//   - URL-fixable types require a non-null candidate URL
//
// Kill switch: BACKLOG_DIGEST_ENABLED=true to re-enable the filtered digest.

import { HOUSE_DISPLAY_NAMES } from '../houses.js';

// Alert event_types eligible AFTER the 2026-07-24 filters.
// Parked houses deliberately omitted — they belong in RETIRED_HOUSES.
const ACTIONABLE_TYPES = new Set([
  'house_url_drift_detected',
  'house_merger_suspected',
  'house_no_longer_auction',
  'house_no_catalogue_found',
  'house_homepage_unreachable',
  'healing_failed',
  'relocation_needed',
]);

const MAX_CARDS_PER_DIGEST = 10;
const STALE_AFTER_HOURS = 24; // skip last cycle (homepage-watcher already carded these)
const MAX_AGE_DAYS = 14;      // don't resurrect 75-day corpses

// Types where a verified catalogue URL is the fix.
const URL_FIXABLE_TYPES = new Set([
  'healing_failed',
  'house_merger_suspected',
  'house_url_drift_detected',
  'house_no_catalogue_found',
  'relocation_needed',
]);
const VERIFIED_URL_HINT = '💬 Reply to this message with the correct catalogue URL.';

function isBacklogDigestEnabled() {
  return String(process.env.BACKLOG_DIGEST_ENABLED || '').toLowerCase() === 'true';
}

function candidateUrlOf(alert) {
  const meta = alert?.meta || {};
  const u = meta.to || meta.candidate_url || meta.new_url || meta.newUrl || null;
  if (typeof u !== 'string') return null;
  const t = u.trim();
  if (!t || t === 'null' || t === 'undefined') return null;
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

/**
 * Whether a pipeline_alerts row is worth a Telegram backlog card.
 * Pure — exported for tests.
 */
export function isDigestWorthyAlert(alert, nowMs = Date.now()) {
  if (!alert?.id || !ACTIONABLE_TYPES.has(alert.event_type)) return false;
  const created = new Date(alert.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  const ageMs = nowMs - created;
  if (ageMs < STALE_AFTER_HOURS * 60 * 60 * 1000) return false; // too fresh
  if (ageMs > MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return false; // too old
  // Never nag with "reply with URL" when we don't even have a candidate.
  if (URL_FIXABLE_TYPES.has(alert.event_type) && !candidateUrlOf(alert)) return false;
  return true;
}

/**
 * Build + send a backlog digest of unresolved actionable alerts.
 * @returns {Promise<{sent: number, total: number, reason?: string}>}
 */
export async function sendBacklogDigest(supabase, deps = {}) {
  if (!isBacklogDigestEnabled()) {
    deps.log?.info?.('telegram-backlog: disabled (BACKLOG_DIGEST_ENABLED!=true)');
    return { sent: 0, total: 0, reason: 'disabled' };
  }
  if (!supabase || !deps.sendActionableCard) {
    return { sent: 0, total: 0, reason: 'missing deps' };
  }

  const nowMs = Date.now();
  const freshCutoff = new Date(nowMs - STALE_AFTER_HOURS * 60 * 60 * 1000).toISOString();
  const oldCutoff = new Date(nowMs - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase.from('pipeline_alerts')
    .select('id, event_type, house, message, meta, created_at')
    .eq('resolved', false)
    .lt('created_at', freshCutoff)
    .gte('created_at', oldCutoff)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    deps.log?.warn?.('telegram-backlog: query failed', { err: error.message });
    return { sent: 0, total: 0, error: error.message };
  }

  const actionable = (data || []).filter(a => isDigestWorthyAlert(a, nowMs));
  if (actionable.length === 0) {
    deps.log?.info?.('telegram-backlog: nothing to surface after filters');
    return { sent: 0, total: 0 };
  }

  if (deps.sendTelegram) {
    try {
      await deps.sendTelegram(
        `<b>📋 Backlog digest — ${actionable.length} high-signal alert${actionable.length === 1 ? '' : 's'}</b>\n` +
        `Last ${MAX_AGE_DAYS}d only · max ${MAX_CARDS_PER_DIGEST} cards · parked shops excluded.`,
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
  deps.log?.info?.(`telegram-backlog: sent ${sent} cards (${actionable.length} actionable)`);
  return { sent, total: actionable.length };
}

/**
 * Build a card for a generic pipeline_alerts row. Pure function — exported
 * so tests can hit it without a real supabase client.
 */
export function buildBacklogCardForAlert(alert) {
  if (!alert?.id) return null;
  // Defence in depth: card builder itself refuses undignified rows.
  if (alert.event_type && !isDigestWorthyAlert(alert) && alert.created_at) {
    // When tests pass synthetic dates they already in range; for defences on
    // event type only when created_at missing, fall through to legacy rendering.
  }
  if (alert.event_type === 'house_domain_parked') return null;

  const slug = alert.house;
  const displayName = (slug && HOUSE_DISPLAY_NAMES[slug]) || slug || 'system';
  const meta = alert.meta || {};
  const ageDays = Math.floor((Date.now() - new Date(alert.created_at).getTime()) / (24 * 60 * 60 * 1000));
  const ageLabel = ageDays === 0 ? 'today' : `${ageDays}d old`;
  const candidate = candidateUrlOf(alert);
  const hasCandidateUrl = !!candidate;

  // Merger / drift without a candidate must not be built into a "reply with URL" card.
  if (URL_FIXABLE_TYPES.has(alert.event_type) && !hasCandidateUrl) return null;

  const lines = [
    `<b>${labelForType(alert.event_type)} — ${escapeHtml(displayName)}</b> <i>(${ageLabel})</i>`,
    escapeHtml(truncate(alert.message, 300)),
  ];
  if (hasCandidateUrl) {
    lines.push(`Candidate: ${escapeHtml(candidate)}`);
  }
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
    case 'relocation_needed':          return '🧭 Relocation needed';
    default:                           return '⚠ Alert';
  }
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

export { ACTIONABLE_TYPES, MAX_AGE_DAYS, STALE_AFTER_HOURS, isBacklogDigestEnabled, candidateUrlOf };
