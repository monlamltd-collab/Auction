// Sentry must be imported before everything else for proper instrumentation
import * as Sentry from '@sentry/node';
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
  });
  console.log('Sentry error tracking enabled');
}

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomBytes, createHash } from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { DOM_EXTRACTORS, UNIVERSAL_DOM_EXTRACTOR, extractWithJSDOM, initExtractors, getLastExtractorUsed, setLastExtractorUsed } from './lib/extractors.js';
import Stripe from 'stripe';
import { callAI, initAI, getAICostSummary } from './lib/ai-provider.js';
import {
  initScraper, FIRECRAWL_API_KEY, FIRECRAWL_SKIP,
  scrapeWithFirecrawl, scrapeRenderedPage, scrapePageWithFirecrawl,
  fetchPage, scrapeAllPages, scrapeAllsopApi, extractAllsopLotsFromJson, enrichAllsopLots,
  detectTotalPages, buildPageUrl, scrapeWithPuppeteer,
  acquirePage, getBrowser, hasPuppeteer, puppeteer,
  extractLotsWithAI, extractLotsFromPdf, isPdfUrl, stripHtml,
  backfillImages, backfillImagesWithFirecrawl, backfillImagesWithPuppeteer,
  backfillImagesFromLotPages, fetchLotPage, enrichLotsFromLotPages,
  normaliseLotStatuses, isValidImageUrl, IMG_EXTENSIONS, IMG_CDN_DOMAINS,
  HOUSE_EXTRACTION_HINTS,
  getFirecrawlStatus, getFcCreditsUsed, isFcCreditExhausted, getFcExhaustedAt,
  getFcFallbackCount, getFcErrorCount, getFcRequestCount,
  isFcTemporarilyDown, getFcDownAt, getFcConsecutive5xx, getFcLastError, getFcLastErrorAt,
  setFcCreditExhausted, setFcExhaustedAt, setFcCreditsUsed,
  setFcTemporarilyDown, setFcDownAt, setFcConsecutive5xx,
  getLastScrapeEngine, setLastScrapeEngine, getLastAITier, setLastAITier,
} from './lib/scraper.js';
import { log, sseWrite, requestLoggerMiddleware } from './lib/logging.js';
import { validateEnv, STRIPE_ENABLED, RATE_LIMIT_PER_DAY, CACHE_DAYS, CACHE_TIERS, getCacheTTL, HEADERS, MAX_PAGES, MAX_PUPPETEER_PAGES, MAX_LOTS_PER_SCRAPE, MAX_AUCTIONS_PER_HOUSE, TIMEOUT, ALLOWED_ORIGINS, FREE_SCAN_LIMIT, FREE_PREVIEW_LOTS, resolveEffectiveTier, getAISearchLimit, truncateAddress, stripAIFields } from './lib/config.js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_ENABLED, SUPABASE_JWT_SECRET } from './lib/supabase.js';
import { securityHeaders, csrfCheck, validateUrl } from './lib/security.js';
import { verifySupabaseToken, safeCompare, getClientIP, rateLimit } from './lib/auth.js';
import { HOUSE_ROOTS, PUPPETEER_IMAGE_HOUSES, detectAuctionHouse, HOUSE_DISPLAY_NAMES, getHouseDisplayName, rewriteUrl, initHouses } from './lib/houses.js';

// ── Harness modules (adaptive resilience framework) ──
import { initAlerts, fireAlert as harnessFireAlert, resolveAlert as harnessResolveAlert, getUnresolved as harnessGetUnresolved } from './lib/harness/alert-router.js';
import { validateBatch } from './lib/harness/data-contract.js';
import { detectRegression } from './lib/harness/regression-detector.js';
import { evaluateGate } from './lib/harness/quality-gate.js';
import { initHouseHealth, updateHealth as harnessUpdateHealth, getHealth as harnessGetHealth, getAllHealth, isCircuitOpen, getBaseline } from './lib/harness/house-health.js';
import { enrichBatch, getEnrichmentReport } from './lib/harness/enrichment-engine.js';
import { initDiscovery, discoverNewHouses, getDiscoveryQueue, approveCandidate, getDiscoveryBudget } from './lib/harness/house-discovery.js';
import { initGenerator } from './lib/harness/extractor-generator.js';
import { initManager, runManagerCycle, getManagerReport, getManagerDirectives, setManagerConfig, getManagerConfig } from './lib/harness/manager.js';
import { enrichLotsWithFundability } from './lib/fundability.js';
import { initEnrichment, extractPostcode, extractStreet, queryLandRegistry, estimateMonthlyRent, buildLotUrl, fetchEPCByPostcode, matchEPCToLot, fetchFloodZone, enrichLots, ensureEnrichmentCacheTable, getCircuitBreakers } from './lib/enrichment.js';
import { escHtml, normaliseUrl } from './lib/utils.js';
import { FALLBACK_CALENDAR, getAuctionCalendar, getCalendarAuctions } from './lib/calendar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

validateEnv();

// escHtml and normaliseUrl moved to lib/utils.js

const stripe = STRIPE_ENABLED && process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's reverse proxy for correct client IP via req.ip / X-Forwarded-For
app.set('trust proxy', 1);

// Stripe webhook needs raw body for signature verification — MUST come before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '100kb' }));

// ═══════════════════════════════════════════════════════════════
// CORS (ALLOWED_ORIGINS from lib/config.js)
// ═══════════════════════════════════════════════════════════════
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ═══════════════════════════════════════════════════════════════
// BROKEN EXTRACTOR TRACKING (auto-populated by audit, persisted to Supabase)
// ═══════════════════════════════════════════════════════════════
const BROKEN_EXTRACTORS = new Set();

// Load broken extractors from Supabase on startup
async function loadBrokenExtractors() {
  try {
    const { data, error } = await supabase
      .from('house_skills')
      .select('slug')
      .eq('status', 'broken');
    if (error) { console.warn('BROKEN: Failed to load broken extractors:', error.message); return; }
    if (data) {
      for (const row of data) {
        BROKEN_EXTRACTORS.add(row.slug);
      }
      if (BROKEN_EXTRACTORS.size > 0) {
        console.log(`BROKEN: Loaded ${BROKEN_EXTRACTORS.size} broken extractors from Supabase: ${[...BROKEN_EXTRACTORS].join(', ')}`);
      }
    }
  } catch (err) {
    console.warn('BROKEN: Failed to load broken extractors:', err.message);
  }
}
// Fire-and-forget on startup (don't block server startup)
loadBrokenExtractors().then(() => initExtractors({ brokenExtractors: BROKEN_EXTRACTORS }));

// ── Security middleware (from lib/security.js) ──
app.use(securityHeaders);
app.use(csrfCheck);

// ── Request logging (from lib/logging.js) ──
app.use(requestLoggerMiddleware(getClientIP));

// ── Config constants from lib/config.js ──
const RATE_LIMIT = RATE_LIMIT_PER_DAY;
// PUPPETEER_IMAGE_HOUSES now imported from lib/houses.js

// ═══════════════════════════════════════════════════════════════
// AI PROVIDER — Model selection & rate limiting in lib/ai-provider.js
// ═══════════════════════════════════════════════════════════════
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
initAI(genAI, supabase);

// ── Harness initialization ──
initAlerts(supabase);
initHouseHealth(supabase).catch(e => console.warn('Harness: health init failed:', e.message));
initDiscovery(supabase, callAI);
initGenerator(supabase, callAI);
// Manager init deferred to after HOUSE_ROOTS and DOM_EXTRACTORS are defined (see below)

// Inject server-level dependencies into lib/houses.js (rewriteUrl needs these)
initHouses({
  firecrawlApiKey: FIRECRAWL_API_KEY,
  getFcCreditExhausted: isFcCreditExhausted,
  scrapeWithFirecrawlFn: scrapeWithFirecrawl,
});

// ═══════════════════════════════════════════════════════════════════════════
// QUALITY GATE — runs before caching to reject bad batches and clean data.
// Called from both /api/analyse (manual) and autoAnalyseOne (auto-scraper).
// Returns { lots, alerts, rejected } where rejected=true means batch is
// too poor to cache and should be discarded.
// ═══════════════════════════════════════════════════════════════════════════
function qualityGate(lots, house, prevCached, prevLots) {
  const alerts = [];
  const before = lots.length;

  // ── Guard 1: Price sanity — strip lots with implausible prices ──
  lots = lots.filter(lot => {
    if (!lot.price) return true; // no price is OK (many lots don't list one)
    if (lot.price < 1000) {
      alerts.push(`Stripped lot with implausible price £${lot.price}: "${(lot.address || '').substring(0, 50)}"`);
      return false;
    }
    if (lot.price > 50000000) {
      alerts.push(`Stripped lot with implausible price £${lot.price.toLocaleString()}: "${(lot.address || '').substring(0, 50)}"`);
      return false;
    }
    return true;
  });

  // ── Guard 2: URL validation — strip lots without a usable URL ──
  lots = lots.filter(lot => {
    if (!lot.url) return true; // missing URL is tolerated (Gemini-extracted lots often lack URLs)
    // Strip lots with javascript: or clearly broken URLs
    if (/^javascript:|^#|^mailto:|^void/i.test(lot.url)) {
      lot.url = ''; // clear the junk URL but keep the lot
    }
    return true;
  });

  // ── Guard 3: Minimum quality gate — reject batch if too sparse ──
  // At least 30% of lots must have either a price OR an image to be worth caching.
  // This catches catastrophic extraction failures where we get addresses only.
  if (lots.length >= 5) {
    const hasSubstance = lots.filter(l => l.price || l.imageUrl).length;
    const coverage = hasSubstance / lots.length;
    if (coverage < 0.3) {
      alerts.push(`QUALITY GATE FAIL: only ${Math.round(coverage * 100)}% of lots have a price or image (${hasSubstance}/${lots.length}). Batch rejected.`);
      return { lots, alerts, rejected: true };
    }
  }

  // ── Guard 4: Regression detection — compare against previous cache ──
  if (prevCached && prevCached.total_lots > 5) {
    // Lot count regression (already in autoAnalyseOne, now universal)
    if (lots.length < prevCached.total_lots * 0.5) {
      alerts.push(`LOT COUNT REGRESSION: ${prevCached.total_lots} → ${lots.length} (${Math.round(lots.length / prevCached.total_lots * 100)}%). Batch rejected.`);
      return { lots, alerts, rejected: true };
    }

    // Image coverage regression — if previous had >50% images and new has <20%, flag it
    if (Array.isArray(prevLots) && prevLots.length > 0) {
      const prevImgCount = prevLots.filter(l => l.imageUrl || l.image_url).length;
      const prevImgPct = prevImgCount / prevCached.total_lots;
      const newImgCount = lots.filter(l => l.imageUrl).length;
      const newImgPct = lots.length > 0 ? newImgCount / lots.length : 0;
      if (prevImgPct > 0.5 && newImgPct < 0.2) {
        alerts.push(`IMAGE COVERAGE REGRESSION: ${Math.round(prevImgPct * 100)}% → ${Math.round(newImgPct * 100)}% (${prevImgCount} → ${newImgCount})`);
        // Don't reject — images can be backfilled, but log the alert
      }
    }
  }

  const stripped = before - lots.length;
  if (stripped > 0) {
    alerts.push(`Cleaned ${stripped} lots with invalid data (${before} → ${lots.length})`);
  }

  // Log all alerts
  for (const a of alerts) {
    console.log(`[QUALITY] ${house}: ${a}`);
  }

  return { lots, alerts, rejected: false };
}


// _lastExtractorUsed is now in lib/extractors.js — use getLastExtractorUsed()/setLastExtractorUsed()
// getLastScrapeEngine(), getLastAITier() now in lib/scraper.js — use getLastScrapeEngine()/getLastAITier()

// scrapeRenderedPage, scrapePageWithFirecrawl, backfillImagesWithFirecrawl,
// HOUSE_EXTRACTION_HINTS — all moved to lib/scraper.js
// HOUSE_ROOTS, PUPPETEER_IMAGE_HOUSES, detectAuctionHouse, HOUSE_DISPLAY_NAMES, getHouseDisplayName, rewriteUrl
// now imported from lib/houses.js

// ═══════════════════════════════════════════════════════════════
// STATIC FILES
// ═══════════════════════════════════════════════════════════════
app.use('/public', express.static(join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════
// API: USER SIGNUP
// ═══════════════════════════════════════════════════════════════
// Legacy signup endpoint — kept for backwards compatibility but no longer issues session tokens
// All auth now goes through Supabase magic links
app.post('/api/signup', rateLimit(60000, 5), async (req, res) => {
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

// ═══════════════════════════════════════════════════════════════
// API: AUTH CONSENT (GDPR)
// ═══════════════════════════════════════════════════════════════
app.post('/api/auth/consent', async (req, res) => {
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

// ═══════════════════════════════════════════════════════════════
// API: AUTH ME
// ═══════════════════════════════════════════════════════════════
app.get('/api/auth/me', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  try {
    const { data } = await supabase
      .from('users')
      .select('id, email, name, tier, analyses_count, tier_expires_at, stripe_subscription_id, consent_auction_alerts, consent_partner_marketing, onboarding_complete, experience_level, budget_max, interests')
      .eq('id', user.id)
      .single();
    const safe = data || user;
    // Don't expose internal Stripe IDs to the client
    const { stripe_subscription_id, stripe_customer_id, ...publicFields } = safe;
    res.json({ ...publicFields, hasSubscription: !!stripe_subscription_id, stripeEnabled: STRIPE_ENABLED });
  } catch (err) {
    const { stripe_subscription_id, stripe_customer_id, ...publicFields } = user;
    res.json({ ...publicFields, hasSubscription: !!stripe_subscription_id, stripeEnabled: STRIPE_ENABLED });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: ONBOARDING
// ═══════════════════════════════════════════════════════════════
app.post('/api/auth/onboarding', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { experience_level, budget_max, interests, referral_source, preferred_regions } = req.body || {};
  const updates = { onboarding_complete: true };
  if (typeof experience_level === 'string') updates.experience_level = experience_level;
  if (typeof budget_max === 'number' && budget_max > 0) updates.budget_max = budget_max;
  if (Array.isArray(interests)) updates.interests = interests.slice(0, 10);
  if (typeof referral_source === 'string') updates.referral_source = referral_source.substring(0, 200);
  if (Array.isArray(preferred_regions)) updates.preferred_regions = preferred_regions.slice(0, 12);

  try {
    await supabase.from('users').update(updates).eq('id', user.id);
    res.json({ ok: true });
  } catch (err) {
    log.error('Onboarding save error', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to save onboarding' });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: SAVED SEARCHES
// ═══════════════════════════════════════════════════════════════
app.get('/api/searches', async (req, res) => {
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

app.post('/api/searches', async (req, res) => {
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

app.delete('/api/searches/:id', async (req, res) => {
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

// ═══════════════════════════════════════════════════════════════
// API: UNSOLD LOT ALERTS
// ═══════════════════════════════════════════════════════════════
app.get('/api/alerts/unsold', async (req, res) => {
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

app.post('/api/alerts/unsold', async (req, res) => {
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
app.post('/api/cron/unsold-alerts', async (req, res) => {
  const secret = req.headers['x-admin-secret'] || req.body?.secret;
  if (!safeCompare(secret || '', process.env.ADMIN_SECRET || '')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.json({ sent: 0, error: 'RESEND_API_KEY not configured' });

  try {
    // Get all active alerts that haven't been sent in the last 23 hours (daily) or 6.5 days (weekly)
    const { data: alerts, error: alertsErr } = await supabase
      .from('unsold_alerts')
      .select('id, user_id, filters, frequency')
      .eq('active', true);

    if (alertsErr) { log.error('Unsold alerts query error', { error: alertsErr.message }); return res.status(500).json({ error: 'Failed to fetch alerts' }); }
    if (!alerts || alerts.length === 0) return res.json({ sent: 0 });

    const now = new Date();
    let sent = 0;

    for (const alert of alerts) {
      // Check frequency gate
      if (alert.last_sent_at) {
        const lastSent = new Date(alert.last_sent_at);
        const hoursSince = (now - lastSent) / 3600000;
        if (alert.frequency === 'daily' && hoursSince < 23) continue;
        if (alert.frequency === 'weekly' && hoursSince < 156) continue;
      }

      // Get user email
      const { data: user, error: userErr } = await supabase.from('users').select('email, name').eq('id', alert.user_id).single();
      if (userErr || !user?.email) continue;

      // Get unsold lots from lots table
      const todayStr = now.toISOString().slice(0, 10);
      const { data: unsoldRows, error: unsoldErr } = await supabase
        .from('lots')
        .select(LOTS_SELECT)
        .or(`status.eq.unsold,and(auction_date.lt.${todayStr},or(status.eq.available,status.is.null))`)
        .limit(1000);

      if (unsoldErr || !unsoldRows) continue;

      let unsoldLots = unsoldRows.map(dbRowToFrontendLot);

      // Apply user's saved filters (price, type, location)
      const f = alert.filters || {};
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

      await fetch('https://api.resend.com/emails', {
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

    res.json({ sent, total: alerts.length });
  } catch (err) {
    log.error('Unsold alerts cron error', { error: err.message });
    res.status(500).json({ error: 'Cron failed', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// STRIPE: Checkout, Webhook, Portal, Status
// ═══════════════════════════════════════════════════════════════

// GET /api/stripe/diag — check Stripe config (temporary diagnostic)
app.get('/api/stripe/diag', (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  if (!STRIPE_ENABLED) return res.status(503).json({ error: 'payments_hibernated' });
  const key = process.env.STRIPE_SECRET_KEY || '';
  const priceId = process.env.STRIPE_MONTHLY_PRICE_ID || '';
  res.json({
    hasStripe: !!stripe,
    keyPrefix: key ? key.slice(0, 8) + '...' : 'MISSING',
    priceId: priceId ? priceId.slice(0, 10) + '...' : 'MISSING',
    hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
  });
});

// POST /api/stripe/checkout — create Stripe Checkout session
app.post('/api/stripe/checkout', rateLimit(60000, 5), async (req, res) => {
  if (!STRIPE_ENABLED) return res.status(503).json({ error: 'payments_hibernated' });
  log.info('Stripe checkout requested', { hasStripe: !!stripe, hasKey: !!process.env.STRIPE_SECRET_KEY, hasPriceId: !!process.env.STRIPE_MONTHLY_PRICE_ID });
  if (!stripe) return res.status(503).json({ error: 'Payments not configured — STRIPE_SECRET_KEY missing' });
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { product } = req.body || {};
  log.info('Stripe checkout', { product, userId: user.id, email: user.email, tier: user.tier });
  if (product !== 'monthly') {
    return res.status(400).json({ error: 'Invalid product. Use "monthly".' });
  }
  if (user.stripe_subscription_id) {
    return res.status(400).json({ error: 'You already have an active subscription. Use the billing portal to manage it.' });
  }

  const priceId = process.env.STRIPE_MONTHLY_PRICE_ID;
  if (!priceId) return res.status(503).json({ error: 'Price not configured — STRIPE_MONTHLY_PRICE_ID missing in Railway' });

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

// Webhook event counter for periodic cleanup of processed_webhook_events
let webhookEventCounter = 0;

// POST /api/stripe/webhook — Stripe event handler
app.post('/api/stripe/webhook', async (req, res) => {
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
          // Legacy day_pass — no longer sold, but handle existing sessions gracefully
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

        log.info('Payment completed', { userId, product, amount: session.amount_total });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        // Find user by subscription ID
        const { data: subUser } = await supabase
          .from('users')
          .select('id')
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
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const { data: subUser } = await supabase
          .from('users')
          .select('id')
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
          // Payment failed — give 3-day grace period before downgrade
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
app.post('/api/stripe/portal', async (req, res) => {
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
app.get('/api/stripe/status', async (req, res) => {
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

// ═══════════════════════════════════════════════════════════════
// API: LEAD SUBMISSION (BridgeMatch Lite)
// ═══════════════════════════════════════════════════════════════
app.post('/api/leads', rateLimit(60000, 10), async (req, res) => {
  const {
    name, email, phone, contactPref, isRegulated, occupancy,
    propertyPrice, loanAmount, ltvPercent, worksBudget,
    matchingLenders, propertyType, propertyAddress,
    depositRange, experienceLevel, auctionUrl, dealData,
    source, consent
  } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  // Phone required unless it's a simple email capture (e.g. landing-page newsletter)
  if (!phone && source !== 'landing-page') {
    return res.status(400).json({ error: 'Name, email, and phone are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  try {
    const { data, error } = await supabase
      .from('leads')
      .insert({
        name: (name || '').trim(),
        email: email.toLowerCase().trim(),
        phone: phone ? phone.trim() : null,
        source: source || 'bridgematch_lite',
        contact_pref: contactPref || 'email',
        is_regulated: !!isRegulated,
        occupancy: occupancy || null,
        property_price: propertyPrice || null,
        loan_amount: loanAmount || null,
        ltv_percent: ltvPercent || null,
        works_budget: worksBudget || null,
        matching_lenders: matchingLenders || null,
        property_type: propertyType || null,
        property_address: propertyAddress || null,
        deposit_range: depositRange || null,
        experience_level: experienceLevel || null,
        auction_url: auctionUrl || null,
        deal_data: dealData || null,
        consent_given: !!consent,
        ip_address: req.ip || null,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) throw error;

    logActivityEvent('lead_submit', { email, propertyPrice, loanAmount, isRegulated, source: source || 'bridgematch-lite' }, email, req.ip);

    // Email notification via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const regulated = isRegulated ? '⚠️ REGULATED (owner-occupier)' : 'Investment (bridging)';
      const safeUrl = auctionUrl && /^https?:\/\//.test(auctionUrl) ? auctionUrl : null;
      const html = `
        <h2>New Lead from Auction Tool</h2>
        <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Name</td><td>${escHtml(name)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Email</td><td><a href="mailto:${escHtml(email)}">${escHtml(email)}</a></td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Phone</td><td><a href="tel:${escHtml(phone)}">${escHtml(phone)}</a></td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Preferred contact</td><td>${escHtml(contactPref || 'email')}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Type</td><td>${regulated}</td></tr>
          ${propertyAddress ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Property</td><td>${escHtml(propertyAddress)}</td></tr>` : ''}
          ${propertyPrice ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Price</td><td>${escHtml(propertyPrice)}</td></tr>` : ''}
          ${loanAmount ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Loan needed</td><td>${escHtml(loanAmount)}</td></tr>` : ''}
          ${ltvPercent ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">LTV</td><td>${escHtml(ltvPercent)}%</td></tr>` : ''}
          ${worksBudget ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Works budget</td><td>${escHtml(worksBudget)}</td></tr>` : ''}
          ${matchingLenders ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Matching lenders</td><td>${escHtml(matchingLenders)}</td></tr>` : ''}
          ${propertyType ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Property type</td><td>${escHtml(propertyType)}</td></tr>` : ''}
          ${depositRange ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Deposit range</td><td>${escHtml(depositRange)}</td></tr>` : ''}
          ${experienceLevel ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Experience</td><td>${escHtml(experienceLevel)}</td></tr>` : ''}
          ${safeUrl ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Source</td><td><a href="${escHtml(safeUrl)}">View deal</a></td></tr>` : ''}
        </table>
      `;
      const safeName = (name || '').replace(/[\r\n\t]/g, ' ').slice(0, 100);
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'AuctionBrain <hello@auctionbrain.co.uk>',
          to: ['hello@bridgematch.co.uk', 'simon@brunel-bridging.co.uk'],
          subject: `🏠 New lead: ${safeName} — ${escHtml(propertyPrice || 'price TBC')}`,
          html,
        }),
      }).catch(e => log.warn('Lead email failed', { error: e.message }));
    }

    res.json({ ok: true, id: data?.id, isRegulated: !!isRegulated });
  } catch (err) {
    log.error('Lead submission error', { error: err.message });
    res.status(500).json({ error: 'Failed to submit enquiry' });
  }
});

// ═══════════════════════════════════════════════════════════════
// WELCOME EMAIL (via Resend) — uses Landing page style + drip sequence
// ═══════════════════════════════════════════════════════════════

// Shared email helpers (match AuctionBrain-Landing style exactly)
function abEmailWrap(body) {
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

function abTipCard(num, title, text) {
  return `<div style="background:#FFFFFF;border:1px solid #E8E4DC;border-radius:6px;padding:20px;margin:0 0 12px;">
  <span style="font-family:'Courier New',monospace;font-size:20px;color:#C0392B;font-weight:500;">${num}</span>
  <strong style="color:#1A1A18;display:block;margin:8px 0 4px;">${title}</strong>
  <span style="color:#6B6B65;font-size:14px;">${text}</span>
</div>`;
}

function abCtaButton(text, url = 'https://auctions.bridgematch.co.uk') {
  return `<a href="${url}" style="display:inline-block;background:#C0392B;color:#FFFFFF;font-size:16px;font-weight:600;padding:14px 28px;border-radius:4px;text-decoration:none;">${text}</a>`;
}

async function sendWelcomeEmail(email, name) {
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

// ═══════════════════════════════════════════════════════════════
// AUTH HELPER: validate user via Supabase JWT or legacy token
// ═══════════════════════════════════════════════════════════════
async function validateUserFromReq(req) {
  const authHeader = req.headers['authorization'] || '';

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (!token) return null;

    // 1) Try Supabase JWT verification
    const payload = await verifySupabaseToken(token);
    if (payload && !payload.error && payload.sub) {
      const authId = payload.sub;
      const email = payload.email;

      // Look up by supabase_auth_id first
      const { data: byAuthId } = await supabase
        .from('users')
        .select('id, email, name, tier, analyses_count, stripe_customer_id, tier_expires_at, stripe_subscription_id, trial_started_at, trial_expires_at, trial_used, ai_searches_today, ai_searches_date')
        .eq('supabase_auth_id', authId)
        .single();
      if (byAuthId) {
        if (byAuthId.tier === 'premium' && byAuthId.tier_expires_at && new Date(byAuthId.tier_expires_at) < new Date()) {
          await supabase.from('users').update({ tier: 'free', tier_expires_at: null, stripe_subscription_id: null }).eq('id', byAuthId.id);
          byAuthId.tier = 'free'; byAuthId.tier_expires_at = null;
        }
        return byAuthId;
      }

      // Link existing user by email on first JWT login
      if (email) {
        const { data: byEmail } = await supabase
          .from('users')
          .select('id, email, name, tier, analyses_count, stripe_customer_id, tier_expires_at, stripe_subscription_id, trial_started_at, trial_expires_at, trial_used, ai_searches_today, ai_searches_date')
          .eq('email', email.toLowerCase().trim())
          .single();
        if (byEmail) {
          await supabase.from('users')
            .update({ supabase_auth_id: authId, last_login: new Date().toISOString() })
            .eq('id', byEmail.id);
          if (byEmail.tier === 'premium' && byEmail.tier_expires_at && new Date(byEmail.tier_expires_at) < new Date()) {
            await supabase.from('users').update({ tier: 'free', tier_expires_at: null, stripe_subscription_id: null }).eq('id', byEmail.id);
            byEmail.tier = 'free'; byEmail.tier_expires_at = null;
          }
          return byEmail;
        }
      }

      // Auto-create new user — check trial_used to prevent trial abuse
      const normalEmail = (email || '').toLowerCase().trim();
      const { data: existingByEmail } = await supabase
        .from('users')
        .select('id, trial_used')
        .eq('email', normalEmail)
        .maybeSingle();
      log.info('Trial check', { email: normalEmail, trial_used: existingByEmail?.trial_used || false });

      let insertData;
      if (existingByEmail && existingByEmail.trial_used) {
        // User previously used a trial — no second trial
        insertData = {
          email: normalEmail,
          supabase_auth_id: authId,
          tier: 'free',
          tier_expires_at: null,
          trial_started_at: null,
          trial_expires_at: null,
          trial_used: true,
        };
      } else if (!STRIPE_ENABLED) {
        // Stripe hibernated — all users start as free (resolveEffectiveTier promotes to premium)
        insertData = {
          email: normalEmail,
          supabase_auth_id: authId,
          tier: 'free',
          tier_expires_at: null,
          trial_started_at: null,
          trial_expires_at: null,
          trial_used: false,
        };
      } else {
        // New user or trial not yet used — grant 14-day Pro trial
        const trialStart = new Date();
        const trialEnd = new Date(trialStart.getTime() + 14 * 24 * 60 * 60 * 1000);
        insertData = {
          email: normalEmail,
          supabase_auth_id: authId,
          tier: 'premium',
          tier_expires_at: trialEnd.toISOString(),
          trial_started_at: trialStart.toISOString(),
          trial_expires_at: trialEnd.toISOString(),
          trial_used: true,
        };
      }
      const { data: newUser, error: insertErr } = await supabase
        .from('users')
        .insert(insertData)
        .select('id, email, name, tier, analyses_count, stripe_customer_id, tier_expires_at, stripe_subscription_id, trial_started_at, trial_expires_at, trial_used, ai_searches_today, ai_searches_date')
        .single();
      if (!insertErr && newUser) {
        sendWelcomeEmail(newUser.email, newUser.name).catch(() => {});
        return newUser;
      }
      // Race guard: if insert failed due to unique constraint, another request already created this user — fetch and return them
      if (insertErr && insertErr.code === '23505') {
        log.info('User insert race — fetching existing', { email: normalEmail });
        const { data: raceUser } = await supabase
          .from('users')
          .select('id, email, name, tier, analyses_count, stripe_customer_id, tier_expires_at, stripe_subscription_id, trial_started_at, trial_expires_at, trial_used, ai_searches_today, ai_searches_date')
          .eq('email', normalEmail)
          .single();
        return raceUser || null;
      }
      return null;
    }

    // 2) Legacy fallback: session_token lookup (migration window)
    try {
      const { data } = await supabase
        .from('users')
        .select('id, email, name, tier, analyses_count, stripe_customer_id, tier_expires_at, stripe_subscription_id, trial_started_at, trial_expires_at, trial_used, ai_searches_today, ai_searches_date')
        .eq('session_token', token)
        .single();
      if (data) return data;
    } catch { /* fall through */ }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// API: AUCTION CALENDAR
// ═══════════════════════════════════════════════════════════════

// Hardcoded fallback calendar — used when Supabase auction_calendar table is empty
// FALLBACK_CALENDAR, getAuctionCalendar, getCalendarAuctions moved to lib/calendar.js
app.get('/api/auctions', async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  try {
    const auctions = await getAuctionCalendar();
    res.json({ updated: new Date().toISOString(), count: auctions.length, auctions });
  } catch (e) {
    log.error('Calendar endpoint error', { error: e.message });
    res.status(500).json({ error: 'Failed to load auction calendar' });
  }
});

// Admin: seed the Supabase calendar from hardcoded data
app.post('/api/admin/seed-calendar', async (req, res) => {
  const { secret } = req.body || {};
  if (!process.env.ADMIN_SECRET || !safeCompare(secret, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  try {
    const rows = FALLBACK_CALENDAR.map(a => ({
      house: a.house, house_slug: a.houseSlug, logo: a.logo,
      date: a.date, date_end: a.dateEnd || null, title: a.title,
      lots: a.lots || null, url: a.url, location: a.location,
      type: a.type, status: a.status, catalogue_ready: a.catalogueReady,
    }));
    const { data, error } = await supabase.from('auction_calendar').upsert(rows, { onConflict: 'url,date' });
    if (error) throw error;
    res.json({ message: `Seeded ${rows.length} auction entries`, count: rows.length });
  } catch (e) {
    log.error('Calendar seed error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: add/update a single auction
app.post('/api/admin/calendar', async (req, res) => {
  const { secret, auction } = req.body || {};
  const token = req.headers['x-admin-secret'] || secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  if (!auction || !auction.house || !auction.date || !auction.url) {
    return res.status(400).json({ error: 'Missing required fields: house, date, url' });
  }
  try {
    const row = {
      house: auction.house,
      house_slug: auction.houseSlug || auction.house.toLowerCase().replace(/[^a-z0-9]/g, ''),
      logo: auction.logo || '🔨',
      date: auction.date,
      date_end: auction.dateEnd || null,
      title: auction.title || auction.date,
      lots: auction.lots || null,
      url: auction.url,
      location: auction.location || 'Online',
      type: auction.type || 'Residential & Commercial',
      status: auction.status || 'upcoming',
      catalogue_ready: auction.catalogueReady !== undefined ? auction.catalogueReady : false,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('auction_calendar').upsert(row, { onConflict: 'url,date' });
    if (error) throw error;
    res.json({ message: 'Auction saved', auction: row });
  } catch (e) {
    log.error('Calendar save error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: deduplicate the calendar — remove duplicate rows keeping the best one per house+date+url
app.post('/api/admin/dedup-calendar', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  try {
    const { data, error } = await supabase.from('auction_calendar').select('id, house, date, url, catalogue_ready');
    if (error) throw error;

    const groups = new Map();
    for (const row of (data || [])) {
      const key = `${(row.house || '').toLowerCase()}|${row.date}|${normaliseUrl(row.url)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    const toDelete = [];
    for (const [, rows] of groups) {
      if (rows.length <= 1) continue;
      // Keep the one with catalogue_ready=true, or the first one
      rows.sort((a, b) => (b.catalogue_ready ? 1 : 0) - (a.catalogue_ready ? 1 : 0));
      for (let i = 1; i < rows.length; i++) toDelete.push(rows[i].id);
    }

    if (toDelete.length > 0) {
      for (const id of toDelete) {
        await supabase.from('auction_calendar').delete().eq('id', id);
      }
    }

    res.json({ message: `Removed ${toDelete.length} duplicate calendar entries`, removed: toDelete.length });
  } catch (e) {
    log.error('Calendar dedup error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: trigger self-healing for a specific house or view healing status
app.post('/api/admin/heal', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  const { slug } = req.body || {};
  if (!slug) {
    // Return healing status for all houses
    const status = {};
    for (const [s, state] of _healingState) {
      status[s] = {
        lastAttempt: state.lastAttempt ? new Date(state.lastAttempt).toISOString() : null,
        attempts: state.attempts,
        onCooldown: state.cooldownUntil ? Date.now() < state.cooldownUntil : false,
        cooldownUntil: state.cooldownUntil ? new Date(state.cooldownUntil).toISOString() : null,
      };
    }
    return res.json({ healingState: status, totalTracked: _healingState.size });
  }

  const rootUrl = HOUSE_ROOTS[slug];
  if (!rootUrl) return res.status(404).json({ error: `Unknown house slug: ${slug}` });

  // Clear cooldown to allow immediate retry
  _healingState.delete(slug);

  try {
    const healedUrl = await healBrokenHouse(slug, rootUrl);
    if (healedUrl) {
      res.json({ healed: true, slug, oldUrl: rootUrl, newUrl: healedUrl });
    } else {
      res.json({ healed: false, slug, message: 'Healing did not find a new URL' });
    }
  } catch (e) {
    log.error('Admin heal error', { slug, error: e.message });
    res.status(500).json({ error: 'Healing failed', detail: e.message });
  }
});

// Admin: delete an auction by ID
app.delete('/api/admin/calendar/:id', async (req, res) => {
  const { secret } = req.body || {};
  if (!process.env.ADMIN_SECRET || !safeCompare(secret, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  try {
    const { error } = await supabase.from('auction_calendar').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Auction deleted' });
  } catch (e) {
    log.error('Calendar delete error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: DISCOVER CATALOGUES — find upcoming auction URLs from root pages
// ═══════════════════════════════════════════════════════════════
// Scrapes a house's root/listing page and uses Claude to extract catalogue links.
// This handles URL format changes (date slugs, query params, auction IDs) automatically.
app.post('/api/admin/discover-catalogues', async (req, res) => {
  const { secret, houses } = req.body || {};
  if (!process.env.ADMIN_SECRET || !safeCompare(secret, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }

  const targetHouses = houses || Object.keys(HOUSE_ROOTS);
  const results = [];

  for (const slug of targetHouses) {
    const rootUrl = HOUSE_ROOTS[slug];
    if (!rootUrl) { results.push({ house: slug, error: 'No root URL configured' }); continue; }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(rootUrl, { headers: HEADERS, signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) { results.push({ house: slug, error: `HTTP ${resp.status}` }); continue; }
      const html = await resp.text();

      // Strip HTML to reduce token usage, keep links and text
      const stripped = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .substring(0, 8000);

      // Also extract all hrefs for Claude to reference
      const hrefMatches = [...html.matchAll(/href="([^"]*(?:auction|lot|catalogue|sale|property)[^"]*)"/gi)];
      const hrefs = [...new Set(hrefMatches.map(m => m[1]))].slice(0, 50);

      const aiText = await callAI(`You are analysing an auction house's listing page to find links to upcoming/current auction catalogues.

House: ${HOUSE_DISPLAY_NAMES[slug] || slug}
Root URL: ${rootUrl}

Page text (truncated):
${stripped}

Links found on page:
${hrefs.join('\n')}

Extract ALL auction catalogue links you can find. For each, provide:
- url: The full URL (resolve relative URLs against ${rootUrl})
- title: The auction title/date as shown on page
- date: The auction date in YYYY-MM-DD format if you can determine it (null if unclear)
- catalogueReady: true if the catalogue appears to have lots listed, false if "coming soon"

Return ONLY valid JSON: {"catalogues": [{"url": "...", "title": "...", "date": "...", "catalogueReady": true}]}
If no catalogues found, return {"catalogues": []}`, { tier: 'capable', maxTokens: 2000, taskType: 'discovery' });

      let catalogues = [];
      try {
        let text = aiText.trim();
        if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        catalogues = JSON.parse(text).catalogues || [];
      } catch (e) {
        results.push({ house: slug, error: 'AI returned invalid JSON', raw: aiText.substring(0, 200) });
        continue;
      }

      results.push({
        house: slug,
        displayName: HOUSE_DISPLAY_NAMES[slug] || slug,
        rootUrl,
        catalogues,
      });
    } catch (e) {
      results.push({ house: slug, error: e.message });
    }
  }

  res.json({ discovered: results.length, results });
});

// ═══════════════════════════════════════════════════════════════
// API: ANALYSE CATALOGUE
// ═══════════════════════════════════════════════════════════════
app.post('/api/analyse', async (req, res) => {
  const { url, budget, email } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing url' });

  // ── Validate URL to prevent SSRF ──
  const urlCheck = await validateUrl(url);
  if (!urlCheck.ok) return res.status(400).json({ error: urlCheck.error });

  // ── Check user is signed up (token-based auth with email fallback) ──
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'signup_required', message: 'Please sign up to use the analyser' });

  // ── Tier info (centralised via resolveEffectiveTier) ──
  const userTier = resolveEffectiveTier(user);
  const scanCount = user.analyses_count || 0;

  // ── Rate limiting (admin bypass with ADMIN_SECRET header) ──
  const isAdmin = process.env.ADMIN_SECRET && safeCompare(req.headers['x-admin-secret'], process.env.ADMIN_SECRET);
  const ip = getClientIP(req);
  const today = new Date().toISOString().slice(0, 10);

  // Atomic rate limit check: upsert+increment in one call via RPC, fallback to select
  let currentRequests = 0;
  try {
    const { data: rateRow } = await supabase.rpc('increment_rate_limit', { p_ip: ip, p_date: today });
    currentRequests = rateRow ?? 0;
  } catch {
    // Fallback if RPC not yet deployed: read then write (non-atomic)
    const { data: rateRow } = await supabase
      .from('rate_limits')
      .select('requests')
      .eq('ip', ip)
      .eq('date', today)
      .single();
    currentRequests = rateRow?.requests ?? 0;
  }

  if (!isAdmin && currentRequests >= RATE_LIMIT) {
    return res.status(429).json({
      error: 'rate_limited',
      message: `Daily limit reached (${RATE_LIMIT} analyses per day). Try again tomorrow.`
    });
  }

  // ── Check cache (metadata only — lot data comes from lots table) ──
  const normalisedUrl = normaliseUrl(url);
  const { data: cached } = await supabase
    .from('cached_analyses')
    .select('house, url, total_lots, title_splits, top_picks, under_100k, avg_yield, dev_potential, vacant_count, expires_at')
    .eq('url', normalisedUrl)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (cached) {
    console.log(`Cache hit for ${normalisedUrl} — reading lots from lots table`);
    const cachedSlug = HOUSE_DISPLAY_NAMES[cached.house]
      ? cached.house
      : Object.entries(HOUSE_DISPLAY_NAMES).find(([k, v]) => v === cached.house)?.[0] || cached.house;
    const cachedDisplayName = HOUSE_DISPLAY_NAMES[cachedSlug] || cached.house;
    const isPremium = userTier === 'premium';

    // Read fresh lot data from lots table (single source of truth)
    const { data: lotRows } = await supabase
      .from('lots')
      .select(LOTS_SELECT)
      .eq('catalogue_url', normalisedUrl)
      .order('score', { ascending: false, nullsFirst: false });

    const freshLots = (lotRows || []).map(dbRowToFrontendLot);
    const gatedLots = isPremium ? freshLots : stripAIFields(freshLots);

    // Recompute summary stats from fresh data
    const lotsWithPrice = freshLots.filter(l => l.price && l.price > 0);
    const yieldsArr = freshLots.map(l => l.estGrossYield).filter(y => y && y > 0);

    return res.json({
      house: cachedDisplayName,
      houseSlug: cachedSlug,
      recognised: cachedSlug !== 'unknown',
      totalLots: freshLots.length,
      titleSplits: freshLots.filter(l => l.titleSplit).length,
      topPicks: freshLots.filter(l => l.score >= 3).length,
      under100k: lotsWithPrice.filter(l => l.price < 100000).length,
      avgYield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
      devPotential: freshLots.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
      vacantCount: freshLots.filter(l => l.vacant === true).length,
      lots: gatedLots,
      cached: true,
      blurred: !isPremium,
      scansUsed: scanCount,
      scanLimit: FREE_SCAN_LIMIT,
    });
  }

  // Rate counter already incremented atomically above (pre-cache check)
  // For cached responses, the count was bumped but that's acceptable (prevents cache-probe abuse)

  // ── Fresh analysis — stream progress via SSE ──
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'API key not configured' });

  // Set up SSE stream
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    const house = detectAuctionHouse(url);
    const rewritten = await rewriteUrl(url, house);
    const scrapeUrl = rewritten.baseUrl;
    const displayNameEarly = getHouseDisplayName(house, url);

    console.log(`House: ${house}, URL: ${scrapeUrl}, isApi: ${rewritten.isApi}, preferPuppeteer: ${!!rewritten.preferPuppeteer}`);
    sseWrite(res, 'phase', { step: 'connecting', house: displayNameEarly });

    // Validate URL first (skip for sites that block server-side fetches)
    if (!rewritten.preferPuppeteer) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const testResp = await fetch(url, { headers: HEADERS, signal: controller.signal });
        clearTimeout(timeout);
        if (!testResp.ok) {
          sseWrite(res, 'error', { message: `That URL returned an error (${testResp.status}). It may not be a catalogue page, or the catalogue hasn't been published yet.` });
          return res.end();
        }
      } catch (e) {
        sseWrite(res, 'error', { message: "Couldn't reach that URL. Check it's a valid catalogue page." });
        return res.end();
      }
    }

    let pages;
    let rawLots = [];

    sseWrite(res, 'phase', { step: 'scraping' });

    const onExtract = (batch, totalBatches, lotsFound) => {
      sseWrite(res, 'extract', { batch, totalBatches, lotsFound });
    };

    // ── PDF catalogues — send directly to Gemini ──
    if (isPdfUrl(url)) {
      log.info('pdf_detected', { url, house });
      rawLots = await extractLotsFromPdf(url);
    } else if (rewritten.paginateAs === 'allsop_api') {
      // Allsop API: parse JSON directly (no Gemini needed)
      pages = await scrapeAllsopApi(rewritten.baseUrl);
      sseWrite(res, 'scrape', { pages: pages.length });
      if (pages.length > 0) {
        sseWrite(res, 'phase', { step: 'extracting' });
        rawLots = extractAllsopLotsFromJson(pages);
      }
    } else if (rewritten.preferPuppeteer) {
      // JS-rendered sites: use Firecrawl+JSDOM (primary) or Puppeteer (fallback)
      console.log(`Scraping JS-rendered site for ${house} (Firecrawl primary, Puppeteer fallback)...`);

      try {
        // Paginated sites: build page URLs, scrape each with scrapeRenderedPage + extractWithJSDOM
        if (rewritten.paginateAs === 'savills_pages') {
          console.log(`Loading paginated Savills catalogue...`);
          const firstResult = await scrapeRenderedPage(scrapeUrl, house);
          // Detect total pages from first page HTML
          const dom = new JSDOM(firstResult.html, { url: scrapeUrl });
          const totalPages = (() => {
            const pageLinks = dom.window.document.querySelectorAll('a[href*="/page-"]');
            let max = 1;
            for (const a of pageLinks) {
              const m = a.textContent.trim().match(/^(\d+)$/);
              if (m) max = Math.max(max, parseInt(m[1]));
            }
            return max;
          })();
          dom.window.close();
          console.log(`Savills: detected ${totalPages} pages`);
          sseWrite(res, 'scrape', { pages: totalPages, lots: 0 });

          const firstPageLots = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
          if (firstPageLots && firstPageLots.length > 0) rawLots.push(...firstPageLots);
          sseWrite(res, 'scrape', { pages: totalPages, lots: rawLots.length });
          console.log(`Page 1: ${firstPageLots ? firstPageLots.length : 0} lots`);

          const maxPages = Math.min(totalPages, 50);
          for (let p = 2; p <= maxPages; p++) {
            try {
              const pageResult = await scrapeRenderedPage(`${scrapeUrl}/page-${p}`, house);
              const pageLots = extractWithJSDOM(pageResult.html, house, `${scrapeUrl}/page-${p}`, pageResult.images);
              if (pageLots && pageLots.length > 0) rawLots.push(...pageLots);
              console.log(`Page ${p}: ${pageLots ? pageLots.length : 0} lots`);
            } catch (e) {
              console.log(`Page ${p} failed: ${e.message}`);
            }
          }
          console.log(`Savills total: ${rawLots.length} lots from ${maxPages} pages via DOM extraction`);

        } else if (rewritten.paginateAs === 'sdl_pages') {
          console.log(`Loading paginated SDL catalogue...`);
          const firstResult = await scrapeRenderedPage(scrapeUrl, house);
          const sdlTotalPages = detectTotalPages(firstResult.html, scrapeUrl, house);
          console.log(`SDL: detected ${sdlTotalPages} pages`);

          const sdlFirstLots = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
          if (sdlFirstLots && sdlFirstLots.length > 0) rawLots.push(...sdlFirstLots);
          console.log(`SDL Page 1: ${sdlFirstLots ? sdlFirstLots.length : 0} lots`);

          const sdlMaxPages = Math.min(sdlTotalPages, 40);
          for (let p = 2; p <= sdlMaxPages; p++) {
            const sep = scrapeUrl.includes('?') ? '&' : '?';
            const pageUrl = `${scrapeUrl}${sep}page=${p}`;
            try {
              const pageResult = await scrapeRenderedPage(pageUrl, house);
              const pageLots = extractWithJSDOM(pageResult.html, house, pageUrl, pageResult.images);
              if (pageLots && pageLots.length > 0) {
                rawLots.push(...pageLots);
                console.log(`SDL Page ${p}: ${pageLots.length} lots`);
              } else {
                console.log(`SDL Page ${p}: 0 lots — stopping pagination`);
                break;
              }
            } catch (e) {
              console.log(`SDL Page ${p} failed: ${e.message}`);
              break;
            }
          }
          console.log(`SDL total: ${rawLots.length} lots via DOM extraction`);

        } else if (rewritten.paginateAs === 'pugh_pages') {
          // Pugh: server-rendered Laravel — plain HTTP + JSDOM (no Firecrawl needed)
          console.log(`Loading paginated Pugh catalogue (plain HTTP)...`);
          const pughHtml1 = await fetchPage(scrapeUrl);
          const pughPage1Lots = extractWithJSDOM(pughHtml1, house, scrapeUrl);
          if (pughPage1Lots && pughPage1Lots.length > 0) rawLots.push(...pughPage1Lots);
          console.log(`Pugh Page 1: ${pughPage1Lots ? pughPage1Lots.length : 0} lots`);

          // Detect total pages from first page HTML
          const pughTotalPages = detectTotalPages(pughHtml1, scrapeUrl, house);
          const pughMaxPages = Math.min(pughTotalPages, 65);
          console.log(`Pugh: detected ${pughTotalPages} pages, loading up to ${pughMaxPages}`);

          for (let p = 2; p <= pughMaxPages; p++) {
            const pageUrl = buildPageUrl(scrapeUrl, p, house);
            try {
              const pageHtml = await fetchPage(pageUrl);
              const pageLots = extractWithJSDOM(pageHtml, house, pageUrl);
              if (pageLots && pageLots.length > 0) {
                rawLots.push(...pageLots);
                if (p % 10 === 0) console.log(`Pugh Page ${p}: ${pageLots.length} lots (total so far: ${rawLots.length})`);
              } else {
                console.log(`Pugh Page ${p}: 0 lots — stopping pagination`);
                break;
              }
              await new Promise(r => setTimeout(r, 200));
            } catch (e) {
              console.log(`Pugh Page ${p} failed: ${e.message}`);
              break;
            }
          }
          console.log(`Pugh total: ${rawLots.length} lots via DOM extraction`);

        } else {
          // ── Generic extraction with auto-pagination ──
          console.log(`Loading ${scrapeUrl} for ${house}`);
          const analyseOpts = {};
          if (rewritten.waitFor) analyseOpts.waitFor = rewritten.waitFor;
          if (rewritten.actions) analyseOpts.actions = rewritten.actions;
          const firstResult = await scrapeRenderedPage(scrapeUrl, house, analyseOpts);

          const domLots = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
          if (domLots && domLots.length >= 3) {
            rawLots.push(...domLots);
            console.log(`${house} Page 1: ${domLots.length} lots via DOM extraction`);

            // Auto-detect pagination from HTML
            const detectedPages = detectTotalPages(firstResult.html, scrapeUrl, house);
            if (detectedPages > 1) {
              const maxPages = Math.min(detectedPages, 25);
              console.log(`${house}: detected ${detectedPages} pages, loading up to ${maxPages}`);

              for (let p = 2; p <= maxPages; p++) {
                if (rawLots.length >= MAX_LOTS_PER_SCRAPE) { console.log(`${house}: lot cap reached at ${rawLots.length}`); break; }
                const pageUrl = buildPageUrl(scrapeUrl, p, house);
                try {
                  const pageResult = await scrapeRenderedPage(pageUrl, house);
                  const pageLots = extractWithJSDOM(pageResult.html, house, pageUrl, pageResult.images);
                  if (pageLots && pageLots.length > 0) {
                    rawLots.push(...pageLots);
                    console.log(`${house} Page ${p}: ${pageLots.length} lots`);
                  } else {
                    console.log(`${house} Page ${p}: 0 lots — stopping pagination`);
                    break;
                  }
                } catch (e) {
                  console.log(`${house} Page ${p} failed: ${e.message}`);
                  break;
                }
              }
            }
            if (rawLots.length > MAX_LOTS_PER_SCRAPE) {
              console.log(`${house}: capping ${rawLots.length} lots to ${MAX_LOTS_PER_SCRAPE}`);
              rawLots = rawLots.slice(0, MAX_LOTS_PER_SCRAPE);
            }
            setLastExtractorUsed(DOM_EXTRACTORS[house] ? 'dom-house' : 'dom-generic');
            console.log(`${house} total: ${rawLots.length} lots via DOM extraction (no Claude needed)`);
          } else {
            // Fall back to Claude extraction
            if (domLots && domLots.length > 0) {
              console.log(`DOM extractor found only ${domLots.length} lots for ${house} (below threshold of 3), falling back to Claude`);
            }
            console.log(`Got ${firstResult.html.length} chars, sending to Claude...`);
            const renderedPages = [{ page: 1, html: firstResult.html, markdown: firstResult.markdown }];
            sseWrite(res, 'phase', { step: 'extracting' });
            rawLots = await extractLotsWithAI(renderedPages, house, onExtract, scrapeUrl);
            console.log(`Claude extracted ${rawLots.length} lots from rendered content`);

            // ── DOM→Gemini merge: harvest URLs + images from DOM, merge into Gemini lots ──
            if (rawLots.length > 0 && firstResult.html) {
              const domHarvest = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
              if (domHarvest && domHarvest.length > 0) {
                const domByLot = {};
                for (const d of domHarvest) { if (d.lot) domByLot[d.lot] = d; }
                let urlsMerged = 0, imgsMerged = 0;
                for (const lot of rawLots) {
                  const dom = domByLot[lot.lot];
                  if (!dom) continue;
                  if (!lot.url && dom.url) { lot.url = dom.url; urlsMerged++; }
                  if (!lot.imageUrl && dom.imageUrl) { lot.imageUrl = dom.imageUrl; imgsMerged++; }
                }
                if (urlsMerged === 0 && imgsMerged === 0 && domHarvest.length >= rawLots.length * 0.5) {
                  for (let i = 0; i < rawLots.length && i < domHarvest.length; i++) {
                    if (!rawLots[i].url && domHarvest[i].url) { rawLots[i].url = domHarvest[i].url; urlsMerged++; }
                    if (!rawLots[i].imageUrl && domHarvest[i].imageUrl) { rawLots[i].imageUrl = domHarvest[i].imageUrl; imgsMerged++; }
                  }
                }
                if (urlsMerged > 0 || imgsMerged > 0) {
                  console.log(`DOM→Gemini merge for ${house}: ${urlsMerged} URLs, ${imgsMerged} images`);
                }
              }
            }
          }
        }
      } catch (err) {
        log.error('JS-rendered scraping failed', { house, error: err.message });
        sseWrite(res, 'error', { message: 'Scraping engine unavailable — please try again in a moment.' });
        return res.end();
      }
    } else {
      // Standard static HTML scraping
      pages = await scrapeAllPages(scrapeUrl, house);
      sseWrite(res, 'scrape', { pages: pages ? pages.length : 0 });
      if (pages && pages.length > 0) {
        sseWrite(res, 'phase', { step: 'extracting' });
        rawLots = await extractLotsWithAI(pages, house, onExtract, scrapeUrl);
      }
      // Rendered page fallback if static scraping found nothing
      const SKIP_PUPPETEER = ['philliparnold','knightfrank'];
      if (rawLots.length === 0 && !SKIP_PUPPETEER.includes(house)) {
        console.log(`No lots from static HTML, trying rendered scraping for ${house}...`);
        try {
          const rendered = await scrapeRenderedPage(url, house);
          if (rendered.html) {
            const renderedLots = extractWithJSDOM(rendered.html, house, url, rendered.images);
            if (renderedLots && renderedLots.length > 0) {
              rawLots = renderedLots;
              console.log(`Rendered scraping got ${rawLots.length} lots via DOM extraction`);
            } else {
              const renderedPages = [{ page: 1, html: rendered.html, markdown: rendered.markdown }];
              sseWrite(res, 'phase', { step: 'extracting' });
              rawLots = await extractLotsWithAI(renderedPages, house, onExtract, scrapeUrl);
              console.log(`Claude extracted ${rawLots.length} lots from rendered content`);
              // DOM→Gemini merge
              if (rawLots.length > 0) {
                const domH = extractWithJSDOM(rendered.html, house, url, rendered.images);
                if (domH && domH.length > 0) {
                  const byLot = {}; for (const d of domH) { if (d.lot) byLot[d.lot] = d; }
                  let um = 0, im = 0;
                  for (const lot of rawLots) {
                    const d = byLot[lot.lot]; if (!d) continue;
                    if (!lot.url && d.url) { lot.url = d.url; um++; }
                    if (!lot.imageUrl && d.imageUrl) { lot.imageUrl = d.imageUrl; im++; }
                  }
                  if (um === 0 && im === 0 && domH.length >= rawLots.length * 0.5) {
                    for (let i = 0; i < rawLots.length && i < domH.length; i++) {
                      if (!rawLots[i].url && domH[i].url) { rawLots[i].url = domH[i].url; um++; }
                      if (!rawLots[i].imageUrl && domH[i].imageUrl) { rawLots[i].imageUrl = domH[i].imageUrl; im++; }
                    }
                  }
                  if (um > 0 || im > 0) console.log(`DOM→Gemini merge (fallback): ${um} URLs, ${im} images`);
                }
              }
            }
          }
        } catch (err) {
          console.log(`Rendered scraping fallback failed for ${house}: ${err.message}`);
        }
      }
    }
    
    if (pages && pages.length === 0 && rawLots.length === 0) {
      sseWrite(res, 'error', { message: "Couldn't find any content on that page." });
      return res.end();
    }

    if (rawLots.length === 0) {
      sseWrite(res, 'error', { message: "Couldn't find any auction lots. Make sure you're linking to the catalogue page, not the auction house homepage." });
      return res.end();
    }

    sseWrite(res, 'phase', { step: 'scoring', lots: rawLots.length });

    const analysed = rawLots.map(lot => analyseLot(lot)).sort((a, b) => b.score - a.score);

    // ── Enrich with Land Registry + rental yields (also resolves lot URLs) ──
    console.log('Starting Land Registry + rental yield enrichment...');
    sseWrite(res, 'phase', { step: 'enriching', lots: analysed.length });
    await enrichLots(analysed, house, url, (done, total) => {
      sseWrite(res, 'enrich', { postcodes: done, total });
    });

    // ── Unified lot-page enrichment: single fetch per lot extracts all missing data ──
    // (address, image, tenure, leaseLength, condition, beds, propType)
    await enrichLotsFromLotPages(analysed);

    // ── Harness enrichment: gap-filling, cross-lot inference, cache carry-forward ──
    const { data: prevLotRows } = await supabase
      .from('lots')
      .select(LOTS_SELECT)
      .eq('catalogue_url', normalisedUrl);
    const harnessResult = enrichBatch(analysed, house, {
      previousCache: (prevLotRows || []).map(dbRowToFrontendLot),
    });
    const enrichedAnalysed = harnessResult.lots;
    if (harnessResult.stats.enriched > 0) {
      console.log(`HARNESS (manual): ${house}: enriched ${harnessResult.stats.enriched} lots (${harnessResult.stats.fieldsImproved.join(', ')})`);
    }
    // Re-score after enrichment fills gaps (e.g. tenure, beds may affect score)
    for (const lot of enrichedAnalysed) {
      const rescored = analyseLot(lot);
      Object.assign(lot, rescored);
    }

    // ── Fundability badges — fire-and-forget, never blocks pipeline ──
    try {
      await enrichLotsWithFundability(enrichedAnalysed);
    } catch (e) {
      console.warn('Fundability enrichment failed (non-fatal):', e.message);
    }

    // ── Cache results ──
    const displayName = getHouseDisplayName(house, url);
    const expiresAt = new Date(Date.now() + getCacheTTL(house)).toISOString();

    // Log unknown house successes for future house addition
    if (house === 'unknown' && enrichedAnalysed.length >= 3) {
      log.info('NEW_HOUSE_CANDIDATE', { hostname: new URL(url).hostname, lots: enrichedAnalysed.length, url });
    }

    // Check if catalogue data actually changed before invalidating preset cache
    const { data: prevCached } = await supabase
      .from('cached_analyses')
      .select('total_lots, top_picks, title_splits')
      .eq('url', normalisedUrl)
      .single();

    // ── Quality gate — validate batch before caching ──
    // prevLotRows already fetched above for enrichBatch
    const qg = qualityGate(enrichedAnalysed, house, prevCached, (prevLotRows || []).map(dbRowToFrontendLot));
    // For manual analyses, log but don't reject — user explicitly asked for this
    if (qg.alerts.length > 0) {
      for (const a of qg.alerts) sseWrite(res, 'warn', { message: a });
    }

    const lotsWithPrice = enrichedAnalysed.filter(l => l.price && l.price > 0);
    const yieldsArr = enrichedAnalysed.map(l => l.estGrossYield).filter(y => y && y > 0);

    const catalogueChanged = !prevCached
      || prevCached.total_lots !== enrichedAnalysed.length
      || prevCached.top_picks !== enrichedAnalysed.filter(l => l.score >= 3).length
      || prevCached.title_splits !== enrichedAnalysed.filter(l => l.titleSplit).length;

    await supabase.from('cached_analyses').upsert({
      url: normalisedUrl,
      house: house,
      total_lots: enrichedAnalysed.length,
      title_splits: enrichedAnalysed.filter(l => l.titleSplit).length,
      top_picks: enrichedAnalysed.filter(l => l.score >= 3).length,
      under_100k: lotsWithPrice.filter(l => l.price < 100000).length,
      avg_yield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
      dev_potential: enrichedAnalysed.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
      vacant_count: enrichedAnalysed.filter(l => l.vacant === true).length,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      last_scraped_at: new Date().toISOString(),
      scraped_with: getLastScrapeEngine(),
    extracted_with: getLastExtractorUsed(),
    ai_tier: getLastAITier(),
    }, { onConflict: 'url' });

    // ── Upsert individual lots to lots table (single source of truth) ──
    normaliseLotStatuses(enrichedAnalysed); // Normalize before write — canonical statuses only
    await upsertToLotsTable(enrichedAnalysed, house, url, {
      scrapedWith: getLastScrapeEngine(),
      extractedWith: getLastExtractorUsed(),
    });

    // Mark preset cache entries as partially stale (only the changed catalogue needs re-searching)
    if (catalogueChanged) {
      const { data: affected } = await supabase
        .from('smart_search_cache')
        .select('query_key, stale_urls')
        .contains('source_urls', [normalisedUrl]);
      if (affected && affected.length > 0) {
        for (const row of affected) {
          const updatedStale = [...new Set([...(row.stale_urls || []), normalisedUrl])];
          await supabase.from('smart_search_cache')
            .update({ stale_urls: updatedStale })
            .eq('query_key', row.query_key);
        }
        console.log(`Marked ${affected.length} preset cache entries stale for: ${normalisedUrl}`);
      }
    }

    // ── Update user count ──
    await supabase.from('users')
      .update({ analyses_count: (user.analyses_count || 0) + 1 })
      .eq('id', user.id);

    // Log activity event
    logActivityEvent('analysis', { house: displayName, url: normalisedUrl, lots_found: enrichedAnalysed.length }, user?.email, getClientIP(req));

    const updatedScanCount = (user.analyses_count || 0) + 1;

    const isPremium = userTier === 'premium';
    const gatedAnalysed = isPremium ? enrichedAnalysed : stripAIFields(enrichedAnalysed);
    sseWrite(res, 'done', {
      house: displayName,
      houseSlug: house,
      recognised: house !== 'unknown',
      totalLots: enrichedAnalysed.length,
      titleSplits: enrichedAnalysed.filter(l => l.titleSplit).length,
      topPicks: enrichedAnalysed.filter(l => l.score >= 3).length,
      under100k: lotsWithPrice.filter(l => l.price < 100000).length,
      avgYield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
      devPotential: enrichedAnalysed.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
      vacantCount: enrichedAnalysed.filter(l => l.vacant === true).length,
      lots: gatedAnalysed,
      cached: false,
      blurred: !isPremium,
      scansUsed: updatedScanCount,
      scanLimit: FREE_SCAN_LIMIT,
    });
    return res.end();
  } catch (err) {
    log.error('Analysis SSE error', { error: err.message });
    sseWrite(res, 'error', { message: 'Analysis failed' });
    return res.end();
  }
});

// ═══════════════════════════════════════════════════════════════
// PRESET QUERIES — cached for instant results
// ═══════════════════════════════════════════════════════════════
const PRESET_QUERIES = {
  'Properties needing heavy refurbishment': 'heavy-refurb',
  'Freehold multi-unit blocks for title splitting': 'title-splits',
  'High yield investments over 8%': 'high-yield-8',
  'Development land with planning': 'dev-land',
  'Probate or executor sales': 'probate',
  'Best scoring deals': 'top-picks',
  'Vacant properties': 'vacant',
  'Properties under £100k': 'under-100k',
  'Commercial property': 'commercial',
  'Land and development sites': 'land-dev',
  'Flats and apartments': 'flats',
};

// ── Deterministic preset filters — bypass Gemini entirely ──
// Each preset defines: filter (lot => boolean), sort (compare fn), report (count => string)
const PRESET_FILTERS = {
  'top-picks': {
    filter: l => (l.score || 0) >= 3,
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} high-scoring investment opportunities (score 3+) across ${total} auction lots. These properties show the strongest combination of investment signals — such as below-market pricing, development potential, motivated sellers, and value-add condition. Higher scores indicate more overlapping opportunity signals.`
      : `No lots currently score 3 or above. Scores are based on investment signals like condition, tenure, yield, and seller motivation. Try browsing the full directory or check back when new catalogues are analysed.`,
  },
  'under-100k': {
    filter: l => l.price && l.price > 0 && l.price < 100000,
    sort: (a, b) => (a.price || Infinity) - (b.price || Infinity),
    report: (n, total) => n > 0
      ? `Found ${n} properties listed under £100,000 across ${total} lots. These are sorted by guide price, lowest first. Remember that guide prices at auction are often below the expected sale price.`
      : `No properties currently listed under £100,000. Guide prices change as new catalogues are published — check back soon.`,
  },
  'vacant': {
    filter: l => l.vacant === true,
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} vacant properties across ${total} lots, sorted by investment score. Vacant possession means faster completion and immediate access for refurbishment or re-letting.`
      : `No properties explicitly listed as vacant possession. Some lots may still be vacant but not stated in the listing — check individual lot details.`,
  },
  'flats': {
    filter: l => l.propType === 'flat',
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} flats and apartments across ${total} lots, sorted by investment score. Check tenure carefully — most flats are leasehold.`
      : `No flats or apartments found in current catalogues.`,
  },
  'high-yield-8': {
    filter: l => l.estGrossYield && l.estGrossYield >= 8,
    sort: (a, b) => (b.estGrossYield || 0) - (a.estGrossYield || 0),
    report: (n, total) => n > 0
      ? `Found ${n} properties with estimated gross yield of 8% or above across ${total} lots, sorted by yield. These yields are estimates based on guide price and local rental data — verify with your own research.`
      : `No properties currently show an estimated gross yield of 8% or above. Yields are calculated from guide prices and local rental data, so they update as new catalogues are published.`,
  },
  'title-splits': {
    filter: l => l.titleSplit === true,
    sort: (a, b) => (b.units || 0) - (a.units || 0) || (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} potential title split opportunities across ${total} lots — freehold properties containing multiple self-contained units. Sorted by unit count. Title splitting can unlock significant value but requires legal and planning checks.`
      : `No title split opportunities detected in current catalogues. These are identified by freehold multi-unit properties where individual flats could be sold separately.`,
  },
  'probate': {
    filter: l => (l.opps || []).some(o => /executor|probate/i.test(o)),
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} probate and executor sales across ${total} lots, sorted by investment score. These often come with motivated sellers and potential for below-market pricing.`
      : `No probate or executor sales found in current catalogues. These are identified by keywords like "executor", "probate", "estate of" in lot descriptions.`,
  },
  'heavy-refurb': {
    filter: l => l.condition === 'needs work' || l.condition === 'poor',
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} properties needing refurbishment across ${total} lots, sorted by investment score. These range from cosmetic updates to full renovations — check lot details for specifics.`
      : `No properties explicitly described as needing refurbishment in current catalogues.`,
  },
  'dev-land': {
    filter: l => (l.opps || []).some(o => /development/i.test(o)),
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} development opportunities across ${total} lots, sorted by investment score. These include properties with planning permission, development potential, or conversion opportunities.`
      : `No development opportunities found in current catalogues. These are identified by keywords like "planning permission", "development potential", "conversion" in lot descriptions.`,
  },
  'commercial': {
    filter: l => l.propType === 'commercial',
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} commercial properties across ${total} lots, sorted by investment score. Includes shops, offices, retail units, industrial premises, and investment portfolios.`
      : `No commercial properties found in current catalogues.`,
  },
  'land-dev': {
    filter: l => l.propType === 'land' || (l.opps || []).some(o => /development/i.test(o)),
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} land and development sites across ${total} lots, sorted by investment score. Includes building plots, development sites, and properties with planning permission.`
      : `No land or development sites found in current catalogues.`,
  },
};

function isPresetQuery(query) {
  return PRESET_QUERIES[query] || null;
}

// ═══════════════════════════════════════════════════════════════
// SMART SEARCH QUERY PARSER — extracts structured column filters
// from natural language queries so the lots table can be queried
// with SQL before sending the narrowed set to Gemini.
// ═══════════════════════════════════════════════════════════════
function parseSmartSearchQuery(query) {
  const result = { filters: {}, softFilters: {}, locationTerms: [], freeText: [], intentWords: [], concepts: [], original: query };
  let q = query.toLowerCase().trim();

  // ── Concept detection — compound intents that shouldn't be split into individual hard filters ──
  // "block(s) of flats" / "blocks of apartments" → multi-unit freehold concept
  if (/blocks?\s+of\s+(?:flats?|apartments?)/i.test(q)) {
    result.concepts.push('multi_unit_freehold');
    q = q.replace(/blocks?\s+of\s+(?:flats?|apartments?)/gi, '').trim();
  }
  // "could title split" / "title split potential" / "potential to title split"
  if (/(?:could|potential\s+to)\s+title\s+split/i.test(q)) {
    result.concepts.push('title_split_potential');
    q = q.replace(/(?:could|potential\s+to)\s+title\s+split/gi, '').trim();
  }
  // "HMO conversion" / "convert to HMO"
  if (/(?:hmo\s+conversion|convert(?:ed)?\s+to\s+hmo)/i.test(q)) {
    result.concepts.push('hmo_conversion');
    q = q.replace(/(?:hmo\s+conversion|convert(?:ed)?\s+to\s+hmo)/gi, '').trim();
  }
  // "development site" / "development opportunity"
  if (/development\s+(?:site|opportunity|potential|plot)/i.test(q)) {
    result.concepts.push('development');
    q = q.replace(/development\s+(?:site|opportunity|potential|plot)/gi, '').trim();
  }
  // "flip" / "buy to flip" / "quick flip"
  if (/(?:buy\s+to\s+|quick\s+)?flip/i.test(q)) {
    result.concepts.push('flip');
    q = q.replace(/(?:buy\s+to\s+|quick\s+)?flip/gi, '').trim();
  }
  // "buy to let" / "BTL" / "rental"
  if (/(?:buy\s+to\s+let|btl|rental\s+(?:investment|property|yield))/i.test(q)) {
    result.concepts.push('buy_to_let');
    q = q.replace(/(?:buy\s+to\s+let|btl|rental\s+(?:investment|property|yield))/gi, '').trim();
  }

  // ── Multi-word phrases (extract before splitting into words) ──
  // title_split as standalone phrase (not part of a concept) → soft filter
  if (/title\s+split/i.test(q)) { result.softFilters.title_split = true; q = q.replace(/title\s+splits?/gi, '').trim(); }
  if (/need(?:s|ing)?\s+work/i.test(q)) { result.softFilters.condition = ['needs work', 'poor']; q = q.replace(/need(?:s|ing)?\s+(?:of\s+)?work/gi, '').trim(); }
  if (/poor\s+condition/i.test(q)) { result.softFilters.condition = ['needs work', 'poor']; q = q.replace(/poor\s+condition/gi, '').trim(); }
  if (/good\s+condition/i.test(q)) { result.filters.condition = ['good']; q = q.replace(/good\s+condition/gi, '').trim(); }
  if (/share\s+of\s+freehold/i.test(q)) { result.filters.tenure = 'Share of Freehold'; q = q.replace(/share\s+of\s+freehold/gi, '').trim(); }
  if (/high\s+yield/i.test(q)) { result.filters.sortBy = 'yield'; q = q.replace(/high\s+yield/gi, '').trim(); }
  if (/deal\s+stack/i.test(q)) { result.concepts.push('deal_stack'); q = q.replace(/deal\s+stack(?:ing)?/gi, '').trim(); }

  // ── Multi-word location names (must extract before splitting) ──
  const multiWordLocations = {
    'milton keynes': 'Milton Keynes', 'st albans': 'St Albans', 'stoke on trent': 'Stoke',
    'weston-super-mare': 'Weston-super-Mare', 'weston super mare': 'Weston-super-Mare',
    'tunbridge wells': 'Tunbridge', 'bury st edmunds': 'Bury St Edmunds',
    'kings lynn': 'Kings Lynn', 'great yarmouth': 'Great Yarmouth',
    'hemel hempstead': 'Hemel Hempstead', 'st helens': 'St Helens',
    'west bromwich': 'West Bromwich', 'sutton coldfield': 'Sutton Coldfield',
    'stratford-upon-avon': 'Stratford-upon-Avon', 'stratford upon avon': 'Stratford-upon-Avon',
    'bishop auckland': 'Bishop Auckland', 'south shields': 'South Shields',
    'port talbot': 'Port Talbot', 'isle of wight': 'Isle of Wight',
    'fort william': 'Fort William', 'east kilbride': 'East Kilbride',
    'barrow in furness': 'Barrow', 'colwyn bay': 'Colwyn Bay',
  };
  for (const [phrase, canonical] of Object.entries(multiWordLocations)) {
    if (q.includes(phrase)) { result.locationTerms.push(canonical); q = q.replace(new RegExp(phrase.replace(/[-]/g, '\\-'), 'gi'), '').trim(); }
  }

  // ── Region names → postcode prefix filters ──
  const regionPostcodes = {
    'london': ['E','EC','N','NW','SE','SW','W','WC','EN','HA','IG','KT','TW','UB','BR','CR','DA','SM','RM'],
    'south east': ['BN','CT','GU','ME','MK','OX','PO','RG','RH','SL','SO','TN','HP'],
    'south west': ['BA','BH','BS','DT','EX','GL','PL','SN','SP','TA','TQ','TR'],
    'east': ['AL','CB','CM','CO','IP','LU','NR','PE','SG','SS','WD'],
    'west midlands': ['B','CV','DY','HR','ST','TF','WR','WS','WV'],
    'east midlands': ['DE','DN','LE','LN','NG','NN'],
    'north west': ['BB','BL','CA','CH','CW','FY','L','LA','M','OL','PR','SK','WA','WN'],
    'north east': ['DH','DL','HG','NE','SR','TS'],
    'yorkshire': ['BD','DN','HD','HG','HU','HX','LS','S','WF','YO'],
    'wales': ['CF','LD','LL','NP','SA','SY'],
    'scotland': ['AB','DD','DG','EH','FK','G','HS','IV','KA','KW','KY','ML','PA','PH','TD','ZE'],
  };
  // Check region phrases (must check multi-word first)
  const regionOrder = ['south east','south west','west midlands','east midlands','north west','north east','east','yorkshire','wales','scotland'];
  for (const region of regionOrder) {
    if (q.includes(region)) {
      result.filters.regionPostcodes = regionPostcodes[region];
      result.filters.regionName = region;
      q = q.replace(new RegExp(region, 'gi'), '').trim();
      break;
    }
  }

  // ── Price patterns ──
  const underMatch = q.match(/(?:under|below|max|up\s+to|less\s+than)\s*£?\s*(\d[\d,]*)\s*k?\b/i);
  if (underMatch) {
    let price = parseInt(underMatch[1].replace(/,/g, ''));
    if (price < 10000) price *= 1000;
    result.filters.maxPrice = price;
    q = q.replace(underMatch[0], '').trim();
  }
  const overMatch = q.match(/(?:over|above|min|more\s+than|from)\s*£?\s*(\d[\d,]*)\s*k?\b/i);
  if (overMatch) {
    let price = parseInt(overMatch[1].replace(/,/g, ''));
    if (price < 10000) price *= 1000;
    result.filters.minPrice = price;
    q = q.replace(overMatch[0], '').trim();
  }

  // ── Beds ──
  const bedMatch = q.match(/(\d+)\s*(?:bed(?:room)?s?\b)/i);
  if (bedMatch) { result.filters.beds = parseInt(bedMatch[1]); q = q.replace(bedMatch[0], '').trim(); }

  // ── Word classification ──
  const propTypes = { house: 'house', houses: 'house', property: null, properties: null, flat: 'flat', flats: 'flat', apartment: 'flat', apartments: 'flat', land: 'land', commercial: 'commercial', garage: 'garage', bungalow: 'bungalow' };
  const conditionWords = { refurb: ['needs work', 'poor'], refurbishment: ['needs work', 'poor'], derelict: ['poor'], dilapidated: ['poor'], rundown: ['needs work', 'poor'] };

  // Intent words — carry meaning for AI ranking but NOT for SQL filtering
  const intentWords = new Set([
    'best','good','great','top','cheap','cheapest','bargain','bargains','deal','deals',
    'interesting','opportunity','opportunities','investment','investments','promising',
    'strong','value','undervalued','potential','recommend','recommended','find','show',
    'search','looking','want','need','any','all','the','with','for','and','near',
    'around','area','region','in','at','on','from','to','what','where','which','how',
    'can','could','should','would','some','these','those','most','more','very','really',
    'please','thanks','help','me','my','give','list','lots','auction','auctions','market',
  ]);

  // Known UK cities/towns for location detection
  const knownLocations = new Set([
    'london','manchester','birmingham','leeds','sheffield','liverpool','bristol','newcastle','nottingham',
    'cardiff','edinburgh','glasgow','belfast','bradford','leicester','coventry','hull','wolverhampton',
    'stoke','derby','swansea','southampton','portsmouth','plymouth','exeter','reading','oxford','cambridge',
    'brighton','bournemouth','bath','york','chester','lancaster','durham','norwich','ipswich','luton',
    'sunderland','middlesbrough','blackpool','bolton','burnley','rochdale','wigan','warrington','crewe',
    'gloucester','cheltenham','swindon','taunton','peterborough','northampton','lincoln','doncaster',
    'halifax','huddersfield','wakefield','barnsley','rotherham','harrogate','scarborough','carlisle',
    'preston','accrington','salford','oldham','stockport','macclesfield','stafford','tamworth',
    'shrewsbury','telford','hereford','worcester','redditch','nuneaton','rugby','solihull',
    'walsall','dudley','kidderminster','chesterfield','mansfield','grantham','loughborough','corby',
    'kettering','wellingborough','buxton','matlock','colchester','chelmsford','southend','basildon',
    'stevenage','watford','hertford','hastings','eastbourne','crawley','chichester',
    'basingstoke','winchester','folkestone','margate','dover','ashford','woking','guildford','maidstone',
    'canterbury','tunbridge','chatham','dartford','gravesend','poole','weymouth','dorchester','barnstaple',
    'yeovil','bridgwater','salisbury','chippenham','truro','penzance','newquay','falmouth',
    'carmarthen','wrexham','bangor','newport','llandudno','aberystwyth','barry','bridgend','neath',
    'llanelli','haverfordwest','pembroke','brecon','aberdeen','dundee','inverness','stirling','perth',
    'falkirk','paisley','kilmarnock','ayr','dumfries','dunfermline','livingston',
    'croydon','bromley','sutton','kingston','richmond','ealing','hounslow','brent','harrow','barnet',
    'enfield','brixton','peckham','hackney','islington','camden','greenwich','lewisham','southwark',
    'lambeth','wandsworth','tottenham','stratford','ilford','romford','dagenham','woolwich','deptford',
  ]);

  const words = q.split(/\s+/).filter(w => w.length > 1);
  const consumed = new Set();
  for (const word of words) {
    const w = word.replace(/[^a-z0-9-]/g, '');
    if (!w) continue;
    if (w === 'freehold' && !result.filters.tenure) { result.filters.tenure = 'Freehold'; consumed.add(word); }
    else if (w === 'leasehold' && !result.filters.tenure) { result.filters.tenure = 'Leasehold'; consumed.add(word); }
    else if (w === 'vacant') { result.softFilters.vacant = true; consumed.add(word); }
    else if (w === 'unsold' || w === 'failed') { result.filters.statusOverride = 'unsold'; consumed.add(word); }
    else if (w === 'development') { result.freeText.push(w); consumed.add(word); }
    else if (w === 'hmo') { result.freeText.push(w); consumed.add(word); }
    else if (w === 'repossession' || w === 'repossessed' || w === 'receivership') { result.freeText.push(w); consumed.add(word); }
    else if (w === 'yield') { result.filters.sortBy = result.filters.sortBy || 'yield'; consumed.add(word); }
    else if (propTypes[w] !== undefined) { if (propTypes[w]) result.softFilters.prop_type = propTypes[w]; consumed.add(word); }
    else if (conditionWords[w] && !result.softFilters.condition) { result.softFilters.condition = conditionWords[w]; consumed.add(word); }
    else if (knownLocations.has(w)) { result.locationTerms.push(w); consumed.add(word); }
    // Postcode prefix (e.g. BS1, M1, LS2)
    else if (/^[a-z]{1,2}\d{1,2}[a-z]?$/i.test(w)) { result.locationTerms.push(w.toUpperCase()); consumed.add(word); }
    // Intent/filler words — strip from SQL, pass context to Gemini
    else if (intentWords.has(w)) { result.intentWords.push(w); consumed.add(word); }
  }

  // Remaining unconsumed words → freeText for full-text search (NOT location)
  for (const word of words) {
    if (consumed.has(word)) continue;
    const w = word.replace(/[^a-z0-9-]/g, '');
    if (!w || w.length < 3) continue;
    result.freeText.push(w);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// SMART SEARCH: Column-filtered database query + AI analysis
// ═══════════════════════════════════════════════════════════════
app.post('/api/smart-search', async (req, res) => {
  const { query, soldFilter } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Missing search query' });

  // Authenticate user
  const user = await validateUserFromReq(req);

  // Anonymous users cannot use AI search at all — must sign up
  if (!user) {
    return res.status(403).json({ error: 'premium_required', message: 'Sign up for free to get 5 AI searches per day, or upgrade to Pro for unlimited.' });
  }

  // ── Rate limiting (free: 5/day, premium/trial: unlimited) ──
  const searchLimit = getAISearchLimit(user);
  const searchToday = new Date().toISOString().slice(0, 10);
  let searchesUsed = 0;
  const _searchIp = req.ip || 'unknown';
  const _searchKey = `aisearch:${_searchIp}`;

  if (searchLimit !== Infinity) {
    if (user) {
      const userSearchDate = user.ai_searches_date ? new Date(user.ai_searches_date).toISOString().slice(0, 10) : null;
      if (userSearchDate === searchToday) searchesUsed = user.ai_searches_today || 0;
      if (searchesUsed >= searchLimit) {
        return res.status(429).json({
          error: 'rate_limited',
          message: `You've used all ${searchLimit} AI searches for today. Upgrade to Pro for unlimited.`,
          searchesUsed, searchLimit,
        });
      }
    } else {
      try {
        const { data: sr } = await supabase.from('rate_limits').select('requests').eq('ip', _searchKey).eq('date', searchToday).single();
        searchesUsed = sr?.requests || 0;
      } catch { /* no row yet */ }
      if (searchesUsed >= searchLimit) {
        return res.status(429).json({
          error: 'rate_limited',
          message: `You've used all ${searchLimit} free AI searches for today. Sign up for 10 per day!`,
          searchesUsed, searchLimit, signup_prompt: true,
        });
      }
    }
  }

  // Helper: increment search counter AFTER successful response
  async function incrementSearchCounter() {
    try {
      if (user) {
        await supabase.from('users').update({ ai_searches_today: searchesUsed + 1, ai_searches_date: searchToday }).eq('id', user.id);
      } else {
        const { data: sr } = await supabase.from('rate_limits').select('requests').eq('ip', _searchKey).eq('date', searchToday).single();
        if (sr) { await supabase.from('rate_limits').update({ requests: (sr.requests || 0) + 1 }).eq('ip', _searchKey).eq('date', searchToday); }
        else { await supabase.from('rate_limits').insert({ ip: _searchKey, date: searchToday, requests: 1 }); }
      }
      searchesUsed += 1;
    } catch { /* non-critical */ }
  }

  const presetSlug = isPresetQuery(query);
  const sf = soldFilter || 'all';

  // ── Deterministic preset fast path — no AI needed ──
  // Presets like "Best scoring deals", "Under £100k", "Vacant" etc. can be resolved
  // by filtering/sorting on precomputed lot fields. Reads from lots table (single source of truth).
  const presetFilter = presetSlug ? PRESET_FILTERS[presetSlug] : null;
  if (presetFilter) {
    try {
      // Query lots table directly — get all lots from active catalogues
      const { data: activeCatalogues } = await supabase
        .from('cached_analyses')
        .select('house, url')
        .gt('expires_at', new Date().toISOString());

      if (!activeCatalogues || activeCatalogues.length === 0) {
        await incrementSearchCounter();
        return res.json({ results: [], report: 'No cached auction data available. Please analyse some auction catalogues first.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
      }

      const activeUrls = [...new Set(activeCatalogues.map(c => c.url))];

      // Build status filter at DB level
      let dbQuery = supabase.from('lots').select(LOTS_SELECT).in('catalogue_url', activeUrls);
      if (sf === 'available') dbQuery = dbQuery.or('status.eq.available,status.is.null');
      else if (sf === 'sold') dbQuery = dbQuery.in('status', ['sold', 'stc', 'withdrawn']);
      else if (sf === 'unsold') dbQuery = dbQuery.eq('status', 'unsold');
      else if (sf === 'stc') dbQuery = dbQuery.eq('status', 'stc');
      else if (sf === 'withdrawn') dbQuery = dbQuery.eq('status', 'withdrawn');
      else if (sf !== 'everything') dbQuery = dbQuery.or('status.eq.available,status.eq.unsold,status.is.null');

      dbQuery = dbQuery.order('score', { ascending: false, nullsFirst: false }).limit(2000);
      const { data: lotRows } = await dbQuery;

      if (!lotRows || lotRows.length === 0) {
        await incrementSearchCounter();
        return res.json({ results: [], report: 'No lots found matching criteria.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
      }

      const allLots = lotRows.map(dbRowToFrontendLot);
      const sources = [];
      const sourceMap = {};
      for (const c of activeCatalogues) {
        if (!sourceMap[c.url]) { sourceMap[c.url] = { house: c.house, url: c.url, count: 0 }; sources.push(sourceMap[c.url]); }
      }
      for (const lot of allLots) {
        if (sourceMap[lot._sourceUrl]) sourceMap[lot._sourceUrl].count++;
      }

      // Apply preset filter and sort
      const matchingLots = allLots.filter(presetFilter.filter);
      matchingLots.sort(presetFilter.sort);

      const report = presetFilter.report(matchingLots.length, allLots.length);

      log.info('smart_search_deterministic', { preset: presetSlug, matches: matchingLots.length, total: allLots.length });
      logActivityEvent('smart_search', { query, results_count: matchingLots.length, deterministic: true }, user?.email, getClientIP(req));

      await incrementSearchCounter();
      return res.json({
        results: matchingLots,
        report,
        sources,
        totalSearched: allLots.length,
        searchesUsed, searchLimit,
      });
    } catch (err) {
      log.warn('Deterministic preset search failed, falling through to AI search', { preset: presetSlug, error: err.message });
      // Fall through to Gemini-based search below
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    log.warn('smart-search: GEMINI_API_KEY not set');
    return res.status(500).json({ error: 'key_missing', message: 'AI search is not configured — GEMINI_API_KEY is missing.' });
  }
  if (creditExhausted) {
    const exhaustedAgo = creditExhaustedAt ? Math.round((Date.now() - creditExhaustedAt) / 60000) : '?';
    log.warn('smart-search: blocked by creditExhausted flag', { exhaustedMinutesAgo: exhaustedAgo });
    return res.status(503).json({ error: 'ai_quota_exhausted', message: `Gemini API rate limit hit ${exhaustedAgo}min ago. Auto-resets after 1 hour. Try again soon.`, exhaustedMinutesAgo: exhaustedAgo });
  }
  const keyPrefix = (process.env.GEMINI_API_KEY || '').substring(0, 10);
  log.info('smart-search pre-flight', { tier: 'fast', keyPrefix: keyPrefix + '...', query: query.substring(0, 60) });

  try {
    // ═══════════════════════════════════════════════════════════
    // LAYER 1: Parse query into structured column filters
    // ═══════════════════════════════════════════════════════════
    const sqParsed = parseSmartSearchQuery(query);
    log.info('smart-search parsed', sqParsed);

    // ── Get active catalogue URLs for freshness gate ──
    const { data: activeCatalogues } = await supabase
      .from('cached_analyses')
      .select('url, house')
      .gt('expires_at', new Date().toISOString());

    if (!activeCatalogues || activeCatalogues.length === 0) {
      await incrementSearchCounter();
      return res.json({ results: [], report: 'No active auction data available.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
    }
    const activeUrls = [...new Set(activeCatalogues.map(c => c.url))];

    // ── Build lots query with column filters ──
    let dbQuery = supabase.from('lots').select(LOTS_SELECT);
    dbQuery = dbQuery.in('catalogue_url', activeUrls);

    // Status: query-level override ("unsold Bristol") takes priority over dropdown filter
    const effectiveSold = sqParsed.filters.statusOverride || sf;
    if (effectiveSold === 'available') dbQuery = dbQuery.or('status.eq.available,status.is.null');
    else if (effectiveSold === 'sold') dbQuery = dbQuery.in('status', ['sold', 'stc', 'withdrawn']);
    else if (effectiveSold === 'unsold') dbQuery = dbQuery.eq('status', 'unsold');
    else if (effectiveSold === 'stc') dbQuery = dbQuery.eq('status', 'stc');
    else if (effectiveSold === 'withdrawn') dbQuery = dbQuery.eq('status', 'withdrawn');
    else if (effectiveSold !== 'everything') dbQuery = dbQuery.or('status.eq.available,status.eq.unsold,status.is.null');

    // ── Hard filters: price, location, tenure, beds — things the user definitely wants to constrain ──
    if (sqParsed.filters.tenure) dbQuery = dbQuery.ilike('tenure', sqParsed.filters.tenure);
    if (sqParsed.filters.maxPrice) dbQuery = dbQuery.lte('price', sqParsed.filters.maxPrice);
    if (sqParsed.filters.minPrice) dbQuery = dbQuery.gte('price', sqParsed.filters.minPrice);
    if (sqParsed.filters.beds) dbQuery = dbQuery.gte('beds', sqParsed.filters.beds);
    if (sqParsed.filters.condition) dbQuery = dbQuery.in('condition', sqParsed.filters.condition);

    // Location: address ILIKE for city/town names
    for (const loc of sqParsed.locationTerms) {
      dbQuery = dbQuery.ilike('address', `%${loc}%`);
    }
    // Region: postcode prefix matching (e.g. "South West" → BS, BA, EX, GL, PL, etc.)
    if (sqParsed.filters.regionPostcodes) {
      const pcOr = sqParsed.filters.regionPostcodes.map(p => `postcode.ilike.${p}%`).join(',');
      dbQuery = dbQuery.or(pcOr);
    }

    // ── Concept-based broadening — build OR conditions for semantic intent ──
    const conceptOrClauses = [];
    for (const concept of sqParsed.concepts) {
      if (concept === 'multi_unit_freehold') {
        // A "block of flats" could be listed as any prop_type, but will have units > 1 or
        // mention flats/apartments in search_text. Tenure freehold is handled as hard filter above.
        conceptOrClauses.push('units.gt.1');
        conceptOrClauses.push('title_split.eq.true');
        conceptOrClauses.push('search_text.ilike.%flats%');
        conceptOrClauses.push('search_text.ilike.%apartments%');
        conceptOrClauses.push('search_text.ilike.%block%');
        conceptOrClauses.push('search_text.ilike.%units%');
        conceptOrClauses.push('prop_type.eq.flat');
      } else if (concept === 'title_split_potential') {
        conceptOrClauses.push('title_split.eq.true');
        conceptOrClauses.push('units.gt.1');
        conceptOrClauses.push('search_text.ilike.%title split%');
        conceptOrClauses.push('search_text.ilike.%flats%');
        conceptOrClauses.push('search_text.ilike.%block%');
      } else if (concept === 'hmo_conversion') {
        conceptOrClauses.push('search_text.ilike.%hmo%');
        conceptOrClauses.push('beds.gte.4');
        conceptOrClauses.push('search_text.ilike.%conversion%');
      } else if (concept === 'development') {
        conceptOrClauses.push('search_text.ilike.%development%');
        conceptOrClauses.push('search_text.ilike.%planning%');
        conceptOrClauses.push('prop_type.eq.land');
        conceptOrClauses.push('deal_type.ilike.%development%');
      } else if (concept === 'flip') {
        conceptOrClauses.push('condition.in.(needs work,poor)');
        conceptOrClauses.push('below_market.gt.10');
        conceptOrClauses.push('search_text.ilike.%modernisation%');
        conceptOrClauses.push('search_text.ilike.%refurb%');
      } else if (concept === 'buy_to_let') {
        conceptOrClauses.push('est_gross_yield.gt.5');
        conceptOrClauses.push('search_text.ilike.%tenant%');
        conceptOrClauses.push('search_text.ilike.%rental%');
        conceptOrClauses.push('search_text.ilike.%let%');
      } else if (concept === 'deal_stack') {
        conceptOrClauses.push('title_split.eq.true');
        conceptOrClauses.push('condition.in.(needs work,poor)');
        conceptOrClauses.push('below_market.gt.15');
      }
    }

    // ── Soft filters — OR-based signals that widen the net, not hard constraints ──
    // These get added to the concept OR clauses so the DB returns candidates matching ANY signal
    const softOrClauses = [];
    if (sqParsed.softFilters.title_split) softOrClauses.push('title_split.eq.true', 'search_text.ilike.%title split%', 'units.gt.1');
    if (sqParsed.softFilters.vacant) softOrClauses.push('vacant.eq.true', 'search_text.ilike.%vacant%');
    if (sqParsed.softFilters.prop_type) softOrClauses.push(`prop_type.eq.${sqParsed.softFilters.prop_type}`, `search_text.ilike.%${sqParsed.softFilters.prop_type}%`);
    if (sqParsed.softFilters.condition) {
      softOrClauses.push(`condition.in.(${sqParsed.softFilters.condition.join(',')})`);
      softOrClauses.push('search_text.ilike.%refurb%', 'search_text.ilike.%modernisation%');
    }

    // Combine concept + soft clauses into one big OR
    const allOrClauses = [...conceptOrClauses, ...softOrClauses];
    if (allOrClauses.length > 0) {
      dbQuery = dbQuery.or(allOrClauses.join(','));
    }

    // Full-text search for remaining unstructured terms (use OR not AND for broader results)
    if (sqParsed.freeText.length > 0) {
      const tsTerms = sqParsed.freeText.map(t => t.replace(/[^a-z0-9]/gi, '')).filter(Boolean);
      if (tsTerms.length) dbQuery = dbQuery.textSearch('search_vector', tsTerms.join(' | '));
    }

    // Sort by yield if requested, otherwise by score
    const sortCol = sqParsed.filters.sortBy === 'yield' ? 'est_gross_yield' : 'score';
    dbQuery = dbQuery.order(sortCol, { ascending: false, nullsFirst: false }).limit(500);
    const { data: lotRows, error: lotErr } = await dbQuery;

    // ── Also include persisted unsold lots from expired catalogues (30-day window) ──
    let unsoldExtra = [];
    if (effectiveSold === 'unsold' || effectiveSold === 'all' || sf === 'everything') {
      const unsoldCutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      let unsoldQuery = supabase.from('lots').select(LOTS_SELECT)
        .in('status', ['unsold', 'withdrawn'])
        .gte('auction_date', unsoldCutoff);
      // Apply same hard filters to unsold lots
      if (sqParsed.filters.tenure) unsoldQuery = unsoldQuery.ilike('tenure', sqParsed.filters.tenure);
      if (sqParsed.filters.maxPrice) unsoldQuery = unsoldQuery.lte('price', sqParsed.filters.maxPrice);
      if (sqParsed.filters.minPrice) unsoldQuery = unsoldQuery.gte('price', sqParsed.filters.minPrice);
      for (const loc of sqParsed.locationTerms) unsoldQuery = unsoldQuery.ilike('address', `%${loc}%`);
      if (sqParsed.filters.regionPostcodes) unsoldQuery = unsoldQuery.or(sqParsed.filters.regionPostcodes.map(p => `postcode.ilike.${p}%`).join(','));
      // Apply same concept/soft OR clauses
      if (allOrClauses.length > 0) unsoldQuery = unsoldQuery.or(allOrClauses.join(','));
      unsoldQuery = unsoldQuery.order(sortCol, { ascending: false, nullsFirst: false }).limit(200);
      const { data: unsoldRows } = await unsoldQuery;
      unsoldExtra = unsoldRows || [];
    }

    if (lotErr) {
      log.error('smart-search lots query failed', { error: lotErr.message });
      return res.status(500).json({ error: 'db_error', message: 'Database query failed.' });
    }

    // Merge active + persisted unsold, dedup by URL
    const allRows = [...(lotRows || []).map(dbRowToFrontendLot), ...unsoldExtra.map(dbRowToFrontendLot)];
    const dedupMap = new Map();
    for (const lot of allRows) {
      const key = lot.url || `${lot._house}|${(lot.address || '').toLowerCase().replace(/[\s,]+/g, ' ').trim()}`;
      const existing = dedupMap.get(key);
      if (existing) {
        const richness = l => (l.score || 0) * 10 + (l.imageUrl ? 5 : 0) + (l.bullets?.length || 0);
        if (richness(lot) > richness(existing)) dedupMap.set(key, lot);
      } else {
        dedupMap.set(key, lot);
      }
    }
    const filteredLots = [...dedupMap.values()];

    // Build sources summary
    const sourceMap = new Map();
    for (const lot of filteredLots) {
      if (!sourceMap.has(lot._sourceUrl)) sourceMap.set(lot._sourceUrl, { house: lot._house, url: lot._sourceUrl, count: 0 });
      sourceMap.get(lot._sourceUrl).count++;
    }
    const sources = [...sourceMap.values()];

    const totalSearched = filteredLots.length;
    log.info('smart-search layer1', { query, columnFilters: sqParsed.filters, softFilters: sqParsed.softFilters, concepts: sqParsed.concepts, locations: sqParsed.locationTerms, freeText: sqParsed.freeText, results: totalSearched });

    // ═══════════════════════════════════════════════════════════
    // LAYER 2: Send matching lots' search_text to Gemini
    // ═══════════════════════════════════════════════════════════
    // If column filters narrowed to 0, return early
    if (filteredLots.length === 0) {
      await incrementSearchCounter();
      const filterDesc = [
        ...sqParsed.locationTerms,
        sqParsed.softFilters.title_split ? 'title split' : '',
        sqParsed.softFilters.vacant ? 'vacant' : '',
        sqParsed.filters.tenure || '',
        sqParsed.softFilters.prop_type || '',
        sqParsed.filters.maxPrice ? `under £${sqParsed.filters.maxPrice.toLocaleString()}` : '',
        ...sqParsed.freeText,
        ...sqParsed.concepts.map(c => c.replace(/_/g, ' ')),
      ].filter(Boolean).join(', ');
      return res.json({ results: [], report: `No lots found matching: ${filterDesc}. Try broadening your search.`, sources: [], totalSearched: 0, searchesUsed, searchLimit });
    }

    // Always send to Gemini — even small sets benefit from investment commentary
    // Cap at 200 lots for Gemini context
    const geminiLots = filteredLots.slice(0, 200);
    const lotSummaries = geminiLots.map((l, i) => {
      const meta = [
        l.status && l.status !== 'available' ? `STATUS:${l.status}` : '',
        l.propType ? `Type:${l.propType}` : '',
        l.tenure ? `Tenure:${l.tenure}` : '',
        l.beds ? `${l.beds}bed` : '',
        l.condition ? `Cond:${l.condition}` : '',
        l.estGrossYield ? `Yield:${l.estGrossYield}%` : '',
        l.belowMarket ? `${l.belowMarket}%belowMkt` : '',
        l.vacant ? 'VACANT' : '',
        l.titleSplit ? 'TITLE_SPLIT' : '',
      ].filter(Boolean).join(' ');
      const context = (l._searchText || '').substring(0, 500);
      return `[${i}] ${l._house} L${l.lot}: ${l.address} | £${l.price || '?'} | Score:${l.score || 0} | ${meta} | ${context}`;
    }).join('\n');

    const soldInstruction = sf === 'available' ? '\nIMPORTANT: Showing only available (unsold) lots.' :
      sf === 'sold' ? '\nIMPORTANT: Showing sold/STC/withdrawn lots only.' :
      sf === 'unsold' ? '\nIMPORTANT: Showing unsold (failed at auction) lots only.' : '';

    // Build filter description for Gemini context
    const appliedFilters = [
      ...sqParsed.locationTerms.map(l => `location: ${l}`),
      sqParsed.filters.regionName ? `region: ${sqParsed.filters.regionName}` : '',
      sqParsed.softFilters.title_split ? 'title split potential (soft)' : '',
      sqParsed.softFilters.vacant ? 'vacant (soft)' : '',
      sqParsed.filters.tenure ? `tenure: ${sqParsed.filters.tenure}` : '',
      sqParsed.softFilters.prop_type ? `type: ${sqParsed.softFilters.prop_type} (soft)` : '',
      sqParsed.filters.beds ? `${sqParsed.filters.beds}+ beds` : '',
      sqParsed.filters.maxPrice ? `under £${sqParsed.filters.maxPrice.toLocaleString()}` : '',
      sqParsed.filters.minPrice ? `over £${sqParsed.filters.minPrice.toLocaleString()}` : '',
      (sqParsed.softFilters.condition || sqParsed.filters.condition) ? `condition: ${(sqParsed.softFilters.condition || sqParsed.filters.condition).join('/')}` : '',
      ...sqParsed.freeText.map(t => `keyword: ${t}`),
      ...sqParsed.concepts.map(c => `concept: ${c.replace(/_/g, ' ')}`),
    ].filter(Boolean);
    const filterNote = appliedFilters.length ? `\nDatabase pre-filters applied: ${appliedFilters.join(', ')}` : '';

    // Build concept explanation for Gemini
    const conceptExplanations = {
      multi_unit_freehold: 'The user wants freehold buildings containing multiple flats/units that could be sold individually — look for blocks of flats, multi-unit properties, properties with 2+ units.',
      title_split_potential: 'The user wants properties where individual units could be split onto separate titles — look for multi-unit freehold properties, blocks of flats, houses converted to flats.',
      hmo_conversion: 'The user wants properties suitable for conversion to Houses in Multiple Occupation — look for large houses (4+ beds), existing HMOs, properties with conversion potential.',
      development: 'The user wants development opportunities — look for land, properties with planning permission, sites with development potential.',
      flip: 'The user wants properties to buy, refurbish, and sell quickly — look for below market value properties in poor condition with good locations.',
      buy_to_let: 'The user wants rental investment properties — look for good yields, existing tenancies, properties in rental demand areas.',
      deal_stack: 'The user wants properties with multiple value-add angles — look for title split potential combined with refurbishment needs and below market value.',
    };
    const conceptNote = sqParsed.concepts.length > 0
      ? '\n\nSEARCH CONCEPTS:\n' + sqParsed.concepts.map(c => `- ${conceptExplanations[c] || c}`).join('\n')
      : '';

    const responseText = await callAI(`You are a UK property investment analyst. A user has searched across auction lots and the database returned ${totalSearched} candidate lots (showing top ${geminiLots.length} by score).${soldInstruction}${filterNote}${conceptNote}

Their search query: "${query}"

These lots were retrieved using broad matching to avoid missing relevant results. Your job is to:
1. CAREFULLY rank and select lots that genuinely match the user's intent — read the search_text context for each lot
2. Be generous but not indiscriminate — include lots that COULD match even if not perfectly tagged
3. Write a brief investment report (2-3 paragraphs) with actionable insights

Lots (broad database matches, sorted by score):
${lotSummaries}

Respond in this exact JSON format:
{"indices":[0,5,12],"report":"Your report here..."}

Return the indices of the best matching lots. If few lots match well, that's fine — quality over quantity. Focus your report on investment insights specific to the user's search intent.`, { tier: 'fast', maxTokens: 4000, taskType: 'search' });
    log.info('smart_search_full', { tier: 'fast', preFiltered: totalSearched, sentToAI: geminiLots.length });

    let aiParsed;
    try {
      let cleaned = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      aiParsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(cleaned);
    } catch (e) {
      console.log('Smart search JSON parse failed:', e.message, 'Raw:', responseText.substring(0, 200));
      const reportMatch = responseText.match(/"report"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
      const indicesMatch = responseText.match(/"indices"\s*:\s*\[([\d,\s]*)\]/);
      aiParsed = {
        indices: indicesMatch ? indicesMatch[1].split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)) : [],
        report: reportMatch ? reportMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : 'Search completed.'
      };
    }

    let matchingLots = (aiParsed.indices || [])
      .filter(i => i >= 0 && i < geminiLots.length)
      .map(i => geminiLots[i]);

    // Fallback: if Gemini returned nothing, return all pre-filtered lots (they already match)
    if (matchingLots.length === 0) {
      matchingLots = geminiLots;
      log.info('smart-search ai-empty-fallback', { returning: matchingLots.length });
      if (!aiParsed.report || aiParsed.report === 'Search completed.') {
        aiParsed.report = `Found ${totalSearched} lot${totalSearched !== 1 ? 's' : ''} matching "${query}". Sorted by investment score.`;
      }
    }

    // Strip _searchText from response (large, not needed by frontend)
    for (const lot of matchingLots) delete lot._searchText;

    await incrementSearchCounter();
    logActivityEvent('smart_search', { query, results_count: matchingLots.length, mode: 'db_plus_ai', preFiltered: totalSearched }, user?.email, getClientIP(req));

    return res.json({
      results: matchingLots,
      report: aiParsed.report || '',
      sources, totalSearched, searchesUsed, searchLimit,
    });
  } catch (err) {
    const msg = err.message || String(err);
    log.error('Smart search error', { error: msg, status: err.status, stack: err.stack?.split('\n').slice(0, 3).join(' | ') });
    if (err.status === 429 || /quota|rate.limit|resource.exhausted/i.test(msg)) {
      creditExhausted = true; creditExhaustedAt = Date.now();
      return res.status(503).json({ error: 'ai_quota_exhausted', message: 'AI rate limit hit. Auto-resets after 1 hour.', provider: process.env.AI_PROVIDER || 'gemini', tier: 'fast' });
    }
    if (err.status === 401 || err.status === 403 || /invalid.api.key|unauthorized|forbidden/i.test(msg)) {
      return res.status(500).json({ error: 'key_invalid', message: 'AI API key is invalid or expired. Check environment variables in Railway.', provider: process.env.AI_PROVIDER || 'gemini' });
    }
    return res.status(500).json({ error: 'api_error', message: 'Smart search failed.', detail: msg, provider: process.env.AI_PROVIDER || 'gemini', tier: 'fast' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN: Cache Status & Manual Refresh
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// API: ALL LOTS — pre-load every cached lot for frontend filtering
// ═══════════════════════════════════════════════════════════════
app.get('/api/all-lots', rateLimit(60000, 30), async (req, res) => {
  try {
    if (!supabase) return res.json({ lots: [], sources: [], stripeEnabled: STRIPE_ENABLED });

    const includePast = req.query.includePast === 'true';
    const user = await validateUserFromReq(req);

    // ── Step 1: Get active catalogue URLs from cached_analyses ──
    const { data: activeCatalogues } = await supabase
      .from('cached_analyses')
      .select('url, house, created_at')
      .gt('expires_at', new Date().toISOString());

    if (!activeCatalogues || activeCatalogues.length === 0) return res.json({ lots: [], sources: [], stripeEnabled: STRIPE_ENABLED });

    const activeUrls = [...new Set(activeCatalogues.map(c => normaliseUrl(c.url)))];

    // ── Step 2: Query individual lots via RPC (returns JSON blob — bypasses PostgREST row limit) ──
    const { data: lotRows, error: lotErr } = await supabase.rpc('get_active_lots');

    if (lotErr) {
      log.error('all-lots: get_active_lots RPC failed', { error: lotErr.message });
      return res.json({ lots: [], sources: [], stripeEnabled: STRIPE_ENABLED });
    }

    if (!lotRows || lotRows.length === 0) {
      return res.json({ lots: [], sources: [], stripeEnabled: STRIPE_ENABLED });
    }

    // ── Step 2b: Include persisted unsold lots from expired catalogues (30-day window) ──
    // This is a key Phase 4 benefit — unsold lots stay visible even after catalogue expires
    const unsoldCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: unsoldRows } = await supabase
      .from('lots')
      .select('*')
      .in('status', ['unsold', 'withdrawn'])
      .gte('auction_date', unsoldCutoff.slice(0, 10))
      .limit(1000);

    // Merge unsold lots, avoiding duplicates with active catalogue lots
    const activeLotKeys = new Set((lotRows || []).map(r => `${r.house}|${r.url}`));
    const extraUnsold = (unsoldRows || []).filter(r => !activeLotKeys.has(`${r.house}|${r.url}`));

    const allLotRows = [...(lotRows || []), ...extraUnsold];
    const rawTotal = allLotRows.length;
    log.info('all-lots query', { activeCatalogues: activeCatalogues.length, activeLots: (lotRows || []).length, persistedUnsold: extraUnsold.length, rawLotCount: rawTotal });

    // ── Step 3: Map snake_case DB columns → camelCase frontend format ──
    const lots = allLotRows.map(r => ({
      _house: r.house,
      lot: r.lot_number,
      url: r.url,
      _sourceUrl: r.catalogue_url,
      address: r.address,
      postcode: r.postcode,
      price: r.price,
      priceText: r.price_text,
      propType: r.prop_type,
      beds: r.beds,
      tenure: r.tenure,
      leaseLength: r.lease_length,
      sqft: r.sqft,
      condition: r.condition,
      imageUrl: r.image_url,
      bullets: r.bullets || [],
      units: r.units || 0,
      _auctionDate: r.auction_date,
      status: r.status,
      soldPrice: r.sold_price,
      epcRating: r.epc_rating,
      epcScore: r.epc_score,
      epcDate: r.epc_date,
      floodZone: r.flood_zone,
      floodRiskLevel: r.flood_risk,
      streetAvg: r.street_avg,
      streetSales: r.street_sales,
      streetSalesCount: r.street_sales_count,
      belowMarket: r.below_market,
      estMonthlyRent: r.est_monthly_rent,
      estAnnualRent: r.est_annual_rent,
      estGrossYield: r.est_gross_yield != null ? parseFloat(r.est_gross_yield) : null,
      score: r.score != null ? parseFloat(r.score) : null,
      scoreBreakdown: r.score_breakdown || [],
      opps: r.opps || [],
      risks: r.risks || [],
      dealType: r.deal_type,
      vacant: r.vacant,
      titleSplit: r.title_split,
    }));

    // Normalise statuses + extract lease length from bullets (handles edge cases)
    normaliseLotStatuses(lots);

    // Within-house address dedup (URL dedup handled by lots table unique constraint)
    // Group by house for address dedup (same logic as before, just no URL dedup needed)
    const lotsByHouse = new Map();
    for (const lot of lots) {
      const h = lot._house;
      if (!lotsByHouse.has(h)) lotsByHouse.set(h, []);
      lotsByHouse.get(h).push(lot);
    }

    const dedupedAll = [];
    for (const [house, houseLots] of lotsByHouse) {
      const byAddr = new Map();
      for (const lot of houseLots) {
        const normAddr = (lot.address || '').toLowerCase().replace(/[\s,]+/g, ' ').replace(/^(lot\s*\d+\s*[-:]?\s*)/i, '').trim();
        const addrKey = normAddr + '|' + (lot.price || '');
        if (normAddr.length > 5) {
          const existing = byAddr.get(addrKey);
          if (existing) {
            const richness = (l) => (l.imageUrl ? 10 : 0) + (l.bullets?.length || 0);
            if (richness(lot) > richness(existing)) byAddr.set(addrKey, lot);
          } else {
            byAddr.set(addrKey, lot);
          }
        } else {
          byAddr.set(`__short_${byAddr.size}`, lot);
        }
      }
      const deduped = [...byAddr.values()];
      const removed = houseLots.length - deduped.length;
      if (removed > 0) console.log(`Dedup ${house}: ${houseLots.length} → ${deduped.length} (removed ${removed})`);
      dedupedAll.push(...deduped);
    }

    // Build sources array — one entry per catalogue (matches old cached_analyses behavior)
    const sources = [];
    const catalogueUpdatedAt = new Map(activeCatalogues.map(c => [normaliseUrl(c.url), c.created_at]));
    const lotsByCatalogue = new Map();
    for (const lot of dedupedAll) {
      const catUrl = lot._sourceUrl;
      if (!lotsByCatalogue.has(catUrl)) lotsByCatalogue.set(catUrl, { house: lot._house, count: 0 });
      lotsByCatalogue.get(catUrl).count++;
    }
    for (const [catUrl, info] of lotsByCatalogue) {
      sources.push({ house: info.house, url: catUrl, count: info.count, updatedAt: catalogueUpdatedAt.get(catUrl) });
    }

    // Replace lots array content with deduped results
    lots.length = 0;
    lots.push(...dedupedAll);

    // ── Attach _auctionDate from calendar (DB + fallback) ──
    const urlDateMap = {};
    // Load from database calendar first
    try {
      const { data: calRows } = await supabase.from('auction_calendar').select('url, date').gte('date', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
      if (calRows) for (const a of calRows) {
        const nu = normaliseUrl(a.url);
        if (nu && a.date && (!urlDateMap[nu] || a.date < urlDateMap[nu])) urlDateMap[nu] = a.date;
      }
    } catch { /* fallback below */ }
    // Fallback calendar overlay
    for (const a of FALLBACK_CALENDAR) {
      const nu = normaliseUrl(a.url);
      if (!urlDateMap[nu] || a.date < urlDateMap[nu]) urlDateMap[nu] = a.date;
    }
    for (const lot of lots) {
      // Per-lot end date from bullets (EIG timed auctions) takes priority
      let lotEndDate = null;
      if (lot.bullets && Array.isArray(lot.bullets)) {
        for (const b of lot.bullets) {
          const m = b.match(/Auction\s*Ends?:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
          if (m) { lotEndDate = m[3] + '-' + m[2] + '-' + m[1]; break; }
        }
      }
      if (lotEndDate) {
        lot._auctionDate = lotEndDate;
      } else if (!lot._auctionDate) {
        // Fallback to calendar lookup only if lots table didn't have a date
        const su = normaliseUrl(lot._sourceUrl);
        const rawDate = urlDateMap[su] || null;
        lot._auctionDate = (rawDate && rawDate > '2098-01-01') ? null : rawDate;
      }
    }

    // ── Server-side future-only filtering (7-day grace period) ──
    if (!includePast) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const beforeFilter = lots.length;
      const filtered = lots.filter(lot => {
        if (!lot._auctionDate) return true; // Include lots with no date
        return lot._auctionDate >= cutoffStr;
      });
      const pastRemoved = beforeFilter - filtered.length;
      if (pastRemoved > 0) console.log(`Future-only filter: removed ${pastRemoved} past lots (cutoff: ${cutoffStr})`);
      lots.length = 0;
      lots.push(...filtered);
    }

    // ── Phase 3: Cross-auction dedup by normalised address (same house only) ──
    // Only dedup lots listed by the SAME house at different auction dates (e.g., timed vs live)
    // Cross-house duplicates are kept — users want to see the same property from different houses
    const crossAddrMap = new Map();
    for (const lot of lots) {
      const normAddr = (lot.address || '').toLowerCase().replace(/[\s,]+/g, ' ').replace(/^(lot\s*\d+\s*[-:]?\s*)/i, '').trim();
      if (normAddr.length <= 5) continue;
      const houseAddr = `${lot._house}|${normAddr}`;
      const entry = crossAddrMap.get(houseAddr);
      if (entry) {
        entry.count++;
        const entryDate = entry.lot._auctionDate || '9999-12-31';
        const lotDate = lot._auctionDate || '9999-12-31';
        if (lotDate < entryDate) entry.lot = lot;
      } else {
        crossAddrMap.set(houseAddr, { lot, count: 1 });
      }
    }
    const keptLots = new Set();
    const dupAddrs = new Set();
    for (const [key, entry] of crossAddrMap) {
      keptLots.add(entry.lot);
      if (entry.count > 1) dupAddrs.add(key);
    }
    const beforeCross = lots.length;
    const finalLots = lots.filter(l => {
      const normAddr = (l.address || '').toLowerCase().replace(/[\s,]+/g, ' ').replace(/^(lot\s*\d+\s*[-:]?\s*)/i, '').trim();
      if (normAddr.length <= 5) { l._alsoInFutureAuctions = false; return true; }
      const houseAddr = `${l._house}|${normAddr}`;
      if (keptLots.has(l)) { l._alsoInFutureAuctions = dupAddrs.has(houseAddr); return true; }
      return false;
    });
    const crossRemoved = beforeCross - finalLots.length;
    if (crossRemoved > 0) console.log(`Cross-auction dedup: removed ${crossRemoved} duplicate lots (same house, different dates)`);

    // Sanitise junk lots — remove non-property entries (email addresses, field labels, etc.)
    const junkAddr = /^(enquiries|info|sales|contact|admin|hello)@|^£[\d,]+|^Properties?$/i;
    const junkAddr2 = /^(Lot|View|More|See|Click|Browse)\s|^Property Type$/i;
    const beforeJunkLot = finalLots.length;
    const cleanLots = finalLots.filter(l => {
      const addr = (l.address || '').trim();
      if (addr.length < 5) return false;
      if (junkAddr.test(addr) || junkAddr2.test(addr)) return false;
      return true;
    });
    const junkLotRemoved = beforeJunkLot - cleanLots.length;
    if (junkLotRemoved > 0) console.log(`Lot sanitiser: removed ${junkLotRemoved} junk lots (non-property entries)`);

    // Sanitise image URLs — strip junk images (logos, council branding, ad trackers, placeholders)
    const junkImg = /logo|icon|\.svg|favicon|banner|flannels|kirklees|\brdw\b|council\.gov|\.gov\.uk\/|googleads|doubleclick|spacer|pixel|1x1|placeholder|no-image|noimage|spinner|badge|modal\.png|_NYC\.|_LCC\.|_BMDC\.|Unit[ie]*d?_?Utilit|Cardwells|themes\/.*assets\/images\/|download_\(\d+\)\./i;
    let imgStripped = 0;
    for (const lot of cleanLots) {
      if (lot.imageUrl && junkImg.test(lot.imageUrl)) { lot.imageUrl = undefined; imgStripped++; }
    }
    if (imgStripped > 0) console.log(`Image sanitiser: stripped ${imgStripped} junk images`);

    // Validate image URLs — must be https + known extension or CDN domain
    let imgInvalid = 0;
    for (const lot of cleanLots) {
      if (lot.imageUrl && !isValidImageUrl(lot.imageUrl)) { lot.imageUrl = undefined; imgInvalid++; }
    }
    if (imgInvalid > 0) console.log(`Image validator: rejected ${imgInvalid} invalid image URLs`);

    // Ensure every lot has a URL — fallback to catalogue page if no lot-specific link
    for (const lot of cleanLots) {
      if (!lot.url && lot._sourceUrl) lot.url = lot._sourceUrl;
    }

    // ── Diagnostic: pipeline summary ──
    log.info('all-lots pipeline', {
      rawFromDb: rawTotal,
      afterAddressDedup: dedupedAll.length,
      afterCrossAuctionDedup: finalLots.length,
      afterJunkRemoval: cleanLots.length,
      junkRemoved: junkLotRemoved,
      imgStripped
    });

    // ── Post-processing enrichment fixes ──
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const lot of cleanLots) {
      // 1. Auto-reclassify past-auction lots as "unsold" if still "available"
      if (lot._auctionDate && lot._auctionDate < todayStr &&
          (!lot.status || lot.status === 'available')) {
        lot.status = 'unsold';
      }

      // 2. Structural risk flag for ultra-low prices
      if (lot.price && lot.price < 25000 && lot.propType !== 'land' && lot.propType !== 'other') {
        if (!lot.risks) lot.risks = [];
        if (!lot.risks.some(r => /low.*price|significant works/i.test(r))) {
          lot.risks.push('Very low guide — likely significant works required');
        }
      }

      // 3. Infer propType from address/title when "other" or "unknown"
      if (!lot.propType || lot.propType === 'other' || lot.propType === 'unknown') {
        const addr = (lot.address || '').toLowerCase();
        if (/\bflat\b|\bapt\b|\bapartment\b/.test(addr)) lot.propType = 'flat';
        else if (/\bhouse\b|\bcottage\b|\bvilla\b|\blodge\b/.test(addr)) lot.propType = 'house';
        else if (/\bbungalow\b/.test(addr)) lot.propType = 'house';
        else if (/\bland\b|\bplot\b|\bgarage\b|\bparking\b|\bkiosk\b/.test(addr)) lot.propType = 'land';
        else if (/\bshop\b|\boffice\b|\bwarehouse\b|\bindustrial\b|\bhotel\b|\bpub\b/.test(addr)) lot.propType = 'commercial';
      }

      // 4. Mark fallback rent estimates so they're not confused with real data
      if (lot.estAnnualRent && lot.estMonthlyRent) {
        const defaultRent = Math.round(825 * 1.10); // VOA_RENTS._default[2] * RENT_UPLIFT._default
        if (lot.estMonthlyRent === defaultRent && !lot.beds) {
          lot._rentEstimated = true; // Signal to frontend this is a generic estimate
        }
      }

      // 5. Freehold opp tag for residential if not already present
      if (lot.tenure === 'Freehold' && ['house', 'bungalow'].includes(lot.propType)) {
        if (lot.opps && !lot.opps.includes('Freehold')) lot.opps.push('Freehold');
      }

      // 6. Days since auction failed (for unsold lots)
      if (lot.status === 'unsold' && lot._auctionDate) {
        const auctionMs = new Date(lot._auctionDate).getTime();
        if (!isNaN(auctionMs)) {
          lot.daysSinceAuction = Math.floor((Date.now() - auctionMs) / 86400000);
        }
      }
    }

    // 7. High-turnover block warning — flag addresses where same building has many sales
    const streetCounts = {};
    for (const lot of cleanLots) {
      if (!lot.streetSalesCount) continue;
      // Group by building/block — use first line of address (e.g. "123 High Street")
      const addr = (lot.address || '').split(',')[0].trim().toLowerCase();
      if (!addr) continue;
      // Extract building name/number pattern
      const buildingMatch = addr.match(/^(.+?)(?:\s+flat\s+\d+|\s+apartment\s+\d+)?$/i);
      const building = buildingMatch ? buildingMatch[1] : addr;
      if (!streetCounts[building]) streetCounts[building] = { count: 0, lots: [] };
      streetCounts[building].count += lot.streetSalesCount;
      streetCounts[building].lots.push(lot);
    }
    for (const [building, data] of Object.entries(streetCounts)) {
      if (data.count > 8) {
        for (const lot of data.lots) {
          if (!lot.risks) lot.risks = [];
          if (!lot.risks.some(r => /high.?turnover/i.test(r))) {
            lot.risks.push(`High-turnover block (${data.count} sales nearby)`);
          }
        }
      }
    }

    // Directory data: free for all, but AI analysis layer requires signup
    // Anonymous users see address/price/image/house but not scores/opps/risks/dealType
    const adminToken = req.headers['x-admin-secret'] || '';
    const isAdmin = process.env.ADMIN_SECRET && safeCompare(adminToken, process.env.ADMIN_SECRET);
    const isSignedIn = !!user || isAdmin;
    if (!isSignedIn) {
      for (const lot of cleanLots) {
        lot.score = null;
        lot.opps = [];
        lot.risks = [];
        lot.scoreBreakdown = [];
        lot.dealType = null;
        lot.condition = null;
        lot.vacant = null;
        lot.titleSplit = null;
        lot.estGrossYield = null;
        lot.anonGated = true;   // Signal to frontend to show signup prompt
        delete lot.blurred;
      }
    } else {
      for (const lot of cleanLots) { delete lot.blurred; }
    }
    // ── Load house logos from house_skills ──
    const uniqueHouses = new Set(sources.map(s => s.house));
    let houseMeta = {};
    try {
      const { data: skills } = await supabase
        .from('house_skills')
        .select('slug, logo_url')
        .not('logo_url', 'is', null);
      if (skills) {
        for (const s of skills) houseMeta[s.slug] = { logoUrl: s.logo_url };
      }
    } catch { /* non-fatal */ }

    res.json({
      lots: cleanLots,
      sources,
      houseMeta,
      houseCount: uniqueHouses.size,
      blurred: false,
      anonGated: !isSignedIn,
      stripeEnabled: STRIPE_ENABLED,
      _debug: {
        activeCatalogues: activeCatalogues.length,
        rawLotCount: rawTotal,
        afterAddressDedup: lots.length,
        afterCrossAuctionDedup: finalLots.length,
        afterJunkRemoval: cleanLots.length,
        source: 'lots_table'
      }
    });
  } catch (e) {
    log.error('All lots error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/cache-status', async (req, res) => {
  // Require admin auth to prevent internal state leakage
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('house, url, total_lots, title_splits, top_picks, under_100k, avg_yield, dev_potential, vacant_count, created_at, expires_at, scraped_with, extracted_with, ai_tier, last_scraped_at')
      .order('house');

    const allAuctions = await getCalendarAuctions();
    const ready = allAuctions.filter(a => a.catalogueReady);
    const cachedUrls = new Set((cached || []).map(c => normaliseUrl(c.url)));

    const now = new Date().toISOString();
    const activeCached = (cached || []).filter(c => c.expires_at > now);
    const expiredCached = (cached || []).filter(c => c.expires_at <= now);
    const totalLots = (cached || []).reduce((s, c) => s + (c.total_lots || 0), 0);
    const activeLots = activeCached.reduce((s, c) => s + (c.total_lots || 0), 0);
    const expiredLots = expiredCached.reduce((s, c) => s + (c.total_lots || 0), 0);
    const missingRaw = ready.filter(a => !cachedUrls.has(normaliseUrl(a.url)));
    // Dedup missing entries by house+date so each auction appears once, not once per lot URL
    const missingMap = new Map();
    for (const a of missingRaw) {
      const key = `${a.house}::${a.date}`;
      if (!missingMap.has(key)) missingMap.set(key, a);
    }
    const missing = [...missingMap.values()];

    res.json({
      summary: {
        totalCached: (cached || []).length,
        activeCached: activeCached.length,
        expiredCached: expiredCached.length,
        totalReady: ready.length,
        totalLots,
        activeLots,
        expiredLots,
        missingCount: missing.length,
      },
      cached: (cached || []).map(c => ({ ...c, _expired: c.expires_at <= now })),
      missing: missing.map(a => ({ house: a.house, url: a.url, date: a.date, status: a.status || 'upcoming' })),
    });
  } catch (e) {
    log.error('Cache status error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/refresh-cache', async (req, res) => {
  const { secret } = req.body || {};
  if (!process.env.ADMIN_SECRET || !safeCompare(secret, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  res.json({ message: 'Auto-analysis triggered. Check server logs for progress.' });
  // Run async — don't block the response
  autoAnalyseAll().catch(e => console.error('Manual refresh failed:', e));
});

// Admin: backfill images for all cached catalogues (no AI tokens used)
app.post('/api/admin/backfill-images', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    // Get active catalogues (metadata only)
    const { data: activeCats } = await supabase
      .from('cached_analyses')
      .select('url, house')
      .gt('expires_at', new Date().toISOString());

    if (!activeCats || activeCats.length === 0) return res.json({ message: 'No cached catalogues found', results: [] });

    const results = [];
    for (const entry of activeCats) {
      // Read lots from lots table
      const { data: lotRows } = await supabase
        .from('lots')
        .select(LOTS_SELECT)
        .eq('catalogue_url', entry.url);
      const lots = (lotRows || []).map(dbRowToFrontendLot);
      const missingImages = lots.filter(l => !l.imageUrl).length;
      if (missingImages === 0) {
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing: 0, gained: 0, status: 'skipped — all have images' });
        continue;
      }

      let gained = 0;

      // Step 1: Plain HTTP backfill from catalogue page (works for server-rendered sites)
      const lotsWithUrl = lots.filter(l => l.url && !l.imageUrl).length;
      if (lotsWithUrl > 0) {
        const updated = await backfillImages(entry.url, lots);
        if (updated) {
          gained += updated.filter(l => l.imageUrl).length - (lots.length - missingImages);
        }
        // Step 2: Deep backfill from individual lot pages
        const stillMissing = lots.filter(l => l.url && !l.imageUrl).length;
        if (stillMissing > 0) {
          const deepGained = await backfillImagesFromLotPages(lots);
          gained += deepGained;
        }
      }

      // Step 3: Rendered backfill — try both engines for best coverage
      const stillNoImages = lots.filter(l => !l.imageUrl).length;
      if (stillNoImages > 0 && PUPPETEER_IMAGE_HOUSES.has(entry.house)) {
        // Pass 1: Firecrawl
        if (FIRECRAWL_API_KEY && !isFcCreditExhausted()) {
          gained += await backfillImagesWithFirecrawl(entry.url, lots, entry.house);
        }
        // Pass 2: Puppeteer for remaining
        const afterFc = lots.filter(l => !l.imageUrl).length;
        if (afterFc > 0 && puppeteer) {
          gained += await backfillImagesWithPuppeteer(entry.url, lots, entry.house);
        }
      }

      if (gained > 0) {
        // Write enriched lots back to lots table
        normaliseLotStatuses(lots);
        await upsertToLotsTable(lots, entry.house, entry.url, { scrapedWith: 'image-backfill' });
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing: missingImages, gained, status: 'updated' });
      } else {
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing: missingImages, gained: 0, status: 'no matches found' });
      }
    }

    const totalGained = results.reduce((s, r) => s + r.gained, 0);
    res.json({ message: `Backfill complete. ${totalGained} images added across ${activeCats.length} catalogues.`, results });
  } catch (err) {
    log.error('Image backfill error', { error: err.message });
    res.status(500).json({ error: 'Image backfill failed. Check server logs.' });
  }
});

// Admin-only: clear cached analyses to force re-scrape
app.post('/api/admin/clear-cache', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const house = req.body?.house;
    let query;
    if (house) {
      query = supabase.from('cached_analyses').delete().eq('house', house);
    } else {
      query = supabase.from('cached_analyses').delete().neq('url', '');
    }
    const { data, error } = await query.select();
    if (error) throw error;

    const cleared = data ? data.length : 0;
    const houses = data ? [...new Set(data.map(r => r.house))].filter(Boolean) : [];
    log.info('Cache cleared', { house: house || 'ALL', cleared });
    res.json({
      message: house
        ? `Cache cleared for ${house}. ${cleared} entries deleted. Next autoAnalyseAll will re-scrape.`
        : `All cache cleared. ${cleared} entries deleted. Next autoAnalyseAll will re-scrape.`,
      cleared, houses,
    });
  } catch (err) {
    log.error('Cache clear error', { error: err.message });
    res.status(500).json({ error: 'Cache clear failed' });
  }
});

// Admin-only: rescrape a specific house (clear cache + trigger immediate re-analysis)
app.post('/api/admin/rescrape', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const { house } = req.body || {};
  if (!house) return res.status(400).json({ error: 'house slug is required' });

  try {
    // 1. Delete cached data for this house
    const { data: deleted } = await supabase
      .from('cached_analyses')
      .delete()
      .eq('house', house)
      .select('url');
    const cleared = deleted ? deleted.length : 0;

    // 2. Find calendar URLs for this house to re-scrape
    const calendar = await getAuctionCalendar();
    const urls = calendar
      .filter(a => a.houseSlug === house || (a.house || '').toLowerCase().replace(/[^a-z]/g, '') === house)
      .map(a => a.url)
      .filter(Boolean);

    // Fallback to HOUSE_ROOTS if no calendar entries
    if (urls.length === 0 && HOUSE_ROOTS[house]) {
      urls.push(HOUSE_ROOTS[house]);
    }

    if (urls.length === 0) {
      return res.json({ message: `Cache cleared (${cleared} entries) but no URLs found to rescrape for ${house}`, cleared, urls: [] });
    }

    // 3. Trigger re-analysis in background (don't block response)
    res.json({ message: `Rescraping ${house}: cleared ${cleared} cached entries, now analysing ${urls.length} URL(s)`, cleared, urls });

    for (const url of urls) {
      try {
        await autoAnalyseOne(url);
      } catch (err) {
        log.error('Rescrape autoAnalyseOne error', { house, url, error: err.message });
      }
    }
    log.info('Rescrape complete', { house, urls: urls.length });
  } catch (err) {
    log.error('Rescrape error', { house, error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Rescrape failed: ' + err.message });
  }
});

// Admin-only: GET broken extractors list
app.get('/api/admin/broken-extractors', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  res.json({
    broken: [...BROKEN_EXTRACTORS],
    count: BROKEN_EXTRACTORS.size,
  });
});

// Admin-only: POST enable/disable broken extractors
app.post('/api/admin/broken-extractors', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { house, action, reason } = req.body || {};
  if (!house || !action) {
    return res.status(400).json({ error: 'house and action (disable|enable) are required' });
  }

  if (action === 'disable') {
    BROKEN_EXTRACTORS.add(house);
    console.log(`BROKEN: Disabled extractor for ${house}${reason ? ': ' + reason : ''}`);

    // Persist to Supabase house_skills
    try {
      await supabase.from('house_skills')
        .update({ status: 'broken', notes: reason || 'Auto-disabled by audit' })
        .eq('slug', house);
    } catch (err) { console.warn('BROKEN: Failed to persist disable:', err.message); }

    // Pipeline alert
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'extractor_broken',
        severity: 'error',
        house,
        message: `Extractor disabled for ${HOUSE_DISPLAY_NAMES[house] || house}: ${reason || 'manual disable'}`,
      });
    } catch (err) { console.warn('BROKEN: Failed to send alert:', err.message); }

    res.json({ message: `Extractor for ${house} disabled`, broken: [...BROKEN_EXTRACTORS] });

  } else if (action === 'enable') {
    BROKEN_EXTRACTORS.delete(house);
    console.log(`BROKEN: Re-enabled extractor for ${house}`);

    // Persist to Supabase house_skills
    try {
      await supabase.from('house_skills')
        .update({ status: 'healthy', notes: 'Re-enabled after fix' })
        .eq('slug', house);
    } catch (err) { console.warn('BROKEN: Failed to persist enable:', err.message); }

    // Pipeline alert
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'extractor_fixed',
        severity: 'info',
        house,
        message: `Extractor re-enabled for ${HOUSE_DISPLAY_NAMES[house] || house}`,
      });
    } catch (err) { console.warn('BROKEN: Failed to send alert:', err.message); }

    res.json({ message: `Extractor for ${house} re-enabled`, broken: [...BROKEN_EXTRACTORS] });

  } else {
    res.status(400).json({ error: 'action must be "disable" or "enable"' });
  }
});

// Admin-only: test DOM extractor on a URL (diagnostics)
app.post('/api/admin/test-extractor', rateLimit(60000, 5), async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  const house = req.body.house || detectAuctionHouse(url);

  try {
    // Use Firecrawl+JSDOM (primary) or Puppeteer (fallback) to render the page
    const result = await scrapeRenderedPage(url, house);
    const html = result.html;
    const dom = new JSDOM(html, { url });
    const { document } = dom.window;

    // Check which CSS selectors match on the rendered page
    const test = sel => document.querySelectorAll(sel).length;
    const selectorMatches = {
      '.property-card': test('.property-card'), '.lot-card': test('.lot-card'),
      '.lot': test('.lot'), '.lot-panel': test('.lot-panel'),
      '.property-list-card': test('.property-list-card'), '.search-result': test('.search-result'),
      'article': test('article'), '.current-lots-single': test('.current-lots-single'),
      '.lot-item': test('.lot-item'), '[class*="property"]': test('[class*="property"]'),
      '[class*="lot"]': test('[class*="lot"]'), 'img[src]': test('img[src]'),
      'img[data-src]': test('img[data-src]'), '.swiper-slide img': test('.swiper-slide img'),
      '[data-mainpic]': test('[data-mainpic]'),
    };

    const pageTitle = document.title || '';
    dom.window.close();

    // Run the actual DOM extractor via JSDOM (pass Firecrawl images if available)
    const lots = extractWithJSDOM(html, house, url, result?.images);
    const hasImages = lots ? lots.filter(l => l.imageUrl).length : 0;
    const hasUrls = lots ? lots.filter(l => l.url && l.url !== '').length : 0;

    res.json({
      house, url, pageTitle,
      hasExtractor: !!DOM_EXTRACTORS[house],
      lotCount: lots ? lots.length : 0,
      lotsWithImages: hasImages,
      lotsWithUrls: hasUrls,
      sampleLots: lots ? lots.slice(0, 3) : [],
      selectorMatches,
      scrapedWith: FIRECRAWL_API_KEY && !isFcCreditExhausted() && !FIRECRAWL_SKIP.has(house) ? 'firecrawl' : (puppeteer ? 'puppeteer' : 'http'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, house });
  }
});

// Admin-only: analyse all catalogue-ready auctions
app.post('/api/analyse-all', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Trigger auto-analysis and wait for it to complete
  try {
    const result = await autoAnalyseAll();
    res.json(result);
  } catch (e) {
    log.error('Refresh cache error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Scrape only houses that have never been cached — much lighter than autoAnalyseAll
app.post('/api/analyse-new', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    // Get all catalogue-ready auctions
    const allAuctions = await getCalendarAuctions();
    const ready = allAuctions.filter(a => a.catalogueReady);

    // Get already-cached URLs
    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('url');
    const cachedUrls = new Set((cached || []).map(c => normaliseUrl(c.url)));

    // Filter to only uncached
    const uncached = ready.filter(a => !cachedUrls.has(normaliseUrl(a.url)));

    // Dedup by house
    const byHouse = new Map();
    for (const a of uncached) {
      if (!byHouse.has(a.house)) byHouse.set(a.house, a);
    }
    const toScrape = [...byHouse.values()];

    log.info(`ANALYSE-NEW: ${toScrape.length} uncached houses to scrape (${ready.length} total ready, ${cachedUrls.size} cached)`);
    res.json({
      message: `Scraping ${toScrape.length} new houses in background`,
      houses: toScrape.map(a => a.house),
      total: toScrape.length,
    });

    // Run in background — process in parallel batches for speed
    // With probe skip for uncached houses, each only does 1 Firecrawl call.
    // Gemini rate limit is 15 RPM but DOM-extractor houses don't need Gemini.
    const CONCURRENCY = 5;
    let done = 0, failed = 0;
    for (let i = 0; i < toScrape.length; i += CONCURRENCY) {
      const batch = toScrape.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (auction, idx) => {
          const n = i + idx + 1;
          console.log(`ANALYSE-NEW: [${n}/${toScrape.length}] ${auction.house} — ${auction.url}`);
          await autoAnalyseOne(auction.url);
          return auction.house;
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') { done++; }
        else { failed++; console.error(`ANALYSE-NEW: ✗ failed: ${r.reason?.message || r.reason}`); }
      }
      // Brief pause between batches (autoAnalyseOne has its own Gemini rate limiting)
      if (i + CONCURRENCY < toScrape.length) await new Promise(r => setTimeout(r, 1000));
    }
    console.log(`ANALYSE-NEW COMPLETE: ${done} succeeded, ${failed} failed out of ${toScrape.length}`);
  } catch (e) {
    log.error('Analyse-new error', { error: e.message });
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ═══════════════════════════════════════════════════════════════
app.get('/admin', (req, res) => {
  res.sendFile(join(__dirname, 'admin.html'));
});

// ═══════════════════════════════════════════════════════════════
// CATCH-ALL
// ═══════════════════════════════════════════════════════════════
app.get('/welcome', (req, res) => {
  res.sendFile(join(__dirname, 'welcome.html'));
});

// ═══════════════════════════════════════════════════════════════
// LEGAL PAGES
// ═══════════════════════════════════════════════════════════════
app.get('/privacy', (req, res) => {
  res.sendFile(join(__dirname, 'privacy.html'));
});
app.get('/terms', (req, res) => {
  res.sendFile(join(__dirname, 'terms.html'));
});

// ═══════════════════════════════════════════════════════════════
// BRIDGEMATCH LITE
// ═══════════════════════════════════════════════════════════════
app.get('/check', (req, res) => {
  if (process.env.UMAMI_WEBSITE_ID) {
    try {
      let html = readFileSync(join(__dirname, 'bridgematch-lite.html'), 'utf-8');
      html = html.replace('data-website-id=""', `data-website-id="${process.env.UMAMI_WEBSITE_ID}"`);
      return res.type('html').send(html);
    } catch (e) { /* fall through to sendFile */ }
  }
  res.sendFile(join(__dirname, 'bridgematch-lite.html'));
});

app.get('/api/admin/daily-stats', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data: events } = await supabase
      .from('activity_events')
      .select('action, detail, user_email')
      .gte('created_at', since);

    const rows = events || [];
    const analyses = rows.filter(r => r.action === 'analysis').length;
    const smart_searches = rows.filter(r => r.action === 'smart_search').length;
    const leads = rows.filter(r => r.action === 'lead_submit').length;
    const unique_users = new Set(rows.filter(r => r.user_email).map(r => r.user_email)).size;

    res.json({ analyses, smart_searches, leads, unique_users, total_events: rows.length });
  } catch (e) {
    log.error('Daily stats error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Per-house skill files (health dashboard) ──
app.get('/api/skills', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const { data, error } = await supabase.from('house_skills').select('*').order('slug');
    if (error) throw error;
    const skills = data || [];
    const healthy = skills.filter(s => s.status === 'healthy').length;
    const degraded = skills.filter(s => s.status === 'degraded').length;
    const broken = skills.filter(s => s.status === 'broken').length;
    res.json({ skills, summary: { total: skills.length, healthy, degraded, broken } });
  } catch (e) {
    log.error('Skills endpoint error', { error: e.message });
    res.json({ skills: [], summary: { total: 0, healthy: 0, degraded: 0, broken: 0 } });
  }
});

// ── AI cost monitoring endpoint ──
app.get('/api/admin/ai-costs', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const summary = getAICostSummary();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    let byModel = [];
    const { data, error } = await supabase
      .from('ai_usage')
      .select('provider, model, tokens_in, tokens_out, est_cost')
      .gte('created_at', todayStart.toISOString());
    if (!error && data) {
      const groups = {};
      for (const row of data) {
        const key = `${row.provider}/${row.model}`;
        if (!groups[key]) groups[key] = { provider: row.provider, model: row.model, calls: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
        groups[key].calls++;
        groups[key].tokens_in += row.tokens_in || 0;
        groups[key].tokens_out += row.tokens_out || 0;
        groups[key].cost += parseFloat(row.est_cost) || 0;
      }
      byModel = Object.values(groups);
    }
    res.json({
      dailyTotal: summary.dailyCostTotal,
      budget: summary.budget,
      budgetExceeded: summary.budgetExceeded,
      callCount: summary.callCount,
      provider: summary.provider,
      byModel,
    });
  } catch (err) {
    console.error('AI costs endpoint error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Consolidated system health endpoint ──
app.get('/api/admin/system-health', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    // 1. Broken extractors
    const brokenExtractors = [...BROKEN_EXTRACTORS];

    // 2. AI costs
    const aiSummary = getAICostSummary();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    let byModel = {};
    const { data: aiData } = await supabase
      .from('ai_usage')
      .select('provider, model, tokens_in, tokens_out, est_cost')
      .gte('created_at', todayStart.toISOString());
    if (aiData) {
      for (const row of aiData) {
        const key = `${row.provider}/${row.model}`;
        if (!byModel[key]) byModel[key] = { calls: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
        byModel[key].calls++;
        byModel[key].tokens_in += row.tokens_in || 0;
        byModel[key].tokens_out += row.tokens_out || 0;
        byModel[key].cost += parseFloat(row.est_cost) || 0;
      }
    }
    const aiCosts = {
      dailyTotal: aiSummary.dailyCostTotal,
      budget: aiSummary.budget,
      overBudget: aiSummary.budgetExceeded,
      byModel,
      callCount: aiSummary.callCount,
    };

    // 3. Coverage — per-house lot counts and image coverage
    const [{ data: cachedMeta }, { data: lotRows }, { data: skills }] = await Promise.all([
      supabase.from('cached_analyses').select('house, expires_at, created_at'),
      supabase.from('lots').select('house, image_url, beds'),
      supabase.from('house_skills').select('slug, status, last_scraped'),
    ]);

    const skillMap = {};
    if (skills) {
      for (const s of skills) skillMap[s.slug] = s;
    }

    const now = new Date();
    const houseMap = {};
    let totalLots = 0;
    let totalImages = 0;
    let totalLotsForImg = 0;

    // Build house metadata from cached_analyses (staleness, last scraped)
    if (cachedMeta) {
      for (const row of cachedMeta) {
        const slug = row.house;
        if (!houseMap[slug]) {
          houseMap[slug] = { slug, displayName: HOUSE_DISPLAY_NAMES[slug] || slug, lotCount: 0, imageCoverage: 0, bedCoverage: 0, status: 'active', lastScraped: null, _imgCount: 0, _lotCount: 0, _bedCount: 0, _hasExpiredCache: false };
        }
        const h = houseMap[slug];
        if (row.created_at && (!h.lastScraped || row.created_at > h.lastScraped)) {
          h.lastScraped = row.created_at;
        }
        if (row.expires_at && new Date(row.expires_at) < now) {
          h._hasExpiredCache = true;
        }
      }
    }

    // Build lot coverage from lots table
    if (lotRows) {
      for (const lot of lotRows) {
        const slug = lot.house;
        if (!houseMap[slug]) {
          houseMap[slug] = { slug, displayName: HOUSE_DISPLAY_NAMES[slug] || slug, lotCount: 0, imageCoverage: 0, bedCoverage: 0, status: 'active', lastScraped: null, _imgCount: 0, _lotCount: 0, _bedCount: 0, _hasExpiredCache: false };
        }
        const h = houseMap[slug];
        h.lotCount++;
        h._lotCount++;
        totalLots++;
        totalLotsForImg++;
        if (lot.image_url) { h._imgCount++; totalImages++; }
        if (lot.beds != null) { h._bedCount++; }
      }
    }

    // Mark stale only if cache expired AND no lots (evaluated after both loops)
    for (const h of Object.values(houseMap)) {
      if (h._hasExpiredCache && h.lotCount === 0) h.status = 'stale';
    }

    const houses = Object.values(houseMap).map(h => {
      const skill = skillMap[h.slug];
      if (skill && skill.status === 'broken') h.status = 'broken';
      if (skill && skill.last_scraped) h.lastScraped = skill.last_scraped;
      h.imageCoverage = h._lotCount > 0 ? Math.round(h._imgCount / h._lotCount * 100) : 0;
      h.bedCoverage = h._lotCount > 0 ? Math.round(h._bedCount / h._lotCount * 100) : 0;
      delete h._imgCount;
      delete h._bedCount;
      delete h._lotCount;
      delete h._hasExpiredCache;
      return h;
    });

    const activeHouses = houses.filter(h => h.status === 'active').length;
    const staleHouses = houses.filter(h => h.status === 'stale').length;

    const coverage = {
      houses,
      totalHouses: houses.length,
      activeHouses,
      staleHouses,
      totalLots,
      avgImageCoverage: totalLotsForImg > 0 ? Math.round(totalImages / totalLotsForImg * 100) : 0,
      avgBedCoverage: totalLots > 0 ? Math.round(houses.reduce((s, h) => s + (h.bedCoverage * h.lotCount / 100), 0) / totalLots * 100) : 0,
      lowBedCoverageHouses: houses.filter(h => h.lotCount > 5 && h.bedCoverage < 50).map(h => ({ slug: h.slug, lots: h.lotCount, bedCoverage: h.bedCoverage + '%' })),
    };

    // 4. Pipeline health
    const pipeline = {
      firecrawl: {
        status: isFcCreditExhausted() ? 'exhausted' : isFcTemporarilyDown() ? 'down' : 'ok',
        creditsUsed: getFcCreditsUsed(),
        creditBudget: getFirecrawlStatus().monthlyBudget,
        exhausted: isFcCreditExhausted(),
      },
      gemini: {
        status: creditExhausted ? 'exhausted' : 'ok',
        exhausted: creditExhausted,
        provider: process.env.AI_PROVIDER || 'gemini',
      },
      puppeteer: {
        status: puppeteer ? 'available' : 'unavailable',
        available: !!puppeteer,
      },
      autoAnalyse: {
        running: _autoAnalysisRunning,
        lastRun: null,
        nextRun: null,
      },
    };

    res.json({ brokenExtractors, aiCosts, coverage, pipeline });
  } catch (err) {
    console.error('System health endpoint error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Missing images admin endpoint ──
app.get('/api/admin/missing-images', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }

  try {
    const houseFilter = req.query.house || '';
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    // Query lots table for lots missing images (from active catalogues)
    let lotQuery = supabase
      .from('lots')
      .select('house, lot_number, address, catalogue_url, auction_date, image_url')
      .or('image_url.is.null,image_url.eq.');

    if (houseFilter) {
      lotQuery = lotQuery.ilike('house', `%${houseFilter}%`);
    }

    // Filter to active catalogues at DB level + apply limit
    const { data: activeCats } = await supabase
      .from('cached_analyses')
      .select('url')
      .gte('expires_at', new Date().toISOString());
    const activeUrls = (activeCats || []).map(c => c.url);
    if (activeUrls.length > 0) {
      lotQuery = lotQuery.in('catalogue_url', activeUrls);
    }
    lotQuery = lotQuery.limit(2000);

    const { data: missingRows, error } = await lotQuery;
    if (error) throw error;

    const missingLots = [];
    const houseCounts = {};

    for (const row of (missingRows || [])) {
      missingLots.push({
        house: row.house,
        lotNumber: row.lot_number || null,
        address: row.address || '',
        catalogueUrl: row.catalogue_url,
        auctionDate: row.auction_date || null,
      });
      houseCounts[row.house] = (houseCounts[row.house] || 0) + 1;
    }

    // Apply pagination
    const paginated = missingLots.slice(offset, offset + limit);

    res.json({
      total: missingLots.length,
      houses: Object.keys(houseCounts).length,
      houseCounts,
      offset,
      limit,
      results: paginated,
    });
  } catch (e) {
    log.error('Missing images endpoint error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/cost-monitor', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const { data: cached } = await supabase.from('cached_analyses').select('house, expires_at');
    const now = new Date();
    const houses = cached || [];
    const freshCount = houses.filter(h => h.expires_at && new Date(h.expires_at) > now).length;
    const SKIP_PUPPETEER_LIST = ['philliparnold','knightfrank'];
    res.json({
      weeklyEstimate: {
        geminiApiCalls: apiCallCount,
        estimatedCost: 0,
        creditExhausted,
        lastResetAt: serverStartTime
      },
      cacheStats: {
        totalHouses: houses.length,
        housesWithFreshCache: freshCount,
        housesWithStaleCache: houses.length - freshCount,
        contentHashHits: hashHitCount
      },
      firecrawl: {
        enabled: !!FIRECRAWL_API_KEY,
        ...getFirecrawlStatus(),
        skipHouses: [...FIRECRAWL_SKIP],
      },
      puppeteerSkipList: SKIP_PUPPETEER_LIST,
      puppeteerAvailable: !!puppeteer,
      lookaheadLimit: MAX_AUCTIONS_PER_HOUSE,
      pageCapLimit: MAX_PUPPETEER_PAGES,
      lotsCapLimit: MAX_LOTS_PER_SCRAPE
    });
  } catch (e) {
    log.error('Cost monitor error', { error: e.message });
    res.status(500).json({ error: 'Cost monitor failed. Check server logs.' });
  }
});

app.get('/api/quality-report', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    // Get cache metadata (no lots JSONB) and lots from lots table
    const [{ data: cached }, { data: lotRows }] = await Promise.all([
      supabase.from('cached_analyses').select('house, url, expires_at, created_at, content_hash'),
      supabase.from('lots').select(LOTS_SELECT),
    ]);

    const now = new Date();
    const report = { houses: [], issues: [], summary: {} };
    let totalLots = 0, housesWithZero = 0, staleHouses = 0;

    // Group cache metadata by house
    const cacheByHouse = {};
    for (const row of (cached || [])) {
      const h = row.house || 'unknown';
      if (!cacheByHouse[h]) cacheByHouse[h] = { urls: [], isStale: true, created_at: null };
      cacheByHouse[h].urls.push(row.url);
      const isStale = row.expires_at && new Date(row.expires_at) < now;
      if (!isStale) cacheByHouse[h].isStale = false;
      if (!cacheByHouse[h].created_at || (row.created_at && new Date(row.created_at) > new Date(cacheByHouse[h].created_at))) {
        cacheByHouse[h].created_at = row.created_at;
      }
    }

    // Group lots by house
    const lotsByHouse = {};
    for (const row of (lotRows || [])) {
      const h = row.house || 'unknown';
      if (!lotsByHouse[h]) lotsByHouse[h] = [];
      lotsByHouse[h].push(row);
    }

    // Merge: all houses from cache metadata + any houses only in lots table
    const allHouses = new Set([...Object.keys(cacheByHouse), ...Object.keys(lotsByHouse)]);

    for (const house of allHouses) {
      const cache = cacheByHouse[house] || { urls: [], isStale: true, created_at: null };
      const rows = lotsByHouse[house] || [];
      const lots = rows.map(dbRowToFrontendLot);
      const isStale = cache.isStale;
      const ageHours = cache.created_at ? Math.round((now - new Date(cache.created_at)) / 3600000) : null;

      const withImage = lots.filter(l => l.imageUrl).length;
      const imgCoverage = lots.length ? Math.round((withImage / lots.length) * 100) : 0;

      totalLots += lots.length;
      if (lots.length === 0) housesWithZero++;
      if (isStale) staleHouses++;

      let fieldCoverage = null;
      try {
        ({ fieldCoverage } = validateBatch(lots, house));
      } catch (_e) { /* non-fatal */ }

      const entry = { house, lots: lots.length, images: withImage, imgCoverage, ageHours, stale: !!isStale, fieldCoverage };
      report.houses.push(entry);

      if (lots.length === 0) report.issues.push({ severity: 'critical', house, msg: 'Zero lots — extractor may be broken' });
      if (imgCoverage < 30 && lots.length > 0) report.issues.push({ severity: 'warn', house, msg: `Low image coverage: ${imgCoverage}%` });
      if (isStale) report.issues.push({ severity: 'info', house, msg: `Cache stale (${ageHours}h old)` });
    }

    report.summary = { totalHouses: allHouses.size, totalLots, housesWithZero, staleHouses };
    res.json(report);
  } catch (e) {
    log.error('Quality report error', { error: e.message });
    res.status(500).json({ error: 'Quality report failed. Check server logs.' });
  }
});


// Scraping functions (fetchPage, scrapeAllPages, scrapeAllsopApi, extractAllsopLotsFromJson,
// enrichAllsopLots, detectTotalPages, buildPageUrl, acquirePage, getBrowser, scrapeWithPuppeteer,
// extractLotsWithAI, isPdfUrl, extractLotsFromPdf, stripHtml, normaliseLotStatuses,
// backfillImages, fetchLotPage, backfillImagesFromLotPages, enrichLotsFromLotPages,
// backfillImagesWithPuppeteer, extractWithDOM) — all moved to lib/scraper.js

// ═══════════════════════════════════════════════════════════════
// ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════
const W2N = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };

function analyseLot(raw) {
  // Strip Strettons date prefix (e.g. "19 Feb 26  -  Lot 25Flat 6 Noble House...")
  let cleanAddress = raw.address;
  cleanAddress = cleanAddress.replace(/^\d{1,2}\s+\w{3}\s+\d{2}\s*-\s*(?:Lot\s*\d+)?/i, '').trim();
  const t = (raw.bullets.join(' ') + ' ' + cleanAddress).toLowerCase();
  const L = { ...raw, score: 0, opps: [], risks: [], dealType: 'Standard', propType: '', beds: null,
    tenure: '', condition: '', vacant: null, sqft: null, titleSplit: false, units: 0 };

  // PropType inference — order matters: specific residential types first, then commercial/land
  // Development sites with bed counts are residential, not land
  const hasBeds = /\d+\s*[-\s]?bed|\bone\s+bed|\btwo\s+bed|\bthree\s+bed|\bstudio/.test(t);
  const hasResidentialSignal = /\bflats?\b|\bhouse\b|\bcottage\b|\bbungalow\b|\bapartments?\b|\bmaisonette\b/.test(t);
  if (/semi[- ]?detached|terraced?|terrace house|detached house|town\s?house|end of terrace|mid[- ]terrace/.test(t)) L.propType = 'house';
  else if (/bungalow/.test(t)) L.propType = 'house';
  else if (/\bflt\b|\bflats?\b|\bapartments?\b|\bmaisonette\b/.test(t) && !/\bblock\b.*\bflats?\b|development\s+site|building\s+plot|planning\s+permission\s+for/.test(t)) L.propType = 'flat';
  else if (/\bdetached\b|period\s+property|residential\s+property|chalet|cottage|lodge|villa|mansion/.test(t)) L.propType = 'house';
  else if (/\bhouse\b/.test(t)) L.propType = 'house';
  else if (/\bshop\b|\boffice\b|\bcommercial\b|\bretail\b|\bindustrial\b|\bwarehouse\b|\bground rent\b/.test(t) && !hasResidentialSignal && !hasBeds) L.propType = 'commercial';
  else if (hasBeds && !hasResidentialSignal) L.propType = 'house'; // Bed count without type = residential
  else if (/\bland\b|\bplot\b|\bsite\b|\bchurch\b|\bhall\b|\bchapel\b/.test(t) && !hasBeds) L.propType = 'land';
  else if (/\bgarage\b|\bparking\b|lock.?up/.test(t)) L.propType = 'garage';
  else if (/\binvestment\b/.test(t) && hasBeds) L.propType = 'house'; // Residential investment
  else if (/\binvestment\b/.test(t)) L.propType = 'commercial'; // Pure investment = commercial
  else L.propType = 'other';

  // Beds — prefer structured field from Gemini, then fall back to regex
  if (raw.beds != null && typeof raw.beds === 'number' && raw.beds >= 0 && raw.beds <= 20) {
    L.beds = raw.beds;
  } else {
    const bm = t.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*[-\s]?bed/) || t.match(/(\w+)\s*[-\s]?bed/);
    if (bm) {
      // "2/3 bed" → take the higher number; "three bed" → word-to-number
      const v = (bm[2] || bm[1]).toLowerCase();
      L.beds = W2N[v] || (v.match(/^\d+$/) ? +v : null);
    }
  }
  // Cap residential bed count at 10 — higher counts are student blocks/HMOs/hotels
  if (L.beds > 10 && ['house', 'flat', 'bungalow'].includes(L.propType)) L.beds = null;
  if (/studio/.test(t) && L.beds === null) L.beds = 0;

  // Tenure — prefer structured field from Gemini, then fall back to regex
  const rawTenure = (raw.tenure || '').trim().toLowerCase();
  if (/share.?of.?freehold/.test(rawTenure)) L.tenure = 'Share of Freehold';
  else if (/freehold/.test(rawTenure) && !/leasehold/.test(rawTenure)) L.tenure = 'Freehold';
  else if (/leasehold/.test(rawTenure)) L.tenure = 'Leasehold';

  // Regex fallback on bullets + address text
  if (!L.tenure) {
    if (/share of freehold|share\s+of\s+the\s+freehold/.test(t)) L.tenure = 'Share of Freehold';
    else if (/flying freehold/.test(t)) L.tenure = 'Freehold';
    else if (/\bfreehold\b/.test(t) && !/leasehold/.test(t)) L.tenure = 'Freehold';
    else if (/long\s+lease(?:hold)?|\bleasehold\b|\blease\s+remaining\b|\byears?\s+(?:remaining|unexpired|left)\b|\b\d+\s*(?:year|yr)\s*lease\b/.test(t)) L.tenure = 'Leasehold';
  }
  // Infer from property type when tenure not stated: flats are almost always leasehold, houses freehold
  if (!L.tenure && L.propType === 'flat' && /\b\d{2,3}\s*(?:year|yr)s?\b/.test(t)) L.tenure = 'Leasehold';

  if (/derelict|dilapidated|fire damage|structurally unsound|uninhabitable|condemned/.test(t)) L.condition = 'poor';
  else if (/modernis|refurbishment|renovation|updating|in need of|improvement|for improve|requires? (?:updating|work|repair)|(?:tired|dated|worn) (?:condition|decor|throughout)|cosmetic work|stripping out|(?:complete|full|extensive) refurb|fixer.upper|requires attention/.test(t)) L.condition = 'needs work';
  else if (/good order|good decorative|well maintained|recently refurbished|well presented|good condition|excellent condition|ready to let|move.in|turnkey/.test(t)) L.condition = 'good';

  if (/vacant possession|\bvp\b|vacant property|\bvacant\b|with vacant|sold with vacant/.test(t)) L.vacant = true;
  else if (/tenant|let to|tenanted|occupied|sitting tenant|subject to tenancy|assured shorthold/.test(t)) L.vacant = false;

  const executor = /executor|probate|estate of|personal representative/.test(t);
  const receivership = /receiver|receivership|administrator|liquidator|lpa receiver/.test(t);
  const devP = /development potential|development opportunity|planning permission|pp granted|change of use|conversion potential|redevelopment|building plot/.test(t);
  const extP = /extension potential|scope to extend|subject to requi[st]i?te? consents|loft conversion|\bhmo\b|potential to extend/.test(t);

  const sm = t.match(/([\d,]+)\s*sq\s*(?:ft|feet)/);
  if (sm) L.sqft = parseInt(sm[1].replace(/,/g, ''));

  let uc = 0;
  const um = t.match(/(\d+)\s*(?:x\s*)?(?:self[- ]contained\s+)?(?:flat|apartment|unit)/); if (um) uc = Math.max(uc, +um[1]);
  const bk = t.match(/block\s+of\s+(\d+)/); if (bk) uc = Math.max(uc, +bk[1]);
  const mx = [...t.matchAll(/(\d+)\s*x\s*(?:one|two|three|1|2|3)\s*[-\s]?bed/g)];
  if (mx.length) uc = Math.max(uc, mx.reduce((s, m) => s + +m[1], 0));
  const fr = cleanAddress.toLowerCase().match(/flats?\s*([a-z])\s*[-–&]\s*([a-z])/);
  if (fr) uc = Math.max(uc, fr[2].charCodeAt(0) - fr[1].charCodeAt(0) + 1);
  const ar = cleanAddress.match(/^(\d+)\s*[-–]\s*(\d+)\s/);
  if (ar) { const d = +ar[2] - +ar[1] + 1; if (d >= 2 && d <= 20) uc = Math.max(uc, d); }
  if (/gff|fff|sff|tff/.test(cleanAddress.toLowerCase())) uc = Math.max(uc, 2);
  const apt = t.match(/(\d+)\s*(?:self[- ]contained\s+)?apartments/); if (apt) uc = Math.max(uc, +apt[1]);
  const isFH = /freehold/.test(t), hasFlats = /flats|apartments|self[- ]contained|arranged as/.test(t);
  const indivSales = /individual flat sales|individual sales/.test(t);
  if (uc >= 2 || ((isFH && hasFlats) || indivSales)) { L.titleSplit = true; L.units = uc || 2; }

  let s = 0;
  const sb = []; // scoreBreakdown: tracks each signal's contribution
  if (L.condition === 'needs work') { s += 2; sb.push({ signal: 'Needs modernisation', pts: 2 }); L.opps.push('Needs modernisation'); }
  if (L.condition === 'poor') { s += 2.5; sb.push({ signal: 'Poor condition', pts: 2.5 }); L.opps.push('Poor condition'); }
  if (executor) { s += 1.5; sb.push({ signal: 'Executor/probate', pts: 1.5 }); L.opps.push('Executor/probate'); }
  if (receivership) { s += 2; sb.push({ signal: 'Receivership', pts: 2 }); L.opps.push('Receivership'); }
  // Development potential: full score for dwellings (it's a genuine uplift signal),
  // reduced for land (it's table stakes — almost every land listing says this)
  if (devP && L.propType !== 'land') { s += 2; sb.push({ signal: 'Development potential', pts: 2 }); L.opps.push('Development potential'); }
  else if (devP && L.propType === 'land') { s += 0.5; sb.push({ signal: 'Development potential', pts: 0.5 }); L.opps.push('Development potential'); }
  if (extP) { s += 1.5; sb.push({ signal: 'Extension/HMO potential', pts: 1.5 }); L.opps.push('Extension/HMO potential'); }
  // Vacant: meaningful for dwellings (no tenant = faster refurb), not for land (land is always vacant)
  if (L.vacant && ['house', 'bungalow', 'flat'].includes(L.propType)) { s += 1; sb.push({ signal: 'Vacant', pts: 1 }); L.opps.push('Vacant'); }
  else if (L.vacant && L.propType === 'land') { L.opps.push('Vacant'); } // tag it but no score boost
  if (L.tenure === 'Freehold' && ['house', 'bungalow'].includes(L.propType)) { s += 0.5; sb.push({ signal: 'Freehold', pts: 0.5 }); L.opps.push('Freehold'); }
  // £/sqft: only meaningful for dwellings with actual floor area (not land/acreage)
  if (L.sqft && L.price && L.propType !== 'land') {
    const p = L.price / L.sqft;
    if (p < 200) { s += 2; sb.push({ signal: `£${Math.round(p)}/sqft`, pts: 2 }); L.opps.push(`£${Math.round(p)}/sqft`); }
    else if (p < 300) { s += 1; sb.push({ signal: `£${Math.round(p)}/sqft`, pts: 1 }); L.opps.push(`£${Math.round(p)}/sqft`); }
  }

  const rm = t.match(/(?:let\s+at|rent\s+of|income\s+of|producing)\s+£?([\d,]+)\s*(?:p\.?a|per\s*annum)/);
  if (rm && L.price) {
    const rent = parseInt(rm[1].replace(/,/g, '')); const gy = (rent / L.price) * 100;
    if (gy > 8) { s += 2.5; sb.push({ signal: `${gy.toFixed(1)}% GIY`, pts: 2.5 }); L.opps.push(`${gy.toFixed(1)}% GIY`); }
    else if (gy > 6) { s += 1.5; sb.push({ signal: `${gy.toFixed(1)}% GIY`, pts: 1.5 }); L.opps.push(`${gy.toFixed(1)}% GIY`); }
  }

  if (/(?:4|5|6)\s*week\s*completion|six week/.test(t)) { s += 0.5; sb.push({ signal: 'Quick completion', pts: 0.5 }); L.opps.push('Quick completion'); }
  if (/by order of/.test(t) && !executor && !receivership) { s += 0.5; sb.push({ signal: 'Motivated seller', pts: 0.5 }); L.opps.push('Motivated seller'); }
  if (L.titleSplit) { s += 1; sb.push({ signal: `Title split (${L.units} units)`, pts: 1 }); L.opps.push(`Title split (${L.units} units)`); }

  if (/sitting tenant/.test(t)) { s -= 2; sb.push({ signal: 'Sitting tenant', pts: -2 }); L.risks.push('Sitting tenant'); }
  if (/knotweed/.test(t)) { s -= 2; sb.push({ signal: 'Knotweed', pts: -2 }); L.risks.push('Knotweed'); }
  if (/flying freehold/.test(t)) { s -= 1; sb.push({ signal: 'Flying freehold', pts: -1 }); L.risks.push('Flying freehold'); }
  if (/non[- ]?standard|timber frame|prefab|prc/.test(t)) { s -= 1; sb.push({ signal: 'Non-std construction', pts: -1 }); L.risks.push('Non-std construction'); }
  if (/flood risk|flood zone/.test(t)) { s -= 1; sb.push({ signal: 'Flood risk', pts: -1 }); L.risks.push('Flood risk'); }
  if (/asbestos|contamination/.test(t)) { s -= 1; sb.push({ signal: 'Contamination', pts: -1 }); L.risks.push('Contamination'); }
  if (/grade ii|listed/.test(t)) L.risks.push('Listed building');
  if (!L.price) L.risks.push('Guide TBA');
  L.scoreBreakdown = sb;

  if (devP) L.dealType = 'Development';
  else if ((L.condition === 'needs work' || L.condition === 'poor') && extP) L.dealType = 'Refurb+Extend';
  else if (L.condition === 'needs work' || L.condition === 'poor') L.dealType = 'Refurb';
  else if (L.titleSplit) L.dealType = 'Title Split';
  else if (executor || receivership) L.dealType = 'Motivated';
  else L.dealType = 'Standard';

  L.score = Math.max(0, Math.min(10, Math.round(s * 10) / 10));
  return L;
}


// ═══════════════════════════════════════════════════════════════
// STARTUP SYNC: Calendar + house-name migrations
// ═══════════════════════════════════════════════════════════════
const HOUSE_NAME_MIGRATIONS = {
  'SDL Auctions': 'BTG Eddisons',
};

async function syncCalendarAndHouseNames() {
  if (!supabase) return;
  try {
    // 1) Upsert all FALLBACK_CALENDAR entries into auction_calendar
    const rows = FALLBACK_CALENDAR.map(a => ({
      house: a.house, house_slug: a.houseSlug, logo: a.logo,
      date: a.date, date_end: a.dateEnd || null, title: a.title,
      lots: a.lots || null, url: a.url, location: a.location,
      type: a.type, status: a.status, catalogue_ready: a.catalogueReady,
      updated_at: new Date().toISOString(),
    }));
    const { error: calErr } = await supabase.from('auction_calendar').upsert(rows, { onConflict: 'url,date' });
    if (calErr) console.error('Calendar sync error:', calErr.message);
    else console.log(`Calendar sync: upserted ${rows.length} entries`);

    // 2) Fix stale house names in cached_analyses
    for (const [oldName, newName] of Object.entries(HOUSE_NAME_MIGRATIONS)) {
      const { data, error } = await supabase
        .from('cached_analyses')
        .update({ house: newName })
        .eq('house', oldName);
      if (error) console.error(`House rename ${oldName} → ${newName} error:`, error.message);
      else console.log(`House rename: ${oldName} → ${newName}`);
    }

    // 3) Purge stale calendar entries for past dates
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from('auction_calendar').delete().lt('date', today);
    console.log('Calendar sync: purged past-date entries');
  } catch (e) {
    console.error('syncCalendarAndHouseNames error:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// HARNESS ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/house-health', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(getAllHealth());
});

app.get('/api/discovery/candidates', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const candidates = await getDiscoveryQueue();
  res.json({ candidates, budget: getDiscoveryBudget() });
});

app.post('/api/discovery/approve', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  const ok = await approveCandidate(url);
  res.json({ approved: ok });
});

app.get('/api/enrichment/report', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const house = req.query.house || null;
  // Get lots from lots table to generate report
  if (house) {
    const { data: lotRows } = await supabase.from('lots')
      .select(LOTS_SELECT)
      .eq('house', house);
    if (lotRows && lotRows.length > 0) {
      return res.json(getEnrichmentReport(lotRows.map(dbRowToFrontendLot), house));
    }
  }
  res.json({ message: 'Provide ?house=slug for per-house report' });
});

app.get('/api/manager/report', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const report = getManagerReport();
  res.json(report || { message: 'No manager cycle has run yet' });
});

app.post('/api/manager/cycle', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const report = await runManagerCycle();
  res.json(report);
});

app.post('/api/manager/config', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.body?.secret || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { config } = req.body || {};
  if (!config) return res.status(400).json({ error: 'config object required' });
  const updated = setManagerConfig(config);
  res.json(updated);
});

app.get('/api/harness/status', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const health = getAllHealth();
  const healthCounts = { healthy: 0, degraded: 0, broken: 0 };
  for (const h of Object.values(health)) {
    if (h.status === 'broken') healthCounts.broken++;
    else if (h.status === 'degraded') healthCounts.degraded++;
    else healthCounts.healthy++;
  }
  res.json({
    health: healthCounts,
    houses: Object.keys(health).length,
    manager: getManagerReport() || { message: 'No cycle yet' },
    managerConfig: getManagerConfig(),
    discoveryBudget: getDiscoveryBudget(),
  });
});

// Sentry error handler — must be after all routes, before app.listen
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.listen(PORT, () => {
  log.info('server_start', { port: PORT });
  if (!process.env.SUPABASE_URL) log.warn('missing_env', { var: 'SUPABASE_URL' });
  if (!process.env.SUPABASE_SERVICE_KEY) log.warn('missing_env', { var: 'SUPABASE_SERVICE_KEY' });
  if (!process.env.GEMINI_API_KEY) log.warn('missing_env', { var: 'GEMINI_API_KEY' });

  // ── Harness manager initialization (after HOUSE_ROOTS + DOM_EXTRACTORS available) ──
  initManager({
    supabase, callAI,
    houseRoots: HOUSE_ROOTS, domExtractors: DOM_EXTRACTORS,
    healBrokenHouse,
    getCircuitBreakers,
  });

  // ── Ensure enrichment_cache table exists ──
  setTimeout(() => ensureEnrichmentCacheTable(), 3000);

  // ── Sync calendar + fix stale house names on startup ──
  setTimeout(() => syncCalendarAndHouseNames(), 5000);

  // ── Auto-analyse all catalogue-ready auctions ──
  // Run 30s after startup (let everything initialise), then every 6 hours
  setTimeout(() => autoAnalyseAll(), 30000);
  setInterval(() => autoAnalyseAll(), 6 * 60 * 60 * 1000);

  // ── Data hygiene engine ──
  // Run 2 min after startup, then every 30 min. No excuses — every lot gets
  // price, postcode, EPC, flood, comps, yield as fast as possible.
  setTimeout(() => runEnrichmentWave(), 2 * 60 * 1000);
  setInterval(() => runEnrichmentWave(), 30 * 60 * 1000);

  // ── Daily analytics snapshot at midnight ──
  function scheduleNextMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 5, 0); // 00:00:05 tomorrow
    const ms = midnight.getTime() - now.getTime();
    setTimeout(async () => {
      try { await saveDailySnapshot(); console.log('ANALYTICS: Midnight snapshot saved'); }
      catch (e) { console.warn('ANALYTICS: Midnight snapshot failed:', e.message); }
      scheduleNextMidnight(); // schedule the next one
    }, ms);
    console.log(`ANALYTICS: Next midnight snapshot in ${Math.round(ms / 60000)} minutes`);
  }
  scheduleNextMidnight();
});

// ═══════════════════════════════════════════════════════════════
// AUTO-ANALYSIS: Pre-analyse all catalogue-ready auctions
// ═══════════════════════════════════════════════════════════════
let _autoAnalysisRunning = false;
let creditExhausted = false;
let creditExhaustedAt = 0;
// Auto-reset creditExhausted after 1 hour (Gemini quotas reset at different intervals)
setInterval(() => {
  if (creditExhausted && Date.now() - creditExhaustedAt > 3600000) {
    creditExhausted = false;
    creditExhaustedAt = 0;
    console.log('Gemini credit exhaustion flag auto-cleared (1h TTL)');
  }
  if (isFcCreditExhausted() && Date.now() - getFcExhaustedAt() > 3600000) {
    setFcCreditExhausted(false);
    setFcExhaustedAt(0);
    console.log('Firecrawl credit exhaustion flag auto-cleared (1h TTL)');
  }
  if (isFcTemporarilyDown() && Date.now() - getFcDownAt() > 600000) {
    setFcTemporarilyDown(false);
    setFcDownAt(0);
    setFcConsecutive5xx(0);
    console.log('Firecrawl temporarily-down flag auto-cleared (10min TTL)');
  }
}, 300000);
let apiCallCount = 0;
let hashHitCount = 0;
const serverStartTime = new Date().toISOString();

// Initialize enrichment module with supabase dependency
initEnrichment({ supabase });

// Initialize scraper with server-level dependencies
initScraper({
  callAI,
  getCreditExhausted: () => creditExhausted,
  setCreditExhausted: (v) => { creditExhausted = v; },
  setCreditExhaustedAt: (v) => { creditExhaustedAt = v; },
  getApiCallCount: () => apiCallCount,
  incApiCallCount: () => { apiCallCount++; },
  extractPostcode,
});

// ── Concurrency utilities for wave-based pipeline ──
function createSemaphore(max) {
  let active = 0;
  const queue = [];
  return {
    async acquire() {
      if (active < max) { active++; return; }
      await new Promise(resolve => queue.push(resolve));
      active++;
    },
    release() {
      active--;
      if (queue.length > 0) queue.shift()();
    },
  };
}

async function runWave(auctions, concurrency, label, processFn) {
  if (auctions.length === 0) return { analysed: 0, skipped: 0, failed: 0 };
  console.log(`WAVE [${label}]: ${auctions.length} houses at concurrency ${concurrency}`);
  const sem = createSemaphore(concurrency);
  const results = await Promise.allSettled(
    auctions.map(async (auction) => {
      await sem.acquire();
      try {
        return await processFn(auction);
      } finally {
        sem.release();
      }
    })
  );
  let analysed = 0, skipped = 0, failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value === 'analysed') analysed++;
      else if (r.value === 'skipped') skipped++;
      else if (r.value === 'failed') failed++;
    } else {
      failed++;
    }
  }
  console.log(`WAVE [${label}]: done — ${analysed} analysed, ${skipped} cached, ${failed} failed`);
  return { analysed, skipped, failed };
}

async function autoAnalyseAll() {
  if (creditExhausted) {
    console.log('AUTO: Gemini API rate limited — DOM-only houses will still be processed');
  }
  if (_autoAnalysisRunning) {
    console.log('AUTO: Analysis already running, skipping this invocation');
    return { skipped: true, reason: 'already_running' };
  }
  _autoAnalysisRunning = true;
  try {
    return await _doAutoAnalyseAll();
  } finally {
    _autoAnalysisRunning = false;
  }
}

async function _doAutoAnalyseAll() {
  console.log('\n═══ AUTO-ANALYSIS: checking all catalogue-ready auctions ═══');
  if (!process.env.GEMINI_API_KEY) { console.log('AUTO: No Gemini API key, skipping'); return; }

  // ── Step 0: Purge cached_analyses rows for past auctions ──
  // Cross-reference with auction_calendar to find cached rows whose auction
  // date has passed. These are stale data from completed auctions that should
  // not be served or re-scraped.
  // IMPORTANT: Some houses reuse the same URL across multiple auction dates
  // (e.g. BidX1, BTG Eddisons). Only purge URLs that appear ONLY in past
  // entries — never delete cache for a URL that also has an upcoming auction.
  try {
    const today = new Date().toISOString().slice(0, 10);
    const normalise = normaliseUrl;
    const BATCH = 50;

    // Get URLs from past calendar entries (exclude always_on — they don't expire)
    const { data: pastCalendar } = await supabase
      .from('auction_calendar')
      .select('url')
      .lt('date', today)
      .neq('status', 'always_on');

    // Get URLs from upcoming calendar entries + always_on (protect from purge)
    const { data: upcomingCalendar } = await supabase
      .from('auction_calendar')
      .select('url')
      .or(`date.gte.${today},status.eq.always_on`);

    if (pastCalendar && pastCalendar.length > 0) {
      const upcomingUrls = new Set((upcomingCalendar || []).map(r => normalise(r.url)));
      // Only purge URLs that do NOT also appear in upcoming auctions
      const purgeable = [...new Set(pastCalendar.map(r => normalise(r.url)).filter(Boolean))]
        .filter(u => !upcomingUrls.has(u));

      let purged = 0;
      for (let i = 0; i < purgeable.length; i += BATCH) {
        const batch = purgeable.slice(i, i + BATCH);
        const { data: deleted, error } = await supabase
          .from('cached_analyses')
          .delete()
          .in('url', batch)
          .select('url');
        if (!error && deleted) purged += deleted.length;
      }
      if (purged > 0) {
        console.log(`AUTO-PURGE: Removed ${purged} cached_analyses rows for past-only auctions (${pastCalendar.length} past, ${purgeable.length} purgeable after protecting ${upcomingUrls.size} upcoming URLs)`);
      }
    }

    // Also purge orphaned cache entries — URLs not in any calendar entry at all
    const { data: allCalendar } = await supabase.from('auction_calendar').select('url');
    const allCalendarUrls = new Set((allCalendar || []).map(r => normalise(r.url)).filter(Boolean));
    const { data: allCached } = await supabase.from('cached_analyses').select('url');
    if (allCached) {
      const orphaned = allCached
        .map(r => normalise(r.url))
        .filter(u => u && !allCalendarUrls.has(u));
      if (orphaned.length > 0) {
        let orphanPurged = 0;
        for (let i = 0; i < orphaned.length; i += BATCH) {
          const batch = orphaned.slice(i, i + BATCH);
          const { data: deleted, error } = await supabase.from('cached_analyses').delete().in('url', batch).select('url');
          if (!error && deleted) orphanPurged += deleted.length;
        }
        if (orphanPurged > 0) console.log(`AUTO-PURGE: Removed ${orphanPurged} orphaned cache entries (no calendar match)`);
      }
    }

    // Purge expired cache entries older than 7 days — no point keeping ancient stale data
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
    const { data: oldExpired, error: oldErr } = await supabase
      .from('cached_analyses')
      .delete()
      .lt('expires_at', sevenDaysAgo)
      .select('url');
    if (!oldErr && oldExpired && oldExpired.length > 0) {
      console.log(`AUTO-PURGE: Removed ${oldExpired.length} cache entries expired >7 days ago`);
    }
  } catch (e) {
    console.warn('AUTO-PURGE: cleanup failed (non-fatal) —', e.message);
  }

  // ── Step 0.5: Ensure every HOUSE_ROOTS entry has at least one calendar entry ──
  // Many houses (EIG, AH UK, etc.) have root URLs that ARE the catalogue page.
  // Without a calendar entry, they never get analysed. These are "always-on"
  // houses — their catalogue is permanently live, not tied to a specific date.
  // We mark them status='always_on' with a sentinel date so they:
  //   - Never get purged by the date-based cleanup in Step 0
  //   - Show separately in the admin UI from dated auctions
  //   - Still get scraped by autoAnalyseOne like any other catalogue-ready entry
  try {
    // Only count ACTIVE entries (upcoming dates or always_on) — stale past entries
    // don't count, otherwise houses with only expired entries never get always_on added
    const lookback7 = new Date();
    lookback7.setDate(lookback7.getDate() - 7);
    const lookbackStr = lookback7.toISOString().slice(0, 10);
    const { data: existingCalendar } = await supabase
      .from('auction_calendar')
      .select('id, house_slug, url, status')
      .or(`date.gte.${lookbackStr},status.eq.always_on`);
    const calendarSlugs = new Set((existingCalendar || []).map(r => r.house_slug).filter(Boolean));
    const calendarUrls = new Set((existingCalendar || []).map(r => normaliseUrl(r.url)));

    // ── Deduplicate: remove duplicate always_on entries per house_slug ──
    // Keep the first entry per slug, delete the rest
    const alwaysOnBySlug = new Map();
    for (const row of (existingCalendar || [])) {
      if (row.status !== 'always_on' || !row.house_slug) continue;
      if (!alwaysOnBySlug.has(row.house_slug)) {
        alwaysOnBySlug.set(row.house_slug, []);
      }
      alwaysOnBySlug.get(row.house_slug).push(row.id);
    }
    let dedupDeleted = 0;
    for (const [slug, ids] of alwaysOnBySlug) {
      if (ids.length <= 1) continue;
      // Keep the first, delete the rest
      const toDelete = ids.slice(1);
      const { error } = await supabase.from('auction_calendar').delete().in('id', toDelete);
      if (!error) dedupDeleted += toDelete.length;
    }
    if (dedupDeleted > 0) {
      console.log(`AUTO-CALENDAR: Deduplicated ${dedupDeleted} duplicate always_on entries`);
    }

    // ── Deduplicate: remove duplicate entries with same normalised URL ──
    // Regardless of status, keep one entry per URL (prefer always_on, then earliest date)
    const byUrl = new Map();
    for (const row of (existingCalendar || [])) {
      const norm = normaliseUrl(row.url);
      if (!norm) continue;
      if (!byUrl.has(norm)) {
        byUrl.set(norm, []);
      }
      byUrl.get(norm).push(row);
    }
    let urlDedupDeleted = 0;
    for (const [, rows] of byUrl) {
      if (rows.length <= 1) continue;
      // Prefer always_on entries, then keep first
      rows.sort((a, b) => {
        if (a.status === 'always_on' && b.status !== 'always_on') return -1;
        if (b.status === 'always_on' && a.status !== 'always_on') return 1;
        return 0;
      });
      const toDelete = rows.slice(1).map(r => r.id);
      const { error } = await supabase.from('auction_calendar').delete().in('id', toDelete);
      if (!error) urlDedupDeleted += toDelete.length;
    }
    if (urlDedupDeleted > 0) {
      console.log(`AUTO-CALENDAR: Deduplicated ${urlDedupDeleted} duplicate URL entries`);
    }

    let autoInserted = 0;
    for (const [slug, rootUrl] of Object.entries(HOUSE_ROOTS)) {
      const normUrl = normaliseUrl(rootUrl);
      // Skip if this house already has an active (upcoming/always_on) calendar entry
      if (calendarSlugs.has(slug) || calendarUrls.has(normUrl)) continue;
      // Auto-insert as always-on catalogue with sentinel date (won't be purged)
      const { error } = await supabase.from('auction_calendar').insert({
        house: HOUSE_DISPLAY_NAMES[slug] || slug,
        house_slug: slug,
        logo: '🔨',
        date: '2099-12-31',
        title: 'Current Catalogue',
        url: rootUrl,
        location: 'Online',
        type: 'Residential & Commercial',
        status: 'always_on',
        catalogue_ready: true,
        updated_at: new Date().toISOString(),
      });
      if (!error) {
        autoInserted++;
      } else {
        console.warn(`AUTO-CALENDAR: Failed to insert ${slug}: ${error.message || JSON.stringify(error)}`);
      }
    }
    console.log(`AUTO-CALENDAR: Step 0.5 complete — ${autoInserted} new always-on entries inserted, ${calendarSlugs.size} active slugs found, ${Object.keys(HOUSE_ROOTS).length} total houses`);

    // Migrate any existing auto-inserted entries (date=today, title='Current Catalogue')
    // that were created by the old logic — convert them to always_on
    const { data: migratable } = await supabase
      .from('auction_calendar')
      .select('id')
      .eq('title', 'Current Catalogue')
      .neq('status', 'always_on');
    if (migratable && migratable.length > 0) {
      const { error: migErr } = await supabase
        .from('auction_calendar')
        .update({ status: 'always_on', date: '2099-12-31' })
        .eq('title', 'Current Catalogue')
        .neq('status', 'always_on');
      if (!migErr) {
        console.log(`AUTO-CALENDAR: Migrated ${migratable.length} legacy entries to always_on`);
      }
    }
  } catch (e) {
    console.warn('AUTO-CALENDAR: root URL insertion failed (non-fatal) —', e.message);
  }

  // ── Step 1: Analyse all catalogue-ready auctions FIRST ──
  // Discovery is deferred to AFTER scraping so users see fresh lots quickly.
  const allReady = await getCalendarAuctions();
  // Limit to nearest MAX_AUCTIONS_PER_HOUSE upcoming dates per house
  const byHouse = {};
  for (const a of allReady) {
    const h = a.house || 'unknown';
    if (!byHouse[h]) byHouse[h] = [];
    byHouse[h].push(a);
  }
  const ready = [];
  for (const [h, auctions] of Object.entries(byHouse)) {
    auctions.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    ready.push(...auctions.slice(0, MAX_AUCTIONS_PER_HOUSE));
    for (const skippedA of auctions.slice(MAX_AUCTIONS_PER_HOUSE)) {
      console.log(`Skipping ${h} ${skippedA.date || skippedA.url} — beyond ${MAX_AUCTIONS_PER_HOUSE}-auction lookahead limit`);
    }
  }
  console.log(`AUTO: ${ready.length} catalogue-ready auctions to check (${allReady.length} total, limited to ${MAX_AUCTIONS_PER_HOUSE} per house)`);

  // ── Manager pre-scrape cycle → get directives ──
  let directives;
  try {
    const preReport = await runManagerCycle();
    if (preReport && !preReport.skipped) {
      console.log(`MANAGER PRE-SCRAPE: Cycle ${preReport.cycle} — ${preReport.actions_taken.length} actions`);
    }
    directives = getManagerDirectives();
  } catch (mgrErr) {
    console.warn('MANAGER PRE-SCRAPE: failed (non-fatal):', mgrErr.message);
    directives = getManagerDirectives(); // returns defaults
  }

  // ── Partition into DOM houses vs Gemini houses ──
  const skipSet = new Set(directives.skip_houses || []);
  const priorityOrder = (directives.priority_houses || []).reduce((m, slug, i) => { m[slug] = i; return m; }, {});

  const domHouses = [];
  const geminiHouses = [];
  const skippedByManager = [];

  for (const auction of ready) {
    const slug = detectAuctionHouse(auction.url);
    if (skipSet.has(slug)) {
      skippedByManager.push(auction);
      console.log(`AUTO: Skipping ${auction.house} — manager directive (${(directives.skip_reasons || {})[slug] || 'skipped'})`);
      continue;
    }
    auction._slug = slug;
    auction._priority = priorityOrder[slug] !== undefined ? priorityOrder[slug] : 999;
    if (slug && DOM_EXTRACTORS[slug]) {
      domHouses.push(auction);
    } else {
      geminiHouses.push(auction);
    }
  }

  // ── Boost never-scraped houses to the front of the queue ──
  // Houses that have never been scraped (no cached_analyses entry) should be
  // processed first so they don't languish behind already-cached re-checks.
  const { data: cachedHouses } = await supabase
    .from('cached_analyses')
    .select('house');
  const cachedHouseSet = new Set((cachedHouses || []).map(r => r.house));
  for (const auction of [...domHouses, ...geminiHouses]) {
    const slug = auction._slug || detectAuctionHouse(auction.url);
    if (!cachedHouseSet.has(slug)) {
      // Never-scraped houses get top priority (below explicit manager priorities)
      auction._priority = Math.min(auction._priority, 1);
    }
  }

  // Sort by manager priority (lower = higher priority)
  domHouses.sort((a, b) => a._priority - b._priority);
  geminiHouses.sort((a, b) => a._priority - b._priority);

  const neverScrapedCount = [...domHouses, ...geminiHouses].filter(a => a._priority <= 1).length;
  console.log(`AUTO: Partitioned — ${domHouses.length} DOM houses, ${geminiHouses.length} Gemini houses, ${skippedByManager.length} skipped by manager, ${neverScrapedCount} never-scraped boosted`);

  // ── Per-auction processing function (same logic as before, no 5s pause) ──
  async function processAuction(auction) {
    try {
      const normalisedUrl = normaliseUrl(auction.url);

      // Check if we already have a fresh cache
      const { data: cached } = await supabase
        .from('cached_analyses')
        .select('url, total_lots, created_at')
        .eq('url', normalisedUrl)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (cached && cached.total_lots > 0) {
        // Read lots from lots table (single source of truth)
        const { data: lotRows } = await supabase
          .from('lots')
          .select(LOTS_SELECT)
          .eq('catalogue_url', normalisedUrl);
        const cachedLots = (lotRows || []).map(dbRowToFrontendLot);
        let needsUpdate = false;

        // Allsop-specific: fix broken lot URLs and enrich with API data (including images)
        if (auction.house === 'allsop') {
          const brokenUrls = cachedLots.filter(l => l.url && /allsop\.co\.uk\/lot\/\d+/i.test(l.url)).length;
          const missingAllsopImages = cachedLots.filter(l => !l.imageUrl).length;
          if (brokenUrls > 0 || missingAllsopImages > 0) {
            try {
              const rewritten = await rewriteUrl(auction.url, 'allsop');
              if (rewritten?.isApi) {
                const pages = await scrapeAllsopApi(rewritten.baseUrl);
                if (pages.length > 0) {
                  enrichAllsopLots(cachedLots, pages);
                  for (const lot of cachedLots) {
                    if (lot.reference) {
                      lot.url = `https://www.allsop.co.uk/lot-overview/lot/${lot.reference}`;
                    }
                  }
                  const newImagesGained = missingAllsopImages - cachedLots.filter(l => !l.imageUrl).length;
                  needsUpdate = true;
                  console.log(`AUTO: ✓ ${auction.house} — fixed ${brokenUrls} broken URLs, gained ${newImagesGained} images`);
                }
              }
            } catch (e) {
              console.log(`AUTO: Allsop URL fix failed: ${e.message}`);
            }
          }
        }

        // Backfill images for lots that are missing them
        const totalMissingImages = cachedLots.filter(l => !l.imageUrl).length;
        if (totalMissingImages > 0) {
          const lotsWithUrl = cachedLots.filter(l => l.url && !l.imageUrl).length;
          if (lotsWithUrl > 0) {
            const updated = await backfillImages(auction.url, cachedLots);
            if (updated) {
              needsUpdate = true;
              const gained = updated.filter(l => l.imageUrl).length;
              console.log(`AUTO: ✓ ${auction.house} — HTTP backfill got ${gained} images`);
            }
            const stillMissing = cachedLots.filter(l => l.url && !l.imageUrl).length;
            if (stillMissing > 0) {
              const deepFilled = await backfillImagesFromLotPages(cachedLots);
              if (deepFilled > 0) needsUpdate = true;
            }
          }
          const stillNoImages = cachedLots.filter(l => !l.imageUrl).length;
          const houseSlug = Object.entries(HOUSE_DISPLAY_NAMES).find(([k, v]) => v === auction.house)?.[0] || auction.house;
          if (stillNoImages > 0 && PUPPETEER_IMAGE_HOUSES.has(houseSlug)) {
            console.log(`AUTO: ${auction.house} — ${stillNoImages} lots still missing images, trying rendered backfill...`);
            let gained = 0;
            if (FIRECRAWL_API_KEY && !isFcCreditExhausted()) {
              gained += await backfillImagesWithFirecrawl(auction.url, cachedLots, houseSlug);
            }
            const afterFc = cachedLots.filter(l => !l.imageUrl).length;
            if (afterFc > 0 && puppeteer) {
              gained += await backfillImagesWithPuppeteer(auction.url, cachedLots, houseSlug);
            }
            if (gained > 0) needsUpdate = true;
          }
          if (!needsUpdate) {
            console.log(`AUTO: ✓ ${auction.house} already cached (${cached.total_lots} lots)`);
          }
        } else if (!needsUpdate) {
          console.log(`AUTO: ✓ ${auction.house} already cached (${cached.total_lots} lots)`);
        }

        if (needsUpdate) {
          // Write enriched lots back to lots table (single source of truth)
          normaliseLotStatuses(cachedLots);
          await upsertToLotsTable(cachedLots, auction.house, auction.url, {
            scrapedWith: 'cache-enrichment',
          });
          console.log(`AUTO: ✓ ${auction.house} — synced enriched lots to lots table`);
        }
        return 'skipped';
      }

      console.log(`AUTO: Analysing ${auction.house} — ${auction.url}`);
      const HOUSE_TIMEOUT_MS = 90000;
      await Promise.race([
        autoAnalyseOne(auction.url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('House scrape timeout (90s)')), HOUSE_TIMEOUT_MS))
      ]);
      return 'analysed';

    } catch (e) {
      console.error(`AUTO: ✗ ${auction.house} failed: ${e.message}`);
      return 'failed';
    }
  }

  // ── Wave 1: DOM houses at high concurrency ──
  const wave1 = await runWave(domHouses, directives.dom_concurrency || 10, 'DOM', processAuction);

  // ── Wave 2: Gemini houses at low concurrency ──
  const wave2 = await runWave(geminiHouses, directives.gemini_concurrency || 3, 'Gemini', processAuction);

  const analysed = wave1.analysed + wave2.analysed;
  const skipped = wave1.skipped + wave2.skipped + skippedByManager.length;
  const failed = wave1.failed + wave2.failed;

  console.log(`═══ AUTO-ANALYSIS COMPLETE: ${analysed} analysed, ${skipped} cached/skipped, ${failed} failed ═══\n`);

  // ── Step 3: Proactive healing sweep for houses with unresolved 0-lot regressions ──
  if (FIRECRAWL_API_KEY && !isFcCreditExhausted()) {
    try {
      const { data: unresolvedAlerts } = await supabase
        .from('pipeline_alerts')
        .select('house, message')
        .eq('event_type', 'extractor_regression')
        .eq('resolved', false)
        .order('created_at', { ascending: false });

      if (unresolvedAlerts && unresolvedAlerts.length > 0) {
        // Deduplicate by house
        const housesToHeal = [...new Set(unresolvedAlerts.map(a => a.house).filter(Boolean))];
        console.log(`HEAL-SWEEP: ${housesToHeal.length} houses with unresolved regressions: ${housesToHeal.join(', ')}`);

        let healed = 0;
        for (const slug of housesToHeal) {
          const rootUrl = HOUSE_ROOTS[slug];
          if (!rootUrl) continue;

          const healedUrl = await healBrokenHouse(slug, rootUrl);
          if (healedUrl) {
            healed++;
            // Try re-analysing with the healed URL
            try {
              await autoAnalyseOne(healedUrl);
            } catch { /* already logged inside */ }
          }
        }
        if (healed > 0) {
          console.log(`HEAL-SWEEP: ✓ Healed ${healed}/${housesToHeal.length} houses`);
        }
      }
    } catch (healErr) {
      console.warn('HEAL-SWEEP: failed (non-fatal) —', healErr.message);
    }
  }

  // ── Step 4: Discover new catalogues AFTER scraping ──
  // Discovery is expensive (Firecrawl + Gemini per house) so runs after lots are live.
  if (creditExhausted) {
    console.log('AUTO-DISCOVER: Skipping — Gemini API rate limited (discovery requires AI)');
  } else {
    await discoverAndUpdateCalendar().catch(e =>
      console.error('AUTO-DISCOVER: failed —', e.message)
    );
  }

  // ── Harness: Manager post-scrape cycle (corrective actions) ──
  try {
    const postReport = await runManagerCycle();
    if (postReport && !postReport.skipped) {
      console.log(`MANAGER POST-SCRAPE: Cycle ${postReport.cycle}: ${postReport.actions_taken.length} actions, effectiveness ${postReport.effectiveness_score}`);
    }
  } catch (mgrErr) {
    console.warn('MANAGER POST-SCRAPE: failed (non-fatal):', mgrErr.message);
  }

  // ── Save daily analytics snapshot ──
  try { await saveDailySnapshot(); } catch (e) { console.warn('Daily snapshot failed:', e.message); }

  return { analysed, skipped, failed, total: ready.length };
}

// ═══════════════════════════════════════════════════════════════
// SELF-HEALING DISCOVERY: Detect broken URLs and find replacements
// ═══════════════════════════════════════════════════════════════
// When a house returns 0 lots after scraping, this function attempts to
// find the new catalogue URL by scraping the house's homepage with Firecrawl
// and asking Gemini to locate the catalogue link.

// Track healing state to avoid repeated attempts
const _healingState = new Map(); // slug → { lastAttempt: Date, attempts: number, cooldownUntil: Date }

async function healBrokenHouse(slug, oldUrl) {
  if (!supabase || !FIRECRAWL_API_KEY) return null;

  // Cooldown: don't retry healing for the same house within 24 hours
  const state = _healingState.get(slug);
  if (state && state.cooldownUntil && Date.now() < state.cooldownUntil) {
    console.log(`HEAL: Skipping ${slug} — on cooldown until ${new Date(state.cooldownUntil).toISOString()}`);
    return null;
  }

  const attempts = (state?.attempts || 0) + 1;
  // Exponential backoff: 24h, 48h, 96h after each failed attempt (max 7 days)
  const cooldownMs = Math.min(24 * 60 * 60 * 1000 * Math.pow(2, attempts - 1), 7 * 24 * 60 * 60 * 1000);

  console.log(`HEAL: Attempting to heal ${slug} (attempt ${attempts}, old URL: ${oldUrl})`);

  try {
    // Extract base domain from the root URL
    const rootUrl = HOUSE_ROOTS[slug];
    if (!rootUrl) {
      console.log(`HEAL: No HOUSE_ROOTS entry for ${slug}`);
      return null;
    }

    const parsedUrl = new URL(rootUrl);
    const homepageUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;

    // Use Firecrawl to render the homepage — handles JS, anti-bot, proxies
    let html, markdown;
    try {
      const fcResult = await scrapeWithFirecrawl(homepageUrl, {
        formats: ['rawHtml', 'markdown'],
      });
      html = fcResult.html;
      markdown = fcResult.markdown;
      console.log(`HEAL: Firecrawl scraped ${homepageUrl} (${(html || '').length} chars HTML, ${(markdown || '').length} chars markdown)`);
    } catch (fcErr) {
      console.log(`HEAL: Firecrawl failed for ${homepageUrl}: ${fcErr.message}`);

      // Fallback to plain fetch if Firecrawl unavailable
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const resp = await fetch(homepageUrl, { headers: HEADERS, signal: controller.signal });
        clearTimeout(timeout);
        if (resp.ok) html = await resp.text();
      } catch { /* silent */ }

      if (!html) {
        _healingState.set(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
        return null;
      }
    }

    // Also try scraping the root URL directly if different from homepage
    let rootHtml = '';
    if (rootUrl !== homepageUrl && rootUrl !== homepageUrl + '/') {
      try {
        const fcRoot = await scrapeWithFirecrawl(rootUrl, { formats: ['rawHtml'] });
        rootHtml = fcRoot.html || '';
        console.log(`HEAL: Also scraped root URL ${rootUrl} (${rootHtml.length} chars)`);
      } catch { /* silent — homepage was the priority */ }
    }

    // Extract text + links for AI analysis
    const allHtml = html + '\n' + rootHtml;
    const stripped = allHtml
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .substring(0, 8000);

    const hrefMatches = [...allHtml.matchAll(/href="([^"]+)"/gi)];
    const hrefs = [...new Set(hrefMatches.map(m => m[1]))]
      .filter(h => !h.startsWith('#') && !h.startsWith('javascript:') && !h.startsWith('mailto:'))
      .slice(0, 60);

    if (hrefs.length === 0 && stripped.length < 200) {
      console.log(`HEAL: Insufficient content from ${slug} homepage`);
      _healingState.set(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
      return null;
    }

    // Ask Gemini to find the new catalogue URL
    const aiText = await callAI(`You are helping fix a broken auction house scraper. The catalogue URL for this auction house has stopped returning lots.

House: ${HOUSE_DISPLAY_NAMES[slug] || slug}
Old catalogue URL (now broken/empty): ${oldUrl}
Homepage: ${homepageUrl}

Here is the text content from the house's website:
${stripped}

Here are all links found on the page:
${hrefs.join('\n')}

${markdown ? `\nMarkdown content:\n${(markdown || '').substring(0, 4000)}` : ''}

TASK: Find the CURRENT catalogue/lots page URL for this auction house. The old URL "${oldUrl}" is no longer working. Look for:
- Links containing words like "catalogue", "lots", "properties", "auction", "current", "upcoming", "search"
- Links that match the pattern of the old URL but with updated paths/dates
- The main page where auction lots are listed for browsing

Return ONLY valid JSON: {"newUrl": "https://...", "confidence": "high|medium|low", "reason": "brief explanation"}
If you cannot find a catalogue URL, return: {"newUrl": null, "confidence": "none", "reason": "explanation"}`, {
      tier: 'capable',
      maxTokens: 500,
      taskType: 'healing',
    });

    let result;
    try {
      let text = aiText.trim();
      if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      result = JSON.parse(text);
    } catch {
      console.log(`HEAL: Failed to parse AI response for ${slug}`);
      _healingState.set(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
      return null;
    }

    if (!result.newUrl || result.confidence === 'none') {
      console.log(`HEAL: No new URL found for ${slug} — ${result.reason || 'unknown'}`);
      _healingState.set(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });

      // Alert admin: house needs manual intervention
      try {
        await supabase.from('pipeline_alerts').insert({
          event_type: 'healing_failed',
          severity: 'warning',
          house: slug,
          message: `Self-healing failed for ${HOUSE_DISPLAY_NAMES[slug] || slug}: ${result.reason || 'no catalogue URL found'}. Old URL: ${oldUrl}`,
        });
      } catch { /* silent */ }

      return null;
    }

    // Validate the new URL is different and looks plausible
    const newUrl = result.newUrl.trim();
    const normOld = normaliseUrl(oldUrl);
    const normNew = normaliseUrl(newUrl);
    if (normOld === normNew) {
      console.log(`HEAL: AI returned the same URL for ${slug} — no change needed`);
      _healingState.set(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
      return null;
    }

    // Verify the new URL is reachable before committing
    try {
      const verifyResult = await scrapeWithFirecrawl(newUrl, { formats: ['rawHtml'] });
      const verifyHtml = verifyResult.html || '';
      if (verifyHtml.length < 500) {
        console.log(`HEAL: New URL ${newUrl} returned very little content (${verifyHtml.length} chars) — skipping`);
        _healingState.set(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
        return null;
      }
    } catch (verifyErr) {
      console.log(`HEAL: New URL ${newUrl} is not reachable: ${verifyErr.message}`);
      _healingState.set(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
      return null;
    }

    console.log(`HEAL: ✓ Found new URL for ${slug}: ${newUrl} (confidence: ${result.confidence}, reason: ${result.reason})`);

    // Update in-memory HOUSE_ROOTS
    HOUSE_ROOTS[slug] = newUrl;

    // Update the calendar entry
    const { error: updateErr } = await supabase
      .from('auction_calendar')
      .update({ url: newUrl, updated_at: new Date().toISOString() })
      .eq('house_slug', slug)
      .eq('url', oldUrl);

    if (updateErr) {
      // If no exact URL match, insert a new entry
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
    }

    // Record the successful heal
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'url_healed',
        severity: 'info',
        house: slug,
        message: `Self-healed ${HOUSE_DISPLAY_NAMES[slug] || slug}: ${oldUrl} → ${newUrl} (confidence: ${result.confidence})`,
      });
    } catch { /* silent */ }

    // Reset healing state on success
    _healingState.set(slug, { lastAttempt: Date.now(), attempts: 0, cooldownUntil: 0 });

    return newUrl;

  } catch (err) {
    console.error(`HEAL: Unexpected error healing ${slug}:`, err.message);
    _healingState.set(slug, { lastAttempt: Date.now(), attempts, cooldownUntil: Date.now() + cooldownMs });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTO-DISCOVER: Scrape house root pages to find new catalogue URLs
// ═══════════════════════════════════════════════════════════════
// Runs as part of the 6-hour auto-analysis cycle. For each house with a
// HOUSE_ROOTS entry, fetches the root page, extracts auction links with
// Claude Haiku, and upserts any new ones into the Supabase calendar.
async function discoverAndUpdateCalendar() {
  if (!supabase || !process.env.GEMINI_API_KEY) return;

  // Only discover for houses that DON'T already have a calendar entry.
  // Houses with direct-catalogue URLs (EIG, AH UK, etc.) are auto-inserted
  // by Step 0.5 in autoAnalyseAll() — no need to spend AI credits on them.
  const { data: existingCalendar } = await supabase
    .from('auction_calendar')
    .select('house_slug')
    .gte('date', new Date().toISOString().slice(0, 10));
  const alreadyInCalendar = new Set((existingCalendar || []).map(r => r.house_slug).filter(Boolean));

  const slugs = Object.keys(HOUSE_ROOTS).filter(s => !alreadyInCalendar.has(s));
  console.log(`AUTO-DISCOVER: Checking ${slugs.length} house root pages for new catalogues (${alreadyInCalendar.size} already in calendar, skipped)`);

  let discovered = 0, errors = 0;

  for (const slug of slugs) {
    const rootUrl = HOUSE_ROOTS[slug];
    try {
      // Fetch root page — prefer Firecrawl (handles JS rendering, anti-bot)
      let html;
      if (FIRECRAWL_API_KEY && !isFcCreditExhausted()) {
        try {
          const fcResult = await scrapeWithFirecrawl(rootUrl, { formats: ['rawHtml'] });
          html = fcResult.html || '';
        } catch (fcErr) {
          console.log(`AUTO-DISCOVER: Firecrawl failed for ${slug}, falling back to plain fetch: ${fcErr.message}`);
        }
      }
      // Fallback to plain HTTP if Firecrawl unavailable or failed
      if (!html) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          const resp = await fetch(rootUrl, { headers: HEADERS, signal: controller.signal });
          clearTimeout(timeout);
          if (!resp.ok) continue;
          html = await resp.text();
        } catch { continue; }
      }
      if (!html) continue;

      // Extract text + links for AI
      const stripped = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .substring(0, 6000);

      const hrefMatches = [...html.matchAll(/href="([^"]*(?:auction|lot|catalogue|sale|propert)[^"]*)"/gi)];
      const hrefs = [...new Set(hrefMatches.map(m => m[1]))].slice(0, 40);

      if (hrefs.length === 0 && stripped.length < 200) continue;

      const aiText = await callAI(`Extract auction catalogue links from this auction house page.

House: ${HOUSE_DISPLAY_NAMES[slug] || slug}
Root URL: ${rootUrl}

Page text (truncated):
${stripped}

Links found:
${hrefs.join('\n')}

For each UPCOMING or CURRENT auction with lots to view, provide:
- url: Full URL (resolve relative URLs against ${rootUrl})
- title: Auction title/date
- date: YYYY-MM-DD if determinable, null otherwise
- catalogueReady: true if lots appear listed

Return ONLY: {"catalogues": [{"url":"...","title":"...","date":"...","catalogueReady":true}]}
No catalogues? Return {"catalogues": []}`, { tier: 'capable', maxTokens: 1500, taskType: 'discovery' });

      let catalogues = [];
      try {
        let text = aiText.trim();
        if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        catalogues = JSON.parse(text).catalogues || [];
      } catch { continue; }

      // Upsert discovered catalogues into Supabase calendar
      const lotUrlPatterns = [
        /\/lot\/details?\//i, /\/lot\/\d+(?:[/#?]|$)/i,
        /\/property\/details?\//i, /\/properties\/\d+(?:[/#?]|$)/i,
        /\/properties\/lot\//i, /lot[_-]?id=/i, /property[_-]?id=/i,
      ];
      for (const cat of catalogues) {
        if (!cat.url) continue;
        if (lotUrlPatterns.some(p => p.test(cat.url))) {
          console.log(`AUTO-DISCOVER: Skipping lot-level URL: ${cat.url}`);
          continue;
        }
        const normUrl = normaliseUrl(cat.url);

        // Check if this URL is already in the calendar
        const { data: existingUrl } = await supabase
          .from('auction_calendar')
          .select('id')
          .eq('url', cat.url)
          .maybeSingle();

        if (existingUrl) continue; // Already known

        // Check if this house+date combo already has an entry (prevent URL variant dupes)
        if (cat.date) {
          const { data: existingDate } = await supabase
            .from('auction_calendar')
            .select('id')
            .eq('house_slug', slug)
            .eq('date', cat.date)
            .limit(1);
          if (existingDate && existingDate.length > 0) continue; // Already have entry for this house+date
        }

        // Insert new calendar entry
        const { error } = await supabase.from('auction_calendar').insert({
          house: HOUSE_DISPLAY_NAMES[slug] || slug,
          house_slug: slug,
          logo: '🔨',
          date: cat.date || new Date().toISOString().split('T')[0],
          title: cat.title || 'Upcoming',
          url: cat.url,
          location: 'Online',
          type: 'Residential & Commercial',
          status: 'upcoming',
          catalogue_ready: cat.catalogueReady || false,
          updated_at: new Date().toISOString(),
        });

        if (!error) {
          discovered++;
          console.log(`AUTO-DISCOVER: ✓ New catalogue found — ${HOUSE_DISPLAY_NAMES[slug]}: ${cat.title} (${cat.url})`);
        }
      }

      // Brief pause between houses
      await new Promise(r => setTimeout(r, 1000));

    } catch (e) {
      errors++;
      // Silent — don't let one house's failure stop the rest
    }
  }

  console.log(`AUTO-DISCOVER: Complete — ${discovered} new catalogues found, ${errors} errors`);

  // ── Pipeline alerting: discovery failures and consecutive misses ──
  if (errors > 0) {
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'discovery_miss',
        severity: 'warning',
        house: null,
        message: `Calendar discovery had ${errors} errors out of ${slugs.length} houses`
      });
    } catch (alertErr) { console.warn('ALERT: Failed to record discovery errors:', alertErr.message); }
  }

  // Track consecutive runs with 0 new catalogues
  if (discovered === 0) {
    discoverAndUpdateCalendar._consecutiveMisses = (discoverAndUpdateCalendar._consecutiveMisses || 0) + 1;
    if (discoverAndUpdateCalendar._consecutiveMisses >= 3) {
      try {
        await supabase.from('pipeline_alerts').insert({
          event_type: 'discovery_miss',
          severity: 'warning',
          house: null,
          message: `${discoverAndUpdateCalendar._consecutiveMisses} consecutive discovery runs found 0 new catalogues`
        });
      } catch (alertErr) { console.warn('ALERT: Failed to record consecutive miss:', alertErr.message); }
    }
  } else {
    discoverAndUpdateCalendar._consecutiveMisses = 0;
  }
}

// ═══════════════════════════════════════════════════════════════
// LOTS TABLE: Dual-write helper — upserts individual lot rows
// alongside the cached_analyses JSONB blob.
// Non-fatal: errors are logged but never block the scrape pipeline.
// ═══════════════════════════════════════════════════════════════
const JUNK_LOT_PATTERN = /^(I'd like to|Property search|Popular|Auction Dates|Register to bid|Information|\dBid Basket|Cookie|Privacy)/i;

// Build a complete natural-language snapshot of a lot for search.
// Everything goes in — the intelligence is in the QUERY strategy, not the storage.
// Structured queries (price, tenure, beds) hit formal columns via SQL.
// This blob is searched only for things that don't map to columns.
function buildSearchText(lot) {
  const parts = [];

  if (lot.address) parts.push(lot.address);
  if (lot.postcode) parts.push(lot.postcode);

  const typeDesc = [lot.beds ? `${lot.beds} bed` : '', lot.propType || '', lot.tenure || ''].filter(Boolean).join(' ');
  if (typeDesc) parts.push(typeDesc);
  if (lot.sqft) parts.push(`${lot.sqft} sqft`);
  if (lot.leaseLength) parts.push(`${lot.leaseLength} year lease`);
  if (lot.units && lot.units > 1) parts.push(`${lot.units} units`);
  if (lot.condition) parts.push(lot.condition);
  if (lot.vacant) parts.push('Vacant possession');
  if (lot.dealType) parts.push(lot.dealType);
  if (lot.price) parts.push(`Guide £${lot.price.toLocaleString()}`);
  if (lot.streetAvg) parts.push(`Street avg £${lot.streetAvg.toLocaleString()}`);
  if (lot.belowMarket) parts.push(`${lot.belowMarket}% below market value`);
  if (lot.estGrossYield) parts.push(`Yield ${lot.estGrossYield}%`);
  if (lot.titleSplit) parts.push('Title split potential');
  if (lot.epcRating) parts.push(`EPC ${lot.epcRating}`);
  if (lot.floodRiskLevel) parts.push(`Flood risk ${lot.floodRiskLevel}`);
  if (lot.opps && lot.opps.length) parts.push(lot.opps.join('. '));
  if (lot.risks && lot.risks.length) parts.push(lot.risks.join('. '));
  if (lot.bullets && lot.bullets.length) parts.push(lot.bullets.join('. '));
  if (lot.scoreBreakdown && lot.scoreBreakdown.length) {
    const labels = lot.scoreBreakdown.map(s => typeof s === 'string' ? s : (s.label || s.reason || '')).filter(Boolean);
    if (labels.length) parts.push(labels.join('. '));
  }

  return parts.join('. ').substring(0, 4000) || null;
}

async function upsertToLotsTable(enrichedLots, house, catalogueUrl, metadata = {}) {
  if (!supabase || !enrichedLots || enrichedLots.length === 0) return;
  try {
    const now = new Date().toISOString();

    // Look up auction date from calendar for this catalogue URL
    let catalogueAuctionDate = null;
    try {
      const normCatUrl = normaliseUrl(catalogueUrl);
      const { data: calRows } = await supabase
        .from('auction_calendar')
        .select('url, date')
        .order('date', { ascending: true });
      if (calRows) {
        for (const r of calRows) {
          if (normaliseUrl(r.url) === normCatUrl) { catalogueAuctionDate = r.date; break; }
        }
      }
    } catch { /* non-fatal */ }

    // Build lot rows
    const rows = [];
    for (const lot of enrichedLots) {
      const addr = (lot.address || '').trim();
      if (!addr || addr.length < 5) continue;
      if (JUNK_LOT_PATTERN.test(addr)) continue;

      let lotUrl = lot.url || null;
      if (!lotUrl) {
        lotUrl = `__synthetic__${house}__${addr.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 80)}__${lot.price || 0}`;
      }

      // Per-lot auction date from EIG bullets takes priority over catalogue date
      let lotAuctionDate = catalogueAuctionDate;
      if (lot.bullets && Array.isArray(lot.bullets)) {
        for (const b of lot.bullets) {
          const m = b.match(/Auction\s*Ends?:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
          if (m) { lotAuctionDate = m[3] + '-' + m[2] + '-' + m[1]; break; }
        }
      }

      rows.push({
        house,
        lot_number: lot.lot || null,
        url: lotUrl,
        catalogue_url: normaliseUrl(catalogueUrl),
        address: addr,
        postcode: lot.postcode || null,
        price: (typeof lot.price === 'number' && lot.price > 0) ? lot.price : null,
        price_text: lot.priceText || null,
        prop_type: lot.propType || null,
        beds: (typeof lot.beds === 'number') ? lot.beds : null,
        tenure: lot.tenure || null,
        lease_length: (typeof lot.leaseLength === 'number') ? lot.leaseLength : null,
        sqft: (typeof lot.sqft === 'number') ? lot.sqft : null,
        condition: lot.condition || null,
        image_url: lot.imageUrl || null,
        bullets: lot.bullets || [],
        units: lot.units || 0,
        auction_date: lotAuctionDate,
        status: lot.status || 'available',
        sold_price: (typeof lot.soldPrice === 'number') ? lot.soldPrice : null,
        epc_rating: lot.epcRating || null,
        epc_score: (typeof lot.epcScore === 'number') ? lot.epcScore : null,
        epc_date: lot.epcDate || null,
        flood_zone: (typeof lot.floodZone === 'number') ? lot.floodZone : null,
        flood_risk: lot.floodRiskLevel || null,
        street_avg: (typeof lot.streetAvg === 'number') ? lot.streetAvg : null,
        street_sales: lot.streetSales || null,
        street_sales_count: (typeof lot.streetSalesCount === 'number') ? lot.streetSalesCount : null,
        below_market: (typeof lot.belowMarket === 'number') ? lot.belowMarket : null,
        est_monthly_rent: (typeof lot.estMonthlyRent === 'number') ? lot.estMonthlyRent : null,
        est_annual_rent: (typeof lot.estAnnualRent === 'number') ? lot.estAnnualRent : null,
        est_gross_yield: (typeof lot.estGrossYield === 'number') ? lot.estGrossYield : null,
        score: (typeof lot.score === 'number') ? lot.score : null,
        score_breakdown: lot.scoreBreakdown || [],
        opps: lot.opps || [],
        risks: lot.risks || [],
        deal_type: lot.dealType || null,
        vacant: lot.vacant || null,
        title_split: lot.titleSplit || null,
        raw_text: lot.rawText || null,
        extracted_with: metadata.extractedWith || null,
        scraped_with: metadata.scrapedWith || null,
        last_seen_at: now,
        enriched_at: lot.enrichedAt || null,
        search_text: buildSearchText(lot),
        // Note: first_seen_at deliberately omitted — uses column default (now()) on INSERT,
        // and is not overwritten on conflict UPDATE
      });
    }

    if (rows.length === 0) return;

    // Fetch existing lots for this catalogue to detect status changes
    const { data: existingLots } = await supabase
      .from('lots')
      .select('id, url, status')
      .eq('house', house)
      .eq('catalogue_url', normaliseUrl(catalogueUrl));

    const existingMap = new Map((existingLots || []).map(l => [l.url, l]));

    // Detect status changes for history tracking
    const statusChanges = [];
    for (const row of rows) {
      const existing = existingMap.get(row.url);
      if (existing && existing.status && existing.status !== row.status) {
        statusChanges.push({
          lot_id: existing.id,
          old_status: existing.status,
          new_status: row.status,
          source: 'scrape',
        });
      }
    }

    // Upsert in batches of 50
    const BATCH_SIZE = 50;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('lots')
        .upsert(batch, { onConflict: 'house,url' });
      if (error) {
        console.warn(`LOTS: Batch upsert error for ${house}: ${error.message}`);
      } else {
        upserted += batch.length;
      }
    }

    // Record status changes in history table
    if (statusChanges.length > 0) {
      const { error: histErr } = await supabase
        .from('lot_status_history')
        .insert(statusChanges);
      if (histErr) console.warn(`LOTS: Status history insert error: ${histErr.message}`);
      else console.log(`LOTS: ${statusChanges.length} status changes recorded for ${house}`);
    }

    console.log(`LOTS: ✓ ${house}: ${upserted}/${rows.length} lots upserted`);
  } catch (err) {
    console.warn(`LOTS: Failed to upsert lots for ${house}: ${err.message}`);
  }
}

async function autoAnalyseOne(url) {
  const urlCheck = await validateUrl(url);
  if (!urlCheck.ok) { log.warn('autoAnalyseOne skipped — invalid URL', { url, reason: urlCheck.error }); return []; }
  const house = detectAuctionHouse(url);

  try {
  // ── Harness: circuit breaker check ──
  if (isCircuitOpen(house)) {
    console.log(`AUTO: Skipping ${house} — circuit breaker open`);
    return;
  }

  // Skip Knight Frank forthcoming-auctions index page — it's a discovery page, not a catalogue.
  // Actual catalogue URLs like /auction/3833/... are discovered and analysed separately.
  if (house === 'knightfrank' && url.toLowerCase().includes('forthcoming-auctions')) {
    console.log(`AUTO: Skipping ${house} forthcoming-auctions index page (not a catalogue)`);
    return;
  }

  const rewritten = await rewriteUrl(url, house);
  if (rewritten.blocked) {
    console.log(`AUTO: Skipping ${house} — marked as blocked (anti-bot protection)`);
    return [];
  }
  const scrapeUrl = rewritten.baseUrl;
  const normalisedUrl = normaliseUrl(url);

  // HTML change detection — scrape first page and hash it
  // Uses Firecrawl for JS-rendered houses so the hash reflects actual rendered content,
  // not the empty JS shell. This makes the hash-skip optimisation work properly and
  // avoids wasteful full re-scrapes every cycle.
  // OPTIMISATION: Skip the probe entirely for never-cached URLs — there's nothing to
  // compare against, so the probe wastes a Firecrawl credit and 5-15 seconds.
  const { data: existingCache } = await supabase
    .from('cached_analyses')
    .select('content_hash, expires_at')
    .eq('url', normalisedUrl)
    .maybeSingle();

  if (existingCache) {
    try {
      let probeHtml;
      let probeSource = 'http';
      if (FIRECRAWL_API_KEY && !isFcCreditExhausted() && !FIRECRAWL_SKIP.has(house)) {
        try {
          const fcProbe = await scrapeWithFirecrawl(scrapeUrl, { formats: ['rawHtml'] });
          probeHtml = fcProbe.html || '';
          probeSource = 'firecrawl';
        } catch {
          probeHtml = await fetchPage(scrapeUrl);
        }
      } else {
        probeHtml = await fetchPage(scrapeUrl);
      }
      const contentHash = createHash('md5').update(probeHtml).digest('hex');

      if (existingCache.content_hash === contentHash && existingCache.expires_at && new Date(existingCache.expires_at) > new Date()) {
        const newExpiry = new Date(Date.now() + getCacheTTL(house)).toISOString();
        await supabase.from('cached_analyses').update({ expires_at: newExpiry, last_scraped_at: new Date().toISOString() }).eq('url', normalisedUrl);
        hashHitCount++;
        console.log(`Cache extended — content unchanged for ${house} (probe: ${probeSource})`);
        return;
      }
      autoAnalyseOne._lastContentHash = contentHash;
    } catch (e) {
      autoAnalyseOne._lastContentHash = null;
    }
  } else {
    // Never cached — skip probe, will hash after full scrape
    autoAnalyseOne._lastContentHash = null;
  }

  let rawLots = [];

  if (rewritten.paginateAs === 'allsop_api') {
    const pages = await scrapeAllsopApi(rewritten.baseUrl);
    if (pages.length > 0) {
      rawLots = extractAllsopLotsFromJson(pages);
    }

  } else if (rewritten.preferPuppeteer) {
    // JS-rendered sites: Firecrawl+JSDOM (primary), Puppeteer (fallback)
    if (isFcCreditExhausted()) console.log(`AUTO: Firecrawl credits exhausted, will use Puppeteer fallback for ${house}`);

    if (rewritten.paginateAs === 'savills_pages') {
      const firstResult = await scrapeRenderedPage(scrapeUrl, house);
      const dom = new JSDOM(firstResult.html, { url: scrapeUrl });
      const totalPages = (() => {
        const pageLinks = dom.window.document.querySelectorAll('a[href*="/page-"]');
        let max = 1;
        for (const a of pageLinks) {
          const m = a.textContent.trim().match(/^(\d+)$/);
          if (m) max = Math.max(max, parseInt(m[1]));
        }
        return max;
      })();
      dom.window.close();

      const firstPageLots = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
      if (firstPageLots && firstPageLots.length > 0) rawLots.push(...firstPageLots);
      const maxPages = Math.min(totalPages, 50);
      for (let p = 2; p <= maxPages; p++) {
        if (isFcCreditExhausted() && !puppeteer) { console.log(`AUTO: No scraping engine available at page ${p}`); break; }
        try {
          const pageResult = await scrapeRenderedPage(`${scrapeUrl}/page-${p}`, house);
          const pageLots = extractWithJSDOM(pageResult.html, house, `${scrapeUrl}/page-${p}`, pageResult.images);
          if (pageLots && pageLots.length > 0) rawLots.push(...pageLots);
        } catch (e) {
          console.log(`AUTO: Page ${p} failed: ${e.message}`);
        }
      }
      console.log(`AUTO: Savills total: ${rawLots.length} lots from ${maxPages} pages`);

    } else if (rewritten.paginateAs === 'sdl_pages') {
      const firstResult = await scrapeRenderedPage(scrapeUrl, house);
      const sdlTotalPages = detectTotalPages(firstResult.html, scrapeUrl, house);
      console.log(`AUTO: SDL detected ${sdlTotalPages} pages`);

      const firstLots = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
      if (firstLots && firstLots.length > 0) rawLots.push(...firstLots);
      console.log(`AUTO: SDL Page 1: ${firstLots ? firstLots.length : 0} lots`);
      const sdlMaxPages = Math.min(sdlTotalPages, 20);
      for (let p = 2; p <= sdlMaxPages; p++) {
        const sep = scrapeUrl.includes('?') ? '&' : '?';
        const pageUrl = `${scrapeUrl}${sep}page=${p}`;
        try {
          const pageResult = await scrapeRenderedPage(pageUrl, house);
          const pageLots = extractWithJSDOM(pageResult.html, house, pageUrl, pageResult.images);
          if (pageLots && pageLots.length > 0) {
            rawLots.push(...pageLots);
            console.log(`AUTO: SDL Page ${p}: ${pageLots.length} lots`);
          } else {
            console.log(`AUTO: SDL Page ${p}: 0 lots — stopping`);
            break;
          }
        } catch (e) { console.log(`AUTO: SDL Page ${p} failed: ${e.message}`); break; }
      }
      console.log(`AUTO: SDL total: ${rawLots.length} lots`);

    } else if (rewritten.paginateAs === 'pugh_pages') {
      // Pugh: server-rendered — plain HTTP + JSDOM (saves Firecrawl credits)
      console.log(`AUTO: Loading paginated Pugh catalogue (plain HTTP)...`);
      const pughHtml1 = await fetchPage(scrapeUrl);
      const pughPage1Lots = extractWithJSDOM(pughHtml1, house, scrapeUrl);
      if (pughPage1Lots && pughPage1Lots.length > 0) rawLots.push(...pughPage1Lots);
      console.log(`AUTO: Pugh Page 1: ${pughPage1Lots ? pughPage1Lots.length : 0} lots`);

      const pughTotalPages = detectTotalPages(pughHtml1, scrapeUrl, house);
      const pughMaxPages = Math.min(pughTotalPages, 65);
      for (let p = 2; p <= pughMaxPages; p++) {
        if (rawLots.length >= MAX_LOTS_PER_SCRAPE) { console.log(`AUTO: Pugh lot cap at ${rawLots.length}`); break; }
        const pageUrl = buildPageUrl(scrapeUrl, p, house);
        try {
          const pageHtml = await fetchPage(pageUrl);
          const pageLots = extractWithJSDOM(pageHtml, house, pageUrl);
          if (pageLots && pageLots.length > 0) {
            rawLots.push(...pageLots);
            if (p % 10 === 0) console.log(`AUTO: Pugh Page ${p}: ${pageLots.length} lots (total: ${rawLots.length})`);
          } else {
            console.log(`AUTO: Pugh Page ${p}: 0 lots — stopping`);
            break;
          }
          await new Promise(r => setTimeout(r, 200));
        } catch (e) { console.log(`AUTO: Pugh Page ${p} failed: ${e.message}`); break; }
      }
      console.log(`AUTO: Pugh total: ${rawLots.length} lots`);

    } else {
      // ── Generic auto-paginating extraction ──
      const scrapeOpts = {};
      if (rewritten.waitFor) scrapeOpts.waitFor = rewritten.waitFor;
      if (rewritten.actions) scrapeOpts.actions = rewritten.actions;
      const firstResult = await scrapeRenderedPage(scrapeUrl, house, scrapeOpts);
      const domLots = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
      if (domLots && domLots.length >= 3) {
        rawLots.push(...domLots);
        console.log(`AUTO: ${house} Page 1: ${domLots.length} lots`);

        const detectedPages = detectTotalPages(firstResult.html, scrapeUrl, house);
        if (detectedPages > 1) {
          const PAGE_CAPS = { probateauction: 12, auctionhouselondon: 10 };
          const pageCap = PAGE_CAPS[house] || 25;
          const maxPages = Math.min(detectedPages, pageCap);
          console.log(`AUTO: ${house}: detected ${detectedPages} pages, loading up to ${maxPages}`);
          for (let p = 2; p <= maxPages; p++) {
            if (rawLots.length >= MAX_LOTS_PER_SCRAPE) { console.log(`AUTO: ${house}: lot cap reached at ${rawLots.length}`); break; }
            const pageUrl = buildPageUrl(scrapeUrl, p, house);
            try {
              const pageResult = await scrapeRenderedPage(pageUrl, house, scrapeOpts);
              const pageLots = extractWithJSDOM(pageResult.html, house, pageUrl, pageResult.images);
              if (pageLots && pageLots.length > 0) {
                rawLots.push(...pageLots);
                console.log(`AUTO: ${house} Page ${p}: ${pageLots.length} lots`);
              } else { console.log(`AUTO: ${house} Page ${p}: 0 lots — stopping`); break; }
            } catch (e) {
              console.log(`AUTO: ${house} Page ${p} failed: ${e.message}`);
              break;
            }
          }
        }
        if (rawLots.length > MAX_LOTS_PER_SCRAPE) {
          console.log(`AUTO: ${house}: capping ${rawLots.length} lots to ${MAX_LOTS_PER_SCRAPE}`);
          rawLots = rawLots.slice(0, MAX_LOTS_PER_SCRAPE);
        }
        console.log(`AUTO: ${house} total: ${rawLots.length} lots`);
      } else if (!creditExhausted) {
        // Fall back to Claude extraction
        const renderedPages = [{ page: 1, html: firstResult.html, markdown: firstResult.markdown }];
        rawLots = await extractLotsWithAI(renderedPages, house, null, scrapeUrl);
        console.log(`AUTO: ${house}: ${rawLots.length} lots via Claude fallback`);

        // ── DOM→Gemini merge: re-run DOM extractor to harvest URLs + images ──
        // Gemini loses URLs/images because it works on stripped text.
        // DOM extractors capture URLs and images from the HTML structure.
        // Merge by lot number to get best of both worlds.
        if (rawLots.length > 0 && firstResult.html) {
          const domHarvest = extractWithJSDOM(firstResult.html, house, scrapeUrl, firstResult.images);
          if (domHarvest && domHarvest.length > 0) {
            const domByLot = {};
            for (const d of domHarvest) {
              if (d.lot) domByLot[d.lot] = d;
            }
            let urlsMerged = 0, imgsMerged = 0;
            for (const lot of rawLots) {
              const dom = domByLot[lot.lot];
              if (!dom) continue;
              if (!lot.url && dom.url) { lot.url = dom.url; urlsMerged++; }
              if (!lot.imageUrl && dom.imageUrl) { lot.imageUrl = dom.imageUrl; imgsMerged++; }
            }
            // Also try position-based merge if lot numbers didn't match
            if (urlsMerged === 0 && imgsMerged === 0 && domHarvest.length >= rawLots.length * 0.5) {
              for (let i = 0; i < rawLots.length && i < domHarvest.length; i++) {
                if (!rawLots[i].url && domHarvest[i].url) { rawLots[i].url = domHarvest[i].url; urlsMerged++; }
                if (!rawLots[i].imageUrl && domHarvest[i].imageUrl) { rawLots[i].imageUrl = domHarvest[i].imageUrl; imgsMerged++; }
              }
            }
            if (urlsMerged > 0 || imgsMerged > 0) {
              console.log(`AUTO: ${house}: DOM→Gemini merge: ${urlsMerged} URLs, ${imgsMerged} images merged`);
            }
          }
        }
      } else {
        console.log(`AUTO: ${house}: DOM extractor found <3 lots and Gemini exhausted — skipping AI fallback`);
      }
    }

  } else {
    // Non-preferPuppeteer path: static HTTP + Gemini (skip Gemini when exhausted)
    if (!creditExhausted) {
      const pages = await scrapeAllPages(scrapeUrl, house);
      if (pages && pages.length > 0) rawLots = await extractLotsWithAI(pages, house, null, scrapeUrl);
    } else {
      console.log(`AUTO: ${house}: Gemini exhausted — skipping static+AI path, trying DOM fallback`);
    }
    // Rendered page fallback if static scraping found nothing
    const SKIP_PUPPETEER = ['philliparnold','knightfrank'];
    if (rawLots.length === 0 && !SKIP_PUPPETEER.includes(house)) {
      try {
        const rendered = await scrapeRenderedPage(url, house);
        if (rendered.html) {
          const renderedLots = extractWithJSDOM(rendered.html, house, url, rendered.images);
          if (renderedLots && renderedLots.length > 0) {
            rawLots = renderedLots;
          } else if (!creditExhausted) {
            const renderedPages = [{ page: 1, html: rendered.html, markdown: rendered.markdown }];
            rawLots = await extractLotsWithAI(renderedPages, house, null, scrapeUrl);
            // DOM→Gemini merge for this fallback path too
            if (rawLots.length > 0) {
              const domH = extractWithJSDOM(rendered.html, house, url, rendered.images);
              if (domH && domH.length > 0) {
                const byLot = {}; for (const d of domH) { if (d.lot) byLot[d.lot] = d; }
                let um = 0, im = 0;
                for (const lot of rawLots) {
                  const d = byLot[lot.lot]; if (!d) continue;
                  if (!lot.url && d.url) { lot.url = d.url; um++; }
                  if (!lot.imageUrl && d.imageUrl) { lot.imageUrl = d.imageUrl; im++; }
                }
                if (um === 0 && im === 0 && domH.length >= rawLots.length * 0.5) {
                  for (let i = 0; i < rawLots.length && i < domH.length; i++) {
                    if (!rawLots[i].url && domH[i].url) { rawLots[i].url = domH[i].url; um++; }
                    if (!rawLots[i].imageUrl && domH[i].imageUrl) { rawLots[i].imageUrl = domH[i].imageUrl; im++; }
                  }
                }
                if (um > 0 || im > 0) console.log(`AUTO: ${house}: DOM→Gemini merge (fallback): ${um} URLs, ${im} images`);
              }
            }
          } else {
            console.log(`AUTO: ${house}: DOM extractor found 0 lots and Gemini exhausted — no extraction possible`);
          }
        }
      } catch (err) {
        console.log(`AUTO: Rendered scraping fallback failed for ${house}: ${err.message}`);
      }
    }
  }

  if (rawLots.length === 0) {
    console.log(`AUTO: ${house}: 0 lots found, skipping cache`);
    // Extractor regression alert: 0 lots when previously had >0
    try {
      const { data: prevSkill } = await supabase.from('house_skills').select('last_lot_count').eq('slug', house).maybeSingle();
      if (prevSkill && prevSkill.last_lot_count > 0) {
        await supabase.from('pipeline_alerts').insert({
          event_type: 'extractor_regression',
          severity: 'error',
          house,
          message: `${HOUSE_DISPLAY_NAMES[house] || house} returned 0 lots (previously had ${prevSkill.last_lot_count})`
        });
        console.log(`ALERT: Extractor regression for ${house} (0 lots, was ${prevSkill.last_lot_count})`);

        // ── Self-healing: try to find a new catalogue URL ──
        console.log(`HEAL: Triggering self-healing for ${house} (was ${prevSkill.last_lot_count} lots, now 0)`);
        const healedUrl = await healBrokenHouse(house, url);
        if (healedUrl) {
          console.log(`HEAL: ✓ ${house} healed — re-analysing with new URL: ${healedUrl}`);
          // Re-analyse immediately with the new URL
          try {
            await autoAnalyseOne(healedUrl);
          } catch (reErr) {
            console.log(`HEAL: Re-analysis with healed URL failed for ${house}: ${reErr.message}`);
          }
        }
      }
    } catch (alertErr) { console.warn('ALERT: Failed to record extractor regression:', alertErr.message); }
    return;
  }

  let lots = rawLots.map(lot => analyseLot(lot)).sort((a, b) => b.score - a.score);
  await enrichLots(lots, house, url);

  // Unified lot-page enrichment: single fetch per lot extracts all missing data
  // (address, image, tenure, leaseLength, condition, beds, propType)
  await enrichLotsFromLotPages(lots);

  // Rendered page backfill for JS-rendered sites — try both engines for best coverage
  const stillNoImg = lots.filter(l => !l.imageUrl).length;
  if (stillNoImg > 0 && PUPPETEER_IMAGE_HOUSES.has(house)) {
    // Pass 1: Firecrawl (with executeJavascript to force lazy-load + images format)
    if (FIRECRAWL_API_KEY && !isFcCreditExhausted()) {
      await backfillImagesWithFirecrawl(url, lots, house);
    }
    // Pass 2: Puppeteer for any remaining misses (renders JS natively, better at intersection observers)
    const stillMissing = lots.filter(l => !l.imageUrl).length;
    if (stillMissing > 0 && puppeteer) {
      await backfillImagesWithPuppeteer(url, lots, house);
    }
  }

  // ── Fundability badges — fire-and-forget, never blocks pipeline ──
  try {
    await enrichLotsWithFundability(lots);
  } catch (e) {
    console.warn('Fundability enrichment failed (non-fatal):', e.message);
  }

  const expiresAt = new Date(Date.now() + getCacheTTL(house)).toISOString();

  // Check if catalogue data actually changed + quality gate
  const [{ data: prevCached }, { data: prevLotRows }] = await Promise.all([
    supabase.from('cached_analyses').select('total_lots, top_picks, title_splits').eq('url', normalisedUrl).single(),
    supabase.from('lots').select(LOTS_SELECT).eq('catalogue_url', normalisedUrl),
  ]);
  const prevLots = (prevLotRows || []).map(dbRowToFrontendLot);

  // ── Quality gate — reject bad batches before caching ──
  const qg = qualityGate(lots, house, prevCached, prevLots);
  if (qg.rejected) {
    console.log(`AUTO: ⚠ ${house} quality gate REJECTED batch. Keeping old data.`);
    // Record alert for monitoring
    if (supabase) {
      try {
        await supabase.from('pipeline_alerts').insert({
          event_type: 'quality_gate_reject',
          severity: 'warning',
          house,
          message: qg.alerts.join(' | '),
        });
      } catch (e) { /* non-fatal */ }
    }
    return;
  }
  lots = qg.lots; // use cleaned lots

  // ── Harness: data contract validation + enrichment + regression detection + health update ──
  try {
    const harnessBaseline = getBaseline(house);
    const harnessValidated = validateBatch(lots, house, { averageLotCount: harnessBaseline.averageLotCount });
    const harnessEnriched = enrichBatch(lots, house, {
      previousCache: prevLots,
    });
    lots = harnessEnriched.lots;
    if (harnessEnriched.stats.enriched > 0) {
      console.log(`HARNESS: ${house}: enriched ${harnessEnriched.stats.enriched} lots (${harnessEnriched.stats.fieldsImproved.join(', ')})`);
    }
    const harnessRegression = detectRegression(house, harnessValidated, harnessBaseline);
    const harnessGate = evaluateGate(house, harnessValidated, harnessRegression, prevCached);
    if (harnessGate.decision === 'reject') {
      console.log(`HARNESS: ${house} quality gate REJECTED — ${harnessGate.reason}. Keeping old data.`);
      // Extend existing cache TTL by 6h
      if (prevCached) {
        const extendedExpiry = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
        await supabase.from('cached_analyses').update({ expires_at: extendedExpiry }).eq('url', normalisedUrl);
      }
      return;
    }
    const harnessHealth = harnessUpdateHealth(house, {
      lots: harnessValidated,
      regression: harnessRegression,
      gate: harnessGate,
      extractionMethod: getLastExtractorUsed() || 'unknown',
    });
    if (harnessHealth.circuitBreaker === 'open') {
      harnessFireAlert({ type: 'circuit_open', severity: 'error', house, message: `Health ${harnessHealth.health}/100` }).catch(() => {});
    }
    if (harnessRegression.verdict === 'healthy') {
      harnessResolveAlert(house, 'extractor_regression').catch(() => {});
    }
  } catch (harnessErr) {
    console.warn(`HARNESS: ${house} harness processing failed (non-fatal):`, harnessErr.message);
  }

  const lotsWithPrice = lots.filter(l => l.price && l.price > 0);
  const yieldsArr = lots.map(l => l.estGrossYield).filter(y => y && y > 0);
  const newTotalLots = lots.length;
  const newTopPicks = lots.filter(l => l.score >= 3).length;
  const newTitleSplits = lots.filter(l => l.titleSplit).length;

  const catalogueChanged = !prevCached
    || prevCached.total_lots !== newTotalLots
    || prevCached.top_picks !== newTopPicks
    || prevCached.title_splits !== newTitleSplits;

  await supabase.from('cached_analyses').upsert({
    url: normalisedUrl,
    house: house,
    total_lots: newTotalLots,
    title_splits: newTitleSplits,
    top_picks: newTopPicks,
    under_100k: lotsWithPrice.filter(l => l.price < 100000).length,
    avg_yield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
    dev_potential: lots.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
    vacant_count: lots.filter(l => l.vacant === true).length,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    content_hash: autoAnalyseOne._lastContentHash || null,
    last_scraped_at: new Date().toISOString(),
    scraped_with: getLastScrapeEngine(),
    extracted_with: getLastExtractorUsed(),
    ai_tier: getLastAITier(),
  }, { onConflict: 'url' });

  // ── Upsert individual lots to lots table (single source of truth) ──
  normaliseLotStatuses(lots); // Normalize before write — canonical statuses only
  await upsertToLotsTable(lots, house, url, {
    scrapedWith: getLastScrapeEngine(),
    extractedWith: getLastExtractorUsed(),
  });

  // Mark preset cache entries as partially stale (only the changed catalogue needs re-searching)
  if (catalogueChanged) {
    const { data: affected } = await supabase
      .from('smart_search_cache')
      .select('query_key, stale_urls')
      .contains('source_urls', [normalisedUrl]);
    if (affected && affected.length > 0) {
      for (const row of affected) {
        const updatedStale = [...new Set([...(row.stale_urls || []), normalisedUrl])];
        await supabase.from('smart_search_cache')
          .update({ stale_urls: updatedStale })
          .eq('query_key', row.query_key);
      }
      console.log(`AUTO: Marked ${affected.length} preset cache entries stale for: ${normalisedUrl}`);
    }
  }

  console.log(`AUTO: ✓ ${house}: ${newTotalLots} lots cached (${newTitleSplits} title splits, ${newTopPicks} top picks)${catalogueChanged ? ' [CHANGED]' : ' [unchanged]'}`);

  // ── Compute per-scrape diff summary ──
  const scrapeDiff = computeScrapeDiff(prevLots, lots);
  try {
    await supabase.from('house_skills')
      .update({ last_diff: scrapeDiff })
      .eq('slug', house);
  } catch (diffErr) { console.warn(`DIFF: Failed to store diff for ${house}:`, diffErr.message); }

  // ── Skill tracking: persist to Supabase ──
  try {
    await updateHouseSkill(house, {
      catalogueUrl: url,
      lotCount: newTotalLots,
      imageCoverage: lots.length > 0 ? Math.round(lots.filter(l => l.imageUrl).length / lots.length * 100) : 0,
      scrapedWith: getLastScrapeEngine(),
      requiresPuppeteer: !!rewritten.preferPuppeteer,
    });
  } catch (skillErr) {
    console.warn(`SKILL: Failed to update skill for ${house}: ${skillErr.message}`);
  }

  // ── Auto-resolve alerts: successful scrape clears existing alerts for this house ──
  try {
    await supabase.from('pipeline_alerts')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('house', house)
      .eq('resolved', false);
  } catch (resolveErr) { console.warn('ALERT: Failed to auto-resolve alerts:', resolveErr.message); }

  } catch (autoErr) {
    // ── Pipeline alert: auto-analyse failure ──
    console.error(`AUTO: autoAnalyseOne failed for ${house}:`, autoErr.message);
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'auto_analyse_failure',
        severity: 'error',
        house,
        message: `Auto-analyse failed for ${HOUSE_DISPLAY_NAMES[house] || house}: ${autoErr.message}`
      });
    } catch (alertErr) { console.warn('ALERT: Failed to record auto-analyse failure:', alertErr.message); }
  }
}

// ═══════════════════════════════════════════════════════════════
// PER-SCRAPE DIFF COMPUTATION
// ═══════════════════════════════════════════════════════════════

function computeScrapeDiff(oldLots, newLots) {
  const oldMap = new Map((oldLots || []).map(l => [l.lotNumber || l.address || l.lot, l]));
  const newMap = new Map((newLots || []).map(l => [l.lotNumber || l.address || l.lot, l]));
  const added = [...newMap.keys()].filter(k => k && !oldMap.has(k));
  const removed = [...oldMap.keys()].filter(k => k && !newMap.has(k));
  const changed = [...newMap.keys()].filter(k => {
    if (!k || !oldMap.has(k)) return false;
    const o = oldMap.get(k), n = newMap.get(k);
    return o.price !== n.price || o.status !== n.status;
  });
  const imagesGained = (newLots || []).filter(l => l.imageUrl && !(oldMap.get(l.lotNumber || l.address || l.lot)?.imageUrl)).length;
  const imagesLost = (oldLots || []).filter(l => l.imageUrl && !(newMap.get(l.lotNumber || l.address || l.lot)?.imageUrl)).length;

  const summary = [];
  if (added.length) summary.push(`+${added.length} new lots`);
  if (removed.length) summary.push(`${removed.length} removed`);
  if (changed.length) summary.push(`${changed.length} changed`);
  if (imagesGained) summary.push(`${imagesGained} images added`);
  if (imagesLost) summary.push(`${imagesLost} images lost`);

  return {
    lots_added: added.length,
    lots_removed: removed.length,
    lots_changed: changed.length,
    images_gained: imagesGained,
    images_lost: imagesLost,
    status_changes: summary,
    timestamp: new Date().toISOString()
  };
}

// ═══════════════════════════════════════════════════════════════
// PER-HOUSE SKILL TRACKING
// ═══════════════════════════════════════════════════════════════

async function updateHouseSkill(slug, { catalogueUrl, lotCount, imageCoverage, scrapedWith, requiresPuppeteer }) {
  // Read existing skill from Supabase
  const { data: existing } = await supabase
    .from('house_skills')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  const now = new Date().toISOString();
  const displayName = HOUSE_DISPLAY_NAMES[slug] || slug;
  const rootUrl = HOUSE_ROOTS[slug] || catalogueUrl;

  // Determine extractor type
  let extractor = 'gemini';
  if (DOM_EXTRACTORS[slug]) {
    if (DOM_EXTRACTORS[slug] === DOM_EXTRACTORS.eigplatform) extractor = 'eigplatform';
    else if (DOM_EXTRACTORS[slug] === DOM_EXTRACTORS.auctionhouseuk) extractor = 'auctionhouseuk';
    else extractor = `${slug}_dom`;
  }

  // Calculate rolling average lot count (EMA)
  const prevAvg = existing?.average_lot_count || lotCount;
  const averageLotCount = Math.round((prevAvg * 0.7) + (lotCount * 0.3));

  // Determine pagination pattern
  let paginationPattern = existing?.pagination_pattern || 'none';
  if (rootUrl.includes('?page=')) paginationPattern = '?page=N';
  else if (rootUrl.includes('/page/')) paginationPattern = '/page/N';

  // Determine status
  let status = 'healthy';
  if (lotCount === 0) {
    status = 'broken';
  } else if (existing?.average_lot_count && lotCount < existing.average_lot_count * 0.7) {
    status = 'degraded';
  }

  // ── Image coverage drop alert: warn when coverage drops below 50% from above 50% ──
  const prevCoverage = existing?.image_coverage || 0;
  if (prevCoverage > 50 && imageCoverage < 50 && lotCount > 5) {
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'image_coverage_drop',
        severity: 'warning',
        house: slug,
        message: `${displayName} image coverage dropped from ${prevCoverage}% to ${imageCoverage}%`
      });
      console.log(`ALERT: Image coverage drop for ${displayName}: ${prevCoverage}% → ${imageCoverage}%`);
    } catch (alertErr) { console.warn('ALERT: Failed to record image coverage drop:', alertErr.message); }
  }

  // Auto-detect platform family from URL patterns or extractor type
  let platformFamily = existing?.platform_family || null;
  if (!platformFamily) {
    const url = (rootUrl || '').toLowerCase();
    if (url.includes('eigonlineauctions.com') || url.includes('eigpropertyauctions.co.uk') || url.includes('gotoproperties.co.uk') || extractor === 'eigplatform') platformFamily = 'eig';
    else if (url.includes('auctionhouse.co.uk') || extractor === 'auctionhouseuk') platformFamily = 'auctionhouse_uk';
    else if (url.includes('btgeddisonspropertyauctions.com') || url.includes('sdlauctions.co.uk')) platformFamily = 'btg_sdl';
    else if (url.includes('iamsold.co.uk')) platformFamily = 'iamsold';
    else if (url.includes('bambooauctions.com')) platformFamily = 'bamboo';
  }

  // Auto-generate logo URL from domain (Google favicon API — free, no scraping cost)
  let logoUrl = existing?.logo_url || null;
  if (!logoUrl && rootUrl) {
    try {
      const domain = new URL(rootUrl).hostname;
      logoUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    } catch { /* invalid URL, skip */ }
  }

  const skill = {
    slug,
    house: displayName,
    catalogue_url: rootUrl,
    extractor,
    platform_family: platformFamily,
    last_verified: now,
    last_lot_count: lotCount,
    average_lot_count: averageLotCount,
    image_coverage: imageCoverage,
    requires_puppeteer: !!requiresPuppeteer,
    requires_firecrawl: scrapedWith === 'firecrawl',
    pagination_pattern: paginationPattern,
    notes: existing?.notes || '',
    status,
    logo_url: logoUrl,
  };

  const { error } = await supabase
    .from('house_skills')
    .upsert(skill, { onConflict: 'slug' });

  if (error) throw new Error(`Supabase skill upsert failed: ${error.message}`);
  console.log(`SKILL: ${displayName} → ${status} (${lotCount} lots, ${imageCoverage}% images)`);
}

// ═══════════════════════════════════════════════════════════════
// DAILY ANALYTICS SNAPSHOTS
// ═══════════════════════════════════════════════════════════════

async function saveDailySnapshot() {
  const today = new Date().toISOString().slice(0, 10);

  // Check if we already saved today's snapshot
  const { data: existing } = await supabase
    .from('analytics_snapshots')
    .select('id')
    .eq('date', today)
    .maybeSingle();

  // Gather current state from cached_analyses (metadata) + lots table (image coverage)
  const [{ data: cached }, { data: imgStats }] = await Promise.all([
    supabase.from('cached_analyses').select('house, total_lots, scraped_with').gt('expires_at', new Date().toISOString()),
    supabase.from('lots').select('house, image_url'),
  ]);

  const houses = cached || [];
  let totalLots = 0;
  const lotsByHouse = {};
  const engineCounts = { firecrawl: 0, puppeteer: 0, http: 0 };

  for (const h of houses) {
    totalLots += h.total_lots || 0;
    lotsByHouse[h.house] = h.total_lots || 0;
    if (h.scraped_with && engineCounts[h.scraped_with] !== undefined) {
      engineCounts[h.scraped_with]++;
    }
  }

  const totalLotsForImages = (imgStats || []).length;
  const totalWithImages = (imgStats || []).filter(l => l.image_url).length;
  const imageCoveragePct = totalLotsForImages > 0 ? Math.round(totalWithImages / totalLotsForImages * 100) : 0;

  // Read skill health status from Supabase
  let healthyHouses = 0, degradedHouses = 0, brokenHouses = 0;
  try {
    const { data: skills } = await supabase.from('house_skills').select('status');
    for (const s of (skills || [])) {
      if (s.status === 'healthy') healthyHouses++;
      else if (s.status === 'degraded') degradedHouses++;
      else if (s.status === 'broken') brokenHouses++;
    }
  } catch {}

  const snapshot = {
    date: today,
    total_lots: totalLots,
    image_coverage_pct: imageCoveragePct,
    lots_by_house: lotsByHouse,
    engine_breakdown: engineCounts,
    healthy_houses: healthyHouses,
    degraded_houses: degradedHouses,
    broken_houses: brokenHouses,
  };

  if (existing) {
    await supabase.from('analytics_snapshots').update(snapshot).eq('date', today);
  } else {
    await supabase.from('analytics_snapshots').insert(snapshot);
  }

  console.log(`ANALYTICS: Snapshot saved for ${today} — ${totalLots} lots, ${imageCoveragePct}% images, ${houses.length} houses`);
}

// ── Pipeline Alerts API endpoint ──
app.get('/api/admin/alerts', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const { data: active } = await supabase
      .from('pipeline_alerts')
      .select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(50);

    const { data: recent } = await supabase
      .from('pipeline_alerts')
      .select('*')
      .eq('resolved', true)
      .order('resolved_at', { ascending: false })
      .limit(20);

    res.json({ active: active || [], recent: recent || [] });
  } catch (e) {
    log.error('Alerts endpoint error', { error: e.message });
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// ── Data Freshness API endpoint ──
app.get('/api/admin/freshness', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const { data: houses } = await supabase
      .from('house_skills')
      .select('slug, house, status, last_verified, last_lot_count, image_coverage, last_diff')
      .order('house');

    res.json({ houses: houses || [] });
  } catch (e) {
    log.error('Freshness endpoint error', { error: e.message });
    res.status(500).json({ error: 'Failed to fetch freshness data' });
  }
});

// ── Umami Cloud API helpers ──
async function fetchUmamiStats(startAt, endAt) {
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  const apiKey = process.env.UMAMI_API_KEY;
  if (!websiteId || !apiKey) return null;
  try {
    const res = await fetch(
      `https://api.umami.is/v1/websites/${websiteId}/stats?startAt=${startAt}&endAt=${endAt}`,
      { headers: { 'x-umami-api-key': apiKey, 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    log.warn('Umami stats API error', { error: e.message });
    return null;
  }
}

async function fetchUmamiMetrics(startAt, endAt, type) {
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  const apiKey = process.env.UMAMI_API_KEY;
  if (!websiteId || !apiKey) return [];
  try {
    const res = await fetch(
      `https://api.umami.is/v1/websites/${websiteId}/metrics?startAt=${startAt}&endAt=${endAt}&type=${type}`,
      { headers: { 'x-umami-api-key': apiKey, 'Accept': 'application/json' } }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    log.warn('Umami metrics API error', { error: e.message });
    return [];
  }
}

// ── Analytics API endpoint ──
app.get('/api/admin/analytics', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endAt = Date.now();
    const startAt = endAt - days * 24 * 60 * 60 * 1000;

    const [snapshots, umamiStats, umamiReferrers, activityEvents] = await Promise.all([
      supabase.from('analytics_snapshots').select('*').gte('date', since).order('date', { ascending: true }),
      fetchUmamiStats(startAt, endAt),
      fetchUmamiMetrics(startAt, endAt, 'referrer'),
      supabase.from('activity_events').select('action, detail, created_at, user_email')
        .gte('created_at', new Date(startAt).toISOString())
        .order('created_at', { ascending: true }),
    ]);

    res.json({
      snapshots: snapshots.data || [],
      umami: umamiStats,
      referrers: umamiReferrers,
      events: activityEvents.data || [],
    });
  } catch (e) {
    log.error('Analytics endpoint error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Seed today's snapshot on demand ──
app.post('/api/admin/seed-snapshot', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    await saveDailySnapshot();
    res.json({ ok: true, message: 'Snapshot saved' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Re-enrich lots with missing data ──
app.post('/api/admin/re-enrich', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const limit = Math.min(req.body?.limit || 200, 500);
    const house = req.body?.house || null; // optional: target specific house
    const dryRun = req.body?.dryRun !== false;

    console.log(`RE-ENRICH: Starting (limit=${limit}, house=${house || 'all'}, dryRun=${dryRun})...`);

    // Find lots needing enrichment: no enriched_at, or no score and recently seen
    let query = supabase
      .from('lots')
      .select('*')
      .or('enriched_at.is.null,score.is.null')
      .order('last_seen_at', { ascending: false })
      .limit(limit);
    if (house) query = query.eq('house', house);

    const { data: lots, error: lotsErr } = await query;
    if (lotsErr) throw new Error(`Failed to fetch lots: ${lotsErr.message}`);
    if (!lots || lots.length === 0) return res.json({ enriched: 0, message: 'No lots need enrichment' });

    // Group by house + catalogue_url for batch processing
    const groups = {};
    for (const lot of lots) {
      const key = `${lot.house}|${lot.catalogue_url}`;
      if (!groups[key]) groups[key] = { house: lot.house, catalogueUrl: lot.catalogue_url, lots: [] };
      groups[key].lots.push(lot);
    }

    if (dryRun) {
      const perHouse = {};
      for (const lot of lots) perHouse[lot.house] = (perHouse[lot.house] || 0) + 1;
      const gaps = {
        noScore: lots.filter(l => l.score == null).length,
        noEnrichedAt: lots.filter(l => !l.enriched_at).length,
        noPostcode: lots.filter(l => !l.postcode).length,
        noStreetAvg: lots.filter(l => l.street_avg == null).length,
        noYield: lots.filter(l => l.est_gross_yield == null).length,
        noCondition: lots.filter(l => !l.condition).length,
        noEpc: lots.filter(l => !l.epc_rating).length,
      };
      return res.json({ dryRun: true, found: lots.length, perHouse, gaps, message: 'POST with { "dryRun": false } to execute' });
    }

    let totalEnriched = 0;
    for (const [, group] of Object.entries(groups)) {
      try {
        // Convert DB rows back to in-memory lot format (includes postcode extraction + metadata)
        const lotObjs = group.lots.map(dbRowToLot);

        // Re-analyse lots that have no score (rebuilds scoring from scratch)
        const needsAnalysis = lotObjs.filter(l => l.score === 0 && (!l.scoreBreakdown || l.scoreBreakdown.length === 0));
        for (let i = 0; i < needsAnalysis.length; i++) {
          const reanalysed = analyseLot(needsAnalysis[i]);
          Object.assign(needsAnalysis[i], reanalysed);
        }

        // Run enrichLots for street comps, yield, EPC, flood
        await enrichLots(lotObjs, group.house, group.catalogueUrl);

        // Write enriched data back to lots table
        normaliseLotStatuses(lotObjs);
        await upsertToLotsTable(lotObjs, group.house, group.catalogueUrl, {
          scrapedWith: 're-enrich',
        });
        totalEnriched += lotObjs.length;
        console.log(`RE-ENRICH: ✓ ${group.house}: ${lotObjs.length} lots re-enriched`);
      } catch (groupErr) {
        console.warn(`RE-ENRICH: Failed for ${group.house}: ${groupErr.message}`);
      }
    }

    console.log(`RE-ENRICH: Complete — ${totalEnriched}/${lots.length} lots enriched`);
    res.json({ enriched: totalEnriched, total: lots.length, groups: Object.keys(groups).length });
  } catch (e) {
    console.error('RE-ENRICH: Failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DATA HYGIENE ENGINE
// ═══════════════════════════════════════════════════════════════
// Runs every 30 minutes. No waiting — every cycle does EVERYTHING for every
// lot that's missing any non-negotiable field. A lot without price/postcode/
// address is useless. Keep hammering until 100% hygiene or explicitly POA.
//
// Non-negotiable fields (lot is useless without these):
//   address, postcode, price, image, prop_type, beds
// Free-if-we-have-postcode (no excuse not to have):
//   EPC, flood risk, street comps, yield
// Lot-page enrichment (fetched per-lot if still missing):
//   tenure, condition, vacant, lease length

let _enrichmentWaveRunning = false;

// ── Helper: convert DB row to in-memory lot object ──
function dbRowToLot(dbRow) {
  return {
    lot: dbRow.lot_number, address: dbRow.address, postcode: dbRow.postcode || extractPostcode(dbRow.address),
    price: dbRow.price, priceText: dbRow.price_text, propType: dbRow.prop_type, beds: dbRow.beds,
    tenure: dbRow.tenure, leaseLength: dbRow.lease_length, sqft: dbRow.sqft, condition: dbRow.condition,
    imageUrl: dbRow.image_url, bullets: dbRow.bullets || [], units: dbRow.units || 0,
    status: dbRow.status || 'available', soldPrice: dbRow.sold_price,
    epcRating: dbRow.epc_rating, epcScore: dbRow.epc_score, epcDate: dbRow.epc_date,
    floodZone: dbRow.flood_zone, floodRiskLevel: dbRow.flood_risk,
    streetAvg: dbRow.street_avg, streetSales: dbRow.street_sales, streetSalesCount: dbRow.street_sales_count,
    belowMarket: dbRow.below_market, estMonthlyRent: dbRow.est_monthly_rent,
    estAnnualRent: dbRow.est_annual_rent, estGrossYield: dbRow.est_gross_yield,
    score: dbRow.score != null ? dbRow.score : 0, scoreBreakdown: dbRow.score_breakdown || [],
    opps: dbRow.opps || [], risks: dbRow.risks || [], dealType: dbRow.deal_type,
    vacant: dbRow.vacant, titleSplit: dbRow.title_split, url: dbRow.url, enrichedAt: dbRow.enriched_at,
    rawText: dbRow.raw_text || null,
    _dbId: dbRow.id, _house: dbRow.house, _catalogueUrl: dbRow.catalogue_url,
  };
}

// ── Helper: convert DB row to frontend-ready camelCase lot (for API responses) ──
function dbRowToFrontendLot(r) {
  return {
    _house: r.house, lot: r.lot_number, url: r.url, _sourceUrl: r.catalogue_url,
    address: r.address, postcode: r.postcode, price: r.price, priceText: r.price_text,
    propType: r.prop_type, beds: r.beds, tenure: r.tenure, leaseLength: r.lease_length,
    sqft: r.sqft, condition: r.condition, imageUrl: r.image_url, bullets: r.bullets || [],
    units: r.units || 0, _auctionDate: r.auction_date, status: r.status, soldPrice: r.sold_price,
    epcRating: r.epc_rating, epcScore: r.epc_score, epcDate: r.epc_date,
    floodZone: r.flood_zone, floodRiskLevel: r.flood_risk, streetAvg: r.street_avg,
    streetSales: r.street_sales, streetSalesCount: r.street_sales_count,
    belowMarket: r.below_market, estMonthlyRent: r.est_monthly_rent,
    estAnnualRent: r.est_annual_rent,
    estGrossYield: r.est_gross_yield != null ? parseFloat(r.est_gross_yield) : null,
    score: r.score != null ? parseFloat(r.score) : null, scoreBreakdown: r.score_breakdown || [],
    opps: r.opps || [], risks: r.risks || [], dealType: r.deal_type,
    vacant: r.vacant, titleSplit: r.title_split,
    _searchText: r.search_text || '',
  };
}

// ── Helper: standard lots select columns for DB queries ──
const LOTS_SELECT = 'house, lot_number, url, catalogue_url, address, postcode, price, price_text, prop_type, beds, tenure, lease_length, sqft, condition, image_url, bullets, units, auction_date, status, sold_price, epc_rating, epc_score, epc_date, flood_zone, flood_risk, street_avg, street_sales, street_sales_count, below_market, est_monthly_rent, est_annual_rent, est_gross_yield, score, score_breakdown, opps, risks, deal_type, vacant, title_split, search_text';

// ── Helper: group lots by house+catalogue and upsert ──
async function upsertLotGroups(lotObjs, source) {
  const groups = {};
  for (const lot of lotObjs) {
    const key = `${lot._house}|${lot._catalogueUrl}`;
    if (!groups[key]) groups[key] = { house: lot._house, catalogueUrl: lot._catalogueUrl, lots: [] };
    groups[key].lots.push(lot);
  }
  let total = 0;
  for (const [, g] of Object.entries(groups)) {
    normaliseLotStatuses(g.lots);
    await upsertToLotsTable(g.lots, g.house, g.catalogueUrl, { scrapedWith: source });
    total += g.lots.length;
  }
  return total;
}

// ── Price extraction from HTML (shared by price hunter + lot-page enrichment) ──
function extractPriceFromText(text) {
  const patterns = [
    /(?:guide\s*price|starting\s*bid|minimum\s*opening\s*bid|reserve\s*price|current\s*bid)[^£]{0,30}£([\d,]+)/i,
    /£([\d,]+)\s*(?:guide|starting|plus|reserve|\+)/i,
    /(?:price|sold\s*(?:for|at|price))[^£]{0,20}£([\d,]+)/i,
    /£([\d,]+)\s*[-–]\s*£([\d,]+)/i, // range — take lower
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const p = parseInt(m[1].replace(/,/g, ''), 10);
      if (p >= 500 && p <= 50000000) return { price: p, priceText: null };
    }
  }
  // Fallback: any standalone £ amount
  const allPrices = [...text.matchAll(/£([\d,]+)/g)]
    .map(m => parseInt(m[1].replace(/,/g, ''), 10))
    .filter(p => p >= 1000 && p <= 50000000);
  if (allPrices.length === 1) return { price: allPrices[0], priceText: null };
  if (allPrices.length > 1) {
    const nonFee = allPrices.filter(p => p >= 5000);
    if (nonFee.length > 0) return { price: nonFee[0], priceText: null };
  }
  // Detect explicit no-price
  if (/\b(?:price on application|p\.?o\.?a\.?|to be advised|t\.?b\.?a\.?|refer to auctioneer|contact.*for.*price|price available on request|offers? invited|no guide|by negotiation)\b/i.test(text)) {
    return { price: null, priceText: 'POA' };
  }
  return null;
}

async function runEnrichmentWave() {
  if (_enrichmentWaveRunning) { console.log('HYGIENE: Already running, skipping'); return; }
  _enrichmentWaveRunning = true;
  const stats = { lotPageFetched: 0, pricesFound: 0, pricesPoa: 0, postcodeFixed: 0, enriched: 0, lotPageEnriched: 0 };
  try {
    console.log(`HYGIENE: Starting at ${new Date().toISOString()}...`);

    // ═══ PASS 1: Price Hunter — fetch lot pages for every lot missing price ═══
    // Price is the #1 non-negotiable. 500 per cycle — Firecrawl budget has headroom.
    const { data: pricelessLots } = await supabase
      .from('lots')
      .select('*')
      .or('price.is.null,price.eq.0')
      .not('url', 'like', '__synthetic__%')
      .is('price_text', null) // skip lots already confirmed POA
      .order('last_seen_at', { ascending: false })
      .limit(500);

    if (pricelessLots && pricelessLots.length > 0) {
      console.log(`HYGIENE [price]: ${pricelessLots.length} lots missing prices...`);
      for (let i = 0; i < pricelessLots.length; i += 5) {
        if (i > 0) await new Promise(r => setTimeout(r, 300));
        const batch = pricelessLots.slice(i, i + 5);
        await Promise.allSettled(batch.map(async (dbRow) => {
          try {
            const result = await fetchLotPage(dbRow.url);
            if (!result) return;
            stats.lotPageFetched++;
            const text = result.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
            const extracted = extractPriceFromText(text);
            const update = {};
            if (extracted) {
              if (extracted.price) { update.price = extracted.price; stats.pricesFound++; }
              if (extracted.priceText) { update.price_text = extracted.priceText; stats.pricesPoa++; }
            }
            // Capture raw_text while we have the page
            if (!dbRow.raw_text) {
              const rawText = result.html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              if (rawText.length > 50) update.raw_text = rawText.slice(0, 10000);
            }
            if (Object.keys(update).length > 0) {
              await supabase.from('lots').update(update).eq('id', dbRow.id);
            }
          } catch { /* retry next cycle */ }
        }));
      }
      console.log(`HYGIENE [price]: ✓ ${stats.pricesFound} found, ${stats.pricesPoa} POA`);
    }

    // ═══ PASS 2: Postcode rescue — lot-page fetch for lots with no postcode ═══
    const { data: noPostcodeLots } = await supabase
      .from('lots')
      .select('*')
      .is('postcode', null)
      .not('url', 'like', '__synthetic__%')
      .order('last_seen_at', { ascending: false })
      .limit(300);

    if (noPostcodeLots && noPostcodeLots.length > 0) {
      console.log(`HYGIENE [postcode]: ${noPostcodeLots.length} lots missing postcodes...`);
      const lotObjs = noPostcodeLots.map(dbRowToLot);
      await enrichLotsFromLotPages(lotObjs, 3);
      for (const lot of lotObjs) {
        if (!lot.postcode && lot.address) {
          lot.postcode = extractPostcode(lot.address);
          if (lot.postcode) stats.postcodeFixed++;
        }
      }
      await upsertLotGroups(lotObjs, 'hygiene-postcode');
      console.log(`HYGIENE [postcode]: ✓ ${stats.postcodeFixed} postcodes recovered`);
    }

    // ═══ PASS 3: Full enrichment — comps, yield, EPC, flood for lots with postcode but missing data ═══
    // No time gates. If you have a postcode and are missing EPC/flood/comps/yield, you get enriched NOW.
    const { data: needsEnrichment } = await supabase
      .from('lots')
      .select('*')
      .not('postcode', 'is', null)
      .or('enriched_at.is.null,epc_rating.is.null,flood_risk.is.null,street_avg.is.null,est_gross_yield.is.null')
      .order('last_seen_at', { ascending: false })
      .limit(500);

    if (needsEnrichment && needsEnrichment.length > 0) {
      console.log(`HYGIENE [enrich]: ${needsEnrichment.length} lots have postcode but missing EPC/flood/comps/yield...`);
      const groups = {};
      for (const row of needsEnrichment) {
        const key = `${row.house}|${row.catalogue_url}`;
        if (!groups[key]) groups[key] = { house: row.house, catalogueUrl: row.catalogue_url, rows: [] };
        groups[key].rows.push(row);
      }

      for (const [, group] of Object.entries(groups)) {
        try {
          const lotObjs = group.rows.map(dbRowToLot);
          // Re-analyse unscored lots
          for (const lot of lotObjs) {
            if (lot.score === 0 && (!lot.scoreBreakdown || lot.scoreBreakdown.length === 0)) {
              Object.assign(lot, analyseLot(lot));
            }
            // Condition inference from bullets
            if (!lot.condition && lot.bullets && lot.bullets.length > 0) {
              const t = lot.bullets.join(' ').toLowerCase();
              if (/derelict|dilapidated|fire damage/.test(t)) lot.condition = 'poor';
              else if (/modernis|refurbishment|renovation|updating|in need of|improvement|requires? (?:updating|work|repair)|fixer.upper/.test(t)) lot.condition = 'needs work';
              else if (/good order|good decorative|well maintained|recently refurbished|good condition/.test(t)) lot.condition = 'good';
            }
          }
          // enrichLots does: Land Registry comps, yield calc, EPC lookup, flood check
          await enrichLots(lotObjs, group.house, group.catalogueUrl);
          normaliseLotStatuses(lotObjs);
          await upsertToLotsTable(lotObjs, group.house, group.catalogueUrl, { scrapedWith: 'hygiene-enrich' });
          stats.enriched += lotObjs.length;
          console.log(`HYGIENE [enrich]: ✓ ${group.house}: ${lotObjs.length} lots`);
        } catch (e) {
          console.warn(`HYGIENE [enrich]: Failed for ${group.house}: ${e.message}`);
        }
      }
    }

    // ═══ PASS 4: Lot-page deep enrichment — tenure, condition, beds, vacant, images ═══
    // Targets any lot still missing non-negotiable fields that has a fetchable URL.
    const { data: needsLotPage } = await supabase
      .from('lots')
      .select('*')
      .not('url', 'like', '__synthetic__%')
      .or('tenure.is.null,condition.is.null,beds.is.null,image_url.is.null,prop_type.is.null,vacant.is.null')
      .order('last_seen_at', { ascending: false })
      .limit(300);

    if (needsLotPage && needsLotPage.length > 0) {
      console.log(`HYGIENE [lot-page]: ${needsLotPage.length} lots need deep enrichment from lot pages...`);
      const lotObjs = needsLotPage.map(dbRowToLot);
      try {
        await enrichLotsFromLotPages(lotObjs, 3);
        await upsertLotGroups(lotObjs, 'hygiene-lotpage');
        stats.lotPageEnriched += lotObjs.length;
        console.log(`HYGIENE [lot-page]: ✓ ${lotObjs.length} lots enriched`);
      } catch (e) {
        console.warn(`HYGIENE [lot-page]: Failed: ${e.message}`);
      }
    }

    // ═══ Summary ═══
    const { count: remainingNoPrice } = await supabase.from('lots').select('*', { count: 'exact', head: true }).or('price.is.null,price.eq.0').is('price_text', null);
    const { count: remainingNoPostcode } = await supabase.from('lots').select('*', { count: 'exact', head: true }).is('postcode', null).not('url', 'like', '__synthetic__%');
    const { count: remainingNoEnrich } = await supabase.from('lots').select('*', { count: 'exact', head: true }).is('enriched_at', null).not('postcode', 'is', null);
    console.log(`HYGIENE: Complete — prices:${stats.pricesFound}found/${stats.pricesPoa}poa, postcodes:${stats.postcodeFixed}fixed, enriched:${stats.enriched}, lotPages:${stats.lotPageEnriched}`);
    console.log(`HYGIENE: Remaining gaps — no price:${remainingNoPrice || 0}, no postcode:${remainingNoPostcode || 0}, no enrichment:${remainingNoEnrich || 0}`);
  } catch (e) {
    console.error('HYGIENE: Fatal error:', e.message);
  } finally {
    _enrichmentWaveRunning = false;
  }
}

// ── Manual trigger for enrichment waves ──
app.post('/api/admin/enrich-waves', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  if (_enrichmentWaveRunning) return res.json({ ok: false, message: 'Enrichment wave already running' });
  runEnrichmentWave().catch(e => console.error('Manual enrichment wave failed:', e.message));
  res.json({ ok: true, message: 'Enrichment wave started in background' });
});

// ── Lightweight event tracking for client-only actions ──
app.post('/api/track/event', rateLimit(60000, 30), async (req, res) => {
  const { action, detail } = req.body || {};
  const allowed = ['deal_stacking', 'csv_export', 'bridgematch_open'];
  if (!action || !allowed.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const user = await validateUserFromReq(req).catch(() => null);
  logActivityEvent(action, detail || {}, user?.email || null, getClientIP(req));
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
// CATCH-ALL — must be AFTER all route registrations
// ═══════════════════════════════════════════════════════════════
app.get('*', (req, res) => {
  try {
    let html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
    // Inject Supabase config — JSON.stringify escapes any special chars to prevent XSS
    html = html.replace("window.__SUPABASE_URL__ || ''", JSON.stringify(SUPABASE_URL || ''));
    html = html.replace("window.__SUPABASE_ANON_KEY__ || ''", JSON.stringify(SUPABASE_ANON_KEY || ''));
    html = html.replace("window.__AUTH_ENABLED__ || false", AUTH_ENABLED ? 'true' : 'false');
    // Inject Umami website ID from env so the HTML doesn't need hardcoded IDs
    if (process.env.UMAMI_WEBSITE_ID) {
      html = html.replace('data-website-id=""', `data-website-id="${process.env.UMAMI_WEBSITE_ID}"`);
    }
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  } catch (e) {
    log.error('Failed to inject config into index.html', { error: e.message });
    res.sendFile(join(__dirname, 'index.html'));
  }
});

// ═══════════════════════════════════════════════════════════════
// ACTIVITY LOGGING & STATS
// ═══════════════════════════════════════════════════════════════

async function logActivityEvent(action, detail = {}, email = null, ip = null) {
  try {
    await supabase.from('activity_events').insert({
      user_email: email || null,
      action,
      detail,
      ip: ip || null,
    });
  } catch (e) {
    console.warn('Activity log error:', e.message);
  }
}

// Helper: get catalogue-ready auctions (used by auto-analyse)
