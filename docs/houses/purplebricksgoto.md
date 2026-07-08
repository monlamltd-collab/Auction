# Purplebricks / GOTO Properties — house dossier

| Field | Value |
|---|---|
| **Slug** | `purplebricksgoto` |
| **Display name** | Purplebricks (GOTO Properties) |
| **Platform** | GOTO Group online auctions on the **EIG OAS** platform. The catalogue is **server-rendered static HTML** and is fetched via **plain HTTP** (`staticCatalogue`) — a browser render re-hydrates the EIG grid and breaks capture (0 lots), the same failure mode as `btgeddisons`. |
| **Region** | National |
| **Catalogue URL** | `https://purplebricks.gotoproperties.co.uk/search` (`HOUSE_ROOTS`); `rewriteUrl` forces `?pagesize=5000` so the **whole catalogue (~2,867 lots) returns in ONE static fetch** with inline addresses/prices. |
| **Detection** | `detectAuctionHouse()` routes `purplebricks.gotoproperties` → `purplebricksgoto` (`lib/houses.js`) |
| **Status** | Fixed 2026-07-08 (0 → 2,867 lots); **prod verify pending** (deploy + rescrape) |
| **Last verified** | 2026-07-08 (live static page, recogniser 2,866/2,867 = 99.97%) |

## Lot URL pattern
`https://purplebricks.gotoproperties.co.uk/lot/details/{id}` (EIG numeric id).

## Recall sentinel
`/purplebricks\.gotoproperties\.co\.uk\/lot\/details\/(\d+)/gi`
Declared in `lib/scraper/house-recognisers.js` → `HOUSE_RECOGNISERS.purplebricksgoto.recallSentinelPattern`.

## Recogniser
`recognisePurplebricksGotoLotsFromMarkdown` (`lib/pipeline/firecrawl-extract.js`).
Anchors on the address link (`[ ### {address} ](…/lot/details/{id})`); the EIG-CDN
photo (`cdn.eigpropertyauctions.co.uk`) precedes it and is bound to the lot with a
scoped look-back window (no image-bleed from the previous card); price from
`Minimum Opening Bid` / `Guide Price`. Test: `tests/test-purplebricks-recogniser.js`.

## Image source
Featured lots carry an eager EIG-CDN `_web_medium` photo in the static HTML; the rest
are lazy-loaded and fill via the **multi-image sweep** / detail-pass.

## Incidents
- **2026-06-13→18:** went dark — circuit open, `zero_lots_no_heal`, health 0, 9
  consecutive failures. Root cause: forced Puppeteer render broke the SSR EIG grid
  (0 lots); the prior `?page=N` walk had also under-captured (1,124 of 2,867).
- **2026-07-08 (fix):** static-catalogue recogniser + `?pagesize=5000` retarget →
  99.97% recall on the live page (0 → 2,867). Mirrors the `btgeddisons` static fix.
  Prod verify = deploy + `POST /api/admin/rescrape {purplebricksgoto}` (bypasses the
  open circuit and closes it on success), then confirm `recall_diagnostic` ~100%.
