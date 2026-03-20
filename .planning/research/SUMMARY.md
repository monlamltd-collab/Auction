# Project Research Summary

**Project:** Bridgematch Auction Tool v1.2 -- Free-First Growth Pivot
**Domain:** UK property auction directory + AI analysis, pivoting from paid subscription to free-first lead generation
**Researched:** 2026-03-20
**Confidence:** HIGH

## Executive Summary

Bridgematch v1.2 is a strategic pivot from a paid subscription model to a free-first lead generation model for an existing, production-quality UK property auction aggregator. The codebase is mature (11K-line Express monolith with Supabase, Gemini AI, and Firecrawl), with most v1.2 features already built -- the work is primarily about removing paywalls, adding measurement, and creating an acquisition funnel. Research across all four domains converges on a clear conclusion: this pivot adds zero new monthly cost if executed correctly, and the primary risks are operational (orphaned Stripe state, uncapped AI costs, Supabase storage limits) rather than technical.

The recommended approach is surgical modification of the existing monolith, not a rebuild. A centralised `resolveEffectiveTier()` function replaces ~10 scattered tier checks, making all signed-in users "premium" when Stripe is hibernated. Analytics should use the existing `logActivityEvent()` infrastructure already in Supabase (server-side product analytics), supplemented by Umami Cloud for cookie-free page-level web metrics (visitor-level data the server cannot capture). The landing page rewrites the existing `welcome.html` with the validated "50% of auction houses aren't on Rightmove" USP. AI costs remain at zero on the Gemini free tier, though rate limits must be preserved even for free users to prevent budget blowout at scale.

The key risks are: (1) Stripe hibernation creating orphaned subscriber state if active subscriptions are not cancelled first, (2) removing AI rate limits without cost caps could burn through budget on a viral day, (3) Supabase free tier storage limits becoming dangerous under growth, and (4) Gemini model deprecation breaking the extraction pipeline. All four have concrete prevention strategies. The competitive window is narrow -- Brickflow is entering the auction space with real funding -- so speed of execution matters more than perfection.

## Key Findings

### Recommended Stack

v1.2 adds zero new dependencies and zero additional monthly cost. The existing stack (Express, Supabase, Gemini, Firecrawl, vanilla JS) is validated and unchanged. See [STACK.md](STACK.md) for full analysis.

**Core technologies (no changes):**
- **Gemini 2.5 Flash-Lite (free tier):** AI extraction and smart search -- 1,000 RPD free tier covers 36 auction houses comfortably. Actual daily calls ~130-215 after hash-based skip. Cost: GBP 0.00/month.
- **Umami Cloud (free tier):** Cookie-free page-level analytics -- 100K events/month covers well beyond 1,000 MAU. No consent banner needed. GDPR compliant. Cost: GBP 0.00/month.
- **Environment variables:** Feature flag system for Stripe hibernation -- one env var (`STRIPE_ENABLED=false`), no library needed.
- **Vanilla HTML/CSS:** Landing page -- no framework, no build step, no new dependencies.

**Researcher conflict resolved -- Analytics (Umami vs Supabase):**

STACK.md recommends Umami Cloud. FEATURES.md recommends custom Supabase tracking. ARCHITECTURE.md recommends wiring up the existing `logActivityEvent()`. The correct answer is both, for different purposes:

- **Supabase `activity_events` (server-side):** Product analytics -- signup funnels, AI search usage, BridgeMatch leads, cost tracking. Already exists. Cannot be blocked by ad blockers. This is the primary analytics system and the one that feeds the lender pitch deck.
- **Umami Cloud (client-side):** Page-level web analytics -- MAU counting, referral sources, landing page bounce rate, device breakdown. Supplements Supabase with visitor-level data that server-side tracking cannot capture (anonymous page views before any API call). Free, cookie-free, one script tag.

Do NOT use Umami as the only analytics tool (it lacks product-level funnel data). Do NOT use Supabase as the only analytics tool (it misses anonymous visitors who never hit an API endpoint). Use both. Total cost: GBP 0.00/month.

### Expected Features

See [FEATURES.md](FEATURES.md) for full competitive analysis and conversion benchmarks.

**Must have (table stakes -- mostly already built):**
- Filterable lot directory with no paywall (DONE)
- Working search and filters (DONE)
- Lot images and auction house links (DONE, 99.6% image coverage)
- Mobile-responsive design (needs 2 bug fixes: sign-in overflow, deal stacking mobile)
- Clear sign-in flow (sign-in page overflow is a BLOCKER)
- Fast page load (monitor under free-tier traffic volume)
- Landing page explaining the value proposition (NEW, highest-impact new build)

**Should have (differentiators -- all already built, just need ungating):**
- "50% aren't on Rightmove" USP (landing page copy)
- AI investment scoring, 20+ signals (unblur for signed-in users)
- BridgeMatch Lite lender matching (unblur, track funnel)
- Deal stacking calculator (unblur, fix mobile bug)
- 36+ auction houses in one view (verify all extractors)
- EPC + flood risk enrichment (already free)
- Natural language AI search (remove daily limit for signed-in users, keep rate limit)

**Defer to v1.3+:**
- Email alerts / notifications
- Blog / SEO content pages
- Individual lot pages with SEO URLs (biggest organic lever, save for v1.3)
- User dashboard / saved searches
- Social login
- A/B testing

### Architecture Approach

All changes are modifications to the existing Express monolith or small new modules (~100 lines total new code). No structural split. The key architectural insight is that `resolveEffectiveTier()` centralises all tier logic into one function, and 4 of 10 client-side tier checks need no changes because the server already drives the client via `/api/auth/me` -> `window._userTier`. See [ARCHITECTURE.md](ARCHITECTURE.md) for exhaustive code location mapping.

**Major components:**
1. **`lib/feature-flags.js` (NEW, ~20 lines)** -- Reads `STRIPE_ENABLED` from env, imported at startup
2. **`resolveEffectiveTier()` (NEW function in server.js)** -- Single source of truth: when Stripe is off, all signed-in users = premium
3. **`logActivityEvent()` (EXISTING, wire up)** -- Server-side analytics at ~7 API endpoints, fire-and-forget
4. **`lib/ai-provider.js` (NEW, ~80 lines)** -- Wraps `callGemini()` with role-based model selection and token usage logging
5. **`welcome.html` (REWRITE)** -- Landing page with free-first USP, served at `/`
6. **`saveDailySnapshot()` (EXISTING, enhance)** -- Add DAU/signups/searches/leads columns to `analytics_snapshots`

### Critical Pitfalls

See [PITFALLS.md](PITFALLS.md) for all 17 identified pitfalls with prevention strategies.

1. **Stripe hibernation breaks active subscribers (CRIT-1)** -- Cancel all active Stripe subscriptions manually BEFORE setting `STRIPE_ENABLED=false`. Run migration to reset tiers. Keep webhook alive for cancellation confirmations only. Forgetting this means Stripe keeps billing users while the app ignores their webhooks.

2. **Uncapped AI costs under free-tier traffic (CRIT-3)** -- "Free" does not mean "unlimited." Keep rate limits on AI features (10 smart searches/day per signed-in user is generous). Set a hard Gemini API budget cap in Google Cloud Console. Without this, a viral day could burn a month's budget.

3. **Supabase storage limits under growth (CRIT-4)** -- Confirm Supabase plan. If on free tier (500 MB, auto-pause), upgrade to Pro ($25/month) is non-negotiable for production. Implement `rate_limits` table pruning (rows accumulate forever with no cleanup).

4. **Gemini model deprecation (CRIT-2)** -- Models deprecated with ~3 months notice. Make model names env vars (not constants). Create extraction test harness with golden snapshots. Monitor Google AI announcements.

5. **Feature flag infects tier logic (MAJ-2)** -- The Stripe flag is not a simple on/off; tier logic is a state machine touching auth, UI, rate limits, and data access. Must map every tier checkpoint (10 locations identified) and test the full user journey end-to-end.

## Implications for Roadmap

Based on combined research, four phases are recommended. All three researchers (FEATURES, ARCHITECTURE, PITFALLS) independently converged on the same ordering, which is a strong signal.

### Phase 1: Foundation -- Feature Flags + Free-First Gating + Bug Fixes

**Rationale:** Everything else depends on the free-first tier model being correct. Landing page CTAs say "sign in free" (requires tier change). Analytics measure free-first engagement (requires tier change). AI cost decisions assume free access volume (requires tier change). Bug fixes to sign-in and mobile are blockers for conversion.

**Delivers:**
- `STRIPE_ENABLED=false` with all 5 Stripe endpoints guarded
- `resolveEffectiveTier()` replacing ~6 inline tier checks
- `lib/feature-flags.js` module
- Sign-in page overflow fix (BLOCKER)
- Deal stacking mobile layout fix
- Heavy refurb blank page fix
- Updated paywall text: "Sign in for free" not "Upgrade"

**Addresses features:** Feature flag system, free-first gating restructure, top 3 bug fixes
**Avoids pitfalls:** CRIT-1 (Stripe orphaned state), MAJ-2 (flag infects tier logic), MOD-1 (anonymous sees unblurred data)

**Pre-requisite action (before any code):** Cancel all active Stripe subscriptions via dashboard. Run tier reset migration. This is CRIT-1 prevention and must happen first.

### Phase 2: Measurement -- Analytics Infrastructure

**Rationale:** Must be measuring before the landing page ships. Cannot pitch lenders without MAU and funnel data. Analytics infrastructure (Supabase `logActivityEvent`) is already built -- just needs wiring up. Low risk, purely additive.

**Delivers:**
- ~7 `logActivityEvent()` calls at key API endpoints (signup, search, analyse, lead_submit, page_view)
- Enhanced `saveDailySnapshot()` with DAU/signups/searches/leads columns
- Umami Cloud script tag on all pages (MAU + referral tracking)
- CSP header update to allow Umami domain
- Admin dashboard showing MAU count and funnel metrics

**Addresses features:** Analytics tracking (both Supabase and Umami)
**Avoids pitfalls:** MAJ-5 (GDPR violation -- Umami is cookie-free), MIN-3 (CSP blocks script)

### Phase 3: AI Hardening -- Provider Abstraction + Cost Tracking

**Rationale:** Prerequisite for model evaluation and cost monitoring. Benefits from analytics infrastructure (Phase 2) for cost data logging. No user-facing changes -- pure backend hardening.

**Delivers:**
- `lib/ai-provider.js` wrapping `callGemini()` with role-based model selection
- Token usage logging per AI call via `logActivityEvent('ai_call', ...)`
- Model names as env vars (`AI_MODEL_FLASH`, `AI_MODEL_PRO`)
- Daily cost dashboard in admin view
- Golden snapshot test harness for extraction quality validation

**Addresses features:** AI cost optimisation, scraping reliability verification
**Avoids pitfalls:** CRIT-2 (model deprecation), MAJ-1 (silent quality regression), MOD-3 (stale cache after model switch)

### Phase 4: Acquisition -- Landing Page

**Rationale:** Depends on correct CTAs (Phase 1) and analytics (Phase 2) to measure from day one. Can be designed in parallel with Phases 2-3, deployed last. Low technical risk -- static HTML rewrite.

**Delivers:**
- Rewritten `welcome.html` with "50% aren't on Rightmove" hero
- Root route `/` serves landing page, `/auctions` serves directory
- Live lot count and house count as social proof
- "Browse Auctions Free" primary CTA, "Sign in for AI features" secondary CTA
- OG meta tags, JSON-LD schema, robots.txt
- Target: Lighthouse Performance > 90, FCP < 1 second

**Addresses features:** Landing page with USP hero, conversion funnel entry point
**Avoids pitfalls:** MAJ-3 (route cannibalization), MOD-5 (slow FCP from SPA loading)

### Phase Ordering Rationale

- Phase 1 first because it is the dependency root. Every other phase assumes free-first gating is settled. Three independent researchers placed it first.
- Phase 2 before Phase 4 because shipping a landing page without analytics means losing the first (most valuable) cohort of data. "Measure, then market."
- Phase 3 can overlap with Phase 4 -- AI hardening is backend-only and landing page is frontend-only. No conflicts.
- Bug fixes in Phase 1 (not separate) because sign-in overflow directly blocks the conversion funnel. Fixing it alongside the tier change is more efficient than a separate pass.
- This ordering avoids the biggest pitfall cascade: Launching the landing page before fixing tier logic (Phase 1) would drive traffic to a broken paywall. Launching without analytics (Phase 2) wastes the initial traffic spike.

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 1 (Foundation):** Needs careful code audit. 10 tier check locations identified, but the sign-in flow and session management may have edge cases. Recommend `/gsd:research-phase` to map the complete auth flow including cross-tab sync, magic link redirect, and tier propagation timing.
- **Phase 3 (AI Hardening):** Model migration and golden snapshot testing is well-researched, but the actual extraction quality comparison between models needs empirical testing, not more research.

**Phases with standard patterns (skip research-phase):**
- **Phase 2 (Analytics):** Wiring up an existing logging function at API endpoints is mechanical. Umami is a script tag. No research needed.
- **Phase 4 (Landing Page):** HTML/CSS rewrite with known content. Conversion benchmarks already researched. No technical unknowns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official pricing pages verified, existing codebase inspected, all costs confirmed at GBP 0.00/month. Gemini free tier limits validated against actual daily call volume. |
| Features | HIGH | Competitor analysis covers PropertyAuctions.io, DealSheet AI, Brickflow, EIG. Conversion benchmarks from First Page Sage 2026. "50% not on Rightmove" claim validated via EIG. |
| Architecture | HIGH | All findings from direct codebase inspection. Every code location referenced by line number. Tier check inventory is exhaustive (10 locations). |
| Pitfalls | HIGH | 17 pitfalls identified across 3 severity levels. Critical pitfalls have concrete prevention steps. Cost modelling covers worst-case scenarios ($67-124/month additional burn). |

**Overall confidence:** HIGH -- This is an unusually well-researched pivot because the codebase is mature, the domain is well-understood, and the changes are modifications to existing code rather than greenfield development.

### Gaps to Address

- **Supabase plan tier unknown:** CRIT-4 flags this. If on free tier, $25/month upgrade is non-negotiable. Must verify before Phase 1.
- **Active Stripe subscriber count unknown:** CRIT-1 requires cancelling all active subscriptions. Need to check Stripe dashboard for actual subscriber count before starting.
- **Resend email plan and volume:** At 500-1000 MAU with magic link auth, email volume may exceed Resend free tier (3,000/month). Need to check current plan and project volume.
- **`rate_limits` table size:** Identified as growing unbounded. Need to check current row count to assess urgency of cleanup.
- **Railway memory baseline:** Need to check current memory usage to determine if traffic growth requires plan upgrade ($5 -> $20/month).
- **Extraction quality at Flash-Lite:** Stack research says Flash-Lite is sufficient. This should be validated empirically by comparing extraction output against a few known-good results before relying on it at scale.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: server.js, index.html, welcome.html, admin.html (all line numbers verified)
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing) -- model costs and free tier limits
- [Gemini Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits) -- RPM/RPD limits per model
- [Umami](https://umami.is/) -- analytics features, free tier (100K events/month)
- [Supabase Pricing](https://supabase.com/pricing) -- free tier limits (500 MB, auto-pause)
- [Railway Pricing](https://docs.railway.com/pricing/plans) -- Hobby $5/month, Pro $20/month
- PROJECT.md, CLAUDE.md, CONCERNS.md -- internal project documentation

### Secondary (MEDIUM confidence)
- [EIG Property Auctions](https://www.eigpropertyauctions.co.uk/news/blog/why-zoopla-and-rightmove-best-way-search-property) -- "50% not on Rightmove" claim validation
- [First Page Sage - Landing Page Conversion Rates 2026](https://firstpagesage.com/seo-blog/landing-page-conversion-rates-by-industry/) -- real estate: 2.6% median, 7.4% mean
- [Brickflow - Auction Finance](https://brickflow.com/bridging-finance/auction-finance) -- competitor entering auction space
- [ICO Cookie Guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/) -- UK PECR analytics cookie requirements
- [LeadCrowd](https://www.leadcrowd.com/lead-types/financial-services/auction-bridging-development-loan/) -- bridging finance lead pricing (GBP 200-300/lead)

### Tertiary (LOW confidence)
- Gemini 3.x model timeline -- expected but not confirmed
- Brickflow auction integration timeline -- announced Oct 2024, unclear current status
- DeepSeek V3.2 reliability -- reported outages, not independently verified

---
*Research completed: 2026-03-20*
*Ready for roadmap: yes*
