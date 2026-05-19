// lib/pipeline/telegram-actions.js
// ═══════════════════════════════════════════════════════════════
// TELEGRAM CALLBACK ACTION DISPATCHER
// ═══════════════════════════════════════════════════════════════
//
// When Simon taps a button on a Telegram card, Telegram POSTs a callback_query
// to routes/telegram-webhook.js, which forwards the callback_data here for
// dispatch. The vocabulary is intentionally small:
//
//   accept:<alertId>   — apply the candidate URL in alert.meta to this house
//   snooze:<alertId>   — resolve the alert + extend the heal cooldown by 7d
//   rerun:<alertId>    — clear cooldown so the next cycle re-heals
//   dismiss:<alertId>  — mark alert resolved (false-positive / handled out-of-band)
//
// Every handler is idempotent: tapping a button twice does not corrupt state.

import { supabase } from '../supabase.js';
import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES } from '../houses.js';
import { normaliseUrl } from '../utils.js';
import { clearHealingCooldown } from './healing.js';

const SNOOZE_DAYS = 7;

/**
 * Parse callback_data and route to the right handler.
 * @returns {Promise<{ok: boolean, summary: string}>}
 */
export async function handleCallbackData(callbackData) {
  if (!callbackData || typeof callbackData !== 'string') {
    return { ok: false, summary: 'invalid callback' };
  }
  const [verb, alertId] = callbackData.split(':');
  if (!verb || !alertId) {
    return { ok: false, summary: 'malformed callback_data' };
  }

  // Load the alert. Without it we can't act safely.
  const alert = await _loadAlert(alertId);
  if (!alert) {
    return { ok: false, summary: `alert ${alertId.slice(0, 8)}… not found` };
  }
  if (alert.resolved) {
    return { ok: true, summary: 'already resolved' };
  }

  switch (verb) {
    case 'accept':  return _accept(alert);
    case 'snooze':  return _snooze(alert);
    case 'rerun':   return _rerun(alert);
    case 'dismiss': return _dismiss(alert);
    default:        return { ok: false, summary: `unknown action "${verb}"` };
  }
}

async function _loadAlert(alertId) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('pipeline_alerts')
      .select('id, event_type, house, message, meta, resolved')
      .eq('id', alertId)
      .maybeSingle();
    if (error) return null;
    return data || null;
  } catch { return null; }
}

async function _resolve(alertId) {
  if (!supabase) return;
  try {
    await supabase.from('pipeline_alerts')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', alertId);
  } catch { /* silent */ }
}

// ── accept: apply candidate URL from meta to HOUSE_ROOTS + auction_calendar ──
async function _accept(alert) {
  const slug = alert.house;
  if (!slug) return { ok: false, summary: 'alert has no house slug' };

  // The candidate URL lives in a few possible meta keys depending on alert type.
  const meta = alert.meta || {};
  const newUrl = meta.to || meta.candidate_url || meta.new_url || meta.newUrl;
  if (!newUrl) {
    return { ok: false, summary: 'no candidate URL on this alert — nothing to apply' };
  }
  const oldUrl = meta.from || meta.old_url || HOUSE_ROOTS[slug] || '';

  // Skip if already applied.
  if (normaliseUrl(newUrl) === normaliseUrl(HOUSE_ROOTS[slug] || '')) {
    await _resolve(alert.id);
    return { ok: true, summary: `already on ${newUrl}` };
  }

  // Update in-memory + calendar (same shape as _commitHeal in healing.js, but
  // we don't import it directly to avoid the cooldown reset coupling).
  HOUSE_ROOTS[slug] = newUrl;
  try {
    await supabase.from('auction_calendar')
      .update({ url: newUrl, updated_at: new Date().toISOString() })
      .eq('house_slug', slug)
      .eq('url', oldUrl);
  } catch { /* silent — calendar entry may not exist */ }

  // Clear any heal cooldown so the next scrape uses the new URL.
  clearHealingCooldown(slug);

  // Record an explicit human-decision alert for audit, then resolve the original.
  try {
    await supabase.from('pipeline_alerts').insert({
      event_type: 'url_accepted_by_human',
      severity: 'info',
      house: slug,
      message: `Simon accepted candidate URL via Telegram: ${oldUrl || '?'} → ${newUrl}`,
      meta: { source_alert: alert.id, old_url: oldUrl, new_url: newUrl },
    });
  } catch { /* silent */ }
  await _resolve(alert.id);

  return { ok: true, summary: `applied → ${HOUSE_DISPLAY_NAMES[slug] || slug}` };
}

// ── snooze: resolve alert + extend healing cooldown by SNOOZE_DAYS ──
async function _snooze(alert) {
  const slug = alert.house;
  const until = new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  if (slug && supabase) {
    try {
      // Touch house_skills so the cooldown is the source of truth even after
      // a process restart. Insert if missing, update if present.
      await supabase.from('house_skills').upsert({
        slug,
        healing_cooldown_until: until,
      }, { onConflict: 'slug' });
    } catch { /* silent */ }
  }
  try {
    await supabase.from('pipeline_alerts').insert({
      event_type: 'snoozed_by_human',
      severity: 'info',
      house: slug,
      message: `Snoozed ${HOUSE_DISPLAY_NAMES[slug] || slug || 'system'} for ${SNOOZE_DAYS} days via Telegram`,
      meta: { source_alert: alert.id, until },
    });
  } catch { /* silent */ }
  await _resolve(alert.id);
  return { ok: true, summary: `snoozed ${SNOOZE_DAYS}d` };
}

// ── rerun: clear cooldown so the next cron tick re-heals this house ──
async function _rerun(alert) {
  const slug = alert.house;
  if (!slug) return { ok: false, summary: 'alert has no house slug' };
  clearHealingCooldown(slug);
  if (supabase) {
    try {
      await supabase.from('house_skills').update({
        healing_cooldown_until: null,
        healing_attempts: 0,
      }).eq('slug', slug);
    } catch { /* silent */ }
  }
  await _resolve(alert.id);
  return { ok: true, summary: `cooldown cleared — next cycle will re-heal` };
}

// ── dismiss: mark resolved with no other side effects ──
async function _dismiss(alert) {
  await _resolve(alert.id);
  return { ok: true, summary: 'dismissed' };
}

// Internal exports for tests.
export const _internal = { _accept, _snooze, _rerun, _dismiss, _loadAlert };
