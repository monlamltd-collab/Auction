# Clive Emson — house dossier

| Field | Value |
|---|---|
| **Slug** | `cliveemson` |
| **Display name** | Clive Emson |
| **Platform** | Independent land & property auctioneer on its own JS-rendered SPA. The `/properties/` catalogue is hydrated client-side, so it needs a **browser render** (Crawlee → turndown) before the recogniser runs. |
| **Region** | South & South-East England (Kent, Sussex, Hampshire, Cornwall, Devon, …) — heavy on **land** lots. |
| **Catalogue URL** | `https://www.cliveemson.co.uk/properties/` (`HOUSE_ROOTS.cliveemson` in `lib/houses.js`; `auction_calendar` "Current Catalogue" rolling row). One page lists the whole current auction. |
| **Detection** | `detectAuctionHouse()` routes `cliveemson` → `cliveemson` (`lib/houses.js`). `rewriteUrl` sets `preferPuppeteer: true`. |
| **Status** | Recogniser added 2026-06-22 (this fixes recall + the maps-URL bug). Before: `house_skills.status='broken'`, circuit **open**, last success 2026-05-30. |
| **Last verified** | 2026-06-22 (live render of auction 266 = 150 lots) |

## Lot URL pattern
`https://www.cliveemson.co.uk/properties/{auctionId}/{lotId}/` — e.g. `/properties/266/1/`.
`{auctionId}` is the auction number (266 = the auction held 17 Jun 2026); `{lotId}` is the
per-auction lot index. The detail link **is** a real `<a href>` in the rendered HTML, so it
survives turndown as a markdown link — the recogniser anchors on it.

## Recall sentinel
`/cliveemson\.co\.uk\/properties\/\d+\/(\d+)/gi` (capture = `{lotId}`).
Declared in **both** `lib/scraper/recall-sentinels.js` (`RECALL_SENTINELS.cliveemson`) and
`lib/scraper/house-recognisers.js` (`HOUSE_RECOGNISERS.cliveemson.recallSentinelPattern`) —
identical patterns; the recogniser bundle is the one the crawlee-extract merge consumes.

## Image source
**No thumbnail survives turndown** — the listing photos are lazy-loaded and not materialised,
so the recogniser leaves `image_url` empty. Galleries are filled later by the **multi-image
sweep**, which fetches the now-correct `/properties/{auc}/{lot}/` detail page. (Older auctions
exposed thumbnails at `https://www.cliveemson.co.uk/Auc{N}/pics/{id}-….jpg`; the current
template serves them from `/properties/{auc}/{lot}/image` and only after JS hydration.)

## Render / engine needs
`preferPuppeteer` → Crawlee render → `htmlToRecognitionMarkdown` → recogniser. `maxPages: 1`
(the catalogue is a single page; all ~150 lots render at once).

## Recogniser
`recogniseCliveEmsonLotsFromMarkdown(markdown) → Map<lotId, lot>` in
`lib/pipeline/firecrawl-extract.js`. Registered in `lib/scraper/house-recognisers.js`
(`HOUSE_RECOGNISERS.cliveemson`). Tests: `tests/test-cliveemson-recogniser.js`
(34 assertions; fixtures are the real turndown shape verified against auction 266).

Each lot card is a single multi-line markdown link:
`[LOT {N} / ### {HEADLINE} / {Town} - {County} / {STATUS} **£{amount}**](…/properties/{auc}/{lot}/)`,
preceded by an empty-anchor Google-Maps pin. Two quirks the recogniser absorbs:

- **Double render + double-prefix bug** — every card renders twice: a grid link to
  `/properties/{auc}/{lot}/` and a list link to a **malformed** `/properties/properties/{auc}/{lot}/`
  (the site's own bug). The URL pattern tolerates the optional extra `properties/` so each
  occurrence matches at its own boundary; the recogniser keys by `{lot}`, keeps the first parse,
  and **always emits the clean URL rebuilt from `{auc}/{lot}`** so the double prefix never reaches
  `lots.url`.
- **Headline ≠ address** — the `### …` line is a property-type description; the address used is the
  `{Town} - {County}` line (qualified with the headline when it's too terse for
  `looksLikeRealAddress`). The full street address comes from the first-contact detail fetch + OS Places.

`auction_date` is parsed once from the page header (`## Wednesday 17th June 2026, …`) — Clive
Emson lots previously sat on the `2099-12-31` sentinel date.

## Known incidents
- **Google-Maps URL bug → blank galleries (root cause, fixed 2026-06-22):** with no deterministic
  recogniser, Gemini under-extracted the dense catalogue and stored each lot's "View on Google Maps"
  pin (`https://maps.google.com/maps?q=lat,lng`) as `lots.url`. The multi-image sweep then fetched a
  map instead of the detail page, so galleries never filled (and the fleet-wide de-chrome pass
  stripped the resulting map/badge junk, leaving them blank). The recogniser anchors on the real
  detail link and emits `/properties/{auc}/{lot}/`, so the sweep can fill the gallery. Recall on the
  live auction (266) was ~8/150 before; the recogniser recovers 150/150.
- **Stale zombie lots (open follow-up, flagged 2026-06-22):** ~240 lots from **past** auctions 264
  (Apr, last seen 2026-04-15) and 265 (May, last seen 2026-05-05) were never expired and still read
  as active — including the 152 with the legacy Google-Maps URL. They are **not** in the current
  catalogue, so re-scraping does not touch them; they need a `last_seen_at`-based expiry / post-auction
  reconciliation (Clive Emson has no per-auction calendar row — just the rolling "Current Catalogue").
- **Circuit deadlock + bare-host cert (recovery, fixed 2026-06-28):** the recogniser (#136) shipped but
  the house never ran it — `house_skills` was `status=broken` / `circuit_state=open`, and the circuit
  couldn't be reset (in-memory `_healthMap` only reloads on restart; the manager re-opens it from
  `health=0`). Fixed by letting `/api/admin/rescrape` bypass the circuit (`ignoreCircuit`, #145). That
  let it render — surfacing a third blocker: the Crawlee/Puppeteer fetch of the **bare** host
  `https://cliveemson.co.uk/properties` fails `net::ERR_CERT_COMMON_NAME_INVALID` (CN-invalid cert;
  only `www.` is valid) because the www-stripping calendar trigger leaves the bare host. Fixed by adding
  `cliveemson` to `WWW_CANONICAL_HOSTS` + routing `rewriteUrl` through `canonicaliseHouseHost` — the same
  fix as Charles Darrow / SDL Auctions (2026-06-23).
