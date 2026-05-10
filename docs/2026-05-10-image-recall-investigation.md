# Image Recall Investigation — 2026-05-10

Investigation by: image-recall-scout
Scope: 7 auction houses with NULL/wrong `image_url` on a chunk of active lots.
Status: investigation only — no code changes.

## TL;DR

Of the seven houses, only **2 are real "image extraction missed it" problems** (gth, johnfrancis), and even those are dominated by a separate junk-lot issue. The other 5 are deeper:

- **2 catalogue URLs are dead 404s** (clarkegammon, buttersjohnbee — for the latter at least intermittently)
- **2 houses have no real catalogue source** (clarkegammon's `/auction/` is informational, taylerandfletcher's source returns "400 Bad Request" on every lot URL stored)
- **1 is Cloudflare-blocked** (symondsandsampson — its 13 stored lots are pre-block ghosts)
- **1 is already RETIRED** (morrismarshall)
- **1 has a URL-canonicalisation duplication bug** (buttersjohnbee — the 12 NULL lots are www. dupes of lots that already have images)

The "missing image" symptom is the visible tip — the underlying problems are mostly stale or wrong-source lots. **Five houses need URL/source healing or retirement, not image extraction work.** Only gth and johnfrancis have real markdown-recogniser cases, and even there most of the NULL lots are nav-menu junk that should be deleted, not given an image.

---

## Cross-cutting findings

### 1. Five of seven have stale lots from before the DOM-extractor retirement (2026-05-08)
The `extracted_with` column shows `dom-house` / `dom-generic` / `dom-house` for symondsandsampson, taylerandfletcher, and (older) buttersjohnbee lots. Those extractors no longer exist; the lots are frozen in their pre-retirement state. Recent re-scrapes (Firecrawl JSON / Gemini) have supplemented them but not replaced them. **Many of the "NULL image" lots are stale ghosts that should be marked removed, not re-extracted.**

### 2. Three houses have "100% of lots have ended/sold status — catalogue likely stale" alerts
gth (12/12), symondsandsampson (9/9), johnfrancis (11/11) all hit this gate on 2026-05-09. Their live catalogues are returning ended sales, not active lots — the catalogue URLs may be stale.

### 3. Address discipline (CATALOGUE_PROMPT) was added 2026-05-05; pre-prompt junk lots survive
gth and johnfrancis NULL-image lots are nav-menu paste-ups (`"Farms & Land"`, `"Commercial Property"`, `"To rentHouses to rentFlats to rent…"`). These would be rejected by `looksLikeRealAddress()` if re-scraped today, but they were extracted before the placeholder-rejection guard landed. **The fix here isn't recall — it's a one-off DELETE of placeholder-address lots.**

### 4. Cache-enrichment image backfill doesn't cross URL canonicalisation forms
buttersjohnbee has duplicate rows: `https://www.buttersjohnbee.com/...` (NULL image) and `https://buttersjohnbee.com/...` (HAS image). Same `property_key`. The `cache-enrichment` path picks one URL form; backfill misses the dupes. **Slug-level dedup at upsert (`HERO_BLEED_THRESHOLD` exists for images, not for URL forms) would prevent this.**

### 5. Schema's `image_url` field works fine for sites with `<img>` tags; misses CSS background-image banners
Clarke Gammon's WordPress + PropertyHive theme uses `<div style="background-image:url(…)">` for all property hero images. Firecrawl JSON extract / Gemini both look for `<img>` tags first and skip backgrounds. This is a real schema gap, but **only one house actually uses this pattern**, and that house's catalogue source is wrong anyway.

---

## Per-house plans

### 1. symondsandsampson — 13/13 NULL (100%)

**Diagnosis**: Lots are PRE-CLOUDFLARE STALE. All 13 lots:
- `extracted_with = 'dom-house'` (extractor retired 2026-05-08)
- `last_seen_at = 2026-05-01` (9 days ago — not refreshed since)
- Each lot's address is just a town name (`"Beaminster"`, `"Ilminster"`, `"Blandford"`, `"Bridport"`, `"Axminster"`)
- Each `url` points to `auctions.symondsandsampson.co.uk/property/<town>/property-for-sale-in-<town>` — these are **branch event pages, not lot pages**
- `raw_text` starts with `"Properties for sale in <Town> We value your privacy. We use cookies…"` — pure cookie banner

The site is now behind **Cloudflare turnstile** (`"Just a moment…"` challenge). Plain HTTP returns 403; only Firecrawl with JS rendering can get through. The existing `rewriteUrl(symondsandsampson)` logic (lib/houses.js:1315–1371) correctly drills through the events page to find lots, but on Cloudflare-blocked attempts it falls through and `marks blocked: true` to prevent scraping fakes — yet the 13 fake lots from the pre-block era are still in the DB.

**Recommended fix**: **E (source-side limitation) + DB cleanup**.
- One-off SQL: delete the 13 stale `dom-house` lots. They are not real lots — they are branch event pages mis-classified as property lots. The `marked: blocked` short-circuit on line 1370 of houses.js already prevents new ones, but the old ones never aged out.
- No extractor / schema change needed. The site itself blocks scraping.
- Optionally consider retiring the slug entirely if Firecrawl can't bypass Cloudflare reliably.

**Effort**: XS (a single DELETE)

**Sample data**:
```
lot 1: address="Axminster", url=…/property/axminster/property-for-sale-in-axminster, image_url=NULL, scraped_with=firecrawl, extracted_with=dom-house
lot 2: address="Beaminster", url=…/property/beaminster/property-for-sale-in-beaminster, image_url=NULL
lot 7: address="Ilminster", url=…/property/ilminster/property-for-sale-in-ilminster, image_url=NULL
```

**Catalogue URL**: `https://auctions.symondsandsampson.co.uk/events/property-auction/symonds-and-sampson-property-auctions?eventdate=upcoming` — **Cloudflare-blocked**

---

### 2. clarkegammon — 10/10 NULL (100%)

**Diagnosis**: HOUSE_ROOTS catalogue URL `https://www.clarkegammon.co.uk/auction/` returns **HTTP 404**. The actual auction page at `/property-auctions/` is **service-information copy only** ("we hold auctions throughout the year, contact Tony Jamieson") — there are zero auction lots on it. The 10 lots in DB are private-sale **strategic land / development listings** scraped from the homepage's featured-property cards (e.g. "Sturt Farm Barn", "Land adj Grayshott Social Club", "Tappers Barn"). They are NOT auction lots.

The detail pages exist and are real listings, but they use **WordPress `<div style="background-image:url(...)">` banners** instead of `<img>` tags (verified via curl against /sturt-farm-barn-sturt-road-haslemere/) — so even if Firecrawl JSON extract scrapes them, the schema's `image_url` field misses CSS backgrounds. The most recent pipeline alert (2026-05-09 02:14) shows `"All scrape tiers failed for clarkegammon: HTTP 404"` — the catalogue URL has been broken for at least a day and probably much longer.

**Recommended fix**: **E (source-side limitation) + retire**.
- Clarke Gammon **does not run a live auction catalogue** — they hold auctions when stock allows and direct enquiries to a phone number. The 10 stored lots are private-sale highlights mis-scraped from the homepage; they should not be in the DB at all.
- Add `clarkegammon` to `RETIRED_HOUSES` in lib/houses.js (alongside morrismarshall).
- Delete the 10 stranded lots.
- A markdown recogniser (Option A) wouldn't help — the source page has no auction lots to recognise.
- A schema tweak for CSS background-image (Option B) wouldn't help — even if it worked on the detail pages, those detail pages aren't auction lots.

**Effort**: XS (RETIRED_HOUSES entry + one DELETE)

**Sample data**:
```
address="Sturt Farm Barn, Sturt Road, Haslemere", url=…/sturt-farm-barn-sturt-road-haslemere/, image_url=NULL
   ↑ private-sale dev site £1.6M; image lives in CSS background-image
address="Land adj Grayshott Social Club, Hill Road", url=…/land-adj-grayshott-social-club-hill-road/, image_url=NULL
address="Land adj Old Loom Mill, East Sussex", url=…/land-adj-old-loom-mill-east-sussex/, image_url=NULL
```

**Catalogue URL** (per HOUSE_ROOTS): `https://www.clarkegammon.co.uk/auction/` — **HTTP 404, dead**

---

### 3. morrismarshall — 3/3 NULL (100%)

**Diagnosis**: **ALREADY RETIRED**. lib/houses.js:374 lists `'morrismarshall'` in `RETIRED_HOUSES`. The 3 stale lots are leftovers from before retirement (2026-05-09 in `RETIRED_HOUSES` per the comment block). They have `scraped_with='http'`, `extracted_with='unknown'` — pre-Firecrawl, pre-extractor-retirement data. The current catalogue URL `/search/?instruction_type=Auction` returns "No Properties Found" (verified live).

The earlier diagnosis note ("scrape_method = http (not Firecrawl!) — switching to Firecrawl is likely the fix") is wrong; the issue isn't the engine, it's that the source has no auction lots. Morris Marshall sells furniture at auction (via the-saleroom.com), not property — confirmed by the retirement comment in lib/houses.js.

**Recommended fix**: **E (source-side limitation) + DB cleanup**.
- House is already retired; just delete the 3 stranded lots.
- DO NOT spawn a fixer agent for this house — it's a no-op.

**Effort**: XS (a single DELETE)

**Sample data**:
```
address="Carno, Caersws, Powys", url=…/property-details/NEW250160/…/caersws-15, scraped_with=http
address="Heol Maengwyn, Machynlleth, Powys", url=…/property-details/MAC250072/…
address="Taliesin, Machynlleth, Ceredigion", url=…/property-details/MAC250011/…
```

**Catalogue URL**: `https://www.morrismarshall.co.uk/search/?instruction_type=Auction` — returns "No Properties Found"

---

### 4. taylerandfletcher — 4/9 NULL (44%) + 5/9 wrong (55%)

**Diagnosis**: Multiple compounding problems. **All 9 lots are corrupt**, not just the 4 NULL ones:

1. **The 5 lots WITH `image_url` have a page URL stored as the image URL** (e.g. `image_url = https://www.taylerandfletcher.co.uk/to-rent/market-square-0-bedroom-commercial-for-rent/1434526` — that's a property page URL, not an image). This is the "taylerandfletcher case" the brief flagged.
2. **All 9 lot `url` fields contain literal placeholder tokens** like `%cfp_cp_url_city%` and `%cfp_cp_url_street%` — the website's CMS templating engine never substituted them. So `url = …/to-rent/%cfp_cp_url_city%/%cfp_cp_url_street%/0-bedroom-commercial-for-rent-in-bourton-link/1423833`. Every fetch returns "400 - Bad Request" (visible in the `raw_text` column).
3. **None of the lots are auction lots** — the URL paths reveal them as `/to-rent/` and `/for-sale/` listings. The Firecrawl extractor grabbed rentals and private sales because the `/property-auctions/` page has no actual auction lots (it's WordPress info copy similar to clarkegammon).
4. **One older lot** (2026-04-03, lot 13 "The Old Forge", from `dom-house`) has `image_url = …/wp-content/themes/taylerandfletcher/images/fancy_close.png` — a UI close-button icon. Hero-bleed candidate.
5. **Site has TLS issues** — `curl` fails with cert error 35; only Firecrawl bypasses.
6. **House had circuit-open alert** 2026-05-09 02:15: `"Health 18/100"`.

**Recommended fix**: **E (source-side limitation) + retire**.
- Like clarkegammon, this house's `/property-auctions/` page is informational, not a live catalogue. Retire it.
- The "wrong-URL strip" Option F doesn't help — the underlying lots aren't auction lots; fixing the image-vs-page-URL field would still leave 9 mis-classified rentals/sales in the DB.
- Healing won't help either — the site genuinely has no current auction catalogue page.

**Effort**: XS (RETIRED_HOUSES + DELETE)

**Sample data**:
```
"with image" but image is page URL:
  address="Market Square", 
  url="https://www.taylerandfletcher.co.uk/to-rent/%cfp_cp_url_city%/%cfp_cp_url_street%/0-bedroom-commercial-for-rent-in-market-square/1434526",
  image_url="https://www.taylerandfletcher.co.uk/to-rent/market-square-0-bedroom-commercial-for-rent/1434526",
  raw_text="400 - Bad Request | Your browser sent a request this server could not understand."

NULL image, dom-generic stale:
  address="The Hill", url=…/for-sale/%cfp_cp_url_city%/%cfp_cp_url_street%/3-bedroom-house-townhouse-for-sale-in-the-hill/1421374
```

**Catalogue URL**: `https://www.taylerandfletcher.co.uk/property-auctions/` — service info page, no live auction catalogue

---

### 5. gth (Greenslade Taylor Hunt) — 3/9 NULL (33%)

**Diagnosis**: Mixed. The 6 lots WITH images are real auction lots — they're farm/land listings on the Homeflow CMS with proper `homeflow-assets.co.uk` CDN URLs (e.g. `https://mr1.homeflow-assets.co.uk/files/photo/image/47125/6029/408x_/BST260069_01.jpg`). Recall is fine for those. The 3 NULL lots are **NOT real lots** — they're nav-menu category pages:

```
lot 1: address="Farms & Land", url=https://www.gth.net/properties/sales/tag-gth-farm-land
lot 2: address="Commercial Property", url=https://www.gth.net/properties/sales/tag-gth-commercial
lot 3: address="Development Land", url=https://www.gth.net/properties/sales/tag-gth-development
```

These are the headers from the GTH site's nav menu, scraped before the address-discipline guard landed in CATALOGUE_PROMPT (2026-05-05). They have `scraped_with='cache-enrichment', extracted_with=null` — they're still floating because cache-enrichment doesn't re-validate addresses; it just passes through whatever was there.

GTH is a Homeflow SPA — the catalogue page needs JS rendering (the existing `gth` rewriteUrl in lib/houses.js:1381 has Puppeteer actions for it). The recent pipeline alert (2026-05-09 02:11) shows `"100% of lots (12/12) have ended/sold status — catalogue likely stale"` — meaning even the live recall path is now flagging issues, but that's a separate calendar staleness issue.

**Recommended fix**: **E (source-side limitation, partial) + DB cleanup**.
- One-off SQL: delete the 3 nav-menu junk lots (URL contains `/tag-gth-farm-land`, `/tag-gth-commercial`, `/tag-gth-development`). These are not auction lots and should never have been extracted.
- After deletion, gth's image coverage will be 100% (6/6).
- No schema or recogniser change needed — the existing CATALOGUE_PROMPT address-discipline already prevents new ones.

**Effort**: XS (a 3-row DELETE)

**Sample data**:
```
lot 1: address="Farms & Land", url=https://www.gth.net/properties/sales/tag-gth-farm-land, image_url=NULL
   ↑ this is a CATEGORY page, not a property lot
lot 2: address="Commercial Property", url=https://www.gth.net/properties/sales/tag-gth-commercial, image_url=NULL
lot 3: address="Development Land", url=https://www.gth.net/properties/sales/tag-gth-development, image_url=NULL
```

**Catalogue URL**: `https://www.gth.net/properties/sales/tag-auction` — works (Homeflow SPA, needs Puppeteer/Firecrawl actions)

---

### 6. johnfrancis — 4/14 NULL (29%)

**Diagnosis**: Identical pattern to gth. The 10 lots WITH images are real Homeflow-asset CDN images (proper `mr0.homeflow-assets.co.uk/files/photo/image/...` URLs). The 4 NULL lots are **nav-menu paste-ups** (much worse than gth's — they're concatenated menu strings):

```
lot 1: address="For saleMortgagesSurveyingConveyancingInsuranceNew HomesGuides and AdviceProperties for saleNew homes for saleHow much does it cost to buy a home?",
       url=https://www.johnfrancis.co.uk/properties/sales/most-recent-first
lot 2: address="To rentHouses to rentFlats to rentZero depositTenant insurance",
       url=https://www.johnfrancis.co.uk/properties/lettings/tag-house/most-recent-first
lot 3: address="CommercialCommercial SalesCommercial Lets",
       url=https://www.johnfrancis.co.uk/properties/sales/tag-commercial-sales/status-all
lot 4: address="New HomesFind your new homeDevelopersBuying a new home",
       url=https://www.johnfrancis.co.uk/properties/sales/tag-jf-new-homes
```

These are pre-2026-05-05 extractions when address discipline didn't reject them. They have `scraped_with='cache-enrichment'` — the cache path keeps replaying them.

The recent pipeline alert (2026-05-09 02:15) shows `"Recall 100%: 11/11"` (so live recall is fine) but `"100% of lots (11/11) have ended/sold status — catalogue likely stale"` — same calendar staleness as gth.

**Recommended fix**: **E (source-side limitation, partial) + DB cleanup**.
- One-off SQL: delete the 4 nav-menu junk lots (URLs contain `/most-recent-first`, `/tag-house/most-recent-first`, `/tag-commercial-sales/status-all`, `/tag-jf-new-homes`).
- After deletion, johnfrancis image coverage will be 100% (10/10).
- No schema or recogniser change needed.

**Effort**: XS (a 4-row DELETE)

**Sample data**: see above — the addresses themselves are smoking guns

**Catalogue URL**: `https://www.johnfrancis.co.uk/properties/sales/tag-auction` — works (same Homeflow CMS as gth)

---

### 7. buttersjohnbee — 12/75 NULL (16%)

**Diagnosis**: **URL-canonicalisation duplicates**. Each of the 12 NULL lots has a SISTER row in the DB at the SAME `property_key` with image_url populated. The two rows differ only in URL prefix:

| URL form | image_url state | first_seen |
|---|---|---|
| `https://www.buttersjohnbee.com/listings/residential_sale-BJB090207974-stoke-on-trent` | NULL | 2026-04-26 |
| `https://buttersjohnbee.com/listings/residential_sale-BJB090207974-stoke-on-trent` | populated rexsoftware JWT URL | 2026-05-09 |

(Verified: `property_key='st1 6bl|hanley road'` matches both rows.)

The site previously canonicalised lot URLs with `www.`; at some point the catalogue scrape started returning the `www.`-less form, so a second row was created. Cache-enrichment image backfill picks ONE URL form per lot for HTTP backfill, so the dupes never gain images. The hero-bleed guard (`HERO_BLEED_THRESHOLD = 3`) only deduplicates IMAGES across distinct addresses, not URL forms within the same property_key.

The 12 NULL `www.`-prefixed lots are stale from a prior canonical form. The `last_seen_at` is 2026-05-09 02:17:23 — they get re-touched by `cache-enrichment` (so they don't age out) but the URL form is no longer in any current scrape.

Site-side: rexsoftware JWTs are short-lived (~24 hr verified by token contents) — even the "with image" URLs may break in a day. The fundamental issue is that buttersjohnbee currently has ALL scrape tiers failing with HTTP 404 (alert 2026-05-10 02:06: `"All scrape tiers failed for buttersjohnbee: HTTP 404"`). The `https://www.buttersjohnbee.com/listings?auction=1&status=all` catalogue URL appears intermittently broken.

**Recommended fix**: **E + DB cleanup** (and a follow-up unrelated to image recall).
- One-off SQL: delete the 12 `www.`-prefixed dupes (any row whose `property_key` matches a sister row with image_url populated). Keep the row with the image.
- After cleanup, buttersjohnbee image coverage rises to 100% (63/63).
- Separately (not in this image-recall workstream): the catalogue URL HTTP 404s need investigation — possibly anti-bot escalation or URL format change. That's a healing job, not an image job.
- No schema / recogniser change needed for the image-recall question.

**Effort**: XS for image fix (DELETE). The 404 issue is a separate problem, not in scope.

**Sample data**:
```
NULL row: url="https://www.buttersjohnbee.com/listings/residential_sale-BJB090207974-stoke-on-trent",
          image_url=NULL, address="Hanley Road, Stoke-On-Trent ST1 6BL", property_key="st1 6bl|hanley road"

Sister row: url="https://buttersjohnbee.com/listings/residential_sale-BJB090207974-stoke-on-trent",
            image_url="https://au-mirage.cdns.rexsoftware.com/api/v1/output/eyJ0eXAi…JWT…",
            address="Hanley Road, Stoke-On-Trent ST1 6BL", property_key="st1 6bl|hanley road"
```

**Catalogue URL**: `https://www.buttersjohnbee.com/listings?auction=1&status=all` — currently HTTP 404 per most recent scrape attempt

---

## Grouping recommendation

The brief offers three dispatch options:

> (i) one agent per house = 7 agents
> (ii) batch by similar bug profile
> (iii) exclude low-value targets

**Recommendation: option (ii) — single batched agent, NOT seven.**

Of the seven houses, **six are not really "image extraction" problems**; they are stale-data / wrong-source / dead-URL problems. The fix in every case is one of:
- DELETE stale lots (symondsandsampson, gth, johnfrancis, morrismarshall)
- DELETE dupes (buttersjohnbee)
- RETIRE the slug + DELETE (clarkegammon, taylerandfletcher, morrismarshall already retired)

Only **two houses** (gth, johnfrancis) have any candidate for an actual extraction-side fix, and those candidates are also "delete the junk lots" — there is no markdown-recogniser to write, no schema tweak that would help.

### Concrete fan-out (single agent, sequential SQL job)

**One agent ("data-cleanup-agent")** doing the following on a fresh branch:

1. Mark these slugs as RETIRED in `lib/houses.js` (add to `RETIRED_HOUSES` Set):
   - `clarkegammon` (no live auction catalogue; HOUSE_ROOTS 404)
   - `taylerandfletcher` (no live auction catalogue; URLs full of unrendered template tokens)
2. SQL: delete stale lots:
   - `DELETE FROM lots WHERE house = 'symondsandsampson' AND extracted_with = 'dom-house'` (13 lots)
   - `DELETE FROM lots WHERE house = 'clarkegammon'` (10 lots)
   - `DELETE FROM lots WHERE house = 'morrismarshall'` (3 lots — house already RETIRED)
   - `DELETE FROM lots WHERE house = 'taylerandfletcher'` (9 lots)
   - `DELETE FROM lots WHERE house = 'gth' AND url LIKE '%/tag-gth-%'` (3 nav-menu lots)
   - `DELETE FROM lots WHERE house = 'johnfrancis' AND url LIKE '%/most-recent-first%' OR url LIKE '%/tag-jf-new-homes%' OR url LIKE '%/tag-commercial-sales/%' OR url LIKE '%/tag-house/most-recent-first%'` (4 nav-menu lots)
   - For buttersjohnbee: `DELETE FROM lots l1 USING lots l2 WHERE l1.house='buttersjohnbee' AND l2.house='buttersjohnbee' AND l1.property_key=l2.property_key AND l1.image_url IS NULL AND l2.image_url IS NOT NULL AND l1.url LIKE 'https://www.%' AND l2.url LIKE 'https://buttersjohnbee.com/%'` (12 dupes)
3. After deletes, image_coverage on these houses jumps to 100% (or N/A for retired ones).
4. Run `npm test` and verify the changes don't break tests.
5. Open a single PR titled e.g. `fix: image-recall investigation cleanup — delete 54 stale/junk/dupe lots, retire 2 houses`.

### What NOT to do

- **Do not** write per-house image extractors (Option D). The auction-conventions skill explicitly forbids them; the actual issue isn't extraction.
- **Do not** add markdown recognisers (Option A) for any of these houses. Pattinson/John Pye/McHugh/Mark Jenkinson recognisers solve a real recall problem (lots present in markdown but missed by JSON). None of these seven houses fit that pattern — gth and johnfrancis already have 100% recall on real lots; the NULL-image rows are junk that shouldn't be there at all.
- **Do not** modify the JSON extract schema for CSS background-image extraction (Option B). Only one house (clarkegammon) uses that pattern, and that house's catalogue source is wrong anyway — fixing the schema would still leave non-auction lots in the DB.
- **Do not** spawn fixer agents per house. Six of them have no extraction work to do; the seventh (buttersjohnbee dedup) is also a SQL job.

---

## Anything cross-cutting worth flagging to the lead

Beyond the image-recall question, this investigation surfaced three issues the lead should know about — they are NOT in scope for this workstream but are visible:

1. **buttersjohnbee catalogue URL is HTTP 404 in the most recent scrape attempt** (2026-05-10 02:06). This is a healing job, separate from image recall. Without it, the existing 63 image-bearing lots will progressively age out as their rexsoftware JWTs expire (~24 hr each).

2. **Three houses (gth, johnfrancis, symondsandsampson) hit "100% ended/sold — catalogue likely stale" gates on 2026-05-09**. Their live catalogues may need URL refreshes — it's possible the May 2026 auction has finished and the next event hasn't been published. Check `auction_calendar` against the live sites.

3. **The address-discipline guard (CATALOGUE_PROMPT, 2026-05-05) catches new junk lots, but pre-existing junk-address lots from before 2026-05-05 still float in the DB via cache-enrichment**. Worth doing a one-off site-wide DELETE of any lot whose `address` fails `looksLikeRealAddress()` — not just for these seven houses. Estimated impact site-wide: probably tens of stranded junk lots. Suggest a separate audit pass (out of scope here).
