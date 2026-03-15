# Pitfalls Research

Researched 2026-03-15 for the Bridgematch Auction Tool expansion (enrichment, deal stacking, subscription hardening, data freshness).

---

## Critical Risks

### 1. Zoopla/Rightmove Scraping — Legal and Technical Blockers

**Severity: CRITICAL — could kill the enrichment feature entirely**

**Legal risk:**
- Rightmove's Terms of Use explicitly prohibit automated access, bots, crawlers, and scrapers. Zoopla has equivalent restrictions.
- The UK Computer Misuse Act 1990 and database rights under the Copyright, Designs and Patents Act 1988 give portals legal standing to pursue scrapers. The 2025-2026 legal landscape has seen a surge of high-profile scraping lawsuits.
- Even if you only scrape publicly available data, ignoring robots.txt undermines any "good faith" defence. PROJECT.md already notes the constraint: "No scraping of data behind login walls; respect robots.txt on property portals."
- Cease-and-desist letters are the typical first step. If Bridgematch is identifiable (user-agent, IP patterns), portals can and do send them.

**Technical blockers:**
- Rightmove uses Cloudflare protection, rate limiting, session tokens that expire quickly, and serves property data inside JavaScript blobs/XHR responses — plain HTML scraping returns empty results.
- Zoopla employs IP bans, CAPTCHAs, and aggressive bot detection. Even rotating proxies get caught at scale.
- Firecrawl may handle some anti-bot measures, but property portals are among the most aggressively protected sites in the UK. Firecrawl is not guaranteed to bypass Cloudflare challenges on these specific domains.

**Warning signs:**
- Firecrawl returns empty HTML or 403s for Zoopla/Rightmove URLs
- Enrichment calls start returning captcha pages instead of property data
- You receive a legal notice from ZPG (Zoopla's parent) or Rightmove plc

**Alternative approaches:**
- Zoopla and Rightmove both offer commercial API access (Zoopla Developer API, Rightmove Data Services) — expensive but legal
- Land Registry data (already integrated) provides sold prices without portal scraping
- PropertyData.co.uk or similar aggregators may offer API access for rental estimates
- Consider enriching from public sources only: Land Registry (sold prices), VOA (council tax bands), EPC register (energy ratings), Google Maps (streetview/location context)

### 2. Firecrawl Credit Burn from Enrichment

**Severity: CRITICAL — could exhaust monthly budget in a single auto-analyse cycle**

**Current state:** 15,000 monthly credits, hash-based skip saves 50-70%. With ~21 houses and ~2,364 lots, the catalogue scraping alone uses a significant portion.

**The enrichment math problem:**
- Firecrawl charges 1 credit per basic page scrape, but features like JSON extraction or Enhanced Mode can cost 5-9 credits per page.
- If enrichment scrapes Zoopla for each of ~2,364 lots: that is 2,364-21,000+ credits for a single enrichment pass, depending on mode used.
- With the 6-hour auto-analyse cycle running 4x/day, even partial re-enrichment could burn 10,000+ credits/day.
- The current `FIRECRAWL_MONTHLY_BUDGET` of 15,000 would be exhausted in 1-2 days.

**Warning signs:**
- `/api/cost-monitor` shows credits spiking after enrichment is deployed
- `fcCreditExhausted` flag fires within hours of a cycle
- Catalogue scraping starts falling back to Puppeteer because enrichment consumed all credits

**The priority inversion problem:** Enrichment is a nice-to-have, but catalogue scraping is the core product. If enrichment starves catalogue scraping of credits, the directory stops updating — catastrophic for user trust.

### 3. SDLT Calculation Edge Cases

**Severity: HIGH — incorrect tax calculations erode trust with sophisticated investor users**

**Current implementation gaps** (from `index.html` line 2460-2467):
The existing `calcSDLT()` function hardcodes investor rates (5% surcharge) with England-only bands. It has no handling for:

**a) First-time buyer relief:**
- 0% on first £300,000, 5% on £300,001-£500,000 (from 1 April 2025)
- Only applies if ALL buyers in a joint purchase qualify and price does not exceed £500,000
- Not relevant for most auction investors (who already own property), but users who are genuinely first-time buyers will get wrong numbers

**b) Corporate purchaser rates:**
- 17% flat rate on residential properties over £500,000 bought by non-natural persons (companies, partnerships with a corporate member)
- Changed from 15% to 17% on 31 October 2024 — any calculator using the old 15% rate is now wrong
- Annual Tax on Enveloped Dwellings (ATED) also applies but is outside calculator scope

**c) Scotland (LBTT) — completely different tax:**
- Different bands, different rates, different name
- Additional Dwelling Supplement (ADS) is 8% (increased from 6% on 5 December 2024)
- Scottish auction houses in the directory (e.g., if any are added) would get English SDLT applied incorrectly

**d) Wales (LTT) — also completely different:**
- Higher tax-free threshold (£225,000 vs £125,000 in England)
- Different band structure and rates
- Higher rates for additional properties increased by 1 percentage point in December 2024

**e) Mixed-use properties:**
- Commercial/mixed-use SDLT rates are substantially lower than residential
- Auction lots flagged as "commercial" or "mixed use" in the directory would get residential rates applied incorrectly
- This matters especially for lots with ground-floor retail + upper residential

**Warning signs:**
- Users complain SDLT figures "don't match my solicitor's quote"
- Scottish/Welsh lots show obviously wrong tax amounts
- Deal stacking calculator outputs are dismissed as unreliable because the SDLT component is wrong

### 4. Stripe Subscription Edge Cases

**Severity: HIGH — revenue and trust risk**

**a) Webhook reliability:**
- Stripe does not guarantee delivery order — `customer.subscription.updated` might arrive before `checkout.session.completed`
- Stripe retries failed webhooks for up to 3 days; the current handler does not track processed event IDs, so duplicate events could trigger duplicate state changes
- The webhook handler (line 1290-1408) processes events synchronously — a slow handler risks timing out the 20-second Stripe window

**b) Double-charging / duplicate subscriptions:**
- Line 1255 checks `stripe_subscription_id` before creating a checkout session, which is good
- But there is a race condition: if a user clicks "Subscribe" twice quickly, two checkout sessions could be created before the first webhook sets `stripe_subscription_id`
- No idempotency key is used on the checkout session creation

**c) Trial abuse (re-signup):**
- `trial_used: true` is set on user creation (line 1663) but is NEVER CHECKED before granting a trial
- The trial is only granted to new users (line 1651: "Auto-create new user"), so same-email re-signup is blocked by the existing user row
- But: a user can create a new Supabase auth account with a different email (e.g., +alias@gmail.com) and get another 14-day trial
- No card fingerprint or device fingerprint check exists
- Magic link auth makes this trivially easy — no password to remember, just use disposable emails

**d) Downgrade timing and proration:**
- On `customer.subscription.deleted`, the user is immediately downgraded to free (line 1354-1358)
- Stripe's default behaviour is to keep the subscription active until the end of the billing period, but the webhook fires at cancellation time, not period end
- The handler should check `sub.current_period_end` and set `tier_expires_at` accordingly, or the user loses access they've paid for
- No proration handling exists for mid-cycle upgrades/downgrades

**e) Missing webhook events:**
- No handler for `customer.subscription.created` — relies entirely on `checkout.session.completed`
- No handler for `customer.subscription.paused` or `customer.subscription.resumed`
- `invoice.payment_succeeded` is not handled — only `invoice.payment_failed`

**Warning signs:**
- Users report losing premium access before their billing period ends
- Support requests about "I was charged twice"
- Trial abuse visible as spike of single-session premium users who never convert

---

## Common Mistakes

### 5. Data Freshness False Positives — Sold/Withdrawn Mislabelling

**The core problem:** Auction houses have no standard for how or when they mark lots as sold, withdrawn, or unsold. The current regex (`/\bSOLD\b|\bSTC\b|\bSALE.?AGREED\b|\bWITHDRAWN\b/i` at line 3136) catches text in bullet elements, but:

**a) False "sold" detection:**
- Some houses add "SOLD" to the page HTML as a watermark overlay on images, not in lot text — JSDOM may or may not pick this up
- Some houses use "SOLD PRIOR" (sold before auction) vs "SOLD" (sold at auction) vs "SOLD AFTER" — all have different implications
- A house might say "SOLD STC" (Subject to Contract) which can fall through
- Some houses display "GUIDE PRICE: SOLD" where SOLD replaces the price field, which could confuse extraction

**b) False "available" detection:**
- Many houses leave sold lots on the catalogue page for days/weeks with no status change
- Some only update the status on a separate "results" page that is not scraped
- Lots that failed to sell ("unsold" / "not sold") may reappear in the next auction — the system could show them as available when they are actually re-listed

**c) Timing mismatches:**
- Auto-analyse runs every 6 hours; an auction that completed at 2pm might not show results until the 6pm cycle
- Between auction completion and results publication (often 24-48 hours), the lot status is ambiguous
- Users see lots that auctioned yesterday as "available" — damaging trust

**d) DOM extractor fragility:**
- Each house's sold detection is baked into its DOM extractor (e.g., line 5085-5087, 5468-5469, 5747)
- When houses redesign, sold/status elements change selectors — but the breakage is silent (lots just appear as available instead of sold)

**Warning signs:**
- Users report calling about "available" lots that were sold weeks ago
- Sold percentage seems implausibly low or high for a completed auction
- A house that just auctioned shows 0 sold lots

### 6. Monolith Growth — server.js at ~9,940 Lines

**The current trajectory:**
- server.js: 9,939 lines today
- Adding Zoopla/Rightmove enrichment: +300-500 lines (enrichment logic, caching, fallbacks)
- Deal stacking calculator: +200-400 lines (SDLT variants, finance cost modelling, input validation)
- Alerting system: +150-300 lines (failure detection, notification dispatch)
- Subscription hardening: +100-200 lines (idempotency, event tracking, proration)
- Projected total: ~11,000-11,300 lines

**When this becomes a real problem:**
- **Right now** for developer experience: finding anything requires searching through 10K lines; merge conflicts on a single file are painful; code review is nearly impossible since every PR touches server.js
- **At ~12,000 lines** for reliability: a syntax error anywhere in the file takes down the entire application — no isolation between auction scraping, subscription handling, and API endpoints
- **At ~15,000+ lines** for Railway hosting: Node.js parses the entire file at startup, increasing cold start times and memory usage

**The "just add more" trap:**
- Each new feature feels small ("just 200 lines"), but the cost is compounding — every feature interacts with shared state (`fcCreditExhausted`, `creditExhausted`, in-memory caches)
- The DOM_EXTRACTORS object alone is likely 3,000+ lines of house-specific logic that could be split into individual files trivially
- Global mutable state (`fcCreditsUsed`, `creditExhausted`, `_lastScrapeEngine`) makes parallel processing or testing impossible

**Warning signs:**
- Deployments take noticeably longer
- A bug in a DOM extractor crashes the Stripe webhook handler
- Developers avoid touching server.js because they cannot reason about side effects
- Railway memory usage trends upward without new traffic

---

## Prevention Strategies

### For Pitfall 1 (Portal Scraping):
1. **Do not scrape Zoopla/Rightmove directly.** The legal and technical risk is too high for a small commercial product.
2. **Use public data APIs instead:** Land Registry (already integrated), EPC register (free API), VOA council tax bands (free).
3. **If portal data is essential**, investigate commercial API access from Zoopla/Rightmove — budget £500-2,000/month.
4. **Firecrawl as a proxy does not insulate you** — Firecrawl's ToS likely prohibit using their service to violate third-party ToS.
5. **Build enrichment to degrade gracefully** — if a source is unavailable, the lot still displays with whatever data exists.

### For Pitfall 2 (Credit Burn):
1. **Separate credit budgets:** Reserve a fixed allocation for catalogue scraping (e.g., 12,000/month) and a smaller pool for enrichment (e.g., 3,000/month). Never let enrichment starve the core product.
2. **Enrich lazily, not eagerly:** Only enrich a lot when a user views it (on-demand), not during the auto-analyse cycle. Cache enrichment data indefinitely (addresses don't change).
3. **Hash-based skip for enrichment:** If a lot already has enrichment data cached, skip it — same pattern as catalogue hash dedup.
4. **Track credits per-feature:** Extend `/api/cost-monitor` to show catalogue vs enrichment credit usage separately.
5. **Consider Firecrawl plan upgrade** if enrichment is valuable — the Hobby plan (3,000 credits/$16/mo) is insufficient; Standard (credit count TBD at $83/mo) may be needed.

### For Pitfall 3 (SDLT):
1. **Detect nation from address/postcode:** Scottish postcodes (EH, G, AB, DD, KY, FK, PH, IV, PA, ML, KA, DG, TD), Welsh postcodes (CF, SA, LL, NP, SY, LD, HR partial) — route to correct tax calculator.
2. **Implement three calculators:** `calcSDLT()` (England/NI), `calcLBTT()` (Scotland), `calcLTT()` (Wales).
3. **Add buyer type selector** to the deal stacking UI: Individual (additional property), Individual (first home), Corporate. Default to "additional property" for auction investors.
4. **Handle mixed-use separately:** If `propType === 'commercial'` or `propType === 'mixed'`, use non-residential SDLT rates.
5. **Add a disclaimer:** "Estimates only — consult your solicitor for exact figures." This is non-optional for any tax calculator.
6. **Pin rate effective dates in the code** with comments, so when rates change (they change roughly annually), it is clear what needs updating.

### For Pitfall 4 (Stripe):
1. **Add idempotency:** Store processed `event.id` values in Supabase and skip duplicates. This is a few lines of code but prevents the entire class of duplicate-processing bugs.
2. **Check `trial_used` before granting trials:** Add a guard in the user creation flow — if an existing user row with the same email has `trial_used: true`, do not grant a new trial.
3. **Fix downgrade timing:** On `customer.subscription.deleted`, check `sub.current_period_end` and set `tier_expires_at` to that date instead of immediately downgrading.
4. **Handle out-of-order events:** Use `event.created` timestamps or fetch the current resource state from Stripe (via `stripe.subscriptions.retrieve()`) rather than trusting the webhook payload.
5. **Add checkout session deduplication:** Use a client-side flag or Stripe's `client_reference_id` to prevent double-click creating two sessions.
6. **Card fingerprint check for trials:** Use Stripe Radar's `card[fingerprint]` to detect users re-signing up with different emails but the same card. (Requires collecting card at trial start.)

### For Pitfall 5 (Data Freshness):
1. **Track auction date in lot data:** If the auction date has passed, flag the catalogue as "results pending" rather than showing lots as available.
2. **Add a "last scraped" timestamp** visible to users on each catalogue — sets expectations about data freshness.
3. **Separate "available"/"sold"/"unknown" states:** Currently sold detection is binary (regex match or not). Add an explicit "unknown/pending" state for lots in completed auctions that haven't been updated.
4. **Scrape results pages:** Many auction houses publish separate results pages after an auction — add these as secondary scrape targets.
5. **Time-based expiry:** If a lot's auction date was >48 hours ago and no status update has been detected, mark it as "status unconfirmed" rather than leaving it as available.

### For Pitfall 6 (Monolith):
1. **Extract DOM extractors immediately:** Move the `DOM_EXTRACTORS` object into `extractors/` directory with one file per house. This alone could remove 3,000+ lines from server.js with zero functional change — each file exports a function, server.js imports them.
2. **Extract Stripe handlers:** `stripe/checkout.js`, `stripe/webhook.js`, `stripe/portal.js` — clean separation, each ~50-100 lines.
3. **Extract the scoring engine:** Self-contained, no external dependencies, easily testable in isolation.
4. **Do not extract routes yet** — Express route registration can stay in server.js as a registry; the handler logic moves to separate files.
5. **New features in new files from day one:** Deal stacking calculator, enrichment pipeline, alerting — each gets its own file, imported by server.js.

---

## Phase Mapping (which phase should address each pitfall)

### Before Any New Feature Work (Phase 0 — Prep)
| Pitfall | Action | Effort |
|---------|--------|--------|
| #6 Monolith | Extract DOM extractors into `extractors/*.js` | 1-2 days |
| #6 Monolith | Establish pattern: new features = new files | Convention only |
| #4 Stripe | Add webhook event idempotency (store `event.id`) | 2-3 hours |
| #4 Stripe | Fix downgrade timing (`current_period_end`) | 1-2 hours |

### Phase 1 — Enrichment (Zoopla/Rightmove replacement)
| Pitfall | Action | Effort |
|---------|--------|--------|
| #1 Portal scraping | **Do not scrape portals directly.** Use Land Registry + EPC + VOA instead | Decision |
| #2 Credit burn | Implement lazy enrichment (on-demand, not batch) | 1 day |
| #2 Credit burn | Add per-feature credit budgets and monitoring | Half day |
| #2 Credit burn | Add enrichment cache with indefinite TTL for address-based data | Half day |

### Phase 2 — Deal Stacking Calculator
| Pitfall | Action | Effort |
|---------|--------|--------|
| #3 SDLT | Implement nation detection from postcode | Half day |
| #3 SDLT | Build `calcLBTT()` and `calcLTT()` alongside existing `calcSDLT()` | 1 day |
| #3 SDLT | Add buyer type selector (individual/FTB/corporate) | Half day |
| #3 SDLT | Handle mixed-use/commercial rate routing | 2-3 hours |
| #3 SDLT | Add tax disclaimer to all calculator outputs | 30 min |
| #6 Monolith | Build deal stacking in `deal-stacking.js`, not in server.js | Convention |

### Phase 3 — Data Freshness
| Pitfall | Action | Effort |
|---------|--------|--------|
| #5 Sold detection | Add auction-date-aware status ("results pending") | Half day |
| #5 Sold detection | Add "last scraped" timestamp to catalogue display | 2-3 hours |
| #5 Sold detection | Implement "status unconfirmed" for stale post-auction lots | Half day |
| #5 Sold detection | Add results page scraping for houses that publish them | 1-2 days |

### Phase 4 — Subscription Hardening
| Pitfall | Action | Effort |
|---------|--------|--------|
| #4 Stripe | Check `trial_used` before granting trials | 30 min |
| #4 Stripe | Add card fingerprint check for trial abuse | 2-3 hours |
| #4 Stripe | Handle `subscription.created`, `.paused`, `.resumed` events | 1-2 hours |
| #4 Stripe | Add checkout session deduplication | 1 hour |
| #6 Monolith | Extract Stripe handlers to `stripe/*.js` | Half day |

### Ongoing
| Pitfall | Action | Frequency |
|---------|--------|-----------|
| #2 Credit burn | Monitor `/api/cost-monitor` for enrichment vs catalogue split | Weekly |
| #3 SDLT | Check for rate changes in April each year (Budget announcements) | Annually |
| #5 Sold detection | Audit sold detection accuracy per house after each auction cycle | Monthly |
| #6 Monolith | Track server.js line count — alert if it grows past 8,000 (post-extraction) | Each PR |

---

*Research sources: Rightmove Terms of Use, Zoopla anti-scraping documentation, Firecrawl pricing/billing docs, GOV.UK SDLT/LBTT/LTT rate tables, Stripe webhook documentation, Revenue Scotland LBTT guidance, GOV.WALES LTT rates.*
