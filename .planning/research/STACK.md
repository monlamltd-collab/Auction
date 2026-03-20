# Stack Research: v1.2 New Capabilities

**Domain:** AI cost optimisation, analytics tracking, feature flags, landing page
**Researched:** 2026-03-20
**Confidence:** HIGH (official pricing pages verified, existing codebase inspected)

This document covers ONLY what needs to change or be added for v1.2. The existing stack (Express, Firecrawl, Supabase, Stripe, vanilla JS) is validated and not re-researched.

---

## 1. AI Cost Optimisation

### Current State

The codebase already uses `gemini-2.5-flash-lite` (MODEL_FLASH) for known houses and `gemini-2.5-pro` (MODEL_PRO) for unknown/PDF extraction. The `@google/generative-ai` SDK is at v0.24.1. The Gemini 2.0 Flash model referenced in CLAUDE.md has already been migrated away from in the actual code.

**Critical deprecation:** Gemini 2.0 Flash shuts down June 1, 2026. The codebase is already on 2.5 models, so no migration is needed.

### AI Model Cost Comparison (March 2026)

All prices are per 1 million tokens. The use case is structured JSON extraction from HTML/markdown property catalogue pages.

| Model | Input $/1M | Output $/1M | Free Tier | JSON Output | Confidence |
|-------|-----------|------------|-----------|-------------|------------|
| **Gemini 2.5 Flash-Lite** | $0.10 | $0.40 | Yes (15 RPM, 1000 RPD) | Yes (native) | HIGH |
| Gemini 2.5 Flash | $0.30 | $2.50 | Yes (10 RPM, 250 RPD) | Yes (native) | HIGH |
| Gemini 2.5 Pro | $1.25 | $10.00 | Yes (5 RPM, 100 RPD) | Yes (native) | HIGH |
| Groq Llama 3.1 8B | $0.05 | $0.08 | No free tier | JSON mode | HIGH |
| Groq Llama 3.1 70B | $0.59 | $0.79 | No free tier | JSON mode | HIGH |
| DeepSeek V3.2 | $0.28 | $0.42 | 5M tokens signup bonus | JSON mode | MEDIUM |
| DeepSeek V3.2 (cache hit) | $0.028 | $0.42 | 5M tokens signup bonus | JSON mode | MEDIUM |
| Mistral Nemo | $0.02 | $0.02 | No free tier | JSON mode | MEDIUM |
| Mistral Medium 3 | $0.40 | $2.00 | No free tier | JSON mode | MEDIUM |
| Grok 4.1 Fast | $0.20 | $0.50 | $25 signup + $150/mo data sharing | JSON mode | MEDIUM |

### Recommendation: Stay on Gemini 2.5 Flash-Lite (No Change)

**Why:** Gemini 2.5 Flash-Lite on the free tier is unbeatable for this use case.

**The math:**
- ~36 auction houses, each averaging ~3 catalogue pages = ~108 Gemini calls per analysis cycle
- 6-hour cycle = 4 cycles/day = ~432 calls/day
- Free tier allows 1,000 RPD for Flash-Lite
- Hash-based skip saves 50-70%, so actual daily calls are ~130-215
- **Cost: GBP 0.00/month** on free tier

**Why NOT switch to alternatives:**

| Alternative | Why Not |
|-------------|---------|
| Groq Llama 3.1 8B | Cheapest per-token, but no free tier. Even at $0.05/1M input, paying anything beats free. Also: 8B models struggle with complex HTML extraction -- accuracy risk. |
| DeepSeek V3.2 | Good pricing, but China-hosted API raises data residency questions for UK property data. 5M free tokens is a one-time bonus, not ongoing free tier. Reliability concerns (outages reported). |
| Grok 4.1 Fast | The $150/mo data sharing credits are attractive but require opting in to xAI training on your API data. The $25 signup credit burns fast. No sustained free tier. |
| Mistral Nemo | Cheapest per-token at $0.02/$0.02, but no free tier and 8B-class model -- accuracy risk for structured extraction from messy auction HTML. |
| Gemini 2.5 Flash | 3x more expensive than Flash-Lite with lower free tier limits (250 RPD vs 1000 RPD). Only use if Flash-Lite extraction quality proves insufficient. |

**When to reconsider:**
- If free tier limits drop again (Google reduced them in Dec 2025)
- If volume exceeds 1,000 RPD (would need ~70+ auction houses with no hash-skip)
- If extraction quality from Flash-Lite degrades on new auction house formats

**Fallback plan:** If Google kills the free tier entirely, Groq Llama 3.1 70B at $0.59/$0.79 per 1M tokens is the best paid alternative. At ~432 calls/day with ~2K tokens avg input and ~1K output per call, that would be roughly $0.40/day = ~GBP 10/month. Acceptable within budget.

### Action Items for AI Cost Optimisation

1. **Audit actual Gemini usage** -- add logging to track daily RPD consumption and confirm free tier is sufficient
2. **No model change needed** -- already on the cheapest viable option
3. **Optimise prompt size** -- ensure markdown format is being sent to Gemini (not raw HTML) to reduce input tokens. The codebase already uses Firecrawl markdown, verify this is the default path.
4. **Monitor Gemini 3.x models** -- Gemini 3.1 Flash-Lite Preview is available at $0.25/$1.50 (no free tier yet) but may get one

---

## 2. Analytics Tracking

### Requirements
- MAU tracking (target: prove 500-1,000 MAU to lenders)
- Funnel tracking (landing page -> signup -> first search -> BridgeMatch use)
- Engagement events (lot views, searches, deal stacking usage)
- Privacy-friendly (GDPR, no cookie banners needed)
- Cheap or free
- Works with vanilla JS frontend (no React/Vue)

### Options Compared

| Tool | Cost | Self-Host? | Cookie-Free | Custom Events | Funnel | Setup Complexity |
|------|------|-----------|-------------|---------------|--------|-----------------|
| **Umami Cloud** | Free (100K events/mo) | Optional | Yes | Yes | Yes | Very Low |
| Plausible Cloud | $9/mo (10K pageviews) | Optional | Yes | Yes | Yes | Very Low |
| Plausible Self-Host | Free (your infra) | Yes | Yes | Yes | Yes | Medium |
| PostHog Cloud | Free (1M events/mo) | Optional | No (uses cookies) | Yes | Yes | Low |
| Google Analytics | Free | No | No (cookies) | Yes | Yes | Low |
| Simple Analytics | $9/mo | No | Yes | Yes | No funnels | Very Low |

### Recommendation: Umami Cloud (Free Tier)

**Why Umami Cloud wins:**

1. **Free for your scale** -- 100,000 events/month covers well beyond 1,000 MAU. At ~10 events per session and 5,000 sessions/month, that is 50K events. Plenty of headroom.
2. **No cookies, no consent banner** -- GDPR compliant out of the box. No cookie banner means no friction on the landing page.
3. **Custom events** -- Track `lot_view`, `search`, `bridgematch_open`, `deal_stack_calculate`, `signup` with one line of JS each.
4. **Funnel analysis** -- Built-in funnel visualisation to show lenders the conversion path.
5. **Vanilla JS compatible** -- Just a `<script>` tag, then `umami.track('event_name', { props })`.
6. **MIT licensed** -- Can self-host on Railway later if you outgrow the free tier or want full control.
7. **Lightweight** -- <2KB tracking script, no performance impact.

**Why NOT the alternatives:**

| Alternative | Why Not |
|-------------|---------|
| Plausible Cloud | $9/month for 10K pageviews -- burns budget unnecessarily when Umami is free. Self-hosted Plausible needs its own Postgres + ClickHouse, heavy for Railway. |
| PostHog | Overkill. 1M free events is generous but PostHog uses cookies (needs consent banner), the JS bundle is heavier (~70KB), and the dashboard is complex. Feature flags are nice but env-var flags are simpler for this use case. |
| Google Analytics | Uses cookies, requires consent banner, Google can change the product at will, privacy-hostile reputation puts off UK investors. |
| Simple Analytics | $9/month, no funnel tracking. |

### Integration Pattern

```html
<!-- In index.html <head> -->
<script defer src="https://cloud.umami.is/script.js"
        data-website-id="YOUR_WEBSITE_ID"></script>
```

```javascript
// Custom event tracking in script.js
umami.track('lot_view', { house: slug, lotNumber: lot.number });
umami.track('search', { query: searchTerm, resultCount: results.length });
umami.track('bridgematch_open', { lotId: lot.id });
umami.track('deal_stack_calculate', { purchasePrice: price });
umami.track('signup', { method: 'magic_link' });
```

### Key Events to Track

| Event | Trigger | Properties | Why |
|-------|---------|-----------|-----|
| `page_view` | Automatic | path, referrer | MAU count |
| `signup` | After Supabase auth | method | Conversion tracking |
| `search` | Search submitted | query, resultCount | Engagement |
| `lot_view` | Lot card expanded | house, lotNumber | Engagement depth |
| `bridgematch_open` | BridgeMatch Lite opened | lotId, price | Funnel metric for lenders |
| `deal_stack_calculate` | Deal stacking used | purchasePrice | Power user signal |
| `filter_applied` | Filter changed | filterType, value | UX insight |

### Cost: GBP 0.00/month

---

## 3. Feature Flags

### Requirements
- Toggle Stripe on/off without code changes
- Simple, no external service
- Works in Express (server-side) and vanilla JS (client-side)

### Recommendation: Plain Environment Variables (No Library)

**Why no library is needed:**

The only feature flag needed for v1.2 is `STRIPE_ENABLED`. This is a single boolean toggle. Adding a feature flag library (LaunchDarkly, Unleash, Flagsmith, even PostHog flags) is massive overkill.

### Implementation Pattern

```javascript
// server.js -- near top with other env vars
const STRIPE_ENABLED = process.env.STRIPE_ENABLED !== 'false'; // default: enabled

// Guard Stripe initialisation
let stripe = null;
if (STRIPE_ENABLED) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
}

// Guard Stripe routes
app.post('/api/create-checkout', (req, res) => {
  if (!STRIPE_ENABLED) return res.status(503).json({ error: 'Payments temporarily unavailable' });
  // ... existing Stripe logic
});

// Expose to frontend via config endpoint
app.get('/api/config', (req, res) => {
  res.json({
    stripeEnabled: STRIPE_ENABLED,
    // other client-safe config
  });
});
```

```javascript
// script.js -- hide payment UI when disabled
fetch('/api/config').then(r => r.json()).then(config => {
  if (!config.stripeEnabled) {
    document.querySelectorAll('.stripe-only').forEach(el => el.style.display = 'none');
  }
});
```

### Why NOT a Feature Flag Service

| Service | Why Not |
|---------|---------|
| LaunchDarkly | $8.33/month minimum, requires SDK, overkill for one flag |
| PostHog flags | Would need PostHog integration just for flags, heavy |
| Unleash | Self-hosted, needs its own database, overkill |
| Flagsmith | Free tier exists but adds external dependency for one boolean |
| growthbook | Good but still overkill -- adds a dependency and dashboard for one toggle |

**When to reconsider:** If v1.3+ needs per-user feature flags (A/B testing, gradual rollouts), consider PostHog or GrowthBook at that point. For v1.2, env vars are correct.

### New Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `STRIPE_ENABLED` | `true` | Set to `false` to hibernate all Stripe functionality |

### Cost: GBP 0.00/month

---

## 4. Landing Page

### Requirements
- High-converting property tool landing page
- Hero: "50% of auction houses aren't on Rightmove"
- Works with existing vanilla JS + CSS custom properties stack
- No framework, no build step

### Recommendation: Pure HTML/CSS (No New Dependencies)

**Why:** The existing stack uses vanilla HTML/CSS with custom properties and Google Fonts (Outfit, Sora). A landing page is static content with a CTA. Adding a framework, static site generator, or landing page builder would be absurd.

### What IS Needed

| Item | Approach | Cost |
|------|----------|------|
| Landing page HTML | New `landing.html` or repurpose `welcome.html` | GBP 0 |
| Social proof / stats | Pull from Supabase (lot count, house count) at build/serve time | GBP 0 |
| OG meta tags | Hand-code `<meta property="og:...">` tags | GBP 0 |
| Favicon / branding | Already exists | GBP 0 |
| Analytics | Umami script tag (see section 2) | GBP 0 |

### What NOT to Add

| Avoid | Why |
|-------|-----|
| Next.js / Astro / Gatsby | The app is a vanilla Express monolith serving HTML. A framework for one landing page is nonsensical. |
| Tailwind CSS | The app uses CSS custom properties consistently. Introducing Tailwind would create two styling systems. |
| Landing page SaaS (Carrd, Framer) | Adds cost, creates a separate domain/subdomain, breaks analytics continuity. |
| Animation libraries (GSAP, Framer Motion) | Unnecessary weight. CSS animations and `IntersectionObserver` for scroll reveals are sufficient. |
| Hero image stock photos | Generic stock photos reduce trust. Use real screenshot of the tool showing actual auction data. |

### Landing Page Performance Checklist

- Inline critical CSS (above-fold styles in `<style>` tag)
- Defer non-critical JS
- Lazy-load below-fold images
- Preload Google Fonts (Outfit, Sora) already in use
- Target: Lighthouse Performance > 90

### Cost: GBP 0.00/month

---

## Total v1.2 Stack Cost Impact

| Capability | Monthly Cost | One-Time Cost | Technology |
|------------|-------------|---------------|------------|
| AI (Gemini 2.5 Flash-Lite free tier) | GBP 0.00 | GBP 0.00 | No change (already using it) |
| Analytics (Umami Cloud free tier) | GBP 0.00 | GBP 0.00 | Add `<script>` tag + event calls |
| Feature flags (env vars) | GBP 0.00 | GBP 0.00 | Code pattern, no library |
| Landing page (HTML/CSS) | GBP 0.00 | GBP 0.00 | No new dependencies |
| **Total** | **GBP 0.00** | **GBP 0.00** | |

**v1.2 adds zero cost to the monthly burn rate.** The existing ~GBP 150/month (Claude Max GBP 80 + Firecrawl GBP 70) is unchanged.

---

## Installation

```bash
# No new npm packages needed for v1.2

# Umami is a <script> tag, not an npm package
# Feature flags are env vars, not a library
# Landing page is HTML/CSS
# AI model is already Gemini 2.5 Flash-Lite via existing @google/generative-ai SDK
```

### New Environment Variables to Add

```bash
# Railway environment
STRIPE_ENABLED=false          # Hibernate Stripe for free-first pivot
UMAMI_WEBSITE_ID=xxxxxxxx    # From Umami Cloud dashboard (after signup)
```

---

## Alternatives Considered (Full Summary)

| Category | Recommended | Alternative | When to Use Alternative |
|----------|-------------|-------------|-------------------------|
| AI extraction | Gemini 2.5 Flash-Lite (free) | Groq Llama 3.1 70B ($0.59/$0.79 per 1M) | If Google kills free tier |
| AI extraction | Gemini 2.5 Flash-Lite (free) | DeepSeek V3.2 ($0.28/$0.42 per 1M) | If you need cache-hit pricing and accept China-hosted API |
| AI fallback (PDF/unknown) | Gemini 2.5 Pro (free, 100 RPD) | Gemini 2.5 Flash ($0.30/$2.50 per 1M) | If Pro free tier RPD is too low |
| Analytics | Umami Cloud (free 100K events) | Plausible self-hosted (free, your infra) | If you want full data ownership on Railway |
| Analytics | Umami Cloud (free 100K events) | PostHog (free 1M events) | If you need session replay or A/B testing |
| Feature flags | Env vars | PostHog / GrowthBook | If you need per-user flags or A/B testing in v1.3+ |
| Landing page | Vanilla HTML/CSS | Astro | If you ever need a multi-page marketing site with blog (v1.3 SEO) |

---

## What NOT to Add in v1.2

| Technology | Why Not | Temptation |
|-----------|---------|-----------|
| OpenRouter | Adds a middleman proxy with markup. Call Gemini directly via existing SDK. | "Single API for all models" |
| LangChain | Massive dependency for what is a single `callGemini()` function. | "AI framework" |
| Vercel Analytics | Would require migrating back to Vercel or adding their edge function. Wrong platform. | "Easy analytics" |
| Sentry | Good tool, wrong milestone. Error tracking is a v1.3 concern. Budget matters. | "We should have error tracking" |
| Redis | No need. In-memory caching + Supabase is working. Railway Redis adds ~$5/month. | "Proper caching" |
| TypeScript | Migration of an 11K-line server.js is a multi-week project. Not in scope for v1.2. | "We should type things" |
| Any CSS framework | Existing custom properties work. Adding Tailwind/Bootstrap creates dual systems. | "Landing page would be faster with Tailwind" |
| Docker compose changes | Railway handles container orchestration. Don't add self-hosted analytics infra. | "Self-host Umami on Railway" |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|----------------|-------|
| `@google/generative-ai` ^0.24.1 | Gemini 2.5 Flash-Lite, 2.5 Pro | Already installed, supports all current models |
| Umami Cloud script | Any browser | External `<script>`, no npm dependency |
| Node.js (Railway) | All above | No version change needed |

---

## Sources

- [Gemini API Pricing (official)](https://ai.google.dev/gemini-api/docs/pricing) -- verified model pricing and deprecation dates (HIGH confidence)
- [Gemini Rate Limits (official)](https://ai.google.dev/gemini-api/docs/rate-limits) -- free tier RPM/RPD limits (HIGH confidence)
- [Groq Pricing](https://groq.com/pricing) -- Llama 3.1 token costs (HIGH confidence)
- [DeepSeek Pricing](https://api-docs.deepseek.com/quick_start/pricing) -- V3.2 token costs (MEDIUM confidence, prices may change)
- [xAI Grok API](https://x.ai/api) -- Grok pricing and free credits program (MEDIUM confidence)
- [Mistral Pricing](https://mistral.ai/pricing) -- Nemo and Medium 3 costs (MEDIUM confidence)
- [Umami](https://umami.is/) -- analytics platform features and pricing (HIGH confidence)
- [Plausible](https://plausible.io/) -- analytics alternative comparison (HIGH confidence)
- [PostHog Pricing](https://posthog.com/pricing) -- free tier limits (HIGH confidence)
- Codebase inspection: `server.js` lines 234-235, 904-935 -- current Gemini model constants and SDK usage (HIGH confidence)

---
*Stack research for: Bridgematch Auction Tool v1.2*
*Researched: 2026-03-20*
