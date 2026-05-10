// ═══════════════════════════════════════════════════════════════
// DAILY CURATOR DIGEST
// ═══════════════════════════════════════════════════════════════
// Bolt-on to the curator pipeline. Reads today's APPROVED curator_picks
// and sends one email per subscriber with daily_digest_optin = true.
//
// Distinct from the weekly digest (lib/pipeline/weekly-digest.js):
//   - Daily cadence — runs at 09:00 UK every day
//   - Uses curator prose (analytical paragraph per lot, not just metadata)
//   - Different opt-in column (`daily_digest_optin`)
//   - Cooldown: 20h, so a same-day re-trigger doesn't spam
//
// Reuses email_signups.unsubscribe_token (one token, one unsubscribe link
// flips both daily and weekly opt-ins off — no separate token plumbing).

import { getHouseDisplayName } from '../houses.js';
// getApprovedPicksWithLots is lazy-imported inside the cycle runner so that
// importing renderDailyDigestEmail (pure) from a test doesn't drag in
// lib/supabase.js (which throws on empty SUPABASE_URL at module load).

const SITE = 'https://auctions.bridgematch.co.uk';
const COOLDOWN_HOURS = 20;
const MIN_PICKS_TO_SEND = 3;  // Below this, the day is too thin — skip rather than send weak content

// ═══════════════════════════════════════════════════════════════
// Pure email renderer — testable in isolation
// ═══════════════════════════════════════════════════════════════
export function renderDailyDigestEmail({ recipientEmail, unsubscribeToken, picksWithLots, pickDate }) {
  const n = picksWithLots.length;
  const subject = `${n} hand-picked auction lots for today`;
  const dateLabel = formatDateLabel(pickDate);

  const cards = picksWithLots.map(({ pick, lot }) => {
    const displayName = getHouseDisplayName(lot.house, '') || lot.house;
    const price = lot.price ? '£' + Number(lot.price).toLocaleString('en-GB') : (lot.price_text || 'Guide TBA');
    const score = lot.score != null ? Number(lot.score).toFixed(1) : null;
    const url = `${SITE}/lot/${lot.id}?utm_source=curator&utm_medium=email&utm_campaign=daily`;
    const img = lot.image_url
      ? `<img src="${escapeHtml(lot.image_url)}" alt="" style="width:100%;max-width:520px;border-radius:8px;margin:0 0 12px;display:block"/>`
      : '';

    return [
      `<div style="margin:0 0 28px;padding:0 0 28px;border-bottom:1px solid #e4dfd6">`,
      img,
      `<div style="font-family:'Source Serif 4',Georgia,serif;font-size:20px;line-height:1.3;color:#1a2a3a;margin:0 0 6px;font-weight:600">${escapeHtml(pick.headline)}</div>`,
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#6b7c8d;margin:0 0 14px">${escapeHtml(price)} · ${escapeHtml(displayName)}${score ? ` · Score ${score}/10` : ''}</div>`,
      `<p style="font-family:'Source Serif 4',Georgia,serif;font-size:15px;line-height:1.6;color:#2d3748;margin:0 0 16px">${escapeHtml(pick.prose)}</p>`,
      `<a href="${escapeHtml(url)}" style="display:inline-block;font-family:Arial,sans-serif;font-size:14px;font-weight:600;background:#c0392b;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open full analysis →</a>`,
      `</div>`,
    ].join('\n');
  }).join('\n');

  const unsubUrl = `${SITE}/api/digest/unsubscribe?token=${encodeURIComponent(unsubscribeToken || '')}&cadence=daily`;
  const recipientLine = recipientEmail
    ? `Daily curated picks delivered to ${escapeHtml(recipientEmail)}.`
    : `Daily curated picks from AuctionBrain.`;

  const html = [
    `<!doctype html><html><body style="background:#faf8f4;margin:0;padding:24px;font-family:Arial,sans-serif;color:#1a1714">`,
    `<div style="max-width:600px;margin:0 auto;background:#fff;padding:32px 28px;border-radius:12px">`,
    `<div style="font-family:Arial,sans-serif;font-size:18px;font-weight:700;margin:0 0 4px"><span style="color:#1a1714">Auction</span><span style="color:#c0392b">Brain</span></div>`,
    `<h1 style="font-family:'Source Serif 4',Georgia,serif;font-size:24px;line-height:1.3;color:#1a2a3a;margin:18px 0 6px">Today's top auction lots</h1>`,
    `<p style="font-family:Arial,sans-serif;font-size:14px;color:#6b7c8d;margin:0 0 28px">${escapeHtml(dateLabel)} · scored 7+/10 with finance available</p>`,
    cards,
    `<p style="font-family:Arial,sans-serif;font-size:13px;color:#6b7c8d;margin:18px 0 0;line-height:1.5">Algorithmic indication only, not financial advice. Always verify with the legal pack and your broker before bidding.</p>`,
    `<p style="font-family:Arial,sans-serif;font-size:12px;color:#8a847a;margin:24px 0 0">${recipientLine} <a href="${escapeHtml(unsubUrl)}" style="color:#c0392b">Unsubscribe from daily digest</a>.</p>`,
    `</div></body></html>`,
  ].join('\n');

  return { subject, html };
}

// ═══════════════════════════════════════════════════════════════
// Cycle runner — impure orchestration
// ═══════════════════════════════════════════════════════════════
export async function runDailyDigestCycle(supabase, deps = {}) {
  const enabled = (process.env.DAILY_DIGEST_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!enabled) {
    deps.log?.info?.('daily-digest: DAILY_DIGEST_ENABLED=false — skipping');
    return { skipped: true, reason: 'disabled' };
  }

  const nowMs = deps.now ?? Date.now();
  const pickDate = deps.pickDate || todayUk(nowMs);
  const cooldownIso = new Date(nowMs - COOLDOWN_HOURS * 3600 * 1000).toISOString();

  // Pull today's approved picks first — if there are too few, skip ALL sends
  // (we'd rather not send than send a weak digest)
  const { getApprovedPicksWithLots } = await import('../curator/persist.js');
  const picks = await getApprovedPicksWithLots(pickDate);
  if (picks.length < MIN_PICKS_TO_SEND) {
    deps.log?.info?.('daily-digest: too few approved picks — skipping all sends', { pickDate, count: picks.length, min: MIN_PICKS_TO_SEND });
    return { skipped: false, summary: { total: 0, sent: 0, skipped: 0, errors: 0, reason: 'too-few-picks', pickCount: picks.length } };
  }

  // Pull eligible subscribers
  const { data: subscribers, error: sErr } = await supabase
    .from('email_signups')
    .select('id, email, unsubscribe_token, last_daily_digest_sent_at')
    .eq('daily_digest_optin', true)
    .or(`last_daily_digest_sent_at.is.null,last_daily_digest_sent_at.lt.${cooldownIso}`)
    .limit(5000);

  if (sErr) {
    deps.log?.error?.('daily-digest: subscriber fetch failed', { err: sErr.message });
    return { skipped: false, error: sErr.message };
  }
  if (!subscribers || subscribers.length === 0) {
    deps.log?.info?.('daily-digest: no subscribers due');
    return { skipped: false, summary: { total: 0, sent: 0, skipped: 0, errors: 0 } };
  }

  const summary = { total: subscribers.length, sent: 0, skipped: 0, errors: 0 };

  for (const sub of subscribers) {
    if (!sub.email) { summary.skipped++; continue; }

    const { subject, html } = renderDailyDigestEmail({
      recipientEmail: sub.email,
      unsubscribeToken: sub.unsubscribe_token,
      picksWithLots: picks,
      pickDate,
    });

    let sendOk = false;
    try {
      const r = await deps.sendEmail?.({ to: sub.email, subject, html });
      sendOk = !!(r && r.ok !== false);
    } catch (e) {
      deps.log?.warn?.('daily-digest: send failed', { email: sub.email, err: e.message });
    }

    if (sendOk) {
      summary.sent++;
      const { error: updErr } = await supabase
        .from('email_signups')
        .update({ last_daily_digest_sent_at: new Date(nowMs).toISOString() })
        .eq('id', sub.id);
      if (updErr) deps.log?.warn?.('daily-digest: last_daily_digest_sent_at update failed', { id: sub.id, err: updErr.message });
    } else {
      summary.errors++;
    }
  }

  deps.log?.info?.('daily-digest: cycle complete', summary);
  return { skipped: false, summary };
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function todayUk(nowMs) {
  const ukNow = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const y = ukNow.getFullYear();
  const m = String(ukNow.getMonth() + 1).padStart(2, '0');
  const d = String(ukNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateLabel(yyyymmdd) {
  if (!yyyymmdd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return '';
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

// Test-only export
export const _internal = { todayUk, formatDateLabel, escapeHtml, COOLDOWN_HOURS, MIN_PICKS_TO_SEND };
