# Scraper Evaluation: Firecrawl vs Apify vs Current Puppeteer

**Date:** 2026-03-14
**Status:** Research complete — no code changes made

---

## 1. Current Puppeteer Setup

### Usage Patterns (6 distinct)

| Pattern | Where | Purpose |
|---------|-------|---------|
| `scrapeWithPuppeteer(url)` | `autoAnalyseAll`, `/api/analyse` | Full-page fetch for JS-rendered sites |
| `acquirePage(url)` | `backfillImagesFromLotPages` | Open individual lot pages for image extraction |
| `autoAnalyseAll` scheduled job | Cron (every 6 hours) | Bulk catalogue scraping across all houses |
| `backfillImagesWithPuppeteer` | Post-scrape step | DOM-based image extraction for JS-rendered catalogues |
| `test-extractor` endpoint | Admin diagnostics | One-off Puppeteer + DOM extraction testing |
| `preferPuppeteer` direct | Per-house config | ~23 houses flagged to always use Puppeteer |

### Scale

- **~42 auction houses** monitored
- **~23 houses** require Puppeteer (JS-rendered or anti-bot)
- **~190-200 page loads** per 6-hour cycle (catalogues + individual lot pages for image backfill)
- **~420 pages/day** across all cycles
- **~12,600 pages/month**

### Current Costs

- **Railway hosting:** Puppeteer runs in the same Node process on Railway
- **No per-page cost** — Puppeteer is free/open-source
- **RAM overhead:** ~200-400MB for Chromium instance, managed via single shared browser with page recycling
- **CPU spikes** during bulk scraping cycles

### Pain Points

- Chromium binary bloats the Docker image (~400MB)
- Memory pressure on Railway (shared process = scraping competes with API serving)
- Fragile: sites change selectors, anti-bot measures evolve
- No built-in retry/proxy rotation
- JS-rendered sites still fail to return images in some cases

---

## 2. Firecrawl

**Website:** firecrawl.dev
**What it is:** Managed scraping API that handles JS rendering, returns clean markdown/HTML/structured JSON.

### Capabilities

| Feature | Support |
|---------|---------|
| JS rendering | Yes (built-in headless browser) |
| Anti-bot bypass | Yes (rotating proxies, browser fingerprinting) |
| Output formats | Markdown, HTML, raw HTML, screenshots, JSON (via LLM extraction) |
| Actions (click/scroll/wait) | Yes — `actions` array supports `click`, `wait`, `scroll`, `executeJavascript` |
| Batch scraping | Yes — `/batch/scrape` endpoint |
| Crawl (follow links) | Yes — `/crawl` endpoint |
| Webhooks | Yes — notify on completion |
| Rate limits | Plan-dependent (free: 10 RPM, paid: higher) |

### Pricing

| Plan | Credits/month | Cost | Per-credit |
|------|--------------|------|------------|
| Free | 500 (one-time) | $0 | — |
| Hobby | 3,000 | $16/mo | $0.0053 |
| Standard | 100,000 | $83/mo | $0.00083 |
| Growth | 500,000 | $333/mo | $0.00067 |

**Credit usage:**
- 1 credit per page (scrape)
- 5 credits per page (crawl — follows links)
- +4 credits per page for JSON/LLM extraction

### Cost Estimate for Our Usage

| Scenario | Pages/month | Credits needed | Plan required | Cost |
|----------|-------------|---------------|---------------|------|
| Catalogues only | ~5,040 | ~5,040 | Standard | $83/mo |
| + lot page image backfill | ~12,600 | ~12,600 | Standard | $83/mo |
| + JSON extraction | ~12,600 | ~63,000 | Standard | $83/mo |
| Peak (with retries) | ~15,000 | ~15,000 | Standard | $83/mo |

**Standard plan ($83/mo) covers our needs with comfortable headroom (100k credits vs ~15k used).**

### Fit Assessment

**Strengths:**
- Eliminates Puppeteer/Chromium entirely from our server
- JS rendering handled automatically — fixes the core image problem
- `actions` support means we can scroll to trigger lazy loading, click "load more" buttons
- `executeJavascript` action lets us run our existing DOM extraction logic remotely
- Batch endpoint suits our `autoAnalyseAll` pattern well
- Anti-bot/proxy rotation included — no maintenance burden
- Reduces Railway RAM usage significantly

**Weaknesses:**
- Recurring cost ($83/mo) vs free Puppeteer
- API dependency — if Firecrawl is down, our scraping stops entirely
- Latency: API call + their rendering is likely slower per-page than local Puppeteer
- Our DOM extraction logic (`extractWithDOM`) runs custom JS in-page — would need `executeJavascript` action or post-processing of returned HTML
- Credit-based model means unexpected spikes (new houses, retries) could exhaust quota
- 100k credits/mo is generous but crawl mode (5 credits/page) would eat into it fast

### Integration Effort

**Moderate.** Replace `scrapeWithPuppeteer()` and `acquirePage()` with Firecrawl API calls. The `extractWithDOM()` logic would either:
- (a) Run via Firecrawl's `executeJavascript` action (ideal — zero local processing), or
- (b) Run locally against the HTML returned by Firecrawl (fallback)

`autoAnalyseAll` would use the batch endpoint. Estimated: **1-2 days of dev work**.

---

## 3. Apify

**Website:** apify.com
**What it is:** Cloud platform for running web scraping "Actors" (containerised scripts). Supports Puppeteer, Playwright, and Cheerio via their Crawlee framework.

### Capabilities

| Feature | Support |
|---------|---------|
| JS rendering | Yes (via Puppeteer/Playwright Actors) |
| Anti-bot bypass | Yes (proxy rotation, browser fingerprinting, residential proxies available) |
| Pre-built Actors | 3,000+ in store — but **no property-auction-specific Actors found** |
| Custom Actors | Yes — write your own using Crawlee (Node.js), deploy to Apify cloud |
| Scheduling | Built-in cron scheduling |
| Storage | Key-value store, datasets, request queues |
| Webhooks | Yes |
| API access | Full REST API |

### Pricing

| Plan | Included | Cost |
|------|----------|------|
| Free | $5/mo platform credits | $0 |
| Starter | $29/mo platform credits | $29/mo |
| Scale | $99/mo platform credits | $99/mo |

**Compute units (CU):** 1 CU = 1 GB RAM x 1 hour = ~$0.25-0.30

### Cost Estimate for Our Usage

Assumptions: each page takes ~30 seconds in a Puppeteer Actor with 1GB RAM.

| Metric | Value |
|--------|-------|
| Pages/day | ~420 |
| Time per page | ~30s |
| RAM per Actor | 1 GB |
| CU/day | ~3.5 |
| CU/month | ~105 |
| **Monthly cost** | **~$26-32** |

This fits within the **Starter plan ($29/mo)** or just above it.

### Fit Assessment

**Strengths:**
- Cheaper than Firecrawl (~$29/mo vs $83/mo)
- We can port our exact Puppeteer logic into a custom Actor — minimal rewrite of scraping logic
- Built-in scheduling could replace our `setInterval`-based `autoAnalyseAll`
- Proxy rotation and anti-bot included
- Eliminates Chromium from Railway (same benefit as Firecrawl)
- Crawlee framework adds automatic retries, request queues, error handling

**Weaknesses:**
- **Significant upfront work:** No pre-built auction Actor — we'd need to write and maintain a custom Actor
- Custom Actor = we still own the Puppeteer/DOM extraction code, just running it elsewhere
- More moving parts: Apify platform + API calls + webhook handling + data retrieval
- Debugging is harder (remote execution, logs in Apify console)
- Vendor lock-in to Apify's Actor framework (Crawlee)
- Cost is per-compute-time, so slow/complex pages cost more unpredictably

### Integration Effort

**High.** We'd need to:
1. Write a custom Crawlee Actor that replicates our scraping + DOM extraction
2. Deploy it to Apify
3. Replace `autoAnalyseAll` with Actor runs + webhooks to receive results
4. Handle data flow: Apify dataset → our Supabase tables
5. Estimated: **3-5 days of dev work** + ongoing Actor maintenance

---

## 4. Comparison Matrix

| Factor | Puppeteer (current) | Firecrawl | Apify |
|--------|-------------------|-----------|-------|
| **Monthly cost** | $0 (bundled in Railway) | ~$83 | ~$29 |
| **JS rendering** | Yes | Yes | Yes |
| **Anti-bot/proxies** | No | Yes (included) | Yes (included) |
| **Eliminates Chromium** | No | Yes | Yes |
| **Integration effort** | N/A (current) | 1-2 days | 3-5 days |
| **Maintenance burden** | High (selectors, anti-bot, memory) | Low (managed) | Medium (custom Actor) |
| **Reliability** | Medium (memory issues, crashes) | High (managed infra) | High (managed infra) |
| **Flexibility** | Full (local code) | Medium (API + actions) | Full (custom code) |
| **Vendor dependency** | None | High | High |
| **Image extraction** | Works (when configured) | Works (returns HTML) | Works (same logic) |
| **Batch processing** | Manual | Built-in batch API | Built-in scheduling |
| **Latency per page** | ~5-15s | ~10-30s (network overhead) | ~10-20s |

---

## 5. Recommendation

### Short term: **Stay with Puppeteer, fix what we have**

The recent image backfill improvements (Puppeteer-based DOM extraction, cache clearing, diagnostics endpoint) address the immediate pain point. The current setup handles ~420 pages/day adequately on Railway, and the cost is $0.

### Medium term (if scaling or reliability becomes an issue): **Firecrawl**

**Firecrawl is the stronger choice** over Apify for our use case because:

1. **Simplest integration** — drop-in replacement for `scrapeWithPuppeteer()`. We call their API, get HTML back, run our extraction logic. 1-2 days vs 3-5 days for Apify.

2. **`executeJavascript` action** — we can run our `extractWithDOM()` function remotely in their browser, getting structured lot data back without needing local Puppeteer at all.

3. **Less code to maintain** — with Apify we'd still own all the Puppeteer logic in a custom Actor. Firecrawl abstracts that away entirely.

4. **Anti-bot and proxy rotation included** — this is the biggest long-term maintenance burden with raw Puppeteer, and Firecrawl handles it transparently.

5. **Cost is acceptable** — $83/mo for Standard plan with 100k credits (we'd use ~15k). This buys significant reliability and reduced maintenance.

**Apify** would make more sense if:
- We needed much heavier compute (hundreds of thousands of pages/month)
- We wanted fine-grained control over browser behaviour per auction house
- Cost sensitivity was the primary concern ($29 vs $83)

### Migration path (when ready)

1. Add `FIRECRAWL_API_KEY` to env
2. Create `scrapeWithFirecrawl(url, options)` wrapper function
3. Replace `scrapeWithPuppeteer` calls to use Firecrawl with fallback to local Puppeteer
4. Use `executeJavascript` action to run `extractWithDOM` remotely
5. Once stable, remove Puppeteer dependency entirely
6. Reduces Railway container size by ~400MB and frees ~200-400MB RAM

### Decision criteria for triggering migration

Move to Firecrawl when any of these become true:
- Railway memory pressure causes scraping failures more than once/week
- Anti-bot measures block >10% of our Puppeteer requests
- We add >60 auction houses (doubling current load)
- Railway plan upgrade cost exceeds Firecrawl Standard ($83/mo)

---

*This evaluation is based on publicly available documentation and pricing as of March 2026. No API keys were created or API calls made during this research.*
