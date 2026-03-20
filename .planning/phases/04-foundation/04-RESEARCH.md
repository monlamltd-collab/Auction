# Phase 4: Foundation - Research

**Researched:** 2026-03-20
**Domain:** Stripe hibernation, tier gating pivot (free-first), bug fixes in vanilla JS monolith
**Confidence:** HIGH (all findings from direct codebase inspection)

## Summary

Phase 4 has three distinct workstreams: (1) infrastructure verification and Stripe hibernation, (2) gating logic pivot from paid-tier to sign-in-only, and (3) eight targeted bug fixes. All work happens within the existing monolith (server.js ~11K lines, index.html ~79K lines) with no new dependencies or structural changes.

The Stripe hibernation is the riskiest piece -- the payment integration spans ~400 lines across 5 endpoints plus scattered tier checks, and there are active subscribers who must be cancelled before the flag is set. The gating pivot requires coordinated changes across both server and client: the server must treat all signed-in users as "premium" when Stripe is disabled, and the client must replace all "Upgrade" CTAs with "Sign in free" messaging and hide all payment UI. The bug fixes are straightforward, isolated changes.

**Primary recommendation:** Address INFR-01/02/03 as a manual verification step first (no code), then implement GATE-01/02/03 as a single atomic change (feature flag + tier resolution + UI cleanup), then GATE-04/05 (rate limits), then all 8 bug fixes in parallel.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFR-01 | Confirm Supabase is on paid plan | Manual check -- Supabase dashboard settings page |
| INFR-02 | Cancel active Stripe subscriptions before hibernating | Manual -- Stripe dashboard, then DB migration to reset tiers |
| INFR-03 | Verify Railway memory/CPU baseline | Manual -- Railway metrics dashboard, check current usage patterns |
| GATE-01 | Hibernate Stripe behind STRIPE_ENABLED env var | Add feature flag constant at top of server.js, guard 5 Stripe endpoints + Stripe client init |
| GATE-02 | resolveEffectiveTier() returns premium for signed-in users when Stripe disabled | New centralised function replacing inline tier checks at ~5 locations in server.js |
| GATE-03 | Paywall modals and upgrade CTAs hidden when Stripe disabled | Server returns `stripeEnabled: false` in config; client hides paywall modal, changes blurred card text |
| GATE-04 | AI features require sign-in but are free | Already partially implemented -- tighten anonymous access, ensure signed-in users bypass paywall |
| GATE-05 | Daily AI rate limit for signed-in users (e.g. 50/day) | Modify `getAISearchLimit()` and `RATE_LIMIT` constant; currently 5/day for free users |
| FIX-01 | Heavy refurb button triggers search execution | `setQ()` currently only sets input value; needs to also call `runSmartSearch()` |
| FIX-02 | Score sort orders within tiers | `renderLots()` tier grouping uses `scoreThenPrice` but may not sort within each tier |
| FIX-03 | Empty state messaging for 0 results | No empty state detection in `renderLots()` -- need to show helpful message |
| FIX-04 | Search input trimmed and debounced | Main search path trims already; needs debounce on keystroke-triggered searches |
| FIX-05 | Negative page numbers guarded | `goPage()` accepts any value; needs `Math.max(1, ...)` guard |
| FIX-06 | Deal stacking widget reflows on mobile | Inline styles on `.deal-stack-widget`; needs responsive CSS for single-column on narrow screens |
| FIX-07 | Sign-in page text overflows container | Auth modal at `max-width:420px` with inline styles; text content may overflow on narrow screens |
| FIX-08 | CSV export has server-side tier check | `dlCSV()` only checks client-side `window._userTier`; no server endpoint to guard |
</phase_requirements>

## Standard Stack

### Core (No New Dependencies)

| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| Express | ^4.21.0 | HTTP server | Already installed, all changes in server.js |
| Stripe | ^20.4.0 | Payment (hibernated) | Keep in package.json, guard with feature flag |
| @supabase/supabase-js | ^2.45.0 | Auth + DB | Already used for tier, rate limits |
| Vanilla JS | N/A | Frontend | All client changes in index.html |

### No New Libraries Needed

This phase adds zero new dependencies. All changes are modifications to existing code patterns. The feature flag is a single `const` reading `process.env`. The tier resolution is a function. The UI changes are CSS and string replacements.

## Architecture Patterns

### Pattern 1: STRIPE_ENABLED Feature Flag

**What:** A single boolean constant at the top of server.js that gates all Stripe functionality.

**Implementation:**
```javascript
// Near top of server.js, after env var reads
const STRIPE_ENABLED = process.env.STRIPE_ENABLED !== 'false'; // default: enabled (backwards compatible)

// Guard Stripe client initialisation
const stripe = STRIPE_ENABLED && process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
```

**Where to guard (5 endpoints):**
- `/api/stripe/checkout` (line ~1301) -- return 503
- `/api/stripe/webhook` (line ~1350) -- keep alive for cancellation confirmations only
- `/api/stripe/portal` (line ~1540) -- return 503
- `/api/stripe/status` (line ~1560) -- return `{ active: false, stripeEnabled: false }`
- `/api/stripe/diag` (line ~1289) -- include `stripeEnabled` in response

**CSP header update:** Remove `checkout.stripe.com` from connect-src and frame-src when `!STRIPE_ENABLED` (line ~91-92).

### Pattern 2: Centralised Tier Resolution

**What:** Replace scattered inline tier checks with a single `resolveEffectiveTier(user)` function.

**Current state (fragmented):**
- `server.js:2803` -- `const userTier = user.tier || 'free';`
- `server.js:2850` -- `const isPremiumOrTrial = userTier === 'premium' || userTier === 'trial';`
- `server.js:3244` -- same pattern repeated
- `server.js:1849-1855` -- `getAISearchLimit(user)` checks tier and trial_expires_at
- `index.html:1072` -- `function isPremium(){return window._userTier==='premium';}`

**New pattern:**
```javascript
// server.js
function resolveEffectiveTier(user) {
  if (!user) return 'anon';
  if (!STRIPE_ENABLED) return 'premium'; // Free-first: all signed-in = full access
  if (user.tier === 'premium') return 'premium';
  if (user.trial_expires_at && new Date(user.trial_expires_at) > new Date()) return 'premium';
  return user.tier || 'free';
}
```

### Pattern 3: Server-Driven Client Config

**What:** The `/api/auth/me` or a new `/api/config` endpoint tells the client whether Stripe is enabled, so the client can hide payment UI without duplicating business logic.

**Implementation:** Add `stripeEnabled` field to the `/api/auth/me` response. The client reads this to:
- Hide/show the paywall modal
- Change "Upgrade" text to "Sign in free"
- Change blurred card overlay text from "Upgrade for full address..." to "Sign in free for full details"
- Hide the pricing cards in the paywall modal

### Pattern 4: Anonymous vs Signed-In Gating

**Current flow:**
- Anonymous: sees blurred lots, "Upgrade" CTA
- Free signed-in: 5 AI searches/day, some data visible
- Premium: unlimited, all data visible

**New flow (when STRIPE_ENABLED=false):**
- Anonymous: sees blurred lots, "Sign in free" CTA (NOT "Upgrade")
- Signed-in: all features unlocked, 50 AI searches/day rate limit (GATE-05)

**Key client-side changes:**
1. `isPremium()` becomes `isSignedIn()` or `isPremium()` always returns true for signed-in users
2. `showPaywall()` becomes `showSignupPrompt()` when Stripe disabled
3. Blurred card overlay text: "Sign in free for full details" not "Upgrade for full address..."
4. Paywall modal content: show sign-up form instead of pricing cards

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Feature flags | Custom flag system with DB storage | Single `process.env` read | One flag. That is all. |
| Tier resolution | Multiple inline checks | Single `resolveEffectiveTier()` function | Already fragmented across 5+ locations |
| Rate limiting | New rate limit implementation | Existing `rate_limits` table + `rateLimit()` middleware | Already works, just change the limit number |
| Debounce | Custom debounce | Simple `setTimeout`/`clearTimeout` pattern | Standard JS pattern, already used for `debounceDealStack` |

## Common Pitfalls

### Pitfall 1: Orphaned Stripe Subscribers (CRITICAL)

**What goes wrong:** Setting `STRIPE_ENABLED=false` without cancelling active Stripe subscriptions. Stripe continues billing users while the webhook endpoint ignores events. Users stuck in wrong tier.
**Why it happens:** Stripe billing is external -- it does not stop when your code stops listening.
**How to avoid:** Manual step BEFORE any code changes: (1) Check Stripe dashboard for active subscriptions, (2) Cancel all active subscriptions, (3) Run DB migration: `UPDATE users SET tier = 'free', stripe_subscription_id = NULL, tier_expires_at = NULL WHERE tier = 'premium' AND stripe_subscription_id IS NOT NULL`.
**Warning signs:** Any row in `users` table with both `tier = 'premium'` and `stripe_subscription_id` not null after hibernation.

### Pitfall 2: Client-Side Tier Check Bypass

**What goes wrong:** CSV export currently checks `window._userTier !== 'premium'` client-side only. Users can set `window._userTier = 'premium'` in console and export. Under the new model this matters less (everyone signed-in is "premium"), but the anon case still needs server-side protection.
**How to avoid:** For GATE-08 (CSV tier check server-side), either: (a) create a lightweight `/api/export` endpoint that checks auth, or (b) since all signed-in users are now premium, just ensure the client-side check changes from `!== 'premium'` to `!window._userTier` (must be signed in).

### Pitfall 3: Inconsistent "Upgrade" Text Throughout App

**What goes wrong:** Searching for "upgrade" in index.html reveals 10+ locations with hardcoded payment-oriented text. Missing even one leaves a confusing "Upgrade to Pro" message in a free app.
**Why it happens:** Text is scattered across inline strings, not centralised.
**How to avoid:** Grep for all instances: `Upgrade`, `Pro`, `payment`, `checkout`, `subscribe`, `pricing`, `paywall`, `Go Pro`. Each must be changed or hidden when Stripe is disabled.

### Pitfall 4: Rate Limit Confusion Between Analyse and Smart Search

**What goes wrong:** There are TWO separate rate limit paths: (1) `/api/analyse` uses `RATE_LIMIT = 5` with the `rate_limits` table keyed by IP, (2) `/api/all-lots` smart search uses `getAISearchLimit()` with its own rate tracking. GATE-05 needs to set a unified daily limit (e.g., 50/day) across both paths.
**Why it happens:** Rate limits were added incrementally, not designed holistically.
**How to avoid:** Update both `RATE_LIMIT` and `getAISearchLimit()` to use the same 50/day constant. Consider keying by user ID (not IP) for signed-in users to prevent circumvention.

### Pitfall 5: New User Auto-Created as Premium

**What goes wrong:** `validateUserFromReq()` auto-creates new users with `tier: 'premium'` and a 14-day trial (line ~889). When Stripe is disabled, this is fine (everyone is premium anyway), but if Stripe is re-enabled later, these users would have an unexpected premium status.
**How to avoid:** When `!STRIPE_ENABLED`, auto-create users with `tier: 'free'` -- since `resolveEffectiveTier()` will return 'premium' for any signed-in user anyway. This keeps the DB clean for future Stripe reactivation.

## Code Examples

### Feature Flag Implementation (server.js top)
```javascript
// ── Feature Flags ──
const STRIPE_ENABLED = process.env.STRIPE_ENABLED !== 'false';

// Stripe client: only initialise when enabled
const stripe = STRIPE_ENABLED && process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
```

### Stripe Endpoint Guard
```javascript
// Guard pattern for all 4 Stripe endpoints (checkout, portal, status, diag)
app.post('/api/stripe/checkout', rateLimit(60000, 5), async (req, res) => {
  if (!STRIPE_ENABLED) return res.status(503).json({ error: 'payments_hibernated' });
  // ... existing code
});
```

### Tier Resolution
```javascript
function resolveEffectiveTier(user) {
  if (!user) return 'anon';
  if (!STRIPE_ENABLED) return 'premium';
  if (user.tier === 'premium') return 'premium';
  if (user.trial_expires_at && new Date(user.trial_expires_at) > new Date()) return 'premium';
  return user.tier || 'free';
}
```

### Updated AI Search Limit
```javascript
const SIGNED_IN_DAILY_LIMIT = 50; // GATE-05: cost safety valve

function getAISearchLimit(user) {
  if (!user) return ANON_AI_SEARCH_LIMIT; // 3 for anon
  if (!STRIPE_ENABLED) return SIGNED_IN_DAILY_LIMIT; // 50 for signed-in when free-first
  if (user.tier === 'premium') return Infinity;
  if (user.trial_expires_at && new Date(user.trial_expires_at) > new Date()) return Infinity;
  return FREE_AI_SEARCH_LIMIT;
}
```

### FIX-01: Heavy Refurb Triggers Search
```javascript
// Current (broken):
function setQ(q){
  if(!window._userTier){showPaywall('...');return}
  $('smartQuery').value=q;
}

// Fixed:
function setQ(q){
  if(!window._userTier){$('signupModal').classList.add('show');return} // Sign-in prompt, not paywall
  $('smartQuery').value=q;
  runSmartSearch(); // Actually execute the search
}
```

### FIX-05: Negative Page Guard
```javascript
// Current:
function goPage(p){_pageFromGoPage=true;_currentPage=p;renderLots();...}

// Fixed:
function goPage(p){_pageFromGoPage=true;_currentPage=Math.max(1,p);renderLots();...}
```

### FIX-03: Empty State Message
```javascript
// In renderLots(), after filtering:
if (lots.length === 0) {
  $('resultsGrid').innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text-muted)">' +
    '<div style="font-size:2rem;margin-bottom:12px">No lots found</div>' +
    '<p>Try adjusting your filters or search terms.</p></div>';
  return;
}
```

### Client-Side Gating Switch
```javascript
// Receive stripeEnabled from server (via /api/auth/me or /api/config)
// Change blurred card text:
// OLD: content:'Upgrade for full address, AI scores & listing link'
// NEW: content:'Sign in free for full details, AI scores & listing link'

// Change paywall to signup prompt:
function showPaywall(reason) {
  if (!window._stripeEnabled) {
    // Show signup modal instead of paywall
    $('signupModal').classList.add('show');
    return;
  }
  // ... existing paywall code (kept for future reactivation)
}
```

## Bug Fix Analysis

### FIX-01: Heavy Refurb Search Execution
**Location:** `index.html:1308-1311` (`setQ()` function)
**Root cause:** `setQ()` sets the input value but never calls the search function.
**Fix:** Add `runSmartSearch()` call after setting the value. Also, when `!window._userTier`, show the sign-up modal instead of the paywall.

### FIX-02: Score Sort Within Tiers
**Location:** `index.html:2451-2458` (renderLots sorting)
**Root cause:** The tiered grouping uses `scoreThenPrice` comparator but need to verify it actually sorts by score descending within each tier, not just filters into tiers.
**Fix:** Verify `scoreThenPrice` sorts `(b.score - a.score) || (a.price - b.price)`. If correct, the issue may be that lots are being grouped into tiers but not visibly sorted within the rendered output. Investigate further during implementation.

### FIX-03: Empty State Messaging
**Location:** `index.html` (renderLots function, after filtering)
**Root cause:** No detection of zero results after filter application.
**Fix:** Add a zero-results check after all filtering, before rendering lot cards. Show contextual message based on active filters ("No lots match your filters") vs smart search ("No results for your search").

### FIX-04: Search Trimmed and Debounced
**Location:** `index.html:1295` (already trims), needs debounce on input events
**Root cause:** Trim is done but no debounce on the search trigger.
**Fix:** Add debounce wrapper (300ms) to the search input change handler. Pattern already exists in codebase: `debounceDealStack()` uses this exact approach.

### FIX-05: Negative Page Guard
**Location:** `index.html:1136` (`goPage()` function)
**Root cause:** No bounds checking on page parameter.
**Fix:** `_currentPage = Math.max(1, Math.min(p, totalPages || 1))`. Also guard in `renderLots()` at line 2469 where `_currentPage` is clamped to `totalPages`.

### FIX-06: Deal Stacking Mobile Reflow
**Location:** `index.html:3141-3175` (deal-stack-widget inline styles)
**Root cause:** Widget uses inline flexbox with fixed widths, no responsive breakpoint.
**Fix:** Add CSS rule: `.deal-stack-widget { display: flex; flex-wrap: wrap; gap: 12px; }` with `@media (max-width: 600px) { .deal-stack-widget > * { width: 100%; } }`. Must inspect the actual widget structure during implementation.

### FIX-07: Sign-In Page Text Overflow
**Location:** `index.html:723-758` (signupModal)
**Root cause:** Modal has `max-width:420px` but text content may overflow on screens narrower than 420px; also the features list may overflow within the modal on very narrow screens.
**Fix:** Add `box-sizing: border-box; overflow-wrap: break-word;` to the modal. Ensure responsive padding. Check at 320px viewport width.

### FIX-08: CSV Export Server-Side Tier Check
**Location:** `index.html:2815` (dlCSV), no server endpoint
**Root cause:** Export is entirely client-side. Data is already in browser memory. Server-side "check" means ensuring `/api/all-lots` does not send exportable data to anonymous users.
**Fix:** Two options: (a) `dlCSV()` checks `window._userTier` exists (signed in), which is sufficient since the server already strips fields for anon; or (b) add a lightweight `/api/export-check` that validates auth token. Option (a) is simpler and adequate given the new model where all signed-in users get full data.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Custom vanilla assertions with JSDOM (no test library) |
| Config file | None -- tests run via `node tests/test-extractors.js` |
| Quick run command | `npm test` |
| Full suite command | `npm test` (same -- only extractor tests exist) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GATE-01 | Stripe endpoints return 503 when STRIPE_ENABLED=false | unit | Manual verification via curl | No -- Wave 0 |
| GATE-02 | resolveEffectiveTier returns 'premium' for signed-in when Stripe off | unit | `node -e "..."` inline test | No -- Wave 0 |
| GATE-03 | No paywall/upgrade text visible when Stripe disabled | manual | Visual inspection | N/A manual-only |
| GATE-04 | AI features require sign-in | integration | curl without auth token, verify 401 | No -- Wave 0 |
| GATE-05 | Rate limit at 50/day for signed-in users | unit | Test getAISearchLimit returns 50 | No -- Wave 0 |
| FIX-01 | Heavy refurb button executes search | manual | Click button, verify search runs | N/A manual-only |
| FIX-02 | Score sort within tiers | manual | Sort by score, verify ordering | N/A manual-only |
| FIX-03 | Empty state shows message | manual | Filter to 0 results, verify message | N/A manual-only |
| FIX-04 | Search trimmed/debounced | manual | Type with spaces, verify trim; type fast, verify single request | N/A manual-only |
| FIX-05 | Negative page guarded | unit | `goPage(-1)` does not break | No -- Wave 0 |
| FIX-06 | Deal stacking reflows mobile | manual | Resize to 375px, verify single column | N/A manual-only |
| FIX-07 | Sign-in text fits container | manual | View at 320px, verify no overflow | N/A manual-only |
| FIX-08 | CSV export checks tier | manual | As anon, verify export blocked | N/A manual-only |
| INFR-01 | Supabase on paid plan | manual | Check dashboard | N/A manual-only |
| INFR-02 | Stripe subscriptions cancelled | manual | Check Stripe dashboard | N/A manual-only |
| INFR-03 | Railway capacity verified | manual | Check Railway metrics | N/A manual-only |

### Sampling Rate
- **Per task commit:** `npm test` (extractor tests as smoke test)
- **Per wave merge:** `npm test` + manual verification of gating behavior
- **Phase gate:** All manual checks passed, documented in verification

### Wave 0 Gaps
- [ ] `tests/test-gating.js` -- test resolveEffectiveTier() and getAISearchLimit() with STRIPE_ENABLED flag
- [ ] `tests/test-feature-flags.js` -- verify Stripe endpoint guards return 503 when disabled

Note: Most Phase 4 requirements are UI/UX behavior changes (paywall text, mobile reflow, empty states) that are inherently manual-verification. The testable server-side logic (tier resolution, rate limits, feature flag) should have automated tests.

## Open Questions

1. **How many active Stripe subscribers exist?**
   - What we know: The pivot decision suggests very few. STATE.md flags this as CRIT-1.
   - What's unclear: Exact count. Could be 0, could be 5+.
   - Recommendation: Check Stripe dashboard first. If > 0, email subscribers before cancelling.

2. **Should the webhook endpoint stay alive for cancellation events?**
   - What we know: PITFALLS.md recommends keeping it alive for `customer.subscription.deleted`.
   - What's unclear: Whether any pending cancellations will arrive after hibernation.
   - Recommendation: Keep webhook alive but only process `customer.subscription.deleted`. Guard all other event types with early return.

3. **Is the current Supabase plan free or paid?**
   - What we know: `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set. Schema has ~6 tables.
   - What's unclear: Current plan tier.
   - Recommendation: Check dashboard. Free tier has 500MB DB, 2GB bandwidth, 50K monthly active users. Should be sufficient for current scale, but confirm before committing to free-first traffic increase.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: server.js, index.html, schema.sql, package.json
- `.planning/research/ARCHITECTURE.md` -- prior v1.2 architecture research
- `.planning/research/PITFALLS.md` -- prior pitfall analysis
- `bugs/bugs-auth-stripe.md` -- existing bug documentation

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md` -- STRIPE_ENABLED pattern documented
- `.planning/research/FEATURES.md` -- feature flag approach confirmed

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all existing code
- Architecture: HIGH -- patterns verified against actual codebase line numbers
- Bug fixes: HIGH -- each bug located to specific lines with root cause identified
- Pitfalls: HIGH -- based on actual code paths and prior research

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (stable -- no external dependency changes expected)
