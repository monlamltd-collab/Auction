---
phase: 2
plan: 1
title: "EPC & Flood Risk Enrichment Pipeline"
status: complete
completed_at: "2026-03-15"
---

# Plan 02-01 Summary: EPC & Flood Risk Enrichment Pipeline

## What was done

### Task 1: enrichment_cache table SQL
Added `ensureEnrichmentCacheTable()` function in server.js that checks for and creates the `enrichment_cache` table on startup with postcode as primary key, JSONB columns for EPC/flood data, lat/lon coordinates, and 30-day TTL via `expires_at` column.

### Task 2: EPC API client
Implemented `fetchEPCByPostcode(postcode)` with HTTP Basic Auth using `EPC_API_EMAIL` and `EPC_API_KEY` env vars. Includes 500ms rate limiting, 10s timeout, and graceful degradation when credentials are missing or API errors occur.

### Task 3: EPC address matching
Implemented `matchEPCToLot(epcRecords, lotAddress)` with address normalisation (strips flat/apartment/unit, collapses whitespace), building number + street name matching, most-recent-lodgement-date preference, and validation (rating A-G, score 1-100).

### Task 4: Flood zone lookup
Implemented `fetchFloodZone(postcode)` with two-step approach: geocode via Postcodes.io, then check EA WFS for Zone 3/2/1 classification. Falls back to EA flood monitoring API if WFS times out. 200ms rate limiting between EA calls.

### Task 5: enrichLots() integration with caching
Added EPC + flood enrichment block to `enrichLots()` after the existing Land Registry step. Uses CONCURRENCY=3 with `Promise.allSettled`, checks `enrichment_cache` before API calls, stores results with 30-day TTL, and cleans expired entries once per cycle.

### Task 6: Frontend display
Added EPC rating pill and flood zone indicator to lot card summary in `card()` function, and full enrichment section in `expandCard()` with colour-coded badges (green for A/B/Zone1, orange for C/D/Zone2, red for E-G/Zone3). All enrichment data is visible to ALL users without any tier gating.

### Task 7: Test suite
Created `tests/test-enrichment.js` with 39 tests covering EPC matching (13 tests), flood zone classification (11 tests), cache TTL logic (8 tests), and ungated display verification (7 tests). All tests pass.

## Key decisions
- EPC/flood data is completely ungated (ENRH-04 compliance) — no blurred class, no isPremium() check
- Cache uses Supabase `enrichment_cache` table with 30-day TTL
- Enrichment is best-effort — failures never block the main pipeline
- Existing CSS variables used throughout (--accent, --accent-warn, --accent-danger)

## New environment variables
- `EPC_API_EMAIL` — Email for EPC API auth
- `EPC_API_KEY` — API key for EPC API auth

## Files modified
- `server.js` — enrichment_cache table, fetchEPCByPostcode, matchEPCToLot, fetchFloodZone, enrichLots integration
- `index.html` — EPC/flood badges in card() and expandCard()
- `tests/test-enrichment.js` — New test file (39 tests)

## Verification
All 7 task verify steps passed. Full test suite: 39/39 passing.
