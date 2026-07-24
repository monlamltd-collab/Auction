// lib/pipeline/alert-sweeper.js — Auto-resolve stale, now-healthy alerts.
//
// pipeline_alerts is append-only by default — alerts pile up forever unless
// something resolves them. The sweeper runs daily and clears alerts that
// satisfy BOTH:
//   1. age >= MIN_AGE_DAYS (default 30 days), AND
//   2. a per-type "now healthy" predicate confirms the underlying problem
//      is no longer in effect.
//
// PLUS a noise sweep (2026-07-24): parked domains, retired houses, ancient
// drift/merger cards, and null-candidate mergers can be resolved without a
// "now healthy" lots check — they were drowning Telegram.

import { RETIRED_HOUSES } from '../houses.js';

const MIN_AGE_DAYS_DEFAULT = 30;
const SCAN_LIMIT = 1000;
const NOISE_MAX_AGE_DAYS = 14;

const HEALTH_PREDICATES = {
  async house_returned_zero_lots(supabase, alert) {
    if (!alert.house) return false;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('lots')
      .select('id', { count: 'exact', head: true })
      .eq('house', alert.house)
      .gte('last_seen_at', since);
    if (error) return false;
    return (count || 0) > 0;
  },

  async zero_lots_after_scrape(supabase, alert) {
    return HEALTH_PREDICATES.house_returned_zero_lots(supabase, alert);
  },

  async firecrawl_extract_regression(supabase, alert) {
    return HEALTH_PREDICATES.house_returned_zero_lots(supabase, alert);
  },

  async extractor_regression(supabase, alert) {
    return HEALTH_PREDICATES.house_returned_zero_lots(supabase, alert);
  },

  async image_coverage_drop(supabase, alert) {
    if (!alert.house) return false;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('lots')
      .select('image_url')
      .eq('house', alert.house)
      .gte('last_seen_at', since)
      .limit(200);
    if (error || !data || data.length === 0) return false;
    const withImg = data.filter(r => r.image_url).length;
    return (withImg / data.length) >= 0.7;
  },

  async firecrawl_budget_threshold(supabase, alert) {
    const ageMs = Date.now() - new Date(alert.created_at).getTime();
    return ageMs > 30 * 24 * 60 * 60 * 1000;
  },

  async hmlr_refresh_failed(supabase, alert) {
    const ageMs = Date.now() - new Date(alert.created_at).getTime();
    return ageMs > 30 * 24 * 60 * 60 * 1000;
  },

  async recall_diagnostic(supabase, alert) {
    return HEALTH_PREDICATES.house_returned_zero_lots(supabase, alert);
  },

  async genuine_zero(supabase, alert) {
    return HEALTH_PREDICATES.house_returned_zero_lots(supabase, alert);
  },
};

/** True when this row is pure noise and safe to dismiss without "healthy" checks. */
export function isNoiseAlertSafeToResolve(alert, nowMs = Date.now()) {
  if (!alert || alert.resolved) return false;
  const type = alert.event_type;
  const house = String(alert.house || '').toLowerCase();
  const ageMs = nowMs - new Date(alert.created_at).getTime();
  if (!Number.isFinite(ageMs)) return false;

  if (house && RETIRED_HOUSES.has(house)) return true;

  if (type === 'house_domain_parked' && ageMs >= NOISE_MAX_AGE_DAYS * 86400000) return true;

  if (['house_url_drift_detected', 'house_merger_suspected', 'house_no_catalogue_found',
    'house_homepage_unreachable', 'house_no_longer_auction', 'relocation_needed',
    'healing_failed', 'healing_abandoned', 'zero_lots_no_heal'].includes(type)
    && ageMs >= NOISE_MAX_AGE_DAYS * 86400000) {
    return true;
  }

  if (type === 'house_merger_suspected' || type === 'house_url_drift_detected') {
    const meta = alert.meta || {};
    const cand = meta.to || meta.candidate_url || meta.new_url || meta.newUrl;
    const has = typeof cand === 'string' && /^https?:\/\//i.test(cand.trim());
    if (!has && ageMs >= 24 * 60 * 60 * 1000) return true;
  }

  return false;
}

export async function sweepStaleAlerts(supabase, opts = {}) {
  const minAgeDays = opts.minAgeDays || MIN_AGE_DAYS_DEFAULT;
  const scanLimit = opts.scanLimit || SCAN_LIMIT;
  const cutoff = new Date(Date.now() - minAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const { data: candidates, error } = await supabase
    .from('pipeline_alerts')
    .select('id, event_type, house, message, created_at, meta, resolved')
    .eq('resolved', false)
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(scanLimit);

  if (error) {
    return { scanned: 0, resolved: [], skippedNoPredicate: 0, skippedNotHealthy: 0, noiseCleared: 0, error: error.message };
  }

  const resolved = [];
  let skippedNoPredicate = 0;
  let skippedNotHealthy = 0;

  for (const alert of candidates || []) {
    const predicate = HEALTH_PREDICATES[alert.event_type];
    if (!predicate) {
      skippedNoPredicate++;
      continue;
    }
    let healthy = false;
    try { healthy = await predicate(supabase, alert); }
    catch (e) {
      console.warn(`alert-sweeper: predicate ${alert.event_type} threw —`, e?.message || e);
      healthy = false;
    }
    if (!healthy) {
      skippedNotHealthy++;
      continue;
    }

    const { error: updateErr } = await supabase
      .from('pipeline_alerts')
      .update({ resolved: true, resolved_at: nowIso })
      .eq('id', alert.id)
      .eq('resolved', false);
    if (updateErr) {
      console.warn(`alert-sweeper: failed to resolve ${alert.id}:`, updateErr.message);
      continue;
    }
    resolved.push({ id: alert.id, event_type: alert.event_type, house: alert.house, predicate: alert.event_type });
    console.info(`alert-sweeper: resolved ${alert.id} (${alert.event_type}, house=${alert.house || '_system'}) — predicate confirmed healthy`);
  }

  let noiseCleared = 0;
  const { data: noiseCandidates, error: nErr } = await supabase
    .from('pipeline_alerts')
    .select('id, event_type, house, message, created_at, meta, resolved')
    .eq('resolved', false)
    .in('event_type', [
      'house_domain_parked',
      'house_url_drift_detected',
      'house_merger_suspected',
      'house_no_catalogue_found',
      'house_homepage_unreachable',
      'house_no_longer_auction',
      'relocation_needed',
      'healing_failed',
      'healing_abandoned',
      'zero_lots_no_heal',
    ])
    .order('created_at', { ascending: true })
    .limit(scanLimit);

  if (!nErr) {
    for (const alert of noiseCandidates || []) {
      if (!isNoiseAlertSafeToResolve(alert)) continue;
      const { error: updateErr } = await supabase
        .from('pipeline_alerts')
        .update({
          resolved: true,
          resolved_at: nowIso,
          meta: {
            ...(alert.meta || {}),
            auto_resolved_reason: 'noise_sweep_2026_07_24',
          },
        })
        .eq('id', alert.id)
        .eq('resolved', false);
      if (!updateErr) {
        noiseCleared++;
        resolved.push({ id: alert.id, event_type: alert.event_type, house: alert.house, predicate: 'noise' });
      }
    }
  }

  return {
    scanned: (candidates?.length || 0) + (noiseCandidates?.length || 0),
    resolved,
    skippedNoPredicate,
    skippedNotHealthy,
    noiseCleared,
  };
}

export { HEALTH_PREDICATES, NOISE_MAX_AGE_DAYS };
