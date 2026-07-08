# Edward Mellor — house dossier

| Field | Value |
|---|---|
| **Slug** | `edwardmellor` |
| **Display name** | Edward Mellor |
| **Platform** | Own **WordPress** site (`edwardmellor.co.uk`). Server-rendered — plain HTTP, **no browser render needed**. **NOT behind Cloudflare** (a stale skill note said "captcha_block/403"; the real failure was a wrong-tier URL — see Incidents). |
| **Region** | Greater Manchester / North West (+ national lots) |
| **Catalogue URL** | `https://edwardmellor.co.uk/auctions/` (`HOUSE_ROOTS`) — a **two-tier** entry: this landing page lists auction **DATES only** (no lots). Lots live one hop deeper on the soonest upcoming dated page `/auctions/{DDmmmYYYY}` (e.g. `/auctions/22jul2026`). |
| **Detection** | `detectAuctionHouse()` routes `edwardmellor` in the URL → `edwardmellor`. |
| **Status** | Fixed 2026-07-08 (0 → 48 lots, two-tier drill + recogniser); **prod verify pending** (deploy + rescrape; circuit is open). |
| **Last verified** | 2026-07-08 (live: drill → `/auctions/22jul2026`, recogniser 48/48 = 100%). |

## Lot URL pattern
`https://edwardmellor.co.uk/property-for-sale/{id}` (8-digit numeric id).

## Recall sentinel
`/\/property-for-sale\/(\d+)/g` (`RECALL_SENTINELS.edwardmellor`; `HOUSE_RECOGNISERS.edwardmellor.recallSentinelPattern`).

## Two-tier drill + recogniser
Registered in `lib/scraper/house-recognisers.js` as `staticCatalogue: true` with a
`resolveCatalogueUrl` hook (the generic two-tier drill support added to the
staticCatalogue block in `lib/analysis.js`).

- **`resolveEdwardMellorCatalogueUrl(baseUrl, fetchPage, todayIso)`** (`lib/pipeline/firecrawl-extract.js`) — fetches the stable landing page (redirects from `/auction/` are followed), parses the `/auctions/{DDmmmYYYY}` date links, and returns `{ url, auctionDateIso }` for the **soonest date ≥ today**. Returns `null` (→ genuine zero, no Gemini fallback) when no auction is upcoming. Only the soonest date carries lots — later upcoming dates are empty until ~weeks before — so "soonest upcoming only" = the full currently-available set (mirrors symondsandsampson's event-drill rationale).
- **`recogniseEdwardMellorLotsFromMarkdown(markdown)`** (`lib/pipeline/firecrawl-extract.js`) — parses the dated page. Anchors on the full-address text link `[addr](…/property-for-sale/{id})` (deduped by id; the leading-`!` guard excludes the image link's inner), reads beds (first standalone integer of the beds/baths/receptions block), `Guide Price £N`, and the status badge from the forward block, and the photo from the `/search/images/{id}/…` image link just before the card. Covered by `tests/test-edwardmellor-recogniser.js`.

## Image source
Per-lot photo `https://edwardmellor.co.uk/search/images/{id}/320-0-3x2-{ts}.JPG|.png` — the card lead; the rest fill via the multi-image sweep.

## Incidents
- **2026-06-17 → dark:** circuit open, 9 consecutive failures, `zero_lots_no_heal`,
  `extractor_regression` (0 lots, previously 91). Root cause: **wrong-tier catalogue
  URL**. `HOUSE_ROOTS.edwardmellor` was `.../auction/`, which 301s to the `/auctions/`
  landing page — a list of auction **dates**, zero lot links. The pipeline scraped the
  landing → 0 lots → Gemini fallback, which then `429`'d on the dead free-tier
  `gemini-2.5-flash-lite`. The self-healer even detected the real dated URL
  (`house_url_drift_detected → /auctions/22jul2026`) but only healed to the lot-less
  landing page. **No Cloudflare was involved** — the fetch reached Gemini, i.e. Railway
  reads the site fine.
- **2026-07-08 (fix):** two-tier drill (`resolveCatalogueUrl`) + static recogniser,
  all plain HTTP (no Firecrawl — none available — and no Gemini). `HOUSE_ROOTS` retargeted
  to the stable `/auctions/` landing. Live: drill → `/auctions/22jul2026`, 48/48 lots with
  address + guide price + beds + photo. Prod verify = deploy + `POST /api/admin/rescrape
  {edwardmellor}` (bypasses the open circuit, closes on success) → confirm `recall_diagnostic`
  ~100%.

## Lesson
A house whose catalogue "root" is a **date-list landing page** needs a drill to the
soonest dated sub-page — scraping the landing yields 0 lots and looks like a dead
extractor. Confirm the failure with the actual production alert (here: `zero_lots` +
a Gemini `429`, **not** a 403) before assuming Cloudflare; the wrong assumption points
at a residential-proxy fix that isn't needed.
