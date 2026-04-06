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
import { randomBytes, timingSafeEqual, createHash } from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { readFileSync } from 'fs';
import { lookup } from 'dns/promises';
import { JSDOM } from 'jsdom';
let puppeteer = null;
try { puppeteer = (await import('puppeteer')).default; } catch {}
import Stripe from 'stripe';
import { callAI, initAI, getAICostSummary } from './lib/ai-provider.js';

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

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════
// ENV VAR VALIDATION
// ═══════════════════════════════════════════════════════════════
const REQUIRED_ENV = ['GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const RECOMMENDED_ENV = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SUPABASE_ANON_KEY', 'SUPABASE_JWT_SECRET', 'ADMIN_SECRET', 'RESEND_API_KEY', 'FIRECRAWL_API_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Required environment variable ${key} is not set. Server cannot start.`);
    process.exit(1);
  }
}
for (const key of RECOMMENDED_ENV) {
  if (!process.env[key]) console.warn(`WARNING: Recommended env var ${key} is not set — some features will be disabled.`);
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// URL normalisation — single source of truth for comparing / deduplicating URLs
const normaliseUrl = u => (u || '').trim().replace(/\/+$/, '').replace(/^http:\/\//i, 'https://').replace(/^(https:\/\/)www\./i, '$1').toLowerCase();

// ── Stripe feature flag: defaults to false (free-first), set STRIPE_ENABLED=true to reinstate payments ──
const STRIPE_ENABLED = process.env.STRIPE_ENABLED === 'true';
const stripe = STRIPE_ENABLED && process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const app = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's reverse proxy for correct client IP via req.ip / X-Forwarded-For
app.set('trust proxy', 1);

// Stripe webhook needs raw body for signature verification — MUST come before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '100kb' }));

// ═══════════════════════════════════════════════════════════════
// CORS
// ═══════════════════════════════════════════════════════════════
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://auctions.bridgematch.co.uk,https://www.bridgematch.co.uk,https://bridgematch.co.uk').split(',');
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

// Timing-safe string comparison for auth tokens
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

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
loadBrokenExtractors();

// ═══════════════════════════════════════════════════════════════
// SECURITY HEADERS
// ═══════════════════════════════════════════════════════════════
app.use((req, res, next) => {
  const stripeSrc = STRIPE_ENABLED ? ' https://checkout.stripe.com' : '';
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://cloud.umami.is; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    `connect-src 'self' https://*.supabase.co https://www.bridgematch.co.uk https://cloud.umami.is https://api.umami.is${stripeSrc}; ` +
    (STRIPE_ENABLED ? "frame-src https://checkout.stripe.com; " : "frame-src 'none'; ") +
    "frame-ancestors 'none'; " +
    "form-action 'self'; " +
    "upgrade-insecure-requests"
  );
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ═══════════════════════════════════════════════════════════════
// CSRF ORIGIN VALIDATION
// ═══════════════════════════════════════════════════════════════
function csrfCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/api/stripe/webhook') return next(); // Stripe uses its own signature verification
  const origin = (req.headers.origin || req.headers.referer || '').replace(/\/+$/, '');
  if (origin && ALLOWED_ORIGINS.some(a => origin === a || origin === a + '/')) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden — missing or invalid Origin header' });
}
app.use(csrfCheck);

// ═══════════════════════════════════════════════════════════════
// SUPABASE CLIENT
// ═══════════════════════════════════════════════════════════════
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// ═══════════════════════════════════════════════════════════════
// SUPABASE AUTH (JWT verification)
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const AUTH_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

let jwks = null;
if (SUPABASE_URL) {
  try {
    jwks = createRemoteJWKSet(new URL(SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/.well-known/jwks.json'));
    console.log('[AUTH] JWKS client created for ES256 verification');
  } catch (e) {
    console.warn('[AUTH] Failed to create JWKS client:', e.message);
  }
}

async function verifySupabaseToken(token) {
  // Try ES256 via JWKS first (Supabase default)
  if (jwks) {
    try {
      const { payload } = await jwtVerify(token, jwks, { audience: 'authenticated' });
      return payload;
    } catch (e) {
      if (e.code === 'ERR_JWT_EXPIRED') return { error: 'Session expired — please sign in again' };
      // Fall through to HS256
    }
  }
  // Fallback: HS256 with JWT secret
  if (SUPABASE_JWT_SECRET) {
    try {
      const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
      const { payload } = await jwtVerify(token, secret, { audience: 'authenticated' });
      return payload;
    } catch (e) {
      if (e.code === 'ERR_JWT_EXPIRED') return { error: 'Session expired — please sign in again' };
      return { error: 'Invalid token' };
    }
  }
  return { error: 'Auth not configured' };
}

// ═══════════════════════════════════════════════════════════════
// STRUCTURED LOGGING
// ═══════════════════════════════════════════════════════════════
function log(level, message, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, msg: message, ...meta };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
log.info = (msg, meta) => log('info', msg, meta);
log.warn = (msg, meta) => log('warn', msg, meta);
log.error = (msg, meta) => log('error', msg, meta);

// SSE helper for streaming progress events
function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Request logging middleware
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const start = Date.now();
  res.on('finish', () => {
    log.info('request', { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start, ip: getClientIP(req) });
  });
  next();
});

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const RATE_LIMIT = STRIPE_ENABLED ? 5 : 50; // 50/day for signed-in users when Stripe disabled
const CACHE_DAYS = 7; // fallback default
const CACHE_TIERS = {
  high:   { houses: ['allsop','savills','sdl','network','bidx1'], ttlHours: 12 },
  medium: { houses: ['cliveemson','edwardmellor','bondwolfe','strettons','countrywide','suttonkersh','tcpa','futureauctions','firstforauctions','harmanhealy','astleys','henrysykes','clarkesimpson','durrants','dawsons','goldings','auctionhousescotland','austingray','auctionhouseeastanglia','auctionhousenorthwest','auctionhousenortheast','auctionhousewales','auctionhousebirmingham','auctionhousekent','iamsold','buttersjohnbee','brownco','fssproperty','auctionhousedevon','auctionhouseeastmidlands','auctionhousewestmidlands','auctionhouseessex','auctionhousemanchester','romanway','hammerprice'], ttlHours: 18 },
  low:    { houses: [], ttlHours: 24 }  // everything else
};
function getCacheTTL(houseKey) {
  if (CACHE_TIERS.high.houses.includes(houseKey)) return CACHE_TIERS.high.ttlHours * 3600000;
  if (CACHE_TIERS.medium.houses.includes(houseKey)) return CACHE_TIERS.medium.ttlHours * 3600000;
  return CACHE_TIERS.low.ttlHours * 3600000;
}
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};
const MAX_PAGES = 40;
const MAX_PUPPETEER_PAGES = 15;
const MAX_LOTS_PER_SCRAPE = 5000;
const MAX_AUCTIONS_PER_HOUSE = 2;
const TIMEOUT = 25000;
// Houses where catalogue pages are JS-rendered — need Puppeteer for image backfill
// All houses get rendered image backfill — every DOM extractor has image selectors.
// Previously limited to 14 houses, leaving ~24 houses with no backfill.
// Populated after HOUSE_ROOTS is defined (see below).
let PUPPETEER_IMAGE_HOUSES = null;

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

// ── Firecrawl rate limiter & credit tracking ──
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';
const FIRECRAWL_MONTHLY_BUDGET = parseInt(process.env.FIRECRAWL_MONTHLY_BUDGET || '15000');
const FIRECRAWL_SKIP = new Set((process.env.FIRECRAWL_SKIP_HOUSES || '').split(',').filter(Boolean));
let _fcLastCall = 0;
const FC_MIN_GAP = parseInt(process.env.FIRECRAWL_MIN_GAP_MS || '300');
async function firecrawlRateLimited(fn) {
  const now = Date.now();
  const earliest = _fcLastCall + FC_MIN_GAP;
  const wait = Math.max(0, earliest - now);
  _fcLastCall = now + wait;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  return fn();
}

let fcCreditsUsed = 0;
let fcCreditExhausted = false;
let fcExhaustedAt = 0;
let fcFallbackCount = 0;
let fcErrorCount = 0;
let fcRequestCount = 0;
let fcTemporarilyDown = false;
let fcDownAt = 0;
let fcConsecutive5xx = 0;
let fcLastError = null;
let fcLastErrorAt = null;

async function scrapeWithFirecrawl(url, options = {}) {
  if (!FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY not set');
  if (fcCreditExhausted) throw new Error('Firecrawl credits exhausted');
  if (fcTemporarilyDown && Date.now() - fcDownAt < 600000) throw new Error('Firecrawl temporarily down');

  const formats = options.formats || ['markdown', 'rawHtml'];
  const body = {
    url,
    formats,
  };
  if (options.waitFor) body.waitFor = options.waitFor;
  if (options.actions) body.actions = options.actions;

  const doFetch = async () => {
    const resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (resp.status === 402 || resp.status === 429) {
      fcCreditExhausted = true;
      fcExhaustedAt = Date.now();
      console.log('Firecrawl: credit/rate limit hit — switching to fallback');
      throw new Error(`Firecrawl ${resp.status}: credits/rate exhausted`);
    }

    if (resp.status >= 500) {
      fcConsecutive5xx++;
      if (fcConsecutive5xx >= 3) {
        fcTemporarilyDown = true;
        fcDownAt = Date.now();
        console.log('Firecrawl: 3 consecutive 5xx — marking temporarily down for 10min');
      }
      throw new Error(`Firecrawl ${resp.status}: server error`);
    }

    if (!resp.ok) throw new Error(`Firecrawl ${resp.status}: ${await resp.text().catch(() => 'unknown')}`);

    fcConsecutive5xx = 0;
    const data = await resp.json();
    if (!data.success) throw new Error(`Firecrawl returned success=false: ${data.error || 'unknown'}`);

    fcCreditsUsed++;
    fcRequestCount++;
    return {
      html: data.data?.rawHtml || data.data?.html || '',
      markdown: data.data?.markdown || '',
      sourceURL: data.data?.metadata?.sourceURL || url,
      images: data.data?.images || [],
    };
  };

  // 1 retry on 5xx/timeout with 2s backoff
  try {
    return await firecrawlRateLimited(doFetch);
  } catch (err) {
    if (/5\d\d|timeout|abort/i.test(err.message)) {
      console.log(`Firecrawl: retrying after error: ${err.message}`);
      await new Promise(r => setTimeout(r, 2000));
      try {
        return await firecrawlRateLimited(doFetch);
      } catch (retryErr) {
        fcErrorCount++;
        fcLastError = retryErr.message;
        fcLastErrorAt = new Date().toISOString();
        throw retryErr;
      }
    }
    fcErrorCount++;
    fcLastError = err.message;
    fcLastErrorAt = new Date().toISOString();
    throw err;
  }
}

// Validate image URLs — must be https and either have a known image extension or come from a known CDN
const IMG_EXTENSIONS = /\.(jpe?g|png|webp)(\?.*)?$/i;
const IMG_CDN_DOMAINS = /cloudinary\.com|imgix\.net|cdn\.sanity\.io|images\.unsplash\.com|ik\.imagekit\.io|res\.cloudinary\.com|s3\.amazonaws\.com|amazonaws\.com\/.*\.(jpe?g|png|webp)|cdn\.shopify\.com|akamaized\.net|cloudfront\.net|twimg\.com|fbcdn\.net|googleusercontent\.com|wp-content\/uploads|supabase\.co\/storage|i\.imgur\.com|eigpropertyauctions\.co\.uk|auction|property|lot|catalogue|catalog/i;

function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https:\/\//i.test(url)) return false;
  if (IMG_EXTENSIONS.test(url)) return true;
  if (IMG_CDN_DOMAINS.test(url)) return true;
  return false;
}

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

function extractWithJSDOM(html, house, baseUrl, firecrawlImages) {
  const dom = new JSDOM(html, { url: baseUrl });
  const { document } = dom.window;

  let lots = null;

  // Skip DOM extraction if house is in BROKEN_EXTRACTORS set (triggers Gemini AI fallback)
  if (BROKEN_EXTRACTORS.has(house)) {
    console.log(`JSDOM extractor for ${house}: SKIPPED (broken extractor -- Gemini fallback)`);
    dom.window.close();
    return null;
  }

  // Try house-specific extractor first
  const extractor = DOM_EXTRACTORS[house];
  if (extractor) {
    try {
      const fn = new Function('document', `${IMG_HELPERS}\nreturn ${extractor.trim()}`);
      const result = fn(document);
      if (Array.isArray(result) && result.length > 0) {
        console.log(`JSDOM extractor for ${house}: found ${result.length} lots`);
        lots = result;
        _lastExtractorUsed = 'dom-house';
      }
    } catch (err) {
      log.warn('JSDOM extractor error', { house, error: err.message });
    }
  }

  // Fall back to universal extractor
  if (!lots) {
    try {
      const fn = new Function('document', `${IMG_HELPERS}\nreturn ${UNIVERSAL_DOM_EXTRACTOR.trim()}`);
      const result = fn(document);
      if (Array.isArray(result) && result.length > 0) {
        console.log(`JSDOM universal extractor for ${house}: found ${result.length} lots`);
        lots = result;
        _lastExtractorUsed = 'dom-generic';
      }
    } catch (err) {
      log.warn('JSDOM universal extractor error', { house, error: err.message });
    }
  }

  if (!lots) {
    console.log(`All JSDOM extractors for ${house}: found 0 lots`);
    dom.window.close();
    return null;
  }

  // Save raw URLs for image matching
  const rawUrls = lots.map(l => l.url || '');

  // Resolve relative URLs to absolute
  for (const lot of lots) {
    if (lot.url && !/^https?:\/\//i.test(lot.url)) {
      try { lot.url = new URL(lot.url, baseUrl).href; } catch {}
    }
    if (lot.detailUrl && !/^https?:\/\//i.test(lot.detailUrl)) {
      try { lot.detailUrl = new URL(lot.detailUrl, baseUrl).href; } catch {}
    }
    if (lot.imageUrl && !/^https?:\/\//i.test(lot.imageUrl)) {
      try { lot.imageUrl = new URL(lot.imageUrl, baseUrl).href; } catch {}
    }
  }

  // Image extraction pass — match by lot URL href→image mapping
  try {
    const skip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|loading|cookie|emoji/i;
    const hrefImageMap = {};
    const links = document.querySelectorAll('a[href]');
    for (const link of links) {
      const rawHref = link.getAttribute('href') || '';
      let absHref;
      try { absHref = new URL(rawHref, baseUrl).href; } catch { absHref = rawHref; }
      if (!rawHref || rawHref === '#') continue;
      if (hrefImageMap[rawHref] || hrefImageMap[absHref]) continue;

      // Strategy 1: <img> inside the link
      let imgSrc = '';
      let img = link.querySelector('img');
      // Strategy 2: Walk up parent (up to 5 levels)
      if (!img) {
        let el = link;
        for (let depth = 0; depth < 5; depth++) {
          el = el.parentElement;
          if (!el) break;
          img = el.querySelector('img');
          if (img) break;
        }
      }
      if (img) {
        imgSrc = img.getAttribute('src') || img.getAttribute('data-src')
          || img.getAttribute('data-lazy-src') || img.getAttribute('data-original')
          || (img.getAttribute('srcset') ? img.getAttribute('srcset').split(',')[0].trim().split(/\s+/)[0] : '');
      }

      // Strategy 3: background-image
      if (!imgSrc || imgSrc.startsWith('data:')) {
        let el = link;
        for (let depth = 0; depth < 5; depth++) {
          el = el.parentElement;
          if (!el) break;
          const bgEls = el.querySelectorAll('[style*="background"]');
          for (const bgEl of bgEls) {
            const style = bgEl.getAttribute('style') || '';
            const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?([^'")\s]+)/i);
            if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
              imgSrc = bgMatch[1];
              break;
            }
          }
          if (imgSrc && !imgSrc.startsWith('data:')) break;
        }
      }

      if (!imgSrc || imgSrc.startsWith('data:') || imgSrc.length < 10 || skip.test(imgSrc)) continue;
      hrefImageMap[rawHref] = imgSrc;
      hrefImageMap[absHref] = imgSrc;
    }

    if (Object.keys(hrefImageMap).length > 0) {
      for (let i = 0; i < lots.length; i++) {
        if (lots[i].imageUrl) continue;
        const imgSrc = hrefImageMap[rawUrls[i]] || hrefImageMap[lots[i].url];
        if (imgSrc) {
          let imgUrl = imgSrc;
          if (!/^https?:\/\//i.test(imgUrl)) {
            try { imgUrl = new URL(imgUrl, baseUrl).href; } catch {}
          }
          lots[i].imageUrl = imgUrl;
        }
      }
      console.log(`JSDOM image extraction for ${house}: ${lots.filter(l => l.imageUrl).length}/${lots.length} lots got images`);
    }
  } catch (err) {
    log.warn('JSDOM image extraction error', { house, error: err.message });
  }

  // Resolve any remaining relative imageUrls
  for (const lot of lots) {
    if (lot.imageUrl && !/^https?:\/\//i.test(lot.imageUrl)) {
      try { lot.imageUrl = new URL(lot.imageUrl, baseUrl).href; } catch {}
    }
  }

  // Firecrawl images format fallback — match remaining imageless lots using Firecrawl's extracted image URLs
  if (firecrawlImages && firecrawlImages.length > 0) {
    const lotsMissingImg = lots.filter(l => !l.imageUrl).length;
    if (lotsMissingImg > 0) {
      // Filter to likely property images (not icons, logos, etc)
      const skipFc = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|favicon|banner|advert|maggsandallen\.co\.uk\/images\/|hollismorgan\.co\.uk\/images\/|fssproperty\.co\.uk\/images\//i;
      const propertyImages = firecrawlImages.filter(img => img && img.length > 20 && /^https?:\/\//i.test(img) && !skipFc.test(img));
      if (propertyImages.length > 0) {
        let fcMatched = 0;
        const usedImages = new Set();
        for (const lot of lots) {
          if (lot.imageUrl) continue;

          // Strategy 1: match by lot number anywhere in image URL (lot field or lotNumber)
          const lotNum = String(lot.lot || lot.lotNumber || '').replace(/\D/g, '');
          if (lotNum && lotNum.length >= 1) {
            const match = propertyImages.find(img => !usedImages.has(img) && (
              img.includes(`/${lotNum}/`) || img.includes(`/${lotNum}.`) || img.includes(`-${lotNum}.`)
              || img.includes(`lot-${lotNum}`) || img.includes(`lot${lotNum}`)
              || img.includes(`_${lotNum}.`) || img.includes(`_${lotNum}_`)
            ));
            if (match) { lot.imageUrl = match; usedImages.add(match); fcMatched++; continue; }
          }

          // Strategy 2: match by lot URL path overlap
          if (lot.url) {
            try {
              const lotPath = new URL(lot.url).pathname.replace(/\/$/, '').split('/').pop();
              if (lotPath && lotPath.length > 3) {
                const match = propertyImages.find(img => !usedImages.has(img) && img.toLowerCase().includes(lotPath.toLowerCase()));
                if (match) { lot.imageUrl = match; usedImages.add(match); fcMatched++; continue; }
              }
            } catch {}
          }

          // Strategy 3: match by address keyword (first meaningful word of street name)
          if (lot.address) {
            const words = lot.address.replace(/^(lot\s*\d+[,:]?\s*)/i, '').split(/[\s,]+/).filter(w => w.length > 3 && !/^\d+$/.test(w));
            const keyword = words[0];
            if (keyword && keyword.length > 3) {
              const kw = keyword.toLowerCase();
              const match = propertyImages.find(img => !usedImages.has(img) && img.toLowerCase().includes(kw));
              if (match) { lot.imageUrl = match; usedImages.add(match); fcMatched++; continue; }
            }
          }
        }

        // Strategy 4: position-based — nth property image = nth imageless lot (last resort)
        const stillMissing = lots.filter(l => !l.imageUrl);
        const unusedImages = propertyImages.filter(img => !usedImages.has(img));
        if (fcMatched < stillMissing.length && unusedImages.length >= stillMissing.length * 0.3) {
          let imgIdx = 0;
          for (const lot of stillMissing) {
            if (imgIdx >= unusedImages.length) break;
            lot.imageUrl = unusedImages[imgIdx++];
            fcMatched++;
          }
        }

        if (fcMatched > 0) console.log(`JSDOM Firecrawl images fallback for ${house}: matched ${fcMatched} lots`);
      }
    }
  }

  // Post-processing: filter junk images (same blocklist as extractWithDOM)
  const imgBlocklist = /logo|icon|placeholder|no-image|default|blank|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|noimage|favicon|banner|advert|sponsor|newsletter|widget|thumb_generic|modal\.png|_NYC\.|_LCC\.|_BMDC\.|Unit[ie]*d?_?Utilit|Cardwells|themes\/.*assets\/images\/|download_\(\d+\)\.|watchLIVEauction|property-top-image|auc2-logo|gavel|backdrop|generic[_-]?image|auction[_-]?house[_-]?(?:logo|image)|coming[_-]?soon|maggsandallen\.co\.uk\/images\/|hollismorgan\.co\.uk\/images\/|fssproperty\.co\.uk\/images\//i;
  const imgDomainBlock = /flannels|kirklees|rdw\b|council\.gov|\.gov\.uk\/|googleads|doubleclick|analytics|hotjar|intercom|crisp\.chat|tawk\.to|zendesk|hubspot|mailchimp|sendgrid/i;
  const hollisJunk = house === 'hollismorgan' || house === 'maggsandallen';
  for (const lot of lots) {
    if (!lot.imageUrl) continue;
    if (imgBlocklist.test(lot.imageUrl) || imgDomainBlock.test(lot.imageUrl)) {
      lot.imageUrl = '';
    } else if (hollisJunk && lot.imageUrl.includes('hollismorgan.co.uk') && !lot.imageUrl.includes('/resize/')) {
      lot.imageUrl = '';
    } else if (hollisJunk && lot.imageUrl.includes('maggsandallen.co.uk') && !lot.imageUrl.includes('/resize/')) {
      lot.imageUrl = '';
    }
  }

  // Second-chance image recovery — for lots still missing images after junk stripping,
  // walk the DOM to find their card container and extract background-image or <img>.
  // This catches sites that use CSS background-image slideshows (Cycle2, Flickity, etc.)
  // regardless of whether the per-house extractor handled them.
  const imgRecoverSkip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|favicon|banner|btn|gallery-left|gallery-right|maggsandallen\.co\.uk\/images\/|hollismorgan\.co\.uk\/images\/|fssproperty\.co\.uk\/images\//i;
  const lotsMissingImgCount = lots.filter(l => !l.imageUrl).length;
  if (lotsMissingImgCount > 0) {
    let recovered = 0;
    for (const lot of lots) {
      if (lot.imageUrl) continue;
      // Find the lot's anchor in the DOM by href
      const href = lot.url || '';
      if (!href) continue;
      const anchor = document.querySelector(`a[href="${href}"], a[href="${href.replace(baseUrl, '')}"]`);
      if (!anchor) continue;
      // Walk up to find the card container (up to 6 levels)
      let card = anchor;
      for (let d = 0; d < 6; d++) {
        card = card.parentElement;
        if (!card) break;
        // Stop at likely card boundaries
        const cls = card.className || '';
        if (/card|lot|listing|property|item/i.test(cls)) break;
      }
      if (!card) continue;
      // Strategy 1: background-image on any descendant (slideshow slides, cover images)
      const bgEl = card.querySelector('[style*="background-image"], .slide[style*="background"], [style*="background"][class*="slide"], [style*="background"][class*="cover"]');
      if (bgEl) {
        const style = bgEl.getAttribute('style') || '';
        const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?([^'")\s]+)/i);
        if (bgMatch && bgMatch[1] && !imgRecoverSkip.test(bgMatch[1]) && bgMatch[1].length > 10) {
          let imgUrl = bgMatch[1];
          if (!/^https?:\/\//i.test(imgUrl)) { try { imgUrl = new URL(imgUrl, baseUrl).href; } catch {} }
          lot.imageUrl = imgUrl;
          recovered++;
          continue;
        }
      }
      // Strategy 2: <img> tag (excluding SVG nav, icons, logos)
      const imgs = card.querySelectorAll('img[src]');
      for (const img of imgs) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && s.length > 10 && !imgRecoverSkip.test(s)) {
          let imgUrl = s;
          if (!/^https?:\/\//i.test(imgUrl)) { try { imgUrl = new URL(imgUrl, baseUrl).href; } catch {} }
          lot.imageUrl = imgUrl;
          recovered++;
          break;
        }
      }
    }
    if (recovered > 0) console.log(`JSDOM image recovery for ${house}: rescued ${recovered}/${lotsMissingImgCount} imageless lots`);
  }

  // Validate image URLs — must be https and look like an actual image
  for (const lot of lots) {
    if (lot.imageUrl && !isValidImageUrl(lot.imageUrl)) {
      lot.imageUrl = null;
    }
  }

  // Image dedup guard — if the same image appears on >50% of lots, it's likely a
  // banner/hero/catalogue image, not a per-lot photo. Strip it from all lots.
  if (lots.length >= 3) {
    const imgCounts = {};
    for (const lot of lots) {
      if (lot.imageUrl) imgCounts[lot.imageUrl] = (imgCounts[lot.imageUrl] || 0) + 1;
    }
    for (const [img, count] of Object.entries(imgCounts)) {
      if (count > lots.length * 0.5) {
        console.log(`[IMG] ${house}: stripped duplicate image appearing on ${count}/${lots.length} lots: ${img.substring(0, 80)}`);
        for (const lot of lots) {
          if (lot.imageUrl === img) lot.imageUrl = null;
        }
      }
    }
  }

  // ── Multi-image collection — gather all property images per lot for carousel ──
  // Walk each lot's card container in the DOM and collect all valid <img> sources.
  // This runs universally so every extractor gets multi-image support for free.
  // Lots that already have an `images` array (e.g. Savills) are skipped.
  const imgCarouselSkip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|favicon|banner|btn|gallery-left|gallery-right|advert|1x1|noimage|placeholder|gavel|backdrop|maggsandallen\.co\.uk\/images\/|hollismorgan\.co\.uk\/images\/|fssproperty\.co\.uk\/images\//i;
  let carouselLots = 0;
  for (const lot of lots) {
    if (lot.images && lot.images.length > 1) { carouselLots++; continue; } // already has multi-image
    const href = lot.url || '';
    if (!href) continue;
    const relHref = href.replace(baseUrl, '').replace(/^\//, '');
    const anchor = document.querySelector(`a[href="${href}"], a[href="/${relHref}"], a[href="${relHref}"]`);
    if (!anchor) continue;
    // Walk up to find the card container
    let card = anchor;
    for (let d = 0; d < 6; d++) {
      card = card.parentElement;
      if (!card) break;
      const cls = card.className || '';
      if (/card|lot|listing|property|item|panel/i.test(cls)) break;
    }
    if (!card) continue;
    // Collect all valid images from the card
    const cardImgs = card.querySelectorAll('img[src], img[data-src]');
    const validSrcs = [];
    const seenSrcs = new Set();
    for (const img of cardImgs) {
      let s = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (!s || s.length < 10 || s.startsWith('data:') || imgCarouselSkip.test(s)) continue;
      if (!/^https?:\/\//i.test(s)) { try { s = new URL(s, baseUrl).href; } catch { continue; } }
      if (seenSrcs.has(s)) continue;
      seenSrcs.add(s);
      if (imgBlocklist.test(s) || imgDomainBlock.test(s)) continue;
      validSrcs.push(s);
    }
    if (validSrcs.length > 1) {
      lot.images = validSrcs.slice(0, 8); // cap at 8 to keep payload reasonable
      // Ensure imageUrl is in the images array and is first
      if (lot.imageUrl && !lot.images.includes(lot.imageUrl)) {
        lot.images.unshift(lot.imageUrl);
        if (lot.images.length > 8) lot.images.pop();
      }
      carouselLots++;
    }
  }
  if (carouselLots > 0) console.log(`JSDOM multi-image: ${carouselLots}/${lots.length} lots got image carousels for ${house}`);

  // ═══════════════════════════════════════════════════════════════
  // UNIVERSAL LOT VALIDATION HARNESS — applies to ALL houses
  // Guards against page chrome leaking in as fake lots, junk
  // bullets, and other extraction artefacts.
  // ══════════════��════════════════════════════════════════════════

  const preHarnessCount = lots.length;

  // Guard 1: Address sanity — strip lots whose address looks like nav/chrome text
  const chromeAddressPattern = /^(Home|Contact|About|Search|Properties|Menu|Login|Register|Sign.?[Ii]n|Sign.?[Uu]p|Cookie|Privacy|Terms|FAQ|Help|Back|Next|Previous|View.?All|Show.?More|Load.?More|See.?All|Read.?More|Click.?Here|Subscribe|Newsletter|Disclaimer|Sitemap|Copyright|©)$/i;
  lots = lots.filter(lot => {
    if (chromeAddressPattern.test((lot.address || '').trim())) return false;
    return true;
  });

  // Guard 2: Duplicate address detection — if >3 lots share the exact same address,
  // something is wrong (likely the same element scraped repeatedly)
  const addrCounts = {};
  for (const lot of lots) {
    const norm = (lot.address || '').toLowerCase().trim();
    if (norm) addrCounts[norm] = (addrCounts[norm] || 0) + 1;
  }
  for (const [addr, count] of Object.entries(addrCounts)) {
    if (count > 3) {
      console.log(`[HARNESS] ${house}: stripped ${count} lots with duplicate address: "${addr.substring(0, 60)}"`);
      let kept = 0;
      lots = lots.filter(lot => {
        if ((lot.address || '').toLowerCase().trim() === addr) {
          kept++;
          return kept <= 1; // keep only the first one
        }
        return true;
      });
    }
  }

  // Guard 3: Bullet sanitisation — strip bullets that look like page chrome across all houses
  const junkBulletPattern = /^(Home|Contact|About|Search|Menu|Login|Register|Cookie|Privacy|Terms|FAQ|Help|©|Tel:|Email:|Fax:|Follow.?Us|Share|Print|Save|View|Click|Subscribe|Newsletter|All.?Rights|Powered.?By|Sitemap|Disclaimer)/i;
  for (const lot of lots) {
    if (lot.bullets && Array.isArray(lot.bullets)) {
      lot.bullets = lot.bullets.filter(b => !junkBulletPattern.test((b || '').trim()));
    }
  }

  const stripped = preHarnessCount - lots.length;
  if (stripped > 0) {
    console.log(`[HARNESS] ${house}: removed ${stripped} invalid lots (${preHarnessCount} → ${lots.length})`);
  }

  // Final image coverage logging
  const lotsWithImages = lots.filter(l => l.imageUrl).length;
  console.log(`[IMG] ${house}: ${lotsWithImages}/${lots.length} lots have images after extraction + Firecrawl merge`);

  dom.window.close();
  return lots;
}

// Track which scraping engine and extractor were last used (for cache metadata)
let _lastScrapeEngine = 'http';
let _lastExtractorUsed = 'dom-house';
let _lastAITier = null; // 'fast' or 'capable' — set by extractLotsWithAI()

async function scrapeRenderedPage(url, house, options = {}) {
  // Tier 1: Firecrawl (if available and not skipped/exhausted)
  if (FIRECRAWL_API_KEY && !fcCreditExhausted && !FIRECRAWL_SKIP.has(house)) {
    if (!(fcTemporarilyDown && Date.now() - fcDownAt < 600000)) {
      try {
        const fcActions = [
          // Scroll down in stages to trigger intersection observers for lazy-loaded content
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1500 },
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1500 },
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1500 },
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1000 },
          // Force lazy-loaded images: swap data-src/data-lazy-src → src
          { type: 'executeJavascript', script: `document.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]').forEach(img => { const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original'); if (src && !img.getAttribute('src')?.startsWith('http')) img.setAttribute('src', src); });` },
          { type: 'wait', milliseconds: 500 },
          // Scroll back to top to capture any fixed-position images
          { type: 'scroll', direction: 'up' },
          { type: 'scroll', direction: 'up' },
          { type: 'scroll', direction: 'up' },
          { type: 'scroll', direction: 'up' },
        ];
        const result = await scrapeWithFirecrawl(url, {
          waitFor: options.waitFor || 3000,
          actions: options.actions || fcActions,
          formats: ['markdown', 'rawHtml', 'images'],
        });
        if (result.html && result.html.length > 500) {
          console.log(`Firecrawl: got ${result.html.length} chars for ${house}`);
          _lastScrapeEngine = 'firecrawl';
          return result;
        }
        console.log(`Firecrawl: empty/short response for ${house}, falling back`);
      } catch (err) {
        console.log(`Firecrawl failed for ${house}: ${err.message}, falling back`);
        fcFallbackCount++;
      }
    }
  }

  // Tier 2: Puppeteer (if available)
  if (puppeteer) {
    try {
      const page = await acquirePage();
      try {
        await page.setUserAgent(HEADERS['User-Agent']);
        await page.setViewport({ width: 1280, height: 900 });
        await page.setRequestInterception(true);
        page.on('request', req => {
          const type = req.resourceType();
          if (['image', 'font', 'media'].includes(type)) req.abort();
          else req.continue();
        });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, options.waitFor || 3000));
        await page.evaluate(async () => {
          for (let i = 0; i < 15; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 500)); }
          window.scrollTo(0, 0);
        });
        await new Promise(r => setTimeout(r, 2000));
        const html = await page.content();
        const sourceURL = page.url();
        _lastScrapeEngine = 'puppeteer';
        return { html, sourceURL };
      } finally {
        await page.close();
      }
    } catch (err) {
      console.log(`Puppeteer fallback failed for ${house}: ${err.message}`);
    }
  }

  // Tier 3: Plain HTTP (last resort)
  try {
    const html = await fetchPage(url);
    _lastScrapeEngine = 'http';
    return { html, sourceURL: url };
  } catch (err) {
    throw new Error(`All scraping methods failed for ${url}: ${err.message}`);
  }
}

async function scrapePageWithFirecrawl(url, house) {
  const result = await scrapeRenderedPage(url, house);
  if (!result.html) return [];
  const pages = [{ page: 1, html: result.html, markdown: result.markdown }];

  // Detect total pages from first page HTML
  const totalPages = detectTotalPages(result.html, url, house);
  if (totalPages > 1) {
    const pageCap = Math.min(totalPages, MAX_PUPPETEER_PAGES);
    console.log(`[PAGINATION] ${house}: ${totalPages} pages detected, loading up to ${pageCap}`);
    for (let p = 2; p <= pageCap; p++) {
      if (fcCreditExhausted) { console.log(`Firecrawl: credits exhausted at page ${p}, stopping`); break; }
      const pageUrl = buildPageUrl(url, p, house);
      try {
        const pageResult = await scrapeRenderedPage(pageUrl, house);
        if (pageResult.html && pageResult.html.length > 500) {
          pages.push({ page: p, html: pageResult.html, markdown: pageResult.markdown });
        } else {
          console.log(`Firecrawl: page ${p} empty for ${house}, stopping`);
          break;
        }
      } catch (err) {
        console.log(`Firecrawl: page ${p} failed for ${house}: ${err.message}`);
        break;
      }
    }
  }
  return pages;
}

async function backfillImagesWithFirecrawl(catalogueUrl, lots, house) {
  try {
    const result = await scrapeRenderedPage(catalogueUrl, house, {
      actions: [
        // Aggressive scrolling to trigger all lazy-load observers
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1000 },
        // Force lazy-loaded images: swap data-src → src
        { type: 'executeJavascript', script: `document.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]').forEach(img => { const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original'); if (src && !img.getAttribute('src')?.startsWith('http')) img.setAttribute('src', src); });` },
        { type: 'wait', milliseconds: 1000 },
        { type: 'scroll', direction: 'up' },
        { type: 'scroll', direction: 'up' },
        { type: 'scroll', direction: 'up' },
        { type: 'scroll', direction: 'up' },
      ],
    });
    if (!result.html) return 0;

    const dom = new JSDOM(result.html, { url: catalogueUrl });
    const { document } = dom.window;

    // Build href→image map from the rendered page
    const skip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|loading|cookie|emoji|maggsandallen\.co\.uk\/images\/|hollismorgan\.co\.uk\/images\/|fssproperty\.co\.uk\/images\//i;
    const hrefImageMap = {};
    const links = document.querySelectorAll('a[href]');
    for (const link of links) {
      const rawHref = link.getAttribute('href') || '';
      let absHref;
      try { absHref = new URL(rawHref, catalogueUrl).href; } catch { absHref = rawHref; }
      if (!rawHref || rawHref === '#') continue;
      if (hrefImageMap[rawHref] || hrefImageMap[absHref]) continue;

      let imgSrc = '';
      let img = link.querySelector('img');
      if (!img) {
        let el = link;
        for (let depth = 0; depth < 5; depth++) {
          el = el.parentElement;
          if (!el) break;
          img = el.querySelector('img');
          if (img) break;
        }
      }
      if (img) {
        imgSrc = img.getAttribute('src') || img.getAttribute('data-src')
          || img.getAttribute('data-lazy-src') || img.getAttribute('data-original')
          || (img.getAttribute('srcset') ? img.getAttribute('srcset').split(',')[0].trim().split(/\s+/)[0] : '');
      }
      if (!imgSrc || imgSrc.startsWith('data:') || imgSrc.length < 10 || skip.test(imgSrc)) continue;
      hrefImageMap[rawHref] = imgSrc;
      hrefImageMap[absHref] = imgSrc;
    }

    // Match images to lots via href→image map
    let updated = 0;
    for (const lot of lots) {
      if (lot.imageUrl) continue;
      const imgSrc = hrefImageMap[lot.url];
      if (imgSrc) {
        let imgUrl = imgSrc;
        if (!/^https?:\/\//i.test(imgUrl)) {
          try { imgUrl = new URL(imgUrl, catalogueUrl).href; } catch {}
        }
        lot.imageUrl = imgUrl;
        updated++;
      }
    }

    // Fallback: use Firecrawl's images array + JSDOM-extracted images for remaining imageless lots
    const allPageImages = [];
    // Collect images from JSDOM parsing
    const allImgs = document.querySelectorAll('img[src], img[data-src]');
    const skipFc = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|favicon|banner|advert|maggsandallen\.co\.uk\/images\/|hollismorgan\.co\.uk\/images\/|fssproperty\.co\.uk\/images\//i;
    for (const img of allImgs) {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (src && src.length > 20 && !src.startsWith('data:') && !skipFc.test(src)) {
        let abs = src;
        if (!/^https?:\/\//i.test(abs)) { try { abs = new URL(abs, catalogueUrl).href; } catch { continue; } }
        allPageImages.push(abs);
      }
    }
    // Also add Firecrawl's images array
    if (result.images && result.images.length > 0) {
      for (const img of result.images) {
        if (img && img.length > 20 && /^https?:\/\//i.test(img) && !skipFc.test(img)) allPageImages.push(img);
      }
    }
    // Deduplicate
    const uniquePageImages = [...new Set(allPageImages)];
    if (uniquePageImages.length > 0) {
      const usedImgs = new Set(lots.filter(l => l.imageUrl).map(l => l.imageUrl));
      const available = uniquePageImages.filter(i => !usedImgs.has(i));
      // Try lot number matching first
      for (const lot of lots) {
        if (lot.imageUrl) continue;
        const lotNum = String(lot.lot || lot.lotNumber || '').replace(/\D/g, '');
        if (lotNum) {
          const match = available.find(img => !usedImgs.has(img) && (
            img.includes(`/${lotNum}/`) || img.includes(`/${lotNum}.`) || img.includes(`-${lotNum}.`)
            || img.includes(`_${lotNum}.`) || img.includes(`lot${lotNum}`)
          ));
          if (match) { lot.imageUrl = match; usedImgs.add(match); updated++; }
        }
      }
      // Position-based matching for remaining
      const stillMissing = lots.filter(l => !l.imageUrl);
      const unusedImgs = available.filter(i => !usedImgs.has(i));
      if (stillMissing.length > 0 && unusedImgs.length >= stillMissing.length * 0.3) {
        let idx = 0;
        for (const lot of stillMissing) {
          if (idx >= unusedImgs.length) break;
          lot.imageUrl = unusedImgs[idx++];
          updated++;
        }
      }
    }
    // Image dedup guard — same as extractWithJSDOM harness
    if (lots.length >= 3) {
      const imgCounts = {};
      for (const lot of lots) {
        if (lot.imageUrl) imgCounts[lot.imageUrl] = (imgCounts[lot.imageUrl] || 0) + 1;
      }
      for (const [img, count] of Object.entries(imgCounts)) {
        if (count > lots.length * 0.5) {
          console.log(`[IMG-BACKFILL] ${house}: stripped duplicate image on ${count}/${lots.length} lots: ${img.substring(0, 80)}`);
          for (const lot of lots) {
            if (lot.imageUrl === img) { lot.imageUrl = null; updated--; }
          }
        }
      }
      if (updated < 0) updated = 0;
    }
    dom.window.close();
    console.log(`Firecrawl image backfill for ${house}: ${updated}/${lots.length} lots got images`);
    return updated;
  } catch (err) {
    log.warn('Firecrawl image backfill error', { house, catalogueUrl, error: err.message });
    return 0;
  }
}

// callGemini() removed — all AI calls now route through callAI() from lib/ai-provider.js

// One-line structural hints for known houses — injected into Haiku prompts
// to compensate for smaller model capacity. Each describes the HTML/JSON shape.
const HOUSE_EXTRACTION_HINTS = {
  // Static HTML / SKIP_PUPPETEER houses (always reach Claude)
  allsop:        'Allsop API returns JSON with properties array. Each has address, guide_price, lot_number, slug, features, auction_type fields.',
  knightfrank:   'EIG auction platform. Lots in cards/rows with lot number, address, guide price, and detail links under knightfrankauctions.com.',
  paulfosh:      'EIG online auction platform (paulfosh.eigonlineauctions.com). Lot panels with lot number, address, guide price, images, and detail links.',
  cottons:       'EIG embed auction platform. Lot containers with lot number, address, guide/sold price, images, and lot detail links with lid= parameter.',
  dedmangray:    'EIG embed platform (tenant 33). Table-based layout with table.lotdetails, td.lotnum, td.lottag (address), td.lotimagecol img, and Guide Price text.',
  barnettross:   'PHP table layout. table.auction-archive-table with tr rows: td (lot number), td.address, td (location), td.guide (price). Row onclick has /property.php?id= URL.',
  philliparnold: 'Auction catalogue cards with lot number, address, guide price, property type, and detail URLs under philliparnoldauctions.co.uk.',
  bidx1:         'Online auction platform. Lot cards with lot number, address, guide price, property type, closing date, and detail links under bidx1.com.',
  edwardmellor:  'Auction lots listed with lot number, full address, guide price, tenure, bedrooms, and detail page links.',
  bradleyhall:   'Property cards on auction.bradleyhall.co.uk with lot number, address, guide price, and search result links.',
  connectuk:     'https://connectukgroup.co.uk/auctions/',
  auctionestates:'Lot cards with lot number, address, guide price, property type, tenure, and detail page URLs.',
  landwood:      'EIG OAS platform (tenant 188) in LIST view. Lot panels (.lot-panel) with h3.list-address, .list-guideprice strong, img.list-image, and /lot/details/ links.',
  loveitts:      'Auction catalogue with lot number, address, guide price, property description, tenure, and links.',
  hunters:       'Bamboo Auctions platform (hunters.bambooauctions.com). React SPA with property cards showing title, address, guide price, bedrooms, property type, and detail links.',
  // preferPuppeteer houses (Claude fallback when DOM extraction fails)
  network:            'Network Auctions. EIG platform. Lot divs with class current-lots-single, lot-number span, guide-price paragraph, and detail links.',
  pattinson:          'Pattinson React SPA. Property cards with lot number, address, starting/current bid price, and auction detail links.',
  savills:            'Savills auctions. Lot cards with lot number, address, guide price, tenure, property type, and detail links on auctions.savills.co.uk.',
  sdl:                'BTG Eddisons Property Auctions (formerly SDL). Tailwind property-card divs with lot number, address, guide price, auction type/date, and links to /properties/ detail pages.',
  bondwolfe:          'Bond Wolfe auctions. Lot listings with lot number, address, guide price, property type, tenure, and detail page links.',
  barnardmarcus:      'Barnard Marcus auctions. Property cards with lot number, address, guide price, property type, and detail links.',
  auctionhouselondon: 'Auction House London. Lot listings with lot number, address, guide price, property type, tenure, and detail links.',
  cliveemson:         'Clive Emson land and property auctions. Lots with lot number, address, guide price, property type, acreage, tenure, and links.',
  strettons:          'Strettons auctions. Commercial/residential lot cards with lot number, address, guide price, property type, and detail links.',
  acuitus:            'Acuitus commercial auctions. Lot listings with lot number, address, guide price, yield, tenant info, and detail links.',
  hollismorgan:       'Hollis Morgan auctions. Lot cards with lot number, address, guide price, property type, tenure, and detail links.',
  maggsandallen:      'Maggs & Allen auctions. Lot listings with lot number, address, guide price, property type, and detail page URLs.',
  mchughandco:        'EIG OAS platform. Lot panels (.lot-panel) with h4.grid-address, .grid-guideprice b, img.grid-img, and /lot/details/ links. Large catalogue (200+ lots).',
  auctionhouse:       'Auction House UK. Lot listings with lot number, address, guide price, property type, auction date, and detail links.',
  probateauction:     'Probate Auction. WordPress site. Lots in div.property-list-card containers within a div.property-list-grid. Each card has a Swiper image gallery, lot number, address, guide price (e.g. £280,000+), description paragraph, and a "Property Details" link.',
  countrywide:        'Countrywide/Sutton Kersh. Bootstrap cards div.property-gallery with h2.property-gallery__title (guide price), h3.property-gallery__address (full address), and image in div.property-gallery__image.',
  venmore:            'Venmore Auctions Liverpool. Cards in div.property-strip-block with lot number, address in span.f-body-copy, guide price in span.p-text-green, and detail links to Property-Details?property_reference=X.',
  tcpa:               'Town & Country Property Auctions. EIG platform. Cards in div.lot-panel with span.lot-address, span.price, time.text-success for auction end, and EIG CDN images.',
  futureauctions:     'Future Property Auctions. ASP site. Cards are a[href*="property_details.asp"] with lot numbers, addresses with postcodes, opening bid prices, and images from /upload/ directory.',
  kivells:            'Kivells Devon/Cornwall. Tailwind site. Cards in div.bg-listing-item-background with h2 address, h3 price, and images from /media/Properties/.',
  firstforauctions:   'First For Auctions. EIG platform. Cards in div.lot-panel with h4.grid-address, guide price in div.grid-guideprice b, and EIG CDN images.',
  harmanhealy:        'Harman Healy. EIG platform. Cards with [data-lot-item-toggle] or lot-panel divs, [data-address-searchable] for address, guide price in text.',
  seelauctions:       'Seel & Co Cardiff. EIG platform. Cards are a[href*="/lot/details/"] with h4 address, Guide Price text, and EIG CDN images.',
  robinsonhall:       'Robinson & Hall. WordPress/Elementor + EIG. Cards in article.ae-post-item with a.ae-element-custom-field (address), .guide-price (price), and EIG CDN images.',
  astleys:            'Astleys Swansea. EIG platform (astleys.eigonlineauctions.com). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  henrysykes:         'Henry Sykes Auctions. EIG platform (onlineauctions.henrysykes.co.uk). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  clarkesimpson:      'Clarke & Simpson. EIG platform (clarke-simpson.eigonlineauctions.com). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  durrants:           'Durrants Norfolk/Suffolk. EIG platform (auctions.durrants.com). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  dawsons:            'Dawsons South Wales. EIG platform (dawsonsproperty.co.uk). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  goldings:           'Goldings Ipswich. EIG platform (goldingsauctions.co.uk). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  auctionhousescotland: 'Auction House Scotland. Auction House UK network (auctionhouse.co.uk/scotland). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  austingray:         'Austin Gray / Auction House Sussex & Hampshire. Auction House UK network (auctionhouse.co.uk/sussexandhampshire). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  // ── Batch 4 (March 2026) ──
  auctionhousedevon:       'Auction House Devon & Cornwall. Auction House UK network (auctionhouse.co.uk/devonandcornwall). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  auctionhouseeastmidlands:'Auction House East Midlands. Auction House UK network (auctionhouse.co.uk/eastmidlands). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  auctionhousewestmidlands:'Auction House West Midlands. Auction House UK network (auctionhouse.co.uk/westmidlands). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  auctionhouseessex:       'Auction House Essex. Auction House UK network (auctionhouse.co.uk/essex). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  auctionhousemanchester:  'Auction House Manchester. Auction House UK network (auctionhouse.co.uk/manchester). Cards in div.lot-search-result with p.grid-address, guide price in div.grid-view-guide, img.lot-image.',
  romanway:                'Roman Way Auctions. EIG platform (romanway.eigonlineauctions.com). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  hammerprice:             'Hammer Price Auctions. EIG platform (hammerprice.eigonlineauctions.com). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, and EIG CDN images.',
  // ── Regional/independent houses (batch 6, March 2026) ──
  underthehammer:          'Under The Hammer. Next.js React SPA (underthehammer.com). Property cards at /for-auction/properties with title, address, guide price, bedrooms, property type, images on blob.core.windows.net, and detail links to /for-auction/slug.',
  lsk:                     'Lacy Scott & Knight Suffolk. Bamboo Auctions platform (lacyscottandknight.bambooauctions.com). React SPA with property cards showing title, address, guide price, bedrooms, property type, and detail links. Same structure as Hunters.',
  // ── GOTO Properties platform (EIG-based) ──
  purplebricksgoto:        'Purplebricks via GOTO Properties. EIG platform (purplebricks.gotoproperties.co.uk). Standard EIG lot-panel cards with h3.list-address, guide price in list-guideprice, img.list-image, and /lot/details/ links. Paginated search with pagesize=48.',
  // ── Verified EIG subdomains (April 2026) ──
  groundrentauctions:      'Ground Rent Auctions. EIG platform (groundrentauctions.eigonlineauctions.com). Specialist ground rent lots. Standard EIG lot-panel cards.',
  benjaminstevens:         'Benjamin Stevens Auctions. EIG platform (online.benjaminstevensauctions.co.uk). Standard EIG lot-panel cards.',
  // ── New houses from own websites (April 2026) ──
  auctionhammermidlands:   'Auction Hammer Midlands. WordPress/Elementor site. Lot cards with LOT number heading (h4), address, guide price (£X plus fees), bedrooms/bathrooms/receptions counts, and property images.',
  sharpesauctions:         'Sharpes Auctions Bradford. PHP site. Lot cards with class products_table_items_lotnumber for lot number, guide price (£X plus fees), property images in products_table_thumb, and address links.',
  jjmorris:                'JJ Morris Pembrokeshire. Property Jungle platform. Card-based layout with address, guide price, bedrooms/bathrooms, property images with lazy loading, and More Details links.',
  rendells:                'Rendells Devon. Bamboo Auctions platform (rendells.bambooauctions.com). Next.js SPA with __NEXT_DATA__ JSON. Property cards with title, address, guide price, image, auction type. Same structure as Hunters.',
  pearsonferrier:          'Pearson Ferrier Manchester. WordPress + PropertyHive plugin. Lot cards in .propertyhive wrapper with .property class, .property__address, .property__price, .property__rooms, .flag-lot (lot number badge).',
};

// getExtractionModel() removed — tier selection now in callAI() callsites

// ═══════════════════════════════════════════════════════════════
// HOUSE ROOTS — catalogue discovery URLs
// ═══════════════════════════════════════════════════════════════
// Each house's root/listing page where upcoming auction catalogue links can be found.
// Used by /api/discover-catalogues to auto-detect new auction URLs when they change.
const HOUSE_ROOTS = {
  savills:            'https://auctions.savills.co.uk/upcoming-auctions', // Auto-discovers actual catalogue via rewriteUrl
  allsop:             'https://www.allsop.co.uk/auctions/residential-auctions/',
  sdl:                'https://www.btgeddisonspropertyauctions.com/properties/',
  network:            'https://www.networkauctions.co.uk/auctions/next-auction/',
  bondwolfe:          'https://www.bondwolfe.com/auctions/properties/',
  barnardmarcus:      'https://www.barnardmarcusauctions.co.uk/',
  auctionhouselondon: 'https://auctionhouselondon.co.uk/current-auction',
  auctionhouse:       'https://www.auctionhouse.co.uk/online',
  cliveemson:         'https://www.cliveemson.co.uk/properties/',
  strettons:          'https://www.strettons.co.uk/auctions/',
  acuitus:            'https://www.acuitus.co.uk/find-a-property/',
  hollismorgan:       'https://www.hollismorgan.co.uk/search-auction/',
  maggsandallen:      'https://www.maggsandallen.co.uk/search-auction/',
  mchughandco:        'https://www.mchughandco.com/pages/auctions',
  knightfrank:        'https://www.knightfrankauctions.com/forthcoming-auctions/',
  pattinson:          'https://www.pattinson.co.uk/auction',
  bidx1:              'https://bidx1.com/en/united-kingdom',
  philliparnold:      'https://www.philliparnoldauctions.co.uk/current-lots',
  edwardmellor:       'https://www.edwardmellor.co.uk/auction/',
  paulfosh:           'https://paulfosh.eigonlineauctions.com/search',
  cottons:            'https://www.cottons.co.uk/auction-archive/',
  dedmangray:         'https://www.dedmangray.co.uk/auction/',
  barnettross:        'https://www.barnettross.co.uk/current.php',
  bradleyhall:        'https://auction.bradleyhall.co.uk/',
  connectuk:          'https://connectukgroup.co.uk/auctions/',
  auctionestates:     'https://www.auctionestates.co.uk/view-properties',
  landwood:           'https://www.landwoodpropertyauctions.com/future-auctions?showall=true',
  loveitts:           'https://www.eigpropertyauctions.co.uk/live-stream/auction/loveitts',
  hunters:            'https://hunters.bambooauctions.com',
  probateauction:     'https://probate.auction/auctions/',
  // ── New houses ──
  countrywide:        'https://www.countrywidepropertyauctions.co.uk/search.php?auction_date=current',
  venmore:            'https://www.venmoreauctions.co.uk/Property-Search',
  tcpa:               'https://www.townandcountrypropertyauctions.co.uk/search',
  futureauctions:     'https://www.futurepropertyauctions.co.uk/catalogue_viewall.asp',
  kivells:            'https://www.kivells.com/residential-property/properties-for-auction',
  firstforauctions:   'https://online.firstforauctions.co.uk/search?view=Grid',
  harmanhealy:        'https://www.harman-healy.co.uk/search',
  seelauctions:       'https://online.seelauctions.co.uk/search?view=Grid&showall=true',
  robinsonhall:       'https://robinsonandhallauctions.co.uk/auctions/available-lots/',
  // ── EIG batch (March 2026) ──
  astleys:            'https://astleys.eigonlineauctions.com/search',
  henrysykes:         'https://onlineauctions.henrysykes.co.uk/search',
  clarkesimpson:      'https://clarke-simpson.eigonlineauctions.com/search',
  durrants:           'https://durrants.com/property-auctions/next-property-auction',
  dawsons:            'https://www.dawsonsproperty.co.uk/auctions.php',
  goldings:           'https://www.goldingsauctions.co.uk/auctions/next-auction/',
  auctionhousescotland: 'https://www.auctionhouse.co.uk/scotland/auction/search-results',
  austingray:         'https://www.auctionhouse.co.uk/sussexandhampshire',
  // ── New houses (March 2026 batch 2) ──
  agentsproperty:     'https://www.agentspropertyauction.com/next-auction/',
  andrewcraig:        'https://www.andrewcraig.co.uk/auction-property-for-sale',
  buttersjohnbee:     'https://www.buttersjohnbee.com/listings?auction=1&status=all',
  brownco:            'https://brownandco.eigonlineauctions.com/search',
  cheffins:           'https://www.cheffins.co.uk/property-auctions/catalogue-view,march-2026_576.htm',
  cheffinstimed:      'https://timedpropertyauctions.cheffins.co.uk/search',
  fssproperty:        'https://www.fssproperty.co.uk/search-auction/',
  iamsold:            'https://www.iamsold.co.uk/available-properties/',
  suttonkersh:        'https://www.suttonkersh.co.uk/properties/gallery/?section=auction&auctionPeriod=current',
  // ── Auction House UK regional branches (March 2026 batch 3) ──
  auctionhouseeastanglia: 'https://www.auctionhouse.co.uk/eastanglia/auction/search-results',
  auctionhousenorthwest:  'https://www.auctionhouse.co.uk/northwest/auction/search-results',
  auctionhousenortheast:  'https://www.auctionhouse.co.uk/northeast/auction/search-results',
  auctionhousewales:      'https://www.auctionhouse.co.uk/southwales/auction/search-results',
  auctionhousebirmingham: 'https://www.auctionhouse.co.uk/birmingham/auction/search-results',
  auctionhousekent:       'https://www.auctionhouse.co.uk/kent/auction/search-results',
  // ── Auction House UK regional branches (batch 4, March 2026) ──
  auctionhousedevon:      'https://www.auctionhouse.co.uk/devonandcornwall/auction/search-results',
  auctionhouseeastmidlands: 'https://www.auctionhouse.co.uk/eastmidlands/auction/search-results',
  auctionhousewestmidlands: 'https://www.auctionhouse.co.uk/westmidlands/auction/search-results',
  auctionhouseessex:      'https://www.auctionhouse.co.uk/essex/auction/search-results',
  auctionhousemanchester: 'https://www.auctionhouse.co.uk/manchester/auction/search-results',
  // ── EIG platform houses (batch 4, March 2026) ──
  romanway:               'https://romanway.eigonlineauctions.com/search',
  hammerprice:            'https://hammerprice.eigonlineauctions.com/search',
  // ── Auction House UK regional branches (batch 5, March 2026) ──
  auctionhousesouthyorkshire:  'https://www.auctionhouse.co.uk/southyorkshire/auction/search-results',
  auctionhousewestyorkshire:   'https://www.auctionhouse.co.uk/westyorkshire/auction/search-results',
  auctionhouseteesvalley:      'https://www.auctionhouse.co.uk/teesvalley/auction/search-results',
  auctionhousehull:            'https://www.auctionhouse.co.uk/hullandeastyorkshire/auction/search-results',
  auctionhousecumbria:         'https://www.auctionhouse.co.uk/cumbria/auction/search-results',
  auctionhouselincolnshire:    'https://www.auctionhouse.co.uk/lincolnshire/auction/search-results',
  auctionhouseuklondon:        'https://www.auctionhouse.co.uk/london/auction/search-results',
  auctionhousebedsandbucks:    'https://www.auctionhouse.co.uk/bedsandbucks/auction/search-results',
  auctionhousenorthamptonshire:'https://www.auctionhouse.co.uk/northamptonshire/auction/search-results',
  auctionhouseoxfordshire:     'https://www.auctionhouse.co.uk/oxfordshire/auction/search-results',
  auctionhouseleicestershire:  'https://www.auctionhouse.co.uk/leicestershire/auction/search-results',
  auctionhousemidlands:        'https://www.auctionhouse.co.uk/midlands/auction/search-results',
  auctionhousecoventry:        'https://www.auctionhouse.co.uk/coventryandwarwickshire/auction/search-results',
  auctionhousenottsandderby:   'https://www.auctionhouse.co.uk/nottsandderby/auction/search-results',
  auctionhousechesterfield:    'https://www.auctionhouse.co.uk/chesterfieldandnorthderbyshire/auction/search-results',
  auctionhousestaffordshire:   'https://www.auctionhouse.co.uk/staffordshire/auction/search-results',
  auctionhousenorthwales:      'https://www.auctionhouse.co.uk/northwales/auction/search-results',
  auctionhousesouthwest:       'https://www.auctionhouse.co.uk/southwest/auction/search-results',
  auctionhousenorthernireland: 'https://www.auctionhouse.co.uk/northernireland/auction/search-results',
  auctionhousenational:        'https://www.auctionhouse.co.uk/national/auction/search-results',
  // ── EIG platform houses (batch 5, March 2026) ──
  sarahmains:             'https://www.auctionworks.co.uk/search',
  sageandco:              'https://sageandco.eigonlineauctions.com/search',
  auctiontrade:           'https://auctiontrade.eigonlineauctions.com/search',
  brggibson:              'https://brggibsonbelfastauctions.eigonlineauctions.com/search',
  higginsdrysdale:        'https://higginsdrysdale.eigonlineauctions.com/search',
  martinpole:             'https://martinpole.eigonlineauctions.com/search',
  jonespeckover:          'https://jonespeckover.eigonlineauctions.com/search',
  thepropertyauctionhouse:'https://thepropertyauctionhouse.eigonlineauctions.com/search',
  propertyauctionagent:   'https://propertyauctionagent.eigonlineauctions.com/search',
  lot9:                   'https://lot9.eigonlineauctions.com/search',
  auctionnorth:           'https://auction-north.eigonlineauctions.com/search',
  bowensonandwatson:      'https://bowensonandwatson.eigonlineauctions.com/search',
  sheldonbosley:          'https://online.sbkauctions.co.uk/search',
  nationalpropertyauctions:'https://nationalpropertyauctions.eigonlineauctions.com/search',
  // ── Regional/independent houses (batch 6, March 2026) ──
  underthehammer:         'https://www.underthehammer.com/for-auction/properties',
  lsk:                    'https://lacyscottandknight.bambooauctions.com/',
  // ── Tier 2: High-value targets (March 2026) ──
  foxandsons:             'https://www.foxandsonsauctions.co.uk/',
  bagshaws:               'https://www.bagshawsauctions.co.uk/',
  wilsons:                'https://www.wilsonsauctions.com/auctions/land-property-auctions',
  strakers:               'https://www.strakers.co.uk/property-auctions/',
  johnpye:                'https://www.johnpyeproperty.co.uk/Listing',
  // ── Batch 7: Tier 1 expansion (March 2026) ──
  symondsandsampson:      'https://auctions.symondsandsampson.co.uk/events/property-auction/symonds-and-sampson-property-auctions?eventdate=upcoming',
  stags:                  'https://www.stags.co.uk/pages/auction-properties',
  lsh:                    'https://propertyauctions.lsh.co.uk/',
  carterjonas:            'https://www.carterjonas.co.uk/property-auctions',
  gth:                    'https://www.gth.net/properties/sales/tag-auction',
  halls:                  'https://www.hallsgb.com/residential/property-and-land-auctions/',
  walkersingleton:        'https://onlinesales.walkersingleton.co.uk/',
  driversnorris:          'https://www.iamsold.co.uk/estate-agent/drivers/',
  shonkibros:             'https://www.shonkibros.com/auctions/latest-auctions/view',
  robinjessop:            'https://www.robinjessop.co.uk/auctions',
  // ── Batch 7: Tier 2 expansion ──
  cleetompkinson:         'https://www.ctf-uk.com/properties/sales/tag-auction',
  mccartneys:             'https://www.mccartneys.co.uk/property-search/?department=property-land-auctions',
  bramleys:               'https://www.bramleys.com/search/?instruction_type=Sale&department=Auction',
  cooperandtanner:        'https://www.eigpropertyauctions.co.uk/live-stream/auction/cooper-tanner-auctions',
  brutonknowles:          'https://www.brutonknowles.co.uk/property-search/?department=auction',
  fisherGerman:           'https://www.fishergerman.co.uk/auctions',
  woolleyandwallis:       'https://www.woolleyandwallis.co.uk/property/auction/',
  hobbsparker:            'https://www.hobbsparker.co.uk/auctioneers/',
  // arnoldskeys — CONFIRMED: machinery auctions only, not property (re-verified 2026-04-05)
  // twgaze — REMOVED: antiques/chattels auctioneer, not property
  hairandson:             'https://www.hairandson.co.uk/auction',
  phillipssmithanddunn:   'https://www.phillipsland.com/auction',
  webbers:                'https://www.webbers.co.uk/auction',
  // ── Batch 7: EIG platform additions ──
  ahlondon:               'https://ahlondon.eigonlineauctions.com/search',
  starpropertyonline:     'https://star-property-online.eigonlineauctions.com/search',
  brggibsondublin:        'https://brggibsondublinauctions.eigonlineauctions.com/search',
  // ── Batch 8: Comprehensive UK coverage (March 2026) ──
  // National / Online
  propertysolvers:        'https://auctions.propertysolvers.co.uk/auction-property-for-sale/',
  pugh:                   'https://www.pugh-auctions.com/property-search?include-sold=off',
  markjenkinson:          'https://www.btgeddisonspropertyauctions.com/properties/',
  regionalauctioneers:    'https://www.regionalpropertyauctioneers.co.uk/properties',
  // South East
  clarkegammon:           'https://www.clarkegammon.co.uk/auction/',
  nesbits:                'https://www.nesbits.co.uk/auctions/',
  pearsons:               'https://www.pearsons.com/properties/auctions',
  foxgrant:               'https://www.foxgrant.com/auctions/',
  // lextons — REMOVED: domain parked, redirects to /lander
  // South West
  bradleysdevon:          'https://www.bradleys-estate-agents.co.uk/properties/sales/tag-auction',
  taylerandfletcher:      'https://www.taylerandfletcher.co.uk/property-auctions/',
  luscombemaye:           'https://www.luscombemaye.com/auctions/',
  // lodgeandthomas — REMOVED: domain parked (GoDaddy), no longer active
  // bondoxboroughphillips — REMOVED: site unreachable (connection timeout)
  charlesdarrow:          'https://www.charlesdarrow.co.uk/auctions/',
  // Eastern England
  aldreds:                'https://www.aldreds.co.uk/auction/',
  humberts:               'https://www.humberts.com/auctions/',
  // Wales
  allwalesauction:        'https://thepropertypeople.bambooauctions.com',
  // evansbros — REMOVED: 404 on auction URL, no property auction page found
  // herbertrthomasandco — REMOVED: site unreachable (connection timeout)
  johnfrancis:            'https://www.johnfrancis.co.uk/properties/sales/tag-auction',
  morrismarshall:         'https://www.morrismarshall.co.uk/search/?instruction_type=Auction',
  // Midlands
  // andrewgrant — REMOVED: estate agent only, no dedicated auction listings
  gherbertbanks:          'https://www.gherbertbanks.co.uk/auctions/',
  hawkesford:             'https://www.hawkesford.co.uk/auctions/',
  howkinsandharrison:     'https://www.howkinsandharrison.co.uk/auctions/',
  scargillmann:           'https://www.sdlauctions.co.uk/properties/',
  // North West
  mellerbraggins:         'https://www.mellerbraggins.com/auctions/',
  smithandsons:           'https://www.smithandsons.net/auctionproperties/1113347',
  wrightmarshall:         'https://www.iamsold.co.uk/estate-agent/wrightmarshall/',
  // North East / Cumbria / Lake District
  // hackneyandleigh — REMOVED: site down (ECONNREFUSED)
  // Scotland
  // onlinepropertyauctionsscotland — REMOVED: site down (ECONNREFUSED)
  // ── GOTO Properties platform (EIG-based, April 2026) ──
  purplebricksgoto:       'https://purplebricks.gotoproperties.co.uk/search?pagesize=48',
  // ── Verified EIG subdomains (April 2026) ──
  groundrentauctions:     'https://groundrentauctions.eigonlineauctions.com/search',
  benjaminstevens:        'https://online.benjaminstevensauctions.co.uk/search',
  // ── New houses from own websites (April 2026) ──
  auctionhammermidlands:  'https://auctionhammermidlands.co.uk/auction/',
  sharpesauctions:        'https://www.sharpesauctions.co.uk/current-traditional-auction.php',
  jjmorris:               'https://www.jjmorris.com/list-search-results/?auction=1&showstc=on',
  rendells:               'https://rendells.bambooauctions.com',
  pearsonferrier:         'https://pearsonferrier.co.uk/next-auctions/',
};

/*
 * ── LIVE EXTRACTION TEST RESULTS (Plan 02-03, 2026-03-15) ──
 * All 15 new houses PASS with >0 lots. Total 3,315 lots (page 1), 99.6% images.
 *
 * agentsproperty:          84 lots,  84 imgs, 100% price — WordPress cards
 * andrewcraig:             24 lots,  24 imgs, 100% price — Estate Apps
 * buttersjohnbee:          12 lots,   0 imgs, 100% price — Rex v2 (images need Firecrawl)
 * cheffins:                10 lots,  10 imgs,  50% price — Own platform (catalogue-view)
 * cheffinstimed:           15 lots,  15 imgs,  60% price — EIG platform
 * fssproperty:              1 lots,   1 imgs, 100% price — Same CMS as Hollis Morgan
 * iamsold:                  5 lots,   5 imgs, 100% price — data-bkimage cards
 * brownco:                 50 lots,  50 imgs,  96% price — EIG platform
 * suttonkersh:             16 lots,  16 imgs,  94% price — start=N pagination (108 total)
 * auctionhouseeastanglia: 506 lots, 506 imgs,  88% price — AH UK branch
 * auctionhousenorthwest:  916 lots, 916 imgs,  81% price — AH UK branch
 * auctionhousenortheast:  722 lots, 722 imgs,  81% price — AH UK branch
 * auctionhousewales:      606 lots, 606 imgs,  72% price — AH UK branch
 * auctionhousebirmingham: 206 lots, 206 imgs,  62% price — AH UK branch
 * auctionhousekent:       142 lots, 142 imgs,  68% price — AH UK branch
 *
 * Blocked/inaccessible (not added): Symonds & Sampson, GTH, All Wales Auction
 */
// Now that HOUSE_ROOTS is defined, populate the image backfill set
PUPPETEER_IMAGE_HOUSES = new Set(Object.keys(HOUSE_ROOTS));

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

// ═══════════════════════════════════════════════════════════════
// SIMPLE IN-MEMORY RATE LIMITER
// ═══════════════════════════════════════════════════════════════
const _rlBuckets = new Map();
function rateLimit(windowMs, maxHits) {
  return (req, res, next) => {
    const ip = getClientIP(req);
    const key = `${req.route?.path || req.path}:${ip}`;
    const now = Date.now();
    let bucket = _rlBuckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      _rlBuckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > maxHits) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}
// Clean up stale rate-limit buckets every 10 minutes (5-min TTL)
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of _rlBuckets) {
    if (now - bucket.start > 300000) _rlBuckets.delete(key); // 5 min TTL
  }
}, 600000);

// ═══════════════════════════════════════════════════════════════
// URL VALIDATION — prevent SSRF via user-supplied URLs
// ═══════════════════════════════════════════════════════════════
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd/i,
  /\.local$/,
  /\.internal$/,
  /\.railway\.internal$/,
];

function isPrivateIP(ip) {
  return BLOCKED_HOST_PATTERNS.some(pat => pat.test(ip));
}

async function validateUrl(raw) {
  let parsed;
  try { parsed = new URL(raw); } catch { return { ok: false, error: 'Invalid URL' }; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Only http/https URLs are allowed' };
  }
  const hostname = parsed.hostname.toLowerCase();
  // Block by hostname pattern
  if (isPrivateIP(hostname)) {
    return { ok: false, error: 'URL points to a private/internal address' };
  }
  // DNS resolution check to prevent DNS rebinding
  try {
    const { address } = await lookup(hostname);
    if (isPrivateIP(address)) {
      return { ok: false, error: 'URL resolves to a private/internal address' };
    }
  } catch {
    return { ok: false, error: 'Cannot resolve hostname' };
  }
  return { ok: true, url: parsed.href };
}

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

const FREE_SCAN_LIMIT = 3;

const FREE_PREVIEW_LOTS = 6; // Show full AI data on first N lots even for free users over limit

// ── Centralised tier resolution ──
const SIGNED_IN_DAILY_LIMIT = 50;  // Daily AI search limit for signed-in users when Stripe disabled

function resolveEffectiveTier(user) {
  if (!user) return 'anon';
  if (!STRIPE_ENABLED) return 'premium'; // All signed-in users are premium when Stripe hibernated
  const tier = user.tier || 'free';
  if (tier === 'premium') return 'premium';
  if (user.trial_expires_at && new Date(user.trial_expires_at) > new Date()) return 'premium';
  return tier;
}

// ── AI Search tier limits ──
const ANON_AI_SEARCH_LIMIT = 3;   // Anonymous users: 3 AI searches/day by IP
const FREE_AI_SEARCH_LIMIT = 5;   // Free registered users: 5 AI searches/day

function getAISearchLimit(user) {
  if (!user) return ANON_AI_SEARCH_LIMIT;
  if (!STRIPE_ENABLED) return SIGNED_IN_DAILY_LIMIT; // 50/day for all signed-in users when Stripe disabled
  const tier = user.tier || 'free';
  if (tier === 'premium') return Infinity;
  if (user.trial_expires_at && new Date(user.trial_expires_at) > new Date()) return Infinity;
  return FREE_AI_SEARCH_LIMIT;
}

function truncateAddress(address) {
  if (!address) return 'Address available with upgrade';
  // Show only area/town — strip street number and name, keep postcode area + town
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 3) return parts.slice(-2).join(', '); // Last 2 parts (town, county/postcode)
  if (parts.length === 2) return parts[1]; // Just the town/area
  // Single part — try to extract just the town/postcode area
  const pcMatch = address.match(/[A-Z]{1,2}\d/);
  if (pcMatch) return pcMatch[0] + '*** area';
  return 'Location available with upgrade';
}

function stripAIFields(lots) {
  return lots.map((lot, i) => {
    if (i < FREE_PREVIEW_LOTS) return lot; // Let them see the value
    return {
      ...lot,
      score: null, opps: [], risks: [], scoreBreakdown: [], bullets: [], dealType: null,
      url: null,                              // Hide auction house link
      address: truncateAddress(lot.address),   // Truncate to area only
      blurred: true
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// API: AUCTION CALENDAR
// ═══════════════════════════════════════════════════════════════

// Hardcoded fallback calendar — used when Supabase auction_calendar table is empty
const FALLBACK_CALENDAR = [
    // ── SAVILLS ──
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-03-31', title: '31 March 2026', lots: null,
      url: 'https://auctions.savills.co.uk/auctions/31-march-2026-220',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-04-21', title: '21 April 2026', lots: null,
      url: 'https://auctions.savills.co.uk/auctions/21-april-2026-221',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-05-06', title: '6 May 2026', lots: null,
      url: 'https://auctions.savills.co.uk/auctions/6-may-2026-222',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── ALLSOP ──
    {
      house: 'Allsop', houseSlug: 'allsop', logo: '🔨',
      date: '2026-03-25', dateEnd: '2026-03-26',
      title: '25 & 26 March 2026 — Residential', lots: null,
      url: 'https://www.allsop.co.uk/residential-auction-view-mar',
      location: 'Online (Live Stream)', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Allsop', houseSlug: 'allsop', logo: '🔨',
      date: '2026-03-24', title: '24 March 2026 — Commercial', lots: null,
      url: 'https://www.allsop.co.uk/commercial-auction-view',
      location: 'Online (Live Stream)', type: 'Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Allsop', houseSlug: 'allsop', logo: '🔨',
      date: '2026-03-25', dateEnd: '2026-03-26',
      title: '25 & 26 March 2026 — Residential', lots: null,
      url: 'https://www.allsop.co.uk/residential-auction-view',
      location: 'Online (Live Stream)', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    // ── NETWORK AUCTIONS ──
    {
      house: 'Network Auctions', houseSlug: 'network', logo: '🌐',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.networkauctions.co.uk/auctions/next-auction/',
      location: 'Online', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Network Auctions', houseSlug: 'network', logo: '🌐',
      date: '2026-05-07', title: '7 May 2026', lots: null,
      url: 'https://www.networkauctions.co.uk/auctions/future-auctions/',
      location: 'Online', type: 'Residential', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Network Auctions', houseSlug: 'network', logo: '🌐',
      date: '2026-06-18', title: '18 June 2026', lots: null,
      url: 'https://www.networkauctions.co.uk/auctions/future-auctions/',
      location: 'Online', type: 'Residential', status: 'upcoming',
      catalogueReady: false,
    },
    // ── BTG EDDISONS (formerly SDL Auctions) ──
    // BTG Eddisons runs rolling timed auctions — all current lots on /properties/
    {
      house: 'BTG Eddisons', houseSlug: 'sdl', logo: '⚡',
      date: '2026-03-25', title: 'Multi-Lot Timed Auction — March 2026', lots: null,
      url: 'https://www.btgeddisonspropertyauctions.com/properties/',
      location: 'Online (Timed)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'SDL Auctions', houseSlug: 'sdl', logo: '⚡',
      date: '2026-03-24', title: '24 March 2026 — Timed', lots: null,
      url: 'https://www.sdlauctions.co.uk/auction/1311/multi-lot-timed-auction-2026-03-24/',
      location: 'Online (Timed)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'SDL Auctions', houseSlug: 'sdl', logo: '⚡',
      date: '2026-03-26', title: '26 March 2026 — Live Streamed', lots: null,
      url: 'https://www.sdlauctions.co.uk/auction/1297/live-streamed-auction-2026-03-26/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── BOND WOLFE ──
    {
      house: 'Bond Wolfe', houseSlug: 'bondwolfe', logo: '🔶',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.bondwolfe.com/auction/3448/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Bond Wolfe', houseSlug: 'bondwolfe', logo: '🔶',
      date: '2026-05-14', title: '14 May 2026', lots: null,
      url: 'https://www.bondwolfe.com/property-auctions-west-midlands/upcoming-property-auctions/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Bond Wolfe', houseSlug: 'bondwolfe', logo: '🔶',
      date: '2026-07-09', title: '9 July 2026', lots: null,
      url: 'https://www.bondwolfe.com/property-auctions-west-midlands/upcoming-property-auctions/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── BARNARD MARCUS ──
    {
      house: 'Barnard Marcus', houseSlug: 'barnardmarcus', logo: '🏠',
      date: '2026-05-19', title: '19 May 2026', lots: null,
      url: 'https://www.barnardmarcusauctions.co.uk/auctions/19-may/',
      location: 'Grand Connaught Rooms, London WC2B', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── AUCTION HOUSE LONDON ──
    {
      house: 'Auction House London', houseSlug: 'auctionhouselondon', logo: '🔑',
      date: '2026-03-18', title: '18-19 March 2026', lots: null,
      url: 'https://auctionhouselondon.co.uk/current-auction/catalogue/18th-19th-march-2026',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House London', houseSlug: 'auctionhouselondon', logo: '🔑',
      date: '2026-03-18', dateEnd: '2026-03-19', title: '18 & 19 March 2026', lots: null,
      url: 'https://auctionhouselondon.co.uk/auction/march-18-19-2026',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── CLIVE EMSON ──
    {
      house: 'Clive Emson', houseSlug: 'cliveemson', logo: '🌿',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.cliveemson.co.uk/properties/',
      location: 'Online', type: 'Residential & Land', status: 'upcoming',
      catalogueReady: true,
    },
    // ── STRETTONS ──
    {
      house: 'Strettons', houseSlug: 'strettons', logo: '📋',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.strettons.co.uk/auctions/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── ACUITUS ──
    {
      house: 'Acuitus', houseSlug: 'acuitus', logo: '🏢',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.acuitus.co.uk/find-a-property/',
      location: 'Online (Live Stream)', type: 'Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Acuitus', houseSlug: 'acuitus', logo: '🏢',
      date: '2026-05-06', title: '6 May 2026', lots: null,
      url: 'https://www.acuitus.co.uk/find-a-property/',
      location: 'Online (Live Stream)', type: 'Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Acuitus', houseSlug: 'acuitus', logo: '🏢',
      date: '2026-06-11', title: '11 June 2026', lots: null,
      url: 'https://www.acuitus.co.uk/find-a-property/',
      location: 'Online (Live Stream)', type: 'Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── PROBATE AUCTION ──
    {
      house: 'Probate Auction', houseSlug: 'probateauction', logo: '⚖️',
      date: '2026-03-25', title: '25 March 2026', lots: null,
      url: 'https://probate.auction/auctions/wednesday-25th-march-2026/',
      location: 'Online', type: 'Residential (Probate)', status: 'upcoming',
      catalogueReady: true,
    },
    // ── HOLLIS MORGAN (Bristol) ──
    {
      house: 'Hollis Morgan', houseSlug: 'hollismorgan', logo: '🏘️',
      date: '2026-04-22', title: '22 April 2026', lots: null,
      url: 'https://www.hollismorgan.co.uk/search-auction/?bid=11&showstc=on&orderby=lot_no+asc',
      location: 'Online (Live Stream from Clifton, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── MAGGS & ALLEN (Bristol) ──
    {
      house: 'Maggs & Allen', houseSlug: 'maggsandallen', logo: '🔨',
      date: '2026-04-23', title: '23 April 2026', lots: null,
      url: 'https://www.maggsandallen.co.uk/search-auction/?auction=1&orderby=lot_no&n=0&showsold=on&showstc=on',
      location: 'Online (Live Stream, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Maggs & Allen', houseSlug: 'maggsandallen', logo: '🔨',
      date: '2026-05-20', title: '20 May 2026', lots: null,
      url: 'https://www.maggsandallen.co.uk/search-auction/?auction=1&orderby=lot_no&n=0&showsold=on&showstc=on',
      location: 'Online (Live Stream, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── MCHUGH & CO ──
    // McHugh uses EIG OAS platform. /current-auction redirects to /future-auctions/{auctionId}.
    // Large page (1.5MB, 200+ lots), needs Puppeteer with extended timeout.
    {
      house: 'McHugh & Co', houseSlug: 'mchughandco', logo: '🏡',
      date: '2026-03-25', title: '25 March 2026', lots: null,
      url: 'https://www.mchughandco.com/current-auction',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'McHugh & Co', houseSlug: 'mchughandco', logo: '🏡',
      date: '2026-05-13', title: '13 May 2026', lots: null,
      url: 'https://www.mchughandco.com/current-auction',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── AUCTION HOUSE UK (National franchise) ──
    {
      house: 'Auction House UK', houseSlug: 'auctionhouse', logo: '🏛️',
      date: '2026-03-16', title: '16 March 2026 (National Online)', lots: null,
      url: 'https://www.auctionhouse.co.uk/online',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── KNIGHT FRANK ──
    {
      house: 'Knight Frank', houseSlug: 'knightfrank', logo: '👑',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.knightfrankauctions.com/auction/3833/knight-frank-auctions-2026-03-19/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Knight Frank', houseSlug: 'knightfrank', logo: '👑',
      date: '2026-05-07', title: '7 May 2026', lots: null,
      url: 'https://www.knightfrankauctions.com/auction/3834/knight-frank-auctions-2026-05-07/',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },

    // ── PATTINSON ──
    {
      house: 'Pattinson', houseSlug: 'pattinson', logo: '🔷',
      date: '2026-03-25', title: 'March 2026 (North East)', lots: null,
      url: 'https://www.pattinson.co.uk/auction',
      location: 'Newcastle', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },

    // ── BIDX1 ──
    {
      house: 'BidX1', houseSlug: 'bidx1', logo: '💻',
      date: '2026-03-19', title: 'March 2026 (Online)', lots: null,
      url: 'https://bidx1.com/en/united-kingdom',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── PHILLIP ARNOLD ──
    {
      house: 'Phillip Arnold', houseSlug: 'philliparnold', logo: '🔨',
      date: '2026-04-16', title: '16 April 2026', lots: null,
      url: 'https://www.philliparnoldauctions.co.uk/current-lots',
      location: 'London', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },

    // ── EDWARD MELLOR ──
    {
      house: 'Edward Mellor', houseSlug: 'edwardmellor', logo: '🏘️',
      date: '2026-03-25', title: '25 March 2026', lots: null,
      url: 'https://edwardmellor.co.uk/auctions/25mar2026',
      location: 'Manchester', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── PAUL FOSH ──
    {
      house: 'Paul Fosh', houseSlug: 'paulfosh', logo: '🏴',
      date: '2026-12-03', title: 'December 2026 Online Auction', lots: null,
      url: 'https://paulfosh.eigonlineauctions.com/search',
      location: 'Newport / National', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── COTTONS ──
    // Cottons uses EIG embed via current-auction.htm (not /current-auction/ WordPress page).
    // EIG tenant_id=26, auction embed ID=82e84b89-9423-459c-bbd9-7462f82e35e2.
    // Next auction: April 22, 2026 — catalogue not yet published.
    {
      house: 'Cottons', houseSlug: 'cottons', logo: '🏭',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.cottons.co.uk/current-auction/',
      location: 'Birmingham', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── DEDMAN GRAY ──
    {
      house: 'Dedman Gray', houseSlug: 'dedmangray', logo: '📋',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.dedmangray.co.uk/auction/?q=1&tid=432',
      location: 'Essex', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── BARNETT ROSS ──
    {
      house: 'Barnett Ross', houseSlug: 'barnettross', logo: '🔑',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.barnettross.co.uk/current.php',
      location: 'London', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── BRADLEY HALL ──
    {
      house: 'Bradley Hall', houseSlug: 'bradleyhall', logo: '🏠',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://auction.bradleyhall.co.uk/',
      location: 'Newcastle', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── CONNECT UK ──
    {
      house: 'Connect UK', houseSlug: 'connectuk', logo: '🔗',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://connectukgroup.co.uk/auctions/',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── AUCTION ESTATES ──
    {
      house: 'Auction Estates', houseSlug: 'auctionestates', logo: '🏢',
      date: '2026-04-23', title: '23 April 2026', lots: null,
      url: 'https://www.auctionestates.co.uk/view-properties',
      location: 'Nottingham', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── LANDWOOD ──
    {
      house: 'Landwood', houseSlug: 'landwood', logo: '🌲',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://www.landwoodpropertyauctions.com/',
      location: 'Manchester', type: 'Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── LOVEITTS ──
    {
      house: 'Loveitts', houseSlug: 'loveitts', logo: '❤️',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://www.loveitts.co.uk/auction/',
      location: 'Coventry', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── HUNTERS ──
    {
      house: 'Hunters', houseSlug: 'hunters', logo: '🏠',
      date: '2026-03-16', title: 'Online Auction', lots: null,
      url: 'https://hunters.bambooauctions.com',
      location: 'National', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },

    // ── NEW HOUSES ──
    // Countrywide Property Auctions
    {
      house: 'Countrywide Property Auctions', houseSlug: 'countrywide', logo: '🌍',
      date: '2026-04-02', title: '2 April 2026 — South West', lots: null,
      url: 'https://www.countrywidepropertyauctions.co.uk/search.php?auction_date=current',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Sutton Kersh
    {
      house: 'Sutton Kersh', houseSlug: 'suttonkersh', logo: '🏛️',
      date: '2026-04-02', title: '2 April 2026 — Liverpool', lots: null,
      url: 'https://www.suttonkersh.co.uk/properties/gallery/?section=auction&auctionPeriod=current',
      location: 'Online (Live Stream)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Venmore Auctions
    {
      house: 'Venmore Auctions', houseSlug: 'venmore', logo: '🏛️',
      date: '2026-03-25', title: '25 March 2026', lots: null,
      url: 'https://www.venmoreauctions.co.uk/Property-Search',
      location: 'Liverpool', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Town & Country Property Auctions
    {
      house: 'Town & Country Property Auctions', houseSlug: 'tcpa', logo: '🏡',
      date: '2026-03-25', title: '25 March 2026 — National', lots: null,
      url: 'https://www.townandcountrypropertyauctions.co.uk/search',
      location: 'Online (Timed)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Future Property Auctions
    {
      house: 'Future Property Auctions', houseSlug: 'futureauctions', logo: '🔮',
      date: '2026-03-19', title: '19 March 2026 — Timed Online', lots: null,
      url: 'https://www.futurepropertyauctions.co.uk/catalogue_viewall.asp',
      location: 'Online (Timed)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Kivells
    {
      house: 'Kivells', houseSlug: 'kivells', logo: '🐑',
      date: '2026-03-20', title: 'March 2026 — Devon & Cornwall', lots: null,
      url: 'https://www.kivells.com/residential-property/properties-for-auction',
      location: 'Devon & Cornwall', type: 'Residential & Land', status: 'upcoming',
      catalogueReady: true,
    },
    // First For Auctions
    {
      house: 'First For Auctions', houseSlug: 'firstforauctions', logo: '🥇',
      date: '2026-03-15', title: 'March 2026 — National', lots: null,
      url: 'https://online.firstforauctions.co.uk/search?view=Grid',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Harman Healy
    {
      house: 'Harman Healy', houseSlug: 'harmanhealy', logo: '🔨',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.harman-healy.co.uk/search/auction',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Seel & Co
    {
      house: 'Seel & Co', houseSlug: 'seelauctions', logo: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://online.seelauctions.co.uk/search?view=Grid&showall=true',
      location: 'Cardiff', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Robinson & Hall
    {
      house: 'Robinson & Hall', houseSlug: 'robinsonhall', logo: '🏠',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://robinsonandhallauctions.co.uk/catalogues/',
      location: 'Bedford / Milton Keynes', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── NEW EIG HOUSES (March 2026 batch) ──
    {
      house: 'Astleys', houseSlug: 'astleys', logo: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
      date: '2026-03-25', title: 'March 2026 — Swansea', lots: null,
      url: 'https://astleys.eigonlineauctions.com/search',
      location: 'Swansea', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Henry Sykes Auctions', houseSlug: 'henrysykes', logo: '🔨',
      date: '2026-03-25', title: 'March 2026 — Online', lots: null,
      url: 'https://onlineauctions.henrysykes.co.uk/search',
      location: 'National (Franchise)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Clarke & Simpson', houseSlug: 'clarkesimpson', logo: '🔨',
      date: '2099-12-31', title: 'Current Catalogue', lots: null,
      url: 'https://clarke-simpson.eigonlineauctions.com/search',
      location: 'Suffolk', type: 'Residential & Land', status: 'always_on',
      catalogueReady: true,
    },
    {
      house: 'Durrants', houseSlug: 'durrants', logo: '🏡',
      date: '2026-03-25', title: '25 March 2026', lots: null,
      url: 'https://durrants.com/property-auctions/next-property-auction',
      location: 'Norfolk / Suffolk', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Dawsons', houseSlug: 'dawsons', logo: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
      date: '2026-03-20', title: 'March 2026 — South Wales', lots: null,
      url: 'https://www.dawsonsproperty.co.uk/auctions.php',
      location: 'South Wales', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Goldings', houseSlug: 'goldings', logo: '🔨',
      date: '2026-05-06', title: '6 May 2026 — Ipswich', lots: null,
      url: 'https://www.goldingsauctions.co.uk/auctions/next-auction/',
      location: 'Ipswich / Suffolk', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House Scotland', houseSlug: 'auctionhousescotland', logo: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/scotland/auction/search-results',
      location: 'Scotland', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House Sussex & Hampshire', houseSlug: 'austingray', logo: '🏠',
      date: '2026-03-26', title: '26 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/sussexandhampshire',
      location: 'Sussex & Hampshire', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── NEW HOUSES (March 2026 batch 2 — missing from original calendar) ──
    {
      house: 'Agents Property Auction', houseSlug: 'agentsproperty', logo: '🏠',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://www.agentspropertyauction.com/next-auction/',
      location: 'National', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Andrew Craig', houseSlug: 'andrewcraig', logo: '🏠',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://www.andrewcraig.co.uk/auction-property-for-sale',
      location: 'North East', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Butters John Bee', houseSlug: 'buttersjohnbee', logo: '🐝',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.buttersjohnbee.com/listings?auction=1&status=all',
      location: 'Staffordshire', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Brown & Co', houseSlug: 'brownco', logo: '🌾',
      date: '2026-03-17', title: '17 March 2026', lots: null,
      url: 'https://brownandco.eigonlineauctions.com/search',
      location: 'East Anglia', type: 'Residential & Land', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Cheffins', houseSlug: 'cheffins', logo: '🔨',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://www.cheffins.co.uk/property-auctions/catalogue-view',
      location: 'Cambridge', type: 'Residential & Land', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Cheffins Timed', houseSlug: 'cheffinstimed', logo: '⏱️',
      date: '2026-03-25', title: 'March 2026 — Timed', lots: null,
      url: 'https://timedpropertyauctions.cheffins.co.uk/search',
      location: 'Cambridge', type: 'Residential & Land', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Feather Smailes & Scales', houseSlug: 'fssproperty', logo: '⚖️',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.fssproperty.co.uk/search-auction/?bid=AUC&showsold=on&showstc=on',
      location: 'Yorkshire', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'iamsold', houseSlug: 'iamsold', logo: '💻',
      date: '2026-03-25', title: 'March 2026', lots: null,
      url: 'https://www.iamsold.co.uk/available-properties/',
      location: 'National', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },

    // ── Auction House UK regional branches ──
    {
      house: 'Auction House East Anglia', houseSlug: 'auctionhouseeastanglia', logo: '🏛️',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/eastanglia/auction/search-results',
      location: 'East Anglia', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House North West', houseSlug: 'auctionhousenorthwest', logo: '🏛️',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/northwest/auction/search-results',
      location: 'North West', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House North East', houseSlug: 'auctionhousenortheast', logo: '🏛️',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/northeast/auction/search-results',
      location: 'North East', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House Wales', houseSlug: 'auctionhousewales', logo: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/southwales/auction/search-results',
      location: 'Wales', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House Birmingham', houseSlug: 'auctionhousebirmingham', logo: '🏛️',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/birmingham/auction/search-results',
      location: 'Birmingham', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Auction House Kent', houseSlug: 'auctionhousekent', logo: '🏛️',
      date: '2026-03-16', title: '16 March 2026', lots: null,
      url: 'https://www.auctionhouse.co.uk/kent/auction/search-results',
      location: 'Kent', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
];

async function getAuctionCalendar() {
  // Try Supabase first
  try {
    const now = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('auction_calendar')
      .select('*')
      .gte('date', now)
      .order('date', { ascending: true });

    if (!error && data && data.length > 0) {
      // Deduplicate: keep one entry per house+date+url (prefer catalogue_ready=true)
      const seen = new Map();
      for (const row of data) {
        const key = `${(row.house || '').toLowerCase()}|${row.date}|${normaliseUrl(row.url)}`;
        const existing = seen.get(key);
        if (!existing || (row.catalogue_ready && !existing.catalogue_ready)) {
          seen.set(key, row);
        }
      }
      return [...seen.values()].map(row => ({
        id: row.id,
        house: row.house,
        houseSlug: row.house_slug,
        logo: row.logo,
        date: row.date,
        dateEnd: row.date_end || undefined,
        title: row.title,
        lots: row.lots,
        url: row.url,
        location: row.location,
        type: row.type,
        status: row.status,
        catalogueReady: row.catalogue_ready,
      }));
    }
  } catch (e) {
    console.warn('Calendar DB read failed, using fallback:', e.message);
  }

  // Fallback to hardcoded
  const now = new Date().toISOString().slice(0, 10);
  return FALLBACK_CALENDAR
    .filter(a => a.date >= now || a.status === 'upcoming')
    .sort((a, b) => a.date.localeCompare(b.date));
}

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
            _lastExtractorUsed = DOM_EXTRACTORS[house] ? 'dom-house' : 'dom-generic';
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
      scraped_with: _lastScrapeEngine,
    extracted_with: _lastExtractorUsed,
    ai_tier: _lastAITier,
    }, { onConflict: 'url' });

    // ── Upsert individual lots to lots table (single source of truth) ──
    normaliseLotStatuses(enrichedAnalysed); // Normalize before write — canonical statuses only
    await upsertToLotsTable(enrichedAnalysed, house, url, {
      scrapedWith: _lastScrapeEngine,
      extractedWith: _lastExtractorUsed,
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
        if (FIRECRAWL_API_KEY && !fcCreditExhausted) {
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
      scrapedWith: FIRECRAWL_API_KEY && !fcCreditExhausted && !FIRECRAWL_SKIP.has(house) ? 'firecrawl' : (puppeteer ? 'puppeteer' : 'http'),
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
// DIAGNOSTIC ENDPOINT (temporary — remove after debugging)
// ═══════════════════════════════════════════════════════════════
app.get('/api/diag', (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  res.json({
    uptime: Math.round(process.uptime()),
    autoRunning: _autoAnalysisRunning,
    creditExhausted,
    fcKey: FIRECRAWL_API_KEY ? 'configured' : 'NOT SET',
    fcCreditsUsed,
    fcCreditExhausted,
    fcTemporarilyDown,
    fcFallbackCount,
    fcErrorCount,
    fcRequestCount,
    fcLastError,
    fcLastErrorAt,
    puppeteerAvailable: !!puppeteer,
    geminiKey: process.env.GEMINI_API_KEY ? 'set' : 'NOT SET',
    apiCallCount,
    circuitBreakers: {
      epc: epcBreaker.status,
      flood: floodBreaker.status,
      landRegistry: lrBreaker.status,
    },
  });
});

// ═══════════════════════════════════════════════════════════════
// ENRICHMENT HEALTH — per-house EPC/flood/LR/image coverage
// ═══════════════════════════════════════════════════════════════
app.get('/api/diag/enrichment', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    // Query lots table directly — no more JSONB blob deserialization
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: rows, error: qErr } = await supabase.rpc('enrichment_health_by_house', {}).catch(() => ({ data: null, error: { message: 'rpc not available' } }));

    // Fallback: raw SQL via aggregation on lots table
    const { data: aggRows } = rows ? { data: rows } : await supabase
      .from('lots')
      .select('house, epc_rating, flood_zone, street_avg, image_url')
      .gte('last_seen_at', cutoff);

    const byHouse = {};
    for (const r of (aggRows || [])) {
      const h = r.house || 'unknown';
      if (!byHouse[h]) byHouse[h] = { n: 0, epc: 0, flood: 0, lr: 0, img: 0 };
      byHouse[h].n++;
      if (r.epc_rating) byHouse[h].epc++;
      if (r.flood_zone != null) byHouse[h].flood++;
      if (r.street_avg != null) byHouse[h].lr++;
      if (r.image_url) byHouse[h].img++;
    }
    const houses = [];
    let totalLots = 0, totalEpc = 0, totalFlood = 0, totalLr = 0, totalImg = 0;
    for (const [house, d] of Object.entries(byHouse)) {
      if (!d.n) continue;
      totalLots += d.n; totalEpc += d.epc; totalFlood += d.flood; totalLr += d.lr; totalImg += d.img;
      houses.push({
        house, lots: d.n,
        epc: Math.round(d.epc / d.n * 100), flood: Math.round(d.flood / d.n * 100),
        lr: Math.round(d.lr / d.n * 100), images: Math.round(d.img / d.n * 100),
        gaps: [
          d.epc / d.n < 0.3 ? 'EPC' : null, d.flood / d.n < 0.3 ? 'Flood' : null,
          d.lr / d.n < 0.3 ? 'LR' : null, d.img / d.n < 0.3 ? 'Images' : null,
        ].filter(Boolean),
      });
    }
    houses.sort((a, b) => (a.epc + a.flood + a.lr + a.images) - (b.epc + b.flood + b.lr + b.images));
    res.json({
      circuitBreakers: { epc: epcBreaker.status, flood: floodBreaker.status, landRegistry: lrBreaker.status },
      summary: {
        totalLots,
        epc: totalLots ? Math.round(totalEpc / totalLots * 100) : 0,
        flood: totalLots ? Math.round(totalFlood / totalLots * 100) : 0,
        lr: totalLots ? Math.round(totalLr / totalLots * 100) : 0,
        images: totalLots ? Math.round(totalImg / totalLots * 100) : 0,
      },
      houses,
    });
  } catch (e) {
    log.error('Enrichment health error', { error: e.message });
    res.status(500).json({ error: 'Failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// TENURE DIAGNOSTIC (temporary — remove after tenure coverage hits 90%+)
// ═══════════════════════════════════════════════════════════════
app.get('/api/diag/tenure', async (req, res) => {
  const adminToken = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(adminToken, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    // Query lots table directly — no more cached_analyses JSONB blobs
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: rows } = await supabase
      .from('lots')
      .select('house, tenure')
      .gte('last_seen_at', cutoff);
    if (!rows) return res.json({ error: 'no data' });

    const counts = { freehold: 0, leasehold: 0, shareOfFreehold: 0, empty: 0, total: 0 };
    const byHouse = {};
    for (const r of rows) {
      counts.total++;
      const t = (r.tenure || '').trim().toLowerCase();
      if (t === 'freehold') counts.freehold++;
      else if (t === 'leasehold') counts.leasehold++;
      else if (t.includes('share')) counts.shareOfFreehold++;
      else counts.empty++;

      if (!t) {
        byHouse[r.house] = (byHouse[r.house] || 0) + 1;
      }
    }
    const populated = counts.total - counts.empty;
    res.json({
      summary: { ...counts, populated, pct: counts.total ? Math.round(populated / counts.total * 100) : 0 },
      nullsByHouse: Object.entries(byHouse).sort((a, b) => b[1] - a[1]).map(([house, count]) => ({ house, count })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
        status: fcCreditExhausted ? 'exhausted' : fcTemporarilyDown ? 'down' : 'ok',
        creditsUsed: fcCreditsUsed,
        creditBudget: FIRECRAWL_MONTHLY_BUDGET,
        exhausted: fcCreditExhausted,
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
        creditsUsed: fcCreditsUsed,
        creditExhausted: fcCreditExhausted,
        temporarilyDown: fcTemporarilyDown,
        fallbackCount: fcFallbackCount,
        errorCount: fcErrorCount,
        requestCount: fcRequestCount,
        monthlyBudget: FIRECRAWL_MONTHLY_BUDGET,
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

// ═══════════════════════════════════════════════════════════════
// AUCTION HOUSE DETECTION
// ═══════════════════════════════════════════════════════════════
function detectAuctionHouse(url) {
  const u = url.toLowerCase();
  if (u.includes('savills')) return 'savills';
  if (u.includes('allsop')) return 'allsop';
  if (u.includes('btgeddisonspropertyauctions') || u.includes('btgeddisons')) return 'sdl';
  if (u.includes('pugh-auctions')) return 'pugh';
  if (u.includes('sdlauctions')) return 'sdl';
  if (u.includes('networkauctions')) return 'network';
  if (u.includes('bondwolfe')) return 'bondwolfe';
  if (u.includes('barnardmarcusauctions') || u.includes('barnardmarcus')) return 'barnardmarcus';
  if (u.includes('auctionhouselondon')) return 'auctionhouselondon';
  if (u.includes('auctionhouse.co.uk/scotland')) return 'auctionhousescotland';
  if (u.includes('auctionhouse.co.uk/sussexandhampshire') || u.includes('sussexandhampshire')) return 'austingray';
  if (u.includes('auctionhouse.co.uk/eastanglia')) return 'auctionhouseeastanglia';
  if (u.includes('auctionhouse.co.uk/northwest')) return 'auctionhousenorthwest';
  if (u.includes('auctionhouse.co.uk/northeast')) return 'auctionhousenortheast';
  if (u.includes('auctionhouse.co.uk/southwales') || u.includes('auctionhouse.co.uk/wales')) return 'auctionhousewales';
  if (u.includes('auctionhouse.co.uk/birmingham')) return 'auctionhousebirmingham';
  if (u.includes('auctionhouse.co.uk/kent')) return 'auctionhousekent';
  if (u.includes('auctionhouse.co.uk/devonandcornwall')) return 'auctionhousedevon';
  if (u.includes('auctionhouse.co.uk/eastmidlands')) return 'auctionhouseeastmidlands';
  if (u.includes('auctionhouse.co.uk/westmidlands')) return 'auctionhousewestmidlands';
  if (u.includes('auctionhouse.co.uk/essex')) return 'auctionhouseessex';
  if (u.includes('auctionhouse.co.uk/manchester')) return 'auctionhousemanchester';
  // ── Auction House UK regional branches (must come BEFORE generic catch-all) ──
  if (u.includes('auctionhouse.co.uk/southyorkshire')) return 'auctionhousesouthyorkshire';
  if (u.includes('auctionhouse.co.uk/westyorkshire')) return 'auctionhousewestyorkshire';
  if (u.includes('auctionhouse.co.uk/teesvalley')) return 'auctionhouseteesvalley';
  if (u.includes('auctionhouse.co.uk/hullandeastyorkshire')) return 'auctionhousehull';
  if (u.includes('auctionhouse.co.uk/cumbria')) return 'auctionhousecumbria';
  if (u.includes('auctionhouse.co.uk/lincolnshire')) return 'auctionhouselincolnshire';
  if (u.includes('auctionhouse.co.uk/london')) return 'auctionhouseuklondon';
  if (u.includes('auctionhouse.co.uk/bedsandbucks')) return 'auctionhousebedsandbucks';
  if (u.includes('auctionhouse.co.uk/northamptonshire')) return 'auctionhousenorthamptonshire';
  if (u.includes('auctionhouse.co.uk/oxfordshire')) return 'auctionhouseoxfordshire';
  if (u.includes('auctionhouse.co.uk/leicestershire')) return 'auctionhouseleicestershire';
  if (u.includes('auctionhouse.co.uk/midlands')) return 'auctionhousemidlands';
  if (u.includes('auctionhouse.co.uk/coventryandwarwickshire')) return 'auctionhousecoventry';
  if (u.includes('auctionhouse.co.uk/nottsandderby')) return 'auctionhousenottsandderby';
  if (u.includes('auctionhouse.co.uk/chesterfieldandnorthderbyshire')) return 'auctionhousechesterfield';
  if (u.includes('auctionhouse.co.uk/staffordshire')) return 'auctionhousestaffordshire';
  if (u.includes('auctionhouse.co.uk/northwales')) return 'auctionhousenorthwales';
  if (u.includes('auctionhouse.co.uk/southwest')) return 'auctionhousesouthwest';
  if (u.includes('auctionhouse.co.uk/northernireland')) return 'auctionhousenorthernireland';
  if (u.includes('auctionhouse.co.uk/national')) return 'auctionhousenational';
  if (u.includes('auctionhouse.co.uk') || u.includes('auctionhouse.uk.net')) return 'auctionhouse';
  if (u.includes('cliveemson')) return 'cliveemson';
  if (u.includes('strettons')) return 'strettons';
  if (u.includes('acuitus')) return 'acuitus';
  if (u.includes('hollismorgan')) return 'hollismorgan';
  if (u.includes('maggsandallen')) return 'maggsandallen';
  if (u.includes('mchughandco')) return 'mchughandco';
  if (u.includes('knightfrankauctions')) return 'knightfrank';
  if (u.includes('pattinson.co.uk')) return 'pattinson';
  if (u.includes('bidx1.com')) return 'bidx1';
  if (u.includes('philliparnoldauctions')) return 'philliparnold';
  if (u.includes('edwardmellor')) return 'edwardmellor';
  if (u.includes('paulfosh') || u.includes('paulfosh.eigonlineauctions')) return 'paulfosh';
  if (u.includes('cottons.co.uk')) return 'cottons';
  if (u.includes('dedmangray')) return 'dedmangray';
  if (u.includes('barnettross')) return 'barnettross';
  if (u.includes('bradleyhall')) return 'bradleyhall';
  if (u.includes('connectukauctions') || u.includes('connectukgroup')) return 'connectuk';
  if (u.includes('auctionestates')) return 'auctionestates';
  if (u.includes('landwoodpropertyauctions') || u.includes('landwoodgroup')) return 'landwood';
  if (u.includes('loveitts')) return 'loveitts';
  if (u.includes('hunters.com') || u.includes('bambooauctions.com')) return 'hunters';
  if (u.includes('probate.auction') || u.includes('timedauctions.probate.auction')) return 'probateauction';
  if (u.includes('auctionhouselondon')) return 'auctionhouselondon';
  if (u.includes('pughauctions') || u.includes('pugh')) return 'pugh';
  // ── New houses ──
  if (u.includes('suttonkersh')) return 'suttonkersh';
  if (u.includes('countrywidepropertyauctions')) return 'countrywide';
  if (u.includes('propertyauctionsouthwest')) return 'countrywide';
  if (u.includes('venmoreauctions')) return 'venmore';
  if (u.includes('townandcountrypropertyauctions') || u.includes('tcpa')) return 'tcpa';
  if (u.includes('futurepropertyauctions')) return 'futureauctions';
  if (u.includes('kivells.com')) return 'kivells';
  if (u.includes('firstforauctions') || u.includes('online.firstforauctions')) return 'firstforauctions';
  if (u.includes('harman-healy') || u.includes('harmanhealy')) return 'harmanhealy';
  if (u.includes('seelauctions') || u.includes('seelandco')) return 'seelauctions';
  if (u.includes('robinsonandhallauctions') || u.includes('robinsonandhall')) return 'robinsonhall';
  // ── EIG batch (March 2026) ──
  if (u.includes('astleys.eigonlineauctions') || u.includes('astleys.net')) return 'astleys';
  if (u.includes('henrysykes.co.uk') || u.includes('onlineauctions.henrysykes')) return 'henrysykes';
  if (u.includes('clarke-simpson.eigonlineauctions') || u.includes('clarkeandsimpson')) return 'clarkesimpson';
  if (u.includes('durrants.com') || u.includes('auctions.durrants')) return 'durrants';
  if (u.includes('dawsonsproperty')) return 'dawsons';
  if (u.includes('goldingsauctions')) return 'goldings';
  // ── New houses (March 2026 batch 2) ──
  if (u.includes('agentspropertyauction.com')) return 'agentsproperty';
  if (u.includes('andrewcraig.co.uk')) return 'andrewcraig';
  if (u.includes('buttersjohnbee.com')) return 'buttersjohnbee';
  if (u.includes('brown-co.com') || u.includes('brownandco.eigonlineauctions')) return 'brownco';
  if (u.includes('timedpropertyauctions.cheffins')) return 'cheffinstimed';
  if (u.includes('cheffins.co.uk')) return 'cheffins';
  if (u.includes('fssproperty.co.uk')) return 'fssproperty';
  if (u.includes('iamsold.co.uk')) return 'iamsold';
  if (u.includes('romanway.eigonlineauctions')) return 'romanway';
  if (u.includes('hammerprice.eigonlineauctions')) return 'hammerprice';
  // ── Regional/independent houses (batch 6, March 2026) ──
  if (u.includes('underthehammer.com')) return 'underthehammer';
  if (u.includes('lacyscottandknight.bambooauctions') || u.includes('lsk.co.uk')) return 'lsk';
  // ── Tier 2/3 houses (March 2026) ──
  if (u.includes('foxandsonsauctions.co.uk')) return 'foxandsons';
  if (u.includes('bagshawsauctions.co.uk')) return 'bagshaws';
  if (u.includes('wilsonsauctions.com')) return 'wilsons';
  if (u.includes('strakers.co.uk')) return 'strakers';
  if (u.includes('johnpyeproperty.co.uk')) return 'johnpye';
  // ── EIG batch 5 houses ──
  if (u.includes('sarah-mains.eigonlineauctions')) return 'sarahmains';
  if (u.includes('sageandco.eigonlineauctions')) return 'sageandco';
  if (u.includes('auctiontrade.eigonlineauctions')) return 'auctiontrade';
  if (u.includes('brggibsonbelfastauctions.eigonlineauctions')) return 'brggibson';
  if (u.includes('higginsdrysdale.eigonlineauctions')) return 'higginsdrysdale';
  if (u.includes('martinpole.eigonlineauctions')) return 'martinpole';
  if (u.includes('jonespeckover.eigonlineauctions')) return 'jonespeckover';
  if (u.includes('thepropertyauctionhouse.eigonlineauctions')) return 'thepropertyauctionhouse';
  if (u.includes('propertyauctionagent.eigonlineauctions')) return 'propertyauctionagent';
  if (u.includes('lot9.eigonlineauctions')) return 'lot9';
  if (u.includes('auction-north.eigonlineauctions')) return 'auctionnorth';
  if (u.includes('bowensonandwatson.eigonlineauctions')) return 'bowensonandwatson';
  if (u.includes('sheldonbosleyknight') || u.includes('sbkauctions')) return 'sheldonbosley';
  if (u.includes('nationalpropertyauctions.eigonlineauctions')) return 'nationalpropertyauctions';
  // ── Batch 7: Tier 1 expansion ──
  if (u.includes('auctions.symondsandsampson')) return 'symondsandsampson';
  if (u.includes('stags.co.uk')) return 'stags';
  if (u.includes('propertyauctions.lsh.co.uk')) return 'lsh';
  if (u.includes('carterjonas.co.uk')) return 'carterjonas';
  if (u.includes('gth.net')) return 'gth';
  if (u.includes('hallsgb.com')) return 'halls';
  if (u.includes('walkersingleton')) return 'walkersingleton';
  if (u.includes('drivers.co.uk')) return 'driversnorris';
  if (u.includes('shonkibros.com')) return 'shonkibros';
  if (u.includes('robinjessop.co.uk')) return 'robinjessop';
  // ── Batch 7: Tier 2 expansion ──
  if (u.includes('ctf-uk.com')) return 'cleetompkinson';
  if (u.includes('mccartneys.co.uk')) return 'mccartneys';
  if (u.includes('bramleys.com')) return 'bramleys';
  if (u.includes('cooperandtanner.co.uk')) return 'cooperandtanner';
  if (u.includes('brutonknowles.co.uk')) return 'brutonknowles';
  if (u.includes('fishergerman.co.uk')) return 'fisherGerman';
  if (u.includes('woolleyandwallis.co.uk')) return 'woolleyandwallis';
  if (u.includes('hobbsparker.co.uk')) return 'hobbsparker';
  if (u.includes('arnoldskeys.com')) return 'arnoldskeys';
  if (u.includes('twgaze.co.uk')) return 'twgaze';
  if (u.includes('hairandson.co.uk')) return 'hairandson';
  if (u.includes('phillipsland.com')) return 'phillipssmithanddunn';
  if (u.includes('webbers.co.uk')) return 'webbers';
  // ── Batch 7: EIG additions ──
  if (u.includes('ahlondon.eigonlineauctions')) return 'ahlondon';
  if (u.includes('star-property-online.eigonlineauctions')) return 'starpropertyonline';
  if (u.includes('brggibsondublinauctions.eigonlineauctions')) return 'brggibsondublin';
  // ── Batch 8: Comprehensive UK coverage ──
  if (u.includes('propertysolvers.co.uk')) return 'propertysolvers';
  if (u.includes('markjenkinson.co.uk')) return 'markjenkinson';
  if (u.includes('regionalpropertyauctioneers.co.uk')) return 'regionalauctioneers';
  if (u.includes('clarkegammon.co.uk')) return 'clarkegammon';
  if (u.includes('nesbits.co.uk')) return 'nesbits';
  if (u.includes('pearsons.com')) return 'pearsons';
  if (u.includes('foxgrant.com')) return 'foxgrant';
  if (u.includes('lextons.com')) return 'lextons';
  if (u.includes('bradleys-estate-agents.co.uk')) return 'bradleysdevon';
  if (u.includes('taylerandfletcher.co.uk')) return 'taylerandfletcher';
  if (u.includes('luscombemaye.com')) return 'luscombemaye';
  if (u.includes('lodgeandthomas.com')) return 'lodgeandthomas';
  if (u.includes('bondoxboroughphillips.co.uk')) return 'bondoxboroughphillips';
  if (u.includes('charlesdarrow.co.uk')) return 'charlesdarrow';
  if (u.includes('aldreds.co.uk')) return 'aldreds';
  if (u.includes('humberts.com')) return 'humberts';
  if (u.includes('allwalesauction.com')) return 'allwalesauction';
  if (u.includes('evansbros.co.uk')) return 'evansbros';
  if (u.includes('herbertrthomasandco.co.uk')) return 'herbertrthomasandco';
  if (u.includes('johnfrancis.co.uk')) return 'johnfrancis';
  if (u.includes('morrismarshall.co.uk')) return 'morrismarshall';
  if (u.includes('andrewgrant.com')) return 'andrewgrant';
  if (u.includes('gherbertbanks.co.uk')) return 'gherbertbanks';
  if (u.includes('hawkesford.co.uk')) return 'hawkesford';
  if (u.includes('howkinsandharrison.co.uk')) return 'howkinsandharrison';
  if (u.includes('scargillmann.co.uk')) return 'scargillmann';
  if (u.includes('mellerbraggins.com')) return 'mellerbraggins';
  if (u.includes('smithandsons.net')) return 'smithandsons';
  if (u.includes('wrightmarshall.co.uk')) return 'wrightmarshall';
  if (u.includes('hackneyandleigh.co.uk')) return 'hackneyandleigh';
  if (u.includes('onlinepropertyauctionsscotland.co.uk')) return 'onlinepropertyauctionsscotland';
  // ── GOTO Properties platform (EIG-based) ──
  if (u.includes('purplebricks.gotoproperties')) return 'purplebricksgoto';
  if (u.includes('gotoproperties.co.uk')) return 'gotoproperties';
  if (u.includes('groundrentauctions.eigonlineauctions')) return 'groundrentauctions';
  if (u.includes('benjaminstevensauctions')) return 'benjaminstevens';
  // ── New houses from own websites (April 2026) ──
  if (u.includes('auctionhammermidlands')) return 'auctionhammermidlands';
  if (u.includes('sharpesauctions')) return 'sharpesauctions';
  if (u.includes('jjmorris.com')) return 'jjmorris';
  if (u.includes('rendells.bambooauctions') || u.includes('rendells.co.uk')) return 'rendells';
  if (u.includes('pearsonferrier.co.uk')) return 'pearsonferrier';
  // (Auction House UK branch patterns moved above generic catch-all)
  // ── EIG platform catch-all ──
  if (u.includes('.eigonlineauctions.com') || u.includes('eigpropertyauctions')) return 'eigplatform';
  // ── Bamboo Auctions catch-all ──
  if (u.includes('bambooauctions.com')) return 'hunters';
  // ── Auctionworks catch-all ──
  if (u.includes('auctionworks.co.uk')) return 'sarahmains';
  return 'unknown';
}

const HOUSE_DISPLAY_NAMES = {
  savills: 'Savills', allsop: 'Allsop', sdl: 'BTG Eddisons',
  network: 'Network Auctions', bondwolfe: 'Bond Wolfe', barnardmarcus: 'Barnard Marcus',
  auctionhouselondon: 'Auction House London', auctionhouse: 'Auction House UK',
  cliveemson: 'Clive Emson', strettons: 'Strettons', acuitus: 'Acuitus',
  hollismorgan: 'Hollis Morgan', maggsandallen: 'Maggs & Allen', mchughandco: 'McHugh & Co',
  knightfrank: 'Knight Frank', pattinson: 'Pattinson', bidx1: 'BidX1',
  philliparnold: 'Phillip Arnold', edwardmellor: 'Edward Mellor', paulfosh: 'Paul Fosh',
  cottons: 'Cottons', dedmangray: 'Dedman Gray', barnettross: 'Barnett Ross',
  bradleyhall: 'Bradley Hall', connectuk: 'Connect UK', auctionestates: 'Auction Estates',
  landwood: 'Landwood', loveitts: 'Loveitts', hunters: 'Hunters',
  probateauction: 'Probate Auction',
  countrywide: 'Countrywide Property Auctions', venmore: 'Venmore Auctions',
  tcpa: 'Town & Country Property Auctions', futureauctions: 'Future Property Auctions',
  kivells: 'Kivells', firstforauctions: 'First For Auctions',
  suttonkersh: 'Sutton Kersh', harmanhealy: 'Harman Healy',
  seelauctions: 'Seel & Co', robinsonhall: 'Robinson & Hall',
  astleys: 'Astleys', henrysykes: 'Henry Sykes Auctions', clarkesimpson: 'Clarke & Simpson',
  durrants: 'Durrants', dawsons: 'Dawsons', goldings: 'Goldings',
  auctionhousescotland: 'Auction House Scotland', austingray: 'Auction House Sussex & Hampshire',
  auctionhouseeastanglia: 'Auction House East Anglia', auctionhousenorthwest: 'Auction House North West',
  auctionhousenortheast: 'Auction House North East', auctionhousewales: 'Auction House Wales',
  auctionhousebirmingham: 'Auction House Birmingham', auctionhousekent: 'Auction House Kent',
  agentsproperty: 'Agents Property Auction', andrewcraig: 'Andrew Craig',
  buttersjohnbee: 'Butters John Bee', brownco: 'Brown & Co',
  cheffins: 'Cheffins', cheffinstimed: 'Cheffins Timed', fssproperty: 'Feather Smailes & Scales',
  iamsold: 'iamsold',
  // ── Batch 4 (March 2026) ──
  auctionhousedevon: 'Auction House Devon & Cornwall',
  auctionhouseeastmidlands: 'Auction House East Midlands',
  auctionhousewestmidlands: 'Auction House West Midlands',
  auctionhouseessex: 'Auction House Essex',
  auctionhousemanchester: 'Auction House Manchester',
  romanway: 'Roman Way Auctions',
  hammerprice: 'Hammer Price Auctions',
  // ── Batch 5 (March 2026) ──
  auctionhousesouthyorkshire: 'Auction House South Yorkshire',
  auctionhousewestyorkshire: 'Auction House West Yorkshire',
  auctionhouseteesvalley: 'Auction House North Yorkshire & Tees Valley',
  auctionhousehull: 'Auction House Hull & East Yorkshire',
  auctionhousecumbria: 'Auction House Cumbria',
  auctionhouselincolnshire: 'Auction House Lincolnshire',
  auctionhouseuklondon: 'Auction House UK London',
  auctionhousebedsandbucks: 'Auction House Beds & Bucks',
  auctionhousenorthamptonshire: 'Auction House Northamptonshire',
  auctionhouseoxfordshire: 'Auction House Oxfordshire',
  auctionhouseleicestershire: 'Auction House Leicestershire',
  auctionhousemidlands: 'Auction House Midlands',
  auctionhousecoventry: 'Auction House Coventry & Warwickshire',
  auctionhousenottsandderby: 'Auction House Notts & Derby',
  auctionhousechesterfield: 'Auction House Chesterfield & N Derbyshire',
  auctionhousestaffordshire: 'Auction House Cheshire, Staffs & Shropshire',
  auctionhousenorthwales: 'Auction House North Wales',
  auctionhousesouthwest: 'Auction House South West',
  auctionhousenorthernireland: 'Auction House Northern Ireland',
  auctionhousenational: 'Auction House National',
  sarahmains: 'Sarah Mains / Auction Works',
  sageandco: 'Sage & Co Auctions',
  auctiontrade: 'Auction Trade',
  brggibson: 'BRG Gibson Belfast',
  higginsdrysdale: 'Higgins Drysdale',
  martinpole: 'Martin Pole Auctions',
  jonespeckover: 'Jones Peckover',
  thepropertyauctionhouse: 'The Property Auction House',
  propertyauctionagent: 'Property Auction Agent',
  lot9: 'Lot9 Auctions',
  auctionnorth: 'Auction North',
  bowensonandwatson: 'Bowen Son & Watson',
  sheldonbosley: 'Sheldon Bosley Knight',
  nationalpropertyauctions: 'National Property Auctions',
  // ── Regional/independent houses (batch 6, March 2026) ──
  underthehammer: 'Under The Hammer',
  lsk: 'Lacy Scott & Knight',
  foxandsons: 'Fox & Sons Auctions',
  bagshaws: 'Bagshaws Auctions',
  wilsons: 'Wilsons Auctions',
  strakers: 'Strakers',
  johnpye: 'John Pye Property',
  // ── Batch 7 (March 2026) ──
  symondsandsampson: 'Symonds & Sampson',
  stags: 'Stags',
  lsh: 'Lambert Smith Hampton',
  carterjonas: 'Carter Jonas',
  gth: 'Greenslade Taylor Hunt',
  halls: 'Halls',
  walkersingleton: 'Walker Singleton',
  driversnorris: 'Drivers & Norris',
  shonkibros: 'Shonki Brothers',
  robinjessop: 'Robin Jessop',
  cleetompkinson: 'Clee Tompkinson & Francis',
  mccartneys: 'McCartneys',
  bramleys: 'Bramleys',
  cooperandtanner: 'Cooper & Tanner',
  brutonknowles: 'Bruton Knowles',
  fisherGerman: 'Fisher German',
  woolleyandwallis: 'Woolley & Wallis',
  hobbsparker: 'Hobbs Parker',
  arnoldskeys: 'Arnolds Keys',
  twgaze: 'TW Gaze',
  hairandson: 'Hair & Son',
  phillipssmithanddunn: 'Phillips Smith & Dunn',
  webbers: 'Webbers',
  ahlondon: 'Auction House London EIG',
  starpropertyonline: 'Star Property Online',
  brggibsondublin: 'BRG Gibson Dublin',
  // ── Batch 8 (March 2026) ──
  propertysolvers: 'Property Solvers', pugh: 'Pugh Auctions',
  markjenkinson: 'Mark Jenkinson', regionalauctioneers: 'Regional Property Auctioneers',
  clarkegammon: 'Clarke Gammon', nesbits: 'Nesbits', pearsons: 'Pearsons',
  foxgrant: 'Fox Grant', lextons: 'Lextons',
  bradleysdevon: 'Bradleys', taylerandfletcher: 'Tayler & Fletcher',
  luscombemaye: 'Luscombe Maye', lodgeandthomas: 'Lodge & Thomas',
  bondoxboroughphillips: 'Bond Oxborough Phillips', charlesdarrow: 'Charles Darrow',
  aldreds: 'Aldreds', humberts: 'Humberts',
  allwalesauction: 'All Wales Auction', evansbros: 'Evans Bros',
  herbertrthomasandco: 'Herbert R Thomas', johnfrancis: 'John Francis',
  morrismarshall: 'Morris Marshall & Poole',
  andrewgrant: 'Andrew Grant', gherbertbanks: 'G Herbert Banks',
  hawkesford: 'Hawkesford', howkinsandharrison: 'Howkins & Harrison',
  scargillmann: 'Scargill Mann',
  mellerbraggins: 'Meller Braggins', smithandsons: 'Smith & Sons',
  wrightmarshall: 'Wright Marshall',
  hackneyandleigh: 'Hackney & Leigh',
  onlinepropertyauctionsscotland: 'Online Property Auctions Scotland',
  // ── GOTO Properties platform (April 2026) ──
  purplebricksgoto: 'Purplebricks (GOTO Properties)',
  // ── Verified EIG subdomains (April 2026) ──
  groundrentauctions: 'Ground Rent Auctions',
  benjaminstevens: 'Benjamin Stevens Auctions',
  // ── New houses from own websites (April 2026) ──
  auctionhammermidlands: 'Auction Hammer Midlands',
  sharpesauctions: 'Sharpes Auctions',
  jjmorris: 'JJ Morris',
  rendells: 'Rendells',
  pearsonferrier: 'Pearson Ferrier',
};

function getHouseDisplayName(slug, url) {
  if (HOUSE_DISPLAY_NAMES[slug]) return HOUSE_DISPLAY_NAMES[slug];
  if (slug === 'unknown' && url) {
    try {
      const hostname = new URL(url).hostname.replace('www.', '');
      return hostname.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    } catch { /* fall through */ }
  }
  return 'Auction';
}

// ═══════════════════════════════════════════════════════════════
// URL REWRITING (map user-friendly URLs to data endpoints)
// ═══════════════════════════════════════════════════════════════
async function rewriteUrl(url, house) {
  const u = url.toLowerCase();

  if (house === 'savills') {
    // Savills: auctions.savills.co.uk/auctions/{slug} — server-rendered, paginated
    if (u.includes('auctions.savills.co.uk/auctions/')) {
      return { baseUrl: url, isApi: false, paginateAs: 'savills_pages', preferPuppeteer: true };
    }
    // Generic URL (e.g. /upcoming-auctions) — auto-discover the nearest catalogue
    try {
      const resp = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      if (resp.ok) {
        const html = await resp.text();
        // Find links to specific auction catalogue pages
        const catalogueLinks = [...html.matchAll(/href="(https:\/\/auctions\.savills\.co\.uk\/auctions\/[^"]+)"/gi)];
        if (catalogueLinks.length > 0) {
          const catalogueUrl = catalogueLinks[0][1];
          console.log(`Savills: auto-discovered catalogue ${catalogueUrl} from ${url}`);
          return { baseUrl: catalogueUrl, isApi: false, paginateAs: 'savills_pages', preferPuppeteer: true };
        }
      }
    } catch (e) { console.log('Savills discovery failed:', e.message); }
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'allsop') {
    // Allsop: rewrite catalogue pages to their JSON API
    if (u.includes('residential-auction') || u.includes('lot_type=residential') || u.includes('/insights/') || u.includes('auction-catalogue')) {
      return { 
        baseUrl: 'https://www.allsop.co.uk/api/property-search?available_only=true&lot_type=residential&page=1&react',
        isApi: true,
        paginateAs: 'allsop_api'
      };
    }
    if (u.includes('commercial-auction') || u.includes('lot_type=commercial')) {
      return {
        baseUrl: 'https://www.allsop.co.uk/api/property-search?available_only=true&lot_type=commercial&page=1&react',
        isApi: true,
        paginateAs: 'allsop_api'
      };
    }
    // If it's the property-search API URL already, use it directly
    if (u.includes('/api/property-search')) {
      return { baseUrl: url, isApi: true, paginateAs: 'allsop_api' };
    }
  }

  if (house === 'sdl') {
    // SDL / BTG Eddisons: JS-rendered with pagination (?page=2, ?page=3 etc)
    // Handles both btgeddisonspropertyauctions.com and sdlauctions.co.uk
    if (u.includes('btgeddisonspropertyauctions.com/properties') || u.includes('sdlauctions.co.uk')) {
      return { baseUrl: url, isApi: false, paginateAs: 'sdl_pages', preferPuppeteer: true };
    }
    if (u.includes('/auction/')) {
      return { baseUrl: url, isApi: false, paginateAs: 'sdl_pages', preferPuppeteer: true };
    }
    if (u.includes('/search')) {
      return { baseUrl: url, isApi: false, paginateAs: 'sdl_pages', preferPuppeteer: true };
    }
  }

  if (house === 'pugh') {
    // Pugh: server-rendered Laravel, paginated with ?page=N, 20 lots/page
    // Use preferPuppeteer path so DOM extractor is tried first (avoids Gemini waste)
    // scrapeRenderedPage will fall back to plain HTTP since it's server-rendered
    return { baseUrl: url, isApi: false, paginateAs: 'pugh_pages', preferPuppeteer: true };
  }

  if (house === 'bondwolfe') {
    // Bond Wolfe: /auctions/properties/ or /auction/3448/ → JS-rendered, needs Puppeteer
    if (u.includes('/auction/') || u.includes('/auctions/properties')) {
      return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
    }
  }

  if (house === 'network') {
    // Network Auctions: server-rendered HTML with lot data, DOM extractor works well
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'pattinson') {
    // Pattinson: React SPA, needs Puppeteer to render. DOM extractor handles bid cards.
    // Falls back to Claude automatically if DOM extraction returns <3 lots.
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'barnardmarcus') {
    // Barnard Marcus: server-rendered but DOM extractor works better with Puppeteer
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'auctionhouselondon') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'cliveemson') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'strettons') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'auctionhouse') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'acuitus') {
    // Acuitus: /find-a-property/ — may need Puppeteer
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'hollismorgan') {
    // Use the URL as-is — calendar or user provides the correct ?bid= param for each auction.
    // Falls back to root listing page if no specific auction URL given.
    const baseUrl = u.includes('search-auction') ? url : (HOUSE_ROOTS.hollismorgan + '?orderby=lot_no+asc');
    return { baseUrl, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'maggsandallen') {
    // Use the URL as-is — calendar or user provides the correct ?auction= param.
    // Falls back to root listing page if no specific auction URL given.
    const baseUrl = u.includes('search-auction') ? url : (HOUSE_ROOTS.maggsandallen + '?orderby=lot_no&n=0');
    return { baseUrl, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'mchughandco') {
    // McHugh & Co: /pages/auctions or /Auctions/LotList.aspx — may need Puppeteer
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'probateauction') {
    // Probate Auction: WordPress with Swiper galleries, property-list-card containers
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'knightfrank') {
    // Knight Frank: JS-rendered SPA, loads lots via AJAX. Needs Puppeteer.
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  // buttersjohnbee removed — PDF-only catalogues

  // ── New houses ──
  // Countrywide: static HTML
  if (house === 'countrywide') {
    return { baseUrl: url, isApi: false, paginateAs: null };
  }
  // Sutton Kersh: static HTML gallery with start=N pagination
  if (house === 'suttonkersh') {
    return { baseUrl: url, isApi: false, paginateAs: 'suttonkersh_pages', preferPuppeteer: false };
  }
  // Venmore: static HTML, pagination via ?pageNum=N
  if (house === 'venmore') {
    return { baseUrl: url, isApi: false, paginateAs: null };
  }
  // TCPA: EIG platform, static HTML, pagination via ?page=N
  if (house === 'tcpa') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Future Property Auctions: ASP, static HTML, pagination via ?offset=N
  if (house === 'futureauctions') {
    return { baseUrl: url, isApi: false, paginateAs: null };
  }
  // Kivells: static HTML, pagination via ?pagenum=N
  if (house === 'kivells') {
    return { baseUrl: url, isApi: false, paginateAs: null };
  }
  // First For Auctions: EIG platform, needs Puppeteer
  if (house === 'firstforauctions') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Harman Healy: EIG platform, needs Puppeteer
  if (house === 'harmanhealy') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Seel & Co: EIG platform, needs Puppeteer. showall=true loads all lots
  if (house === 'seelauctions') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Paul Fosh: EIG online auctions platform, needs Puppeteer
  if (house === 'paulfosh') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Cottons: EIG embed via current-auction.htm, needs Puppeteer to render the JS embed
  if (house === 'cottons') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Dedman Gray: EIG embed (tenant 33), JS-rendered table layout, needs Puppeteer
  if (house === 'dedmangray') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Landwood: EIG OAS platform (tenant 188), /current-auction redirects to /future-auctions/
  if (house === 'landwood') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Robinson & Hall: WordPress/Elementor, needs Puppeteer
  if (house === 'robinsonhall') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  // ── New EIG houses (March 2026 batch) ──
  if (house === 'astleys') {
    return { baseUrl: 'https://astleys.eigonlineauctions.com/search', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'henrysykes') {
    return { baseUrl: 'https://onlineauctions.henrysykes.co.uk/search', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'clarkesimpson') {
    return { baseUrl: 'https://clarke-simpson.eigonlineauctions.com/search', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'durrants') {
    return { baseUrl: 'https://durrants.com/property-auctions/next-property-auction', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'dawsons') {
    return { baseUrl: 'https://www.dawsonsproperty.co.uk/auctions.php', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'goldings') {
    return { baseUrl: 'https://www.goldingsauctions.co.uk/auctions/next-auction/', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Auction House UK branches
  if (house === 'auctionhousescotland') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/scotland/auction/search-results', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'austingray') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/sussexandhampshire', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  // Auction House UK batch 4 branches
  if (house === 'auctionhousedevon') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/devonandcornwall/auction/search-results', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'auctionhouseeastmidlands') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/eastmidlands/auction/search-results', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'auctionhousewestmidlands') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/westmidlands/auction/search-results', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'auctionhouseessex') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/essex/auction/search-results', isApi: false, paginateAs: null, preferPuppeteer: true };
  }
  if (house === 'auctionhousemanchester') {
    return { baseUrl: 'https://www.auctionhouse.co.uk/manchester/auction/search-results', isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  // Symonds & Sampson: WebDadi two-tier — events page lists auctions, each links to lot listings
  // The event detail pages serve lot data in static HTML (FeaturedGrid cards)
  if (house === 'symondsandsampson') {
    // Auto-discover the nearest upcoming event page with lots
    const eventsUrl = HOUSE_ROOTS.symondsandsampson || url;
    const origin = new URL(eventsUrl).origin;
    // Broader regex: match /event/ or /events/ links containing "auction" or "property"
    const eventPatterns = [
      /href="(\/event\/[^"]*auction[^"]*)"/gi,
      /href="(\/events\/[^"]*auction[^"]*)"/gi,
      /href="(\/event\/property[^"]*)"/gi,
    ];
    // Try plain HTTP first (WebDadi events pages are usually server-rendered)
    let discoveredUrl = null;
    try {
      const resp = await fetch(eventsUrl, { headers: HEADERS, redirect: 'follow' });
      if (resp.ok) {
        const html = await resp.text();
        for (const pattern of eventPatterns) {
          const matches = [...html.matchAll(pattern)];
          if (matches.length > 0) {
            discoveredUrl = origin + matches[0][1];
            break;
          }
        }
        // Also check for FeaturedGrid on the events page itself (lots may be directly on this page)
        if (!discoveredUrl && html.includes('FeaturedGrid')) {
          console.log('Symonds: events page itself contains FeaturedGrid — using directly');
          return { baseUrl: eventsUrl, isApi: false, paginateAs: null, preferPuppeteer: true };
        }
      }
    } catch (e) { console.log('Symonds plain HTTP discovery failed:', e.message); }
    // Fallback: try Firecrawl-based discovery (in case events page needs JS rendering)
    if (!discoveredUrl && FIRECRAWL_API_KEY && !fcCreditExhausted) {
      try {
        const fcResult = await scrapeWithFirecrawl(eventsUrl, { formats: ['rawHtml'], waitFor: 5000 });
        if (fcResult.html) {
          for (const pattern of eventPatterns) {
            const matches = [...fcResult.html.matchAll(pattern)];
            if (matches.length > 0) {
              discoveredUrl = origin + matches[0][1];
              break;
            }
          }
          if (!discoveredUrl && fcResult.html.includes('FeaturedGrid')) {
            console.log('Symonds: Firecrawl events page contains FeaturedGrid — using directly');
            return { baseUrl: eventsUrl, isApi: false, paginateAs: null, preferPuppeteer: true };
          }
        }
      } catch (e) { console.log('Symonds Firecrawl discovery failed:', e.message); }
    }
    if (discoveredUrl) {
      console.log(`Symonds: auto-discovered event page ${discoveredUrl}`);
      return { baseUrl: discoveredUrl, isApi: false, paginateAs: null, preferPuppeteer: true };
    }
    console.log('Symonds: no event page discovered, using root URL');
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  // Stags / GTH / Clee Tompkinson: Homeflow SPA — needs JS rendering + extended wait for SPA hydration
  // Homeflow loads property cards via AJAX after page load. Standard scroll+wait actions aren't enough.
  // Custom actions: long initial wait for SPA hydration, then poll for property cards, then scroll for images.
  if (house === 'stags' || house === 'gth' || house === 'cleetompkinson') {
    const homeflowActions = [
      { type: 'wait', milliseconds: 5000 },
      // Trigger any deferred search by scrolling into view — Homeflow often lazy-inits on scroll
      { type: 'scroll', direction: 'down' },
      { type: 'wait', milliseconds: 3000 },
      // Poll for property cards to appear (Homeflow AJAX may take a while)
      { type: 'executeJavascript', script: `
        await new Promise(resolve => {
          let attempts = 0;
          const check = () => {
            const cards = document.querySelectorAll('.property-results-list li, .property-card, [class*="PropertyCard"], [class*="property-result"]');
            if (cards.length > 0 || attempts++ > 20) return resolve();
            setTimeout(check, 500);
          };
          check();
        });
      ` },
      { type: 'scroll', direction: 'down' },
      { type: 'wait', milliseconds: 1500 },
      { type: 'scroll', direction: 'down' },
      { type: 'wait', milliseconds: 1500 },
      // Force lazy-loaded images
      { type: 'executeJavascript', script: `document.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]').forEach(img => { const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original'); if (src && !img.getAttribute('src')?.startsWith('http')) img.setAttribute('src', src); });` },
      { type: 'scroll', direction: 'up' },
      { type: 'scroll', direction: 'up' },
      { type: 'scroll', direction: 'up' },
    ];
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true, waitFor: 12000, actions: homeflowActions };
  }

  // Robin Jessop: StackProtect reCAPTCHA v3 blocks all automated requests.
  // Firecrawl and Puppeteer both fail. Skip to save credits — revisit if StackProtect is removed.
  if (house === 'robinjessop') {
    console.log(`${house}: skipped — StackProtect reCAPTCHA blocks all automated scraping`);
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true, waitFor: 8000, blocked: true };
  }

  // Hunters: Bamboo Auctions React SPA, needs Puppeteer
  if (house === 'hunters') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  // GOTO Properties / Purplebricks: EIG platform, server-rendered, paginated (?page=N, 48/page)
  if (house === 'purplebricksgoto') {
    return { baseUrl: url, isApi: false, paginateAs: 'pugh_pages', preferPuppeteer: false };
  }

  // Unknown houses: prefer Puppeteer since most modern auction sites are JS-rendered
  if (house === 'unknown') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  // Known houses without specific rewrite rules — static HTML works for these
  return { baseUrl: url, isApi: false, paginateAs: null };
}

// ═══════════════════════════════════════════════════════════════
// SCRAPING
// ═══════════════════════════════════════════════════════════════
async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function scrapeAllPages(baseUrl, house) {
  const pages = [];
  const html1 = await fetchPage(baseUrl);
  pages.push({ page: 1, html: html1 });
  const totalPages = detectTotalPages(html1, baseUrl, house);
  const pageCap = Math.min(totalPages, MAX_PAGES);
  for (let pg = 2; pg <= pageCap; pg++) {
    const pageUrl = buildPageUrl(baseUrl, pg, house);
    try {
      const html = await fetchPage(pageUrl);
      if (html.length > 1000) { pages.push({ page: pg, html }); }
      else { break; }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) { break; }
  }
  if (totalPages > MAX_PAGES) console.log(`${house} pagination cap reached at ${MAX_PAGES} pages`);
  return pages;
}

// Allsop JSON API pagination
async function scrapeAllsopApi(baseUrl) {
  const pages = [];
  for (let pg = 1; pg <= MAX_PAGES; pg++) {
    const pageUrl = baseUrl.replace(/page=\d+/, `page=${pg}`);
    try {
      const html = await fetchPage(pageUrl);
      if (html.length < 100 || html.includes('"data":[]') || html.includes('"template":"404"')) {
        console.log(`Allsop API: page ${pg} empty, stopping`);
        break;
      }
      pages.push({ page: pg, html });
      console.log(`Allsop API: got ${html.length} chars from page ${pg}`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.log(`Allsop API: page ${pg} failed: ${e.message}`);
      break;
    }
  }
  return pages;
}

// Parse Allsop JSON API pages directly into lot objects (bypasses Gemini entirely)
function extractAllsopLotsFromJson(pages) {
  _lastExtractorUsed = 'api';
  const lots = [];
  const seen = new Set();
  for (const p of pages) {
    try {
      const json = JSON.parse(p.html);
      const results = json?.data?.results || json?.results || [];
      for (const item of results) {
        const ref = item.reference || '';
        if (seen.has(ref) && ref) continue;
        if (ref) seen.add(ref);

        // Address — allsop_address is most complete, fall back to address1+postcode
        const address = (item.allsop_address ||
          [item.address1, item.address2, item.address3, item.county, item.postcode].filter(Boolean).join(', ')
        ).trim();
        if (!address || address.length < 3) continue;

        // Lot number — API doesn't provide lot numbers, use positional
        const lotNum = lots.length + 1;

        // Price — numeric string like "19117000.00" or null
        let price = null;
        const priceText = item.price || item.price_description || '';
        const pm = String(priceText).replace(/,/g, '').match(/(\d+)/);
        if (pm) price = parseInt(pm[1]);

        // URL — construct from reference
        const slug = (address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')).substring(0, 60);
        const url = ref ? `https://www.allsop.co.uk/lot-overview/${slug}/${ref}`
                       : `https://www.allsop.co.uk/find-a-property/`;

        // Image — S3 bucket pattern
        let imageUrl = '';
        const imgId = item.image_file_id;
        if (imgId) {
          imageUrl = `https://as-prod-bau-object-storage.s3.eu-west-2.amazonaws.com/image_cache/${imgId}---auto--.jpg`;
        }

        // Bullets — property types, status, byline
        const bullets = [];
        if (item.property_types && item.property_types.length > 0) {
          bullets.push(item.property_types.join(', '));
        }
        if (item.sales_status && item.sales_status !== 'For Sale') {
          bullets.push(item.sales_status.toUpperCase());
        }
        if (item.price_description) bullets.push(item.price_description);
        if (item.department) bullets.push(item.department === 'RES' ? 'Residential' : item.department === 'COM' ? 'Commercial' : item.department);

        lots.push({
          lot: lotNum,
          address,
          price,
          url,
          imageUrl: imageUrl || undefined,
          bullets,
          reference: ref,
          allsopPropertyId: item.allsop_property_id || item.property_id,
          propType: (item.property_types || [])[0] || undefined,
        });
      }
    } catch (e) {
      console.log(`Allsop JSON parse error on page ${p.page}: ${e.message}`);
    }
  }
  console.log(`Allsop direct JSON extraction: ${lots.length} lots from ${pages.length} pages`);
  return lots;
}

// Enrich Allsop lots with reference and image data from raw API JSON
function enrichAllsopLots(lots, pages) {
  // Parse all API results from raw JSON pages
  const apiItems = [];
  for (const p of pages) {
    try {
      const json = JSON.parse(p.html);
      const results = json?.data?.results || [];
      apiItems.push(...results);
    } catch {}
  }
  if (apiItems.length === 0) return;

  // Build lookup by postcode (most reliable match field)
  const byPostcode = {};
  for (const item of apiItems) {
    const pc = (item.postcode || '').trim().toUpperCase();
    if (pc) {
      if (!byPostcode[pc]) byPostcode[pc] = [];
      byPostcode[pc].push(item);
    }
  }

  // Track which API items have been matched to prevent double-matching
  const usedApiIds = new Set();

  let matched = 0;
  for (const lot of lots) {
    let match = null;

    // Strategy 1: Match by postcode (most reliable)
    const pcMatch = (lot.address || '').match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
    if (pcMatch) {
      // Normalise postcode: "EC4A3DQ" -> "EC4A 3DQ"
      const rawPc = pcMatch[0].toUpperCase().replace(/\s+/g, '');
      const lotPc = rawPc.slice(0, -3) + ' ' + rawPc.slice(-3);
      const candidates = (byPostcode[lotPc] || byPostcode[rawPc] || []).filter(c => !usedApiIds.has(c.property_id));
      // If only one property at this postcode, it's a match
      match = candidates.length === 1 ? candidates[0] : null;
      // If multiple, try matching by address text
      if (!match && candidates.length > 1) {
        const lotAddr = (lot.address || '').toLowerCase();
        match = candidates.find(c => {
          const apiAddr = (c.allsop_address || c.address1 || '').toLowerCase();
          return lotAddr.includes(apiAddr.split(',')[0]) || apiAddr.includes(lotAddr.split(',')[0]);
        });
      }
    }

    // Strategy 2: Fuzzy address match across ALL API items (for lots without postcodes)
    if (!match) {
      const lotAddr = (lot.address || '').toLowerCase().replace(/[,.\s]+/g, ' ').trim();
      if (lotAddr.length > 5) {
        // Extract street number + name for matching
        const streetMatch = lotAddr.match(/(\d+[a-z]?)\s+(\w+)/);
        if (streetMatch) {
          const streetNum = streetMatch[1];
          const streetWord = streetMatch[2];
          match = apiItems.find(c => {
            if (usedApiIds.has(c.property_id)) return false;
            const apiAddr = (c.allsop_address || c.address1 || '').toLowerCase();
            return apiAddr.includes(streetNum) && apiAddr.includes(streetWord);
          });
        }
        // Try matching by first significant word in both addresses
        if (!match) {
          match = apiItems.find(c => {
            if (usedApiIds.has(c.property_id)) return false;
            const apiAddr = (c.allsop_address || c.address1 || '').toLowerCase().replace(/[,.\s]+/g, ' ').trim();
            // Both addresses must share at least the first meaningful segment
            const lotFirst = lotAddr.split(' ').filter(w => w.length > 2).slice(0, 3).join(' ');
            const apiFirst = apiAddr.split(' ').filter(w => w.length > 2).slice(0, 3).join(' ');
            return lotFirst.length > 5 && apiFirst.length > 5 &&
              (lotAddr.includes(apiFirst) || apiAddr.includes(lotFirst));
          });
        }
      }
    }

    if (match) {
      usedApiIds.add(match.property_id);
      lot.reference = match.reference;
      lot.allsopPropertyId = match.allsop_property_id;
      lot.imageFileId = match.image_file_id;
      // Construct image URL from image_file_id
      if (match.image_file_id && !lot.imageUrl) {
        lot.imageUrl = `https://as-prod-bau-object-storage.s3.eu-west-2.amazonaws.com/image_cache/${match.image_file_id}---auto--.jpg`;
      }
      matched++;
    }
  }
  console.log(`Allsop enrichment: matched ${matched}/${lots.length} lots with API data`);
}

function detectTotalPages(html, url, house) {
  const pageMatches = [...html.matchAll(/page[=-](\d+)/gi)];
  if (pageMatches.length > 0) return Math.max(...pageMatches.map(m => parseInt(m[1])));
  const ofMatch = html.match(/page\s+\d+\s+of\s+(\d+)/i);
  if (ofMatch) return parseInt(ofMatch[1]);
  const numMatches = [...html.matchAll(/<a[^>]*>\s*(\d{1,3})\s*<\/a>/g)];
  const nums = numMatches.map(m => parseInt(m[1])).filter(n => n >= 2 && n <= 100);
  if (nums.length) return Math.max(...nums);
  return 1;
}

function buildPageUrl(baseUrl, page, house) {
  const clean = baseUrl.replace(/\/page[-=]\d+/i, '').replace(/[?&]page=\d+/i, '');
  switch (house) {
    case 'savills': return `${clean}/page-${page}`;
    case 'allsop': return `${clean}?page=${page}`;
    case 'sdl': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'pugh': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'network': return `${clean}?page=${page}`;
    case 'bondwolfe': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'barnardmarcus': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'acuitus': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    // ── New houses (pagination) ──
    case 'agentsproperty': return `${clean.replace(/\/page\/\d+\/?/, '')}/page/${page}/`;
    case 'suttonkersh': {
      const skClean = clean.replace(/[?&]start=\d+/i, '');
      const offset = (page - 1) * 16;
      return skClean.includes('?') ? `${skClean}&start=${offset}` : `${skClean}?start=${offset}`;
    }
    case 'buttersjohnbee': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'brownco': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'purplebricksgoto': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'iamsold': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'andrewcraig': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    default:
      if (baseUrl.includes('/page-')) return `${clean}/page-${page}`;
      return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// PUPPETEER SCRAPING (for JS-rendered sites)
// ═══════════════════════════════════════════════════════════════
let browserInstance = null;
let browserUseCount = 0;
const BROWSER_MAX_USES = 10;
const MAX_CONCURRENT_PAGES = 3;
let activePagesCount = 0;

async function acquirePage() {
  if (!puppeteer) throw new Error('Puppeteer not available');
  // Wait for a slot if at max concurrency
  while (activePagesCount >= MAX_CONCURRENT_PAGES) {
    await new Promise(r => setTimeout(r, 500));
  }
  activePagesCount++;
  let browser, page;
  try {
    browser = await getBrowser();
    page = await browser.newPage();
  } catch (err) {
    activePagesCount = Math.max(0, activePagesCount - 1);
    throw new Error(`Puppeteer page creation failed: ${err.message}`);
  }
  const origClose = page.close.bind(page);
  page.close = async () => { activePagesCount = Math.max(0, activePagesCount - 1); return origClose(); };
  return page;
}

async function getBrowser() {
  if (!puppeteer) throw new Error('Puppeteer not available');
  // Restart browser after N uses to prevent memory bloat
  if (browserInstance && browserUseCount >= BROWSER_MAX_USES) {
    console.log(`Puppeteer: recycling browser after ${browserUseCount} uses`);
    try { await browserInstance.close(); } catch (e) { /* ignore */ }
    browserInstance = null;
    browserUseCount = 0;
  }
  if (browserInstance && browserInstance.isConnected()) {
    browserUseCount++;
    return browserInstance;
  }
  browserInstance = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
    ],
  });
  browserUseCount = 1;
  return browserInstance;
}

async function scrapeWithPuppeteer(url, house) {
  const pages = [];
  try {
    const page = await acquirePage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.setViewport({ width: 1280, height: 900 });

    // Block images/fonts/media to speed up loading
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) req.abort();
      else req.continue();
    });

    console.log(`Puppeteer: loading ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

    // Wait a bit more for dynamic content to render
    await new Promise(r => setTimeout(r, 3000));

    // Scroll down to trigger lazy loading
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 800));
      }
      window.scrollTo(0, 0);
    });

    await new Promise(r => setTimeout(r, 2000));

    const html = await page.content();
    pages.push({ page: 1, html });
    console.log(`Puppeteer: got ${html.length} chars from page 1`);

    // Check for pagination and scrape more pages
    const totalPages = detectTotalPages(html, url, house);
    const puppeteerPageCap = Math.min(totalPages, MAX_PUPPETEER_PAGES);
    for (let pg = 2; pg <= puppeteerPageCap; pg++) {
      try {
        const pageUrl = buildPageUrl(url, pg, house);
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));

        // Scroll to trigger lazy loading
        await page.evaluate(async () => {
          for (let i = 0; i < 3; i++) {
            window.scrollBy(0, window.innerHeight);
            await new Promise(r => setTimeout(r, 600));
          }
        });
        await new Promise(r => setTimeout(r, 1500));

        const pgHtml = await page.content();
        if (pgHtml.length > 2000) {
          pages.push({ page: pg, html: pgHtml });
          console.log(`Puppeteer: got ${pgHtml.length} chars from page ${pg}`);
        } else { break; }
      } catch (e) {
        console.log(`Puppeteer: page ${pg} failed: ${e.message}`);
        break;
      }
    }
    if (totalPages > MAX_PUPPETEER_PAGES) console.log(`${house} pagination cap reached at ${MAX_PUPPETEER_PAGES} pages`);

    await page.close();
  } catch (err) {
    console.error(`Puppeteer scrape failed: ${err.message}`);
  }
  return pages;
}

// ═══════════════════════════════════════════════════════════════
// AI EXTRACTION (Gemini)
// ═══════════════════════════════════════════════════════════════
async function extractLotsWithAI(pages, house, onProgress, catalogueUrl) {
  _lastExtractorUsed = 'gemini';
  const extractionTier = house === 'unknown' ? 'capable' : 'fast';
  _lastAITier = extractionTier;
  const allLots = [];
  const seenLots = new Set();
  const batchSize = 3;
  for (let i = 0; i < pages.length; i += batchSize) {
    if (creditExhausted) { console.log('Skipping remaining batches — API rate limited'); break; }
    if (allLots.length >= MAX_LOTS_PER_SCRAPE) { console.log(`${house} lots cap reached at ${MAX_LOTS_PER_SCRAPE}`); break; }
    const batch = pages.slice(i, i + batchSize);
    // Prefer markdown for AI extraction when available (Gemini handles it natively)
    const strippedBatch = batch.map(p => ({
      page: p.page,
      content: (p.markdown && p.markdown.length > 200) ? p.markdown : stripHtml(p.html),
      usedMarkdown: !!(p.markdown && p.markdown.length > 200)
    }));
    const totalStrippedLen = strippedBatch.reduce((sum, p) => sum + p.content.length, 0);
    const mdCount = strippedBatch.filter(p => p.usedMarkdown).length;
    const hint = HOUSE_EXTRACTION_HINTS[house];
    console.log(`Batch ${Math.floor(i/batchSize)+1}: ${strippedBatch.length} page(s), ${totalStrippedLen} chars${mdCount > 0 ? ` (${mdCount} from markdown)` : ' after stripping'}, tier: ${extractionTier}`);
    const prompt = `You are extracting property auction lot data from a UK auction house catalogue (${house}).
${hint ? `\nStructure hint: ${hint}\n` : ''}
Below are ${strippedBatch.length} page(s) of catalogue content. Extract EVERY auction lot you find.

For each lot, return a JSON object with these fields:
- lot: number (the lot number)
- address: string (full address including postcode)
- price: number or null (guide price in pounds, null if TBA/not stated)
- url: string (detail page URL if found, empty string if not)
- tenure: string or null — one of "Freehold", "Leasehold", "Share of Freehold", or null. Look for: freehold, leasehold, share of freehold, flying freehold, long leasehold, years remaining/unexpired. If not explicitly stated, infer from context (e.g. "125 year lease" = Leasehold, ground rent mentioned = Leasehold). Only return null if there is genuinely no indication.
- beds: number or null — number of bedrooms. Extract from descriptions like "3 bed", "three bedroom", "studio" (=0). For multi-unit properties, total beds across all units. null if not stated.
- status: string — one of "available", "sold", "unsold", "stc", "withdrawn". Default "available" if not stated. "unsold" means the auction took place but the lot did not sell (no bids met the reserve). Look for: SOLD, STC, Sale Agreed, Withdrawn, Under Offer, Prior to Auction, UNSOLD, Not Sold, Passed, No Sale.
- bullets: array of strings (key features/description points - condition, sq ft, special circumstances etc)

Return ONLY a JSON array of lot objects, no other text. If a page has no lots, return an empty array.

Important:
- Extract the COMPLETE address including postcode
- Guide prices may be shown as "Guide Price £X" or "Guide £X" or just "£X"
- Tenure is a PRIORITY field — always look for it in the description, legal pack summary, and property details
- Beds is a PRIORITY field — always look for bedroom count in the title, description, or property details. "2/3 bed" should return 3 (maximum). "Studio" = 0.
- Status field: check for sold/STC/withdrawn markers, badges, labels, or overlays on the lot listing. "Unsold" or "Not Sold" or "Passed" means the auction happened but the lot didn't sell — these are distinct from "available" (not yet auctioned).
- Bullet points include things like: property type, condition, sq ft, vacant/tenanted, executor sale, development potential, completion terms
- Include ALL lots, even commercial ones or land

${strippedBatch.map(p => `=== PAGE ${p.page} ===\n${p.content}`).join('\n\n')}

Return ONLY the JSON array:`;
    try {
      apiCallCount++;
      const text = await callAI(prompt, { tier: extractionTier, maxTokens: 16000, taskType: 'extraction' });
      log.info('ai_extraction', { house, tier: extractionTier, batch: Math.floor(i/batchSize)+1 });
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const lots = JSON.parse(jsonMatch[0]);
        for (const lot of lots) {
          if (!lot.lot) continue;
          // Deduplicate by lot number AND by normalised address
          const addrKey = (lot.address || '').toLowerCase().replace(/[\s,]+/g, ' ').trim();
          if (seenLots.has(lot.lot) || (addrKey.length > 10 && seenLots.has(addrKey))) continue;
          seenLots.add(lot.lot);
          if (addrKey.length > 10) seenLots.add(addrKey);
          allLots.push({
            lot: lot.lot, address: lot.address || '',
            price: lot.price || null,
            priceText: lot.price ? `£${lot.price.toLocaleString()}` : 'TBA',
            url: lot.url || '', bullets: lot.bullets || [],
            status: lot.status || 'available',
          });
        }
      }
      if (onProgress) onProgress(Math.floor(i/batchSize)+1, Math.ceil(pages.length/batchSize), allLots.length);
    } catch (err) {
      console.error(`Gemini extraction failed for batch starting at page ${batch[0].page}:`, err.message);
      if (err.status === 429 || /quota|rate.limit|resource.exhausted/i.test(err.message)) {
        creditExhausted = true; creditExhaustedAt = Date.now();
        console.error('Gemini API rate limited — stopping all extraction');
        break;
      }
    }
  }
  // Resolve relative URLs to absolute using the catalogue URL as base
  if (catalogueUrl) {
    for (const lot of allLots) {
      if (lot.url && !/^https?:\/\//i.test(lot.url)) {
        try { lot.url = new URL(lot.url, catalogueUrl).href; } catch {}
      }
    }
  }
  return allLots;
}

// ═══════════════════════════════════════════════════════════════
// PDF EXTRACTION — Send PDF directly to Claude for lot extraction
// ═══════════════════════════════════════════════════════════════
function isPdfUrl(url) {
  return /\.pdf(\?|$|#)/i.test(url) || /content-type=application\/pdf/i.test(url);
}

async function extractLotsFromPdf(url) {
  log.info('pdf_download', { url });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let pdfBuffer;
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`PDF download failed: HTTP ${resp.status}`);
    pdfBuffer = Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    clearTimeout(timeout);
    throw new Error(`Couldn't download PDF: ${e.message}`);
  }

  const pdfBase64 = pdfBuffer.toString('base64');
  const sizeMB = (pdfBuffer.length / 1024 / 1024).toFixed(1);
  log.info('pdf_loaded', { sizeMB, bytes: pdfBuffer.length });

  // Gemini supports PDFs up to 20MB inline
  if (pdfBuffer.length > 20 * 1024 * 1024) {
    throw new Error('PDF is too large (over 20MB). Try a smaller catalogue.');
  }

  const allLots = [];
  const seenLots = new Set();

  const prompt = `You are extracting property auction lot data from a UK auction house catalogue PDF.

Extract EVERY auction lot you find in this PDF document.

For each lot, return a JSON object with these fields:
- lot: number (the lot number)
- address: string (full address including postcode)
- price: number or null (guide price in pounds, null if TBA/not stated)
- url: string (empty string — PDFs don't have lot URLs)
- tenure: string or null — one of "Freehold", "Leasehold", "Share of Freehold", or null. Look for: freehold, leasehold, share of freehold, flying freehold, long leasehold, years remaining/unexpired. If not explicitly stated, infer from context (e.g. "125 year lease" = Leasehold, ground rent mentioned = Leasehold). Only return null if there is genuinely no indication.
- beds: number or null — number of bedrooms. Extract from descriptions like "3 bed", "three bedroom", "studio" (=0). For multi-unit properties, total beds across all units. null if not stated.
- status: string — one of "available", "sold", "unsold", "stc", "withdrawn". Default "available" if not stated. "unsold" means the auction took place but the lot did not sell (no bids met the reserve). Look for: UNSOLD, Not Sold, Passed, No Sale.
- bullets: array of strings (key features/description points - condition, sq ft, special circumstances etc)

Return ONLY a JSON array of lot objects, no other text.

Important:
- Extract the COMPLETE address including postcode
- Guide prices may be shown as "Guide Price £X" or "Guide £X" or just "£X"
- Tenure is a PRIORITY field — always look for it in the description, legal pack summary, and property details
- Beds is a PRIORITY field — always look for bedroom count in the title, description, or property details. "2/3 bed" should return 3 (maximum). "Studio" = 0.
- Bullet points include things like: property type, condition, sq ft, vacant/tenanted, executor sale, development potential, completion terms
- Include ALL lots, even commercial ones or land
- Do NOT include terms & conditions, legal text, or non-lot pages

Return ONLY the JSON array:`;

  try {
    // PDFs always use Gemini capable tier (callAI forces Gemini when pdfBase64 is provided)
    const text = await callAI(prompt, { tier: 'capable', maxTokens: 32000, pdfBase64, taskType: 'extraction' });
    log.info('ai_pdf_extraction', { tier: 'capable' });
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const lots = JSON.parse(jsonMatch[0]);
      for (const lot of lots) {
        if (lot.lot && !seenLots.has(lot.lot)) {
          seenLots.add(lot.lot);
          allLots.push({
            lot: lot.lot, address: lot.address || '',
            price: lot.price || null,
            priceText: lot.price ? `£${lot.price.toLocaleString()}` : 'TBA',
            url: '', bullets: lot.bullets || [],
            status: lot.status || 'available',
          });
        }
      }
    }
    log.info('pdf_extracted', { lots: allLots.length });
  } catch (err) {
    log.error('pdf_extraction_failed', { error: err.message });
    throw new Error(`PDF extraction failed: ${err.message}`);
  }

  return allLots;
}

function stripHtml(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    // Remove common noise sections by class/id patterns
    .replace(/<div[^>]*class="[^"]*(?:testimonial|review|cookie|consent|modal|popup|newsletter|sidebar|social|share|footer|banner|advert)[^"]*"[\s\S]*?<\/div>/gi, '')
    .replace(/<section[^>]*class="[^"]*(?:testimonial|review|cookie|consent|modal|popup|newsletter)[^"]*"[\s\S]*?<\/section>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    // Remove repeated whitespace more aggressively
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/ \n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Allow up to 120k for large catalogues (Claude can handle it)
  if (text.length > 120000) text = text.substring(0, 120000);
  return text;
}

// ═══════════════════════════════════════════════════════════════
// LOT STATUS NORMALISATION
// ═══════════════════════════════════════════════════════════════
function normaliseLotStatuses(lots) {
  for (const lot of lots) {
    // Also re-check 'available' status against bullets — DOM extractors often push sold/stc
    // indicators into bullets without setting the status field, which then defaults to 'available'
    if (!lot.status || lot.status === 'available') {
      const bulletStr = (lot.bullets || []).join(' ');
      if (/\bUNSOLD\b|\bNOT.?SOLD\b|\bPASSED\b|\bNO.?SALE\b|\bAuction\s*Ended\b/i.test(bulletStr)) lot.status = 'unsold';
      else if (/\bSOLD\b/i.test(bulletStr)) lot.status = 'sold';
      else if (/\bSTC\b|\bSALE.?AGREED\b|\bUNDER.?OFFER\b/i.test(bulletStr)) lot.status = 'stc';
      else if (/\bWITHDRAWN\b|\bPOSTPONED\b/i.test(bulletStr)) lot.status = 'withdrawn';
      else lot.status = 'available';
    }
    // Normalise any non-standard values
    const s = (lot.status || '').toLowerCase().trim();
    if (/unsold|not.?sold|passed|no.?sale/i.test(s)) lot.status = 'unsold';
    else if (/sold/i.test(s) && !/stc|agreed/i.test(s)) lot.status = 'sold';
    else if (/stc|agreed|under.?offer/i.test(s)) lot.status = 'stc';
    else if (/withdrawn|postponed/i.test(s)) lot.status = 'withdrawn';
    else if (s !== 'sold' && s !== 'stc' && s !== 'withdrawn' && s !== 'unsold') lot.status = 'available';

    // ── Lease length from bullets (fallback when lot page enrichment misses it) ──
    if (lot.tenure === 'Leasehold' && !lot.leaseLength) {
      const bulletStr = (lot.bullets || []).join(' ').toLowerCase();
      const lm = bulletStr.match(/\b(\d{2,4})\s*(?:year|yr)s?\s*(?:remaining|unexpired|left|lease)\b/) ||
                 bulletStr.match(/lease\s*(?:length|term|remaining)?\s*:?\s*(\d{2,4})\s*(?:year|yr)s?\b/) ||
                 bulletStr.match(/\b(\d{2,4})\s*(?:year|yr)\s*lease\b/) ||
                 bulletStr.match(/(?:term|length)\s*(?:of)?\s*(\d{2,4})\s*(?:year|yr)s?\b/);
      if (lm) {
        const years = parseInt(lm[1], 10);
        if (years >= 1 && years <= 999) lot.leaseLength = years;
      }
    }
  }
  return lots;
}

// ═══════════════════════════════════════════════════════════════
// DOM EXTRACTORS - Per-house JS that runs inside Puppeteer
// Returns structured lot data directly, no Claude needed for extraction
// ═══════════════════════════════════════════════════════════════

// ── Image extraction helpers (embedded as string in DOM extractors) ──
// Provides getBestImgSrc(img) for lazy-load fallback chain and
// upgradeThumbnailUrl(url) for full-size image resolution.
// isJunkImage(url) filters out non-property images.
const IMG_HELPERS = `
  function getBestImgSrc(img) {
    if (!img) return '';
    return img.getAttribute('data-src')
      || img.getAttribute('data-lazy-src')
      || img.getAttribute('data-original')
      || img.getAttribute('src')
      || (img.getAttribute('srcset') ? img.getAttribute('srcset').split(',')[0].trim().split(/\\s+/)[0] : '')
      || '';
  }
  function getBackgroundImageUrl(el) {
    if (!el) return '';
    const style = el.getAttribute('style') || '';
    const m = style.match(/background(?:-image)?:\\s*url\\(['"]?([^'"\\)]+)/i);
    return (m && m[1] && !m[1].startsWith('data:')) ? m[1] : '';
  }
  function upgradeThumbnailUrl(url) {
    if (!url) return url;
    return url
      .replace(/\\/thumb\\//gi, '/large/')
      .replace(/\\/small\\//gi, '/medium/')
      .replace(/_thumb\\./gi, '.')
      .replace(/_tn\\./gi, '.')
      .replace(/[?&]w=\\d{2,3}(?=&|$)/gi, function(m) { return m.replace(/\\d+/, '800'); })
      .replace(/[?&]width=\\d{2,3}(?=&|$)/gi, function(m) { return m.replace(/\\d+/, '800'); });
  }
  function isJunkImage(src) {
    if (!src || src.length < 10 || src.startsWith('data:')) return true;
    return /logo|icon|nav|sprite|placeholder|arrow|spacer|pixel|\\.svg|facebook|twitter|linkedin|badge|spinner|loading|cookie|emoji|1x1|favicon|banner|advert|gavel|backdrop|generic[_-]?image|coming[_-]?soon/i.test(src);
  }
  function extractCardImage(card) {
    // Strategy 1: img with lazy-load attributes
    const imgs = card.querySelectorAll('img');
    for (const img of imgs) {
      const s = getBestImgSrc(img);
      if (!isJunkImage(s)) return upgradeThumbnailUrl(s);
    }
    // Strategy 2: background-image on card or child elements
    const bgEls = card.querySelectorAll('[style*="background"]');
    for (const el of bgEls) {
      const s = getBackgroundImageUrl(el);
      if (!isJunkImage(s)) return upgradeThumbnailUrl(s);
    }
    // Strategy 3: background-image on the card itself
    const cardBg = getBackgroundImageUrl(card);
    if (!isJunkImage(cardBg)) return upgradeThumbnailUrl(cardBg);
    return '';
  }
`;

const DOM_EXTRACTORS = {
  // ─── SAVILLS ───────────────────────────────────────────────
  // auctions.savills.co.uk — each lot is a <li> containing:
  // "Lot X", "Guide Price £X", address in link title, bullets, "Full details" link
  // Paginated: need to handle via Puppeteer scrolling or multi-page
  savills: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Savills: lot cards are <li class="lot"> with id="lot-{id}"
      // Each contains: lot-left (image carousel) + lot-right (details)
      // Lot number in <p class="lot-number">Lot X</p>
      // Address in <a class="lot-name" title="...">
      // Images in <ul class="lot-image-list"> > <li class="lot-image"> > <a> > <img>
      const lotCards = document.querySelectorAll('li.lot[id^="lot-"]');
      for (const li of lotCards) {
        const text = li.textContent || '';
        // Lot number from .lot-number element or text match
        let lotNum = null;
        const lotNumEl = li.querySelector('.lot-number');
        if (lotNumEl) {
          const lm = lotNumEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (lm) lotNum = parseInt(lm[1]);
        }
        if (lotNum === null) {
          const lotMatch = text.match(/Lot\\s+(\\d+)/);
          if (lotMatch) lotNum = parseInt(lotMatch[1]);
        }
        if (lotNum === null || seen.has(lotNum)) continue;
        seen.add(lotNum);
        // Address from lot-name link or any link with title containing a postcode
        let address = '';
        let url = '';
        const lotName = li.querySelector('a.lot-name[title]');
        if (lotName) {
          const title = lotName.getAttribute('title') || '';
          if (title) { address = title; url = lotName.getAttribute('href') || ''; }
        }
        if (!address) {
          const links = li.querySelectorAll('a[href]');
          for (const a of links) {
            const title = a.getAttribute('title') || '';
            const href = a.getAttribute('href') || '';
            const linkText = a.textContent.trim();
            if (title && title.match(/[A-Z]{1,2}\\d/) && !address) {
              address = title;
              url = href;
            } else if (linkText && linkText.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && !address) {
              address = linkText;
              url = href;
            }
          }
        }
        if (!address) {
          const addrMatch = text.match(/\\d+[a-z]?\\s+[A-Z][a-z]+[\\s\\S]*?[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/);
          if (addrMatch) address = addrMatch[0].trim();
        }
        if (!address) continue;
        // Full details link
        if (!url) {
          const links = li.querySelectorAll('a[href]');
          for (const a of links) {
            if (a.textContent.includes('Full details')) {
              url = a.getAttribute('href') || '';
              break;
            }
          }
        }
        // Price: Guide Price or Hammer Price
        let price = null;
        const priceMatch = text.match(/(?:Guide Price|Hammer Price)\\s*£([\\d,]+)/i);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        else {
          const pm2 = text.match(/£([\\d,]+)/);
          if (pm2) price = parseInt(pm2[1].replace(/,/g, ''));
        }
        // Bullets from nested list items (skip lot-image items)
        const bullets = [];
        const subLis = li.querySelectorAll('li:not(.lot-image)');
        for (const sub of subLis) {
          const t = sub.textContent.trim();
          if (t.length > 5 && t.length < 200 && !t.match(/^Lot\\s+\\d|^£|^Guide|^Hammer|Cancel proxy/i)) {
            bullets.push(t);
          }
        }
        // Detect sold/withdrawn
        if (text.match(/\\bSold\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/sold|withdrawn/i))) bullets.push('SOLD/STC');
        }
        // Image: prefer 2nd carousel image (1st is often a floorplan on Savills)
        // Savills loads all images (12-24) per lot card with no photo/floorplan metadata,
        // so we skip the first and take the second which is almost always a property photo.
        let imageUrl = '';
        const carouselImgs = li.querySelectorAll('.lot-image-list img[src], .lot-image img[src]');
        const validImgs = [];
        for (const img of carouselImgs) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && !/floor[\\s_-]?plan|floorplan|site[\\s_-]?plan|epc/i.test(s) && s.length > 10) {
            validImgs.push(s);
          }
        }
        // Use 2nd image as primary (1st is often a floorplan on Savills), store all for carousel
        imageUrl = validImgs[1] || validImgs[0] || '';
        // Fallback: any img inside the lot card
        if (!imageUrl) {
          const anyImg = li.querySelector('img[src]');
          if (anyImg) {
            const s = anyImg.getAttribute('src') || anyImg.dataset.src || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && !/floor[\\s_-]?plan|floorplan|site[\\s_-]?plan|epc/i.test(s) && s.length > 10) imageUrl = s;
          }
        }
        // Store all valid images for frontend carousel (max 8 to keep payload reasonable)
        const images = validImgs.length > 1 ? validImgs.slice(0, 8) : undefined;
        const entry = { lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined };
        if (images) entry.images = images;
        lots.push(entry);
      }
      return lots;
    })()
  `,

  // ─── HOLLIS MORGAN ─────────────────────────────────────────
  // hollismorgan.co.uk — anchored on "SHOW ME MORE" detail links
  // Each lot: h3=address, h4=price, h4="Lot TBC", li=bullets
  hollismorgan: `
    (() => {
      const lots = [];
      const detailLinks = document.querySelectorAll('a[href*="property-details"]');
      let lotIndex = 1;
      for (const link of detailLinks) {
        const url = link.getAttribute('href') || '';
        if (!url || link.textContent.trim() === '') continue;
        let card = link.parentElement;
        for (let i = 0; i < 5 && card; i++) {
          if (card.querySelector('h3') && card.querySelector('h4')) break;
          card = card.parentElement;
        }
        if (!card) continue;
        const h3 = card.querySelector('h3');
        const address = h3 ? h3.textContent.trim() : '';
        if (!address) continue;
        let price = null;
        const h4s = card.querySelectorAll('h4');
        for (const h4 of h4s) {
          const t = h4.textContent.trim();
          const pm = t.match(/£([\\d,]+)/);
          if (pm) { price = parseInt(pm[1].replace(/,/g, '')); break; }
        }
        let lotNum = lotIndex;
        for (const h4 of h4s) {
          const t = h4.textContent.trim();
          const lm = t.match(/Lot\\s+(\\d+)/i);
          if (lm) { lotNum = parseInt(lm[1]); break; }
        }
        const bullets = [];
        const lis = card.querySelectorAll('li');
        for (const li of lis) {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        }
        const cardText = card.textContent;
        if (cardText.match(/\\bSOLD\\b|\\bSALEAGREED\\b|\\bSALE AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        // Image: property photos use img.property-grid-image with /resize/ URLs
        let imageUrl = '';
        const cardImg = card.querySelector('img.property-grid-image');
        if (cardImg) {
          imageUrl = cardImg.getAttribute('src') || cardImg.dataset.src || '';
        }
        // Fallback: any img whose src contains /resize/ (property photo pattern)
        if (!imageUrl) {
          const imgs = card.querySelectorAll('img[src]');
          for (const img of imgs) {
            const s = img.getAttribute('src') || '';
            if (s.includes('/resize/') && !s.includes('.svg')) { imageUrl = s; break; }
          }
        }
        // Filter out non-property images (icons, logos, banners)
        if (imageUrl && (imageUrl.includes('.svg') || imageUrl.includes('/images/') || imageUrl.includes('logo') || imageUrl.includes('icon') || imageUrl.includes('banner'))) {
          imageUrl = '';
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        lotIndex++;
      }
      return lots;
    })()
  `,

  // ─── MAGGS & ALLEN ─────────────────────────────────────────
  // maggsandallen.co.uk — same CMS as Hollis Morgan (Auction2 platform)
  maggsandallen: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Maggs & Allen 2026: Bootstrap .card layout with .auction-property-image, h2 > a for address
      let cards = document.querySelectorAll('.card');
      if (cards.length === 0) cards = document.querySelectorAll('[class*="property-card"], article, .lot-card');
      for (const card of cards) {
        const text = card.textContent || '';
        // Skip nav/footer cards that aren't property listings
        if (text.length < 20 || text.length > 5000) continue;
        if (!text.match(/£[\\d,]|Lot\\s+\\d|Guide/i)) continue;
        // Address from h2 > a or h2/h3
        let address = '', url = '';
        const h2a = card.querySelector('h2 a, .card-body h2 a, h3 a');
        if (h2a) {
          address = h2a.textContent.trim();
          url = h2a.getAttribute('href') || '';
        }
        if (!address) {
          const h2 = card.querySelector('h2, h3');
          if (h2) address = h2.textContent.trim();
        }
        if (!address || address.length < 5) continue;
        // URL fallback
        if (!url) {
          const link = card.querySelector('a[href*="property"], a[href*="details"], .card-footer a, a[href]');
          if (link) url = link.getAttribute('href') || '';
        }
        // Price from .card-text or text
        let price = null;
        const priceEl = card.querySelector('.card-text, [class*="price"]');
        const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/LOT\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        if (seen.has(lotNum)) continue;
        seen.add(lotNum);
        // Image: Auction2 CMS uses img.property-grid-image with /resize/ URLs (same as Hollis Morgan)
        let imageUrl = '';
        const cardImg = card.querySelector('img.property-grid-image');
        if (cardImg) {
          imageUrl = cardImg.getAttribute('src') || cardImg.dataset.src || '';
        }
        // Fallback: any img whose src contains /resize/ (Auction2 property photo pattern)
        if (!imageUrl) {
          const imgs = card.querySelectorAll('img[src]');
          for (const img of imgs) {
            const s = img.getAttribute('src') || '';
            if (s.includes('/resize/') && !s.includes('.svg')) { imageUrl = s; break; }
          }
        }
        // Filter out non-property images
        if (imageUrl && (imageUrl.includes('.svg') || imageUrl.includes('/images/') || imageUrl.includes('logo') || imageUrl.includes('icon') || imageUrl.includes('banner'))) {
          imageUrl = '';
        }
        // Bullets
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── BTG EDDISONS (formerly SDL Auctions) ──────────────────
  // btgeddisonspropertyauctions.com — Tailwind + Swiper. Cards are div.property-card
  // Each has: lot number as plain text, address in link text, guide price in
  // .text-btg-blue, images from asta.btgeddisonspropertyauctions.com, and
  // property links to /properties/{id}/for-auction-{slug}
  sdl: `
    (() => {
      const lots = [];
      const seen = new Set();
      // BTG Eddisons: find all property links, then walk up to their card container
      const propLinks = document.querySelectorAll('a[href*="/properties/"]');
      const processed = new Set();
      for (const propLink of propLinks) {
        const url = propLink.getAttribute('href') || '';
        if (!url || seen.has(url)) continue;
        // Walk up to find the card container (up to 8 levels)
        let card = propLink;
        for (let i = 0; i < 8; i++) {
          if (!card.parentElement) break;
          card = card.parentElement;
          // Stop at a container that has both price text and a property link
          if (card.textContent.match(/Guide\\s*Price|£[\\d,]/i) && card.querySelector('img')) break;
        }
        // Skip if we already processed this card
        const cardId = card.getAttribute('data-idx') || card.innerHTML.substring(0, 100);
        if (processed.has(cardId)) continue;
        processed.add(cardId);
        seen.add(url);
        const text = card.textContent || '';
        // Lot number — plain 3-digit text like "001", "002"
        let lotNum = 0;
        const lotMatch = text.match(/(?:^|\\s)(\\d{2,4})(?:\\s|$)/);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Address from link text with postcode pattern
        let address = '';
        const allLinks = card.querySelectorAll('a[href*="/properties/"]');
        for (const link of allLinks) {
          const t = link.textContent.trim();
          if (t.length > 10 && t.match(/[A-Z]{1,2}\\d/i)) { address = t; break; }
        }
        // Fallback: h3 text
        if (!address) {
          const h3 = card.querySelector('h3');
          if (h3) address = h3.textContent.trim();
        }
        if (!address || address.length < 5) continue;
        // Deduplicate address if it repeats (overlay + content)
        address = address.replace(/(.{20,})\\1/g, '$1').trim();
        // Price from "Guide Price: £X+" pattern
        let price = null;
        const priceMatch = text.match(/Guide\\s*Price[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // Bullets — auction type, end date
        const bullets = [];
        const typeMatch = text.match(/(Multi-Lot Timed|Single-Lot Timed|Live Stream)\\s*Auction/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        const endMatch = text.match(/Auction\\s*Ends?:\\s*(\\d{2}\\/\\d{2}\\/\\d{4})/i);
        if (endMatch) bullets.push('Auction Ends: ' + endMatch[1]);
        if (text.match(/\\bWithdrawn\\b|\\bSOLD\\b|\\bSTC\\b|\\bSale Agreed\\b/i)) {
          bullets.push('SOLD/STC');
        }
        // Image — first real property image
        let imageUrl = '';
        const imgs = card.querySelectorAll('img[src]');
        const imgJunk = /logo|icon|\\.svg|placeholder|modal\\.png|_NYC\\.|_LCC\\.|_BMDC\\.|council|utilit|cardwell|download_\\(|captcha|floor[\\s_-]?plan|floorplan|site[\\s_-]?plan|epc[\\s_-]?chart|map[\\s_-]?view/i;
        for (const img of imgs) {
          const s = img.getAttribute('src') || '';
          if (s && s.length > 10 && !imgJunk.test(s)) {
            imageUrl = s;
            break;
          }
        }
        lots.push({ lot: lotNum || lots.length + 1, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── BOND WOLFE ────────────────────────────────────────────
  // bondwolfe.com — WordPress + EIG. Similar card structure to SDL
  bondwolfe: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Bond Wolfe lot cards
      const cards = document.querySelectorAll('.property-card, .lot-card, [class*="property"], article, .search-result');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const lotNum = parseInt(lotMatch[1]);
        if (seen.has(lotNum)) continue;
        seen.add(lotNum);
        const link = card.querySelector('a[href*="/property/"], a[href*="/lot/"], a[href*="/properties/"]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address, .property-title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li, .feature, .tag').forEach(el => {
          const t = el.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        // Image from card
        let imageUrl = '';
        const cardImg = card.querySelector('img[src]');
        if (cardImg) {
          const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── NETWORK AUCTIONS (WordPress + EIG images, tenant 24) ──
  network: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.current-lots-single');
      for (const card of cards) {
        const lotEl = card.querySelector('.lot-number, span.lot-number');
        let lotNum = lots.length + 1;
        if (lotEl) {
          const m = lotEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        const addrP = card.querySelector('.lot-info p');
        let address = '';
        if (addrP) {
          addrP.querySelectorAll('br').forEach(br => br.replaceWith(', '));
          address = addrP.textContent.trim().replace(/\\s+/g, ' ').replace(/, ,/g, ',');
        }
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        let price = null;
        const priceEl = card.querySelector('p.guide-price, .guide-price');
        if (priceEl) {
          const pm = priceEl.textContent.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        let url = '';
        const link = card.querySelector('a[href*="/property/"]');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img[src]');
        if (img) {
          const s = img.getAttribute('src') || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
        const bullets = [];
        const text = card.textContent || '';
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── BARNARD MARCUS ────────────────────────────────────────
  // barnardmarcusauctions.co.uk — Countrywide CMS, server-rendered
  barnardmarcus: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Barnard Marcus 2026: .lot-item cards with BEM-style classes
      let cards = document.querySelectorAll('.lot-item');
      if (cards.length === 0) cards = document.querySelectorAll('[class*="lot-item"], [class*="lot-card"], article');
      for (const card of cards) {
        const text = card.textContent || '';
        // Lot number from .lot-info__name or text
        const lotEl = card.querySelector('.lot-info__name, [class*="lot-info"] [class*="name"], [class*="lot-number"]');
        const lotMatch = (lotEl ? lotEl.textContent : text).match(/(?:Lot\\s+)?(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        // Address from .lot-item__address
        const addrEl = card.querySelector('.lot-item__address, [class*="lot-item__address"], [class*="address"], h3, h4');
        const address = addrEl ? addrEl.textContent.trim() : '';
        if (!address) continue;
        // Price from .lot-item__price
        let price = null;
        const priceEl = card.querySelector('.lot-item__price, [class*="price"]');
        const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // URL
        const link = card.querySelector('.lot-item__link, a[href*="lot"], a[href*="property"], a[href]');
        const url = link ? link.getAttribute('href') : '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('.lot-item__img img, img[src]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
        }
        // Bullets
        const bullets = [];
        const desc = card.querySelector('.lot-item__description, [class*="description"]');
        if (desc) { const t = desc.textContent.trim(); if (t.length > 5) bullets.push(t.substring(0, 200)); }
        const loc = card.querySelector('.lot-item__location, [class*="location"]');
        if (loc && loc.textContent.trim()) bullets.push(loc.textContent.trim());
        const statusEl = card.querySelector('.lot-info__status, [class*="status"]');
        if (statusEl && statusEl.textContent.match(/sold|unsold|withdrawn/i)) continue;
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b/i)) continue;
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── AUCTION HOUSE LONDON ─────────────────────────────────
  // Lot numbers are empty on this site — deduplicate by href, assign positional numbers
  auctionhouselondon: `
    (() => {
      const lots = [];
      const links = document.querySelectorAll('a[href*="/lot/"]');
      const seen = new Set();
      let idx = 1;
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (!href || seen.has(href)) continue;
        seen.add(href);
        const text = link.textContent || '';
        // Price from "Guide Price: £210,000+"
        const priceMatch = text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        // Address: find the semibold heading div, or parse from text
        const addrEl = link.querySelector('[class*="font-semibold"]');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address) {
          // Fallback: strip LOT/price/badges from text, take first substantial line
          address = text.replace(/LOT\\s*\\d*/gi, '').replace(/Guide Price[^£]*£[\\d,]+\\+?/gi, '').replace(/£[\\d,]+\\+?/g, '');
          address = address.split('\\n').map(s=>s.trim()).filter(s=>s.length>5 && !s.match(/^(Flat|Leasehold|Freehold|Sold|SOLD|STC|View)$/i))[0] || '';
        }
        if (!address || address.length < 5) continue;
        // Image
        let imageUrl = '';
        const img = link.querySelector('img[src]');
        if (img) {
          const s = img.getAttribute('src') || '';
          if (s.length > 10 && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg')) imageUrl = s;
        }
        if (!imageUrl) {
          const parent = link.closest('[class*="mb-30"], [class*="w-full"]') || link.parentElement;
          if (parent) { const pi = parent.querySelector('img[src*="eigpropertyauctions"], img[src*="property"]'); if (pi) imageUrl = pi.getAttribute('src') || ''; }
        }
        // Description bullets
        const bullets = [];
        const descEl = link.querySelector('[class*="leading-normal"], [class*="text-15"]');
        if (descEl) { const d = descEl.textContent.trim(); if (d.length > 10) bullets.push(d); }
        // Sold/STC detection
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          bullets.push('SOLD/STC');
        }
        // Property type & tenure from badge spans
        const badges = link.querySelectorAll('span');
        let propType, tenure;
        for (const b of badges) {
          const bt = b.textContent.trim();
          if (/^(Flat|House|Bungalow|Land|Commercial|Maisonette)$/i.test(bt)) propType = bt;
          if (/^(Freehold|Leasehold|Share of Freehold)$/i.test(bt)) tenure = bt;
        }
        lots.push({ lot: idx++, address, price, url: href, bullets, imageUrl: imageUrl || undefined, propType, tenure });
      }
      return lots;
    })()
  `,

  // ─── McHUGH & CO ──────────────────────────────────────────
  // ── MCHUGH & CO (EIG OAS platform) ──
  // mchughandco.com/current-auction → /future-auctions/{id}. EIG OAS lot panels.
  // Uses .lot-panel, h4.grid-address, .grid-guideprice b, img.grid-img.
  mchughandco: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        // Address from h4.grid-address
        const addrEl = card.querySelector('h4.grid-address, h4');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Lot number from panel title or text
        const titleEl = card.querySelector('.panel-title, .lot-number');
        let lotNum = lotIndex;
        if (titleEl) {
          const lotMatch = titleEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (lotMatch) lotNum = parseInt(lotMatch[1]);
        } else {
          const text = card.textContent || '';
          const lotMatch = text.match(/Lot\\s+(\\d+)/i);
          if (lotMatch) lotNum = parseInt(lotMatch[1]);
        }
        // Price from .grid-guideprice b or strong
        let price = null;
        const priceEl = card.querySelector('.grid-guideprice b, .grid-guideprice strong');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from lot detail link
        let url = '';
        const link = card.querySelector('a[href*="/lot/"], a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img.grid-img, img.img-responsive, img[src*="eigpropertyauctions"]');
        if (img) {
          const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
        // Tagline as bullet
        const bullets = [];
        const tagline = card.querySelector('.grid-tagline');
        if (tagline) {
          const t = tagline.textContent.trim().replace(/^Lot\\s+\\d+\\s*[-–]\\s*/i, '');
          if (t.length > 3) bullets.push(t);
        }
        const _ct = card.textContent || '';
        if (_ct.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        lotIndex++;
      }
      return lots;
    })()
  `,

  // ─── CLIVE EMSON ───────────────────────────────────────────
  // cliveemson.co.uk — server-rendered catalogue with background-image and data-image
  cliveemson: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Clive Emson: lots are in .lot elements with .lotPic (background-image), .LotHeading, .LotLocation
      const cards = document.querySelectorAll('.lot, [class*="lot"], [class*="property"], .search-result, article');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('.LotHeading, .LotLocation, h2, h3, h4, .address, .title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li, p').forEach(el => {
          const t = el.textContent.trim();
          if (t.length > 10 && t.length < 200 && !t.match(/^Lot|^Guide|^£/i)) bullets.push(t);
        });
        // Skip sold/completed lots
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b/i)) continue;
        // Image: Clive Emson grid-view cards have data-mainpic (filename) and data-auc (auction number)
        // Full URL pattern: https://www.cliveemson.co.uk/auc{data-auc}/pics/{data-mainpic}
        let imageUrl = '';
        const mainPic = card.getAttribute('data-mainpic') || '';
        const aucNum = card.getAttribute('data-auc') || '';
        if (mainPic && aucNum) {
          imageUrl = 'https://www.cliveemson.co.uk/auc' + aucNum + '/pics/' + mainPic;
        }
        // Fallback: background-image on .lotPic (list-view) or .lotImgWrap elements
        if (!imageUrl) {
          const lotPic = card.querySelector('.lotPic, .lotImgWrap, .lotImages [style*="background-image"]');
          if (lotPic) {
            const style = lotPic.getAttribute('style') || '';
            const bgMatch = style.match(/background-image:\\s*url\\(['"]?([^'"\\)]+)/i);
            if (bgMatch) imageUrl = bgMatch[1];
            if (!imageUrl) {
              const bg = getComputedStyle(lotPic).backgroundImage || '';
              const bgm = bg.match(/url\\(['"]?([^'"\\)]+)/);
              if (bgm) imageUrl = bgm[1];
            }
          }
        }
        // Fallback: data-image on child elements (carousel items)
        if (!imageUrl) {
          const dataImg = card.querySelector('[data-image]');
          if (dataImg) {
            const di = dataImg.getAttribute('data-image') || '';
            if (di && aucNum) imageUrl = 'https://www.cliveemson.co.uk/auc' + aucNum + '/pics/' + di;
            else if (di) imageUrl = di;
          }
        }
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── STRETTONS ─────────────────────────────────────────────
  strettons: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Strettons 2026: Bootstrap/JS-rendered. Try multiple card strategies.
      let cards = document.querySelectorAll('.lot-item, .property-card, .catalogue-item');
      if (cards.length === 0) cards = document.querySelectorAll('[class*="lot-item"], [class*="lot-card"], [class*="property-item"]');
      if (cards.length === 0) cards = document.querySelectorAll('article, .card');
      if (cards.length === 0) {
        // Fallback: find all links to lot/property pages and walk up
        const links = document.querySelectorAll('a[href*="/lot"], a[href*="/property"], a[href*="/auction"]');
        const parentSet = new Set();
        for (const link of links) {
          let p = link;
          for (let i = 0; i < 6 && p.parentElement; i++) {
            p = p.parentElement;
            const t = p.textContent || '';
            if (t.match(/Lot\\s+\\d/i) && t.match(/£[\\d,]/)) break;
          }
          if (!parentSet.has(p) && p.textContent.length > 20 && p.textContent.length < 3000) parentSet.add(p);
        }
        cards = parentSet;
      }
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        // Address
        let address = '';
        const addrEl = card.querySelector('[class*="address"], h2, h3, h4, .title');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 5 && s.length < 200);
          for (const l of lines) {
            if (l.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i)) { address = l; break; }
          }
        }
        if (!address) continue;
        // Price
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        // URL
        const link = card.querySelector('a[href*="/lot"], a[href*="/property"], a[href*="/auction"], a[href]');
        const url = link ? link.getAttribute('href') : '';
        // Image
        let imageUrl = extractCardImage(card);
        const bullets = [];
        card.querySelectorAll('li, .description, .feature, [class*="description"]').forEach(el => {
          const t = el.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── ACUITUS ───────────────────────────────────────────────
  acuitus: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Acuitus 2026: .property-card containers with .lot-number, .address, .guide-price
      let cards = document.querySelectorAll('.property-card');
      if (cards.length === 0) cards = document.querySelectorAll('[class*="property-card"], [class*="property-item"], [class*="lot-card"]');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotEl = card.querySelector('.lot-number, [class*="lot-number"]');
        const lotMatch = (lotEl ? lotEl.textContent : text).match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const addrEl = card.querySelector('.address, [class*="address"], h2, h3');
        const address = addrEl ? addrEl.textContent.trim() : '';
        if (!address) continue;
        let price = null;
        const priceEl = card.querySelector('.guide-price, [class*="guide-price"], [class*="price"]');
        const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        const link = card.querySelector('a[href*="/property/"], a[href]');
        const url = link ? link.getAttribute('href') : '';
        let imageUrl = extractCardImage(card);
        const bullets = [];
        const yieldEl = card.querySelector('.yield, [class*="yield"]');
        if (yieldEl && yieldEl.textContent.trim()) bullets.push('Yield: ' + yieldEl.textContent.trim());
        const typeEl = card.querySelector('.property-type, [class*="property-type"]');
        if (typeEl && typeEl.textContent.trim()) bullets.push(typeEl.textContent.trim());
        const statusEl = card.querySelector('.status, [class*="status"]');
        if (statusEl && statusEl.textContent.match(/sold|withdrawn/i)) bullets.push('SOLD/STC');
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── AUCTION HOUSE UK ─────────────────────────────────────
  auctionhouse: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('[class*="lot"], [class*="property"], article, .search-result');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address, .title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        // Image from card — uses lazy-load helpers for data-src/data-lazy-src/background-image fallback
        let imageUrl = extractCardImage(card);
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── KNIGHT FRANK (EIG platform) ──
  knightfrank: `
    (() => {
      const lots = [];
      document.querySelectorAll('a[href*="/property/"], a[href*="/lot/"], .lot-card, .property-card, [class*="lot"]').forEach(el => {
        const text = el.textContent || '';
        const href = el.getAttribute('href') || '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:guide|price|reserve)[:\\s]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const pcMatch = text.match(/[A-Z]{1,2}\\d{1,2}[A-Z]?\\s*\\d[A-Z]{2}/i);
        const address = text.replace(/lot\\s*\\d+/i, '').replace(/£[\\d,]+/g, '').replace(/guide\\s*price/i, '').trim().split('\\n')[0].trim();
        if (address && address.length > 5) {
          // Image from card — uses lazy-load helpers
          let imageUrl = extractCardImage(el);
          const bullets = [];
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── PATTINSON (React SPA with bid cards) ──
  pattinson: `
    (() => {
      const lots = [];
      document.querySelectorAll('[class*="card"], [class*="property"], [class*="auction-item"], .lot-item').forEach(card => {
        const text = card.textContent || '';
        const link = card.querySelector('a[href*="auction"]') || card.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:starting|current|guide)\\s*(?:bid|price)[:\\s]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const address = text.split('\\n').find(l => l.trim().length > 10 && !l.match(/^(?:lot|starting|current|guide|£|bid)/i));
        if (address) {
          let imageUrl = extractCardImage(card);
          const bullets = [];
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
          lots.push({ lot: num, address: address.trim().substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── BIDX1 (React SPA) ──
  bidx1: `
    (() => {
      const lots = [];
      document.querySelectorAll('[class*="property"], [class*="card"], [class*="listing"], [class*="lot"]').forEach(card => {
        const text = card.textContent || '';
        const link = card.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/€([\\d,]+)/) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 5);
        const address = lines.find(l => !l.match(/^(?:€|£|\\d+\\s*bed|guide|reserve|sold)/i));
        if (address) {
          let imageUrl = extractCardImage(card);
          const bullets = [];
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
          lots.push({ lot: lots.length + 1, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── PHILLIP ARNOLD (PHP gallery) ──
  philliparnold: `
    (() => {
      const lots = [];
      document.querySelectorAll('.gallery-item, .lot-item, .property-item, [class*="lot"]').forEach(el => {
        const text = el.textContent || '';
        const link = el.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/guide\\s*price\\s*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const address = text.replace(/lot\\s*\\d+/i, '').replace(/guide\\s*price\\s*£[\\d,]+/i, '').replace(/£[\\d,]+/g, '').trim().split('\\n')[0].trim();
        if (address && address.length > 5) {
          let imageUrl = extractCardImage(el);
          const bullets = [];
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── EDWARD MELLOR (WordPress, verified HTML) ──
  edwardmellor: `
    (() => {
      const lots = [];
      document.querySelectorAll('a[href*="/property-for-sale/"]').forEach(link => {
        const text = link.textContent || '';
        const href = link.getAttribute('href') || '';
        const lotMatch = text.match(/lot\\s*(\\d+|TBC)/i);
        const num = lotMatch && lotMatch[1] !== 'TBC' ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/guide\\s*price\\s*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const pcMatch = text.match(/[A-Z]{1,2}\\d{1,2}[A-Z]?\\s*\\d[A-Z]{2}/i);
        const addressLine = text.split('\\n').find(l => l.trim().length > 10 && l.match(/[A-Z]{1,2}\\d/));
        const address = addressLine ? addressLine.trim() : text.split('\\n')[0].trim();
        if (address && address.length > 5) {
          const bullets = [];
          const beds = text.match(/(\\d+)\\s*bed/i);
          if (beds) bullets.push(beds[1] + ' bed');
          // Image: Edward Mellor uses widget cards on auction page
          let imageUrl = '';
          const linkParent = link.parentElement;
          if (linkParent) {
            const parentImg = linkParent.querySelector('img[src]') || (linkParent.parentElement ? linkParent.parentElement.querySelector('img[src]') : null);
            if (parentImg) {
              const s = parentImg.getAttribute('src') || parentImg.dataset.src || '';
              if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
            }
          }
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
            if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
          }
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── BARNETT ROSS (PHP, table.auction-archive-table) ──
  barnettross: `
    (() => {
      const lots = [];
      const seen = new Set();
      const table = document.querySelector('table.auction-archive-table');
      if (!table) return lots;
      const rows = table.querySelectorAll('tr[onclick], tr[style*="cursor"]');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 4) continue;
        const lotNum = parseInt(cells[0].textContent.trim()) || (lots.length + 1);
        const address = cells[1].textContent.trim();
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        let price = null;
        const priceText = cells[3].textContent || '';
        const pm = priceText.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        let url = '';
        const onclick = row.getAttribute('onclick') || '';
        const urlMatch = onclick.match(/document\\.location='([^']+)'/);
        if (urlMatch) url = urlMatch[1];
        const bullets = [];
        const _rt = row.textContent || '';
        if (_rt.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        let imageUrl = '';
        const img = row.querySelector('img[src]');
        if (img) {
          const s = img.getAttribute('src') || '';
          if (s && s.length > 10 && !s.startsWith('data:') && !/logo|icon|\\.svg|spacer|pixel/i.test(s)) imageUrl = s;
        }
        lots.push({ lot: lotNum, address, price, url, imageUrl: imageUrl || undefined, bullets });
      }
      return lots;
    })()
  `,

  // ── COTTONS (EIG embed via current-auction.htm) ──
  // EIG embed renders .lot-container divs with .lotnum, .address, .price, img.lot-image
  // Prices may show "Guide Price*: £X" (upcoming) or "Result: Sold for £X" (past).
  cottons: `
    (() => {
      const lots = [];
      const seen = new Set();
      const containers = document.querySelectorAll('.lot-container');
      for (const card of containers) {
        // Lot number from .lotnum (e.g. "LOT 1")
        const lotnumEl = card.querySelector('.lotnum');
        let lotNum = lots.length + 1;
        if (lotnumEl) {
          const m = lotnumEl.textContent.match(/LOT\\s+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        // Address from .address or .address-mob
        const addrEl = card.querySelector('.address, .address-mob');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price — guide price or sold price
        let price = null;
        const priceEl = card.querySelector('.price');
        if (priceEl) {
          const priceText = priceEl.textContent;
          const pm = priceText.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from lot detail link
        let url = '';
        const link = card.querySelector('a[href*="lid="]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img.lot-image, img[src*="eigpropertyauctions"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Description: text after the address in .lot-info (everything before = lot num + result)
        const bullets = [];
        const infoEl = card.querySelector('.lot-info');
        if (infoEl) {
          const fullText = infoEl.textContent || '';
          const addrIdx = fullText.indexOf(address);
          if (addrIdx >= 0) {
            let desc = fullText.substring(addrIdx + address.length).trim();
            // Strip leading price remnants like "£70,000."
            desc = desc.replace(/^£[\\d,]+\\+?\\.?\\s*/i, '');
            if (desc.length > 5 && desc.length < 200) bullets.push(desc);
          }
        }
        const _ct = card.textContent || '';
        if (_ct.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── DEDMAN GRAY (EIG embed, tenant 33, table-based layout) ──
  dedmangray: `
    (() => {
      const lots = [];
      const seen = new Set();
      const tables = document.querySelectorAll('table.lotdetails');
      for (const table of tables) {
        const lotCell = table.querySelector('td.lotnum');
        let lotNum = lots.length + 1;
        if (lotCell) {
          const m = lotCell.textContent.match(/LOT[:\\s]+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        const addrCell = table.querySelector('td.lottag');
        let address = addrCell ? addrCell.textContent.trim().replace(/\\s+/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        let price = null;
        const text = table.textContent || '';
        const pm = text.match(/Guide Price[^£]*£([\\d,]+)/i);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        let url = '';
        const link = table.querySelector('a[href*="lot-details"], a[href*="lid="]');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const img = table.querySelector('td.lotimagecol img, img[src*="eigpropertyauctions"]');
        if (img) {
          const s = img.getAttribute('src') || '';
          if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
        }
        const bullets = [];
        const descCells = table.querySelectorAll('td[colspan="2"]');
        if (descCells.length > 0) {
          const desc = descCells[0].textContent.trim().replace(/\\s+/g, ' ');
          if (desc.length > 10 && desc.length < 500 && !desc.match(/^Guide Price/i)) {
            bullets.push(desc.substring(0, 250));
          }
        }
        const _tt = table.textContent || '';
        if (_tt.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  probateauction: `
    (() => {
      const lots = [];
      document.querySelectorAll('.property-list-card').forEach(card => {
        const text = card.textContent || '';
        const link = card.querySelector('a[href*="/lot/"], a[href*="property"]');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
        // Address is typically the first substantial line that isn't lot number or price
        const address = lines.find(l => l.length > 10 && !l.match(/^(?:lot|guide|£|sold|property details|view|swipe)/i));
        // Description is the longest paragraph-like text
        const desc = lines.filter(l => l.length > 30 && !l.match(/^(?:lot|£)/i)).join(' ').substring(0, 300);
        // Image — check background-image slides first (Cycle2 gallery uses <a class="slide" style="background-image:url(...)">)
        let imageUrl = '';
        const slideDiv = card.querySelector('.slide[style*="background"], .swiper-slide [style*="background"], [style*="background-image"]');
        if (slideDiv) {
          const bg = slideDiv.getAttribute('style') || '';
          const bgMatch = bg.match(/background(?:-image)?:\\s*url\\(['"]?([^'"\\)]+)/i);
          if (bgMatch) imageUrl = bgMatch[1];
        }
        if (!imageUrl) {
          // Fallback to img tags — exclude SVG nav arrows and icons
          const swiperImg = card.querySelector('.swiper-slide img, img[src*="uploads"]');
          if (swiperImg) {
            const s = swiperImg.getAttribute('src') || swiperImg.dataset.src || '';
            if (s && !s.includes('.svg') && !s.includes('arrow') && !s.includes('logo') && !s.includes('icon')) imageUrl = s;
          }
        }
        if (!imageUrl) {
          const anyImg = card.querySelector('img[src]');
          if (anyImg) {
            const s = anyImg.getAttribute('src') || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && !s.includes('arrow') && s.length > 10) imageUrl = s;
          }
        }
        if (address) {
          const bullets = desc ? [desc] : [];
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
            if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
          }
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── BRADLEY HALL (EIG platform with lot-panel cards) ──
  bradleyhall: `
    (() => {
      const lots = [];
      const seen = new Set();
      document.querySelectorAll('.lot-panel').forEach(panel => {
        const text = panel.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) return;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) return;
        seen.add(num);
        const link = panel.querySelector('a[href*="/lot/"]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/Guide Price[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const addrEl = panel.querySelector('.grid-address, h4');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address) return;
        const taglineEl = panel.querySelector('.grid-tagline');
        const bullets = [];
        if (taglineEl) bullets.push(taglineEl.textContent.trim());
        // Image from grid-img
        let imageUrl = '';
        const img = panel.querySelector('img.grid-img, img.img-responsive, img[src*="eigpropertyauctions"]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && s.length > 10) imageUrl = s;
        }
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      });
      return lots;
    })()
  `,

  // ── LANDWOOD (EIG OAS platform, tenant 188, LIST view) ──
  landwood: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        const addrEl = card.querySelector('h3.list-address, h3.grid-address, h4.grid-address');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        let lotNum = lotIndex;
        const titleEl = card.querySelector('.panel-title');
        if (titleEl) {
          const m = titleEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        let price = null;
        const priceEl = card.querySelector('.list-guideprice strong, .grid-guideprice b, .grid-guideprice strong');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        let url = '';
        const link = card.querySelector('a[href*="/lot/details/"], a[href*="/lot/"]');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const imgs = card.querySelectorAll('img');
        for (const img of imgs) {
          const s = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
          if (s && s.length > 10 && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && !s.includes('gavel') && !s.includes('backdrop') && !s.includes('placeholder')) {
            imageUrl = s;
            break;
          }
        }
        // Dedup: reject image if already used by a previous lot (prevents image bleed)
        const usedImages = lots.map(l => l.imageUrl).filter(Boolean);
        if (imageUrl && usedImages.includes(imageUrl)) imageUrl = '';
        const bullets = [];
        const headingEl = card.querySelector('h4.lot-data-heading strong, h4.lot-data-heading');
        if (headingEl) {
          const t = headingEl.textContent.trim();
          if (t.length > 3 && t.length < 300) bullets.push(t);
        }
        const _ct2 = card.textContent || '';
        if (_ct2.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        lotIndex++;
      }
      return lots;
    })()
  `,

  // ── CONNECT UK AUCTIONS ──
  connectuk: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('[class*="lot"], [class*="property"], .search-result, article, [class*="card"]');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address, .title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        let imageUrl = extractCardImage(card);
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── AUCTION ESTATES ──
  // Site has no lot numbers — assign by position. Catalogue at /view-properties.
  auctionestates: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.result-container');
      let idx = 1;
      for (const card of cards) {
        const text = card.textContent || '';
        let address = '';
        const heading = card.querySelector('.property-title, h1, h2, h3');
        if (heading) address = heading.textContent.trim();
        if (!address || address.length < 5) continue;
        const priceEl = card.querySelector('.property-guide-price');
        const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const link = card.querySelector('a[href*="/property/"]');
        const url = link ? link.getAttribute('href') : '';
        let imageUrl = '';
        const img = card.querySelector('img.result-property-image, img[src]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
        }
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        const flash = card.querySelector('.property-flash');
        if (flash && /\\bSOLD\\b|\\bWithdrawn\\b/i.test(flash.textContent)) {
          bullets.push(flash.textContent.trim());
        }
        lots.push({ lot: idx++, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── LOVEITTS ──
  loveitts: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('[class*="lot"], [class*="property"], .search-result, article, [class*="card"]');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address, .title');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        let imageUrl = extractCardImage(card);
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── HUNTERS (BAMBOO AUCTIONS) ───────────────────────────────
  // hunters.bambooauctions.com — React/Next.js SPA with styled-components.
  // Cards are a[href^="/property/"] wrapping div with Title h3, Address p, Price p.
  // Images on cdn.bambooauctions.com. No lot numbers — uses sequential index.
  hunters: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Each card is wrapped in an anchor with href="/property/slug-id"
      const links = document.querySelectorAll('a[href^="/property/"]');
      let lotIndex = 1;
      for (const link of links) {
        const url = link.getAttribute('href') || '';
        if (!url || seen.has(url)) continue;
        seen.add(url);

        const card = link;

        // Title: h3 inside the card
        const titleEl = card.querySelector('h3');
        const title = titleEl ? titleEl.textContent.trim() : '';

        // Address: p element with class containing "Address" (styled-components)
        let address = '';
        const addrEl = card.querySelector('p[class*="Address"]');
        if (addrEl) {
          address = addrEl.textContent.trim();
        }
        // Fallback: use title + address combo or just title
        if (!address && title) address = title;
        // Don't skip lots with missing address — enrichLotsFromLotPages will fill them later

        // Combine title and address if they differ
        let fullAddress = address || '';
        if (title && address && !address.toUpperCase().includes(title.substring(0, 10).toUpperCase())) {
          fullAddress = title + ', ' + address;
        }

        // Price: p element with class containing "Price"
        let price = null;
        const priceEl = card.querySelector('p[class*="Price"]');
        if (priceEl) {
          const priceMatch = priceEl.textContent.match(/£([\\d,]+)/);
          if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        }

        // Image: extract from srcset (Next.js /_next/image?url=ENCODED&w=N format)
        // CDN varies: cdn.bambooauctions.com, s3 bamboo-cdn, cloudfront
        let imageUrl = '';
        const img = card.querySelector('img[alt]');
        if (img) {
          const srcset = img.getAttribute('srcset') || '';
          // Extract decoded URL from srcset — pick a mid-size image (w=640 or w=828)
          const srcsetParts = srcset.split(',').map(s => s.trim());
          for (const part of srcsetParts) {
            if (part.includes('/_next/image') || part.includes('/property/img/')) {
              const urlMatch = part.match(/url=([^&]+)/);
              if (urlMatch) {
                try { imageUrl = decodeURIComponent(urlMatch[1]); } catch(e) {}
              }
              if (part.includes('w=640') || part.includes('w=828') || part.includes('w=1080')) break;
            }
          }
          // Fallback to img src
          if (!imageUrl) {
            const src = img.getAttribute('src') || '';
            if (src.includes('/_next/image')) {
              const urlMatch = src.match(/url=([^&]+)/);
              if (urlMatch) {
                try { imageUrl = decodeURIComponent(urlMatch[1]); } catch(e) {}
              }
            } else if (src.includes('/property/img/')) {
              imageUrl = src;
            }
          }
          // Skip tracking pixels and non-property images
          if (imageUrl && (imageUrl.includes('logo') || imageUrl.includes('icon') ||
              imageUrl.includes('.svg') || imageUrl.includes('placeholder') ||
              imageUrl.includes('1x1') || imageUrl.includes('spacer'))) {
            imageUrl = '';
          }
        }

        // Bullets: auction type, bedrooms, bathrooms, property type
        const bullets = [];
        // Auction type ribbon (Traditional/Conditional)
        const ribbon = card.querySelector('[class*="AuctionTypeRibbon"] span, [class*="Ribbon"] span');
        if (ribbon) bullets.push('Auction: ' + ribbon.textContent.trim());
        // Bedrooms (icon: flaticon-bed)
        const bedIcon = card.querySelector('i[class*="flaticon-bed"]');
        if (bedIcon) {
          const bedDiv = bedIcon.parentElement;
          const beds = bedDiv ? bedDiv.textContent.trim() : '';
          if (beds) bullets.push(beds + ' bedrooms');
        }
        // Bathrooms (icon: flaticon-shower)
        const bathIcon = card.querySelector('i[class*="flaticon-shower"]');
        if (bathIcon) {
          const bathDiv = bathIcon.parentElement;
          const baths = bathDiv ? bathDiv.textContent.trim() : '';
          if (baths) bullets.push(baths + ' bathrooms');
        }
        // Property type (div with class containing PropertyType)
        const typeEl = card.querySelector('[class*="PropertyType"]');
        if (typeEl) bullets.push(typeEl.textContent.trim());

        const _ht = card.textContent || '';
        if (_ht.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({
          lot: lotIndex++,
          address: fullAddress,
          price,
          url,
          bullets,
          imageUrl: imageUrl || undefined
        });
      }
      return lots;
    })()
  `,

  // ─── COUNTRYWIDE / SUTTON KERSH ────────────────────────────
  // countrywidepropertyauctions.co.uk / suttonkersh.co.uk
  // Bootstrap grid. Cards are div.property-gallery with h2.property-gallery__title (price)
  // and h3.property-gallery__address (address). Static HTML, no JS needed.
  countrywide: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.property-gallery');
      let lotIndex = 1;
      for (const card of cards) {
        const text = card.textContent || '';
        // Address
        const addrEl = card.querySelector('.property-gallery__address, h3');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price from h2.property-gallery__title — "Guide Price: £90,000+" or "Sold Prior"
        let price = null;
        const titleEl = card.querySelector('.property-gallery__title, h2');
        const titleText = titleEl ? titleEl.textContent.trim() : '';
        const priceMatch = titleText.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // URL from detail link
        let url = '';
        const detailLink = card.querySelector('a[href*="property_details"]');
        if (detailLink) url = detailLink.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('.property-gallery__image img:not(.sold)');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Bullets — sold status, virtual tour
        const bullets = [];
        if (titleText.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bPostponed\\b/i)) bullets.push('SOLD/STC');
        if (card.querySelector('.vu360')) bullets.push('Virtual Tour Available');
        lots.push({ lot: lotIndex++, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── VENMORE AUCTIONS ───────────────────────────────────────
  // venmoreauctions.co.uk — Liverpool. Cards are div.property-strip-block.
  // Server-rendered, lot numbers in text, prices as "Guide Price £X PLUS*"
  venmore: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.property-strip-block');
      for (const card of cards) {
        const text = card.textContent || '';
        // Lot number from "Lot N" text
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Address from span.f-body-copy.db.marbot10
        let address = '';
        const addrEl = card.querySelector('.f-body-copy.db.marbot10, span[class*="marbot"]');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address || address.length < 5) continue;
        // Price from span.p-text-green — "Guide Price £90,000 PLUS*"
        let price = null;
        const priceEl = card.querySelector('.p-text-green, span[class*="greatprimer"]');
        if (priceEl) {
          const pm = priceEl.textContent.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from detail link
        let url = '';
        const link = card.querySelector('a[href*="Property-Details"]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img.img_resp, img[src*="resizeCrop"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Bullets — status, auction date
        const bullets = [];
        const statusEl = card.querySelector('.p-flash-green');
        if (statusEl) {
          const _st = statusEl.textContent.trim();
          if (_st.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
          else if (_st.length > 1) bullets.push(_st);
        }
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        const dateMatch = text.match(/(\\d{2}\\/\\d{2}\\/\\d{4})/);
        if (dateMatch) bullets.push('Auction: ' + dateMatch[1]);
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── TOWN & COUNTRY PROPERTY AUCTIONS (TCPA) ───────────────
  // townandcountrypropertyauctions.co.uk — National franchise on EIG platform.
  // Cards are div.lot-panel with span.lot-address, span.price, time.text-success
  tcpa: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        const text = card.textContent || '';
        // Address from span.lot-address
        const addrEl = card.querySelector('.lot-address, span[class*="lot-address"]');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price from span.price inside div.grid-guideprice
        let price = null;
        const priceEl = card.querySelector('.grid-guideprice .price, span.price');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from image container link
        let url = '';
        const link = card.querySelector('.grid-img-container a[href], a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        if (seen.has(url) && url) continue;
        // Image — first real img in swiper
        let imageUrl = '';
        const img = card.querySelector('img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Bullets — auction end date, office name, features, ribbon
        const bullets = [];
        const timeEl = card.querySelector('time.text-success');
        if (timeEl) bullets.push('Auction Ends: ' + timeEl.textContent.trim());
        const officeEl = card.querySelector('.lot-auctioneer-name');
        if (officeEl) bullets.push(officeEl.textContent.trim());
        // Features list
        card.querySelectorAll('.grid-tagline.custom-fields li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 1) bullets.push(t);
        });
        // Ribbon badge
        const ribbon = card.querySelector('[data-ribbon]');
        if (ribbon) {
          const ribbonText = ribbon.getAttribute('data-ribbon') || '';
          if (/sold|completed|exchanged/i.test(ribbonText)) continue;
          bullets.push(ribbonText);
        }
        // Skip sold/completed lots — EIG /search includes historical
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b|\\bExchanged\\b/i)) continue;
        lots.push({ lot: lotIndex++, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── FUTURE PROPERTY AUCTIONS ──────────────────────────────
  // futurepropertyauctions.co.uk — ASP classic, classless HTML.
  // Cards are a[href*="property_details.asp"]. Price as "£X OPENING BID".
  futureauctions: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Future Property Auctions 2026: ASP pages, property_details.asp links
      // Try both link-as-card and walking up from links to parent containers
      let cards = document.querySelectorAll('a[href*="property_details.asp"]');
      // If links are small (just "View Details"), walk up to parent containers
      const useParent = cards.length > 0 && cards[0].textContent.trim().length < 50;
      const processed = new Set();
      for (const el of cards) {
        const href = el.getAttribute('href') || '';
        if (processed.has(href)) continue;
        processed.add(href);
        // Walk up to the lot container
        let card = el;
        if (useParent) {
          for (let i = 0; i < 6 && card.parentElement; i++) {
            card = card.parentElement;
            const t = card.textContent || '';
            if (t.match(/£[\\d,]/) && t.match(/Lot\\s+\\d|bedroom|property/i)) break;
          }
        }
        const text = card.textContent || '';
        if (text.length < 20 || text.length > 3000) continue;
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        if (seen.has(lotNum)) continue;
        seen.add(lotNum);
        // Price
        let price = null;
        const priceMatch = text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // Address — look for Google Maps link text or postcode-containing line
        let address = '';
        const mapsLink = card.querySelector('a[href*="maps.google"], a[href*="google.com/maps"]');
        if (mapsLink) address = mapsLink.textContent.trim();
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 3);
          for (const line of lines) {
            if (line.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && line.length < 200) {
              address = line.replace(/Lot\\s+\\d+/i, '').replace(/£[\\d,]+[^\\n]*/g, '').trim();
              break;
            }
          }
          if (!address) {
            const h4 = card.querySelector('h4 a, h4, h3');
            if (h4) address = h4.textContent.trim();
          }
        }
        if (!address || address.length < 5) continue;
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="/upload/"], img[src*="futurepropertyauctions"], img[src]');
        if (img) {
          let src = img.getAttribute('src') || '';
          if (src.startsWith('http://')) src = src.replace('http://', 'https://');
          if (src && !src.includes('logo') && !src.includes('icon') && src.length > 10) imageUrl = src;
        }
        const bullets = [];
        const typeMatch = text.match(/(Timed Online Auction|Live Auction)[^\\n]*/i);
        if (typeMatch) bullets.push(typeMatch[0].trim());
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address, price, url: href, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── KIVELLS ────────────────────────────────────────────────
  // kivells.com — Devon/Cornwall. Tailwind + Alpine.js.
  // Cards are div.bg-listing-item-background with h2 address, h3 price.
  kivells: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('[class*="bg-listing-item-background"]');
      for (const card of cards) {
        const text = card.textContent || '';
        // Address from h2.font-serif
        const addrEl = card.querySelector('h2.font-serif, h2');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address || address.length < 5) continue;
        // Price from h3.font-serif — "£250,000 Guide Price"
        let price = null;
        const priceEl = card.querySelector('h3.font-serif, h3');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from "View property details" link
        let url = '';
        const link = card.querySelector('a[href*="/properties/"]');
        if (link) url = link.getAttribute('href') || '';
        // Image — first property image
        let imageUrl = '';
        const img = card.querySelector('img[src*="/media/Properties/"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Reference code and bedrooms from list items
        const bullets = [];
        card.querySelectorAll('ul li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 1 && t.length < 100) bullets.push(t);
        });
        // Description
        const descEl = card.querySelector('p.font-light.leading-loose, p.font-light');
        if (descEl) {
          const desc = descEl.textContent.trim();
          if (desc.length > 10 && desc.length < 300) bullets.push(desc);
        }
        const _kt = card.textContent || '';
        if (_kt.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lots.length + 1, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── FIRST FOR AUCTIONS ─────────────────────────────────────
  // online.firstforauctions.co.uk — EIG platform.
  // Cards are div.lot-panel with h4.grid-address, div.grid-guideprice b.
  // ─── PAUL FOSH (EIG ONLINE AUCTIONS) ────────────────────────
  // paulfosh.eigonlineauctions.com — EIG platform, same structure as firstforauctions.
  // Lot panels with h4.grid-address, .grid-guideprice, img.grid-img.
  paulfosh: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        const addrEl = card.querySelector('h4.grid-address, h4');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Lot number from panel title
        const titleEl = card.querySelector('.panel-title');
        let lotNum = lotIndex;
        if (titleEl) {
          const lotMatch = titleEl.textContent.match(/Lot\\s+(\\d+)/i);
          if (lotMatch) lotNum = parseInt(lotMatch[1]);
        }
        // Price from .grid-guideprice strong or b
        let price = null;
        const priceEl = card.querySelector('.grid-guideprice strong, .grid-guideprice b');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from lot detail link
        let url = '';
        const link = card.querySelector('.grid-img-container a[href], a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('.grid-img-container img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Tagline as bullet
        const bullets = [];
        const tagline = card.querySelector('.grid-tagline');
        if (tagline) {
          const t = tagline.textContent.trim().replace(/^Lot\\s+\\d+\\s*-\\s*/i, '');
          if (t.length > 3) bullets.push(t);
        }
        const _pt = card.textContent || '';
        if (_pt.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        lotIndex++;
      }
      return lots;
    })()
  `,

  firstforauctions: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-panel');
      let lotIndex = 1;
      for (const card of cards) {
        // Address from h4.grid-address
        const addrEl = card.querySelector('h4.grid-address, h4');
        let address = addrEl ? addrEl.textContent.trim().replace(/\\u00a0/g, ' ') : '';
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price from div.grid-guideprice b
        let price = null;
        const priceEl = card.querySelector('.grid-guideprice b');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from image container or View button
        let url = '';
        const link = card.querySelector('.grid-img-container a[href], a.btn-primary[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('.grid-img-container img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || '';
        const bullets = [];
        const _ft = card.textContent || '';
        // Skip sold/completed lots entirely — EIG /search includes historical
        if (_ft.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b|\\bExchanged\\b/i)) continue;
        const ribbon = card.querySelector('[data-ribbon]');
        if (ribbon && /sold|completed|exchanged/i.test(ribbon.getAttribute('data-ribbon') || '')) continue;
        lots.push({ lot: lotIndex++, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── SUTTON KERSH ───────────────────────────────────────────
  // suttonkersh.co.uk — Liverpool. Static HTML gallery.
  // Cards are .propertyBox.auctionBox with .info h1 a (address) and h2 a (price).
  // Must validate cards have a lot link to filter out page chrome.
  suttonkersh: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.propertyBox.auctionBox');
      for (const card of cards) {
        const text = card.textContent || '';
        // URL from detail link — MUST exist to confirm this is a real lot
        let url = '';
        const link = card.querySelector('a[href*="/properties/lot/"]');
        if (link) url = link.getAttribute('href') || '';
        if (!url) continue;
        // Address from h1 > a inside .info
        let address = '';
        const addrEl = card.querySelector('.info h1 a, h1 a');
        if (addrEl) address = addrEl.textContent.replace(/\\n/g, ', ').trim();
        if (!address || address.length < 5) continue;
        // Skip if address looks like nav/chrome text
        if (address.match(/^(Home|Contact|About|Search|Properties|Menu|Login|Register)$/i)) continue;
        // Price from h2 > a inside .info — "Sold for £63,000" or "Available at £X"
        let price = null;
        const priceEl = card.querySelector('.info h2 a, h2 a');
        if (priceEl) {
          const pm = priceEl.textContent.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot[:\\s]+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Image
        let imageUrl = '';
        const img = card.querySelector('.img_container img:not(.sold), img[src*="image_crop"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Bullets — status, property type (strict filtering)
        const bullets = [];
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        if (text.match(/\\bPostponed\\b/i)) bullets.push('Postponed');
        // Property type from p tags — only keep lines that look like property descriptions
        const infoPs = card.querySelectorAll('.info p');
        for (const p of infoPs) {
          const pt = p.textContent.trim();
          if (pt.length < 4 || pt.length > 80) continue;
          // Skip lines that are clearly not property type/description
          if (pt.match(/Lot[:\\s]|Guide|Save|View|Click|Search|Contact|Share|Print|©|Cookie|Privacy|Tel:|Email:|Fax:/i)) continue;
          // Only keep if it looks like a property descriptor
          if (pt.match(/residential|commercial|land|investment|vacant|freehold|leasehold|semi|terrace|detach|flat|house|bungalow|garage|shop|office|warehouse|industrial|mixed.use|development|site/i)) {
            bullets.push(pt);
          }
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── HARMAN HEALY ──────────────────────────────────────────
  // harman-healy.co.uk — National, EIG platform (tenant 18).
  // Cards use [data-lot-item-toggle] or a[href*="/lot/details/"].
  harmanhealy: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Try data-lot-item-toggle first, fall back to lot-panel
      let cards = document.querySelectorAll('[data-lot-item-toggle]');
      if (cards.length === 0) cards = document.querySelectorAll('.lot-panel, a[href*="/lot/details/"]');
      for (const card of cards) {
        const text = card.textContent || '';
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Address from [data-address-searchable] or first heading
        let address = '';
        const addrEl = card.querySelector('[data-address-searchable], h3 a, a h3, h3, h4.grid-address, h4');
        if (addrEl) address = addrEl.textContent.trim().replace(/\\u00a0/g, ' ');
        // Skip descriptions masquerading as addresses (e.g. "A three bedroom house" with no postcode)
        if (address && /^A\\s+(one|two|three|four|five|six|\\d+)\\s+(bed|studio)/i.test(address)) {
          // Try h3 which often has the real address on EIG sites like Harmanhealy
          const h3El = card.querySelector('h3');
          if (h3El && h3El !== addrEl) {
            const h3Text = h3El.textContent.trim().replace(/\\u00a0/g, ' ');
            if (h3Text && h3Text.length >= 10 && /[A-Z]{1,2}\\d/.test(h3Text)) address = h3Text;
          }
        }
        if (!address) {
          // Fallback: find postcode line in text
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 5);
          for (const l of lines) {
            if (l.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && l.length < 200) { address = l; break; }
          }
        }
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        // Price — "Guide Price*: £165,000 plus"
        let price = null;
        const priceMatch = text.match(/(?:Guide Price|Minimum Opening)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // URL
        let url = '';
        const link = card.querySelector('a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        else if (card.tagName === 'A') url = card.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        // Bullets — end time
        const bullets = [];
        const endMatch = text.match(/End Time[^\\d]*(\\d{2}\\/\\d{2}\\/\\d{4}\\s*\\d{2}:\\d{2})/i);
        if (endMatch) bullets.push('End Time: ' + endMatch[1]);
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bAuction Ended\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── SEEL & CO ─────────────────────────────────────────────
  // online.seelauctions.co.uk — Cardiff, EIG platform (tenant 46).
  // Cards are a[href*="/lot/details/"] with h4 address, Guide Price in text.
  seelauctions: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Seel Auctions 2026: EIG platform — try multiple card selectors
      let cards = document.querySelectorAll('.lot-panel');
      if (cards.length === 0) cards = document.querySelectorAll('[data-lot-item-toggle]');
      if (cards.length === 0) cards = document.querySelectorAll('a[href*="/lot/details/"]');
      if (cards.length === 0) cards = document.querySelectorAll('.grid-item, [class*="lot-card"], [class*="property-card"]');
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10 || text.length > 3000) continue;
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        if (seen.has(num)) continue;
        seen.add(num);
        // Address
        let address = '';
        const addrEl = card.querySelector('h4.grid-address, .lot-address, [data-address-searchable], h4, h3, .address');
        if (addrEl) address = addrEl.textContent.trim().replace(/\\u00a0/g, ' ');
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 5 && s.length < 200);
          for (const l of lines) {
            if (l.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i)) { address = l; break; }
          }
        }
        if (!address || address.length < 5) continue;
        // Price
        let price = null;
        const priceMatch = text.match(/(?:Guide Price|Opening Bid)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // URL
        let url = '';
        const link = card.querySelector('a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        else if (card.tagName === 'A') url = card.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img.grid-img, img.img-responsive, img[src]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
        }
        const bullets = [];
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bPostponed\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: num, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── ROBINSON & HALL ───────────────────────────────────────
  // robinsonandhallauctions.co.uk — WordPress/Elementor + EIG.
  // Cards are article.ae-post-item with a.ae-element-custom-field (address).
  robinsonhall: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('article.ae-post-item, [data-source="ams-property"] article');
      // Helper: extract per-card image, rejecting duplicates (prevents image bleed)
      function extractCardImg(card, usedImages) {
        const imgs = card.querySelectorAll('img');
        for (const img of imgs) {
          const s = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
          if (s && s.length > 10 && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && !s.includes('gavel') && !s.includes('backdrop') && !s.includes('placeholder')) {
            if (!usedImages.has(s)) { usedImages.add(s); return s; }
          }
        }
        return '';
      }
      const usedImages = new Set();
      if (cards.length === 0) {
        // Fallback: find lot blocks by guide-price class
        const priceBlocks = document.querySelectorAll('.guide-price');
        for (const pb of priceBlocks) {
          const card = pb.closest('article, .elementor-section, .ae-post-item') || pb.parentElement?.parentElement;
          if (!card) continue;
          const text = card.textContent || '';
          let address = '';
          const addrLink = card.querySelector('a.ae-element-custom-field');
          if (addrLink) address = addrLink.textContent.trim();
          if (!address || address.length < 5) continue;
          let price = null;
          const pm = text.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
          let url = addrLink ? addrLink.getAttribute('href') || '' : '';
          let lotNum = lots.length + 1;
          const lotEl = card.querySelector('.lot-block .ae-element-custom-field');
          if (lotEl) lotNum = parseInt(lotEl.textContent.trim()) || lotNum;
          const imageUrl = extractCardImg(card, usedImages);
          const bullets = [];
          const desc = card.querySelector('.property-strapline');
          if (desc) bullets.push(desc.textContent.trim().substring(0, 200));
          if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
            if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
          }
          lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        }
        return lots;
      }
      for (const card of cards) {
        const text = card.textContent || '';
        let address = '';
        const addrLink = card.querySelector('a.ae-element-custom-field');
        if (addrLink) address = addrLink.textContent.trim();
        if (!address || address.length < 5) continue;
        let price = null;
        const pm = text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        let url = addrLink ? addrLink.getAttribute('href') || '' : '';
        let lotNum = lots.length + 1;
        const lotEl = card.querySelector('.lot-block .ae-element-custom-field');
        if (lotEl) lotNum = parseInt(lotEl.textContent.trim()) || lotNum;
        const imageUrl = extractCardImg(card, usedImages);
        const bullets = [];
        const desc = card.querySelector('.property-strapline');
        if (desc) bullets.push(desc.textContent.trim().substring(0, 200));
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      // Deduplicate by address (Elementor repeaters duplicate cards)
      const seen = new Set();
      return lots.filter(l => {
        const key = l.address.toLowerCase().replace(/\\s+/g, ' ');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })()
  `,

  // ── EIG PLATFORM (reusable for any EIG-hosted house) ──
  eigplatform: `
    (() => {
      const lots = [];
      // Strategy 1: lot-panel cards (grid/list view)
      let cards = document.querySelectorAll('.lot-panel');
      if (cards.length === 0) cards = document.querySelectorAll('[data-lot-item-toggle]');
      // Strategy 2: find lot links, dedupe by href, walk up to parent container
      if (cards.length === 0) {
        const links = document.querySelectorAll('a[href*="/lot/details/"]');
        const seen = new Set();
        const containers = [];
        for (const a of links) {
          const href = a.getAttribute('href');
          if (!href || seen.has(href)) continue;
          seen.add(href);
          // Walk up to find the lot container — try grandparent or great-grandparent
          let container = a.parentElement;
          // Keep walking up while container has little text (probably just wraps the link)
          for (let i = 0; i < 3 && container && container.textContent.length < 50; i++) {
            container = container.parentElement;
          }
          if (container) containers.push(container);
        }
        cards = containers;
      }
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10) continue;
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:Guide Price|Opening Bid|Minimum Opening Bid)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        // Address from known selectors — try specific selectors first, then generic
        let address = '';
        const addrEl = card.querySelector('h3.list-address') || card.querySelector('h4.grid-address')
          || card.querySelector('.lot-address') || card.querySelector('[data-address-searchable]')
          || card.querySelector('h4.lot-data-heading')
          || card.querySelector('h3') || card.querySelector('h4');
        if (addrEl) address = addrEl.textContent.trim().replace(/\\u00a0/g, ' ');
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 5 && s.length < 200);
          for (const l of lines) {
            if (l.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i)) { address = l; break; }
          }
        }
        if (!address || address.length < 5) continue;
        let url = '';
        const link = card.querySelector('a[href*="/lot/details/"]');
        if (link) url = link.getAttribute('href') || '';
        else if (card.tagName === 'A') url = card.getAttribute('href') || '';
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img.list-image, img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        const bullets = [];
        const ribbon = card.querySelector('[data-ribbon]');
        if (ribbon) {
          const r = ribbon.getAttribute('data-ribbon') || '';
          if (/sold|completed|exchanged/i.test(r)) continue;
          if (r) bullets.push(r);
        } else if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b|\\bExchanged\\b/i)) continue;
        // Extract bedrooms from card text (e.g. "3 Bedroom", "2 bed", "4-bed")
        const bedMatch = text.match(/(\\d+)\\s*[-\\s]?(?:bed(?:room)?s?)\\b/i);
        const beds = bedMatch ? parseInt(bedMatch[1]) : null;
        const entry = { lot: num, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined };
        if (beds) entry.beds = beds;
        lots.push(entry);
      }
      return lots;
    })()
  `,

  // ── AUCTION HOUSE UK TEMPLATE (auctionhouse.co.uk branches) ──
  auctionhouseuk: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.lot-search-result, .lot-search-wrapper');
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10) continue;
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/Guide[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const addrEl = card.querySelector('p.grid-address, .grid-address');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address) {
          const typeEl = card.querySelector('p.fw-bold.blue-text');
          if (typeEl) address = typeEl.textContent.trim();
        }
        if (!address || address.length < 5) continue;
        let url = '';
        const link = card.querySelector('a[href*="/auction/lot/"], a.home-lot-wrapper-link');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const img = card.querySelector('img.lot-image, img[loading="lazy"]');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        // Skip sold/completed lots — search results include historical
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b|\\bExchanged\\b/i)) continue;
        const ribbon = card.querySelector('.lot-tag, .ribbon, [data-ribbon]');
        if (ribbon && /sold|completed|exchanged/i.test(ribbon.textContent || ribbon.getAttribute('data-ribbon') || '')) continue;
        const bullets = [];
        lots.push({ lot: num, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── GOLDINGS (goldingsauctions.co.uk) ──
  // Clean BEM structure: div.property-card with data-lotid
  goldings: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.property-card, .block-lot-listing__lot');
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10) continue;
        let lotNum = lots.length + 1;
        const lotEl = card.querySelector('.property-card__lot-no strong');
        if (lotEl) lotNum = parseInt(lotEl.textContent.trim()) || lotNum;
        let address = '';
        const addrEl = card.querySelector('.property-card__additional-meta__address');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address || address.length < 5) continue;
        let price = null;
        const priceEl = card.querySelector('.property-card__meta-price span');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        let url = '';
        const link = card.querySelector('a[href*="/lot/"]');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const img = card.querySelector('.property-card__gallery-main-image img, .property-card__gallery img');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        const bullets = [];
        const tagline = card.querySelector('.property-card__additional-meta__tagline');
        if (tagline) bullets.push(tagline.textContent.trim().substring(0, 200));
        const soldFlag = card.querySelector('.property-card__sold-flag');
        if (soldFlag || text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bCompleted\\b/i)) continue;
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── DAWSONS (dawsonsproperty.co.uk) ──
  // Bootstrap layout with div.homes-content for each lot, images in sibling col within same .row
  dawsons: `
    (() => {
      const lots = [];
      const usedImages = new Set();
      const contentBlocks = document.querySelectorAll('.homes-content');
      for (const block of contentBlocks) {
        const text = block.textContent || '';
        if (text.length < 10) continue;
        let address = '';
        const h3 = block.querySelector('h3');
        if (h3) address = h3.textContent.trim();
        if (!address || address.length < 5) continue;
        let price = null;
        const priceEl = block.querySelector('.price-properties .title, .price-properties h3');
        if (priceEl) {
          const pm = priceEl.textContent.match(/([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        let url = '';
        const link = block.querySelector('a[href*="/auction/"]');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        // Strategy 1: image inside the block itself
        let img = block.querySelector('img.d-block, img.img-fluid, img[src*="auction"], img[src*="/assets/"]');
        // Strategy 2: sibling column in the same .row (each lot has its own .row)
        if (!img) {
          const row = block.closest('.row');
          if (row) {
            // Find images NOT inside this block (sibling col)
            const allImgs = row.querySelectorAll('img.d-block, img.img-fluid, img[src*="auction"], img[src*="/assets/"]');
            for (const candidate of allImgs) {
              if (!block.contains(candidate)) {
                const src = candidate.getAttribute('src') || '';
                // Skip if this exact image was already assigned to another lot
                if (src && !usedImages.has(src)) { img = candidate; break; }
              }
            }
          }
        }
        if (img) {
          const src = img.getAttribute('src') || '';
          if (src && !usedImages.has(src)) {
            imageUrl = src;
            usedImages.add(src);
          }
        }
        const bullets = [];
        const beds = block.querySelector('.fa-bed');
        if (beds && beds.nextElementSibling) bullets.push(beds.nextElementSibling.textContent.trim() + ' bed');
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lots.length + 1, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── DURRANTS (durrants.com) ──
  // Elementor page builder — lots are manual sections with elementor-icon-list-text containing "Lot N"
  durrants: `
    (() => {
      const lots = [];
      // Find all "Lot N" markers
      const lotMarkers = document.querySelectorAll('.elementor-icon-list-text');
      for (const marker of lotMarkers) {
        const lotMatch = marker.textContent.match(/Lot\\s*(\\d+)/i);
        if (!lotMatch) continue;
        const lotNum = parseInt(lotMatch[1]);
        // Walk up to the container section
        const section = marker.closest('.e-con, .elementor-section, .elementor-element');
        if (!section) continue;
        const text = section.textContent || '';
        // Address and price are in <p><strong> tags within text-editor widgets
        let address = '', price = null;
        const strongs = section.querySelectorAll('.elementor-widget-text-editor p strong, .elementor-text-editor p strong');
        for (const s of strongs) {
          const t = s.textContent.trim();
          const priceM = t.match(/(?:Guide Price|Auction Guide Price)[^£]*£([\\d,]+)/i);
          if (priceM) { price = parseInt(priceM[1].replace(/,/g, '')); continue; }
          if (t.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && !address) { address = t; }
        }
        if (!address || address.length < 5) continue;
        let url = '';
        const link = section.querySelector('a[href*="/property/"], a.elementor-button');
        if (link) url = link.getAttribute('href') || '';
        let imageUrl = '';
        const img = section.querySelector('img[src*="durrants"], img[src*="property"]');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        const bullets = [];
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Agents Property Auction (WordPress, agentspropertyauction.com) ──
  // Cards: article.card--property inside div.card-grid-item
  // Lot: span.pill--pink ("Lot 1"), Address: h3.card-title--property a, Price: p.card-price
  // Image: background-image on div.card-img-bg, Link: a.u-link-cover
  agentsproperty: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('div.card-grid-item');
      for (const card of cards) {
        // Lot number from pill badge
        let lotNum = 0;
        const pill = card.querySelector('span.pill--pink, span.card-img-meta');
        if (pill) {
          const m = (pill.textContent || '').match(/Lot\\s+(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        // Address from title link
        let address = '';
        const titleLink = card.querySelector('h3.card-title--property a, h3.card-title a');
        if (titleLink) address = (titleLink.textContent || '').replace(/<br\\s*\\/?>/gi, ', ').trim();
        if (!address || address.length < 5) continue;
        // Price from p.card-price
        let price = null;
        const priceEl = card.querySelector('p.card-price');
        if (priceEl) {
          const pm = (priceEl.textContent || '').match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Image: CSS background-image on div.card-img-bg
        let imageUrl = '';
        const imgBg = card.querySelector('div.card-img-bg');
        if (imgBg) {
          const style = imgBg.getAttribute('style') || '';
          const urlMatch = style.match(/url\\(([^)]+)\\)/);
          if (urlMatch) imageUrl = urlMatch[1].replace(/['"]/g, '');
        }
        // Detail link
        let url = '';
        const detailLink = card.querySelector('a.u-link-cover, h3.card-title--property a');
        if (detailLink) url = detailLink.getAttribute('href') || '';
        // Bullets from card-excerpt
        const bullets = [];
        const excerpt = card.querySelector('div.card-excerpt');
        if (excerpt) {
          const t = (excerpt.textContent || '').trim();
          const bedMatch = t.match(/(\\d+)\\s*Bed/i);
          if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
          const bathMatch = t.match(/(\\d+)\\s*Bath/i);
          if (bathMatch) bullets.push(bathMatch[1] + ' bathrooms');
          const recMatch = t.match(/(\\d+)\\s*Recep/i);
          if (recMatch) bullets.push(recMatch[1] + ' receptions');
        }
        // Status
        const banner = card.querySelector('span.card-img-banner');
        if (banner) {
          const status = (banner.textContent || '').trim();
          if (status && status !== 'Upcoming') bullets.push(status);
        }
        if (seen.has(address)) continue;
        seen.add(address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Andrew Craig (Estate Apps platform, andrewcraig.co.uk) ──
  // Cards: div.card[data-id], Address: div.card-content > a.card-image-container (text)
  // Price: span.price-value, Image: img[data-src] (lazy loaded), Link: a.card-image-container[href]
  // Pagination: ?page=N, No lot numbers — uses property IDs
  andrewcraig: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('div.card[data-id]');
      let lotNum = 0;
      for (const card of cards) {
        // Skip CTA cards
        if (card.classList.contains('card--property-worth')) continue;
        lotNum++;
        // Address from the text link in card-content
        let address = '';
        const addrLink = card.querySelector('div.card-content > a.card-image-container');
        if (addrLink) address = (addrLink.textContent || '').trim();
        // Clean "X bed Y for sale in" prefix
        address = address.replace(/^\\d+\\s+bed\\s+\\w+\\s+for\\s+sale\\s+in\\s+/i, '').trim();
        if (!address || address.length < 5) continue;
        // Price from span.price-value
        let price = null;
        const priceEl = card.querySelector('span.price-value');
        if (priceEl) {
          const pm = (priceEl.textContent || '').match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Image: data-src (lazy loaded with base64 placeholder in src)
        let imageUrl = '';
        const img = card.querySelector('div.card-image img');
        if (img) {
          imageUrl = img.getAttribute('data-src') || '';
          if (!imageUrl || imageUrl.startsWith('data:')) imageUrl = img.getAttribute('src') || '';
          if (imageUrl.startsWith('data:')) imageUrl = '';
        }
        // Detail link
        let url = '';
        const link = card.querySelector('a.card-image-container');
        if (link) url = link.getAttribute('href') || '';
        // Bullets: bedroom/bathroom counts from span.number elements
        const bullets = [];
        const numbers = card.querySelectorAll('div.card-content__detail__left span.number');
        if (numbers.length >= 1) bullets.push(numbers[0].textContent.trim() + ' bedrooms');
        if (numbers.length >= 2) bullets.push(numbers[1].textContent.trim() + ' bathrooms');
        if (numbers.length >= 3) bullets.push(numbers[2].textContent.trim() + ' receptions');
        // Property tag (e.g. "Land")
        const tag = card.querySelector('span.property-tag');
        if (tag) bullets.push((tag.textContent || '').trim());
        if (seen.has(address)) continue;
        seen.add(address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Butters John Bee (Rex Software v2 platform, buttersjohnbee.com) ──
  // Cards: h4 address headings near a[href*="/listings/"] links
  // Image in sibling <a> with img, Price in text, Pagination: ?page=N
  buttersjohnbee: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Find all h4 elements that look like addresses (near listing links)
      const h4s = document.querySelectorAll('h4');
      let lotNum = 0;
      for (const h4 of h4s) {
        const t = (h4.textContent || '').trim();
        if (t.length < 5 || t.length > 200) continue;
        if (t.match(/^\\d+$/) || t.match(/^(Guide|£|Auction|Search|Filter|Sort)/i)) continue;
        // Walk up to find parent container with listing link
        let container = h4.parentElement;
        let link = null;
        for (let i = 0; i < 8 && container; i++) {
          link = container.querySelector('a[href*="/listings/"]');
          if (link) break;
          container = container.parentElement;
        }
        if (!link) continue;
        const href = link.getAttribute('href') || '';
        if (!href.match(/\\/listings\\//)) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        lotNum++;
        // Price from container text
        let price = null;
        const cText = container ? (container.textContent || '') : '';
        const pm = cText.match(/(?:Guide\\s*Price\\s*)?£([\\d,]+)/i);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        // Image from the img link
        let imageUrl = '';
        if (container) {
          const img = container.querySelector('img');
          if (img) imageUrl = getBestImgSrc(img);
          if (isJunkImage(imageUrl)) imageUrl = '';
          if (!imageUrl) imageUrl = extractCardImage(container);
        }
        // Bullets from text
        const bullets = [];
        const bedMatch = cText.match(/(\\d+)\\s*bed/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        const bathMatch = cText.match(/(\\d+)\\s*bath/i);
        if (bathMatch) bullets.push(bathMatch[1] + ' bathrooms');
        lots.push({ lot: lotNum, address: t.substring(0, 200), price, url: href, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Cheffins (cheffins.co.uk, EIG-based catalogue pages) ──
  // Cards: div.property-card, Lot: div.pc-tag ("Lot number: N"), Address: div.pc-add
  // Price: div.pc-price, Image: div.pc-slide div[data-img] (EIG CDN), Link: a.btn--alt
  cheffins: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('div.property-card');
      for (const card of cards) {
        // Lot number from pc-tag
        let lotNum = 0;
        const tag = card.querySelector('div.pc-tag');
        if (tag) {
          const m = (tag.textContent || '').match(/Lot\\s*(?:number)?:?\\s*(\\d+)/i);
          if (m) lotNum = parseInt(m[1]);
        }
        // Address from pc-add
        let address = '';
        const addrEl = card.querySelector('div.pc-add');
        if (addrEl) address = (addrEl.textContent || '').trim();
        if (!address || address.length < 5) continue;
        // Price from pc-price
        let price = null;
        const priceEl = card.querySelector('div.pc-price');
        if (priceEl) {
          const pt = (priceEl.textContent || '').trim();
          const pm = pt.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Image: data-img attribute on slider divs (EIG CDN)
        let imageUrl = '';
        const imgDiv = card.querySelector('div.pc-slide > div[data-img]');
        if (imgDiv) imageUrl = imgDiv.getAttribute('data-img') || '';
        // Detail link
        let url = '';
        const detailBtn = card.querySelector('a.btn--alt, a.btn');
        if (detailBtn) url = detailBtn.getAttribute('href') || '';
        // Bullets: status from pc-extraInfo
        const bullets = [];
        const extraInfo = card.querySelector('div.pc-extraInfo');
        if (extraInfo) {
          const status = (extraInfo.textContent || '').trim();
          if (status && status !== 'New') bullets.push(status);
        }
        // Description summary
        const summ = card.querySelector('div.pc-summ');
        if (summ) {
          const st = (summ.textContent || '').trim();
          if (st.match(/\\bland\\b/i)) bullets.push('Land');
          if (st.match(/\\bgarage\\b/i)) bullets.push('Garage');
          if (st.match(/\\bbarn\\b/i)) bullets.push('Barn');
          const bedMatch = st.match(/(\\d+)\\s*(?:bed|Bed)/i);
          if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        }
        if (seen.has(address)) continue;
        seen.add(address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Feather Smailes & Scales (fssproperty.co.uk, same CMS as Hollis Morgan) ──
  fssproperty: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('#search-results .property, .property');
      let lotNum = 0;
      for (const card of cards) {
        lotNum++;
        const text = card.textContent || '';
        // Lot number from description
        const lotMatch = text.match(/LOT\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Address from first h3 > a[href*="/property-details/"]
        let address = '';
        const addrLink = card.querySelector('a[href*="/property-details/"]');
        if (addrLink) address = (addrLink.textContent || '').trim();
        if (!address || address.length < 5) continue;
        // Price from second h3
        let price = null;
        const h3s = card.querySelectorAll('h3');
        for (const h of h3s) {
          const t = (h.textContent || '').trim();
          const pm = t.match(/£([\\d,]+)/);
          if (pm) { price = parseInt(pm[1].replace(/,/g, '')); break; }
        }
        // Image: /resize/ pattern (same as Hollis Morgan)
        let imageUrl = '';
        const img = card.querySelector('img[src*="/resize/"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // URL
        let url = '';
        if (addrLink) url = addrLink.getAttribute('href') || '';
        const bullets = [];
        const bedMatch = text.match(/(\\d+)\\s*(?:bed|Bed)/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        if (seen.has(address)) continue;
        seen.add(address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── iamsold (server-rendered with data-bkimage for images) ──
  iamsold: `
    (() => {
      const lots = [];
      const seen = new Set();
      // iamsold uses div.c__property cards with structured content
      const cards = document.querySelectorAll('.c__property, .c__propertyAlt');
      let lotNum = 0;
      for (const card of cards) {
        lotNum++;
        const text = card.textContent || '';
        // Address from .c__property__address (contains bed count + street + area + postcode)
        let address = '';
        const addrEl = card.querySelector('.c__property__address');
        if (addrEl) {
          address = (addrEl.textContent || '').replace(/\\s+/g, ' ').trim();
          // Remove leading "X bed Type" prefix (e.g. "2 bed Apartment")
          address = address.replace(/^\\d+\\s+bed\\s+\\w+\\s*/i, '').trim();
        }
        if (!address || address.length < 5) {
          // Fallback: try link slug
          const link = card.querySelector('a[href*="/property/"]');
          if (link) {
            const href = link.getAttribute('href') || '';
            const slug = href.split('/property/')[1];
            if (slug) address = slug.replace(/\\/$/, '').replace(/-/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase());
          }
        }
        if (!address || address.length < 5) continue;
        // Price from tags or status text
        let price = null;
        const tags = card.querySelectorAll('.c__property__tags li, .c__property__infoPoints li');
        for (const tag of tags) {
          const tm = (tag.textContent || '').match(/(?:Starting\\s*bid|Guide\\s*Price)[:\\s]*£([\\d,]+)/i);
          if (tm) { price = parseInt(tm[1].replace(/,/g, '')); break; }
        }
        if (!price) {
          const pm = text.match(/(?:Starting\\s*bid|Guide\\s*Price)[:\\s]*£([\\d,]+)/i);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        if (!price) {
          const pm = text.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Image from data-bkimage (cloudfront CDN)
        let imageUrl = '';
        const bkImg = card.querySelector('[data-bkimage]');
        if (bkImg) imageUrl = bkImg.getAttribute('data-bkimage') || '';
        if (!imageUrl) {
          const webpAlt = card.querySelector('[data-webpalt]');
          if (webpAlt) imageUrl = webpAlt.getAttribute('data-webpalt') || '';
        }
        if (!imageUrl) imageUrl = extractCardImage(card);
        // URL
        let url = '';
        const link = card.querySelector('a[href*="/property/"]');
        if (link) url = link.getAttribute('href') || '';
        // Bullets
        const bullets = [];
        const bedMatch = text.match(/(\\d+)\\s*bed/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        const typeMatch = text.match(/\\b(Detached|Semi-Detached|Terrace|Flat|Apartment|Bungalow|House|Cottage|Land|Commercial)\\b/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        // Status tag
        const statusEl = card.querySelector('.c__property__status');
        if (statusEl) {
          const st = (statusEl.textContent || '').trim();
          if (st && st !== 'Available') bullets.push(st);
        }
        if (seen.has(url || address)) continue;
        seen.add(url || address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Wilsons Auctions (wilsonsauctions.com — l-grid__item cards) ──
  wilsons: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.l-grid__item a[href*="/lots/"]');
      let lotNum = 0;
      for (const link of cards) {
        const href = link.getAttribute('href') || '';
        if (!href || seen.has(href)) continue;
        seen.add(href);
        lotNum++;
        const card = link.closest('.l-grid__item') || link;
        const text = card.textContent || '';
        let address = '';
        const heading = card.querySelector('h3, h2, h4');
        if (heading) address = (heading.textContent || '').trim();
        if (!address || address.length < 5) continue;
        let price = null;
        const pm = text.match(/(?:Guide|Reserve|Starting)[:\\s]*£([\\d,]+)/i);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        if (!price) { const gm = text.match(/£([\\d,]+)/); if (gm) price = parseInt(gm[1].replace(/,/g, '')); }
        let imageUrl = '';
        const img = card.querySelector('img');
        if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
        const bullets = [];
        const bedMatch = text.match(/(\\d+)\\s*Bed/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        const typeMatch = text.match(/\\b(House|Flat|Apartment|Bungalow|Land|Commercial|Cottage|Farm)\\b/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url: href, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Strakers (strakers.co.uk — .card.card-auction cards) ──
  strakers: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.card-auction, .card[class*="auction"]');
      let lotNum = 0;
      for (const card of cards) {
        lotNum++;
        const text = card.textContent || '';
        let address = '';
        const heading = card.querySelector('h5 a, h4 a, h3 a');
        if (heading) address = (heading.textContent || '').trim();
        if (!address) {
          const h = card.querySelector('h5, h4, h3');
          if (h) address = (h.textContent || '').trim();
        }
        if (!address || address.length < 5) continue;
        let price = null;
        const priceEl = card.querySelector('.card__price');
        if (priceEl) {
          const pm = (priceEl.textContent || '').match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        if (!price) { const pm = text.match(/£([\\d,]+)/); if (pm) price = parseInt(pm[1].replace(/,/g, '')); }
        let imageUrl = '';
        const img = card.querySelector('.card__head img');
        if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (!imageUrl) { const anyImg = card.querySelector('img'); if (anyImg) imageUrl = anyImg.getAttribute('src') || ''; }
        let url = '';
        const link = card.querySelector('a[href]');
        if (link) url = link.getAttribute('href') || '';
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const lot = lotMatch ? lotMatch[1] : String(lotNum);
        if (seen.has(url || address)) continue;
        seen.add(url || address);
        lots.push({ lot, address: address.substring(0, 200), price, url, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── Under The Hammer (Next.js SPA — underthehammer.com) ──
  // React SPA, no server-rendered lot cards. The site uses /for-auction/properties
  // which loads property data via client-side JS. DOM extractor will return <3 lots,
  // triggering the Gemini AI fallback which handles JS-rendered content via Firecrawl.
  underthehammer: `
    (() => {
      const lots = [];
      const seen = new Set();
      // UTH renders property cards client-side, but attempt to catch any SSR content
      // Look for any property links with /for-auction/ pattern
      const links = document.querySelectorAll('a[href*="/for-auction/"]');
      let lotNum = 0;
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (!href || href === '/for-auction/properties' || seen.has(href)) continue;
        if (!href.match(/\\/for-auction\\/[a-z0-9-]+$/i)) continue;
        seen.add(href);
        lotNum++;
        // Walk up to find the card container
        let card = link;
        for (let i = 0; i < 6 && card.parentElement; i++) {
          card = card.parentElement;
          const cl = (card.className || '').toLowerCase();
          if (cl.match(/card|property|listing|item|result/) || card.tagName === 'ARTICLE') break;
        }
        const text = card.textContent || '';
        // Address from heading or text
        let address = '';
        const heading = card.querySelector('h2, h3, h4');
        if (heading) address = (heading.textContent || '').trim();
        if (!address || address.length < 5) {
          // Try link title
          const title = link.getAttribute('title') || link.textContent.trim();
          if (title && title.length > 5) address = title;
        }
        if (!address || address.length < 5) continue;
        // Price
        let price = null;
        const pm = text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="property"], img[src*="blob.core.windows.net"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        if (!imageUrl) {
          const anyImg = card.querySelector('img[alt]');
          if (anyImg) {
            const srcset = anyImg.getAttribute('srcset') || '';
            const urlMatch = srcset.match(/url=([^&]+)/);
            if (urlMatch) { try { imageUrl = decodeURIComponent(urlMatch[1]); } catch(e) {} }
            if (!imageUrl) imageUrl = anyImg.getAttribute('src') || '';
          }
        }
        // Bullets
        const bullets = [];
        const bedMatch = text.match(/(\\d+)\\s*bed/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        const typeMatch = text.match(/\\b(Detached|Semi-Detached|Terrace|Flat|Apartment|Bungalow|House|Cottage|Land|Commercial)\\b/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url: href, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── SYMONDS & SAMPSON ─────────────────────────────────────
  // WebDadi platform — event detail pages serve lots in FeaturedGrid cards
  // Each card: a.FeaturedGrid__item with data-bg image, h3 address, nativecurrencyvalue price
  symondsandsampson: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.FeaturedGrid__item-container, .FeaturedGrid__item');
      let lotNum = 0;
      for (const card of cards) {
        const link = card.tagName === 'A' ? card : card.querySelector('a.FeaturedGrid__item, a[href*="/property/"]');
        if (!link) continue;
        const href = link.getAttribute('href') || '';
        if (!href.includes('/property/') || href.includes('property-for-sale') || href.includes('property-to-rent')) continue;
        lotNum++;
        // Address from first h3 inside FeaturedProperty__description
        const descDiv = link.querySelector('.FeaturedProperty__description');
        const h3s = descDiv ? descDiv.querySelectorAll('h3') : link.querySelectorAll('h3');
        let address = '';
        if (h3s.length > 0) {
          address = h3s[0].textContent.trim();
        }
        if (!address) continue;
        // Price from .nativecurrencyvalue
        let price = null;
        const priceEl = link.querySelector('.nativecurrencyvalue');
        if (priceEl) {
          const pm = priceEl.textContent.replace(/[^0-9]/g, '');
          if (pm) price = parseInt(pm);
        }
        // Image from data-bg on .FeaturedProperty__featured-image
        let imageUrl = '';
        const imgDiv = link.querySelector('.FeaturedProperty__featured-image, [data-bg]');
        if (imgDiv) imageUrl = imgDiv.getAttribute('data-bg') || '';
        if (!imageUrl) {
          const img = link.querySelector('img[src*="cdn.webdadi.net"]');
          if (img) imageUrl = img.getAttribute('src') || '';
        }
        // Property type from URL path
        const bullets = [];
        const typeMatch = href.match(/\\/(house|flat|land|bungalow|detached|semi-detached|terraced|cottage|studio|other|barn|garage|maisonette|commercial)[\\/]/i);
        if (typeMatch) bullets.push(typeMatch[1].charAt(0).toUpperCase() + typeMatch[1].slice(1));
        const bedMatch = href.match(/(\\d+)-bedroom/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        lots.push({ lot: lotNum, address, price, url: href, imageUrl: imageUrl || undefined, bullets });
      }
      return lots;
    })()
  `,

  // ─── STAGS / GTH (HOMEFLOW SPA) ───────────────────────────
  // Homeflow platform renders property cards after JS hydration
  // Cards: .property-card or li with .list-address + .list-price
  stags: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Try multiple Homeflow card selectors
      const cards = document.querySelectorAll('.property-results-list li, .property-card, [class*="property"] li');
      let lotNum = 0;
      for (const card of cards) {
        // Address
        const addrEl = card.querySelector('.list-address, h3 a, .property-title, .address');
        if (!addrEl) continue;
        const address = addrEl.textContent.trim();
        if (!address || address.length < 5) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        lotNum++;
        // Price
        let price = null;
        const priceEl = card.querySelector('.list-price, .price, [class*="price"]');
        if (priceEl) {
          const pm = priceEl.textContent.replace(/[^0-9]/g, '');
          if (pm && pm.length >= 4) price = parseInt(pm);
        }
        // URL
        let url = '';
        const link = addrEl.tagName === 'A' ? addrEl : (card.querySelector('a[href*="/properties/"]') || card.querySelector('a[href]'));
        if (link) url = link.getAttribute('href') || '';
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="homeflow-assets"], img[src*="cdn"], img[data-src]');
        if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
        const bgEl = card.querySelector('[style*="background"]');
        if (!imageUrl && bgEl) {
          const bgMatch = (bgEl.getAttribute('style') || '').match(/url\\(['"]?([^'"\\)]+)/);
          if (bgMatch) imageUrl = bgMatch[1];
        }
        // Bullets from property type badges or text
        const bullets = [];
        const typeEl = card.querySelector('.property-type, .type');
        if (typeEl) bullets.push(typeEl.textContent.trim());
        const bedEl = card.querySelector('.beds, .bedrooms, [class*="bed"]');
        if (bedEl) {
          const bm = bedEl.textContent.match(/(\\d+)/);
          if (bm) bullets.push(bm[1] + ' bedrooms');
        }
        lots.push({ lot: lotNum, address, price, url, imageUrl: imageUrl || undefined, bullets });
      }
      return lots;
    })()
  `,

};

// ── SHONKI BROTHERS ──
// Own site hosts lots from EIG backend. Cards at /auctions/latest-auctions/view
DOM_EXTRACTORS['shonkibros'] = `
  (() => {
    const lots = [];
    const cards = document.querySelectorAll('.auction-image-container, .flat-item');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      const lotMatch = text.match(/Lot\\s*(?:number)?[:\\s]*(\\d+)/i);
      const num = lotMatch ? parseInt(lotMatch[1]) : idx;
      const heading = card.querySelector('h5 a strong, h5 a, h4 a, h3 a');
      const address = heading ? heading.textContent.trim() : '';
      if (!address || address.length < 5) { idx++; continue; }
      const priceEl = card.querySelector('.price, span.price');
      const priceMatch = (priceEl ? priceEl.textContent : text).match(/£([\\d,]+)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
      const link = card.querySelector('a[href*="/auctions/lot/"], a[href*="/lot/details/"]');
      const url = link ? link.getAttribute('href') : '';
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || '';
        if (s && s.length > 10 && !s.includes('logo') && !s.includes('icon')) imageUrl = s;
      }
      lots.push({ lot: num, address, price, url, imageUrl: imageUrl || undefined });
      idx++;
    }
    return lots;
  })()
`;

// ── BAGSHAWS ──
// Ancient table-based layout. Images in one row, text in next row, 4 lots per row pair.
DOM_EXTRACTORS['bagshaws'] = `
  (() => {
    const lots = [];
    // Find all links to barnardmarcusauctions containing "Lot NNN"
    const lotLinks = document.querySelectorAll('a[href*="barnardmarcusauctions"], a[href*="/auctions/"]');
    const seen = new Set();
    for (const link of lotLinks) {
      const strong = link.querySelector('strong') || link;
      const lotMatch = (strong.textContent || '').match(/Lot\\s+(\\d+)/i);
      if (!lotMatch) continue;
      const num = parseInt(lotMatch[1]);
      if (seen.has(num)) continue;
      seen.add(num);
      const url = link.getAttribute('href') || '';
      // The parent <td> contains address and price as text nodes
      const td = link.closest('td');
      if (!td) continue;
      const tdText = td.textContent || '';
      // Address: everything between "Lot NNN" and "Guide:"
      const addrMatch = tdText.match(/Lot\\s+\\d+\\s*(.+?)\\s*Guide/is);
      const address = addrMatch ? addrMatch[1].replace(/\\s+/g, ' ').trim() : '';
      if (!address || address.length < 5) continue;
      const priceMatch = tdText.match(/£([\\d,]+)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
      // Image: find img in same row or previous row linking to same lot URL
      let imageUrl = '';
      const table = td.closest('table');
      if (table && url) {
        const imgLink = table.querySelector('a[href="' + url.replace(/"/g, '') + '"] img');
        if (imgLink) {
          const s = imgLink.getAttribute('src') || '';
          if (s && s.length > 5) imageUrl = s;
        }
      }
      lots.push({ lot: num, address, price, url, imageUrl: imageUrl || undefined });
    }
    return lots;
  })()
`;

// Wire up EIG house aliases to the shared eigplatform extractor
for (const slug of ['astleys', 'henrysykes', 'clarkesimpson', 'brownco', 'cheffinstimed', 'romanway', 'hammerprice', 'sarahmains', 'sageandco', 'auctiontrade', 'brggibson', 'higginsdrysdale', 'martinpole', 'jonespeckover', 'thepropertyauctionhouse', 'propertyauctionagent', 'lot9', 'auctionnorth', 'bowensonandwatson', 'sheldonbosley', 'nationalpropertyauctions', 'ahlondon', 'starpropertyonline', 'brggibsondublin', 'lsh', 'groundrentauctions', 'benjaminstevens']) {
  DOM_EXTRACTORS[slug] = DOM_EXTRACTORS.eigplatform;
}
// Wire up Bamboo Auctions platform houses to the shared hunters extractor
DOM_EXTRACTORS['lsk'] = DOM_EXTRACTORS.hunters;
// Wire up Sequence/Connells platform houses to the shared barnardmarcus extractor
DOM_EXTRACTORS['foxandsons'] = DOM_EXTRACTORS.barnardmarcus;
// Wire up iamsold platform houses
DOM_EXTRACTORS['driversnorris'] = DOM_EXTRACTORS.iamsold;
DOM_EXTRACTORS['wrightmarshall'] = DOM_EXTRACTORS.iamsold;
// Mark Jenkinson merged into BTG Eddisons (sdl)
DOM_EXTRACTORS['markjenkinson'] = DOM_EXTRACTORS.sdl;
// Scargill Mann uses SDL Auctions platform
DOM_EXTRACTORS['scargillmann'] = DOM_EXTRACTORS.sdl;
// Carter Jonas uses Bamboo Auctions platform (same as hunters)
DOM_EXTRACTORS['carterjonas'] = DOM_EXTRACTORS.hunters;
// All Wales Auction uses Bamboo via The Property People
DOM_EXTRACTORS['allwalesauction'] = DOM_EXTRACTORS.hunters;
// Rendells Devon uses Bamboo Auctions platform (same as hunters)
DOM_EXTRACTORS['rendells'] = DOM_EXTRACTORS.hunters;
// Cooper and Tanner uses EIG platform for auctions
DOM_EXTRACTORS['cooperandtanner'] = DOM_EXTRACTORS.eigplatform;
// GOTO Properties platform is EIG-based (purplebricks.gotoproperties.co.uk)
DOM_EXTRACTORS['purplebricksgoto'] = DOM_EXTRACTORS.eigplatform;
// GTH (Greenslade Taylor Hunt) uses Homeflow SPA platform (same as stags)
DOM_EXTRACTORS['gth'] = DOM_EXTRACTORS.stags;
// Clee Tompkinson Francis also uses Homeflow (same tag/auction URL pattern)
DOM_EXTRACTORS['cleetompkinson'] = DOM_EXTRACTORS.stags;
// John Francis uses Homeflow with /properties/sales/tag-auction URL
DOM_EXTRACTORS['johnfrancis'] = DOM_EXTRACTORS.stags;
// Bradleys Devon uses Homeflow with /properties/sales/tag-auction URL
DOM_EXTRACTORS['bradleysdevon'] = DOM_EXTRACTORS.stags;

// ─── PROPERTY SOLVERS ──────────────────────────────────────
// PropertyHive WordPress plugin, single page (no pagination), ~111 lots
DOM_EXTRACTORS['propertysolvers'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    // PropertyHive: lot cards inside .phive-results container
    const cards = document.querySelectorAll('.phive-results .row.property, .property-results .row.property, .propertyhive-property');
    let idx = 1;
    for (const card of cards) {
      // Address from h3 link inside details
      const addrLink = card.querySelector('.phive-details-inner h3 a, .details h3 a, h3 a');
      const address = addrLink ? addrLink.textContent.trim() : '';
      if (!address || address.length < 5) { idx++; continue; }
      // Lot detail URL
      const url = addrLink ? addrLink.getAttribute('href') || '' : '';
      if (seen.has(url)) continue;
      seen.add(url);
      // Price — strip qualifier spans, extract £ amount
      const priceEl = card.querySelector('.phive-details-inner .price, .details .price, .price');
      let price = null;
      if (priceEl) {
        const priceText = priceEl.textContent.replace(/\\s+/g, ' ').trim();
        const pm = priceText.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      // Image from thumbnail
      const img = card.querySelector('.phive-thumb img, .thumbnail img, img[src]');
      let imageUrl = '';
      if (img) {
        imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
      }
      // Bullets from CSS class metadata
      const bullets = [];
      const classList = card.className || '';
      if (/tenure-freehold/i.test(classList)) bullets.push('Freehold');
      if (/tenure-leasehold/i.test(classList)) bullets.push('Leasehold');
      if (/sale_by-unconditional/i.test(classList)) bullets.push('Unconditional');
      if (/sale_by-conditional/i.test(classList)) bullets.push('Conditional');
      if (/availability-sold/i.test(classList) || card.textContent.match(/\\bSOLD\\b|\\bSTC\\b/i)) bullets.push('SOLD/STC');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;
// ─── PUGH AUCTIONS ─────────────────────────────────────────
// Server-rendered Laravel, Tailwind CSS. ~1,193 lots across 60 pages.
// Part of BTG/SDL family but has own frontend with different selectors.
DOM_EXTRACTORS['pugh'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    // Pugh: property cards in grid layout
    const cards = document.querySelectorAll('div.grid > div.h-full.mb-8, div.grid > div.h-full');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      // Address from bold link inside card
      const addrLink = card.querySelector('div.text-white.uppercase.text-lg.font-bold a.block, div.uppercase a, h3 a, h2 a, a[href*="/property/"]');
      let address = addrLink ? addrLink.textContent.trim() : '';
      // Fallback: first link with substantial text
      if (!address) {
        const links = card.querySelectorAll('a');
        for (const lnk of links) {
          const t = lnk.textContent.trim();
          if (t.length > 10 && !t.match(/^(View|More|See|Back|Next|Previous)/i)) { address = t; break; }
        }
      }
      if (!address || address.length < 5) { idx++; continue; }
      // Lot URL
      let url = '';
      if (addrLink) url = addrLink.getAttribute('href') || '';
      if (!url) {
        const anyLink = card.querySelector('a[href*="/property/"], a[href*="pugh-auctions.com/property"]');
        if (anyLink) url = anyLink.getAttribute('href') || '';
      }
      if (seen.has(url) && url) { idx++; continue; }
      if (url) seen.add(url);
      // Lot number from text
      const lotMatch = text.match(/Lot\\s*(?:No\\.?)?\\s*(\\d+)/i);
      const lotNum = lotMatch ? parseInt(lotMatch[1]) : idx;
      // Price from bold span
      let price = null;
      const priceEl = card.querySelector('p.text-secondary span.text-xl, span.text-xl, .price');
      if (priceEl) {
        const pm = priceEl.textContent.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      if (!price) {
        const pm = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      // Image — BTG Eddisons CDN or local
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && s.length > 10 && !/logo|icon|placeholder|\\.svg/i.test(s)) imageUrl = s;
      }
      // Bullets — auction type, status
      const bullets = [];
      if (/\\bWithdrawn\\b|\\bSOLD\\b|\\bSTC\\b|\\bSale Agreed\\b/i.test(text)) bullets.push('SOLD/STC');
      if (/Timed\\s*Auction/i.test(text)) bullets.push('Timed Auction');
      if (/Live\\s*(Stream)?\\s*Auction/i.test(text)) bullets.push('Live Auction');
      const dateMatch = text.match(/(\\d{1,2}(?:st|nd|rd|th)?\\s+\\w+\\s+\\d{4})/i);
      if (dateMatch) bullets.push(dateMatch[1]);
      lots.push({ lot: lotNum, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// ─── PEARSONS ────────────────────────────────────────────────
// Custom Bootstrap site, server-rendered. ~22 lots, single page.
// Cards use .propertyBlock.auctions with background-image for photos.
DOM_EXTRACTORS['pearsons'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.propertyBlock.auctions');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      // Address from h3 link
      const addrEl = card.querySelector('.propTextHolder h3 a, h3 a');
      const address = addrEl ? addrEl.textContent.trim() : '';
      if (!address || address.length < 5) { idx++; continue; }
      // Detail link
      const url = addrEl ? addrEl.getAttribute('href') || '' : '';
      if (seen.has(url)) continue;
      seen.add(url);
      // Price from p.size18
      let price = null;
      const priceEl = card.querySelector('.propTextHolder p.size18, p.size18');
      if (priceEl) {
        const pm = priceEl.textContent.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      if (!price) {
        const pm = text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      // Image from background-image on .propImageHolder
      let imageUrl = '';
      const imgHolder = card.querySelector('.propImageHolder');
      if (imgHolder) {
        const style = imgHolder.getAttribute('style') || '';
        const bgMatch = style.match(/url\\(['"]?([^'"\\)]+)['"]?\\)/);
        if (bgMatch) imageUrl = bgMatch[1];
      }
      if (!imageUrl) {
        const img = card.querySelector('img[src]');
        if (img) imageUrl = img.getAttribute('src') || '';
      }
      // Bullets
      const bullets = [];
      const bedMatch = text.match(/(\\d+)\\s*bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      if (/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i.test(text)) bullets.push('SOLD/STC');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// ─── NESBITS ─────────────────────────────────────────────────
// WordPress custom theme, server-rendered. ~9 lots.
// Cards are <a href="/property/..."> wrappers with h4 for address.
DOM_EXTRACTORS['nesbits'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    const links = document.querySelectorAll('a[href*="/property/"]');
    let idx = 1;
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (!href || seen.has(href)) continue;
      // Must be a property detail link (not nav/footer)
      const h4 = link.querySelector('h4');
      if (!h4) continue;
      seen.add(href);
      const address = h4.textContent.trim();
      if (!address || address.length < 5) { idx++; continue; }
      const text = link.textContent || '';
      // Price — "£X Guide price" text above the heading
      let price = null;
      const pm = text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      // Image
      let imageUrl = '';
      const img = link.querySelector('img[src]');
      if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
      // Bullets
      const bullets = [];
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      const bedMatch = text.match(/(\\d+)\\s*bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      lots.push({ lot: idx, address, price, url: href, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// ─── SMITH AND SONS ──────────────────────────────────────────
// Custom CMS (Gud Design), server-rendered. ~9 lots per auction event.
// Cards are <a href="/auctionproperties/..."> with img + price range + address.
DOM_EXTRACTORS['smithandsons'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    const links = document.querySelectorAll('a[href*="/auctionproperties/"]');
    let idx = 1;
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (!href || seen.has(href) || href.split('/').length < 3) continue;
      // Skip navigation/auction event links (those are shorter paths)
      if (!/[a-z].*[a-z]/i.test(href.split('/auctionproperties/')[1] || '')) continue;
      seen.add(href);
      const text = link.textContent || '';
      // Address — look for postcode-containing text
      let address = '';
      const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 5);
      // Typically: price range, property type, address with postcode
      for (const line of lines) {
        if (/[A-Z]{1,2}\\d{1,2}\\s*\\d[A-Z]{2}/i.test(line) || (line.length > 10 && !line.startsWith('£') && !/^(Vacant|Commercial|Residential|Land|Guide)/i.test(line))) {
          address = line;
          break;
        }
      }
      if (!address) address = lines[lines.length - 1] || '';
      if (!address || address.length < 5) { idx++; continue; }
      // Price — range format "£75,000 - £85,000" or single
      let price = null;
      const pm = text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      // Image
      let imageUrl = '';
      const img = link.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || '';
        if (s && !/logo|icon/i.test(s)) imageUrl = s;
      }
      // Bullets
      const bullets = [];
      if (/Vacant/i.test(text)) bullets.push('Vacant');
      if (/Commercial/i.test(text)) bullets.push('Commercial');
      if (/Land/i.test(text)) bullets.push('Land');
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      lots.push({ lot: idx, address, price, url: href, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// ─── BRUTON KNOWLES ──────────────────────────────────────────
// WordPress custom (not PropertyHive), server-rendered. ~220 lots.
// Cards use .property-post-template with code references and prices.
DOM_EXTRACTORS['brutonknowles'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.property-post-template, .wp-block-post');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      // Skip non-property cards
      if (text.length < 20) continue;
      // Address — from heading or first substantial text
      let address = '';
      const heading = card.querySelector('h3 a, h2 a, h3, h2');
      if (heading) address = heading.textContent.trim();
      if (!address || address.length < 5) {
        // Try link text
        const link = card.querySelector('a[href*="/property/"]');
        if (link) address = link.textContent.trim();
      }
      if (!address || address.length < 5) { idx++; continue; }
      // Detail link
      let url = '';
      const link = card.querySelector('a[href*="/property/"], a[href*="brutonknowles"]');
      if (link) url = link.getAttribute('href') || '';
      if (!url) {
        const anyLink = card.querySelector('a[href]');
        if (anyLink) url = anyLink.getAttribute('href') || '';
      }
      if (seen.has(url || address)) continue;
      seen.add(url || address);
      // Price
      let price = null;
      const pm = text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      // Image
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && !/logo|icon|placeholder/i.test(s)) imageUrl = s;
      }
      // Bullets
      const bullets = [];
      const codeMatch = text.match(/Code\\s*(\\d+)/i);
      if (codeMatch) bullets.push('Ref: ' + codeMatch[1]);
      const acreMatch = text.match(/(\\d+\\.?\\d*)\\s*acres?/i);
      if (acreMatch) bullets.push(acreMatch[0]);
      if (/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i.test(text)) bullets.push('SOLD/STC');
      if (/\\bPOA\\b|On Application/i.test(text)) bullets.push('POA');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// ─── McCARTNEYS ──────────────────────────────────────────────
// WordPress + PropertyHive, server-rendered.
// URL: /property-search/?department=property-land-auctions
DOM_EXTRACTORS['mccartneys'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.repeat-team, .property-result, li.type-property, .office-slider');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      // Address
      let address = '';
      const addrEl = card.querySelector('h4 a, h3 a, h2 a, .col-right h4 a');
      if (addrEl) address = addrEl.textContent.trim();
      if (!address || address.length < 5) { idx++; continue; }
      // URL
      let url = '';
      const link = card.querySelector('a[href*="/property-details/"], a[href*="/property/"], h4 a, h3 a');
      if (link) url = link.getAttribute('href') || '';
      if (seen.has(url || address)) continue;
      seen.add(url || address);
      // Price
      let price = null;
      const priceEl = card.querySelector('p.price, .price');
      if (priceEl) {
        const pm = priceEl.textContent.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      if (!price) {
        const pm = text.match(/£([\\d,]+)/);
        if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      }
      // Image
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) imageUrl = img.getAttribute('src') || img.getAttribute('data-src') || '';
      // Bullets
      const bullets = [];
      const bedMatch = text.match(/(\\d+)\\s*bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// ─── BRAMLEYS ────────────────────────────────────────────────
// Custom CMS (Property Jungle), server-rendered. .property cards.
// URL: /search/?instruction_type=Sale&department=Auction
DOM_EXTRACTORS['bramleys'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.property, .product-container');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      if (text.length < 20) continue;
      // Address from paragraph or heading
      let address = '';
      const addrEl = card.querySelector('p, h4');
      if (addrEl) {
        // Address is usually the line with a town/postcode
        const lines = (card.textContent || '').split('\\n').map(l => l.trim()).filter(l => l.length > 5);
        for (const line of lines) {
          if (/[A-Z]{1,2}\\d/i.test(line) || (line.includes(',') && !line.startsWith('£') && !line.startsWith('Auction') && !/^\\d+\\s*Bed/i.test(line))) {
            address = line;
            break;
          }
        }
      }
      if (!address) {
        const h4 = card.querySelector('h4');
        if (h4) address = h4.textContent.trim();
      }
      if (!address || address.length < 5) { idx++; continue; }
      // Detail link
      let url = '';
      const link = card.querySelector('a[href*="/property-details/"], a[href]');
      if (link) url = link.getAttribute('href') || '';
      if (seen.has(url || address)) continue;
      seen.add(url || address);
      // Price
      let price = null;
      const pm = text.match(/(?:Guide|Auction)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      // Image
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && !/logo|icon/i.test(s)) imageUrl = s;
      }
      // Bullets
      const bullets = [];
      const bedMatch = text.match(/(\\d+)\\s*Bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      const typeMatch = text.match(/\\b(Detached|Semi|Terrace|Back to Back|End Terrace|Flat|Bungalow|House|Cottage|Land)\\b/i);
      if (typeMatch) bullets.push(typeMatch[0]);
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      if (/FOR SALE/i.test(text)) bullets.push('For Sale');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// ─── MORRIS MARSHALL ─────────────────────────────────────────
// Property Jungle CMS, Infinite Ajax Scroll. .product-container cards.
// URL: /search/?instruction_type=Auction
DOM_EXTRACTORS['morrismarshall'] = `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('.product-container, .property');
    let idx = 1;
    for (const card of cards) {
      const text = card.textContent || '';
      if (text.length < 20) continue;
      let address = '';
      const addrEl = card.querySelector('h4 a, h3 a, h2 a, .address, p');
      if (addrEl) address = addrEl.textContent.trim();
      if (!address || address.length < 5) {
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 5);
        for (const line of lines) {
          if (/[A-Z]{1,2}\\d/i.test(line) || (line.includes(',') && !line.startsWith('£'))) {
            address = line; break;
          }
        }
      }
      if (!address || address.length < 5) { idx++; continue; }
      let url = '';
      const link = card.querySelector('a[href*="/property/"], a[href*="/property-details/"], a[href]');
      if (link) url = link.getAttribute('href') || '';
      if (seen.has(url || address)) continue;
      seen.add(url || address);
      let price = null;
      const pm = text.match(/£([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (s && !/logo|icon/i.test(s)) imageUrl = s;
      }
      const bullets = [];
      const bedMatch = text.match(/(\\d+)\\s*bed/i);
      if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
      if (/\\bSOLD\\b|\\bSTC\\b/i.test(text)) bullets.push('SOLD/STC');
      lots.push({ lot: idx, address, price, url, imageUrl: imageUrl || undefined, bullets });
      idx++;
    }
    return lots;
  })()
`;

// Wire up Auction House UK branches to the shared auctionhouseuk extractor
for (const slug of ['auctionhousescotland', 'austingray', 'auctionhouseeastanglia', 'auctionhousenorthwest', 'auctionhousenortheast', 'auctionhousewales', 'auctionhousebirmingham', 'auctionhousekent', 'auctionhousedevon', 'auctionhouseeastmidlands', 'auctionhousewestmidlands', 'auctionhouseessex', 'auctionhousemanchester', 'auctionhousesouthyorkshire', 'auctionhousewestyorkshire', 'auctionhouseteesvalley', 'auctionhousehull', 'auctionhousecumbria', 'auctionhouselincolnshire', 'auctionhouseuklondon', 'auctionhousebedsandbucks', 'auctionhousenorthamptonshire', 'auctionhouseoxfordshire', 'auctionhouseleicestershire', 'auctionhousemidlands', 'auctionhousecoventry', 'auctionhousenottsandderby', 'auctionhousechesterfield', 'auctionhousestaffordshire', 'auctionhousenorthwales', 'auctionhousesouthwest', 'auctionhousenorthernireland', 'auctionhousenational']) {
  DOM_EXTRACTORS[slug] = DOM_EXTRACTORS.auctionhouseuk;
}

// Universal DOM extractor — works on any auction site by detecting common patterns
const UNIVERSAL_DOM_EXTRACTOR = `
  (() => {
    const lots = [];
    const seen = new Set();
    
    // Strategy 1: Find all links to individual property/lot pages
    const propLinks = document.querySelectorAll('a[href*="/property/"], a[href*="/lot/"], a[href*="property-details"], a[href*="/properties/"], a[href*="/auction/"], a[href*="/catalogue/"], a[href*="/sale/"], a[href*="lot-overview"], a[href*="/listing/"], a[href*="/auctions/lot"]');
    const linkSet = new Set();
    
    for (const link of propLinks) {
      const href = link.getAttribute('href') || '';
      if (linkSet.has(href)) continue;
      linkSet.add(href);
      
      // Walk up to find the card container (look for a repeating parent element)
      let card = link;
      for (let i = 0; i < 8 && card.parentElement; i++) {
        card = card.parentElement;
        // Stop when we find an element that likely wraps a single lot
        const cl = (card.className || '').toLowerCase();
        const tag = card.tagName.toLowerCase();
        if (cl.match(/card|lot|property|listing|item|result|auction/) || 
            (tag === 'article') || 
            (tag === 'li' && card.querySelector('a[href]'))) break;
      }
      
      const text = card.innerText || card.textContent || '';
      if (text.length < 20 || text.length > 5000) continue;
      
      // Extract price
      let price = null;
      const priceMatch = text.match(/(?:Guide[\\s]*(?:Price)?|Price|Starting|Reserve|Estimate)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
      if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
      
      // Extract address — look for postcode pattern
      let address = '';
      const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 0);
      // First try: line with a UK postcode
      for (const line of lines) {
        if (line.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && line.length < 200) {
          address = line;
          break;
        }
      }
      // Second try: first heading in the card
      if (!address) {
        const heading = card.querySelector('h1, h2, h3, h4, h5, .title, .address, [class*="title"], [class*="address"]');
        if (heading) address = heading.textContent.trim();
      }
      // Third try: link title or first substantial text
      if (!address) {
        const title = link.getAttribute('title');
        if (title && title.length > 5) address = title;
      }
      if (!address) {
        const substantial = lines.find(l => l.length > 10 && l.length < 150 && !l.match(/^(Guide|Price|Lot|Find|View|More|Search|Filter|Sort|Show|Order|£)/i));
        if (substantial) address = substantial;
      }
      if (!address || address.length < 5) continue;
      
      // Deduplicate by address
      const addrKey = address.toLowerCase().replace(/\\s+/g, ' ').substring(0, 60);
      if (seen.has(addrKey)) continue;
      seen.add(addrKey);
      
      // Extract lot number
      let lotNum = lots.length + 1;
      const lotMatch = text.match(/Lot\\s+(\\d+)/i);
      if (lotMatch) lotNum = parseInt(lotMatch[1]);
      
      // Extract bullets/features
      const bullets = [];
      card.querySelectorAll('li, .feature, .tag, .type, .property-type, .meta').forEach(el => {
        const t = el.textContent.trim();
        if (t.length > 2 && t.length < 200 && !t.match(/^(Search|Filter|Sort|Show|View|Order|My|Menu|Buy|Sell|About|Contact|Home)/i)) {
          bullets.push(t);
        }
      });
      // Also grab description-like paragraphs
      card.querySelectorAll('p, .description, [class*="desc"]').forEach(el => {
        const t = el.textContent.trim();
        if (t.length > 15 && t.length < 300 && !bullets.includes(t)) bullets.push(t);
      });
      
      // Detect sold/withdrawn status
      if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
        if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
      }
      
      // Extract image from card
      let imageUrl = '';
      const junkImg = /\\.svg|icon|logo|facebook|linkedin|twitter|spacer|pixel|badge|placeholder|no-image|1x1/i;
      const img = card.querySelector('img[src], img[data-src], img[data-lazy-src]');
      if (img) {
        const imgSrc = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
        if (imgSrc && imgSrc.length > 10 && !imgSrc.startsWith('data:') && !junkImg.test(imgSrc)) {
          imageUrl = imgSrc;
        }
      }
      // Also check for background-image on card or immediate children
      if (!imageUrl) {
        const bgEl = card.querySelector('[style*="background"]');
        if (bgEl) {
          const bgMatch = (bgEl.getAttribute('style') || '').match(/url\\(['"]?([^'"\\)]+)/);
          if (bgMatch && bgMatch[1] && !junkImg.test(bgMatch[1])) imageUrl = bgMatch[1];
        }
      }

      lots.push({ lot: lotNum, address, price, url: href, imageUrl: imageUrl || undefined, bullets: bullets.slice(0, 8) });
    }

    // Strategy 2: If no property links found, look for repeated card-like elements
    if (lots.length === 0) {
      // Find the most common class pattern that appears 5+ times with £ prices
      const candidates = document.querySelectorAll('[class*="card"], [class*="lot"], [class*="property"], [class*="listing"], [class*="item"], [class*="auction"], article');
      for (const card of candidates) {
        const text = card.innerText || card.textContent || '';
        if (text.length < 30 || text.length > 5000) continue;
        const priceMatch = text.match(/£([\\d,]+)/);
        if (!priceMatch) continue;
        const price = parseInt(priceMatch[1].replace(/,/g, ''));
        if (price < 1000) continue; // Skip non-property prices
        
        let address = '';
        const heading = card.querySelector('h1, h2, h3, h4, h5, .title, .address, [class*="title"], [class*="address"]');
        if (heading) address = heading.textContent.trim();
        if (!address) {
          const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 10 && s.length < 150);
          if (lines.length) address = lines[0];
        }
        if (!address || address.length < 5) continue;
        
        const addrKey = address.toLowerCase().replace(/\\s+/g, ' ').substring(0, 60);
        if (seen.has(addrKey)) continue;
        seen.add(addrKey);
        
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b|\\bSALE.?AGREED\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        
        // Extract image from card
        let imageUrl = '';
        const junkImg2 = /\\.svg|icon|logo|facebook|linkedin|twitter|spacer|pixel|badge|placeholder|no-image|1x1/i;
        const img2 = card.querySelector('img[src], img[data-src], img[data-lazy-src]');
        if (img2) {
          const imgSrc2 = img2.getAttribute('src') || img2.getAttribute('data-src') || img2.getAttribute('data-lazy-src') || '';
          if (imgSrc2 && imgSrc2.length > 10 && !imgSrc2.startsWith('data:') && !junkImg2.test(imgSrc2)) {
            imageUrl = imgSrc2;
          }
        }
        if (!imageUrl) {
          const bgEl2 = card.querySelector('[style*="background"]');
          if (bgEl2) {
            const bgMatch2 = (bgEl2.getAttribute('style') || '').match(/url\\(['"]?([^'"\\)]+)/);
            if (bgMatch2 && bgMatch2[1] && !junkImg2.test(bgMatch2[1])) imageUrl = bgMatch2[1];
          }
        }

        lots.push({ lot: lotMatch ? parseInt(lotMatch[1]) : lots.length + 1, address, price, url, imageUrl: imageUrl || undefined, bullets: bullets.slice(0, 8) });
      }
    }

    return lots;
  })()
`;

// HTTP-based image backfill — fetches catalogue page(s) and matches images to lots by URL
async function backfillImages(catalogueUrl, lots) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const resp = await fetch(catalogueUrl, { headers: HEADERS, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const html = await resp.text();
    const resolvedBase = resp.url || catalogueUrl; // use final URL after redirects

    // Also fix relative lot URLs while we're at it
    for (const lot of lots) {
      if (lot.url && !/^https?:\/\//i.test(lot.url)) {
        try { lot.url = new URL(lot.url, resolvedBase).href; } catch {}
      }
    }

    // Helper: resolve a src to absolute URL, skip non-property images
    const resolveImg = (src) => {
      if (!src || src.startsWith('data:') || src.length < 10
        || /\.svg|icon|logo|facebook|linkedin|twitter|spacer|pixel|badge/i.test(src)) return null;
      if (/^https?:\/\//i.test(src)) return src;
      try { return new URL(src, resolvedBase).href; } catch { return null; }
    };

    // Strategy 1: Build href→image map from <a href>...<img src> (image inside link)
    const hrefImgMap = {};
    const linkImgRe = /<a[^>]+href="([^"]+)"[^>]*>[^]*?<img[^>]+(?:src|data-src|data-lazy-src)="([^"]+)"/gi;
    let m;
    while ((m = linkImgRe.exec(html)) !== null) {
      const href = m[1];
      const src = resolveImg(m[2]);
      if (src && !hrefImgMap[href]) hrefImgMap[href] = src;
    }
    // Also match <a href>...background-image:url(...) patterns
    const linkBgRe = /<a[^>]+href="([^"]+)"[^>]*>[^]*?background(?:-image)?:\s*url\(['"]?([^'")\s]+)/gi;
    while ((m = linkBgRe.exec(html)) !== null) {
      const href = m[1];
      const src = resolveImg(m[2]);
      if (src && !hrefImgMap[href]) hrefImgMap[href] = src;
    }

    // Strategy 2: Collect ALL property-like image URLs (both absolute and relative)
    const allImages = [];
    const imgRe = /<img[^>]+(?:src|data-src|data-lazy-src)="([^"]+)"/gi;
    while ((m = imgRe.exec(html)) !== null) {
      const src = resolveImg(m[1]);
      if (src) allImages.push(src);
    }
    // Also collect background-image URLs
    const bgRe = /background(?:-image)?:\s*url\(['"]?([^'")\s]+)/gi;
    while ((m = bgRe.exec(html)) !== null) {
      const src = resolveImg(m[1]);
      if (src) allImages.push(src);
    }
    // Also collect srcset first entries
    const srcsetRe = /srcset="([^"]+)"/gi;
    while ((m = srcsetRe.exec(html)) !== null) {
      const first = m[1].split(',')[0].trim().split(/\s+/)[0];
      const src = resolveImg(first);
      if (src) allImages.push(src);
    }

    // Strategy 3: Proximity matching — for each lot URL, find nearest image in HTML
    // Build a position index of all image src positions in the HTML
    const imgPositions = [];
    const imgPosRe = /<img[^>]+(?:src|data-src|data-lazy-src)="([^"]+)"/gi;
    while ((m = imgPosRe.exec(html)) !== null) {
      const src = resolveImg(m[1]);
      if (src) imgPositions.push({ pos: m.index, src });
    }

    let updated = 0;
    for (const lot of lots) {
      if (lot.imageUrl) continue;
      if (!lot.url) continue; // URL-less lots handled by position matching below
      let imgSrc = null;

      // Strategy 1: direct href match (try multiple URL variants)
      const urlVariants = [lot.url];
      try { urlVariants.push(new URL(lot.url).pathname); } catch {}
      if (lot.url.startsWith('http://')) urlVariants.push(lot.url.replace('http://', 'https://'));
      else if (lot.url.startsWith('https://')) urlVariants.push(lot.url.replace('https://', 'http://'));
      for (const v of urlVariants) {
        if (hrefImgMap[v]) { imgSrc = hrefImgMap[v]; break; }
      }

      // Strategy 2: match by numeric ID found ANYWHERE in the lot URL path
      if (!imgSrc) {
        try {
          const path = new URL(lot.url).pathname;
          // Extract all numeric IDs (4+ digits) from the URL path
          const ids = path.match(/\d{4,}/g) || [];
          for (const id of ids) {
            imgSrc = allImages.find(src => src.includes('/' + id + '/') || src.includes('/' + id + '.') || src.includes('-' + id + '.') || src.includes('/' + id + '_'));
            if (imgSrc) break;
          }
        } catch {}
      }

      // Strategy 3: proximity — find lot URL in HTML and grab nearest image
      if (!imgSrc) {
        for (const v of urlVariants) {
          const pos = html.indexOf(v);
          if (pos === -1) continue;
          // Find the nearest image within 2000 chars before or after
          let best = null, bestDist = 2000;
          for (const ip of imgPositions) {
            const dist = Math.abs(ip.pos - pos);
            if (dist < bestDist) { bestDist = dist; best = ip.src; }
          }
          if (best) { imgSrc = best; break; }
        }
      }

      if (imgSrc) {
        lot.imageUrl = imgSrc;
        updated++;
      }
    }
    // Strategy 4: Position-based matching for URL-less lots (Gemini extraction loses URLs)
    // Use allImages ordered by appearance — nth unique property image = nth lot
    const urlLessLots = lots.filter(l => !l.imageUrl && !l.url);
    if (urlLessLots.length > 0 && allImages.length > 0) {
      // Deduplicate images while preserving order
      const seen = new Set();
      const uniqueImages = allImages.filter(img => { if (seen.has(img)) return false; seen.add(img); return true; });
      // If image count is roughly similar to lot count, do positional matching
      if (uniqueImages.length >= urlLessLots.length * 0.3) {
        let posMatched = 0;
        for (let i = 0; i < urlLessLots.length && i < uniqueImages.length; i++) {
          urlLessLots[i].imageUrl = uniqueImages[i];
          posMatched++;
        }
        updated += posMatched;
        if (posMatched > 0) console.log(`Image backfill position-match for URL-less lots: ${posMatched}/${urlLessLots.length}`);
      }
    }

    console.log(`Image backfill for ${catalogueUrl.substring(0, 60)}: ${updated}/${lots.filter(l => !l.imageUrl).length + updated} matched`);
    return updated > 0 ? lots : null;
  } catch (err) {
    log.warn('Image backfill error', { catalogueUrl, error: err.message });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// FIRECRAWL LOT-PAGE FETCHER — shared helper for all backfill functions
// ═══════════════════════════════════════════════════════════════
// Fetches a lot page with plain HTTP first (cheap), then Firecrawl if
// plain fetch returns too little content (JS-rendered page). Returns HTML string.
async function fetchLotPage(url) {
  // Try plain HTTP first — fast and free
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, { headers: HEADERS, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    if (resp.ok) {
      const html = await resp.text();
      // If we got substantial content, no need for Firecrawl
      // Heuristic: <500 chars of visible text means the page is likely JS-rendered
      const visibleText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (visibleText.length > 500) {
        return { html, url: resp.url || url, source: 'http' };
      }
      // Page looks JS-rendered — fall through to Firecrawl
    }
  } catch { /* timeout or network error — try Firecrawl */ }

  // Firecrawl fallback — handles JS rendering, anti-bot
  if (FIRECRAWL_API_KEY && !fcCreditExhausted) {
    try {
      const fcResult = await scrapeWithFirecrawl(url, { formats: ['rawHtml'] });
      if (fcResult.html && fcResult.html.length > 100) {
        return { html: fcResult.html, url: fcResult.sourceURL || url, source: 'firecrawl' };
      }
    } catch { /* Firecrawl failed — return null */ }
  }

  return null;
}

// Deep image backfill — standalone version for image-only passes (cache refresh, etc.)
async function backfillImagesFromLotPages(lots, concurrency = 5) {
  const missing = lots.filter(l => l.url && !l.imageUrl && /^https?:\/\//i.test(l.url));
  if (missing.length === 0) return 0;
  const capped = missing.slice(0, 50);
  const junk = /logo|icon|nav|sprite|\.svg|placeholder|no-image|modal\.png|_NYC\.|_LCC\.|_BMDC\.|council|utilit|cardwell|badge|spacer|pixel|facebook|twitter|1x1|gavel|backdrop|generic[_-]?image|coming[_-]?soon|maggsandallen\.co\.uk\/images\/|hollismorgan\.co\.uk\/images\/|fssproperty\.co\.uk\/images\//i;
  let filled = 0, fcUsed = 0;
  for (let i = 0; i < capped.length; i += concurrency) {
    if (i > 0) await new Promise(r => setTimeout(r, 500));
    const batch = capped.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(async (lot) => {
      try {
        const result = await fetchLotPage(lot.url);
        if (!result) return;
        if (result.source === 'firecrawl') fcUsed++;
        const imgRe = /<img[^>]+(?:src|data-src|data-lazy-src|data-original)="([^"]+)"/gi;
        let m;
        while ((m = imgRe.exec(result.html)) !== null) {
          const src = m[1];
          if (!src || src.length <= 20 || src.startsWith('data:')) continue;
          let imgUrl = src;
          if (!/^https?:\/\//i.test(imgUrl)) {
            try { imgUrl = new URL(imgUrl, result.url || lot.url).href; } catch { continue; }
          }
          if (junk.test(imgUrl)) continue;
          lot.imageUrl = imgUrl; filled++;
          break;
        }
      } catch { /* skip */ }
    }));
  }
  if (filled > 0) console.log(`Image backfill (lot pages): ${filled}/${missing.length}${fcUsed > 0 ? ` (${fcUsed} via Firecrawl)` : ''}`);
  return filled;
}

// ═══════════════════════════════════════════════════════════════
// UNIFIED LOT-PAGE ENRICHMENT — single pass extracts ALL missing data
// Replaces separate address/tenure/image/condition backfill functions.
// One fetch per lot page → extracts address, image, tenure, lease length,
// condition, beds, propType in a single pass. No wasted credits.
// ═══════════════════════════════════════════════════════════════
async function enrichLotsFromLotPages(lots, concurrency = 5) {
  // Target any lot with a URL that's missing ANY enrichment field
  const addrIsDescription = a => /^A\s+(one|two|three|four|five|six|\d+)\s+(bed|studio)/i.test(a);
  const targets = lots.filter(l => {
    if (!l.url || !/^https?:\/\//i.test(l.url)) return false;
    return !l.address || l.address.trim().length < 5
      || addrIsDescription(l.address || '')
      || !l.postcode
      || !l.imageUrl
      || !l.tenure
      || !l.condition
      || !l.beds
      || !l.price
      || l.vacant == null
      || !l.propType || l.propType === 'other' || l.propType === 'unknown'
      || (l.tenure === 'Leasehold' && !l.leaseLength);
  });
  if (targets.length === 0) return 0;

  // Prioritise lots missing beds (high-value enrichment) ahead of other gaps
  targets.sort((a, b) => (!a.beds ? 0 : 1) - (!b.beds ? 0 : 1));

  const junk = /logo|icon|nav|sprite|\.svg|placeholder|no-image|modal\.png|_NYC\.|_LCC\.|_BMDC\.|council|utilit|cardwell|badge|spacer|pixel|facebook|twitter|1x1|gavel|backdrop|generic[_-]?image|coming[_-]?soon|maggsandallen\.co\.uk\/images\/|hollismorgan\.co\.uk\/images\/|fssproperty\.co\.uk\/images\//i;

  let fcUsed = 0;
  const stats = { address: 0, image: 0, tenure: 0, condition: 0, beds: 0, leaseLength: 0, propType: 0 };

  for (let i = 0; i < targets.length; i += concurrency) {
    if (i > 0) await new Promise(r => setTimeout(r, 500));
    const batch = targets.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(async (lot) => {
      try {
        const result = await fetchLotPage(lot.url);
        if (!result) return;
        if (result.source === 'firecrawl') fcUsed++;
        const html = result.html;
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();

        // ── Address ──
        // Also re-fetch if address looks like a description (no postcode, starts with "A one/two/three bed")
        const addrLooksLikeDescription = lot.address && /^A\s+(one|two|three|four|five|six|\d+)\s+(bed|studio)/i.test(lot.address);
        if (!lot.address || lot.address.trim().length < 5 || addrLooksLikeDescription) {
          let address = '';
          const ogMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
                           html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
          if (ogMatch) address = ogMatch[1].trim();
          if (!address) {
            const h1Match = html.match(/<h1[^>]*>([^<]{10,})<\/h1>/i);
            if (h1Match) address = h1Match[1].trim();
          }
          if (!address) {
            // h2 fallback — EIG lot pages often have address in h2 (e.g. "Lot 10 - 22 Street, Town, AB1 2CD")
            const h2Match = html.match(/<h2[^>]*>([^<]{10,})<\/h2>/i);
            if (h2Match) address = h2Match[1].trim();
          }
          if (!address) {
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) address = titleMatch[1].replace(/\s*[-|].*$/, '').trim();
          }
          if (address) {
            address = address.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
            // Strip "Lot N - " prefix from heading-derived addresses
            address = address.replace(/^Lot\s+\d+\s*[-–—]\s*/i, '').trim();
          }
          if (address && address.length >= 5) { lot.address = address; stats.address++; }
        }

        // ── Image ──
        if (!lot.imageUrl) {
          const imgRe = /<img[^>]+(?:src|data-src|data-lazy-src|data-original)="([^"]+)"/gi;
          let m;
          while ((m = imgRe.exec(html)) !== null) {
            const src = m[1];
            if (!src || src.length <= 20 || src.startsWith('data:')) continue;
            let imgUrl = src;
            if (!/^https?:\/\//i.test(imgUrl)) {
              try { imgUrl = new URL(imgUrl, result.url || lot.url).href; } catch { continue; }
            }
            if (junk.test(imgUrl)) continue;
            lot.imageUrl = imgUrl; stats.image++;
            break;
          }
        }

        // ── Raw text capture (for Gemini fuzzy search) ──
        if (!lot.rawText) {
          const rawText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (rawText.length > 50) lot.rawText = rawText.slice(0, 10000); // cap at 10k chars
        }

        // ── Tenure ──
        if (!lot.tenure) {
          if (/share of freehold|share\s+of\s+the\s+freehold/.test(text)) { lot.tenure = 'Share of Freehold'; stats.tenure++; }
          else if (/flying freehold/.test(text)) { lot.tenure = 'Freehold'; stats.tenure++; }
          else if (/\bfreehold\b/.test(text) && !/leasehold/.test(text)) { lot.tenure = 'Freehold'; stats.tenure++; }
          else if (/\bleasehold\b|long\s+lease|lease\s+remaining|\byears?\s+(?:remaining|unexpired|left)\b|\b\d+\s*(?:year|yr)\s*lease\b/.test(text)) { lot.tenure = 'Leasehold'; stats.tenure++; }
          // Freehold scoring bonus (only if not already awarded)
          if (lot.tenure === 'Freehold' && lot.propType === 'house' && !(lot.opps || []).includes('Freehold') && !(lot.scoreBreakdown || []).some(s => s.signal === 'Freehold house')) {
            lot.score = (lot.score || 0) + 0.5;
            lot.opps = lot.opps || []; lot.opps.push('Freehold');
            lot.scoreBreakdown = lot.scoreBreakdown || [];
            lot.scoreBreakdown.push({ signal: 'Freehold house', pts: 0.5 });
            lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
          }
        }

        // ── Lease length ──
        if (lot.tenure === 'Leasehold' && !lot.leaseLength) {
          const leaseMatch = text.match(/\b(\d{2,4})\s*(?:year|yr)s?\s*(?:remaining|unexpired|left|lease)\b/) ||
                             text.match(/lease\s*(?:length|term|remaining)?\s*:?\s*(\d{2,4})\s*(?:year|yr)s?\b/) ||
                             text.match(/\b(\d{2,4})\s*(?:year|yr)\s*lease\b/) ||
                             text.match(/(?:approx(?:imately)?|circa|c\.?)\s*(\d{2,4})\s*(?:year|yr)s?\s*(?:remaining|unexpired|left)?\b/) ||
                             text.match(/(?:term|length)\s*(?:of)?\s*(\d{2,4})\s*(?:year|yr)s?\b/) ||
                             text.match(/(\d{2,4})\s*(?:year|yr)s?\s*(?:from|commencing|starting)\s*\d{4}/);
          if (leaseMatch) {
            const years = parseInt(leaseMatch[1], 10);
            if (years >= 1 && years <= 999) { lot.leaseLength = years; stats.leaseLength++; }
          }
          // Try "999 year lease from 2005" → compute remaining
          if (!lot.leaseLength) {
            const fromMatch = text.match(/(\d{2,4})\s*(?:year|yr)s?\s*(?:from|commencing|starting|dated)\s*(\d{4})/);
            if (fromMatch) {
              const total = parseInt(fromMatch[1], 10);
              const startYear = parseInt(fromMatch[2], 10);
              const remaining = total - (new Date().getFullYear() - startYear);
              if (remaining >= 1 && remaining <= 999) { lot.leaseLength = remaining; stats.leaseLength++; }
            }
          }
        }

        // ── Condition ──
        if (!lot.condition) {
          if (/\b(?:derelict|uninhabitable|severe(?:ly)?\s+dilapidated|structurally?\s+(?:unsound|unsafe)|condemned)\b/.test(text)) {
            lot.condition = 'derelict'; stats.condition++;
          } else if (/\b(?:poor\s+condition|very\s+poor|badly?\s+(?:damaged|deteriorated)|significant(?:ly)?\s+(?:dated|tired)|extensive\s+(?:refurb|renovation|works?\s+required))\b/.test(text)) {
            lot.condition = 'poor'; stats.condition++;
          } else if (/\b(?:need(?:s|ing)\s+(?:modernis|refurb|renovation|updating|improvement)|in\s+need\s+of\s+(?:modernis|refurb|renovation)|(?:requires?|requiring)\s+(?:modernis|refurb|renovation|updating)|(?:tired|dated|worn)\s+(?:condition|decor|throughout))\b/.test(text)) {
            lot.condition = 'needs modernisation'; stats.condition++;
          } else if (/\b(?:good\s+(?:condition|order|decorative)|well\s+(?:maintained|presented|kept)|recently\s+(?:refurb|renovated|decorated|updated))\b/.test(text)) {
            lot.condition = 'good'; stats.condition++;
          }
          // Condition scoring (only if not already awarded — prevents inflation on re-enrichment)
          if (lot.condition === 'needs modernisation' && !(lot.opps || []).includes('Needs modernisation') && !(lot.scoreBreakdown || []).some(s => s.signal === 'Needs modernisation')) {
            lot.score = (lot.score || 0) + 2.0;
            lot.opps = lot.opps || []; lot.opps.push('Needs modernisation');
            lot.scoreBreakdown = lot.scoreBreakdown || [];
            lot.scoreBreakdown.push({ signal: 'Needs modernisation', pts: 2.0 });
            lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
          } else if ((lot.condition === 'poor' || lot.condition === 'derelict') && !(lot.opps || []).includes('Poor condition') && !(lot.scoreBreakdown || []).some(s => /Poor.*condition/i.test(s.signal))) {
            lot.score = (lot.score || 0) + 2.5;
            lot.opps = lot.opps || []; lot.opps.push('Poor condition');
            lot.scoreBreakdown = lot.scoreBreakdown || [];
            lot.scoreBreakdown.push({ signal: 'Poor/derelict condition', pts: 2.5 });
            lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
          }
        }

        // ── Beds ──
        if (!lot.beds) {
          // Try "2/3 bed" variant format first (take higher), then standard patterns
          const variantMatch = text.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*[-\s]?bed/i);
          const standardMatch = text.match(/\b(\d{1,2})\s*(?:[-\s])?(?:bed(?:room)?s?|double\s+bed(?:room)?s?)\b/i);
          const studioMatch = /\bstudio\s*(?:flat|apartment)?\b/i.test(text);
          if (variantMatch) {
            const n = Math.max(parseInt(variantMatch[1], 10), parseInt(variantMatch[2], 10));
            if (n >= 1 && n <= 20) { lot.beds = n; stats.beds++; }
          } else if (standardMatch) {
            const n = parseInt(standardMatch[1], 10);
            if (n >= 1 && n <= 20) { lot.beds = n; stats.beds++; }
          } else if (studioMatch) {
            lot.beds = 0; stats.beds++;
          }
        }

        // ── Property type ──
        if (!lot.propType || lot.propType === 'other' || lot.propType === 'unknown') {
          if (/\b(?:flat|apartment|maisonette|studio\s+flat|penthouse)\b/.test(text)) { lot.propType = 'flat'; stats.propType++; }
          else if (/\b(?:terraced|semi[- ]detached|detached\s+house|end[- ]terrace|mid[- ]terrace|town\s*house|cottage|villa|lodge)\b/.test(text)) { lot.propType = 'house'; stats.propType++; }
          else if (/\bbungalow\b/.test(text)) { lot.propType = 'house'; stats.propType++; }
          else if (/\b(?:land|plot|garage|parking\s+space|storage\s+unit)\b/.test(text)) { lot.propType = 'land'; stats.propType++; }
          else if (/\b(?:shop|retail|office|warehouse|industrial|commercial|pub|hotel|restaurant)\b/.test(text)) { lot.propType = 'commercial'; stats.propType++; }
        }

        // ── Price ──
        if (!lot.price) {
          // Guide Price: £165,000 / Starting Bid: £50,000 / Reserve Price: £80,000
          const priceMatch = text.match(/(?:guide\s*price|starting\s*bid|reserve\s*price|price|asking)[^£]*£([\d,]+)/i)
            || text.match(/£([\d,]+)\s*(?:guide|starting|reserve|plus)/i);
          if (priceMatch) {
            const p = parseInt(priceMatch[1].replace(/,/g, ''), 10);
            if (p >= 1000 && p <= 50000000) { lot.price = p; if (!stats.price) stats.price = 0; stats.price++; }
          }
        }

        // ── Vacant ──
        if (lot.vacant == null) {
          if (/\b(?:vacant\s+possession|sold\s+with\s+vacant|\bvp\b|vacant\s+property|with\s+vacant|currently\s+vacant|unoccupied)\b/.test(text)) {
            lot.vacant = true; if (!stats.vacant) stats.vacant = 0; stats.vacant++;
          } else if (/\b(?:(?:currently\s+)?(?:let|tenanted|rented|occupied)|tenant\s+in\s+situ|subject\s+to\s+tenanc|assured\s+shorthold|sitting\s+tenant|(?:rental|current)\s+income)\b/.test(text)) {
            lot.vacant = false; if (!stats.vacant) stats.vacant = 0; stats.vacant++;
          }
        }

        // ── Postcode re-extraction from newly fetched address ──
        if (!lot.postcode && lot.address) {
          const pc = extractPostcode(lot.address);
          if (pc) lot.postcode = pc;
        }

      } catch { /* timeout or network error — skip */ }
    }));
  }

  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  if (total > 0) {
    const parts = Object.entries(stats).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(' ');
    const bedCoverage = lots.filter(l => l.beds != null).length;
    console.log(`Lot-page enrichment: ${targets.length} pages fetched, ${total} fields filled — ${parts}${fcUsed > 0 ? ` (${fcUsed} via Firecrawl)` : ''} | beds coverage: ${bedCoverage}/${lots.length} (${Math.round(bedCoverage/lots.length*100)}%)`);
  }
  return total;
}

// ═══════════════════════════════════════════════════════════════
// PUPPETEER IMAGE BACKFILL — for JS-rendered sites where plain HTTP fails
// ═══════════════════════════════════════════════════════════════
async function backfillImagesWithPuppeteer(catalogueUrl, lots, house) {
  let page;
  try {
    page = await acquirePage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.setViewport({ width: 1280, height: 900 });
    // Allow images through (unlike normal scraper) so img src attributes populate
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['font', 'media'].includes(type)) req.abort();
      else req.continue();
    });

    await page.goto(catalogueUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000));
    // Scroll to trigger lazy-loaded images
    await page.evaluate(async () => {
      for (let i = 0; i < 15; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 500));
      }
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 2000));

    // Use existing DOM extractor to get lots with images from rendered page
    const domLots = await extractWithDOM(page, house);
    if (!domLots || domLots.length === 0) {
      console.log(`Puppeteer image backfill: DOM extractor returned 0 lots for ${house}`);
      return 0;
    }

    // Build lot number → {imageUrl, url} map
    const lotMap = {};
    for (const dl of domLots) {
      if (dl.lot) lotMap[dl.lot] = { imageUrl: dl.imageUrl, url: dl.url };
    }

    let updated = 0;
    for (const lot of lots) {
      const match = lotMap[lot.lot];
      if (!match) continue;
      if (!lot.imageUrl && match.imageUrl) { lot.imageUrl = match.imageUrl; updated++; }
      if ((!lot.url || lot.url === '') && match.url) lot.url = match.url;
    }

    console.log(`Puppeteer image backfill for ${house}: ${updated}/${lots.length} lots got images (DOM found ${domLots.length} lots)`);
    return updated;
  } catch (err) {
    log.warn('Puppeteer image backfill error', { house, catalogueUrl, error: err.message });
    return 0;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function extractWithDOM(page, house) {
  let lots = null;

  // Try house-specific extractor first
  const extractor = DOM_EXTRACTORS[house];
  if (extractor) {
    try {
      const result = await page.evaluate(extractor);
      if (Array.isArray(result) && result.length > 0) {
        console.log(`DOM extractor for ${house}: found ${result.length} lots directly`);
        lots = result;
      }
    } catch (err) {
      log.warn('DOM extractor error', { house, error: err.message });
    }
  }

  // Fall back to universal extractor
  if (!lots) {
    try {
      const result = await page.evaluate(UNIVERSAL_DOM_EXTRACTOR);
      if (Array.isArray(result) && result.length > 0) {
        console.log(`Universal DOM extractor for ${house}: found ${result.length} lots`);
        lots = result;
      }
    } catch (err) {
      log.warn('Universal DOM extractor error', { house, error: err.message });
    }
  }

  if (!lots) {
    console.log(`All DOM extractors for ${house}: found 0 lots, falling back to Claude`);
    return null;
  }

  // Save raw URLs (before resolution) for image matching against DOM hrefs
  const rawUrls = lots.map(l => l.url || '');

  // Resolve relative URLs to absolute using the page's own URL as base
  const baseUrl = page.url();
  for (const lot of lots) {
    if (lot.url && !/^https?:\/\//i.test(lot.url)) {
      try { lot.url = new URL(lot.url, baseUrl).href; } catch {}
    }
    if (lot.detailUrl && !/^https?:\/\//i.test(lot.detailUrl)) {
      try { lot.detailUrl = new URL(lot.detailUrl, baseUrl).href; } catch {}
    }
    if (lot.imageUrl && !/^https?:\/\//i.test(lot.imageUrl)) {
      try { lot.imageUrl = new URL(lot.imageUrl, baseUrl).href; } catch {}
    }
  }

  // Image extraction pass — match by lot URL, not lot number text
  try {
    const hrefImageMap = await page.evaluate(() => {
      const map = {};
      const skip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|loading|cookie|emoji/i;
      const links = document.querySelectorAll('a[href]');
      for (const link of links) {
        const rawHref = link.getAttribute('href') || '';
        const absHref = link.href; // browser-resolved absolute
        if (!rawHref || rawHref === '#') continue;
        if (map[rawHref] || map[absHref]) continue;

        // Strategy 1: <img> inside the link itself
        let imgSrc = '';
        let img = link.querySelector('img');
        // Strategy 2: Walk up to parent container (up to 5 levels) and look for img
        if (!img) {
          let el = link;
          for (let depth = 0; depth < 5; depth++) {
            el = el.parentElement;
            if (!el) break;
            img = el.querySelector('img');
            if (img) break;
          }
        }
        if (img) {
          imgSrc = img.getAttribute('src') || img.dataset.src
            || img.getAttribute('data-lazy-src') || img.getAttribute('data-original')
            || (img.srcset ? img.srcset.split(',')[0].trim().split(/\s+/)[0] : '');
        }

        // Strategy 3: background-image on elements near the link
        if (!imgSrc || imgSrc.startsWith('data:')) {
          let el = link;
          for (let depth = 0; depth < 5; depth++) {
            el = el.parentElement;
            if (!el) break;
            const bgEls = el.querySelectorAll('[style*="background"]');
            for (const bgEl of bgEls) {
              const style = bgEl.getAttribute('style') || '';
              const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?([^'")\s]+)/i);
              if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
                imgSrc = bgMatch[1];
                break;
              }
            }
            if (imgSrc && !imgSrc.startsWith('data:')) break;
          }
        }

        if (!imgSrc || imgSrc.startsWith('data:') || imgSrc.length < 10 || skip.test(imgSrc)) continue;
        map[rawHref] = imgSrc;
        map[absHref] = imgSrc;
      }
      return map;
    });
    if (hrefImageMap && Object.keys(hrefImageMap).length > 0) {
      for (let i = 0; i < lots.length; i++) {
        if (lots[i].imageUrl) continue;
        // Match using raw URL (as in DOM), resolved URL, or absolute lot.url
        const imgSrc = hrefImageMap[rawUrls[i]] || hrefImageMap[lots[i].url];
        if (imgSrc) {
          let imgUrl = imgSrc;
          if (!/^https?:\/\//i.test(imgUrl)) {
            try { imgUrl = new URL(imgUrl, baseUrl).href; } catch {}
          }
          lots[i].imageUrl = imgUrl;
        }
      }
      console.log(`Image extraction for ${house}: ${lots.filter(l => l.imageUrl).length}/${lots.length} lots got images`);
    }
  } catch (err) {
    log.warn('Image extraction error', { house, error: err.message });
  }

  // Resolve any relative imageUrls to absolute
  for (const lot of lots) {
    if (lot.imageUrl && !/^https?:\/\//i.test(lot.imageUrl)) {
      try { lot.imageUrl = new URL(lot.imageUrl, baseUrl).href; } catch {}
    }
  }

  // Post-processing: filter out non-property images (logos, icons, placeholders, known junk)
  const imgBlocklist = /logo|icon|placeholder|no-image|default|blank|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|noimage|favicon|banner|advert|sponsor|newsletter|widget|thumb_generic|modal\.png|_NYC\.|_LCC\.|_BMDC\.|Unit[ie]*d?_?Utilit|Cardwells|themes\/.*assets\/images\/|download_\(\d+\)\.|watchLIVEauction|property-top-image|auc2-logo|gavel|backdrop|generic[_-]?image|auction[_-]?house[_-]?(?:logo|image)|coming[_-]?soon|maggsandallen\.co\.uk\/images\/|hollismorgan\.co\.uk\/images\/|fssproperty\.co\.uk\/images\//i;
  // Known non-property domains and brand names that appear as junk images
  const imgDomainBlock = /flannels|kirklees|rdw\b|council\.gov|\.gov\.uk\/|googleads|doubleclick|analytics|hotjar|intercom|crisp\.chat|tawk\.to|zendesk|hubspot|mailchimp|sendgrid/i;
  // House-specific: Hollis Morgan property photos always use /resize/ path
  const hollisJunk = house === 'hollismorgan' || house === 'maggsandallen';
  for (const lot of lots) {
    if (!lot.imageUrl) continue;
    if (imgBlocklist.test(lot.imageUrl) || imgDomainBlock.test(lot.imageUrl)) {
      lot.imageUrl = undefined;
    } else if (hollisJunk && lot.imageUrl.includes('hollismorgan.co.uk') && !lot.imageUrl.includes('/resize/')) {
      // Hollis Morgan: only /resize/ URLs are property photos; everything else is junk
      lot.imageUrl = undefined;
    } else if (hollisJunk && lot.imageUrl.includes('maggsandallen.co.uk') && !lot.imageUrl.includes('/resize/')) {
      lot.imageUrl = undefined;
    }
  }

  return lots;
}

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
// LAND REGISTRY ENRICHMENT
// ═══════════════════════════════════════════════════════════════
function extractPostcode(address) {
  if (!address) return null;
  const m = address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
  return m ? m[0].toUpperCase().replace(/\s+/g, ' ') : null;
}

function extractStreet(address) {
  if (!address) return null;
  // Try to pull street name from address (between number and town/postcode)
  const m = address.match(/\d+[a-z]?\s+(.+?)(?:,|\s+[A-Z]{1,2}\d)/i);
  return m ? m[1].trim().toUpperCase() : null;
}

async function queryLandRegistry(postcode) {
  if (!postcode) return [];
  // Sanitize postcode: strip non-alphanumeric/space, validate UK format
  const sanitised = postcode.replace(/[^A-Z0-9 ]/gi, '').trim();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(sanitised)) return [];
  const sparql = `
PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?paon ?saon ?street ?town ?postcode ?amount ?date ?category ?propertyType
WHERE {
  VALUES ?postcode {"${sanitised}"^^xsd:string}
  ?addr lrcommon:postcode ?postcode.
  ?transx lrppi:propertyAddress ?addr ;
          lrppi:pricePaid ?amount ;
          lrppi:transactionDate ?date ;
          lrppi:transactionCategory/skos:prefLabel ?category .
  OPTIONAL {?addr lrcommon:paon ?paon}
  OPTIONAL {?addr lrcommon:saon ?saon}
  OPTIONAL {?addr lrcommon:street ?street}
  OPTIONAL {?addr lrcommon:town ?town}
  OPTIONAL {?transx lrppi:propertyType/skos:prefLabel ?propertyType}
  FILTER(?date >= "${new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}"^^xsd:date)
}
ORDER BY DESC(?date)
LIMIT 30`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch('https://landregistry.data.gov.uk/landregistry/query', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `query=${encodeURIComponent(sparql)}`,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      console.warn(`Land Registry API ${resp.status} for ${postcode}`);
      return { data: [], failed: true };
    }
    const data = await resp.json();
    const results = (data.results?.bindings || []).map(b => ({
      address: [b.saon?.value, b.paon?.value, b.street?.value].filter(Boolean).join(', '),
      town: b.town?.value || '',
      postcode: b.postcode?.value || '',
      price: parseInt(b.amount?.value) || 0,
      date: b.date?.value || '',
      category: b.category?.value || '',
      propertyType: b.propertyType?.value || '',
    }));
    return { data: results, failed: false };
  } catch (e) {
    console.log(`Land Registry query failed for ${postcode}: ${e.message}`);
    return { data: [], failed: true };
  }
}

// ═══════════════════════════════════════════════════════════════
// VOA RENTAL ESTIMATES (local authority averages by beds)
// Monthly rent in £ — source: VOA Private Rental Market Statistics 2024/25
// Format: { area_keyword: { 0: studio, 1: 1bed, 2: 2bed, 3: 3bed, 4: 4bed+ } }
// ═══════════════════════════════════════════════════════════════
const VOA_RENTS = {
  // London boroughs
  'london': { 0: 1200, 1: 1500, 2: 1800, 3: 2200, 4: 2800 },
  'westminster': { 0: 1600, 1: 2000, 2: 2800, 3: 3800, 4: 5000 },
  'camden': { 0: 1400, 1: 1800, 2: 2400, 3: 3200, 4: 4000 },
  'islington': { 0: 1350, 1: 1750, 2: 2300, 3: 3000, 4: 3800 },
  'hackney': { 0: 1200, 1: 1550, 2: 2000, 3: 2600, 4: 3200 },
  'tower hamlets': { 0: 1300, 1: 1650, 2: 2100, 3: 2700, 4: 3400 },
  'southwark': { 0: 1200, 1: 1550, 2: 2000, 3: 2600, 4: 3200 },
  'lambeth': { 0: 1150, 1: 1500, 2: 1900, 3: 2500, 4: 3100 },
  'lewisham': { 0: 1000, 1: 1300, 2: 1600, 3: 2000, 4: 2500 },
  'greenwich': { 0: 1000, 1: 1300, 2: 1600, 3: 2000, 4: 2500 },
  'newham': { 0: 950, 1: 1250, 2: 1550, 3: 1900, 4: 2400 },
  'barking': { 0: 850, 1: 1100, 2: 1400, 3: 1700, 4: 2100 },
  'croydon': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'ealing': { 0: 1000, 1: 1300, 2: 1650, 3: 2100, 4: 2600 },
  'brent': { 0: 1050, 1: 1350, 2: 1700, 3: 2200, 4: 2700 },
  'haringey': { 0: 1100, 1: 1400, 2: 1800, 3: 2300, 4: 2800 },
  'waltham forest': { 0: 950, 1: 1250, 2: 1550, 3: 1950, 4: 2400 },
  'enfield': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'hounslow': { 0: 950, 1: 1200, 2: 1500, 3: 1900, 4: 2400 },
  'redbridge': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'hillingdon': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'barnet': { 0: 1000, 1: 1300, 2: 1650, 3: 2100, 4: 2600 },
  'bromley': { 0: 900, 1: 1150, 2: 1450, 3: 1800, 4: 2200 },
  'wandsworth': { 0: 1200, 1: 1550, 2: 2000, 3: 2600, 4: 3200 },
  'richmond': { 0: 1100, 1: 1450, 2: 1850, 3: 2400, 4: 3000 },
  'kingston': { 0: 1000, 1: 1300, 2: 1650, 3: 2100, 4: 2600 },
  'merton': { 0: 1000, 1: 1300, 2: 1650, 3: 2100, 4: 2600 },
  'sutton': { 0: 850, 1: 1100, 2: 1400, 3: 1750, 4: 2100 },
  // Major cities & regions
  'manchester': { 0: 700, 1: 850, 2: 1050, 3: 1300, 4: 1600 },
  'birmingham': { 0: 600, 1: 750, 2: 900, 3: 1100, 4: 1400 },
  'liverpool': { 0: 500, 1: 600, 2: 750, 3: 900, 4: 1100 },
  'leeds': { 0: 600, 1: 700, 2: 850, 3: 1050, 4: 1300 },
  'sheffield': { 0: 500, 1: 600, 2: 750, 3: 900, 4: 1100 },
  'bristol': { 0: 750, 1: 900, 2: 1100, 3: 1400, 4: 1700 },
  'newcastle': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'nottingham': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1200 },
  'leicester': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1200 },
  'coventry': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1200 },
  'cardiff': { 0: 600, 1: 700, 2: 850, 3: 1050, 4: 1300 },
  'swansea': { 0: 450, 1: 550, 2: 650, 3: 800, 4: 1000 },
  'edinburgh': { 0: 700, 1: 850, 2: 1050, 3: 1350, 4: 1700 },
  'glasgow': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1250 },
  'reading': { 0: 750, 1: 950, 2: 1200, 3: 1500, 4: 1800 },
  'oxford': { 0: 800, 1: 1000, 2: 1300, 3: 1600, 4: 2000 },
  'cambridge': { 0: 800, 1: 1000, 2: 1300, 3: 1600, 4: 2000 },
  'brighton': { 0: 750, 1: 950, 2: 1200, 3: 1500, 4: 1800 },
  'southampton': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'portsmouth': { 0: 550, 1: 700, 2: 850, 3: 1050, 4: 1300 },
  'bournemouth': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'exeter': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'plymouth': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'bath': { 0: 700, 1: 850, 2: 1100, 3: 1400, 4: 1700 },
  'york': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'chester': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'norwich': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1200 },
  'ipswich': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'stoke': { 0: 400, 1: 500, 2: 600, 3: 750, 4: 950 },
  'derby': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'wolverhampton': { 0: 450, 1: 550, 2: 700, 3: 850, 4: 1050 },
  'walsall': { 0: 450, 1: 550, 2: 700, 3: 850, 4: 1050 },
  'sunderland': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'middlesbrough': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'bradford': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'hull': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'blackburn': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'burnley': { 0: 375, 1: 450, 2: 550, 3: 675, 4: 850 },
  'clitheroe': { 0: 425, 1: 525, 2: 650, 3: 800, 4: 1000 },
  // Regional fallbacks
  'south east': { 0: 750, 1: 950, 2: 1200, 3: 1500, 4: 1800 },
  'south west': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'east midlands': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'west midlands': { 0: 550, 1: 650, 2: 800, 3: 1000, 4: 1250 },
  'north west': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'north east': { 0: 400, 1: 475, 2: 575, 3: 700, 4: 900 },
  'yorkshire': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1150 },
  'east': { 0: 600, 1: 750, 2: 950, 3: 1150, 4: 1400 },
  'wales': { 0: 475, 1: 575, 2: 700, 3: 875, 4: 1050 },
  'scotland': { 0: 500, 1: 600, 2: 750, 3: 950, 4: 1200 },
  // Default UK fallback
  '_default': { 0: 550, 1: 675, 2: 825, 3: 1025, 4: 1275 },
};

// Rent inflation factors — VOA baseline values are from mid-2024, apply uplifts for 2026 market
const RENT_UPLIFT = { bristol: 1.25, bath: 1.20, london: 1.10, _default: 1.10 };

function estimateMonthlyRent(address, beds, units) {
  const a = (address || '').toLowerCase();
  // Multi-unit: estimate per-unit rent then multiply
  // For blocks, derive per-unit bed count from total beds / units, or default to 2
  const perUnitBeds = (units && units >= 2)
    ? (beds != null && beds <= 10 ? Math.max(1, Math.round(beds / units)) : 2)
    : (beds ?? 2);
  const unitCount = (units && units >= 2) ? units : 1;
  const clampedBeds = Math.min(Math.max(perUnitBeds, 0), 4);
  // Try specific towns/cities first, then regions
  for (const [key, rents] of Object.entries(VOA_RENTS)) {
    if (key === '_default') continue;
    if (a.includes(key)) {
      const base = rents[clampedBeds];
      const uplift = RENT_UPLIFT[key] || RENT_UPLIFT._default;
      return Math.round(base * uplift * unitCount);
    }
  }
  const base = VOA_RENTS._default[clampedBeds];
  return Math.round(base * RENT_UPLIFT._default * unitCount);
}

// ═══════════════════════════════════════════════════════════════
// LOT URL CONSTRUCTION
// ═══════════════════════════════════════════════════════════════
function buildLotUrl(lot, house, sourceUrl) {
  // If Claude already extracted a URL, use it
  if (lot.url && lot.url.startsWith('http')) return lot.url;

  switch (house) {
    case 'savills':
      // Savills lot pages: /auctions/auction-name/lot-number
      if (sourceUrl.includes('savills.co.uk')) {
        const base = sourceUrl.replace(/\/page-\d+.*/, '');
        return `${base}?lot=${lot.lot}`;
      }
      break;
    case 'allsop':
      // Allsop: lot overview pages use the property reference
      if (lot.reference) return `https://www.allsop.co.uk/lot-overview/lot/${lot.reference}`;
      return `https://www.allsop.co.uk/find-a-property/`;
    case 'sdl':
      // BTG Eddisons (formerly SDL): property pages are /properties/{id}/for-auction-{slug}
      if (lot.url && lot.url.startsWith('http')) return lot.url;
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.btgeddisonspropertyauctions.com${lot.url}`;
      }
      if (lot.propertyId) {
        return `https://www.btgeddisonspropertyauctions.com/properties/${lot.propertyId}/`;
      }
      break;
    case 'bondwolfe':
      // Bond Wolfe: /auctions/properties/{id}-property-auction-{location}/
      if (lot.propertyId) {
        return `https://www.bondwolfe.com/auctions/properties/${lot.propertyId}/`;
      }
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.bondwolfe.com${lot.url}`;
      }
      break;
    case 'network':
      // Network Auctions: individual lot pages
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.networkauctions.co.uk${lot.url}`;
      }
      break;
    case 'barnardmarcus':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.barnardmarcusauctions.co.uk${lot.url}`;
      }
      break;
    case 'auctionhouselondon':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://auctionhouselondon.co.uk${lot.url}`;
      }
      break;
    case 'cliveemson':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.cliveemson.co.uk${lot.url}`;
      }
      break;
    case 'strettons':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.strettons.co.uk${lot.url}`;
      }
      break;
    case 'acuitus':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.acuitus.co.uk${lot.url}`;
      }
      break;
    case 'auctionhouse':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.auctionhouse.co.uk${lot.url}`;
      }
      break;
    case 'hollismorgan':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.hollismorgan.co.uk${lot.url}`;
      }
      break;
    case 'maggsandallen':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.maggsandallen.co.uk${lot.url}`;
      }
      break;
    case 'mchughandco':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.mchughandco.com${lot.url}`;
      }
      break;
    case 'knightfrank':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.knightfrankauctions.com${lot.url}`;
      }
      break;
    case 'pattinson':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.pattinson.co.uk${lot.url}`;
      }
      break;
    case 'bidx1':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://bidx1.com${lot.url}`;
      }
      break;
    case 'philliparnold':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.philliparnoldauctions.co.uk${lot.url}`;
      }
      break;
    case 'edwardmellor':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.edwardmellor.co.uk${lot.url}`;
      }
      break;
    case 'paulfosh':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://paulfosh.eigonlineauctions.com${lot.url}`;
      }
      break;
    case 'cottons':
      // EIG embed lot links are like ?lid=329469&ClientID=26&src=40
      if (lot.url && lot.url.includes('lid=')) {
        return `https://www.cottons.co.uk/current-auction.htm${lot.url}`;
      }
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.cottons.co.uk${lot.url}`;
      }
      break;
    case 'dedmangray':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.dedmangray.co.uk${lot.url}`;
      }
      break;
    case 'barnettross':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.barnettross.co.uk${lot.url}`;
      }
      break;
    case 'bradleyhall':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.bradleyhall.co.uk${lot.url}`;
      }
      break;
    case 'connectuk':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.connectukauctions.co.uk${lot.url}`;
      }
      break;
    case 'auctionestates':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.auctionestates.co.uk${lot.url}`;
      }
      break;
    case 'landwood':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.landwoodpropertyauctions.com${lot.url}`;
      }
      break;
    case 'loveitts':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.loveitts.co.uk${lot.url}`;
      }
      break;
    case 'hunters':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://hunters.bambooauctions.com${lot.url}`;
      }
      break;
    // ── New houses ──
    case 'probateauction':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://probate.auction${lot.url}`;
      }
      break;
    case 'countrywide':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.countrywidepropertyauctions.co.uk${lot.url}`;
      }
      break;
    case 'venmore':
      if (lot.url && !lot.url.startsWith('http')) {
        return `https://www.venmoreauctions.co.uk/${lot.url.replace(/^\//, '')}`;
      }
      break;
    case 'tcpa':
      // TCPA URLs are already absolute (regional subdomains)
      break;
    case 'futureauctions':
      if (lot.url && !lot.url.startsWith('http')) {
        return `https://www.futurepropertyauctions.co.uk/${lot.url.replace(/^\//, '')}`;
      }
      break;
    case 'kivells':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.kivells.com${lot.url}`;
      }
      break;
    case 'firstforauctions':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://online.firstforauctions.co.uk${lot.url}`;
      }
      break;
    case 'harmanhealy':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.harman-healy.co.uk${lot.url}`;
      }
      break;
    case 'seelauctions':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://online.seelauctions.co.uk${lot.url}`;
      }
      break;
    case 'robinsonhall':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://robinsonandhallauctions.co.uk${lot.url}`;
      }
      break;
    // ── New EIG houses (March 2026 batch) ──
    case 'astleys':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://astleys.eigonlineauctions.com${lot.url}`;
      }
      break;
    case 'henrysykes':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://onlineauctions.henrysykes.co.uk${lot.url}`;
      }
      break;
    case 'clarkesimpson':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://clarke-simpson.eigonlineauctions.com${lot.url}`;
      }
      break;
    case 'durrants':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://durrants.com${lot.url}`;
      }
      break;
    case 'dawsons':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.dawsonsproperty.co.uk${lot.url}`;
      }
      break;
    case 'goldings':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.goldingsauctions.co.uk${lot.url}`;
      }
      break;
    case 'auctionhousescotland':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.auctionhouse.co.uk${lot.url}`;
      }
      break;
    case 'austingray':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.auctionhouse.co.uk${lot.url}`;
      }
      break;
    // ── New houses (March 2026 batch 2) ──
    case 'agentsproperty':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.agentspropertyauction.com${lot.url}`;
      }
      break;
    case 'andrewcraig':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.andrewcraig.co.uk${lot.url}`;
      }
      break;
    case 'buttersjohnbee':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.buttersjohnbee.com${lot.url}`;
      }
      break;
    case 'brownco':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://brownandco.eigonlineauctions.com${lot.url}`;
      }
      break;
    case 'cheffins':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.cheffins.co.uk${lot.url}`;
      }
      break;
    case 'fssproperty':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.fssproperty.co.uk${lot.url}`;
      }
      break;
    case 'iamsold':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.iamsold.co.uk${lot.url}`;
      }
      break;
  }
  // Fallback: if no lot-specific URL, link to the source catalogue page
  return lot.url || sourceUrl || '';
}

// ═══════════════════════════════════════════════════════════════
// ENRICHMENT: EPC & Flood Risk APIs
// ═══════════════════════════════════════════════════════════════

// ── Circuit Breaker (shared pattern for external APIs) ──
class CircuitBreaker {
  constructor(name, { maxFailures = 3, resetMs = 600000 } = {}) {
    this.name = name;
    this.maxFailures = maxFailures;
    this.resetMs = resetMs;
    this.failures = 0;
    this.openedAt = 0;
  }
  isOpen() {
    if (this.failures < this.maxFailures) return false;
    if (Date.now() - this.openedAt > this.resetMs) {
      console.log(`Circuit breaker [${this.name}] half-open — retrying`);
      this.failures = 0;
      return false;
    }
    return true;
  }
  recordFailure() {
    this.failures++;
    if (this.failures >= this.maxFailures) {
      this.openedAt = Date.now();
      console.warn(`Circuit breaker [${this.name}] OPEN — ${this.maxFailures} consecutive failures, pausing for ${this.resetMs / 1000}s`);
    }
  }
  recordSuccess() { this.failures = 0; }
  get status() { return this.isOpen() ? 'open' : this.failures > 0 ? 'half-open' : 'closed'; }
}

const epcBreaker = new CircuitBreaker('EPC', { maxFailures: 3, resetMs: 600000 });
const floodBreaker = new CircuitBreaker('Flood', { maxFailures: 3, resetMs: 600000 });
const lrBreaker = new CircuitBreaker('LandRegistry', { maxFailures: 5, resetMs: 300000 });

// EPC API credentials check (logged once at startup)
let _epcWarningLogged = false;
const EPC_API_EMAIL = process.env.EPC_API_EMAIL || '';
const EPC_API_KEY = process.env.EPC_API_KEY || '';
if (!EPC_API_EMAIL || !EPC_API_KEY) {
  console.warn('WARNING: EPC_API_EMAIL or EPC_API_KEY not set — EPC enrichment will be skipped');
  _epcWarningLogged = true;
}

let _lastEPCCallTime = 0;

/**
 * Fetch EPC records for a postcode from the MHCLG Open Data Communities API.
 * Returns an array of EPC records or null on failure.
 * Rate limited to 500ms between calls.
 */
async function fetchEPCByPostcode(postcode) {
  if (!EPC_API_EMAIL || !EPC_API_KEY) return null;
  if (!postcode) return null;
  if (epcBreaker.isOpen()) return null;

  // Rate limit: 500ms between consecutive calls
  const now = Date.now();
  const elapsed = now - _lastEPCCallTime;
  if (elapsed < 500) {
    await new Promise(r => setTimeout(r, 500 - elapsed));
  }
  _lastEPCCallTime = Date.now();

  try {
    const encoded = encodeURIComponent(postcode.trim());
    const url = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encoded}&size=5000`;
    const authToken = Buffer.from(EPC_API_EMAIL + ':' + EPC_API_KEY).toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${authToken}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`EPC API ${response.status} for ${postcode}`);
      epcBreaker.recordFailure();
      return null;
    }

    const data = await response.json();
    const rows = data.rows || data.results || data;
    epcBreaker.recordSuccess();
    return Array.isArray(rows) ? rows : null;
  } catch (e) {
    if (e.name === 'AbortError') {
      console.warn(`EPC API timeout for ${postcode}`);
    } else {
      console.warn(`EPC API error for ${postcode}: ${e.message}`);
    }
    epcBreaker.recordFailure();
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// ENRICHMENT: Flood Zone Lookup (Postcodes.io + EA)
// ═══════════════════════════════════════════════════════════════

let _lastEACallTime = 0;
const EA_RATE_LIMIT_MS = 200;

/**
 * Geocode a postcode via Postcodes.io, then check EA flood zones.
 * Returns { floodZone, floodRiskLevel, lat, lon } or null on failure.
 */
async function fetchFloodZone(postcode) {
  if (!postcode) return null;
  if (floodBreaker.isOpen()) return null;

  try {
    // Step 1: Geocode via Postcodes.io
    const encoded = encodeURIComponent(postcode.trim());
    const geoController = new AbortController();
    const geoTimeout = setTimeout(() => geoController.abort(), 5000);

    const geoRes = await fetch(`https://api.postcodes.io/postcodes/${encoded}`, {
      signal: geoController.signal,
    });
    clearTimeout(geoTimeout);

    if (!geoRes.ok) {
      console.warn(`Postcodes.io ${geoRes.status} for ${postcode}`);
      return null;
    }

    const geoData = await geoRes.json();
    const lat = geoData?.result?.latitude;
    const lon = geoData?.result?.longitude;
    if (!lat || !lon) {
      console.warn(`Postcodes.io no coords for ${postcode}`);
      return null;
    }

    // Step 2: Check EA flood zones via WFS (Zone 3 first, then Zone 2)
    let floodZone = "1";
    let floodRiskLevel = "Low";
    let floodData = null;
    let usedWFS = false;

    try {
      // Rate limit EA calls
      const now = Date.now();
      const elapsed = now - _lastEACallTime;
      if (elapsed < EA_RATE_LIMIT_MS) {
        await new Promise(r => setTimeout(r, EA_RATE_LIMIT_MS - elapsed));
      }
      _lastEACallTime = Date.now();

      // Check Zone 3 first
      const z3FullUrl = `https://environment.data.gov.uk/spatialdata/flood-map-for-planning-rivers-and-sea-flood-zone-3/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=Flood_Map_for_Planning_Rivers_and_Sea_Flood_Zone_3&outputFormat=application/json&count=1&srsName=EPSG:4326&CQL_FILTER=INTERSECTS(shape,POINT(${lon} ${lat}))`;

      const z3Controller = new AbortController();
      const z3Timeout = setTimeout(() => z3Controller.abort(), 5000);
      const z3Res = await fetch(z3FullUrl, { signal: z3Controller.signal });
      clearTimeout(z3Timeout);

      if (z3Res.ok) {
        const z3Data = await z3Res.json();
        if (z3Data.features && z3Data.features.length > 0) {
          floodZone = "3";
          floodRiskLevel = "High";
          floodData = { source: "EA_WFS", zone: 3 };
          usedWFS = true;
        } else {
          // Rate limit between Zone 3 and Zone 2 check
          await new Promise(r => setTimeout(r, EA_RATE_LIMIT_MS));
          _lastEACallTime = Date.now();

          // Check Zone 2
          const z2FullUrl = `https://environment.data.gov.uk/spatialdata/flood-map-for-planning-rivers-and-sea-flood-zone-2/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=Flood_Map_for_Planning_Rivers_and_Sea_Flood_Zone_2&outputFormat=application/json&count=1&srsName=EPSG:4326&CQL_FILTER=INTERSECTS(shape,POINT(${lon} ${lat}))`;

          const z2Controller = new AbortController();
          const z2Timeout = setTimeout(() => z2Controller.abort(), 5000);
          const z2Res = await fetch(z2FullUrl, { signal: z2Controller.signal });
          clearTimeout(z2Timeout);

          if (z2Res.ok) {
            const z2Data = await z2Res.json();
            if (z2Data.features && z2Data.features.length > 0) {
              floodZone = "2";
              floodRiskLevel = "Medium";
              floodData = { source: "EA_WFS", zone: 2 };
              usedWFS = true;
            } else {
              floodData = { source: "EA_WFS", zone: 1 };
              usedWFS = true;
            }
          }
        }
      }
    } catch (wfsErr) {
      console.warn(`EA WFS failed for ${postcode}: ${wfsErr.message}, trying flood monitoring API`);
    }

    // Fallback: flood monitoring API if WFS failed
    if (!usedWFS) {
      try {
        await new Promise(r => setTimeout(r, EA_RATE_LIMIT_MS));
        _lastEACallTime = Date.now();

        const fmController = new AbortController();
        const fmTimeout = setTimeout(() => fmController.abort(), 5000);
        const fmUrl = `https://environment.data.gov.uk/flood-monitoring/id/floods?lat=${lat}&long=${lon}&dist=5`;

        const fmRes = await fetch(fmUrl, { signal: fmController.signal });
        clearTimeout(fmTimeout);

        if (fmRes.ok) {
          const fmData = await fmRes.json();
          const items = fmData.items || [];
          if (items.length > 0) {
            floodRiskLevel = "Alert";
            floodZone = "2";
            floodData = { source: "EA_monitoring", activeWarnings: items.length };
          } else {
            floodData = { source: "EA_monitoring", activeWarnings: 0 };
          }
        }
      } catch (fmErr) {
        console.warn(`EA flood monitoring API also failed for ${postcode}: ${fmErr.message}`);
        floodData = { source: "none", error: "both_apis_failed" };
        floodBreaker.recordFailure();
        return { floodZone: null, floodRiskLevel: null, floodData, lat, lon };
      }
    }

    floodBreaker.recordSuccess();
    return { floodZone, floodRiskLevel, floodData, lat, lon };
  } catch (e) {
    console.warn(`fetchFloodZone error for ${postcode}: ${e.message}`);
    floodBreaker.recordFailure();
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// ENRICHMENT: EPC Address Matching
// ═══════════════════════════════════════════════════════════════

// Common street suffixes to normalise (Road→rd, Street→st, etc.) — hoisted for performance
const EPC_SUFFIX_MAP = { road: 'rd', street: 'st', avenue: 'ave', drive: 'dr', lane: 'ln', close: 'cl', crescent: 'cres', terrace: 'ter', place: 'pl', court: 'ct', gardens: 'gdns', grove: 'gr', way: 'wy', park: 'pk' };

/**
 * Match EPC records to a specific lot address.
 * Returns { epcRating, epcScore, epcDate, _matchConfidence } or null if no confident match.
 */
function matchEPCToLot(epcRecords, lotAddress) {
  if (!epcRecords || !epcRecords.length || !lotAddress) return null;

  function normalise(addr) {
    return (addr || '')
      .toLowerCase()
      .replace(/\b(flat|apartment|unit|apt|ground\s+floor|first\s+floor|second\s+floor)\b/gi, '')
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractNumber(addr) {
    const m = addr.match(/^(\d+[a-z]?)\b/i) || addr.match(/\b(\d+[a-z]?)\s/i);
    return m ? m[1].toLowerCase() : null;
  }

  function extractStreetWords(addr) {
    const cleaned = addr
      .replace(/^\d+[a-z]?\s+/i, '')
      .replace(/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/i, '') // remove postcode
      .trim();
    return cleaned.split(/\s+/).slice(0, 4).map(w => EPC_SUFFIX_MAP[w] || w);
  }

  function streetMatchScore(wordsA, wordsB) {
    if (!wordsA.length || !wordsB.length) return 0;
    let matched = 0;
    for (const w of wordsA) {
      if (wordsB.includes(w)) matched++;
    }
    // Score: proportion of the shorter street name that matched
    return matched / Math.min(wordsA.length, wordsB.length);
  }

  const normLot = normalise(lotAddress);
  const lotNumber = extractNumber(normLot);
  const lotStreetWords = extractStreetWords(normLot);

  if (!lotNumber || !lotStreetWords.length) return null;

  let bestMatch = null;
  let bestDate = '';
  let bestStreetScore = 0;

  for (const rec of epcRecords) {
    const epcAddr = normalise(
      [rec.address1 || rec.address || '', rec.address2 || '', rec.address3 || ''].join(' ')
    );

    const epcNumber = extractNumber(epcAddr);
    if (!epcNumber || epcNumber !== lotNumber) continue;

    const epcStreetWords = extractStreetWords(epcAddr);
    const score = streetMatchScore(lotStreetWords, epcStreetWords);

    // Require at least 50% of street words to match (was: first word only)
    if (score < 0.5) continue;

    const rating = (rec['current-energy-rating'] || rec.currentEnergyRating || '').toUpperCase();
    const epcScore = parseInt(rec['current-energy-efficiency'] || rec.currentEnergyEfficiency || '0', 10);
    const date = rec['lodgement-date'] || rec.lodgementDate || '';

    if (!/^[A-G]$/.test(rating)) continue;
    if (epcScore < 1 || epcScore > 100) continue;

    const epcBeds = parseInt(rec['number-habitable-rooms'] || rec.numberHabitableRooms || rec['number-heated-rooms'] || rec.numberHeatedRooms || '0', 10);

    // Prefer: higher street match score, then most recent date
    if (!bestMatch || score > bestStreetScore || (score === bestStreetScore && date > bestDate)) {
      bestMatch = { epcRating: rating, epcScore: epcScore, epcDate: date, epcBeds: (epcBeds >= 1 && epcBeds <= 20) ? epcBeds : null, _matchConfidence: score };
      bestDate = date;
      bestStreetScore = score;
    }
  }

  return bestMatch;
}

// ═══════════════════════════════════════════════════════════════
// ENRICHMENT: Land Registry + Rental Yield per lot
// ═══════════════════════════════════════════════════════════════
async function enrichLots(lots, house, sourceUrl, onProgress) {
  // Group lots by postcode to avoid duplicate queries
  const postcodeMap = {};
  for (const lot of lots) {
    lot.url = buildLotUrl(lot, house, sourceUrl);
    const pc = extractPostcode(lot.address);
    lot.postcode = pc;
    if (pc && !postcodeMap[pc]) postcodeMap[pc] = [];
    if (pc) postcodeMap[pc].push(lot);
  }

  const postcodes = Object.keys(postcodeMap);
  console.log(`Enriching ${lots.length} lots across ${postcodes.length} unique postcodes...`);

  // ── Geocode postcodes via postcodes.io (free, bulk, no API key) ──
  try {
    for (let i = 0; i < postcodes.length; i += 100) {
      const batch = postcodes.slice(i, i + 100);
      const geoResp = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: batch }),
      });
      if (geoResp.ok) {
        const geoData = await geoResp.json();
        for (const item of (geoData.result || [])) {
          if (item.result) {
            const pc = item.query.toUpperCase().replace(/\s+/g, ' ');
            const lotsForPc = postcodeMap[pc] || postcodeMap[item.query] || [];
            for (const lot of lotsForPc) {
              lot._lat = item.result.latitude;
              lot._lng = item.result.longitude;
            }
          }
        }
      }
    }
    const geocoded = lots.filter(l => l._lat).length;
    if (geocoded > 0) console.log(`Geocoded ${geocoded}/${lots.length} lots`);
  } catch (geoErr) {
    console.warn('Geocoding failed (non-fatal):', geoErr.message);
  }

  // Query Land Registry for each unique postcode (with persistent cache + circuit breaker)
  const LR_CONCURRENCY = 5;
  const LR_CACHE_TTL_DAYS = 14;
  const lrCache = {};
  let enrichDone = 0;
  let lrCacheHits = 0;

  // Check Supabase cache for LR data first
  if (supabase && postcodes.length > 0) {
    try {
      const { data: cached } = await supabase
        .from('enrichment_cache')
        .select('postcode, lr_data')
        .in('postcode', postcodes)
        .gt('lr_expires_at', new Date().toISOString())
        .not('lr_data', 'is', null);
      if (cached) {
        for (const row of cached) {
          lrCache[row.postcode] = row.lr_data;
          lrCacheHits++;
        }
      }
    } catch { /* cache miss — proceed with API */ }
  }

  const uncachedPostcodes = postcodes.filter(pc => !lrCache[pc]);
  if (lrCacheHits > 0) console.log(`LR cache: ${lrCacheHits} hits, ${uncachedPostcodes.length} to fetch`);

  for (let i = 0; i < uncachedPostcodes.length; i += LR_CONCURRENCY) {
    if (lrBreaker.isOpen()) {
      console.warn('LR circuit breaker open — skipping remaining postcodes');
      break;
    }
    const batch = uncachedPostcodes.slice(i, i + LR_CONCURRENCY);
    const results = await Promise.all(batch.map(async (pc) => {
      const result = await queryLandRegistry(pc);
      if (result.failed) {
        lrBreaker.recordFailure();
      } else if (result.data.length > 0) {
        lrBreaker.recordSuccess();
      }
      return result.data;
    }));
    batch.forEach((pc, idx) => { lrCache[pc] = results[idx]; });
    enrichDone += batch.length;
    if (onProgress) onProgress(lrCacheHits + enrichDone, postcodes.length);
    if (i + LR_CONCURRENCY < uncachedPostcodes.length) await new Promise(r => setTimeout(r, 200));
  }

  // Persist LR results to Supabase cache (update only lr_data columns, preserve EPC/flood)
  if (supabase && uncachedPostcodes.length > 0) {
    const lrExpiry = new Date(Date.now() + LR_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    try {
      const toStore = uncachedPostcodes.filter(pc => lrCache[pc] && lrCache[pc].length > 0);
      let stored = 0;
      for (const pc of toStore) {
        try {
          // Try update first (row may exist from EPC/flood enrichment)
          const { data: updated } = await supabase.from('enrichment_cache')
            .update({ lr_data: lrCache[pc], lr_expires_at: lrExpiry })
            .eq('postcode', pc)
            .select('postcode');
          if (!updated || updated.length === 0) {
            // Row doesn't exist yet — insert with LR data only
            await supabase.from('enrichment_cache').insert({
              postcode: pc, lr_data: lrCache[pc], lr_expires_at: lrExpiry,
              cached_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            });
          }
          stored++;
        } catch { /* individual write failure — continue */ }
      }
      if (stored > 0) console.log(`LR cache: stored ${stored} postcodes (${LR_CACHE_TTL_DAYS}d TTL)`);
    } catch (e) {
      console.warn('LR cache write failed (non-fatal):', e.message);
    }
  }

  // Enrich each lot
  for (const lot of lots) {
    const pc = lot.postcode;
    const sales = lrCache[pc] || [];
    
    // Street sales data
    lot.streetSales = sales.slice(0, 10).map(s => ({
      address: s.address,
      price: s.price,
      date: s.date,
      type: s.propertyType,
    }));

    // Calculate street average (last 3 years) — type-aware with IQR outlier exclusion
    const allSales = sales.filter(s => s.price > 0);
    // Try type-matched comps first (flat vs flat, house vs house)
    const typeMap = { flat: /flat|maisonette/i, house: /terraced|semi|detached/i, bungalow: /bungalow/i };
    const typePattern = typeMap[lot.propType];
    const typedSales = typePattern ? allSales.filter(s => typePattern.test(s.propertyType || '')) : [];
    // Use typed comps if we have 2+, otherwise fall back to all sales
    let relevantSales = typedSales.length >= 2 ? typedSales : allSales;
    // IQR-based outlier exclusion (only with 4+ comps to have meaningful quartiles)
    if (relevantSales.length >= 4) {
      const prices = relevantSales.map(s => s.price).sort((a, b) => a - b);
      const q1 = prices[Math.floor(prices.length * 0.25)];
      const q3 = prices[Math.floor(prices.length * 0.75)];
      const iqr = q3 - q1;
      const lower = q1 - 1.5 * iqr;
      const upper = q3 + 1.5 * iqr;
      const filtered = relevantSales.filter(s => s.price >= lower && s.price <= upper);
      if (filtered.length >= 2) relevantSales = filtered; // Only apply if we keep enough comps
    }
    if (relevantSales.length > 0) {
      const avg = Math.round(relevantSales.reduce((s, x) => s + x.price, 0) / relevantSales.length);
      lot.streetAvg = avg;
      lot.streetSalesCount = relevantSales.length;
      lot._compType = typedSales.length >= 2 ? 'matched' : 'all'; // Signal comp quality
      
      // Bargain score: how far below street average is the guide price?
      // Only score for residential — street comps are house sales, meaningless for land/garage/commercial
      const compReliable = ['house', 'bungalow', 'flat'].includes(lot.propType);
      if (lot.price && avg > 0) {
        const discount = ((avg - lot.price) / avg) * 100;
        lot.belowMarket = Math.round(discount);
        if (compReliable && discount > 20) {
          lot.score += 2;
          lot.scoreBreakdown = lot.scoreBreakdown || [];
          lot.scoreBreakdown.push({ signal: `${lot.belowMarket}% below market`, pts: 2 });
          lot.opps.push(`${lot.belowMarket}% below market`);
        } else if (compReliable && discount > 10) {
          lot.score += 1;
          lot.scoreBreakdown = lot.scoreBreakdown || [];
          lot.scoreBreakdown.push({ signal: `${lot.belowMarket}% below market`, pts: 1 });
          lot.opps.push(`${lot.belowMarket}% below market`);
        } else if (discount < -10) {
          lot.risks.push(`${Math.abs(lot.belowMarket)}% above market avg`);
        }
        lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
      }
    } else {
      lot.streetAvg = null;
      lot.streetSalesCount = 0;
    }

    // Rental yield estimate — only for property types that generate rental income
    const yieldEligible = ['house', 'bungalow', 'flat', 'commercial'].includes(lot.propType);
    const monthlyRent = yieldEligible ? estimateMonthlyRent(lot.address, lot.beds, lot.units) : 0;
    lot.estMonthlyRent = monthlyRent || null;
    lot._rentMultiUnit = lot.units >= 2; // Flag multi-unit rent estimates for frontend
    lot.estAnnualRent = monthlyRent ? monthlyRent * 12 : null;
    if (lot.price && lot.price > 0 && lot.estAnnualRent) {
      lot.estGrossYield = Math.round((lot.estAnnualRent / lot.price) * 1000) / 10;
      // Flag unrealistic yields — typically caused by very low guide prices
      if (lot.estGrossYield > 30) {
        lot._yieldEstimateWarning = true;
        if (!lot.risks) lot.risks = [];
        if (!lot.risks.some(r => /yield.*unrealistic|verify.*rent/i.test(r))) {
          lot.risks.push('Yield estimate unrealistic — verify actual achievable rent');
        }
      }
      if (yieldEligible && lot.estGrossYield > 8 && !lot._yieldEstimateWarning && !lot.opps.some(o => o.includes('GIY') || o.includes('yield'))) {
        lot.score += 2.5;
        lot.scoreBreakdown = lot.scoreBreakdown || [];
        lot.scoreBreakdown.push({ signal: `Est. ${lot.estGrossYield}% yield`, pts: 2.5 });
        lot.opps.push(`Est. ${lot.estGrossYield}% yield`);
      } else if (yieldEligible && lot.estGrossYield > 6 && !lot._yieldEstimateWarning && !lot.opps.some(o => o.includes('GIY') || o.includes('yield'))) {
        lot.score += 1.5;
        lot.scoreBreakdown = lot.scoreBreakdown || [];
        lot.scoreBreakdown.push({ signal: `Est. ${lot.estGrossYield}% yield`, pts: 1.5 });
        lot.opps.push(`Est. ${lot.estGrossYield}% yield`);
      }
      lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
    }
  }


  // ── EPC & Flood Risk Enrichment (best-effort, never blocks pipeline) ──
  try {
    const ENRICH_CONCURRENCY = 3;
    const enrichmentPostcodes = postcodes.filter(Boolean);
    console.log(`EPC/Flood enrichment: processing ${enrichmentPostcodes.length} postcodes...`);

    // Clean expired cache entries once per enrichLots cycle
    if (supabase) {
      try {
        await supabase.from('enrichment_cache').delete().lt('expires_at', new Date().toISOString());
      } catch (cleanErr) {
        // Non-fatal
      }
    }

    for (let i = 0; i < enrichmentPostcodes.length; i += ENRICH_CONCURRENCY) {
      const batch = enrichmentPostcodes.slice(i, i + ENRICH_CONCURRENCY);

      const results = await Promise.allSettled(batch.map(async (pc) => {
        let epcRecords = null;
        let floodResult = null;

        // Check cache first
        if (supabase) {
          try {
            const { data: cached } = await supabase
              .from('enrichment_cache')
              .select('*')
              .eq('postcode', pc)
              .gt('expires_at', new Date().toISOString())
              .single();

            if (cached) {
              epcRecords = cached.epc_data;
              floodResult = {
                floodZone: cached.flood_zone,
                floodRiskLevel: cached.flood_zone === "3" ? "High" : cached.flood_zone === "2" ? "Medium" : "Low",
                floodData: cached.flood_data,
                lat: parseFloat(cached.lat),
                lon: parseFloat(cached.lon),
              };
              return { pc, epcRecords, floodResult, fromCache: true };
            }
          } catch (cacheErr) {
            // Cache miss or table not ready — proceed with API calls
          }
        }

        // Cache miss — fetch from APIs
        const [epcResult, floodRes] = await Promise.allSettled([
          fetchEPCByPostcode(pc),
          fetchFloodZone(pc),
        ]);

        epcRecords = epcResult.status === 'fulfilled' ? epcResult.value : null;
        floodResult = floodRes.status === 'fulfilled' ? floodRes.value : null;

        // Store in cache
        if (supabase && (epcRecords || floodResult)) {
          try {
            await supabase.from('enrichment_cache').upsert({
              postcode: pc,
              epc_data: epcRecords,
              flood_zone: floodResult?.floodZone || null,
              flood_data: floodResult?.floodData || null,
              lat: floodResult?.lat || null,
              lon: floodResult?.lon || null,
              cached_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            }, { onConflict: 'postcode' });
          } catch (upsertErr) {
            // Cache write failure is non-fatal
            console.warn(`enrichment_cache upsert failed for ${pc}: ${upsertErr.message}`);
          }
        }

        return { pc, epcRecords, floodResult, fromCache: false };
      }));

      // Apply enrichment data to lots in this batch
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { pc, epcRecords, floodResult } = result.value;
        const lotsForPc = postcodeMap[pc] || [];

        for (const lot of lotsForPc) {
          // EPC matching
          if (epcRecords && epcRecords.length > 0) {
            const epcMatch = matchEPCToLot(epcRecords, lot.address);
            if (epcMatch) {
              lot.epcRating = epcMatch.epcRating;
              lot.epcScore = epcMatch.epcScore;
              lot.epcDate = epcMatch.epcDate;
              // Fill beds from EPC if not already extracted
              if (!lot.beds && epcMatch.epcBeds) {
                lot.beds = epcMatch.epcBeds;
                lot._bedsSource = 'epc';
              }
            }
          }

          // MEES regulatory risk for poor EPC ratings
          if (lot.epcRating && /^[EFG]$/i.test(lot.epcRating)) {
            if (!lot.risks) lot.risks = [];
            if (!lot.risks.some(r => /MEES|EPC.*unlettable|cannot.*legally.*let/i.test(r))) {
              const rating = lot.epcRating.toUpperCase();
              if (/^[FG]$/i.test(rating)) {
                lot.risks.push(`EPC ${rating} — cannot legally let without upgrading (MEES regs)`);
              } else {
                lot.risks.push(`EPC E — at risk under tightening MEES regulations`);
              }
            }
          }

          // Flood zone
          if (floodResult) {
            lot.floodZone = floodResult.floodZone;
            lot.floodRiskLevel = floodResult.floodRiskLevel;
          }

          lot.enrichedAt = new Date().toISOString();
        }
      }
    }

    const epcCount = lots.filter(l => l.epcRating).length;
    const floodCount = lots.filter(l => l.floodZone).length;
    const bedsCount = lots.filter(l => l.beds != null).length;
    const bedsFromEpc = lots.filter(l => l._bedsSource === 'epc').length;
    console.log(`EPC/Flood enrichment done: ${epcCount} lots with EPC, ${floodCount} lots with flood zone, beds: ${bedsCount}/${lots.length} (${Math.round(bedsCount/lots.length*100)}%${bedsFromEpc ? ', ' + bedsFromEpc + ' from EPC' : ''})`);
  } catch (enrichErr) {
    console.warn(`EPC/Flood enrichment failed (non-fatal): ${enrichErr.message}`);
  }

  // Re-sort by score after enrichment
  lots.sort((a, b) => b.score - a.score);
  console.log(`Enrichment complete. ${Object.values(lrCache).flat().length} total Land Registry sales found.`);
  return lots;
}
// ═══════════════════════════════════════════════════════════════
// ENRICHMENT CACHE TABLE INIT
// ═══════════════════════════════════════════════════════════════
async function ensureEnrichmentCacheTable() {
  if (!supabase) return;
  try {
    // Check if table exists by attempting a simple query
    const { error } = await supabase.from('enrichment_cache').select('postcode').limit(1);
    if (error && error.code === '42P01') {
      // Table doesn't exist — create via raw SQL using rpc
      console.log('Creating enrichment_cache table...');
      const { error: createErr } = await supabase.rpc('exec_sql', {
        sql: `
          CREATE TABLE IF NOT EXISTS enrichment_cache (
            postcode TEXT PRIMARY KEY,
            epc_data JSONB,
            flood_zone TEXT,
            flood_data JSONB,
            lat NUMERIC(9,6),
            lon NUMERIC(9,6),
            lr_data JSONB,
            lr_expires_at TIMESTAMPTZ,
            cached_at TIMESTAMPTZ DEFAULT NOW(),
            expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
          );
          CREATE INDEX IF NOT EXISTS idx_enrichment_expires ON enrichment_cache(expires_at);
        `
      });
      if (createErr) {
        console.warn('enrichment_cache table creation via rpc failed (create manually in Supabase dashboard):', createErr.message);
        console.log(`SQL to run manually:
CREATE TABLE IF NOT EXISTS enrichment_cache (
  postcode TEXT PRIMARY KEY,
  epc_data JSONB,
  flood_zone TEXT,
  flood_data JSONB,
  lat NUMERIC(9,6),
  lon NUMERIC(9,6),
  lr_data JSONB,
  lr_expires_at TIMESTAMPTZ,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);
CREATE INDEX IF NOT EXISTS idx_enrichment_expires ON enrichment_cache(expires_at);
ALTER TABLE enrichment_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON enrichment_cache FOR ALL USING (true) WITH CHECK (true);`);
      } else {
        console.log('enrichment_cache table created successfully');
      }
    } else if (!error) {
      console.log('enrichment_cache table exists');
      // Migrate: add LR columns if missing
      try {
        await supabase.rpc('exec_sql', {
          sql: `ALTER TABLE enrichment_cache ADD COLUMN IF NOT EXISTS lr_data JSONB; ALTER TABLE enrichment_cache ADD COLUMN IF NOT EXISTS lr_expires_at TIMESTAMPTZ;`
        });
      } catch { /* columns may already exist or rpc unavailable */ }
    }
  } catch (e) {
    console.warn('enrichment_cache table check failed:', e.message);
  }
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
    getCircuitBreakers: () => ({ epc: epcBreaker.status, flood: floodBreaker.status, landRegistry: lrBreaker.status }),
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
  if (fcCreditExhausted && Date.now() - fcExhaustedAt > 3600000) {
    fcCreditExhausted = false;
    fcExhaustedAt = 0;
    console.log('Firecrawl credit exhaustion flag auto-cleared (1h TTL)');
  }
  if (fcTemporarilyDown && Date.now() - fcDownAt > 600000) {
    fcTemporarilyDown = false;
    fcDownAt = 0;
    fcConsecutive5xx = 0;
    console.log('Firecrawl temporarily-down flag auto-cleared (10min TTL)');
  }
}, 300000);
let apiCallCount = 0;
let hashHitCount = 0;
const serverStartTime = new Date().toISOString();

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
            if (FIRECRAWL_API_KEY && !fcCreditExhausted) {
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
  if (FIRECRAWL_API_KEY && !fcCreditExhausted) {
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
      if (FIRECRAWL_API_KEY && !fcCreditExhausted) {
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
      if (FIRECRAWL_API_KEY && !fcCreditExhausted && !FIRECRAWL_SKIP.has(house)) {
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
    if (fcCreditExhausted) console.log(`AUTO: Firecrawl credits exhausted, will use Puppeteer fallback for ${house}`);

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
        if (fcCreditExhausted && !puppeteer) { console.log(`AUTO: No scraping engine available at page ${p}`); break; }
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
    if (FIRECRAWL_API_KEY && !fcCreditExhausted) {
      await backfillImagesWithFirecrawl(url, lots, house);
    }
    // Pass 2: Puppeteer for any remaining misses (renders JS natively, better at intersection observers)
    const stillMissing = lots.filter(l => !l.imageUrl).length;
    if (stillMissing > 0 && puppeteer) {
      await backfillImagesWithPuppeteer(url, lots, house);
    }
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
      extractionMethod: _lastExtractorUsed || 'unknown',
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
    scraped_with: _lastScrapeEngine,
    extracted_with: _lastExtractorUsed,
    ai_tier: _lastAITier,
  }, { onConflict: 'url' });

  // ── Upsert individual lots to lots table (single source of truth) ──
  normaliseLotStatuses(lots); // Normalize before write — canonical statuses only
  await upsertToLotsTable(lots, house, url, {
    scrapedWith: _lastScrapeEngine,
    extractedWith: _lastExtractorUsed,
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
      scrapedWith: _lastScrapeEngine,
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
async function getCalendarAuctions() {
  const today = new Date().toISOString().slice(0, 10);
  // Include last 7 days for past failed scrape auditing
  const lookback = new Date();
  lookback.setDate(lookback.getDate() - 7);
  const lookbackDate = lookback.toISOString().slice(0, 10);
  // Try Supabase first — include dated auctions (lookback) + always_on houses
  try {
    const { data, error } = await supabase
      .from('auction_calendar')
      .select('house, url, date, catalogue_ready, status')
      .eq('catalogue_ready', true)
      .or(`date.gte.${lookbackDate},status.eq.always_on`)
      .order('date', { ascending: true });

    const alwaysOn = (data || []).filter(r => r.status === 'always_on').length;
    const dated = (data || []).filter(r => r.status !== 'always_on').length;
    console.log(`getCalendarAuctions: Supabase returned ${(data || []).length} rows (${alwaysOn} always_on, ${dated} dated), error=${error ? error.message : 'none'}`);
    if (!error && data && data.length > 0) {
      // Deduplicate by normalised URL — keep earliest date per URL
      const seen = new Map();
      for (const row of data) {
        const norm = normaliseUrl(row.url);
        if (!norm) continue;
        if (!seen.has(norm) || (row.date && (!seen.get(norm).date || row.date < seen.get(norm).date))) {
          seen.set(norm, row);
        }
      }
      const deduped = [...seen.values()];
      if (deduped.length < data.length) {
        console.log(`getCalendarAuctions: Deduplicated ${data.length} → ${deduped.length} rows by URL`);
      }
      return deduped.map(row => ({
        house: row.house,
        url: row.url,
        date: row.date,
        catalogueReady: row.catalogue_ready,
        status: row.status || 'upcoming',
      }));
    }
    console.log('getCalendarAuctions: Supabase returned 0 rows, falling through to fallback');
  } catch (e) {
    console.warn('Calendar DB read failed in getCalendarAuctions, using fallback:', e.message);
  }

  // Fallback to hardcoded (no always_on in fallback)
  const fallbackFiltered = FALLBACK_CALENDAR.filter(a => a.catalogueReady && a.date >= lookbackDate);
  console.log(`getCalendarAuctions: Using FALLBACK — ${FALLBACK_CALENDAR.filter(a => a.catalogueReady).length} catalogue-ready, ${fallbackFiltered.length} within lookback (${lookbackDate})`);
  return fallbackFiltered
    .map(a => ({
      house: a.house,
      url: a.url,
      date: a.date,
      catalogueReady: a.catalogueReady,
      status: 'upcoming',
    }));
}
