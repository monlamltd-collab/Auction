# Detail-Page Extraction Refactor

**Goal:** Hydrate lot data from individual lot detail pages (not just shallow catalogue cards) using a per-house declarative depth profile, while cutting Firecrawl spend by switching from 6-hourly catalogue scraping to overnight full passes plus continuous free-tier enrichment.

**Architecture:** Symmetric two-tier extraction — `DOM_EXTRACTORS` for catalogue listings, new `DETAIL_EXTRACTORS` for individual lot pages. A new `EXTRACTION_PROFILE` config in `lib/houses.js` declares per-house catalogue richness (`shell` | `medium` | `rich`) and deep-fetch policy (`always-deep` | `gap-fill` | `never-deep`). The existing `enrichLotsFromLotPages()` is generalised to honour the profile, with overwrite-when-low-confidence rather than gap-fill-only. Scheduling moves to a three-tier model: 03:00 full pass, 30-min free-tier enrichment ticks, hourly daytime status drift checks. New `lot_details` cache table (30-day TTL) and `/api/lot` endpoint for on-demand single-URL analysis.

**Tech Stack:** Node.js 20, Express, Supabase (PostgreSQL), Firecrawl, Puppeteer, JSDOM, Gemini API.

---

## Scope & Phases

| Phase | Deliverable | Files | Risk |
|---|---|---|---|
| 0 | Three-tier scheduling: 03:00 cron full pass, 30-min free enrichment tick, hourly status drift | `server.js`, `lib/analysis.js`, `lib/pipeline/enrichment-wave.js` | Medium — behaviour change |
| 1 | `EXTRACTION_PROFILE` config; classify all 173 houses | `lib/houses.js` | None — additive |
| 2 | `enrichLotsFromLotPages` honours profile; overwrite-low-confidence | `lib/scraper.js` | Low — same code path |
| 3 | `lot_details` cache table + read/write helpers | `migrations/`, `lib/scraper.js`, `lib/supabase.js` | Low |
| 4 | `DETAIL_EXTRACTORS` for Maggs & Allen, Hollis Morgan, FSS Property | `lib/extractors/details/` (new), `lib/extractors/details/index.js` | Low |
| 5 | Remove obsolete image blocklists (Maggs, Hollis, FSS) | `lib/extractors/runner.js`, `lib/scraper.js` | Medium — needs Phase 4 |
| 6 | `POST /api/lot` endpoint — single-URL on-demand analysis | `routes/analyse.js` (or `server.js`) | Low |
| 7 | Telemetry: Firecrawl credits-per-cycle by tier; `/api/cost-monitor` breakdown | `lib/budget.js`, `server.js` | None — observability |

---

## File Map

**Modified:**
- `lib/houses.js` — adds `EXTRACTION_PROFILE` export; ~50 line addition
- `lib/scraper.js` — `enrichLotsFromLotPages` gains profile-aware target filter and overwrite policy; ~30 line modification
- `lib/extractors/runner.js` — strips Maggs/Hollis/FSS image blocklist entries (4 regex literals); cosmetic
- `lib/analysis.js` — `autoAnalyseAll` accepts an opts object `{ tier: 'full'|'free-enrichment'|'status-drift' }` to gate work
- `lib/pipeline/enrichment-wave.js` — splits free passes (1-3) from Firecrawl pass (4)
- `server.js` — replaces `setInterval` with cron-style scheduling; wires `/api/lot`
- `lib/budget.js` — adds `creditsByTier` accumulator; existing `/api/cost-monitor` reads it

**Created:**
- `lib/extractors/details/index.js` — `DETAIL_EXTRACTORS` registry
- `lib/extractors/details/maggsandallen.js` — single-lot detail extractor
- `lib/extractors/details/hollismorgan.js` — single-lot detail extractor
- `lib/extractors/details/fssproperty.js` — single-lot detail extractor
- `lib/extractors/details/runner.js` — `extractLotDetail(html, house, url)` JSDOM harness
- `migrations/2026-04-23-lot-details-cache.sql` — `lot_details` table
- `tests/snapshots/maggsandallen-detail.html` — snapshot for detail extractor test
- `tests/snapshots/hollismorgan-detail.html` — snapshot for detail extractor test
- `tests/snapshots/fssproperty-detail.html` — snapshot for detail extractor test
- `tests/test-detail-extractors.js` — JSDOM-based assertions per snapshot

---

## Per-Phase Detail

### Phase 0 — Three-tier scheduling

**Why:** Firecrawl is the only paid component. 6h cycles waste 75% of spend on unchanged catalogues. Free APIs (EPC, flood, Land Registry, postcodes.io) can run 48× more often at zero cost.

**Schedule:**
- **03:00 UK** — `autoAnalyseAll({ tier: 'full' })`: catalogue scrape + detail-page hydration + image backfill cascade
- **Every 30 min** — `runEnrichmentWave({ freeOnly: true })`: passes 2 (postcode rescue from cached raw text), 3 (EPC/flood/comps/yield) only. Skips passes 1 and 4 (which use Firecrawl).
- **Hourly 09:00–18:00 UK** — status drift check on rotating subset of ~10 lots whose auction is within 7 days. Uses existing `checkStatusDrift` in `lib/harness/sub-agents.js`.
- **Boot retry** — if process restarts, run a free-enrichment tick after 60s, but skip full pass unless `force=true` env or it's been >25h since last full pass.

**Implementation:**
- `server.js`: replace `setTimeout` + `setInterval` block with a small cron helper that checks every minute against UK time
- `autoAnalyseAll` already exists; add `opts.tier` parameter that gates the Firecrawl-heavy paths
- `runEnrichmentWave` already exists; add `opts.freeOnly` parameter

### Phase 1 — `EXTRACTION_PROFILE`

**Default:** every house → `{ catalogue: 'medium', policy: 'gap-fill' }` (current behaviour).

**Overrides:**
- `maggsandallen`, `hollismorgan`, `fssproperty` → `{ catalogue: 'shell', policy: 'always-deep', overwriteFields: ['imageUrl', 'bullets'] }`
- `allsop` → `{ catalogue: 'rich', policy: 'never-deep' }` (API gives everything)
- Houses known to have rich detail pages but cheap catalogues will be classified `shell`/`always-deep` over time as audited

**API:**
```js
// lib/houses.js
export const EXTRACTION_PROFILE = {
  maggsandallen: { catalogue: 'shell', policy: 'always-deep', overwriteFields: ['imageUrl', 'bullets'], maxPerCycle: 80 },
  // ...
};
export function getProfile(slug) {
  return EXTRACTION_PROFILE[slug] || { catalogue: 'medium', policy: 'gap-fill' };
}
```

### Phase 2 — Enrichment honours profile

**Change:** `enrichLotsFromLotPages(lots, concurrency)` becomes `enrichLotsFromLotPages(lots, { house, concurrency })`. Target filter consults `getProfile(house)`:
- `policy === 'never-deep'` → return 0 immediately
- `policy === 'gap-fill'` → current behaviour (lot has empty key field)
- `policy === 'always-deep'` → every lot is a target, up to `maxPerCycle`

**Overwrite policy:** for fields listed in `overwriteFields`, the detail-page value replaces the catalogue value even if catalogue had something. Other fields remain gap-fill (don't clobber good data).

### Phase 3 — `lot_details` cache

**Schema:**
```sql
CREATE TABLE lot_details (
  url TEXT PRIMARY KEY,
  house TEXT NOT NULL,
  html_hash TEXT,
  extracted_data JSONB,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '30 days'),
  source TEXT  -- 'http' | 'firecrawl' | 'puppeteer'
);
CREATE INDEX idx_lot_details_expires ON lot_details(expires_at);
CREATE INDEX idx_lot_details_house ON lot_details(house);
```

**Helpers in `lib/scraper.js`:**
- `getCachedLotDetail(url)` → returns `{ html, extracted_data }` or null
- `cacheLotDetail(url, house, html, extracted_data, source)`

`fetchLotPage()` checks the cache first; if hit and not expired, returns from cache. Saves Firecrawl spend dramatically — same lot is not re-fetched cycle-to-cycle.

### Phase 4 — Detail extractors

**Pattern (mirrors `DOM_EXTRACTORS`):**
```js
// lib/extractors/details/maggsandallen.js
export default `
  (() => {
    const out = {};
    out.address = document.querySelector('h1, .property-title')?.textContent.trim() || '';
    out.images = [...document.querySelectorAll('.gallery img, .property-images img')]
      .map(i => i.src).filter(s => s && !/logo|icon/i.test(s));
    out.imageUrl = out.images[0] || '';
    out.bullets = [...document.querySelectorAll('.features li, .key-features li')].map(li => li.textContent.trim()).filter(Boolean);
    out.tenure = ...; // parse tenure from page
    out.guidePrice = ...; // parse price
    out.viewingDates = [...];
    out.propType = ...;
    out.beds = ...;
    return out;
  })()
`;
```

**Runner:** `extractLotDetail(html, house, url)` in `lib/extractors/details/runner.js`. Mirrors `extractWithJSDOM` — tries house-specific extractor, falls back to existing `enrichLotsFromLotPages` text-regex universal logic.

**Test snapshots:** save real HTML samples under `tests/snapshots/{slug}-detail.html`, assert against expected fields.

### Phase 5 — Remove blocklists

Once detail extractors are returning correct images, the four `maggsandallen.co.uk/images/|hollismorgan.co.uk/images/|fssproperty.co.uk/images/` regex entries become obsolete:
- `lib/extractors/runner.js:256` (skip regex)
- `lib/extractors/runner.js:258-267` (`hollisJunk` strip)
- `lib/extractors/runner.js:274` (recover skip regex)
- `lib/extractors/runner.js:352` (carousel skip regex)
- `lib/scraper.js:1335` (backfill junk regex)
- `lib/scraper.js:1388` (deep backfill junk regex)

### Phase 6 — `/api/lot` endpoint

**Spec:**
```
POST /api/lot
Body: { url: 'https://www.maggsandallen.co.uk/property-details/34534630/-/...' }
Returns: { lot: {...full enriched lot object...}, house, cached: bool }
```

Behaviour:
1. Detect house via `detectAuctionHouse(url)`
2. Check `lot_details` cache; if hit, return enriched immediately
3. Otherwise: `fetchLotPage(url)` → `extractLotDetail(html, house, url)` → `enrichLots([lot], house)` → cache → return

### Phase 7 — Telemetry

Add to `lib/budget.js`:
```js
const _creditsByTier = { full: 0, statusDrift: 0, onDemand: 0, healing: 0 };
budget.recordFirecrawlSpend(tier, n) { _creditsByTier[tier] += n; }
budget.getCreditsByTier() { return { ..._creditsByTier }; }
```

Wire `tier` through `scrapeWithFirecrawl` callsites. Surface in `/api/cost-monitor` response.

---

## Testing Strategy

- **Phase 4** — JSDOM snapshot tests, one per shell house. Pattern follows `tests/test-extractors.js`. Save real-world HTML, assert extractor returns expected `address`, `imageUrl`, `bullets`, `tenure`, `propType`.
- **Phase 0, 2, 3, 6, 7** — wiring/config changes. Smoke test by booting server locally and watching logs for one full cycle. Manual verification of `/api/lot` with the user's example URL.
- **Phase 1, 5** — config/cleanup. No test required; covered by Phase 4 tests passing afterwards.

---

## Rollout & Safety

- Each phase committed atomically. If a phase regresses, revert that single commit.
- Phase 5 (blocklist removal) is last in the chain because it depends on Phase 4 being live.
- Default `EXTRACTION_PROFILE` for unconfigured houses preserves current behaviour — no surprise regressions.
- `lot_details` cache is additive — if read fails, fall back to live fetch. Never blocks the pipeline.
- Scheduling change includes a "boot run" guard: if process restarts and last full pass was >25h ago, run a full pass on boot. Otherwise wait for cron.

---

## Out of Scope

- Detail extractors for the other 170 houses (only the 3 known-shell houses in this milestone)
- Frontend UI for the `/api/lot` flow (backend-only; user can test via curl)
- Removing `lib/pipeline/cache-enrich-stage.js` image cascade (it's still useful as fallback)
- New houses
- Health dashboards beyond cost-monitor
