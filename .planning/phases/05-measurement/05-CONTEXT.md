# Phase 5: Measurement - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Analytics infrastructure for MAU tracking and funnel data needed to pitch lenders. Covers server-side activity events (ANAL-01), Umami Cloud integration (ANAL-02), BridgeMatch funnel tracking (ANAL-03), and admin analytics summary (ANAL-04). Does not include marketing dashboards, external reporting tools, or public-facing analytics.

</domain>

<decisions>
## Implementation Decisions

### Event Coverage
- Add 5 new server-side activity events: `signup`, `signin`, `deal_stacking`, `csv_export`, `bridgematch_open`
- Use separate action names for `signup` vs `signin` (not a single `auth` action with type field)
- Anonymous browsing (page views, filter clicks, lot expansions) tracked by Umami only — not in activity_events
- Include IP address on all events (consistent with existing `logActivityEvent` pattern)
- Existing events preserved: `analysis`, `smart_search`, `lead_submit`

### BridgeMatch Funnel
- Dual tracking: client-side (Umami custom events) for lot_expand and finance_click; server-side (activity_events) for form_start and lead_submit
- Funnel steps defined as:
  1. **lot_view** = user expands a lot card in the directory
  2. **finance_click** = user clicks the BridgeMatch/finance button on a lot
  3. **form_start** = user focuses/changes any input field in the BridgeMatch form
  4. **submission** = existing `lead_submit` event (already wired)
- Include lot context metadata on funnel events: lot_number, house, guide_price — for lender pitch data on which property types drive finance interest

### Admin Analytics View
- MAU count as the hero metric — big number, front-and-centre
- Data sources: Umami API for page-level metrics (MAU, bounce rate, referrals) + activity_events for action-level metrics (funnel, engagement)
- Live queries on admin page load (no daily snapshot/cron job) — fine at current volume, add caching later if needed
- Additional metrics beyond MAU and funnel:
  - Top search queries (from smart_search events)
  - Signups over time (from signup events)
  - Referral sources (from Umami API)
- Builds on existing admin Analytics tab — enhance, don't replace

### Umami Setup
- Umami Cloud free tier (10K events/month) — zero infrastructure, script tag integration
- Track public pages only: index.html, bridgematch-lite.html — exclude admin.html to avoid skewing metrics
- Use Umami custom events (`umami.track()`) for client-side funnel steps: lot_expand, finance_click, form_start
- Update privacy.html to mention Umami (privacy-respecting, no cookies, GDPR compliant)

### Claude's Discretion
- Umami script tag placement and loading strategy
- Exact admin dashboard layout and styling
- Error handling for Umami API failures
- activity_events table schema (if columns need adding beyond existing structure)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `logActivityEvent(action, detail, email, ip)` at server.js:11178 — already wired for 3 events, reuse for new events
- `activity_events` Supabase table — already exists with user_email, action, detail (JSONB), ip columns
- Admin Analytics tab in admin.html:483 — existing tab with stats grid, just needs content enhancement
- `loadAnalytics()` function in admin.html:1258 — existing admin JS that fetches `/api/admin/analytics`
- `/api/admin/analytics` endpoint at server.js:11139 — existing endpoint with admin auth, needs expanding

### Established Patterns
- Admin auth via `x-admin-secret` header — all admin endpoints use this
- `apiFetch()` wrapper in admin.html for authenticated admin API calls
- `getClientIP(req)` helper for IP extraction
- Supabase client already initialized in server.js

### Integration Points
- New `logActivityEvent` calls go into existing endpoint handlers (sign-up in auth flow, deal stacking in calc endpoint, CSV in export endpoint)
- Umami script tag added to index.html and bridgematch-lite.html `<head>`
- Umami custom events triggered from script.js event handlers (lot expand, finance click, form interaction)
- Admin analytics endpoint enhanced to query both activity_events and Umami API
- privacy.html updated with analytics disclosure

</code_context>

<specifics>
## Specific Ideas

- MAU is the pitch number for lenders — it needs to be unmissable in the admin view
- Lot context on funnel events (house, price, lot number) specifically for showing lenders which property segments drive finance interest
- The 10K events/month Umami Cloud free tier should be sufficient for the 500-1000 MAU target — reassess if traffic grows

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-measurement*
*Context gathered: 2026-03-22*
