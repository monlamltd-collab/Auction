---
phase: 02
status: passed
verified_at: 2026-03-15
must_haves_verified: 15/15
---

# Phase 02 Verification: Enrichment & House Expansion

## Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ENRH-01 | Verified | `fetchEPCByPostcode()` at server.js:9165, uses MHCLG open data API with Basic Auth |
| ENRH-02 | Verified | `fetchFloodZone()` at server.js:9223, EA WFS for Zone 3/2/1 with monitoring API fallback |
| ENRH-03 | Verified | `enrichLots()` at server.js:9513 runs EPC/flood async post-extraction, CONCURRENCY=3, 30-day TTL cache via `enrichment_cache` table |
| ENRH-04 | Verified | EPC/flood badges in index.html:2469 and 2731 have NO `isPremium()` gate, NO `blurred` class wrapper. Comment at line 2731: "ungated -- visible to ALL users" |
| IMG-01 | Verified | IMG_HELPERS module (server.js:5267) with `getBestImgSrc()`, `extractCardImage()` injected into all extractors. Lazy-load chain: data-src -> data-lazy-src -> data-original -> src -> srcset -> background-image. 99.6% coverage on new houses |
| IMG-02 | Verified | Firecrawl formats set to `['markdown', 'rawHtml', 'images']` at server.js:679 |
| IMG-03 | Verified | `GET /api/admin/missing-images` at server.js:4188 with `x-admin-secret` auth. Admin dashboard section in admin.html:430 with house filter, table, coverage badge |
| EXPN-01 | Verified | 15 new houses added to HOUSE_ROOTS (server.js:1044-1059), exceeding minimum of 5 |
| EXPN-02 | Verified | Each house has a DOM extractor: custom (agentsproperty:7551, andrewcraig:7618, buttersjohnbee:7674, cheffins:7727, fssproperty:7787, iamsold:7831, suttonkersh:7132) or aliased (6 AH UK branches via auctionhouseuk:7397, wired at 7913; brownco/cheffinstimed via EIG extractor). All 15 pass live test with >0 lots |
| EXPN-03 | Verified | Image URLs captured for all new houses. Test results in HOUSE_ROOTS comment block (server.js:1062-1083): 99.6% image coverage (3,303/3,315 lots) |
| EXPN-04 | Verified | `buildPageUrl()` at server.js:4872 has entries for agentsproperty (/page/N/), suttonkersh (start=N offset), buttersjohnbee, brownco, iamsold, andrewcraig. AH UK branches return all lots on single page |

## Plan 02-01: EPC & Flood Enrichment — must_haves

| # | must_have | Status | Evidence |
|---|-----------|--------|----------|
| 1 | enrichment_cache table SQL in server.js | Verified | `ensureEnrichmentCacheTable()` at server.js:9635. Creates table with postcode PK, JSONB columns, expires_at for 30-day TTL, row-level security policy. Called on startup via setTimeout at line 9738 |
| 2 | fetchEPCByPostcode() with auth | Verified | server.js:9165. HTTP Basic Auth via `Buffer.from(EPC_API_EMAIL + ':' + EPC_API_KEY).toString('base64')`. 500ms rate limiting, 10s timeout, graceful null return on missing credentials or errors |
| 3 | matchEPCToLot() with address matching | Verified | server.js:9356. Address normalisation, building number + street matching, most-recent-lodgement preference, rating A-G validation |
| 4 | fetchFloodZone() returns zone 1/2/3 | Verified | server.js:9223. Two-step: geocode via Postcodes.io, then EA WFS checks Zone 3 first (line 9265), then Zone 2 (line 9285), defaults to Zone 1 (line 9251). Fallback to EA flood monitoring API on WFS failure |
| 5 | enrichLots() integrates enrichment with caching | Verified | server.js:9513. Runs after Land Registry step, checks enrichment_cache before API calls (line 9539), upserts with 30-day TTL (line 9573), cleans expired entries (line 9522) |
| 6 | Frontend displays EPC badge and flood zone, NOT gated | Verified | index.html:2469 (card summary: EPC pill + FZ pill) and index.html:2731 (expanded card: colour-coded badges with risk levels). No isPremium() check, no blurred class, no tier logic anywhere near these elements |
| 7 | tests/test-enrichment.js exists | Verified | File exists at `tests/test-enrichment.js` with 39 tests covering EPC matching, flood classification, cache TTL, and ungated display |

## Plan 02-02: Image Coverage — must_haves

| # | must_have | Status | Evidence |
|---|-----------|--------|----------|
| 1 | DOM extractors handle data-src, data-lazy-src, data-original | Verified | IMG_HELPERS at server.js:5267 defines `getBestImgSrc()` with full lazy-load chain. Injected into all extractors at line 372. Also in Firecrawl executeJavascript actions at lines 667-668 and 779-780 |
| 2 | Firecrawl images format in scrape requests | Verified | `formats: ['markdown', 'rawHtml', 'images']` at server.js:679 |
| 3 | GET /api/admin/missing-images endpoint with auth | Verified | server.js:4188, protected by `x-admin-secret` header check at line 4189-4191. Returns total, houses, houseCounts, results array |
| 4 | Admin dashboard missing-images section | Verified | admin.html:430 has `#missing-images-section` with house filter dropdown (line 444), table (line 460), coverage badge (line 440), refresh button (line 435). `loadMissingImages()` function at line 714 |
| 5 | Test files exist | Verified | `tests/test-image-coverage.js` (7 tests) and `tests/test-missing-images-endpoint.js` (4 tests) both exist |

## Plan 02-03: House Expansion — must_haves

| # | must_have | Status | Evidence |
|---|-----------|--------|----------|
| 1 | At least 5 new houses in HOUSE_ROOTS | Verified | 15 new houses added at server.js:1044-1059. Batch 2: agentsproperty, andrewcraig, buttersjohnbee, brownco, cheffins, cheffinstimed, fssproperty, iamsold, suttonkersh. Batch 3: auctionhouseeastanglia, auctionhousenorthwest, auctionhousenortheast, auctionhousewales, auctionhousebirmingham, auctionhousekent |
| 2 | Each has a DOM extractor (custom or aliased) | Verified | Custom extractors: agentsproperty (7551), andrewcraig (7618), buttersjohnbee (7674), cheffins (7727), fssproperty (7787), iamsold (7831), suttonkersh (7132). Aliased: 6 AH UK branches wired to `auctionhouseuk` extractor at line 7913. brownco and cheffinstimed use EIG platform extractor |
| 3 | Pagination handling for multi-page houses | Verified | `buildPageUrl()` at server.js:4882-4892 has cases for agentsproperty, suttonkersh (offset-based), buttersjohnbee, brownco, iamsold, andrewcraig. AH UK branches confirmed single-page |
| 4 | Each new extractor returns >0 lots on live test | Verified | Live test results documented in HOUSE_ROOTS comment block (server.js:1062-1083): all 15 houses pass, total 3,315 lots, 99.6% image coverage |

## Gaps Found

None. All 11 Phase 2 requirement IDs (IMG-01, IMG-02, IMG-03, ENRH-01, ENRH-02, ENRH-03, ENRH-04, EXPN-01, EXPN-02, EXPN-03, EXPN-04) are accounted for and verified against actual code.

## Success Criteria Check (from ROADMAP.md)

1. **EPC + flood risk displayed per lot, cached 30 days** — Verified. Both displayed in card and expanded views, 30-day TTL in enrichment_cache table.
2. **Image coverage >80%** — Verified. New houses at 99.6%. IMG_HELPERS + Firecrawl images format improve coverage system-wide.
3. **Missing images flagged in admin dashboard** — Verified. Dedicated section with house filter, table, coverage percentage, colour-coded badge.
4. **At least 5 new houses with working extractors** — Verified. 15 new houses, 3,315 lots, all pass live test.
5. **Enrichment data visible to all users, not gated** — Verified. No isPremium() check, no blurred class near EPC/flood display code.
