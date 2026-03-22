# Phase 6: AI & Scraping Hardening - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

AI costs visible and controllable via multi-provider abstraction layer, and scraping coverage audited and expanded. Covers provider abstraction (AI-01, AI-03), cost logging (AI-02), DOM extractor audit (SCRP-01, SCRP-02), limited new house recruitment (SCRP-03), and admin dashboard cleanup (SCRP-04). Does not include new AI features, new scraping targets beyond easy additions, or frontend user-facing changes.

</domain>

<decisions>
## Implementation Decisions

### Provider Abstraction
- Multi-provider ready: abstract to a generic `callAI()` interface, not just a Gemini extraction
- Day-one providers: Gemini (existing) + Grok (xAI) via OpenAI-compatible API
- Model tier abstraction: each provider exposes a cheap/fast model and a capable/expensive model (e.g., Gemini flash-lite vs pro, Grok mini vs full). The provider layer handles this mapping internally
- Provider and model selection: Claude's discretion on whether to use a single env var or per-task env vars, based on how the code uses AI (extraction, search, discovery have different needs)
- Extract `callGemini()` and related functions from server.js to `lib/ai-provider.js`

### Cost Logging & Visibility
- Per-call logging to new Supabase `ai_usage` table: provider, model, tokens_in, tokens_out, est_cost, timestamp, task_type
- Dedicated "AI Costs" section in admin dashboard with daily spend, per-model breakdown, and budget tracking
- Daily cost budget alert via `AI_DAILY_BUDGET` env var (e.g., 0.50). Admin shows red warning when exceeded
- AI cost tracking only — Firecrawl cost-monitor stays as-is (separate system)

### Extractor Audit Strategy
- "Broken" defined by comparing scraped lot count vs house-advertised lot count (each auction house typically shows total lot count on their site)
- Self-audit validation: the system must cross-reference its own scraped count against the house's stated count, not just check for zero lots
- Multi-angle validation: research approaches to ensure extractors are checking houses and lots from different angles for maximum coverage (e.g., pagination detection, alternate URL patterns, API endpoints some houses expose)
- Automated + ongoing: extend existing nightly audit (scripts/audit.mjs) to run this lot-count comparison. Flags mismatches in admin
- Auto-disable broken extractors + pipeline alert when mismatch detected. Gemini fallback handles extraction until manually fixed. Re-enable after fix
- Image coverage verification across all houses (target >90%)
- Add 5-10 new houses if time allows — target easy additions (EIG platform clones or Auction House UK network branches)

### Admin Dashboard Cleanup
- New "System Health" tab in admin with 4 sections: Broken Extractors (red alerts), AI Costs (daily spend + budget), Coverage (house-by-house grid), Pipeline Health (engine status)
- Stale cached houses: collapse into summary count ("12 inactive houses — no upcoming auctions"), expandable if needed
- Upcoming auctions section: should confirm house is reporting correctly (validated lot count), not just say "upcoming"
- Issues section: include diagnostic hints and attempt auto-fix where possible for common failures (selector mismatch, URL changes). Flag auto-fix successes and failures
- Missing catalogues section: clarify what it means — if the tool knows they're missing, explain why it can't auto-fix, or auto-fix if possible
- Fix perpetual "analysing" status bug: admin UI sections that permanently show "analyzing" when nothing is running should show actual state or "idle"
- All four priority areas at a glance: broken extractors, AI cost today, coverage summary, pipeline health

### Claude's Discretion
- Per-task vs single env var for provider selection (based on how extraction, search, and discovery use AI differently)
- Auto-fix implementation details for broken extractors (what's realistically automatable)
- Exact layout and styling of new System Health tab
- Timeout/retry logic for the "stuck analysing" UI fix
- Which specific new auction houses to recruit (EIG/AuctionHouseUK clones)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `callGemini()` at server.js:908 — main AI function, needs extracting to lib/ai-provider.js
- `geminiRateLimited()` — rate limit wrapper, extract alongside callGemini
- `extractLotsWithAI()` at server.js:5284 — batch extraction using Gemini, will call through provider abstraction
- `DOM_EXTRACTORS` object at server.js:5577-8178 — 49 extractors to audit
- `scripts/audit.mjs` — existing nightly audit via GitHub Actions, extend for lot-count validation
- `/api/cost-monitor` at server.js:4513 — existing endpoint, keep for Firecrawl, add new AI costs endpoint
- `logActivityEvent()` at server.js:11178 — pattern for Supabase event logging, reuse for ai_usage
- Pipeline alerting (4 event types) from v1.1 — reuse for broken extractor alerts
- `HOUSE_EXTRACTION_HINTS` at server.js:943-967 — per-house hints, relevant during audit

### Established Patterns
- Admin auth via `x-admin-secret` header — new endpoints follow this
- Tab-based admin layout — new System Health tab follows existing tab pattern
- Circuit breaker flags (`creditExhausted`, `fcCreditExhausted`) — extend pattern for provider-level exhaustion
- `MODEL_PRO` and `MODEL_FLASH` constants at server.js:238-239 — replace with provider abstraction
- Structured JSON logging — use for cost logging events

### Integration Points
- `callGemini()` called from: extractLotsWithAI(), smart search, catalogue discovery — all must route through new provider layer
- Admin dashboard tabs in admin.html — add new System Health tab
- Environment variables: new AI_PROVIDER, AI_DAILY_BUDGET, GROK_API_KEY vars
- Supabase: new ai_usage table for cost logging
- Nightly audit script: extend with lot-count validation logic

</code_context>

<specifics>
## Specific Ideas

- User wants extractors validated against the house's own advertised lot count — "if we're scraping fewer than that there's a problem"
- User wants extractors "looking at houses and lots from different angles to ensure maximum performance" — research multi-strategy validation
- Admin cached houses section has "loads of old stale houses" — collapse inactive ones
- Upcoming auctions section should "confirm the house was reporting correctly, instead of just saying it's upcoming"
- Issues section should have "suggested fixes displayed next to the error, or a link to Claude to help fix these"
- Missing catalogues section is confusing — "if the tool knows these are missing why isn't it fixing them?"
- Some admin sections permanently show "analysing" — "makes them appear broken"
- Auto-fix broken extractors where possible for common failures

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-ai-scraping-hardening*
*Context gathered: 2026-03-22*
