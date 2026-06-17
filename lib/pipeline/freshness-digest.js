// ═══════════════════════════════════════════════════════════════
// lib/pipeline/freshness-digest.js — Daily catalogue-freshness digest.
//
// Automates the morning health check the operator was running by hand
// after the 2026-06-11 incident: how much of the active catalogue has
// been re-verified recently, how much is going stale, whether the
// extraction engine actually ran, and how big the post-auction
// reconciliation backlog is. Sent to Telegram (the ops channel) once a
// day from scheduleTick — see server.js (08:00 UK tier).
//
// The point: "lot count" is a misleading health metric (it stays flat by
// design — re-scrapes refresh in place and the prune gates protect
// inventory). The metric that proves the scraper is manufacturing a
// fresh product is the freshness DISTRIBUTION shifting stale → fresh,
// night after night. This digest is that evidence, delivered.
// ═══════════════════════════════════════════════════════════════

import { sendNotification, isConfigured } from '../telegram.js';
import { isSilentScraperFailure } from './liveness.js';
import { HOUSE_DISPLAY_NAMES } from '../houses.js';

const ACTIVE = ['available', 'unsold'];

async function countLots(supabase, mutate) {
  let q = supabase.from('lots').select('id', { count: 'exact', head: true })
    .not('status', 'in', '("sold","withdrawn")');
  q = mutate ? mutate(q) : q;
  const { count, error } = await q;
  if (error) throw new Error(`freshness-digest count failed: ${error.message}`);
  return count || 0;
}

/**
 * Gather the digest numbers. Pure-ish: all I/O through the injected client.
 * @returns {Promise<object>} digest payload (see formatFreshnessDigestForTelegram)
 */
export async function buildFreshnessDigest(supabase) {
  const now = Date.now();
  const iso = (ms) => new Date(now - ms).toISOString();
  const DAY = 24 * 60 * 60 * 1000;
  const today = new Date(now).toISOString().slice(0, 10);

  const [total, fresh1d, fresh7d, fresh14d, newToday] = await Promise.all([
    countLots(supabase),
    countLots(supabase, q => q.gte('last_seen_at', iso(DAY))),
    countLots(supabase, q => q.gte('last_seen_at', iso(7 * DAY))),
    countLots(supabase, q => q.gte('last_seen_at', iso(14 * DAY))),
    countLots(supabase, q => q.gte('first_seen_at', iso(DAY))),
  ]);

  // Post-auction backlog: auction passed but status never confirmed.
  // in-window = the 05:00 sweep's remit (last 30 days); escaped = older,
  // beyond the sweep window (needs a decision, not a sweep).
  const backlogQ = (mutate) => {
    let q = supabase.from('lots').select('id', { count: 'exact', head: true })
      .in('status', ACTIVE).lt('auction_date', today);
    return mutate ? mutate(q) : q;
  };
  const [{ count: backlogInWindow }, { count: backlogEscaped }] = await Promise.all([
    backlogQ(q => q.gte('auction_date', new Date(now - 30 * DAY).toISOString().slice(0, 10))),
    backlogQ(q => q.lt('auction_date', new Date(now - 30 * DAY).toISOString().slice(0, 10))),
  ]);

  // Engine vitals for the last 24h.
  const sinceIso = iso(DAY);
  const [extraction, hallucinations, extractFailures, crawlerRestarts] = await Promise.all([
    supabase.from('ai_usage').select('id', { count: 'exact', head: true })
      .eq('task_type', 'extraction').gte('created_at', sinceIso),
    supabase.from('pipeline_alerts').select('id', { count: 'exact', head: true })
      .eq('event_type', 'ai_hallucination_blocked').gte('created_at', sinceIso),
    supabase.from('pipeline_alerts').select('id', { count: 'exact', head: true })
      .eq('event_type', 'ai_extraction_failure').gte('created_at', sinceIso),
    supabase.from('pipeline_alerts').select('id', { count: 'exact', head: true })
      .eq('event_type', 'crawlee_crawler_restart').gte('created_at', sinceIso),
  ]);

  // Silent scraper failures: houses with a feed (lots persisted from prior runs)
  // whose MOST RECENT scheduled run extracted nothing. This is the metric the
  // old "all clear, N houses healthy" report was blind to — it counted lots in
  // the DB, which persist while the crawler is dead (the 2026-06-17 ghost-lot
  // incident). Driven by the per-run liveness signal in house_skills.
  const { data: skillRows } = await supabase
    .from('house_skills')
    .select('slug, average_lot_count, last_lot_count, last_probe_result, last_full_extract_at');
  const silent = (skillRows || [])
    .filter(isSilentScraperFailure)
    .map(s => ({ slug: s.slug, name: HOUSE_DISPLAY_NAMES[s.slug] || s.slug, lastGood: s.last_full_extract_at || null }));

  return {
    date: today,
    total,
    buckets: {
      fresh1d,
      d1to7: Math.max(0, fresh7d - fresh1d),
      d7to14: Math.max(0, fresh14d - fresh7d),
      stale14plus: Math.max(0, total - fresh14d),
    },
    newToday,
    backlogInWindow: backlogInWindow || 0,
    backlogEscaped: backlogEscaped || 0,
    extractionCalls: extraction.count || 0,
    hallucinationsBlocked: hallucinations.count || 0,
    extractionFailures: extractFailures.count || 0,
    crawlerRestarts: crawlerRestarts.count || 0,
    silentFailures: silent,
  };
}

const pct = (n, total) => total > 0 ? `${Math.round((n / total) * 100)}%` : '0%';

/** Pure formatter — testable without I/O. */
export function formatFreshnessDigestForTelegram(d) {
  const b = d.buckets;
  const lines = [
    `📊 Catalogue freshness — ${d.date}`,
    ``,
    `Active lots: ${d.total.toLocaleString('en-GB')}  (+${d.newToday} new in 24h)`,
    `  ✅ fresh <24h:    ${String(b.fresh1d).padStart(6)}  (${pct(b.fresh1d, d.total)})`,
    `  🟢 1–7 days:      ${String(b.d1to7).padStart(6)}  (${pct(b.d1to7, d.total)})`,
    `  🟠 7–14 days:     ${String(b.d7to14).padStart(6)}  (${pct(b.d7to14, d.total)})`,
    `  🔴 >14 days:      ${String(b.stale14plus).padStart(6)}  (${pct(b.stale14plus, d.total)})`,
    ``,
    `Engine (24h): ${d.extractionCalls} extraction calls` +
      (d.extractionFailures ? `, ⚠️ ${d.extractionFailures} extraction failures` : '') +
      (d.hallucinationsBlocked ? `, 🛡 ${d.hallucinationsBlocked} hallucinations blocked` : '') +
      (d.crawlerRestarts ? `, ♻️ ${d.crawlerRestarts} crawler restarts` : ''),
    `Post-auction backlog: ${d.backlogInWindow} awaiting sweep` +
      (d.backlogEscaped ? `, ⚠️ ${d.backlogEscaped} older than the 30d sweep window` : ''),
  ];
  // Silent scraper failures — the headline this digest used to miss. List the
  // houses whose feed is live but whose last run extracted nothing (dead crawler
  // hiding behind persisted lots), or an explicit all-clear when there are none.
  const silent = d.silentFailures || [];
  lines.push('');
  if (silent.length === 0) {
    lines.push(`✅ Liveness: no silent scraper failures (every house with a feed extracted this run)`);
  } else {
    lines.push(`🛑 Silent scraper failures (${silent.length}) — feed present but last run extracted 0:`);
    for (const s of silent.slice(0, 20)) {
      lines.push(`  • ${s.name}${s.lastGood ? ` (last good extract ${s.lastGood.slice(0, 10)})` : ''}`);
    }
    if (silent.length > 20) lines.push(`  …and ${silent.length - 20} more`);
  }
  return lines.join('\n');
}

/** Build + send. Returns the digest (or null when Telegram unconfigured). */
export async function runFreshnessDigest(supabase) {
  const digest = await buildFreshnessDigest(supabase);
  const text = formatFreshnessDigestForTelegram(digest);
  console.log(`FRESHNESS-DIGEST:\n${text}`);
  if (isConfigured()) await sendNotification(text);
  return digest;
}
