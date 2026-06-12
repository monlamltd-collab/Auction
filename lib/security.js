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

// Hostnames that encode an IPv4 address in a non-dotted form, which the
// dotted-decimal BLOCKED_HOST_PATTERNS above don't catch: a bare integer
// (http://2130706433/ = 127.0.0.1), hex (http://0x7f000001/), or any octet
// written in hex/octal. getaddrinfo happily resolves these, so reject the
// shapes outright — no legitimate catalogue host is a bare number or 0x….
function isEncodedIpHost(hostname) {
  if (/^\d+$/.test(hostname)) return true;            // 2130706433
  if (/^0x[0-9a-f]+$/i.test(hostname)) return true;   // 0x7f000001
  if (/^(\d{1,3}|0x[0-9a-f]+|0[0-7]+)(\.(\d{1,3}|0x[0-9a-f]+|0[0-7]+)){1,3}$/i.test(hostname)
      && /(^|\.)(0x[0-9a-f]+|0[0-7]+)/i.test(hostname)) return true; // 0177.0.0.1 / 0x7f.0.0.1
  return false;
}

export async function validateUrl(raw) {
  let parsed;
  try { parsed = new URL(raw); } catch { return { ok: false, error: 'Invalid URL' }; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Only http/https URLs are allowed' };
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isEncodedIpHost(hostname)) {
    return { ok: false, error: 'URL uses an encoded IP address' };
  }
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

/**
 * SSRF-safe fetch: validates the URL, then follows redirects MANUALLY,
 * re-validating every hop. Native fetch's default `redirect: 'follow'` would
 * let a validated public URL 302 to an internal address (169.254.169.254,
 * *.railway.internal) with no second check — the redirect-SSRF hole closed
 * here (security fix 2026-06-12). Caller-supplied opts (headers, signal) flow
 * through; `redirect` is forced to 'manual'.
 *
 * Residual: a sub-second DNS-rebind between validateUrl's lookup and fetch's
 * own resolution is still theoretically possible (impact is blind SSRF only,
 * as callers don't return the body); fully closing it needs IP-pinned connect.
 *
 * @returns {Promise<Response>} the final non-redirect response
 * @throws {Error} (code 'SSRF_BLOCKED' / 'TOO_MANY_REDIRECTS') on a bad hop
 */
export async function safeFetch(rawUrl, opts = {}, { maxRedirects = 5, _validateUrl = validateUrl, _fetch = fetch } = {}) {
  let target = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await _validateUrl(target);
    if (!check.ok) { const e = new Error(`Blocked URL: ${check.error}`); e.code = 'SSRF_BLOCKED'; throw e; }
    const resp = await _fetch(check.url, { ...opts, redirect: 'manual' });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) return resp; // 3xx without a target — hand back as-is
      target = new URL(loc, check.url).href; // re-validated at the top of the next iteration
      continue;
    }
    return resp;
  }
  const e = new Error('Too many redirects'); e.code = 'TOO_MANY_REDIRECTS'; throw e;
}
