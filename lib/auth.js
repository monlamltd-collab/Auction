// lib/auth.js — JWT verification, rate limiting, auth helpers
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { timingSafeEqual } from 'crypto';
import { SUPABASE_URL, SUPABASE_JWT_SECRET } from './supabase.js';
import { supabase } from './supabase.js';
import { log } from './logging.js';
import { STRIPE_ENABLED } from './config.js';

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

// ── Late-bound callback for new user creation (set by server.js after email module loads) ──
let _onNewUser = null;
export function setOnNewUser(fn) { _onNewUser = fn; }

// ── User cache ──
// Short-TTL in-memory cache of the user row keyed on supabase auth id.
// Prevents pool-exhaustion 401 cascades by collapsing repeated lookups
// within the same few seconds. 30s is acceptable staleness — counters
// may lag briefly; callers that mutate the user row can flush via
// invalidateUserCache(authId).
const _userCache = new Map();
const USER_CACHE_TTL_MS = 30 * 1000;
const USER_CACHE_MAX = 2000;

function _getCachedUser(authId) {
  const entry = _userCache.get(authId);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) { _userCache.delete(authId); return undefined; }
  return entry.user;
}

function _setCachedUser(authId, user) {
  _userCache.set(authId, { user, expires: Date.now() + USER_CACHE_TTL_MS });
  if (_userCache.size > USER_CACHE_MAX) {
    const oldest = _userCache.keys().next().value;
    _userCache.delete(oldest);
  }
}

export function invalidateUserCache(authId) { _userCache.delete(authId); }

// Exported for tests
export const _userCacheInternals = { get: _getCachedUser, set: _setCachedUser, map: _userCache };

/**
 * Downgrade a premium user whose trial has expired — but ONLY if they have
 * no Stripe subscription attached. Users with a stripe_subscription_id are
 * Stripe's responsibility; the webhook is the authoritative source for their
 * tier, and a past-due subscription carries a grace period that must not be
 * silently cut short by this request-time check.
 */
async function maybeExpireTrial(userRow) {
  if (!userRow) return;
  if (userRow.tier !== 'premium') return;
  if (!userRow.tier_expires_at) return;
  if (new Date(userRow.tier_expires_at) >= new Date()) return;
  if (userRow.stripe_subscription_id) return;  // leave paying/past-due users to the webhook
  await supabase.from('users')
    .update({ tier: 'free', tier_expires_at: null })
    .eq('id', userRow.id);
  userRow.tier = 'free';
  userRow.tier_expires_at = null;
}

// Exported for tests
export { maybeExpireTrial as _maybeExpireTrial };

/** Validate user from request via Supabase JWT or legacy session token */
export async function validateUserFromReq(req) {
  const authHeader = req.headers['authorization'] || '';

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (!token) return null;

    // 1) Try Supabase JWT verification
    const payload = await verifySupabaseToken(token);
    if (payload && !payload.error && payload.sub) {
      const authId = payload.sub;
      const email = payload.email;

      // Short-circuit to cache if this authId was validated in the last 30s
      const cached = _getCachedUser(authId);
      if (cached) return cached;

      // Look up by supabase_auth_id first
      const { data: byAuthId } = await supabase
        .from('users')
        .select('id, email, name, tier, analyses_count, stripe_customer_id, tier_expires_at, stripe_subscription_id, trial_started_at, trial_expires_at, trial_used, ai_searches_today, ai_searches_date')
        .eq('supabase_auth_id', authId)
        .single();
      if (byAuthId) {
        await maybeExpireTrial(byAuthId);
        _setCachedUser(authId, byAuthId);
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
          await maybeExpireTrial(byEmail);
          _setCachedUser(authId, byEmail);
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
        if (_onNewUser) _onNewUser(newUser.email, newUser.name);
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
