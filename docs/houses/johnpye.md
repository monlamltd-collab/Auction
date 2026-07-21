# John Pye — house dossier

| Field | Value |
|---|---|
| **Slug** | `johnpye` |
| **Display name** | John Pye |
| **Platform** | Own **WordPress + Avada/Fusion** site (`johnpye.co.uk`). Fully server-rendered — plain HTTP, **no browser render needed**, no Cloudflare. Property is a small corner of a mostly industrial/vehicle/police asset-disposal site. |
| **Region** | National (Notts-centred; stock across the Midlands, North West, London) |
| **Catalogue URL** | `https://www.johnpye.co.uk/properties/` (`HOUSE_ROOTS.johnpye`, [lib/houses.js:157](../../lib/houses.js)). Single page — no pagination (`?page=2` returns the identical page) and the `/properties/{category}` tiles are nav, not catalogues. |
| **Detection** | `detectAuctionHouse()` — any `johnpye.co.uk` URL → `johnpye` ([lib/houses.js:628](../../lib/houses.js)). |
| **Calendar** | One `always_on` row, `date = 2099-12-31` (sentinel). Correct: most stock is undated private treaty. Timed lots carry their own parsed date, which outranks the calendar in `persist-lots.js`. |
| **Status** | Fixed 2026-07-21 — deterministic recogniser, 17/17 = 100% recall, 0 ended leaks. |
| **Last verified** | 2026-07-21 (live page: 17 sale lots = 9 available / 8 sold, + 1 lettings card excluded). |

## Lot URL pattern
`https://www.johnpye.co.uk/auctions/{slug}/` — slug is usually the whole card title
kebab-cased (`for-sale-by-private-treaty-…-de72-3ey`) but is sometimes a bare WordPress
post id (`10040-2`, `10048-2`). Any sentinel with a minimum slug length misses those.

## Recall sentinel
`/johnpye\.co\.uk\/auctions\/(?![a-z0-9-]*-to-rent\b)([a-z0-9][a-z0-9-]*)\/?/gi`
(`HOUSE_RECOGNISERS.johnpye.recallSentinelPattern`). The negative lookahead skips the
lettings card so sentinel parity matches what the recogniser deliberately returns.

## Recogniser
`recogniseJohnPyeLotsFromMarkdown(markdown)` in [lib/pipeline/firecrawl-extract.js](../../lib/pipeline/firecrawl-extract.js),
registered `staticCatalogue: true, maxPages: 1` — one plain-HTTP fetch → turndown →
recogniser. **No AI extractor, no browser render.**

Card shape in the turndown markdown (Avada/Fusion post-card grid):

```
-   [](…/auctions/{slug}/)
    {TITLE — status prefix – descriptors – address+postcode – price}
    [](…/{slug}/)
    [![](…image…)](…/{slug}/)
    [](…/{slug}/)
    {DESCRIPTION — same fields, hyphen-separated}
    [View Property](…)          ← or [Preview Auction](…) on timed lots
    {contact boilerplate}
    {BUTTON LABEL — "For Sale By Private Treaty" /
                    "For Sale by Private Treaty - UNDER OFFER" / "To Let" /
                    "Auction Ends | Thursday 30th Jul | 11:00am"}
```

Cards are therefore delimited by **runs of same-slug lot links**, not by list markers.
The grid renders twice on the page (desktop + small-screen); dedupe by slug keeps the
first copy.

Parsing rules:
- **Address** — split title/description on *spaced* dashes only (` – ` / ` — ` / ` - `, so
  `Semi-Detached` and `Stoke-On-Trent` survive) and take the segment carrying the UK
  postcode. Handles every observed title shape without a bespoke per-shape regex.
- **Status (anti-leak)** — read from the WHOLE card. `/auctions/10040-2/` has a clean
  title and its only "UNDER OFFER" marker is on the button label; title-only parsing
  ships it as available.
- **Auction date** — the `Auction Ends | Thursday 30th Jul | 11:00am` button, via
  `parseAuctionDateFromBullet` (year-less → current-year-if-upcoming, never rolled forward).
- **Rental exclusion** — `To Let` / `To Rent` cards (serviced offices) are not sale lots.
- **Non-lot slugs** — `general-auctions`, `vehicle-auctions`, `police-auctions`,
  `insolvency-auctions`, `properties`, … are nav tiles, denylisted.

Covered by `tests/test-johnpye-recogniser.js` (33 assertions).

## Image source
One per-card banner `https://www.johnpye.co.uk/wp-content/uploads/{yyyy}/{mm}/…webp`
(John Pye's own "Previews Template Banner" strip / `prop-N.png`). Distinct per lot — 17
distinct URLs across 17 lots, so no hero bleed. Site logos are filtered out. Full
galleries fill from the detail pages via the multi-image sweep.

## Incidents
- **2026-05-30 → wrongly retired.** The slug was retired as "not an auction house" after
  reading only the industrial/vehicle side of the site. Un-retired 2026-06-27 and pointed
  at `/properties/`.
- **2026-07-21 → recogniser drift (fixed).** The site was rebuilt onto an Avada/Fusion
  post-card grid. The old recogniser split markdown on `\n- {CAPS}` and read each block's
  **first line** as the title; the new cards open with an **empty anchor** and carry the
  title on the next line, so the split produced 2 blocks for the whole page and returned
  2 fabricated "lots" — the page `<title>` ("Properties For Sale – John Pye Auctions") and
  the words "Auction Location" — both as `status='available'`. Real recall: **0**.
  Everything the frontend showed came from the **AI fallback**, which is quota-dead most
  of the month (hence the house reading 0 live), and when it did run it leaked
  **49 Curlew Close (Under Offer) as available**, shipped the **Mercury House lettings**
  listing as a £22,500 sale (price bled from another lot), and invented prices for two
  cards the source publishes with none. Fix: rebuilt recogniser (runs-of-same-slug card
  blocks, whole-card status, postcode-segment address), corrected sentinel,
  `staticCatalogue: true`.

## Lesson
When a template rebuild moves the title off the block's first line, a first-line-based
recogniser doesn't return 0 — it returns *garbage that passes `looksLikeRealAddress`*.
Always count what survives `normaliseScrapedLot` **and eyeball the addresses**; "2 lots
recovered" hid a total failure. And always check the card's **button label** for status:
on this house it is the only place "UNDER OFFER" appears for some lots.
