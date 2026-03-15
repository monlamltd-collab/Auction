# Architecture Research

Research into how to integrate four new capabilities into the existing monolith (`server.js` ~9,750 lines).

---

## Enrichment Pipeline Design

### Goal
Add a Zoopla/Rightmove enrichment step that attaches comps, rental estimates, and sold prices to lots after extraction — supplementing the existing Land Registry data.

### Current Enrichment Flow
After lots are extracted and scored, `enrichLots()` (line 8857) runs:
1. Groups lots by postcode
2. Queries Land Registry in batches of 5 concurrent requests
3. Calculates street averages, below-market scores, rental yield estimates (via `estimateMonthlyRent()` lookup table)
4. Adjusts scores based on findings

This runs **synchronously** within both `autoAnalyseOne()` (line 9612) and the user-triggered `POST /api/analyse` flow (line 2888).

### Recommended Approach: Async Background Enrichment

**Do not run Zoopla/Rightmove scraping synchronously during lot extraction.** Reasons:

1. **Firecrawl credit budget.** Each portal lookup costs 1 Firecrawl credit. A 100-lot catalogue would burn 100-200 credits just for enrichment, against a 15,000/month budget that already covers ~21 houses' catalogue scraping. Synchronous enrichment would blow the budget within a few cycles.
2. **Latency.** Portal scraping adds 2-5s per lot (Firecrawl rate limits, portal rendering). A 100-lot catalogue would add 3-8 minutes to analysis time. Unacceptable for user-initiated `POST /api/analyse` which streams SSE progress.
3. **Failure isolation.** Portal pages change frequently. A broken Zoopla scraper should not fail the entire lot extraction pipeline.

### Design

Add a new function `enrichFromPortals(lots, house)` that:
1. Runs **after** the lot is cached in `cached_analyses` (post-upsert at line 9682)
2. For each lot with an address/postcode, scrapes Zoopla/Rightmove via Firecrawl for:
   - Recent sold prices (complements Land Registry with asking prices and time-on-market)
   - Current rental listings (replaces the hardcoded `VOA_RENTS` lookup table at line 8540)
   - Property details (EPC, council tax band, floor area)
3. Updates the cached lot data in-place via `supabase.from('cached_analyses').update()`
4. Tracks enrichment status per-lot to avoid re-enriching on next cycle

### Credit Budget Strategy

- **Batch by postcode** — same as `enrichLots()` does now. One Zoopla search per postcode covers all lots in that area.
- **Priority enrichment** — only enrich lots scoring >= 3 (top picks) or under a price threshold. A 100-lot catalogue might have 15-20 top picks = 15-20 Firecrawl credits, not 100.
- **Daily credit ceiling** — add an `FC_ENRICHMENT_DAILY_CAP` (e.g., 200 credits/day) separate from scraping budget. Check `fcCreditsUsed` before each enrichment call.
- **Cache enrichment results** — store portal data in the lot object (`lot.portalData = { zoopla: {...}, rightmove: {...} }`). Skip lots that already have `portalData` on subsequent cycles.

### Integration Point

In `autoAnalyseOne()`, after the upsert at line 9682:
```
await enrichFromPortals(lots, house);  // non-blocking, updates DB directly
```

For user-initiated analysis, do **not** run portal enrichment. Return cached lots immediately; portal data appears when the background cycle processes it. This keeps the user flow fast.

### Firecrawl Format

Use Firecrawl's `markdown` format (not `rawHtml`) for portal pages. Zoopla/Rightmove have heavy JS rendering; markdown output is cheaper to parse with Gemini or regex than raw HTML. Example:
```js
const result = await scrapeWithFirecrawl(zooplaUrl, { formats: ['markdown'] });
```

### Legal Note
Zoopla and Rightmove may block scraping. Firecrawl's proxy rotation helps, but monitor for 403s and implement per-portal circuit breakers mirroring the existing `fcTemporarilyDown` pattern.

---

## Data Freshness Architecture

### Goal
Reliably detect and remove stale/sold lots so the directory only shows actionable inventory.

### Current Staleness Handling

1. **Auction date expiry** (line 9072-9118): `_doAutoAnalyseAll()` purges `cached_analyses` rows whose auction calendar date is in the past — but only if the URL does not also appear in an upcoming auction entry. This is the primary staleness mechanism.
2. **Content hash** (line 9392-9419): `autoAnalyseOne()` probes the catalogue URL with plain HTTP, hashes the HTML, and skips re-analysis if the hash matches and the cache is < 24 hours old.
3. **Cache TTLs** (tiered by house traffic): high-traffic 12h, medium 18h, low 24h. Expired cache triggers re-analysis on the next 6-hour cycle.
4. **Sold status in DOM extractors**: Many extractors detect `SOLD`, `STC`, `SALE AGREED`, `WITHDRAWN` via regex on bullet text (lines 5085-5363). These are surfaced as bullet tags, and the smart search layer can filter on them (line 3135-3141).

### Gaps

- **No diff detection.** If a lot disappears from the catalogue (removed, not marked sold), the system does not notice — it re-scrapes the whole catalogue and overwrites, so removed lots naturally vanish. But lots marked "SOLD" that remain on the page persist in the directory.
- **Calendar date is the only hard expiry.** If a house reuses URLs across dates (BidX1, BTG Eddisons), lots from a past auction linger until someone manually cleans the calendar.
- **Sold lots pollute the feed.** Users see "SOLD/STC" lots mixed with available ones. The frontend has no default filter for this.

### Recommended Approach: Three-Layer Freshness

**Layer 1: Auction date auto-expiry (exists, enhance)**
- Already works. Enhance by adding a 48-hour grace period after auction date (some results are posted the day after). After grace period, mark all lots from that catalogue as `status: 'past'` rather than deleting — keeps historical data for analytics.

**Layer 2: Re-scrape diff detection (new)**
Add to `autoAnalyseOne()`, after extracting `rawLots`:
```
// Compare new lot list against cached lot list
const { data: cached } = await supabase.from('cached_analyses').select('lots').eq('url', normalisedUrl).single();
if (cached?.lots) {
  const oldLotNums = new Set(cached.lots.map(l => l.lot));
  const newLotNums = new Set(rawLots.map(l => l.lot));
  const removed = [...oldLotNums].filter(n => !newLotNums.has(n));
  if (removed.length > 0) {
    console.log(`AUTO: ${house} — ${removed.length} lots removed from catalogue`);
    // These lots were likely sold/withdrawn. Don't carry them forward.
  }
}
```
The existing regression guard (line 9654) already protects against false drops (< 50% lot count = keep old data). This diff layer handles the case where a few lots disappear — they should not be carried forward.

**Layer 3: Sold status extraction (exists, standardise)**
- Standardise a `lot.status` field across all DOM extractors: `'available'`, `'sold'`, `'stc'`, `'withdrawn'`, `'prior'` (post-auction but no result yet).
- Parse from the existing bullet patterns (`SOLD/STC`, `WITHDRAWN`, `SALE AGREED`).
- Default frontend filter to `status !== 'sold' && status !== 'withdrawn'` — show available and STC by default, let users toggle to see sold.
- This is a data normalisation task, not an architecture change. Each DOM extractor needs a 2-line addition.

### No New Infrastructure Needed
All three layers work within the existing 6-hour `autoAnalyseAll()` cycle and Supabase storage. No queues, no workers, no new tables.

---

## Deal Stacking Module Design

### Goal
A calculator that takes a lot's data + user inputs (GDV, works cost, legal, expected rental) and outputs: SDLT, finance costs (from real Bridgematch lender data), total cost in, profit, ROI, cash-on-cash return.

### Current State

1. **`calcSDLT(price)`** (index.html line 2461) — investor SDLT rates 2025/26, frontend-only. Correct and tested.
2. **`calcDealAnalysis(guidePrice, streetAvg, grossYield, monthlyRent)`** (index.html line 2471) — basic calculator using hardcoded assumptions (75% LTV, 0.75%/mo rate, 4% other costs). No real lender data.
3. **Bridgematch Lite** (`bridgematch-lite.html`) — full lender matching engine with ~60 embedded lenders, plus live data feed from `https://www.bridgematch.co.uk/api/lenders-lite`. Contains `matchLenders()` function that does per-lender LTGDV calculation, LTV matching, geographic exclusions, property type filtering.

### Recommended Approach: Frontend-First with API Fallback

**Primary: All calculation runs client-side.** Rationale:
- SDLT is deterministic from price — already works client-side.
- Finance cost calculation needs lender data, but `bridgematch-lite.html` already loads it client-side from the `/api/lenders-lite` endpoint. The same data can be fetched in `index.html`.
- No server round-trip needed for calculation. Keeps the deal stacker instant and interactive (user adjusts GDV slider, sees ROI update immediately).
- No additional server load or rate limiting concerns.

**Architecture:**

1. **Lender data source:** Fetch from `https://www.bridgematch.co.uk/api/lenders-lite` at page load (same as `bridgematch-lite.html` does at line 382). Cache in a global `window._lenderData` variable. Fall back to a minimal embedded snapshot if fetch fails.

2. **New function `calcDealStack(params)`** replaces `calcDealAnalysis()`:
   ```
   Input:
     purchasePrice     — from lot.price (prefilled)
     gdv               — user input (default: streetAvg or purchasePrice * 1.2)
     worksCost         — user input (default: 0)
     legalCosts        — user input (default: purchasePrice * 0.015)
     expectedRent      — user input (default: lot.estMonthlyRent)
     loanTermMonths    — user input (default: 12)
     propertyType      — from lot.propType
     isRefurb          — derived from worksCost > 0

   Calculation:
     1. SDLT = calcSDLT(purchasePrice)
     2. Run matchLenders() from bridgematch-lite logic against lender data
        → pick the best-fit lender (highest LTV that matches property type + price range)
        → extract: day1Advance, interestRate, procFee, LTGDV
     3. loanAmount = purchasePrice * bestLender.ltv
     4. interestCost = loanAmount * bestLender.rate * loanTermMonths
     5. totalCostIn = purchasePrice + SDLT + worksCost + legalCosts + interestCost + procFee
     6. deposit = purchasePrice - loanAmount + SDLT + worksCost + legalCosts
     7. netProfit = gdv - totalCostIn
     8. roi = netProfit / deposit * 100
     9. cashOnCash = (expectedRent * 12 - interestCost) / deposit * 100  (if BTL hold)
     10. lenderCount = number of lenders that match (for the "X lenders would fund this" badge)

   Output:
     { sdlt, loanAmount, lenderName: '[masked]', lenderCount, interestCost,
       totalCostIn, deposit, netProfit, roi, cashOnCash, monthlyProfit }
   ```

3. **UI location:** Expand the existing lot detail panel. When a user clicks a lot, show a "Deal Stacker" section below the lot details. Prefill known values, let user edit GDV/works/legal/rent. Show real-time results as they type.

4. **Gating:** Deal stacking is a premium feature. Free users see the UI but results are blurred (consistent with existing AI field blurring pattern). Lender names are always masked (per existing policy, line 94 of PROJECT.md).

### Why Not a Server Endpoint?

- The `matchLenders()` logic is already proven client-side in `bridgematch-lite.html`.
- Server endpoint would add latency, require auth, rate limiting, and an additional API contract to maintain.
- The only scenario requiring a server endpoint: if lender data becomes too large to embed or if calculation logic needs to be proprietary. Neither applies today (~60 lenders, ~50KB).
- **Exception:** If a future "bulk deal stack all lots" feature is added (e.g., auto-score fundability for every lot in a catalogue), that should run server-side during enrichment. But for the MVP, per-lot client-side is correct.

### Bridgematch Lender Data Integration

The `bridgematch-lite.html` live feed pattern (line 382) is the template:
```js
const r = await fetch('https://www.bridgematch.co.uk/api/lenders-lite');
const lenders = await r.json();
```
Port the `matchLenders()` function and its helpers (`parseLTV`, `parseMoney`, `parseRate`, `parseProcFee`, `estimateNetFromGross`) from `bridgematch-lite.html` into `index.html`. These are ~250 lines of pure functions with no dependencies.

---

## Alerting & Monitoring Approach

### Goal
Get notified when auto-analyse fails, discovery misses catalogues, or scraping breaks — without adding a dedicated monitoring service.

### Current Monitoring

1. **Sentry** (line 1-10, 8987-8989) — already initialised with `@sentry/node`. Error handler attached after all routes. Captures unhandled exceptions and Express errors. `tracesSampleRate: 0.1`.
2. **Resend** (line 1386, 1511, 1557) — already integrated for transactional emails (welcome emails, lead notifications, payment failure notices).
3. **Quality report** (`GET /api/quality-report`) — returns house health, image coverage, cache stats. Machine-readable but not actively monitored.
4. **Cost monitor** (`GET /api/cost-monitor`) — Firecrawl credit usage stats.
5. **Console logging** — extensive structured logging throughout `autoAnalyseAll()` but only visible in Railway logs.

### Recommended Approach: Layered Alerting via Existing Services

**Layer 1: Sentry Alerts (errors, already exists — configure)**
Sentry is already capturing errors but likely not configured with alert rules. Add:
- Alert on `autoAnalyseAll` failure rate (> 3 house failures per cycle)
- Alert on Firecrawl credit exhaustion (`fcCreditExhausted = true`)
- Alert on Gemini rate limit hits (`creditExhausted = true`)
- Use `Sentry.captureMessage()` with level `warning` for non-exception alerts — no new dependencies needed.

Implementation — add to existing code:
```js
// In autoAnalyseAll(), after the analysis loop:
if (failed > ready.length * 0.3) {
  Sentry.captureMessage(`Auto-analysis: ${failed}/${ready.length} houses failed`, 'warning');
}
```

**Layer 2: Email Digest via Resend (daily summary)**
After the midnight `saveDailySnapshot()`, send a digest email using the existing Resend integration:
- Houses with 0 lots (extractor likely broken)
- Houses where lot count dropped > 50% from previous snapshot
- Firecrawl credit usage vs budget
- Image coverage rate
- Any houses that haven't been successfully scraped in > 48 hours

Cost: ~0. Resend free tier = 100 emails/day. One daily digest = 1 email.

Implementation location: at the end of `saveDailySnapshot()` (line ~9004 area), after snapshot data is computed.

**Layer 3: Discord/Slack Webhook (real-time critical alerts)**
For time-sensitive alerts (Firecrawl down, Gemini quota exceeded, zero lots from a major house), add a simple webhook function:

```js
async function alertWebhook(message, severity = 'warning') {
  const url = process.env.ALERT_WEBHOOK_URL;  // Discord or Slack webhook
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `[${severity.toUpperCase()}] ${message}`,  // Discord format
        // For Slack: { text: `[${severity}] ${message}` }
      }),
    });
  } catch (e) { /* non-fatal */ }
}
```

This is ~15 lines. No SDK, no dependency. Fire-and-forget. Add calls at:
- `fcCreditExhausted = true` (line 299)
- `creditExhausted = true` (Gemini rate limit)
- `autoAnalyseAll` completion with failure count > 0
- Regression guard trigger (line 9656)

**Do not add:** Dedicated monitoring services (Datadog, New Relic), PagerDuty, or custom dashboards. The three layers above cover all current needs using services already in the stack.

### Priority Order
1. Sentry alert rules (configuration only, no code changes)
2. Discord/Slack webhook helper (15 lines of code, covers critical real-time alerts)
3. Daily email digest via Resend (moderate effort, highest ongoing value)

---

## Integration Points

### Shared State / Cross-Cutting Concerns

| New Feature | Touches | Depends On |
|---|---|---|
| Portal enrichment | `autoAnalyseOne()`, `cached_analyses` table, Firecrawl credit tracking | Firecrawl API, credit budget, lot postcode data |
| Data freshness | `autoAnalyseAll()`, `cached_analyses` table, DOM extractors | Auction calendar dates, lot extraction pipeline |
| Deal stacking | `index.html` frontend, `bridgematch.co.uk/api/lenders-lite` | Lender data API, lot price/type fields |
| Alerting | `autoAnalyseAll()`, `saveDailySnapshot()`, credit exhaustion handlers | Sentry DSN, Resend API key, webhook URL (new env var) |

### New Environment Variables

| Variable | Purpose | Required |
|---|---|---|
| `ALERT_WEBHOOK_URL` | Discord/Slack webhook for critical alerts | Optional |
| `FC_ENRICHMENT_DAILY_CAP` | Max Firecrawl credits/day for portal enrichment | Optional (default 200) |
| `ALERT_EMAIL` | Recipient for daily digest emails | Optional (default: admin) |

### Database Changes

No new tables needed. Extend existing:
- `cached_analyses.lots[].portalData` — enrichment data stored in lot JSON (no schema change, JSONB column)
- `cached_analyses.lots[].status` — normalised lot status (`available`, `sold`, `stc`, `withdrawn`)
- `cached_analyses.enriched_at` — timestamp of last portal enrichment (new column, nullable)

### Supabase Migration

```sql
ALTER TABLE cached_analyses ADD COLUMN IF NOT EXISTS enriched_at timestamptz;
```

One column. The rest is JSONB field additions inside the existing `lots` column.

---

## Suggested Build Order

Based on dependencies, effort, and user value:

### Phase 1: Alerting (1-2 days)
**Why first:** Zero risk, immediate operational value. You need visibility before changing the pipeline.
1. Configure Sentry alert rules (no code)
2. Add `alertWebhook()` helper + calls at credit exhaustion and autoAnalyse failure points
3. Add `ALERT_WEBHOOK_URL` env var to Railway

### Phase 2: Data Freshness (2-3 days)
**Why second:** Improves data quality for existing users before adding new features.
1. Standardise `lot.status` field across DOM extractors (bulk find-and-replace in `DOM_EXTRACTORS`)
2. Add diff detection in `autoAnalyseOne()` (removed lot handling)
3. Default frontend to hide sold/withdrawn lots
4. Add 48-hour grace period to auction date expiry

### Phase 3: Deal Stacking MVP (3-5 days)
**Why third:** High-value premium feature, drives subscription upgrades.
1. Port `matchLenders()` + helpers from `bridgematch-lite.html` into `index.html`
2. Add lender data fetch on page load
3. Build `calcDealStack()` function
4. Build deal stacker UI in lot detail panel
5. Gate behind premium tier

### Phase 4: Portal Enrichment (5-7 days)
**Why last:** Highest risk (portal scraping fragility), highest credit cost, depends on stable pipeline.
1. Build `enrichFromPortals()` function with Zoopla scraping via Firecrawl markdown format
2. Add credit ceiling and per-lot enrichment caching
3. Wire into `autoAnalyseOne()` post-upsert
4. Display portal data in lot detail panel (comps, rental estimates)
5. Monitor credit burn rate for 1 week before expanding to Rightmove

**Total estimated effort: 11-17 days**, with each phase independently shippable and valuable.
