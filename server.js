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
const RATE_LIMIT = 5;
const CACHE_DAYS = 7; // fallback default
const CACHE_TIERS = {
  high:   { houses: ['allsop','savills','sdl','network','bidx1'], ttlHours: 12 },
  medium: { houses: ['cliveemson','edwardmellor','bondwolfe','strettons','countrywide','tcpa','futureauctions','firstforauctions','harmanhealy','astleys','henrysykes','clarkesimpson','durrants','dawsons','goldings','auctionhousescotland','austingray'], ttlHours: 18 },
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
const MAX_LOTS_PER_SCRAPE = 100;
const MAX_AUCTIONS_PER_HOUSE = 2;
const TIMEOUT = 25000;
// Houses where catalogue pages are JS-rendered — need Puppeteer for image backfill
// All houses get rendered image backfill — every DOM extractor has image selectors.
// Previously limited to 14 houses, leaving ~24 houses with no backfill.
// Populated after HOUSE_ROOTS is defined (see below).
let PUPPETEER_IMAGE_HOUSES = null;

// ═══════════════════════════════════════════════════════════════
// GEMINI MODEL SELECTION — Flash-Lite for known houses, Pro for unknown/PDF
// ═══════════════════════════════════════════════════════════════
const MODEL_PRO   = 'gemini-2.5-pro';
const MODEL_FLASH = 'gemini-2.5-flash-lite';

// ── Gemini client & rate limiter (free tier: 15 RPM) ──
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
let geminiLastCall = 0;
async function geminiRateLimited(fn) {
  const now = Date.now();
  const earliest = geminiLastCall + 4100;
  const wait = Math.max(0, earliest - now);
  geminiLastCall = now + wait; // claim this slot immediately to prevent concurrent overlap
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  return fn();
}

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

async function scrapeWithFirecrawl(url, options = {}) {
  if (!FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY not set');
  if (fcCreditExhausted) throw new Error('Firecrawl credits exhausted');
  if (fcTemporarilyDown && Date.now() - fcDownAt < 600000) throw new Error('Firecrawl temporarily down');

  const formats = options.formats || ['rawHtml'];
  const body = {
    url,
    formats,
  };
  if (options.waitFor) body.waitFor = options.waitFor;
  if (options.actions) body.actions = options.actions;

  const doFetch = async () => {
    const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
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
        throw retryErr;
      }
    }
    fcErrorCount++;
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

function extractWithJSDOM(html, house, baseUrl, firecrawlImages) {
  const dom = new JSDOM(html, { url: baseUrl });
  const { document } = dom.window;

  let lots = null;

  // Try house-specific extractor first
  const extractor = DOM_EXTRACTORS[house];
  if (extractor) {
    try {
      const fn = new Function('document', `return ${extractor}`);
      const result = fn(document);
      if (Array.isArray(result) && result.length > 0) {
        console.log(`JSDOM extractor for ${house}: found ${result.length} lots`);
        lots = result;
        _lastExtractorUsed = 'dom';
      }
    } catch (err) {
      log.warn('JSDOM extractor error', { house, error: err.message });
    }
  }

  // Fall back to universal extractor
  if (!lots) {
    try {
      const fn = new Function('document', `return ${UNIVERSAL_DOM_EXTRACTOR}`);
      const result = fn(document);
      if (Array.isArray(result) && result.length > 0) {
        console.log(`JSDOM universal extractor for ${house}: found ${result.length} lots`);
        lots = result;
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
      const skipFc = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|favicon|banner|advert/i;
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
  const imgBlocklist = /logo|icon|placeholder|no-image|default|blank|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|noimage|favicon|banner|advert|sponsor|newsletter|widget|thumb_generic|modal\.png|_NYC\.|_LCC\.|_BMDC\.|Unit[ie]*d?_?Utilit|Cardwells|themes\/.*assets\/images\/|download_\(\d+\)\.|watchLIVEauction|property-top-image|auc2-logo/i;
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
  const imgRecoverSkip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|favicon|banner|btn|gallery-left|gallery-right/i;
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

  dom.window.close();
  return lots;
}

// Track which scraping engine and extractor were last used (for cache metadata)
let _lastScrapeEngine = 'http';
let _lastExtractorUsed = 'dom';

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
          formats: ['rawHtml', 'images'],
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
        await new Promise(r => setTimeout(r, 3000));
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
  const pages = [{ page: 1, html: result.html }];

  // Detect total pages from first page HTML
  const totalPages = detectTotalPages(result.html, url, house);
  if (totalPages > 1) {
    const pageCap = Math.min(totalPages, MAX_PUPPETEER_PAGES);
    console.log(`Firecrawl multi-page: ${house} has ${totalPages} pages, loading up to ${pageCap}`);
    for (let p = 2; p <= pageCap; p++) {
      if (fcCreditExhausted) { console.log(`Firecrawl: credits exhausted at page ${p}, stopping`); break; }
      const pageUrl = buildPageUrl(url, p, house);
      try {
        const pageResult = await scrapeRenderedPage(pageUrl, house);
        if (pageResult.html && pageResult.html.length > 500) {
          pages.push({ page: p, html: pageResult.html });
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
    const skip = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|loading|cookie|emoji/i;
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
    const skipFc = /logo|icon|arrow|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|favicon|banner|advert/i;
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
    dom.window.close();
    console.log(`Firecrawl image backfill for ${house}: ${updated}/${lots.length} lots got images`);
    return updated;
  } catch (err) {
    log.warn('Firecrawl image backfill error', { house, catalogueUrl, error: err.message });
    return 0;
  }
}

async function callGemini(prompt, { model = MODEL_FLASH, maxTokens = 8000, systemPrompt = null, pdfBase64 = null } = {}) {
  const config = { maxOutputTokens: maxTokens };
  const modelOpts = { model };
  if (systemPrompt) modelOpts.systemInstruction = systemPrompt;
  const m = genAI.getGenerativeModel(modelOpts);
  const parts = [];
  if (pdfBase64) {
    parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfBase64 } });
  }
  parts.push({ text: prompt });

  let result;
  try {
    result = await geminiRateLimited(() =>
      m.generateContent({
        contents: [{ role: 'user', parts }],
        generationConfig: config,
      })
    );
  } catch (err) {
    const msg = err?.message || String(err);
    if (/429|quota|rate/i.test(msg)) {
      creditExhausted = true; creditExhaustedAt = Date.now();
      log.warn('Gemini quota exhausted', { model, error: msg });
    }
    throw new Error(`Gemini API error (${model}): ${msg}`);
  }
  if (!result || !result.response) {
    throw new Error(`Gemini returned empty response (${model})`);
  }
  return result.response.text();
}

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
};

function getExtractionModel(house) {
  return house === 'unknown' ? MODEL_PRO : MODEL_FLASH;
}

// ═══════════════════════════════════════════════════════════════
// HOUSE ROOTS — catalogue discovery URLs
// ═══════════════════════════════════════════════════════════════
// Each house's root/listing page where upcoming auction catalogue links can be found.
// Used by /api/discover-catalogues to auto-detect new auction URLs when they change.
const HOUSE_ROOTS = {
  savills:            'https://auctions.savills.co.uk/upcoming-auctions',
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
  barnettross:        'https://www.barnettross.co.uk/lotlist.php?a=&countryid=1',
  bradleyhall:        'https://auction.bradleyhall.co.uk/',
  connectuk:          'https://connectukgroup.co.uk/auctions/',
  auctionestates:     'https://www.auctionestates.co.uk/',
  landwood:           'https://www.landwoodpropertyauctions.com/',
  loveitts:           'https://www.loveitts.co.uk/auction/',
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
  cheffins:           'https://www.cheffins.co.uk/property-auctions.htm',
  fssproperty:        'https://www.fssproperty.co.uk/search-auction/',
  iamsold:            'https://www.iamsold.co.uk/available-properties/',
};

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
// Clean up stale buckets every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 600000;
  for (const [k, v] of _rlBuckets) { if (v.start < cutoff) _rlBuckets.delete(k); }
}, 300000);

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
      .select('id, email, name, tier, analyses_count, tier_expires_at, stripe_subscription_id, consent_auction_alerts, consent_partner_marketing')
      .eq('id', user.id)
      .single();
    const safe = data || user;
    // Don't expose internal Stripe IDs to the client
    const { stripe_subscription_id, stripe_customer_id, ...publicFields } = safe;
    res.json({ ...publicFields, hasSubscription: !!stripe_subscription_id });
  } catch (err) {
    const { stripe_subscription_id, stripe_customer_id, ...publicFields } = user;
    res.json({ ...publicFields, hasSubscription: !!stripe_subscription_id });
  }
});

// ═══════════════════════════════════════════════════════════════
// STRIPE: Checkout, Webhook, Portal, Status
// ═══════════════════════════════════════════════════════════════

// POST /api/stripe/checkout — create Stripe Checkout session
app.post('/api/stripe/checkout', rateLimit(60000, 5), async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });
  const user = await validateUserFromReq(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { product } = req.body || {};
  if (product !== 'monthly') {
    return res.status(400).json({ error: 'Invalid product. Use "monthly".' });
  }
  if (user.stripe_subscription_id) {
    return res.status(400).json({ error: 'You already have an active subscription. Use the billing portal to manage it.' });
  }

  const priceId = process.env.STRIPE_MONTHLY_PRICE_ID;
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
      success_url: `${ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : 'https://auctions.bridgematch.co.uk'}/?payment=success`,
      cancel_url: `${ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : 'https://auctions.bridgematch.co.uk'}/?payment=cancelled`,
      metadata: { user_id: user.id, product },
      ...(product === 'monthly' && { subscription_data: { metadata: { user_id: user.id, product } } }),
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
          // Keep stripe_subscription_id so recovery events can find the user
          await supabase.from('users').update({ tier: 'free', tier_expires_at: null }).eq('id', subUser.id);
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
                from: 'BridgeMatch <hello@bridgematch.co.uk>',
                to: [failedUser.email],
                subject: 'Payment failed — your BridgeMatch Pro subscription',
                html: `<p>Hi ${escHtml((failedUser.name || '').split(' ')[0] || 'there')},</p><p>We couldn't process your latest payment for BridgeMatch Pro. Please update your payment method to keep your subscription active.</p><p><a href="https://auctions.bridgematch.co.uk/?manage=billing">Update payment method</a></p><p>— The BridgeMatch team</p>`,
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
          from: 'BridgeMatch <hello@bridgematch.co.uk>',
          to: ['hello@bridgematch.co.uk'],
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
// WELCOME EMAIL (via Resend)
// ═══════════════════════════════════════════════════════════════
async function sendWelcomeEmail(email, name) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  const firstName = escHtml((name || '').split(' ')[0] || 'there');
  const html = `
    <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1714">
      <div style="background:linear-gradient(135deg,#1a3a5c,#2a5a8c);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center">
        <span style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#fff">Auction <span style="color:#8bc34a">Brain</span></span>
      </div>
      <div style="background:#ffffff;padding:32px 24px;border:1px solid #e4dfd6;border-top:none;border-radius:0 0 12px 12px">
        <h1 style="font-size:20px;margin:0 0 16px;color:#1a2332">Welcome, ${firstName}!</h1>
        <p style="line-height:1.7;color:#5c564d;margin:0 0 16px">You're in — and you've got <strong>14 days of Pro access</strong> on us. Here's what you can do:</p>
        <ul style="line-height:1.8;color:#5c564d;margin:0 0 20px;padding-left:20px">
          <li><strong>Unlimited AI searches</strong> — natural language search across every catalogue</li>
          <li><strong>Browse 2,000+ auction lots</strong> — every major UK auction house in one place</li>
          <li><strong>AI investment scores</strong> — opportunity/risk flags on every lot</li>
          <li><strong>BridgeMatch finance check</strong> — see which of 60+ bridging lenders would fund any lot</li>
        </ul>
        <p style="line-height:1.7;color:#5c564d;margin:0 0 20px">After your trial, you'll still get 10 free AI searches per day. Upgrade to Pro (£9.99/month) for unlimited.</p>
        <div style="text-align:center;margin:24px 0">
          <a href="https://auctions.bridgematch.co.uk/" style="display:inline-block;background:#2e7d32;color:#fff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;text-decoration:none">Browse Auction Deals →</a>
        </div>
        <p style="font-size:13px;color:#8a847a;margin:20px 0 0;text-align:center">Questions? Just reply to this email.</p>
      </div>
    </div>
  `;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Auction Brain <hello@bridgematch.co.uk>',
        to: [email],
        subject: `Welcome to Auction Brain — your unfair advantage at auction`,
        html,
      }),
    });
    log.info('Welcome email sent', { email });
  } catch (e) {
    log.warn('Welcome email failed', { email, error: e.message });
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

      // Auto-create new user with 14-day Pro trial
      const trialStart = new Date();
      const trialEnd = new Date(trialStart.getTime() + 14 * 24 * 60 * 60 * 1000);
      const { data: newUser, error: insertErr } = await supabase
        .from('users')
        .insert({
          email: (email || '').toLowerCase().trim(),
          supabase_auth_id: authId,
          tier: 'premium',
          tier_expires_at: trialEnd.toISOString(),
          trial_started_at: trialStart.toISOString(),
          trial_expires_at: trialEnd.toISOString(),
          trial_used: true,
        })
        .select('id, email, name, tier, analyses_count, stripe_customer_id, tier_expires_at, stripe_subscription_id, trial_started_at, trial_expires_at, trial_used, ai_searches_today, ai_searches_date')
        .single();
      if (!insertErr && newUser) {
        sendWelcomeEmail(newUser.email, newUser.name).catch(() => {});
        return newUser;
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

// ── AI Search tier limits ──
const ANON_AI_SEARCH_LIMIT = 3;   // Anonymous users: 3 AI searches/day by IP
const FREE_AI_SEARCH_LIMIT = 10;  // Free registered users: 10 AI searches/day

function getAISearchLimit(user) {
  if (!user) return ANON_AI_SEARCH_LIMIT;
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
      date: '2026-02-24', dateEnd: '2026-02-25',
      title: '24 & 25 February 2026', lots: null,
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
      url: 'https://www.hollismorgan.co.uk/search-auction/?bid=11&orderby=lot_no+asc',
      location: 'Online (Live Stream from Clifton, Bristol)', type: 'Residential & Commercial', status: 'upcoming',
      catalogueReady: true,
    },
    {
      house: 'Hollis Morgan', houseSlug: 'hollismorgan', logo: '🏘️',
      date: '2026-04-01', title: 'April 2026', lots: null,
      url: 'https://www.hollismorgan.co.uk/search-auction/',
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
      date: '2026-03-10', title: '10 March 2026 (National Online)', lots: null,
      url: 'https://www.auctionhouse.co.uk/online/auction/2026/3/10',
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

    // ── PAUL FOSH ──
    {
      house: 'Paul Fosh', houseSlug: 'paulfosh', logo: '🏴',
      date: '2026-03-12', title: 'March 2026 Online Auction', lots: null,
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
      date: '2026-04-22', title: '22 April 2026', lots: null,
      url: 'https://www.cottons.co.uk/current-auction.htm',
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
      url: 'https://www.landwoodpropertyauctions.com/current-auction',
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

    // ── HUNTERS ──
    {
      house: 'Hunters', houseSlug: 'hunters', logo: '🏠',
      date: '2026-03-15', title: 'Online Auction', lots: null,
      url: 'https://hunters.bambooauctions.com',
      location: 'National', type: 'Residential', status: 'upcoming',
      catalogueReady: true,
    },

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
      date: '2026-03-25', title: 'March 2026 — Suffolk', lots: null,
      url: 'https://clarke-simpson.eigonlineauctions.com/search',
      location: 'Suffolk', type: 'Residential & Land', status: 'upcoming',
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
        const key = `${(row.house || '').toLowerCase()}|${row.date}|${(row.url || '').trim().replace(/\/+$/, '').toLowerCase()}`;
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
      const key = `${(row.house || '').toLowerCase()}|${row.date}|${(row.url || '').trim().replace(/\/+$/, '').toLowerCase()}`;
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

      const aiText = await callGemini(`You are analysing an auction house's listing page to find links to upcoming/current auction catalogues.

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
If no catalogues found, return {"catalogues": []}`, { maxTokens: 2000 });

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

  // ── Tier info (blurring removed — all data visible) ──
  const userTier = user.tier || 'free';
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
    const isPremiumOrTrial = userTier === 'premium' || userTier === 'trial';
    const gatedLots = isPremiumOrTrial ? cached.lots : stripAIFields(cached.lots || []);
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
      lots: gatedLots,
      cached: true,
      blurred: !isPremiumOrTrial,
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
      // Allsop API: paginate through JSON endpoint
      pages = await scrapeAllsopApi(rewritten.baseUrl);
      sseWrite(res, 'scrape', { pages: pages.length });
      if (pages.length > 0) {
        sseWrite(res, 'phase', { step: 'extracting' });
        rawLots = await extractLotsWithAI(pages, house, onExtract, scrapeUrl);
        enrichAllsopLots(rawLots, pages);
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

        } else {
          // ── Generic extraction with auto-pagination ──
          console.log(`Loading ${scrapeUrl} for ${house}`);
          const firstResult = await scrapeRenderedPage(scrapeUrl, house);

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
            _lastExtractorUsed = 'dom';
            console.log(`${house} total: ${rawLots.length} lots via DOM extraction (no Claude needed)`);
          } else {
            // Fall back to Claude extraction
            if (domLots && domLots.length > 0) {
              console.log(`DOM extractor found only ${domLots.length} lots for ${house} (below threshold of 3), falling back to Claude`);
            }
            console.log(`Got ${firstResult.html.length} chars, sending to Claude...`);
            const renderedPages = [{ page: 1, html: firstResult.html }];
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
              const renderedPages = [{ page: 1, html: rendered.html }];
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
      scraped_with: _lastScrapeEngine,
    extracted_with: _lastExtractorUsed,
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

    const isPremiumOrTrial = userTier === 'premium' || userTier === 'trial';
    const gatedAnalysed = isPremiumOrTrial ? analysed : stripAIFields(analysed);
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
      lots: gatedAnalysed,
      cached: false,
      blurred: !isPremiumOrTrial,
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

function isPresetQuery(query) {
  return PRESET_QUERIES[query] || null;
}

// ═══════════════════════════════════════════════════════════════
// SMART SEARCH: Claude-powered filtering across cached analyses
// ═══════════════════════════════════════════════════════════════
app.post('/api/smart-search', async (req, res) => {
  const { query, soldFilter } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Missing search query' });

  // Allow anonymous users (user = null)
  const user = await validateUserFromReq(req);

  // ── Tier-aware AI search rate limiting (check only — increment on success) ──
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
      const isPremiumCached = user && (user.tier === 'premium' || user.tier === 'trial');
      const cachedResults = isPremiumCached ? (presetCache.results || []) : stripAIFields(presetCache.results || []);
      await incrementSearchCounter();
      return res.json({
        results: cachedResults,
        report: presetCache.report || '',
        sources: presetCache.sources || [],
        totalSearched: presetCache.total_searched || 0,
        cached: true,
        searchesUsed, searchLimit,
      });
    }

    if (presetCache && presetCache.stale_urls && presetCache.stale_urls.length > 0) {
      // Partially stale — only re-search the changed catalogues and merge
      if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'API key not configured' });

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
          const isPremiumClean1 = user && (user.tier === 'premium' || user.tier === 'trial');
          const gatedClean1 = isPremiumClean1 ? cleanResults : stripAIFields(cleanResults);
          await incrementSearchCounter();
          return res.json({ results: gatedClean1, report: presetCache.report || '', sources: cleanSources, totalSearched: cleanResults.length, cached: true, searchesUsed, searchLimit });
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
          const isPremiumClean2 = user && (user.tier === 'premium' || user.tier === 'trial');
          const gatedClean2 = isPremiumClean2 ? cleanResults : stripAIFields(cleanResults);
          await incrementSearchCounter();
          return res.json({ results: gatedClean2, report: presetCache.report || '', sources: cleanSources, totalSearched: cleanResults.length, cached: true, searchesUsed, searchLimit });
        }

        // Run Gemini on the delta lots
        if (creditExhausted) {
          const exhaustedAgo = creditExhaustedAt ? Math.round((Date.now() - creditExhaustedAt) / 60000) : '?';
          log.warn('Incremental smart search skipped — Gemini quota exhausted', { exhaustedMinutesAgo: exhaustedAgo });
          throw new Error('quota_exhausted'); // fall through to return stale cache
        }
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

        const responseText = await callGemini(`You are a UK property investment analyst. A user has searched across ${filteredDelta.length} NEW auction lots from ${deltaSources.length} recently updated catalogues.

Their search query: "${query}"

Here are ${included} lots from the updated catalogues, sorted by relevance:

${lotSummaries}

TASK:
1. Identify the lots that best match the user's query. Return the indices of matching lots.
2. Write a one-line summary of what changed (e.g. "3 new heavy refurb properties found in Savills catalogue").

Respond in this exact JSON format:
{"indices":[0,5,12],"summary":"Brief change summary"}

Only return lots that genuinely match the query.`, { maxTokens: 4000 });
        log.info('smart_search_incremental', { model: MODEL_FLASH });
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

        const isPremiumMerged = user && (user.tier === 'premium' || user.tier === 'trial');
        const gatedMerged = isPremiumMerged ? mergedResults : stripAIFields(mergedResults);
        await incrementSearchCounter();
        return res.json({
          results: gatedMerged,
          report: mergedReport,
          sources: mergedSources,
          totalSearched: (presetCache.total_searched || 0) + filteredDelta.length,
          cached: true,
          searchesUsed, searchLimit,
        });
      } catch (err) {
        log.warn('Incremental preset refresh failed, falling through to full search', { error: err.message });
        // Fall through to full search below
      }
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    log.warn('smart-search: GEMINI_API_KEY not set');
    return res.status(500).json({ error: 'key_missing', message: 'AI search is not configured — GEMINI_API_KEY is missing.' });
  }
  if (creditExhausted) {
    const exhaustedAgo = creditExhaustedAt ? Math.round((Date.now() - creditExhaustedAt) / 60000) : '?';
    log.warn('smart-search: blocked by creditExhausted flag', { exhaustedMinutesAgo: exhaustedAgo });
    return res.status(503).json({ error: 'ai_quota_exhausted', message: `Gemini API daily quota hit ${exhaustedAgo}min ago. Auto-resets after 1 hour. Try again soon.`, exhaustedMinutesAgo: exhaustedAgo });
  }
  // Pre-flight: log which key/model will be used
  const keyPrefix = (process.env.GEMINI_API_KEY || '').substring(0, 10);
  log.info('smart-search pre-flight', { model: MODEL_FLASH, keyPrefix: keyPrefix + '...', query: query.substring(0, 60) });

  try {
    // Get all cached analyses
    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('house, url, lots, total_lots')
      .gt('expires_at', new Date().toISOString());

    if (!cached || cached.length === 0) {
      await incrementSearchCounter();
      return res.json({ results: [], report: 'No cached auction data available. Please analyse some auction catalogues first.', sources: [], searchesUsed, searchLimit });
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
      await incrementSearchCounter();
      return res.json({ results: [], report: 'No lot data in cache. Please analyse auction catalogues first.', sources: [], searchesUsed, searchLimit });
    }

    // Apply sold filter before sending to Gemini
    const soldRe = /\bSOLD\b|\bSTC\b|\bSALE.?AGREED\b|\bWITHDRAWN\b/i;
    const filteredLots = soldFilter === 'available'
      ? allLots.filter(l => !(l.bullets || []).some(b => soldRe.test(b)))
      : soldFilter === 'sold'
      ? allLots.filter(l => (l.bullets || []).some(b => soldRe.test(b)))
      : allLots;

    // Build a compact lot summary for Gemini, prioritising query-relevant lots
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const lotEntries = filteredLots.map((l, i) => {
      const summary = `[${i}] ${l._house} L${l.lot}: ${l.address} | £${l.price || '?'} | Score:${l.score || 0} | ${l.titleSplit ? 'TITLE_SPLIT' : ''} | ${(l.bullets || []).join('; ').substring(0, 150)}`;
      const searchText = summary.toLowerCase();
      const relevance = queryTerms.filter(t => searchText.includes(t)).length;
      return { summary, relevance };
    });

    // Sort: query-relevant lots first, then by original order
    lotEntries.sort((a, b) => b.relevance - a.relevance);

    // Build context string with 120K char budget (fits within Gemini's context)
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

    const responseText = await callGemini(`You are a UK property investment analyst. A user has searched across ${filteredLots.length} auction lots from ${sources.length} auction house catalogues.${soldInstruction}

Their search query: "${query}"

Here are ${included} lots${omitted > 0 ? ` (${omitted} lower-relevance lots omitted for brevity)` : ''}, sorted by relevance to the query (index, house, lot number, address, price, score, title split status, key features):

${lotSummaries}

TASK:
1. Identify the lots that best match the user's query. Return the indices of matching lots.
2. Write a brief investment report (2-3 paragraphs) summarising what you found.

Respond in this exact JSON format:
{"indices":[0,5,12],"report":"Your report here..."}

Only return lots that genuinely match the query. If nothing matches well, say so in the report and return an empty indices array.`, { maxTokens: 4000 });
    log.info('smart_search_full', { model: MODEL_FLASH });
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

    // Gate data for free/anon users
    const isPremium = user && (user.tier === 'premium' || user.tier === 'trial');
    const gatedResults = isPremium ? matchingLots : stripAIFields(matchingLots);

    const response = {
      results: gatedResults,
      report: parsed.report || '',
      sources,
      totalSearched: filteredLots.length,
      searchesUsed, searchLimit,
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

    await incrementSearchCounter();
    return res.json(response);
  } catch (err) {
    const msg = err.message || String(err);
    log.error('Smart search error', { error: msg, status: err.status, stack: err.stack?.split('\n').slice(0, 3).join(' | ') });
    if (err.status === 429 || /quota|rate.limit|resource.exhausted/i.test(msg)) {
      creditExhausted = true; creditExhaustedAt = Date.now();
      return res.status(503).json({ error: 'ai_quota_exhausted', message: 'Gemini API daily quota hit. Auto-resets after 1 hour.', provider: 'gemini', model: MODEL_FLASH });
    }
    if (err.status === 401 || err.status === 403 || /invalid.api.key|unauthorized|forbidden/i.test(msg)) {
      return res.status(500).json({ error: 'key_invalid', message: 'Gemini API key is invalid or expired. Check GEMINI_API_KEY in Railway.', provider: 'gemini' });
    }
    return res.status(500).json({ error: 'api_error', message: 'Smart search failed — Gemini API error.', detail: msg, provider: 'gemini', model: MODEL_FLASH });
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
    if (!supabase) return res.json({ lots: [], sources: [] });

    const user = await validateUserFromReq(req);

    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('house, url, lots, created_at')
      .gt('expires_at', new Date().toISOString());

    if (!cached || cached.length === 0) return res.json({ lots: [], sources: [] });

    // ── Diagnostic: raw lot count before any filtering/dedup ──
    const rawTotal = (cached || []).reduce((s, c) => s + (Array.isArray(c.lots) ? c.lots.length : 0), 0);
    log.info('all-lots query', { cachedRows: cached.length, rawLotCount: rawTotal });

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
      sources.push({ house: c.house, url: c.url, count: dedupedLots.length, updatedAt: c.created_at });
    }

    // ── Attach _auctionDate from FALLBACK_CALENDAR URL→date map ──
    const urlDateMap = {};
    for (const a of FALLBACK_CALENDAR) {
      const nu = a.url.trim().replace(/\/+$/, '').toLowerCase();
      if (!urlDateMap[nu] || a.date < urlDateMap[nu]) urlDateMap[nu] = a.date;
    }
    for (const lot of lots) {
      const su = (lot._sourceUrl || '').trim().replace(/\/+$/, '').toLowerCase();
      lot._auctionDate = urlDateMap[su] || null;
    }

    // ── Phase 3: Cross-auction dedup by normalised address ──
    const crossAddrMap = new Map();
    for (const lot of lots) {
      const normAddr = (lot.address || '').toLowerCase().replace(/[\s,]+/g, ' ').replace(/^(lot\s*\d+\s*[-:]?\s*)/i, '').trim();
      if (normAddr.length <= 5) continue;
      const entry = crossAddrMap.get(normAddr);
      if (entry) {
        entry.count++;
        const entryDate = entry.lot._auctionDate || '9999-12-31';
        const lotDate = lot._auctionDate || '9999-12-31';
        if (lotDate < entryDate) entry.lot = lot;
      } else {
        crossAddrMap.set(normAddr, { lot, count: 1 });
      }
    }
    const keptLots = new Set();
    const dupAddrs = new Set();
    for (const [addr, entry] of crossAddrMap) {
      keptLots.add(entry.lot);
      if (entry.count > 1) dupAddrs.add(addr);
    }
    const beforeCross = lots.length;
    const finalLots = lots.filter(l => {
      const normAddr = (l.address || '').toLowerCase().replace(/[\s,]+/g, ' ').replace(/^(lot\s*\d+\s*[-:]?\s*)/i, '').trim();
      if (normAddr.length <= 5) { l._alsoInFutureAuctions = false; return true; }
      if (keptLots.has(l)) { l._alsoInFutureAuctions = dupAddrs.has(normAddr); return true; }
      return false;
    });
    const crossRemoved = beforeCross - finalLots.length;
    if (crossRemoved > 0) console.log(`Cross-auction dedup: removed ${crossRemoved} duplicate lots across auction dates`);

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
      afterWithinHouseDedup: lots.length,
      afterCrossAuctionDedup: finalLots.length,
      afterJunkRemoval: cleanLots.length,
      junkRemoved: junkLotRemoved,
      imgStripped
    });

    // Directory data is free to serve — no gating, no blurring
    res.json({
      lots: cleanLots,
      sources,
      blurred: false,
      _debug: {
        cachedRows: cached.length,
        rawLotCount: rawTotal,
        afterWithinHouseDedup: lots.length,
        afterCrossAuctionDedup: finalLots.length,
        afterJunkRemoval: cleanLots.length
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
      .select('house, url, total_lots, title_splits, top_picks, under_100k, avg_yield, dev_potential, vacant_count, created_at, expires_at, scraped_with, extracted_with, last_scraped_at')
      .order('house');

    const normaliseUrl = u => (u || '').trim().replace(/\/+$/, '').toLowerCase();

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
      missing: missing.map(a => ({ house: a.house, url: a.url, date: a.date })),
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
        await supabase.from('cached_analyses').update({ lots }).eq('url', entry.url);
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing: missingImages, gained, status: 'updated' });
      } else {
        results.push({ house: entry.house, url: entry.url, total: lots.length, missing: missingImages, gained: 0, status: 'no matches found' });
      }
    }

    const totalGained = results.reduce((s, r) => s + r.gained, 0);
    res.json({ message: `Backfill complete. ${totalGained} images added across ${cached.length} catalogues.`, results });
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
      .eq('house', HOUSE_DISPLAY_NAMES[house] || house)
      .select('url');
    const cleared = deleted ? deleted.length : 0;

    // 2. Find calendar URLs for this house to re-scrape
    const calendar = getAuctionCalendar();
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
  res.json({
    uptime: Math.round(process.uptime()),
    autoRunning: _autoAnalysisRunning,
    creditExhausted,
    fcKey: FIRECRAWL_API_KEY ? `set (${FIRECRAWL_API_KEY.length} chars)` : 'NOT SET',
    fcCreditsUsed,
    fcCreditExhausted,
    fcTemporarilyDown,
    fcFallbackCount,
    fcErrorCount,
    fcRequestCount,
    puppeteerAvailable: !!puppeteer,
    geminiKey: process.env.GEMINI_API_KEY ? 'set' : 'NOT SET',
    apiCallCount,
  });
});

// ═══════════════════════════════════════════════════════════════
// TENURE DIAGNOSTIC (temporary — remove after tenure coverage hits 90%+)
// ═══════════════════════════════════════════════════════════════
app.get('/api/diag/tenure', async (req, res) => {
  try {
    const { data: cached } = await supabase
      .from('cached_analyses')
      .select('house, lots')
      .gt('expires_at', new Date().toISOString());
    if (!cached) return res.json({ error: 'no data' });

    const counts = { freehold: 0, leasehold: 0, shareOfFreehold: 0, empty: 0, total: 0 };
    const byHouse = {};
    for (const c of cached) {
      if (!Array.isArray(c.lots)) continue;
      for (const l of c.lots) {
        counts.total++;
        const t = (l.tenure || '').trim().toLowerCase();
        if (t === 'freehold') counts.freehold++;
        else if (t === 'leasehold') counts.leasehold++;
        else if (t.includes('share')) counts.shareOfFreehold++;
        else counts.empty++;

        if (!t) {
          byHouse[c.house] = (byHouse[c.house] || 0) + 1;
        }
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
    const { data: cached } = await supabase.from('cached_analyses').select('house, lots, expires_at, created_at, content_hash');
    const now = new Date();
    const report = { houses: [], issues: [], summary: {} };
    let totalLots = 0, housesWithZero = 0, staleHouses = 0, totalDupes = 0;

    // Deduplicate by house — merge all cached URLs per house into one report entry
    const byHouse = {};
    for (const row of (cached || [])) {
      const h = row.house || 'unknown';
      if (!byHouse[h]) byHouse[h] = { lots: [], isStale: true, created_at: null };
      const lots = row.lots || [];
      byHouse[h].lots.push(...lots);
      const isStale = row.expires_at && new Date(row.expires_at) < now;
      if (!isStale) byHouse[h].isStale = false; // fresh if ANY URL is fresh
      if (!byHouse[h].created_at || (row.created_at && new Date(row.created_at) > new Date(byHouse[h].created_at))) {
        byHouse[h].created_at = row.created_at;
      }
    }

    for (const [house, data] of Object.entries(byHouse)) {
      const lots = data.lots;
      const isStale = data.isStale;
      const ageHours = data.created_at ? Math.round((now - new Date(data.created_at)) / 3600000) : null;
      const withImage = lots.filter(l => l.imageUrl).length;
      const imgCoverage = lots.length ? Math.round((withImage / lots.length) * 100) : 0;

      // Duplicate check
      const urls = new Set();
      let dupes = 0;
      for (const l of lots) {
        const key = l.url || l.address;
        if (key && urls.has(key)) dupes++;
        else if (key) urls.add(key);
      }

      totalLots += lots.length;
      totalDupes += dupes;
      if (lots.length === 0) housesWithZero++;
      if (isStale) staleHouses++;

      const entry = { house, lots: lots.length, images: withImage, imgCoverage, dupes, ageHours, stale: !!isStale };
      report.houses.push(entry);

      if (lots.length === 0) report.issues.push({ severity: 'critical', house, msg: 'Zero lots — extractor may be broken' });
      if (dupes > 0) report.issues.push({ severity: 'warn', house, msg: `${dupes} duplicate lots` });
      if (imgCoverage < 30 && lots.length > 0) report.issues.push({ severity: 'warn', house, msg: `Low image coverage: ${imgCoverage}%` });
      if (isStale) report.issues.push({ severity: 'info', house, msg: `Cache stale (${ageHours}h old)` });
    }

    report.summary = { totalHouses: Object.keys(byHouse).length, totalLots, housesWithZero, staleHouses, totalDupes };
    res.json(report);
  } catch (e) {
    log.error('Quality report error', { error: e.message });
    res.status(500).json({ error: 'Quality report failed. Check server logs.' });
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
    log.error('Failed to inject config into index.html', { error: e.message });
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
  if (u.includes('auctionhouse.co.uk/scotland')) return 'auctionhousescotland';
  if (u.includes('auctionhouse.co.uk/sussexandhampshire')) return 'austingray';
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
  if (u.includes('cheffins.co.uk') || u.includes('timedpropertyauctions.cheffins')) return 'cheffins';
  if (u.includes('fssproperty.co.uk')) return 'fssproperty';
  if (u.includes('iamsold.co.uk')) return 'iamsold';
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
  bradleyhall: 'Bradley Hall', connectuk: 'https://connectukgroup.co.uk/auctions/', auctionestates: 'Auction Estates',
  landwood: 'Landwood', loveitts: 'Loveitts', hunters: 'Hunters',
  probateauction: 'Probate Auction',
  countrywide: 'Countrywide / Sutton Kersh', venmore: 'Venmore Auctions',
  tcpa: 'Town & Country Property Auctions', futureauctions: 'Future Property Auctions',
  kivells: 'Kivells', firstforauctions: 'First For Auctions',
  suttonkersh: 'Sutton Kersh', harmanhealy: 'Harman Healy',
  seelauctions: 'Seel & Co', robinsonhall: 'Robinson & Hall',
  astleys: 'Astleys', henrysykes: 'Henry Sykes Auctions', clarkesimpson: 'Clarke & Simpson',
  durrants: 'Durrants', dawsons: 'Dawsons', goldings: 'Goldings',
  auctionhousescotland: 'Auction House Scotland', austingray: 'Auction House Sussex & Hampshire',
  agentsproperty: 'Agents Property Auction', andrewcraig: 'Andrew Craig',
  buttersjohnbee: 'Butters John Bee', brownco: 'Brown & Co',
  cheffins: 'Cheffins', fssproperty: 'Feather Smailes & Scales',
  iamsold: 'iamsold',
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

  // Hunters: Bamboo Auctions React SPA, needs Puppeteer
  if (house === 'hunters') {
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
  if (!puppeteer) throw new Error('Puppeteer not available');
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
  const allLots = [];
  const seenLots = new Set();
  const batchSize = 3;
  for (let i = 0; i < pages.length; i += batchSize) {
    if (creditExhausted) { console.log('Skipping remaining batches — API rate limited'); break; }
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
- tenure: string or null — one of "Freehold", "Leasehold", "Share of Freehold", or null. Look for: freehold, leasehold, share of freehold, flying freehold, long leasehold, years remaining/unexpired. If not explicitly stated, infer from context (e.g. "125 year lease" = Leasehold, ground rent mentioned = Leasehold). Only return null if there is genuinely no indication.
- bullets: array of strings (key features/description points - bedrooms, condition, sq ft, special circumstances etc)

Return ONLY a JSON array of lot objects, no other text. If a page has no lots, return an empty array.

Important:
- Extract the COMPLETE address including postcode
- Guide prices may be shown as "Guide Price £X" or "Guide £X" or just "£X"
- Tenure is a PRIORITY field — always look for it in the description, legal pack summary, and property details
- Bullet points include things like: property type, bedrooms, condition, sq ft, vacant/tenanted, executor sale, development potential, completion terms
- Include ALL lots, even commercial ones or land

${strippedBatch.map(p => `=== PAGE ${p.page} ===\n${p.content}`).join('\n\n')}

Return ONLY the JSON array:`;
    try {
      apiCallCount++;
      const text = await callGemini(prompt, { model, maxTokens: 16000 });
      log.info('gemini_extraction', { house, model, batch: Math.floor(i/batchSize)+1 });
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
- bullets: array of strings (key features/description points - bedrooms, condition, sq ft, special circumstances etc)

Return ONLY a JSON array of lot objects, no other text.

Important:
- Extract the COMPLETE address including postcode
- Guide prices may be shown as "Guide Price £X" or "Guide £X" or just "£X"
- Tenure is a PRIORITY field — always look for it in the description, legal pack summary, and property details
- Bullet points include things like: property type, bedrooms, condition, sq ft, vacant/tenanted, executor sale, development potential, completion terms
- Include ALL lots, even commercial ones or land
- Do NOT include terms & conditions, legal text, or non-lot pages

Return ONLY the JSON array:`;

  try {
    // PDFs use Pro model — complex layout extraction needs the stronger model
    const text = await callGemini(prompt, { model: MODEL_PRO, maxTokens: 32000, pdfBase64 });
    log.info('gemini_pdf_extraction', { model: MODEL_PRO });
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
        // Image from .auction-property-image or img
        let imageUrl = '';
        const imgEl = card.querySelector('.auction-property-image, img.auction-property-image');
        if (imgEl && imgEl.tagName === 'IMG') {
          imageUrl = imgEl.getAttribute('src') || '';
        } else if (imgEl) {
          const innerImg = imgEl.querySelector('img[src]');
          if (innerImg) imageUrl = innerImg.getAttribute('src') || '';
          if (!imageUrl) {
            const bg = imgEl.getAttribute('style') || '';
            const bgMatch = bg.match(/url\\(['"]?([^'"\\)]+)/);
            if (bgMatch) imageUrl = bgMatch[1];
          }
        }
        if (!imageUrl) {
          const anyImg = card.querySelector('img[src]');
          if (anyImg) {
            const s = anyImg.getAttribute('src') || '';
            if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
          }
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
        const imgJunk = /logo|icon|\\.svg|placeholder|modal\\.png|_NYC\\.|_LCC\\.|_BMDC\\.|council|utilit|cardwell|download_\\(|captcha/i;
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
        if (statusEl && statusEl.textContent.match(/sold|unsold|withdrawn/i)) bullets.push('SOLD/STC');
        lots.push({ lot: num, address, price, url, bullets, imageUrl: imageUrl || undefined });
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
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: num, address, price, url: href, bullets, imageUrl: imageUrl || undefined });
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
        let imageUrl = '';
        const img = card.querySelector('img[src]');
        if (img) {
          const s = img.getAttribute('src') || img.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
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
        let imageUrl = '';
        const img = card.querySelector('img[src]');
        if (img) {
          const s = img.getAttribute('src') || '';
          if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
        }
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
          let imageUrl = '';
          const cardImg = card.querySelector('img[src]');
          if (cardImg) {
            const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
          }
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
          let imageUrl = '';
          const cardImg = card.querySelector('img[src]');
          if (cardImg) {
            const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
          }
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
          let imageUrl = '';
          const elImg = el.querySelector('img[src]');
          if (elImg) {
            const s = elImg.getAttribute('src') || elImg.dataset.src || '';
            if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
          }
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
        const img = card.querySelector('img.list-image, img.grid-img, img.img-responsive, img[src*="eigpropertyauctions"]');
        if (img) {
          const s = img.getAttribute('src') || img.getAttribute('data-src') || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
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
        let imageUrl = '';
        const cardImg = card.querySelector('img[src]');
        if (cardImg) {
          const s = cardImg.getAttribute('src') || cardImg.dataset.src || '';
          if (s && !s.includes('logo') && !s.includes('icon') && !s.includes('.svg') && s.length > 10) imageUrl = s;
        }
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
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
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
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
        if (!address) continue;

        // Combine title and address if they differ
        let fullAddress = address;
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
        if (ribbon) bullets.push(ribbon.getAttribute('data-ribbon'));
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
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
        if (_ft.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
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
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
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
        let imageUrl = '';
        const img = card.querySelector('img[src*="eigpropertyauctions"], img[src*="cdn."]');
        if (img) imageUrl = img.getAttribute('src') || img.dataset.src || '';
        const bullets = [];
        const desc = card.querySelector('.property-strapline');
        if (desc) bullets.push(desc.textContent.trim().substring(0, 200));
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
          if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN|SALE AGREED/i))) bullets.push('SOLD/STC');
        }
        lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── EIG PLATFORM (reusable for any EIG-hosted house) ──
  eigplatform: `
    (() => {
      const lots = [];
      // Strategy 1: lot-panel cards (grid/list view)
      let cards = document.querySelectorAll('.lot-panel');
      if (cards.length === 0) cards = document.querySelectorAll('a[href*="/lot/details/"]');
      if (cards.length === 0) cards = document.querySelectorAll('[data-lot-item-toggle]');
      for (const card of cards) {
        const text = card.textContent || '';
        if (text.length < 10) continue;
        const lotMatch = text.match(/Lot\\s*(\\d+)/i);
        const num = lotMatch ? parseInt(lotMatch[1]) : lots.length + 1;
        const priceMatch = text.match(/(?:Guide Price|Opening Bid|Minimum Opening Bid)[^£]*£([\\d,]+)/i) || text.match(/£([\\d,]+)/);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
        // Address from known selectors (h3.list-address for list view, h4.grid-address for grid)
        let address = '';
        const addrEl = card.querySelector('h3.list-address, h4.grid-address, .lot-address, [data-address-searchable], h4, h3');
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
        if (ribbon) { const r = ribbon.getAttribute('data-ribbon'); if (r) bullets.push(r); }
        else if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: num, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
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
        const bullets = [];
        if (text.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
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
        if (soldFlag || text.match(/\\bSOLD\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) bullets.push('SOLD/STC');
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

  // ── DAWSONS (dawsonsproperty.co.uk) ──
  // Bootstrap layout with div.homes-content for each lot
  dawsons: `
    (() => {
      const lots = [];
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
        // Images are in sibling col or in modal carousel
        const parent = block.closest('.row') || block.parentElement;
        if (parent) {
          const img = parent.querySelector('img.d-block, img.img-fluid, img[src*="auction"]');
          if (img) imageUrl = img.getAttribute('src') || '';
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

  // ── Butters John Bee (Rex Software platform, buttersjohnbee.com) ──
  // Cards: <a href="/listings/{type}-{id}-{location}"> (entire card is a link)
  // Address: h4 inside card, Price: bold/strong with £, Image: img[alt="Listing image"]
  // Rooms: .listing__rooms .room, Pagination: ?page=N
  buttersjohnbee: `
    (() => {
      const lots = [];
      const seen = new Set();
      // Each card is an <a> tag linking to /listings/
      const links = document.querySelectorAll('a[href*="/listings/"]');
      let lotNum = 0;
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (!href.match(/\\/listings\\/\\w+_\\w+-/)) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        lotNum++;
        const text = link.textContent || '';
        // Address from h4 inside the card
        let address = '';
        const h4s = link.querySelectorAll('h4');
        for (const h of h4s) {
          const t = (h.textContent || '').trim();
          // Skip room count h4s (single digits like "3", "1", "2")
          if (t.length > 5 && !t.match(/^\\d+$/) && !t.match(/^Guide|^£/i)) {
            address = t;
            break;
          }
        }
        if (!address || address.length < 3) continue;
        // Price from bold/strong text
        let price = null;
        const strongs = link.querySelectorAll('strong, b');
        for (const s of strongs) {
          const pm = (s.textContent || '').match(/£([\\d,]+)/);
          if (pm) { price = parseInt(pm[1].replace(/,/g, '')); break; }
        }
        if (!price) {
          const pm = text.match(/(?:Guide\\s*Price\\s*)?£([\\d,]+)/i);
          if (pm) price = parseInt(pm[1].replace(/,/g, ''));
        }
        // Image
        let imageUrl = '';
        const img = link.querySelector('img');
        if (img) {
          const src = img.getAttribute('src') || '';
          if (src && !src.startsWith('data:')) imageUrl = src;
        }
        // Bullets from room stats
        const bullets = [];
        const rooms = link.querySelectorAll('.listing__rooms .room');
        for (const room of rooms) {
          const rt = (room.textContent || '').trim();
          if (rt.match(/\\d+.*bed/i)) bullets.push(rt);
          else if (rt.match(/\\d+.*bath/i)) bullets.push(rt);
          else if (rt.match(/sq\\s*ft/i)) bullets.push(rt);
        }
        if (!bullets.length) {
          const bedMatch = text.match(/(\\d+)\\s*Bed/i);
          if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        }
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url: href, bullets, imageUrl: imageUrl || undefined });
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

  // ── iamsold (JS-rendered React app, needs Puppeteer) ──
  iamsold: `
    (() => {
      const lots = [];
      const seen = new Set();
      // iamsold renders property cards with links to /property/{slug}
      const links = document.querySelectorAll('a[href*="/property/"]');
      const cardMap = new Map();
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (!href.match(/\\/property\\/.+/)) continue;
        if (cardMap.has(href)) continue;
        let card = link;
        for (let i = 0; i < 8; i++) { if (card.parentElement) card = card.parentElement; }
        cardMap.set(href, card);
      }
      let lotNum = 0;
      for (const [href, card] of cardMap) {
        lotNum++;
        const text = card.textContent || '';
        let address = '';
        const headings = card.querySelectorAll('h2, h3, h4, p');
        for (const h of headings) {
          const t = (h.textContent || '').trim();
          // Address usually contains a postcode or comma-separated location
          if (t.length > 10 && (t.match(/[A-Z]{1,2}\\d/) || t.includes(','))) { address = t; break; }
        }
        if (!address) {
          // Try slug from URL
          const slug = href.split('/property/')[1]?.replace(/\\/$/, '').replace(/-/g, ' ');
          if (slug && slug.length > 5) address = slug.replace(/\\b\\w/g, c => c.toUpperCase());
        }
        if (!address || address.length < 5) continue;
        let price = null;
        const priceMatch = text.match(/(?:Starting\\s*Bid|Guide\\s*Price)?\\s*£([\\d,]+)/i);
        if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
        let imageUrl = '';
        const img = card.querySelector('img[src*="http"]');
        if (img) {
          const src = img.getAttribute('src') || '';
          if (!src.match(/logo|icon|placeholder|avatar/i)) imageUrl = src;
        }
        const bullets = [];
        const bedMatch = text.match(/(\\d+)\\s*bed/i);
        if (bedMatch) bullets.push(bedMatch[1] + ' bedrooms');
        const typeMatch = text.match(/\\b(Detached|Semi|Terrace|Flat|Bungalow|House|Cottage|Land|Commercial)\\b/i);
        if (typeMatch) bullets.push(typeMatch[0]);
        if (seen.has(address)) continue;
        seen.add(address);
        lots.push({ lot: lotNum, address: address.substring(0, 200), price, url: href, bullets, imageUrl: imageUrl || undefined });
      }
      return lots;
    })()
  `,

};

// Wire up EIG house aliases to the shared eigplatform extractor
for (const slug of ['astleys', 'henrysykes', 'clarkesimpson', 'brownco']) {
  DOM_EXTRACTORS[slug] = DOM_EXTRACTORS.eigplatform;
}
// Wire up Auction House UK branches to the shared auctionhouseuk extractor
for (const slug of ['auctionhousescotland', 'austingray']) {
  DOM_EXTRACTORS[slug] = DOM_EXTRACTORS.auctionhouseuk;
}

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

// Deep image backfill — fetch individual lot pages for lots still missing images
// Used when catalogue page has junk/placeholder images that get stripped
async function backfillImagesFromLotPages(lots, concurrency = 5) {
  const missing = lots.filter(l => l.url && !l.imageUrl && /^https?:\/\//i.test(l.url));
  if (missing.length === 0) return 0;

  const junk = /logo|icon|\.svg|placeholder|no-image|modal\.png|_NYC\.|_LCC\.|_BMDC\.|council|utilit|cardwell|badge|spacer|pixel|facebook|twitter|1x1/i;

  let filled = 0;
  // Process in batches to limit concurrency
  for (let i = 0; i < missing.length; i += concurrency) {
    const batch = missing.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(async (lot) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const resp = await fetch(lot.url, { headers: HEADERS, signal: controller.signal, redirect: 'follow' });
        clearTimeout(timeout);
        if (!resp.ok) return null;
        const html = await resp.text();
        // Find first non-junk property image (new regex per call to avoid shared lastIndex)
        const imgRe = /<img[^>]+(?:src|data-src|data-lazy-src)="([^"]+)"/gi;
        let m;
        while ((m = imgRe.exec(html)) !== null) {
          const src = m[1];
          if (src && src.length > 20 && !src.startsWith('data:') && !junk.test(src)) {
            // Resolve relative URL
            let imgUrl = src;
            if (!/^https?:\/\//i.test(imgUrl)) {
              try { imgUrl = new URL(imgUrl, resp.url || lot.url).href; } catch { continue; }
            }
            lot.imageUrl = imgUrl;
            filled++;
            return imgUrl;
          }
        }
        return null;
      } catch { return null; }
    }));
  }
  if (filled > 0) console.log(`Deep image backfill (lot pages): ${filled}/${missing.length} lots got images`);
  return filled;
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
  const imgBlocklist = /logo|icon|placeholder|no-image|default|blank|spacer|pixel|\.svg|facebook|twitter|linkedin|badge|spinner|cookie|emoji|1x1|noimage|favicon|banner|advert|sponsor|newsletter|widget|thumb_generic|modal\.png|_NYC\.|_LCC\.|_BMDC\.|Unit[ie]*d?_?Utilit|Cardwells|themes\/.*assets\/images\/|download_\(\d+\)\.|watchLIVEauction|property-top-image|auc2-logo/i;
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
  const sb = []; // scoreBreakdown: tracks each signal's contribution
  if (L.condition === 'needs work') { s += 2; sb.push({ signal: 'Needs modernisation', pts: 2 }); L.opps.push('Needs modernisation'); }
  if (L.condition === 'poor') { s += 2.5; sb.push({ signal: 'Poor condition', pts: 2.5 }); L.opps.push('Poor condition'); }
  if (executor) { s += 1.5; sb.push({ signal: 'Executor/probate', pts: 1.5 }); L.opps.push('Executor/probate'); }
  if (receivership) { s += 2; sb.push({ signal: 'Receivership', pts: 2 }); L.opps.push('Receivership'); }
  if (devP) { s += 2; sb.push({ signal: 'Development potential', pts: 2 }); L.opps.push('Development potential'); }
  if (extP) { s += 1.5; sb.push({ signal: 'Extension/HMO potential', pts: 1.5 }); L.opps.push('Extension/HMO potential'); }
  if (L.vacant && ['house', 'bungalow', 'flat', 'land'].includes(L.propType)) { s += 1; sb.push({ signal: 'Vacant', pts: 1 }); L.opps.push('Vacant'); }
  if (L.tenure === 'Freehold' && ['house', 'bungalow'].includes(L.propType)) { s += 0.5; sb.push({ signal: 'Freehold', pts: 0.5 }); L.opps.push('Freehold'); }
  if (L.sqft && L.price) {
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
      const base = rents[Math.min(Math.max(beds ?? 2, 0), 4)];
      const uplift = RENT_UPLIFT[key] || RENT_UPLIFT._default;
      return Math.round(base * uplift);
    }
  }
  const base = VOA_RENTS._default[Math.min(Math.max(beds ?? 2, 0), 4)];
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
        lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
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
        lot.score += 2.5;
        lot.opps.push(`Est. ${lot.estGrossYield}% yield`);
      } else if (lot.estGrossYield > 6 && !lot.opps.some(o => o.includes('GIY'))) {
        lot.score += 1.5;
        lot.opps.push(`Est. ${lot.estGrossYield}% yield`);
      }
      lot.score = Math.max(0, Math.min(10, Math.round(lot.score * 10) / 10));
    }
  }

  // Re-sort by score after enrichment
  lots.sort((a, b) => b.score - a.score);
  console.log(`Enrichment complete. ${Object.values(lrCache).flat().length} total Land Registry sales found.`);
  return lots;
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

// Sentry error handler — must be after all routes, before app.listen
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.listen(PORT, () => {
  log.info('server_start', { port: PORT });
  if (!process.env.SUPABASE_URL) log.warn('missing_env', { var: 'SUPABASE_URL' });
  if (!process.env.SUPABASE_SERVICE_KEY) log.warn('missing_env', { var: 'SUPABASE_SERVICE_KEY' });
  if (!process.env.GEMINI_API_KEY) log.warn('missing_env', { var: 'GEMINI_API_KEY' });

  // ── Sync calendar + fix stale house names on startup ──
  setTimeout(() => syncCalendarAndHouseNames(), 5000);

  // ── Auto-analyse all catalogue-ready auctions ──
  // Run 30s after startup (let everything initialise), then every 6 hours
  setTimeout(() => autoAnalyseAll(), 30000);
  setInterval(() => autoAnalyseAll(), 6 * 60 * 60 * 1000);

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

async function autoAnalyseAll() {
  if (creditExhausted) {
    console.log('AUTO: Skipping — Gemini API rate limited');
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
    const normalise = u => (u || '').trim().replace(/\/+$/, '').toLowerCase();

    // Get URLs from past calendar entries
    const { data: pastCalendar } = await supabase
      .from('auction_calendar')
      .select('url')
      .lt('date', today);

    // Get URLs from upcoming calendar entries (to protect from purge)
    const { data: upcomingCalendar } = await supabase
      .from('auction_calendar')
      .select('url')
      .gte('date', today);

    if (pastCalendar && pastCalendar.length > 0) {
      const upcomingUrls = new Set((upcomingCalendar || []).map(r => normalise(r.url)));
      // Only purge URLs that do NOT also appear in upcoming auctions
      const purgeable = [...new Set(pastCalendar.map(r => normalise(r.url)).filter(Boolean))]
        .filter(u => !upcomingUrls.has(u));

      const BATCH = 50;
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
  } catch (e) {
    console.warn('AUTO-PURGE: cleanup failed (non-fatal) —', e.message);
  }

  // ── Step 1: Discover new catalogues from house root pages ──
  // Runs once per cycle to find new auction URLs that aren't in the calendar yet.
  await discoverAndUpdateCalendar().catch(e =>
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
        const totalMissingImages = cachedLots.filter(l => !l.imageUrl).length;
        if (totalMissingImages > 0) {
          // Step 1: Plain HTTP backfill from catalogue page
          const lotsWithUrl = cachedLots.filter(l => l.url && !l.imageUrl).length;
          if (lotsWithUrl > 0) {
            const updated = await backfillImages(auction.url, cachedLots);
            if (updated) {
              needsUpdate = true;
              const gained = updated.filter(l => l.imageUrl).length;
              console.log(`AUTO: ✓ ${auction.house} — HTTP backfill got ${gained} images`);
            }
            // Step 2: Deep backfill from individual lot pages
            const stillMissing = cachedLots.filter(l => l.url && !l.imageUrl).length;
            if (stillMissing > 0) {
              const deepFilled = await backfillImagesFromLotPages(cachedLots);
              if (deepFilled > 0) needsUpdate = true;
            }
          }
          // Step 3: Rendered backfill — try both engines for best image coverage
          const stillNoImages = cachedLots.filter(l => !l.imageUrl).length;
          const houseSlug = Object.entries(HOUSE_DISPLAY_NAMES).find(([k, v]) => v === auction.house)?.[0] || auction.house;
          if (stillNoImages > 0 && PUPPETEER_IMAGE_HOUSES.has(houseSlug)) {
            console.log(`AUTO: ${auction.house} — ${stillNoImages} lots still missing images, trying rendered backfill...`);
            let gained = 0;
            // Pass 1: Firecrawl with executeJavascript + images format
            if (FIRECRAWL_API_KEY && !fcCreditExhausted) {
              gained += await backfillImagesWithFirecrawl(auction.url, cachedLots, houseSlug);
            }
            // Pass 2: Puppeteer for remaining misses
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
          await supabase.from('cached_analyses').update({ lots: cachedLots }).eq('url', normalisedUrl);
        }
        skipped++;
        continue;
      }

      console.log(`AUTO: Analysing ${auction.house} — ${auction.url}`);
      await autoAnalyseOne(auction.url);
      analysed++;

      // Pause between analyses to be kind to servers and our resources
      await new Promise(r => setTimeout(r, 5000));

    } catch (e) {
      console.error(`AUTO: ✗ ${auction.house} failed: ${e.message}`);
      failed++;
    }
  }

  console.log(`═══ AUTO-ANALYSIS COMPLETE: ${analysed} analysed, ${skipped} cached, ${failed} failed ═══\n`);

  // ── Save daily analytics snapshot ──
  try { await saveDailySnapshot(); } catch (e) { console.warn('Daily snapshot failed:', e.message); }

  return { analysed, skipped, failed, total: ready.length };
}

// ═══════════════════════════════════════════════════════════════
// AUTO-DISCOVER: Scrape house root pages to find new catalogue URLs
// ═══════════════════════════════════════════════════════════════
// Runs as part of the 6-hour auto-analysis cycle. For each house with a
// HOUSE_ROOTS entry, fetches the root page, extracts auction links with
// Claude Haiku, and upserts any new ones into the Supabase calendar.
async function discoverAndUpdateCalendar() {
  if (!supabase || !process.env.GEMINI_API_KEY) return;

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

      const aiText = await callGemini(`Extract auction catalogue links from this auction house page.

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
No catalogues? Return {"catalogues": []}`, { maxTokens: 1500 });

      let catalogues = [];
      try {
        let text = aiText.trim();
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

async function autoAnalyseOne(url) {
  const urlCheck = await validateUrl(url);
  if (!urlCheck.ok) { log.warn('autoAnalyseOne skipped — invalid URL', { url, reason: urlCheck.error }); return []; }
  const house = detectAuctionHouse(url);

  // Skip Knight Frank forthcoming-auctions index page — it's a discovery page, not a catalogue.
  // Actual catalogue URLs like /auction/3833/... are discovered and analysed separately.
  if (house === 'knightfrank' && url.toLowerCase().includes('forthcoming-auctions')) {
    console.log(`AUTO: Skipping ${house} forthcoming-auctions index page (not a catalogue)`);
    return;
  }

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
    // Check if cache entry is too old (>3 days) — force re-analysis even if hash matches
    // because fetchPage() does plain HTTP, not Puppeteer, so JS-rendered sites always hash the same
    const MAX_CACHE_AGE_MS = 24 * 3600000; // 24 hours
    const cacheAge = cached?.expires_at ? Date.now() - (new Date(cached.expires_at).getTime() - getCacheTTL(house)) : Infinity;
    const tooOld = cacheAge > MAX_CACHE_AGE_MS;

    if (cached && cached.content_hash === contentHash && cached.expires_at && new Date(cached.expires_at) > new Date() && !tooOld) {
      // Extend cache TTL since content hasn't changed and data is recent
      const newExpiry = new Date(Date.now() + getCacheTTL(house)).toISOString();
      await supabase.from('cached_analyses').update({ expires_at: newExpiry, last_scraped_at: new Date().toISOString() }).eq('url', normalisedUrl);
      hashHitCount++;
      console.log(`Cache extended — content unchanged for ${house}`);
      return;
    }
    if (tooOld) console.log(`Cache too old for ${house} (${Math.round(cacheAge / 3600000)}h) — forcing re-analysis`);
    // Store hash for later upsert
    autoAnalyseOne._lastContentHash = contentHash;
  } catch (e) {
    autoAnalyseOne._lastContentHash = null;
  }

  let rawLots = [];

  if (rewritten.paginateAs === 'allsop_api') {
    const pages = await scrapeAllsopApi(rewritten.baseUrl);
    if (pages.length > 0) {
      rawLots = await extractLotsWithAI(pages, house, null, scrapeUrl);
      enrichAllsopLots(rawLots, pages);
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

    } else {
      // ── Generic auto-paginating extraction ──
      const firstResult = await scrapeRenderedPage(scrapeUrl, house);
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
              const pageResult = await scrapeRenderedPage(pageUrl, house);
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
      } else {
        // Fall back to Claude extraction
        const renderedPages = [{ page: 1, html: firstResult.html }];
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
      }
    }

  } else {
    const pages = await scrapeAllPages(scrapeUrl, house);
    if (pages && pages.length > 0) rawLots = await extractLotsWithAI(pages, house, null, scrapeUrl);
    // Rendered page fallback if static scraping found nothing
    const SKIP_PUPPETEER = ['philliparnold','knightfrank'];
    if (rawLots.length === 0 && !SKIP_PUPPETEER.includes(house)) {
      try {
        const rendered = await scrapeRenderedPage(url, house);
        if (rendered.html) {
          const renderedLots = extractWithJSDOM(rendered.html, house, url, rendered.images);
          if (renderedLots && renderedLots.length > 0) {
            rawLots = renderedLots;
          } else {
            const renderedPages = [{ page: 1, html: rendered.html }];
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
          }
        }
      } catch (err) {
        console.log(`AUTO: Rendered scraping fallback failed for ${house}: ${err.message}`);
      }
    }
  }

  if (rawLots.length === 0) {
    console.log(`AUTO: ${house}: 0 lots found, skipping cache`);
    return;
  }

  const lots = rawLots.map(lot => analyseLot(lot)).sort((a, b) => b.score - a.score);
  await enrichLots(lots, house, url);

  // Deep backfill: fetch individual lot pages for lots still missing images
  const lotsMissingImg = lots.filter(l => l.url && !l.imageUrl).length;
  if (lotsMissingImg > 0) {
    await backfillImagesFromLotPages(lots);
  }
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
  const lotsWithPrice = lots.filter(l => l.price && l.price > 0);
  const yieldsArr = lots.map(l => l.estGrossYield).filter(y => y && y > 0);

  // Check if catalogue data actually changed + lot count regression guard
  const { data: prevCached } = await supabase
    .from('cached_analyses')
    .select('total_lots, top_picks, title_splits')
    .eq('url', normalisedUrl)
    .single();

  const newTotalLots = lots.length;
  const newTopPicks = lots.filter(l => l.score >= 3).length;
  const newTitleSplits = lots.filter(l => l.titleSplit).length;

  // Lot count regression guard — if new scrape finds <50% of previous lots, warn and keep old data
  if (prevCached && prevCached.total_lots > 5 && newTotalLots < prevCached.total_lots * 0.5) {
    console.log(`AUTO: ⚠ ${house} lot count regression: ${prevCached.total_lots} → ${newTotalLots} (${Math.round(newTotalLots / prevCached.total_lots * 100)}%). Keeping old data.`);
    return;
  }

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
    scraped_with: _lastScrapeEngine,
    extracted_with: _lastExtractorUsed,
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

  const skill = {
    slug,
    house: displayName,
    catalogue_url: rootUrl,
    extractor,
    last_verified: now,
    last_lot_count: lotCount,
    average_lot_count: averageLotCount,
    image_coverage: imageCoverage,
    requires_puppeteer: !!requiresPuppeteer,
    requires_firecrawl: scrapedWith === 'firecrawl',
    pagination_pattern: paginationPattern,
    notes: existing?.notes || '',
    status,
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

  // Gather current state from cached_analyses
  const { data: cached } = await supabase
    .from('cached_analyses')
    .select('house, total_lots, lots, scraped_with')
    .gt('expires_at', new Date().toISOString());

  const houses = cached || [];
  let totalLots = 0;
  let totalWithImages = 0;
  let totalLotsForImages = 0;
  const lotsByHouse = {};
  const engineCounts = { firecrawl: 0, puppeteer: 0, http: 0 };

  for (const h of houses) {
    totalLots += h.total_lots || 0;
    lotsByHouse[h.house] = h.total_lots || 0;
    if (h.scraped_with && engineCounts[h.scraped_with] !== undefined) {
      engineCounts[h.scraped_with]++;
    }
    const lots = h.lots || [];
    totalLotsForImages += lots.length;
    totalWithImages += lots.filter(l => l.imageUrl).length;
  }

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

// ── Analytics API endpoint ──
app.get('/api/admin/analytics', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('analytics_snapshots')
      .select('*')
      .gte('date', since)
      .order('date', { ascending: true });
    if (error) throw error;
    res.json({ snapshots: data || [] });
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
  // Try Supabase first
  try {
    const { data, error } = await supabase
      .from('auction_calendar')
      .select('house, url, date, catalogue_ready')
      .eq('catalogue_ready', true)
      .gte('date', today)
      .order('date', { ascending: true });

    if (!error && data && data.length > 0) {
      return data.map(row => ({
        house: row.house,
        url: row.url,
        date: row.date,
        catalogueReady: row.catalogue_ready,
      }));
    }
  } catch (e) {
    console.warn('Calendar DB read failed in getCalendarAuctions, using fallback:', e.message);
  }

  // Fallback to hardcoded
  return FALLBACK_CALENDAR
    .filter(a => a.catalogueReady && a.date >= today)
    .map(a => ({
      house: a.house,
      url: a.url,
      date: a.date,
      catalogueReady: a.catalogueReady,
    }));
}
