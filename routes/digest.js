// routes/digest.js — Email-only weekly digest (Milestone 6)
//
// POST /api/digest/subscribe       — accept email, opt them in
// GET  /api/digest/unsubscribe     — token-gated one-click unsub
//
// Both routes are public (no auth). Subscribe is rate-limited to deter
// abuse; unsubscribe is rate-limited too because the token is essentially
// the auth and a tight quota mitigates blanket-scraping attempts.
//
// On a successful subscribe:
//   - Inserts (or updates) an email_signups row with digest_optin = TRUE
//   - Generates a fresh unsubscribe_token if one doesn't exist
//   - Returns 200 with a generic success body — we don't reveal whether
//     the address was already in the table (avoids enumeration)

import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { rateLimit } from '../lib/auth.js';
import { log } from '../lib/logging.js';
import { escHtml } from '../lib/utils.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

router.post('/api/digest/subscribe', rateLimit(60000, 6), async (req, res) => {
  const rawEmail = (req.body && typeof req.body.email === 'string') ? req.body.email : '';
  const email = rawEmail.toLowerCase().trim();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  // cadence=daily opts the subscriber into the curator daily digest;
  // anything else (or absent) keeps the original Monday weekly behaviour.
  const cadence = (req.body && typeof req.body.cadence === 'string') ? req.body.cadence.toLowerCase() : 'weekly';
  const isDaily = cadence === 'daily';
  const sourceTag = (req.body && typeof req.body.source === 'string') ? req.body.source.slice(0, 32) : (isDaily ? 'curator_widget' : 'digest');

  const optColumn = isDaily ? 'daily_digest_optin' : 'digest_optin';
  const successMessage = isDaily
    ? "Thanks — you'll get tomorrow's top 8 lots in your inbox at noon."
    : 'Thanks — first digest will be on its way Monday.';

  try {
    // Existence check first — Supabase doesn't support upsert with partial
    // updates on the columns we want to leave alone (e.g. created_at,
    // source for an existing row). One round-trip extra; tiny table.
    const { data: existing, error: selErr } = await supabase
      .from('email_signups')
      .select(`id, digest_optin, daily_digest_optin, unsubscribe_token`)
      .eq('email', email)
      .maybeSingle();

    if (selErr) {
      log.warn('digest.subscribe select failed', { email, err: selErr.message });
      return res.status(500).json({ error: 'Subscription temporarily unavailable' });
    }

    if (existing) {
      if (!existing[optColumn]) {
        const { error: updErr } = await supabase
          .from('email_signups')
          .update({ [optColumn]: true })
          .eq('id', existing.id);
        if (updErr) {
          log.warn('digest.subscribe update failed', { email, cadence, err: updErr.message });
          return res.status(500).json({ error: 'Subscription temporarily unavailable' });
        }
      }
    } else {
      const insertRow = { email, source: sourceTag };
      insertRow[optColumn] = true;
      const { error: insErr } = await supabase
        .from('email_signups')
        .insert(insertRow);
      if (insErr && insErr.code !== '23505') {
        // 23505 = unique-violation; race with another request — treat as success
        log.warn('digest.subscribe insert failed', { email, cadence, err: insErr.message });
        return res.status(500).json({ error: 'Subscription temporarily unavailable' });
      }
    }

    log.info('digest.subscribe ok', { email, cadence });
    return res.json({ ok: true, message: successMessage, cadence });
  } catch (err) {
    log.error('digest.subscribe threw', { email, err: err.message });
    return res.status(500).json({ error: 'Subscription temporarily unavailable' });
  }
});

router.get('/api/digest/unsubscribe', rateLimit(60000, 30), async (req, res) => {
  const token = (req.query && typeof req.query.token === 'string') ? req.query.token : '';
  if (!token || token.length < 10 || token.length > 64) {
    return res.status(400).type('html').send(unsubResponseHtml({ ok: false, msg: 'Invalid unsubscribe link.' }));
  }

  // cadence=daily | weekly | all (default). Lets the daily-digest email's
  // unsubscribe link flip ONLY the daily opt-in (so a subscriber on both
  // daily + weekly can drop one without losing the other).
  const cadence = (req.query && typeof req.query.cadence === 'string') ? req.query.cadence.toLowerCase() : 'all';

  try {
    const { data: row, error: selErr } = await supabase
      .from('email_signups')
      .select('id, email, digest_optin, daily_digest_optin')
      .eq('unsubscribe_token', token)
      .maybeSingle();

    if (selErr) {
      log.warn('digest.unsubscribe select failed', { err: selErr.message });
      return res.status(500).type('html').send(unsubResponseHtml({ ok: false, msg: 'Try again in a moment.' }));
    }

    if (!row) {
      // Don't reveal whether the token existed — show success to make scraping pointless.
      return res.type('html').send(unsubResponseHtml({ ok: true, msg: "You're unsubscribed." }));
    }

    const update = {};
    if (cadence === 'daily') {
      if (row.daily_digest_optin) update.daily_digest_optin = false;
    } else if (cadence === 'weekly') {
      if (row.digest_optin) update.digest_optin = false;
    } else {
      if (row.digest_optin) update.digest_optin = false;
      if (row.daily_digest_optin) update.daily_digest_optin = false;
    }

    if (Object.keys(update).length > 0) {
      const { error: updErr } = await supabase
        .from('email_signups')
        .update(update)
        .eq('id', row.id);
      if (updErr) {
        log.warn('digest.unsubscribe update failed', { err: updErr.message });
        return res.status(500).type('html').send(unsubResponseHtml({ ok: false, msg: 'Try again in a moment.' }));
      }
    }

    log.info('digest.unsubscribe ok', { email: row.email, cadence });
    const msg = cadence === 'daily'
      ? "You're unsubscribed from the daily digest."
      : cadence === 'weekly'
        ? "You're unsubscribed from the weekly digest."
        : "You're unsubscribed. Sorry to see you go.";
    return res.type('html').send(unsubResponseHtml({ ok: true, msg }));
  } catch (err) {
    log.error('digest.unsubscribe threw', { err: err.message });
    return res.status(500).type('html').send(unsubResponseHtml({ ok: false, msg: 'Try again in a moment.' }));
  }
});

function unsubResponseHtml({ ok, msg }) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ok ? 'Unsubscribed' : 'Unsubscribe failed'} — Auction Brain</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/public/styles.css">
</head><body style="background:#f5f7fa;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">
<main style="background:#fff;max-width:460px;padding:36px 30px;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.08);text-align:center;font-family:system-ui,-apple-system,sans-serif">
<div style="font-size:2rem;margin-bottom:12px">${ok ? '✓' : '✗'}</div>
<h1 style="font-size:1.4rem;margin:0 0 8px;color:#1a2332">${escHtml(msg)}</h1>
<p style="color:#6b7c8d;font-size:.9rem;margin:0 0 24px;line-height:1.5">${ok
    ? "We won't send any more weekly digests. You can resubscribe anytime from the home page."
    : "Something went wrong. Try clicking the link from your email again, or just delete future digests."}</p>
<a href="/" style="display:inline-block;padding:12px 22px;background:#c0392b;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">← Back to Auction Brain</a>
</main></body></html>`;
}

export default router;
