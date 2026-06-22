# BTG Eddisons — house dossier

| Field | Value |
|---|---|
| **Slug** | `btgeddisons` (formerly the overloaded `sdl` slug — renamed 2026-06-21) |
| **Display name** | BTG Eddisons |
| **Platform** | BTG Eddisons / SDL network — property-world backend behind an EIG widget. The catalogue is **server-rendered static HTML** and is fetched via **plain HTTP** (a browser render lets the EIG widget re-hydrate the grid and drop the inline "Guide Price" labels). |
| **Region** | National |
| **Catalogue URL** | `https://www.btgeddisonspropertyauctions.com/properties/` (`HOUSE_ROOTS.btgeddisons` in `lib/houses.js`); `rewriteUrl` forces `?page=1&limit=500` so the whole catalogue returns in one fetch. |
| **Detection** | `detectAuctionHouse()` routes `btgeddisonspropertyauctions.com` / `btgeddisons` **and** `networkauctions` → `btgeddisons` (`lib/houses.js`) |
| **Status** | Live (~480 active lots, verified 2026-06-22) |
| **Last verified** | 2026-06-22 |

## Lot URL pattern
`https://www.btgeddisonspropertyauctions.com/properties/{id}/for-auction-{location}`
The lot `{id}` ends in a `-DDMMYY` auction-date suffix (e.g. `…-220626` = 22 Jun 2026), which the recogniser parses into `auction_date`.

## Recall sentinel
`/btgeddisonspropertyauctions\.com\/properties\/([a-z0-9_-]+?)\/for-auction/gi`

Declared in `lib/scraper/house-recognisers.js` → `HOUSE_RECOGNISERS.btgeddisons.recallSentinelPattern` (the per-house recogniser pattern is the source of truth for this house).

## Image source
Property photos live in the **static detail-page HTML** under
`https://asta.btgeddisonspropertyauctions.com/.../artnr_{id}/_pictures/….jpg`. The
catalogue listing usually carries only the estate-agent **logo** (a different `artnr`),
which the recogniser rejects — so the catalogue lead image is often empty and the gallery
is filled later by the **multi-image sweep** (which fetches the detail page; the photos are
in the static HTML, so no browser render is needed for images).

## Render / engine needs
`staticCatalogue: true` — fetched via plain HTTP, fed straight to the recogniser. **Do NOT
browser-render** (the EIG widget drops the guide-price labels on hydration). `maxPages: 1`
(the `?limit=500` URL returns everything in one page).

## Recogniser
`recogniseBtgEddisonsLotsFromMarkdown(markdown) → Map<id, lot>` in
`lib/pipeline/firecrawl-extract.js`. Registered in `lib/scraper/house-recognisers.js`
(`HOUSE_RECOGNISERS.btgeddisons`). The lot link renders **twice** per card (image link then
text link) and the "Guide Price: £X" + photo sit in only one window, so the recogniser
**merges fields additively across the two occurrences** (keyed by lot id). Binds the property
photo by the `artnr_{idPrefix}` matching the lot id; rejects the agent logo. Tests:
`tests/test-btgeddisons-recogniser.js`.

## Known incidents
- **Template rebuild (2026-06-14):** BTG rebuilt its listing template → 0 lots since ~31 May.
  Recovered via the `?page=1&limit=500` single-page recogniser. A second regression (each lot
  link rendered twice; price lived in only one window) dropped catalogue price coverage
  92%→16% until the recogniser was made to merge across both windows.
- **`sdl`→`btgeddisons` de-conflation (2026-06-21):** the `sdl` slug had been overloaded across
  three distinct houses (BTG Eddisons + Charles Darrow + SDL Auctions) plus a dead `network`
  slug. BTG Eddisons was carved out as the canonical `btgeddisons` slug; the dead `network`
  lots (191, 0 active) were folded in; `charlesdarrow` and `sdlauctions` became their own houses.
- **Image-throughput fix (Plan 1, 2026-06-21):** btgeddisons galleries were blank not because of
  extraction (photos are in static HTML) but because the daily multi-image sweep was fair-share-
  capped and only reached ~34/run against a fresh ~480-lot catalogue. Fixed with an urgency-first
  sweep (imminent-auction lots bypass the cap) + an on-demand `POST /api/admin/sweep-images`
  drain. The first drain recovered ~208 galleries (98 → 321) on 2026-06-21.
