# Technology Stack

> **⚠️ STALE — DO NOT TRUST.** Last accurate ~2026-04. References the deleted `api/` directory, the monolithic `server.js`, deleted `scripts/audit.mjs` / `audit-fix.mjs`, and the deleted DOM extractor test suite. For the current stack snapshot see `CLAUDE.md` and `.claude/skills/auction-conventions/SKILL.md`. This file is retained only as a historical reference.

## Language and Runtime

- **JavaScript (ES Modules)** — `"type": "module"` in `package.json`
- **Node.js >= 18** — specified in `package.json` `engines` field
- **Dockerfile uses `node:20-slim`** — production runtime is Node 20

## Frameworks and Core Libraries

| Dependency | Version | Purpose |
|---|---|---|
| `express` | ^4.21.0 | HTTP server, routing, middleware |
| `@google/generative-ai` | ^0.24.1 | Google Gemini API client for AI lot extraction |
| `@supabase/supabase-js` | ^2.45.0 | Supabase client for database, auth, and RLS |
| `jose` | ^5.0.0 | JWT verification (Supabase auth token validation via JWKS) |
| `jsdom` | ^24.0.0 | Server-side DOM parsing for HTML extraction (DOM extractors) |
| `puppeteer` | ^22.0.0 | Headless Chrome for JS-rendered sites (conditional import, fallback scraper) |
| `stripe` | ^20.4.0 | Stripe payments — checkout sessions, webhooks, customer/subscription management |
| `@sentry/node` | ^8.0.0 | Error tracking and performance monitoring |

### Dev Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| `sharp` | ^0.34.5 | Image processing (likely for OG image generation) |

## Key Dependency Notes

- **Puppeteer is conditionally imported** — the server starts without it if unavailable. Chromium install is optional in the Dockerfile via `INSTALL_CHROMIUM` build arg.
- **Stripe is conditionally initialised** — only active when `STRIPE_SECRET_KEY` is set.
- **Sentry is conditionally initialised** — only active when `SENTRY_DSN` is set.
- **No Firecrawl SDK** — Firecrawl is called via raw `fetch()` to `https://api.firecrawl.dev/v1/scrape`.
- **No Resend SDK** — Resend email API is called via raw `fetch()` to `https://api.resend.com/emails`.

## Build and Dev Tooling

| Script | Command | Purpose |
|---|---|---|
| `start` | `node server.js` | Production start |
| `dev` | `node --watch server.js` | Development with native Node watch mode |
| `test` | `node tests/test-extractors.js` | DOM extractor tests against saved HTML snapshots |
| `audit` | `node scripts/audit.mjs` | Auction house health audit (checks all extractors against live sites) |

### CI/CD

- **GitHub Actions** — `.github/workflows/nightly-audit.yml` runs a daily cron job (5am UTC) that:
  1. Runs the full audit (`scripts/audit.mjs --json --save`)
  2. Applies auto-fixes and sends an email report (`scripts/audit-fix.mjs`)
  3. Commits and pushes any fixes as "Auction Health Bot"
- **Docker** — `Dockerfile` based on `node:20-slim` with optional Chromium install for Puppeteer
- **Railway** — production hosting platform (set via env vars, `trust proxy` configured)

### Legacy

- **`vercel.json`** — vestigial config from when the project was hosted on Vercel. No longer used in production (Railway + Express now).
- **`api/analyse.js` and `api/auctions.js`** — Vercel serverless function stubs. `api/analyse.js` uses the Anthropic SDK (Claude) instead of Gemini, suggesting it was an early prototype. The production server uses `server.js` directly.

## Configuration Approach

All configuration is via **environment variables**. No `.env` files are committed.

### Required

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key for AI lot extraction |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (full DB access) |

### Recommended (features degrade gracefully without these)

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API key for payments |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |
| `STRIPE_MONTHLY_PRICE_ID` | Stripe Price ID for subscription product |
| `SUPABASE_ANON_KEY` | Supabase anon key (client-side auth) |
| `SUPABASE_JWT_SECRET` | JWT secret for HS256 token verification fallback |
| `ADMIN_SECRET` | Secret token for admin API endpoints |
| `RESEND_API_KEY` | Resend email API key |
| `FIRECRAWL_API_KEY` | Firecrawl managed scraping API key |
| `SENTRY_DSN` | Sentry error tracking DSN |

### Tuning

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Server port (Railway sets this) |
| `FIRECRAWL_MONTHLY_BUDGET` | 95000 | Optional soft cap on monthly Firecrawl credits, sized just under the 100k plan quota (set lower to throttle earlier) |
| `FIRECRAWL_SKIP_HOUSES` | (empty) | Comma-separated house slugs to bypass Firecrawl |
| `FIRECRAWL_MIN_GAP_MS` | 300 | Minimum gap between Firecrawl API calls |
| `ALLOWED_ORIGINS` | bridgematch.co.uk domains | CORS allowed origins |
| `NODE_ENV` | production | Environment label for Sentry |

## Project Structure

```
server.js              — Monolithic Express server (~456KB, ~9700 lines)
index.html             — Single-page app (directory + analyser views)
admin.html             — Admin dashboard
welcome.html           — Welcome/onboarding page
bridgematch-lite.html  — Investor-facing bridging finance tool
privacy.html           — Privacy policy
terms.html             — Terms of service
Dockerfile             — Production container (node:20-slim + optional Chromium)
vercel.json            — Legacy Vercel config (unused)
package.json           — Dependencies and scripts
schema.sql             — Core Supabase schema
leads_schema.sql       — Leads table schema
auction_calendar_schema.sql — Calendar table schema
smart_search_cache_schema.sql — Smart search cache schema
analytics_snapshots_schema.sql — Analytics snapshots schema
api/analyse.js         — Legacy Vercel serverless function (uses Anthropic/Claude)
api/auctions.js        — Legacy Vercel serverless function (static calendar)
scripts/audit.mjs      — Auction house health auditor
scripts/audit-fix.mjs  — Auto-fix + email report from audit results
scripts/pre-launch-qa.mjs — Pre-launch QA checks
scripts/test-*.mjs     — Per-house extractor test scripts
tests/test-extractors.js — DOM extractor test suite
public/                — Static assets (favicon, OG image, Supabase client JS)
```
