# Under The Hammer — house dossier

| Field | Value |
|---|---|
| **Slug** | `underthehammer` |
| **Display name** | Under The Hammer |
| **Platform** | Own **Next.js SPA** (`underthehammer.com`). The catalogue page ships an empty shell; every card hydrates client-side from the site's own **public JSON API**. No Cloudflare, no auth, no cookie wall — plain HTTP 200 from a datacenter IP with the project's standard headers. |
| **Region** | National, online-only timed auctions (Midlands / North-heavy stock) |
| **Catalogue URL** | `HOUSE_ROOTS.underthehammer` = `https://www.underthehammer.com/for-auction/properties` (the human-facing page). `rewriteUrl()` **forces every** underthehammer URL at the API: `https://www.underthehammer.com/api/properties?top=200&skip=0&status=upcoming&sortBy=most-recent` (`paginateAs: 'underthehammer_api'`, `isApi: true`). |
| **Detection** | `detectAuctionHouse()` routes any `underthehammer.com` URL → `underthehammer`. |
| **Engine** | Bespoke JSON-API consumer — `lib/scraper/underthehammer.js`, dispatched from `lib/pipeline/scrape-stage.js`. Bypasses Crawlee / Firecrawl / Gemini entirely. Zero credits, one HTTP fetch, **no AI dependency**. |
| **Extraction profile** | `EXTRACTION_PROFILE.underthehammer = { catalogue: 'rich', policy: 'never-deep' }` — the API already carries everything a detail fetch could add, and the detail pages are SPA shells that would each cost a browser render. |
| **Status** | Fixed 2026-07-21 (0 live → 161/161 current lots). |
| **Last verified** | 2026-07-21 — live API: 285 records, 161 `upcoming`, **161 survive `normaliseScrapedLot`**, 0 ended leaked. |

## Lot URL pattern
`https://www.underthehammer.com/property/{id}` — `{id}` is an 18-character Salesforce
record id (`a0YQ400000Z4P8XMAV`).

**Not** `/for-auction/{id}`. The catalogue cards are React `router.push` handlers, not
anchors, so the real route cannot be read off the static HTML or the sitemap (which lists
only category pages). It was confirmed by clicking a card in a live Puppeteer render.
A prior triage assumed `/for-auction/{id}`; it is wrong.

## Recall sentinel
`RECALL_SENTINELS.underthehammer = /underthehammer\.com\/property\/([A-Za-z0-9]{15,})(?:[/?#]|$)/gi`

The previous pattern (`/for-auction/([a-z0-9-]+)`) matched the **catalogue URL itself**
(`/for-auction/properties`) and no lots at all, so recall always read ~1 and the house's
total blackout was never flagged. The sentinel is decorative on this house (the bespoke
scraper never produces markdown) but is kept correct so a future engine change measures
something real.

## The API
`GET /api/properties?top={n}&skip={n}&status=upcoming&sortBy=most-recent`

```jsonc
{
  "totalCount": 285,
  "properties": [{
    "id": "a0YQ400000Z4P8XMAV",
    "status": "upcoming",                  // | sold | unsold | withdrawn
    "title": "30 Princes Street, DL4",     // outward code only — do NOT use as address
    "address": { "street": "...", "city": "...", "county": "", "postCode": "DL4 1AX",
                 "latitude": 54.63, "longitude": -1.65 },
    "guidePrice": 30000, "startingPrice": 35000,
    "bedrooms": 2, "bathrooms": 1, "type": "Terraced House", "tenure": "Freehold",
    "occupied_status": "Vacant", "epc_rating": "G", "council_tax_band": null,
    "completion_timescale": "28 days (4 weeks)",
    "description": "<p>…</p>",             // HTML
    "images": ["https://advwebsaprod0.blob.core.windows.net/property-images/{id}/….jpg"],
    "floorplan": "…", "virtual_tour": "…",
    "auction": { "startDate": "…", "endDate": "2026-08-12T11:00:00.000Z" },
    "auctionEndsAt": "2026-08-12T11:00:00.000Z"
  }]
}
```

`top`/`skip` paginate; `fetchUnderTheHammerProperties` walks `skip` in steps of 200 until
`totalCount` is satisfied (2 requests for today's full book, 1 for the `status=upcoming`
slice).

## The anti-leak contract
The endpoint publishes the **whole book**, not the live one — today 285 records of which
only 161 are current (106 sold, 16 unsold, 2 withdrawn). A naive consumer ships 124 ended
lots as `available`. Two **independent** gates, both required (`isCurrentUnderTheHammerLot`):

1. `status === 'upcoming'` — the source's own lifecycle field.
2. `auction.endDate` (≡ `auctionEndsAt`) is **today or later**.

Neither alone is sufficient, and today's feed contains a live counter-example for each:

- a **sold** lot dated `2026-07-28` (future) — a date-only gate would leak it;
- an `upcoming` record can outlive its auction date — a status-only gate would leak it.

`?status=upcoming` on the URL is a payload optimisation only. The client-side gates are
the guarantee, and `tests/test-underthehammer-scraper.js` pins the case where the server
ignores the param and returns the full book.

## Bullets vs description — load-bearing
Bullets are a **curated fact list** (type, beds, baths, tenure, occupancy, EPC band,
council-tax band, completion timescale) — deliberately **not** the source narrative.

`normaliseLotStatuses` (`lib/scraper/validation.js`) re-greps `bullets` for `/\bSOLD\b/`
and demotes any matching `available` lot. **5 of today's 161 live descriptions** contain
"sold" in prose ("sold with vacant possession"), so folding the narrative into bullets
would silently hide 3% of the house. The narrative still reaches `lots.description`,
which that check does not read.

## Address
`address.street + city + county + postCode`, whitespace-collapsed — the source embeds
literal newlines in `street` ("93 Doncaster Lane\nWoodlands"). This is exactly the join
the site's own cards render. The `title` field is **street + outward code only**
("30 Princes Street, DL4") and loses both the town and the inward code — never use it.

## Lot numbers
The source publishes none (the site renders none), so `lot_number` is `null` — never a
fabricated positional index. Dedup is on `url`, which is stable and id-derived.

## Image source
`https://advwebsaprod0.blob.core.windows.net/property-images/{id}/{uuid}.jpg` — up to 17
per lot. The scraper passes the first 8 straight through as `lot.images` (matching
`image-extract.js` `MAX_IMAGES_PER_LOT`), so galleries land at scrape time and
`multi-image-sweep` never has to render 161 SPA detail pages. Each image path carries the
lot's own id, so hero-bleed is structurally impossible.

## Incidents
- **2026-06-13 → dark.** Last successful scrape 2026-05-29; last lot seen 2026-06-13.
  `house_skills`: `last_probe_result='error'`, `last_lot_count=9`, circuit closed (so no
  circuit alert fired). 70 rows sat in `lots` as `available` stamped with the
  `2099-12-31` `always_on` calendar sentinel and junk AI-invented URLs (`/lot/1`,
  `/property/6055`), unseen for 5+ weeks. **Root cause:** the house had no recogniser and
  leaned entirely on render→AI extraction. The catalogue page is an empty Next.js shell,
  so the extractor saw ~9 of 161 lots on a good day and nothing at all once the AI quota
  died. The broken recall sentinel meant the blackout was never flagged.
- **2026-07-21 (fix).** Bespoke JSON-API scraper + `rewriteUrl` retarget + corrected
  sentinel + `never-deep` profile. Live: 161/161 current lots through
  `normaliseScrapedLot`, 0 ended leaked, real addresses/prices/images, real auction dates
  (2026-07-28 / 08-12 / 08-26) replacing the 2099 sentinel.

## Follow-ups
- The `FALLBACK_CALENDAR` row (`lib/calendar.js`) is still the `2099-12-31` `always_on`
  placeholder. Harmless — `persist-lots` puts the scraper's per-lot `_auctionDate` **above**
  the calendar date — but the calendar UI will show a placeholder entry for this house.
- The ~70 stale pre-blackout rows are left to self-heal: the snapshot-diff prune withdraws
  those in the last snapshot, the ghost sweep retires the rest after 4 days unseen. No
  manual DB edit is needed.

## Lesson
When a house is a **client-rendered SPA**, look for the endpoint it hydrates from before
reaching for a render + recogniser. A public JSON API is strictly better on every axis
(recall, cost, latency, field richness, AI-quota independence) — but it usually publishes
the **whole book**, so the live/ended filter becomes the load-bearing correctness gate,
and it must be keyed on the source's own status field, not just the auction date.
