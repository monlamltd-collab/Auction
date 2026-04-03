# Phase 8: Field Extraction & Validation - Research

**Researched:** 2026-04-03
**Domain:** Data quality pipeline — enrichment engine, quality gate, admin dashboard
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Remove the hard cap on lot-page detail page fetches for missing fields. The cap (currently 10/house) was a safety valve — but the right rule is: fetch every missing-field lot's detail page. The enrichment already targets only lots missing the field, so credits are only spent on actual gaps.
- **D-02:** Targeting priority: beds first (lowest coverage ~51%), then tenure (~67%), then propType and price.
- **D-03:** Missing fields are silently omitted from frontend display — no "?", no empty labelled chips, no placeholder text. If beds is null, the beds chip simply doesn't appear. Lot remains fully visible.
- **D-04:** Which fields are always shown vs optionally omitted: Claude's discretion. Builder should make the call based on field type — structural fields (price, address, URL) always shown; supplementary fields (beds, tenure, propType, sqft, leaseLength) omitted if missing.
- **D-05:** Quality gate threshold should be raised above 0.3 (current) — exact value at Claude's discretion based on current field coverage data. Gate informs display behaviour, does not hide lots.
- **D-06:** Per-house field coverage table lives in the Operations tab (not a new tab).
- **D-07:** Table format: one row per house, columns for beds %, tenure %, price %, images %. Amber highlight <70%, red highlight <50%.
- **D-08:** View only — no action buttons. Backfill/re-analyse triggers already exist elsewhere in Operations.

### Claude's Discretion

- Exact quality gate threshold value (based on analysis of current coverage distribution)
- Which specific supplementary fields to omit silently vs always show
- Whether to add propType to the coverage table (it's a normalisation issue, not just missing data)

### Deferred Ideas (OUT OF SCOPE)

- Price range handling ("£50k-£60k" → which bound to use) — skipped, user deprioritised this during area selection. Claude's discretion: take lower bound (conservative, investor-friendly).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FIELD-01 | Bedroom count extracted for >80% of lots across all auction houses | Cap removal in `enrichLotsFromLotPages` + beds-priority sort; address regex + lot-page HTML regex already in place |
| FIELD-02 | Tenure (freehold/leasehold) extracted for >80% of lots | Cross-lot inference + lot-page text scanning already implemented; cap removal benefits this too |
| FIELD-03 | Property type normalised to canonical values (house/flat/land/commercial/mixed) — no raw free-text | `PROP_TYPE_MAP` + `normalisePropType` exist; bungalow non-canonical leak needs fixing |
| FIELD-04 | Guide price extracted for >95% of lots; price ranges handled consistently | `normalisePrice` handles integers; range strings (e.g. "50000-60000") currently pass through as NaN — need lower-bound parser |
| VAL-01 | Quality gate flags low-quality lots for graceful frontend handling; every lot remains visible | `evaluateGate()` verdict needs surfacing per-lot; frontend chip rendering needs "omit if null" logic |
| VAL-03 | Admin dashboard shows per-house field coverage breakdown | `/api/quality-report` already computes `fieldCoverage` in `validateBatch()`; needs to be returned in API response and rendered in Operations tab |
</phase_requirements>

---

## Summary

Phase 8 is a pure data-quality improvement phase with no new architecture to introduce. All the hard work — the enrichment engine, quality gate, data contract — is already built and tested (64/64 harness tests green). The phase is about **removing a cap, surfacing existing data, and fixing display gaps**.

The lot-page enrichment function `enrichLotsFromLotPages` (server.js:11119) already targets all missing fields in a single fetch per lot and already prioritises beds. Its only problem is an internal hard-coded cap of 200 lots (`MAX_LOT_PAGES = 200`) that must be removed entirely, plus a legacy env-var cap (`ENRICHMENT_LOT_PAGE_CAP`) in `enrichment-engine.js` that is unused by the main pipeline but still exists. Both need to go.

The quality gate at `evaluateGate()` rejects batches below quality 0.3. This threshold is expressed in terms of `batchQuality`, which is a mean of per-lot scores where each lot is scored by field presence (imageUrl=0.25, price=0.20, address=0.20, tenure=0.15, beds=0.10, url=0.10). A lot with address + url + price scores 0.50; with image too, 0.75. At ~51% beds coverage and ~67% tenure coverage the typical lot is missing both supplementary fields but has the structural ones. A reasonable lot (address+url+price+image) scores 0.75; missing image scores 0.50. A batch mean of ~0.55-0.65 is realistic for current data. Raising the reject threshold from 0.30 to 0.45 creates a meaningful quality bar without risking rejection of real catalogues. The warn band should shift to 0.45–0.60.

**Primary recommendation:** Remove the `MAX_LOT_PAGES = 200` hard cap in `enrichLotsFromLotPages`, remove the `ENRICHMENT_LOT_PAGE_CAP` env var from `enrichment-engine.js`, fix the 4 frontend "?" chips to silent-omit, extend `/api/quality-report` to return per-field coverage per house, and render that as a table in the Operations tab.

---

## Standard Stack

No new libraries are needed. This phase is entirely within the existing stack.

### Core (already in place)
| Component | Location | Purpose |
|-----------|----------|---------|
| `enrichLotsFromLotPages()` | `server.js:11119` | Unified lot-page fetch — extracts beds, tenure, propType, image, address, condition in one pass |
| `enrichBatch()` | `lib/harness/enrichment-engine.js:54` | Cross-lot inference, cache carry-forward, address regex |
| `validateBatch()` | `lib/harness/data-contract.js:178` | Computes `fieldCoverage` object per house |
| `evaluateGate()` | `lib/harness/quality-gate.js:17` | Batch-level quality gate; verdict: cache/cache_warn/reject |
| `normalisePropType()` | `lib/harness/data-contract.js:73` | Maps raw strings → canonical 5 values via `PROP_TYPE_MAP` |
| `normalisePrice()` | `lib/harness/data-contract.js:51` | Strips £/commas → integer; does NOT handle range strings |
| `/api/quality-report` | `server.js:5702` | Returns per-house image coverage; does NOT yet return field coverage |
| `loadQualityReport()` | `admin.html:1269` | Calls quality report API and updates image cells in houses table |

### No New Dependencies Required

**Installation:** None needed.

---

## Architecture Patterns

### Pattern 1: Enrichment Cap Removal

The cap exists in two places — only one is active in the main pipeline:

**Active cap (must remove):** `server.js:11133` — `const MAX_LOT_PAGES = 200;`
This hardcoded value slices targets to 200 before any fetching. Remove the `const capped = targets.slice(0, MAX_LOT_PAGES);` line and use `targets` directly throughout the function.

**Legacy cap (must remove):** `enrichment-engine.js:7` — `const ENRICHMENT_LOT_PAGE_CAP = parseInt(process.env.ENRICHMENT_LOT_PAGE_CAP || '10');`
This env var is read but never used in the active enrichment path (the main pipeline uses `enrichLotsFromLotPages` in server.js, not the harness `enrichBatch`). However it creates confusion and the user explicitly wants it gone. Remove the constant and remove any reference to it.

**Iron rule to preserve:** Never overwrite existing good data. The `isEmpty()` check at enrichment-engine.js:17 and the `if (!lot.beds)` guards in `enrichLotsFromLotPages` already enforce this. Do not break these guards.

### Pattern 2: Price Range Handling

`normalisePrice()` uses `parseInt()` on the stripped string. `parseInt("50000-60000")` returns `50000` (stops at `-`) — this is correct by coincidence for the lower-bound decision. However "50,000-60,000" → strip commas → "50000-60000" → parseInt → 50000. This already works correctly for ranges with commas stripped.

The edge case that does NOT work: `"£50k-£60k"` → strip £ → `"50k-60k"` → parseInt("50k") = 50 (wrong). This pattern is rare in UK auction data but worth handling. A small patch to `normalisePrice` to expand `k` suffix before parseInt will cover it.

### Pattern 3: PropType Non-Canonical Leak

`PROP_TYPE_MAP` in `data-contract.js` maps `'bungalow'` → `'house'`. However `enrichLotsFromLotPages` (server.js:11279) sets `lot.propType = 'bungalow'` directly (bypassing normalisation). The `analyseLot()` function also sets `lot.propType = 'bungalow'` (server.js:4737). This means `bungalow` leaks through as a raw value not in the canonical 5-set.

**Fix options:**
1. Add `bungalow` as a canonical value (sixth value) — cleaner for investors (bungalows have distinct characteristics)
2. Map `bungalow` → `house` everywhere it's set — simpler, consistent with PROP_TYPE_MAP intent

The user requirement says "five canonical values (house/flat/land/commercial/mixed)". Option 2 is correct. All assignment points must normalise through `normalisePropType()` or inline the mapping.

**Leaking propType assignment points:**
- `server.js:11279` — `lot.propType = 'bungalow'` in enrichLotsFromLotPages
- `server.js:4737` — `lot.propType = 'bungalow'` in analyseLot
- Other raw assignments bypassing `normalisePropType()`

### Pattern 4: Quality Gate Threshold

Current thresholds in `quality-gate.js`:
- `< 0.3` → reject
- `0.3 – 0.5` → cache_warn
- `>= 0.5` → cache (or cache_warn if degraded regression)

Field weights in `data-contract.js` (FIELD_WEIGHTS): imageUrl=0.25, price=0.20, address=0.20, tenure=0.15, beds=0.10, url=0.10.

A lot with address+price+url (structural fields only) scores 0.50. Adding image: 0.75. Adding tenure: 0.65. Currently beds is ~51% present and tenure ~67% present. Lots with structural fields score 0.50 minimum.

Recommended new thresholds:
- `< 0.45` → reject (was 0.30) — structural fields (address+price+url) alone score exactly 0.50, so reject threshold of 0.45 ensures lots with ALL three structural fields still pass
- `0.45 – 0.60` → cache_warn (was 0.30–0.50)
- `>= 0.60` → cache clean

This is a meaningful tightening without risking rejection of legitimate lots that simply lack images or supplementary fields. The reject case (< 0.45) catches batches where even the structural fields are mostly absent — indicating a broken extractor, not just missing beds.

### Pattern 5: Frontend Silent Omit

Current behaviour in `index.html:3463-3476` (card() function):
```javascript
// CURRENT — shows "Beds: ?" chip when beds is null
else detailPills.push({text: 'Beds: ?', tip: '...', gap: true});

// CURRENT — shows "Tenure: ?" chip when tenure is absent
} else {
  detailPills.push({text: 'Tenure: ?', tip: '...', gap: true});
}
```

New behaviour (D-03): if field is null/empty, push nothing. The `detailPills.push(...)` in the `else` branches must be removed entirely. The chip is simply absent.

**Fields classified per D-04:**

| Field | Always shown | Omit if missing |
|-------|-------------|-----------------|
| price | Yes | — |
| address | Yes | — |
| url (view link) | Yes | — |
| lot number | Yes | — |
| propType | No | Yes — omit if null |
| beds | No | Yes — omit if null |
| tenure | No | Yes — omit if null |
| leaseLength | No | Yes — shown inline with tenure only if present |
| sqft | No | Yes — already omit |

### Pattern 6: Admin Field Coverage Table

**API side (`/api/quality-report`):**

`validateBatch()` already computes `fieldCoverage` as an object `{ imageUrl, price, address, tenure, beds, url }` with percentage values (0–100). This is computed per-house but currently not returned in the `/api/quality-report` response.

The response currently builds `entry` objects (server.js:5757) with: `house, lots, rawLots, images, imgCoverage, dupes, ageHours, stale`.

**Change needed:** Add `fieldCoverage` to each entry. This requires calling `validateBatch()` on the deduplicated lots for each house inside the quality-report handler, then including `fieldCoverage` in the entry.

**Admin UI side (`admin.html`):**

The Operations tab has a "Cached Houses" table (line 368) with columns: Status, House, Lots, Imgs %, Top Picks, Yield, Pipeline, Last Scrape, Next Auction, Cache Expires, Actions.

The field coverage table should be a NEW section below the Cached Houses table — a separate, clearly titled section. It should NOT be inserted into the existing table (that table already has 11 columns and different data flow). Modelled on the existing "Missing Images" collapsible section pattern using `<details>/<summary>`.

**Table structure:**
```
| House | Beds % | Tenure % | Price % | Images % |
```

Colour-coding: inline style on `<td>` — amber background for <70%, red background for <50%, green text for >=70%. Match existing admin colour variables: `var(--red)`, `var(--amber)` (or `var(--text-amber)`), `var(--green)`.

`loadQualityReport()` already fetches `/api/quality-report` and has `data.houses`. The field coverage table render can be added to the same function.

### Recommended Task Structure

Based on dependency analysis, the phase splits cleanly into 3 independent work units:

1. **Backend enrichment** — Remove cap from `enrichLotsFromLotPages`, remove `ENRICHMENT_LOT_PAGE_CAP` env var, fix price range `k` suffix, fix propType bungalow leak, raise quality gate threshold
2. **Admin dashboard** — Extend `/api/quality-report` to return `fieldCoverage` per house, add field coverage table to Operations tab
3. **Frontend display** — Remove the "?" fallback chips for beds and tenure from card() in index.html; verify expanded panel has same treatment

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Field coverage stats | Custom counter loop | `validateBatch()` from `lib/harness/data-contract.js` | Already computes exact `fieldCoverage` object per-house with correct null/empty handling |
| Beds extraction from lot-page HTML | New regex parser | Existing bed regex in `enrichLotsFromLotPages` (server.js:11261-11272) | Already handles "3 bed", "3/4 bed", "studio" variants |
| Tenure detection from lot-page HTML | New text scanner | Existing tenure block in `enrichLotsFromLotPages` (server.js:11192-11205) | Already handles share-of-freehold, flying freehold, year-lease patterns |
| PropType normalisation | New map | `normalisePropType()` + `PROP_TYPE_MAP` in data-contract.js | Already maps 30+ raw strings to 5 canonical values |
| Admin table colour thresholds | New CSS class logic | Inline style with existing CSS vars (`var(--red)`, `var(--green)`) | Matches existing admin pattern used in freshness table |

**Key insight:** The enrichment infrastructure is already battle-tested (64/64 tests pass). The phase is about configuration and surfacing, not building.

---

## Common Pitfalls

### Pitfall 1: Cap Is In Two Places
**What goes wrong:** Developer removes `ENRICHMENT_LOT_PAGE_CAP` from enrichment-engine.js but misses the hardcoded `MAX_LOT_PAGES = 200` in server.js:11133. The main pipeline path uses server.js, not the harness env var. Both must be removed.
**Why it happens:** The env var name (ENRICHMENT_LOT_PAGE_CAP) sounds like the active cap, but the server.js internal constant is what actually limits fetches in production.
**How to avoid:** Search for both `ENRICHMENT_LOT_PAGE_CAP` and `MAX_LOT_PAGES` — both are present, both need removal.
**Warning signs:** Enrichment log still shows "200 pages fetched" ceiling for large houses.

### Pitfall 2: PropType Bungalow Leak
**What goes wrong:** `PROP_TYPE_MAP` maps 'bungalow' → 'house' but `enrichLotsFromLotPages` and `analyseLot` in server.js assign `lot.propType = 'bungalow'` directly, bypassing normalisation. These raw values persist in the cache and leak to the frontend.
**Why it happens:** The lot-page enrichment and scoring function were written independently from the data-contract's PROP_TYPE_MAP. Assignment happens before/after normalisation.
**How to avoid:** Either call `normalisePropType()` at the assignment points, or change the assignments to `'house'` inline.
**Warning signs:** Frontend or admin shows `propType: "bungalow"` in lot data — this is not in the canonical 5-set.

### Pitfall 3: Quality Gate Reject Threshold Too Aggressive
**What goes wrong:** Raising the reject threshold too high (e.g., 0.60) causes legitimate batches from houses with no images to be rejected. A house with all lots having address+price+url but no images scores exactly 0.50 batch mean — below 0.60.
**Why it happens:** imageUrl has the highest weight (0.25). Batches from image-sparse houses will always score below 0.75 even with complete structural data.
**How to avoid:** Keep reject threshold at 0.45 (structural fields floor). Raise the cache_warn ceiling to 0.60.
**Warning signs:** Quality gate rejecting previously-healthy houses after threshold change.

### Pitfall 4: fieldCoverage Not Persisted in Cache
**What goes wrong:** `validateBatch()` computes `fieldCoverage` at validation time but the result is not stored in Supabase `cached_analyses`. The quality-report endpoint must re-run validation on cached lots to get field coverage — but this is fine (it already does lot deduplication on the fly).
**Why it happens:** The current quality-report builds `entry` objects from raw lot arrays, not from stored validation results.
**How to avoid:** Call `validateBatch(lots, house)` inside the quality-report handler after the deduplication step. The `fieldCoverage` object from that call feeds the response entry directly.
**Warning signs:** `fieldCoverage` undefined or missing from API response.

### Pitfall 5: Admin Table Data Race
**What goes wrong:** `loadQualityReport()` is called during `refreshAll()` but also separately. If the field coverage section renders before data arrives, it shows empty rows.
**Why it happens:** The admin JS pattern mixes synchronous DOM writes with async API calls.
**How to avoid:** Render the coverage table inside the `.then()` / `await` of `apiFetch('/api/quality-report')` — already the pattern in `loadQualityReport()`. Don't create a separate load function.

### Pitfall 6: Beds Sort Bug in enrichLotsFromLotPages
**What goes wrong:** The current sort prioritises beds-missing lots LAST, not first.
```js
// Current (line 11135): sorts lots MISSING beds to position 0 (front of queue)
targets.sort((a, b) => (!a.beds ? 0 : 1) - (!b.beds ? 0 : 1));
```
This comparator puts lots WITH beds at index 1 and lots WITHOUT beds at index 0 — i.e., lots missing beds sort BEFORE lots that have beds. This is actually the intended behaviour (lots missing beds = 0, lots with beds = 1, so missing-beds lots sort first). The sort is correct despite looking confusing. Do not "fix" this.

---

## Code Examples

### Remove Enrichment Cap (server.js:11133-11136)

```javascript
// Source: server.js:11119 — enrichLotsFromLotPages
// BEFORE (remove these two lines):
const MAX_LOT_PAGES = 200;
const capped = targets.slice(0, MAX_LOT_PAGES);

// AFTER — remove MAX_LOT_PAGES constant and replace capped with targets:
// (use `targets` directly in the for loop below)
for (let i = 0; i < targets.length; i += concurrency) {
```

### Price Range Lower-Bound Fix (lib/harness/data-contract.js:normalisePrice)

```javascript
// Source: lib/harness/data-contract.js:51
// Add k-suffix expansion BEFORE parseInt, after stripping £ and commas:
function normalisePrice(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val > 0 ? Math.round(val) : null;
  let s = String(val).replace(/[£,]/g, '').replace(/guide\s*price\s*/i, '').trim();
  // Expand k-suffix (e.g. "50k" → "50000") before range split
  s = s.replace(/(\d+(?:\.\d+)?)\s*k\b/gi, (_, n) => String(Math.round(parseFloat(n) * 1000)));
  // For ranges, take the lower bound (conservative/investor-friendly)
  const rangePart = s.split(/[-–]/)[0].trim();
  const n = parseInt(rangePart, 10);
  return (n && n > 0) ? n : null;
}
```

### PropType Bungalow Fix (server.js:11279 and 4737)

```javascript
// Source: server.js:11279 — in enrichLotsFromLotPages
// BEFORE:
else if (/\bbungalow\b/.test(text)) { lot.propType = 'bungalow'; stats.propType++; }

// AFTER (map to canonical 'house'):
else if (/\bbungalow\b/.test(text)) { lot.propType = 'house'; stats.propType++; }

// Same fix at server.js:4737 in analyseLot:
// BEFORE: else if (/\bbungalow\b/.test(addr)) lot.propType = 'bungalow';
// AFTER:  else if (/\bbungalow\b/.test(addr)) lot.propType = 'house';
```

### Quality Gate Threshold Raise (lib/harness/quality-gate.js)

```javascript
// Source: lib/harness/quality-gate.js:31-38
// BEFORE:
if (batchQuality < 0.3 && currentLots > 0) {         // reject
if (batchQuality < 0.5 && batchQuality >= 0.3) {      // cache_warn

// AFTER:
if (batchQuality < 0.45 && currentLots > 0) {         // reject
if (batchQuality < 0.60 && batchQuality >= 0.45) {    // cache_warn
// (also update the reason string: "threshold: 0.45")
```

### Frontend Silent Omit (index.html — card() function ~line 3463)

```javascript
// Source: index.html:3463 — card() function
// BEFORE (beds):
if (l.beds != null) detailPills.push({text: l.beds + ' bed', ...});
else detailPills.push({text: 'Beds: ?', tip: '...', gap: true});   // REMOVE THIS LINE

// AFTER:
if (l.beds != null) detailPills.push({text: l.beds + ' bed', tip: '...'});
// (no else — simply omit)

// BEFORE (tenure):
if (l.tenure) {
  detailPills.push({text: tenureLabel, ...});
} else {
  detailPills.push({text: 'Tenure: ?', tip: '...', gap: true});     // REMOVE THIS ELSE BRANCH
}

// AFTER:
if (l.tenure) {
  detailPills.push({text: tenureLabel, ...});
}
// (no else)
```

### Extend /api/quality-report (server.js:5757)

```javascript
// Source: server.js:5757 — quality-report entry construction
// After the existing deduplication step, call validateBatch:
const { fieldCoverage } = validateBatch(lots, house);

// Add fieldCoverage to the entry object:
const entry = {
  house, lots: lots.length, rawLots: rawLots.length,
  images: withImage, imgCoverage, dupes, ageHours, stale: !!isStale,
  fieldCoverage,   // ADD THIS
};
```

### Field Coverage Table in admin.html

```html
<!-- Source: admin.html — inject after Cached Houses section, before Issues -->
<div class="section" id="field-coverage-section">
  <details>
  <summary style="padding:14px 18px;font-size:.88rem;font-weight:700;cursor:pointer;">
    Field Coverage Per House
    <span class="badge" id="field-coverage-badge" style="font-size:.7rem;">-</span>
  </summary>
  <div style="overflow-x:auto;">
    <table id="field-coverage-table">
      <thead>
        <tr>
          <th>House</th>
          <th title="% of lots with bedroom count">Beds %</th>
          <th title="% of lots with freehold/leasehold">Tenure %</th>
          <th title="% of lots with guide price">Price %</th>
          <th title="% of lots with image URL">Images %</th>
        </tr>
      </thead>
      <tbody id="field-coverage-tbody">
        <tr><td colspan="5" class="loading"><span class="spinner"></span> Loading...</td></tr>
      </tbody>
    </table>
  </div>
  </details>
</div>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate backfill functions per field | Unified `enrichLotsFromLotPages` — single fetch, all fields | v1.1 | One Firecrawl credit per lot instead of one per field |
| Per-house Gemini extraction only | DOM extractor → Gemini fallback → lot-page enrichment | v1.1 | Beds/tenure coverage improved from near 0 to ~51%/67% |
| No quality gate | `evaluateGate()` reject/warn/cache pipeline | v1.1 | Broken extractions no longer silently cache |
| Manual field checking | `validateBatch()` computes `fieldCoverage` automatically | v1.1 | Coverage % now computed on every scrape, just not surfaced |

**Not yet done (this phase):**
- fieldCoverage from validateBatch never returned from the API or rendered in admin
- Enrichment cap never removed (partially limits beds coverage gains)
- Frontend still shows "?" chips instead of silent omission

---

## Open Questions

1. **propType coverage table column**
   - What we know: `fieldCoverage` from `validateBatch()` does not include `propType` — only fields in `FIELD_WEIGHTS` are tracked (`imageUrl`, `price`, `address`, `tenure`, `beds`, `url`)
   - What's unclear: Should propType coverage be added to fieldCoverage computation, and to the admin table?
   - Recommendation: Add propType to the coverage table (it helps diagnose normalisation issues). Requires adding propType tracking to `validateBatch()` — simple to add as a non-weighted field.

2. **Beds coverage target realism**
   - What we know: Current beds coverage ~51%, target >80%. Cap removal will fetch lot pages for all lots missing beds. Many lots are commercial/land where beds is genuinely inapplicable.
   - What's unclear: What fraction of the ~49% missing-beds lots are commercial/land where beds is correctly null vs residential lots where beds is extractable?
   - Recommendation: After cap removal, measure commercial/land share of missing-beds lots. If ~30% are non-residential, realistic achievable coverage may be ~70-75% for overall and >80% for residential-only. Adjust success criteria interpretation accordingly.

3. **Lot-page fetch volume and credit impact**
   - What we know: Across ~2,364 lots, roughly 49% (~1,158 lots) are missing beds. `fetchLotPage` uses plain HTTP first, escalating to Firecrawl only for JS-rendered pages (detects <500 chars visible text). Firecrawl credit cost: ~1 per JS-rendered page.
   - What's unclear: What fraction of missing-beds lot pages are JS-rendered vs plain HTML?
   - Recommendation: The plain HTTP path costs zero Firecrawl credits. Even if 50% need Firecrawl, the per-cycle cost is ~600 extra credits. Monthly budget cap is 15,000 — well within limits. Safe to proceed with full cap removal.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies beyond existing stack — Node.js 24 confirmed, no new services needed)

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in assert pattern (custom, no external test runner) |
| Config file | none — run directly via `node tests/test-harness.js` |
| Quick run command | `node tests/test-harness.js` |
| Full suite command | `node tests/test-harness.js && node tests/test-gating.js && node tests/test-enrichment.js` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FIELD-01 | beds extracted from lot-page HTML regex | unit | `node tests/test-harness.js` | Yes (test-harness.js covers enrichBatch) |
| FIELD-02 | tenure extracted via cross-lot + lot-page | unit | `node tests/test-harness.js` | Yes |
| FIELD-03 | propType normalised — no raw values leak | unit | `node tests/test-harness.js` | Yes (validateLot + normalisePropType) |
| FIELD-04 | price range "50k-60k" → 50000 | unit | `node tests/test-harness.js` | Partial (normalisePrice tested; range case not yet) |
| VAL-01 | quality gate threshold at 0.45 rejects low batches | unit | `node tests/test-harness.js` | Yes (evaluateGate tests in test-harness.js) |
| VAL-03 | /api/quality-report returns fieldCoverage | integration-manual | Manual: `curl /api/quality-report` | No — Wave 0 gap |

### Sampling Rate
- **Per task commit:** `node tests/test-harness.js`
- **Per wave merge:** `node tests/test-harness.js && node tests/test-gating.js && node tests/test-enrichment.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test-harness.js` — add test for `normalisePrice("50k-60k") === 50000` (FIELD-04 range case)
- [ ] `tests/test-harness.js` — add test for `normalisePropType("bungalow") === "house"` (FIELD-03 bungalow fix)
- [ ] `tests/test-harness.js` — add test for `evaluateGate` with batchQuality=0.44 → reject (new threshold VAL-01)
- [ ] `tests/test-harness.js` — add test for `validateBatch` including propType coverage if added

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 8 |
|-----------|------------------|
| ES Modules — `import` only, no `require()` | All harness files already use `import`; any new code must too |
| 2-space indentation, single quotes in JS | All edits to server.js and harness files must follow this |
| No linter/formatter — manual convention | Test visually that style matches surrounding code |
| `try/catch` wrapping for every async function | Any new async functions in server.js or harness must be wrapped |
| Empty catch `{}` for non-critical operations | Lot-page enrichment already uses this pattern — preserve it |
| Never overwrite good data (iron rule) | All enrichment fills gaps only; do NOT remove `isEmpty()` guards |
| DOM extractors use `new Function('document', ...)` | Not directly relevant to this phase |
| Admin routes protected by `x-admin-secret` header | The `/api/quality-report` extension uses this — already in place |
| UPPER_SNAKE_CASE for configuration constants | Any new constants (e.g. threshold values) must follow this |
| Section headers use `// ══════` style | New code blocks in server.js must use this comment style |
| `<details>/<summary>` for admin accordions | Coverage table section must use `<details>` — no JS-driven toggles |

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `lib/harness/data-contract.js` — field weights, normalisation functions, validateBatch
- Direct code inspection: `lib/harness/enrichment-engine.js` — ENRICHMENT_LOT_PAGE_CAP, enrichBatch strategies
- Direct code inspection: `lib/harness/quality-gate.js` — evaluateGate thresholds (0.3 reject, 0.3–0.5 warn)
- Direct code inspection: `server.js:11119-11295` — enrichLotsFromLotPages, MAX_LOT_PAGES=200 cap
- Direct code inspection: `server.js:5702-5768` — /api/quality-report, fieldCoverage absent from response
- Direct code inspection: `index.html:3463-3476` — "Beds: ?" and "Tenure: ?" gap chips
- Direct code inspection: `admin.html:252-456` — Operations tab structure, `<details>` pattern
- Test run: `node tests/test-harness.js` — 64/64 passed (2026-04-03)

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions D-01 through D-08 — user-locked implementation choices

### Tertiary (LOW confidence)
- Coverage estimates (~51% beds, ~67% tenure) — from ROADMAP.md success criteria baseline statements, not measured live

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components directly read and understood
- Architecture: HIGH — all integration points identified from source code
- Pitfalls: HIGH — identified from actual code paths, not speculation
- Test coverage: MEDIUM — existing tests cover most; Wave 0 gaps identified

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable codebase — no external dependency changes expected)
