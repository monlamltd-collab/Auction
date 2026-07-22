# William H Brown (Norwich) — house dossier

| Field | Value |
|---|---|
| **Slug** | `williamhbrownnorwich` |
| **Display name** | William H Brown (Norwich) |
| **Platform** | **None.** A hand-maintained static XHTML page (~17KB, table layout, no JS, no CMS) on `williamhbrownauctions-norwich.co.uk`. The branch is part of the Sequence / Connells group and sells through **Barnard Marcus Auctions** — this page is a guide-price index of *its own* lots in the shared sale. |
| **Region** | Norfolk / Suffolk / Cambridgeshire / Lincolnshire (Norwich branch) |
| **Catalogue URL** | `https://www.williamhbrownauctions-norwich.co.uk/` (`HOUSE_ROOTS`) — a **rolling** URL reused for every sale. Changed from `/Current_Auction.html` to the site ROOT on 2026-07-22: the root serves the identical catalogue (verified 19/19), matches the two Sequence siblings, and — because `rewriteUrl` pins this house to `HOUSE_ROOTS` — avoids depending on one hand-maintained FILE whose rename would take the house to 0 with healing unable to recover (every healed URL is discarded by the pin). |
| **Detection** | `detectAuctionHouse()` routes `williamhbrownauctions-norwich` → `williamhbrownnorwich`. Note `barnardmarcusauctions` → `barnardmarcus`, so the **detail** URLs belong to a sibling slug; only the catalogue host decides this house. |
| **Status** | Fixed 2026-07-21 (0 live → 19/19 lots, deterministic static recogniser). Prod verify = deploy + rescrape. |
| **Last verified** | 2026-07-21 (live page: 19 lots, sentinel 19, recogniser 19, 19 surviving `normaliseScrapedLot`). |

## Lot URL pattern
`https://www.barnardmarcusauctions.co.uk/auctions/{DD-month-YYYY}/{6-digit id}/`
— e.g. `…/auctions/28-july-2026/707599/`. **The sale date is in the URL slug**, which is
what makes the live boundary cheap and deterministic here.

## Recall sentinel
`/barnardmarcusauctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi`
(`RECALL_SENTINELS.williamhbrownnorwich`; mirrored **verbatim** in
`HOUSE_RECOGNISERS.williamhbrownnorwich.recallSentinelPattern`). Shared shape with
`sequence`, the other Sequence-network slug.

## Recogniser
`recogniseSequenceBranchLotsFromMarkdown(markdown)`
(`lib/pipeline/firecrawl-extract.js`), registered `staticCatalogue: true, maxPages: 1`
— one plain-HTTP fetch carries the whole catalogue, so no browser render and **no AI**.

**Changed 2026-07-22:** this house moved off its own
`recogniseWilliamHBrownNorwichLotsFromMarkdown` onto the recogniser shared with
`bagshaws` and `foxandsons` (all three serve the identical Sequence template). The shared
parser was the superset — it additionally rescues a lot whose text anchor is a broken
`href="link"` typo, which the old WHB parser silently dropped. `property_type` inference
was carried across from the old parser. Re-verified 19/19 survivors on the live page.

Card shape in recognition markdown (`htmlToRecognitionMarkdown`):

```
[![](…/images/auctions/2026/july26/234.jpg)](…/auctions/28-july-2026/707599/)   ← photo row
…
**[Lot 234](…/auctions/28-july-2026/707599/)**\\                                 ← text row
20, Purdy Way, NORWICH,\\
Norfolk,\\
NR11 6DH\\
Guide: £120,000
```

Three things the layout forces:

- **Photos bind by shared detail URL, never by position.** Photo cells and text cells
  are *separate table rows* with `Spacer.gif` cells interleaved; positional binding
  smears one lot's photo across its neighbours. `/images/general/` (logo, spacer,
  rule) is excluded so the page logo can never become a lot photo.
- **Address = the `\\`-broken lines between the anchor and `Guide:`**, stopping at the
  first markdown link/image so a guide-less card can't absorb the next photo row. A
  status line (`SOLD PRIOR`, `Withdrawn`) feeds the status parse but is kept **out** of
  the address.
- **Live boundary from the URL slug.** `auction_date` is parsed per lot from
  `/auctions/28-july-2026/`. The page has no "ended" badges of its own, so this is the
  only ended-leak guard available — and it replaces the `2099-12-31` `always_on` calendar
  placeholder with the real date (`_auctionDate` outranks the calendar in
  `persist-lots.js`).
  **Do not "keep it and hide it downstream" — tried and reverted 2026-07-22.** The
  idea was to return past-dated lots with their real past date and let
  `get_active_lots` (`auction_date >= current_date - 1`) hide them. It does not work:
  - `lib/sitemap.js`'s live cohort is an **OR** (`auction_date >= today` OR
    `last_seen_at` within 7d), so a re-seen past-dated `available` row is submitted
    to **Google as a live listing**.
  - Nothing can retire it. `ghost-sweep` only flips lots **unseen** for 7+ days, and a
    card still on the page is re-seen every scrape, so it is re-stamped `available`
    forever. Inside `post-auction-sweep`'s 30-day window the two fight: the sweep sets
    `sold`/`unsold`, the next scrape reverts it to `available`.
  - The "dropping causes a false recall regression" argument does not apply — the
    recall gate runs on the Crawlee and Firecrawl paths only, and this house runs
    `staticCatalogue`, which never evaluates the sentinel.

  Both invariants are asserted directly: the past card is dropped, and no surviving lot
  may carry an empty or `2099-12-31` date (which is what kept dead lots live).

Covered by `tests/test-williamhbrownnorwich-recogniser.js`.

## Image source
Per-lot photo on the house's own domain:
`https://www.williamhbrownauctions-norwich.co.uk/images/auctions/{YYYY}/{mon}{yy}/{lot}.jpg`
(one thumbnail per lot, named by lot number). Galleries fill later from the Barnard
Marcus detail page via the multi-image sweep.

## Incidents
- **2026-07-21 → dark (0 live, 58 historical lots).** Root cause: **no recogniser** —
  the house depended entirely on the AI extractor. Its last good AI run (2026-07-11)
  captured all 19 lots correctly, but with the AI quota dead those rows stopped being
  re-stamped and aged past `get_active_lots`' **7-day `last_seen_at` freshness window**
  → 0 live while `lots` still held 58 rows. Later AI runs actively degraded: the
  2026-07-21 run emitted a **single junk lot** (page logo as `image_url`, the catalogue
  URL as `url`), and a 2026-06-03 run had fabricated a lot from the **office address in
  the page footer** ("5 Bank Plain, Norwich… £250,000", lot 280). Fix: deterministic
  static recogniser + `staticCatalogue` registration, verified 19/19 against the live
  page.

## Lesson
A tiny hand-built static page is the *easiest* house to parse deterministically and the
*worst* one to leave on the AI extractor: there is no structure for the model to lean on,
so when it degrades it invents lots out of page chrome (the footer office address) rather
than returning zero. "0 live" here was **not** a scrape failure — the scrape succeeded and
the rows existed; they had simply gone stale under the freshness window. Always check
`last_seen_at` against the 7-day window before concluding a house is failing to scrape.
