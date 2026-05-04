# Firecrawl Extractor Playbook

How we use Firecrawl to scrape auction houses, and what every per-house extractor needs to declare. Read this before adding or refactoring a house.

This document is what I learned the hard way scraping Pattinson, cross-referenced with Firecrawl's full v2 docs. The Pattinson section at the bottom is the concrete worked example.

---

## Mental model shift

The old DOM extractor was **code** — a CSS-selector IIFE that ran in JSDOM/Puppeteer.

The new Firecrawl-native extractor is mostly **data** — a per-house profile that declares which Firecrawl primitive to use and how to configure it. The extraction itself is done by Firecrawl's LLM against a JSON schema.

This means a per-house extractor is now a small config object plus an optional thin orchestrator. Most fields are reusable across houses; only the quirky ones differ.

---

## Pick the right primitive

Firecrawl has six endpoints. Pick the one that fits, don't force everything through `/v2/scrape`.

| Job | Endpoint | When |
|---|---|---|
| One known page | `/v2/scrape` | Default. Sync. 1 credit base + 4 for JSON mode. |
| List of N known URLs (paginated catalogue) | `/v2/batch/scrape` | **Always** for catalogue pagination. Async, parallel, one job ID. |
| Recursive crawl from a root | `/v2/crawl` | When you don't know all URLs and the site links them. Async. |
| URL discovery only | `/v2/map` | Sitemap + SERP + cache lookup. 1 credit per call regardless of links returned. |
| "I don't know which sites have this" | `/v2/agent` | Autonomous research. Default `spark-1-mini`, 60% cheaper than Pro. Dynamic credits. |
| Login / click / fill flows | `/v2/scrape` then `/v2/interact` | Stateful browser session. 7 credits/min with prompts, 2 credits/min code-only. |
| Local PDFs / DOCX | `/v2/parse` | Multipart upload, up to 50 MB. |

The single biggest mistake in the old codebase pattern was using `/v2/scrape` 84 times in a sequential loop when `/v2/batch/scrape` does it in one call with `maxConcurrency` control.

---

## The cost model (memorize this)

| Operation | Credits |
|---|---|
| Base scrape | 1 / page |
| JSON-schema extraction (LLM) | +4 / page |
| Enhanced proxy (`proxy: 'enhanced'`) | +4 / page |
| ZDR (Enterprise) | +1 / page |
| Map | 1 / call |
| changeTracking — `git-diff` mode | free |
| changeTracking — `json` mode | +5 / page |
| PDF parsing | 1 / PDF page |
| Audio extraction | +4 / page |
| Agent | dynamic, default cap 2,500 credits/run |
| Cached hit (`maxAge` window) | 1 / page (still charged, just faster) |

**Sanity check for catalogue scraping:** 1 base + 4 JSON = 5 credits/page. A house with 84 pages of listings costs ~420 credits per full pass. Trivial against a 500k budget. Stop optimizing for credits — optimize for reliability and recall.

---

## The defaults will hurt you

Firecrawl's defaults are tuned for the average site. Auction sites are not the average site. Things that bit me:

### `waitFor` is dangerous

On at least one anti-bot SPA (Pattinson), setting `waitFor` to *any* non-zero value caused Firecrawl to silently drop the TCP connection mid-request — `UND_ERR_SOCKET`, `bytesRead: 0`, no HTTP response. Removing `waitFor` and instead bumping the request-body `timeout` to 120000 fixed it.

**Rule:** never set `waitFor` blindly. Probe without it first. Only add it if scrapes return empty content (genuine SPA hydration delay) AND removing it doesn't fix the problem.

**Bonus:** `waitFor` is one of the parameters that must match exactly for a cache hit. Setting it differently across runs defeats `maxAge` caching even when it works.

### `timeout` defaults to 60s

That's fine for static pages, often too short for JS-heavy SPAs. For SPA catalogues bump to `120000`. Max is `300000`. Set it explicitly per house.

### `proxy: 'auto'` is the right default

`auto` tries basic first, retries with enhanced on failure. Don't pre-emptively set `enhanced` — it's 5 credits/page and rarely the actual problem. If `auto` fails, the *real* fix is usually to remove `waitFor`, increase `timeout`, or change the URL pattern, not to throw enhanced proxies at it.

### `onlyMainContent` strips lot listings on some sites

Default is `true`. If lot cards live in a sidebar or `<aside>`, they'll get nuked. Set `false` when in doubt during the probe phase.

### Cache busts for unobvious reasons

`maxAge` is bypassed entirely when the request includes any of: `actions`, custom `headers`, a `profile`, `changeTracking`, or custom `screenshot` viewport. So if you add changeTracking later, the cache stops helping you. Plan for that.

---

## The recall problem

This is the single hardest gotcha. JSON-schema extraction *under-extracts*. On a page that has 20 lot cards in the rendered markdown, the LLM will reliably pull only 6–10 of them into the JSON payload.

### What doesn't work

- ❌ `minItems: 20` — the LLM will hallucinate fake entries to satisfy it
- ❌ `maxItems: 20` — has no effect on what it returns
- ❌ Vague schema descriptions — "list of lots" gets you partial recall
- ❌ Adding more fields to the schema — actively hurts (LLM gives up sooner)

### What does work

- ✅ Add a **`prompt`** alongside the schema: *"Extract ALL property listings visible on the page. Do not skip any. There should be approximately 20 lots per page."*
- ✅ **Keep schemas small** — split a 30-field schema into two requests of 10–15 fields each
- ✅ Use **`enum` arrays** for constrained string fields (e.g. `lot_status`)
- ✅ Add **null-handling** in field descriptions: *"Return null if not found on the page."*
- ✅ Add **location hints**: *"Guide price from the green badge in the top-right corner of each card."*
- ✅ Use **`"type": "array"`** for lists — `"type": "object"` returns one item

### The two-pass fallback

When prompt-tuning isn't enough, fall back to two passes:

1. **Pass 1** — JSON schema scrape of the listing page. Get the lots the LLM extracted (usually 10/20).
2. **Pass 2** — parse the markdown for the URL pattern of detail pages (e.g. `/property/(\d+)`). Diff against the IDs already in the JSON. For the missed IDs, do per-detail-page scrapes (these are usually trivial — detail pages don't have the SPA recall problem because they have one set of fields, not a list).

This is what `lib/scraper/pattinson.js` should do.

---

## changeTracking: the killer feature for recurring scrapes

Until now, the AuctionBrain pipeline diffed scrapes manually via `lot_history.snapshot_hash`. With `changeTracking`, Firecrawl does the diff and tells you per-page whether it's `new`, `same`, `changed`, or `removed`.

### How to use it

```js
formats: [
  { type: 'json', schema: CATALOGUE_SCHEMA },
  'markdown',
  { type: 'changeTracking', tag: 'pattinson-daily' }
]
```

- **`markdown` is required** alongside `changeTracking` — the comparison is done on the markdown
- **`tag`** scopes the comparison history. Different tags = independent histories. So `pattinson-daily` and `pattinson-hourly` track separately.
- **Snapshots are persistent** — they don't expire. A scrape three months later still compares against the previous one.
- **Scoped to the team**, not the user.

### Modes

| Mode | Cost | Output |
|---|---|---|
| (none) | free | Just the `changeStatus` flag (`new`/`same`/`changed`/`removed`) |
| `git-diff` | free | Line-level diff of the markdown, plus structured JSON of the changes |
| `json` | +5 credits/page | Field-level extraction of `{ previous, current }` pairs against a schema |

For most houses, `git-diff` is the right default. Use `json` mode when you need structured deltas (e.g., guide price changed from £X to £Y).

### Implication for the pipeline

A daily run with `changeStatus: 'same'` can short-circuit the entire scrape→extract→enrich pipeline for that page. We already do this with content hashes; changeTracking is simpler and cheaper.

`changeTracking` requests **bypass `maxAge` caching**. Both can't be on simultaneously.

---

## Per-house profile shape

Each house should declare a profile object. Fields:

```js
{
  slug: 'pattinson',
  displayName: 'Pattinson',
  baseUrl: 'https://www.pattinson.co.uk/auction/property-search',

  // ── Which primitive ──
  primitive: 'batch_scrape',  // 'scrape' | 'batch_scrape' | 'crawl' | 'map' | 'agent'

  // ── Pagination ──
  pagination: {
    style: 'query',           // 'query' | 'path' | 'sitemap' | 'crawl' | 'offset' | 'api'
    queryParam: 'p',          // for 'query'
    totalPages: 84,           // hardcoded ceiling, OR …
    detectTotalPages: (md) => { /* parse "1673 results" → ceil(/20) */ },
  },

  // ── Firecrawl request body ──
  scrape: {
    formats: [
      { type: 'json', schema: 'CATALOGUE_SCHEMA' },
      'markdown',
      { type: 'changeTracking', tag: 'pattinson-daily' }
    ],
    timeout: 120000,            // explicit
    waitFor: undefined,         // explicit: DO NOT SET
    proxy: 'auto',              // explicit default
    onlyMainContent: true,
    maxAge: 0,                  // disabled when changeTracking is on anyway
  },

  // ── Schema tuning ──
  schemaTuning: {
    promptAddendum: 'Extract ALL property listings visible on the page. Do not skip any. There should be approximately 20 lots per page.',
    expectedItemsPerPage: 20,
  },

  // ── Recall fallback ──
  recall: {
    detailUrlPattern: /\/property\/(\d+)/g,
    detailUrlBuilder: (id) => `https://www.pattinson.co.uk/property/${id}`,
    detailSchema: 'DETAIL_SCHEMA',
    minRecoveryRatio: 0.9,    // if we recover <90% of markdown IDs, alert
  },

  // ── Concurrency / rate limit ──
  concurrency: {
    maxConcurrency: 10,        // for batch_scrape
    delayMs: 1500,             // for sequential fallback
  },

  // ── Failure handling ──
  retry: {
    onCodes: ['UND_ERR_SOCKET', 'fetch failed', /^5\d\d/, 'timeout', 'abort'],
    backoffMs: [2000, 4000, 8000],
    maxAttempts: 3,
  },

  // ── Manifest contract ──
  manifest: {
    extractStrategy: 'firecrawl-json+detail-backfill',
    expectedFields: ['address', 'guide_price', 'detail_url', 'image_url'],
  },
}
```

What this gives you:
- A house's "extractor" is now a **diff against the default profile**, often just 3–4 fields.
- The scrape orchestrator (`lib/scraper/firecrawl.js` + a thin per-house module) reads the profile and constructs the right Firecrawl request.
- Quirks live in code review, not folklore.

---

## Probe before you build

Don't write the profile blind. Spend 10 minutes probing every new house:

1. **`/v2/map`** the domain. Does it return useful URLs? Are detail pages discoverable?
2. **`/v2/scrape`** the listing page, **markdown only, no waitFor, default timeout**. Does it return content? How many `/property/{id}`-style URLs in the markdown?
3. **`/v2/scrape`** with JSON schema. Compare lot count vs the markdown URL count. That tells you the recall ratio.
4. **Find the pagination pattern** in the rendered HTML — search for `?page=`, `?p=`, `/page-N`, etc. Eyeball the first 5–10 pagination links.
5. **Try `?p=2` directly** with markdown only. Confirm it returns different lots than page 1.
6. **Look for an API endpoint** in the network tab (or in the rendered `__NEXT_DATA__` blob via `executeJavascript` action). If the site has a JSON API, prefer that — it's the Allsop pattern, near-100% recall, no LLM cost.

Only after these six probes pass do you write the profile.

The probe is cheap — about 10 credits total — and it's the difference between a 2-hour build and a 2-day debug session.

---

## Failure modes to watch for

| Symptom | Likely cause | Fix |
|---|---|---|
| `UND_ERR_SOCKET`, `bytesRead: 0` | `waitFor` triggering anti-bot timeout at Firecrawl edge | Remove `waitFor`, set `timeout: 120000` |
| HTTP 200 + `success: false` + cryptic error | Schema rejected (often too large) | Split schema into smaller requests |
| HTTP 200, `lots: []`, 1.2 MB rawHtml | LLM gave up, schema too complex or page too long | Add `prompt`, simplify schema, or use markdown + ID parsing |
| Same page returns different lot counts each call | LLM non-determinism | Add `prompt: "Extract ALL listings"`, accept some variance |
| `403` on direct fetch but Firecrawl works | Site blocks direct HTTP — no problem, that's why we use Firecrawl | Don't fall back to plain HTTP |
| `402` / `429` from Firecrawl | Credit / rate exhaustion | Existing `ResourceBudget` handles this; check `lib/resource-budget.js` |
| Map returns 0 URLs | Site has no sitemap and SERPs are weak | Crawl from root with `/v2/crawl` instead |
| Crawl returns 0 pages | Starting URL doesn't match `includePaths` | Loosen `includePaths` or use `regexOnFullURL` |

---

## Deprecations to clean up

- **`/v2/extract` is deprecated.** Use `/v2/agent` instead. Existing `agentExtract()` in [lib/scraper/firecrawl.js:272](../lib/scraper/firecrawl.js) hits the deprecated endpoint — migrate when convenient.
- **`jsonOptions` (v1)** doesn't exist in v2. Schemas now live inside the format object: `formats: [{ type: 'json', schema: {...}, prompt: '...' }]`.
- **DOM extractor IIFEs** in `lib/extractors/houses/*.js` are being retired in favor of profiles. Don't add new ones unless the site has *no* viable Firecrawl path (rare).

---

## Worked example: Pattinson

Concrete numbers from the live probe (2026-05-04):

| Aspect | Value |
|---|---|
| Listing URL | `https://www.pattinson.co.uk/auction/property-search` |
| Total lots | 1,673 (shown in markdown header) |
| Total pages | 84 |
| Lots per page | 20 (page 1–83), 13 (page 84) |
| Pagination | `?p=N` (NOT `?page=N`) |
| `waitFor` behaviour | **DROPS THE CONNECTION** at any value |
| `timeout` needed | 120,000 ms |
| Detail URL pattern | `/property/(\d+)` |
| JSON recall | ~50% (10/20 per page) |
| Field coverage on extracted lots | 100% |
| Direct `fetch` to listing | 403 (anti-bot) |
| Direct `fetch` to detail page | 403 |
| `/v2/map` works | yes — but only ~50 URLs total |
| `/v2/scrape` on listing | works without `waitFor`, with `timeout: 120000` |
| `/v2/scrape` on detail page | works with defaults |

Profile diff against defaults:

- `pagination.queryParam: 'p'` (not `'page'`)
- `pagination.totalPages: 84`
- `scrape.timeout: 120000`
- `scrape.waitFor: undefined` (with a comment explaining why)
- `recall.detailUrlPattern: /\/property\/(\d+)/g`
- `schemaTuning.promptAddendum`: the "extract ALL listings" boilerplate

That's it — five fields. The rest is shared with every other house.

Cost per full run: ~420 credits for the listing pass + up to ~840 credits for missing-ID detail backfill = ~1,260 credits per full daily refresh. Once `changeTracking` is on, only `changed`/`new` pages need detail backfill, dropping the steady-state cost dramatically.

---

## Checklist for new houses

When adding a house, work through this in order:

1. [ ] Run the 6-step probe above
2. [ ] Decide which primitive (`scrape` / `batch_scrape` / `crawl` / `map` / `agent`)
3. [ ] Write the profile — start by copying the default and editing only the diff
4. [ ] Add the house slug to `HOUSE_ROOTS` in `lib/houses.js`
5. [ ] Add a `getHouseScrapingProfile()` case if pagination quirks need a `paginateAs` value
6. [ ] Wire the profile into `lib/scraper/{slug}.js` (modeled on `lib/scraper/allsop.js` for API-style or `lib/scraper/pattinson.js` for batch-scrape style)
7. [ ] Run a probe on the first 3 pages, check field coverage and recall ratio
8. [ ] If recall < 90%, tune the `promptAddendum` or split the schema
9. [ ] Enable `changeTracking` with a unique `tag`
10. [ ] Add a snapshot test under `tests/snapshots/{slug}.html` *only if* you have a pre-Firecrawl JSDOM extractor as fallback
11. [ ] Confirm the manifest gets stamped with `_extractStrategy: 'firecrawl-json'` (or the relevant variant)
12. [ ] Run for a few days and check `pipeline_alerts` for regressions
