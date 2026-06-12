// lib/auth.js — JWT verification, rate limiting, auth helpers
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { timingSafeEqual } from 'crypto';
import { SUPABASE_URL, SUPABASE_JWT_SECRET } from './supabase.js';
import { supabase } from './supabase.js';
import { log } from './logging.js';
import { STRIPE_ENABLED } from './config.js';

// ── JWKS client ──
//
// jose's default cooldownDuration is 30s — but cacheMaxAge defaults to
// 10 minutes, after which a fresh fetch happens automatically. The real
// failure mode that bit us during the OAuth-loop debugging on 2026-05-03:
// when Supabase restarts its Auth service and rotates the signing key,
// our cached JWKS still holds the OLD key. Any new JWT from a fresh
// sign-in fails verification → 401 → wrapper signs the user out → modal
// pops → user clicks Continue with Google again → loop.
//
// Two mitigations:
//   1) Shorten cooldown so a `kid not found` error retries quickly.
//   2) On a verification failure with `code === ERR_JWKS_NO_MATCHING_KEY`
//      explicitly invalidate + retry once before giving up. This handles
//      the key-rotation case without waiting for the 10-min refresh.
let jwks = null;
function buildJwks() {
  if (!SUPABASE_URL) return null;
  try {
    const set = createRemoteJWKSet(
      new URL(SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/.well-known/jwks.json'),
      { cooldownDuration: 5000, cacheMaxAge: 60_000 }
    );
    console.log('[AUTH] JWKS client created for ES256 verification (cooldown 5s, cache 60s)');
    return set;
  } catch (e) {
    console.warn('[AUTH] Failed to create JWKS client:', e.message);
    return null;
  }
}
jwks = buildJwks();

/** Verify a Supabase JWT — tries ES256 (JWKS) then HS256 fallback.
 * On `ERR_JWKS_NO_MATCHING_KEY` we rebuild the JWKS client (forces a
 * fresh fetch) and retry once — this absorbs Supabase signing-key
 * rotations that would otherwise lock us out until the 10-min cache
 * naturally expires. */
export async function verifySupabaseToken(token) {
  // Try ES256 via JWKS first (Supabase default)
  if (jwks) {
    try {
      const { payload } = await jwtVerify(token, jwks, { audience: 'authenticated' });
      return payload;
    } catch (e) {
      if (e.code === 'ERR_JWT_EXPIRED') return { error: 'Session expired — please sign in again' };
      if (e.code === 'ERR_JWKS_NO_MATCHING_KEY') {
        log.warn('[AUTH] JWKS key not found — rotating cache and retrying once', { kid: e.message });
        jwks = buildJwks();
        if (jwks) {
          try {
            const { payload } = await jwtVerify(token, jwks, { audience: 'authenticated' });
            return payload;
          } catch (retryErr) {
            log.warn('[AUTH] JWKS retry also failed', { code: retryErr.code, message: retryErr.message });
          }
        }
      } else if (process.env.AUTH_DEBUG === '1') {
        log.warn('[AUTH] ES256 verify failed', { code: e.code, message: e.message });
      }
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
      log.warn('[AUTH] HS256 verify failed', { code: e.code, message: e.message });
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

/** Express middleware: gate a route on the x-admin-secret header.
 *  Header-only — body-secret is intentionally NOT accepted to avoid leaking
 *  the secret into request logs or copied JSON. */
export function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/** Extract client IP from request (behind reverse proxy).
 *
 * Uses Express's `req.ip`, which — with `trust proxy = 1` set in server.js —
 * is the single trusted hop the platform (Railway) appends, i.e. the real
 * client IP. Reading `x-forwarded-for[0]` directly (the old behaviour) took
 * the LEFTMOST, fully client-controlled value, so any caller could send a
 * random `X-Forwarded-For` per request to mint a fresh rate-limit bucket and
 * bypass every per-IP quota (free unlimited /api/analyse → Firecrawl/Gemini
 * spend, signup/lead spam). Security fix 2026-06-12. */
export function getClientIP(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
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

// Periodic cleanup of expired entries — runs every 5 min to bound memory usage
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _userCache) if (v.expires < now) _userCache.delete(k);
}, 5 * 60 * 1000);

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

/**
 * Attach a `subscription_warning` field when a paying user's subscription is
 * past_due (i.e. they have a stripe_subscription_id but tier_expires_at is set
 * to a grace-period deadline in the near future rather than null).
 * The frontend can use this to show a "please update payment" banner without
 * kicking the user out.
 */
function _addSubscriptionWarning(userRow) {
  if (!userRow) return;
  if (
    userRow.stripe_subscription_id &&
    userRow.tier_expires_at &&
    new Date(userRow.tier_expires_at) > new Date()
  ) {
    // A grace-period expiry on an active subscription signals past_due
    userRow.subscription_warning = 'past_due';
  }
}

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

      // Look up by supabase_auth_id first — with graceful degradation on DB errors
      let byAuthId, dbError;
      try {
        const result = await supabase
          .from('users')
          .select('id, email, name, tier, analyses_count, stripe_customer_id, tier_expires_at, stripe_subscription_id, trial_started_at, trial_expires_at, trial_used, ai_searches_today, ai_searches_date')
          .eq('supabase_auth_id', authId)
          .single();
        byAuthId = result.data;
        dbError = result.error;
      } catch (e) {
        dbError = e;
      }

      // Graceful degradation: if Supabase is unreachable, return a recent stale cache entry
      // rather than forcing a 401 that appears as a spurious sign-out under load
      if (dbError && !byAuthId) {
        const staleEntry = _userCache.get(authId);
        const STALE_GRACE_MS = 5 * 60 * 1000;
        if (staleEntry && Date.now() - (staleEntry.expires - USER_CACHE_TTL_MS) < STALE_GRACE_MS) {
          log.warn('[AUTH] Supabase unreachable — returning stale cache entry', { authId, error: dbError.message });
          return staleEntry.user;
        }
      }

      if (byAuthId) {
        await maybeExpireTrial(byAuthId);
        _addSubscriptionWarning(byAuthId);
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
          _addSubscriptionWarning(byEmail);
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
  }

  return null;
}
