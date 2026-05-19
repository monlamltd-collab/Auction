// lib/security.js — CSP headers, CSRF origin validation, SSRF URL validation
import { lookup } from 'dns/promises';
import { STRIPE_ENABLED, ALLOWED_ORIGINS } from './config.js';

/** Security headers middleware */
export function securityHeaders(req, res, next) {
  const stripeSrc = STRIPE_ENABLED ? ' https://checkout.stripe.com' : '';
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://cloud.umami.is; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    // api.postcodes.io: postcode/town → lat/lng for the radius search
    // api.postcodes.io: postcode/town → lat/lng for the radius search.
    // *.umami.dev: Umami's send-payload endpoint (api-gateway.umami.dev) —
    // without it the tracker is blocked at request time even though the
    // script loads from cloud.umami.is.
    `connect-src 'self' https://*.supabase.co https://www.bridgematch.co.uk https://cloud.umami.is https://api.umami.is https://api-gateway.umami.dev https://api.postcodes.io${stripeSrc}; ` +
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
}

/** CSRF origin validation middleware */
export function csrfCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/api/stripe/webhook') return next(); // Stripe uses its own signature verification
  if (req.path === '/telegram/webhook') return next();   // Telegram verifies via X-Telegram-Bot-Api-Secret-Token header
  const origin = (req.headers.origin || req.headers.referer || '').replace(/\/+$/, '');
  if (origin && ALLOWED_ORIGINS.some(a => origin === a || origin === a + '/')) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden — missing or invalid Origin header' });
}

/** SSRF prevention — validate user-supplied URLs */
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

export async function validateUrl(raw) {
  let parsed;
  try { parsed = new URL(raw); } catch { return { ok: false, error: 'Invalid URL' }; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Only http/https URLs are allowed' };
  }
  const hostname = parsed.hostname.toLowerCase();
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
