# Phase 9: Image Pipeline & Frontend Polish - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate image URLs via async background HEAD-checking (broken flagged, not silently dropped), fix the CDN badge bug (wsrv.nl `&default=1` removal + DOM onerror fix + carousel slide cleanup), finish VAL-02 graceful missing-data display across expanded panel / list view / AI output, and extend the Phase 8 admin coverage table with image % and broken count columns.

No lots are hidden or removed. Image data stays in place — broken is flagged, not deleted.

</domain>

<decisions>
## Implementation Decisions

### HTTP HEAD Validation (IMG-01)

- **D-01:** Run image HEAD checks as a **nightly async background job**, not at scrape time. Scrape-time validation would block the pipeline; Railway RAM constraints make parallelising hundreds of HEAD requests per house risky.
- **D-02:** When a HEAD check returns non-2xx or times out, **mark the URL as broken** — store a `broken` flag on the lot. Do not drop or null the imageUrl. Frontend onerror handles the visual fallback; admin can see the count.
- **D-03:** Check **all active lots' images** in the nightly pass. Cache HEAD results with a 24h TTL to avoid hammering CDNs with repeated checks for stable URLs.
- **D-04:** Broken count folds into the admin image coverage table (see Admin section). No separate broken report needed.

### wsrv.nl Proxy & Badge Bug (IMG-02, IMG-04)

- **D-05:** **Remove `&default=1`** from `optimImg()` in `index.html`. With `&default=1` gone, wsrv.nl returns 4xx when source image is unreachable, allowing the browser's `onerror` handler to fire properly.
- **D-06:** Fix the **onerror DOM bug (HIGH-8)**: the current handler uses `this.outerHTML = getPlaceholderHtml(...)`, which replaces the `<img>` element in-place — badges survive as siblings in `.card-image-wrapper`. This is the correct fix direction. The fallback `onerror` on single-image cards must replace only the `<img>` node, not rebuild the wrapper.
- **D-07:** **Carousel broken slide fix**: when a carousel `<img>` fails, remove the slide from the DOM and update the dot count. Current `this.style.display='none'` leaves an invisible slot and mismatches the dot indicators.

### VAL-02: Graceful Missing-Data Display

- **D-08:** Audit these specific areas for empty/labelled gaps (not the card — Phase 8 handled that):
  1. **Expanded panel** (`.exp-*` elements) — beds, tenure, propType, leaseLength may still render labelled empty rows
  2. **List view layout** — may render fields differently from card grid view
  3. **AI analysis output** — score breakdown, opportunities, risks — check for empty sections or "N/A" strings that should simply be absent
  4. **Export/share features** — if any data export exists, empty fields should be omitted
- **D-09:** Fix approach is **code-audit only** — identify confirmed gap patterns in `index.html` rendering logic and remove the empty-label rendering paths. No full visual redesign of the panel.

### Admin Image Coverage Table (IMG-03)

- **D-10:** Add to the **existing Phase 8 per-house field coverage table** in the Operations tab. Do not create a new table.
- **D-11:** Add two new columns: **Images %** (amber <70%, red <50%) and **Broken** (count of HEAD-flagged broken image URLs for that house). Threshold for flagging is 70% — houses below that need attention. This differs from the existing 30% warn threshold in `/api/quality-report` which should be raised to 70% to match.

### Claude's Discretion

- Exact nightly schedule for HEAD job (2am UTC is a reasonable default given pipeline runs at ~6h intervals)
- HEAD timeout per request (5s is sensible to avoid hanging on slow CDNs)
- Whether to persist HEAD results to a separate table or add a `broken_image` column to `lots`
- Parallelism level for nightly HEAD job (suggest 20 concurrent to balance speed and Railway load)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Frontend image rendering
- `index.html` ~line 4195 — `optimImg()` function (contains `&default=1` to remove)
- `index.html` ~line 4320 — `getCardImageHtml()` — single image `onerror` DOM bug (HIGH-8), carousel `onerror` handlers
- `index.html` ~line 4200 — `getCardImageBadges()` — badge rendering that must survive image failure

### Server-side image handling
- `server.js` ~line 402 — `isValidImageUrl()` + `IMG_CDN_DOMAINS` — URL-pattern validation (no HTTP HEAD — this is what we're adding)
- `server.js` ~line 5118 — existing quality gate image validation call
- `server.js` ~line 6002 — `/api/quality-report` — `imageCoverage` already computed per house; extend to include broken count

### Admin UI
- `admin.html` — Operations tab where Phase 8 field coverage table lives (add columns here)

### Phase 8 precedents
- `.planning/phases/08-field-extraction-validation/08-CONTEXT.md` — D-03 (silent field omission), D-06/D-07 (admin table format: amber <70%, red <50%, view-only)

### Project conventions
- `.planning/codebase/CONVENTIONS.md` — Code style, naming, patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `optimImg(url, width)` (`index.html` ~line 4195) — wsrv.nl proxy wrapper; `&default=1` is the param to remove for proper onerror propagation
- `getPlaceholderHtml(type)` (`index.html` ~line 4213) — generates the placeholder `<div>` used in onerror fallbacks; already exists, just need to target the right DOM element
- `isValidImageUrl(url)` (`server.js` ~line 402) — URL-pattern validation; the HTTP HEAD layer will be additive, not a replacement
- `imageCoverage` field (`server.js` ~line 6063) — already computed per house in quality report pipeline; just needs broken count added

### Established Patterns
- Never overwrite good data (from enrichment-engine.js) — applies to broken flag: mark broken without discarding the URL
- Admin Operations tab additions follow Phase 8 pattern: view-only table, amber/red thresholds, no action buttons
- Quality gate flags but doesn't reject (from Phase 8 D-05) — same philosophy: broken images are flagged, lots remain visible

### Integration Points
- Nightly HEAD job connects to: `lots` table (read imageUrl, write broken flag) → `/api/quality-report` (expose broken count per house) → `admin.html` Operations tab (display columns)
- Badge fix is pure frontend (`index.html`) — no server changes needed for HIGH-8
- VAL-02 audit is pure frontend (`index.html`) — scan expanded panel / list view rendering paths

</code_context>

<specifics>
## Specific Ideas

- "Mark as broken, keep URL" — user explicitly wants the URL preserved so admin can inspect patterns. This is consistent with the Phase 8 principle that data quality is surfaced through admin visibility, not silent deletion.
- The admin broken count column gives a fast signal for which auction houses have unstable CDN hosting — useful for prioritising house-level fixes in Phase 10.

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope.

</deferred>

---

*Phase: 09-image-pipeline-frontend-polish*
*Context gathered: 2026-04-15*
