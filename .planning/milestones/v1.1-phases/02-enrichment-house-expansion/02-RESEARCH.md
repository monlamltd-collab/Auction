# Phase 2: Enrichment & House Expansion — Research

**Researched:** 2026-03-15
**Status:** Complete

## Current Architecture

### Server & Data Flow
- **Single file server**: `server.js` (~10,256 lines) — Express app on Railway
- **Database**: Supabase (PostgreSQL) — `cached_analyses` stores lot data as JSONB in a `lots` column
- **Pipeline**: `autoAnalyseAll()` runs on startup (30s delay) then every 6 hours. For each catalogue-ready auction, calls `autoAnalyseOne(url)` which scrapes, extracts, enriches, and caches
- **Existing enrichment**: `enrichLots()` already runs post-extraction — groups lots by postcode, queries Land Registry SPARQL endpoint for street sales/comps, estimates rental yields. This is the natural insertion point for EPC + flood enrichment

### Lot Data Structure (JSONB in `cached_analyses.lots`)
Each lot object includes: `lot`, `address`, `price`, `url`, `imageUrl`, `propType`, `beds`, `tenure`, `postcode` (set by `extractPostcode()`), `score`, `opps[]`, `risks[]`, `bullets[]`, `streetSales[]`, `streetAvg`, `belowMarket`, `estGrossYield`, `estMonthlyRent`, `estAnnualRent`, `status` (available/sold/STC/withdrawn), `blurred` (tier gating)

No `epcRating`, `epcScore`, `floodRisk`, or similar fields exist yet.

### Postcode Extraction
`extractPostcode(address)` at line 8527 uses regex `/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i` to pull UK postcodes from lot addresses. Already called in `enrichLots()` and stored as `lot.postcode`. This is the key for EPC and flood lookups.

### Image Pipeline (Current State)
Multi-strategy approach in priority order:
1. **DOM extractors** — per-house selectors extract `imageUrl` from HTML
2. **Firecrawl `images` format** — images array returned alongside rawHtml
3. **Firecrawl `executeJavascript`** — forces lazy-load swap
4. **Two-pass backfill**:
   - `backfillImages()` / `backfillImagesWithFirecrawl()` — JSDOM + Firecrawl images, matches by lot number/URL/address/position
   - `backfillImagesWithPuppeteer()` — Puppeteer fallback for remaining misses
5. **`backfillImagesFromLotPages()`** — fetches individual lot detail pages for image extraction

Image coverage is already tracked per-house in `house_skills.image_coverage` and in `analytics_snapshots.image_coverage_pct`. The admin dashboard shows these metrics (Phase 1 FRSH-05 complete).

### DOM Extractors
`DOM_EXTRACTORS` object at line 5149 contains per-house JavaScript extractors. Key patterns:
- **Unique extractors**: savills, allsop, sdl, network, bondwolfe, barnardmarcus, auctionhouselondon, auctionhouse, cliveemson, strettons, acuitus, hollismorgan, maggsandallen, mchughandco, knightfrank, pattinson, bidx1, philliparnold, edwardmellor, paulfosh, cottons, dedmangray, barnettross, bradleyhall, connectuk, auctionestates, landwood, loveitts, hunters, probateauction, countrywide, venmore, tcpa, futureauctions, kivells, firstforauctions, harmanhealy, seelauctions, robinsonhall, dawsons, goldings, agentsproperty, andrewcraig, buttersjohnbee, cheffins, fssproperty, iamsold, durrants
- **Shared extractors**: `eigplatform` (reused by astleys, henrysykes, clarkesimpson, brownco), `auctionhouseuk` (reused by auctionhousescotland, austingray)
- **Universal fallback**: `UNIVERSAL_DOM_EXTRACTOR` for unknown houses
- **Gemini fallback**: When DOM extractor returns <3 lots, HTML is sent to Gemini for AI extraction

`HOUSE_ROOTS` lists 47 houses with catalogue URLs.

### Frontend Lot Display
- `index.html` (~3000 lines) — single-page app with inline JS
- Lot cards built by `renderLots()` → card HTML template at line ~2463
- Expanded detail panel via `expandCard(lot)` at line 2679 — shows image, AI analysis, signals, finance check widget, and "Coming Soon" labels for premium features
- EPC/flood data would display in the expanded panel and potentially as pills/chips on the card

## External APIs

### MHCLG EPC Data (Domestic Energy Performance Certificates)

**Endpoint:** `https://epc.opendatacommunities.org/api/v1/domestic/search`

**Authentication:** HTTP Basic Auth — Base64-encoded `email:api-key`. Requires free registration at `epc.opendatacommunities.org` to get an API key.

**Rate Limits:** No explicit rate limits documented, but should be used respectfully. Batch by postcode to minimise calls.

**Postcode Search:** `?postcode=SW1A2AA` (full postcode, no space required) or prefix like `?postcode=SW1A`

**Response Format:** JSON (via `Accept: application/json` header), CSV, Excel, Zip

**Key Fields Returned:**
- `current-energy-rating` — EPC band (A-G)
- `current-energy-efficiency` — Numeric score (1-100)
- `property-type` — Detached, Semi-Detached, Terraced, Flat, etc.
- `total-floor-area` — Square metres
- `lodgement-date` — When EPC was lodged
- `address`, `postcode`, `uprn`
- `potential-energy-rating` — Potential rating after improvements

**Pagination:** Default 25 per page, max 5000 per page. Use `search-after` parameter for unlimited results.

**Key Consideration:** Multiple EPC certificates may exist per address (one per lodgement). Must pick the most recent one. Match by address within the postcode results, not just postcode alone (a postcode covers multiple properties).

**GDPR Note:** Contains personal data (addresses). Must comply with Data Protection Act 2018. Address data usage needs Royal Mail licensing awareness.

**Registration Action Required:** Someone must register at `epc.opendatacommunities.org` to get API credentials. Store as `EPC_API_EMAIL` and `EPC_API_KEY` environment variables.

### Environment Agency Flood Risk

**Challenge:** There is no simple "postcode to flood zone" REST API from the Environment Agency. The available options are:

**Option A: Real-Time Flood Monitoring API (Not Ideal)**
- Endpoint: `https://environment.data.gov.uk/flood-monitoring/id/floods`
- Provides current flood warnings/alerts, not long-term flood zone classification
- Supports lat/lon proximity queries (`?lat=y&long=x&dist=r`)
- No postcode parameter — would need geocoding first
- Free, no auth required, Open Government Licence
- **Verdict:** Wrong data type — shows active warnings, not planning flood zones

**Option B: ArcGIS Tile Services (Used by GOV.UK)**
- The GOV.UK "Check long term flood risk" service uses ArcGIS vector tile services at `tiles.arcgis.com/tiles/JZM7qJpmv7vJ0Hzx/arcgis/rest/services/`
- Services include: Risk of Flooding from Rivers and Sea, Surface Water Risk
- These are map tile services, not query APIs — designed for rendering, not point-in-polygon lookups
- **Verdict:** Not practical for server-side postcode queries

**Option C: Postcodes.io + Flood Monitoring API (Practical Compromise)**
1. Convert postcode to lat/lon using `https://api.postcodes.io/postcodes/{postcode}` (free, no auth, no rate limit beyond fair use)
2. Query `https://environment.data.gov.uk/flood-monitoring/id/floods?lat={lat}&long={lon}&dist=5` to check for nearby active flood warnings
3. Also query flood areas: `https://environment.data.gov.uk/flood-monitoring/id/floodAreas?lat={lat}&long={lon}&dist=2`
4. **Limitation:** Only shows current/recent flood events, not long-term flood zone classification (Zone 1/2/3)

**Option D: Flood Map for Planning GeoServer (Best Data, More Complex)**
- EA publishes Flood Zone 2 and 3 data as OGC Web Feature Service (WFS)
- URL pattern: `https://environment.data.gov.uk/spatialdata/flood-map-for-planning-rivers-and-sea-flood-zone-{2|3}/wfs`
- Can do spatial queries (point-in-polygon) to determine if coordinates fall within Flood Zone 2 or 3
- Requires: postcode → lat/lon (via Postcodes.io), then WFS GetFeature with spatial filter
- **Verdict:** Best approach for actual flood zone data, but more complex to implement

**Recommended Approach:**
1. Use **Postcodes.io** for postcode → lat/lon geocoding (free, reliable)
2. Use **EA WFS** for flood zone classification (Zone 1/2/3) — try this first
3. Fallback to **EA flood monitoring API** for active flood warnings as supplementary data
4. Display: "Flood Zone 1" (low risk), "Flood Zone 2" (medium), "Flood Zone 3" (high) — these are planning designations that investors understand

**If WFS proves unreliable**, a simpler alternative: query flood warnings API for nearby active/recent warnings and classify as "No current flood risk" / "Flood alert area" / "Flood warning area". Less precise but much simpler to implement.

## Image Coverage

### Current State
- ~47 houses in `HOUSE_ROOTS`
- Image coverage tracked in `house_skills.image_coverage` and `analytics_snapshots.image_coverage_pct`
- Target: >80% (currently unknown exact baseline — check admin dashboard)
- Known issues: Firecrawl lazy-load images not always captured, cascading image loss when Gemini fallback triggers

### Improvement Strategies (IMG-01, IMG-02)

1. **Firecrawl structured output (IMG-02):** Phase 1 switched to `['markdown', 'rawHtml']` format (HARD-07). The `images` format can be added as a third option to capture all page images. Already partially implemented in `scrapeRenderedPage()` with `executeJavascript` for lazy-load forcing.

2. **Per-house image selector audit:** Review each DOM extractor's image extraction. Common issues:
   - `data-src` / `data-lazy-src` not being read (only `src` checked)
   - Background images in CSS `style` attributes missed
   - Thumbnail URLs used instead of full-size (e.g. `/thumb/` vs `/large/`)
   - Relative URLs not resolved

3. **Lot page image backfill:** `backfillImagesFromLotPages()` already exists — ensure it runs for all houses, not just those in specific lists. Individual lot pages almost always have images.

4. **Position-based fallback refinement:** Current position-based matching (nth image = nth lot) can misalign. Improve by filtering out navigation/logo/icon images before position matching.

### Missing Image Flagging (IMG-03)
- Admin dashboard already shows image coverage per house
- Need: filterable list of lots with missing images showing house name, lot number, catalogue URL
- Implementation: New admin API endpoint that queries `cached_analyses.lots` JSONB for entries where `imageUrl` is null/empty, returns as filterable table

## New Auction Houses

### Current Coverage
47 houses in `HOUSE_ROOTS` with DOM extractors. Target: add at least 5 more.

### Candidates from AUCTION_URLS_RESEARCH.md
Already identified and added to `HOUSE_ROOTS` but may need DOM extractor verification:
- `agentsproperty` — WordPress site, ~87 lots
- `andrewcraig` — Estate Apps platform, ~35 lots
- `buttersjohnbee` — Own website with auction filter, ~32 lots
- `brownco` — EIG platform (already wired to `eigplatform` extractor)
- `cheffins` — Own platform, ~10 lots
- `fssproperty` — Own platform, ~5 lots
- `iamsold` — National platform, 100s of lots

### Additional Candidates to Research
From AUCTION_URLS_RESEARCH.md "Possible" list:
- **Symonds & Sampson** — blocks automated fetches (403), may need Puppeteer/Firecrawl
- **Greenslade Taylor Hunt** — blocks automated fetches (403)
- **All Wales Auction** — PHP site, lots on external TPP UK platform

### Platform Leverage
- **EIG platform houses**: Any new EIG-hosted house can reuse `DOM_EXTRACTORS.eigplatform` — just add to the alias wiring loop. The EIG extractor handles lot-panel cards, grid/list views, and image extraction.
- **Auction House UK branches**: Reuse `DOM_EXTRACTORS.auctionhouseuk`
- **iamsold platform**: Once `iamsold` extractor works, could add any iamsold-powered agent (Clarke Gammon, Drivers & Norris, etc.)

### Extractor Development Pattern
Each DOM extractor is a JavaScript string that runs in JSDOM. Pattern:
1. `document.querySelectorAll()` to find lot cards
2. Extract: lot number, address, price, URL, imageUrl, bullets
3. Return array of lot objects
4. Test with live catalogue URL to verify >0 lots returned

### Challenges
- Houses that block scraping (403) — need Firecrawl or Puppeteer
- Houses with JS-only rendering — need Firecrawl (primary) or Puppeteer (fallback)
- Pagination patterns vary per house — some infinite scroll, some page params, some no pagination
- Houses that redesign break extractors — Gemini fallback mitigates but loses images

## Database Changes

### New Fields on Lot Objects (JSONB in `cached_analyses.lots`)
No schema migration needed — lots are stored as JSONB. Add fields to lot objects:
```
lot.epcRating        — String: "A" through "G" or null
lot.epcScore         — Number: 1-100 or null
lot.epcDate          — String: ISO date of most recent EPC lodgement
lot.floodZone        — String: "1", "2", "3" or null
lot.floodRiskLevel   — String: "Low", "Medium", "High" or null
lot.enrichedAt       — String: ISO timestamp of when enrichment ran
```

### New Table: Enrichment Cache
To avoid re-querying APIs for the same postcode within 30 days:
```sql
CREATE TABLE IF NOT EXISTS enrichment_cache (
  postcode TEXT PRIMARY KEY,
  epc_data JSONB,          -- Array of EPC records for this postcode
  flood_zone TEXT,         -- "1", "2", "3"
  flood_data JSONB,        -- Raw flood risk response
  lat NUMERIC(9,6),        -- Cached geocode
  lon NUMERIC(9,6),
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX idx_enrichment_expires ON enrichment_cache(expires_at);

ALTER TABLE enrichment_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON enrichment_cache FOR ALL USING (true) WITH CHECK (true);
```

This table caches enrichment at the postcode level (not per-lot), matching the existing `enrichLots()` pattern of grouping lots by postcode.

### Alternative: Add Columns to `cached_analyses`
Not needed — the JSONB `lots` column already holds per-lot data. Adding `epcRating` etc. to each lot object in the JSONB is sufficient. The `enrichment_cache` table handles the 30-day cache at the postcode level.

## Caching Strategy

### 30-Day Enrichment Cache (ENRH-03)
1. **Postcode-level caching** in `enrichment_cache` table
2. Before querying EPC/flood APIs, check cache: `SELECT * FROM enrichment_cache WHERE postcode = $1 AND expires_at > NOW()`
3. If cache hit: use stored EPC data and flood zone, skip API calls
4. If cache miss: query APIs, store results with 30-day TTL
5. Cache invalidation: automatic via `expires_at` column; no manual invalidation needed (EPC ratings and flood zones rarely change)

### Integration with Existing Pipeline
`enrichLots()` already groups lots by postcode and batches Land Registry queries with CONCURRENCY=5. Add EPC + flood queries to the same loop:
```
For each unique postcode:
  1. Check enrichment_cache
  2. If miss: query Postcodes.io for lat/lon (if needed for flood)
  3. Query EPC API by postcode
  4. Query flood zone by lat/lon
  5. Store all in enrichment_cache
  6. Apply to lots
```

### Rate Limiting Considerations
- **EPC API**: No documented rate limits, but be conservative. Use CONCURRENCY=3 with 500ms delay between batches.
- **Postcodes.io**: Supports bulk lookups (`POST /postcodes` with array of up to 100 postcodes). Use this for efficiency.
- **EA flood API/WFS**: No auth required, reasonable use expected. CONCURRENCY=3 with 200ms delay.
- **Total per catalogue**: Average 50-100 lots, ~30-60 unique postcodes. Even at 500ms per postcode, enrichment adds only 15-30 seconds to pipeline.

## Technical Risks

### Risk 1: EPC API Registration Required
**Impact:** Medium — cannot proceed without API key
**Mitigation:** Register account at `epc.opendatacommunities.org` early. Store credentials as env vars `EPC_API_EMAIL` and `EPC_API_KEY`.

### Risk 2: EPC Address Matching Ambiguity
**Impact:** Medium — postcode returns multiple properties, must match correct one to lot
**Mitigation:** Match by address within postcode results. Use fuzzy matching (normalise case, strip "Flat", "Apartment", number formatting). If no confident match, return null rather than wrong data. Multiple EPCs per address — always use most recent by `lodgement-date`.

### Risk 3: Flood Zone Data Complexity
**Impact:** High — no simple postcode-to-flood-zone API exists
**Mitigation:** Start with EA WFS approach (Option D). If too complex, fall back to flood monitoring API (active warnings only) as MVP, with WFS as Phase 2b enhancement. Worst case: display "Check flood risk" link to GOV.UK service with pre-filled postcode.

### Risk 4: Enrichment Pipeline Performance
**Impact:** Low — adds API calls to existing enrichment step
**Mitigation:** Postcode-level caching means repeat postcodes in same catalogue are free. 30-day cache means re-scrapes of same catalogue skip enrichment entirely. Postcodes.io bulk endpoint handles up to 100 postcodes per call.

### Risk 5: New House Extractors Breaking
**Impact:** Medium — houses redesign sites, extractors stop working
**Mitigation:** Gemini fallback already handles this. Platform-based extractors (EIG, Auction House UK) are more stable since platform changes affect all houses simultaneously. `house_skills` table tracks extractor health. Pipeline alerts (FRSH-04) fire on extraction failures.

### Risk 6: GDPR Compliance for EPC Data
**Impact:** Low-Medium — EPC data contains addresses (personal data under GDPR)
**Mitigation:** Only display EPC rating/score, not full EPC certificate details. Cache at postcode level, not per-address. Display as a property attribute alongside other publicly visible data (price, tenure, etc.).

### Risk 7: server.js Size
**Impact:** Low — file is already 10,256 lines. Adding enrichment + new extractors will push towards 12,000+.
**Mitigation:** Keep enrichment functions self-contained near existing `enrichLots()`. Consider extracting DOM extractors to a separate file in a future refactor, but not in this phase.

## Validation Architecture

### Enrichment Data Quality

**EPC Validation:**
- Verify `epcRating` is a single character A-G
- Verify `epcScore` is a number 1-100
- Cross-check: EPC rating should correlate with score (A=92-100, B=81-91, C=69-80, D=55-68, E=39-54, F=21-38, G=1-20)
- Log mismatches between lot property type and EPC property type as warnings
- Track enrichment hit rate: % of lots with valid postcodes that get EPC data (target: >60%, since not all properties have EPCs)

**Flood Zone Validation:**
- Verify `floodZone` is one of "1", "2", "3", or null
- Cross-check with existing scoring: lots in flood zone 2/3 should already have "Flood risk" in `risks[]` if detected by AI — compare agreement rate
- Track enrichment hit rate: % of lots with valid postcodes that get flood zone data (target: >80%, since postcodes.io + WFS should work for most UK postcodes)

### Image Coverage Metrics

**Already in place (Phase 1):**
- `house_skills.image_coverage` — per-house percentage
- `analytics_snapshots.image_coverage_pct` — daily snapshot
- Admin dashboard visualisation

**New for Phase 2:**
- Missing-image lot list endpoint: `GET /api/admin/missing-images?house=X` returning `[{house, lotNumber, address, catalogueUrl}]`
- Aggregate metric: overall image coverage across all houses (weighted by lot count)
- Per-run diff: image coverage change logged in `house_skills.last_diff`

### Extractor Correctness

**Live Test Protocol (EXPN-02):**
1. For each new house, run DOM extractor against live catalogue URL
2. Verify: `lots.length > 0`
3. Verify: no duplicate lot numbers (`new Set(lots.map(l => l.lot)).size === lots.length`)
4. Verify: >50% of lots have addresses with valid postcodes
5. Verify: >50% of lots have non-null prices
6. Verify: images captured where available (EXPN-03)

**Pagination Verification (EXPN-04):**
- For houses with >1 page: verify total lots > single page lot count
- Check that page 2+ lots have different lot numbers from page 1
- Log pagination method used (URL param, infinite scroll, API cursor)

**Ongoing Health:**
- `house_skills.status` tracks healthy/degraded/broken
- Pipeline alerts fire when extraction returns 0 lots for a previously healthy house
- Gemini fallback auto-triggers, logged as `extracted_with: 'gemini'` in `cached_analyses`

### Success Criteria Verification

| Criterion | Metric | Measurement Method |
|-----------|--------|--------------------|
| SC1: EPC + flood on lot detail | % lots with enrichment data | Query `cached_analyses.lots` JSONB for non-null `epcRating`/`floodZone` |
| SC2: Image coverage >80% | Overall image % | `analytics_snapshots.image_coverage_pct` |
| SC3: Missing images flagged | Admin endpoint exists | Manual test of `/api/admin/missing-images` |
| SC4: 5+ new houses added | Count of new HOUSE_ROOTS entries with >0 lots | Live test each new extractor |
| SC5: Enrichment not gated | Free tier user sees EPC/flood | Frontend check: no `blurred` class on enrichment fields |

## RESEARCH COMPLETE
