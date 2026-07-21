# Pattinson (Pattinson Estate Agents) — house dossier

| Field | Value |
|---|---|
| **Slug** | `pattinson` |
| **Display name** | Pattinson |
| **Platform** | Next.js App Router + **Payload CMS** backend, **server-rendered (SSR/RSC)**, behind **Cloudflare**. A datacenter/plain-HTTP request gets a **403 "Just a moment"** — GET on the catalogue *and* POST on the JSON endpoint — so everything needs a **real-browser render** to pass CF. |
| **Region** | North East (+ national auction lots) |
| **Catalogue URL** | `https://www.pattinson.co.uk/auction/property-search` (`HOUSE_ROOTS`). `rewriteUrl` forces this URL for **any** pattinson URL. |
| **Scale (2026-07-21)** | **1,783 catalogue records → 1,724 live lots**, **20/page**, **90 pages**. Page size is FIXED at 20 — `pageSize`/`limit`/`perPage`/`size`/`take`/`count` are all ignored (tested in-page on the JSON endpoint, all return 20). |
| **Detection** | `detectAuctionHouse()` routes `pattinson.co.uk` → `pattinson`. |
| **Scrape path** | **BESPOKE** — `paginateAs: 'pattinson_api'` → `lib/scraper/pattinson.js` via `scrape-stage.js`. Skips Crawlee-extract / Firecrawl / Gemini entirely (`BESPOKE_SCRAPER_PAGINATE_AS` in `lib/analysis.js`). No AI, no credits. |
| **Status** | ✅ **100% of the live book — 1,724/1,724 lots, 0 ended leak** (live run 2026-07-21: 10.5s end-to-end, peak RSS 203 MB). Was ~17%. |
| **Last verified** | 2026-07-21 (live run through the shipped code path: 1,783 records over 90/90 pages, 1,724 lots survive `normaliseScrapedLot`, 0 past-dated emitted, 1,724 distinct hero images). |

## How it works — render once, then walk the site's own JSON endpoint

Two problems compound here: Cloudflare blocks any non-browser request, **and** the
catalogue is 90 fixed pages of 20. The render path caps at `MAX_PUPPETEER_PAGES=15`
(`lib/config.js`) → ~300/1,783 ≈ 17%, and 90 sequential CF-solving renders would
blow the render deadline anyway. Raising the global page cap is not an option (it is
the fleet's memory guard).

So: **render page 1 ONCE** through Crawlee — that clears Cloudflare and leaves a warm
session — then walk the site's own paged JSON endpoint **from inside that page
context**. The `cf_clearance` cookie is HttpOnly and bound to the browser's TLS/JS
fingerprint, so it cannot be lifted out into a node fetch; the walk has to happen
in-page. Implemented as a **host-gated** `IN_PAGE_PAGINATORS` hook in
`lib/scraper/crawlee.js`'s `requestHandler`, modelled on `CLICK_TO_LOAD_SELECTORS`:
the mechanics (`collectPagedJson`) are house-agnostic, only the endpoint/body config
is per-host, and a house that isn't listed can never enter the branch. The walk's
result rides back on `scrapeWithCrawlee`'s `inPageData`.

### The endpoint

```
POST https://www.pattinson.co.uk/api/property/list-search
```

Returns `properties.results` = `{ pageCount, totalItemCount, pageNumber, pageSize, items[] }`
— ~66 KB/page vs ~1.5 MB for the HTML page. Per item: `id`, `price`,
`priceDescription`, `tenure`, `propertyTypeName`, `deadline` (ISO auction end),
`millisecondsRemaining`, `isSold`, `isAuction`, `isOnlineAuction`, `auctionBids`,
`headline`, `bedrooms`/`bathrooms`/`receptions`, `image`, `propertyImages[]` (full
gallery), structured `address{}`, `parkingTypes`, `chainFree`, `hasGarden`,
`salesDescription`.

**It rejects a partial body with HTTP 400** — the request body in `crawlee.js` is the
exact payload the site's own client sends. Do not "tidy" fields out of it;
`includeCommercial:false` silently drops 403 lots.

> **Correcting the earlier finding.** The 2026-07-16 note said "no public JSON API —
> all `/api/{properties,property,lots,…}` → 404". That was true of **GET**-probing
> guessed paths. The real endpoint is a **POST** with a required body, found by
> watching what the client itself calls when you click through to page 2. The
> HTML-regex plan in that note still works but is strictly worse: 90 × 1.5 MB in
> flight (~117 MB, OOM — stripping `<script>/<style>/<svg>` only removes 16%,
> the bulk is inline card markup), no auction-deadline field, no sold flag, and a
> card DOM with no clean per-card container.

## THE ANTI-LEAK CONTRACT — read before touching the gate

**The 1,783-record catalogue is NOT all live.** On 2026-07-21 it carried **59 records
whose auction deadline had already passed** (4 of them `isSold:true`) — Pattinson
leaves an ended online auction in the search index for a while. Two independent gates
must BOTH pass (`isCurrentPattinsonLot`):

1. `isSold !== true` — the source's own sale flag.
2. `deadline` is absent, **or** strictly in the future.

Gate 2 compares **full timestamps, not dates**: a lot that ended at 09:00 today is
ended, and a date-only gate would ship it as available. Both gates are kept even
though on the live feed all 4 sold records were also past-dated — that redundancy is
the point.

**A missing deadline is LIVE, not ended.** 28 records carry `isOnlineAuction:false`
and no `deadline` — traditional in-room auction lots with a guide price. Verified on
their detail pages: `schema.org/InStock`, `canBid:true`. Dropping them would be 28
lots of self-inflicted under-recall. They ship with an empty `auction_date`, which
`routes/search.js` already handles (`auction_date.is.null` is inside the live filter,
with a 14-day stale-synth fallback once a lot stops being re-seen).

Past-dated **unsold** lots still read `InStock` on their detail pages (the online
auction ended without a sale). They are still dropped: `millisecondsRemaining` is 0,
they are not biddable, and the post-auction sweeps own lifecycle reconciliation for
lots already persisted.

## THE HEADLINE TRAP — never put `headline` in `bullets`

**646 of 1,783** headlines read *"Being Sold via Secure Sale Online Bidding"*.
`normaliseLotStatuses` (`lib/scraper/validation.js`, run on the persist path)
re-greps `bullets` for `/\bSOLD\b/` and demotes any matching `available` lot — so a
headline that reached bullets would have marked **36% of the house sold**. Bullets are
curated structured facts only; the headline goes to `description`, which that check
does not read.

`normaliseScrapedLot` falls `description` back **into** bullets when bullets is empty,
so `buildBullets` guarantees at least one entry (`salesDescription` is the fallback —
present on every record and carries no status vocabulary). Pinned by
`tests/test-pattinson-scraper.js` Tests 3 and 6.

## Lot URL pattern
`https://www.pattinson.co.uk/property/{id}` (numeric id).

## Recall sentinel
`/\/property\/(\d+)/g` (`HOUSE_RECOGNISERS.pattinson.recallSentinelPattern`).

Bespoke scrapers bypass the Crawlee recall gate, so `scrapePattinson` fires its own
`recallGateAlert` measuring **records walked vs `totalItemCount` advertised by the
source**. A truncated walk (budget exhausted, or a page 500s mid-batch) therefore
raises `recall_below_100` instead of shipping a partial in silence.

## Recogniser (DORMANT)
`recognisePattinsonLotsFromMarkdown` (`lib/pipeline/firecrawl-extract.js`) no longer
runs for this house — it stays registered as the documented markdown fallback and to
resolve the recall sentinel. Still pinned by `tests/test-crawlee-recognition.js` Test 4.

## Image source
`https://pattinson.blob.core.windows.net/paccess/property-images/{id}/{imageId}_w1048_h786.jpg`.
The endpoint hands us the **whole gallery** per lot, so `lot.images` is populated at
scrape time (up to 8) rather than making multi-image-sweep render ~1,700 detail pages.
Every image path carries its own lot's id, so a hero cannot bleed from a neighbour —
live run: 1,724 lots, 1,724 distinct hero images, max reuse 1.

## Incidents
- **2026-06-10→13:** went dark — circuit open, `zero_lots_no_heal`, health 0, 10
  consecutive failures. Root cause: **template rebuild** of the React SPA. The old
  recogniser split on a literal `parking](…/property/{id})` anchor (it assumed every
  card's link text ended in "parking"); the rebuilt template no longer emits that,
  so the recogniser matched nothing → 0 lots even though the render succeeded.
- **2026-07-08 (fix):** recogniser rewritten to match the whole card link + read
  fields off content lines (template-robust). Live render: 20/20 page 1 (100%), was 0.
- **2026-07-16 (diagnosis):** recogniser fine, but structurally capped at ~17% —
  90 pages vs `MAX_PUPPETEER_PAGES=15`. Logged as the fleet's single biggest
  coverage gap.
- **2026-07-22 (100% fix):** bespoke in-page paginator shipped. 1,724/1,724 live
  lots, 0 ended leak, peak RSS 203 MB, 10.5s end-to-end. Also found the catalogue
  was **not** all-live (59 ended records) and the 646-headline `SOLD` trap — either
  would have been a silent ended-lot leak on any naive "ship all 1,783" build.

## Lessons
1. A recogniser anchored on incidental card text (a "parking" detail label) is
   brittle — anchor on the **lot-detail link** and read fields off content **lines**.
2. **A GET 404 does not prove there is no API.** Watch what the site's own client
   calls when you paginate; Pattinson's is a POST with a required body.
3. **Never assume a catalogue's headline count is the live count.** 1,783 advertised
   was 1,724 live. Audit the lifecycle fields before treating the total as the target.
4. When a source's prose is folded anywhere near `bullets`, check it against
   `normaliseLotStatuses`' status vocabulary first.
