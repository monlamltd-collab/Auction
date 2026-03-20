# Domain Pitfalls

**Domain:** Free-first pivot, analytics, AI cost optimisation for existing UK property auction monolith
**Researched:** 2026-03-20
**Codebase:** server.js ~11K lines, ~36 auction houses, Supabase + Stripe + Gemini + Firecrawl

---

## Critical Pitfalls

Mistakes that cause service outages, data loss, or budget blowout.

### CRIT-1: Stripe Hibernation Breaks Active User Sessions

**What goes wrong:** Wrapping Stripe behind `STRIPE_ENABLED=false` without updating every code path that reads user tier. The webhook endpoint stops processing, but existing subscribers still have `tier: 'premium'` and `stripe_subscription_id` in Supabase. When their subscriptions naturally expire or Stripe sends cancellation webhooks, the webhook handler is disabled, so users stay stuck as "premium" forever -- or worse, the `validateUserFromReq` function (which checks `tier_expires_at`) downgrades them mid-session and nulls their `stripe_subscription_id`, breaking any future reactivation.

**Why it happens:** The Stripe integration touches at minimum 8 distinct code paths in server.js (checkout, webhook handler with 4 event types, portal, status check, and the `validateUserFromReq` tier expiry check). Disabling the webhook endpoint without handling the existing subscriber lifecycle creates orphaned state.

**Consequences:** Users stuck in wrong tier. Stripe continues charging existing subscribers (Stripe does not stop billing just because your webhook endpoint is disabled). When you reactivate Stripe, subscription state is months out of sync with your database.

**Prevention:**
1. Before setting `STRIPE_ENABLED=false`, manually cancel all active Stripe subscriptions via the Stripe dashboard (there are likely very few paying users given the pivot decision).
2. Run a one-time migration: `UPDATE users SET tier = 'free', stripe_subscription_id = NULL, tier_expires_at = NULL WHERE tier = 'premium'`.
3. Keep the webhook endpoint alive but have it only handle `customer.subscription.deleted` events (the cancellation confirmations).
4. Set a calendar reminder to verify Stripe dashboard shows zero active subscriptions.

**Detection:** Check Stripe dashboard for active subscriptions monthly. Monitor `users` table for any rows where `tier = 'premium'` after hibernation.

**Phase:** Must be addressed in the very first phase, before any other changes.

---

### CRIT-2: Gemini Model Deprecation During Development

**What goes wrong:** The codebase currently uses `gemini-2.5-flash-lite` and `gemini-2.5-pro`. Google has announced deprecation of the Gemini 2.5 model line, with stable replacement models expected before June 2026. If the project does not pin to a stable model version or monitor deprecation announcements, the extraction pipeline silently breaks when Google sunsets the model endpoint.

**Why it happens:** Google's model lifecycle is aggressive -- models get deprecated with ~3 months notice. The codebase references models by string constant (`MODEL_FLASH`, `MODEL_PRO`) which is good, but there is no health check that validates the model is still responding correctly.

**Consequences:** Total extraction pipeline failure. `callGemini()` throws errors for every auction house, the `creditExhausted` flag gets set (it triggers on quota/error responses), and the entire auto-analyse cycle stops. With 36 auction houses dependent on AI extraction, this is a full outage.

**Prevention:**
1. Subscribe to Google AI developer announcements for deprecation notices.
2. When switching models, run the extraction pipeline against 5-10 saved HTML snapshots and diff the JSON output field-by-field before deploying.
3. Keep `MODEL_FLASH` and `MODEL_PRO` as env vars (not hardcoded constants) so model changes do not require code deploys.
4. Add a simple model health check in the admin dashboard: call Gemini with a test prompt on startup or on demand.

**Detection:** `callGemini()` already logs errors with model name. Add an alert when Gemini error rate exceeds 50% over 10 minutes.

**Phase:** AI cost optimisation phase -- model migration must include deprecation-proofing.

---

### CRIT-3: Budget Blowout from Free-Tier Traffic on Paid Gemini API

**What goes wrong:** Currently on Gemini paid Tier 1 (~2000 RPM for flash-lite). Opening all AI features for free means every signed-in user gets unlimited smart search, which calls `callGemini()` per query. At 500-1000 MAU, even 2-3 smart searches per user per day = 1000-3000 Gemini calls/day. At `gemini-2.5-flash-lite` pricing ($0.10 input / $0.40 output per 1M tokens), with smart search prompts of ~50K input tokens + ~2K output tokens each: ~$0.005 per search + $0.001 output = ~$0.006/search. 3000 searches/day = ~$18/month on Gemini alone. Manageable. But if Gemini Pro is triggered (unknown houses, PDFs) at $1.25/$10 per 1M tokens, a single PDF extraction costing $0.10-0.50 per call, with 36 houses * 2 auctions/month = 72 extractions, could add $7-36/month.

**Why it happens:** The cost model changes dramatically when you remove rate limits that were implicitly provided by the paywall. Free users had 3 AI searches (anon) or 10/day (signed in). Removing these gates removes the cost ceiling.

**Consequences:** With ~$150/month total budget, Gemini costs eating $25-55/month leaves dangerously little headroom. A viral day with 5x normal traffic could burn through a month's budget in days.

**Prevention:**
1. Keep rate limits on AI features even for free users. "Free" does not mean "unlimited" -- it means "no payment required." 10 smart searches/day per user is generous and caps cost.
2. Set a hard Gemini API budget cap in Google Cloud Console (not just in-app tracking).
3. Track Gemini spend daily in the admin dashboard alongside Firecrawl credits.
4. Use `gemini-2.5-flash-lite` for everything including smart search (it is 6-25x cheaper than Pro). Reserve Pro only for PDF extraction where Flash-Lite genuinely fails.
5. Consider caching smart search results more aggressively (current 1-hour TTL could be extended to 6-24 hours for identical queries).

**Detection:** Daily cost tracking via Google Cloud billing alerts. Set alerts at $30/month and $50/month.

**Phase:** Must be addressed simultaneously with free-first gating pivot -- never open the gate without the cost cap.

---

### CRIT-4: Supabase Free Tier Limits Under Growth

**What goes wrong:** Supabase free tier provides 500 MB database storage and pauses projects after 7 days of inactivity. If the project is on the free tier and traffic grows to 500-1000 MAU, several limits become dangerous:
- The `cached_analyses` table stores full lot arrays as JSONB -- 36 houses * ~100 lots * ~2KB per lot = ~7 MB per scrape cycle. With 7-day cache TTL, that is ~50 MB just for cached analyses. Add `rate_limits`, `users`, `activity_events`, `enrichment_cache` (EPC + flood data for thousands of postcodes), and you approach 500 MB within months.
- The auto-pause feature would kill the site dead during quiet periods.

**Why it happens:** Moving from paid-user model (few users, high value) to free-for-all model (many users, low individual value) changes the database growth curve from linear to exponential.

**Consequences:** Database full = write failures. Auto-pause = site down. Both destroy user trust during the critical growth phase.

**Prevention:**
1. Confirm current Supabase plan tier. If on free tier, upgrade to Pro ($25/month) -- this is non-negotiable for a production app.
2. If already on Pro, implement enrichment_cache pruning (30-day cache with actual cleanup, not just TTL-based reads).
3. Add a database size monitor to the admin dashboard.
4. Prune `rate_limits` table daily (it has no cleanup logic -- rows accumulate forever).
5. Consider moving `cached_analyses` to shorter TTL or compressing the JSONB.

**Detection:** Supabase dashboard shows storage usage. Set an alert at 400 MB (free) or track growth rate monthly (Pro).

**Phase:** Infrastructure phase, before launching free-tier publicly.

---

## Major Pitfalls

Mistakes that cause significant rework or user-facing issues.

### MAJ-1: AI Model Switch Causes Silent Quality Regression

**What goes wrong:** Switching from `gemini-2.5-flash-lite` to a cheaper model (Grok, Gemini 3.1 Flash-Lite, etc.) for cost savings, but the new model produces subtly different JSON output. Fields get renamed, arrays become objects, numbers become strings, or -- most insidiously -- the extraction quality drops (fewer lots detected, wrong prices, missing addresses) without any error being thrown.

**Why it happens:** The extraction pipeline does regex-based JSON parsing (`text.match(/\[[\s\S]*\]/)`) rather than schema validation. A model that returns valid JSON but with different field names or structures will silently produce lots with missing data. The scoring engine then gives everything a 0 score because it cannot find the expected fields.

**Consequences:** The directory fills with degraded data. Users see lots with missing prices, no images, no scores. The site looks broken even though no errors are logged.

**Prevention:**
1. Create a test harness: save 10 representative HTML pages across different auction houses, run extraction with the current model, save the JSON output as "golden" snapshots.
2. Before switching models, run the same pages through the new model and diff field-by-field: lot count, field presence, price accuracy, address completeness.
3. Add post-extraction validation: reject any lot missing `address`, `price`, or `lotNumber`. Log rejections with the model name.
4. Roll out model changes per-house (override `selectModel()` for a few houses first) rather than globally.

**Detection:** Track average lots-per-house and average fields-per-lot in the admin dashboard. A sudden drop after a model change signals regression.

---

### MAJ-2: Feature Flag Scope Creep -- Stripe Flag Infects Tier Logic

**What goes wrong:** Adding `STRIPE_ENABLED` as a single boolean flag, but the tier system is deeply coupled to Stripe throughout the codebase. The frontend checks `window._userTier`, which is set by `/api/auth/me`, which reads from the `users` table, which is updated by Stripe webhooks. Disabling Stripe does not automatically change the tier logic -- it just removes the mechanism that updates tiers. The `isPremium()` function still checks for `'premium'` tier, the blur CSS still applies to non-premium users, the rate limits still differ by tier.

**Why it happens:** Feature flags work well for binary on/off features. The Stripe integration is not a feature -- it is a state machine (free -> trial -> premium -> cancelled -> free) that touches auth, UI, rate limiting, and data access simultaneously.

**Consequences:** Users see blur overlays on data that should now be free. Or the opposite: the flag removes blurring but not rate limits, so users hit "10 searches/day" walls on what was advertised as unlimited.

**Prevention:**
1. Do not use a single flag. Use a two-step approach:
   - `STRIPE_ENABLED=false` disables checkout/portal/webhook endpoints only.
   - Separately update the tier logic: change `isPremium()` to always return true (or remove the concept entirely), remove blur CSS, update rate limit tiers.
2. Map every place `tier` or `isPremium()` is checked (server.js AND index.html) and create a checklist.
3. Test the full user journey: anonymous -> sign up -> use smart search -> view lot details -> use deal stacking. Verify no paywalls or blur at any step.

**Detection:** Manual QA walkthrough. Automated: check that no response from `/api/auth/me` returns `tier: 'free'` for signed-in users (if everything should be free).

---

### MAJ-3: Landing Page Cannibalizes Existing Routes

**What goes wrong:** The current route structure serves `index.html` for `/`, `/auctions`, and `/analyse`. Adding a landing page at `/` means either: (a) the landing page replaces the directory as the homepage, requiring users to click through to reach the tool, or (b) the landing page is at a separate route like `/home` which nobody will find organically.

**Why it happens:** Single-page apps with catch-all routing make it hard to add marketing pages without conflicting with app routes. The current `index.html` handles multiple "pages" via tab switching, not actual routes.

**Consequences:** SEO confusion (Google indexes `/` as the directory, then suddenly it is a marketing page -- ranking drops). Users who bookmarked `/` now see a landing page instead of the tool. Or, the landing page at a separate URL gets no organic traffic.

**Prevention:**
1. Make the landing page the new `/` route, but ensure the directory is one click away at `/auctions` (which already exists as a route).
2. Add a 301 redirect or canonical tag so Google knows the directory moved.
3. The landing page should load fast (static HTML, no Supabase/Gemini calls) -- do not serve it through the same heavy `index.html` that initialises the full SPA.
4. Implement as a separate HTML file (`landing.html` or `welcome.html`) served at `/`, not as another tab in `index.html`.

**Detection:** Monitor Google Search Console for ranking changes on key terms after launch.

---

### MAJ-4: Railway Memory Pressure from Free-for-All Traffic

**What goes wrong:** Railway Hobby plan ($5/month) has limited resources. The server.js monolith already runs Express + Puppeteer (chromium) + extensive in-memory caching. Moving from ~10 paid users to 500-1000 MAU means 50-100x more concurrent connections, more in-memory cache entries, more rate limit buckets (the `_rlBuckets` Map grows unbounded per CONCERNS.md), and more Supabase queries.

**Why it happens:** The monolith architecture means web serving, scraping, and API responses share a single Node.js process. A traffic spike during an auction-heavy week (when users are most likely to search) coincides with auto-analyse background scraping, competing for the same memory and CPU.

**Consequences:** Out-of-memory crashes on Railway. The server restarts, losing all in-memory cache (every auction house must be re-scraped). This triggers a cascade: 36 Firecrawl calls burn credits, 36+ Gemini calls burn API budget, and users see "loading" for 20+ minutes.

**Prevention:**
1. Upgrade to Railway Pro plan ($20/month) if memory becomes an issue -- vertical autoscaling is available.
2. Implement `_rlBuckets` cleanup: prune entries older than 24 hours on a setInterval.
3. Move to Supabase-backed caching only (remove in-memory cache duplication) so restarts do not trigger re-scraping.
4. Consider separating the auto-analyse cron job from the web server (Railway supports multiple services in one project).
5. Set `NODE_OPTIONS=--max-old-space-size=512` (or appropriate limit) to get predictable OOM behaviour rather than silent degradation.

**Detection:** Railway dashboard shows memory usage. Set alerts at 80% of container limit.

---

### MAJ-5: Analytics Implementation Violates UK PECR/GDPR

**What goes wrong:** Adding Google Analytics (GA4) or similar cookie-based tracking without a cookie consent banner. Under UK PECR (enforced by ICO), analytics cookies require prior informed consent -- users must opt in before any tracking cookie is set. Simply adding a GA4 script tag without consent management is illegal and can result in ICO enforcement action.

**Why it happens:** Developers often assume "analytics are fine" or "everyone does it." The UK's ICO has been actively enforcing cookie compliance, reporting 95%+ compliance among top 1000 UK websites in 2025-2026.

**Consequences:** ICO enforcement (unlikely at this scale but reputationally damaging). More practically: a cookie consent banner adds friction to the sign-up flow, which directly undermines the free-first growth strategy.

**Prevention:**
1. Use a cookie-free analytics tool instead. **Plausible** ($9/month) or **Umami** (self-hosted, free) are GDPR-compliant by design -- no cookies, no personal data, no consent banner needed.
2. If using Plausible: it counts unique visitors via a hash of IP + User-Agent (no cookies stored), which is sufficient for MAU counting.
3. Do NOT use Google Analytics unless you are prepared to implement a full cookie consent management platform.
4. For Bridgematch funnel tracking (which users click "Get Finance"): track this server-side via the existing `activity_events` table, not via client-side analytics.

**Detection:** Run a cookie audit tool (e.g., cookieyes.com scanner) on the live site after deployment.

**Cost impact:** Plausible at $9/month adds ~6% to the monthly burn. Umami self-hosted on Railway adds ~$5/month (separate service). Both are far cheaper than the development time for a proper cookie consent implementation.

---

## Moderate Pitfalls

### MOD-1: Removing Paywall Exposes Unblurred Data Without Sign-In Gate

**What goes wrong:** The current flow blurs AI-generated data (scores, opportunities, risks, listing URLs) after 6 lots for non-premium users. The free-first pivot intends to remove blurring for signed-in users. But if the sign-in gate is not tight, anonymous users see everything -- eliminating the incentive to create an account, which defeats the lead-generation purpose of the pivot.

**Prevention:** Implement gating in this order: (1) keep blur for anonymous users, (2) require sign-in to see beyond 6 lots, (3) remove all blur for signed-in users. The sign-in captures email for lead gen. Test that incognito/anonymous users still see the blur.

---

### MOD-2: Feature Flag Cleanup Never Happens

**What goes wrong:** `STRIPE_ENABLED`, `AUTH_ENABLED`, and other feature flags accumulate. Nobody remembers what each flag does or which combination is "production." New developers (or future-you) toggle a flag and break something unexpected because flag interactions were never documented.

**Prevention:** Document every feature flag in a single location (env var table in CLAUDE.md or a dedicated FLAGS.md). For each flag: what it controls, what depends on it, and when it should be removed. Set a calendar reminder to review flags quarterly.

---

### MOD-3: Smart Search Cache Invalidation After Model Switch

**What goes wrong:** The `smart_search_cache` table caches Gemini responses with a 1-hour TTL. When switching models, the cache serves stale results from the old model. If the new model produces better/different results, users see inconsistent quality depending on whether they hit cache.

**Prevention:** Flush `smart_search_cache` when changing models. Add the model name as part of the cache key so different models do not share cache entries.

---

### MOD-4: Firecrawl Cost Unaffected by Free Pivot -- Still Burns Credits

**What goes wrong:** Firecrawl costs ~$70/month regardless of whether users pay or not -- it is a backend scraping cost, not a per-user cost. But if the free-first pivot attracts more auction houses or more frequent scraping requests (admin enthusiasm), Firecrawl credits get consumed faster.

**Prevention:** Keep the existing Firecrawl monthly budget cap (15,000 credits). Do not increase scraping frequency just because the tool is free. Hash-based skip already saves 50-70%. Consider reducing scrape frequency from 6-hour to 12-hour cycles if budget is tight -- lots do not change that frequently.

---

### MOD-5: Landing Page Performance Kills Conversion

**What goes wrong:** Building the landing page as part of the existing `index.html` SPA means it loads the entire 79KB HTML file, initialises Supabase auth, fetches auction data, and runs all the frontend JavaScript before the user sees the hero message. First Contentful Paint > 3 seconds. Bounce rate skyrockets.

**Prevention:** Build the landing page as a separate, lightweight HTML file. No Supabase init, no auction data fetch, no SPA framework. Just HTML + CSS + a CTA button that links to `/auctions`. Target < 1 second FCP.

---

### MOD-6: Email Templates Have Known XSS Vulnerabilities

**What goes wrong:** Per CONCERNS.md, welcome emails and payment failure notifications interpolate user-supplied data (`name`, `email`) into HTML without escaping. If the free-first pivot drives more signups (the goal), more emails are sent, and the XSS surface area grows. A malicious email address could inject HTML into emails sent to admins.

**Prevention:** Fix the XSS in email templates before the free-tier launch. Use `esc()` or template literals with proper escaping for all user-supplied values in email HTML. This is a security fix that should be prioritized regardless of the pivot.

---

## Minor Pitfalls

### MIN-1: `isPremium()` Returns False for All Free-Tier Users

**What goes wrong:** The `isPremium()` function checks `window._userTier === 'premium'`. When all users become "free" tier in the database after the pivot, `isPremium()` returns false for everyone, which may trigger blur/gating on features that should now be universally accessible.

**Prevention:** After the free-first pivot, either (a) set all users to `tier: 'premium'` in the database (hacky but fast), or (b) update `isPremium()` to always return true when `STRIPE_ENABLED=false`, or (c) create a new gating function `isSignedIn()` that replaces `isPremium()` for all feature checks.

---

### MIN-2: Resend Email Costs at Scale

**What goes wrong:** Resend free tier allows 3,000 emails/month. If 500-1000 MAU sign up via magic links (1 email per sign-up + 1 welcome email = 2 emails per user), that is 1000-2000 emails/month just for auth. Add password resets and notifications, and the free tier is exceeded.

**Prevention:** Check current Resend plan. If on free tier, budget ~$20/month for Resend Pro (or switch to a cheaper transactional email service). Alternatively, reduce email volume by using longer-lived sessions so users do not need to re-authenticate frequently.

---

### MIN-3: CSP Headers Block New Analytics Script

**What goes wrong:** The existing Content-Security-Policy header allows specific domains (`cdnjs.cloudflare.com`, `fonts.googleapis.com`, `checkout.stripe.com`). Adding a new analytics service (Plausible, Umami, GA4) requires updating the CSP `script-src` and `connect-src` directives. Forgetting this means the analytics script is silently blocked by the browser.

**Prevention:** When adding any new third-party script, update the CSP header in server.js. Test in browser DevTools console for CSP violation errors.

---

### MIN-4: Git History Reveals Stripe Keys If Not Rotated

**What goes wrong:** When "hibernating" Stripe, developers sometimes commit the removal of Stripe env vars or accidentally log them. Even though the keys are in Railway env vars (not in code), the Stripe webhook secret is referenced in server.js. If someone removes the webhook route and commits the secret accidentally, it is in git history forever.

**Prevention:** Stripe keys stay in Railway env vars only. Never commit secrets. When reactivating Stripe, rotate all keys (secret key, webhook secret, price IDs) as a precaution.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|---|---|---|---|
| Stripe hibernation | CRIT-1: Orphaned subscriber state | Critical | Cancel all subs first, migration script, keep webhook alive for cancellations |
| Free-first gating | CRIT-3: Uncapped AI costs | Critical | Keep rate limits, set Google Cloud budget alerts |
| Free-first gating | MAJ-2: Stripe flag infects tier logic | Major | Map all tier checkpoints, test full user journey |
| Free-first gating | MOD-1: Anonymous users see unblurred data | Moderate | Sign-in gate before unblurring |
| AI cost optimisation | CRIT-2: Model deprecation | Critical | Monitor Google announcements, env var model names |
| AI cost optimisation | MAJ-1: Silent quality regression | Major | Golden snapshot test harness |
| AI cost optimisation | MOD-3: Stale smart search cache | Moderate | Model name in cache key |
| Analytics tracking | MAJ-5: GDPR/PECR violation | Major | Use cookie-free analytics (Plausible/Umami) |
| Analytics tracking | MIN-3: CSP blocks script | Minor | Update CSP headers |
| Landing page | MAJ-3: Route cannibalization | Major | Separate HTML file, 301 redirects |
| Landing page | MOD-5: Slow FCP from SPA loading | Moderate | Lightweight standalone HTML |
| Infrastructure scaling | CRIT-4: Supabase limits | Critical | Confirm/upgrade Supabase plan |
| Infrastructure scaling | MAJ-4: Railway OOM crashes | Major | Prune in-memory caches, consider Pro plan |
| Email at scale | MIN-2: Resend free tier exceeded | Minor | Budget for Resend Pro or switch provider |

---

## Cost Pitfall Summary

Given the $950 seed / ~$150/month burn constraint, here are the hidden costs that could erode runway:

| Cost Risk | Monthly Estimate | Trigger | Prevention |
|---|---|---|---|
| Gemini API (smart search at scale) | $18-55/month | 500-1000 MAU using free AI search | Rate limit AI features, use flash-lite exclusively |
| Supabase Pro (if currently on free) | $25/month | Production app needs 24/7 uptime | Non-negotiable -- must be on Pro for production |
| Analytics tool (Plausible) | $9/month | Needed for lender pitch | Could self-host Umami instead ($0-5/month) |
| Railway upgrade (if needed) | $15/month extra | Memory pressure from traffic growth | Only if OOM issues appear |
| Resend upgrade | $20/month | >3000 auth emails/month | Only at scale; reduce email frequency first |
| **Worst case additional burn** | **$67-124/month** | All of the above | Pushes burn to $217-274/month, halving runway |

**Safest path:** Keep Gemini rate-limited ($18/month), use self-hosted Umami ($0), stay on Railway Hobby ($5/month), defer Resend upgrade. Additional burn: ~$43-48/month. Runway: ~4 months instead of 6.

---

## Sources

- [Supabase Pricing](https://supabase.com/pricing) -- free tier: 500 MB DB, auto-pause after 7 days inactivity, 50K MAU auth
- [Railway Pricing Plans](https://docs.railway.com/pricing/plans) -- Hobby $5/month, Pro $20/month, vertical autoscaling available
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing) -- flash-lite $0.10/$0.40 per 1M tokens, Pro $1.25/$10
- [Gemini Deprecations](https://ai.google.dev/gemini-api/docs/deprecations) -- 2.0 models deprecated, 2.5 stable versions expected before June 2026
- [ICO Cookie Guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/) -- UK PECR requires consent for analytics cookies
- [ICO Storage and Access Technologies Draft Guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/) -- statistical purposes exception (limited)
- Internal: `.planning/codebase/CONCERNS.md` -- 283 catalogued bugs including security issues
- Internal: `.planning/codebase/INTEGRATIONS.md` -- full external service dependency map
- Internal: `bugs/bugs-auth-stripe.md` -- Stripe webhook handling bugs and fixes
