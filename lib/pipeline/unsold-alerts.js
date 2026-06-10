// lib/pipeline/unsold-alerts.js — Unsold-lot alert emails.
//
// Extracted from routes/auth.js (2026-06-10 tidy): POST /api/cron/unsold-alerts
// was fully built but nothing ever called it — no external cron existed and the
// endpoint waited forever. The cycle now runs from scheduleTick (Tier 19, daily
// 08:10 UK, worker role); the route remains as a manual admin trigger that
// delegates here.
//
// Query shape (refactored 2026-04-30, review item #12): one alerts query
// (capped, frequency-gated in SQL), one users query, one lots query, then
// per-alert in-memory filter + email send.
//
// supabase is injected (same pattern as saved-search-alerts.js) so tests can
// stub it without lib/supabase.js's env validation at import time.

import { log } from '../logging.js';
import { escHtml } from '../utils.js';
import { abEmailWrap, abCtaButton } from '../email.js';
import { LOTS_SELECT, dbRowToLot } from '../types/lot.js';

export async function runUnsoldAlertsCycle(supabase, { now = new Date(), fetchFn = fetch } = {}) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { sent: 0, total: 0, skipped: 'RESEND_API_KEY not configured' };

  const todayStr = now.toISOString().slice(0, 10);
  const dailyCutoffIso = new Date(now.getTime() - 23 * 3600000).toISOString();
  const weeklyCutoffIso = new Date(now.getTime() - 156 * 3600000).toISOString();

  // ── Batch 1: alerts that are actually due ──
  // SQL filter: never sent OR (daily + > 23h ago) OR (weekly + > 156h ago).
  // Cap at 500 — loose-fitting until the subscriber base grows significantly;
  // if we ever hit it, the rest wait for the next cycle.
  const { data: alerts, error: alertsErr } = await supabase
    .from('unsold_alerts')
    .select('id, user_id, filters, frequency, last_sent_at')
    .eq('active', true)
    .or(`last_sent_at.is.null,and(frequency.eq.daily,last_sent_at.lt.${dailyCutoffIso}),and(frequency.eq.weekly,last_sent_at.lt.${weeklyCutoffIso})`)
    .limit(500);

  if (alertsErr) {
    log.error('Unsold alerts query error', { error: alertsErr.message });
    throw new Error('Failed to fetch alerts');
  }
  if (!alerts || alerts.length === 0) return { sent: 0, total: 0 };

  // ── Batch 2: all users for those alerts in ONE query ──
  const userIds = [...new Set(alerts.map(a => a.user_id).filter(Boolean))];
  const { data: userRows } = await supabase
    .from('users')
    .select('id, email, name')
    .in('id', userIds);
  const userMap = new Map((userRows || []).map(u => [u.id, u]));

  // ── Batch 3: unsold lots fetched ONCE ──
  const { data: unsoldRows } = await supabase
    .from('lots')
    .select(LOTS_SELECT)
    .or(`status.eq.unsold,and(auction_date.lt.${todayStr},or(status.eq.available,status.is.null))`)
    .limit(1000);
  const allUnsold = (unsoldRows || []).map(dbRowToLot);

  let sent = 0;

  for (const alert of alerts) {
    const user = userMap.get(alert.user_id);
    if (!user?.email) continue;

    // Apply user's saved filters (price, type, location) in-memory.
    const f = alert.filters || {};
    let unsoldLots = allUnsold;
    if (f.minPrice) unsoldLots = unsoldLots.filter(l => l.price >= f.minPrice);
    if (f.maxPrice) unsoldLots = unsoldLots.filter(l => l.price <= f.maxPrice);
    if (f.propType) unsoldLots = unsoldLots.filter(l => l.propType === f.propType);
    if (f.location) unsoldLots = unsoldLots.filter(l => (l.address || '').toLowerCase().includes(f.location.toLowerCase()));

    // Sort by days since auction (most recent first)
    unsoldLots.sort((a, b) => {
      const da = a._auctionDate || '0000', db = b._auctionDate || '0000';
      return db.localeCompare(da);
    });

    // Cap at 20 for the email
    const topLots = unsoldLots.slice(0, 20);
    if (topLots.length === 0) continue;

    // Build email
    const firstName = escHtml((user.name || '').split(' ')[0] || 'there');
    const lotRows = topLots.map(l => {
      const daysSince = l._auctionDate ? Math.floor((now - new Date(l._auctionDate)) / 86400000) : '?';
      const price = l.price ? '£' + l.price.toLocaleString() : 'POA';
      return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px">${escHtml(l.address || 'Address unknown')}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;white-space:nowrap">${price}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;text-align:center">${daysSince}d</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px">${escHtml(l._house || '')}</td>
        </tr>`;
    }).join('');

    const emailHtml = abEmailWrap(`
          <h1 style="font-size:24px;color:#1A1A18;margin:0 0 16px;line-height:1.3;">Unsold Lot Alert</h1>
          <p style="font-size:16px;color:#6B6B65;line-height:1.6;margin:0 0 20px;">Hi ${firstName}, there are <strong>${unsoldLots.length} unsold lots</strong> matching your filters — vendors may accept below-guide offers.</p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <tr style="background:#f5f5f5"><th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">Address</th><th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">Guide</th><th style="padding:8px 12px;text-align:center;font-size:12px;color:#666">Unsold</th><th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">House</th></tr>
            ${lotRows}
          </table>
          ${unsoldLots.length > 20 ? `<p style="font-size:13px;color:#888;margin:0 0 16px">+ ${unsoldLots.length - 20} more — <a href="https://auctions.bridgematch.co.uk/?status=unsold" style="color:#C0392B">view all on AuctionBrain</a></p>` : ''}
          ${abCtaButton('View Unsold Lots &rarr;', 'https://auctions.bridgematch.co.uk/?status=unsold')}
          <p style="font-size:11px;color:#6B6B65;text-align:center;margin:16px 0 0">You're receiving this because you subscribed to unsold lot alerts. <a href="https://auctions.bridgematch.co.uk/" style="color:#C0392B">Manage preferences</a></p>`);

    await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'AuctionBrain <hello@auctionbrain.co.uk>',
        to: [user.email],
        subject: `${unsoldLots.length} unsold auction lots — vendors may accept offers`,
        html: emailHtml,
      }),
    });

    await supabase.from('unsold_alerts').update({ last_sent_at: now.toISOString() }).eq('id', alert.id);
    sent++;
  }

  return { sent, total: alerts.length };
}
