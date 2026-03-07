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
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { readFileSync } from 'fs';
import { lookup } from 'dns/promises';
import puppeteer from 'puppeteer';
import Stripe from 'stripe';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
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
  if (bufA.length !== bufB.length) return timingSafeEqual(Buffer.from(a.padEnd(64)), Buffer.from(b.padEnd(64))) && false;
  return timingSafeEqual(bufA, bufB);
}

// ═══════════════════════════════════════════════════════════════
// SECURITY HEADERS
// ═══════════════════════════════════════════════════════════════
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://*.supabase.co https://www.bridgematch.co.uk https://checkout.stripe.com; " +
    "frame-src https://checkout.stripe.com; " +
    "frame-ancestors 'none'"
  );
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ═══════════════════════════════════════════════════════════════
// CSRF ORIGIN VALIDATION
// ═══════════════════════════════════════════════════════════════
function csrfCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/api/stripe/webhook') return next(); // Stripe uses its own signature verification
  const origin = req.headers.origin || req.headers.referer || '';
  const allowed = ['https://auctions.bridgematch.co.uk', 'https://www.bridgematch.co.uk', 'https://bridgematch.co.uk'];
  if (origin && allowed.some(a => origin.startsWith(a))) {
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
const RATE_LIMIT = 5;
const CACHE_DAYS = 7; // fallback default
const CACHE_TIERS = {
  high:   { houses: ['allsop','savills','sdl','network','bidx1'], ttlHours: 12 },
  medium: { houses: ['cliveemson','edwardmellor','bondwolfe','strettons','countrywide','tcpa','futureauctions','firstforauctions','harmanhealy'], ttlHours: 24 },
  low:    { houses: [], ttlHours: 48 }  // everything else
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
const MAX_LOTS_PER_SCRAPE = 100;
const MAX_AUCTIONS_PER_HOUSE = 2;
const TIMEOUT = 25000;

// ═══════════════════════════════════════════════════════════════
// CLAUDE MODEL SELECTION — Haiku for known houses, Sonnet for unknown/PDF
// ═══════════════════════════════════════════════════════════════
const MODEL_SONNET = 'claude-sonnet-4-6';
const MODEL_HAIKU  = 'claude-haiku-4-5-20251001';

// One-line structural hints for known houses — injected into Haiku prompts
// to compensate for smaller model capacity. Each describes the HTML/JSON shape.
const HOUSE_EXTRACTION_HINTS = {
  // Static HTML / SKIP_PUPPETEER houses (always reach Claude)
  allsop:        'Allsop API returns JSON with properties array. Each has address, guide_price, lot_number, slug, features, auction_type fields.',
  knightfrank:   'EIG auction platform. Lots in cards/rows with lot number, address, guide price, and detail links under knightfrankauctions.com.',
  paulfosh:      'Auction lot listings with lot number, address, guide price, property type, and links under paulfosh.com.',
  cottons:       'Auction catalogue with lot cards showing lot number, address, guide price, property description, and detail links.',
  dedmangray:    'Property auction lots with lot number, address, guide price, key features, and detail page URLs.',
  barnettross:   'Auction lot listings with lot number, address, guide/reserve price, brief description, and detail links.',
  philliparnold: 'Auction catalogue cards with lot number, address, guide price, property type, and detail URLs under philliparnoldauctions.co.uk.',
  bidx1:         'Online auction platform. Lot cards with lot number, address, guide price, property type, closing date, and detail links under bidx1.com.',
  edwardmellor:  'Auction lots listed with lot number, full address, guide price, tenure, bedrooms, and detail page links.',
  bradleyhall:   'Property cards on auction.bradleyhall.co.uk with lot number, address, guide price, and search result links.',
  connectuk:     'Realtime auction platform. Lot listings with lot number, address, guide price, property type, and detail links.',
  auctionestates:'Lot cards with lot number, address, guide price, property type, tenure, and detail page URLs.',
  landwood:      'Commercial/mixed property lots with lot number, address, guide price, property type, and detail links.',
  loveitts:      'Auction catalogue with lot number, address, guide price, property description, tenure, and links.',
  hunters:       'Property search results with lot/property cards showing address, price, key features, and detail links.',
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
  mchughandco:        'McHugh & Co auctions. Lot cards with lot number, address, guide price, property description, and detail links.',
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
};

function getExtractionModel(house) {
  return house === 'unknown' ? MODEL_SONNET : MODEL_HAIKU;
}

// ═══════════════════════════════════════════════════════════════
// HOUSE ROOTS — catalogue discovery URLs
// ═══════════════════════════════════════════════════════════════
// Each house's root/listing page where upcoming auction catalogue links can be found.
// Used by /api/discover-catalogues to auto-detect new auction URLs when they change.
const HOUSE_ROOTS = {
  savills:            'https://auctions.savills.co.uk/upcoming-auctions',
  allsop:             'https://www.allsop.co.uk/auction-calendar/',
  sdl:                'https://www.btgeddisonspropertyauctions.com/properties/',
  network:            'https://www.networkauctions.co.uk/auctions/next-auction/',
  bondwolfe:          'https://www.bondwolfe.com/auctions/properties/',
  barnardmarcus:      'https://www.barnardmarcusauctions.co.uk/',
  auctionhouselondon: 'https://www.auctionhouselondon.co.uk/next-auction/',
  auctionhouse:       'https://www.auctionhouse.co.uk/auction/search',
  cliveemson:         'https://www.cliveemson.co.uk/properties/',
  strettons:          'https://www.strettons.co.uk/auctions/',
  acuitus:            'https://www.acuitus.co.uk/find-a-property/',
  hollismorgan:       'https://www.hollismorgan.co.uk/search-auction/',
  maggsandallen:      'https://www.maggsandallen.co.uk/search-auction/',
  mchughandco:        'https://www.mchughandco.com/pages/auctions',
  knightfrank:        'https://www.knightfrankauctions.com/forthcoming-auctions/',
  pattinson:          'https://www.pattinson.co.uk/auction',
  bidx1:              'https://www.bidx1.com/en-gb/properties',
  philliparnold:      'https://www.philliparnoldauctions.co.uk/current-lots',
  edwardmellor:       'https://www.edwardmellor.co.uk/auction/',
  // paulfosh: REMOVED — site down (Squarespace parking page), no DOM extractor
  cottons:            'https://www.cottons.co.uk/',
  dedmangray:         'https://www.dedmangray.co.uk/auction/',
  barnettross:        'https://www.barnettross.co.uk/lotlist.php?a=&countryid=1',
  bradleyhall:        'https://auction.bradleyhall.co.uk/',
  connectuk:          'https://www.connectukauctions.co.uk/',
  auctionestates:     'https://www.auctionestates.co.uk/',
  landwood:           'https://www.landwoodpropertyauctions.com/',
  loveitts:           'https://www.loveitts.co.uk/auction/',
  // hunters: REMOVED — auction service discontinued, no DOM extractor
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
};

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

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
app.post('/api/signup', async (req, res) => {
  const { email, name } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

  try {
    const token = randomBytes(32).toString('hex');
    const { data: existing } = await supabase
      .from('users')
      .select('id, email, name, tier')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existing) {
      await supabase.from('users').update({ last_login: new Date().toISOString(), session_token: token }).eq('id', existing.id);
      return res.json({ user: existing, token, returning: true });
    }

    const { data: newUser, error } = await supabase
      .from('users')
      .insert({ email: email.toLowerCase().trim(), name: name || null, session_token: token })
      .select('id, email, name, tier')
      .single();

    if (error) throw error;
    return res.json({ user: newUser, token, returning: false });
  } catch (err) {
    console.error('Signup error:', err);
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
      .select('id, email, name, tier, analyses_count, tier_expires_at, stripe_subscription_id, consent_auction_alerts, consent_partner_marketing')
      .eq('id', user.id)
      .single();
    res.json(data || user);
  } catch (err) {
    res.json(user);
  }
});

// ═══════════════════════════════════════════════════════════════
// STRIPE: Checkout, Webhook, Portal, Status
// ═══════════════════════════════════════════════════════════════

// POST /api/stripe/checkout — create Stripe Checkout session
app.post('/api/stripe/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { product } = req.body || {};
  if (!['day_pass', 'monthly'].includes(product)) {
    return res.status(400).json({ error: 'Invalid product. Use "day_pass" or "monthly".' });
  }

  const priceId = product === 'day_pass'
    ? process.env.STRIPE_DAY_PASS_PRICE_ID
    : process.env.STRIPE_MONTHLY_PRICE_ID;
  if (!priceId) return res.status(503).json({ error: 'Price not configured' });

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
      success_url: `${req.headers.origin || 'https://auctions.bridgematch.co.uk'}/?payment=success`,
      cancel_url: `${req.headers.origin || 'https://auctions.bridgematch.co.uk'}/?payment=cancelled`,
      metadata: { user_id: user.id, product },
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    log.error('Stripe checkout error', { error: err.message, userId: user.id });
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

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

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        const product = session.metadata?.product;
        if (!userId) break;

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
          // Day pass: premium for 24 hours
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
        // Find user by subscription ID and downgrade
        const { data: subUser } = await supabase
          .from('users')
          .select('id')
          .eq('stripe_subscription_id', sub.id)
          .single();
        if (subUser) {
          await supabase.from('users').update({
            tier: 'free',
            stripe_subscription_id: null,
            tier_expires_at: null,
          }).eq('id', subUser.id);
          log.info('Subscription cancelled', { userId: subUser.id });
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
        if (subUser && sub.status === 'active') {
          await supabase.from('users').update({ tier: 'premium' }).eq('id', subUser.id);
        } else if (subUser && ['past_due', 'canceled', 'unpaid'].includes(sub.status)) {
          await supabase.from('users').update({ tier: 'free', stripe_subscription_id: null, tier_expires_at: null }).eq('id', subUser.id);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        log.warn('Invoice payment failed', { customer: invoice.customer, subscription: invoice.subscription });
        break;
      }
    }
  } catch (err) {
    log.error('Stripe webhook handler error', { error: err.message, eventType: event.type });
  }

  res.json({ received: true });
});

// POST /api/stripe/portal — billing portal for subscription management
app.post('/api/stripe/portal', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (!user.stripe_customer_id) return res.status(400).json({ error: 'No billing account found' });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${req.headers.origin || 'https://auctions.bridgematch.co.uk'}/`,
    });
    res.json({ url: session.url });
  } catch (err) {
    log.error('Stripe portal error', { error: err.message });
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// GET /api/stripe/status — return user's subscription status
app.get('/api/stripe/status', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  res.json({
    tier: user.tier || 'free',
    scansUsed: user.analyses_count || 0,
    scanLimit: FREE_SCAN_LIMIT,
    tierExpiresAt: user.tier_expires_at || null,
    hasSubscription: !!user.stripe_subscription_id,
  });
});

// ═══════════════════════════════════════════════════════════════
// API: LEAD SUBMISSION (BridgeMatch Lite)
// ═══════════════════════════════════════════════════════════════
app.post('/api/leads', async (req, res) => {
  const {
    name, email, phone, contactPref, isRegulated, occupancy,
    propertyPrice, loanAmount, ltvPercent, worksBudget,
    matchingLenders, propertyType, propertyAddress,
    depositRange, experienceLevel, auctionUrl, dealData,
    source
  } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  // Phone required unless it's a simple email capture (e.g. landing-page newsletter)
  if (!phone && !source) {
    return res.status(400).json({ error: 'Name, email, and phone are required' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  try {
    const { data, error } = await supabase
      .from('leads')
      .insert({
        name,
        email: email.toLowerCase().trim(),
        phone: phone || null,
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
        deal_data: source ? { source, ...(dealData || {}) } : (dealData || null),
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
      const html = `
        <h2>New Lead from Auction Tool</h2>
        <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Name</td><td>${name}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Email</td><td><a href="mailto:${email}">${email}</a></td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Phone</td><td><a href="tel:${phone}">${phone}</a></td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Preferred contact</td><td>${contactPref || 'email'}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Type</td><td>${regulated}</td></tr>
          ${propertyAddress ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Property</td><td>${propertyAddress}</td></tr>` : ''}
          ${propertyPrice ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Price</td><td>${propertyPrice}</td></tr>` : ''}
          ${loanAmount ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Loan needed</td><td>${loanAmount}</td></tr>` : ''}
          ${ltvPercent ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">LTV</td><td>${ltvPercent}%</td></tr>` : ''}
          ${worksBudget ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Works budget</td><td>${worksBudget}</td></tr>` : ''}
          ${matchingLenders ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Matching lenders</td><td>${matchingLenders}</td></tr>` : ''}
          ${propertyType ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Property type</td><td>${propertyType}</td></tr>` : ''}
          ${depositRange ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Deposit range</td><td>${depositRange}</td></tr>` : ''}
          ${experienceLevel ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Experience</td><td>${experienceLevel}</td></tr>` : ''}
          ${auctionUrl ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Source</td><td><a href="${auctionUrl}">View deal</a></td></tr>` : ''}
        </table>
      `;
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'BridgeMatch <hello@bridgematch.co.uk>',
          to: ['hello@bridgematch.co.uk'],
          subject: `🏠 New lead: ${name} — ${propertyPrice || 'price TBC'}`,
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
        .select('id, email, name, tier, analyses_count, stripe_customer_id, tier_expires_at, stripe_subscription_id')
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
          .select('id, email, name, tier, analyses_count, stripe_customer_id, tier_expires_at, stripe_subscription_id')
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

      // Auto-create new user
      const { data: newUser, error: insertErr } = await supabase
        .from('users')
        .insert({ email: (email || '').toLowerCase().trim(), supabase_auth_id: authId })
        .select('id, email, name, tier, analyses_count, stripe_customer_id, tier_expires_at, stripe_subscription_id')
        .single();
      if (!insertErr && newUser) return newUser;
      return null;
    }

    // 2) Legacy fallback: session_token lookup (migration window)
    try {
      const { data } = await supabase
        .from('users')
        .select('id, email, name, tier, analyses_count, stripe_customer_id, tier_expires_at, stripe_subscription_id')
        .eq('session_token', token)
        .single();
      if (data) return data;
    } catch { /* fall through */ }
  }

  return null;
}

const FREE_SCAN_LIMIT = 3;

function stripAIFields(lots) {
  return lots.map(lot => ({ ...lot, score: null, opps: [], risks: [], bullets: [], dealType: null, blurred: true }));
}

// ═══════════════════════════════════════════════════════════════
// API: AUCTION CALENDAR
// ═══════════════════════════════════════════════════════════════

// Hardcoded fallback calendar — used when Supabase auction_calendar table is empty
const FALLBACK_CALENDAR = [
    // ── SAVILLS ──
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-02-24', dateEnd: '2026-02-25',
      title: '24 & 25 February 2026', lots: 322,
      url: 'https://auctions.savills.co.uk/auctions/24--25-february-2026-218',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-03-17', title: '17 March 2026', lots: null,
      url: 'https://auctions.savills.co.uk/upcoming-auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-03-31', title: '31 March 2026', lots: null,
      url: 'https://auctions.savills.co.uk/upcoming-auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-04-21', title: '21 April 2026', lots: null,
      url: 'https://auctions.savills.co.uk/upcoming-auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Savills', houseSlug: 'savills', logo: '🏛️',
      date: '2026-05-06', title: '6 May 2026', lots: null,
      url: 'https://auctions.savills.co.uk/upcoming-auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── ALLSOP ──
    {
      house: 'Allsop', houseSlug: 'allsop', logo: '🔨',
      date: '2026-02-25', dateEnd: '2026-02-26',
      title: '25 & 26 February 2026 — Residential', lots: 325,
      url: 'https://www.allsop.co.uk/residential-auction-view',
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
      date: '2026-03-10', title: '10 March 2026', lots: null,
      url: 'https://www.barnardmarcusauctions.co.uk/auctions/current/',
      location: 'Grand Connaught Rooms, London WC2B', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // ── AUCTION HOUSE LONDON ──
    {
      house: 'Auction House London', houseSlug: 'auctionhouselondon', logo: '🔑',
      date: '2026-03-04', title: '4 March 2026', lots: 45,
      url: 'https://auctionhouselondon.co.uk/current-auction',
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
      date: '2026-03-05', title: '5 March 2026 catalogue live', lots: null,
      url: 'https://www.cliveemson.co.uk/search/',
      location: 'Online', type: 'Residential & Land', status: 'upcoming',
      catalogueReady: true,
    },
    // ── STRETTONS ──
    {
      house: 'Strettons', houseSlug: 'strettons', logo: '📋',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.strettons.co.uk/auctions/current-catalogue/',
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
      date: '2026-03-11', title: '11 March 2026', lots: null,
      url: 'https://probate.auction/auctions/wednesday-11th-march-2026/',
      location: 'Online', type: 'Residential (Probate)', status: 'upcoming',
      catalogueReady: true,
    },
    // ── HOLLIS MORGAN (Bristol) ──
    {
      house: 'Hollis Morgan', houseSlug: 'hollismorgan', logo: '🏘️',
      date: '2026-03-11', title: '11 March 2026', lots: null,
      url: 'https://www.hollismorgan.co.uk/search-auction/?bid=11&showstc=on&orderby=lot_no+asc',
      location: 'Online (Live Stream from Clifton, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Hollis Morgan', houseSlug: 'hollismorgan', logo: '🏘️',
      date: '2026-04-01', title: 'April 2026', lots: null,
      url: 'https://www.hollismorgan.co.uk/search-auction/?bid=11&showstc=on&orderby=lot_no+asc',
      location: 'Online (Live Stream from Clifton, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── MAGGS & ALLEN (Bristol) ──
    {
      house: 'Maggs & Allen', houseSlug: 'maggsandallen', logo: '🔨',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.maggsandallen.co.uk/search-auction/',
      location: 'Online (Live Stream, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Maggs & Allen', houseSlug: 'maggsandallen', logo: '🔨',
      date: '2026-04-23', title: '23 April 2026', lots: null,
      url: 'https://www.maggsandallen.co.uk/search-auction/',
      location: 'Online (Live Stream, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    {
      house: 'Maggs & Allen', houseSlug: 'maggsandallen', logo: '🔨',
      date: '2026-05-20', title: '20 May 2026', lots: null,
      url: 'https://www.maggsandallen.co.uk/search-auction/',
      location: 'Online (Live Stream, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── MCHUGH & CO ──
    {
      house: 'McHugh & Co', houseSlug: 'mchughandco', logo: '🏡',
      date: '2026-03-25', title: '25 March 2026', lots: null,
      url: 'https://www.mchughandco.com/pages/auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'McHugh & Co', houseSlug: 'mchughandco', logo: '🏡',
      date: '2026-05-13', title: '13 May 2026', lots: null,
      url: 'https://www.mchughandco.com/pages/auctions',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },
    // ── AUCTION HOUSE UK (National franchise) ──
    {
      house: 'Auction House UK', houseSlug: 'auctionhouse', logo: '🏛️',
      date: '2026-03-10', title: '10 March 2026 (National Online)', lots: null,
      url: 'https://www.auctionhouse.co.uk/online/auction/2026/3/10',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── KNIGHT FRANK ──
    {
      house: 'Knight Frank', houseSlug: 'knightfrank', logo: '👑',
      date: '2026-03-12', title: '12 March 2026', lots: null,
      url: 'https://www.knightfrankauctions.com/forthcoming-auctions/',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── PATTINSON ──
    {
      house: 'Pattinson', houseSlug: 'pattinson', logo: '🔷',
      date: '2026-03-05', title: '5 March 2026 (North East)', lots: null,
      url: 'https://www.pattinson.co.uk/auction/property-search',
      location: 'Newcastle', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },

    // ── BIDX1 ──
    {
      house: 'BidX1', houseSlug: 'bidx1', logo: '💻',
      date: '2026-03-01', title: 'March 2026 (Online)', lots: null,
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
      date: '2026-03-04', title: '4-5 March 2026', lots: null,
      url: 'https://www.edwardmellor.co.uk/auctions/04mar2026',
      location: 'Manchester', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // paulfosh: REMOVED — site down (Squarespace parking page)

    // ── COTTONS ──
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
      url: 'https://www.dedmangray.co.uk/auction/',
      location: 'Essex', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },

    // ── BARNETT ROSS ──
    {
      house: 'Barnett Ross', houseSlug: 'barnettross', logo: '🔑',
      date: '2026-03-19', title: '19 March 2026', lots: null,
      url: 'https://www.barnettross.co.uk/current.php',
      location: 'London', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: false,
    },

    // ── BRADLEY HALL ──
    {
      house: 'Bradley Hall', houseSlug: 'bradleyhall', logo: '🏠',
      date: '2026-03-12', title: '12 March 2026', lots: null,
      url: 'https://auction.bradleyhall.co.uk/search',
      location: 'Newcastle', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── CONNECT UK ──
    {
      house: 'Connect UK', houseSlug: 'connectuk', logo: '🔗',
      date: '2026-03-10', title: '10 March 2026', lots: null,
      url: 'https://realtime.connectukauctions.co.uk/for-sale/',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── AUCTION ESTATES ──
    {
      house: 'Auction Estates', houseSlug: 'auctionestates', logo: '🏢',
      date: '2026-03-12', title: '12 March 2026', lots: null,
      url: 'https://www.auctionestates.co.uk/view-properties',
      location: 'Nottingham', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── LANDWOOD ──
    {
      house: 'Landwood', houseSlug: 'landwood', logo: '🌲',
      date: '2026-03-10', title: '10 March 2026', lots: null,
      url: 'https://www.landwoodpropertyauctions.com/Auction',
      location: 'Manchester', type: 'Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // ── LOVEITTS ──
    {
      house: 'Loveitts', houseSlug: 'loveitts', logo: '❤️',
      date: '2026-03-11', title: '11 March 2026', lots: null,
      url: 'https://www.loveitts.co.uk/auctions',
      location: 'Coventry', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },

    // hunters: REMOVED — auction service discontinued

    // ── NEW HOUSES ──
    // Countrywide / Sutton Kersh
    {
      house: 'Countrywide / Sutton Kersh', houseSlug: 'countrywide', logo: '🌍',
      date: '2026-04-02', title: '2 April 2026 — Liverpool & South West', lots: null,
      url: 'https://www.countrywidepropertyauctions.co.uk/search.php?auction_location=SK&auction_date=current',
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
      date: '2026-03-11', title: '11 March 2026 — National', lots: null,
      url: 'https://www.townandcountrypropertyauctions.co.uk/search',
      location: 'Online (Timed)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Future Property Auctions
    {
      house: 'Future Property Auctions', houseSlug: 'futureauctions', logo: '🔮',
      date: '2026-03-12', title: '12 March 2026 — Timed Online', lots: null,
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
      date: '2026-04-23', title: '23 April 2026', lots: null,
      url: 'https://www.harman-healy.co.uk/search',
      location: 'Online', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Seel & Co
    {
      house: 'Seel & Co', houseSlug: 'seelauctions', logo: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
      date: '2026-03-24', title: '24 March 2026', lots: null,
      url: 'https://online.seelauctions.co.uk/search?view=Grid&showall=true',
      location: 'Cardiff', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    // Robinson & Hall
    {
      house: 'Robinson & Hall', houseSlug: 'robinsonhall', logo: '🏠',
      date: '2026-04-08', title: '8 April 2026', lots: null,
      url: 'https://robinsonandhallauctions.co.uk/auctions/available-lots/',
      location: 'Bedford / Milton Keynes', type: 'Residential & Commercial', status: 'upcoming',
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
      return data.map(row => ({
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
    console.error('Calendar endpoint error:', e.message);
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
  if (!process.env.ADMIN_SECRET || !safeCompare(secret, process.env.ADMIN_SECRET)) {
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

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const aiResp = await client.messages.create({
        model: MODEL_HAIKU,
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `You are analysing an auction house's listing page to find links to upcoming/current auction catalogues.

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
If no catalogues found, return {"catalogues": []}`
        }]
      });

      let catalogues = [];
      try {
        let text = aiResp.content[0].text.trim();
        if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        catalogues = JSON.parse(text).catalogues || [];
      } catch (e) {
        results.push({ house: slug, error: 'AI returned invalid JSON', raw: aiResp.content[0].text.substring(0, 200) });
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

  // ── Free tier scan gating ──
  const userTier = user.tier || 'free';
  const scanCount = user.analyses_count || 0;
  const isFreeLimited = (userTier === 'free' && scanCount >= FREE_SCAN_LIMIT);

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

  // ── Check cache ──
  const normalisedUrl = url.trim().replace(/\/+$/, '').toLowerCase();
  const { data: cached } = await supabase
    .from('cached_analyses')
    .select('*')
    .eq('url', normalisedUrl)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (cached) {
    console.log(`Cache hit for ${normalisedUrl}`);
    // Handle both old cached entries (slug like 'savills') and new ones (display name like 'Savills')
    const cachedSlug = HOUSE_DISPLAY_NAMES[cached.house]
      ? cached.house  // cached.house is already a slug
      : Object.entries(HOUSE_DISPLAY_NAMES).find(([k, v]) => v === cached.house)?.[0] || 'unknown';
    const cachedDisplayName = HOUSE_DISPLAY_NAMES[cachedSlug] || cached.house;
    return res.json({
      house: cachedDisplayName,
      houseSlug: cachedSlug,
      recognised: cachedSlug !== 'unknown',
      totalLots: cached.total_lots,
      titleSplits: cached.title_splits,
      topPicks: cached.top_picks,
      under100k: cached.under_100k || 0,
      avgYield: cached.avg_yield || null,
      devPotential: cached.dev_potential || 0,
      vacantCount: cached.vacant_count || 0,
      lots: isFreeLimited ? stripAIFields(cached.lots) : cached.lots,
      cached: true,
      blurred: isFreeLimited,
      scansUsed: scanCount,
      scanLimit: FREE_SCAN_LIMIT,
    });
  }

  // Rate counter already incremented atomically above (pre-cache check)
  // For cached responses, the count was bumped but that's acceptable (prevents cache-probe abuse)

  // ── Fresh analysis — stream progress via SSE ──
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // Set up SSE stream
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    const house = detectAuctionHouse(url);
    const rewritten = rewriteUrl(url, house);
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
    const client = new Anthropic({ apiKey });
    let rawLots = [];

    sseWrite(res, 'phase', { step: 'scraping' });

    const onExtract = (batch, totalBatches, lotsFound) => {
      sseWrite(res, 'extract', { batch, totalBatches, lotsFound });
    };

    // ── PDF catalogues — send directly to Claude ──
    if (isPdfUrl(url)) {
      log.info('pdf_detected', { url, house });
      rawLots = await extractLotsFromPdf(client, url);
    } else if (rewritten.paginateAs === 'allsop_api') {
      // Allsop API: paginate through JSON endpoint
      pages = await scrapeAllsopApi(rewritten.baseUrl);
      sseWrite(res, 'scrape', { pages: pages.length });
      if (pages.length > 0) {
        sseWrite(res, 'phase', { step: 'extracting' });
        rawLots = await extractLotsWithClaude(client, pages, house, onExtract, scrapeUrl);
        enrichAllsopLots(rawLots, pages);
      }
    } else if (rewritten.preferPuppeteer) {
      // JS-rendered sites: go straight to Puppeteer
      console.log(`Using Puppeteer directly for ${house} (JS-rendered site)...`);
      const browser = await getBrowser();
      const page = await browser.newPage();
      await page.setUserAgent(HEADERS['User-Agent']);
      await page.setViewport({ width: 1280, height: 900 });
      await page.setRequestInterception(true);
      page.on('request', req => {
        const type = req.resourceType();
        if (['image', 'font', 'media'].includes(type)) req.abort();
        else req.continue();
      });

      try {
        // Handle paginated sites (Savills has 28+ pages)
        if (rewritten.paginateAs === 'savills_pages') {
          console.log(`Puppeteer: loading paginated Savills catalogue...`);
          // Load first page to detect total pages
          await page.goto(scrapeUrl, { waitUntil: 'networkidle2', timeout: 45000 });
          await new Promise(r => setTimeout(r, 2000));
          
          // Detect total pages from pagination links
          const totalPages = await page.evaluate(() => {
            const pageLinks = document.querySelectorAll('a[href*="/page-"]');
            let max = 1;
            for (const a of pageLinks) {
              const m = a.textContent.trim().match(/^(\d+)$/);
              if (m) max = Math.max(max, parseInt(m[1]));
            }
            return max;
          });
          console.log(`Savills: detected ${totalPages} pages`);
          sseWrite(res, 'scrape', { pages: totalPages, lots: 0 });

          // Extract from first page
          const firstPageLots = await extractWithDOM(page, house);
          if (firstPageLots && firstPageLots.length > 0) rawLots.push(...firstPageLots);
          sseWrite(res, 'scrape', { pages: totalPages, lots: rawLots.length });
          console.log(`Page 1: ${firstPageLots ? firstPageLots.length : 0} lots`);

          // Load remaining pages
          const maxPages = Math.min(totalPages, 50);
          for (let p = 2; p <= maxPages; p++) {
            const pageUrl = `${scrapeUrl}/page-${p}`;
            try {
              await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
              await new Promise(r => setTimeout(r, 1500));
              const pageLots = await extractWithDOM(page, house);
              if (pageLots && pageLots.length > 0) rawLots.push(...pageLots);
              console.log(`Page ${p}: ${pageLots ? pageLots.length : 0} lots`);
            } catch (e) {
              console.log(`Page ${p} failed: ${e.message}`);
            }
          }
          console.log(`Savills total: ${rawLots.length} lots from ${maxPages} pages via DOM extraction`);

        } else if (rewritten.paginateAs === 'sdl_pages') {
          // ── SDL / BTG Eddisons: paginated with ?page=N ──
          console.log(`Puppeteer: loading paginated SDL catalogue...`);
          await page.goto(scrapeUrl, { waitUntil: 'networkidle2', timeout: 45000 });
          await new Promise(r => setTimeout(r, 3000));
          // Scroll to load lazy content on first page
          await page.evaluate(async () => {
            for (let i = 0; i < 15; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 500)); }
            window.scrollTo(0, 0);
          });
          await new Promise(r => setTimeout(r, 2000));

          // Detect total pages from pagination
          const sdlTotalPages = await page.evaluate(() => {
            const pageLinks = document.querySelectorAll('a[href*="page="], .pagination a, nav a');
            let max = 1;
            for (const a of pageLinks) {
              const href = a.getAttribute('href') || '';
              const pm = href.match(/page=(\d+)/);
              if (pm) max = Math.max(max, parseInt(pm[1]));
              const tm = a.textContent.trim().match(/^(\d+)$/);
              if (tm) max = Math.max(max, parseInt(tm[1]));
            }
            const bodyText = document.body.innerText;
            const ofMatch = bodyText.match(/page\s+\d+\s+of\s+(\d+)/i) || bodyText.match(/(\d+)\s+pages/i);
            if (ofMatch) max = Math.max(max, parseInt(ofMatch[1]));
            return max;
          });
          console.log(`SDL: detected ${sdlTotalPages} pages`);

          // Extract from first page
          const sdlFirstLots = await extractWithDOM(page, house);
          if (sdlFirstLots && sdlFirstLots.length > 0) rawLots.push(...sdlFirstLots);
          console.log(`SDL Page 1: ${sdlFirstLots ? sdlFirstLots.length : 0} lots`);

          // Load remaining pages
          const sdlMaxPages = Math.min(sdlTotalPages, 20);
          for (let p = 2; p <= sdlMaxPages; p++) {
            const sep = scrapeUrl.includes('?') ? '&' : '?';
            const pageUrl = `${scrapeUrl}${sep}page=${p}`;
            try {
              await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
              await new Promise(r => setTimeout(r, 2000));
              await page.evaluate(async () => {
                for (let i = 0; i < 10; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 400)); }
                window.scrollTo(0, 0);
              });
              await new Promise(r => setTimeout(r, 1500));
              const pageLots = await extractWithDOM(page, house);
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

        } else {
          // ── Generic Puppeteer extraction with auto-pagination ──
          console.log(`Puppeteer: loading ${scrapeUrl} for ${house}`);
          await page.goto(scrapeUrl, { waitUntil: 'networkidle2', timeout: 45000 });
          await new Promise(r => setTimeout(r, 3000));

          // Scroll to trigger lazy loading
          await page.evaluate(async () => {
            for (let i = 0; i < 15; i++) {
              window.scrollBy(0, window.innerHeight);
              await new Promise(r => setTimeout(r, 500));
            }
            window.scrollTo(0, 0);
          });
          await new Promise(r => setTimeout(r, 2000));

          // Extract page 1
          const domLots = await extractWithDOM(page, house);
          if (domLots && domLots.length >= 3) {
            rawLots.push(...domLots);
            console.log(`${house} Page 1: ${domLots.length} lots via DOM extraction`);

            // ── Auto-detect pagination and follow it ──
            const detectedPages = await page.evaluate(() => {
              let max = 1;
              // Strategy 1: ?page=N or &page=N links
              document.querySelectorAll('a[href*="page="], a[href*="page-"], a[href*="/page/"]').forEach(a => {
                const href = a.getAttribute('href') || '';
                const m = href.match(/page[=/](\d+)/) || href.match(/page-(\d+)/);
                if (m) max = Math.max(max, parseInt(m[1]));
              });
              // Strategy 2: pagination nav with numbered links
              document.querySelectorAll('.pagination a, nav.pagination a, .paging a, .page-numbers a, [class*="pagination"] a, [class*="pager"] a').forEach(a => {
                const t = a.textContent.trim();
                if (t.match(/^\d+$/)) max = Math.max(max, parseInt(t));
              });
              // Strategy 3: "Page X of Y" text
              const bodyText = document.body.innerText;
              const ofMatch = bodyText.match(/page\s+\d+\s+of\s+(\d+)/i) || bodyText.match(/(\d+)\s+pages/i);
              if (ofMatch) max = Math.max(max, parseInt(ofMatch[1]));
              // Strategy 4: "Showing 1-20 of 345" — calculate pages
              const showMatch = bodyText.match(/showing\s+\d+[\s-]+\d+\s+of\s+(\d+)/i) || bodyText.match(/(\d+)\s+results?\s+found/i) || bodyText.match(/(\d+)\s+(?:lots?|properties)/i);
              if (showMatch) {
                const total = parseInt(showMatch[1]);
                if (total > 50) max = Math.max(max, Math.ceil(total / 20)); // assume ~20 per page
              }
              // Detect the pagination URL pattern
              let pattern = 'query'; // default: ?page=N
              const pageLink = document.querySelector('a[href*="page-"]');
              if (pageLink) pattern = 'path-dash'; // /page-2
              const pageSlash = document.querySelector('a[href*="/page/"]');
              if (pageSlash) pattern = 'path-slash'; // /page/2
              return { max, pattern };
            });

            if (detectedPages.max > 1) {
              const maxPages = Math.min(detectedPages.max, 25);
              console.log(`${house}: detected ${detectedPages.max} pages (pattern: ${detectedPages.pattern}), loading up to ${maxPages}`);

              for (let p = 2; p <= maxPages; p++) {
                let pageUrl;
                if (detectedPages.pattern === 'path-dash') {
                  pageUrl = scrapeUrl.replace(/\/page-\d+/, '') + `/page-${p}`;
                } else if (detectedPages.pattern === 'path-slash') {
                  pageUrl = scrapeUrl.replace(/\/page\/\d+/, '') + `/page/${p}`;
                } else {
                  const sep = scrapeUrl.includes('?') ? '&' : '?';
                  pageUrl = `${scrapeUrl}${sep}page=${p}`;
                }

                try {
                  await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                  await new Promise(r => setTimeout(r, 2000));
                  await page.evaluate(async () => {
                    for (let i = 0; i < 10; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 400)); }
                    window.scrollTo(0, 0);
                  });
                  await new Promise(r => setTimeout(r, 1500));
                  const pageLots = await extractWithDOM(page, house);
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
            console.log(`${house} total: ${rawLots.length} lots via DOM extraction (no Claude needed)`);
          } else {
            // Fall back to Claude extraction from page HTML
            if (domLots && domLots.length > 0) {
              console.log(`DOM extractor found only ${domLots.length} lots for ${house} (below threshold of 3), falling back to Claude`);
            }
            const html = await page.content();
            console.log(`Puppeteer: got ${html.length} chars, sending to Claude...`);
            const puppeteerPages = [{ page: 1, html }];
            sseWrite(res, 'phase', { step: 'extracting' });
            rawLots = await extractLotsWithClaude(client, puppeteerPages, house, onExtract, scrapeUrl);
            console.log(`Claude extracted ${rawLots.length} lots from Puppeteer content`);
          }
        }
      } finally {
        await page.close();
      }
    } else {
      // Standard static HTML scraping
      pages = await scrapeAllPages(scrapeUrl, house);
      sseWrite(res, 'scrape', { pages: pages ? pages.length : 0 });
      if (pages && pages.length > 0) {
        sseWrite(res, 'phase', { step: 'extracting' });
        rawLots = await extractLotsWithClaude(client, pages, house, onExtract, scrapeUrl);
      }
      // Puppeteer fallback if static scraping found nothing
      // Skip for houses where Puppeteer wastes memory (blocked, empty, or JS-only)
      const SKIP_PUPPETEER = ['cottons','dedmangray','philliparnold'];
      if (rawLots.length === 0 && !SKIP_PUPPETEER.includes(house)) {
        console.log(`No lots from static HTML, trying Puppeteer for ${house}...`);
        const puppeteerPages = await scrapeWithPuppeteer(url, house);
        if (puppeteerPages.length > 0) {
          console.log(`Puppeteer got ${puppeteerPages.length} page(s), sending to Claude...`);
          sseWrite(res, 'phase', { step: 'extracting' });
          rawLots = await extractLotsWithClaude(client, puppeteerPages, house, onExtract, scrapeUrl);
          console.log(`Claude extracted ${rawLots.length} lots from Puppeteer content`);
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

    // ── Enrich with Land Registry + rental yields ──
    console.log('Starting Land Registry + rental yield enrichment...');
    sseWrite(res, 'phase', { step: 'enriching', lots: analysed.length });
    await enrichLots(analysed, house, url, (done, total) => {
      sseWrite(res, 'enrich', { postcodes: done, total });
    });

    // ── Cache results ──
    const displayName = getHouseDisplayName(house, url);
    const expiresAt = new Date(Date.now() + getCacheTTL(house)).toISOString();
    const lotsWithPrice = analysed.filter(l => l.price && l.price > 0);
    const yieldsArr = analysed.map(l => l.estGrossYield).filter(y => y && y > 0);

    // Log unknown house successes for future house addition
    if (house === 'unknown' && analysed.length >= 3) {
      log.info('NEW_HOUSE_CANDIDATE', { hostname: new URL(url).hostname, lots: analysed.length, url });
    }

    // Check if catalogue data actually changed before invalidating preset cache
    const { data: prevCached } = await supabase
      .from('cached_analyses')
      .select('total_lots, top_picks, title_splits')
      .eq('url', normalisedUrl)
      .single();

    const catalogueChanged = !prevCached
      || prevCached.total_lots !== analysed.length
      || prevCached.top_picks !== analysed.filter(l => l.score >= 3).length
      || prevCached.title_splits !== analysed.filter(l => l.titleSplit).length;

    await supabase.from('cached_analyses').upsert({
      url: normalisedUrl,
      house: displayName,
      total_lots: analysed.length,
      title_splits: analysed.filter(l => l.titleSplit).length,
      top_picks: analysed.filter(l => l.score >= 3).length,
      under_100k: lotsWithPrice.filter(l => l.price < 100000).length,
      avg_yield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
      dev_potential: analysed.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
      vacant_count: analysed.filter(l => l.vacant === true).length,
      lots: analysed,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      last_scraped_at: new Date().toISOString(),
    }, { onConflict: 'url' });

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
    logActivityEvent('analysis', { house: displayName, url: normalisedUrl, lots_found: analysed.length }, user?.email, getClientIP(req));

    const updatedScanCount = (user.analyses_count || 0) + 1;
    const nowFreeLimited = (userTier === 'free' && updatedScanCount >= FREE_SCAN_LIMIT);

    sseWrite(res, 'done', {
      house: displayName,
      houseSlug: house,
      recognised: house !== 'unknown',
      totalLots: analysed.length,
      titleSplits: analysed.filter(l => l.titleSplit).length,
      topPicks: analysed.filter(l => l.score >= 3).length,
      under100k: lotsWithPrice.filter(l => l.price < 100000).length,
      avgYield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
      devPotential: analysed.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
      vacantCount: analysed.filter(l => l.vacant === true).length,
      lots: isFreeLimited ? stripAIFields(analysed) : analysed,
      cached: false,
      blurred: isFreeLimited,
      scansUsed: updatedScanCount,
      scanLimit: FREE_SCAN_LIMIT,
    });
    return res.end();
  } catch (err) {
    console.error(err);
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

function isPresetQuery(query) {
  return PRESET_QUERIES[query] || null;
}

// ═══════════════════════════════════════════════════════════════
// SMART SEARCH: Claude-powered filtering across cached analyses
// ═══════════════════════════════════════════════════════════════
app.post('/api/smart-search', async (req, res) => {
  const { query, soldFilter } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Missing search query' });

  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'signup_required' });

  // Rate limit: 30 smart searches per IP per day
  const SEARCH_RATE_LIMIT = 30;
  const searchIp = req.ip || 'unknown';
  const searchToday = new Date().toISOString().slice(0, 10);
  const searchKey = `search:${searchIp}`;
  try {
    const { data: sr } = await supabase.from('rate_limits').select('requests').eq('ip', searchKey).eq('date', searchToday).single();
    if (sr && sr.requests >= SEARCH_RATE_LIMIT) {
      return res.status(429).json({ error: 'rate_limited', message: `Daily search limit reached (${SEARCH_RATE_LIMIT}). Try again tomorrow.` });
    }
    if (sr) { await supabase.from('rate_limits').update({ requests: sr.requests + 1 }).eq('ip', searchKey).eq('date', searchToday); }
    else { await supabase.from('rate_limits').insert({ ip: searchKey, date: searchToday, requests: 1 }); }
  } catch { /* rate limit check failed — allow through */ }

  const presetSlug = isPresetQuery(query);
  const sf = soldFilter || 'all';

  // Gate custom (non-preset) queries behind premium tier
  if (!presetSlug && (user.tier || 'free') === 'free') {
    return res.status(403).json({
      error: 'premium_required',
      message: 'Custom AI search is a premium feature',
      features: [
        'Natural language AI search across all catalogues',
        'Email alerts for new lots matching saved criteria',
        'Unlimited daily catalogue analyses',
        'CSV/JSON export of results',
        'Portfolio tracking (watching / bid / won)',
        'BridgeMatch finance integration per lot',
        'Historical auction data & price trends',
        'Custom scoring weights',
      ],
    });
  }

  // Check smart search cache for preset queries
  if (presetSlug) {
    const cacheKey = `${presetSlug}:${sf}`;
    const { data: presetCache } = await supabase
      .from('smart_search_cache')
      .select('*')
      .eq('query_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (presetCache && (!presetCache.stale_urls || presetCache.stale_urls.length === 0)) {
      // Fully fresh cache — return instantly
      return res.json({
        results: presetCache.results || [],
        report: presetCache.report || '',
        sources: presetCache.sources || [],
        totalSearched: presetCache.total_searched || 0,
        cached: true,
      });
    }

    if (presetCache && presetCache.stale_urls && presetCache.stale_urls.length > 0) {
      // Partially stale — only re-search the changed catalogues and merge
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

      try {
        // Fetch only the changed catalogues
        const { data: staleCatalogues } = await supabase
          .from('cached_analyses')
          .select('house, url, lots, total_lots')
          .in('url', presetCache.stale_urls)
          .gt('expires_at', new Date().toISOString());

        if (!staleCatalogues || staleCatalogues.length === 0) {
          // Stale catalogues expired or gone — strip old results from those sources and return
          const cleanResults = (presetCache.results || []).filter(l =>
            !presetCache.stale_urls.includes((l._sourceUrl || '').trim().replace(/\/+$/, '').toLowerCase())
          );
          const cleanSources = (presetCache.sources || []).filter(s =>
            !presetCache.stale_urls.includes((s.url || '').trim().replace(/\/+$/, '').toLowerCase())
          );
          await supabase.from('smart_search_cache').update({
            results: cleanResults, sources: cleanSources,
            total_searched: cleanResults.length, stale_urls: [],
          }).eq('query_key', cacheKey);
          return res.json({ results: cleanResults, report: presetCache.report || '', sources: cleanSources, totalSearched: cleanResults.length, cached: true });
        }

        // Gather lots from only the changed catalogues
        const deltaLots = [];
        const deltaSources = [];
        for (const c of staleCatalogues) {
          if (c.lots && Array.isArray(c.lots)) {
            deltaSources.push({ house: c.house, url: c.url, count: c.lots.length });
            for (const lot of c.lots) {
              deltaLots.push({ ...lot, _house: c.house, _sourceUrl: c.url });
            }
          }
        }

        // Apply sold filter to delta lots
        const soldRe = /\bSOLD\b|\bSTC\b|\bSALE.?AGREED\b|\bWITHDRAWN\b/i;
        const filteredDelta = sf === 'available'
          ? deltaLots.filter(l => !(l.bullets || []).some(b => soldRe.test(b)))
          : sf === 'sold'
          ? deltaLots.filter(l => (l.bullets || []).some(b => soldRe.test(b)))
          : deltaLots;

        if (filteredDelta.length === 0) {
          // Changed catalogues have no matching lots after filtering — just remove old results from those sources
          const cleanResults = (presetCache.results || []).filter(l =>
            !presetCache.stale_urls.includes((l._sourceUrl || '').trim().replace(/\/+$/, '').toLowerCase())
          );
          const cleanSources = (presetCache.sources || []).filter(s =>
            !presetCache.stale_urls.includes((s.url || '').trim().replace(/\/+$/, '').toLowerCase())
          );
          for (const ds of deltaSources) cleanSources.push(ds);
          await supabase.from('smart_search_cache').update({
            results: cleanResults, sources: cleanSources,
            source_urls: cleanSources.map(s => s.url),
            total_searched: (presetCache.total_searched || 0) - deltaLots.length + filteredDelta.length,
            stale_urls: [],
          }).eq('query_key', cacheKey);
          return res.json({ results: cleanResults, report: presetCache.report || '', sources: cleanSources, totalSearched: cleanResults.length, cached: true });
        }

        // Run Claude only on the delta lots
        const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        const lotEntries = filteredDelta.map((l, i) => {
          const summary = `[${i}] ${l._house} L${l.lot}: ${l.address} | £${l.price || '?'} | Score:${l.score || 0} | ${l.titleSplit ? 'TITLE_SPLIT' : ''} | ${(l.bullets || []).join('; ').substring(0, 150)}`;
          const searchText = summary.toLowerCase();
          const relevance = queryTerms.filter(t => searchText.includes(t)).length;
          return { summary, relevance };
        });
        lotEntries.sort((a, b) => b.relevance - a.relevance);

        const CONTEXT_LIMIT = 120000;
        let lotSummaries = '';
        let included = 0;
        for (const entry of lotEntries) {
          if (lotSummaries.length + entry.summary.length + 1 > CONTEXT_LIMIT) break;
          lotSummaries += entry.summary + '\n';
          included++;
        }

        const client = new Anthropic({ apiKey });
        const msg = await client.messages.create({
          model: MODEL_HAIKU,
          max_tokens: 4000,
          messages: [{ role: 'user', content: `You are a UK property investment analyst. A user has searched across ${filteredDelta.length} NEW auction lots from ${deltaSources.length} recently updated catalogues.

Their search query: "${query}"

Here are ${included} lots from the updated catalogues, sorted by relevance:

${lotSummaries}

TASK:
1. Identify the lots that best match the user's query. Return the indices of matching lots.
2. Write a one-line summary of what changed (e.g. "3 new heavy refurb properties found in Savills catalogue").

Respond in this exact JSON format:
{"indices":[0,5,12],"summary":"Brief change summary"}

Only return lots that genuinely match the query.` }]
        });
        const ssUsage = msg.usage || {};
        log.info('smart_search_incremental', { model: MODEL_HAIKU, input_tokens: ssUsage.input_tokens, output_tokens: ssUsage.output_tokens });

        const responseText = msg.content[0]?.text || '';
        let parsed;
        try {
          let cleaned = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(cleaned);
        } catch (e) {
          const indicesMatch = responseText.match(/"indices"\s*:\s*\[([\d,\s]*)\]/);
          parsed = { indices: indicesMatch ? indicesMatch[1].split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)) : [], summary: '' };
        }

        const newMatches = (parsed.indices || [])
          .filter(i => i >= 0 && i < filteredDelta.length)
          .map(i => filteredDelta[i]);

        // Merge: keep old results from unchanged catalogues + new results from changed ones
        const staleUrlSet = new Set(presetCache.stale_urls);
        const keptResults = (presetCache.results || []).filter(l =>
          !staleUrlSet.has((l._sourceUrl || '').trim().replace(/\/+$/, '').toLowerCase())
        );
        const mergedResults = [...keptResults, ...newMatches];

        // Merge sources
        const keptSources = (presetCache.sources || []).filter(s =>
          !staleUrlSet.has((s.url || '').trim().replace(/\/+$/, '').toLowerCase())
        );
        const mergedSources = [...keptSources, ...deltaSources];

        const mergedReport = parsed.summary
          ? `${presetCache.report || ''}\n\nUpdate: ${parsed.summary}`
          : presetCache.report || '';

        // Update cache with merged results
        await supabase.from('smart_search_cache').update({
          results: mergedResults,
          report: mergedReport,
          sources: mergedSources,
          source_urls: mergedSources.map(s => s.url),
          total_searched: (presetCache.total_searched || 0) + filteredDelta.length,
          stale_urls: [],
          cached_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }).eq('query_key', cacheKey);

        console.log(`Incremental preset refresh: ${presetSlug} — ${newMatches.length} new matches from ${deltaSources.map(s => s.house).join(', ')}`);

        return res.json({
          results: mergedResults,
          report: mergedReport,
          sources: mergedSources,
          totalSearched: (presetCache.total_searched || 0) + filteredDelta.length,
          cached: true,
        });
      } catch (err) {
        console.error('Incremental preset refresh failed, falling through to full search:', err.message);
        // Fall through to full search below
      }
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    // Get all cached analyses
    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('house, url, lots, total_lots')
      .gt('expires_at', new Date().toISOString());

    if (!cached || cached.length === 0) {
      return res.json({ results: [], report: 'No cached auction data available. Please analyse some auction catalogues first.', sources: [] });
    }

    // Gather all lots from all cached analyses
    const allLots = [];
    const sources = [];
    for (const c of cached) {
      if (c.lots && Array.isArray(c.lots)) {
        sources.push({ house: c.house, url: c.url, count: c.lots.length });
        for (const lot of c.lots) {
          allLots.push({ ...lot, _house: c.house, _sourceUrl: c.url });
        }
      }
    }

    if (allLots.length === 0) {
      return res.json({ results: [], report: 'No lot data in cache. Please analyse auction catalogues first.', sources: [] });
    }

    // Apply sold filter before sending to Claude
    const soldRe = /\bSOLD\b|\bSTC\b|\bSALE.?AGREED\b|\bWITHDRAWN\b/i;
    const filteredLots = soldFilter === 'available'
      ? allLots.filter(l => !(l.bullets || []).some(b => soldRe.test(b)))
      : soldFilter === 'sold'
      ? allLots.filter(l => (l.bullets || []).some(b => soldRe.test(b)))
      : allLots;

    // Build a compact lot summary for Claude, prioritising query-relevant lots
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const lotEntries = filteredLots.map((l, i) => {
      const summary = `[${i}] ${l._house} L${l.lot}: ${l.address} | £${l.price || '?'} | Score:${l.score || 0} | ${l.titleSplit ? 'TITLE_SPLIT' : ''} | ${(l.bullets || []).join('; ').substring(0, 150)}`;
      const searchText = summary.toLowerCase();
      const relevance = queryTerms.filter(t => searchText.includes(t)).length;
      return { summary, relevance };
    });

    // Sort: query-relevant lots first, then by original order
    lotEntries.sort((a, b) => b.relevance - a.relevance);

    // Build context string with 120K char budget (fits within Claude's context)
    const CONTEXT_LIMIT = 120000;
    let lotSummaries = '';
    let included = 0;
    for (const entry of lotEntries) {
      if (lotSummaries.length + entry.summary.length + 1 > CONTEXT_LIMIT) break;
      lotSummaries += entry.summary + '\n';
      included++;
    }
    const omitted = filteredLots.length - included;

    const soldInstruction = soldFilter === 'available' ? '\nIMPORTANT: The user has filtered to show only available (unsold) lots. All sold/STC/withdrawn lots have already been excluded.' :
      soldFilter === 'sold' ? '\nIMPORTANT: The user is specifically looking at sold/STC/withdrawn lots only.' : '';

    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 4000,
      messages: [{ role: 'user', content: `You are a UK property investment analyst. A user has searched across ${filteredLots.length} auction lots from ${sources.length} auction house catalogues.${soldInstruction}

Their search query: "${query}"

Here are ${included} lots${omitted > 0 ? ` (${omitted} lower-relevance lots omitted for brevity)` : ''}, sorted by relevance to the query (index, house, lot number, address, price, score, title split status, key features):

${lotSummaries}

TASK:
1. Identify the lots that best match the user's query. Return the indices of matching lots.
2. Write a brief investment report (2-3 paragraphs) summarising what you found.

Respond in this exact JSON format:
{"indices":[0,5,12],"report":"Your report here..."}

Only return lots that genuinely match the query. If nothing matches well, say so in the report and return an empty indices array.` }]
    });
    const ssFullUsage = msg.usage || {};
    log.info('smart_search_full', { model: MODEL_HAIKU, input_tokens: ssFullUsage.input_tokens, output_tokens: ssFullUsage.output_tokens });

    const responseText = msg.content[0]?.text || '';
    let parsed;
    try {
      // Strip markdown code fences if present
      let cleaned = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      // Extract JSON object from response
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(cleaned);
      }
    } catch (e) {
      console.log('Smart search JSON parse failed:', e.message, 'Raw:', responseText.substring(0, 200));
      // Try to extract report text even if JSON parsing fails
      const reportMatch = responseText.match(/"report"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
      const indicesMatch = responseText.match(/"indices"\s*:\s*\[([\d,\s]*)\]/);
      parsed = {
        indices: indicesMatch ? indicesMatch[1].split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)) : [],
        report: reportMatch ? reportMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : responseText.replace(/\{[\s\S]*\}/, '').trim() || 'Search completed but could not parse results.'
      };
    }

    const matchingLots = (parsed.indices || [])
      .filter(i => i >= 0 && i < filteredLots.length)
      .map(i => filteredLots[i]);

    const response = {
      results: matchingLots,
      report: parsed.report || '',
      sources,
      totalSearched: filteredLots.length,
    };

    // Log smart search activity
    logActivityEvent('smart_search', { query, results_count: matchingLots.length }, user?.email, getClientIP(req));

    // Cache preset query results (1-hour TTL)
    if (presetSlug) {
      const cacheKey = `${presetSlug}:${sf}`;
      await supabase.from('smart_search_cache').upsert({
        query_key: cacheKey,
        results: matchingLots,
        report: parsed.report || '',
        sources,
        source_urls: sources.map(s => s.url),
        total_searched: filteredLots.length,
        sold_filter: sf,
        cached_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'query_key' });
    }

    return res.json(response);
  } catch (err) {
    log.error('Smart search error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN: Cache Status & Manual Refresh
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// API: ALL LOTS — pre-load every cached lot for frontend filtering
// ═══════════════════════════════════════════════════════════════
app.get('/api/all-lots', async (req, res) => {
  try {
    if (!supabase) return res.json({ lots: [], sources: [] });

    // Optional auth — anonymous users see full data (entice signup)
    const user = await validateUserFromReq(req);
    const shouldBlur = user && (user.tier || 'free') === 'free' && (user.analyses_count || 0) >= FREE_SCAN_LIMIT;

    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('house, url, lots')
      .gt('expires_at', new Date().toISOString());

    if (!cached || cached.length === 0) return res.json({ lots: [], sources: [] });

    const lots = [];
    const sources = [];
    for (const c of cached) {
      if (!c.lots || !Array.isArray(c.lots)) continue;
      const houseLots = c.lots.map(l => ({ ...l, _house: c.house, _sourceUrl: c.url }));

      // Phase 1: Within-house dedup by URL (keep lot with richer data)
      const byUrl = new Map();
      for (const lot of houseLots) {
        const url = (lot.url || '').trim().replace(/\/+$/, '').toLowerCase();
        if (url.length > 5) {
          const existing = byUrl.get(url);
          if (existing) {
            // Keep the one with more data: imageUrl > more bullets
            const richness = (l) => (l.imageUrl ? 10 : 0) + (l.bullets?.length || 0) + (l.price ? 1 : 0);
            if (richness(lot) > richness(existing)) byUrl.set(url, lot);
          } else {
            byUrl.set(url, lot);
          }
        } else {
          byUrl.set(`__no_url_${byUrl.size}`, lot);
        }
      }

      // Phase 2: Within-house dedup by normalised address + price
      const byAddr = new Map();
      for (const lot of byUrl.values()) {
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

      const dedupedLots = [...byAddr.values()];
      const removed = houseLots.length - dedupedLots.length;
      if (removed > 0) console.log(`Dedup ${c.house}: ${houseLots.length} → ${dedupedLots.length} (removed ${removed})`);
      lots.push(...dedupedLots);
      sources.push({ house: c.house, url: c.url, count: dedupedLots.length });
    }

    res.json({ lots: shouldBlur ? stripAIFields(lots) : lots, sources, blurred: !!shouldBlur });
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
      .select('house, url, total_lots, title_splits, top_picks, under_100k, avg_yield, dev_potential, vacant_count, created_at, expires_at')
      .gt('expires_at', new Date().toISOString())
      .order('house');

    const allAuctions = await getCalendarAuctions();
    const ready = allAuctions.filter(a => a.catalogueReady);
    const cachedUrls = new Set((cached || []).map(c => c.url));
    
    const totalLots = (cached || []).reduce((s, c) => s + (c.total_lots || 0), 0);
    const missing = ready.filter(a => !cachedUrls.has(a.url.trim().replace(/\/+$/, '').toLowerCase()));

    res.json({
      summary: {
        totalCached: (cached || []).length,
        totalReady: ready.length,
        totalLots,
        missingCount: missing.length,
      },
      cached: cached || [],
      missing: missing.map(a => ({ house: a.house, url: a.url })),
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
    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('url, house, lots')
      .gt('expires_at', new Date().toISOString());

    if (!cached || cached.length === 0) return res.json({ message: 'No cached catalogues found', results: [] });

    const results = [];
    for (const entry of cached) {
      const lots = entry.lots || [];
      const missing = lots.filter(l => l.url && !l.imageUrl).length;
      if (missing === 0) {
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing: 0, gained: 0, status: 'skipped — all have images' });
        continue;
      }

      const updated = await backfillImages(entry.url, lots);
      if (updated) {
        const gained = updated.filter(l => l.imageUrl).length - (lots.length - missing);
        await supabase.from('cached_analyses').update({ lots: updated }).eq('url', entry.url);
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing, gained, status: 'updated' });
      } else {
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing, gained: 0, status: 'no matches found' });
      }
    }

    const totalGained = results.reduce((s, r) => s + r.gained, 0);
    res.json({ message: `Backfill complete. ${totalGained} images added across ${cached.length} catalogues.`, results });
  } catch (err) {
    log.error('Image backfill error', { error: err.message });
    res.status(500).json({ error: 'Backfill failed: ' + err.message });
  }
});

// User-facing: analyse all catalogue-ready auctions
app.post('/api/analyse-all', async (req, res) => {
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'signup_required' });

  // Trigger auto-analysis and wait for it to complete
  try {
    const result = await autoAnalyseAll();
    res.json(result);
  } catch (e) {
    log.error('Refresh cache error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// CATCH-ALL
// ═══════════════════════════════════════════════════════════════
app.get('/welcome', (req, res) => {
  res.sendFile(join(__dirname, 'welcome.html'));
});

// ═══════════════════════════════════════════════════════════════
// BRIDGEMATCH LITE
// ═══════════════════════════════════════════════════════════════
app.get('/check', (req, res) => {
  res.sendFile(join(__dirname, 'bridgematch-lite.html'));
});

app.get('/api/admin/daily-stats', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.query.token || '';
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

app.get('/api/cost-monitor', async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.query.token || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const { data: cached } = await supabase.from('cached_analyses').select('house, expires_at');
    const now = new Date();
    const houses = cached || [];
    const freshCount = houses.filter(h => h.expires_at && new Date(h.expires_at) > now).length;
    const SKIP_PUPPETEER_LIST = ['cottons','dedmangray','philliparnold'];
    res.json({
      weeklyEstimate: {
        claudeApiCalls: apiCallCount,
        estimatedCost: +(apiCallCount * 0.00025).toFixed(4),
        creditExhausted,
        lastResetAt: serverStartTime
      },
      cacheStats: {
        totalHouses: houses.length,
        housesWithFreshCache: freshCount,
        housesWithStaleCache: houses.length - freshCount,
        contentHashHits: hashHitCount
      },
      puppeteerSkipList: SKIP_PUPPETEER_LIST,
      lookaheadLimit: MAX_AUCTIONS_PER_HOUSE,
      pageCapLimit: MAX_PUPPETEER_PAGES,
      lotsCapLimit: MAX_LOTS_PER_SCRAPE
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  try {
    let html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
    // Inject Supabase config — JSON.stringify escapes any special chars to prevent XSS
    html = html.replace("window.__SUPABASE_URL__ || ''", JSON.stringify(SUPABASE_URL || ''));
    html = html.replace("window.__SUPABASE_ANON_KEY__ || ''", JSON.stringify(SUPABASE_ANON_KEY || ''));
    html = html.replace("window.__AUTH_ENABLED__ || false", AUTH_ENABLED ? 'true' : 'false');
    res.type('html').send(html);
  } catch (e) {
    res.sendFile(join(__dirname, 'index.html'));
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
  if (u.includes('pugh-auctions')) return 'sdl'; // Pugh merged into BTG Eddisons/SDL
  if (u.includes('sdlauctions')) return 'sdl';
  if (u.includes('networkauctions')) return 'network';
  if (u.includes('bondwolfe')) return 'bondwolfe';
  if (u.includes('barnardmarcusauctions') || u.includes('barnardmarcus')) return 'barnardmarcus';
  if (u.includes('auctionhouselondon')) return 'auctionhouselondon';
  if (u.includes('auctionhouse.co.uk')) return 'auctionhouse';
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
  if (u.includes('paulfosh')) return 'paulfosh';
  if (u.includes('cottons.co.uk')) return 'cottons';
  if (u.includes('dedmangray')) return 'dedmangray';
  if (u.includes('barnettross')) return 'barnettross';
  if (u.includes('bradleyhall')) return 'bradleyhall';
  if (u.includes('connectukauctions') || u.includes('connectukgroup')) return 'connectuk';
  if (u.includes('auctionestates')) return 'auctionestates';
  if (u.includes('landwoodpropertyauctions') || u.includes('landwoodgroup')) return 'landwood';
  if (u.includes('loveitts')) return 'loveitts';
  if (u.includes('hunters.com')) return 'hunters';
  if (u.includes('probate.auction') || u.includes('timedauctions.probate.auction')) return 'probateauction';
  // buttersjohnbee — PDF-only catalogues, not supported for DOM extraction
  if (u.includes('auctionhouselondon')) return 'auctionhouselondon';
  if (u.includes('auctionhouse.co.uk')) return 'auctionhouse';
  if (u.includes('pughauctions') || u.includes('pugh')) return 'sdl';
  // ── New houses ──
  if (u.includes('countrywidepropertyauctions') || u.includes('suttonkersh')) return 'countrywide';
  if (u.includes('venmoreauctions')) return 'venmore';
  if (u.includes('townandcountrypropertyauctions') || u.includes('tcpa')) return 'tcpa';
  if (u.includes('futurepropertyauctions')) return 'futureauctions';
  if (u.includes('kivells.com')) return 'kivells';
  if (u.includes('firstforauctions') || u.includes('online.firstforauctions')) return 'firstforauctions';
  if (u.includes('harman-healy') || u.includes('harmanhealy')) return 'harmanhealy';
  if (u.includes('seelauctions') || u.includes('seelandco')) return 'seelauctions';
  if (u.includes('robinsonandhallauctions') || u.includes('robinsonandhall')) return 'robinsonhall';
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
  countrywide: 'Countrywide / Sutton Kersh', venmore: 'Venmore Auctions',
  tcpa: 'Town & Country Property Auctions', futureauctions: 'Future Property Auctions',
  kivells: 'Kivells', firstforauctions: 'First For Auctions',
  suttonkersh: 'Sutton Kersh', harmanhealy: 'Harman Healy',
  seelauctions: 'Seel & Co', robinsonhall: 'Robinson & Hall',
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
function rewriteUrl(url, house) {
  const u = url.toLowerCase();

  if (house === 'savills') {
    // Savills: auctions.savills.co.uk/auctions/{slug} — server-rendered, paginated
    // Rewrite to specific auction page. DOM extractor handles extraction.
    // If user pastes auctions.savills.co.uk or upcoming-auctions, keep as-is for now
    if (u.includes('auctions.savills.co.uk/auctions/')) {
      return { baseUrl: url, isApi: false, paginateAs: 'savills_pages', preferPuppeteer: true };
    }
    // Generic savills URL — try the latest auction
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
  }

  if (house === 'allsop') {
    // Allsop: rewrite catalogue pages to their JSON API
    if (u.includes('residential-auction') || u.includes('lot_type=residential')) {
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
    if (u.includes('btgeddisonspropertyauctions.com/properties')) {
      return { baseUrl: url, isApi: false, paginateAs: 'sdl_pages', preferPuppeteer: true };
    }
    if (u.includes('/auction/')) {
      return { baseUrl: url, isApi: false, paginateAs: 'sdl_pages', preferPuppeteer: true };
    }
    if (u.includes('/search')) {
      return { baseUrl: url, isApi: false, paginateAs: 'sdl_pages', preferPuppeteer: true };
    }
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
    const baseUrl = u.includes('search-auction') ? url : (HOUSE_ROOTS.hollismorgan + '?showstc=on&orderby=lot_no+asc');
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

  // buttersjohnbee removed — PDF-only catalogues

  // ── New houses ──
  // Countrywide/Sutton Kersh: static HTML, pagination via ?page=N
  if (house === 'countrywide') {
    return { baseUrl: url, isApi: false, paginateAs: null };
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
  // Robinson & Hall: WordPress/Elementor, needs Puppeteer
  if (house === 'robinsonhall') {
    return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: true };
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
    case 'network': return `${clean}?page=${page}`;
    case 'bondwolfe': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'barnardmarcus': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
    case 'acuitus': return clean.includes('?') ? `${clean}&page=${page}` : `${clean}?page=${page}`;
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
  // Wait for a slot if at max concurrency
  while (activePagesCount >= MAX_CONCURRENT_PAGES) {
    await new Promise(r => setTimeout(r, 500));
  }
  activePagesCount++;
  const browser = await getBrowser();
  const page = await browser.newPage();
  const origClose = page.close.bind(page);
  page.close = async () => { activePagesCount = Math.max(0, activePagesCount - 1); return origClose(); };
  return page;
}

async function getBrowser() {
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
// CLAUDE EXTRACTION
// ═══════════════════════════════════════════════════════════════
async function extractLotsWithClaude(client, pages, house, onProgress, catalogueUrl) {
  const allLots = [];
  const seenLots = new Set();
  const batchSize = 3;
  for (let i = 0; i < pages.length; i += batchSize) {
    if (creditExhausted) { console.log('Skipping remaining batches — API credits exhausted'); break; }
    if (allLots.length >= MAX_LOTS_PER_SCRAPE) { console.log(`${house} lots cap reached at ${MAX_LOTS_PER_SCRAPE}`); break; }
    const batch = pages.slice(i, i + batchSize);
    const strippedBatch = batch.map(p => ({ page: p.page, content: stripHtml(p.html) }));
    const totalStrippedLen = strippedBatch.reduce((sum, p) => sum + p.content.length, 0);
    const model = getExtractionModel(house);
    const hint = HOUSE_EXTRACTION_HINTS[house];
    console.log(`Batch ${Math.floor(i/batchSize)+1}: ${strippedBatch.length} page(s), ${totalStrippedLen} chars after stripping, model: ${model}`);
    const prompt = `You are extracting property auction lot data from a UK auction house catalogue (${house}).
${hint ? `\nStructure hint: ${hint}\n` : ''}
Below are ${strippedBatch.length} page(s) of catalogue content. Extract EVERY auction lot you find.

For each lot, return a JSON object with these fields:
- lot: number (the lot number)
- address: string (full address including postcode)
- price: number or null (guide price in pounds, null if TBA/not stated)
- url: string (detail page URL if found, empty string if not)
- bullets: array of strings (key features/description points - tenure, bedrooms, condition, sq ft, special circumstances etc)

Return ONLY a JSON array of lot objects, no other text. If a page has no lots, return an empty array.

Important:
- Extract the COMPLETE address including postcode
- Guide prices may be shown as "Guide Price £X" or "Guide £X" or just "£X"
- Bullet points include things like: property type, bedrooms, tenure (freehold/leasehold), condition, sq ft, vacant/tenanted, executor sale, development potential, completion terms
- Include ALL lots, even commercial ones or land

${strippedBatch.map(p => `=== PAGE ${p.page} ===\n${p.content}`).join('\n\n')}

Return ONLY the JSON array:`;
    try {
      apiCallCount++;
      const response = await client.messages.create({
        model,
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
      });
      const usage = response.usage || {};
      log.info('claude_extraction', { house, model, batch: Math.floor(i/batchSize)+1, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens });
      const text = response.content.map(c => c.text || '').join('');
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
          });
        }
      }
      if (onProgress) onProgress(Math.floor(i/batchSize)+1, Math.ceil(pages.length/batchSize), allLots.length);
    } catch (err) {
      console.error(`Claude extraction failed for batch starting at page ${batch[0].page}:`, err.message);
      if (err.status === 400 && /credit.*(balance|low)|insufficient.*credit/i.test(err.message)) {
        creditExhausted = true;
        console.error('API credits exhausted — stopping all extraction');
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

async function extractLotsFromPdf(client, url) {
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

  // Claude supports PDFs up to 32MB
  if (pdfBuffer.length > 32 * 1024 * 1024) {
    throw new Error('PDF is too large (over 32MB). Try a smaller catalogue.');
  }

  const allLots = [];
  const seenLots = new Set();

  // Send full PDF to Claude — it can read the document natively
  const prompt = `You are extracting property auction lot data from a UK auction house catalogue PDF.

Extract EVERY auction lot you find in this PDF document.

For each lot, return a JSON object with these fields:
- lot: number (the lot number)
- address: string (full address including postcode)
- price: number or null (guide price in pounds, null if TBA/not stated)
- url: string (empty string — PDFs don't have lot URLs)
- bullets: array of strings (key features/description points - tenure, bedrooms, condition, sq ft, special circumstances etc)

Return ONLY a JSON array of lot objects, no other text.

Important:
- Extract the COMPLETE address including postcode
- Guide prices may be shown as "Guide Price £X" or "Guide £X" or just "£X"
- Bullet points include things like: property type, bedrooms, tenure (freehold/leasehold), condition, sq ft, vacant/tenanted, executor sale, development potential, completion terms
- Include ALL lots, even commercial ones or land
- Do NOT include terms & conditions, legal text, or non-lot pages

Return ONLY the JSON array:`;

  try {
    // Use streaming to avoid SDK timeout on large PDF uploads
    // PDFs stay on Sonnet — complex layout extraction needs the stronger model
    const stream = client.messages.stream({
      model: MODEL_SONNET,
      max_tokens: 32000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: prompt },
        ],
      }],
    });
    const response = await stream.finalMessage();
    const pdfUsage = response.usage || {};
    log.info('claude_pdf_extraction', { model: MODEL_SONNET, input_tokens: pdfUsage.input_tokens, output_tokens: pdfUsage.output_tokens });
    const text = response.content.map(c => c.text || '').join('');
    if (response.stop_reason === 'max_tokens') {
      log.warn('pdf_truncated', { url, textLength: text.length });
    }
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
          });
        }
      }
    }
    log.info('pdf_extracted', { lots: allLots.length, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens });
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
// DOM EXTRACTORS - Per-house JS that runs inside Puppeteer
// Returns structured lot data directly, no Claude needed for extraction
// ═══════════════════════════════════════════════════════════════

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
        if (lotNum === null || lotNum === 0 || seen.has(lotNum)) continue;
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
        // Image: first real image from the lot-image-list carousel
        let imageUrl = '';
        const carouselImgs = li.querySelectorAll('.lot-image-list img[src], .lot-image img[src]');
        for (const img of carouselImgs) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) {
            imageUrl = s;
            break;
          }
        }
        // Fallback: any img inside the lot card
        if (!imageUrl) {
          const anyImg = li.querySelector('img[src]');
          if (anyImg) {
            const s = anyImg.getAttribute('src') || anyImg.dataset.src || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
          }
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
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
        // Image: look for <img> in card, or background-image on .auction-property-image
        let imageUrl = '';
        const cardImg = card.querySelector('img.main-image, img.img-responsive, .auction-property-image, .property-grid-image img');
        if (cardImg) {
          if (cardImg.tagName === 'IMG') {
            imageUrl = cardImg.getAttribute('src') || cardImg.dataset.src || '';
          } else {
            const bg = cardImg.style.backgroundImage || getComputedStyle(cardImg).backgroundImage || '';
            const bgMatch = bg.match(/url\\(['"]?([^'"\\)]+)/);
            if (bgMatch) imageUrl = bgMatch[1];
          }
        }
        if (!imageUrl) {
          const anyImg = card.querySelector('img[src]');
          if (anyImg) {
            const s = anyImg.getAttribute('src') || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
          }
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
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 3 && t.length < 200) bullets.push(t);
        });
        const cardText = card.textContent;
        if (cardText.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        // Image: look for <img> or background-image on .auction-property-image
        let imageUrl = '';
        const imgDiv = card.querySelector('.auction-property-image');
        if (imgDiv) {
          const bg = imgDiv.style.backgroundImage || imgDiv.getAttribute('style') || '';
          const bgMatch = bg.match(/url\\(['"]?([^'"\\)]+)/);
          if (bgMatch) imageUrl = bgMatch[1];
        }
        if (!imageUrl) {
          const cardImg = card.querySelector('img.main-image, img.img-responsive, .property-grid-image img');
          if (cardImg) imageUrl = cardImg.getAttribute('src') || cardImg.dataset.src || '';
        }
        if (!imageUrl) {
          const anyImg = card.querySelector('img[src]');
          if (anyImg) {
            const s = anyImg.getAttribute('src') || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
          }
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
        lotIndex++;
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
      const cards = document.querySelectorAll('.property-card');
      for (const card of cards) {
        const text = card.textContent || '';
        // Lot number — plain 3-digit text like "001", "002" at start of card
        let lotNum = 0;
        const lotMatch = text.match(/^\\s*(\\d{1,4})\\s/);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // URL from property link
        let url = '';
        const propLink = card.querySelector('a[href*="/properties/"]');
        if (propLink) url = propLink.getAttribute('href') || '';
        if (seen.has(url) && url) continue;
        if (url) seen.add(url);
        // Address from the link text (contains full address with postcode)
        let address = '';
        if (propLink) address = propLink.textContent.trim();
        // If multiple links, find the one with substantive text (not just whitespace overlay)
        if (!address || address.length < 5) {
          const allLinks = card.querySelectorAll('a[href*="/properties/"]');
          for (const link of allLinks) {
            const t = link.textContent.trim();
            if (t.length > 5 && t.match(/[A-Z]{1,2}\\d/i)) { address = t; break; }
          }
        }
        if (!address) continue;
        // Deduplicate address if it repeats (site duplicates it in overlay + content)
        address = address.replace(/(.{20,})\\1/g, '$1').trim();
        // Price from "Guide Price: £X+" pattern
        let price = null;
        const priceMatch = text.match(/Guide\\s*Price[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // Bullets — auction type, end date, property type
        const bullets = [];
        const typeMatch = text.match(/(Multi-Lot Timed|Single-Lot Timed|Live Stream)\\s*Auction/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        const endMatch = text.match(/Auction\\s*Ends?:\\s*(\\d{2}\\/\\d{2}\\/\\d{4})/i);
        if (endMatch) bullets.push('Auction Ends: ' + endMatch[1]);
        // Detect sold/withdrawn status
        if (text.match(/\\bWithdrawn\\b|\\bSOLD\\b|\\bSTC\\b|\\bSale Agreed\\b/i)) {
          bullets.push('SOLD/STC');
        }
        // Image — first real property image from swiper or img tag
        let imageUrl = '';
        const imgs = card.querySelectorAll('img[src]');
        for (const img of imgs) {
          const s = img.getAttribute('src') || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg')
              && !s.includes('placeholder') && s.length > 10) {
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

  // ─── NETWORK AUCTIONS ─────────────────────────────────────
  network: `
    (() => {
      const lots = [];
      const seen = new Set();
      const cards = document.querySelectorAll('.lot-card, .property-card, [class*="lot-item"], [class*="property"], article');
      for (const card of cards) {
        const text = card.textContent || '';
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const lotNum = parseInt(lotMatch[1]);
        if (seen.has(lotNum)) continue;
        seen.add(lotNum);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/(?:Guide|Price)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const heading = card.querySelector('h2, h3, h4, .address');
        if (heading) address = heading.textContent.trim();
        if (!address) continue;
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
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

  // ─── BARNARD MARCUS ────────────────────────────────────────
  // barnardmarcusauctions.co.uk — Countrywide CMS, server-rendered
  barnardmarcus: `
    (() => {
      const lots = [];
      const seen = new Set();
      const headers = document.querySelectorAll('h2, h3, h4, h5');
      for (const h of headers) {
        const text = h.textContent.trim();
        const lotMatch = text.match(/^\\s*(\\d{1,4})\\s*$/) || text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const parent = h.closest('.lot, .property, div[class*="lot"], div, li, article') || h.parentElement;
        if (!parent) continue;
        let address = '', price = null, url = '';
        const links = parent.querySelectorAll('a[href]');
        for (const link of links) {
          const lt = link.textContent.trim();
          const href = link.getAttribute('href') || '';
          if (lt.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && !address) {
            address = lt;
            if (href && href !== '#') url = href;
          }
        }
        const priceMatch = parent.textContent.match(/(?:Guide|Price|£)\\s*£?([\\d,]+(?:,\\d{3})*)/i);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        const bullets = [];
        parent.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
        });
        if (parent.textContent.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
        // Image from parent container
        let imageUrl = '';
        const parentImg = parent.querySelector('img[src]');
        if (parentImg) {
          const s = parentImg.getAttribute('src') || parentImg.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
        if (address || price) lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── AUCTION HOUSE LONDON ─────────────────────────────────
  auctionhouselondon: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('a[href*="/lot/"]');
      const seen = new Set();
      for (const card of cards) {
        const text = card.textContent;
        const lotMatch = text.match(/LOT\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const href = card.getAttribute('href') || '';
        const priceMatch = text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = text.replace(/LOT\\s+\\d+/i, '').replace(/Guide Price[^£]*£[\\d,]+\\+?/i, '').replace(/£[\\d,]+\\+?/g, '').trim();
        address = address.split('\\n').map(s=>s.trim()).filter(s=>s.length>5)[0] || '';
        const bullets = [];
        const desc = text.split('\\n').map(s=>s.trim()).filter(s=>s.length>10 && !s.match(/^LOT|^Guide|^£/i));
        if (desc.length > 0) bullets.push(desc[0]);
        // Image from card or parent
        let imageUrl = '';
        let imgContainer = card;
        for (let d = 0; d < 3 && imgContainer; d++) { imgContainer = imgContainer.parentElement; if (!imgContainer) break; const img = imgContainer.querySelector('img[src]'); if (img) { const s = img.getAttribute('src') || img.dataset.src || ''; if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) { imageUrl = s; break; } } }
        if (!imageUrl) { const cardImg = card.querySelector('img[src]'); if (cardImg) { const s = cardImg.getAttribute('src') || ''; if (s.length > 10 && !s.includes('logo')) imageUrl = s; } }
        lots.push({ lot: num, address, price, url: href, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── McHUGH & CO ──────────────────────────────────────────
  mchughandco: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Try card-based approach first
      const cards = document.querySelectorAll('.lot-item, [class*="lot"], [class*="property"], article');
      for (const card of cards) {
        const text = card.textContent;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (!lotMatch) continue;
        const num = parseInt(lotMatch[1]);
        if (seen.has(num)) continue;
        seen.add(num);
        const link = card.querySelector('a[href]');
        const url = link ? link.getAttribute('href') : '';
        const priceMatch = text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        let address = '';
        const addrEl = card.querySelector('.address, h2, h3, h4, [class*="address"]');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address) {
          const lines = text.split('\\n').map(s=>s.trim()).filter(s=>s.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i));
          if (lines.length) address = lines[0];
        }
        const bullets = [];
        card.querySelectorAll('li').forEach(li => {
          const t = li.textContent.trim();
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
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
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
        if (text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
        }
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
      const cards = document.querySelectorAll('[class*="lot"], [class*="property"], .catalogue-item, article');
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
        const heading = card.querySelector('h2, h3, h4, .address');
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
        // Image from card
        let imageUrl = '';
        const cardImg = card.querySelector('img[src]');
        if (cardImg) {
          const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
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
        card.querySelectorAll('li, .description, .feature').forEach(el => {
          const t = el.textContent.trim();
          if (t.length > 5 && t.length < 200) bullets.push(t);
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
        // Image from card
        let imageUrl = '';
        const cardImg = card.querySelector('img[src]');
        if (cardImg) {
          const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
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
          // Image from card
          let imageUrl = '';
          const elImg = el.querySelector('img[src]');
          if (elImg) {
            const s = elImg.getAttribute('src') || elImg.dataset.src || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
          }
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets: [], imageUrl: imageUrl || undefined });
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
          let imageUrl = '';
          const cardImg = card.querySelector('img[src]');
          if (cardImg) {
            const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
          }
          lots.push({ lot: num, address: address.trim().substring(0, 150), price, url: href, bullets: [], imageUrl: imageUrl || undefined });
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
          let imageUrl = '';
          const cardImg = card.querySelector('img[src]');
          if (cardImg) {
            const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
          }
          lots.push({ lot: lots.length + 1, address: address.substring(0, 150), price, url: href, bullets: [], imageUrl: imageUrl || undefined });
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
          let imageUrl = '';
          const elImg = el.querySelector('img[src]');
          if (elImg) {
            const s = elImg.getAttribute('src') || elImg.dataset.src || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
          }
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets: [], imageUrl: imageUrl || undefined });
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
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets, imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── BARNETT ROSS (PHP) ──
  barnettross: `
    (() => {
      const lots = [];
      document.querySelectorAll('a[href*="property.php"], .lot-row, .property-row, [class*="lot"]').forEach(el => {
        const text = el.textContent || '';
        const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:guide|sold|price)[:\\s]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const pcMatch = text.match(/[A-Z]{1,2}\\d{1,2}[A-Z]?\\s*\\d[A-Z]{2}/i);
        const address = text.replace(/lot\\s*\\d+/i, '').replace(/£[\\d,]+/g, '').trim().split('\\n')[0].trim();
        if (address && address.length > 5) {
          let imageUrl = '';
          const elImg = el.querySelector('img[src]');
          if (elImg) {
            const s = elImg.getAttribute('src') || elImg.dataset.src || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
          }
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets: [], imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── COTTONS (WordPress) ──
  cottons: `
    (() => {
      const lots = [];
      document.querySelectorAll('.property-card, .lot-card, [class*="property"], [class*="lot"]').forEach(card => {
        const text = card.textContent || '';
        const link = card.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/guide\\s*(?:price)?\\s*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const address = text.split('\\n').find(l => l.trim().length > 10 && !l.match(/^(?:lot|guide|£|sold)/i));
        if (address) {
          let imageUrl = '';
          const cardImg = card.querySelector('img[src]');
          if (cardImg) {
            const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
          }
          lots.push({ lot: num, address: address.trim().substring(0, 150), price, url: href, bullets: [], imageUrl: imageUrl || undefined });
        }
      });
      return lots;
    })()
  `,

  // ── DEDMAN GRAY (PHP) ──
  dedmangray: `
    (() => {
      const lots = [];
      document.querySelectorAll('.property-card, .auction-lot, [class*="property"], [class*="lot"]').forEach(card => {
        const text = card.textContent || '';
        const link = card.querySelector('a');
        const href = link ? link.getAttribute('href') : '';
        const lotMatch = text.match(/lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/guide\\s*(?:price)?\\s*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        const address = text.split('\\n').find(l => l.trim().length > 10 && !l.match(/^(?:lot|guide|£|sold)/i));
        if (address) {
          let imageUrl = '';
          const cardImg = card.querySelector('img[src]');
          if (cardImg) {
            const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
          }
          lots.push({ lot: num, address: address.trim().substring(0, 150), price, url: href, bullets: [], imageUrl: imageUrl || undefined });
        }
      });
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
        // Image from Swiper gallery
        let imageUrl = '';
        const swiperImg = card.querySelector('.swiper-slide img, .property-gallery img, img[src*="uploads"]');
        if (swiperImg) {
          imageUrl = swiperImg.getAttribute('src') || swiperImg.dataset.src || '';
        }
        if (!imageUrl) {
          // Check for background-image on swiper slide divs
          const slideDiv = card.querySelector('.swiper-slide [style*="background"]');
          if (slideDiv) {
            const bg = slideDiv.getAttribute('style') || '';
            const bgMatch = bg.match(/background(?:-image)?:\\s*url\\(['"]?([^'"\\)]+)/i);
            if (bgMatch) imageUrl = bgMatch[1];
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
          lots.push({ lot: num, address: address.substring(0, 150), price, url: href, bullets: desc ? [desc] : [], imageUrl: imageUrl || undefined });
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
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      });
      return lots;
    })()
  `,

  // ── LANDWOOD (EIG platform) ──
  landwood: `
    (() => {
      const lots = [];
      const seen = new Set();
      document.querySelectorAll('.lot-panel, .lot-card, [class*="lot-item"]').forEach(panel => {
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
        const addrEl = panel.querySelector('.grid-address, h4, h3');
        let address = addrEl ? addrEl.textContent.trim() : '';
        if (!address) return;
        const bullets = [];
        const tagEl = panel.querySelector('.grid-tagline');
        if (tagEl) bullets.push(tagEl.textContent.trim());
        let imageUrl = '';
        const img = panel.querySelector('img.grid-img, img.img-responsive, img[src*="eigpropertyauctions"]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && s.length > 10) imageUrl = s;
        }
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      });
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
        let imageUrl = '';
        const cardImg = card.querySelector('img[src]');
        if (cardImg) {
          const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── AUCTION ESTATES ──
  auctionestates: `
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
        let imageUrl = '';
        const cardImg = card.querySelector('img[src]');
        if (cardImg) {
          const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
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
        let imageUrl = '';
        const cardImg = card.querySelector('img[src]');
        if (cardImg) {
          const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
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
        if (titleText.match(/Sold|Withdrawn|Postponed/i)) bullets.push(titleText.trim());
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
        if (statusEl) bullets.push(statusEl.textContent.trim());
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
        if (ribbon) bullets.push(ribbon.getAttribute('data-ribbon'));
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
      // Each lot card wraps in a link to property_details.asp
      const cards = document.querySelectorAll('a[href*="property_details.asp"]');
      for (const card of cards) {
        const href = card.getAttribute('href') || '';
        if (seen.has(href)) continue;
        seen.add(href);
        const text = card.textContent || '';
        if (text.length < 20 || text.length > 2000) continue;
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Price — "£60,000 OPENING BID" or "£60,000"
        let price = null;
        const priceMatch = text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // Address — find a postcode pattern and use nearby text
        let address = '';
        const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length > 3);
        for (const line of lines) {
          if (line.match(/[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}/i) && line.length < 200) {
            address = line.replace(/Lot\\s+\\d+/i, '').replace(/£[\\d,]+[^\\n]*/g, '').trim();
            break;
          }
        }
        if (!address) {
          // Use first substantial line that isn't a price or lot number
          for (const line of lines) {
            if (line.length > 10 && line.length < 200 && !line.match(/^Lot\\s|^£|OPENING BID|Offer Now|Timed|Online/i)) {
              address = line;
              break;
            }
          }
        }
        if (!address || address.length < 5) continue;
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="/upload/"]');
        if (img) {
          let src = img.getAttribute('src') || '';
          if (src.startsWith('http://')) src = src.replace('http://', 'https://');
          imageUrl = src;
        }
        // Bullets — auction type
        const bullets = [];
        const typeMatch = text.match(/(Timed Online Auction|Live Auction)[^\\n]*/i);
        if (typeMatch) bullets.push(typeMatch[0].trim());
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
        lots.push({ lot: lots.length + 1, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── FIRST FOR AUCTIONS ─────────────────────────────────────
  // online.firstforauctions.co.uk — EIG platform.
  // Cards are div.lot-panel with h4.grid-address, div.grid-guideprice b.
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
        lots.push({ lot: lotIndex++, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ─── SUTTON KERSH ───────────────────────────────────────────
  // suttonkersh.co.uk — Liverpool. Static HTML gallery.
  // Cards are .galleryProperty with .info h1 a (address) and h2 a (price).
  suttonkersh: `
    (() => {
      const lots = [];
      const cards = document.querySelectorAll('.galleryProperty, .propertyBox.auctionBox');
      for (const card of cards) {
        const text = card.textContent || '';
        // Address from h1 > a inside .info
        let address = '';
        const addrEl = card.querySelector('.info h1 a, h1 a');
        if (addrEl) address = addrEl.textContent.replace(/\\n/g, ', ').trim();
        if (!address || address.length < 5) continue;
        // Price from h2 > a inside .info — "Sold for £63,000" or "Available at £X"
        let price = null;
        const priceEl = card.querySelector('.info h2 a, h2 a');
        if (priceEl) {
          const pm = priceEl.textContent.match(/£([\\d,]+)/);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // URL from detail link
        let url = '';
        const link = card.querySelector('a[href*="/properties/lot/"]');
        if (link) url = link.getAttribute('href') || '';
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot[:\\s]+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Image
        let imageUrl = '';
        const img = card.querySelector('.img_container img:not(.sold), img[src*="image_crop"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Bullets — status, property type
        const bullets = [];
        const statusText = priceEl ? priceEl.textContent.trim() : '';
        if (statusText.match(/Sold|Withdrawn|Postponed/i)) bullets.push(statusText);
        // Property type from p after lot number
        const infoPs = card.querySelectorAll('.info p');
        for (const p of infoPs) {
          const pt = p.textContent.trim();
          if (pt.length > 3 && pt.length < 80 && !pt.match(/Lot:|Guide/i)) bullets.push(pt);
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
        const addrEl = card.querySelector('[data-address-searchable], h4.grid-address, h4');
        if (addrEl) address = addrEl.textContent.trim().replace(/\\u00a0/g, ' ');
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
        if (text.match(/Auction Ended/i)) bullets.push('Auction Ended');
        if (text.match(/\\bSold\\b/i)) bullets.push('SOLD');
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
      const cards = document.querySelectorAll('a[href*="/lot/details/"]');
      for (const card of cards) {
        const href = card.getAttribute('href') || '';
        if (seen.has(href)) continue;
        seen.add(href);
        const text = card.textContent || '';
        if (text.length < 10 || text.length > 3000) continue;
        // Lot number
        let lotNum = lots.length + 1;
        const lotMatch = text.match(/Lot\\s+(\\d+)/i);
        if (lotMatch) lotNum = parseInt(lotMatch[1]);
        // Address from h4
        let address = '';
        const addrEl = card.querySelector('h4');
        if (addrEl) address = addrEl.textContent.trim();
        if (!address || address.length < 5) continue;
        // Price — "Guide Price £120,000+"
        let price = null;
        const priceMatch = text.match(/Guide Price[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        // Image
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"]');
        if (img) imageUrl = img.getAttribute('src') || '';
        // Bullets
        const bullets = [];
        if (text.match(/Postponed/i)) bullets.push('Postponed');
        lots.push({ lot: lotNum, address, price, url: href, bullets, imageUrl: imageUrl || undefined });
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
          let imageUrl = '';
          const img = card.querySelector('img[src*="eigpropertyauctions"], img[src*="cdn."]');
          if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
          const bullets = [];
          const desc = card.querySelector('.property-strapline');
          if (desc) bullets.push(desc.textContent.trim().substring(0, 200));
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
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img[src*="cdn."]');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        const bullets = [];
        const desc = card.querySelector('.property-strapline');
        if (desc) bullets.push(desc.textContent.trim().substring(0, 200));
        const status = card.querySelector('.elementor-heading-title');
        if (status) bullets.push(status.textContent.trim());
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── EIG PLATFORM (reusable for any EIG-hosted house) ──
  eigplatform: `
    (() => {
      const lots = [];
      // Strategy 1: lot-panel cards (grid view)
      let cards = document.querySelectorAll('.lot-panel');
      if (cards.length === 0) cards = document.querySelectorAll('a[href*="/lot/details/"]');
      if (cards.length === 0) cards = document.querySelectorAll('[data-lot-item-toggle]');
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10) continue;
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:Guide Price|Opening Bid)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        // Address from known selectors
        let address = '';
        const addrEl = card.querySelector('h4.grid-address, .lot-address, [data-address-searchable], h4');
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
        const img = card.querySelector('img[src*="eigpropertyauctions"], img.grid-img, img.img-responsive');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        lots.push({ lot: num, address: address.substring(0, 200), price, url, bullets: [], imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

};

// Universal DOM extractor — works on any auction site by detecting common patterns
const UNIVERSAL_DOM_EXTRACTOR = `
  (() => {
    const lots = [];
    const seen = new Set();
    
    // Strategy 1: Find all links to individual property/lot pages
    const propLinks = document.querySelectorAll('a[href*="/property/"], a[href*="/lot/"], a[href*="property-details"], a[href*="/properties/"]');
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
      
      lots.push({ lot: lotNum, address, price, url: href, bullets: bullets.slice(0, 8) });
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
        
        lots.push({ lot: lotMatch ? parseInt(lotMatch[1]) : lots.length + 1, address, price, url, bullets: bullets.slice(0, 8) });
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
      if (lot.imageUrl || !lot.url) continue;
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
    console.log(`Image backfill for ${catalogueUrl.substring(0, 60)}: ${updated}/${lots.filter(l => !l.imageUrl).length + updated} matched`);
    return updated > 0 ? lots : null;
  } catch (err) {
    console.log(`Image backfill error for ${catalogueUrl}: ${err.message}`);
    return null;
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
      console.log(`DOM extractor error for ${house}: ${err.message}`);
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
      console.log(`Universal DOM extractor error for ${house}: ${err.message}`);
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
    console.log(`Image extraction error for ${house}: ${err.message}`);
  }

  // Resolve any relative imageUrls to absolute
  for (const lot of lots) {
    if (lot.imageUrl && !/^https?:\/\//i.test(lot.imageUrl)) {
      try { lot.imageUrl = new URL(lot.imageUrl, baseUrl).href; } catch {}
    }
  }

  // Post-processing: filter out non-property images (logos, icons, placeholders)
  const imgBlocklist = /logo|icon|placeholder|no-image|default|blank|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|noimage/i;
  for (const lot of lots) {
    if (lot.imageUrl && imgBlocklist.test(lot.imageUrl)) {
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

  if (/\bflt\b|flat|apartment|maisonette/.test(t)) L.propType = 'flat';
  else if (/bungalow/.test(t)) L.propType = 'bungalow';
  else if (/semi[- ]?detached|terraced?|terrace house|detached house|town\s?house|end of terrace|mid[- ]terrace/.test(t)) L.propType = 'house';
  else if (/\bdetached\b|period\s+property|residential\s+property|chalet|cottage|lodge|villa|mansion/.test(t)) L.propType = 'house';
  else if (/\bhouse\b/.test(t)) L.propType = 'house';
  else if (/shop|office|commercial|retail|industrial|warehouse|investment|ground rent/.test(t)) L.propType = 'commercial';
  else if (/\bland\b|plot|site|church|hall|chapel/.test(t)) L.propType = 'land';
  else if (/garage|parking|lock.?up/.test(t)) L.propType = 'garage';
  else L.propType = 'other';

  const bm = t.match(/(\w+)\s*[-\s]?bed/);
  if (bm) {
    const v = bm[1].toLowerCase(); L.beds = W2N[v] || (v.match(/^\d+$/) ? +v : null);
    // Cap residential bed count at 10 — higher counts are student blocks/HMOs/hotels
    if (L.beds > 10 && ['house', 'flat', 'bungalow'].includes(L.propType)) L.beds = null;
  }
  if (/studio/.test(t) && L.beds === null) L.beds = 0;

  if (/share of freehold/.test(t)) L.tenure = 'Share of Freehold';
  else if (/freehold/.test(t) && !/leasehold/.test(t)) L.tenure = 'Freehold';
  else if (/leasehold/.test(t)) L.tenure = 'Leasehold';

  if (/modernis|refurbishment|renovation|updating|in need of|improvement|for improve/.test(t)) L.condition = 'needs work';
  else if (/good order|good decorative|well maintained|recently refurbished/.test(t)) L.condition = 'good';
  else if (/derelict|dilapidated|fire damage/.test(t)) L.condition = 'poor';

  if (/vacant possession|\bvp\b|vacant property/.test(t)) L.vacant = true;
  else if (/tenant|let to|tenanted|occupied|sitting tenant/.test(t)) L.vacant = false;

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
  if (L.condition === 'needs work') { s += 2; L.opps.push('Needs modernisation'); }
  if (L.condition === 'poor') { s += 2.5; L.opps.push('Poor condition'); }
  if (executor) { s += 1.5; L.opps.push('Executor/probate'); }
  if (receivership) { s += 2; L.opps.push('Receivership'); }
  if (devP) { s += 2; L.opps.push('Development potential'); }
  if (extP) { s += 1.5; L.opps.push('Extension/HMO potential'); }
  if (L.vacant && ['house', 'bungalow', 'flat', 'land'].includes(L.propType)) { s += 1; L.opps.push('Vacant'); }
  if (L.tenure === 'Freehold' && ['house', 'bungalow'].includes(L.propType)) { s += 0.5; L.opps.push('Freehold'); }
  if (L.sqft && L.price) {
    const p = L.price / L.sqft;
    if (p < 200) { s += 2; L.opps.push(`£${Math.round(p)}/sqft`); }
    else if (p < 300) { s += 1; L.opps.push(`£${Math.round(p)}/sqft`); }
  }

  const rm = t.match(/(?:let\s+at|rent\s+of|income\s+of|producing)\s+£?([\d,]+)\s*(?:p\.?a|per\s*annum)/);
  if (rm && L.price) {
    const rent = parseInt(rm[1].replace(/,/g, '')); const gy = (rent / L.price) * 100;
    if (gy > 8) { s += 2.5; L.opps.push(`${gy.toFixed(1)}% GIY`); }
    else if (gy > 6) { s += 1.5; L.opps.push(`${gy.toFixed(1)}% GIY`); }
  }

  if (/(?:4|5|6)\s*week\s*completion|six week/.test(t)) { s += 0.5; L.opps.push('Quick completion'); }
  if (/by order of/.test(t) && !executor && !receivership) { s += 0.5; L.opps.push('Motivated seller'); }
  if (L.titleSplit) { s += 1; L.opps.push(`Title split (${L.units} units)`); }

  if (/sitting tenant/.test(t)) { s -= 2; L.risks.push('Sitting tenant'); }
  if (/knotweed/.test(t)) { s -= 2; L.risks.push('Knotweed'); }
  if (/flying freehold/.test(t)) { s -= 1; L.risks.push('Flying freehold'); }
  if (/non[- ]?standard|timber frame|prefab|prc/.test(t)) { s -= 1; L.risks.push('Non-std construction'); }
  if (/flood risk|flood zone/.test(t)) { s -= 1; L.risks.push('Flood risk'); }
  if (/asbestos|contamination/.test(t)) { s -= 1; L.risks.push('Contamination'); }
  if (/grade ii|listed/.test(t)) L.risks.push('Listed building');
  if (!L.price) L.risks.push('Guide TBA');

  if (devP) L.dealType = 'Development';
  else if ((L.condition === 'needs work' || L.condition === 'poor') && extP) L.dealType = 'Refurb+Extend';
  else if (L.condition === 'needs work' || L.condition === 'poor') L.dealType = 'Refurb';
  else if (L.titleSplit) L.dealType = 'Title Split';
  else if (executor || receivership) L.dealType = 'Motivated';
  else L.dealType = 'Standard';

  L.score = Math.round(s * 10) / 10;
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
    const resp = await fetch('http://landregistry.data.gov.uk/landregistry/query', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `query=${encodeURIComponent(sparql)}`,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return [];
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
    return results;
  } catch (e) {
    console.log(`Land Registry query failed for ${postcode}: ${e.message}`);
    return [];
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

function estimateMonthlyRent(address, beds) {
  const a = (address || '').toLowerCase();
  // Try specific towns/cities first, then regions
  for (const [key, rents] of Object.entries(VOA_RENTS)) {
    if (key === '_default') continue;
    if (a.includes(key)) {
      const base = rents[Math.min(beds ?? 2, 4)];
      const uplift = RENT_UPLIFT[key] || RENT_UPLIFT._default;
      return Math.round(base * uplift);
    }
  }
  const base = VOA_RENTS._default[Math.min(beds ?? 2, 4)];
  return Math.round(base * RENT_UPLIFT._default);
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
        return `https://www.paulfosh.com${lot.url}`;
      }
      break;
    case 'cottons':
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
        return `https://www.landwoodgroup.com${lot.url}`;
      }
      break;
    case 'loveitts':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.loveitts.co.uk${lot.url}`;
      }
      break;
    case 'hunters':
      if (lot.url && lot.url.startsWith('/')) {
        return `https://www.huntersnet.co.uk${lot.url}`;
      }
      break;
    // ── New houses ──
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
  }
  return lot.url || '';
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

  // Query Land Registry for each unique postcode (with concurrency limit)
  const CONCURRENCY = 5;
  const lrCache = {};
  let enrichDone = 0;
  for (let i = 0; i < postcodes.length; i += CONCURRENCY) {
    const batch = postcodes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(pc => queryLandRegistry(pc)));
    batch.forEach((pc, idx) => { lrCache[pc] = results[idx]; });
    enrichDone += batch.length;
    if (onProgress) onProgress(enrichDone, postcodes.length);
    if (i + CONCURRENCY < postcodes.length) await new Promise(r => setTimeout(r, 200));
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

    // Calculate street average (last 3 years)
    const relevantSales = sales.filter(s => s.price > 0);
    if (relevantSales.length > 0) {
      const avg = Math.round(relevantSales.reduce((s, x) => s + x.price, 0) / relevantSales.length);
      lot.streetAvg = avg;
      lot.streetSalesCount = relevantSales.length;
      
      // Bargain score: how far below street average is the guide price?
      if (lot.price && avg > 0) {
        const discount = ((avg - lot.price) / avg) * 100;
        lot.belowMarket = Math.round(discount);
        if (discount > 20) {
          lot.score += 2;
          lot.opps.push(`${lot.belowMarket}% below market`);
        } else if (discount > 10) {
          lot.score += 1;
          lot.opps.push(`${lot.belowMarket}% below market`);
        } else if (discount < -10) {
          lot.risks.push(`${Math.abs(lot.belowMarket)}% above market avg`);
        }
        lot.score = Math.round(lot.score * 10) / 10;
      }
    } else {
      lot.streetAvg = null;
      lot.streetSalesCount = 0;
    }

    // Rental yield estimate
    const monthlyRent = estimateMonthlyRent(lot.address, lot.beds);
    lot.estMonthlyRent = monthlyRent;
    lot.estAnnualRent = monthlyRent * 12;
    if (lot.price && lot.price > 0) {
      lot.estGrossYield = Math.round((lot.estAnnualRent / lot.price) * 1000) / 10;
      if (lot.estGrossYield > 8 && !lot.opps.some(o => o.includes('GIY'))) {
        lot.score += 1.5;
        lot.opps.push(`Est. ${lot.estGrossYield}% yield`);
      } else if (lot.estGrossYield > 6 && !lot.opps.some(o => o.includes('GIY'))) {
        lot.score += 0.5;
        lot.opps.push(`Est. ${lot.estGrossYield}% yield`);
      }
      lot.score = Math.round(lot.score * 10) / 10;
    }
  }

  // Re-sort by score after enrichment
  lots.sort((a, b) => b.score - a.score);
  console.log(`Enrichment complete. ${Object.values(lrCache).flat().length} total Land Registry sales found.`);
  return lots;
}
// Sentry error handler — must be after all routes, before app.listen
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.listen(PORT, () => {
  log.info('server_start', { port: PORT });
  if (!process.env.SUPABASE_URL) log.warn('missing_env', { var: 'SUPABASE_URL' });
  if (!process.env.SUPABASE_SERVICE_KEY) log.warn('missing_env', { var: 'SUPABASE_SERVICE_KEY' });
  if (!process.env.ANTHROPIC_API_KEY) log.warn('missing_env', { var: 'ANTHROPIC_API_KEY' });

  // ── Auto-analyse all catalogue-ready auctions ──
  // Run 30s after startup (let everything initialise), then every 6 hours
  setTimeout(() => autoAnalyseAll(), 30000);
  setInterval(() => autoAnalyseAll(), 6 * 60 * 60 * 1000);
});

// ═══════════════════════════════════════════════════════════════
// AUTO-ANALYSIS: Pre-analyse all catalogue-ready auctions
// ═══════════════════════════════════════════════════════════════
let _autoAnalysisRunning = false;
let creditExhausted = false;
let apiCallCount = 0;
let hashHitCount = 0;
const serverStartTime = new Date().toISOString();

async function autoAnalyseAll() {
  if (creditExhausted) {
    console.log('AUTO: Skipping — API credits exhausted');
    return { skipped: true, reason: 'credits_exhausted' };
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.log('AUTO: No API key, skipping'); return; }

  // ── Step 1: Discover new catalogues from house root pages ──
  // Runs once per cycle to find new auction URLs that aren't in the calendar yet.
  await discoverAndUpdateCalendar(apiKey).catch(e =>
    console.error('AUTO-DISCOVER: failed —', e.message)
  );

  // ── Step 2: Analyse all catalogue-ready auctions ──
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

  let analysed = 0, skipped = 0, failed = 0;

  for (const auction of ready) {
    try {
      const normalisedUrl = auction.url.trim().replace(/\/+$/, '').toLowerCase();

      // Check if we already have a fresh cache
      const { data: cached } = await supabase
        .from('cached_analyses')
        .select('url, total_lots, created_at, lots')
        .eq('url', normalisedUrl)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (cached && cached.total_lots > 0) {
        const cachedLots = cached.lots || [];
        let needsUpdate = false;

        // Allsop-specific: fix broken lot URLs and enrich with API data (including images)
        if (auction.house === 'allsop') {
          const brokenUrls = cachedLots.filter(l => l.url && /allsop\.co\.uk\/lot\/\d+/i.test(l.url)).length;
          const missingAllsopImages = cachedLots.filter(l => !l.imageUrl).length;
          if (brokenUrls > 0 || missingAllsopImages > 0) {
            try {
              const rewritten = rewriteUrl(auction.url, 'allsop');
              if (rewritten?.isApi) {
                const pages = await scrapeAllsopApi(rewritten.baseUrl);
                if (pages.length > 0) {
                  enrichAllsopLots(cachedLots, pages);
                  // Rebuild URLs for enriched lots
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

        // Backfill images for cached lots that are missing them
        const missingImages = cachedLots.filter(l => l.url && !l.imageUrl).length;
        if (missingImages > 0) {
          const updated = await backfillImages(auction.url, cachedLots);
          if (updated) {
            needsUpdate = true;
            const gained = updated.filter(l => l.imageUrl).length;
            console.log(`AUTO: ✓ ${auction.house} already cached (${cached.total_lots} lots) — backfilled ${gained} images`);
          } else if (!needsUpdate) {
            console.log(`AUTO: ✓ ${auction.house} already cached (${cached.total_lots} lots)`);
          }
        } else if (!needsUpdate) {
          console.log(`AUTO: ✓ ${auction.house} already cached (${cached.total_lots} lots)`);
        }

        if (needsUpdate) {
          await supabase.from('cached_analyses').update({ lots: cachedLots }).eq('url', normalisedUrl);
        }
        skipped++;
        continue;
      }

      console.log(`AUTO: Analysing ${auction.house} — ${auction.url}`);
      await autoAnalyseOne(auction.url, apiKey);
      analysed++;

      // Pause between analyses to be kind to servers and our resources
      await new Promise(r => setTimeout(r, 5000));

    } catch (e) {
      console.error(`AUTO: ✗ ${auction.house} failed: ${e.message}`);
      failed++;
    }
  }

  console.log(`═══ AUTO-ANALYSIS COMPLETE: ${analysed} analysed, ${skipped} cached, ${failed} failed ═══\n`);
  return { analysed, skipped, failed, total: ready.length };
}

// ═══════════════════════════════════════════════════════════════
// AUTO-DISCOVER: Scrape house root pages to find new catalogue URLs
// ═══════════════════════════════════════════════════════════════
// Runs as part of the 6-hour auto-analysis cycle. For each house with a
// HOUSE_ROOTS entry, fetches the root page, extracts auction links with
// Claude Haiku, and upserts any new ones into the Supabase calendar.
async function discoverAndUpdateCalendar(apiKey) {
  if (!supabase || !apiKey) return;

  // Only discover for houses that have root URLs configured
  const slugs = Object.keys(HOUSE_ROOTS);
  console.log(`AUTO-DISCOVER: Checking ${slugs.length} house root pages for new catalogues`);

  let discovered = 0, errors = 0;

  for (const slug of slugs) {
    const rootUrl = HOUSE_ROOTS[slug];
    try {
      // Fetch root page
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(rootUrl, { headers: HEADERS, signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) continue;
      const html = await resp.text();

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

      const client = new Anthropic({ apiKey });
      const aiResp = await client.messages.create({
        model: MODEL_HAIKU,
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Extract auction catalogue links from this auction house page.

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
No catalogues? Return {"catalogues": []}`
        }]
      });

      let catalogues = [];
      try {
        let text = aiResp.content[0].text.trim();
        if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        catalogues = JSON.parse(text).catalogues || [];
      } catch { continue; }

      // Upsert discovered catalogues into Supabase calendar
      for (const cat of catalogues) {
        if (!cat.url) continue;
        const normUrl = cat.url.trim().replace(/\/+$/, '').toLowerCase();

        // Check if this URL is already in the calendar
        const { data: existing } = await supabase
          .from('auction_calendar')
          .select('id')
          .eq('url', cat.url)
          .maybeSingle();

        if (existing) continue; // Already known

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
}

async function autoAnalyseOne(url, apiKey) {
  const urlCheck = await validateUrl(url);
  if (!urlCheck.ok) { log.warn('autoAnalyseOne skipped — invalid URL', { url, reason: urlCheck.error }); return []; }
  const house = detectAuctionHouse(url);
  const rewritten = rewriteUrl(url, house);
  const scrapeUrl = rewritten.baseUrl;
  const normalisedUrl = url.trim().replace(/\/+$/, '').toLowerCase();

  // HTML change detection — scrape first page and hash it
  try {
    const probeHtml = await fetchPage(scrapeUrl);
    const contentHash = createHash('md5').update(probeHtml).digest('hex');
    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('content_hash, expires_at')
      .eq('url', normalisedUrl)
      .single();
    if (cached && cached.content_hash === contentHash && cached.expires_at && new Date(cached.expires_at) > new Date()) {
      // Extend cache TTL since content hasn't changed
      const newExpiry = new Date(Date.now() + getCacheTTL(house)).toISOString();
      await supabase.from('cached_analyses').update({ expires_at: newExpiry, last_scraped_at: new Date().toISOString() }).eq('url', normalisedUrl);
      hashHitCount++;
      console.log(`Cache extended — content unchanged for ${house}`);
      return;
    }
    // Store hash for later upsert
    autoAnalyseOne._lastContentHash = contentHash;
  } catch (e) {
    autoAnalyseOne._lastContentHash = null;
  }

  const client = new Anthropic({ apiKey });
  let rawLots = [];

  if (rewritten.paginateAs === 'allsop_api') {
    const pages = await scrapeAllsopApi(rewritten.baseUrl);
    if (pages.length > 0) {
      rawLots = await extractLotsWithClaude(client, pages, house, null, scrapeUrl);
      enrichAllsopLots(rawLots, pages);
    }

  } else if (rewritten.preferPuppeteer) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) req.abort();
      else req.continue();
    });

    try {
      if (rewritten.paginateAs === 'savills_pages') {
        await page.goto(scrapeUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2000));
        const totalPages = await page.evaluate(() => {
          const pageLinks = document.querySelectorAll('a[href*="/page-"]');
          let max = 1;
          for (const a of pageLinks) {
            const m = a.textContent.trim().match(/^(\d+)$/);
            if (m) max = Math.max(max, parseInt(m[1]));
          }
          return max;
        });
        const firstPageLots = await extractWithDOM(page, house);
        if (firstPageLots && firstPageLots.length > 0) rawLots.push(...firstPageLots);
        const maxPages = Math.min(totalPages, 50);
        for (let p = 2; p <= maxPages; p++) {
          try {
            await page.goto(`${scrapeUrl}/page-${p}`, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(r => setTimeout(r, 1500));
            const pageLots = await extractWithDOM(page, house);
            if (pageLots && pageLots.length > 0) rawLots.push(...pageLots);
          } catch (e) { console.log(`AUTO: Page ${p} failed: ${e.message}`); }
        }
        console.log(`AUTO: Savills total: ${rawLots.length} lots from ${maxPages} pages`);

      } else if (rewritten.paginateAs === 'sdl_pages') {
        await page.goto(scrapeUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 3000));
        await page.evaluate(async () => {
          for (let i = 0; i < 15; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 500)); }
          window.scrollTo(0, 0);
        });
        await new Promise(r => setTimeout(r, 2000));
        const sdlTotalPages = await page.evaluate(() => {
          const pageLinks = document.querySelectorAll('a[href*="page="], .pagination a, nav a');
          let max = 1;
          for (const a of pageLinks) {
            const href = a.getAttribute('href') || '';
            const pm = href.match(/page=(\d+)/);
            if (pm) max = Math.max(max, parseInt(pm[1]));
            const tm = a.textContent.trim().match(/^(\d+)$/);
            if (tm) max = Math.max(max, parseInt(tm[1]));
          }
          const bodyText = document.body.innerText;
          const ofMatch = bodyText.match(/page\s+\d+\s+of\s+(\d+)/i) || bodyText.match(/(\d+)\s+pages/i);
          if (ofMatch) max = Math.max(max, parseInt(ofMatch[1]));
          return max;
        });
        console.log(`AUTO: SDL detected ${sdlTotalPages} pages`);
        const firstLots = await extractWithDOM(page, house);
        if (firstLots && firstLots.length > 0) rawLots.push(...firstLots);
        console.log(`AUTO: SDL Page 1: ${firstLots ? firstLots.length : 0} lots`);
        const sdlMaxPages = Math.min(sdlTotalPages, 20);
        for (let p = 2; p <= sdlMaxPages; p++) {
          const sep = scrapeUrl.includes('?') ? '&' : '?';
          const pageUrl = `${scrapeUrl}${sep}page=${p}`;
          try {
            await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000));
            await page.evaluate(async () => {
              for (let i = 0; i < 10; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 400)); }
              window.scrollTo(0, 0);
            });
            await new Promise(r => setTimeout(r, 1500));
            const pageLots = await extractWithDOM(page, house);
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

      } else {
        // ── Generic auto-paginating Puppeteer extraction ──
        await page.goto(scrapeUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 3000));
        await page.evaluate(async () => {
          for (let i = 0; i < 15; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 500)); }
          window.scrollTo(0, 0);
        });
        await new Promise(r => setTimeout(r, 2000));

        const domLots = await extractWithDOM(page, house);
        if (domLots && domLots.length >= 3) {
          rawLots.push(...domLots);
          console.log(`AUTO: ${house} Page 1: ${domLots.length} lots`);

          // Auto-detect pagination
          const detectedPages = await page.evaluate(() => {
            let max = 1;
            document.querySelectorAll('a[href*="page="], a[href*="page-"], a[href*="/page/"]').forEach(a => {
              const href = a.getAttribute('href') || '';
              const m = href.match(/page[=/](\d+)/) || href.match(/page-(\d+)/);
              if (m) max = Math.max(max, parseInt(m[1]));
            });
            document.querySelectorAll('.pagination a, nav.pagination a, .paging a, .page-numbers a, [class*="pagination"] a, [class*="pager"] a').forEach(a => {
              const t = a.textContent.trim();
              if (t.match(/^\d+$/)) max = Math.max(max, parseInt(t));
            });
            const bodyText = document.body.innerText;
            const ofMatch = bodyText.match(/page\s+\d+\s+of\s+(\d+)/i) || bodyText.match(/(\d+)\s+pages/i);
            if (ofMatch) max = Math.max(max, parseInt(ofMatch[1]));
            const showMatch = bodyText.match(/showing\s+\d+[\s-]+\d+\s+of\s+(\d+)/i) || bodyText.match(/(\d+)\s+results?\s+found/i) || bodyText.match(/(\d+)\s+(?:lots?|properties)/i);
            if (showMatch) { const total = parseInt(showMatch[1]); if (total > 50) max = Math.max(max, Math.ceil(total / 20)); }
            let pattern = 'query';
            if (document.querySelector('a[href*="page-"]')) pattern = 'path-dash';
            if (document.querySelector('a[href*="/page/"]')) pattern = 'path-slash';
            return { max, pattern };
          });

          if (detectedPages.max > 1) {
            const maxPages = Math.min(detectedPages.max, 25);
            console.log(`AUTO: ${house}: detected ${detectedPages.max} pages (${detectedPages.pattern}), loading up to ${maxPages}`);
            for (let p = 2; p <= maxPages; p++) {
              let pageUrl;
              if (detectedPages.pattern === 'path-dash') pageUrl = scrapeUrl.replace(/\/page-\d+/, '') + `/page-${p}`;
              else if (detectedPages.pattern === 'path-slash') pageUrl = scrapeUrl.replace(/\/page\/\d+/, '') + `/page/${p}`;
              else { const sep = scrapeUrl.includes('?') ? '&' : '?'; pageUrl = `${scrapeUrl}${sep}page=${p}`; }
              try {
                await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(r => setTimeout(r, 2000));
                await page.evaluate(async () => { for (let i = 0; i < 10; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 400)); } window.scrollTo(0, 0); });
                await new Promise(r => setTimeout(r, 1500));
                const pageLots = await extractWithDOM(page, house);
                if (pageLots && pageLots.length > 0) { rawLots.push(...pageLots); console.log(`AUTO: ${house} Page ${p}: ${pageLots.length} lots`); }
                else { console.log(`AUTO: ${house} Page ${p}: 0 lots — stopping`); break; }
              } catch (e) { console.log(`AUTO: ${house} Page ${p} failed: ${e.message}`); break; }
            }
          }
          console.log(`AUTO: ${house} total: ${rawLots.length} lots`);
        } else {
          const html = await page.content();
          const puppeteerPages = [{ page: 1, html }];
          rawLots = await extractLotsWithClaude(client, puppeteerPages, house, null, scrapeUrl);
          console.log(`AUTO: ${house}: ${rawLots.length} lots via Claude fallback`);
        }
      }
    } finally {
      await page.close();
    }

  } else {
    const pages = await scrapeAllPages(scrapeUrl, house);
    if (pages && pages.length > 0) rawLots = await extractLotsWithClaude(client, pages, house, null, scrapeUrl);
    // Skip Puppeteer fallback for houses where it wastes memory (blocked, empty, or JS-only)
    const SKIP_PUPPETEER = ['cottons','dedmangray','philliparnold'];
    if (rawLots.length === 0 && !SKIP_PUPPETEER.includes(house)) {
      const puppeteerPages = await scrapeWithPuppeteer(url, house);
      if (puppeteerPages.length > 0) rawLots = await extractLotsWithClaude(client, puppeteerPages, house, null, scrapeUrl);
    }
  }

  if (rawLots.length === 0) {
    console.log(`AUTO: ${house}: 0 lots found, skipping cache`);
    return;
  }

  const lots = rawLots.map(lot => analyseLot(lot)).sort((a, b) => b.score - a.score);
  await enrichLots(lots, house, url);

  const expiresAt = new Date(Date.now() + getCacheTTL(house)).toISOString();
  const lotsWithPrice = lots.filter(l => l.price && l.price > 0);
  const yieldsArr = lots.map(l => l.estGrossYield).filter(y => y && y > 0);

  // Check if catalogue data actually changed
  const { data: prevCached } = await supabase
    .from('cached_analyses')
    .select('total_lots, top_picks, title_splits')
    .eq('url', normalisedUrl)
    .single();

  const newTotalLots = lots.length;
  const newTopPicks = lots.filter(l => l.score >= 3).length;
  const newTitleSplits = lots.filter(l => l.titleSplit).length;
  const catalogueChanged = !prevCached
    || prevCached.total_lots !== newTotalLots
    || prevCached.top_picks !== newTopPicks
    || prevCached.title_splits !== newTitleSplits;

  await supabase.from('cached_analyses').upsert({
    url: normalisedUrl,
    house,
    total_lots: newTotalLots,
    title_splits: newTitleSplits,
    top_picks: newTopPicks,
    under_100k: lotsWithPrice.filter(l => l.price < 100000).length,
    avg_yield: yieldsArr.length ? +(yieldsArr.reduce((a, b) => a + b, 0) / yieldsArr.length).toFixed(1) : null,
    dev_potential: lots.filter(l => (l.opps || []).some(o => /development|planning|conversion/i.test(o))).length,
    vacant_count: lots.filter(l => l.vacant === true).length,
    lots,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    content_hash: autoAnalyseOne._lastContentHash || null,
    last_scraped_at: new Date().toISOString(),
  }, { onConflict: 'url' });

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
}

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
  // Try Supabase first
  try {
    const { data, error } = await supabase
      .from('auction_calendar')
      .select('house, url, catalogue_ready')
      .eq('catalogue_ready', true);

    if (!error && data && data.length > 0) {
      return data.map(row => ({
        house: row.house,
        url: row.url,
        catalogueReady: row.catalogue_ready,
      }));
    }
  } catch (e) {
    console.warn('Calendar DB read failed in getCalendarAuctions, using fallback:', e.message);
  }

  // Fallback to hardcoded
  return FALLBACK_CALENDAR.filter(a => a.catalogueReady).map(a => ({
    house: a.house,
    url: a.url,
    catalogueReady: a.catalogueReady,
  }));
}
