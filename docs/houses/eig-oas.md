# EIG OAS platform — shared dossier (~26 houses)

Covers every house on the **EIG "Online Auction System" (OAS)** handled by the shared
`recogniseEigOasLotsFromMarkdown` recogniser + the paginated static-catalogue path.
One dossier for the whole cluster because the handling is genuinely shared — per-house
differences are only the catalogue URL and whether the house is currently live.

| Field | Value |
|---|---|
| **Platform** | EIG OAS — `{sub}.eigonlineauctions.com/search`, EIG white-labels on custom domains, and `eigpropertyauctions.co.uk/live-stream/auction/{name}` embeds. Server-rendered; fetched via **plain HTTP** (`staticCatalogue` + `paginateStatic`). |
| **Recogniser** | `recogniseEigOasLotsFromMarkdown` (`lib/pipeline/firecrawl-extract.js`) |
| **Registration** | `resolvePlatformRecogniser` → `EIG_OAS_HOUSES` allowlist (`lib/scraper/house-recognisers.js`) |
| **Sentinel** | `EIG_SENTINEL_SRC` — `/lot/(details\|redirect)/({uuid}\|{numeric})` (`lib/scraper/recall-sentinels.js`) |
| **Test** | `tests/test-eig-oas-recogniser.js` (anti-leak contract, 22 assertions) |
| **Status** | Built + verified on branch `feat/eig-current-auction-scoping` 2026-07-09; **prod rescrape pending** |
| **Last verified** | 2026-07-09 (live sweep, forced `?view=List`) |

## The scoping problem (why this is not a plain recogniser)
The EIG `/search` page returns the **full archive** (paulfosh "1-50 of 5,223") behind a
**base64 signed token** — raw `?Order=`/`?auctionId=`/`?status=` params are **ignored**
(verified live; only `pagesize`/`page`/`view`/`showall` are honoured). There is no
server-side way to ask for "current auction only", and every EIG lot otherwise sits on
the `2099-12-31` `always_on` calendar date, which passes `get_active_lots`' date guard.
So a naive extract ships thousands of **ended** lots as live — the exact commandment
violation this cluster guards against.

## How current-auction scoping works (three independent guards)
1. **Recogniser keeps only affirmatively-live lots.** It segments cards by the raw
   `/lot/details/{id}` URL (numeric **or** UUID; strips the per-scrape `?searchToken`)
   and **drops** any card with an ended marker (`Auction Ended` / `View Result` /
   `Result: Sold|Unsold|Withdrawn|Postponed`), a **past** parsed date, or **no positive
   live signal** (future date / live token / guide price). Absence of an ended badge is
   never enough — some themes render a concluded lot as a bare address (landwood
   `/lot/details/170612`).
2. **Real per-lot auction date.** Parsed from the card's `Available Until` / `End Time` /
   `Auction Ends` (DD/MM/YYYY **or** "30 Jul 2026") → kills the 2099 sentinel, so
   `get_active_lots` auto-expires anything that slips past.
3. **Live-boundary pagination.** The paginated static path (`lib/analysis.js`) walks
   `?pagesize&page` **forcing `?view=List`** and stops at the first page with zero live
   lots (the live↔ended boundary) — fetching only the live head, never the archive. On
   zero live it returns a **genuine zero** and does NOT fall through to Gemini (which
   would re-ingest the ended archive as `available`).

## CRITICAL: always List view
The OAS **Grid** view renders compact cards with **no status/date discriminator**, so the
recogniser cannot tell live from ended and keeps everything. `firstforauctions` (whose
`HOUSE_ROOTS` carried `?view=Grid`) would have shipped ~520 mostly-ended lots as live;
forcing `?view=List` scopes it to 48 live with a clean boundary. The path forces List and
drops `?showall`. **Never register an EIG house on a Grid/showall URL.**

## Lot URL / image
- Lots: `…/lot/details/{id}` — id is NUMERIC (paulfosh `186986`) or a **UUID** (tcpa
  `742e9488-…`); may live on a branch subdomain (`eastmidlands.tcpa…`) and carry
  `?searchToken=` (stripped).
- Images: `https://cdn.eigpropertyauctions.co.uk/ams/images/{tenant}/…_web_medium`. Static
  HTML lazy-loads some; the **multi-image sweep** backfills galleries.

## Houses (verified 2026-07-09, `?view=List`)
Live counts move with the auction cycle; "dormant" = between auctions (page-1 all-ended,
0 live — correct, not a miss).

| Slug | Catalogue host | State (2026-07-09) |
|---|---|---|
| `tcpa` | www.townandcountrypropertyauctions.co.uk | **276 live** (multi-branch buy-it-now) |
| `firstforauctions` | online.firstforauctions.co.uk | **48 live** |
| `thepropertyauctionhouse` | thepropertyauctionhouse.eigonlineauctions.com | **27 live** |
| `landwood` | www.landwoodpropertyauctions.com | **39 live** |
| `sageandco` | sageandco.eigonlineauctions.com | **14 live** |
| `harmanhealy` | www.harman-healy.co.uk | **12 live** |
| `hmox` | auctions.hmox.co.uk | **12 live** |
| `brownco` | brownandco.eigonlineauctions.com | 8 live |
| `clarkesimpson` | clarke-simpson.eigonlineauctions.com | 6 live |
| `ahlondon` | ahlondon.eigonlineauctions.com | 6 live |
| `sarahmains` | www.auctionworks.co.uk | 6 live |
| `propertyauctionagent` | propertyauctionagent.eigonlineauctions.com | 3 live |
| `higginsdrysdale` | higginsdrysdale.eigonlineauctions.com | 1 live |
| `paulfosh` | auction.paulfosh.com | dormant (0) |
| `seelauctions` `astleys` `martinpole` `jonespeckover` `lot9` `auctionnorth` `bowensonandwatson` `starpropertyonline` `rogerparry` `sheldonbosley` `benjaminstevens` `henrysykes` | various OAS | dormant (0) |

## Not yet on the shared recogniser (follow-ups)
- **`mchughandco`, `purplebricksgoto`** — already have bespoke recognisers; left as-is.
- **Render / different-URL variants** (still on their legacy path — a known gap, not made
  worse): `cotswoldpropertyauctions` (plain-HTTP fetch fails → needs render),
  `walkersingleton` (root is `/`, not `/search`), `dedmangray` (`/auction/` table embed),
  and the `eigpropertyauctions.co.uk/live-stream/auction/{name}` embeds (`loveitts`,
  `fssproperty`, `cooperandtanner` — no `/lot/details` on the page). Onboard by giving
  each the correct OAS `/search` URL or a Crawlee-render fetch, then add to
  `EIG_OAS_HOUSES`.

## Incidents
- **2026-07-08→09 (build):** cluster was dark/leaking — the AI 429 cascade (fixed, PR #180)
  had masked the real blocker: EIG current-auction scoping. Shipped the shared recogniser +
  live-boundary path + UUID sentinel fix + forced List view. Proven on the live sites
  (tcpa 276/0-ended, landwood 39/0, firstforauctions 48/0, dormants 0). Registered 26
  houses. Prod verify = deploy + `POST /api/admin/rescrape {slug}` (tcpa first), confirm
  `get_active_lots` shows the live count with **0 ended**.
