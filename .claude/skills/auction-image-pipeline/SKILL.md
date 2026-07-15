---
name: auction-image-pipeline
description: Use when working on lot images in the Auction (Bridgematch AuctionBrain) repo — missing/blank thumbnails or galleries, the multi-image sweep, chrome/junk-image stripping, "house X has no images", or per-house image-recall gaps. Covers the image data model, how galleries fill, the de-chrome system, the admin endpoints (+ auth), and a diagnostic playbook that classifies any missing-image report. Pairs with auction-self-healing.
---

# Auction image pipeline

How lot images work, why they go missing, and how to fix it. Distilled from the
2026-06 image incidents (PRs #129 stale-cache, #130 de-chrome, #131 throughput,
#132 SDL). Always **classify the cause from the DB before fixing** — the fix is
different for each.

## Data model (`lots` table)
- **`image_url`** (text) — the single CARD thumbnail. Set at catalogue scrape. The frontend card renders this.
- **`images`** (jsonb array) — the GALLERY / carousel. `public/app.js` shows a carousel when length > 1.
- A lot with a thumbnail but empty gallery shows one photo; with neither, the frontend shows a property-type icon + "No photo available" placeholder (`getPlaceholderHtml`, `public/app.js`). **Standing rule:** every available lot must show a real photo where the source has one — see `[[feedback-100pct-lot-coverage]]` in memory.

## How galleries fill — `lib/pipeline/multi-image-sweep.js`
`sweepMultiImages()` runs daily 06:00 (server.js scheduler) + on demand. Two passes:
- **PASS 1 (free):** cooldown-free reconcile from the `lot_details` cache.
- **PASS 2:** live fetch (`fetchLotPage`, HTTP→Crawlee, `skipCache:true`) of empty/under-target lots — current-auction-first + urgency-first, fair-shared, ~500/run, 30-min wall-clock.
- It only processes **empty / under-target (<3 images)** lots. Full galleries are NOT re-touched — so cleaning existing junk needs the de-chrome endpoint, not the sweep.
- In practice the sweep is **slow** (~a few lots/min; Crawlee renders dominate) — treat a manual trigger as an hours-long background drain, not instant.

## Vision quality filter — `lib/pipeline/image-quality-filter.js` (first-line junk defence)
A vision classifier (OpenRouter `callVisionAI` primary, direct Gemini legacy fallback) labels each image (property_photo / floor_plan / logo / banner / stock_photo / map / auction_sign / document / unknown) and discards non-property images at the boundary — it runs in the enrich stage (`lib/pipeline/enrich-stage.js`) BEFORE `persist-lots.js` writes `images[]`. First-contact lots only; re-scrapes skip already-vetted lots.
- **Fails open on quota/model errors** — a 429 trips a 10-min circuit breaker and affected lots keep their images **unfiltered** (junk can slip through; the de-chrome layer below is the backstop). `unknown` = "couldn't see the image" → always kept, never cached.
- **Per-URL verdict cache** (since 2026-07-11) — affirmative verdicts are cached in the `image_classifications` table, 90-day TTL, so a URL is never re-classified while fresh. Kill switch: `IMAGE_CLASSIFICATION_CACHE=off`. Tests: `tests/test-image-classification-cache.js`.

## Chrome stripping — `lib/pipeline/image-extract.js` (pure, unit-tested)
Non-property "chrome" (logos, trade-body badges, map loaders, `.svg`/`.gif`, CMS theme assets, shared placeholder slides) pollutes galleries/thumbnails fleet-wide. Two further house-agnostic defences:
- **`isChromeUrl(url)`** — token + format filter (svg/gif; propertymark/naea/rics/tpo/nava; loader; gstatic; vimeocdn; `/oas/`; open-for-business; …). Zero real-photo false positives. `extractImagesFromHtml` uses it.
- **`computeBleedByHouse` + `dechromeGallery`** — an image shared across ≥3 distinct lots of one house is chrome the token filter can't name (e.g. Maggs & Allen's text slide, S&S's webdadi PNG). `dechromeGallery` strips chrome + bleed and promotes the first surviving real photo to the thumbnail.
- **SAFETY GUARD — do not remove:** *never blank a gallery via the bleed heuristic.* Token-chrome may blank (the lot then becomes under-target → the sweep refills it); bleed is removed ONLY when a real image survives — a genuinely shared real photo (a development sold as multiple lots) must never be destroyed. The sweep and the retroactive endpoint share this one cleaner.

## Admin endpoints
All are `POST` and require **BOTH** an `x-admin-secret` header **and** a matching `Origin: https://auctions.bridgematch.co.uk` header (CSRF guard — missing Origin → `403 Forbidden — missing or invalid Origin header`). The Auction app is at `auctions.bridgematch.co.uk`; Railway project `auction-brain`, service `Auction` (single-process, runs the scheduler).
- **`/api/admin/dechrome-images`** — retroactive de-chrome. **Dry-run by default**; `{"apply":true}` writes; `{"house":"x"}` scopes; `{"threshold":N}`. Returns `lotsToChange`, `lotsBlanked`, per-house `sampleRemoved`. ALWAYS dry-run and eyeball `sampleRemoved` (chrome vs real) before applying.
- **`/api/admin/sweep-images`** — fire-and-forget trigger of `sweepMultiImages` (returns immediately; runs in background up to 30 min). Confirm via Railway deploy logs: `multi-image-sweep: starting` / `: complete`.
- **`/api/admin/firecrawl-probe`** — render a URL via the Crawlee tier (`scrapeWithCrawlee`; name kept for callers, **zero Firecrawl credits**) → rendered `html` only; `markdown`/`images` are always empty. `waitFor` (ms) maps to Crawlee's `timeoutMs`; 503 if the Crawlee tier is unavailable. The render auto-scrolls + waits for networkidle2, but a timeout can still return a shell — don't trust an empty probe to mean "no lots/images".

## Diagnostic playbook — "house X has missing images"
Classify against the DB first (Supabase project `pohrbfhftbprlfzsozyj`, via the `supabase`/`supabase-authed` MCP). The cause is almost always one of:
1. **Stale-cache false-negative** (#129) — lot stamped `no_images_found` in `enrichment_manifest.multi_image_sweep`, but the cached/live detail page actually HAS photos. Already fixed by the two-pass sweep (skipCache + reconcile); recover the backlog by triggering the sweep.
2. **Chrome in gallery/thumbnail** (#130) — `images[]`/`image_url` are logos/badges/map tiles. Fix = `dechrome-images` endpoint (dry-run → apply).
3. **Wrong lot `url`** (cliveemson) — `url` points at a Google-Maps embed (or other non-detail page), so the sweep fetches the wrong page and never finds photos. Fix = a per-house recogniser that captures the real detail URL.
4. **Recall gap** — extraction never captured per-lot photos (only site furniture): JS-rendered cards whose links are scripted (not `<a href>`), or EIG banner-only pages. Fix = per-house recogniser / render escalation.
5. **Throughput/backlog** — photos exist, lot just hasn't been swept yet. Wait for 06:00, or trigger `sweep-images`.
6. **Vision-filter fault** — three sub-cases: (a) *quota fail-open* — junk persisted while the classifier was in 429 cooldown; re-run de-chrome (or re-classify) once quota recovers. (b) *misclassification* — a real photo discarded (or junk kept) by the model; check the lot's kept/discarded URLs against the source page. (c) *stale cached verdict* — a wrong verdict in `image_classifications` (90-day TTL) keeps re-applying; delete that URL's row (or set `IMAGE_CLASSIFICATION_CACHE=off`) and re-scrape.

**Handy SQL building blocks:** `jsonb_array_length(images)`; empty-gallery = `images IS NULL OR jsonb_array_length(images)=0`; sweep verdict = `enrichment_manifest->'multi_image_sweep'->>'status'`; cross-lot "bleed" = explode `images` then `GROUP BY house,url HAVING count(DISTINCT id) >= 3`; classify a house's lot URLs (`%maps.google%` vs the expected detail pattern).

## Conventions
- Prefer generic, house-agnostic fixes ("kill many birds"), BUT 100% coverage outranks that — write a per-house recogniser when it's the only way to hit 100% (see `auction-conventions` "Adding a New Auction House" + `docs/houses/<slug>.md`).
- Recognisers are built/tested against **real captured rendered markdown** as a fixture (the build env has no Chromium — capture via the prod Crawlee path, or take `firecrawl-probe` rendered HTML through the turndown bridge `lib/scraper/html-to-markdown.js`; the probe itself returns HTML only, no markdown).
- Never commit the admin secret. Use the project's CSRF Origin header on every admin POST.
