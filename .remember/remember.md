# Handoff

## State
Loop 8 complete — all pipeline module extractions done. Committed and pushed to main.

### What was done (Loops 7-8, this session)
1. **Committed + pushed Loop 5 & 6** from prior session
2. **Extracted 9 more modules from `lib/analysis.js`** (1,581 → 714 lines, −867):
   - `lib/pipeline/purge.js` (82 lines) — stale/orphaned/expired cache cleanup
   - `lib/pipeline/calendar-sync.js` (119 lines) — always-on calendar sync + dedup + migration
   - `lib/pipeline/quality-gate.js` (85 lines) — batch lot validation (price, URL, regression)
   - `lib/pipeline/scoring.js` (153 lines) — investment scoring engine (analyseLot + W2N)
   - `lib/pipeline/persist-lots.js` (242 lines) — merge-safe lot upsert + search text builder
   - `lib/pipeline/enrichment-wave.js` (206 lines) — 4-pass data hygiene + price extraction
   - `lib/pipeline/lot-mappers.js` — DB row ↔ frontend lot mappers + LOTS_SELECT
   - `lib/pipeline/scrape-diff.js` — old vs new lot comparison
   - `lib/pipeline/activity-log.js` — activity event logging

3. **All tests pass**: 33 scoring tests. All exports preserved via thin wrappers/aliases.

### Cumulative refactor (Loops 5-8)
- `lib/extractors.js` (4,226 lines) → `lib/extractors/` directory (55 files)
- `lib/analysis.js` (2,144 lines) → **714 lines** (−66.7%)
- **14 pipeline modules** in `lib/pipeline/`

### Commits pushed
- `f866bd2` — Loop 5: extractors monolith split
- `196f2e1` — Loop 6: 5 pipeline modules
- `50e6b23` — Loop 7: 6 pipeline modules
- `4d56288` — Loop 8: final 3 pipeline modules

## Next
1. **Optional cleanup**: `syncCalendarAndHouseNames()` (33 lines) still inline in analysis.js — could merge into `calendar-sync.js` but low value
2. **Optional**: fix `test-gating.js` regex loader (pre-existing, not caused by this work)
3. **Optional**: remove unused imports from analysis.js (`createHash`, `getEnrichmentReport`, etc.) — some may now be dead
4. **Railway deploy**: changes are on main but verify Railway auto-deploys correctly since module structure changed significantly
5. **Move on to product work** — the refactor is done, analysis.js is pure orchestration

## Context
- `dbRowToLot` is created lazily via `createDbRowToLot()` in `initAnalysis()` because it needs `_deps.extractPostcode`
- `upsertLotGroups` stays inline because it uses `_deps.normaliseLotStatuses` closure
- All external consumers (routes/admin.js, routes/analyse.js, routes/auth.js, routes/search.js) import from `lib/analysis.js` unchanged
- EIG platform houses are `always_on` — never set them to `upcoming` with a specific date
