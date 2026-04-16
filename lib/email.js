// lib/email.js — AuctionBrain email helpers (Resend API)
import { log } from './logging.js';
import { supabase } from './supabase.js';
import { HOUSE_ROOTS } from './houses.js';

export function abEmailWrap(body) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F5F1EA;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="margin-bottom:32px;">
      <span style="font-size:22px;font-weight:700;color:#1A1A18;">Auction</span><span style="font-size:22px;font-weight:500;color:#C0392B;font-family:'Courier New',monospace;">Brain</span>
    </div>
    ${body}
    <hr style="border:none;border-top:1px solid #E8E4DC;margin:32px 0 16px;">
    <p style="font-size:12px;color:#6B6B65;margin:0;">
      AuctionBrain &middot; Powered by BridgeMatch<br>
      <a href="https://www.auctionbrain.co.uk" style="color:#C0392B;">www.auctionbrain.co.uk</a>
    </p>
  </div>
</body>
</html>`;
}

export function abTipCard(num, title, text) {
  return `<div style="background:#FFFFFF;border:1px solid #E8E4DC;border-radius:6px;padding:20px;margin:0 0 12px;">
  <span style="font-family:'Courier New',monospace;font-size:20px;color:#C0392B;font-weight:500;">${num}</span>
  <strong style="color:#1A1A18;display:block;margin:8px 0 4px;">${title}</strong>
  <span style="color:#6B6B65;font-size:14px;">${text}</span>
</div>`;
}

export function abCtaButton(text, url = 'https://auctions.bridgematch.co.uk') {
  return `<a href="${url}" style="display:inline-block;background:#C0392B;color:#FFFFFF;font-size:16px;font-weight:600;padding:14px 28px;border-radius:4px;text-decoration:none;">${text}</a>`;
}

export async function sendWelcomeEmail(email, name) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  // 0) Deduplicate — if drip_log already has step 0 for this email, we already sent
  if (supabase) {
    const { data: existing } = await supabase.from('drip_log').select('id').eq('email', email).eq('step', 0).maybeSingle();
    if (existing) { log.info('Welcome email already sent, skipping', { email }); return; }
  }

  // 1) Add contact to Resend audience (same audience as Landing page)
  try {
    const audRes = await fetch('https://api.resend.com/audiences', {
      headers: { 'Authorization': `Bearer ${resendKey}` },
    });
    const audData = await audRes.json();
    const audienceId = audData?.data?.[0]?.id;
    if (audienceId) {
      await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    }
  } catch (e) {
    log.warn('Resend audience add failed', { email, error: e.message });
  }

  // 2) Send welcome email (Landing page style — drip step 0)
  const html = abEmailWrap(`
    <h1 style="font-size:24px;color:#1A1A18;margin:0 0 16px;line-height:1.3;">You're in.</h1>
    <p style="font-size:16px;color:#6B6B65;line-height:1.6;margin:0 0 20px;">
      AuctionBrain searches ${Object.keys(HOUSE_ROOTS).length}+ UK auction houses so you don't have to. Every lot is scored for investment potential, with flood zone, EPC, and bridging finance data baked in.
    </p>
    <p style="font-size:16px;color:#6B6B65;line-height:1.6;margin:0 0 24px;">
      Here are 3 things to try first:
    </p>
    ${abTipCard('01', 'Search your area', 'Type a postcode or town. See every lot within range across all auction houses.')}
    ${abTipCard('02', 'Filter for unsold lots', "These didn't meet reserve — prime for post-auction negotiation at 10-20% below guide.")}
    ${abTipCard('03', 'Check the flood zone', "Flood zone 3 = most lenders won't touch it. We flag it so you don't find out after exchange.")}
    ${abCtaButton('Browse auction lots &rarr;')}
    <p style="font-size:14px;color:#6B6B65;line-height:1.6;margin:24px 0 0;">
      We'll send you a few tips over the next week to help you get the most out of it. No spam.
    </p>`);

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'AuctionBrain <hello@auctionbrain.co.uk>',
        to: [email],
        subject: "You're in — here's how to find auction deals",
        html,
      }),
    });
    log.info('Welcome email sent', { email });
  } catch (e) {
    log.warn('Welcome email failed', { email, error: e.message });
  }

  // 3) Register in email_signups + drip_log so Landing page drip cron sends follow-ups
  if (supabase) {
    await supabase.from('email_signups').insert({ email, source: 'tool' }).then(({ error }) => {
      if (error && error.code !== '23505') log.warn('email_signups insert failed', { error: error.message });
    });
    await supabase.from('drip_log').insert({ email, step: 0 }).then(({ error }) => {
      if (error && error.code !== '23505') log.warn('drip_log insert failed', { error: error.message });
    });
  }
}
