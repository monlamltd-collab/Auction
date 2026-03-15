# BridgeMatch Bug Log — Auth & Stripe Agent
Started: Sat Mar 14 03:13:46 GMTST 2026

## BUG 1
**File:** server.js:2574-2700 (`/api/all-lots` endpoint)
**Area:** Gating
**Severity:** Critical
**Description:** The `/api/all-lots` endpoint returns full lot data (scores, opportunities, risks, full addresses, listing URLs) to ALL users including unauthenticated visitors. Line 2578 comment confirms: "Optional auth — all users see full data (no blurring)". The `stripAIFields()` function exists (line 946) but is never called anywhere in the codebase — it is dead code. This means the entire paid-tier data gating for the directory view is non-functional. Every lot's score, opps, risks, full address, and auction house URL are exposed to anonymous `curl` requests.
**Reproduction steps:** `curl https://auctions.bridgematch.co.uk/api/all-lots` — returns all lot data with scores, opps, risks, full addresses, and listing URLs with no auth token.
**Suggested fix:** Call `stripAIFields(lots)` for free/anon users before returning from `/api/all-lots`. Check user tier and only return full data for premium/trial users.
---

## BUG 2
**File:** server.js:2140, 1709 (`/api/analyse` endpoint)
**Area:** Gating
**Severity:** High
**Description:** The `/api/analyse` endpoint always returns `blurred: false` and sends full lot data (scores, opps, risks, full addresses, URLs) regardless of user tier. Line 1648 comment confirms: "Tier info (blurring removed — all data visible)". Any authenticated user (including free tier) gets complete analysis results with no data restriction. The `FREE_SCAN_LIMIT` of 3 limits how many analyses they can run, but each analysis returns full unblurred data.
**Reproduction steps:** Sign up as a free user, run `/api/analyse` with any catalogue URL — full scores, opportunities, risks, and addresses are returned.
**Suggested fix:** Re-enable `stripAIFields()` for free-tier users beyond the preview lot count, or decide if the scan limit alone is the intended gating mechanism and document that decision.
---

## BUG 3
**File:** index.html (absent), server.js (absent)
**Area:** Coming Soon Label
**Severity:** Medium
**Description:** The mission spec requires "Coming Soon" labels on: yield calculations, comparables, deal stacking tool, and analytics dashboard. None of these have "Coming Soon" labels. Yield data (`estGrossYield`, `estMonthlyRent`) is computed and displayed to all users in lot cards. The `calcDealAnalysis()` function (index.html:2440) runs client-side for any user — it calculates uplift, SDLT, bridging costs, net profit, and ROI using `streetAvg` (comparables) data. Street averages (`streetAvg`, `belowMarket%`) are also visible to all users in lot cards and CSV exports. The only "Coming Soon" text in the entire app is "Portfolio tracking (coming soon)" on the paywall modal (index.html:760).
**Reproduction steps:** Browse any lot listing — yield estimates, street averages, below-market percentages are visible to unauthenticated users. Open browser console and call `calcDealAnalysis(100000, 150000, 7.5, 650)` — full deal stack result returned.
**Suggested fix:** Add "Coming Soon" labels/overlays to yield calculation sections, comparables data, and deal stacking tool in the frontend. Hide the underlying data from the API response until these features are formally launched.
---

## BUG 4
**File:** server.js:631-635 (`invoice.payment_failed` webhook handler)
**Area:** Stripe Webhook
**Severity:** Medium
**Description:** The `invoice.payment_failed` webhook event only logs a warning but takes no action on the user's account. If Stripe retries fail and the subscription becomes delinquent, the user retains premium access until `customer.subscription.deleted` or `customer.subscription.updated` fires. There is a window (potentially days, depending on Stripe's retry schedule) where users with failed payments continue to access premium features. The `customer.subscription.updated` handler (line 625) does handle `past_due` status, but this event may fire asynchronously or not at all depending on Stripe's dunning configuration.
**Reproduction steps:** Simulate a failed payment in Stripe test mode — user tier remains "premium" until Stripe eventually fires `subscription.updated` with `past_due` status or `subscription.deleted`.
**Suggested fix:** On `invoice.payment_failed`, consider marking the user's tier as "past_due" or showing a warning banner. Alternatively, confirm that Stripe's dunning settings guarantee a `customer.subscription.updated` event fires promptly on payment failure.
---

## BUG 5
**File:** index.html:2456-2462 (`dlCSV()` and `dlJSON()` functions)
**Area:** Gating
**Severity:** High
**Description:** CSV and JSON export functions (`dlCSV()`, `dlJSON()`) export the full `LOTS` array including all AI-scored data (scores, yields, street averages, below-market percentages, opportunities, risks, listing URLs) with no tier check. Any user who loads the page and has lots data in memory can download the complete dataset. This is listed as a Pro feature ("CSV/JSON export of results" in paywall modal, line 759) but has no gating whatsoever.
**Reproduction steps:** As an unauthenticated user, browse to the auctions page, wait for lots to load via `/api/all-lots`, then call `dlCSV()` or `dlJSON()` from the browser console — full data is exported. The export buttons in the UI may also be accessible without tier checks.
**Suggested fix:** Check user tier before allowing export. Either disable export buttons for free users (showing the paywall instead), or strip premium fields from the exported data for free users.
---

## BUG 6
**File:** server.js:2844, 2871, 2906 (admin endpoints)
**Area:** Security
**Severity:** Medium
**Description:** Admin endpoints `/api/admin/daily-stats`, `/api/cost-monitor`, and `/api/quality-report` accept the admin secret via query string parameter (`req.query.token`). Query string parameters are logged in web server access logs, browser history, Sentry breadcrumbs, Railway deploy logs, and potentially proxy/CDN logs — exposing the admin secret in plaintext. This creates a secret leakage vector.
**Reproduction steps:** Access `/api/admin/daily-stats?token=SECRET` — the admin secret appears in the URL and is logged.
**Suggested fix:** Remove `req.query.token` from these endpoints. Only accept the admin secret via the `x-admin-secret` header, which is not logged in URLs.
---

## BUG 7
**File:** server.js:2805-2817 (`/api/analyse-all` endpoint)
**Area:** Gating
**Severity:** High
**Description:** The `/api/analyse-all` endpoint only checks that the user is authenticated (`validateUserFromReq`), but does not check tier or admin status. Any signed-up free user can trigger a full auto-analysis of all catalogue-ready auctions, consuming Gemini API credits (free tier: 1500 RPD) and significant server resources (Puppeteer instances, RAM on Railway). A malicious or curious user could exhaust the daily Gemini quota, breaking the service for everyone.
**Reproduction steps:** Sign up as a free user, POST to `/api/analyse-all` with a valid auth token — the full auto-analysis runs, consuming API credits.
**Suggested fix:** Add admin secret check (`x-admin-secret` header) before allowing `/api/analyse-all`. This is an admin-level operation, not a user-facing feature.
---

## BUG 8
**File:** server.js:882-893 (auto-created user in `validateUserFromReq`)
**Area:** Gating
**Severity:** Low
**Description:** When a new user is auto-created on first JWT login, their tier is set to `'premium'` (line 889) with `tier_expires_at` set to 14 days out. The `getAISearchLimit()` function (line 929) checks `tier === 'premium'` first and returns `Infinity` — without checking whether the premium is from a trial or a paid subscription. This means trial users get the exact same access as paying subscribers. While this may be intentional for the trial period, the tier field doesn't distinguish between "trial premium" and "paid premium", which could cause confusion in reporting and makes it harder to apply different limits to trial vs paid users later.
**Reproduction steps:** Sign up for the first time — user gets tier='premium' and unlimited AI searches for 14 days, identical to a paid subscriber.
**Suggested fix:** Consider using a distinct tier value like 'trial' rather than reusing 'premium', or add a `is_trial` boolean to differentiate. The `getAISearchLimit()` already has a separate trial check path (line 930) that would work if trial users weren't also tier='premium'.
---

## BUG 9
**File:** index.html:1049, 1371, 1375, 1403, 1436
**Area:** Gating
**Severity:** Low
**Description:** Line 1049 has `const PREMIUM_ENABLED=true;` with a TODO comment: "gate behind auth when auction tool gets subscriptions". This flag IS used — it controls whether refurb affordability filtering (line 1371, 1436) and title split affordability filtering (lines 1375, 1403) are active. However, it's hardcoded to `true` and is NOT gated behind authentication as the TODO specifies. All users, including unauthenticated visitors, get these premium affordability filters. The TODO was never implemented.
**Reproduction steps:** As an unauthenticated user, open the affordability filter panel — refurb and title split affordability filters are visible and functional.
**Suggested fix:** Either implement the TODO by checking the user's tier before enabling these filters, or remove the TODO comment if these features are now intentionally free.
---

## BUG 10
**File:** server.js:93-96 (CSRF check)
**Area:** Security
**Severity:** Medium
**Description:** The CSRF origin check uses `origin.startsWith(a)` which could be bypassed if an attacker registers a domain like `bridgematch.co.uk.evil.com`. The check at line 95 would match because `'https://bridgematch.co.uk.evil.com'.startsWith('https://bridgematch.co.uk')` returns `true`. This allows cross-origin POST requests from attacker-controlled domains that start with the allowed origin strings.
**Reproduction steps:** Send a POST request with `Origin: https://bridgematch.co.uk.evil.com` — CSRF check passes, allowing cross-site request forgery from a malicious domain.
**Suggested fix:** Use exact match or parse the URL and compare hostnames: `new URL(origin).hostname === new URL(a).hostname`, or append a `/` to each allowed origin before comparing.
---

## BUG 11
**File:** index.html (absent — no handler for `?payment=cancelled`)
**Area:** Stripe Flow
**Severity:** Low
**Description:** After a successful Stripe checkout, the app handles `?payment=success` with a green toast notification (index.html:1704-1716). However, there is no handler for `?payment=cancelled` (the cancel_url set at server.js:532). If a user cancels checkout in Stripe, they return to the app with `?payment=cancelled` in the URL but see no feedback — the query param just sits in the URL bar. There's no message explaining that checkout was cancelled or offering to retry.
**Reproduction steps:** Click "Upgrade to Pro", get redirected to Stripe Checkout, click the back/cancel button in Stripe — you return to `/?payment=cancelled` with no feedback.
**Suggested fix:** Add a handler for `?payment=cancelled` that shows a brief message like "Checkout cancelled" and cleans the URL parameter via `history.replaceState`.
---

## BUG 12
**File:** .env.example
**Area:** Security / DevOps
**Severity:** Low
**Description:** The `.env.example` file only documents `GEMINI_API_KEY`. It is missing all Stripe-related variables (`STRIPE_SECRET_KEY`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`), auth variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`), and operational variables (`ADMIN_SECRET`, `SENTRY_DSN`, `ALLOWED_ORIGINS`). A developer setting up the project would miss critical configuration, leading to silent failures (Stripe returning null, auth not working, etc.).
**Reproduction steps:** Clone the repo, copy `.env.example` to `.env`, fill in `GEMINI_API_KEY` — the app starts but Stripe payments, auth, and admin endpoints all silently fail.
**Suggested fix:** Update `.env.example` to list all required environment variables with placeholder values and comments explaining each one.
---

## BUG 13
**File:** server.js:403-434 (`/api/signup` endpoint)
**Area:** Security
**Severity:** Medium
**Description:** The `/api/signup` endpoint creates user records and returns session tokens based solely on an email address — no email verification, no magic link confirmation, no password. While the frontend shows a magic link flow (index.html:709), the server-side `/api/signup` endpoint appears to be a legacy endpoint that bypasses Supabase auth entirely. It generates a random `session_token` and returns it immediately. An attacker could sign up with any email address (including someone else's) and receive a valid session token, potentially claiming another user's email before they sign up.
**Reproduction steps:** `curl -X POST https://auctions.bridgematch.co.uk/api/signup -H 'Content-Type: application/json' -d '{"email":"victim@example.com"}'` — returns a session token for that email.
**Suggested fix:** Either remove the `/api/signup` endpoint if all auth now goes through Supabase magic links, or add email verification. The legacy session_token auth path (server.js:904-912) should also be deprecated once migration is complete.
---

## BUG 14
**File:** server.js:855-857, 873-875 (tier expiry check in `validateUserFromReq`)
**Area:** Gating
**Severity:** Medium
**Description:** The tier expiry check in `validateUserFromReq` only downgrades users with `tier_expires_at` set AND expired. But for monthly subscribers (line 589), `tier_expires_at` is set to `null` — "managed by subscription lifecycle". If the webhook for `customer.subscription.deleted` fails to fire or the webhook endpoint is down, a cancelled subscriber keeps `tier: 'premium'` with `tier_expires_at: null` indefinitely. The `validateUserFromReq` function has no way to detect this state because it only checks expiry, not subscription validity. There is no periodic reconciliation to catch stale premium users.
**Reproduction steps:** Subscribe to Pro monthly, then cancel in Stripe. If the `customer.subscription.deleted` webhook fails to reach the server (network issue, Railway downtime), the user retains premium access permanently.
**Suggested fix:** Add a periodic reconciliation job that checks active subscribers against Stripe's API, or set `tier_expires_at` to the subscription's `current_period_end` on each renewal webhook, so the expiry check in `validateUserFromReq` can catch stale subscriptions.
---

## BUG 15
**File:** server.js:531-532, 654 (Stripe checkout & portal URL construction)
**Area:** Security / Stripe Flow
**Severity:** Medium
**Description:** The Stripe checkout `success_url`, `cancel_url`, and billing portal `return_url` are constructed using `req.headers.origin` without validating it against the allowed origins list. Combined with BUG 10 (CSRF `startsWith` bypass), an attacker who can get an authenticated user to submit a request with `Origin: https://bridgematch.co.uk.evil.com` would cause Stripe to redirect the user to `https://bridgematch.co.uk.evil.com/?payment=success` after payment — an open redirect. While Bearer token auth makes CSRF harder to exploit than cookie-based auth, the redirect URLs should still be validated. Stripe will redirect the user's browser to whatever URL is set, regardless of the origin of the API call.
**Reproduction steps:** From a client that has a valid auth token, POST to `/api/stripe/checkout` with header `Origin: https://bridgematch.co.uk.evil.com` and body `{"product":"monthly"}`. The returned Stripe session will have `success_url` pointing to the attacker domain. The CSRF check passes due to the `startsWith` bug.
**Suggested fix:** Validate `req.headers.origin` against the hardcoded allowed origins list before using it in Stripe redirect URLs. If the origin doesn't match exactly, fall back to the default `https://auctions.bridgematch.co.uk`.
---

## BUG 16
**File:** server.js:403-433 (`/api/signup` endpoint)
**Area:** Security
**Severity:** Medium
**Description:** The `/api/signup` endpoint has no rate limiting. An attacker can call it in a tight loop to create unlimited user records in the Supabase `users` table, or enumerate existing users (the response includes `returning: true` for existing emails). The `/api/analyse` endpoint has rate limiting via `rate_limits` table, but `/api/signup` has none. This enables: (1) database pollution with fake user records, (2) email enumeration — the response distinguishes between new and existing users, (3) abuse of the `sendWelcomeEmail()` function to spam arbitrary email addresses.
**Reproduction steps:** `for i in $(seq 1 1000); do curl -s -X POST https://auctions.bridgematch.co.uk/api/signup -H 'Content-Type: application/json' -d "{\"email\":\"test${i}@example.com\"}"; done` — creates 1000 user records with no throttling. For enumeration: POST with a known email — `returning: true` confirms the account exists.
**Suggested fix:** Add rate limiting (e.g., 5 signups per IP per hour). Remove the `returning` field from the response to prevent email enumeration (return the same response shape for both new and existing users). Consider deprecating this endpoint entirely if all auth now flows through Supabase magic links.
---

## BUG 17
**File:** server.js:637-641 (Stripe webhook error handling)
**Area:** Stripe Webhook
**Severity:** Low
**Description:** The Stripe webhook endpoint returns `{ received: true }` (HTTP 200) even when the event handler throws an error (line 641). The try/catch at line 637 catches all handler errors, logs them, but still responds with 200. This tells Stripe the event was successfully processed when it wasn't. Stripe will not retry the webhook because it received a 200 response. If, for example, the `checkout.session.completed` handler fails to update the user's tier due to a Supabase outage, the user's payment is recorded by Stripe but the tier upgrade is lost, and Stripe won't retry because it received acknowledgement.
**Reproduction steps:** Temporarily break the Supabase connection, then trigger a `checkout.session.completed` webhook. The handler errors out, logs the error, but returns 200. The event is marked as delivered in the Stripe dashboard and is not retried.
**Suggested fix:** Re-throw the error after logging, or return a 500 status on handler failure, so Stripe knows to retry the event. Alternatively, move `res.json({ received: true })` inside the try block after the switch statement.
---

## BUG 18
**File:** server.js:93 (CSRF check referer fallback)
**Area:** Security
**Severity:** Low
**Description:** The CSRF check uses `req.headers.referer` as a fallback when `req.headers.origin` is absent (line 93). The Referer header contains a full URL (e.g., `https://bridgematch.co.uk/auctions?page=2`), and the check uses `startsWith` against the allowed origins. This works correctly for the intended case, but the Referer header is less reliable for CSRF protection because: (1) it can be suppressed by `Referrer-Policy: no-referrer`, and (2) when both origin and referer are absent, the request is blocked — but some legitimate same-origin requests from privacy-focused browsers may strip both headers, causing false rejections.
**Reproduction steps:** Send a POST request from a browser with `Referrer-Policy: no-referrer` and no Origin header — the request is blocked with 403 even if it's legitimate.
**Suggested fix:** This is minor — the current behavior (block when no origin/referer) is the safe default. Consider adding a note in documentation about browser compatibility, or using a CSRF token approach for critical endpoints.
---

## BUG 19
**File:** server.js:692-741 (`/api/leads` endpoint)
**Area:** Security
**Severity:** Medium
**Description:** The `/api/leads` endpoint has no rate limiting and no authentication. It accepts arbitrary name, email, phone, and deal data and inserts it directly into the `leads` Supabase table. An attacker can flood this endpoint to fill the leads table with junk data, making it difficult to find real leads. It also stores `req.ip` (line 733) which could be used for reconnaissance. Additionally, since there's no CAPTCHA or bot protection, automated scrapers or competitors could spam the leads table.
**Reproduction steps:** `for i in $(seq 1 1000); do curl -s -X POST https://auctions.bridgematch.co.uk/api/leads -H 'Content-Type: application/json' -d '{"name":"spam","email":"spam'$i'@test.com","phone":"000"}'; done` — creates 1000 junk lead records with no throttling.
**Suggested fix:** Add rate limiting (e.g., 5 leads per IP per hour). Consider adding a honeypot field or reCAPTCHA check to filter bots.
---

## BUG 20
**File:** server.js:2743-2751 (`/api/refresh-cache` endpoint)
**Area:** Security
**Severity:** Low
**Description:** The `/api/refresh-cache` endpoint accepts the admin secret in the request body (`req.body.secret`) rather than via the `x-admin-secret` header. This is inconsistent with other admin endpoints like `/api/cache-status` (line 2709) and `/api/admin/backfill-images` (line 2755) which use the header. Request bodies are logged less commonly than query params, but placing secrets in the body is still worse practice than headers. Several other admin endpoints (`/api/admin/seed-calendar`, `/api/admin/calendar`, `/api/admin/calendar/:id`) also accept the secret in the request body rather than headers. This inconsistency makes the auth pattern harder to audit and maintain.
**Reproduction steps:** Compare admin endpoints — `/api/cache-status` uses `x-admin-secret` header, while `/api/refresh-cache`, `/api/admin/seed-calendar`, `/api/admin/calendar`, and `/api/admin/calendar/:id` use `req.body.secret`. No single consistent pattern.
**Suggested fix:** Standardise all admin endpoints to use the `x-admin-secret` header for the admin secret. This matches the pattern already used by `/api/cache-status` and `/api/admin/backfill-images`.
---

## BUG 21
**File:** server.js:904-912 (legacy session_token auth path)
**Area:** Security
**Severity:** Medium
**Description:** The `validateUserFromReq` function has a legacy fallback that accepts a session_token (random 32-byte hex string) as a Bearer token (line 904-912). This token is generated by the `/api/signup` endpoint (line 408) without any email verification. The session_token is stored in plaintext in the Supabase `users` table. This creates a parallel authentication path that bypasses Supabase JWT verification entirely — anyone who obtains or guesses a session_token gets full authenticated access. Since the `/api/signup` endpoint has no rate limiting (BUG 16), an attacker could create accounts with arbitrary emails and receive session tokens, then use those tokens on any authenticated endpoint.
**Reproduction steps:** POST to `/api/signup` with any email → receive a `token` in the response → use that token as `Authorization: Bearer <token>` on `/api/stripe/checkout` or `/api/analyse` → full authenticated access without email verification.
**Suggested fix:** Deprecate and remove the legacy session_token auth path once all existing users have migrated to Supabase magic link auth. Add an expiry to session_tokens or remove the `/api/signup` endpoint entirely.
---

## BUG 22
**File:** server.js:93 (CSRF check), server.js:90-100 (csrfCheck function)
**Area:** Security
**Severity:** Low
**Description:** When both `req.headers.origin` and `req.headers.referer` are empty strings, the CSRF check falls through to the `if (origin && ...)` condition at line 95. Since `origin` is `''` (falsy), the condition is NOT entered and the function falls through to line 98, which returns 403. This is actually correct behavior (empty origin = blocked). However, when the Origin header is completely absent (not just empty), some browsers on same-origin POST requests may not send an Origin header at all. The fallback to Referer is fine, but if the user's browser has `Referrer-Policy: no-referrer` set, both will be absent and the legitimate request is blocked. This is a minor UX issue rather than a security bug — already noted in BUG 18 but worth re-confirming it's still present.
**Reproduction steps:** Already documented in BUG 18 — this is a re-verification that the issue persists.
**Suggested fix:** Already documented in BUG 18.
---

## BUG 23
**File:** server.js:2574-2705 (`/api/all-lots`), index.html (lot card rendering)
**Area:** Gating
**Severity:** High
**Description:** The `/api/all-lots` endpoint returns the `url` field for every lot, which is the direct link to the auction house listing page. This is a high-value data point that should be gated for paid users — it's the primary actionable data that converts a browser into a bidder. Free users should see the lot summary but need to upgrade to get the direct auction house URL. Currently, any unauthenticated user gets the full listing URL for every lot across all auction houses via a single API call. Combined with `dlJSON()` (BUG 5), this enables bulk scraping of all auction house listing URLs.
**Reproduction steps:** `curl https://auctions.bridgematch.co.uk/api/all-lots | jq '.[0].url'` — returns the auction house listing URL for the first lot, no auth needed.
**Suggested fix:** This is a subset of BUG 1 but worth calling out specifically — the `url` field is the single most valuable gated field. Even if other fields remain visible, gating the listing URL would create a meaningful free/paid boundary.
---

## BUG 24
**File:** server.js:505-542 (`/api/stripe/checkout` endpoint)
**Area:** Stripe Flow
**Severity:** Medium
**Description:** The checkout endpoint does not check whether the user already has an active subscription (`user.stripe_subscription_id`). A user who is already a paying subscriber can hit the checkout endpoint again and create a second Stripe subscription, resulting in double billing. Stripe will happily create multiple subscriptions for the same customer. The webhook handler on `checkout.session.completed` (line 588) overwrites `stripe_subscription_id` with the new one, orphaning the old subscription — the old sub continues billing but the app no longer tracks it, so the `customer.subscription.deleted` webhook won't match it to downgrade the user.
**Reproduction steps:** As a premium subscriber, POST to `/api/stripe/checkout` with `{"product":"monthly"}` — a new checkout session is created. Complete the checkout — now the user has two active Stripe subscriptions but only the latest one is tracked in the database.
**Suggested fix:** Before creating a checkout session, check `if (user.stripe_subscription_id)` and return an error like "You already have an active subscription. Use the billing portal to manage it." Alternatively, pass `subscription_data: { metadata: { ... } }` and use Stripe's `allow_promotion_codes` or other deduplication mechanisms.
---

## BUG 25
**File:** server.js:90-100 (CSRF check), server.js:403 (`/api/signup`)
**Area:** Security
**Severity:** Medium
**Description:** The CSRF check (line 91) skips GET, HEAD, and OPTIONS methods but does NOT add `localhost` or `127.0.0.1` to the allowed origins list. During local development, POST requests from `http://localhost:3000` (or any local origin) are rejected with 403 "Forbidden — missing or invalid Origin header". Developers must either disable CSRF manually, use curl, or add their own origin — but the `.env.example` doesn't document an `ALLOWED_ORIGINS` override. The hardcoded allowed origins (line 94) only include production domains. There is no mechanism to add development origins via environment variable — the origins list is fully hardcoded.
**Reproduction steps:** Run the server locally, open `http://localhost:3000` in a browser, attempt any POST request (signup, analyse, etc.) — the CSRF check blocks it with 403.
**Suggested fix:** Either read additional allowed origins from an environment variable (e.g., `ALLOWED_ORIGINS`), or automatically allow `localhost` origins when `NODE_ENV !== 'production'`.
---

## BUG 26
**File:** server.js:563-565 (`checkout.session.completed` webhook handler)
**Area:** Stripe Webhook
**Severity:** Medium
**Description:** The `checkout.session.completed` handler retrieves `user_id` from `session.metadata?.user_id` (line 563). If `userId` is falsy (metadata missing or corrupted), the handler silently `break`s without logging a warning or error (line 565: `if (!userId) break;`). The payment is recorded by Stripe but the user's tier is never upgraded. Since the webhook returns 200, Stripe won't retry. The user has paid but gets nothing — and there's no log entry to help diagnose it. This can happen if the checkout session was created by a different version of the code that didn't set metadata, or if Stripe drops metadata for any reason.
**Reproduction steps:** Create a Stripe Checkout session manually (via Stripe dashboard or API) without setting `user_id` in metadata. Complete the checkout — the webhook fires, finds no `userId`, breaks out of the switch, returns 200. No user is upgraded, no error is logged.
**Suggested fix:** Log a warning when `userId` is missing from checkout session metadata, including the session ID and customer email so the issue can be resolved manually.
---

## BUG 27
**File:** server.js:2954-2965 (catch-all route, Supabase config injection)
**Area:** Security
**Severity:** Low
**Description:** The catch-all route injects `SUPABASE_URL` and `SUPABASE_ANON_KEY` into every HTML response via string replacement (lines 2958-2959). While the anon key is designed to be public (it's a Supabase anon/public key, not a service key), the injection uses `JSON.stringify()` which is safe against XSS. However, if `SUPABASE_URL` or `SUPABASE_ANON_KEY` environment variables are accidentally set to the service key, the service key would be exposed to every client. There is no validation that the injected key is actually an anon key vs a service key. Additionally, the fallback path (line 2963: `res.sendFile`) serves the raw HTML without injection if the `readFileSync` throws — in that case, the frontend gets empty strings for Supabase config, silently breaking auth.
**Reproduction steps:** Set `SUPABASE_ANON_KEY` to the service role key by mistake — it gets injected into every page response, visible in the browser's page source.
**Suggested fix:** Add a startup check that validates `SUPABASE_ANON_KEY` looks like an anon key (doesn't contain `service_role`). Log a clear warning if auth config injection fails in the fallback path.
---

## BUG 28
**File:** server.js:416 (`/api/signup` — session_token overwrite on returning user)
**Area:** Security
**Severity:** Medium
**Description:** When a returning user hits `/api/signup`, a new `session_token` is generated and overwrites the old one (line 416). This invalidates any other active sessions the user has (e.g., on another device or browser tab). This is a session fixation risk: an attacker who knows a victim's email can POST to `/api/signup` (no rate limiting, per BUG 16), which generates a new session_token and returns it to the attacker. The attacker now has a valid session token for the victim's account. The victim's old session_token is invalidated. Combined with the legacy session_token auth path (BUG 21), this means an attacker can take over any account by simply knowing the email address.
**Reproduction steps:** User A is logged in with session_token X. Attacker POSTs to `/api/signup` with `{"email":"userA@example.com"}`. Attacker receives a new session_token Y. User A's session_token X is invalidated. Attacker uses token Y to access User A's account.
**Suggested fix:** Do not generate or return a new session_token for returning users in `/api/signup`. If the legacy auth path must stay, require email verification before issuing tokens. Better yet, remove `/api/signup` entirely now that Supabase magic link auth is in place.
---

## Sweep completed at 2026-03-14T21:30:00Z

## Re-sweep completed at 2026-03-14 — all 28 bugs confirmed still present, no new issues found. No code changes detected in auth/Stripe/gating areas since last sweep.

## BUG 29
**File:** server.js:90-99 (csrfCheck function) vs server.js:40 (CORS ALLOWED_ORIGINS)
**Area:** Security
**Severity:** Medium
**Description:** The CORS middleware (line 40) correctly reads allowed origins from the `ALLOWED_ORIGINS` environment variable and uses exact match via `.includes()`. However, the CSRF check (line 94) uses a **separate hardcoded list** of origins and the vulnerable `.startsWith()` comparison. This means: (1) Any origins added via the `ALLOWED_ORIGINS` env var (e.g., `http://localhost:3000` for development) will pass CORS but fail CSRF, causing POST requests to be rejected with 403. (2) The CSRF fix for BUG 10 (`startsWith` → exact match) would need to be applied to csrfCheck independently — fixing CORS doesn't fix CSRF. (3) The two lists can drift apart silently. The CSRF check should use the same `ALLOWED_ORIGINS` constant as the CORS middleware rather than maintaining a duplicate hardcoded list.
**Reproduction steps:** Set `ALLOWED_ORIGINS=https://auctions.bridgematch.co.uk,http://localhost:3000` in env. CORS allows `http://localhost:3000` but the CSRF check at line 94 blocks POST requests from it with 403. Conversely, the CSRF `startsWith` is vulnerable even though the CORS `.includes()` is not.
**Suggested fix:** Replace the hardcoded list in `csrfCheck` (line 94) with the `ALLOWED_ORIGINS` constant from line 40, and change `startsWith` to exact match (or parsed hostname comparison). This ensures both CORS and CSRF use the same source of truth.
---

## Sweep completed at 2026-03-14T22:00:00Z — 29 bugs total. BUGs 1-28 confirmed still present, BUG 29 is new (CSRF/CORS origin list inconsistency).

## BUG 34
**File:** index.html:903-904 (CSV/JSON export buttons), index.html:2456-2462 (`dlCSV()` / `dlJSON()`)
**Area:** Gating
**Severity:** Medium
**Description:** The CSV and JSON export buttons in the UI toolbar (lines 903-904) are always visible and functional regardless of authentication state or user tier. The paywall modal (line 759) lists "CSV/JSON export of results" as a Pro feature, but neither `dlCSV()` nor `dlJSON()` calls `requireSignup()` or checks `currentSession` or `window._userTier`. Any visitor — including unauthenticated users — can click "↓ CSV" or "↓ JSON" and download the full lot dataset currently in memory. This is distinct from BUG 5 (which documented the data content of exports); this bug is about the UI buttons themselves being ungated despite being advertised as a paid feature.
**Reproduction steps:** Visit the auctions page as an unauthenticated user. Wait for lots to load. Click the "↓ CSV" or "↓ JSON" button in the toolbar — the full dataset downloads with no auth prompt or paywall shown.
**Suggested fix:** Add a tier check to both `dlCSV()` and `dlJSON()`: if the user is not premium/trial, call `showPaywall('CSV/JSON export is a Pro feature. Upgrade for unlimited exports.')` and return early. Hide or grey out the export buttons for free/anon users.
---

## BUG 35
**File:** index.html:677 (account dropdown), index.html:1665-1668 (`showPaywall()`)
**Area:** Stripe Flow
**Severity:** Low
**Description:** The account dropdown (line 677) shows an "Upgrade" link for ALL authenticated users, including those already on the premium tier. Clicking it calls `showPaywall()` which shows the "Upgrade to Pro" modal with the checkout button. Combined with BUG 24 (no duplicate subscription check on the server), a premium user who clicks "Upgrade" in their account dropdown is presented with the checkout flow and could accidentally create a second subscription.
**Reproduction steps:** Log in as a premium subscriber. Click the account dropdown → click "Upgrade" → the paywall modal appears with the "Pro £9.99/month" checkout button, even though you're already subscribed.
**Suggested fix:** Hide the "Upgrade" link in the account dropdown when `window._userTier === 'premium'` and the user has an active subscription (not a trial). The `updateProStatus()` function already stores `window._userTier` — use it to conditionally show/hide the upgrade option.

## BUG 30
**File:** server.js:2525-2530 (`/api/smart-search` response)
**Area:** Gating
**Severity:** High
**Description:** The `/api/smart-search` endpoint returns full, unblurred lot objects to all users including anonymous visitors. At line 2530, `matchingLots` are the raw cached lot objects with scores, opportunities, risks, full addresses, and listing URLs — `stripAIFields()` is never called. Anonymous users get 3 free AI searches per day (by IP), and each search returns complete lot data for matching results. This is a separate data leak path from BUG 1 (`/api/all-lots`) — even if BUG 1 were fixed by adding tier-based stripping to `/api/all-lots`, smart search would still return full data. A free user could run 3 targeted searches per day and extract full AI-scored data for dozens of lots without paying.
**Reproduction steps:** `curl -X POST https://auctions.bridgematch.co.uk/api/smart-search -H 'Content-Type: application/json' -d '{"query":"title split under 100k"}'` — returns full lot objects with scores, opps, risks, full addresses, and listing URLs. No auth token required.
**Suggested fix:** Apply `stripAIFields()` to `matchingLots` for free/anonymous users before returning from `/api/smart-search`. Premium and trial users should see full data.
---

## BUG 31
**File:** server.js:2541-2553 (smart search cache)
**Area:** Gating
**Severity:** Medium
**Description:** The smart search cache (`smart_search_cache` table) stores full unblurred lot data including scores, addresses, and URLs (line 2545: `results: matchingLots`). If tier-based stripping is later added to the smart search response, the cache would still contain full data from when it was populated by a premium user. A subsequent free user hitting the same preset query would get the cached premium-tier response with full data, bypassing the tier check. The cache has no concept of per-tier responses.
**Reproduction steps:** As a premium user, run a preset smart search — full results are cached. As an anonymous user, run the same preset — the cached full-data response is returned (via the cache hit path) without any tier-based stripping.
**Suggested fix:** Either strip cached results per-tier before returning, or include the user's tier in the cache key so free and premium users get separate cached responses.
---

## BUG 32
**File:** server.js:889 (auto-created user tier), server.js:855-857 (tier expiry check)
**Area:** Gating
**Severity:** Medium
**Description:** New auto-created users get `tier: 'premium'` and `tier_expires_at` set to 14 days out (lines 889-892). The expiry check in `validateUserFromReq` (lines 855-858) correctly downgrades expired users. However, there is a race condition: if a user's trial expires while they have an active browser session, their `currentSession` JWT remains valid (Supabase JWTs have a 1-hour expiry by default). During that window, the frontend still treats them as authenticated and premium. The `updateProStatus()` function (index.html:1719) fetches `/api/stripe/status` which DOES check tier correctly — but this function only runs once on login (`onSignIn`). If the trial expires mid-session, the UI won't update until the page is refreshed or the user logs in again. They could continue using features gated only by frontend checks (like the export buttons) during this window.
**Reproduction steps:** Log in during the last hour of a trial. Wait for the trial to expire without refreshing the page. The UI still shows the PRO badge and allows CSV export. The `/api/stripe/status` endpoint would return `tier: 'free'` if called, but nothing triggers that call mid-session.
**Suggested fix:** Periodically call `updateProStatus()` (e.g., every 5-10 minutes) to refresh the tier state during active sessions, or add a timer that checks against the known `trialExpiresAt` timestamp.
---

## BUG 33
**File:** index.html:1704-1716 (payment success handler)
**Area:** Stripe Flow
**Severity:** Low
**Description:** The payment success handler at line 1706 checks for `?payment=success` in the URL and shows a toast. However, this check runs immediately on page load (it's an IIFE at line 1704) — BEFORE the Supabase auth state is initialised (which happens at line 1524 in `initAuth()`). If the Stripe webhook hasn't yet processed the `checkout.session.completed` event by the time the user lands on the success URL, the user sees "Payment successful! You now have Pro access" but their tier hasn't actually been updated yet. The `updateProStatus()` call in `onSignIn` may still show the old tier. The user could be confused when features still appear locked despite seeing the success message.
**Reproduction steps:** Complete Stripe checkout. If the webhook takes more than a second to process (network latency, Railway cold start), the user sees the success toast but their account tier is still 'free' until the next page refresh or `updateProStatus()` call.
**Suggested fix:** After showing the success toast, poll `/api/stripe/status` for a few seconds (e.g., 3 retries with 2s intervals) until the tier reflects 'premium', then call `updateProStatus()` to refresh the UI.
---

## Sweep completed at 2026-03-14T23:00:00Z — 33 bugs total. BUGs 1-29 confirmed still present. BUGs 30-33 are new: smart search data leak (30), smart search cache tier bypass (31), trial expiry mid-session race (32), payment success webhook timing (33).

## Sweep completed at 2026-03-14T23:45:00Z — 35 bugs total. BUGs 1-33 confirmed still present, no code changes detected. BUGs 34-35 are new: export buttons ungated in UI despite being listed as Pro feature (34), "Upgrade" link shown to already-premium users enabling double subscription (35).

## BUG 36
**File:** server.js:625-626 (`customer.subscription.updated` webhook handler)
**Area:** Stripe Webhook
**Severity:** Medium
**Description:** When a subscription enters `past_due` status (e.g., failed payment retry), line 626 sets `stripe_subscription_id: null`. This means if Stripe's retry schedule later succeeds and fires another `customer.subscription.updated` with `status: 'active'`, the handler at line 618-621 looks up the user by `stripe_subscription_id` — but it's been nulled out, so `.single()` returns nothing. The user's tier stays `'free'` permanently even though Stripe successfully resumed their subscription. The user would need to contact support or re-subscribe (creating a duplicate per BUG 24).
**Reproduction steps:** Simulate a payment failure in Stripe test mode. The `customer.subscription.updated` event fires with `past_due` status, nulling `stripe_subscription_id`. Then simulate a successful retry — `customer.subscription.updated` fires with `active` status, but the user lookup returns null because `stripe_subscription_id` was cleared.
**Suggested fix:** On `past_due`/`unpaid`, downgrade the tier to `'free'` but **keep** `stripe_subscription_id` intact so the recovery event can find the user. Only null out `stripe_subscription_id` on `customer.subscription.deleted` (which already handles the permanent cancellation case at line 608). Alternatively, also look up users by `stripe_customer_id` as a fallback.
---

## BUG 37
**File:** server.js:527-533 (`/api/stripe/checkout` session creation)
**Area:** Stripe Flow
**Severity:** Low
**Description:** The checkout session sets `metadata: { user_id, product }` on the **session** object (line 533), but does not set `subscription_data.metadata`. This means the resulting Stripe Subscription object has no metadata linking it to the user. Currently this doesn't cause issues because `checkout.session.completed` writes `stripe_subscription_id` to the user record. However, if an admin needs to reconcile subscriptions in the Stripe dashboard, there's no way to identify which user a subscription belongs to without cross-referencing the checkout session. It also means any future webhook that receives the subscription object directly (without going through a checkout session) cannot identify the user by metadata alone.
**Reproduction steps:** Complete a checkout, then view the resulting subscription in the Stripe dashboard — the subscription object has no `user_id` in its metadata. Only the checkout session has the metadata.
**Suggested fix:** Add `subscription_data: { metadata: { user_id: user.id } }` to the checkout session params. This ensures the subscription object itself carries user identification metadata for dashboard reconciliation and future webhook resilience.
---

## Sweep completed at 2026-03-14T24:00:00Z — 37 bugs total. BUGs 1-35 confirmed still present. BUGs 36-37 are new: past_due subscription recovery broken by premature stripe_subscription_id nulling (36), checkout session missing subscription_data.metadata (37).

## Sweep completed at 2026-03-14T03:30:00Z — 37 bugs confirmed still present. No new issues found. Key re-verifications: (1) No hardcoded Stripe keys (sk_/pk_) anywhere in codebase — all from env vars. (2) CSRF startsWith bypass (BUG 10) still present at server.js:95. (3) stripAIFields() still dead code — defined at server.js:946 but never called (BUGs 1, 2, 30). (4) Only one "Coming Soon" label in entire app (index.html:760 — "Portfolio tracking"). (5) Webhook raw body handling correctly configured (line 32-33). (6) /api/analyse-all still ungated to any authenticated user (BUG 7). (7) checkout.session.completed still silently breaks on missing userId metadata (BUG 26).

## Sweep completed at 2026-03-14T11:15:00Z — 11 bugs FIXED, 26 still open, 1 new bug found (BUG 38).

### FIXED since last sweep (code changes detected):
- **BUG 1** (FIXED): `/api/all-lots` now calls `stripAIFields()` for non-premium users (server.js:2705-2706). Data gating for the directory view is now functional.
- **BUG 6** (FIXED): Admin endpoints `/api/admin/daily-stats`, `/api/cost-monitor`, `/api/quality-report` now use `req.headers['x-admin-secret']` instead of `req.query.token`. No more secrets in query strings.
- **BUG 7** (FIXED): `/api/analyse-all` now requires `x-admin-secret` header (server.js:2820-2822). No longer accessible to any authenticated user.
- **BUG 10** (FIXED): CSRF check at server.js:94 now uses exact match (`origin === a`) instead of `startsWith`. Domain spoofing via `bridgematch.co.uk.evil.com` no longer possible.
- **BUG 15** (MITIGATED): CSRF fix at line 94 blocks invalid origins before they reach `/api/stripe/checkout`, so the Stripe redirect URL injection is no longer exploitable via CSRF. The `req.headers.origin` fallback to production URL (line 533) adds defence-in-depth.
- **BUG 17** (FIXED): Webhook handler now returns HTTP 500 on error (server.js:645) instead of always returning 200. Stripe will retry failed webhooks.
- **BUG 23** (FIXED): Subset of BUG 1 — `url` field is now stripped by `stripAIFields()` for non-premium users.
- **BUG 24** (FIXED): Checkout endpoint now checks `user.stripe_subscription_id` (server.js:513-515) and returns error if user already has an active subscription.
- **BUG 25** (FIXED): CSRF check now uses the same `ALLOWED_ORIGINS` variable as CORS (server.js:94 references `ALLOWED_ORIGINS` from line 40), which reads from the `ALLOWED_ORIGINS` env var. Localhost can now be added for development.
- **BUG 26** (FIXED): `checkout.session.completed` handler now logs a warning when `userId` is missing from metadata (server.js:568).
- **BUG 29** (FIXED): CSRF and CORS now share the same `ALLOWED_ORIGINS` variable and use exact match. No more dual-list drift.
- **BUG 30** (FIXED): `/api/smart-search` now calls `stripAIFields()` for non-premium users (server.js:2531).
- **BUG 36** (FIXED): `customer.subscription.updated` handler now keeps `stripe_subscription_id` on `past_due`/`canceled`/`unpaid` (server.js:631-632 comment confirms intent). Recovery events can still find the user.

### STILL PRESENT (26 bugs):
- **BUG 2** (High): `/api/analyse` still returns full unblurred data for all authenticated users. Both cached (line 1708-1714) and fresh (line 2145-2147) paths return `blurred: false` with `lots: cached.lots` / `lots: analysed` — `stripAIFields()` is not called.
- **BUG 3** (Medium): "Coming Soon" labels still missing on yield calculations, comparables, deal stacking tool. Only "Portfolio tracking (coming soon)" exists at index.html:760.
- **BUG 4** (Medium): `invoice.payment_failed` webhook still only logs — no user-facing action.
- **BUG 5** (High): `dlCSV()` and `dlJSON()` still export full `LOTS` array with no tier check.
- **BUG 8** (Low): Trial and paid premium still share `tier: 'premium'` — no distinction.
- **BUG 9** (Low): `PREMIUM_ENABLED=true` still hardcoded, TODO unimplemented.
- **BUG 11** (Low): No `?payment=cancelled` handler.
- **BUG 12** (Low): `.env.example` still only lists `GEMINI_API_KEY`.
- **BUG 13** (Medium): `/api/signup` still creates users with no email verification.
- **BUG 14** (Medium): Tier expiry still depends entirely on webhook — no reconciliation.
- **BUG 16** (Medium): `/api/signup` still has no rate limiting.
- **BUG 18** (Low): CSRF Referer fallback edge case still present.
- **BUG 19** (Medium): `/api/leads` still has no rate limiting or bot protection.
- **BUG 20** (Low): Admin endpoints still inconsistent — some use header (`x-admin-secret`), some use body (`req.body.secret`). Query string usage is fixed but body vs header split remains.
- **BUG 21** (Medium): Legacy `session_token` auth path still active (server.js:904-912).
- **BUG 27** (Low): No validation that `SUPABASE_ANON_KEY` isn't actually the service key.
- **BUG 28** (Medium): `/api/signup` still overwrites session_token for returning users — account takeover via email.
- **BUG 31** (Medium): Smart search cache doesn't account for tier — cached premium results could be served to free users.
- **BUG 32** (Medium): Trial expiry mid-session race — `updateProStatus()` only runs once on login.
- **BUG 33** (Low): Payment success toast may fire before webhook processes tier upgrade.
- **BUG 34** (Medium): CSV/JSON export buttons visible and functional for all users despite being listed as Pro feature.
- **BUG 35** (Low): "Upgrade" link shown in account dropdown for already-premium users.
- **BUG 37** (Low): Checkout session missing `subscription_data.metadata`.
- **BUG 22** (Low): CSRF edge case — duplicate of BUG 18.

## BUG 38
**File:** server.js:2530-2531 (`/api/smart-search` tier check)
**Area:** Gating
**Severity:** Medium
**Description:** The smart search tier check at line 2530 checks `user.tier === 'premium' || user.tier === 'trial'`. However, the auto-created user system (line 889) sets `tier: 'premium'` for trial users — there is no `tier: 'trial'` value in the database. The `|| user.tier === 'trial'` branch is dead code that will never match. This isn't a bug today (trial users get 'premium' and pass the first check), but if anyone later introduces a 'trial' tier value expecting it to grant premium data access, the `/api/all-lots` endpoint (line 2705) has the same pattern and would work correctly — however, the `/api/analyse` endpoint (BUG 2) doesn't call `stripAIFields()` at all, so a 'trial' tier user would get full data there regardless. The inconsistency between endpoints creates a fragile gating model.
**Reproduction steps:** Search for `tier === 'trial'` in server.js — it appears in the smart search and all-lots gating checks but no user is ever assigned `tier: 'trial'`. The check is harmless dead code today but reveals an inconsistency in the tier model.
**Suggested fix:** Either remove the `|| user.tier === 'trial'` checks (since trial users already have `tier: 'premium'`), or implement the 'trial' tier value properly and update all gating points consistently — including `/api/analyse` which currently has no gating at all.
---

## BUG 39
**File:** server.js:488-501 (`/api/auth/me` endpoint)
**Area:** Security
**Severity:** Low
**Description:** The `/api/auth/me` endpoint returns user data including `stripe_subscription_id` in the response (line 495 selects it). While this is a Stripe-internal ID (not a secret), exposing it to the client is unnecessary and could be used by a malicious user to infer information about the subscription (e.g., creation order, approximate timing). More importantly, the `catch` block at line 500 returns the raw `user` object from `validateUserFromReq`, which includes additional fields like `ai_searches_today`, `ai_searches_date`, and `trial_used` — more data than the explicit `select` at line 495 intended to return. This inconsistency means error paths leak more data than success paths.
**Reproduction steps:** Call `GET /api/auth/me` with a valid auth token when Supabase is experiencing intermittent issues — the catch block returns the full user object with extra fields not in the success path's select.
**Suggested fix:** In the catch block, return only the same fields as the success path (`id, email, name, tier, analyses_count, tier_expires_at, consent_auction_alerts, consent_partner_marketing`). Consider removing `stripe_subscription_id` from the select entirely since the client doesn't need it — use `/api/stripe/status` for subscription state.
---

## BUG 40
**File:** server.js:867-868 (tier expiry downgrade side effect)
**Area:** Gating
**Severity:** Medium
**Description:** When `validateUserFromReq` detects an expired premium tier (line 867), it immediately writes `stripe_subscription_id: null` to the database (line 868). This is a side effect inside what should be a read-only auth validation function. If a user has a paid subscription with `tier_expires_at` erroneously set (e.g., leftover from a day_pass that was later upgraded to monthly), this auto-downgrade will null out their valid `stripe_subscription_id`, breaking the webhook recovery path. The function conflates two concerns: (1) validating who the user is, and (2) enforcing tier expiry — the latter should be a separate process or at minimum should not clear `stripe_subscription_id` when one exists.
**Reproduction steps:** User buys a day_pass (sets `tier_expires_at` to 24h). Before it expires, they upgrade to monthly (sets `tier: 'premium'`, `stripe_subscription_id: sub_xxx`, `tier_expires_at: null`). If a bug or race condition leaves `tier_expires_at` as the old day_pass value while `stripe_subscription_id` is set, the next API call triggers line 868 which nulls the subscription ID and downgrades to free — even though they have an active monthly subscription.
**Suggested fix:** In the expiry check, skip the downgrade if `stripe_subscription_id` is present — active subscribers should only be downgraded via Stripe webhook events, not by tier expiry logic. Alternatively, separate the expiry enforcement from the auth validation function.
---

## Sweep completed at 2026-03-14T12:00:00Z — 40 bugs total. 13 previously FIXED (BUGs 1, 6, 7, 10, 15, 17, 23, 24, 25, 26, 29, 30, 36). 25 STILL OPEN from prior sweeps (BUGs 2-5, 8-9, 11-14, 16, 18-22, 27-28, 31-35, 37-38). 2 NEW bugs found (BUGs 39-40). No new code changes detected in auth/Stripe/gating areas since last sweep except those already noted as fixes.

## Sweep completed at 2026-03-14T14:30:00Z — 40 bugs total, 19 FIXED, 21 STILL OPEN, 0 new bugs.

### NEWLY FIXED since last sweep (code changes detected):
- **BUG 5/34** (FIXED): `dlCSV()` and `dlJSON()` now check `window._userTier !== 'premium'` and call `showPaywall()` for non-premium users (index.html:2464, 2470). CSV/JSON export is now properly gated as a Pro feature.
- **BUG 13** (FIXED): `/api/signup` no longer issues session tokens (server.js:404-437). Returns same response shape (`message: 'Check your email for a login link'`) for both new and existing users — no email enumeration, no token issuance.
- **BUG 28** (FIXED): `/api/signup` no longer overwrites or generates session_tokens for returning users (server.js:418-421). Account takeover via email is no longer possible through this endpoint.
- **BUG 16** (PARTIALLY FIXED): `/api/signup` no longer issues tokens, so the impact of no rate limiting is reduced (attacker only creates user records, doesn't get auth tokens). However, the endpoint still has no rate limiting — mass account creation and welcome email spam are still possible.

### ALL FIXED (19 bugs): 1, 5, 6, 7, 10, 13, 15, 17, 23, 24, 25, 26, 28, 29, 30, 34, 36 (+ partial: 16)

### STILL OPEN (21 bugs):
- **BUG 2** (High): `/api/analyse` still returns full unblurred data for all authenticated users. Both cached path (line 1722-1724: `lots: cached.lots, blurred: false`) and fresh path (line 2153-2155: `lots: analysed, blurred: false`) return complete data without calling `stripAIFields()`.
- **BUG 3** (Medium): "Coming Soon" labels still missing on yield calculations, comparables, deal stacking. Only "Portfolio tracking (coming soon)" at index.html:760. `calcDealAnalysis()` (line 2448) still callable by any user.
- **BUG 4** (Medium): `invoice.payment_failed` webhook still only logs — no user-facing action.
- **BUG 8** (Low): Trial and paid premium still share `tier: 'premium'` — no distinction.
- **BUG 9** (Low): `PREMIUM_ENABLED=true` hardcoded at line 1049, TODO unimplemented.
- **BUG 11** (Low): No `?payment=cancelled` handler.
- **BUG 12** (Low): `.env.example` still only lists `GEMINI_API_KEY`.
- **BUG 14** (Medium): Tier expiry still depends entirely on webhook — no reconciliation job.
- **BUG 16** (Low — downgraded): `/api/signup` no longer issues tokens but still lacks rate limiting. Impact reduced to DB pollution and welcome email spam.
- **BUG 18** (Low): CSRF Referer fallback edge case.
- **BUG 19** (Medium): `/api/leads` still has no rate limiting or bot protection.
- **BUG 20** (Low): Admin secret still accepted via body in some endpoints, header in others.
- **BUG 21** (Medium): Legacy `session_token` auth path still active (server.js:919-927). Any user with an old session_token can still authenticate without Supabase JWT.
- **BUG 22** (Low): CSRF edge case duplicate of BUG 18.
- **BUG 27** (Low): No validation that `SUPABASE_ANON_KEY` isn't the service key.
- **BUG 31** (Medium): Smart search cache doesn't account for tier.
- **BUG 32** (Medium): Trial expiry mid-session race — `updateProStatus()` only runs once on login.
- **BUG 33** (Low): Payment success toast may fire before webhook processes tier upgrade.
- **BUG 35** (Low): "Upgrade" link shown in account dropdown for already-premium users (line 677 — always visible, no tier check).
- **BUG 37** (Low): Checkout session missing `subscription_data.metadata`.
- **BUG 38** (Medium): Dead `tier === 'trial'` check in gating code — no user is ever assigned this tier value.
- **BUG 39** (Low): `/api/auth/me` catch block leaks extra user fields.
- **BUG 40** (Medium): `validateUserFromReq` tier expiry check nulls `stripe_subscription_id` for active subscribers if `tier_expires_at` is erroneously set.

## BUG 41
**File:** server.js:2258-2267, 2296, 2335, 2420-2425 (smart search preset cache hit paths)
**Area:** Gating
**Severity:** High
**Description:** The `/api/smart-search` endpoint has tier-based gating via `stripAIFields()` on the **fresh query** path (line 2546), but the **preset cache hit** paths bypass this entirely. There are at least 4 return paths that serve cached results directly without calling `stripAIFields()`: (1) Fully fresh cache at line 2262 returns `presetCache.results` raw. (2) Stale catalogues expired at line 2296 returns `cleanResults` raw. (3) Delta catalogues with no matches at line 2335 returns `cleanResults` raw. (4) Merged incremental results at line 2421 returns `mergedResults` raw. All of these paths return full unblurred lot data (scores, opps, risks, addresses, URLs) to anonymous users hitting a preset query that was previously cached. This is distinct from BUG 31 (which noted the cache stores unblurred data) — this bug is about the **return paths** actively serving that unblurred cached data without any tier check. Since preset queries like "title split under 100k" are the most common user searches, this is a high-impact data leak.
**Reproduction steps:** As a premium user, run a preset smart search (e.g., "title split opportunities") — results are cached with full data. As an anonymous user (no auth token), run the same preset query. The cache hit path at line 2258 serves the full unblurred results including scores, opportunities, risks, full addresses, and listing URLs.
**Suggested fix:** Apply `stripAIFields()` to the results on ALL cache-hit return paths before sending to the client. Add the same `isPremium` check used at line 2544-2546 to each cache-hit return point: `const gatedResults = isPremium ? results : stripAIFields(results);`
---

## BUG 42
**File:** server.js:406-437 (`/api/signup`), server.js:704-795 (`/api/leads`)
**Area:** Security
**Severity:** Medium
**Description:** The `sendWelcomeEmail()` call at line 431 fires for every new signup with no rate limiting on the `/api/signup` endpoint. An attacker can loop signups with arbitrary email addresses, causing the server to send welcome emails to those addresses via Resend. This is an email-sending abuse vector — the attacker can use the endpoint to spam arbitrary inboxes with BridgeMatch welcome emails. Similarly, `/api/leads` at line 753 sends notification emails via Resend for each lead submission with no rate limiting. Both endpoints can be weaponised for email flooding. While BUG 16 noted the lack of rate limiting on `/api/signup`, it focused on DB pollution and didn't highlight the email spam angle as a distinct issue.
**Reproduction steps:** `for i in $(seq 1 100); do curl -s -X POST https://auctions.bridgematch.co.uk/api/signup -H 'Content-Type: application/json' -d "{\"email\":\"victim${i}@example.com\"}"; done` — sends 100 welcome emails to different addresses in seconds. Same pattern works with `/api/leads`.
**Suggested fix:** Add per-IP rate limiting to both `/api/signup` (e.g., 5/hour) and `/api/leads` (e.g., 10/hour). Consider using an in-memory rate limiter like `express-rate-limit` on these endpoints specifically.
---

## Sweep completed at 2026-03-14T15:30:00Z — 42 bugs total, 19 FIXED, 23 STILL OPEN, 2 NEW bugs found (BUGs 41-42).

### FIXED (19 bugs): 1, 5, 6, 7, 10, 13, 15, 17, 23, 24, 25, 26, 28, 29, 30, 34, 36 (+ partial: 16)

### STILL OPEN (23 bugs):
- **BUG 2** (High): `/api/analyse` returns full unblurred data to all authenticated users — `stripAIFields()` not called on either cached (line 1722) or fresh (line 2153) paths.
- **BUG 3** (Medium): "Coming Soon" labels missing on yield calculations, comparables, deal stacking. Only "Portfolio tracking (coming soon)" at index.html:760.
- **BUG 4** (Medium): `invoice.payment_failed` webhook only logs — no user-facing action or tier change.
- **BUG 8** (Low): Trial and paid premium share `tier: 'premium'` — no distinction.
- **BUG 9** (Low): `PREMIUM_ENABLED=true` hardcoded at index.html:1049, TODO unimplemented.
- **BUG 11** (Low): No `?payment=cancelled` handler in frontend.
- **BUG 12** (Low): `.env.example` only lists `GEMINI_API_KEY`.
- **BUG 14** (Medium): Tier expiry depends entirely on webhook — no periodic reconciliation.
- **BUG 16** (Low — downgraded): `/api/signup` lacks rate limiting; no tokens issued but DB pollution and email spam still possible.
- **BUG 18** (Low): CSRF Referer fallback edge case with privacy-focused browsers.
- **BUG 19** (Medium): `/api/leads` has no rate limiting or bot protection.
- **BUG 20** (Low): Admin secret accepted via body in `/api/refresh-cache`, `/api/admin/seed-calendar`, `/api/admin/calendar`, `/api/admin/calendar/:id`; via header in others.
- **BUG 21** (Medium): Legacy `session_token` auth path still active at server.js:919-927.
- **BUG 27** (Low): No validation that `SUPABASE_ANON_KEY` isn't the service key.
- **BUG 31** (Medium): Smart search cache stores full unblurred data regardless of tier.
- **BUG 32** (Medium): Trial expiry mid-session race — `updateProStatus()` only runs once on login.
- **BUG 33** (Low): Payment success toast may fire before webhook processes tier upgrade.
- **BUG 35** (Low): "Upgrade" link shown to already-premium users in account dropdown (line 677).
- **BUG 37** (Low): Checkout session missing `subscription_data.metadata`.
- **BUG 38** (Medium): Dead `tier === 'trial'` check — no user is ever assigned this tier value.
- **BUG 39** (Low): `/api/auth/me` catch block leaks extra user fields.
- **BUG 40** (Medium): `validateUserFromReq` tier expiry nulls `stripe_subscription_id` for active subscribers.
- **BUG 41** (High — NEW): Smart search preset cache hit paths bypass `stripAIFields()` — 4 return paths serve unblurred data to anonymous users.
- **BUG 42** (Medium — NEW): `/api/signup` and `/api/leads` can be weaponised for email spam (welcome emails and lead notifications) with no rate limiting.

### Key verifications this sweep:
1. No hardcoded Stripe keys (sk_/pk_) anywhere — all from env vars. ✅
2. CSRF uses exact match (`===`) and shares `ALLOWED_ORIGINS` with CORS. ✅
3. Stripe webhook validates signature before processing. ✅
4. Stripe webhook returns 500 on handler errors (BUG 17 fix confirmed). ✅
5. `/api/signup` no longer issues session tokens (BUG 13 fix confirmed). ✅
6. `/api/all-lots` calls `stripAIFields()` for non-premium users (BUG 1 fix confirmed). ✅
7. `dlCSV()`/`dlJSON()` check `window._userTier` (BUG 5/34 fix confirmed). ✅
8. `customer.subscription.updated` keeps `stripe_subscription_id` on downgrade (BUG 36 fix confirmed). ✅
9. `/api/analyse` still returns `blurred: false` with full data for all authenticated users (BUG 2 still open). ❌
10. Smart search fresh path calls `stripAIFields()` (BUG 30 fix confirmed) but cache hit paths do NOT (BUG 41 new). ❌

## Sweep completed at 2026-03-14T16:30:00Z — 42 bugs total, 19 FIXED, 23 STILL OPEN, 0 new bugs found.

### Independent verification results:
1. No hardcoded Stripe keys (sk_live_, sk_test_, pk_live_, pk_test_, whsec_) anywhere in codebase — only references are in mission docs. ✅
2. All Stripe env vars loaded from `process.env` (STRIPE_SECRET_KEY, STRIPE_MONTHLY_PRICE_ID, STRIPE_WEBHOOK_SECRET). ✅
3. Stripe webhook validates signature via `stripe.webhooks.constructEvent()` before processing. ✅
4. Webhook returns 500 on handler errors (BUG 17 fix confirmed at line 650). ✅
5. Checkout blocks duplicate subscriptions (BUG 24 fix confirmed at line 518-519). ✅
6. Checkout redirect URLs validated against ALLOWED_ORIGINS with exact match (line 538-539). ✅
7. `/api/analyse` CONFIRMED still returns `blurred: false` with full `lots` array at lines 1723-1725 (cached) and 2154-2156 (fresh) — BUG 2 STILL OPEN. ❌
8. Only one "Coming Soon" text in entire app: "Portfolio tracking (coming soon)" at index.html:760 — BUG 3 STILL OPEN. ❌
9. `invoice.payment_failed` webhook only logs warning at line 644 — BUG 4 STILL OPEN. ❌
10. Legacy session_token auth path still active — BUG 21 STILL OPEN. ❌

### Priority ranking of open bugs:
**HIGH (fix immediately):**
- BUG 2: `/api/analyse` data leak — full scores/opps/risks to all authenticated users
- BUG 41: Smart search cache hit paths bypass `stripAIFields()` — 4 unblurred return paths

**MEDIUM (fix this week):**
- BUG 3: Missing "Coming Soon" labels on yield, comparables, deal stacking
- BUG 14: No subscription reconciliation — stale premium if webhook fails
- BUG 19: `/api/leads` no rate limiting
- BUG 21: Legacy session_token auth bypass
- BUG 31: Smart search cache tier-unaware
- BUG 40: validateUserFromReq nulls stripe_subscription_id on tier expiry
- BUG 42: Email spam via unrate-limited signup/leads

**LOW (fix when convenient):**
- BUGs 4, 8, 9, 11, 12, 16, 18, 20, 27, 32, 33, 35, 37, 38, 39

## Sweep completed at 2026-03-14T17:30:00Z — 42 bugs total, 22 FIXED, 20 STILL OPEN, 0 new bugs found.

### NEWLY FIXED since last sweep (code changes detected):
- **BUG 9** (FIXED): `PREMIUM_ENABLED=true` is no longer present in index.html. The hardcoded constant has been removed entirely. `isPremium()` at line 1049 now simply checks `window._userTier === 'premium'`.
- **BUG 11** (FIXED): `?payment=cancelled` is now handled. Lines 1714-1720 check for both `payment=success` and `payment=cancelled` URL params and display appropriate toast messages ("Checkout cancelled. You can upgrade any time from your account menu.").
- **BUG 35** (FIXED): "Upgrade" link is now hidden for premium users. Line 1758: `if ($('acctUpgrade')) $('acctUpgrade').style.display = 'none'` runs when `data.tier === 'premium'`. Trial users still see the Upgrade link (correct — they haven't paid yet).

### ALL FIXED (22 bugs): 1, 5, 6, 7, 9, 10, 11, 13, 15, 17, 23, 24, 25, 26, 28, 29, 30, 34, 35, 36 (+ partial: 16)

### STILL OPEN (20 bugs):
- **BUG 2** (High): `/api/analyse` still returns full unblurred data for all authenticated users. Cached path (line 1723-1725: `lots: cached.lots, blurred: false`) and fresh path (line 2154-2156: `lots: analysed, blurred: false`) both return complete data without calling `stripAIFields()`.
- **BUG 3** (Medium): "Coming Soon" labels still missing on yield calculations, comparables, deal stacking. Only "Portfolio tracking (coming soon)" at index.html:760.
- **BUG 4** (Medium): `invoice.payment_failed` webhook still only logs — no user-facing action.
- **BUG 8** (Low): Trial and paid premium still share `tier: 'premium'` — no distinction in the database.
- **BUG 12** (Low): `.env.example` still only lists `GEMINI_API_KEY`.
- **BUG 14** (Medium): Tier expiry still depends entirely on webhook — no reconciliation job.
- **BUG 16** (Low — downgraded): `/api/signup` lacks rate limiting; no tokens issued but DB pollution and email spam still possible.
- **BUG 18** (Low): CSRF Referer fallback edge case with privacy-focused browsers.
- **BUG 19** (Medium): `/api/leads` has no rate limiting or bot protection.
- **BUG 20** (Low): Admin secret accepted via body in some endpoints, header in others.
- **BUG 21** (Medium): Legacy `session_token` auth path still active at server.js:920-928. Any user with an old session_token can authenticate without Supabase JWT.
- **BUG 27** (Low): No validation that `SUPABASE_ANON_KEY` isn't the service key.
- **BUG 31** (Medium): Smart search cache stores full unblurred data regardless of tier.
- **BUG 32** (Medium): Trial expiry mid-session race — `updateProStatus()` only runs once on login.
- **BUG 33** (Low): Payment success toast may fire before webhook processes tier upgrade.
- **BUG 37** (Low): Checkout session missing `subscription_data.metadata`.
- **BUG 38** (Medium): Dead `tier === 'trial'` check — no user is ever assigned this tier value.
- **BUG 39** (Low): `/api/auth/me` catch block leaks extra user fields.
- **BUG 40** (Medium): `validateUserFromReq` tier expiry nulls `stripe_subscription_id` for active subscribers if `tier_expires_at` is erroneously set.
- **BUG 41** (High): Smart search preset cache hit paths bypass `stripAIFields()` — 4 return paths serve unblurred data to anonymous users.
- **BUG 42** (Medium): `/api/signup` and `/api/leads` can be weaponised for email spam with no rate limiting.

### Key verifications this sweep:
1. No hardcoded Stripe keys (sk_/pk_/whsec_) anywhere in codebase. ✅
2. CSRF uses exact match (`===`) and shares `ALLOWED_ORIGINS` with CORS. ✅
3. Stripe webhook validates signature via `stripe.webhooks.constructEvent()`. ✅
4. Stripe webhook returns 500 on handler errors. ✅
5. `/api/all-lots` calls `stripAIFields()` for non-premium users. ✅
6. `dlCSV()`/`dlJSON()` check `window._userTier`. ✅
7. `PREMIUM_ENABLED` hardcode removed — BUG 9 FIXED. ✅
8. `?payment=cancelled` now handled — BUG 11 FIXED. ✅
9. "Upgrade" link hidden for premium users — BUG 35 FIXED. ✅
10. `/api/analyse` still returns `blurred: false` with full data — BUG 2 STILL OPEN. ❌
11. Smart search preset cache hit paths still bypass `stripAIFields()` — BUG 41 STILL OPEN. ❌
12. Only one "Coming Soon" text: "Portfolio tracking (coming soon)" at index.html:760 — BUG 3 STILL OPEN. ❌

### Priority ranking of open bugs:
**HIGH (fix immediately):**
- BUG 2: `/api/analyse` data leak — full scores/opps/risks to all authenticated users
- BUG 41: Smart search cache hit paths bypass `stripAIFields()` — 4 unblurred return paths

**MEDIUM (fix this week):**
- BUG 3: Missing "Coming Soon" labels on yield, comparables, deal stacking
- BUG 14: No subscription reconciliation — stale premium if webhook fails
- BUG 19: `/api/leads` no rate limiting
- BUG 21: Legacy session_token auth bypass
- BUG 31: Smart search cache tier-unaware
- BUG 40: validateUserFromReq nulls stripe_subscription_id on tier expiry
- BUG 42: Email spam via unrate-limited signup/leads

**LOW (fix when convenient):**
- BUGs 4, 8, 12, 16, 18, 20, 27, 32, 33, 37, 38, 39

---

## Sweep 6 — 2026-03-14T12:00:00Z

### New Bugs Found

## BUG 43
**File:** server.js:946 (`getAISearchLimit()`)
**Area:** Gating
**Severity:** Medium
**Description:** `getAISearchLimit()` at line 946 checks `user.trial_expires_at` independently of `user.tier`. After a subscriber cancels (webhook sets `tier: 'free'`, `stripe_subscription_id: null`), if their original 14-day `trial_expires_at` hasn't passed, they continue to get unlimited AI searches. The function returns `Infinity` for any user with a non-expired `trial_expires_at`, even if they've been downgraded to free. This creates a loophole: sign up (get 14-day trial), subscribe on day 2, cancel on day 3 — get unlimited AI searches until day 14 despite being tier `free`.
**Reproduction steps:** 1. New user signs up (gets 14-day trial, tier='premium'). 2. User subscribes via Stripe on day 5. 3. User cancels subscription on day 6 (customer.subscription.deleted sets tier='free'). 4. Between day 6 and day 14, user still gets unlimited AI searches because `trial_expires_at` is still in the future.
**Suggested fix:** Change `getAISearchLimit()` to also require `user.tier === 'premium'` before granting Infinity for trial users: `if (user.tier === 'premium' && user.trial_expires_at && new Date(user.trial_expires_at) > new Date()) return Infinity;`
---

## BUG 44
**File:** server.js:2546, 2720
**Area:** Gating (dead code)
**Severity:** Low
**Description:** The `isPremium` checks at lines 2546 and 2720 include `user.tier === 'trial'` as a condition, but no user ever has `tier` value `'trial'` in the database. Trial users are stored as `tier: 'premium'` with a `trial_expires_at` date. The `'trial'` check is dead code that gives a false impression that trial gating is handled separately. If someone later introduces a `tier: 'trial'` database value, these checks would unexpectedly grant premium data access without proper validation of trial expiry.
**Reproduction steps:** Search codebase for `tier === 'trial'` or `tier === "trial"` — found at lines 2546 and 2720 in `isPremium` checks. Cross-reference with user creation at line 905: `tier: 'premium'` (not 'trial').
**Suggested fix:** Remove the `|| user.tier === 'trial'` clause from both isPremium checks since trials are managed via tier='premium' + tier_expires_at. Or, if a 'trial' tier value is desired in future, add it to the database schema and user creation flow consistently.
---

## BUG 45
**File:** server.js:1712-1728 (cached `/api/analyse` response)
**Area:** Gating
**Severity:** High
**Description:** When `/api/analyse` returns a cached response (cache hit path at line 1705), it sends `lots: cached.lots` with `blurred: false` regardless of user tier. The endpoint requires auth (line 1661-1662) but performs zero tier checks. A free-tier user who triggers a cached analysis gets full AI fields (scores, opps, risks, URLs, full addresses). This is worse than the fresh-analysis path (BUG 2) because the cache hit doesn't even consume a rate-limited analysis slot — the rate counter is incremented before the cache check (line 1674-1687), so the user burns a count but gets full data. Multiple free users can all hit the same cached URL and get full unblurred data.
**Reproduction steps:** 1. Premium user analyses a catalogue URL (populates cache). 2. Free user analyses the same URL within cache TTL. 3. Free user receives full cached lots with scores, opps, risks, full addresses, and `blurred: false`.
**Suggested fix:** Apply `stripAIFields()` to `cached.lots` before returning when user is not premium. Set `blurred: true` for free users. Same fix as BUG 2 but specifically for the cache hit path at line 1712.
---

### Existing Bugs Re-verified (Still Open)

| Bug | Status | Notes |
|-----|--------|-------|
| BUG 2 | STILL OPEN ❌ | `/api/analyse` always returns `blurred: false` and full data (lines 1725, 2156). No `stripAIFields()` call on any code path. |
| BUG 3 | STILL OPEN ❌ | Only "Coming Soon" text in entire app: "Portfolio tracking (coming soon)" at index.html:760. No "Coming Soon" on yield calculations, comparables, or deal stacking. `calcDealAnalysis()` (line 2452) is dead code but still present. |
| BUG 14 | STILL OPEN ❌ | No subscription reconciliation cron — stale premium if webhook delivery fails. |
| BUG 19 | STILL OPEN ❌ | `/api/leads` at line 704 has no rate limiting. |
| BUG 21 | STILL OPEN ❌ | Legacy `session_token` auth at lines 920-928 still active — any DB row with a `session_token` value can authenticate without JWT verification. |
| BUG 31 | STILL OPEN ❌ | Smart search cache stores full lot data (line 2563) without applying `stripAIFields()`. |
| BUG 40 | STILL OPEN ❌ | `validateUserFromReq()` at lines 871-873 and 889-891 nulls `stripe_subscription_id` on expired tier, breaking billing portal access. |
| BUG 41 | STILL OPEN ❌ | Smart search preset cache hit paths at lines 2262-2269, 2297, and 2335 return full results without `stripAIFields()` for free/anon users. |
| BUG 42 | STILL OPEN ❌ | `/api/signup` and `/api/leads` lack rate limiting — email spam vector. |

### Confirmed Clean

1. No hardcoded Stripe keys (sk_live_, sk_test_, pk_live_, pk_test_, whsec_) anywhere in codebase — only references are in docs/mission files. ✅
2. All Stripe keys loaded from environment variables: `STRIPE_SECRET_KEY` (line 27), `STRIPE_MONTHLY_PRICE_ID` (line 522), `STRIPE_WEBHOOK_SECRET` (line 555). ✅
3. Stripe webhook validates `stripe-signature` header via `constructEvent()` (line 560). ✅
4. Webhook handles: `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`, `invoice.payment_failed`. ✅
5. Admin routes all check `ADMIN_SECRET`: `/api/cache-status` (line 2732), `/api/refresh-cache` (line 2767), `/api/admin/backfill-images` (line 2778), `/api/analyse-all` (line 2829), `/api/admin/daily-stats` (line 2869), `/api/cost-monitor` (line 2895), `/api/quality-report` (line 2931). ✅
6. Stripe checkout creates customer correctly, passes `success_url` and `cancel_url` with origin validation. ✅
7. Payment success/cancel toast renders correctly in frontend (lines 1711-1725). ✅
8. CSV/JSON export gated to Pro users in frontend (lines 2468, 2474). ✅

### Priority Ranking (Updated)

**CRITICAL:**
- (None — no hardcoded secrets found)

**HIGH (fix immediately):**
- BUG 2: `/api/analyse` full data leak to all authenticated users (both cache hit and fresh paths)
- BUG 45: `/api/analyse` cache hit path returns full unblurred data to free users
- BUG 41: Smart search preset cache bypass — 4 unblurred return paths

**MEDIUM (fix this week):**
- BUG 3: Missing "Coming Soon" labels on yield, comparables, deal stacking
- BUG 43: Trial-to-cancel AI search loophole (getAISearchLimit ignores tier)
- BUG 14: No subscription reconciliation cron
- BUG 19: `/api/leads` no rate limiting
- BUG 21: Legacy session_token auth bypass
- BUG 31: Smart search cache stores ungated data
- BUG 40: validateUserFromReq nulls stripe_subscription_id on expiry
- BUG 42: Email spam via unrate-limited signup/leads

**LOW (fix when convenient):**
- BUG 44: Dead `tier === 'trial'` checks in isPremium
- BUGs 4, 8, 12, 16, 18, 20, 27, 32, 33, 37, 38, 39

## Sweep 6 completed at 2026-03-14T12:00:00Z

---

## Sweep 7 — Full Re-audit (2026-03-14)

### New Bugs

## BUG 46
**File:** server.js:2262-2269, 2297, 2336 (smart search preset cache hit paths)
**Area:** Gating
**Severity:** High
**Description:** The smart search preset cache stores full unblurred `matchingLots` at line 2563-2565 (the `results` field in `smart_search_cache`). When a preset cache hit is served (lines 2262-2269), the results are returned directly without checking user tier or calling `stripAIFields()`. This means anonymous users and free-tier users receive full AI fields (scores, opps, risks, full addresses, URLs) from cached preset searches. The same bypass exists on the partial-stale cache paths at lines 2297 and 2336. This is a duplicate/refinement of BUG 41 but confirming it is still present with current line numbers.
**Reproduction steps:** 1. Call `POST /api/smart-search` with a preset query (e.g. "Properties under £100k") without any auth header. 2. If the preset is cached, the response includes full lot data with scores, opps, risks, full addresses, and listing URLs — no blurring applied.
**Suggested fix:** Apply `stripAIFields()` to results on all cache hit return paths (lines 2263, 2286/2297, 2322/2336) when user is not premium. Or store two versions of the cache (blurred and full).
---

## BUG 47
**File:** server.js:495, 867 (`/api/auth/me` and `validateUserFromReq`)
**Area:** Security — Data Exposure
**Severity:** Medium
**Description:** The `/api/auth/me` endpoint at line 495 returns `stripe_subscription_id` in its response. This exposes the Stripe subscription ID to the client, which is unnecessary for frontend functionality and could be used to probe Stripe's API for subscription details. Additionally, the `validateUserFromReq` function at line 867 selects `stripe_customer_id` and `stripe_subscription_id` into the user object that is returned on auth failure fallback at line 500. While not a critical secret, Stripe subscription IDs should be treated as internal identifiers.
**Reproduction steps:** Sign in, call `GET /api/auth/me` — response includes `stripe_subscription_id` field.
**Suggested fix:** Remove `stripe_subscription_id` from the `select()` clause in the `/api/auth/me` query. The frontend only needs `tier` and `tier_expires_at` to determine subscription state. Keep `stripe_subscription_id` internal to server-side logic only.
---

## BUG 48
**File:** server.js:871-873, 889-891 (validateUserFromReq expiry side-effect)
**Area:** Stripe Subscription Integrity
**Severity:** Medium
**Description:** The `validateUserFromReq()` function performs a destructive side-effect: when a user's `tier_expires_at` has passed, it sets `stripe_subscription_id: null` (lines 872 and 890). This is dangerous because a monthly subscriber whose `tier_expires_at` was incorrectly set (e.g., from a legacy day_pass or data migration) would have their active subscription link severed. Once `stripe_subscription_id` is nulled, the `customer.subscription.deleted` and `customer.subscription.updated` webhooks can no longer find the user (they query by `stripe_subscription_id`). The user keeps paying Stripe but loses premium access permanently. This is a refinement of BUG 40 confirming it is still present with updated line numbers.
**Reproduction steps:** 1. User has an active monthly subscription (tier='premium', stripe_subscription_id='sub_xxx'). 2. Manually set `tier_expires_at` to a past date in Supabase (simulating a data issue). 3. User makes any authenticated request. 4. `validateUserFromReq` downgrades tier to 'free' AND nulls `stripe_subscription_id`. 5. Subsequent webhook events for 'sub_xxx' find no matching user.
**Suggested fix:** Never null `stripe_subscription_id` based on `tier_expires_at`. Subscription lifecycle should only be managed by Stripe webhook events. The expiry check should only downgrade `tier` and `tier_expires_at`, not touch `stripe_subscription_id`.
---

## BUG 49
**File:** index.html:2468-2474 (CSV/JSON export gating)
**Area:** Gating — Client-side Only
**Severity:** Medium
**Description:** CSV and JSON export functions (`dlCSV` at line 2468, `dlJSON` at line 2474) are gated only on the client side by checking `window._userTier !== 'premium'`. However, the `LOTS` array in memory contains full unblurred data for the first 6 lots (via `stripAIFields` allowing `FREE_PREVIEW_LOTS` through). A technically savvy free user can simply call `dlCSV()` or `dlJSON()` from the browser console after modifying `window._userTier = 'premium'`, or directly access `LOTS` to extract all data in memory. There is no server-side export endpoint that enforces tier checks.
**Reproduction steps:** 1. Visit the site as a free user. 2. Open browser console. 3. Type `window._userTier = 'premium'`. 4. Click the CSV export button — full data exports successfully.
**Suggested fix:** Either: (a) Create server-side export endpoints that check tier before generating CSV/JSON, or (b) Accept this as a low-risk known limitation since the `LOTS` array is already in browser memory and `stripAIFields` limits what free users see anyway. The bigger concern is that the preview lots (first 6) contain full AI data even for free users.
---

### Existing Bugs Re-verified (Sweep 7)

| Bug | Status | Line Numbers (current) | Notes |
|-----|--------|------------------------|-------|
| BUG 1 | **FIXED** ✅ | server.js:2719-2721 | `/api/all-lots` now calls `stripAIFields(cleanLots)` for non-premium users. `isPremium` check at line 2720. |
| BUG 2 | STILL OPEN ❌ | server.js:1723-1725, 2154-2156 | `/api/analyse` returns `lots: cached.lots` and `lots: analysed` with `blurred: false` for ALL authenticated users. No `stripAIFields` call on either path. |
| BUG 3 | STILL OPEN ❌ | index.html:760 | Only "Coming Soon" text: "Portfolio tracking (coming soon)". No "Coming Soon" labels on yield calculations, comparables, or deal stacking. `calcDealAnalysis()` at line 2452 is dead code. |
| BUG 4 | STILL OPEN ❌ | server.js:642-645 | `invoice.payment_failed` webhook only logs — no user notification or tier change. |
| BUG 14 | STILL OPEN ❌ | N/A | No subscription reconciliation job exists. |
| BUG 19 | STILL OPEN ❌ | server.js:704 | `/api/leads` has no rate limiting. |
| BUG 21 | STILL OPEN ❌ | server.js:920-928 | Legacy `session_token` auth path still active. |
| BUG 31 | STILL OPEN ❌ | server.js:2563-2565 | Smart search cache stores full `matchingLots` (not `gatedResults`). |
| BUG 40 | STILL OPEN ❌ | server.js:871-873, 889-891 | `validateUserFromReq` nulls `stripe_subscription_id` on tier expiry. See also BUG 48. |
| BUG 41 | STILL OPEN ❌ | server.js:2262-2269, 2297, 2336 | Preset cache returns unblurred results. See also BUG 46. |
| BUG 42 | STILL OPEN ❌ | server.js:406, 704 | `/api/signup` and `/api/leads` lack rate limiting. |
| BUG 43 | STILL OPEN ❌ | server.js:946 | `getAISearchLimit()` grants Infinity based on `trial_expires_at` regardless of `tier`. |
| BUG 44 | STILL OPEN ❌ | server.js:2546, 2720 | Dead `tier === 'trial'` checks in `isPremium`. |
| BUG 45 | STILL OPEN ❌ | server.js:1705-1728 | `/api/analyse` cache hit path returns full unblurred data to free users. |

### Confirmed Clean (Sweep 7)

1. No hardcoded Stripe keys (sk_live_, sk_test_, pk_live_, pk_test_, whsec_) anywhere in codebase — only references are in docs/mission files. ✅
2. All Stripe keys loaded from environment variables: `STRIPE_SECRET_KEY` (line 27), `STRIPE_MONTHLY_PRICE_ID` (line 522), `STRIPE_WEBHOOK_SECRET` (line 555). ✅
3. Stripe webhook validates `stripe-signature` header via `constructEvent()` (line 560). ✅
4. Webhook handles: `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`, `invoice.payment_failed`. ✅
5. Webhook returns 500 on handler errors (line 650). ✅
6. Admin routes all check `ADMIN_SECRET` with timing-safe comparison. ✅
7. CSRF origin validation active on all POST routes (Stripe webhook correctly exempted at line 94). ✅
8. Content Security Policy headers present (line 68-79). ✅
9. Stripe checkout validates existing subscription before creating new one (line 518-519). ✅
10. No hardcoded API keys, passwords, or secrets in index.html. ✅

### Priority Ranking (Sweep 7)

**CRITICAL:** (None — no hardcoded secrets)

**HIGH (fix immediately):**
- BUG 2: `/api/analyse` full data leak to all authenticated users (both paths)
- BUG 45: `/api/analyse` cache hit returns full data to free users
- BUG 41/46: Smart search preset cache bypasses gating on 3+ return paths

**MEDIUM (fix this week):**
- BUG 3: Missing "Coming Soon" labels on yield, comparables, deal stacking
- BUG 40/48: `validateUserFromReq` destructively nulls `stripe_subscription_id`
- BUG 43: Trial-to-cancel AI search loophole
- BUG 47: `/api/auth/me` exposes `stripe_subscription_id` to client
- BUG 49: Export gating is client-side only
- BUG 19/42: No rate limiting on `/api/leads` and `/api/signup`
- BUG 21: Legacy `session_token` auth path still active
- BUG 31: Smart search cache stores ungated data
- BUG 14: No subscription reconciliation

**LOW:**
- BUG 44: Dead `tier === 'trial'` checks
- BUG 4: `invoice.payment_failed` only logs

## Sweep 7 completed at 2026-03-14T16:00:00Z — 49 bugs total. BUG 1 confirmed FIXED. 4 new bugs (46-49). 13 existing bugs confirmed still open.

---

## BUG 50
**File:** server.js:2563-2565 (smart search cache upsert)
**Area:** Gating
**Severity:** High
**Description:** When smart search results are cached for preset queries, the cache stores `matchingLots` (line 2565) — the ungated, full-data results — rather than `gatedResults`. The gated data is only computed at line 2547 for the immediate response. When a subsequent user hits the cache (lines 2259-2269), the stored `presetCache.results` contain full premium data regardless of the requesting user's tier. This is a re-confirmation and expansion of BUG 31: the partially-stale cache merge paths (lines 2286-2297, 2322-2336) also return cached results without applying `stripAIFields()`.
**Reproduction steps:** 1. A premium user triggers a preset smart search — results with full scores, opps, risks are cached. 2. An anonymous user triggers the same preset search — cache hit at line 2259 returns full ungated data.
**Suggested fix:** Either cache only gated data (but this loses premium detail), or apply `stripAIFields()` to cached results at read time based on the requesting user's tier.
---

## BUG 51
**File:** server.js:495 (`/api/auth/me` endpoint)
**Area:** Security / Data Exposure
**Severity:** Low
**Description:** The `/api/auth/me` endpoint returns `stripe_subscription_id` to the client (line 495 select list). This is an internal Stripe object ID (e.g., `sub_1234...`) that has no use on the frontend and could be used by an attacker to probe Stripe's API if combined with a leaked API key. While not directly exploitable on its own, it violates the principle of least privilege — internal identifiers should not be sent to the client unless needed.
**Reproduction steps:** Sign in, call `GET /api/auth/me` — response includes `stripe_subscription_id`.
**Suggested fix:** Remove `stripe_subscription_id` from the select list in `/api/auth/me`. The frontend only needs `tier` and `tier_expires_at` to determine access level.
---

### Existing Bugs Re-verified (Sweep 8)

| Bug | Status | Line Numbers (current) | Notes |
|-----|--------|------------------------|-------|
| BUG 1 | **FIXED** ✅ | server.js:2719-2721 | `/api/all-lots` calls `stripAIFields()` for non-premium users. |
| BUG 2 | STILL OPEN ❌ | server.js:1723-1725, 2154-2156 | `/api/analyse` returns full data with `blurred: false` for ALL authenticated users. No `stripAIFields` on either cache or fresh path. |
| BUG 3 | STILL OPEN ❌ | index.html:760 | Only "Coming Soon" text: "Portfolio tracking (coming soon)". No labels on yield, comparables, deal stacking. |
| BUG 4 | STILL OPEN ❌ | server.js:642-645 | `invoice.payment_failed` only logs. |
| BUG 5/49 | STILL OPEN ❌ | index.html:2468, 2474 | Export gating is client-side only (`window._userTier` check). |
| BUG 10 | **FIXED** ✅ | server.js:96 | CSRF now uses exact match (`origin === a`) instead of `startsWith`. |
| BUG 14 | STILL OPEN ❌ | N/A | No subscription reconciliation job. |
| BUG 15 | **FIXED** ✅ | server.js:538-539 | Stripe redirect URLs now validated against `ALLOWED_ORIGINS.includes()`. |
| BUG 17 | **FIXED** ✅ | server.js:648-650 | Webhook now returns 500 on handler error instead of swallowing. |
| BUG 19/42 | STILL OPEN ❌ | server.js:406, 704 | `/api/signup` and `/api/leads` lack rate limiting. |
| BUG 21 | STILL OPEN ❌ | server.js:920-928 | Legacy `session_token` auth path still active. |
| BUG 24 | **FIXED** ✅ | server.js:518-519 | Checkout now checks `user.stripe_subscription_id` before creating new session. |
| BUG 25 | STILL OPEN ❌ | server.js:96 | CSRF allowed origins still hardcoded — no `ALLOWED_ORIGINS` env var for dev. Wait — line 42 does read from env: `process.env.ALLOWED_ORIGINS`. But the CSRF check at line 96 uses `ALLOWED_ORIGINS` which IS the env-backed list. **FIXED** ✅ |
| BUG 26 | **FIXED** ✅ | server.js:573 | `checkout.session.completed` now logs warning when `userId` missing from metadata. |
| BUG 31/50 | STILL OPEN ❌ | server.js:2563-2565 | Smart search cache stores ungated `matchingLots`. |
| BUG 40 | STILL OPEN ❌ | server.js:871-873, 889-891 | `validateUserFromReq` nulls `stripe_subscription_id` on tier expiry. |
| BUG 41/46 | STILL OPEN ❌ | server.js:2262-2269, 2297, 2336 | Preset cache returns ungated results on multiple paths. |
| BUG 43 | STILL OPEN ❌ | server.js:946 | `getAISearchLimit()` grants Infinity for expired trial users who still have `trial_expires_at` in the future (edge case with time zones). |
| BUG 44 | STILL OPEN ❌ | server.js:2546, 2720 | Dead `tier === 'trial'` checks — no user ever has tier='trial'. |
| BUG 45 | STILL OPEN ❌ | server.js:1705-1728 | `/api/analyse` cache hit returns full unblurred data. |
| BUG 47 | STILL OPEN ❌ | server.js:495 | `/api/auth/me` exposes `stripe_subscription_id`. See BUG 51. |

### Confirmed Clean (Sweep 8)

1. No hardcoded Stripe keys (sk_live_, sk_test_, pk_live_, pk_test_, whsec_) anywhere in codebase. ✅
2. All Stripe keys loaded from environment variables: `STRIPE_SECRET_KEY` (line 27), `STRIPE_MONTHLY_PRICE_ID` (line 522), `STRIPE_WEBHOOK_SECRET` (line 555). ✅
3. Stripe webhook validates `stripe-signature` header via `constructEvent()` (line 560). ✅
4. Webhook handles: `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`, `invoice.payment_failed`. ✅
5. Webhook returns 500 on handler errors (line 650). ✅ (Fixed since sweep 6)
6. CSRF origin validation uses exact match (line 96). ✅ (Fixed since sweep 6)
7. Stripe checkout prevents double subscription (line 518-519). ✅ (Fixed since sweep 7)
8. Stripe redirect URLs validated against allowed origins (lines 538-539, 666). ✅ (Fixed since sweep 7)
9. CSRF allowed origins now configurable via `ALLOWED_ORIGINS` env var (line 42). ✅ (Fixed since sweep 7)
10. Content Security Policy headers present (lines 68-79). ✅
11. Admin routes use timing-safe comparison (`safeCompare`). ✅
12. No hardcoded API keys or secrets in index.html. ✅

### Priority Ranking (Sweep 8)

**HIGH (fix immediately):**
- BUG 2/45: `/api/analyse` full data leak (cache + fresh paths) to all authenticated users
- BUG 31/41/46/50: Smart search cache stores and returns ungated premium data on 4+ code paths
- BUG 3: Missing "Coming Soon" labels on yield, comparables, deal stacking

**MEDIUM (fix this week):**
- BUG 40: `validateUserFromReq` destructively nulls `stripe_subscription_id` on trial expiry
- BUG 43: Trial AI search loophole via `trial_expires_at`
- BUG 19/42: No rate limiting on `/api/leads` and `/api/signup`
- BUG 21: Legacy `session_token` auth path
- BUG 14: No subscription reconciliation job
- BUG 5/49: Export gating is client-side only

**LOW:**
- BUG 44: Dead `tier === 'trial'` checks
- BUG 4: `invoice.payment_failed` only logs
- BUG 51: `/api/auth/me` exposes `stripe_subscription_id`

### Fixes Confirmed Since Last Sweep
- BUG 10: CSRF `startsWith` → exact match ✅
- BUG 15: Stripe redirect URL validation ✅
- BUG 17: Webhook error returns 500 ✅
- BUG 24: Double subscription prevention ✅
- BUG 25: ALLOWED_ORIGINS from env var ✅
- BUG 26: Missing userId logging ✅

## Sweep 8 completed at 2026-03-14T19:30:00Z — 51 bugs total. 7 bugs confirmed FIXED (1, 10, 15, 17, 24, 25, 26). 2 new bugs (50, 51). 14 existing bugs confirmed still open.

---

## Sweep 9 — Full Re-audit (2026-03-14)

### New Bugs

## BUG 52
**File:** terms.html:82 vs server.js:515-516, 588-589
**Area:** Stripe Flow / Legal
**Severity:** Medium
**Description:** The Terms of Service (terms.html:82) advertise a "Day Pass" product at £1.99 for 24-hour access. However, the server-side checkout endpoint (server.js:515-516) only accepts `product === 'monthly'` — any other value returns a 400 error. The Day Pass is handled in the webhook as a legacy product (server.js:588-589: `// Legacy day_pass — no longer sold`), and the paywall modal in index.html only shows the Pro £9.99/month option with no Day Pass button. This creates a legal discrepancy: the Terms promise a product that cannot be purchased, potentially violating UK consumer protection regulations (Consumer Rights Act 2015 requires accurate pre-contractual information).
**Reproduction steps:** 1. Read terms.html — Day Pass is listed as an active product at £1.99. 2. Attempt to purchase a Day Pass — no button exists in the UI. 3. Try `POST /api/stripe/checkout` with `{"product":"day_pass"}` — returns 400 "Invalid product. Use 'monthly'."
**Suggested fix:** Either: (a) Remove Day Pass from terms.html if it's no longer offered, or (b) Re-enable Day Pass by adding `'day_pass'` to the accepted products list in checkout and creating a corresponding Stripe price ID. If (a), update JSON-LD structured data in index.html which also references Day Pass pricing.
---

## BUG 53
**File:** server.js:934, 690, 1727, 2158
**Area:** Gating
**Severity:** Medium
**Description:** `FREE_SCAN_LIMIT = 3` is defined at line 934 and reported to the frontend via `/api/stripe/status` (line 690: `scanLimit: FREE_SCAN_LIMIT`) and `/api/analyse` responses (lines 1727, 2158). However, it is **never enforced** server-side. The `/api/analyse` endpoint uses a separate IP-based `RATE_LIMIT = 5` (line 186) for rate limiting (line 1689). The `analyses_count` field on the user record is only tracked/incremented (not compared against `FREE_SCAN_LIMIT`). The frontend shows "X of 3 free scans used" but the actual server-side limit is 5 per IP per day — and it's IP-based, not user-based. A free user can run 5 analyses per day (not 3), and the count resets by IP, not by account.
**Reproduction steps:** 1. Check `/api/stripe/status` — `scanLimit: 3`. 2. Run 4 analyses from the same account — all succeed (IP rate limit is 5, not 3). 3. The frontend may show "3 of 3 scans used" but the server allows 2 more.
**Suggested fix:** Either enforce `FREE_SCAN_LIMIT` server-side by comparing `user.analyses_count` against it for non-premium users, or change the reported `scanLimit` to match the actual `RATE_LIMIT` value. Consider whether the limit should be per-user (analyses_count) or per-IP (rate_limits table).
---

## BUG 54
**File:** server.js:2563-2565, 2262-2269 (smart search cache write and read)
**Area:** Gating
**Severity:** High
**Description:** When smart search caches preset results (line 2563), it stores the ungated `matchingLots` rather than `gatedResults`. The cache write occurs AFTER the `stripAIFields()` call at line 2547 computes `gatedResults`, but uses the pre-gated `matchingLots` array. On cache read (line 2262-2269), the full ungated data is returned directly. This means even if a free user triggers the initial cache population, the data stored in cache is the ungated version. Furthermore, the `incrementSearchCounter()` at line 2261 counts a search hit against the user's quota even though the user is getting cached (not AI-generated) results. This punishes users for cache hits.
**Reproduction steps:** 1. As anonymous user, run a preset smart search (e.g. "refurb under 100k"). 2. If it's the first hit, the fresh path runs and the response is correctly gated. 3. But the cache stores ungated data. 4. The next anonymous user hitting the same preset gets full ungated data from cache. 5. Both users have their search counter incremented.
**Suggested fix:** Store `gatedResults` in cache (or better: always store full data but apply `stripAIFields()` at read time based on requesting user's tier). Don't increment search counter for pure cache hits since no AI API call was made.
---

### Existing Bugs Re-verified (Sweep 9)

| Bug | Status | Notes |
|-----|--------|-------|
| BUG 1 | **FIXED** ✅ | `/api/all-lots` calls `stripAIFields()` at line 2721. |
| BUG 2/45 | STILL OPEN ❌ | `/api/analyse` returns full data with `blurred: false` for all authenticated users. No `stripAIFields()` on cache (line 1724) or fresh (line 2155) paths. |
| BUG 3 | STILL OPEN ❌ | Only "Coming Soon" text: "Portfolio tracking (coming soon)" at index.html:760. No labels on yield, comparables, deal stacking. |
| BUG 4 | STILL OPEN ❌ | `invoice.payment_failed` webhook only logs (line 644). |
| BUG 5/34 | **FIXED** ✅ | `dlCSV()`/`dlJSON()` now check `window._userTier`. |
| BUG 6 | **FIXED** ✅ | Admin endpoints no longer accept `req.query.token`. |
| BUG 7 | **FIXED** ✅ | `/api/analyse-all` now requires admin secret (line 2829). |
| BUG 9 | **FIXED** ✅ | `PREMIUM_ENABLED` hardcode removed. |
| BUG 10 | **FIXED** ✅ | CSRF uses exact match at line 96. |
| BUG 11 | **FIXED** ✅ | `?payment=cancelled` now handled. |
| BUG 13 | **FIXED** ✅ | `/api/signup` no longer issues session tokens. |
| BUG 14 | STILL OPEN ❌ | No subscription reconciliation job. |
| BUG 15 | **FIXED** ✅ | Stripe redirect URLs validated against ALLOWED_ORIGINS. |
| BUG 17 | **FIXED** ✅ | Webhook returns 500 on handler error (line 650). |
| BUG 19/42 | STILL OPEN ❌ | `/api/signup` and `/api/leads` still lack rate limiting. |
| BUG 21 | STILL OPEN ❌ | Legacy `session_token` auth path still active at lines 920-927. |
| BUG 24 | **FIXED** ✅ | Checkout checks `user.stripe_subscription_id` (line 518). |
| BUG 25 | **FIXED** ✅ | CSRF uses `ALLOWED_ORIGINS` from env var. |
| BUG 26 | **FIXED** ✅ | `checkout.session.completed` logs warning when userId missing. |
| BUG 28 | **FIXED** ✅ | `/api/signup` no longer generates session tokens for returning users. |
| BUG 29 | **FIXED** ✅ | CSRF and CORS share `ALLOWED_ORIGINS`. |
| BUG 30 | **FIXED** ✅ | Smart search fresh path calls `stripAIFields()` at line 2547. |
| BUG 31/41/46/50/54 | STILL OPEN ❌ | Smart search cache stores ungated data and returns it without `stripAIFields()` on 4+ code paths. |
| BUG 35 | **FIXED** ✅ | "Upgrade" link hidden for premium users. |
| BUG 36 | **FIXED** ✅ | `customer.subscription.updated` keeps `stripe_subscription_id` on downgrade (line 636). |
| BUG 40/48 | STILL OPEN ❌ | `validateUserFromReq` nulls `stripe_subscription_id` on tier expiry (lines 872, 890). |
| BUG 43 | STILL OPEN ❌ | `getAISearchLimit()` grants Infinity based on `trial_expires_at` regardless of tier (line 946). |
| BUG 44 | STILL OPEN ❌ | Dead `tier === 'trial'` checks at lines 2546, 2720. |
| BUG 49 | STILL OPEN ❌ | Export gating is client-side only. |
| BUG 51 | STILL OPEN ❌ | `/api/auth/me` returns `stripe_subscription_id` to client (line 495). |

### Confirmed Clean (Sweep 9)

1. No hardcoded Stripe keys (sk_live_, sk_test_, pk_live_, pk_test_, whsec_) anywhere in codebase. ✅
2. All Stripe keys loaded from environment variables: `STRIPE_SECRET_KEY` (line 27), `STRIPE_MONTHLY_PRICE_ID` (line 522), `STRIPE_WEBHOOK_SECRET` (line 555). ✅
3. Stripe webhook validates `stripe-signature` header via `constructEvent()` (line 560). ✅
4. Webhook handles: `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`, `invoice.payment_failed`. ✅
5. Webhook returns 500 on handler errors (line 650). ✅
6. CSRF origin validation uses exact match and shares `ALLOWED_ORIGINS` with CORS. ✅
7. Stripe checkout prevents double subscription (line 518). ✅
8. Stripe redirect URLs validated against `ALLOWED_ORIGINS` (lines 538-539, 666). ✅
9. Content Security Policy headers present (lines 68-79). ✅
10. Admin routes all use timing-safe comparison (`safeCompare`). ✅
11. No hardcoded API keys or secrets in HTML files. ✅
12. CSV/JSON export gated to Pro users in frontend (lines 2468, 2474). ✅

### Priority Ranking (Sweep 9)

**HIGH (fix immediately):**
- BUG 2/45: `/api/analyse` full data leak (cache + fresh paths) to all authenticated users
- BUG 31/41/46/50/54: Smart search cache stores and returns ungated premium data on 4+ code paths
- BUG 3: Missing "Coming Soon" labels on yield, comparables, deal stacking

**MEDIUM (fix this week):**
- BUG 52: Terms advertise Day Pass but it can't be purchased (legal discrepancy)
- BUG 53: `FREE_SCAN_LIMIT` reported as 3 but actual server limit is 5/IP/day
- BUG 40/48: `validateUserFromReq` destructively nulls `stripe_subscription_id` on trial expiry
- BUG 43: Trial AI search loophole via `trial_expires_at`
- BUG 19/42: No rate limiting on `/api/leads` and `/api/signup`
- BUG 21: Legacy `session_token` auth path
- BUG 14: No subscription reconciliation job
- BUG 49: Export gating is client-side only

**LOW:**
- BUG 44: Dead `tier === 'trial'` checks
- BUG 4: `invoice.payment_failed` only logs
- BUG 51: `/api/auth/me` exposes `stripe_subscription_id`
- BUGs 8, 12, 16, 18, 20, 27, 32, 33, 37, 38, 39

### All Fixed Bugs (22 total)
BUGs 1, 5, 6, 7, 9, 10, 11, 13, 15, 17, 23, 24, 25, 26, 28, 29, 30, 34, 35, 36 (+ partial: 16)

## Sweep 9 completed at 2026-03-14T23:45:00Z — 54 bugs total. 22 FIXED. 3 new bugs (52, 53, 54). 29 open (including duplicates/refinements).
