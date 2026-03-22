# Phase 5: Measurement - Research

**Researched:** 2026-03-22
**Domain:** Analytics instrumentation (server-side events + Umami Cloud + admin dashboard)
**Confidence:** HIGH

## Summary

Phase 5 adds analytics measurement to the Bridgematch Auction Tool across four requirements: wiring server-side activity events to key endpoints (ANAL-01), integrating Umami Cloud for page-level metrics (ANAL-02), tracking the BridgeMatch finance funnel end-to-end (ANAL-03), and building an admin analytics summary (ANAL-04).

The existing codebase already has strong foundations: `logActivityEvent()` fires for 3 actions (analysis, smart_search, lead_submit), the `activity_events` Supabase table exists, the admin Analytics tab has a working chart framework with Chart.js, and `loadAnalytics()` already fetches from `/api/admin/analytics`. The work is additive -- extending existing patterns rather than building new infrastructure.

Umami Cloud provides the page-level analytics (MAU, bounce rate, referrals) via a script tag with zero infrastructure. Its REST API (authenticated via `x-umami-api-key` header) returns the stats the admin dashboard needs. The free tier allows 10K events/month, sufficient for the 500-1000 MAU target.

**Primary recommendation:** Extend existing `logActivityEvent` calls into 5 new endpoints, add Umami Cloud script tag to public pages, wire client-side `umami.track()` for funnel steps, and enhance the existing admin analytics endpoint to query both Supabase activity_events and Umami API.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Add 5 new server-side activity events: `signup`, `signin`, `deal_stacking`, `csv_export`, `bridgematch_open`
- Use separate action names for `signup` vs `signin` (not a single `auth` action with type field)
- Anonymous browsing (page views, filter clicks, lot expansions) tracked by Umami only -- not in activity_events
- Include IP address on all events (consistent with existing `logActivityEvent` pattern)
- Existing events preserved: `analysis`, `smart_search`, `lead_submit`
- Dual tracking for BridgeMatch funnel: client-side (Umami custom events) for lot_expand and finance_click; server-side (activity_events) for form_start and lead_submit
- Funnel steps: lot_view (expand card), finance_click (BridgeMatch button), form_start (focus/change input), submission (existing lead_submit)
- Include lot context metadata on funnel events: lot_number, house, guide_price
- MAU count as hero metric in admin view -- big number, front-and-centre
- Data sources: Umami API for page-level metrics + activity_events for action-level metrics
- Live queries on admin page load (no daily snapshot/cron job)
- Additional admin metrics: top search queries, signups over time, referral sources
- Builds on existing admin Analytics tab -- enhance, don't replace
- Umami Cloud free tier (10K events/month)
- Track public pages only: index.html, bridgematch-lite.html -- exclude admin.html
- Use Umami custom events (`umami.track()`) for client-side funnel steps
- Update privacy.html to mention Umami

### Claude's Discretion
- Umami script tag placement and loading strategy
- Exact admin dashboard layout and styling
- Error handling for Umami API failures
- activity_events table schema (if columns need adding beyond existing structure)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ANAL-01 | Supabase activity_events wired to key API endpoints (search, analyse, deal stacking, BridgeMatch, sign-up) | Existing `logActivityEvent()` pattern at server.js:11178 -- add calls to signup (line 1186), signin (line 1198), and new endpoints. CSV export is client-side only (dlCSV in index.html) so needs a lightweight server endpoint or client-to-Umami tracking. |
| ANAL-02 | Umami Cloud integrated for page-level metrics (MAU, bounce rate, page views) | Umami Cloud script tag with `data-website-id`, deferred loading. API at `https://api.umami.is/v1` with `x-umami-api-key` header. |
| ANAL-03 | BridgeMatch funnel tracked: lot view to finance click to form start to submission | Client-side steps via `umami.track()` in `expandCard()` and `bridgeMatchLot()` functions in index.html. Server-side steps via `logActivityEvent()` in leads endpoint. |
| ANAL-04 | Admin can view analytics summary (MAU, funnel, engagement) | Enhance existing `/api/admin/analytics` endpoint (server.js:11139) and `loadAnalytics()` function (admin.html:1256). Add Umami API proxy calls server-side. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Umami Cloud | Free tier | Page-level analytics (MAU, bounce, referrals) | Privacy-respecting, GDPR compliant, no cookies, zero infrastructure |
| Supabase `activity_events` | Existing | Server-side action tracking | Already in use for 3 events, proven pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Chart.js | Already loaded in admin.html | Visualize analytics data | Admin dashboard charts -- already used by `makeChart()` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Umami Cloud | PostHog, Plausible | Umami is locked decision; free tier sufficient, privacy-first |
| Supabase activity_events | Dedicated analytics DB | Overkill at current scale; Supabase free tier has plenty of room |

**Installation:**
No npm packages needed. Umami is a script tag. All server-side work uses existing Supabase client.

## Architecture Patterns

### Event Flow Architecture
```
Client (index.html / bridgematch-lite.html)
├── Page views, anonymous browsing → Umami script (automatic)
├── lot_expand, finance_click → umami.track() custom events
├── form_start → umami.track() + POST /api/leads (existing)
└── lead_submit → POST /api/leads → logActivityEvent() (existing)

Server (server.js)
├── POST /api/signup → logActivityEvent('signup', ...)
├── POST /api/signup (existing user) → logActivityEvent('signin', ...)
├── POST /api/analyse → logActivityEvent('analysis', ...) [existing]
├── POST /api/smart-search → logActivityEvent('smart_search', ...) [existing]
├── POST /api/leads → logActivityEvent('lead_submit', ...) [existing]
└── [deal_stacking, csv_export, bridgematch_open → new logActivityEvent calls]

Admin (admin.html)
├── GET /api/admin/analytics → queries activity_events + Umami API
└── loadAnalytics() → renders MAU hero + funnel + engagement charts
```

### Pattern 1: Server-Side Event Logging
**What:** One-line `logActivityEvent()` call added to existing endpoint handlers
**When to use:** For all server-side actions (signup, signin, deal_stacking, csv_export, bridgematch_open)
**Example:**
```javascript
// In POST /api/signup handler, after successful user creation (server.js ~line 1211)
logActivityEvent('signup', { source: 'web' }, newUser.email, getClientIP(req));

// In POST /api/signup handler, for existing user sign-in (server.js ~line 1199)
logActivityEvent('signin', {}, existing.email, getClientIP(req));
```

### Pattern 2: Client-Side Umami Custom Events
**What:** `umami.track()` calls in existing JS event handlers for anonymous funnel tracking
**When to use:** For client-side funnel steps that don't hit the server
**Example:**
```javascript
// In expandCard() function (index.html ~line 3003)
function expandCard(lot) {
  if (lot.anonGated) { /* existing gate */ return; }
  // Track lot expansion for funnel
  if (window.umami) umami.track('lot_expand', {
    lot_number: lot.lot, house: lot._house, guide_price: lot.price
  });
  // ... existing expansion logic
}

// In bridgeMatchLot() function (index.html ~line 3311)
function bridgeMatchLot(idx, event) {
  if (window.umami) umami.track('finance_click', {
    lot_number: lot.lot, house: lot._house, guide_price: lot.price
  });
  // ... existing logic
}
```

### Pattern 3: Umami API Proxy (Server-Side)
**What:** Server-side proxy to Umami Cloud API, avoiding CORS and keeping API key secret
**When to use:** Admin analytics endpoint fetching MAU, bounce rate, referrals from Umami
**Example:**
```javascript
// In /api/admin/analytics handler
async function fetchUmamiStats(startAt, endAt) {
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  const apiKey = process.env.UMAMI_API_KEY;
  if (!websiteId || !apiKey) return null;

  try {
    const res = await fetch(
      `https://api.umami.is/v1/websites/${websiteId}/stats?startAt=${startAt}&endAt=${endAt}`,
      { headers: { 'x-umami-api-key': apiKey, 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('Umami API error:', e.message);
    return null;
  }
}
```

### Anti-Patterns to Avoid
- **Tracking everything server-side:** Anonymous browsing belongs in Umami only -- don't bloat activity_events with page views
- **Blocking on analytics:** `logActivityEvent` is fire-and-forget (already uses try/catch with warn). Never await analytics before sending response to user.
- **Exposing Umami API key client-side:** Always proxy Umami API calls through the server's admin endpoint
- **Tracking admin pages:** Exclude admin.html from Umami to avoid skewing MAU metrics

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Page-level analytics | Custom page view tracking | Umami Cloud script tag | Handles unique visitors, sessions, bounce rate, referrals automatically |
| MAU calculation | Custom unique visitor counting | Umami API `/stats` endpoint | Umami uses fingerprinting without cookies, handles deduplication |
| Chart rendering | Custom SVG/canvas charts | Chart.js (already loaded) | `makeChart()` helper already exists in admin.html |
| Privacy compliance | Cookie consent banner | Umami (cookieless, GDPR compliant) | No cookies = no consent needed |

## Common Pitfalls

### Pitfall 1: Umami Script Loading Race Condition
**What goes wrong:** `umami.track()` called before the Umami script loads, throwing ReferenceError
**Why it happens:** Script is loaded with `defer`, so it loads after HTML parsing but custom event calls may fire before it initializes
**How to avoid:** Always guard with `if (window.umami)` before calling `umami.track()`
**Warning signs:** Console errors about `umami is not defined`

### Pitfall 2: Umami Cloud API Rate Limiting
**What goes wrong:** Admin dashboard fails to load analytics because Umami API returns 429
**Why it happens:** Umami Cloud limits to 50 API calls per 15 seconds per key
**How to avoid:** Batch Umami API calls on admin page load (stats + metrics in parallel, not sequentially). Consider short TTL cache (5 min) if admin refreshes frequently.
**Warning signs:** Intermittent failures in admin analytics tab

### Pitfall 3: Double-Counting Funnel Events
**What goes wrong:** A single user action fires both Umami and activity_events, making funnel analysis confusing
**Why it happens:** Not being clear about which tracking layer owns which funnel step
**How to avoid:** Follow the locked decision: lot_expand and finance_click are Umami-only (client); form_start and lead_submit are activity_events (server). The admin dashboard queries both sources and presents a unified funnel view.
**Warning signs:** Funnel numbers don't make sense (more submissions than form starts)

### Pitfall 4: Missing Lot Context on Events
**What goes wrong:** Funnel events fire but don't include lot_number, house, guide_price -- making the data useless for lender pitches
**Why it happens:** Forgetting to pass metadata when adding `umami.track()` or `logActivityEvent()` calls
**How to avoid:** Define a helper that extracts lot context, use it consistently across all funnel event calls
**Warning signs:** Empty `detail` column in activity_events; missing event data in Umami custom events

### Pitfall 5: Signup vs Signin Distinction
**What goes wrong:** Both signup and returning user login go through `POST /api/signup`, making it easy to log both as 'signup'
**Why it happens:** The endpoint checks for existing user at line 1198 -- if found, it updates last_login and returns same response shape
**How to avoid:** Log 'signup' only when `newUser` is created (after line 1210); log 'signin' when `existing` user is found (after line 1199)
**Warning signs:** Signup count much higher than expected (includes returning users)

## Code Examples

### Umami Script Tag (for index.html and bridgematch-lite.html)
```html
<!-- Umami Cloud Analytics - privacy-respecting, no cookies -->
<script defer src="https://cloud.umami.is/script.js"
  data-website-id="YOUR_WEBSITE_ID"
  data-domains="auctions.bridgematch.co.uk">
</script>
```
Source: [Umami Tracker Configuration](https://umami.is/docs/tracker-configuration)

Note: `data-domains` ensures the tracker only fires on production, not localhost/staging.

### Umami Custom Event with Properties
```javascript
// Source: https://umami.is/docs/track-events
umami.track('finance_click', {
  lot_number: '42',
  house: 'allsop',
  guide_price: 150000
});
```

### Umami API: Get Website Stats
```javascript
// Source: https://umami.is/docs/api/website-stats
// GET https://api.umami.is/v1/websites/{websiteId}/stats
// Headers: x-umami-api-key: YOUR_KEY
// Params: startAt (ms timestamp), endAt (ms timestamp)
// Response: { pageviews, visitors, visits, bounces, totaltime }
```

### Umami API: Get Referral Sources
```javascript
// GET https://api.umami.is/v1/websites/{websiteId}/metrics
// Params: startAt, endAt, type=referrer
// Response: [{ x: 'google.com', y: 42 }, ...]
```

### Enhanced Admin Analytics Endpoint
```javascript
// Extend existing /api/admin/analytics to return both Supabase + Umami data
app.get('/api/admin/analytics', async (req, res) => {
  // ... existing auth check ...
  const days = parseInt(req.query.days) || 30;
  const endAt = Date.now();
  const startAt = endAt - days * 24 * 60 * 60 * 1000;

  const [snapshots, umamiStats, umamiReferrers, activityEvents] = await Promise.all([
    // Existing: analytics_snapshots
    supabase.from('analytics_snapshots').select('*').gte('date', since).order('date'),
    // New: Umami page-level stats
    fetchUmamiStats(startAt, endAt),
    // New: Umami referral sources
    fetchUmamiMetrics(startAt, endAt, 'referrer'),
    // New: activity_events aggregation
    supabase.from('activity_events').select('action, detail, created_at, user_email')
      .gte('created_at', new Date(startAt).toISOString()),
  ]);

  res.json({
    snapshots: snapshots.data || [],
    umami: umamiStats,
    referrers: umamiReferrers,
    events: activityEvents.data || [],
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Google Analytics (cookies, GDPR issues) | Umami / Plausible (cookieless) | 2023-2024 | No cookie banner needed, GDPR compliant by default |
| Client-side only analytics | Dual client+server tracking | Current best practice | Server events can't be blocked by ad blockers |
| Analytics snapshots via cron | Live queries on page load | Decision for this phase | Simpler, no cron job needed, fine at current scale |

## Open Questions

1. **CSV Export Tracking**
   - What we know: `dlCSV()` is entirely client-side (index.html ~line 2869). There's no server endpoint for CSV generation.
   - What's unclear: How to fire a server-side `logActivityEvent('csv_export')` without a server round-trip
   - Recommendation: Either (a) add a lightweight `POST /api/track/csv-export` endpoint that just logs the event, or (b) track via `umami.track('csv_export')` client-side. Option (a) is more consistent with the activity_events pattern.

2. **Deal Stacking Tracking**
   - What we know: Deal stacking (`calcDealStack`, `runDealStack`) is entirely client-side in index.html. No server endpoint exists.
   - What's unclear: Same as CSV -- no natural server endpoint to hook into
   - Recommendation: Same approach as CSV -- either a lightweight tracking endpoint or Umami custom event. The CONTEXT specifies it as a server-side activity_event, so a small tracking endpoint is needed.

3. **Bridgematch Open Tracking**
   - What we know: `bridgeMatchLot()` is client-side only, opens the finance widget inline
   - Recommendation: Track via `umami.track('finance_click')` for the funnel, plus add a lightweight `POST /api/track/event` endpoint for the `bridgematch_open` activity_event if server-side tracking is needed.

4. **Umami Website ID**
   - What we know: Need to sign up for Umami Cloud and create a website to get the ID
   - Recommendation: Store as `UMAMI_WEBSITE_ID` env var in Railway. Hard-code in script tag `data-website-id` (it's public-facing anyway, like a GA tracking ID).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in (no framework -- existing tests use plain `node` scripts) |
| Config file | none -- tests run via `node tests/test-extractors.js` |
| Quick run command | `node tests/test-extractors.js` |
| Full suite command | `node tests/test-extractors.js && node tests/test-gating.js` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ANAL-01 | logActivityEvent fires for signup, signin, deal_stacking, csv_export, bridgematch_open | manual-only | Verify by checking Supabase activity_events table after triggering each action | N/A -- no unit test framework for server endpoints |
| ANAL-02 | Umami script tag present on index.html and bridgematch-lite.html, NOT on admin.html | smoke | `grep -c "umami" index.html bridgematch-lite.html admin.html` | Wave 0 |
| ANAL-03 | Funnel events fire with lot context metadata | manual-only | Trigger lot expand, finance click, form start in browser; verify in Umami dashboard and Supabase | N/A |
| ANAL-04 | Admin analytics endpoint returns umami stats + activity events | manual-only | Load admin Analytics tab, verify MAU hero number and funnel chart render | N/A |

### Sampling Rate
- **Per task commit:** Manual browser verification (load page, trigger events, check Supabase/Umami)
- **Per wave merge:** Full manual walkthrough of all funnel steps
- **Phase gate:** All 4 ANAL requirements verified with live data

### Wave 0 Gaps
- [ ] Umami Cloud account creation and website ID generation (manual prerequisite)
- [ ] `UMAMI_WEBSITE_ID` and `UMAMI_API_KEY` env vars set in Railway

## New Environment Variables

| Variable | Purpose | Where Set |
|----------|---------|-----------|
| `UMAMI_WEBSITE_ID` | Umami Cloud website identifier for API queries | Railway env |
| `UMAMI_API_KEY` | Umami Cloud API key for server-side stats fetching | Railway env |

## Existing Code Integration Points

| What | Where | Action |
|------|-------|--------|
| `logActivityEvent()` | server.js:11178 | Reuse as-is for all new events |
| `getClientIP(req)` | server.js:1098 | Already used by logActivityEvent callers |
| `POST /api/signup` | server.js:1186 | Add signup/signin events at lines 1199 and 1211 |
| `POST /api/leads` | server.js:1601 | Already has `lead_submit` event -- no change needed |
| `POST /api/analyse` | server.js:2828 | Already has `analysis` event -- no change needed |
| `POST /api/smart-search` | server.js:3333 | Already has `smart_search` event -- no change needed |
| `expandCard()` | index.html:3003 | Add `umami.track('lot_expand', ...)` |
| `bridgeMatchLot()` | index.html:3311 | Add `umami.track('finance_click', ...)` |
| `dlCSV()` | index.html:2869 | Add tracking (client or server) |
| `/api/admin/analytics` | server.js:11139 | Expand to query Umami API + activity_events |
| `loadAnalytics()` | admin.html:1256 | Expand to render MAU hero, funnel chart, engagement |
| Admin Analytics tab | admin.html:483 | Add MAU hero card, funnel visualization, search queries table |
| privacy.html | root | Add Umami disclosure paragraph |

## Sources

### Primary (HIGH confidence)
- [Umami Tracker Configuration](https://umami.is/docs/tracker-configuration) - script tag setup, data attributes
- [Umami Track Events](https://umami.is/docs/track-events) - custom event API, data attributes method
- [Umami Website Stats API](https://umami.is/docs/api/website-stats) - stats endpoint, response format
- [Umami Cloud API Key](https://umami.is/docs/cloud/api-key) - API key auth via `x-umami-api-key` header
- [Umami Authentication](https://umami.is/docs/api/authentication) - Cloud vs self-hosted auth methods
- Codebase inspection: server.js, index.html, admin.html -- existing patterns verified directly

### Secondary (MEDIUM confidence)
- [Umami API Overview](https://umami.is/docs/api) - endpoint structure, base URL for Cloud

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Umami Cloud is well-documented, existing Supabase pattern proven
- Architecture: HIGH - all integration points identified in codebase, patterns are straightforward extensions
- Pitfalls: HIGH - identified from direct code inspection (signup/signin distinction, client-only endpoints)

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable domain, Umami API unlikely to change)
