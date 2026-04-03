# Phase 8: Field Extraction & Validation - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Improve extraction coverage for beds (→>80%), tenure (→>80%), propType (normalised), and price (→>95%) across all auction houses. Raise the quality gate to flag low-quality lots so missing fields are silently omitted from frontend display. Add per-house field coverage table to admin Operations tab. No lots are ever hidden or rejected — only field display is affected.

</domain>

<decisions>
## Implementation Decisions

### Lot-Page Enrichment
- **D-01:** Remove the hard cap on lot-page detail page fetches for missing fields. The cap (currently 10/house) was a safety valve — but the right rule is: fetch every missing-field lot's detail page. The enrichment already targets only lots missing the field, so credits are only spent on actual gaps.
- **D-02:** Targeting priority: beds first (lowest coverage ~51%), then tenure (~67%), then propType and price.

### Quality Gate & Field Display
- **D-03:** Missing fields are silently omitted from frontend display — no "?", no empty labelled chips, no placeholder text. If beds is null, the beds chip simply doesn't appear. Lot remains fully visible.
- **D-04:** Which fields are always shown vs optionally omitted: Claude's discretion. Builder should make the call based on field type — structural fields (price, address, URL) always shown; supplementary fields (beds, tenure, propType, sqft, leaseLength) omitted if missing.
- **D-05:** Quality gate threshold should be raised above 0.3 (current) — exact value at Claude's discretion based on current field coverage data. Gate informs display behaviour, does not hide lots.

### Admin Field Coverage Dashboard
- **D-06:** Per-house field coverage table lives in the Operations tab (not a new tab).
- **D-07:** Table format: one row per house, columns for beds %, tenure %, price %, images %. Amber highlight <70%, red highlight <50%.
- **D-08:** View only — no action buttons. Backfill/re-analyse triggers already exist elsewhere in Operations.

### Claude's Discretion
- Exact quality gate threshold value (based on analysis of current coverage distribution)
- Which specific supplementary fields to omit silently vs always show
- Whether to add propType to the coverage table (it's a normalisation issue, not just missing data)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core data quality modules
- `lib/harness/data-contract.js` — Field weights, PROP_TYPE_MAP, TENURE_MAP, normalisation functions, lot validation, quality scoring
- `lib/harness/enrichment-engine.js` — Gap-filling strategies: cross-lot inference, cache carry-forward, address regex, lot-page fetch logic and the cap to remove
- `lib/harness/quality-gate.js` — Batch acceptance thresholds (0.3 minimum to raise)
- `lib/harness/regression-detector.js` — Field coverage regression detection (>40pp drop threshold)

### Frontend display
- `index.html` — Lot card and expanded panel: beds display (~line 3463, 4241), existing onerror/gap handling

### Admin
- `server.js` — `/api/quality-report` endpoint (~line 5702) — field coverage data already computed here, needs surfacing in admin UI
- `admin.html` — Operations tab where coverage table should be added

### Project conventions
- `.planning/codebase/CONVENTIONS.md` — Code style, naming, patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PROP_TYPE_MAP` (data-contract.js:16) — already maps 30+ property type strings to 5 canonical values. Extension point for unmapped commercial/rural terms.
- `TENURE_MAP` (data-contract.js:34) — canonical tenure normalisation already wired
- `extractBedsFromAddress()` (enrichment-engine.js:28) — regex for "3 bed", "3 bedroom" variants from address string
- `inferPropTypeFromAddress()` (enrichment-engine.js:37) — flat/house/land inference from address keywords
- `enrichBatch()` (enrichment-engine.js:54) — the main enrichment pipeline; lot-page fetch cap is `ENRICHMENT_LOT_PAGE_CAP` env var (line 7)
- `/api/quality-report` (server.js:5702) — computes per-house stats from cached_analyses; extend to include field coverage %

### Established Patterns
- Never overwrite good data — enrichment fills gaps only (iron rule throughout enrichment-engine.js)
- `_enrichedFields` array tracks which fields were inferred vs extracted directly
- Cross-lot inference: if 80%+ of lots in a house share a tenure value, infer for blanks (safety: only Freehold, only if propType != flat)
- Gemini extraction prompts already mark beds and tenure as PRIORITY fields (server.js:6905-6906, 7011-7012)
- Lot-page enrichment: `fetchLotPage()` used by all three enrichment functions — smarter than full re-scrape

### Integration Points
- Quality gate verdict flows from `quality-gate.js` → `enrichBatch()` → scraping pipeline in `server.js`
- Field coverage % already computed in `validateBatch()` (data-contract.js) — needs to be passed through to the quality report API
- Admin Operations tab in `admin.html` is the injection point for the coverage table

</code_context>

<specifics>
## Specific Ideas

- "There should be no artificial limits preventing us from obtaining the data" — user explicitly wants the lot-page enrichment cap removed entirely, not raised. The targeting (only lots missing the field) is sufficient cost control.
- The beds coverage improvement is the top priority in this phase.

</specifics>

<deferred>
## Deferred Ideas

- Price range handling ("£50k-£60k" → which bound to use) — skipped, user deprioritised this during area selection. Claude's discretion: take lower bound (conservative, investor-friendly).

</deferred>

---

*Phase: 08-field-extraction-validation*
*Context gathered: 2026-04-03*
