# CONCERNS.md -- Technical Debt, Known Issues, and Areas of Concern

Generated: 2026-03-15

---

## 1. Monolith Architecture / File Size

The single biggest structural concern is that `server.js` is a **9,749-line monolith** (~456 KB) containing:
- Express HTTP server and middleware
- 40+ auction house DOM extractors (the `DOM_EXTRACTORS` object starting at line 4864)
- Three-tier scraping engine (Firecrawl, Puppeteer, plain HTTP)
- Gemini AI extraction pipeline
- Stripe billing and webhook handling
- Supabase auth/JWT verification
- Leads capture
- Scoring engine
- Smart search
- Admin endpoints
- Auto-analyse cron logic
- VOA rent data (8000+ lines of hardcoded rent tables around line 8274)
- Activity logging

Similarly, `index.html` is **3,007 lines** containing all CSS, HTML, and client-side JavaScript in a single file with no build step or module system.

This makes the codebase difficult to test, review, or safely refactor.

---

## 2. Backup File Indicating Incomplete Refactoring

`server.js.txt` (2,572 lines) is an older version of the server that uses **Anthropic/Claude** instead of Gemini for extraction and lacks the security hardening (CORS, CSRF, CSP headers, Sentry, Stripe) found in the current `server.js`. It imports `puppeteer` unconditionally and has no Firecrawl support. This file should either be deleted or moved to version control history -- its presence suggests a manual backup workflow rather than proper git branching.

Similarly, `server_leads_endpoint.js` (205 lines) contains a standalone copy of the leads API endpoint with a `// TODO: Replace with actual email sending` comment at line 137. This code appears to be duplicated into `server.js` already, making this file dead code.

**Files:**
- `server.js.txt` -- stale backup of older server
- `server_leads_endpoint.js` -- dead code / staging file with TODO

---

## 3. Known Bug Inventory (283 bugs catalogued)

The `bugs/` folder contains a comprehensive automated bug sweep from 2026-03-14. The summary in `bugs/bugs-SUMMARY.md` reports:

| Severity | Count |
|----------|-------|
| Critical | 4 |
| High | 18 |
| Medium | 60 |
| Low | 159+ |
| Fixed | 13 |

### Critical issues still open:

- **CRIT-1**: Admin endpoints may still accept secrets via query string (partially fixed per Auth BUG 6, but needs verification across all endpoints) -- `server.js` lines 2844, 2871, 2906
- **CRIT-2**: `PREMIUM_ENABLED=true` hardcoded client-side in `index.html` line 1049 -- all premium features accessible to everyone via DevTools
- **CRIT-3**: SSE stream reader in `index.html` lines 1891-1943 has no error handling -- connection drop causes unhandled exception

### High-severity security issues:

- **HIGH-1**: `/api/analyse` returns full unblurred data to all users regardless of tier
- **HIGH-2**: XSS in email templates -- user-supplied `name`, `email`, `auctionUrl` interpolated into HTML without escaping (`server.js` lines 747-765, 797-838)
- **HIGH-3**: Frontend `esc()` function does not escape quotes -- breaks out of HTML attributes
- **HIGH-15**: `/api/signup` overwrites `session_token` for existing users, enabling account takeover via email

---

## 4. Security Concerns

### 4a. `new Function()` execution of DOM extractors

`server.js` line 359 executes DOM extractor strings via `new Function('document', ...)`. The extractor strings are hardcoded in `DOM_EXTRACTORS`, not user-supplied, so this is not directly exploitable. However, it bypasses CSP and static analysis, and any future change that allows user-supplied extractor code would be catastrophic.

### 4b. Row-Level Security policies are permissive

All Supabase RLS policies across every schema file use `USING (true) WITH CHECK (true)`, meaning any authenticated role has full read/write access to all tables. The server uses the `service_role` key, which bypasses RLS entirely. If the `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_KEY` were ever exposed, all data (users, leads, cached analyses) would be fully accessible.

**Files:** `schema.sql` lines 101-105, `leads_schema.sql` line 62, `auction_calendar_schema.sql` line 29, `smart_search_cache_schema.sql` line 19, `analytics_snapshots_schema.sql` line 20

### 4c. CSP allows `unsafe-inline` for scripts

`server.js` line 87: `script-src 'self' 'unsafe-inline'` undermines XSS protection that the CSP header is supposed to provide.

### 4d. Supabase client initialized with empty strings

`server.js` lines 123-126: When `SUPABASE_URL` or `SUPABASE_SERVICE_KEY` are missing, the client is created with `''` values. It exists but silently fails on every query. The `SUPABASE_JWT_SECRET` defaulting to `''` is particularly dangerous -- it could theoretically allow JWT verification to pass with an empty secret.

### 4e. CORS allows wildcard in Vercel API endpoints

`api/analyse.js` line 19: `Access-Control-Allow-Origin: *` -- the Vercel serverless endpoint has no origin restriction. The main Express server has proper origin checking, but these legacy Vercel functions do not.

### 4f. No rate limiting on many public endpoints

Multiple agents flagged missing rate limiting on `/api/leads`, `/api/signup`, `/api/all-lots`, and Stripe endpoints. The in-memory rate limiter at line 986 exists but is not applied to all routes.

---

## 5. Performance Concerns

### 5a. In-memory caching with no eviction

The codebase uses in-memory Maps and objects for caching (rate limit buckets at line 985, Gemini rate limiting state, Firecrawl credit tracking). On Railway with limited RAM, these grow unbounded. The `_rlBuckets` Map is never pruned of expired entries.

### 5b. Full `lots` array stored as JSONB

`schema.sql` line 16: `lots jsonb NOT NULL` stores the entire lot array (potentially hundreds of lots with all fields) as a single JSONB column. Queries against individual lot properties require full column scan. No GIN index on the JSONB column.

### 5c. Puppeteer memory pressure

Puppeteer (headless Chrome) runs on the same Railway container as the Express server. Multiple concurrent scrapes can exhaust available RAM. The `acquirePage()` function manages a page pool but browser crashes under memory pressure are a known issue (HIGH-16 from bug summary: `browser.newPage()` failure not caught).

### 5d. Hardcoded VOA rent data

Lines ~8274+ of `server.js` contain thousands of lines of hardcoded rent data for UK areas. This should be in a database table or external file, not compiled into the server module. It inflates the startup parse time and makes the file unwieldy.

### 5e. Sequential scraping with artificial delays

The Gemini rate limiter enforces a 4.1-second gap between calls (line 243). For a catalogue with 10 pages processed in batches of 3, this means ~14 seconds of mandatory waiting on Gemini alone, plus Firecrawl delays. This is necessary for the free tier but creates poor UX for analysis.

---

## 6. Code Duplication

### 6a. Image backfill logic duplicated 4 times

Image extraction/matching logic (href-to-image maps, lot number matching, position-based fallback) is duplicated across:
- `extractWithJSDOM()` (lines 408-478)
- `backfillImagesWithFirecrawl()` (lines 688-816)
- `backfillImages()` (line 7672)
- `backfillImagesWithPuppeteer()` (line 7866)

Each copy has slightly different skip patterns and matching strategies.

### 6b. `stripHtml()` duplicated between server.js and api/analyse.js

`server.js` line 4826 and `api/analyse.js` line 245 both contain `stripHtml()` functions with slightly different implementations (the server.js version is more aggressive with noise removal).

### 6c. Scoring engine duplicated

`api/analyse.js` lines 274-375 contains a complete `analyseLot()` scoring engine that duplicates the one in `server.js`. The server.js version has likely diverged (more patterns, updated scoring weights).

### 6d. Firecrawl scroll actions duplicated

The same scroll + wait + executeJavascript action array is copy-pasted in `scrapeRenderedPage()` (lines 579-597) and `backfillImagesWithFirecrawl()` (lines 692-708).

---

## 7. Vestigial / Dead Code

### 7a. Vercel configuration

`vercel.json` remains in the repo despite the project having migrated to Railway/Express. The `api/analyse.js` and `api/auctions.js` are Vercel serverless functions that use Anthropic (not Gemini) and have no shared auth/security with the main server. These are effectively dead code.

**Files:** `vercel.json`, `api/analyse.js`, `api/auctions.js`

### 7b. Hardcoded auction calendar in api/auctions.js

`api/auctions.js` contains a manually curated list of auction dates. The main server has its own calendar system backed by Supabase (`auction_calendar` table). This Vercel function is stale.

### 7c. `/api/diag` endpoint marked as temporary

`server.js` line 3831: Comment reads `// DIAGNOSTIC ENDPOINT (temporary -- remove after debugging)`. Still present in production.

### 7d. Legacy `session_token` auth path

`server.js` around line 904: The old session-token authentication mechanism co-exists alongside Supabase JWT auth, creating two parallel auth systems.

---

## 8. Missing Error Handling

### 8a. Supabase queries missing error checks (20+ locations)

Throughout `server.js`, Supabase queries destructure only `{ data }` without checking `{ error }`. When Supabase is unavailable: rate limiting breaks, cache returns empty arrays, webhook events fail silently, signup creates duplicates. This was flagged as HIGH-9 in the bug summary.

### 8b. `callGemini()` can still crash callers

While `callGemini()` (line 819) now has basic error handling, it re-throws errors that not all callers catch consistently. The Gemini response JSON parsing (`text.match(/\[[\s\S]*\]/)` pattern at line 4802 and elsewhere) silently drops entire batches if JSON is malformed.

### 8c. Frontend fetch calls don't check `r.ok`

`index.html` has multiple `fetch()` calls that go straight to `r.json()` without checking `r.ok` first. Server 500/502 responses produce confusing JSON parse errors instead of meaningful messages.

### 8d. Empty catch blocks

Both `server.js` and `index.html` contain catch blocks that silently swallow errors. The bug summary (MED-49) notes "Widespread empty catch blocks -- errors completely swallowed with no logging."

---

## 9. Fragile Areas

### 9a. DOM extractors break when auction houses redesign

The `DOM_EXTRACTORS` object contains CSS selector-based extractors for 40+ auction houses. When any house redesigns their website, its extractor silently fails and falls back to Gemini API extraction (which is rate-limited and loses images). There is no automated alerting when an extractor stops returning lots.

### 9b. Pagination detection is heuristic

`detectTotalPages()` uses regex heuristics to find pagination patterns. Different houses use different patterns. False positives (detecting navigation links as page numbers) or false negatives (missing pages) are common failure modes.

### 9c. Position-based image matching

When other image-matching strategies fail, `extractWithJSDOM()` falls back to position-based matching (nth image = nth lot). This produces incorrect image assignments when the page layout changes or has non-lot images interspersed.

### 9d. Global mutable state

Variables like `creditExhausted`, `fcCreditExhausted`, `fcTemporarilyDown`, `_lastScrapeEngine`, `_lastExtractorUsed` (lines 264-272, 570-572, 8842-8843) are module-level mutable state. Concurrent requests can race on these flags, potentially causing one request to incorrectly see another's state.

### 9e. `parseInt()` without radix or NaN check

Multiple `parseInt()` calls throughout `server.js` lack a radix parameter and don't check for `NaN`, which can propagate bad values into scoring calculations (MED-50).

---

## 10. Scalability Concerns

### 10a. Single-process architecture

The entire application runs as a single Node.js process on Railway. There is no horizontal scaling, no worker queue for scraping jobs, and no separation between the web server and background scraping tasks. An `autoAnalyseAll()` run (scraping 40+ auction houses sequentially) blocks the event loop with Puppeteer operations.

### 10b. No database connection pooling

The Supabase client is created once at startup. Under heavy load, concurrent database operations may exhaust the connection pool without proper backpressure.

### 10c. Gemini free tier rate limits

The system is built on Gemini's free tier (15 RPM, 1500 RPD). Scaling to more auction houses or more frequent scraping requires a paid tier. The `creditExhausted` flag and auto-reset mechanism at line 8842 is a fragile workaround for this fundamental constraint.

### 10d. No CDN for static assets

Static HTML, CSS, and JS are served directly from the Express server. There is no CDN layer, no asset fingerprinting, and no cache headers on static files (beyond what Express static middleware provides by default).

---

## 11. Schema Concerns

### 11a. Multiple standalone schema files

The database schema is spread across 6 separate SQL files with no migration system:
- `schema.sql` -- core tables
- `leads_schema.sql` -- leads table
- `auction_calendar_schema.sql` -- calendar
- `analytics_snapshots_schema.sql` -- analytics
- `smart_search_cache_schema.sql` -- search cache
- `add_session_token.sql` -- ALTER TABLE migration
- `add_stats_columns.sql` -- ALTER TABLE migration

There is no migration runner, no version tracking, and no way to determine which migrations have been applied. The `add_session_token.sql` and `add_stats_columns.sql` files are one-off ALTER TABLE scripts that may or may not have been run.

### 11b. No foreign key constraints

The `users` table has no relationship to `leads`, `cached_analyses`, or `rate_limits`. There are no foreign keys anywhere in the schema. User deletion would leave orphaned records.

### 11c. `consent_given` defaults to `true`

`leads_schema.sql` line 49: `consent_given boolean DEFAULT true` -- consent should be explicitly captured, not assumed.

---

## 12. TODO / FIXME Comments

Only one explicit TODO was found in the application code:

- `server_leads_endpoint.js` line 137: `// TODO: Replace with actual email sending` -- the lead notification function only logs to console. The main `server.js` appears to have implemented Resend-based email sending, confirming this file is stale.

The CLAUDE.md file contains a larger roadmap of unimplemented features (automated calendar scraping, email alerts, Land Registry integration, EPC lookups).

---

## 13. Dependency Concerns

- `package.json` lists `puppeteer` as a production dependency (`^22.0.0`). Puppeteer bundles Chromium (~280 MB), significantly inflating the Docker image and Railway deployment size.
- `package-lock.json` line 3501 flags a deprecated dependency: `< 24.15.0 is no longer supported`.
- `@sentry/node` at `^8.0.0` -- verify this is the latest major version for the Node.js runtime in use.
- No lockfile integrity verification in the build/deploy pipeline.

---

## 14. Testing Gaps

The only test file is `tests/test-extractors.js`, which tests DOM extractors against saved HTML snapshots (3 files in `tests/snapshots/`). There are no tests for:
- Scoring engine
- Auth/JWT verification
- Stripe webhook handling
- Rate limiting
- API endpoint behavior
- Frontend JavaScript logic

The `scripts/` directory contains audit/QA scripts (`audit.mjs`, `pre-launch-qa.mjs`) but these appear to be operational checks rather than unit/integration tests.

---

## Summary: Recommended Priority Order

1. **Security**: Fix XSS in email templates, `esc()` quote escaping, `PREMIUM_ENABLED` client-side flag, `/api/signup` account takeover (items from bug summary Priority 1)
2. **Error handling**: Add error checks to Supabase queries, frontend fetch calls, and callGemini
3. **Rate limiting**: Apply rate limits to all public endpoints
4. **Cleanup**: Delete `server.js.txt`, `server_leads_endpoint.js`, `vercel.json`, `api/analyse.js`, `api/auctions.js`
5. **Architecture**: Begin extracting `server.js` into modules (DOM extractors, scoring engine, VOA data, auth middleware)
6. **Schema**: Implement a migration system; add foreign keys
7. **Testing**: Add tests for scoring engine, auth flows, and critical API endpoints
