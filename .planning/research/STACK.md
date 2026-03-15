# Stack Research

Research conducted 2026-03-15 for Milestone 2 capabilities. Focuses on what needs to be ADDED to the existing Node.js/Express + Firecrawl + Supabase + Stripe stack.

---

## Firecrawl Capabilities (Current API)

### Current Usage (Underutilised)

The codebase currently calls Firecrawl v1 at `https://api.firecrawl.dev/v1/scrape` with `formats: ['rawHtml']` as the default (line 279 of server.js). This means:
- Every scrape returns raw HTML that must be parsed locally with JSDOM
- The `markdown` format (Firecrawl's primary value proposition — 67% fewer tokens than HTML) is never used
- The `json` structured extraction mode is never used
- The `metadata` object in responses (title, description, statusCode) is available but not leveraged

### Available Formats (v1/v2 API)

| Format | What It Returns | Credit Cost | Relevance |
|--------|----------------|-------------|-----------|
| `markdown` | Clean LLM-ready markdown, main content only | 1 credit | HIGH — feed directly to Gemini instead of stripped HTML |
| `rawHtml` | Full unmodified HTML | 1 credit | Already used |
| `html` | Cleaned HTML (scripts/styles removed) | 1 credit | Useful fallback |
| `json` | LLM-extracted structured data via schema or prompt | +4 credits/page | HIGH for enrichment |
| `images` | All image URLs from rendered page | 1 credit | Already used for backfill |
| `links` | All links from page | 1 credit | Useful for pagination detection |
| `screenshot` | Full-page screenshot URL (24hr expiry) | 1 credit | Low priority |

### Structured JSON Extraction

Firecrawl's `json` format accepts either a JSON Schema or a natural language prompt to extract structured data. This is the key capability for property enrichment:

```js
// Schema-based extraction (most reliable)
const result = await scrapeWithFirecrawl(url, {
  formats: ['json'],
  jsonOptions: {
    schema: {
      type: 'object',
      properties: {
        sold_prices: { type: 'array', items: { type: 'object', properties: {
          address: { type: 'string' },
          price: { type: 'number' },
          date: { type: 'string' },
          property_type: { type: 'string' }
        }}},
        rental_estimate: { type: 'number' },
        average_asking_price: { type: 'number' }
      }
    }
  }
});

// Prompt-based extraction (more flexible, less predictable)
const result = await scrapeWithFirecrawl(url, {
  formats: ['json'],
  jsonOptions: {
    prompt: 'Extract all sold prices, rental estimates, and average asking prices from this property listing page'
  }
});
```

**Credit cost:** 5 credits per page (1 base + 4 for JSON mode). At 15,000 monthly budget, that's 3,000 enrichment lookups/month — roughly 140 per lot if enriching all ~21 houses' catalogues.

### `/extract` Endpoint (Separate from `/scrape`)

Firecrawl also has a dedicated `/extract` endpoint that:
- Accepts wildcard URL patterns (e.g., `zoopla.co.uk/house-prices/*`)
- Can process entire websites, not just single pages
- Returns structured data via schema or prompt
- Supports `enableWebSearch` for enriched context
- Returns a Job ID for async polling

This could be useful for batch enrichment but is a different billing model.

### Actions Parameter

Already partially used (executeJavascript for lazy images). Full action support includes:
- `write` — input text into search fields
- `press` — keyboard keys (Enter, Tab)
- `click` — click DOM elements by CSS selector
- `wait` — pause for rendering
- `screenshot` — capture state

This enables **interactive scraping** — e.g., searching for an address on Zoopla/Rightmove and extracting the results page.

### Recommendations for Firecrawl

1. **Switch catalogue scraping to `formats: ['markdown', 'rawHtml']`** — feed markdown to Gemini (fewer tokens = better extraction + lower Gemini token usage), keep rawHtml for DOM extractors. Cost: 0 additional credits (markdown is included in base credit).
2. **Use `json` format for enrichment** — define schemas for Zoopla/Rightmove data extraction. Cost: +4 credits per enrichment call.
3. **Use `actions` for portal search** — type address, press Enter, wait, then extract results.
4. **Upgrade to v2 API** — the codebase uses v1 (`/v1/scrape`). v2 has the same endpoint structure but better extraction quality. Migration: change URL path from `/v1/` to `/v2/`.

**Confidence: HIGH** — all capabilities confirmed in current Firecrawl docs.

---

## Property Portal Data Access (Zoopla/Rightmove)

### Zoopla

**Official API:** Zoopla historically offered a public developer API with endpoints for property listings, sold prices, rental estimates, and area stats. As of 2025, the API is in a grey zone — it exists but is no longer actively maintained, API keys can stop working without warning, and there is no new developer signup process visible. **Do not rely on the official Zoopla API.**

**Scraping feasibility:** Zoopla employs anti-bot measures (CAPTCHAs, rate limiting, IP bans) but Firecrawl's managed proxy rotation and JS rendering can handle this. Key pages:

| Data Needed | Zoopla URL Pattern | Scrapeable? |
|-------------|-------------------|-------------|
| Sold prices | `zoopla.co.uk/house-prices/{postcode}/` | YES via Firecrawl |
| Rental estimates | `zoopla.co.uk/house-prices/{address}` (Zed-Index) | YES via Firecrawl |
| Current listings | `zoopla.co.uk/for-sale/details/{id}` | YES via Firecrawl |
| Area stats | `zoopla.co.uk/house-prices/{area}/` | YES via Firecrawl |

**Approach:** Use Firecrawl `actions` to navigate to sold prices page for a postcode, then extract with `json` format + schema. Estimated 2-3 credits per lookup (1 base + potential enhanced proxy).

### Rightmove

**Official API:** Rightmove has NO public API. Their APIs (Real Time Data Feed, Commercial Listings API) are restricted to registered estate agents for listing management only. Rightmove explicitly prohibits scraping in their ToS.

**Scraping feasibility:** Rightmove is more aggressive with anti-bot than Zoopla. However, Firecrawl's proxy rotation can typically handle it. Key pages:

| Data Needed | Rightmove URL Pattern | Scrapeable? |
|-------------|----------------------|-------------|
| Sold prices | `rightmove.co.uk/house-prices/{postcode}.html` | YES via Firecrawl (public page) |
| Rental estimates | Not directly available as a page | NO — derived data only |
| Current listings | `rightmove.co.uk/properties/{id}` | YES via Firecrawl |
| House price history | `rightmove.co.uk/house-prices/detail.html?propertyId={id}` | YES via Firecrawl |

**Legal note from PROJECT.md:** "No scraping of data behind login walls; respect robots.txt on property portals." Sold prices pages on both portals are public (no login required) and are not blocked by robots.txt. This is publicly available information derived from Land Registry data that the portals present with added context.

### PropertyData API (Legitimate Alternative)

**PropertyData.co.uk** aggregates data from Rightmove, Zoopla, OnTheMarket, Land Registry, and other sources into a single REST API with 66+ endpoints. Key endpoints:

| Endpoint | What It Returns | Credits |
|----------|----------------|---------|
| Sold prices / comps | Historical transactions near an address | 1 |
| Rental estimates | Live local asking rents by property type | 1 |
| Yields | Local rental yields | 1 |
| Growth forecasts | Price growth predictions | 1 |
| Demand signals | Market demand metrics | 1 |
| Flood risk | Flood zone data | 1 |

**Pricing:** Starts at £28/month for 2,000 credits (rate limit: 4 per 10 seconds). The API 5k plan at £48/month would cover ~5,000 lookups — sufficient for enriching all lots.

**Authentication:** API key based, straightforward REST.

### Recommended Approach (Tiered)

1. **Primary: Firecrawl scraping of Zoopla/Rightmove sold prices pages** — uses existing Firecrawl budget, no new vendor. Build address-to-URL mapping, scrape public sold prices pages, extract with JSON schema. Cost: ~5 Firecrawl credits per lot enrichment.

2. **Fallback/Supplement: PropertyData API** — for rental estimates and yield data that aren't easily scraped. £28-48/month for structured, reliable data. Much more reliable than scraping for ongoing use.

3. **Existing: Land Registry enrichment** — already implemented, provides street averages and yield estimates. The new enrichment supplements this, not replaces it.

**Confidence: MEDIUM-HIGH** — Firecrawl can scrape Zoopla/Rightmove public pages today, but portals may tighten anti-bot over time. PropertyData is the reliable fallback.

---

## Deal Stacking / Investment Analysis Patterns

### What Exists Today

The codebase has a `calcDealAnalysis()` function (referenced in bugs as dead code at ~line 2452 of index.html/script.js). Known bugs from `bugs-forms-data.md`:
- Bridging cost formula error (incorrect calculation)
- Bridging cost missing from total cost
- Assumes street average = post-works GDV (should be separate user input)
- SDLT shows £0 for some price ranges
- Hardcodes 12-month hold period (most auction deals are 6-9 months)
- No `worksCost` parameter

The existing `bridgematch-lite.html` has a working SDLT calculation but uses investor surcharge rates that appear to be the old 3% rates (pre-October 2024), not the current 5% surcharge.

### SDLT Calculation Rules (2025/26, England & Northern Ireland)

**Standard residential rates (from April 2025):**

| Band | Rate |
|------|------|
| £0 - £125,000 | 0% |
| £125,001 - £250,000 | 2% |
| £250,001 - £925,000 | 5% |
| £925,001 - £1,500,000 | 10% |
| Over £1,500,000 | 12% |

**Additional property surcharge (investors/BTL/second homes): +5% on ALL bands**

Effective investor rates:

| Band | Rate (with 5% surcharge) |
|------|--------------------------|
| £0 - £125,000 | 5% |
| £125,001 - £250,000 | 7% |
| £250,001 - £925,000 | 10% |
| £925,001 - £1,500,000 | 15% |
| Over £1,500,000 | 17% |

**Non-UK resident surcharge:** Additional 2% on top of everything (so investor + non-resident = +7% total surcharge). Implementation should include a toggle for this.

**Threshold:** No surcharge applies to properties under £40,000.

**Implementation (deterministic, no API needed):**

```js
function calculateSDLT(price, isAdditional = true, isNonResident = false) {
  if (price < 40000) return 0;
  const surcharge = (isAdditional ? 0.05 : 0) + (isNonResident ? 0.02 : 0);
  const bands = [
    { threshold: 125000, rate: 0 },
    { threshold: 250000, rate: 0.02 },
    { threshold: 925000, rate: 0.05 },
    { threshold: 1500000, rate: 0.10 },
    { threshold: Infinity, rate: 0.12 }
  ];
  let tax = 0, prev = 0;
  for (const band of bands) {
    const taxable = Math.min(price, band.threshold) - prev;
    if (taxable <= 0) break;
    tax += taxable * (band.rate + surcharge);
    prev = band.threshold;
  }
  return Math.round(tax);
}
```

**Confidence: HIGH** — rates confirmed on GOV.UK, effective from April 2025.

### Deal Stacking Calculator — Full Formula

The deal stack is the complete cost breakdown for an auction property investment. Based on research of UK property investment calculators (PropMarker, PropertyEngine, ThePropertyCalculator, WTF Property BRRR calculator):

**Inputs (auto-calculated from lot data + lender data):**
- Purchase price (from lot `guidePrice`)
- SDLT (calculated from purchase price, investor rates)
- Bridging finance cost (from Bridgematch lender data: rate, term, arrangement fee)
- Auction buyer's premium (typically 2% + VAT, varies by house)

**Inputs (user-provided):**
- GDV (Gross Development Value — post-works value)
- Works cost (refurbishment budget)
- Legal fees (solicitor, conveyancing)
- Survey/valuation costs
- Expected monthly rental income
- Hold period in months (default 9 for auction refurbs)
- Exit strategy: Flip (sell) or Hold (refinance to BTL mortgage)

**Outputs — the "stack":**

```
TOTAL COST IN:
  Purchase price .................. £X
  SDLT (investor rate) ........... £X  [auto]
  Buyer's premium ................ £X  [auto if known]
  Legal fees ..................... £X  [user input]
  Survey / valuation ............. £X  [user input]
  Works cost ..................... £X  [user input]
  Bridging interest .............. £X  [auto: loan * monthly rate * months]
  Bridging arrangement fee ....... £X  [auto: loan * 1-2%]
  ─────────────────────────────────────
  TOTAL COST IN .................. £X

FLIP ANALYSIS (if selling):
  GDV (sale price) ............... £X  [user input]
  Agent fees (1.5% + VAT) ........ £X  [auto]
  ─────────────────────────────────────
  Net proceeds ................... £X
  Gross profit ................... £X  (GDV - agent fees - total cost in)
  ROI ............................ X%  (profit / total cost in * 100)
  Cash-on-cash return ............ X%  (profit / cash actually deployed)

HOLD ANALYSIS (if refinancing to BTL):
  Monthly rental income .......... £X  [user input]
  Annual rental income ........... £X
  Gross yield .................... X%  (annual rent / purchase price)
  Net yield (est) ................ X%  (annual rent - costs / purchase price)
  Refinance value (GDV) .......... £X  [user input]
  75% LTV mortgage ............... £X  [auto]
  Cash left in deal .............. £X  (total cost in - mortgage)
  Cash-on-cash return ............ X%  (annual net rent / cash left in)
```

**Bridging cost auto-calculation** requires data from Bridgematch lender matching:
- Day-1 advance rate (typically 70-80% of purchase price or value)
- Monthly interest rate (0.55-1.0% typical)
- Arrangement fee (1-2% of loan)
- The system already has lender data in Bridgematch Lite

**Confidence: HIGH** — standard property investment formulas, well-established in UK property education.

---

## Subscription Management Patterns

### Current State

The system uses Supabase auth (magic links) and Stripe for £9.99/month premium subscriptions with a 14-day Pro trial on signup. Known issues from `bugs-auth-stripe.md` include edge cases around trial expiry, downgrade flows, and resubscription.

### Stripe Webhook Events to Handle

**Minimum required events for robust subscription management:**

| Event | Action |
|-------|--------|
| `customer.subscription.created` | Set user tier to premium in Supabase |
| `customer.subscription.updated` | Check status transitions (active/past_due/canceled) |
| `customer.subscription.deleted` | Revoke premium access, set to free tier |
| `customer.subscription.trial_will_end` | Send email warning (3 days before trial ends) |
| `invoice.paid` | Confirm/renew premium access |
| `invoice.payment_failed` | Notify user, grace period before downgrade |
| `invoice.finalization_failed` | Handle tax/location validation errors |

### Subscription State Machine

```
TRIALING (14 days)
  ├─→ ACTIVE (payment succeeds at trial end)
  ├─→ PAST_DUE (payment fails at trial end)
  │     ├─→ ACTIVE (user updates payment, retry succeeds)
  │     ├─→ CANCELED (all retries exhausted)
  │     └─→ UNPAID (terminal, no more retries)
  └─→ CANCELED (user cancels during trial)
       └─→ ACTIVE (user resubscribes)
```

### Edge Cases to Harden

1. **Trial expiry without payment method:** Stripe fires `customer.subscription.updated` with status change from `trialing` to `past_due` or `paused`. The webhook must downgrade the user's Supabase tier immediately.

2. **Payment failure on renewal:** Stripe retries failed payments on a configurable schedule (default: 3 retries over ~3 weeks). During this period, status is `past_due`. Decision needed: keep premium access during grace period or revoke immediately?

3. **Resubscription after cancellation:** When a canceled user resubscribes, Stripe creates a NEW subscription (not reactivating the old one). The webhook must handle `customer.subscription.created` even if the user already exists in Supabase.

4. **Webhook delivery failure:** Stripe retries webhooks for up to 3 days with exponential backoff. Implement idempotency keys or check Stripe subscription status on each API request as a fallback.

5. **Race condition: webhook vs. frontend redirect:** After Stripe Checkout, the user is redirected back to the app before the webhook fires. The frontend should poll or optimistically show premium access, then the webhook confirms it server-side.

6. **Subscription status on every API request (belt-and-suspenders):** Don't rely solely on webhooks. On each premium-gated API request, check the user's subscription status in Supabase AND optionally verify with Stripe API if the cached status is stale (>1 hour old).

### Implementation Pattern for Express + Supabase

```js
// Webhook endpoint (raw body required for signature verification)
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const status = subscription.status; // active, past_due, canceled, unpaid
      // Update Supabase user tier based on status
      await supabase.from('users')
        .update({ tier: status === 'active' ? 'premium' : 'free', stripe_status: status })
        .eq('stripe_customer_id', customerId);
      break;
    }
    case 'customer.subscription.trial_will_end': {
      // Send warning email via Supabase or external service
      break;
    }
    case 'invoice.payment_failed': {
      // Notify user to update payment method
      break;
    }
  }
  res.json({ received: true });
});
```

### Supabase-Specific Considerations

- **Row Level Security (RLS):** Ensure the webhook can update user tiers. Use a service role key for webhook operations, not the anon key.
- **Stripe Sync Engine:** Supabase offers an open-source `stripe-sync-engine` that syncs Stripe data to Postgres via webhooks. Consider using it instead of rolling custom sync logic.
- **Real-time subscriptions:** Supabase Realtime can push tier changes to the frontend instantly after webhook processing.

**Confidence: HIGH** — Stripe webhook patterns are well-documented and widely implemented.

---

## Recommendations

### Priority 1: Firecrawl Markdown Mode (Low effort, high value)

**What:** Change `scrapeWithFirecrawl` default formats from `['rawHtml']` to `['markdown', 'rawHtml']`. Feed markdown to Gemini instead of stripped HTML.

**Why:** Markdown uses 67% fewer tokens than HTML. This means Gemini extraction will be faster, more accurate (less noise), and cheaper (fewer tokens per request). Zero additional Firecrawl credit cost.

**How:** Modify line 279 of server.js. Update Gemini prompt templates to expect markdown instead of stripped HTML. Keep rawHtml for DOM extractors.

**Risk:** Low. Markdown format is stable and well-tested in Firecrawl.

### Priority 2: Deal Stacking Calculator (Medium effort, high user value)

**What:** Build the full deal stack calculator as described above. Replace the broken `calcDealAnalysis()` with a proper implementation.

**Why:** This is the primary premium feature upgrade path. Users get free directory data; the deal stacker makes premium worth paying for.

**How:**
1. Implement correct SDLT calculation (investor rates 2025/26 as documented above)
2. Build deal stack formula with auto-calculated fields (SDLT, bridging costs from lender data) and user inputs (GDV, works, legal, rental)
3. Wire into lot detail view as a premium-gated feature
4. Include both Flip and Hold analysis outputs

**Dependencies:** Bridgematch lender data for bridging cost auto-calculation. If not available per-lot, use sensible defaults (0.75% monthly rate, 2% arrangement fee, 75% LTV).

### Priority 3: Property Portal Enrichment (Medium effort, medium-high value)

**What:** Enrich lots with Zoopla/Rightmove sold prices and rental estimates using Firecrawl's JSON extraction.

**How:**
1. Build address-to-URL mapper for Zoopla sold prices pages (`zoopla.co.uk/house-prices/{postcode}/`)
2. Use Firecrawl `json` format with a schema to extract comparable sold prices
3. Cache enrichment data in Supabase (don't re-scrape if data <30 days old)
4. Supplement with PropertyData API for rental estimates (£28-48/month)
5. Display enrichment data on lot detail cards (free for all users per tier strategy)

**Budget impact:** ~5 Firecrawl credits per lot enrichment. For ~2,400 lots, that's ~12,000 credits — close to the 15,000 monthly budget. Either:
  - Enrich only lots with guide price >£50k (eliminates garage/parking lots)
  - Enrich on-demand when user views lot detail (lazy enrichment)
  - Increase Firecrawl budget
  - Use PropertyData API as primary source instead (£28-48/month, more reliable)

**Recommended approach:** Lazy enrichment (on lot detail view) + 30-day cache. This spreads credit usage across the month and only enriches lots users actually care about.

### Priority 4: Subscription Tier Hardening (Medium effort, critical for revenue)

**What:** Implement all webhook handlers, edge case handling, and belt-and-suspenders status checking as documented above.

**How:**
1. Implement Stripe webhook endpoint with signature verification
2. Handle all 7 recommended events
3. Add subscription status cache in Supabase with TTL
4. Add server-side status check on every premium-gated API request
5. Handle trial_will_end with email notification
6. Test all edge cases with Stripe Test Clocks

**Key decision needed:** Grace period policy — when payment fails, how long before revoking premium access? Recommendation: 7-day grace period (Stripe default retry schedule is ~3 weeks, but user should be warned on day 1).

### Technology Additions Required

| Addition | Purpose | Cost |
|----------|---------|------|
| `stripe` npm package | Webhook signature verification, API calls | Free (already partially integrated) |
| PropertyData API key | Reliable rental estimates and yield data | £28-48/month |
| Firecrawl v2 migration | Better extraction quality | Free (same API key) |

### What NOT to Add

- **No new scraping libraries** — Firecrawl handles everything needed
- **No separate property data database** — cache in existing Supabase
- **No frontend framework** — keep vanilla JS per existing architecture
- **No separate microservice** — keep in server.js monolith per constraints
