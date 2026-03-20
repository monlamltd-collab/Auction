# Architecture Patterns

**Domain:** v1.2 feature integration -- feature flags, analytics, landing page, AI abstraction into existing Express monolith
**Researched:** 2026-03-20
**Confidence:** HIGH (all findings from direct codebase inspection)

---

## Current Architecture Summary

```
server.js (~11K lines, Express monolith)
  |-- Supabase (auth + DB: users, cached_analyses, auction_calendar, leads, analytics_snapshots, activity_events, ...)
  |-- Gemini AI (extraction + smart search, direct @google/generative-ai SDK calls)
  |-- Firecrawl / Puppeteer / HTTP (three-tier scraping)
  |-- Stripe (checkout, webhooks, portal -- to be hibernated)

index.html (~79K, SPA with embedded <script>)
  |-- Vanilla JS, no framework
  |-- isPremium() reads window._userTier
  |-- Client-side gating: blur CSS, showPaywall(), CSV/JSON export blocks
  |-- Cross-tab tier sync via localStorage

welcome.html (existing marketing page, "Auction Brain" branding, full SEO markup)
admin.html (admin dashboard)
bridgematch-lite.html (investor finance tool)
```

### Key Architectural Facts from Code Inspection

- **Tier logic is split across server and client.** Server: `getAISearchLimit()` (line 1849), `stripAIFields()` (line 1869), inline `isPremiumOrTrial` checks in `/api/all-lots` (line ~2850) and `/api/analyse` (line ~3244). Client: `isPremium()` function (line 1072), `showPaywall()` (line 1721), `dlCSV()`/`dlJSON()` guards (line 2815).
- **`callGemini()` (line 904)** is a single function called from ~12 locations. Uses `@google/generative-ai` SDK. Model selection via constants `MODEL_FLASH` (gemini-2.5-flash-lite) and `MODEL_PRO` (gemini-2.5-pro). Rate limiter built in (100ms gap, paid Tier 1).
- **Stripe code spans ~400 lines** (lines 1285-1560): 5 endpoints (`/api/stripe/checkout`, `/api/stripe/webhook`, `/api/stripe/portal`, `/api/stripe/status`, `/api/stripe/diag`) plus tier expiry checks scattered in auth flow (`/api/auth/me` lines 1754, 1772).
- **Analytics infrastructure partially exists:** `analytics_snapshots` table (daily pipeline health), `saveDailySnapshot()` (midnight + post-analyse), `logActivityEvent(action, detail, email, ip)` helper (line 11139, writes to `activity_events` table but barely wired up), `/api/admin/analytics` endpoint.
- **`welcome.html` already exists** at `/welcome` route with full SEO markup (title, meta description, OG tags, canonical URL), but branded "Auction Brain" and oriented toward paid product.
- **Tier constants:** `ANON_AI_SEARCH_LIMIT = 3`, `FREE_AI_SEARCH_LIMIT = 5`, `FREE_PREVIEW_LOTS = 6`, `FREE_SCAN_LIMIT = 3`.

---

## Recommended Architecture for v1.2

No structural split of the monolith. All changes are modifications to existing files or small new modules. The monolith constraint is acknowledged and respected.

### Component Map: New vs Modified

| Component | Status | What Changes |
|-----------|--------|-------------|
| `server.js` | MODIFIED | Feature flag logic, tier resolution centralised, analytics event hooks, AI call sites updated |
| `index.html` | MODIFIED | Paywall text changes ("sign in" not "upgrade"), gating logic simplified via server-driven tier |
| `welcome.html` | REWRITTEN | New landing page content with free-first "50% aren't on Rightmove" USP |
| New: `lib/feature-flags.js` | NEW | Centralised feature flag module (~20 lines) |
| New: `lib/ai-provider.js` | NEW | AI provider abstraction layer (~80 lines) |
| Supabase: `analytics_snapshots` | MODIFIED | Add user metric columns (dau, signups, searches, leads) |
| Supabase: `activity_events` | EXISTING | Already exists with `logActivityEvent()` -- wire up at key endpoints |

---

## Integration Pattern 1: Stripe Feature Flag + Free-First Tier

### Problem
Stripe code is scattered across ~15 code paths. Must be hibernated (preserved) not deleted. All signed-in users need full access when Stripe is off.

### Recommended Approach

**Single env var `STRIPE_ENABLED` (default: `false`) with centralised tier resolution.**

```javascript
// lib/feature-flags.js (NEW FILE, ~20 lines)
const FLAGS = {
  STRIPE_ENABLED: process.env.STRIPE_ENABLED === 'true',
};
module.exports = { FLAGS };
```

**The critical change -- centralised tier resolution:**

```javascript
// In server.js near existing tier logic (line ~1840)
function resolveEffectiveTier(user) {
  if (!FLAGS.STRIPE_ENABLED && user) return 'premium';  // Free-first: all signed-in = full access
  if (!user) return 'anon';
  if (user.tier === 'premium') return 'premium';
  if (user.trial_expires_at && new Date(user.trial_expires_at) > new Date()) return 'premium';
  return 'free';
}
```

### All Tier Check Locations (exhaustive from code inspection)

| Location | File | Line | Current Check | Change Needed |
|----------|------|------|---------------|---------------|
| `getAISearchLimit()` | server.js | 1849-1855 | `tier === 'premium'` or active trial | Call `resolveEffectiveTier(user)` |
| `stripAIFields()` | server.js | 1869 | Called when non-premium | Only called when `resolveEffectiveTier` != premium |
| `/api/all-lots` | server.js | ~2850 | Inline `isPremiumOrTrial` | Replace with `resolveEffectiveTier(user) === 'premium'` |
| `/api/analyse` | server.js | ~3244 | Inline `isPremiumOrTrial` | Same |
| `/api/smart-search` | server.js | 3304 | Returns `premium_required` error | Change to `signin_required` when no user |
| `/api/auth/me` | server.js | 1754, 1772 | Checks tier expiry, downgrades to free | When `!STRIPE_ENABLED`, skip tier expiry checks |
| `dlCSV()` / `dlJSON()` | index.html | 2815-2822 | `window._userTier !== 'premium'` | No change needed (server sends tier=premium for signed-in) |
| `showPaywall()` | index.html | 1721 | "Upgrade" messaging | Change text to "Sign in for free" |
| Deal stacking | index.html | 1426+ | `isPremium()` | No change needed (tier=premium from server) |
| Lot card `.blurred` | index.html | 2536 | Based on `lot.blurred` from server | No change needed (server won't set blurred) |

**Key insight:** 4 of the 10 locations need NO client-side changes because `resolveEffectiveTier()` on the server returns `'premium'` for signed-in users, and the existing `/api/auth/me` -> `window._userTier` flow propagates this to the client automatically.

### Stripe Endpoint Guards

Each of the 5 Stripe endpoints gets an early-return guard (code preserved, not deleted):

```javascript
if (!FLAGS.STRIPE_ENABLED) return res.status(503).json({ error: 'payments_hibernated' });
```

### Stripe Initialisation Guard

```javascript
// Line ~44: guard the SDK init
const stripe = FLAGS.STRIPE_ENABLED && process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
```

### Data Flow After Change

```
Anonymous   -> /api/auth/me -> 401 -> prompt "Sign in for free"
Signed-in   -> /api/auth/me -> { tier: 'premium' } -> no blur, unlimited searches
Stripe route -> /api/stripe/* -> 503 "payments_hibernated"
```

### Reactivation Path
Set `STRIPE_ENABLED=true` in Railway, restart. All Stripe code, env vars, and DB columns are preserved.

---

## Integration Pattern 2: Analytics Tracking

### Problem
Need MAU, BridgeMatch funnel, and engagement metrics to pitch lenders at 500-1,000 MAU. No user engagement tracking exists today.

### Existing Infrastructure (already built, barely used)

| Component | Status | Location |
|-----------|--------|----------|
| `logActivityEvent(action, detail, email, ip)` | EXISTS | server.js line 11139 |
| `activity_events` table | EXISTS | Supabase (insert via logActivityEvent) |
| `analytics_snapshots` table | EXISTS | Supabase (pipeline health only) |
| `saveDailySnapshot()` | EXISTS | server.js line 10985 |
| `/api/admin/analytics` | EXISTS | server.js line 11100 |

### Recommended Approach: Wire Up Existing `logActivityEvent()`

The infrastructure is already there. The function exists, the table exists, but it is barely called anywhere. Wire it into key API endpoints.

**Do NOT add Umami, GA, Mixpanel, or any client-side analytics:**
1. Ad blockers strip client-side trackers for 30-40% of tech-savvy users
2. No budget for paid tools
3. Server already sees every API request -- measure there
4. `logActivityEvent()` already exists and works

**Event emission points (add to server.js):**

| Event | Trigger Endpoint | Properties |
|-------|-----------------|------------|
| `signup` | `/api/signup` success | `{ method: 'magic_link' }` |
| `search` | `/api/smart-search` success | `{ query, results_count }` |
| `analyse` | `/api/analyse` success | `{ house, lots_count }` |
| `lead_submit` | `/api/leads` success | `{ source, lender_count }` |
| `page_view` | GET `/`, `/auctions`, `/analyse` | `{ path }` |
| `export` | CSV/JSON export if server-gated | `{ format }` |

Each is a single line addition at the endpoint's success path:
```javascript
logActivityEvent('search', { query: q, results: filteredLots.length }, user?.email, req.ip);
```

**Enhance `saveDailySnapshot()` for user metrics:**

Add columns to `analytics_snapshots`:
```sql
ALTER TABLE analytics_snapshots
  ADD COLUMN IF NOT EXISTS dau integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS signups integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS searches integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leads integer DEFAULT 0;
```

In `saveDailySnapshot()`, query `activity_events` for the day's counts and include in the snapshot.

**MAU query for lender pitch:**
```sql
SELECT COUNT(DISTINCT COALESCE(user_email, ip))
FROM activity_events
WHERE created_at > now() - interval '30 days';
```

### What NOT to Build
- No client-side analytics library
- No real-time dashboard (daily snapshots suffice)
- No session tracking or user journey mapping
- No A/B testing framework

---

## Integration Pattern 3: AI Provider Abstraction

### Problem
`callGemini()` is called from ~12 locations with hardcoded Gemini SDK. Need to audit spend and test cheaper models without rewriting call sites.

### Current Call Sites (exhaustive)

| Caller | Location | Purpose | Model |
|--------|----------|---------|-------|
| `extractLotsWithAI()` | line 5257 | Lot extraction from HTML | FLASH / PRO |
| `/api/smart-search` (delta) | line 3475 | Smart search with delta | FLASH |
| `/api/smart-search` (full) | line 3648 | Smart search full | FLASH |
| PDF extraction | line 5408 | Lots from PDF | PRO |
| Discovery | line 2743 | Find catalogue links | FLASH |
| Discovery (admin) | line 10362 | Admin catalogue discovery | FLASH |
| Auto-analyse | lines 10517, 10620, 10662 | Background extraction | FLASH / PRO |

`callGemini()` signature: `(prompt, { model, maxTokens, systemPrompt, pdfBase64 })` -> `string`

### Recommended Approach

```javascript
// lib/ai-provider.js (NEW FILE, ~80 lines)
const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODELS = {
  flash: process.env.AI_MODEL_FLASH || 'gemini-2.5-flash-lite',
  pro:   process.env.AI_MODEL_PRO   || 'gemini-2.5-pro',
};

// Drop-in replacement for callGemini()
// Key change: 'model' becomes 'role' ('flash' or 'pro')
async function callAI(prompt, { role = 'flash', maxTokens = 8000, systemPrompt = null, pdfBase64 = null } = {}) {
  const model = MODELS[role];
  // ... Gemini implementation (moved from server.js callGemini)
  // Future: switch on process.env.AI_PROVIDER for different backends
}

module.exports = { callAI, MODELS };
```

### Migration (incremental, no behaviour change)

1. Create `lib/ai-provider.js` -- move `callGemini()` logic, rate limiter, and Gemini client init
2. Export `callAI(prompt, { role, maxTokens, systemPrompt, pdfBase64 })`
3. In server.js: `const { callAI } = require('./lib/ai-provider');`
4. Replace ~12 `callGemini(prompt, { model: MODEL_FLASH })` with `callAI(prompt, { role: 'flash' })`
5. Add token usage logging per call (Gemini response includes usage metadata)

### Cost Tracking (the "audit spend" deliverable)

After each `callAI()` call, log token usage via `logActivityEvent()`:
```javascript
logActivityEvent('ai_call', {
  role, model, inputTokens, outputTokens,
  caller: 'smart_search', // or 'extraction', 'discovery'
});
```

Daily cost query:
```sql
SELECT
  detail->>'role' as role,
  SUM((detail->>'inputTokens')::int) as total_input,
  SUM((detail->>'outputTokens')::int) as total_output
FROM activity_events
WHERE action = 'ai_call' AND created_at > now() - interval '1 day'
GROUP BY role;
```

### What NOT to Abstract
- DOM extractors (pure HTML parsing, not AI)
- Prompts (keep near business logic in server.js)
- Rate limiting (stays inside provider module, provider-specific)

---

## Integration Pattern 4: Landing Page

### Problem
Need marketing landing page with "50% aren't on Rightmove" hero. `welcome.html` exists with correct SEO structure but wrong messaging.

### Recommended Approach: Rewrite `welcome.html` Content

Same file, same `/welcome` route, new content. Also change root route to serve landing page.

### Route Change

```javascript
// Explicit root route BEFORE the catch-all (line ~4582)
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'welcome.html'));
});

// Existing routes unchanged
// GET /auctions -> index.html
// GET /analyse  -> index.html
// GET /welcome  -> welcome.html (explicit route, line 4282)

// Catch-all changes: redirect to / instead of serving index.html
app.get('*', (req, res) => { res.redirect(301, '/'); });
```

**Rationale:** New visitors at `auctions.bridgematch.co.uk` should see the value proposition before the tool. Landing page has "Browse Auctions" CTA -> `/auctions`.

### SEO Checklist
- `welcome.html` already has: title, meta description, OG tags, canonical URL, viewport
- Update title to include "UK Auction Property Search"
- Update meta description with "50% aren't on Rightmove" USP
- Add JSON-LD WebApplication schema
- Pure HTML+CSS above fold (fast LCP, no JS dependency)
- Add `robots.txt` to block `/admin`, `/api/*`

### Not a Separate App
Stays as static HTML file served by Express. No SSR, no build step. Consistent with existing pattern (welcome.html, admin.html, bridgematch-lite.html).

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `lib/feature-flags.js` | Centralised flag state from env vars | Imported by server.js at startup |
| `lib/ai-provider.js` | AI API calls, model routing, cost tracking | Imported by server.js, logs to activity_events |
| `resolveEffectiveTier()` | Single source of truth for user access level | Called by all content-gating endpoints |
| `logActivityEvent()` | Analytics event recording (exists, wire up) | Called from endpoints, writes to activity_events |
| `saveDailySnapshot()` | Daily metric aggregation (exists, enhance) | Reads activity_events + cached_analyses, writes analytics_snapshots |
| `welcome.html` | Marketing landing page | Standalone HTML, links to /auctions |

---

## Data Flow: Before and After

### Before (v1.1)
```
Anonymous   -> /api/smart-search -> 3/day -> "Upgrade to Pro"
Free user   -> /api/all-lots     -> blurred after 6 lots -> "Upgrade"
Premium     -> /api/all-lots     -> full access
```

### After (v1.2)
```
Anonymous   -> / (landing page)  -> "Browse Auctions" -> /auctions (full directory, no blur)
            -> /api/smart-search -> 3/day -> "Sign in for free unlimited access"
Signed-in   -> /api/all-lots     -> full access (no blur, no limits)
            -> /api/smart-search -> unlimited
            -> server logs event to activity_events (fire-and-forget)
            -> BridgeMatch -> lead -> leads table
```

---

## Suggested Build Order

Each phase is independently shippable. Order reflects dependencies and risk.

### Phase 1: Feature Flag + Free-First Tier (FOUNDATION -- unblocks everything)

**Scope:**
- New: `lib/feature-flags.js` (~20 lines)
- server.js: `resolveEffectiveTier()` function + replace ~6 inline tier checks + guards on 5 Stripe endpoints + Stripe init guard
- index.html: Change `showPaywall()` messages, hide upgrade button
- Railway: Set `STRIPE_ENABLED=false`

**Why first:** Every other feature assumes free-first gating. Landing page CTAs say "sign in free" not "upgrade." Analytics measure free-first engagement. AI cost decisions assume free access volume.

**Risk:** Medium -- touches many code paths. Mitigated by `resolveEffectiveTier()` centralising all tier logic. Test: signed-in user sees no blur + unlimited searches; anonymous gets 3 searches + sign-in prompt; Stripe endpoints return 503.

**Cross-cutting:** Yes (server + client), but server change drives client automatically via `/api/auth/me` -> `window._userTier`.

### Phase 2: Analytics Event Infrastructure

**Scope:**
- server.js: Add ~7 `logActivityEvent()` calls at endpoints (signup, search, analyse, lead_submit, page_view)
- server.js: Enhance `saveDailySnapshot()` to count DAU/signups/searches/leads from activity_events
- Supabase: Add dau/signups/searches/leads columns to analytics_snapshots
- Supabase: Verify activity_events table indexes

**Why second:** Must be measuring before landing page ships. Provides cost data foundation for AI work.

**Risk:** Low -- purely additive. `logActivityEvent()` is fire-and-forget. No existing behaviour changes.

**Isolation:** Server-only, additive.

### Phase 3: AI Provider Abstraction + Cost Tracking

**Scope:**
- New: `lib/ai-provider.js` (~80 lines)
- server.js: Replace ~12 `callGemini()` calls with `callAI()` calls
- Cost logging: Token usage per call via `logActivityEvent('ai_call', ...)`

**Why third:** Prerequisite for model evaluation. Benefits from analytics infrastructure (Phase 2) for cost data. No user-facing changes.

**Risk:** Medium -- changes AI call path globally. Mitigated by zero behaviour change on initial migration (same Gemini models, same rate limits, just wrapped).

**Isolation:** Backend only. New module + mechanical call site migration.

### Phase 4: Landing Page

**Scope:**
- welcome.html: Full content rewrite with free-first USP
- server.js: Add explicit `GET /` route, change catch-all to redirect
- Optional: new assets in public/

**Why last:** Depends on feature flags (correct CTAs) and analytics (measure from day one). Can be designed in parallel, deploy after Phases 1-2.

**Risk:** Low -- static HTML, minimal routing change.

**Isolation:** Fully isolated.

### Dependency Graph

```
Phase 1: Feature Flags + Free-First Tier
  |
  +-- Phase 2: Analytics (needs tier model settled)
  |     |
  |     +-- Phase 3: AI Abstraction (uses analytics for cost data)
  |
  +-- Phase 4: Landing Page (needs correct CTAs, analytics in place)
```

Phases 2 and 4 can run in parallel after Phase 1.
Phase 3 follows Phase 2.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Scattered Feature Flag Checks
**What:** Adding `if (process.env.STRIPE_ENABLED !== 'true')` in 15 different locations.
**Why bad:** Inconsistent checks, typos, forgotten paths, impossible to audit.
**Instead:** `resolveEffectiveTier()` centralises ALL tier logic. Stripe endpoints get ONE guard each. Flag module reads env once at startup.

### Anti-Pattern 2: Client-Side Tier Enforcement as Security
**What:** Relying on `isPremium()` in index.html to protect data.
**Why bad:** `window._userTier = 'premium'` in console bypasses everything.
**Instead:** Server always gates actual data via `stripAIFields()`. Client checks are UX only. This is already the pattern -- maintain it.

### Anti-Pattern 3: Client-Side Analytics
**What:** Adding Umami, GA, or Mixpanel via `<script>` tags.
**Why bad:** Ad blockers strip ~35% of client-side tracking. Adds external dependency. Budget concern with paid tools.
**Instead:** `logActivityEvent()` already exists server-side. Server sees every API request. Wire it up, not add a new tool.

### Anti-Pattern 4: Building a Full Analytics Platform
**What:** Session tracking, cohort analysis, real-time dashboards, funnels.
**Why bad:** Over-engineering for <100 users. Goal is "MAU number for lender pitch."
**Instead:** `COUNT(DISTINCT user_email) WHERE created_at > '30 days ago'` is the MVP.

### Anti-Pattern 5: Splitting the Monolith
**What:** Extracting server.js into route files, services, etc.
**Why bad:** ~6 months runway, one developer. Shipping features > refactoring.
**Instead:** Extract only `lib/feature-flags.js` and `lib/ai-provider.js`. Everything else stays in server.js.

### Anti-Pattern 6: AI Provider Overengineering
**What:** Plugin registry, capability matrices, automatic fallback chains, streaming.
**Why bad:** 2 model roles, 1 provider. Abstraction enables swapping, not an ecosystem.
**Instead:** Simple `callAI(prompt, { role })`. Adding a provider = one if branch.

### Anti-Pattern 7: Deleting Stripe Code
**What:** Removing Stripe routes, handlers, SDK init during hibernation.
**Why bad:** Reactivation becomes multi-day re-implementation of tested code.
**Instead:** Guard with `FLAGS.STRIPE_ENABLED`. All code stays. All env vars stay. All DB columns stay.

---

## New Environment Variables

| Variable | Purpose | Default | Required |
|----------|---------|---------|----------|
| `STRIPE_ENABLED` | Master switch for Stripe payment flow | `false` | Yes (set in Railway) |
| `AI_MODEL_FLASH` | Override flash model without code change | `gemini-2.5-flash-lite` | No |
| `AI_MODEL_PRO` | Override pro model without code change | `gemini-2.5-pro` | No |

### Database Changes

| Change | Type | Migration |
|--------|------|-----------|
| `analytics_snapshots`: add `dau`, `signups`, `searches`, `leads` columns | ALTER TABLE | 1 SQL statement in Supabase |
| Ensure `activity_events` has indexes on `action` and `created_at` | INDEX | Verify, add if missing |
| No new tables needed | -- | `activity_events` + `logActivityEvent()` already exist |

---

## Scalability Considerations

| Concern | At 100 users (now) | At 1K MAU (target) | At 10K MAU |
|---------|--------------------|--------------------|------------|
| server.js monolith | Fine | Fine | Consider route extraction |
| activity_events volume | ~100 rows/day | ~5K rows/day (Supabase free OK) | Add 90-day retention |
| AI API costs (paid Tier 1) | ~$5-10/mo | ~$20-50/mo | Model swap critical |
| Railway memory (512MB) | Fine | Monitor | May need 1GB |
| Landing page LCP | Static HTML, fast | Fast | Consider CDN |

---

## Sources

- Direct code inspection: server.js (all line numbers referenced), index.html, welcome.html, analytics_snapshots_schema.sql, leads_schema.sql
- PROJECT.md (v1.2 requirements, constraints, budget)
- CLAUDE.md (architecture overview, agent skills, known issues)
- project_tier_strategy.md (free-first pivot strategy)
- Confidence: HIGH -- all findings from production codebase analysis, no external research needed
