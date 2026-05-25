// lib/pipeline/weekly-digest.js
// ═══════════════════════════════════════════════════════════════
// EMAIL-ONLY WEEKLY DIGEST (Milestone 6)
// ═══════════════════════════════════════════════════════════════
//
// Soft-signup alternative: a visitor drops just an email in the footer
// form and receives one curated email a week — top scored lots from the
// past 7 days, with deep links into /lot/:id pages. No password, no full
// account, no Stripe.
//
// Cron tier 14 in server.js fires this Mondays 09:00 UK. Pure functions
// (selectDigestLots, renderDigestEmail) are above the impure cycle so
// the curation logic can be unit-tested without DB or Resend.

import { dbRowToLot } from '../types/lot.js';

const SITE = 'https://auctions.bridgematch.co.uk';
const DEFAULT_TOP_N = 8;

// ═══════════════════════════════════════════════════════════════
// Pure curator — given a set of recent lots, pick the top N "interesting"
// ones to feature in the digest. Heuristic: score DESC, then by recency
// of last_seen_at. Anything without a score is sorted last (so the
// digest stays high-signal).
// ═══════════════════════════════════════════════════════════════
export function selectDigestLots(lots, { topN = DEFAULT_TOP_N } = {}) {
  if (!Array.isArray(lots)) return [];
  return lots
    .filter(lot => lot && (lot.address || lot.priceText || lot.price))
    .sort((a, b) => {
      const sa = Number.isFinite(a.score) ? a.score : -1;
      const sb = Number.isFinite(b.score) ? b.score : -1;
      if (sb !== sa) return sb - sa;
      // Secondary: most recently seen first
      const ta = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
      const tb = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
      return tb - ta;
    })
    .slice(0, topN);
}

// ═══════════════════════════════════════════════════════════════
// Pure email renderer. Returns { subject, html }. The unsubscribe link
// is pinned to the recipient's token so a one-click unsub works without
// any auth wall — the token IS the auth.
// ═══════════════════════════════════════════════════════════════
export function renderDigestEmail({ recipientEmail, unsubscribeToken, matches, weekLabel }) {
  const n = matches.length;
  const subj = n === 1
    ? `1 fresh auction lot worth a look this week`
    : `${n} fresh auction lots worth a look this week`;
  const subject = subj;

  const cards = matches.map(lot => {
    const price = lot.price ? '£' + Number(lot.price).toLocaleString('en-GB') : (lot.priceText || 'Guide TBA');
    const score = lot.score != null ? ` · Score ${Number(lot.score).toFixed(1)}/10` : '';
    const propType = lot.propType ? ` · ${lot.propType}` : '';
    const url = lot.id ? `${SITE}/lot/${lot.id}` : SITE;
    const img = lot.imageUrl
      ? `<img src="${escapeHtml(lot.imageUrl)}" alt="" style="width:100%;max-width:520px;border-radius:8px;margin:0 0 8px"/>`
      : '';
    const addr = escapeHtml(lot.address || 'Auction lot');
    return [
      `<div style="margin:0 0 24px;padding:0 0 24px;border-bottom:1px solid #e4dfd6">`,
      img,
      `<div style="font-family:'Source Serif 4',Georgia,serif;font-size:18px;color:#1a2a3a;margin:0 0 6px">${addr}</div>`,
      `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f8a5f;font-weight:600;margin:0 0 4px">${escapeHtml(price)}</div>`,
      `<div style="font-family:Arial,sans-serif;font-size:13px;color:#6b7c8d;margin:0 0 12px">${escapeHtml(String(lot._house || '').toUpperCase())}${propType}${score}</div>`,
      `<a href="${escapeHtml(url)}" style="display:inline-block;font-family:Arial,sans-serif;font-size:14px;font-weight:600;background:#c0392b;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none">Open this lot →</a>`,
      `</div>`,
    ].join('\n');
  }).join('\n');

  const unsubUrl = `${SITE}/api/digest/unsubscribe?token=${encodeURIComponent(unsubscribeToken || '')}`;
  const recipientLine = recipientEmail
    ? `You're getting this at ${escapeHtml(recipientEmail)} because you subscribed to the AuctionBrain weekly digest.`
    : `You're getting this because you subscribed to the AuctionBrain weekly digest.`;

  const html = [
    `<!doctype html><html><body style="background:#faf8f4;margin:0;padding:24px;font-family:Arial,sans-serif;color:#1a1714">`,
    `<div style="max-width:560px;margin:0 auto;background:#fff;padding:32px 24px;border-radius:12px">`,
    `<div style="font-family:Arial,sans-serif;font-size:18px;font-weight:700;margin:0 0 4px"><span style="color:#1a1714">Auction</span><span style="color:#c0392b">Brain</span></div>`,
    `<h1 style="font-family:'Source Serif 4',Georgia,serif;font-size:22px;line-height:1.3;color:#1a2a3a;margin:16px 0 8px">This week's top auction lots</h1>`,
    weekLabel ? `<p style="font-family:Arial,sans-serif;font-size:14px;color:#6b7c8d;margin:0 0 24px">${escapeHtml(weekLabel)}</p>` : '',
    cards,
    `<p style="font-family:Arial,sans-serif;font-size:14px;color:#6b7c8d;margin:18px 0 0">Scored by AuctionBrain — algorithmic indication only, not a recommendation.</p>`,
    `<p style="font-family:Arial,sans-serif;font-size:13px;color:#8a847a;margin:28px 0 0">${recipientLine} <a href="${escapeHtml(unsubUrl)}" style="color:#c0392b">Unsubscribe</a>.</p>`,
    `</div></body></html>`,
  ].join('\n');

  return { subject, html };
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════════
// Cycle runner — impure orchestration. deps lets the caller inject the
// email sender so the module stays testable.
//
//   deps.sendEmail({ to, subject, html })  → Promise<{ ok }>
//   deps.log                                 structured logger
//   deps.now                                 ms-since-epoch (test override)
// ═══════════════════════════════════════════════════════════════
const RECENT_DAYS = 7;
const COOLDOWN_DAYS = 5;
const MAX_LOTS_TO_PICK_FROM = 200;
const DIGEST_LOT_FIELDS = 'id, house, lot_number, url, address, postcode, price, price_text, prop_type, beds, status, image_url, score, deal_type, last_seen_at, search_text';

export async function runWeeklyDigestCycle(supabase, deps = {}) {
  const enabled = (process.env.WEEKLY_DIGEST_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!enabled) {
    deps.log?.info?.('weekly-digest: WEEKLY_DIGEST_ENABLED=false — skipping');
    return { skipped: true, reason: 'disabled' };
  }

  const nowMs = deps.now ?? Date.now();
  const cutoff = new Date(nowMs - COOLDOWN_DAYS * 86400000).toISOString();
  const since = new Date(nowMs - RECENT_DAYS * 86400000).toISOString();
  const weekLabel = `Week of ${new Date(nowMs - RECENT_DAYS * 86400000).toUTCString().slice(5, 11).trim()} – ${new Date(nowMs).toUTCString().slice(5, 11).trim()}`;

  // Pull eligible subscribers — opted in AND not sent within the cooldown.
  const { data: subscribers, error: sErr } = await supabase
    .from('email_signups')
    .select('id, email, unsubscribe_token, last_digest_sent_at')
    .eq('digest_optin', true)
    .or(`last_digest_sent_at.is.null,last_digest_sent_at.lt.${cutoff}`)
    .limit(5000);

  if (sErr) {
    deps.log?.error?.('weekly-digest: subscriber fetch failed', { err: sErr.message });
    return { skipped: false, error: sErr.message };
  }
  if (!subscribers || subscribers.length === 0) {
    deps.log?.info?.('weekly-digest: no subscribers due');
    return { skipped: false, summary: { total: 0, sent: 0, skipped: 0, errors: 0 } };
  }

  // Pull candidate lots for the week — score-sorted at the DB so we don't
  // ship the whole catalogue back. Same lot set goes to every subscriber
  // (it's a generic digest, not per-user filtering).
  const { data: lotRows, error: lErr } = await supabase
    .from('lots')
    .select(DIGEST_LOT_FIELDS)
    .gte('last_seen_at', since)
    .neq('status', 'sold')
    .neq('status', 'withdrawn')
    .order('score', { ascending: false, nullsFirst: false })
    .order('last_seen_at', { ascending: false })
    .limit(MAX_LOTS_TO_PICK_FROM);

  if (lErr) {
    deps.log?.error?.('weekly-digest: lots fetch failed', { err: lErr.message });
    return { skipped: false, error: lErr.message };
  }

  const candidateLots = (lotRows || []).map(dbRowToLot);
  const matches = selectDigestLots(candidateLots);

  if (matches.length === 0) {
    deps.log?.info?.('weekly-digest: no candidate lots this week — skipping all sends');
    return { skipped: false, summary: { total: subscribers.length, sent: 0, skipped: subscribers.length, errors: 0, reason: 'no-lots' } };
  }

  const summary = { total: subscribers.length, sent: 0, skipped: 0, errors: 0 };

  for (const sub of subscribers) {
    if (!sub.email) { summary.skipped++; continue; }

    const { subject, html } = renderDigestEmail({
      recipientEmail: sub.email,
      unsubscribeToken: sub.unsubscribe_token,
      matches,
      weekLabel,
    });

    let sendOk = false;
    try {
      const r = await deps.sendEmail?.({ to: sub.email, subject, html });
      sendOk = !!(r && r.ok !== false);
    } catch (e) {
      deps.log?.warn?.('weekly-digest: send failed', { email: sub.email, err: e.message });
    }

    if (sendOk) {
      summary.sent++;
      const { error: updErr } = await supabase
        .from('email_signups')
        .update({ last_digest_sent_at: new Date(nowMs).toISOString() })
        .eq('id', sub.id);
      if (updErr) deps.log?.warn?.('weekly-digest: last_digest_sent_at update failed', { id: sub.id, err: updErr.message });
    } else {
      summary.errors++;
    }
  }

  deps.log?.info?.('weekly-digest: cycle complete', summary);
  return { skipped: false, summary };
}
