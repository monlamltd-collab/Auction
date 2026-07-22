# Fox & Sons — house dossier

| Field | Value |
|---|---|
| **Slug** | `foxandsons` |
| **Display name** | Fox & Sons Auctions (`HOUSE_DISPLAY_NAMES.foxandsons`) |
| **Platform** | **None.** A hand-maintained static XHTML page (table layout, no CMS, no JS, no anti-bot) — the *same* template as `bagshaws` and `williamhbrownnorwich`. One plain-HTTP fetch carries the whole catalogue. |
| **Region** | Hampshire / Somerset / Devon / Wiltshire / Avon (Southampton office) |
| **Catalogue URL** | `https://www.foxandsonsauctions.co.uk/` (`HOUSE_ROOTS.foxandsons`). `rewriteUrl()` pins **any** foxandsonsauctions.co.uk URL to this root. |
| **Group** | Sequence / Connells. Fox & Sons contributes a numbered slice of lots (138–159 on the 28 Jul 2026 sale) to a shared **national sale** hosted by Barnard Marcus. Siblings: `bagshaws` (253–275), `williamhbrownnorwich` (234–252). The `sequence` portal slug itself is retired (2026-07-05). |
| **Detection** | `detectAuctionHouse()`: `foxandsonsauctions.co.uk` → `foxandsons`. NB the *lot* URLs live on `barnardmarcusauctions.co.uk` and would resolve to `barnardmarcus` — persist uses the passed slug, so Fox lots stay under `foxandsons`. |
| **Status** | Fixed 2026-07-22 — deterministic recogniser, **21/21 = 100% recall** against the live page, counted as survivors of `normaliseScrapedLot`. Prod verify (deploy + rescrape) pending. |
| **Last verified** | 2026-07-22 (live: 21 lots, all available, 21 distinct real photos, 21 guide prices, sale date 2026-07-28). |

## Not a duplicate brand-front
Fox & Sons lots are hosted on `barnardmarcusauctions.co.uk`, which is also an active house
(`barnardmarcus`). That superficially resembles the duplicate brand-fronts retired on
2026-07-22 (`pugh`, `markjenkinson`, `sdl`, `auctionhousenational`) — it is **not** one.
Verified 2026-07-22: **zero** lot-URL overlap in `lots` between `foxandsons`, `bagshaws`,
`williamhbrownnorwich` and `barnardmarcus`. Each branch publishes its own disjoint lot-id
range out of the shared sale, and `barnardmarcus`'s own catalogue is the London sale.
Scraping all four adds coverage, not duplicates. Re-run the overlap check before
onboarding any further Sequence branch (e.g. William H Brown Leeds).

## Page shape
The homepage IS the catalogue (and `/Current_Auction.html` serves the identical lot set —
both were verified at 21/21; the root is pinned because a healed `Auction-Results.html`,
which lists **past** sales, must never become the target). A table alternates **thumbnail
rows** (interleaved with `Spacer.gif` cells) and **text rows**, both linking to the same
lot pages:

```
[![](…/images/auctions/2026/july26/138.jpg)](…/auctions/28-july-2026/707922/)
![spacer](…/images/general/Spacer.gif)
…
**[Lot 138](…/auctions/28-july-2026/707922/)**\\
10 Virginia Park Road, GOSPORT,\\
Hampshire,\\
PO12 3DZ\\
Guide: £165,000 +
```

Fox writes guides with a trailing `+` (`Guide: £165,000 +`) where Bagshaws does not — the
guide regex anchors on the digits, so both parse.

## Lot URL pattern
`https://www.barnardmarcusauctions.co.uk/auctions/{DD-month-YYYY}/{6-digit id}/`
— e.g. `/auctions/28-july-2026/707922/`. The **date slug is the sale date**.

## Recall sentinel
`/barnardmarcusauctions\.co\.uk\/auctions\/[a-z0-9-]+\/(\d{6,})/gi`
(`RECALL_SENTINELS.foxandsons`, mirrored on `HOUSE_RECOGNISERS.foxandsons.recallSentinelPattern`).
Counts 21 distinct ids on the live page = the recogniser's 21 lots.

## Recogniser
`recogniseSequenceBranchLotsFromMarkdown(markdown)` in `lib/pipeline/firecrawl-extract.js` —
**shared with `bagshaws` and `williamhbrownnorwich`**, registered `staticCatalogue: true,
maxPages: 1` (plain HTTP → `htmlToRecognitionMarkdown` → recogniser; **no browser, no AI**).
Keyed by the Sequence lot id so the Crawlee recovery/corroboration path can match it.
Covered by `tests/test-foxandsons-recogniser.js`.

Fox-specific traps the parse must survive (all four were AI fabrications before the fix):

1. **Nav links.** `Catalogue_request.html`, `Legal_Documents.html` and `Auction-Results.html`
   are page nav, not lots. The AI invented a lot at each.
2. **Footer office address.** "32/34 London Road, Southampton, Hampshire SO15 2AG" is the
   branch office in the page footer; the AI emitted it as a property.
3. **Page chrome as photo.** `images/general/Blue-Line.jpg` and `Spacer.gif` sit between the
   lot thumbnails; the AI used Blue-Line.jpg as a lot image. The recogniser only accepts a
   thumbnail whose *link target* is a lot URL, which excludes all chrome.
4. **Unlinked withdrawn lot.** `**Lot 143** Withdrawn Prior.` carries no anchor at all. It is
   not in the recall sentinel either, so ignoring it keeps recogniser and sentinel in lockstep.

## Image source
`https://www.foxandsonsauctions.co.uk/images/auctions/{YYYY}/{mon}{yy}/{lotNumber}.jpg`
— one real per-lot photo, 21 distinct URLs, no hero bleed. Galleries fill from the Barnard
Marcus lot pages via the multi-image sweep.

## Incidents
- **2026-07-22 → `ai_only_freshness_rot` (27 rows "available", only 21 real).** Root cause:
  **no recogniser** — the house depended entirely on the AI extractor. Six rows were wrong:
  four fabricated (the two nav links, the footer office address, and a row whose image was
  the `Blue-Line.jpg` page rule) and two real-but-stale lots from the **past 23 Jun 2026**
  sale still sitting in `available`. Every row — real and fabricated — carried
  `auction_date = 2099-12-31` from the `always_on` calendar placeholder, so
  `get_active_lots` (`auction_date >= current_date - 1`) could never expire any of them.
- **2026-07-22 (fix).** Registered on the shared
  `recogniseSequenceBranchLotsFromMarkdown` + `staticCatalogue` + a `rewriteUrl()` root pin.
  21/21 live, 100% recall, real `2026-07-28` sale date on every lot, no AI, no render.

## Residual / follow-ups
- **Junk rows.** Six pre-existing bad rows (4 fabricated + 2 stale June) stop being re-seen
  after deploy and age out of the 7-day freshness window; the two June lots are also
  re-listed under new July ids (`707845`, `707851`), so they are duplicates of live lots
  until they expire. Flipping them to `withdrawn` clears the UI immediately — see the PR
  description for the exact SQL.
- **Calendar row.** `auction_calendar` for `foxandsons` is a `2099-12-31 always_on`
  placeholder. Harmless now the recogniser stamps the real date; the honest fix is a dated
  row per sale.

## Lesson
Three houses served the *identical* hand-built template and were fixed one at a time with
three separate parsers. Consolidating them onto one recogniser meant the weakest parse got
every sibling's hard-won defence for free — Bagshaws' broken-anchor rescue, William H
Brown's `property_type` inference, and Fox's chrome/nav anti-fabrication now protect all
three. When a "new" dark house shares a group, diff its page against the sibling that
already works before writing a parser.
