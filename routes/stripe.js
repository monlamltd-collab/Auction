// routes/stripe.js — Stripe checkout, webhook, portal, status
import { Router } from 'express';
import Stripe from 'stripe';
import { STRIPE_ENABLED, ALLOWED_ORIGINS, FREE_SCAN_LIMIT, getAISearchLimit } from '../lib/config.js';
import { supabase } from '../lib/supabase.js';
import { validateUserFromReq, safeCompare, rateLimit, invalidateUserCache } from '../lib/auth.js';
import { log } from '../lib/logging.js';
import { escHtml } from '../lib/utils.js';

const stripe = STRIPE_ENABLED && process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const router = Router();

// Webhook event counter for periodic cleanup
let webhookEventCounter = 0;

// GET /api/stripe/diag — check Stripe config
router.get('/diag', (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  if (!STRIPE_ENABLED) return res.status(503).json({ error: 'payments_hibernated' });
  const key = process.env.STRIPE_SECRET_KEY || '';
  const monthlyId = process.env.STRIPE_MONTHLY_PRICE_ID || '';
  const dayPassId = process.env.STRIPE_DAY_PASS_PRICE_ID || '';
  res.json({
    hasStripe: !!stripe,
    keyPrefix: key ? key.slice(0, 8) + '...' : 'MISSING',
    monthlyPriceId: monthlyId ? monthlyId.slice(0, 10) + '...' : 'MISSING',
    dayPassPriceId: dayPassId ? dayPassId.slice(0, 10) + '...' : 'MISSING',
    hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
  });
});

// POST /api/stripe/checkout — create Stripe Checkout session
router.post('/checkout', rateLimit(60000, 5), async (req, res) => {
  if (!STRIPE_ENABLED) return res.status(503).json({ error: 'payments_hibernated' });
  log.info('Stripe checkout requested', { hasStripe: !!stripe, hasKey: !!process.env.STRIPE_SECRET_KEY, hasPriceId: !!process.env.STRIPE_MONTHLY_PRICE_ID });
  if (!stripe) return res.status(503).json({ error: 'Payments not configured — STRIPE_SECRET_KEY missing' });
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { product } = req.body || {};
  log.info('Stripe checkout', { product, userId: user.id, email: user.email, tier: user.tier });
  if (product !== 'monthly' && product !== 'day_pass') {
    return res.status(400).json({ error: 'Invalid product. Use "monthly" or "day_pass".' });
  }
  if (product === 'monthly' && user.stripe_subscription_id) {
    return res.status(400).json({ error: 'You already have an active subscription. Use the billing portal to manage it.' });
  }
  if (product === 'day_pass' && user.tier === 'premium') {
    return res.status(400).json({ error: 'You already have premium access. No need to buy a day pass.' });
  }

  const priceId = product === 'monthly'
    ? process.env.STRIPE_MONTHLY_PRICE_ID
    : process.env.STRIPE_DAY_PASS_PRICE_ID;
  const priceVar = product === 'monthly' ? 'STRIPE_MONTHLY_PRICE_ID' : 'STRIPE_DAY_PASS_PRICE_ID';
  if (!priceId) return res.status(503).json({ error: `Price not configured — ${priceVar} missing in Railway` });

  try {
    // Lazy-create Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } });
      customerId = customer.id;
      await supabase.from('users').update({ stripe_customer_id: customerId }).eq('id', user.id);
    }

    const sessionParams = {
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: product === 'monthly' ? 'subscription' : 'payment',
      success_url: `${ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : 'https://auctions.bridgematch.co.uk'}/?payment=success`,
      cancel_url: `${ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : 'https://auctions.bridgematch.co.uk'}/?payment=cancelled`,
      metadata: { user_id: user.id, product },
      ...(product === 'monthly' && { subscription_data: { metadata: { user_id: user.id, product } } }),
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    log.error('Stripe checkout error', { error: err.message, type: err.type, code: err.code, userId: user.id });
    res.status(500).json({ error: `Failed to create checkout session: ${err.message}` });
  }
});

// POST /api/stripe/webhook — Stripe event handler
router.post('/webhook', async (req, res) => {
  if (!stripe) return res.sendStatus(400);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !webhookSecret) return res.sendStatus(400);

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    log.warn('Stripe webhook signature failed', { error: err.message });
    return res.status(400).send('Webhook signature verification failed');
  }

  // Idempotency: skip already-processed events
  const { data: existingEvent } = await supabase
    .from('processed_webhook_events')
    .select('event_id')
    .eq('event_id', event.id)
    .maybeSingle();

  if (existingEvent) {
    log.info(`Webhook event ${event.id} already processed, skipping`);
    return res.json({ received: true, duplicate: true });
  }

  // When Stripe is hibernated, only process subscription deletions (for cancellation confirmations)
  if (!STRIPE_ENABLED && event.type !== 'customer.subscription.deleted') {
    log.info(`Stripe hibernated — ignoring ${event.type}`);
    return res.json({ received: true, hibernated: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        const product = session.metadata?.product;
        if (!userId) {
          log.warn('checkout.session.completed missing user_id in metadata', { sessionId: session.id, email: session.customer_email });
          break;
        }

        // Record payment
        await supabase.from('payments').insert({
          user_id: userId,
          stripe_session_id: session.id,
          stripe_payment_intent: session.payment_intent || session.subscription,
          product_type: product || 'unknown',
          amount_pence: session.amount_total || 0,
          currency: session.currency || 'gbp',
          status: 'completed',
        });

        if (product === 'day_pass') {
          // 24-hour premium burst — tier_expires_at gates the downgrade
          await supabase.from('users').update({
            tier: 'premium',
            tier_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          }).eq('id', userId);
        } else if (product === 'monthly') {
          // Monthly sub: premium until cancelled
          await supabase.from('users').update({
            tier: 'premium',
            stripe_subscription_id: session.subscription,
            tier_expires_at: null, // managed by subscription lifecycle
          }).eq('id', userId);
        }

        // Bust user cache so the upgraded tier is visible on the next request
        {
          const { data: paidUser } = await supabase.from('users').select('supabase_auth_id').eq('id', userId).single();
          if (paidUser?.supabase_auth_id) invalidateUserCache(paidUser.supabase_auth_id);
        }

        log.info('Payment completed', { userId, product, amount: session.amount_total });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        // Find user by subscription ID
        const { data: subUser } = await supabase
          .from('users')
          .select('id, supabase_auth_id')
          .eq('stripe_subscription_id', sub.id)
          .single();
        if (subUser) {
          const periodEnd = sub.current_period_end
            ? new Date(sub.current_period_end * 1000)
            : null;

          if (periodEnd && periodEnd > new Date()) {
            // Honour paid period — keep premium until current_period_end
            await supabase.from('users').update({
              stripe_subscription_id: null,
              tier_expires_at: periodEnd.toISOString(),
            }).eq('id', subUser.id);
            log.info(`Subscription deleted, premium until ${periodEnd.toISOString()}`, { userId: subUser.id });
          } else {
            // Period already ended, downgrade now
            await supabase.from('users').update({
              tier: 'free',
              stripe_subscription_id: null,
              tier_expires_at: null,
            }).eq('id', subUser.id);
            log.info('Subscription deleted, immediate downgrade', { userId: subUser.id });
          }
          if (subUser.supabase_auth_id) invalidateUserCache(subUser.supabase_auth_id);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const { data: subUser } = await supabase
          .from('users')
          .select('id, supabase_auth_id')
          .eq('stripe_subscription_id', sub.id)
          .single();
        if (!subUser) break;

        if (sub.status === 'active') {
          await supabase.from('users').update({ tier: 'premium', tier_expires_at: null }).eq('id', subUser.id);
        } else if (sub.status === 'canceled') {
          // User cancelled but period hasn't ended — keep premium until period end
          const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
          await supabase.from('users').update({
            tier_expires_at: periodEnd,
          }).eq('id', subUser.id);
          log.info(`Subscription canceled, premium until ${periodEnd}`, { userId: subUser.id });
        } else if (sub.status === 'past_due') {
          // Payment failed — give 3-day grace period before downgrade.
          // Do NOT touch tier or stripe_subscription_id: the user remains premium
          // during the grace window so they aren't kicked mid-session. The
          // subscription_warning field is computed at request time from this
          // tier_expires_at + stripe_subscription_id combination.
          const grace = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
          await supabase.from('users').update({
            tier_expires_at: grace,
          }).eq('id', subUser.id);
          log.warn(`Payment past_due, grace period until ${grace}`, { userId: subUser.id });
        } else if (sub.status === 'unpaid') {
          // All retry attempts failed — immediate downgrade
          await supabase.from('users').update({
            tier: 'free',
            stripe_subscription_id: null,
            tier_expires_at: null,
          }).eq('id', subUser.id);
          log.info('Subscription unpaid, immediate downgrade', { userId: subUser.id });
        }
        // Bust the cache so the next request picks up the new tier/expiry immediately
        if (subUser.supabase_auth_id) invalidateUserCache(subUser.supabase_auth_id);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        log.warn('Invoice payment failed', { customer: invoice.customer, subscription: invoice.subscription });
        // Notify user via email if possible
        if (invoice.customer) {
          const { data: failedUser } = await supabase.from('users').select('email, name').eq('stripe_customer_id', invoice.customer).single();
          if (failedUser?.email && process.env.RESEND_API_KEY) {
            fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: 'AuctionBrain <hello@auctionbrain.co.uk>',
                to: [failedUser.email],
                subject: 'Payment failed — your AuctionBrain Pro subscription',
                html: `<p>Hi ${escHtml((failedUser.name || '').split(' ')[0] || 'there')},</p><p>We couldn't process your latest payment for AuctionBrain Pro. Please update your payment method to keep your subscription active.</p><p><a href="https://auctions.bridgematch.co.uk/?manage=billing">Update payment method</a></p><p>— The AuctionBrain team</p>`,
              }),
            }).catch(e => log.warn('Payment failed email send error', { error: e.message }));
          }
        }
        break;
      }
    }
  } catch (err) {
    log.error('Stripe webhook handler error', { error: err.message, eventType: event.type });
    return res.status(500).json({ error: 'Webhook handler failed' });
  }

  // Record event as processed (upsert handles race conditions)
  await supabase
    .from('processed_webhook_events')
    .upsert(
      { event_id: event.id, processed_at: new Date().toISOString() },
      { onConflict: 'event_id', ignoreDuplicates: true }
    );

  // Periodic cleanup: delete processed webhook events older than 7 days (every 100th webhook)
  webhookEventCounter++;
  if (webhookEventCounter % 100 === 0) {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    supabase.from('processed_webhook_events')
      .delete()
      .lt('processed_at', cutoff)
      .then(({ error }) => {
        if (error) log.warn('Webhook event cleanup failed', { error: error.message });
        else log.info('Webhook event cleanup completed');
      })
      .catch(() => {});
  }

  res.json({ received: true });
});

// POST /api/stripe/portal — billing portal for subscription management
router.post('/portal', async (req, res) => {
  if (!STRIPE_ENABLED) return res.status(503).json({ error: 'payments_hibernated' });
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (!user.stripe_customer_id) return res.status(400).json({ error: 'No billing account found' });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : 'https://auctions.bridgematch.co.uk'}/`,
    });
    res.json({ url: session.url });
  } catch (err) {
    log.error('Stripe portal error', { error: err.message });
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// GET /api/stripe/status — return user's subscription status
router.get('/status', async (req, res) => {
  if (!STRIPE_ENABLED) {
    const user = await validateUserFromReq(req);
    if (!user) return res.json({ active: false, stripeEnabled: false });
    const searchDate = user.ai_searches_date ? new Date(user.ai_searches_date).toISOString().slice(0, 10) : null;
    const today = new Date().toISOString().slice(0, 10);
    const aiSearchesUsed = searchDate === today ? (user.ai_searches_today || 0) : 0;
    return res.json({ active: true, tier: 'member', stripeEnabled: false, aiSearchesUsed, aiSearchLimit: getAISearchLimit(user) });
  }
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const isTrial = !!(user.trial_expires_at && new Date(user.trial_expires_at) > new Date() && !user.stripe_subscription_id);
  const trialDaysLeft = isTrial ? Math.max(0, Math.ceil((new Date(user.trial_expires_at) - new Date()) / (24 * 60 * 60 * 1000))) : 0;
  const searchDate = user.ai_searches_date ? new Date(user.ai_searches_date).toISOString().slice(0, 10) : null;
  const today = new Date().toISOString().slice(0, 10);
  const aiSearchesUsed = searchDate === today ? (user.ai_searches_today || 0) : 0;
  const aiSearchLimit = getAISearchLimit(user);

  res.json({
    tier: user.tier || 'free',
    scansUsed: user.analyses_count || 0,
    scanLimit: FREE_SCAN_LIMIT,
    tierExpiresAt: user.tier_expires_at || null,
    hasSubscription: !!user.stripe_subscription_id,
    trial: isTrial,
    trialExpiresAt: isTrial ? user.trial_expires_at : null,
    trialDaysLeft,
    aiSearchesUsed,
    aiSearchLimit: aiSearchLimit === Infinity ? 'unlimited' : aiSearchLimit,
  });
});

export default router;
