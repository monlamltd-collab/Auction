import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { supabase } from '../lib/supabase.js';
import { validateUserFromReq, rateLimit, getClientIP, safeCompare } from '../lib/auth.js';
import { log } from '../lib/logging.js';
import { resolveEffectiveTier, getAISearchLimit, STRIPE_ENABLED, stripAIFields, applyAnonTeaserGate } from '../lib/config.js';
import { callAI, hasAIFallback } from '../lib/ai-provider.js';
import { logActivityEvent, getCreditExhausted, setCreditExhausted, getCreditExhaustedAt, setCreditExhaustedAt } from '../lib/analysis.js';
import { LOTS_SELECT, dbRowToLot } from '../lib/types/lot.js';
import { enrichLotsWithFundability } from '../lib/fundability.js';
import { normaliseUrl, findAuctionDateInBullets } from '../lib/utils.js';
import { FALLBACK_CALENDAR } from '../lib/calendar.js';
import { getLotsForCatalogues } from '../lib/pipeline/lot-lookup.js';
import { normaliseLotStatuses, isValidImageUrl } from '../lib/scraper.js';
import { parseAIResponse } from '../lib/search-parse.js';
import { parseSmartSearchQuery, REGION_POSTCODES } from '../lib/search-query-parse.js';
import { createHash } from 'crypto';

const router = Router();

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
  'HMO and multi-let investments': 'hmo',
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
  'hmo': {
    filter: l => l.dealType === 'HMO' || (l.dealSignals || []).includes('hmo'),
    // Investment-valuation candidates first, then stated income, then score.
    sort: (a, b) =>
      (((b.dealSignals || []).includes('investment-valuation') ? 1 : 0) - ((a.dealSignals || []).includes('investment-valuation') ? 1 : 0))
      || ((b.statedIncomePa || 0) - (a.statedIncomePa || 0))
      || ((b.score || 0) - (a.score || 0)),
    report: (n, total) => n > 0
      ? `Found ${n} HMO and multi-let investments across ${total} lots. Lots flagged as investment-valuation candidates (larger HMOs with en-suites or stated passing income, where some lenders may apply a commercial yield-based valuation rather than bricks-and-mortar comparables) are shown first. Verify licensing, planning status and the valuation basis with your lender before bidding.`
      : `No HMO or multi-let lots detected in current catalogues. These are identified from listing text — HMO keywords, 5+ bedroom houses with letting context, en-suite counts and stated rental income.`,
  },
};

function isPresetQuery(query) {
  return PRESET_QUERIES[query] || null;
}

// ═══════════════════════════════════════════════════════════════
// SMART SEARCH QUERY PARSER — extracted to lib/search-query-parse.js
// (2026-07-07) so the parsing contract is unit-testable without this
// module's Supabase-at-import dependency. See tests/test-smart-query-parse.js.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// SMART SEARCH: Column-filtered database query + AI analysis
// ═══════════════════════════════════════════════════════════════
const _smartSearchCache = new Map();
const SMART_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Clean up expired smart search cache entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - SMART_CACHE_TTL;
  for (const [k, v] of _smartSearchCache) {
    if (v.timestamp < cutoff) _smartSearchCache.delete(k);
  }
}, 10 * 60 * 1000);

// Returns the union of active catalogue URLs from BOTH:
//   (a) cached_analyses with unexpired TTL (recently scraped via cron)
//   (b) lots table with last_seen_at within the last 14 days
//
// Previously this was fallback-only — (b) only fired when (a) was empty. That
// was a degenerate edge case in practice: when scrape failures accumulated,
// (a) would shrink to a handful of houses but stay non-empty, so the fallback
// never triggered and the frontend silently lost ~80% of its inventory. The
// 2026-05-06 lot-drop incident was exactly this pattern.
//
// Union approach: cached_analyses entries take precedence on duplicate URLs
// (their created_at reflects a successful recent cron). Lots-table entries
// fill the long tail of houses whose cache happens to have lapsed but whose
// lots were still scraped recently enough to be relevant.
async function getActiveCataloguesWithFallback() {
  const fbCutoff = new Date(Date.now() - 14 * 86400000).toISOString();
  const merged = new Map();

  // (a) cached_analyses — primary source, takes precedence on duplicates
  const { data: cacheRows, error: cacheErr } = await supabase
    .from('cached_analyses')
    .select('url, house, created_at')
    .gt('expires_at', new Date().toISOString());
  if (cacheErr) return { rows: null, error: cacheErr, fromFallback: false };
  for (const r of (cacheRows || [])) {
    merged.set(r.url, { url: r.url, house: r.house, created_at: r.created_at, auctionId: null });
  }

  // (b) lots-table-recent — backfill houses whose cache has lapsed but
  // whose lots were scraped within the last 14 days. Skip URLs already
  // seen via cached_analyses (a fresher source). Move 2: pull auction_id
  // so the smart-search dual-read can hit the FK path.
  const { data: lotsRows, error: lotsErr } = await supabase
    .from('lots')
    .select('catalogue_url, house:house_slug, last_seen_at, auction_id')
    .gte('last_seen_at', fbCutoff)
    .not('catalogue_url', 'is', null)
    .limit(10000);
  if (!lotsErr && lotsRows) {
    for (const r of lotsRows) {
      const existing = merged.get(r.catalogue_url);
      if (existing) {
        // Cached_analyses won the URL. Promote auction_id from lots if cached
        // entry has none — same catalogue, just enriches the join key.
        if (!existing.auctionId && r.auction_id) existing.auctionId = r.auction_id;
        continue;
      }
      merged.set(r.catalogue_url, {
        url: r.catalogue_url,
        house: r.house,
        created_at: r.last_seen_at,
        auctionId: r.auction_id || null,
      });
    }
  } else if (lotsErr) {
    log.warn('lots-table fallback query failed', { err: lotsErr.message });
  }

  // (c) auction_calendar fallback — for cached_analyses entries that still
  // have no auction_id (no lot stamped yet — happens on brand-new houses or
  // when lots-table query missed them), look up by URL. Cheap (~268 rows).
  const stillMissing = [...merged.values()].some(v => !v.auctionId);
  if (stillMissing) {
    const { data: calRows } = await supabase.from('auction_calendar').select('url, id');
    const urlToId = new Map((calRows || []).map(r => [r.url, r.id]));
    for (const entry of merged.values()) {
      if (!entry.auctionId) {
        const aid = urlToId.get(entry.url);
        if (aid) entry.auctionId = aid;
      }
    }
  }

  if (merged.size === 0) return { rows: null, error: null, fromFallback: true };
  const usedFallback = (cacheRows || []).length === 0;
  return { rows: [...merged.values()], error: null, fromFallback: usedFallback };
}

// Build a PostgREST OR clause matching lots whose postcode is in a region's
// postcode-area list. Single-letter areas (B, E, N, W, L, M, S, G) MUST be
// digit-guarded: bare `postcode.ilike.B%` matched every area starting with B
// (Bristol/Brighton/Bradford/Bath…) — a "west midlands" AI search returned 370
// lots of which only 103 were Birmingham (2026-07-07 audit, verified in prod).
// A UK postcode area is 1–2 letters ALWAYS followed by a digit, so `B0%..B9%`
// matches exactly the single-letter 'B' area and nothing beginning 'BS'/'BN'.
function regionPostcodeOrClause(prefixes) {
  const terms = [];
  for (const p of prefixes) {
    if (p.length === 1) {
      for (let d = 0; d <= 9; d++) terms.push(`postcode.ilike.${p}${d}%`);
    } else {
      terms.push(`postcode.ilike.${p}%`);
    }
  }
  return terms.join(',');
}

// asyncHandler: the pre-try section (auth + rate limiting + location parse)
// runs outside the handler's own try/catch — a rejection there previously
// hung the request (Phase 5).
router.post('/api/smart-search', asyncHandler(async (req, res) => {
  const { query, soldFilter, location, region } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Missing search query' });

  // ── Normalise UI-supplied location filter (postcode/town input + radius) ──
  // Sent by the catalogue page to keep AI search synced with the dropdowns.
  // Precedence: precise center+radius > rawInput postcode prefix > rawInput address ILIKE.
  let uiLoc = null;
  if (location && typeof location === 'object') {
    const center = location.center && Number.isFinite(location.center.lat) && Number.isFinite(location.center.lng)
      ? { lat: +location.center.lat, lng: +location.center.lng }
      : null;
    const radiusMiles = Number.isFinite(+location.radiusMiles) && +location.radiusMiles > 0 ? +location.radiusMiles : null;
    const rawInput = typeof location.rawInput === 'string' ? location.rawInput.trim() : '';
    const pcMatch = rawInput.match(/^([A-Z]{1,2}\d[A-Z\d]?)/i);
    if (center && radiusMiles) {
      // Bounding-box approximation: 1° lat ≈ 69mi; 1° lng ≈ 40mi at UK latitudes (conservative).
      uiLoc = {
        type: 'bbox',
        minLat: +(center.lat - radiusMiles / 69).toFixed(6), maxLat: +(center.lat + radiusMiles / 69).toFixed(6),
        minLng: +(center.lng - radiusMiles / 40).toFixed(6), maxLng: +(center.lng + radiusMiles / 40).toFixed(6),
        // Text fallback for the ~47% of lots with no lat/lng — without it a
        // bbox silently drops every coord-less lot in the area, so AI search
        // returned far fewer lots than browse for the same town (2026-07-07).
        pcPrefix: pcMatch ? pcMatch[1].toUpperCase() : null,
        // Commas/parens would break the PostgREST .or() grammar; drop the
        // address fallback rather than risk a malformed filter.
        addrText: (rawInput && !/[(),]/.test(rawInput)) ? rawInput : null,
      };
    } else if (rawInput) {
      uiLoc = pcMatch ? { type: 'postcode', prefix: pcMatch[1].toUpperCase() } : { type: 'address', text: rawInput };
    }
  }
  const applyUiLoc = (q) => {
    if (!uiLoc) return q;
    if (uiLoc.type === 'bbox') {
      const bbox = `and(lat.gte.${uiLoc.minLat},lat.lte.${uiLoc.maxLat},lng.gte.${uiLoc.minLng},lng.lte.${uiLoc.maxLng})`;
      const fb = [];
      if (uiLoc.pcPrefix) fb.push(`postcode.ilike.${uiLoc.pcPrefix}%`);
      if (uiLoc.addrText) fb.push(`address.ilike.%${uiLoc.addrText}%`);
      if (!fb.length) return q.or(bbox);
      // Coord-having lots: strict bbox. Coord-less lots: text-area fallback.
      const fbGroup = fb.length > 1 ? `or(${fb.join(',')})` : fb[0];
      return q.or(`${bbox},and(lat.is.null,${fbGroup})`);
    }
    if (uiLoc.type === 'postcode') return q.ilike('postcode', `${uiLoc.prefix}%`);
    if (uiLoc.type === 'address') return q.ilike('address', `%${uiLoc.text}%`);
    return q;
  };

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

  // Tracks whether we already atomically incremented the auth-user counter
  // upfront via the RPC. When true, incrementSearchCounter() is a no-op for
  // this request — the bump already happened.
  let userIncrementedAtomically = false;

  if (searchLimit !== Infinity) {
    if (user) {
      // Atomic check-and-increment via increment_ai_search RPC.
      // Replaces a read-then-check-then-write race (issue #10 from the
      // 2026-04-29 code review): two concurrent requests at counter=N
      // both passed the limit check and both wrote N+1, silently
      // exceeding the daily quota.
      try {
        const { data: rpcRows, error: rpcErr } = await supabase
          .rpc('increment_ai_search', {
            p_user_id: user.id,
            p_today: searchToday,
            p_limit: searchLimit,
          });
        const rpc = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
        if (rpcErr || !rpc) {
          // Fail open — better to allow the search than to lock a paying
          // user out due to an RPC hiccup. The cached read below is the
          // backstop for blatantly over-quota requests.
          log.warn('increment_ai_search RPC failed; falling back to non-atomic check', { err: rpcErr?.message, userId: user.id });
          const userSearchDate = user.ai_searches_date ? new Date(user.ai_searches_date).toISOString().slice(0, 10) : null;
          if (userSearchDate === searchToday) searchesUsed = user.ai_searches_today || 0;
          if (searchesUsed >= searchLimit) {
            return res.status(429).json({
              error: 'rate_limited',
              message: `You've used all ${searchLimit} AI searches for today. Upgrade to Pro for unlimited.`,
              searchesUsed, searchLimit,
            });
          }
          // Fallback path lets the request proceed; the trailing
          // incrementSearchCounter() will do a non-atomic bump later.
        } else {
          searchesUsed = rpc.searches_used ?? 0;
          if (!rpc.allowed) {
            return res.status(429).json({
              error: 'rate_limited',
              message: `You've used all ${searchLimit} AI searches for today. Upgrade to Pro for unlimited.`,
              searchesUsed, searchLimit,
            });
          }
          userIncrementedAtomically = true;
        }
      } catch (err) {
        log.warn('increment_ai_search RPC threw; falling back to non-atomic check', { err: err.message, userId: user.id });
        const userSearchDate = user.ai_searches_date ? new Date(user.ai_searches_date).toISOString().slice(0, 10) : null;
        if (userSearchDate === searchToday) searchesUsed = user.ai_searches_today || 0;
        if (searchesUsed >= searchLimit) {
          return res.status(429).json({
            error: 'rate_limited',
            message: `You've used all ${searchLimit} AI searches for today. Upgrade to Pro for unlimited.`,
            searchesUsed, searchLimit,
          });
        }
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

  // Helper: increment search counter AFTER successful response.
  // For authenticated users where the RPC already incremented atomically
  // upfront, this is a no-op (skips the redundant DB write). For
  // authenticated users on the fallback path (RPC hiccup) it does the
  // non-atomic bump as before. Anon users still use rate_limits.
  async function incrementSearchCounter() {
    try {
      if (user) {
        if (userIncrementedAtomically) return; // already done by the RPC
        await supabase.from('users').update({ ai_searches_today: searchesUsed + 1, ai_searches_date: searchToday }).eq('id', user.id);
      } else {
        const { data: sr } = await supabase.from('rate_limits').select('requests').eq('ip', _searchKey).eq('date', searchToday).single();
        if (sr) { await supabase.from('rate_limits').update({ requests: (sr.requests || 0) + 1 }).eq('ip', _searchKey).eq('date', searchToday); }
        else { await supabase.from('rate_limits').insert({ ip: _searchKey, date: searchToday, requests: 1 }); }
      }
      searchesUsed += 1;
    } catch { /* non-critical */ }
  }

  // Refund the upfront atomic increment when the search fails for a reason
  // that isn't the user's fault (no AI key, provider quota-dead, DB error).
  // The counter is bumped BEFORE the AI call to keep the quota race-safe, so a
  // failed search would otherwise silently burn one of the user's daily
  // searches (2026-07-07 audit). Guarded, floor-at-0; only fires when we
  // actually charged this request atomically.
  let _refunded = false;
  async function refundSearchCounter() {
    if (!user || !userIncrementedAtomically || _refunded) return;
    _refunded = true;
    try {
      await supabase.rpc('refund_ai_search', { p_user_id: user.id, p_today: searchToday });
    } catch {
      // Fallback if the RPC isn't deployed: guarded non-atomic decrement.
      try {
        const cur = Math.max(0, (searchesUsed || 1) - 1);
        await supabase.from('users').update({ ai_searches_today: cur }).eq('id', user.id).eq('ai_searches_date', searchToday);
      } catch { /* non-critical */ }
    }
    searchesUsed = Math.max(0, searchesUsed - 1);
  }

  const presetSlug = isPresetQuery(query);
  const sf = soldFilter || 'all';

  // ── UI region dropdown (fLocation) → postcode-prefix scope ──
  // The region dropdown isn't part of the query text (the parser never sees
  // it) and until 2026-07-09 was applied ONLY client-side after results
  // returned — so the AI/preset searched nationwide, the "N matches" count
  // reflected that, but the browser then hid every out-of-region lot ("5
  // matches", 1 card). Resolve it once here and scope BOTH the preset fast
  // path (applyUiRegion) and the AI candidate pool (via sqParsed.filters
  // .regionPostcodes) server-side so the count matches the grid.
  const uiRegionKey = typeof region === 'string' ? region.trim().toLowerCase() : '';
  const uiRegionPostcodes = (uiRegionKey && REGION_POSTCODES[uiRegionKey]) ? REGION_POSTCODES[uiRegionKey] : null;
  const applyUiRegion = (q) => uiRegionPostcodes ? q.or(regionPostcodeOrClause(uiRegionPostcodes)) : q;

  // ── Smart search cache: return cached result for identical queries ──
  // The key MUST include the UI location filter AND region — they shape the
  // result set, and omitting location served one user's Bristol-scoped results
  // to another user's identical query scoped to Leeds (Phase 5 review,
  // cross-user bug). Region has the same hazard, so it's in the key too.
  const _smLocKey = uiLoc ? JSON.stringify(uiLoc) : '';
  const _smCacheKey = (query.toLowerCase().trim() + '|' + sf + '|' + _smLocKey + '|' + (uiRegionKey || '')).trim();
  const _smCached = _smartSearchCache.get(_smCacheKey);
  if (_smCached && (Date.now() - _smCached.timestamp) < SMART_CACHE_TTL) {
    await incrementSearchCounter();
    log.info('smart-search cache-hit', { query, cacheAge: Math.round((Date.now() - _smCached.timestamp) / 1000) + 's' });
    return res.json({ ..._smCached.result, searchesUsed, searchLimit });
  }

  // ── Deterministic preset fast path — no AI needed ──
  // Presets like "Best scoring deals", "Under £100k", "Vacant" etc. can be resolved
  // by filtering/sorting on precomputed lot fields. Reads from lots table (single source of truth).
  const presetFilter = presetSlug ? PRESET_FILTERS[presetSlug] : null;
  if (presetFilter) {
    try {
      // Query lots table directly — get all lots from active catalogues
      // (with fallback if cached_analyses is empty)
      const { rows: activeCatalogues } = await getActiveCataloguesWithFallback();

      if (!activeCatalogues || activeCatalogues.length === 0) {
        await incrementSearchCounter();
        return res.json({ results: [], report: 'No cached auction data available. Please analyse some auction catalogues first.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
      }

      // Move 2: dual-read via the lot-lookup helper. activeCatalogues carries
      // `auctionId` when known (stamped by getActiveCataloguesWithFallback
      // above); the helper partitions and runs two parallel queries with the
      // same filter chain, then merges + re-sorts the union.
      const { data: lotRows } = await getLotsForCatalogues(supabase, activeCatalogues, {
        select: LOTS_SELECT,
        applyFilters: (q) => {
          if (sf === 'available') q = q.or('status.eq.available,status.is.null');
          else if (sf === 'sold') q = q.in('status', ['sold', 'stc', 'withdrawn']);
          else if (sf === 'unsold') q = q.eq('status', 'unsold');
          else if (sf === 'stc') q = q.eq('status', 'stc');
          else if (sf === 'withdrawn') q = q.eq('status', 'withdrawn');
          else if (sf !== 'everything') q = q.or('status.eq.available,status.eq.unsold,status.is.null');
          q = applyUiLoc(q);
          q = applyUiRegion(q);
          return q.order('score', { ascending: false, nullsFirst: false }).limit(2000);
        },
        sort: (a, b) => {
          if (a.score == null && b.score == null) return 0;
          if (a.score == null) return 1;
          if (b.score == null) return -1;
          return b.score - a.score;
        },
        limit: 2000,
      });

      if (!lotRows || lotRows.length === 0) {
        await incrementSearchCounter();
        return res.json({ results: [], report: 'No lots found matching criteria.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
      }

      const allLots = lotRows.map(dbRowToLot);
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

  // Any provider in the callAI chain will do — OpenRouter serves production
  // when the direct Gemini key is absent or quota-dead.
  if (!process.env.GEMINI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    log.warn('smart-search: no AI provider key set (GEMINI_API_KEY / OPENROUTER_API_KEY)');
    await refundSearchCounter();
    return res.status(500).json({ error: 'key_missing', message: 'AI search is not configured — no AI provider API key is set.' });
  }
  // The creditExhausted flag is Gemini-specific (it can be latched by
  // background catalogue extraction, not just search). With a fallback
  // provider configured — production is OpenRouter-first — callAI rolls
  // past a dead Gemini, so a latched flag must NOT block the search.
  if (!hasAIFallback() && getCreditExhausted()) {
    const exhaustedAgo = getCreditExhaustedAt() ? Math.round((Date.now() - getCreditExhaustedAt()) / 60000) : '?';
    log.warn('smart-search: blocked by creditExhausted flag', { exhaustedMinutesAgo: exhaustedAgo });
    await refundSearchCounter();
    return res.status(503).json({ error: 'ai_quota_exhausted', message: `Gemini API rate limit hit ${exhaustedAgo}min ago. Auto-resets after 1 hour. Try again soon.`, exhaustedMinutesAgo: exhaustedAgo });
  }
  const keyPrefix = (process.env.GEMINI_API_KEY || '').substring(0, 10);
  log.info('smart-search pre-flight', { tier: 'fast', keyPrefix: keyPrefix + '...', query: query.substring(0, 60) });

  // Hoisted for the catch block: once Layer 1 has produced a candidate pool,
  // an AI-provider failure degrades to score-ranked DB results instead of a
  // 503 — the search must not die when the database already answered.
  let _l1Pool = null, _l1Sources = null, _l1Total = 0;

  try {
    // ═══════════════════════════════════════════════════════════
    // LAYER 1: Parse query into structured column filters
    // ═══════════════════════════════════════════════════════════
    const sqParsed = parseSmartSearchQuery(query);

    // Fold the UI region dropdown (resolved once near the top) into the SAME
    // regionPostcodes mechanism the query-text region path uses, so the AI
    // searches and ranks WITHIN the region (applied in buildLayer1Query /
    // unsold pool below). A region typed into the query wins (already parsed);
    // the dropdown only fills the gap when none was typed.
    if (uiRegionPostcodes && !sqParsed.filters.regionPostcodes) {
      sqParsed.filters.regionPostcodes = uiRegionPostcodes;
      sqParsed.filters.regionName = uiRegionKey;
    }
    log.info('smart-search parsed', sqParsed);

    // ── Get active catalogue URLs for freshness gate (with fallback) ──
    const { rows: activeCatalogues } = await getActiveCataloguesWithFallback();

    if (!activeCatalogues || activeCatalogues.length === 0) {
      await incrementSearchCounter();
      return res.json({ results: [], report: 'No active auction data available.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
    }
    const effectiveSold = sqParsed.filters.statusOverride || sf;
    const sortCol = sqParsed.filters.sortBy === 'yield' ? 'est_gross_yield' : 'score';

    // UI-supplied postcode/town + radius is applied inside buildLayer1Query()
    // via applyUiLoc(); no outer dbQuery exists in this scope. The previous
    // `dbQuery = applyUiLoc(dbQuery)` line here threw ReferenceError on every
    // non-preset AI search and was caught + logged as a generic failure.

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

    // Concept/soft/free-text OR clauses are no longer used as Layer-1 filters
    // — Layer 2 (Gemini) is the semantic interpreter. They're still computed
    // above so they can flow into the AI prompt as context (filterNote).
    const allOrClauses = [...conceptOrClauses, ...softOrClauses];

    // ── Layer-1 query — broad candidate pool ──
    // PHILOSOPHY: Layer 1 should ONLY apply the user's EXPLICIT, MEASURABLE
    // constraints (status, location, hard price/beds/tenure). Anything that
    // requires interpretation — "title split", "good for HMO", "needs work",
    // "could be split" — is left to Layer 2 (Gemini), which can reason about
    // a lot's search_text using its general knowledge of property investment.
    //
    // This prevents over-narrowing: e.g. "freehold multi unit block to split"
    // shouldn't require literal words "block" or "split" to appear in
    // search_text. Gemini reads the lot descriptions and recognises a 4-flat
    // freehold investment as a title-split candidate even when the data
    // doesn't tag it explicitly.
    //
    // Relaxation only kicks in if hard filters narrow to zero — drop hard
    // filters, then drop location, then wildcard. Each drop is reported to
    // Gemini so the report can be honest about what was matched.
    // Move 2: returns a Promise<{data, error}> via the dual-read helper
    // (was a query builder pre-Move-2; caller still awaits the same shape).
    // Status filter (always applied — semantic meaning of 'available' /
    // 'unsold' etc). Shared by the tiered Layer-1 query and the free-text
    // recall pool below.
    // Freshness guards mirroring get_active_lots() so an AI "available" search
    // can't surface ended or stale-cached lots the browse grid deliberately
    // hides (2026-07-07 audit): available requires last_seen within 7d AND a
    // null/today-or-future auction date.
    const freshCutoffISO = new Date(Date.now() - 7 * 86400000).toISOString();
    const dateFloor = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const applyStatusFilter = (q) => {
      if (effectiveSold === 'available') {
        return q.or('status.eq.available,status.is.null')
          .gte('last_seen_at', freshCutoffISO)
          .or(`auction_date.is.null,auction_date.gte.${dateFloor}`);
      }
      if (effectiveSold === 'sold') return q.in('status', ['sold', 'stc', 'withdrawn']);
      if (effectiveSold === 'unsold') return q.eq('status', 'unsold');
      if (effectiveSold === 'stc') return q.eq('status', 'stc');
      if (effectiveSold === 'withdrawn') return q.eq('status', 'withdrawn');
      if (effectiveSold !== 'everything') return q.or('status.eq.available,status.eq.unsold,status.is.null');
      return q;
    };

    async function buildLayer1Query(tier) {
      return getLotsForCatalogues(supabase, activeCatalogues, {
        select: LOTS_SELECT,
        applyFilters: (q) => {
          q = applyStatusFilter(q);

          // Hard filters (tier 0 only) — explicit user constraints from query parser
          if (tier === 0) {
            if (sqParsed.filters.tenure) q = q.ilike('tenure', sqParsed.filters.tenure);
            if (sqParsed.filters.maxPrice) q = q.lte('price', sqParsed.filters.maxPrice);
            if (sqParsed.filters.minPrice) q = q.gte('price', sqParsed.filters.minPrice);
            if (sqParsed.filters.beds) q = q.gte('beds', sqParsed.filters.beds);
            if (sqParsed.filters.condition) q = q.in('condition', sqParsed.filters.condition);
          }

          // Location (tiers 0-1). Each term matches address text OR the
          // postcode column — "b34" / "bristol" style queries previously
          // only ILIKEd address, dropping lots whose address string doesn't
          // repeat the postcode/town (the Bristol-class recall bug).
          if (tier <= 1) {
            for (const loc of sqParsed.locationTerms) q = q.or(`address.ilike.%${loc}%,postcode.ilike.${loc}%`);
            if (sqParsed.filters.regionPostcodes) {
              q = q.or(regionPostcodeOrClause(sqParsed.filters.regionPostcodes));
            }
            // UI-supplied town/postcode + radius from the catalogue page
            // dropdowns. The header comment above always promised this was
            // applied here — it wasn't, so AI search silently ignored the
            // user's location dropdowns for the main candidate pool. Tier 2
            // (wildcard) intentionally relaxes past it, and the relaxation
            // note tells the AI to say "no matches in your area".
            q = applyUiLoc(q);
          }

          // Up the limit to 800 — Layer 2 (Gemini) gets a wider candidate pool to
          // reason over so semantic concepts (title-split, HMO, refurb, etc.)
          // can be recognised even when the database doesn't tag them.
          return q.order(sortCol, { ascending: false, nullsFirst: false }).limit(800);
        },
        sort: (a, b) => {
          // Mirror per-query order: sortCol desc, nulls last. Re-applied after
          // the merge so the union is precisely sorted before slicing.
          const av = a[sortCol]; const bv = b[sortCol];
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          return bv - av;
        },
        limit: 800,
      });
    }

    const TIER_LABELS = ['strict', 'location-only', 'wildcard'];
    let lotRows = null, lotErr = null, searchTier = 0;
    for (let tier = 0; tier <= 2; tier++) {
      const { data, error } = await buildLayer1Query(tier);
      if (error) { lotErr = error; break; }
      if (data && data.length > 0) { lotRows = data; searchTier = tier; break; }
    }
    if (searchTier > 0) log.info('smart-search relaxed filters', { from: 'strict', to: TIER_LABELS[searchTier], query, results: lotRows?.length || 0 });

    // ── Free-text recall pool ──
    // Unrecognised words ("sheldon", "stella croft" — suburbs, streets, any
    // term not in the known-locations set) are deliberately NOT Layer-1
    // filters, so lots matching them only reached the AI if they happened to
    // rank inside the top-800-by-score pool — usually they didn't, and the AI
    // saw zero relevant lots. Fetch lots that literally mention the terms and
    // put them FIRST in the candidate pool so Layer 2 always sees them.
    let freeTextRows = [];
    if (sqParsed.freeText.length > 0) {
      const ftOr = sqParsed.freeText.slice(0, 5)
        .map(t => `address.ilike.%${t}%,postcode.ilike.${t}%,search_text.ilike.%${t}%`)
        .join(',');
      const { data: ftData, error: ftErr } = await getLotsForCatalogues(supabase, activeCatalogues, {
        select: LOTS_SELECT,
        applyFilters: (q) => {
          q = applyStatusFilter(q);
          q = applyUiLoc(q);
          q = q.or(ftOr);
          return q.order(sortCol, { ascending: false, nullsFirst: false }).limit(200);
        },
        limit: 200,
      });
      if (ftErr) log.warn('smart-search freetext pool query failed', { err: ftErr.message });
      freeTextRows = ftData || [];
      if (freeTextRows.length) log.info('smart-search freetext pool', { terms: sqParsed.freeText, extra: freeTextRows.length });
    }

    // ── Also include persisted unsold lots from expired catalogues (30-day window) ──
    let unsoldExtra = [];
    if (effectiveSold === 'unsold' || effectiveSold === 'all' || sf === 'everything') {
      const unsoldCutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      // Honour an explicit 'unsold' filter — withdrawn lots are not unsold,
      // and in the no-AI fallback paths this pool is served to users directly.
      let unsoldQuery = supabase.from('lots').select(LOTS_SELECT)
        .in('status', effectiveSold === 'unsold' ? ['unsold'] : ['unsold', 'withdrawn'])
        .gte('auction_date', unsoldCutoff);
      // Apply same hard filters to unsold lots
      if (sqParsed.filters.tenure) unsoldQuery = unsoldQuery.ilike('tenure', sqParsed.filters.tenure);
      if (sqParsed.filters.maxPrice) unsoldQuery = unsoldQuery.lte('price', sqParsed.filters.maxPrice);
      if (sqParsed.filters.minPrice) unsoldQuery = unsoldQuery.gte('price', sqParsed.filters.minPrice);
      if (sqParsed.filters.beds) unsoldQuery = unsoldQuery.gte('beds', sqParsed.filters.beds);
      if (sqParsed.filters.condition) unsoldQuery = unsoldQuery.in('condition', sqParsed.filters.condition);
      for (const loc of sqParsed.locationTerms) unsoldQuery = unsoldQuery.or(`address.ilike.%${loc}%,postcode.ilike.${loc}%`);
      if (sqParsed.filters.regionPostcodes) unsoldQuery = unsoldQuery.or(regionPostcodeOrClause(sqParsed.filters.regionPostcodes));
      unsoldQuery = applyUiLoc(unsoldQuery);
      // Apply same concept/soft OR clauses
      if (allOrClauses.length > 0) unsoldQuery = unsoldQuery.or(allOrClauses.join(','));
      unsoldQuery = unsoldQuery.order(sortCol, { ascending: false, nullsFirst: false }).limit(200);
      const { data: unsoldRows } = await unsoldQuery;
      unsoldExtra = unsoldRows || [];
    }

    if (lotErr) {
      log.error('smart-search lots query failed', { error: lotErr.message });
      await refundSearchCounter();
      return res.status(500).json({ error: 'db_error', message: 'Database query failed.' });
    }

    // Merge free-text matches (first, so they survive the AI-pool slice) +
    // active + persisted unsold, dedup by URL
    const allRows = [...freeTextRows.map(dbRowToLot), ...(lotRows || []).map(dbRowToLot), ...unsoldExtra.map(dbRowToLot)];
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
    // Note: progressive relaxation above almost guarantees filteredLots > 0.
    // If we're STILL at 0 here, the catalogue genuinely has no lots in the
    // requested status — return a clear message but don't pretend to search.
    if (filteredLots.length === 0) {
      await incrementSearchCounter();
      return res.json({ results: [], report: 'No auction lots are available in the current catalogue. The next scrape will run shortly.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
    }

    // Always send to Gemini — Layer 2 is the semantic interpreter, not a ranker.
    // Wider candidate pool (was 200) so the LLM has more lots to reason over
    // when interpreting concept queries like "freehold multi unit block to split".
    const geminiLots = filteredLots.slice(0, 400);
    _l1Pool = geminiLots; _l1Sources = sources; _l1Total = totalSearched;
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
        (l.dealSignals || []).includes('hmo') ? 'HMO' : '',
        (l.dealSignals || []).includes('investment-valuation') ? 'INVESTMENT_VALUATION' : '',
        l.statedIncomePa ? `Income:£${l.statedIncomePa}pa(${l.incomeKind || 'stated'})` : '',
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

    // If hard filters narrowed to 0, tell the AI so the report can explain.
    // 3-tier ladder: strict / location-only / wildcard.
    const relaxationNote = searchTier === 0 ? '' :
      searchTier === 1 ? '\nNOTE: No lots matched the user\'s exact constraints (price/beds/tenure/type). The lots below match the user\'s LOCATION + STATUS only — be honest in the report ("no exact matches for your filters") and rank as alternatives.' :
      '\nNOTE: No lots matched the user\'s area at all. Showing top-scored available lots from the wider catalogue — say "no matches in your area" and suggest reviewing these alternatives.';

    const responseText = await callAI(`You are a UK property investment analyst with deep knowledge of property strategies (title-split, HMO conversion, BTL, refurb-and-flip, deal stacking, multi-unit freeholds, GDV uplift, planning gain, lease extension arbitrage, etc.).

USER'S SEARCH QUERY: "${query}"
${soldInstruction}${filterNote}${conceptNote}${relaxationNote}

YOUR JOB IS SEMANTIC INTERPRETATION, NOT KEYWORD MATCHING.
The database has done minimal pre-filtering — only the user's EXPLICIT measurable constraints (status, location, hard price/beds/tenure) have been applied. The candidate pool below intentionally INCLUDES lots that don't literally contain the user's words. YOU are responsible for using your understanding of property investment to find lots that fit the user's INTENT.

Examples of how to interpret intent:
- "freehold multi unit block to title split" → look for tenure=Freehold + descriptions of multiple flats/units (e.g. "investment of 4 self-contained flats", "freehold building with 6 apartments", "5 units producing £X rent"). Do NOT require literal words "title split" or "block".
- "HMO opportunity" → 4+ bed houses, large terraces near universities/hospitals, properties described as "currently let on AST" or "convertible".
- "buy to let in good rental area" → properties with existing tenants, decent yields, addresses in known rental hotspots.
- "needs work for flip" → "in need of modernisation", "scope for improvement", repossessions, vacant possession in below-market areas.
- "development opportunity" → land with planning, properties with planning history, sites with PD potential, anything described as "development potential".

Be generous when the search_text describes the concept in different words. Be skeptical when the search_text doesn't support the user's intent at all.

Lots (top ${geminiLots.length} of ${totalSearched} by investment score; status+location filtered, semantic concepts NOT pre-filtered):
${lotSummaries}

Respond in this exact JSON format (and nothing else):
{"indices":[0,5,12],"report":"Your investment commentary..."}

Pick the indices of lots that genuinely match the user's INTENT — quality over quantity. Aim for 5-30 picks for a typical query; fewer if matches are weak. HARD LIMIT: never return more than 40 indices — if more lots match, pick the best 40 and say in the report that more matches exist. The report (2 short paragraphs) should: (1) summarise what was found, (2) call out standout lots with their investment angle, (3) honestly note if the user's exact concept couldn't be matched and what was returned instead.`, { tier: 'fast', maxTokens: 8000, taskType: 'search', userId: user.id });
    log.info('smart_search_full', { tier: 'fast', preFiltered: totalSearched, sentToAI: geminiLots.length, relaxationTier: TIER_LABELS[searchTier] });

    const aiParsed = parseAIResponse(responseText);
    if (aiParsed.salvaged) {
      log.warn('smart-search AI response salvaged (truncated/malformed JSON)', { indices: aiParsed.indices.length, raw: responseText.substring(0, 200) });
    }
    if (!aiParsed.report) aiParsed.report = 'Search completed.';

    let matchingLots = (aiParsed.indices || [])
      .filter(i => i >= 0 && i < geminiLots.length)
      .map(i => geminiLots[i]);

    // Fallback: if the AI returned nothing, return the TOP of the pre-filtered
    // pool — capped. Previously this dumped the entire 400-lot candidate pool
    // ("freehold blocks" → 400 "matches" on 2026-06-28), which reads as a
    // broken search. 40 top-scored candidates with an honest report is useful.
    if (matchingLots.length === 0) {
      matchingLots = geminiLots.slice(0, 40);
      log.info('smart-search ai-empty-fallback', { returning: matchingLots.length, poolSize: geminiLots.length });
      if (!aiParsed.report || aiParsed.report === 'Search completed.') {
        aiParsed.report = `The AI couldn't pinpoint exact matches for "${query}", so here are the top ${matchingLots.length} candidates (of ${totalSearched} searched) that fit your filters, sorted by investment score.`;
      }
    }

    // Strip _searchText from response (large, not needed by frontend)
    for (const lot of matchingLots) delete lot._searchText;

    await incrementSearchCounter();
    logActivityEvent('smart_search', { query, results_count: matchingLots.length, mode: 'db_plus_ai', preFiltered: totalSearched }, user?.email, getClientIP(req));

    // Cache the result for repeat queries
    const _smResponseData = { results: matchingLots, report: aiParsed.report || '', sources, totalSearched };
    _smartSearchCache.set(_smCacheKey, { result: _smResponseData, timestamp: Date.now() });

    return res.json({
      ..._smResponseData, searchesUsed, searchLimit,
    });
  } catch (err) {
    const msg = err.message || String(err);
    log.error('Smart search error', { error: msg, status: err.status, stack: err.stack?.split('\n').slice(0, 3).join(' | ') });

    const quotaShaped = err.status === 429 || /quota|rate.limit|resource.exhausted/i.test(msg);
    // Latch the global flag only when Gemini is the sole provider. With a
    // fallback chain this catch means every provider failed *this request*
    // — transient, so latching would wrongly lock ALL users out for an hour
    // (2026-07-06 prod incident: one failed search blanked AI search fleet-wide).
    const geminiOnly = !hasAIFallback();
    if (quotaShaped && geminiOnly) { setCreditExhausted(true); setCreditExhaustedAt(Date.now()); }

    // Graceful degradation: if Layer 1 completed, the error came from the AI
    // stage — serve the score-ranked DB pool with an honest report rather
    // than failing the whole search (2026-07-06: both providers quota-dead
    // turned every search into a 503 despite 954 matching lots in hand).
    if (_l1Pool && _l1Pool.length) {
      const results = _l1Pool.slice(0, 40);
      for (const lot of results) delete lot._searchText;
      await incrementSearchCounter();
      log.warn('smart-search degraded: AI unavailable, serving Layer-1 results', { results: results.length, of: _l1Total, error: msg.substring(0, 120) });
      logActivityEvent('smart_search', { query, results_count: results.length, mode: 'degraded_layer1' }, user?.email, getClientIP(req));
      return res.json({
        results,
        report: `AI ranking is temporarily unavailable, so these are the top ${results.length} of ${_l1Total} lots matching your search filters, sorted by investment score. Try again later for AI-refined results.`,
        sources: _l1Sources || [], totalSearched: _l1Total, searchesUsed, searchLimit, degraded: true,
      });
    }

    // No results were served (degraded path above didn't fire) — the search
    // failed outright, so refund the upfront quota charge.
    await refundSearchCounter();
    if (quotaShaped) {
      return res.status(503).json({
        error: 'ai_quota_exhausted',
        message: geminiOnly
          ? 'AI rate limit hit. Auto-resets after 1 hour.'
          : 'AI search is temporarily over capacity. The standard filters still work — please try again later.',
        provider: process.env.AI_PROVIDER || 'gemini', tier: 'fast',
      });
    }
    if (err.status === 401 || err.status === 403 || /invalid.api.key|unauthorized|forbidden/i.test(msg)) {
      return res.status(500).json({ error: 'key_invalid', message: 'AI API key is invalid or expired. Check environment variables in Railway.', provider: process.env.AI_PROVIDER || 'gemini' });
    }
    return res.status(500).json({ error: 'api_error', message: 'Smart search failed.', detail: msg, provider: process.env.AI_PROVIDER || 'gemini', tier: 'fast' });
  }
}));

// ═══════════════════════════════════════════════════════════════
// API: ALL LOTS — pre-load every cached lot for frontend filtering
// ═══════════════════════════════════════════════════════════════
// In-memory response cache. The pipeline below takes 3-4s per call against
// Supabase; without this cache, INITIAL_SESSION repeats and cross-tab opens
// caused dozens of redundant runs. Auction data refreshes once nightly via
// autoAnalyseAll at 03:00 UK, so a long TTL is safe — invalidate manually
// after scrape completion via invalidateAllLotsCache() if needed.
const _allLotsCache = new Map(); // key = `${signed|anon}:${past|future}` → { body, etag, ts }
const ALL_LOTS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

export function invalidateAllLotsCache() {
  _allLotsCache.clear();
  log.info('all-lots cache invalidated');
}

// Pure compute: builds the all-lots response payload + ETag for a given
// (isSignedIn, includePast) pair. No HTTP concerns — used by both the route
// handler and warmAllLotsCache(). Returns { body, etag } always; etag is null
// when the response is the trivial-empty shape (no need to cache).
async function buildAllLotsResponse({ isSignedIn, includePast }) {
  const emptyBody = { lots: [], sources: [], stripeEnabled: STRIPE_ENABLED };
  if (!supabase) return { body: emptyBody, etag: null };

  // ── Step 1: Get active catalogue URLs from cached_analyses ──
    let { data: activeCatalogues, error: catErr } = await supabase
      .from('cached_analyses')
      .select('url, house, created_at')
      .gt('expires_at', new Date().toISOString());

    if (catErr) { log.error('all-lots: cached_analyses query failed', { error: catErr.message }); return { body: emptyBody, etag: null }; }

    // Resilience fallback: when cached_analyses is unhealthy (wiped, mostly
    // expired, or many houses failed today's scrape and didn't refresh their
    // entries) we'd otherwise serve a thin slice of the catalogue to users.
    // Instead, fall back to the lots table directly — serve every lot scraped
    // in the last 14 days, and synthesize active-catalogue rows from their
    // catalogue_url values so the rest of the pipeline (sources array, dedup,
    // scoring) is unchanged. Auto-analyse will repopulate cached_analyses
    // naturally.
    //
    // Threshold raised 2026-05-06 from === 0 to < 50: with 167 known houses,
    // a healthy state has ~150 active rows. 12 active means most catalogues
    // expired without being refreshed (the failure mode we hit on 2026-05-06
    // when Bristol search returned 2 lots out of ~78 available BS-postcode
    // lots in the lots table). 50 is a generous floor — well below normal
    // healthy state, well above pathological "almost everything expired".
    const ACTIVE_CATALOGUES_FLOOR = 50;
    let usedFallback = false;
    let fallbackLotRows = null;
    if (!activeCatalogues || activeCatalogues.length < ACTIVE_CATALOGUES_FLOOR) {
      log.warn('all-lots: cached_analyses unhealthy — using lots-table fallback (last 14d)', {
        isSignedIn, includePast,
        activeCount: activeCatalogues?.length || 0,
        floor: ACTIVE_CATALOGUES_FLOOR,
      });
      const fbCutoff = new Date(Date.now() - 14 * 86400000).toISOString();
      const { data: fbRows, error: fbErr } = await supabase
        .from('lots').select(LOTS_SELECT)
        .gte('last_seen_at', fbCutoff)
        .limit(5000);
      if (fbErr || !fbRows || fbRows.length === 0) {
        log.error('all-lots: fallback query failed', { error: fbErr?.message, rows: fbRows?.length || 0 });
        return { body: emptyBody, etag: null };
      }
      fallbackLotRows = fbRows;
      const catMap = new Map();
      for (const r of fbRows) {
        if (r.catalogue_url && !catMap.has(r.catalogue_url)) {
          catMap.set(r.catalogue_url, { url: r.catalogue_url, house: r.house, created_at: r.last_seen_at });
        }
      }
      activeCatalogues = [...catMap.values()];
      usedFallback = true;
    }

    const activeUrls = [...new Set(activeCatalogues.map(c => normaliseUrl(c.url)))];

    // ── Step 2: Run independent queries in parallel ──
    const unsoldCutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    // Upper bound for the status side-queries: excludes sentinel-dated rows
    // (always_on houses stamp 2099-12-31) which otherwise sort first under
    // `order auction_date desc` and eat the row cap with stale zombies —
    // same class of leak the 2026-07-03 get_active_lots sentinel guard fixed.
    const dateHorizon = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);

    // Always call get_active_lots — after the 2026-05-06 RPC rewrite (Fix B,
    // see migrations/2026-05-06-rewrite-get-active-lots-rpc.sql) the RPC
    // queries the lots table directly with a status + last_seen_at filter,
    // bypassing cached_analyses. The fallback's lot-fetch is now redundant
    // (and worse — Supabase REST defaults cap fallback at ~1000 rows). The
    // fallback STILL runs to synthesize activeCatalogues for the `sources`
    // array, but we no longer use its lot rows.
    const [lotResult, unsoldResult, soldResult, calendarResult, skillsResult] = await Promise.all([
      supabase.rpc('get_active_lots'),
      supabase.from('lots').select(LOTS_SELECT)
        .in('status', ['unsold', 'withdrawn'])
        .gte('auction_date', unsoldCutoff)
        .lte('auction_date', dateHorizon)
        .limit(1000),
      // Sold/STC within the same 30-day window. The LOT STATUS dropdown has
      // offered "Sold" / "Sale Agreed" / "All (inc. sold)" since launch, but
      // these rows never shipped — all three options silently returned an
      // empty grid (2026-07-06 audit). Own query + cap so heavy sold volume
      // can't crowd the unsold/withdrawn feed out of its 1000-row cap.
      supabase.from('lots').select(LOTS_SELECT)
        .in('status', ['sold', 'stc'])
        .gte('auction_date', unsoldCutoff)
        .lte('auction_date', dateHorizon)
        .order('auction_date', { ascending: false })
        .limit(1000),
      supabase.from('auction_calendar').select('url, date').gte('date', weekAgo),
      supabase.from('house_skills').select('slug, logo_url').not('logo_url', 'is', null),
    ]);

    const { data: lotRows, error: lotErr } = lotResult;
    const { data: unsoldRows } = unsoldResult;
    const { data: soldRows } = soldResult;

    if (lotErr) {
      log.error('all-lots: get_active_lots RPC failed', { error: lotErr.message });
      return { body: emptyBody, etag: null };
    }

    if (!lotRows || lotRows.length === 0) {
      return { body: emptyBody, etag: null };
    }

    // Merge unsold + sold lots, avoiding duplicates with active catalogue lots
    const activeLotKeys = new Set((lotRows || []).map(r => `${r.house}|${r.url}`));
    const extraUnsold = (unsoldRows || []).filter(r => !activeLotKeys.has(`${r.house}|${r.url}`));
    const extraSold = (soldRows || []).filter(r => !activeLotKeys.has(`${r.house}|${r.url}`));

    const allLotRows = [...(lotRows || []), ...extraUnsold, ...extraSold];
    const rawTotal = allLotRows.length;
    log.info('all-lots query', { activeCatalogues: activeCatalogues.length, activeLots: (lotRows || []).length, persistedUnsold: extraUnsold.length, persistedSold: extraSold.length, rawLotCount: rawTotal });

    // ── Step 3: Map snake_case DB columns → camelCase frontend format ──
    const lots = allLotRows.map(r => ({
      _house: r.house,
      auctioneer: r.auctioneer,
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
      // images JSONB array — populated by multi-image-sweep cron. Frontend's
      // card-carousel branch (public/app.js) only renders when this is a
      // length-2+ array; otherwise it falls back to the single image_url.
      images: Array.isArray(r.images) ? r.images : [],
      // floor_plan_url → floor_plans[] (lean rebuild). floorPlanUrl kept as
      // the first-plan alias for public/app.js's gallery branch.
      floorPlans: Array.isArray(r.floor_plans) ? r.floor_plans : [],
      floorPlanUrl: (Array.isArray(r.floor_plans) && r.floor_plans[0]) || null,
      bullets: r.bullets || [],
      units: r.units || 0,
      // Null the always-on / timed-house sentinel (2099-12-31) at source so no
      // downstream render shows a bogus "31 December 2099" date or clusters
      // 69% of active lots under a 2099 divider under SOONEST FIRST (2026-07-07
      // audit). No-date semantics are correct for these — they're perpetually
      // live. Safe: get_active_lots already gates 'available' on last_seen>7d,
      // so the 14-day stale-synth block below never fires on these rows.
      _auctionDate: (r.auction_date && r.auction_date > '2098-01-01') ? null : r.auction_date,
      status: r.status,
      epcRating: r.epc_rating,
      epcScore: r.epc_score,
      floorAreaSqm: r.floor_area_sqm ?? null,
      floodZone: r.flood_zone,
      floodRiskLevel: r.flood_risk,
      // street_avg → comparable_price (lean rebuild). streetAvg kept as alias
      // for public/app.js; street_sales (raw array) dropped.
      comparablePrice: r.comparable_price,
      streetAvg: r.comparable_price,
      streetSalesCount: r.street_sales_count,
      belowMarket: r.below_market,
      estMonthlyRent: r.est_monthly_rent,
      // est_annual_rent dropped — derived on read.
      estAnnualRent: r.est_monthly_rent != null ? r.est_monthly_rent * 12 : null,
      estGrossYield: r.est_gross_yield != null ? parseFloat(r.est_gross_yield) : null,
      score: r.score != null ? parseFloat(r.score) : null,
      scoreBreakdown: r.score_breakdown || [],
      opps: r.opps || [],
      risks: r.risks || [],
      dealType: r.deal_type,
      // deal-signal layer (3.4.0). Defensive defaults: the RPC only returns
      // these after the 2026-07-13 republish, and rows keep NULL until their
      // next scoring pass.
      dealSignals: Array.isArray(r.deal_signals) ? r.deal_signals : [],
      statedIncomePa: r.stated_income_pa ?? null,
      incomeKind: r.income_kind || null,
      vacant: r.vacant,
      titleSplit: r.title_split,
      valueEstimate: r.value_estimate || null,
      _dbId: r.id,  // lots-table UUID → mobile drawer ?lot= URL state + SSR /lot/:id deep-link (active lots need l.id in get_active_lots — see 2026-06-25 migration)
      _lat: r.lat != null ? parseFloat(r.lat) : null,
      _lng: r.lng != null ? parseFloat(r.lng) : null,
      _lastSeenAt: r.last_seen_at || null,
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
    // Use pre-fetched calendar data from parallel query (Step 2)
    const calRows = calendarResult.data;
    if (calRows) for (const a of calRows) {
      const nu = normaliseUrl(a.url);
      if (nu && a.date && (!urlDateMap[nu] || a.date < urlDateMap[nu])) urlDateMap[nu] = a.date;
    }
    // Fallback calendar overlay
    for (const a of FALLBACK_CALENDAR) {
      const nu = normaliseUrl(a.url);
      if (!urlDateMap[nu] || a.date < urlDateMap[nu]) urlDateMap[nu] = a.date;
    }
    for (const lot of lots) {
      // Per-lot end date from bullets takes priority. Handles both EIG
      // timed-auction "Auction Ends: DD/MM/YYYY" and EIG white-label
      // "20 May 2026 LIVE ONLINE AUCTION" / "MAY LIVE ONLINE AUCTION"
      // formats — see lib/utils.js#parseAuctionDateFromBullet.
      const lotEndDate = findAuctionDateInBullets(lot.bullets);
      if (lotEndDate) {
        lot._auctionDate = lotEndDate;
      } else if (!lot._auctionDate) {
        // Fallback to calendar lookup only if lots table didn't have a date
        const su = normaliseUrl(lot._sourceUrl);
        const rawDate = urlDateMap[su] || null;
        lot._auctionDate = (rawDate && rawDate > '2098-01-01') ? null : rawDate;
      }
    }

    // ── Staleness fallback (Issue 2 fix (c)) ──
    // Lots with no auction_date (source doesn't publish one, no calendar row,
    // no EIG "Auction Ends:" bullet) get stuck rendering as live forever. If
    // we haven't re-seen a lot in 14+ days, synthesise an end-date from its
    // last_seen_at so the "Auction ended" badge fires and the default
    // future-only filter can exclude it. Read-time only — no DB mutation.
    const STALE_GRACE_MS = 14 * 86400000;
    const staleCutoff = Date.now() - STALE_GRACE_MS;
    let staleSynth = 0;
    for (const lot of lots) {
      if (lot._auctionDate || !lot._lastSeenAt) continue;
      const seenMs = Date.parse(lot._lastSeenAt);
      if (!Number.isFinite(seenMs) || seenMs >= staleCutoff) continue;
      lot._auctionDate = new Date(seenMs + STALE_GRACE_MS).toISOString().slice(0, 10);
      lot._auctionDateSource = 'stale_synth';
      staleSynth++;
    }
    if (staleSynth > 0) log.info('all-lots: stale-synth dates', { count: staleSynth, graceDays: 14 });

    // ── Server-side future-only filtering (no grace period) ──
    // Default view hides any lot whose auction date is strictly in the past.
    // Today's auctions are still shown (auction is live during the day).
    // Users opt back in to past auctions via the "Show past auctions" checkbox
    // in index.html (#fShowPast → ?includePast=true). Lots with no auction date
    // (source doesn't publish one and stale-synth hasn't fired yet) are kept —
    // hiding them would silently drop legitimate undated catalogues.
    if (!includePast) {
      const cutoffStr = new Date().toISOString().slice(0, 10);
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
        // Prefer an actionable listing over an ended one: a relisted lot must
        // not be shadowed by its own sold/stc/withdrawn record from a prior
        // auction (matters now sold/stc rows ship for the status dropdown).
        // Within the same class, keep the soonest auction date as before.
        const ENDED_STATUSES = ['sold', 'stc', 'withdrawn'];
        const entryEnded = ENDED_STATUSES.includes(entry.lot.status);
        const lotEnded = ENDED_STATUSES.includes(lot.status);
        if (entryEnded !== lotEnded) {
          if (entryEnded) entry.lot = lot;
        } else {
          const entryDate = entry.lot._auctionDate || '9999-12-31';
          const lotDate = lot._auctionDate || '9999-12-31';
          if (lotDate < entryDate) entry.lot = lot;
        }
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

    // Sanitise image URLs — strip junk images (logos, council branding, ad trackers, placeholders).
    // `\.ico` catches favicon files even when the URL says `fav.ico` rather than `favicon`
    // (e.g. cdnx.livechatinc.com/website/media/img/fav.ico — auctionhousenorthwales had one of these).
    const junkImg = /logo|icon|\.svg|\.ico(\?|$|#)|favicon|livechatinc\.com|banner|flannels|kirklees|\brdw\b|council\.gov|\.gov\.uk\/|googleads|doubleclick|spacer|pixel|1x1|placeholder|no-image|noimage|spinner|badge|modal\.png|_NYC\.|_LCC\.|_BMDC\.|Unit[ie]*d?_?Utilit|Cardwells|themes\/.*assets\/images\/|download_\(\d+\)\./i;
    let imgStripped = 0;
    let imgUnclosed = 0;
    for (const lot of cleanLots) {
      // Strip stray trailing `)` from markdown-link extraction bleed (e.g. buttersjohnbee JWT URLs
      // where `[image](https://…token)` lost the leading bracket but kept the closing paren).
      if (lot.imageUrl && typeof lot.imageUrl === 'string' && /\)+$/.test(lot.imageUrl) && !/\(/.test(lot.imageUrl)) {
        lot.imageUrl = lot.imageUrl.replace(/\)+$/, '');
        imgUnclosed++;
      }
      if (lot.imageUrl && junkImg.test(lot.imageUrl)) { lot.imageUrl = undefined; imgStripped++; }
    }
    if (imgStripped > 0) console.log(`Image sanitiser: stripped ${imgStripped} junk images`);
    if (imgUnclosed > 0) console.log(`Image sanitiser: trimmed ${imgUnclosed} stray trailing ')'`);

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

    // 6b. Batch relist verification for unsold lots
    const unsoldLots = cleanLots.filter(l => l.status === 'unsold' && l._auctionDate);
    if (unsoldLots.length > 0) {
      const normAddr = (addr) => (addr || '').toLowerCase().replace(/[\s,]+/g, ' ')
        .replace(/^(lot\s*\d+\s*[-:]?\s*)/i, '').trim();

      const unsoldAddrs = unsoldLots.map(l => ({
        lot: l,
        house: l._house,
        addr: normAddr(l.address),
        date: l._auctionDate
      })).filter(x => x.addr.length > 5);

      if (unsoldAddrs.length > 0) {
        const houses = [...new Set(unsoldAddrs.map(x => x.house))];
        const minDate = unsoldAddrs.reduce((min, x) => x.date < min ? x.date : min, '9999-12-31');
        const { data: newerLots } = await supabase
          .from('lots')
          .select('house:house_slug, address, auction_date, status')
          .in('house', houses)
          .in('status', ['sold', 'stc', 'available'])
          .gte('auction_date', minDate);

        if (newerLots?.length) {
          const newerMap = new Map();
          for (const nl of newerLots) {
            const key = `${nl.house}|${normAddr(nl.address)}`;
            const existing = newerMap.get(key);
            if (!existing || nl.auction_date > existing.auction_date) {
              newerMap.set(key, nl);
            }
          }

          let relistCount = 0;
          for (const { lot, house, addr, date } of unsoldAddrs) {
            const key = `${house}|${addr}`;
            const newer = newerMap.get(key);
            if (newer && newer.auction_date > date) {
              lot._relistStatus = newer.status;
              // sold_price dropped (lot_events-completion); relist price now
              // lives in lot_events (lot_sold_price_set) / lot_history_archive.
              lot._relistDate = newer.auction_date;
              relistCount++;
            }
          }
          if (relistCount > 0) log.info('relist-verification', { unsold: unsoldLots.length, relisted: relistCount });
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

    // Directory data: free for all, but the AI analysis layer requires signup.
    // Anonymous users see address/price/image/house — plus an HMO teaser (the
    // deal-type badge/tag/filter) — but not scores/opps/risks/income/yield.
    // See applyAnonTeaserGate for the exact reveal/gate line.
    if (!isSignedIn) {
      for (const lot of cleanLots) applyAnonTeaserGate(lot);
    } else {
      for (const lot of cleanLots) { delete lot.blurred; }
    }
    // ── House logos from pre-fetched house_skills (Step 2 parallel query) ──
    const uniqueHouses = new Set(sources.map(s => s.house));
    let houseMeta = {};
    const skills = skillsResult.data;
    if (skills) {
      for (const s of skills) houseMeta[s.slug] = { logoUrl: s.logo_url };
    }

    // ── ETag: skip full response if client already has this data ──
    // IMPORTANT: include the signed-in flag in the hash. Anon responses strip
    // score/dealType/opps/risks while signed-in responses include them, so two
    // states with the same lots produce different payloads. Without this, a
    // signed-in user whose browser cached the anon ETag gets 304 and keeps
    // seeing "Sign up for AI scores" / "Sign up for deal type" stubs.
    // Hash the FULL serialised lot payload, not just url+status. The old hash
    // ignored price, auction_date, images, score, address, beds, EPC, etc., so
    // a lot whose guide price changed (url+status unchanged) kept its ETag and
    // the browser was served 304 → the user saw a stale price indefinitely
    // (2026-07-07 audit). JSON.stringify over the already-built cleanLots is
    // cheap here — this runs only on a cache miss / warm-loop rebuild.
    const etag = '"' + createHash('md5')
      .update((isSignedIn ? 'signed:' : 'anon:') + cleanLots.length + ':' + JSON.stringify(cleanLots))
      .digest('hex') + '"';

    const body = {
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
    };

    return { body, etag };
}

// Pre-warm the cache for both visitor variants. Called from server.js on boot
// and on a periodic interval to keep the cache continuously hot — first
// visitor never pays the ~3-4s pipeline cost.
export async function warmAllLotsCache() {
  for (const includePast of [false]) {
    for (const isSignedIn of [false, true]) {
      try {
        const started = Date.now();
        const { body, etag } = await buildAllLotsResponse({ isSignedIn, includePast });
        if (etag) {
          const key = (isSignedIn ? 'signed' : 'anon') + ':' + (includePast ? 'past' : 'future');
          _allLotsCache.set(key, { body, etag, ts: Date.now() });
          log.info('all-lots cache warmed', { key, ms: Date.now() - started, lots: body.lots?.length || 0 });
        }
      } catch (e) {
        log.warn('all-lots cache warm failed', { isSignedIn, err: e.message });
      }
    }
  }
}

router.get('/api/all-lots', rateLimit(60000, 30), async (req, res) => {
  try {
    const includePast = req.query.includePast === 'true';
    const user = await validateUserFromReq(req);
    const adminToken = req.headers['x-admin-secret'] || '';
    const isAdmin = process.env.ADMIN_SECRET && safeCompare(adminToken, process.env.ADMIN_SECRET);
    const isSignedIn = !!user || isAdmin;

    // Anonymous responses are identical for everyone — let browsers/CDN
    // hold them briefly instead of every visitor hitting origin (ETag alone
    // still costs a full round-trip per page view; Phase 5 review). Signed-in
    // responses stay private: the payload varies with tier/gating.
    const setCacheHeaders = () => {
      res.set('Cache-Control', isSignedIn
        ? 'private, no-cache'
        : 'public, max-age=120, s-maxage=300, stale-while-revalidate=600');
      res.set('Vary', 'Authorization');
    };

    const cacheKey = (isSignedIn ? 'signed' : 'anon') + ':' + (includePast ? 'past' : 'future');
    const hit = _allLotsCache.get(cacheKey);
    if (hit && (Date.now() - hit.ts) < ALL_LOTS_CACHE_TTL_MS) {
      setCacheHeaders();
      if (req.headers['if-none-match'] === hit.etag) return res.status(304).end();
      res.set('ETag', hit.etag);
      return res.json(hit.body);
    }

    const { body, etag } = await buildAllLotsResponse({ isSignedIn, includePast });
    if (etag) _allLotsCache.set(cacheKey, { body, etag, ts: Date.now() });

    setCacheHeaders();
    if (etag && req.headers['if-none-match'] === etag) return res.status(304).end();
    if (etag) res.set('ETag', etag);
    res.json(body);
  } catch (e) {
    log.error('All lots error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/lots/:id/comps — postcode-level sales + rental comps for one lot ──
// Returns up to 10 nearest sold prices (postcode_sales), up to 10 nearest
// rentals (postcode_rentals), and median/p25/p75 bands for both. The
// frontend lot card consumes this for the "Comparable sales" / "Rental
// estimate" disclosures.
router.get('/api/lots/:id/comps', rateLimit(60000, 60), async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ error: 'invalid_lot_id' });
    }

    // 1. Fetch the lot itself for postcode + propType + beds + price.
    const { data: lot } = await supabase
      .from('lots')
      .select('id, postcode, prop_type, beds, price, address')
      .eq('id', id)
      .maybeSingle();
    if (!lot) return res.status(404).json({ error: 'lot_not_found' });
    if (!lot.postcode) {
      return res.json({
        lot_id: id,
        postcode: null,
        sales: { items: [], stats: null },
        rentals: { items: [], stats: null },
        yield_band: null,
      });
    }

    // 2. Sales + rentals in parallel.
    const [salesResp, rentalsResp] = await Promise.all([
      supabase.from('postcode_sales')
        .select('address, sold_price, sold_date, property_type')
        .eq('postcode', lot.postcode)
        .order('sold_date', { ascending: false })
        .limit(10),
      supabase.from('postcode_rentals')
        .select('source, url, rent_pcm, beds, property_type, is_room_share, scraped_at')
        .eq('postcode', lot.postcode)
        .eq('is_room_share', false)
        .gt('rent_pcm', 0)
        .order('scraped_at', { ascending: false })
        .limit(10),
    ]);

    const sales = salesResp.data || [];
    const rentals = rentalsResp.data || [];

    // 3. Stats per group.
    const sStats = computeStats(sales.map(s => s.sold_price));
    const rStats = computeStats(rentals.map(r => r.rent_pcm));

    // 4. Yield band — annualised rent / lot price, bracketed by the
    //    rental p25/p50/p75. Only meaningful when we have a price + ≥3
    //    rental comps.
    let yieldBand = null;
    if (lot.price && lot.price > 0 && rStats && rStats.count >= 3) {
      const toYield = pcm => Math.round((pcm * 12 / lot.price) * 1000) / 10;
      yieldBand = {
        p25: toYield(rStats.p25),
        median: toYield(rStats.median),
        p75: toYield(rStats.p75),
        sample: rStats.count,
      };
    }

    res.json({
      lot_id: id,
      postcode: lot.postcode,
      prop_type: lot.prop_type,
      beds: lot.beds,
      price: lot.price,
      sales: { items: sales, stats: sStats },
      rentals: { items: rentals, stats: rStats },
      yield_band: yieldBand,
    });
  } catch (e) {
    log.error('lot comps error', { error: e.message, lotId: req.params.id });
    res.status(500).json({ error: 'comps_failed' });
  }
});

// Pure helper — median + quartile + count from a numeric array.
// Defined locally so the endpoint is self-contained.
function computeStats(values) {
  const nums = (values || []).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const at = pct => nums[Math.min(nums.length - 1, Math.floor(nums.length * pct))];
  const median = nums.length % 2 === 0
    ? Math.round((nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2)
    : nums[Math.floor(nums.length / 2)];
  return {
    count: nums.length,
    median,
    p25: at(0.25),
    p75: at(0.75),
    min: nums[0],
    max: nums[nums.length - 1],
  };
}

export default router;
