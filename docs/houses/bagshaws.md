# Bagshaws Residential — house dossier

| Field | Value |
|---|---|
| **Slug** | `bagshaws` |
| **Display name** | Bagshaws Auctions (`HOUSE_DISPLAY_NAMES.bagshaws` = "Bagshaws Auctions") |
| **Platform** | **None.** A hand-maintained static HTML page (table layout, no CMS, no JS, no anti-bot). One plain-HTTP fetch carries the whole catalogue. |
| **Region** | Derbyshire / Staffordshire / Nottinghamshire / Lincolnshire (Derby office) |
| **Catalogue URL** | `https://www.bagshawsauctions.co.uk/` (`HOUSE_ROOTS.bagshaws`). `rewriteUrl()` pins **any** bagshawsauctions.co.uk URL to this root. |
| **Group** | Sequence / Connells. Bagshaws contributes a numbered slice of lots to a shared **national sale** hosted by Barnard Marcus — sibling contributors are `foxandsons`, `williamhbrownnorwich`, `williamhbrownleeds`. The `sequence` portal slug itself is retired (2026-07-05). |
| **Detection** | `detectAuctionHouse()`: `bagshawsauctions.co.uk` → `bagshaws`. NB the *lot* URLs live on `barnardmarcusauctions.co.uk` and resolve to `barnardmarcus` — persist uses the passed slug, so bagshaws lots stay under `bagshaws` (same arrangement as `foxandsons` / `williamhbrownnorwich`). |
| **Status** | Fixed 2026-07-21 — deterministic recogniser, 23/23 = 100% recall against the live page. Prod verify (deploy + rescrape) pending. |
| **Last verified** | 2026-07-21 (live: 23 lots, 22 available + 1 sold-prior, 23 distinct real photos, 22 guide prices, sale date 2026-07-28). |

## Page shape
The homepage IS the catalogue. A banner states the slice (`Bagshaws Residential Lots are
253 to 275 inclusive.`) and the sale date (`Our Next Major Auction will be Held on Tuesday
28th July.`), then a table alternates **thumbnail rows** and **text rows**, both linking to
the same lot pages:

```
[![](…/images/auctions/2026/july26/261.jpg)](…/auctions/28-july-2026/707824/)
…
**[Lot 261](…/auctions/28-july-2026/707824/)**\\
8, Lime Avenue, DERBY,\\
Derbyshire,\\
DE1 1TU\\
Guide: £185,000
```

## Lot URL pattern
`https://www.barnardmarcusauctions.co.uk/auctions/{DD-month-YYYY}/{6-digit id}/`
— e.g. `/auctions/28-july-2026/707824/`. The **date slug is the sale date**.

## Recall sentinel
`/barnardmarcusauctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi`
(`RECALL_SENTINELS.bagshaws`, mirrored on `HOUSE_RECOGNISERS.bagshaws.recallSentinelPattern`).
Counts 23 distinct ids on the live page = the recogniser's 23 lots.

## Recogniser
`recogniseSequenceBranchLotsFromMarkdown(markdown)` in `lib/pipeline/firecrawl-extract.js`
— **shared with `foxandsons` and `williamhbrownnorwich`** since 2026-07-22 (it was
`recogniseBagshawsLotsFromMarkdown`; this implementation was the superset and became the
shared one). Registered `staticCatalogue: true, maxPages: 1` in
`lib/scraper/house-recognisers.js`
(plain HTTP → `htmlToRecognitionMarkdown` → recogniser; **no browser, no AI**).
Keyed by the Sequence lot id so the Crawlee recovery/corroboration path can match it.
Covered by `tests/test-bagshaws-recogniser.js`.

Three things the parse exists to get right:

1. **Status.** A sold lot carries `**Sold Prior**` where the guide line would be
   (Lot 274 on the 28 Jul 2026 sale, cross-confirmed `sold` on its Barnard Marcus lot
   page). It emits `lot_status='sold'` and must never persist as available.
2. **Auction date.** Parsed from the lot-URL date slug (`28-july-2026` → `2026-07-28`)
   and stamped on every lot. This is load-bearing: the house's only `auction_calendar`
   row is a `2099-12-31` `always_on` placeholder, which would otherwise keep every lot
   "live" forever after the hammer falls. `lot._auctionDate` outranks the calendar date
   in `persist-lots.js`, and a real past date makes `get_active_lots` drop the lot.
3. **Broken anchor.** One lot's text link is `href="link"` — a hand-editing typo on the
   live page (Lot 257). Its thumbnail link is intact and the image basename IS the lot
   number (`257.jpg` → Lot 257), so the URL + photo are recovered from there instead of
   dropping the lot. Verified: the recovered id `707825` really is 66 Wythburn Road.

## Image source
`https://www.bagshawsauctions.co.uk/images/auctions/{YYYY}/{mon}{yy}/{lotNumber}.jpg`
— one real per-lot photo (~10 KB JPEG), 23 distinct URLs, no hero bleed. Galleries fill
from the Barnard Marcus lot pages via the multi-image sweep.

## Incidents
- **2026-07-21 → dark (82 lots stored, ~0 live).** Root cause: **no recogniser**. The
  house depended entirely on the AI extractor. Its last good pass (11 Jul) recovered 22
  of 23 and dropped the SOLD-PRIOR lot; every pass after that produced a single junk row
  (`lot 275`, `url = https://www.bagshawsauctions.co.uk/`, i.e. the catalogue root). With
  nothing re-confirming them, the 22 real lots aged past the **7-day freshness window** in
  `get_active_lots` and the house went dark. Classic "no-recogniser house dying with the
  AI quota". Two secondary defects rode along: every lot was stamped `auction_date =
  2099-12-31` from the `always_on` calendar row, and the SOLD-PRIOR lot was invisible.
- **2026-07-21 (fix).** `recogniseBagshawsLotsFromMarkdown` + `staticCatalogue`
  registration + a `rewriteUrl()` pin to the root (so a stale calendar row or a healed
  `Auction-Results.html` — which lists **past** sales — can never become the target).
  23/23 live, 100% recall, no AI, no render.

## Residual / follow-ups
- **Junk rows to expire.** Three pre-existing rows will simply stop being re-seen and age
  out of the 7-day window: `url='https://www.bagshawsauctions.co.uk/'` (lot 275 dup),
  `url='https://www.bagshawsauctions.co.uk/link'` (lot 257 under the broken href), and
  `url='/'` (lot 1, "32-34 The Cornmarket", last seen 2026-06-03). No DB write is required;
  delete them only if the clutter matters.
- **Calendar row.** `auction_calendar` for `bagshaws` is a single `2099-12-31 always_on`
  placeholder. Harmless now that the recogniser stamps the real date, but the honest fix
  is a dated row per sale.
- ~~**Sibling houses.**~~ **Done 2026-07-22.** `foxandsons` and `williamhbrownnorwich` run
  the *same* hand-built Sequence template and contribute adjacent lot ranges to the same
  national sale (138–159 and 234–252 vs Bagshaws' 253–275). Both are now registered on the
  shared `recogniseSequenceBranchLotsFromMarkdown` — 21/21 and 19/19 survivor-verified. See
  [foxandsons.md](foxandsons.md) and [williamhbrownnorwich.md](williamhbrownnorwich.md).
  Three junk rows on this slug (`/`, the root, `/link`) were confirmed still `available` at
  that date — see the PR description for the cleanup SQL.

## Lesson
When a house's lot links point at a **sibling group host**, the recall sentinel and the
lot keys belong on that host, not the house's own domain — and the sale date is often
sitting in the lot-URL slug. Stamping it is what lets a house with a `2099` `always_on`
calendar row expire correctly instead of leaking ended lots forever.
