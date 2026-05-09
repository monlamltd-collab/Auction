# New Auction House Playbook

How to add a new auction house to Bridgematch. Post-2026-05-08 the pipeline is **Firecrawl-first** — most new houses need only a `HOUSE_ROOTS` entry and a recall sentinel, with zero per-house JS.

---

## Prerequisites

Before starting, gather:
1. The house's **catalogue URL** (the page listing all lots for an upcoming auction).
2. Whether the page renders server-side or as an SPA (View Source: does the lot data appear in the raw HTML?). Firecrawl handles both, but JS-heavy SPAs may need an `executeJavascript` scroll action.
3. A sample lot detail URL — useful for sanity-checking detail-page enrichment.
4. The **canonical display name** (e.g. "My New House Auctions", not "MyNewHouse").

---

## Step 1 — Register the slug in `lib/houses.js`

Add three things, in this order:

```js
// HOUSE_ROOTS — the catalogue URL (where upcoming lots are listed)
mynewhouse: 'https://www.mynewhouse.co.uk/auctions/current',
```

```js
// HOUSE_DISPLAY_NAMES — the human-friendly name used in UI + API responses
mynewhouse: 'My New House Auctions',
```

```js
// detectAuctionHouse() — add a clause BEFORE the final `return 'unknown'`
if (u.includes('mynewhouse.co.uk')) return 'mynewhouse';
```

**Slug rules:** lowercase, no spaces, no separators. `mynewhouse`, not `my-new-house`.

If the catalogue domain differs from the lot-detail domain (mergers, multi-brand sites), include both variants in `detectAuctionHouse()`.

---

## Step 2 — Recall sentinel in `lib/analysis.js` (recommended)

Add a regex to `RECALL_SENTINELS` so the harness can compare lots in Firecrawl markdown vs. lots in the JSON-extract response:

```js
RECALL_SENTINELS.mynewhouse = /Lot\s+(\d+)/i;  // capture group 1 = lot id
```

If the house uses a known platform (EIG, AH UK, Bamboo), `detectPlatformSentinel()` in `lib/analysis.js` auto-detects it — no entry needed.

The sentinel is free observability: one regex, no extractor, no maintenance.

---

## Step 3 — Test the extraction live

Run the Firecrawl probe against the catalogue URL:

```bash
node scripts/test-firecrawl-extract.mjs "https://www.mynewhouse.co.uk/auctions/current"
```

This calls the unified `extractCatalogueListing()` path and prints the parsed lots without persisting. Check:

- **Lot count** — matches what you see on the live page (within ±5%).
- **Address coverage** — all lots have a real address (not a town name, not blank).
- **Price coverage** — most lots have a `price` (some genuinely list "Guide TBA"; that's fine).
- **Image coverage** — most lots have an `imageUrl` that isn't a logo or banner.

If the result is good, you're done with extraction. Skip to Step 5.

If lots are missing or fields are thin, decide between **Step 4a** (markdown recogniser) and **Step 4b** (Firecrawl scrape override).

---

## Step 4a — Per-house markdown recogniser (most common fix)

When Firecrawl JSON misses lots that ARE present in the markdown response, add a recogniser to `HOUSE_OVERRIDES` in `lib/houses.js`:

```js
HOUSE_OVERRIDES.mynewhouse = {
  markdownRecogniser(markdown) {
    const lots = [];
    // walk the markdown, regex-match lot blocks, push { lot, address, price, url, ... }
    // see HOUSE_OVERRIDES.pattinson and HOUSE_OVERRIDES.johnpye for working examples
    return lots;
  },
};
```

The recogniser runs *after* JSON extract; its output is merged with whatever JSON returned (deduped by `(lot, address)` pair). It supplements, it doesn't replace.

**Reference implementations:**
- `HOUSE_OVERRIDES.pattinson` — markdown blocks with bold address + bracketed lot number
- `HOUSE_OVERRIDES.johnpye` — markdown table layout with per-row links

---

## Step 4b — Firecrawl scrape override (rare)

When the page genuinely doesn't render lot data without JavaScript (SPA, lazy-loaded gallery, scroll-triggered hydration), add an entry to `HOUSE_SCRAPE_OVERRIDES` in `lib/scraper.js`:

```js
HOUSE_SCRAPE_OVERRIDES.mynewhouse = {
  preActions: [
    { type: 'wait', milliseconds: 2000 },
    { type: 'scroll', direction: 'down' },
    { type: 'scroll', direction: 'down' },
  ],
};
```

Use sparingly — `executeJavascript` and `preActions` are credit-expensive on Firecrawl. Confirm via the Firecrawl markdown response that the action actually unlocked content before committing.

---

## Step 5 — Mirror in `admin.html`

If the slug needs a friendly name in the admin dashboard's house dropdown / filter, add it to the `friendlyHouseName` map in `admin.html`. Minor and easy to forget; mostly cosmetic.

---

## Step 6 — Run tests + commit

```bash
npm test
```

Must stay green. The test suite no longer has DOM-snapshot tests (those were retired 2026-05-08); current tests cover scoring, fundability, enrichment, manifest, harness, and the frontend shell.

Commit format:

```
feat: add mynewhouse auction house (N lots)
```

If you added a markdown recogniser:

```
feat: add mynewhouse auction house with markdown recogniser
```

---

## Step 7 — Verify in production

After deploy:

1. Hit `POST /api/admin/rescrape { slug: "mynewhouse" }` with the admin secret to trigger a fresh scrape.
2. Wait ~120s for the scrape to land.
3. `SELECT count(*), count(DISTINCT image_url), count(DISTINCT address) FROM lots WHERE house = 'mynewhouse';` — counts should look healthy.
4. Open the live frontend at auctions.bridgematch.co.uk and filter by the new house — sanity-check three lots visually.

---

## Common gotchas

- **Slug-case duplication** — `persist-lots.js` lowercases the slug at upsert; if you see both `MyNewHouse` and `mynewhouse` in `lots`, an old row pre-dates the guard. Run `UPDATE lots SET house = lower(house) WHERE lower(house) = 'mynewhouse'`.
- **Hero-image bleed** — if all lots get the same image, the JSON extract grabbed a banner. Check `lib/scraper/lot-schema.js` — the prompt should explicitly reject logos. The runtime guard in `persist-lots.js` (`HERO_BLEED_THRESHOLD = 3`) auto-strips repeated URLs across ≥3 distinct addresses.
- **Two-tier discovery** — multi-branch auctioneers (Symonds, John Pye, Stags) often have an "events" listing AND a per-event "lots" listing. Make sure `HOUSE_ROOTS[slug]` points at the *lot-bearing* page. If lots are sparse, look for a `/property/` (or equivalent) link as the catalogue signal.
- **Captcha / Cloudflare** — if Firecrawl hits a captcha page, check whether the same lots arrive under a sibling slug first (it might be a merger, not a captcha). Only add a `HOUSE_SCRAPE_OVERRIDES.preActions` workaround after that check.

---

## What was removed in the 2026-05-08 retirement

For agents reading historical commits or older skill docs:

- `lib/extractors/` directory (per-house DOM extractor IIFEs) — **deleted**
- `lib/extractors/index.js`, `lib/extractors/helpers.js`, `lib/extractors/runner.js` — **deleted**
- `tests/test-extractors.js`, `tests/test-detail-extractors.js` — **deleted**
- `tests/snapshots/{slug}.html` — **deleted**
- `scripts/audit.mjs`, `scripts/audit-fix.mjs` — **deleted**
- Env vars `USE_FIRECRAWL_EXTRACT`, `FORCE_EXTRACT_HOUSES`, `BROKEN_EXTRACTORS` — **gone**
- `DOM_EXTRACTORS` constant — **gone**

Do not reintroduce any of these. The Firecrawl JSON extract path replaces the entire DOM extractor system.
