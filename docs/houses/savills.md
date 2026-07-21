# Savills — house dossier

| Field | Value |
|---|---|
| **Slug** | `savills` |
| **Display name** | Savills |
| **Platform** | Own **Joomla** site (`auctions.savills.co.uk`) with a Vue bidding layer bolted on. The lot grid is **fully server-rendered** — plain HTTP, no browser render needed. No Cloudflare, no cookie wall. |
| **Region** | National (London-weighted; residential + commercial sections) |
| **Catalogue URL** | `https://auctions.savills.co.uk/upcoming-auctions` (`HOUSE_ROOTS`) — a **two-tier** entry: this page is the auction **CALENDAR** (dates, a "N properties for sale" count, and a "View catalogue" link per sale). Lots live one hop deeper on each dated catalogue `/auctions/{d[--d]-month-year-{auctionId}}`. |
| **Detection** | `detectAuctionHouse()` routes any `savills` URL → `savills`. |
| **Status** | Fixed 2026-07-21 (0 → 306 live lots, calendar drill + static recogniser + sentinel repair); **prod verify pending** (deploy + rescrape). |
| **Last verified** | 2026-07-21 — live: 306/306 = 100% recall across all four upcoming sales (297 available / 5 sold-prior / 4 withdrawn-prior). |

## Lot URL pattern
`https://auctions.savills.co.uk/auctions/{auction-slug}/{address-slug}-{lotId}`
e.g. `/auctions/28--29-july-2026-227/10-brooklyn-avenue-loughton-essex-ig10-1bl-23983`.

The site emits these hrefs on **`http://`** even though it serves `https` — the recogniser
upgrades the scheme at source (the frontend blocks mixed content and an `http` URL would
also fork the dedup key).

**The `{auctionId}` suffix ROTATES every sale** (…-220, -222, -227, -240, -242, -243 …), so
a pinned `auction_calendar` row rots within weeks. The calendar drill exists for that.

## Pagination — a PATH segment, not a query param
`/auctions/{slug}/page-{n}/quantity-{n}`. Default is ~10 lots/page (29 pages for the 288-lot
July 2026 sale). `quantity-100` collapses that to 3 fetches; `quantity-500` puts the whole
catalogue in one 7.8MB fetch. **100 is the shipped page size** — the wide page measured 7.9s
against a 25s `fetchPage` timeout and ~293MB peak RSS through turndown, both of which are
avoidable risk for no benefit. `quantity-500` is kept only as the fallback for a sale whose
lot count the calendar doesn't publish.

## Recall sentinel
`RECALL_SENTINELS.savills` (mirrored on `HOUSE_RECOGNISERS.savills.recallSentinelPattern`):

```
/\/auctions\/[\w-]+\/[\w-]+-(\d{4,6})(?=$|[/?#)\s"'\]])/gi
```

The lookahead **must** accept the delimiters a lot URL actually sits behind — markdown's
`](…)`, HTML's `href="…"`/`'…'`, whitespace. The previous `(?=$|[/?#])` form matched
**nothing** in either markdown or HTML, so recall read 0 against a 287-lot catalogue and the
total blackout was never flagged. Verified 287/287 in both forms.

The pattern deliberately does **not** match the section-divider pseudo-lots
(`/auctions/{slug}/-24101` — no address slug), so the denominator counts real lots only.

## Calendar drill + recogniser
Registered in `lib/scraper/house-recognisers.js` as `staticCatalogue: true` with a
`resolveCatalogueUrl` hook.

- **`resolveSavillsCatalogueUrl(_baseUrl, fetchPage, todayIso)`** (`lib/pipeline/firecrawl-extract.js`) —
  always re-reads the calendar (never trusts the incoming URL, which may be a pinned stale
  sale), keeps every sale whose **end** date is today-or-later, orders soonest-first, and
  returns **one page target per catalogue page**: `ceil(count / 100) + 1` targets sized from
  the calendar's own "N properties for sale" count (the +1 is headroom so the walk can never
  silently truncate), or a single `quantity-500` page when no count is published. Returns
  `null` → genuine zero when no sale is upcoming.
- **Multiple sales are scraped, not just the soonest.** On 2026-07-21 the July sale carried
  287 lots and three *later* sales already carried 19 more; "soonest only" would have shipped
  94% and breached the 100% rule. This is the opposite of `edwardmellor`, whose later dates
  are genuinely empty.
- **`recogniseSavillsLotsFromMarkdown(markdown)`** (`lib/pipeline/firecrawl-extract.js`) —
  anchors on the address text link, treats the card's own `[Full details](…)` link as the
  card terminator, and reads lot number / guide price / status from the block before the
  address and bullets from the block after. Covered by `tests/test-savills-recogniser.js`.

`resolveCatalogueUrl` returning a **list** is a generic capability added to the
`staticCatalogue` block in `lib/analysis.js` — single-target houses (edwardmellor,
btgeddisons, …) keep their exact previous behaviour including the page-1-hash short-circuit,
which is deliberately **not** applied to multi-target houses (an unchanged first page says
nothing about the later sales).

## Card shapes the parser must survive
- **Section dividers** — pseudo-lots with "Lot 0", `Guide Price TBA` and an **empty** address
  anchor (`[](…/-24101)`), used to introduce the commercial section. The anchor regex rejects
  them, and their own "Full details" link still closes the card, so a divider's fields can
  never bleed onto the next real lot.
- **`Sold Prior` / `Withdrawn Prior`** badges sit inline with available lots (9 of 288 on the
  28–29 July 2026 sale). Status is read **only** from the zone between `Your Bid` and the
  address anchor, so bullet prose like "sold off on long lease" or "To be sold on Tuesday 28
  July" (14 lots on that sale) can't flip an available lot, and a sold lot can't read
  available.
- **Two-day sales** list both days' lots on one page. The per-lot "To be offered on …" bullet
  picks the day, but **only** when it names one of the slug's own sale days — otherwise the
  sale's **last** day is used, so a still-live lot is never hidden a day early.

## Image source
Per-lot gallery `https://resize.auctions.savills.co.uk/resized/images/w650/lots/{aucId}/{imgId}/{hash}.jpeg`
(up to ~23 per lot, all `https`). The recogniser binds the **first image whose link target
carries this lot's id**, so a neighbouring card's photo can't bleed. 306/306 lots carried a
photo on the 2026-07-21 verify; the only repeated URLs were two properties genuinely listed
in both the July and August sales.

## Incidents
- **≤ 2026-07-21 → dark:** 500 lots historically, **0 live**. Two independent causes, either
  of which alone would have been fatal:
  1. **No recogniser.** Savills went through the AI catalogue extractor, which is quota-dead
     for most of each month (see the `AI provider stack` memory), so the house produced 0
     lots and the calendar row aged out.
  2. **Broken recall sentinel.** `(?=$|[/?#])` never matched a lot URL in markdown or HTML,
     so recall measured 0/0 and the `recall_below_100` gate never fired — the blackout was
     invisible to the harness for months.
  A third, smaller issue: `rewriteUrl` picked `catalogueLinks[0]` in **document order** and
  left the default ~10-lots-per-page view in place, so even a successful scrape would have
  seen ~10 of 288 lots on the on-demand `/analyse` path.
- **2026-07-21 (fix):** calendar drill returning every upcoming sale, deterministic static
  recogniser, sentinel lookahead repair, and `rewriteUrl` reworked to sort by parsed sale date
  and force `quantity-500`. All plain HTTP — no Firecrawl, no Gemini. Live: 306/306 = 100%,
  every lot today-or-future dated, 305/306 with a guide price (the one exception is a
  sold-prior lot the site publishes without a guide), 306/306 with a real photo.

## Lesson
**A broken recall sentinel is worse than a broken extractor** — the extractor failure is at
least loud, whereas a sentinel that matches nothing makes a 100%-loss house look like a house
with nothing to report. When a house is dark, test the sentinel against the *live* markdown
**and** raw HTML before trusting any recall number in the alert history.

Second lesson: "drill to the soonest upcoming auction" is **not** universally right. Savills
publishes several sales concurrently and all of them carry live lots; check whether the later
dates are actually empty (edwardmellor) before scoping to one.
