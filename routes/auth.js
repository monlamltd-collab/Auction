// routes/auth.js — Authentication, signup, saved searches, unsold alerts
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { validateUserFromReq, safeCompare, rateLimit, getClientIP } from '../lib/auth.js';
import { log } from '../lib/logging.js';
import { STRIPE_ENABLED } from '../lib/config.js';
import { sendWelcomeEmail } from '../lib/email.js';
import { logActivityEvent } from '../lib/analysis.js';
import { runUnsoldAlertsCycle } from '../lib/pipeline/unsold-alerts.js';

const router = Router();

// POST /api/signup
router.post('/api/signup', rateLimit(60000, 5), async (req, res) => {
  const { email, name } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Valid email required' });

  try {
    const normEmail = email.toLowerCase().trim();
    const { data: existing } = await supabase
      .from('users')
      .select('id, email, name, tier')
      .eq('email', normEmail)
      .single();

    if (existing) {
      await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', existing.id);
      logActivityEvent('signin', {}, existing.email, getClientIP(req));
      // Don't reveal whether user exists — same response shape
      return res.json({ message: 'Check your email for a login link' });
    }

    const { data: newUser, error } = await supabase
      .from('users')
      .insert({ email: normEmail, name: name || null })
      .select('id, email, name, tier')
      .single();

    if (error) throw error;
    sendWelcomeEmail(newUser.email, newUser.name).catch(() => {});
    logActivityEvent('signup', { source: 'web' }, newUser.email, getClientIP(req));
    return res.json({ message: 'Check your email for a login link' });
  } catch (err) {
    log.error('Signup error', { error: err.message });
    return res.status(500).json({ error: 'Signup failed' });
  }
});

// POST /api/auth/consent — record GDPR consent
router.post('/api/auth/consent', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { auction_alerts, partner_marketing } = req.body || {};
  const now = new Date().toISOString();
  const ip = req.ip || req.headers['x-forwarded-for'] || '';
  const ua = req.headers['user-agent'] || '';

  try {
    // Update user consent columns
    const updates = {};
    if (typeof auction_alerts === 'boolean') {
      updates.consent_auction_alerts = auction_alerts;
      updates.consent_auction_alerts_at = now;
    }
    if (typeof partner_marketing === 'boolean') {
      updates.consent_partner_marketing = partner_marketing;
      updates.consent_partner_marketing_at = now;
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('users').update(updates).eq('id', user.id);
    }

    // Append immutable audit log entries
    const logEntries = [];
    if (typeof auction_alerts === 'boolean') {
      logEntries.push({ user_id: user.id, user_email: user.email, consent_type: 'auction_alerts', consent_given: auction_alerts, ip_address: ip, user_agent: ua });
    }
    if (typeof partner_marketing === 'boolean') {
      logEntries.push({ user_id: user.id, user_email: user.email, consent_type: 'partner_marketing', consent_given: partner_marketing, ip_address: ip, user_agent: ua });
    }
    if (logEntries.length > 0) {
      await supabase.from('user_consent_log').insert(logEntries);
    }

    res.json({ ok: true });
  } catch (err) {
    log.error('Consent update error', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to update consent' });
  }
});

// GET /api/auth/me — return current user profile
router.get('/api/auth/me', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  // Allowlist of fields safe to send to the client. Adding a new sensitive
  // column to the SELECT below (e.g. another stripe_*, an internal flag,
  // a server-only setting) is safe because it won't show up in the response
  // unless its name is also added here. Previous denylist pattern silently
  // leaked any new column.
  const PUBLIC_USER_FIELDS = [
    'id', 'email', 'name', 'tier', 'analyses_count', 'tier_expires_at',
    'consent_auction_alerts', 'consent_partner_marketing',
    'onboarding_complete', 'experience_level', 'budget_max', 'interests',
    'preferred_regions', 'preferred_location',
  ];
  function toPublicUser(row) {
    const out = {};
    for (const f of PUBLIC_USER_FIELDS) if (f in row) out[f] = row[f];
    out.hasSubscription = !!row.stripe_subscription_id;
    out.stripeEnabled = STRIPE_ENABLED;
    return out;
  }

  try {
    const { data } = await supabase
      .from('users')
      .select('id, email, name, tier, analyses_count, tier_expires_at, stripe_subscription_id, consent_auction_alerts, consent_partner_marketing, onboarding_complete, experience_level, budget_max, interests, preferred_regions, preferred_location')
      .eq('id', user.id)
      .single();
    res.json(toPublicUser(data || user));
  } catch (err) {
    res.json(toPublicUser(user));
  }
});

// POST /api/auth/onboarding
router.post('/api/auth/onboarding', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { experience_level, budget_max, interests, referral_source, preferred_regions, preferred_location } = req.body || {};
  const updates = { onboarding_complete: true };
  if (typeof experience_level === 'string') updates.experience_level = experience_level;
  if (typeof budget_max === 'number' && budget_max > 0) updates.budget_max = budget_max;
  if (Array.isArray(interests)) updates.interests = interests.slice(0, 10);
  if (typeof referral_source === 'string') updates.referral_source = referral_source.substring(0, 200);
  if (Array.isArray(preferred_regions)) updates.preferred_regions = preferred_regions.slice(0, 12);
  // Preferred investment location — { input: 'Bristol' | 'BS1', radius: 10 }.
  // Applied by the frontend as the default town/postcode + radius filter so
  // the lot list opens scoped to the user's investment area on every device.
  if (preferred_location && typeof preferred_location === 'object') {
    const input = typeof preferred_location.input === 'string' ? preferred_location.input.trim().substring(0, 80) : '';
    const radius = Number.isFinite(+preferred_location.radius) && +preferred_location.radius > 0
      ? Math.min(+preferred_location.radius, 200) : null;
    updates.preferred_location = input ? { input, radius } : null;
  }

  try {
    await supabase.from('users').update(updates).eq('id', user.id);
    res.json({ ok: true });
  } catch (err) {
    log.error('Onboarding save error', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to save onboarding' });
  }
});

// ═══════════════════════════════════════════════════════════════
// SAVED SEARCHES
// ═══════════════════════════════════════════════════════════════
router.get('/api/searches', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { data, error } = await supabase
      .from('saved_searches')
      .select('id, name, filters, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json({ searches: data || [] });
  } catch (err) {
    log.error('Load saved searches error', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to load saved searches' });
  }
});

router.post('/api/searches', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { name, filters } = req.body || {};
  if (!name || typeof name !== 'string' || name.length > 100) return res.status(400).json({ error: 'Name required (max 100 chars)' });
  if (!filters || typeof filters !== 'object') return res.status(400).json({ error: 'Filters required' });

  try {
    // Cap at 10 saved searches per user
    const { count, error: countErr } = await supabase.from('saved_searches').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
    if (countErr) { log.error('Saved search count error', { error: countErr.message }); return res.status(500).json({ error: 'Failed to check search limit' }); }
    if (count >= 10) return res.status(400).json({ error: 'Maximum 10 saved searches. Delete one first.' });

    const { data, error } = await supabase
      .from('saved_searches')
      .insert({ user_id: user.id, name: name.trim(), filters })
      .select('id, name, filters, created_at')
      .single();
    if (error) throw error;
    res.json({ search: data });
  } catch (err) {
    log.error('Save search error', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to save search' });
  }
});

router.delete('/api/searches/:id', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { error } = await supabase
      .from('saved_searches')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    log.error('Delete search error', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to delete search' });
  }
});

// PATCH /api/searches/:id — toggle email alerts on/off for a saved
// search. Pro-tier-gated server-side: free users get 403 even if their
// client somehow surfaces the toggle. Single mutation surface — only
// notify_email is editable here.
router.patch('/api/searches/:id', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (user.tier !== 'premium') {
    return res.status(403).json({ error: 'Email alerts are a Pro feature', upgrade_required: true });
  }

  const { notify_email } = req.body || {};
  if (typeof notify_email !== 'boolean') {
    return res.status(400).json({ error: 'notify_email (boolean) required' });
  }

  try {
    const { data, error } = await supabase
      .from('saved_searches')
      .update({ notify_email })
      .eq('id', req.params.id)
      .eq('user_id', user.id)
      .select('id, notify_email')
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Saved search not found' });
    res.json({ search: data });
  } catch (err) {
    log.error('Patch saved search error', { error: err.message, userId: user.id, searchId: req.params.id });
    res.status(500).json({ error: 'Failed to update saved search' });
  }
});

// ═══════════════════════════════════════════════════════════════
// UNSOLD LOT ALERTS
// ═══════════════════════════════════════════════════════════════
router.get('/api/alerts/unsold', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { data } = await supabase
      .from('unsold_alerts')
      .select('id, filters, frequency, active, created_at')
      .eq('user_id', user.id)
      .single();
    res.json({ alert: data || null });
  } catch (err) {
    res.json({ alert: null });
  }
});

router.post('/api/alerts/unsold', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { filters, frequency, active } = req.body || {};
  const freq = ['daily', 'weekly'].includes(frequency) ? frequency : 'daily';

  try {
    const { data, error } = await supabase
      .from('unsold_alerts')
      .upsert({
        user_id: user.id,
        filters: filters || {},
        frequency: freq,
        active: active !== false,
      }, { onConflict: 'user_id' })
      .select('id, filters, frequency, active, created_at')
      .single();
    if (error) throw error;
    res.json({ alert: data });
  } catch (err) {
    log.error('Unsold alert save error', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to save alert' });
  }
});

// ── CRON: Send unsold lot alert emails ──
// Refactored 2026-04-30 (review item #12): the previous handler had three
// N+1 layers — N user fetches, N identical 1000-row lot queries, and an
// uncapped outer alerts query. Plus the SQL had no frequency gate, so
// expired-but-not-yet-due alerts were scanned every run and skipped in JS.
// Now: one alerts query (capped, frequency-gated), one users query, one
// lots query, then per-alert in-memory filter + email send. Same email
// output, dramatically less DB work.
router.post('/api/cron/unsold-alerts', rateLimit(60000, 1), async (req, res) => {
  // Header-only auth (was: also `req.body?.secret`, which leaked the secret
  // into request loggers — same fix as the #6 batch).
  const secret = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(secret, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Sender extracted to lib/pipeline/unsold-alerts.js (2026-06-10) and run
  // daily from scheduleTick Tier 19 — this route stays as a manual trigger.
  try {
    const result = await runUnsoldAlertsCycle(supabase);
    res.json(result);
  } catch (err) {
    log.error('Unsold alerts cron error', { error: err.message });
    res.status(500).json({ error: 'Cron failed', message: err.message });
  }
});

export default router;
