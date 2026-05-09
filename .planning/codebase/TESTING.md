# Testing Patterns

> **⚠️ STALE — DO NOT TRUST.** Last accurate ~2026-04. The DOM extractor test suite (`tests/test-extractors.js`, `tests/snapshots/`) was retired 2026-05-08, along with `scripts/audit.mjs` and `scripts/audit-fix.mjs`. Current test layout is described in `.claude/skills/auction-conventions/SKILL.md` (Testing section) and the test files themselves under `tests/`. This file is retained only as a historical reference.

## Overview

Testing in this project is lightweight and pragmatic. There is no mainstream test framework (no Jest, Mocha, or Vitest). Tests are custom Node.js scripts that use manual assertions and `process.exit(1)` for failure signaling.

## Test Framework

**None.** All tests are hand-rolled Node.js scripts using:
- Custom `assert()` helper functions (not the Node.js built-in `assert` module)
- `console.log()` for pass/fail output
- `process.exit(1)` on failure, `process.exit(0)` on success
- Exit code conventions: `0` = pass, `1` = failures detected

## How to Run Tests

```bash
# Primary test suite (DOM extractor snapshot tests)
npm test
# equivalent to: node tests/test-extractors.js

# Audit script (health check against live sites)
npm run audit
# equivalent to: node scripts/audit.mjs

# Pre-launch QA (checks live API for data quality)
node scripts/pre-launch-qa.mjs [--base-url https://auctions.bridgematch.co.uk]

# Individual extractor test against live site
node scripts/test-btg-extractor.mjs
node scripts/test-new-houses.mjs
```

Defined in `package.json` at `C:\Users\User\Documents\GitHub\Auction\package.json`:
```json
"scripts": {
  "test": "node tests/test-extractors.js",
  "audit": "node scripts/audit.mjs"
}
```

## Test File Structure

```
tests/
  test-extractors.js          # DOM extractor snapshot test suite
  snapshots/
    savills.html              # Saved HTML snapshots for offline testing
    sdl.html
    bondwolfe.html

scripts/
  audit.mjs                   # Live site health audit (all houses)
  audit-fix.mjs               # Auto-fix + email report based on audit results
  pre-launch-qa.mjs           # Data quality checks against running API
  test-btg-extractor.mjs      # Single-house Puppeteer extractor test
  test-new-houses.mjs         # Multi-house live extractor test
```

## Test Types

### 1. Snapshot Tests (`tests/test-extractors.js`)

**Purpose:** Validate DOM extractors against saved HTML snapshots for regression detection.

**How it works:**
1. Extracts `DOM_EXTRACTORS` from `server.js` by reading the file as text and using regex/brace-matching to find the object (avoids importing `server.js` which has side effects)
2. For each extractor with a matching snapshot file in `tests/snapshots/`, runs the extractor in a JSDOM context
3. Validates against expected results defined in the `EXPECTED` object (minimum lot counts, sample lot data)
4. Runs a syntax check on ALL extractors (even those without snapshots) to catch parse errors
5. Checks field coverage -- warns if extractors don't reference required fields (`lot`, `address`, `price`, `url`)

**Expected data format:**
```js
const EXPECTED = {
  savills: {
    minLots: 3,
    samples: [
      { lot: 1, addressContains: 'Acacia Avenue', priceMin: 100000 },
      { lot: 2, addressContains: 'High Street', priceMin: 50000 },
      { lot: 3, addressContains: 'Willow Lane', hasSold: true },
    ]
  },
};
```

**Adding a new snapshot:**
1. Visit the auction house page in a browser
2. Right-click, Save As, HTML Only, save to `tests/snapshots/{house_slug}.html`
3. Add an entry to `EXPECTED` with the house slug and expected lot count/sample data
4. Run `npm test`

**Current snapshots:** `savills`, `sdl`, `bondwolfe` (3 of 30+ extractors have snapshot coverage)

**Known limitations:** JSDOM does not fully replicate browser behavior. Some extractors may fail in JSDOM but work in Puppeteer. These are tracked separately as `snapshotFails` and do not cause the test suite to exit with failure.

### 2. Health Audit (`scripts/audit.mjs`)

**Purpose:** Comprehensive live-site diagnostic for all auction house scrapers.

**What it checks:**
- Extracts configuration from `server.js` (HOUSE_ROOTS, DOM_EXTRACTORS, SKIP lists)
- HTTP probes against live auction house URLs
- Runs DOM extractors against live HTML (via Puppeteer or HTTP fetch)
- Compares results to production cache
- Detects broken selectors, site redesigns, missing configuration
- Saves fingerprints and history for trend analysis

**CLI flags:**
```
--house venmore,kivells    # Specific houses only
--fast                     # HTTP probes only (skip Puppeteer)
--discover                 # Include new house discovery
--save                     # Save fingerprints + history to scripts/audit/
--json                     # Machine-readable JSON output
--concurrency 3            # Puppeteer page limit (default 5)
```

### 3. Pre-Launch QA (`scripts/pre-launch-qa.mjs`)

**Purpose:** Data quality validation against the live or local API.

**Checks:**
- Every house has >0 lots
- No duplicate lot numbers within a house
- All prices parse correctly
- Image URLs resolve (samples 5 per house with HEAD requests)
- Image coverage stats per house (warns below 30%)

**Output:** Structured console report with severity levels (`CRITICAL`, `WARN`). Exits with code 1 if any critical issues found.

### 4. Single-House Extractor Tests (`scripts/test-btg-extractor.mjs`, `scripts/test-new-houses.mjs`)

**Purpose:** Manual testing of new or modified DOM extractors against live sites using Puppeteer.

**Pattern:** Each script contains a copy-pasted DOM extractor string, launches Puppeteer, navigates to the house URL, runs the extractor via `page.evaluate()`, and prints results. These are ad-hoc development tools, not part of the CI pipeline.

## Mocking Approach

**No mocking framework.** The codebase avoids mocking entirely:

- Snapshot tests use saved HTML files as test fixtures instead of mocking HTTP responses
- The `DOM_EXTRACTORS` object is extracted from `server.js` source text using brace-matching (to avoid importing the module and triggering side effects like database connections)
- Live tests hit actual production URLs
- No dependency injection or test doubles

## Test Coverage

**No coverage tooling.** There is no `nyc`, `istanbul`, `c8`, or similar coverage tool configured.

Coverage is implicitly low given the approach:
- Only 3 of 30+ DOM extractors have snapshot test fixtures
- The scoring engine (`analyseLot`), Gemini integration, Firecrawl integration, caching layer, and all Express routes have no unit tests
- The audit and QA scripts serve as integration/smoke tests against running systems rather than isolated unit tests

## CI/CD Integration

**None apparent.** There is no GitHub Actions workflow, no `.github/` directory, no CI config files. Tests are run manually during development.

## Key Files

| File | Purpose |
|------|---------|
| `C:\Users\User\Documents\GitHub\Auction\tests\test-extractors.js` | Main test suite (snapshot + syntax) |
| `C:\Users\User\Documents\GitHub\Auction\tests\snapshots\` | HTML fixtures for snapshot tests |
| `C:\Users\User\Documents\GitHub\Auction\scripts\audit.mjs` | Live health audit |
| `C:\Users\User\Documents\GitHub\Auction\scripts\audit-fix.mjs` | Auto-fix + email report |
| `C:\Users\User\Documents\GitHub\Auction\scripts\pre-launch-qa.mjs` | Data quality QA |
| `C:\Users\User\Documents\GitHub\Auction\scripts\test-btg-extractor.mjs` | Single-house Puppeteer test |
| `C:\Users\User\Documents\GitHub\Auction\scripts\test-new-houses.mjs` | Multi-house live test |
| `C:\Users\User\Documents\GitHub\Auction\package.json` | `npm test` and `npm run audit` scripts |
