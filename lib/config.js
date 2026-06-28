// lib/config.js — Environment validation, constants, cache tiers, tier resolution

// ── ENV Validation ──
export const REQUIRED_ENV = ['GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
export const RECOMMENDED_ENV = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SUPABASE_ANON_KEY', 'SUPABASE_JWT_SECRET', 'ADMIN_SECRET', 'RESEND_API_KEY', 'FIRECRAWL_API_KEY'];

export function validateEnv() {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
      console.error(`FATAL: Required environment variable ${key} is not set. Server cannot start.`);
      process.exit(1);
    }
  }
  for (const key of RECOMMENDED_ENV) {
    if (!process.env[key]) console.warn(`WARNING: Recommended env var ${key} is not set — some features will be disabled.`);
  }
}

// ── Stripe feature flag ──
export const STRIPE_ENABLED = process.env.STRIPE_ENABLED === 'true';

// ── Rate limits & caching ──
export const RATE_LIMIT_PER_DAY = STRIPE_ENABLED ? 5 : 50;
export const CACHE_DAYS = 7;
export const CACHE_TIERS = {
  high:   { houses: ['allsop','savills','btgeddisons','bidx1'], ttlHours: 12 },
  medium: { houses: ['cliveemson','edwardmellor','bondwolfe','strettons','countrywide','suttonkersh','tcpa','futureauctions','firstforauctions','harmanhealy','astleys','henrysykes','clarkesimpson','durrants','dawsons','goldings','auctionhousescotland','austingray','auctionhouseeastanglia','auctionhousenorthwest','auctionhousenortheast','auctionhousewales','auctionhousebirmingham','auctionhousekent','iamsold','buttersjohnbee','brownco','fssproperty','auctionhousedevon','auctionhouseeastmidlands','auctionhousewestmidlands','auctionhouseessex','auctionhousemanchester','romanway','hammerprice'], ttlHours: 18 },
  low:    { houses: [], ttlHours: 24 }  // everything else
};

// When an auction is within this window, cap the TTL so the frontend sees near-live data.
export const NEAR_AUCTION_WINDOW_MS = 48 * 3600000;
export const NEAR_AUCTION_TTL_MS = 2 * 3600000;

// Houses where Puppeteer rendering is known to fail (anti-bot, JS shell, etc.).
// Lives here so scripts/audit.mjs can import it without pulling in the
// Supabase client (which requires runtime env vars).
export const SKIP_PUPPETEER = ['philliparnold', 'knightfrank'];

export function getCacheTTL(houseKey, auctionDate) {
  let ttl;
  if (CACHE_TIERS.high.houses.includes(houseKey)) ttl = CACHE_TIERS.high.ttlHours * 3600000;
  else if (CACHE_TIERS.medium.houses.includes(houseKey)) ttl = CACHE_TIERS.medium.ttlHours * 3600000;
  else ttl = CACHE_TIERS.low.ttlHours * 3600000;

  if (auctionDate) {
    const ts = auctionDate instanceof Date ? auctionDate.getTime() : Date.parse(auctionDate);
    if (!Number.isNaN(ts)) {
      const msUntilAuction = ts - Date.now();
      if (msUntilAuction > 0 && msUntilAuction < NEAR_AUCTION_WINDOW_MS) {
        return Math.min(ttl, NEAR_AUCTION_TTL_MS);
      }
    }
  }
  return ttl;
}

export const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};
export const MAX_PAGES = 40;
export const MAX_PUPPETEER_PAGES = 15;
export const MAX_LOTS_PER_SCRAPE = 5000;
export const MAX_AUCTIONS_PER_HOUSE = 2;
export const TIMEOUT = 25000;

// ── Allowed origins for CORS + CSRF ──
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://auctions.bridgematch.co.uk,https://www.bridgematch.co.uk,https://bridgematch.co.uk').split(',');

// ── User tier resolution ──
export const FREE_SCAN_LIMIT = 3;
export const FREE_PREVIEW_LOTS = 6;
export const SIGNED_IN_DAILY_LIMIT = 50;

export function resolveEffectiveTier(user) {
  if (!user) return 'anon';
  if (!STRIPE_ENABLED) return 'premium';
  const tier = user.tier || 'free';
  if (tier === 'premium') return 'premium';
  if (user.trial_expires_at && new Date(user.trial_expires_at) > new Date()) return 'premium';
  return tier;
}

// ── AI Search tier limits ──
export const ANON_AI_SEARCH_LIMIT = 3;
export const FREE_AI_SEARCH_LIMIT = 5;
// Premium/trial cap. Was Infinity (unlimited); bounded to control AI cost
// during the DeepSeek V4 Pro trial (paid model, ~3p/search). Tune here.
export const PREMIUM_AI_SEARCH_LIMIT = 50;

export function getAISearchLimit(user) {
  if (!user) return ANON_AI_SEARCH_LIMIT;
  if (!STRIPE_ENABLED) return SIGNED_IN_DAILY_LIMIT;
  const tier = user.tier || 'free';
  if (tier === 'premium') return PREMIUM_AI_SEARCH_LIMIT;
  if (user.trial_expires_at && new Date(user.trial_expires_at) > new Date()) return PREMIUM_AI_SEARCH_LIMIT;
  return FREE_AI_SEARCH_LIMIT;
}

export function truncateAddress(address) {
  if (!address) return 'Address available with upgrade';
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 3) return parts.slice(-2).join(', ');
  if (parts.length === 2) return parts[1];
  const pcMatch = address.match(/[A-Z]{1,2}\d/);
  if (pcMatch) return pcMatch[0] + '*** area';
  return 'Location available with upgrade';
}

export function stripAIFields(lots) {
  return lots.map((lot, i) => {
    if (i < FREE_PREVIEW_LOTS) return lot;
    return {
      ...lot,
      score: null, opps: [], risks: [], scoreBreakdown: [], bullets: [], dealType: null,
      url: null,
      address: truncateAddress(lot.address),
      blurred: true
    };
  });
}
