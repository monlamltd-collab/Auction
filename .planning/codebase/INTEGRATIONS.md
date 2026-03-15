# External Integrations

## Database

### Supabase (PostgreSQL)

- **Type:** Hosted PostgreSQL via Supabase
- **Connection:** `@supabase/supabase-js` client with service role key (server-side, full access)
- **Config:** `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` env vars
- **Row Level Security:** Enabled on all tables, with service role bypass policies
- **Connection file:** `server.js` (lines 123-126)

#### Tables

| Table | Schema file | Purpose |
|---|---|---|
| `cached_analyses` | `schema.sql` | Cached scrape/analysis results per catalogue URL (7-day TTL) |
| `rate_limits` | `schema.sql` | Per-IP daily request tracking |
| `users` | `schema.sql` | User accounts (email, tier, session tokens, Stripe IDs) |
| `analytics_snapshots` | `schema.sql` | Daily system health snapshots for time-series |
| `house_skills` | `schema.sql` | Per-house scraping configuration and status tracking |
| `auction_calendar` | `auction_calendar_schema.sql` | Upcoming auction dates and catalogue URLs |
| `smart_search_cache` | `smart_search_cache_schema.sql` | AI smart search result cache (1-hour TTL) |
| `leads` | `leads_schema.sql` | Bridging finance lead capture (investor contact + deal data) |
| `consent_log` | referenced in `server.js` | GDPR consent audit trail |

### In-Memory Caching

- `server.js` maintains extensive in-memory caches alongside Supabase persistence
- Tiered cache TTLs (`CACHE_TIERS`) and content hash-based change detection

## AI / LLM APIs

### Google Gemini

- **SDK:** `@google/generative-ai` (`GoogleGenerativeAI` class)
- **Models used:**
  - `gemini-2.5-flash-lite` — primary model for known auction houses (fast, cheap)
  - `gemini-2.5-pro` — for unknown houses and PDF extraction
- **Purpose:** Structured lot data extraction from stripped HTML, smart search natural language queries
- **Rate limiting:** Built-in 4.1-second gap between calls (15 RPM free tier safe margin)
- **Config:** `GEMINI_API_KEY` env var
- **Usage locations:** `callGemini()` in `server.js` (line ~819), smart search endpoint, catalogue discovery

### Anthropic Claude (Legacy)

- **SDK:** `@anthropic-ai/sdk` — used only in `api/analyse.js` (legacy Vercel serverless function)
- **Model:** `claude-sonnet-4-20250514`
- **Purpose:** Original lot extraction (before migration to Gemini). Not used in production `server.js`.
- **Config:** `ANTHROPIC_API_KEY` env var (only needed for legacy endpoint)

## Scraping Services

### Firecrawl

- **No SDK** — called via raw `fetch()` to `https://api.firecrawl.dev/v1/scrape`
- **Purpose:** Primary managed scraping service. Handles JS rendering, anti-bot, proxy rotation.
- **Features used:** `rawHtml` format, `images` format, `executeJavascript` actions for lazy-loaded images
- **Rate limiting:** Custom rate limiter (`firecrawlRateLimited()`), monthly budget cap, auto-fallback on 402/429
- **Credit management:** Hash-based dedup saves ~50-70% credits; per-house skip list; auto-exhaustion detection with 1-hour cooldown; 3x 5xx marks temporarily down for 10 minutes
- **Config:** `FIRECRAWL_API_KEY`, `FIRECRAWL_MONTHLY_BUDGET`, `FIRECRAWL_SKIP_HOUSES`, `FIRECRAWL_MIN_GAP_MS`
- **Fallback chain:** Firecrawl -> Puppeteer -> Plain HTTP fetch
- **Usage:** `scrapeWithFirecrawl()` in `server.js` (line ~274)

### Puppeteer (Self-hosted)

- **Library:** `puppeteer` ^22.0.0 (conditional import — server works without it)
- **Purpose:** Fallback headless Chrome scraper for JS-rendered sites when Firecrawl is unavailable
- **Runtime:** Chromium installed in Docker container (`/usr/bin/chromium`), or skipped for Firecrawl-only deployments
- **Config:** `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true`, `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`

## Payments

### Stripe

- **SDK:** `stripe` ^20.4.0
- **Config:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MONTHLY_PRICE_ID`
- **Features:**
  - **Checkout Sessions** — `POST /api/stripe/checkout` creates subscription or one-time payment sessions
  - **Webhooks** — `POST /api/stripe/webhook` handles `checkout.session.completed`, `invoice.payment_failed`, subscription lifecycle events
  - **Customer Portal** — `POST /api/stripe/portal` creates billing portal sessions for self-service management
  - **Subscription Status** — `GET /api/stripe/status` checks subscription state
  - **Customer Management** — lazy-creates Stripe customers, links to Supabase users via `stripe_customer_id`
- **Webhook events handled:** checkout completion (tier upgrade), payment failures (email notification), subscription cancellation
- **Usage:** `server.js` lines ~1169-1370

## Authentication

### Supabase Auth (JWT)

- **Method:** JWT token verification via two strategies:
  1. **ES256 via JWKS** (primary) — fetches Supabase JWKS endpoint for public key verification
  2. **HS256 via shared secret** (fallback) — uses `SUPABASE_JWT_SECRET` for HMAC verification
- **Library:** `jose` (createRemoteJWKSet, jwtVerify)
- **Implementation:** `verifySupabaseToken()` in `server.js` (line ~146)
- **Protected endpoints:** Most API endpoints check for Bearer token in Authorization header

### Admin Auth

- **Method:** Shared secret comparison (`x-admin-secret` header)
- **Implementation:** Timing-safe comparison via `safeCompare()` using Node crypto `timingSafeEqual`
- **Config:** `ADMIN_SECRET` env var
- **Protected endpoints:** Calendar management, cache operations, rescrape triggers, analyse-all

### Session Tokens

- **Method:** Random token (`crypto.randomBytes`) stored in `users.session_token` column
- **Purpose:** Lightweight session management alongside JWT auth

## Email / Notifications

### Resend

- **No SDK** — called via raw `fetch()` to `https://api.resend.com/emails`
- **Config:** `RESEND_API_KEY` env var
- **Sender:** Sent from `bridgematch.co.uk` domain
- **Email types:**
  - **Welcome emails** — sent on new user signup (`sendWelcomeEmail()` in `server.js` line ~1486)
  - **Payment failure notifications** — sent when Stripe invoice payment fails (line ~1314)
  - **Magic link / login emails** — sent during passwordless auth flow (line ~1464)
  - **Nightly audit reports** — sent by `scripts/audit-fix.mjs` with health summary

## Error Monitoring

### Sentry

- **SDK:** `@sentry/node` ^8.0.0
- **Config:** `SENTRY_DSN` env var (conditional init)
- **Settings:** `tracesSampleRate: 0.1` (10% performance sampling)
- **Environment:** reads from `NODE_ENV` (defaults to `production`)
- **Init:** Must be imported before all other modules (line 1 of `server.js`)

## Hosting and Infrastructure

### Railway

- **Type:** Container hosting (Docker-based)
- **Reverse proxy:** Express configured with `trust proxy: 1` for correct client IP
- **Port:** Set via `PORT` env var (Railway provides this)
- **Domain:** `auctions.bridgematch.co.uk`

### GitHub Actions

- **Nightly audit workflow** — `.github/workflows/nightly-audit.yml`
- Runs daily at 5am UTC, auto-commits fixes, sends email reports
- Uses `actions/checkout@v4`, `actions/setup-node@v4` with Node 20

## CDN / External Assets

Referenced in Content-Security-Policy headers:
- `https://cdnjs.cloudflare.com` — external JS libraries
- `https://fonts.googleapis.com` / `https://fonts.gstatic.com` — Google Fonts (Outfit, Sora, JetBrains Mono)
- `https://checkout.stripe.com` — Stripe Checkout iframe

## Summary of External API Calls

| Service | Method | Endpoint | Auth |
|---|---|---|---|
| Google Gemini | SDK | via `@google/generative-ai` | `GEMINI_API_KEY` |
| Firecrawl | fetch | `https://api.firecrawl.dev/v1/scrape` | Bearer token (`FIRECRAWL_API_KEY`) |
| Resend | fetch | `https://api.resend.com/emails` | Bearer token (`RESEND_API_KEY`) |
| Stripe | SDK | via `stripe` package | `STRIPE_SECRET_KEY` |
| Supabase | SDK | via `@supabase/supabase-js` | `SUPABASE_SERVICE_KEY` |
| Sentry | SDK | via `@sentry/node` | `SENTRY_DSN` |
| Supabase JWKS | jose | `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` | Public endpoint |
