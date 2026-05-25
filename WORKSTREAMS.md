# Worktrees

## main

Foundation work only. Lot contract, observability views, schema reconciliation.

## worktree-ui (not yet created)

In-scope: `public/app.js`, `public/*.html`, `public/*.css`, route handlers that
shape API responses for the frontend.

Out-of-scope: `lib/scraper/*`, `lib/pipeline/*`, `migrations/*`, `lib/types/*`.

Reads from the canonical Lot shape. Does not redefine field names.

## worktree-data (not yet created)

In-scope: queries and views over `lot_events`, `scrape_health_daily`,
`house_skills`, `catalogue_snapshots`. New SQL views, diagnostic CLI commands,
admin route surfacing per-source health.

Out-of-scope: `public/*`, `lib/scraper/*` (scraper fixes belong in a separate
focused branch once health views tell us which scraper to fix), `lib/types/*`.

# Open notes (things spotted but deliberately not fixed yet)

- Three event tables co-exist (`lot_events`, `lot_history`, `lot_status_history`).
  Consolidation onto `lot_events` is in progress per the migration comment.

- `bullets` field has two semantic shapes upstream (multi-element vs single-
  element from description). Needs reconciliation in `normaliseScrapedLot`
  but flag if behaviour changes.

- `auction_date` has no timezone handling at any boundary. Europe/London is
  assumed implicitly. Out of scope for now.

- `cached_analyses.lots` JSONB blob is untyped. Consider validating against
  the canonical Lot shape on read in a future pass.

- **Stale JSDoc / inline comments referencing deleted symbols.** Five files
  still mention `dbRowToFrontendLot` or `normaliseLot` in non-code positions
  (left intact per surgical-change principle during Task 3):
  - `lib/pipeline/value-estimator.js` lines 8 and 74
  - `lib/curator/select-picks.js` line 33
  - `lib/curator/generate-prose.js` line 40
  - `lib/pipeline/cache-enrich-stage.js` line 23
  - `lib/pipeline/firecrawl-extract.js` placeholder-address comment block
    (the `// see normaliseLot + looksLikeRealAddress` cross-reference)

- **`lib/types/lot.js` header has two now-stale sentences.** The "Migration
  status" block (lines ~53–62) says "Consumers will be migrated to this
  module in Task 3" and "DO NOT delete the originals before all callers
  are migrated" — the migration is complete and the originals were deleted
  in commit `1a73fe1`. Comment-only, no functional impact.

- **`lib/types/lot.js:89` lists `floor_plan_url` as intentionally omitted**
  from `LOT_COLUMNS`. The investor-trust merge (`ea1b454 feat(schema):
  persist lot.floorPlanUrl end-to-end`) added it to the column list at
  line 118 and wired it through `dbRowToLot` (line 233) and `lotToDbRow`
  (line 339). The header comment needs that entry removed from the
  "intentionally OMITTED" list to match reality.

- **Helper duplication between `lib/pipeline/firecrawl-extract.js` and
  `lib/types/lot.js`.** `looksLikeRealAddress`, `stripEigCatalogueParams`,
  `PLACEHOLDER_PHRASES`, `UK_POSTCODE_RE`. Intentional during the
  transition — firecrawl-extract.js's secondary detail-page normaliser and
  `tests/test-address-validation.js` still import them from
  firecrawl-extract.js, and `lib/types/lot.js` needs its own copies to
  stay leaf-level (no `lib/pipeline/` imports). Long-term these belong in
  one place; the safest move is to migrate the remaining consumers to
  import from `lib/types/lot.js` and delete the firecrawl-extract.js
  copies.

- **`scrape-diff.js` keys lots by `l.lotNumber || l.address || l.lot`.**
  After the canonical-shape migration, `l.lotNumber` is always undefined,
  so the diff keys by `l.address` (since address comes before `lot` in the
  OR chain). The diff is stable, but the fallback order should be flipped
  to `l.lot || l.address` for clarity. Pure refactor — behaviour
  identical because both candidate keys are non-null after normalisation.

- **`dbRowToLot` emits `enrichedAt` and `rawText` keys but canonical
  `LOTS_SELECT` doesn't fetch `enriched_at` / `raw_text`.** Those keys
  always resolve to `undefined` unless the caller has expanded their
  select. Latent contract gap predating the consolidation — matches
  existing behaviour, but the canonical module exposes the gap more
  visibly than the legacy mappers did. Either (a) add the columns to
  `LOT_COLUMNS`, or (b) drop the keys from `dbRowToLot`.

- **`LOTS_SELECT` divergence (Task 1 finding) — RESOLVED.** Listed here
  for historical reference only.
  `lib/pipeline/persist-stage.js:28` previously defined a local
  `LOTS_SELECT` referencing six columns that do not exist in the live
  `lots` table (`guide_price_text`, `sq_ft`, `opportunities`,
  `price_per_sqft`, `fundability_badge`, `fundability_url`). Reads on
  that stage had been silently failing with PostgREST 400. Fixed in
  commit `1a73fe1` by replacing the broken local const with the canonical
  import.
