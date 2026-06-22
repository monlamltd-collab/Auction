# Charles Darrow — house dossier

| Field | Value |
|---|---|
| **Slug** | `charlesdarrow` |
| **Display name** | Charles Darrow |
| **Platform** | Own ASP.NET site (independent — NOT BTG Eddisons / SDL network) |
| **Region** | South West — Devon, Cornwall, Somerset & Dorset |
| **Catalogue URL** | `https://www.charlesdarrow.co.uk/Auctions/` (`HOUSE_ROOTS.charlesdarrow` in `lib/houses.js`) |
| **Detection** | `detectAuctionHouse()` routes `charlesdarrow.co.uk` / `charlesdarrowauctions.com` → `charlesdarrow` (`lib/houses.js`) |
| **Status** | Live |
| **Last verified** | 2026-06-21 |

## Lot URL pattern
`https://www.charlesdarrow.co.uk/propertyInfo/{numericId}/for-sale/{type-slug}/{location}`
(e.g. `/propertyInfo/34493/for-sale/Shop-Commercial-Property,-Mixed-Use,-Investment,-Auctions/Torquay-Devon`)

## Recall sentinel
`/charlesdarrow\.co\.uk\/propertyInfo\/(\d+)/gi`

Provenance: derived from the real rendered catalogue markdown (captured live 2026-06-21
via Crawlee render → `htmlToRecognitionMarkdown`). Declared in two places (matching the
BTG Eddisons convention):
- `lib/scraper/recall-sentinels.js` → `RECALL_SENTINELS.charlesdarrow`
- `lib/scraper/house-recognisers.js` → `HOUSE_RECOGNISERS.charlesdarrow.recallSentinelPattern`

## Image source
Property photos via `https://www.charlesdarrow.co.uk/Modules/Controls/ImageServer.aspx?I={id}_{n}.jpg&T=-1&C=/Images/Im2/1/`.
The recogniser binds the photo whose `I={id}_…` prefix matches the lot id and rejects
the per-card `…/property icon.png` placeholder. Galleries / lead-image misses are
filled later by the multi-image sweep + detail-page fetch.

## Render / engine needs
The `/Auctions/` grid is **AJAX-loaded into `#resultsControl`** — a plain HTTP fetch
returns 0 lots. It needs a browser render (Crawlee → turndown) before the recogniser
runs. The page is paginated ("Page 1 of 24", "Your search returned 142 Properties")
but pagination is `javascript:setCurrentIndex(...)` (no per-page URL), so a single
render yields page 1's ~6 cards; the rest accrue via re-scrape cycles + the detail/
sweep passes. `maxPages: 1` in the recogniser entry.

## Recogniser
`recogniseCharlesDarrowLotsFromMarkdown(markdown) → Map<id, lot>` in
`lib/pipeline/firecrawl-extract.js`. Registered in `lib/scraper/house-recognisers.js`
(`HOUSE_RECOGNISERS.charlesdarrow`). Parses, per card: address (descriptive
`# Auction Lot:` title + `Location:`), guide price (`FH/LH Price: £X Guide Price`),
detail_url, auction_date (`Public Auction d/m/yy` bullet — tolerates the site's
occasional "Pubic Auction" typo), tenure (FH/LH prefix), property_type (`Type:` line),
bullets, and the lead image. Tests: `tests/test-charlesdarrow-recogniser.js`
(fixtures are a real captured-markdown excerpt).

## Known incident
Charles Darrow was **wrongly folded into the `sdl` slug** (the "acquired by BTG
Eddisons, lots flow through btgeddisonspropertyauctions.com" assumption). It is in
fact an **independent** auctioneer with its own `/propertyInfo/` catalogue and
`ImageServer.aspx` photos. De-conflated 2026-06-21: the `sdl`→`btgeddisons` re-slug
carved Charles Darrow out as its own house; **170 zombie lots retired 2026-06-21**.
This onboarding registers the house so its lots can persist under the correct slug.
