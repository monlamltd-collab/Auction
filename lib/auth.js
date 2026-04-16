// lib/auth.js — JWT verification, rate limiting, auth helpers
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { timingSafeEqual } from 'crypto';
import { SUPABASE_URL, SUPABASE_JWT_SECRET } from './supabase.js';

// ── JWKS client ──
let jwks = null;
if (SUPABASE_URL) {
  try {
    jwks = createRemoteJWKSet(new URL(SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/.well-known/jwks.json'));
    console.log('[AUTH] JWKS client created for ES256 verification');
  } catch (e) {
    console.warn('[AUTH] Failed to create JWKS client:', e.message);
  }
}

/** Verify a Supabase JWT — tries ES256 (JWKS) then HS256 fallback */
export async function verifySupabaseToken(token) {
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

/** Timing-safe string comparison for auth tokens */
export function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Extract client IP from request (behind reverse proxy) */
export function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

/** In-memory rate limiter middleware factory */
const _rlBuckets = new Map();
export function rateLimit(windowMs, maxHits) {
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
    if (now - bucket.start > 300000) _rlBuckets.delete(key);
  }
}, 600000);
