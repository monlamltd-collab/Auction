# Phase 01: Hardening & Data Freshness — Verification Report

**Verified:** 2026-03-15
**Phase goal:** Fix broken code (SDLT rates, Stripe trial abuse, webhook idempotency, immediate downgrade), improve data freshness (future-only defaults, sold/unsold tracking, alerting), switch Firecrawl to markdown+rawHtml format.

## Requirement Cross-Reference

Phase requirement IDs from ROADMAP.md: HARD-01, HARD-02, HARD-03, HARD-04, HARD-05, HARD-07, FRSH-01, FRSH-02, FRSH-03, FRSH-04, FRSH-05

All 11 requirement IDs are accounted for. Each is verified below.

---

### HARD-01: SDLT calculator uses correct 2025/26 investor rates (5% surcharge, not 3%)

**Status: PASS**

- `index.html` line ~2476: `calcSDLT(price, country)` uses 5% surcharge for England (line 2505: `price * 0.05` for <=250k, then 10% to 925k, 15% to 1.5M, 17% above).
- Comment explicitly states "5% surcharge" (line 2504).
- Old 3% surcharge is not present anywhere in the codebase.
- `bridgematch-lite.html` also has matching `calcSDLT()` with identical 5% rates.

**Evidence:** `index.html:2505` — `if(price<=250000) return Math.round(price*0.05);`

---

### HARD-02: SDLT calculator handles Scotland (LBTT + ADS) and Wales (LTT) correctly

**Status: PASS**

- Scotland branch (line 2479-2487): 6% ADS on full price + progressive LBTT bands (2% 145k-250k, 5% 250k-325k, 10% 325k-750k, 12% 750k+).
- Wales branch (line 2489-2502): LTT higher rates (4% to 180k, 7.5% 180k-250k, 9% 250k-400k, 11.5% 400k-750k, 14% 750k-1.5M, 16% 1.5M+).
- Country selector dropdown (`sdltCountry`) in finance profile panel with localStorage persistence.
- `detectCountry()` helper auto-detects Scotland/Wales from postcodes and city names.
- `bridgematch-lite.html` has matching standalone `calcSDLT()` and country dropdown.

**Evidence:** `index.html:2478-2513`, `index.html:2516-2532`, `index.html:869`

---

### HARD-03: Stripe trial_used flag checked on signup to prevent trial abuse

**Status: PASS**

- `server.js` line ~1724: Comment "Auto-create new user -- check trial_used to prevent trial abuse".
- Queries existing user by email, checks `trial_used` flag (line 1728-1734).
- If `trial_used` is true, user is created with `tier: 'free'` instead of receiving a trial.

**Evidence:** `server.js:1724-1734` — `if (existingByEmail && existingByEmail.trial_used) {`

---

### HARD-04: Stripe webhooks deduplicate events by event.id (idempotency)

**Status: PASS**

- `processed_webhook_events` table in `schema.sql` (line 95-98) with `event_id TEXT PRIMARY KEY`.
- Before processing, webhook handler checks for existing event (server.js line 1309-1313).
- After processing, event is recorded via upsert for race-condition safety (line 1459-1463).
- Periodic cleanup every 100th webhook removes events older than 7 days (line 1468-1473).

**Evidence:** `server.js:1308-1313`, `schema.sql:95-98`

---

### HARD-05: Subscription downgrade honours current_period_end instead of immediate cutoff

**Status: PASS**

- `customer.subscription.deleted` handler (server.js line 1370-1389): Reads `sub.current_period_end`, converts to Date. If period end is in the future, sets `tier_expires_at` to that date instead of immediate downgrade.
- `customer.subscription.updated` handler (line 1412-1418): For `past_due` status, gives 3-day grace period before downgrade. For `unpaid`, immediate downgrade (all retries exhausted).
- `canceled` status also honours the period end via `tier_expires_at`.

**Evidence:** `server.js:1370-1379` — `if (periodEnd && periodEnd > new Date()) { ... tier_expires_at: periodEnd.toISOString() }`

---

### HARD-07: Firecrawl requests use ['markdown', 'rawHtml'] format

**Status: PASS**

- `server.js` line 279: Default formats are `['markdown', 'rawHtml']`.
- Markdown is returned alongside rawHtml from Firecrawl (line 325: `markdown: data.data?.markdown || ''`).
- Markdown is passed through pagination (line 735, 748).
- AI extraction prefers markdown when available and >200 chars, falls back to stripped HTML (line 4922: `p.markdown && p.markdown.length > 200`).

**Evidence:** `server.js:279` — `const formats = options.formats || ['markdown', 'rawHtml'];`

---

### FRSH-01: Frontend defaults to future-only auctions

**Status: PASS**

- Server-side filtering in `/api/all-lots` (server.js line 3616-3630): 7-day grace period cutoff. Lots with null `_auctionDate` are always included.
- Filtering is opt-out: `includePast` query param must be explicitly set to `'true'` (line 3617).
- Frontend: `fShowPast` checkbox (index.html line 845), unchecked by default. URL parameter `?showPast=true` is bookmarkable (line 1139-1143).
- `loadAllLots()` sends `?includePast=true` only when checkbox is checked (line 1151).

**Evidence:** `server.js:3616-3630`, `index.html:845,1138-1151`

---

### FRSH-02: Lot-level sold/unsold status reliably detected and displayed

**Status: PASS**

- `normaliseLotStatuses()` function (server.js line 5124) normalises status from bullets and AI output.
- Detects SOLD, STC/Sale Agreed/Under Offer, Withdrawn/Postponed from bullet text for legacy data.
- Status field included in AI extraction prompts (line 4940): `status: string -- one of "available", "sold", "stc", "withdrawn"`.
- Status added to both HTML and PDF extraction prompts.
- Overlay banners displayed on lot cards: `.lot-status-overlay` CSS (index.html line 429-430) with per-status colours (red/orange/grey for sold/stc/withdrawn).

**Evidence:** `server.js:5121-5134`, `index.html:429-430,2640`

---

### FRSH-03: Standardised lot.status field in extraction pipeline

**Status: PASS**

- `normaliseLotStatuses()` centralises status normalisation at API response time.
- Called in three places: `/api/all-lots` (line 3560), analyse endpoint delta lots (line 3233), and analyse endpoint main path (line 3408).
- Status field in AI prompt specifies exact valid values: "available", "sold", "stc", "withdrawn" (line 4940).
- Default is "available" if not stated (line 4975: `status: lot.status || 'available'`).

**Evidence:** `server.js:5124,3233,3408,3560,4940`

---

### FRSH-04: Alerting fires when auto-analyse fails or discovery misses catalogues

**Status: PASS**

- `pipeline_alerts` table in schema.sql (line 105-114) with 4 event types: `auto_analyse_failure`, `extractor_regression`, `discovery_miss`, `image_coverage_drop`.
- Alert generation in `autoAnalyseOne()`: failure alerts on catch (line 9928), regression alerts on lot count drop (line 9791), auto-resolve on success (line 9917-9919).
- Alert generation in `discoverAndUpdateCalendar()`: discovery miss alerts on errors (line 9526) and consecutive misses >= 3 (line 9540).
- Image coverage drop alerts when coverage drops below 50% from above 50% for houses with >5 lots (line 10016-10018).
- Admin API endpoint `/api/admin/alerts` (line 10124) with x-admin-secret auth.

**Evidence:** `server.js:9526,9540,9791,9917,9928,10016,10124`, `schema.sql:105-114`

---

### FRSH-05: Admin dashboard shows data freshness metrics

**Status: PASS**

- `/api/admin/freshness` endpoint (server.js line 10152) returns per-house freshness data.
- `admin.html` includes:
  - Alerts feed section (`#alertsSection`, line 237) with active/resolved alerts and count badge.
  - House health table (`.freshness-table`, line 255) with sortable columns.
  - `loadAlerts()` and `loadFreshness()` functions wired into `refreshAll()`.
- Per-scrape diff summaries computed by `computeScrapeDiff()` (server.js line 9942) and stored in `house_skills.last_diff`.

**Evidence:** `server.js:10152,9942`, `admin.html:237,250,255,593,633`

---

## Summary

| Requirement | Plan | Status | Verified In |
|-------------|------|--------|-------------|
| HARD-01 | 01-01 | PASS | index.html, bridgematch-lite.html |
| HARD-02 | 01-01 | PASS | index.html, bridgematch-lite.html |
| HARD-03 | 01-02 | PASS | server.js |
| HARD-04 | 01-02 | PASS | server.js, schema.sql |
| HARD-05 | 01-02 | PASS | server.js |
| HARD-07 | 01-03 | PASS | server.js |
| FRSH-01 | 01-03 | PASS | server.js, index.html |
| FRSH-02 | 01-03 | PASS | server.js, index.html |
| FRSH-03 | 01-03 | PASS | server.js |
| FRSH-04 | 01-04 | PASS | server.js, schema.sql |
| FRSH-05 | 01-04 | PASS | server.js, admin.html |

**Result: 11/11 requirements PASS. Phase 01 goal achieved.**

All requirement IDs from the ROADMAP phase definition are accounted for in REQUIREMENTS.md and verified against the actual codebase. No missing or unimplemented requirements found.

---
*Verification completed: 2026-03-15*
