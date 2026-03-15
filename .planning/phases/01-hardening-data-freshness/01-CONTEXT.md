# Phase 1: Hardening & Data Freshness - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix broken code (SDLT rates, Stripe trial/webhook/downgrade bugs), improve data freshness (future-only defaults, sold/unsold tracking, pipeline alerting, admin metrics), and switch Firecrawl to `['markdown', 'rawHtml']` format. No new features beyond what's in ROADMAP.md requirements HARD-01 through HARD-07, FRSH-01 through FRSH-05.

</domain>

<decisions>
## Implementation Decisions

### Sold/unsold display
- Diagonal overlay banner across lot image (estate agent board style) for Sold/STC/Withdrawn statuses
- Available lots have no overlay — clean card
- Banner colours: classic red for "SOLD", bright yellow for "STC", muted grey for "Withdrawn"
- Add "Status" filter dropdown to existing filter bar (default: show all)
- When sold price is available, show both: "Guide: £85,000 → Sold: £92,000"

### Future-only toggle
- Checkbox inside the existing filter bar: "Show past auctions" (unchecked by default)
- Server-side filtering: `/api/all-lots` defaults to future-only, add `?includePast=true` param
- "Past" defined as auction date + 7 days (recent auctions stay visible for a week to see sold prices)
- After 7 days, auctions are hidden from default view but retained in archive
- Preference persisted via URL param (`?showPast=true`) — shareable and bookmarkable

### Pipeline alerting
- Admin dashboard log only — no email or webhook push notifications for now
- Dedicated "Alerts" feed section at top of admin.html, chronological list
- Alert events: auto-analyse failure, discovery miss, image coverage drop, DOM extractor regression
- Severity levels: warning (degraded quality) and error (broken/0 lots)
- Alerts auto-resolve when the next successful run clears the issue — resolved alerts move to a "Recent" section

### Admin freshness metrics
- Per-house health table: house name, last scrape time, lot count, image coverage %, status
- Three status levels: Healthy (scraped OK, lots > 0), Warning (degraded quality e.g. low images, lot count dropped significantly), Broken (0 lots, extraction failing)
- Each scrape run shows a diff summary: timestamp, lots added/removed/changed, images gained/lost, status changes (e.g. "+2 new lots, 1 withdrawn, 3 images added")
- Sortable columns for quick visual scan

### Claude's Discretion
- Exact overlay banner CSS implementation (rotation, opacity, positioning)
- Health threshold values (what % image coverage triggers "Warning")
- Alert feed pagination/limit (how many alerts to show)
- Diff summary storage format (how change data is persisted in Supabase)
- SDLT calculation implementation details (lookup tables vs formulas)
- Stripe webhook idempotency implementation pattern
- Firecrawl format switch rollout approach

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `escHtml()` helper in server.js for safe HTML rendering in admin dashboard
- `saveDailySnapshot()` already captures analytics data — can be extended for change tracking
- `house_skills` Supabase table tracks per-house scraping status — can store health/alert data
- `analytics_snapshots` table has time-series data — basis for trend metrics
- Resend email integration exists if push alerts are needed later
- Existing filter bar in index.html — checkbox can be added alongside existing dropdowns
- `contentHash` comparison already detects catalogue changes — foundation for diff summaries

### Established Patterns
- Express route handlers with try/catch and JSON error responses
- Admin routes protected by `x-admin-secret` header
- In-memory caching alongside Supabase persistence
- Structured JSON logging via `log()` function
- Circuit breaker pattern for credit/exhaustion guards
- DOM extractors as string source evaluated at runtime

### Integration Points
- `/api/all-lots` endpoint — add `includePast` param and date filtering
- `autoAnalyseAll()` / `autoAnalyseOne()` — hook alert generation into failure paths
- `admin.html` — add alerts section and health table
- `extractWithJSDOM()` / `extractLotsWithAI()` — add `lot.status` field to extraction output
- `scrapeWithFirecrawl()` — switch format from `['rawHtml']` to `['markdown', 'rawHtml']`
- Stripe webhook handler — add event.id dedup and current_period_end checks

</code_context>

<specifics>
## Specific Ideas

- Sold overlay should feel like physical estate agent "SOLD" boards — classic red diagonal ribbon
- Change tracking is the core value of the admin dashboard — "completed at X o'clock with these changes: ..."
- Past auctions archived after 7 days but retained for: information depth, recognising re-marketed properties in future
- Guide → Sold price display helps users learn auction pricing patterns (premiums/discounts)

</specifics>

<deferred>
## Deferred Ideas

- **Legal pack completeness tracking** — detecting whether legal packs are available per lot, displaying status. New data extraction capability — future phase.
- **Bid prior to auction as a search parameter** — some lots allow pre-auction bidding. New search/filter dimension — future phase.
- **Auction terms (28/56 day completion) as searchable field** — completion period extraction and filtering. New extraction + filter — future phase.
- **Re-marketed property recognition** — cross-auction-cycle matching to spot lots that failed to sell and are re-listed. New analytical capability — future phase.
- **Email/webhook push alerts** — currently admin dashboard only; can add push notifications in a future phase if needed.

</deferred>

---

*Phase: 01-hardening-data-freshness*
*Context gathered: 2026-03-15*
