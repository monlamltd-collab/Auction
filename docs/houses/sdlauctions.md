# SDL Property Auctions — house dossier

| Field | Value |
|---|---|
| **Slug** | `sdlauctions` |
| **Display name** | SDL Auctions |
| **Platform** | Own WordPress site (custom `sdl-auctions` theme); now operates under the **BTG Eddisons** brand but still trades its own catalogue. Photos on the **property-world** platform (same as BTG Eddisons). EIG online-bidding mirror at `online.sdlauctions.co.uk`. |
| **Region** | National (Midlands-heavy; Nottingham / Derby / Leicester / nationwide) |
| **Catalogue URL** | `https://www.sdlauctions.co.uk/search/` (`HOUSE_ROOTS.sdlauctions` in `lib/houses.js`) |
| **Detection** | `detectAuctionHouse()` routes any `sdlauctions` URL → `sdlauctions` (`lib/houses.js`, already present) |
| **Status** | Live — ~186 lots in the catalogue (render-enabled 2026-06-27; awaiting deploy + house_skills row) |
| **Last verified** | 2026-06-27 |

## Lot URL pattern
`https://www.sdlauctions.co.uk/property/{numericId}/{type}-for-auction-{town}/`
(e.g. `/property/51073/commercial-property-for-auction-rotherham/`)

EIG online-bidding mirror (same numeric id): `https://online.sdlauctions.co.uk/lot/redirect/{id}`.

## Recall sentinel
`/sdlauctions\.co\.uk\/property\/(\d+)/gi`

Provenance: derived from the real rendered catalogue markdown (captured live 2026-06-22
via the `ajaxProp` search response → `htmlToRecognitionMarkdown`). Declared in two places
(matching the BTG Eddisons / Charles Darrow convention):
- `lib/scraper/recall-sentinels.js` → `RECALL_SENTINELS.sdlauctions`
- `lib/scraper/house-recognisers.js` → `HOUSE_RECOGNISERS.sdlauctions.recallSentinelPattern`

## Image source
Property photos on the property-world platform (same as BTG Eddisons):
`https://*.property-world.co.uk/.../artnr_{lotPhotoId}/_pictures/….jpg` — the real photo is
lazy-loaded in a `<style>.lazy-{id}{ background-image:url(…artnr_…/_pictures/…) }` block
that turndown **strips**, so the only `![]` image surviving into the recognition markdown is
the per-card estate-AGENT **partner logo** (`…/artnr_{GUID}/_pictures/{Agent}.jpg` — e.g.
`The_property_Fox.jpg`, `Hannells_New_logo.jpg`). The recogniser **rejects** that logo
(image stays empty) and accepts only a genuine `_pictures/` property photo whose filename is
a timestamped photo, not a logo — exactly the BTG/Charles Darrow lazy-photo handling. Lead-
image misses are filled later by the multi-image sweep + detail-page fetch.

## Render / engine needs
The `/search/` grid is **AJAX-hydrated** — a plain HTTP fetch of `/search/` returns 0 lot
cards. The WordPress theme's `searchProperty()` POSTs to
`/wp-content/themes/sdl-auctions/library/property-functions.php` (`func=ajaxProp`, with the
serialized `#prop-search-form` + `&limit=&page={n}&order=&oos=0`) and injects the card HTML
into `#searchView`. So the catalogue needs a **browser render** (Crawlee → turndown) before
the recogniser runs.

**The default render only surfaces ~12 of ~186 lots** — the grid defaults to a page-size of
12 (selector `a.pageLimit`, options `12 / 24 / 36 / 48 / All`), and **scrolling does NOT load
more**. Clicking the **"All"** page-size link re-POSTs `ajaxProp` with no limit and injects the
**full ~186-lot book** into `#searchView`. The render therefore must click "All" once — wired
in [`lib/scraper/crawlee.js`](../../lib/scraper/crawlee.js) `CLICK_TO_LOAD_SELECTORS`
(`{ host: /sdlauctions\.co\.uk$/, selector: 'a.pageLimit', text: 'All', once: true, waitMs: 9000 }`).
It's a **one-shot** toggle (the link does not vanish, unlike Bond Wolfe's "Load more" button),
so it clicks exactly once and waits for the AJAX. `maxPages: 1` in the recogniser entry — the
whole book is on one page after the click, no `?page=N` pagination. Verified live 2026-06-27:
default render 11 ids → click-All **186** ids, recogniser **186/186**.

## Recogniser
`recogniseSdlAuctionsLotsFromMarkdown(markdown) → Map<id, lot>` in
`lib/pipeline/firecrawl-extract.js`. Registered in `lib/scraper/house-recognisers.js`
(`HOUSE_RECOGNISERS.sdlauctions`). Parses, per card: address (first bullet carrying a UK
postcode — skips the bare bedrooms-count bullet; falls back to the `{Type} in {Town}` title),
guide price (`£N+ (plus fees)` after `Guide price*`), detail_url (`/property/{id}/…`),
property_type (from the title link), and auction_date (`Auction date: Nth Mon YYYY`). The
lot link renders 3× per card; keyed by numeric id so repeats merge additively. Tests:
`tests/test-sdlauctions-recogniser.js` (fixtures are a real captured-markdown excerpt,
including the partner-logo rejection case mirroring the BTG card-2 test).

## Known incident
SDL is a **major real auctioneer**, but the project was previously persisting
**fabricated / hallucinated lots** attributed to it (under a mis-wired `scargillmann` slug
that pointed at `sdlauctions.co.uk` — see `RETIRED_HOUSES.scargillmann`, retired 2026-06-21,
and `KNOWN_SENTINEL_GAPS.scargillmann`). Those fabricated lots are purged by a separate
migration, and the anti-fabrication guard was added 2026-06-21. This onboarding (de-conflation
plan 4) registers SDL as its own correctly-wired house so its **real** lots persist under the
`sdlauctions` slug.

### 2026-06-27 — onboarded in code but never scraped (0 live lots) + 12/186 partial render
Root cause (two parts): (1) plan 4 added the recogniser/sentinel/HOUSE_ROOTS but **never created a
`house_skills` row**, and the daily scheduler iterates `house_skills` → SDL was never scraped.
(2) Even once scraped, the default Crawlee render only surfaced 12 of ~186 lots because the
`/search/` grid defaults to a 12-row page size and scrolling doesn't load more. Fix:
`migrations/2026-06-27-onboard-sdlauctions-house-skills.sql` (the row, mirroring the btg_sdl
sister) + a one-shot "Show: All" click in `lib/scraper/crawlee.js` `CLICK_TO_LOAD_SELECTORS`.
No restart needed (no tripped circuit). Verified locally via the real handler sequence: 11 → 186,
recogniser 186/186. The recognisers were never broken — they just never received rendered markdown
(prior memory wrongly inferred a `requires_puppeteer`/`rewriteUrl` gap; under `CRAWLEE_DEFAULT=true`
the engine already renders, so the only levers were the missing row + the page-size click).
