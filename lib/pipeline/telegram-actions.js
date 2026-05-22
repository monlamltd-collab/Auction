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
//
// A second inbound path handles a REPLY to one of those cards: Simon replies
// with a human-verified catalogue URL (handleVerifiedUrlReply), which is
// matched to its alert via the replied-to message_id and applied — as the
// house's catalogue URL, or as a merger when the URL belongs to a house we
// already track.

import { supabase } from '../supabase.js';
import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES, detectAuctionHouse } from '../houses.js';
import { normaliseUrl } from '../utils.js';
import { validateUrl } from '../security.js';
import { clearHealingCooldown, _commitMerger } from './healing.js';

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

// ═══════════════════════════════════════════════════════════════
// VERIFIED-URL REPLY — apply a human-supplied catalogue URL
// ═══════════════════════════════════════════════════════════════
//
// When Simon replies to a heal-failed / possible-merger card with a URL,
// routes/telegram-webhook.js forwards it here. The URL is validated, matched
// to its alert via the replied-to message_id, then applied: as the house's
// catalogue URL, or — if the URL belongs to a house we already track — as a
// merger.

/**
 * Pull the first http(s) URL out of a free-text Telegram reply. Trailing
 * sentence punctuation is stripped. Returns the URL string, or null.
 */
export function extractUrl(text) {
  const m = String(text || '').match(/https?:\/\/\S+/i);
  if (!m) return null;
  const url = m[0].replace(/[.,;:!?)\]]+$/, '').trim();
  return url || null;
}

/**
 * Pure decision: is a verified URL a catalogue fix for `currentSlug`, or does
 * it belong to a different house we already track (→ merger)?
 *
 * detectAuctionHouse returns the sentinel 'unknown' when nothing matches. A
 * merger only applies when the URL resolves to a *different house we already
 * track* (has a HOUSE_ROOTS entry) — otherwise it is just this house's own
 * catalogue URL, possibly on a new domain.
 * @returns {{kind: 'catalogue'} | {kind: 'merger', parentSlug: string}}
 */
export function classifyVerifiedUrl(url, currentSlug) {
  const resolved = detectAuctionHouse(url);
  if (resolved && resolved !== 'unknown' && resolved !== currentSlug && HOUSE_ROOTS[resolved]) {
    return { kind: 'merger', parentSlug: resolved };
  }
  return { kind: 'catalogue' };
}

/**
 * Handle an inbound Telegram message that replies to an alert card with a
 * human-verified catalogue URL.
 * @param {{ replyToMessageId: number, text: string }} input
 * @returns {Promise<{ok: boolean, summary: string, rescrape?: {slug: string, url: string}}>}
 */
export async function handleVerifiedUrlReply({ replyToMessageId, text } = {}) {
  const url = extractUrl(text);
  if (!url) {
    return { ok: false, summary: "that doesn't look like a URL — reply with the full https://… catalogue link" };
  }

  const check = await validateUrl(url);
  if (!check.ok) {
    return { ok: false, summary: `that URL was rejected (${check.error})` };
  }

  const alert = await _loadAlertByMessageId(replyToMessageId);
  if (!alert) {
    return { ok: false, summary: "couldn't match that to an alert — reply directly to a heal-failed or possible-merger card" };
  }
  if (alert.resolved) {
    return { ok: true, summary: 'that alert is already resolved' };
  }

  return applyVerifiedUrl(alert, check.url);
}

/**
 * Apply a verified URL to the house behind `alert`. If the URL resolves to a
 * different tracked house it is committed as a merger; otherwise it becomes
 * the house's catalogue URL and is queued for a verification re-scrape.
 */
export async function applyVerifiedUrl(alert, url) {
  const slug = alert.house;
  if (!slug) return { ok: false, summary: 'that alert has no house attached — cannot apply a URL' };

  const decision = classifyVerifiedUrl(url, slug);
  if (decision.kind === 'merger') {
    return _applyAsMerger(alert, slug, decision.parentSlug, url);
  }
  return _applyAsCatalogue(alert, slug, url);
}

// ── Load the alert a Telegram card belongs to, by its message_id ──
async function _loadAlertByMessageId(messageId) {
  if (!supabase || !messageId) return null;
  try {
    const { data } = await supabase
      .from('pipeline_alerts')
      .select('id, event_type, house, message, meta, resolved, telegram_message_id')
      .eq('telegram_message_id', messageId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data || null;
  } catch { return null; }
}

// ── Apply the URL as the house's catalogue URL (the heal case) ──
async function _applyAsCatalogue(alert, slug, url) {
  const displayName = HOUSE_DISPLAY_NAMES[slug] || slug;
  const meta = alert.meta || {};
  const oldUrl = meta.from || meta.old_url || meta.candidate_url || HOUSE_ROOTS[slug] || '';

  // No-op if the house is already pointed at this URL.
  if (normaliseUrl(url) === normaliseUrl(HOUSE_ROOTS[slug] || '')) {
    await _resolve(alert.id);
    return { ok: true, summary: `${displayName} is already pointed at that URL` };
  }

  // Point the in-memory registry + the persistent calendar at the new URL.
  HOUSE_ROOTS[slug] = url;
  await _writeCalendarUrl(slug, oldUrl, url);

  // Reset heal + adaptive-backoff state so the harness scrapes the house
  // promptly instead of skipping it on a stale cooldown.
  clearHealingCooldown(slug);
  try {
    await supabase.from('house_skills').update({
      healing_cooldown_until: null,
      healing_attempts: 0,
      next_scrape_at: null,
    }).eq('slug', slug);
  } catch { /* silent — house_skills row may not exist yet */ }

  // Audit trail, then resolve the alert that prompted this.
  try {
    await supabase.from('pipeline_alerts').insert({
      event_type: 'url_accepted_by_human',
      severity: 'info',
      house: slug,
      message: `Verified catalogue URL supplied via Telegram reply: ${oldUrl || '?'} → ${url}`,
      meta: { source_alert: alert.id, old_url: oldUrl, new_url: url, via: 'telegram_reply' },
    });
  } catch { /* silent */ }
  await _resolve(alert.id);

  return {
    ok: true,
    summary: `applied to ${displayName} — re-scraping to verify`,
    rescrape: { slug, url },
  };
}

// ── Apply the URL as a merger: the URL belongs to a tracked sibling ──
async function _applyAsMerger(alert, slug, parentSlug, url) {
  const fromName = HOUSE_DISPLAY_NAMES[slug] || slug;
  const intoName = HOUSE_DISPLAY_NAMES[parentSlug] || parentSlug;
  // _commitMerger deprecates the slug in-memory, marks its calendar rows
  // 'merged', and files a house_merged alert for the permanent code change.
  await _commitMerger(slug, parentSlug, url, `Human-verified via Telegram reply: ${url}`);
  await _resolve(alert.id);
  return {
    ok: true,
    summary: `treated as a merger — ${fromName} → ${intoName}; '${slug}' deprecated, lots now flow via '${parentSlug}'`,
  };
}

// ── Point the house's auction_calendar row at newUrl (update-or-insert) ──
// Mirrors _commitHeal in healing.js: updates the row whose url matches
// oldUrl; if nothing matches, inserts a fresh catalogue row.
async function _writeCalendarUrl(slug, oldUrl, newUrl) {
  try {
    const { data } = await supabase.from('auction_calendar')
      .update({ url: newUrl, updated_at: new Date().toISOString() })
      .eq('house_slug', slug)
      .eq('url', oldUrl)
      .select('id');
    if (data && data.length) return;
  } catch { /* fall through to insert */ }
  try {
    await supabase.from('auction_calendar').insert({
      house: HOUSE_DISPLAY_NAMES[slug] || slug,
      house_slug: slug,
      logo: '🔨',
      date: new Date().toISOString().split('T')[0],
      title: 'Current Catalogue',
      url: newUrl,
      location: 'Online',
      type: 'Residential & Commercial',
      status: 'upcoming',
      catalogue_ready: true,
      updated_at: new Date().toISOString(),
    });
  } catch { /* silent — calendar write is best-effort */ }
}

// Internal exports for tests.
export const _internal = {
  _accept, _snooze, _rerun, _dismiss, _loadAlert,
  _loadAlertByMessageId, _applyAsCatalogue, _applyAsMerger, _writeCalendarUrl,
};
