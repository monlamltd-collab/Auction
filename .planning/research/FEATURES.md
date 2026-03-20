# Feature Landscape: v1.2 Free-First Growth Pivot

**Domain:** UK property auction directory + AI analysis tool, pivoting from paid subscription to free-first lead generation
**Researched:** 2026-03-20
**Mode:** Ecosystem research for feature prioritisation

---

## Table Stakes

Features users expect from a free property auction aggregator. Missing any of these and the product feels broken or incomplete. Validated against PropertyAuctions.io (free, 100% open), EIG (paywalled aggregator), and Under The Hammer.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|-------------|------------|--------------|-------|
| Filterable lot directory (no paywall) | Every competitor shows listings free. PropertyAuctions.io is 100% free, no subscriptions. Gating directory data kills growth. | DONE | Already built | Core directory is already free and unblurred per tier strategy |
| Working search and filters | Users expect to filter by location, price, property type at minimum. PropertyAuctions.io has advanced location + type filters. | DONE | Already built | Existing filters work; smart AI search is the differentiator |
| Lot images and links to auction house | Users expect to see photos and click through to the original listing. No images = no trust. | DONE | Already built | 99.6% image coverage on new houses (v1.1 IMG_HELPERS) |
| Mobile-responsive design | 60%+ of UK property searches happen on mobile. Broken mobile = majority of visitors lost. | LOW | 8 known bugs include mobile issues | Deal stacking mobile bug and sign-in page overflow must be fixed |
| Clear sign-in flow | If requiring sign-in for AI features, it must work flawlessly. Broken auth = lost signups forever. | LOW | Supabase magic links exist | Sign-in page overflow bug is a blocker -- fix before launch |
| Fast page load | Property investors browse quickly. If directory takes >3s to render, bounce rate hits 50%+. | LOW | Existing architecture | Monitor Railway performance under free-tier traffic volume |
| Landing page explaining what this is | First-time visitors need to understand value in <5 seconds. Without a landing page, they land on raw directory and bounce. | MED | New build, `welcome.html` exists as skeleton | Highest-impact new feature for v1.2 |

## Differentiators

Features that set Bridgematch apart from PropertyAuctions.io, DealSheet AI, and Brickflow. These are the reasons an investor would choose this tool over alternatives.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| "50% aren't on Rightmove" USP | Validated claim (EIG Property Auctions confirms: "over 50% of properties never make it to Rightmove"). No competitor leads with this message. Investors using Rightmove alone miss half the market. | LOW (copy) | Landing page | Hero message. Must be prominent, not buried. |
| AI investment scoring (20+ signals) | No free competitor scores lots for investment potential. PropertyAuctions.io shows listings but no analysis. DealSheet AI charges GBP 4.99/week. Giving this free is a genuine differentiator. | DONE | Already built | Currently blurred for non-premium. v1.2 makes it free with sign-in gate. |
| BridgeMatch Lite lender matching | "How many lenders would fund this deal?" is uniquely valuable. Brickflow offers similar but requires broker involvement. No other free tool combines auction data + bridging finance matching. | DONE | Already built | Lender names stay masked (generates lead value). Funnel tracking needed. |
| Deal stacking calculator | Full deal economics: SDLT + bridging costs + refurb + flip/hold scenarios with lender-matched rates. DealSheet AI charges for this. Free behind sign-in is compelling. | DONE | Needs mobile bug fix | Premium in v1.1, becomes free-with-signin in v1.2 |
| 36+ auction houses in one view | More houses than most aggregators index. AI extraction means structured, enriched data. | DONE | Already built | Scraping reliability pass should verify all extractors |
| EPC + flood risk enrichment | Free enrichment data investors would otherwise look up manually. No other auction aggregator shows this inline. | DONE | Already built | EPC via MHCLG, flood via EA. Both free APIs, 30-day cache. |
| Natural language search | "3-bed houses under 100k in the North West needing refurb" -- no other free auction tool does this. | DONE | Already built | Currently tiered (anon: 3, free: 10/day). v1.2: free-with-signin. |

## Anti-Features

Features to explicitly NOT build in v1.2. Each has a clear reason.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Email alerts / notifications | Increases complexity and ongoing cost. Deferred to v1.3 per PROJECT.md. Focus v1.2 on sign-up funnel, not retention. | Capture email at sign-in (already done via Supabase). Build alerts later when you have users to retain. |
| Blog / SEO content | Content marketing is a long game. v1.2 needs quick wins. Deferred to v1.3. | Landing page with strong USP copy is the v1.2 SEO play. Individual lot pages (v1.3) drive organic traffic. |
| Individual lot pages with SEO URLs | High SEO value but significant engineering (new routes, OG tags, structured data per lot). Deferred to v1.3. | Directory view sufficient for v1.2. These pages become the biggest SEO lever in v1.3. |
| Payment / premium tier | The entire v1.2 strategy is free-first. Do not build new payment features. | Feature flag STRIPE_ENABLED=false. All Stripe code preserved, dormant. Reactivate when needed. |
| User dashboard / saved searches | Adds complexity. v1.2 goal is raw signup numbers, not engagement features. | Track what users search (analytics) to understand demand. Build in v1.3+ if data supports it. |
| Automated calendar scraping | Partially exists but full automation deferred. Manual management fine for 36 houses. | Keep existing admin calendar + discovery flow. Automate when house count justifies it. |
| Social login (Google, Facebook) | OAuth complexity. Magic links are simpler and guarantee email capture. | Stick with Supabase magic links. Good conversion rates, direct email capture. |
| Naming Rightmove/Zoopla as competitors | Legally risky (trademark), antagonistic tone. | Frame as "50% of auction houses aren't on major property portals" -- positive framing about completeness, not attack. |
| Third-party feature flag service | PostHog flags, LaunchDarkly, etc. are overkill for one flag. Adds dependency and complexity. | Single env var: STRIPE_ENABLED. That is the feature flag system. |
| A/B testing framework | Overkill for <1,000 MAU, adds complexity for negligible statistical significance. | Ship one landing page, iterate manually based on analytics. |
| Session replay tools | Privacy-invasive, unnecessary at this scale, GDPR complexity. | Page-level analytics are sufficient for v1.2. |

---

## New Features for v1.2 (Ordered by Impact)

### 1. Landing Page with USP Hero

**Impact:** HIGH -- every visitor sees this first. Without it, first-time visitors bounce from the raw directory.
**Complexity:** MEDIUM
**Dependencies:** None (new page, `welcome.html` skeleton exists)

**What good looks like:**
- Hero section: "50% of auction houses aren't on Rightmove. We show them all." (validated claim per EIG)
- 3-4 benefit bullets: AI scoring, lender matching, deal stacking -- all free
- Single primary CTA: "Browse Auctions Free" (not "Sign Up" -- reduce friction, show value first)
- Social proof: lot count, house count, "updated daily" (e.g., "2,364 lots from 36 auction houses")
- How it works: 3 steps (Browse -> Analyse -> Fund)
- Secondary CTA lower down: "Sign in for AI features" (after they see value)
- NO video, NO animation -- fast load, clear copy, single purpose

**Conversion benchmarks (research-validated):**
- Real estate landing pages: 2.6% median, 7.4% mean (First Page Sage 2026)
- Free tool with no payment barrier should target 8-12% visitor-to-signup
- Interactive tools significantly boost conversion -- the directory itself IS the interactive element
- SaaS median is 3.8%; free tools outperform this because no payment friction

**What property investors respond to (research-validated):**
- ROI metrics front and centre (yield, scores, opportunities)
- Immediate utility, not promises -- show real lot data on the landing page
- Low friction sign-up (magic link = no password)
- Social proof via data volume ("36 auction houses, 2000+ lots") more compelling than testimonials at this stage

### 2. Feature Flag System (Stripe Hibernation)

**Impact:** HIGH -- prerequisite for free-first model
**Complexity:** LOW
**Dependencies:** None

**Implementation:**
- Single env var: `STRIPE_ENABLED=false`
- Wrap all Stripe-related UI, routes, and webhook handlers in conditional checks
- When false: hide pricing, trial banners, upgrade CTAs, payment pages, Stripe webhook processing
- When true: everything works exactly as before (no code deleted)
- Do NOT use a feature flag service. One env var is sufficient.
- Best practice per research: wrap third-party integrations in kill switches. This is exactly that pattern.

### 3. Free-First Gating Restructure

**Impact:** HIGH -- the core model change
**Complexity:** MEDIUM
**Dependencies:** Feature flag system (must hibernate Stripe first to avoid conflicting tier logic)

**New tier model:**
- **Anonymous:** Full directory access + limited AI search (3 queries, existing behaviour)
- **Signed-in (free):** Unlimited AI search, investment scores visible, deal stacking, BridgeMatch Lite
- **Premium:** Does not exist while STRIPE_ENABLED=false

**UX pattern:**
- Sign-in prompt appears when user attempts an AI feature, not as a blocking wall
- "Sign in to unlock" messaging (not "Subscribe" or "Upgrade")
- After sign-in, user returns to exactly where they were (no redirect to dashboard)
- Magic link flow: enter email -> check inbox -> click link -> back in tool

**Key insight:** Freemium conversion is dramatically higher when the free tier is genuinely useful. The directory being fully free with NO sign-in requirement is critical -- it builds trust. Gate only the AI features that have compute cost.

### 4. Bug Fixes (8 Known Issues)

**Impact:** MEDIUM-HIGH -- bugs in sign-in and mobile directly hurt conversion
**Complexity:** LOW-MEDIUM (8 discrete fixes)
**Dependencies:** None (can parallel with everything)

**Priority order (by impact on conversion):**
1. **Sign-in page overflow** -- BLOCKER: breaks the signup flow, the single most important funnel step
2. **Deal stacking mobile layout** -- breaks the key differentiator feature on majority device type
3. **Heavy refurb blank page** -- breaks user flow for a common lot type
4. **Score sort within tiers** -- confusing UX, investors expect score-sorted results
5. **Empty state messaging** -- confusing for new users who see no results
6. **Search trim/debounce** -- minor UX friction
7. **Negative page guard** -- edge case
8. **CSV client-only gate** -- minor, low priority

### 5. Analytics Tracking

**Impact:** MEDIUM-HIGH -- cannot pitch lenders without MAU and funnel data
**Complexity:** MEDIUM
**Dependencies:** Sign-in flow working (need to track authenticated users)

**What to track (for lender pitch):**
- **MAU** (monthly active users) -- the headline metric for lender sponsorship conversations
- **Sign-in conversion rate** (visitor -> signed-in user)
- **BridgeMatch Lite funnel** (lot viewed -> BridgeMatch clicked -> result seen -> "speak to broker" clicked)
- **Feature engagement** (AI search usage, deal stacking usage, score views per session)
- **Lot click-through rate** (users clicking through to auction house website)
- **Retention** (users returning within 7 days, 30 days)

**Tool recommendation: Custom Supabase tracking.**

Rationale: You already have Supabase. A `user_events` table with (timestamp, user_id, event_type, metadata_jsonb) is:
- Zero additional cost (within Supabase free tier)
- No cookie consent required (first-party, no third-party tracking)
- No additional dependency to manage
- Queryable with SQL for the lender pitch deck
- Simpler than integrating any third-party analytics SDK

PostHog (1M free events/month) is the fallback if you need pre-built dashboards or funnels. But for 500-1000 MAU, a Supabase table + a few SQL queries is sufficient and cheaper.

**Alternative considered: Umami.** Lightweight, privacy-friendly, self-hostable. Good for page-level analytics (MAU, page views). But lacks product analytics (funnel tracking, feature engagement). Supabase custom events cover both web analytics and product analytics in one place.

**If using Supabase tracking, add a simple admin view** showing:
- MAU count (distinct user_ids in last 30 days)
- Sign-in conversion (events where type = 'page_view' vs 'sign_in')
- BridgeMatch funnel counts
- Top searched terms (from AI search events)

### 6. AI Cost Optimisation

**Impact:** MEDIUM -- runway preservation, not user-facing
**Complexity:** LOW-MEDIUM
**Dependencies:** None

**Actions:**
1. Audit actual Gemini spend since Tier 1 upgrade -- what is monthly cost?
2. Model cost at 500 MAU and 1000 MAU with free AI search
3. Gemini 2.0 Flash is already primary for extraction -- this is the right choice
4. For AI search queries (user-facing), evaluate if Gemini 1.5 Flash is sufficient (cheaper, faster)
5. Cache AI search results aggressively (same query = same results within cache window)
6. If Gemini costs are <GBP 10/month at 1000 MAU, further optimisation is unnecessary
7. If >GBP 30/month, consider rate-limiting free users (e.g., 20 AI searches/day instead of unlimited)

**Cost modelling assumptions:**
- AI search: ~0.001-0.003 per query (Gemini Flash pricing)
- At 1000 MAU with 5 searches/user/month = 5000 queries = GBP 5-15/month
- Extraction pipeline costs are fixed regardless of user count (scraping runs on schedule)
- The real cost risk is not AI queries but Firecrawl credits if scraping frequency increases

### 7. Scraping Reliability

**Impact:** MEDIUM -- data quality underpins everything, stale/broken data destroys trust
**Complexity:** MEDIUM (ongoing maintenance, not one-time)
**Dependencies:** None

**Actions:**
- Verify all 36 DOM extractors against live auction catalogues
- Fix any broken extractors (auction houses redesign without warning)
- Monitor image coverage (target >90% across all houses)
- Ensure auto-analyse pipeline is running reliably on 6-hour cycle
- This is maintenance work, not a feature -- but essential for credibility

### 8. Admin Dashboard Usability

**Impact:** LOW (internal only, not user-facing)
**Complexity:** LOW-MEDIUM
**Dependencies:** None

**Focus areas:**
- Calendar management workflow (adding/updating auction URLs)
- Extractor health at a glance (which houses are broken right now?)
- Pipeline freshness visibility (when did each house last successfully update?)
- Analytics summary view (if building Supabase tracking, add MAU/funnel counts here)

---

## Feature Dependencies

```
Landing Page (standalone, no deps)
    |
Feature Flag System (env var, no deps)
    |
    v
Free-First Gating (requires feature flags to hide Stripe UI)
    |
    v
Analytics Tracking (requires sign-in flow to track authenticated users)
    |
    v
Lender Pitch Deck (requires analytics data -- out of v1.2 scope but the end goal)

Bug Fixes -----------> independent, can parallel with anything
AI Cost Optimisation -> independent, can run anytime
Admin Dashboard -----> independent, lowest priority
Scraping Reliability -> independent, ongoing
```

## MVP Recommendation

**Phase 1 (Week 1-2): Foundation**
1. Feature flag system (Stripe hibernation) -- prerequisite for free-first, unblocks everything
2. Bug fixes -- prioritise sign-in overflow and mobile issues (quality before growth)
3. Free-first gating restructure -- the core model change

**Phase 2 (Week 2-3): Growth Lever**
4. Landing page with USP hero -- the acquisition driver
5. Analytics tracking via Supabase -- start measuring immediately after landing page ships

**Phase 3 (Ongoing): Optimisation**
6. AI cost optimisation -- audit and model costs at scale
7. Scraping reliability -- verify all extractors
8. Admin dashboard usability -- internal efficiency

**Defer to v1.3:**
- Email alerts (retention mechanism)
- Blog/SEO content (organic growth channel)
- Individual lot pages with SEO URLs (biggest organic lever)
- Saved searches / user dashboard (engagement features)
- Unsold lot tracking (high-value differentiator but needs new scraping logic)

---

## Competitive Landscape (v1.2 Context)

| Competitor | Free? | Auction Data | AI Analysis | Finance Matching | Key Weakness |
|-----------|-------|-------------|-------------|-----------------|-------------|
| PropertyAuctions.io | Yes, 100% free | All UK auctioneers | No | No | No analysis, just listings |
| DealSheet AI | No (GBP 4.99/week) | Accepts URLs for analysis | Yes (7 strategies) | No | Paid. No directory. One deal at a time. |
| Brickflow | Free to model | No auction directory | No scoring | Yes (80+ lenders, broker-gated) | No auction aggregation. Expanding into auction house integrations (Oct 2024 announcement). |
| EIG | Paywalled | 850K+ historical lots | No | No | Expensive, dated UX |
| Rightmove/Zoopla | Yes | ~50% of auction houses | No | No | Missing half the market |
| **Bridgematch v1.2** | **Yes (sign-in for AI)** | **36+ houses, AI-extracted** | **Yes (20+ signals, free)** | **Yes (BridgeMatch Lite, free)** | **New, unproven, needs traffic** |

**The competitive gap:** Nobody else combines free auction aggregation + AI investment scoring + bridging finance matching. The "50% not on Rightmove" message is externally validated and unique to aggregators who cover independent auction houses.

**Competitive threat to watch:** Brickflow announced auction house integration partnerships in October 2024. They have funding (Crunchbase), 80+ lenders, and are moving into the auction space. Bridgematch's window of advantage is NOW -- get users before Brickflow closes the gap.

---

## Conversion Strategy for Property Investors

**What makes property investors sign up (research-validated):**

1. **ROI metrics visible before sign-in** -- show yield estimates, opportunity flags, and score badges in the free directory. Investors prioritise returns; seeing "8.2% yield, score 7.5, development potential" on a lot card is more compelling than any marketing copy.

2. **The directory IS the lead magnet** -- no need for a separate PDF download, "free guide", or email course. The product itself demonstrates value. Landing page should funnel visitors INTO the directory, not away from it.

3. **Low-friction authentication** -- magic link (no password) is ideal for property investors who are busy professionals. "Sign in with email" is the lowest barrier. Research confirms: every additional form field reduces conversion by ~10%.

4. **Social proof through data volume** -- "2,364 lots from 36 auction houses, updated daily" is more credible than "trusted by thousands of investors" (which you cannot yet claim). Use data you actually have.

5. **Interactive tool as conversion driver** -- research shows interactive tools significantly boost landing page conversion. The directory IS the interactive tool. The landing page's job is to get people into it.

**Target conversion benchmarks:**

| Funnel Step | Target Rate | Basis |
|-------------|------------|-------|
| Landing page -> directory browser | 40-60% | Strong USP, single CTA, free access |
| Directory browser -> sign-in | 8-12% | Free tool, low friction, clear AI value |
| Signed-in -> BridgeMatch Lite user | 15-25% | Natural next step after seeing scores |
| Overall visitor -> signed-in user | 5-8% | Above 3.8% SaaS median (no payment) |
| BridgeMatch user -> "speak to broker" | 3-5% | This is the monetisable lead |

At 500 MAU with 5% BridgeMatch-to-broker conversion = ~25 qualified bridging finance leads/month. At GBP 200-300 per lead (industry rate per LeadCrowd, The Lead Engine), that is GBP 5,000-7,500/month in lead value -- far exceeding the GBP 150/month running cost.

---

## Sources

- [EIG Property Auctions - Why Rightmove isn't the best way to search auctions](https://www.eigpropertyauctions.co.uk/news/blog/why-zoopla-and-rightmove-best-way-search-property) -- validates "50% not on Rightmove" claim (MEDIUM confidence)
- [PropertyAuctions.io](https://propertyauctions.io/) -- primary free competitor, feature baseline
- [DealSheet AI](https://dealsheetai.com/) -- AI analysis competitor, GBP 4.99/week pricing confirmed
- [Brickflow - Auction Finance](https://brickflow.com/bridging-finance/auction-finance) -- finance matching competitor, expanding auction house integrations
- [Brickflow expands with auction house integration (Mortgage Solutions, Oct 2024)](https://www.mortgagesolutions.co.uk/specialist-lending/bridging/2024/10/03/brickflow-expands-footprint-with-auction-house-integration/) -- Brickflow entering auction space
- [First Page Sage - Landing Page Conversion Rates by Industry 2026](https://firstpagesage.com/seo-blog/landing-page-conversion-rates-by-industry/) -- real estate: 2.6% median, 7.4% mean
- [First Page Sage - Average SaaS Conversion Rates 2026](https://firstpagesage.com/seo-blog/average-saas-conversion-rates/) -- SaaS median 3.8%
- [F3 Fund It - Solopreneur Analytics Stack 2026](https://f3fundit.com/the-solopreneur-analytics-stack-2026-posthog-vs-plausible-vs-fathom-analytics-and-why-you-should-ditch-google-analytics/) -- PostHog 1M free events, Plausible 500 MAU free
- [Flagsmith - Feature Flags Best Practices](https://www.flagsmith.com/blog/feature-flags-best-practices) -- kill switch pattern for third-party integrations
- [Stripe - Freemium Pricing Explained](https://stripe.com/resources/more/freemium-pricing-explained) -- freemium conversion best practices
- [LeadCrowd - Bridging Finance Leads](https://www.leadcrowd.com/lead-types/financial-services/auction-bridging-development-loan/) -- lead pricing benchmarks
- [The Lead Engine - Bridging Loan Leads](https://theleadengine.co.uk/bridging-loan-leads/) -- UK bridging lead generation market
