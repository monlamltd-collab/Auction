# C1 — Auction-Date-Aware Cache TTL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache expiry for an upcoming auction catalogue falls to 2h once the auction is within 48h, so frontend sees near-live data on auction day without tanking credit spend on far-off sales.

**Architecture:** Extend `getCacheTTL(houseKey)` to accept an optional `auctionDate` second argument. When the date is < 48h in the future, cap the tier-derived TTL at 2 hours. A new pure helper `getAuctionDateForUrl(catalogueUrl)` in `lib/calendar.js` does a targeted `auction_calendar` lookup (returns `null` on miss / error, so a missing calendar entry falls back to the existing tier-only behaviour). All three cache-writing call sites resolve the auction date once and pass it in.

**Tech Stack:** Node.js 20 ESM, Supabase JS client (direct queries, no ORM), vanilla assertions via `node tests/test-*.js` (no framework). CI runs each test as a separate step in `.github/workflows/test.yml`.

---

## Context — what this ships on top of

- Tier A + Tier B are on `main` at `ecfed3b`. CI is green across 11 test files. No `continue-on-error` flags remain.
- `lib/config.js:31-35` — `getCacheTTL(houseKey)` currently looks up the tier and returns `ttlHours * 3600000`. Three call sites use it:
  - [lib/pipeline/probe.js:74](lib/pipeline/probe.js:74) — extends cache TTL after a hash-match probe
  - [lib/pipeline/probe.js:82](lib/pipeline/probe.js:82) — logs the TTL hours on hash-match
  - [lib/pipeline/persist-stage.js:52](lib/pipeline/persist-stage.js:52) — computes `expires_at` after a fresh scrape
  - [routes/analyse.js:510](routes/analyse.js:510) — same, for the manual analyse endpoint
- `auction_calendar` has one row per (house, date, url). `url` matches the normalised catalogue URL stored in `cached_analyses.url`. [lib/pipeline/persist-lots.js:60-70](lib/pipeline/persist-lots.js:60) already shows the join pattern (though it over-fetches).
- `lib/calendar.js` exports `getAuctionCalendar()` and `getCalendarAuctions()` — both fetch the full upcoming list. There is no single-URL accessor yet.

---

## File Structure

**Modified files:**

- `lib/config.js` — extend `getCacheTTL` signature, add two named constants (`NEAR_AUCTION_WINDOW_MS`, `NEAR_AUCTION_TTL_MS`). Keep the function pure and synchronous.
- `lib/calendar.js` — export new `getAuctionDateForUrl(catalogueUrl)` helper. Targeted DB query, `null` on miss / error.
- `lib/pipeline/probe.js` — resolve auction date once, pass to both `getCacheTTL` calls.
- `lib/pipeline/persist-stage.js` — resolve auction date, pass to the one `getCacheTTL` call.
- `routes/analyse.js` — resolve auction date, pass to the one `getCacheTTL` call.

**Created files:**

- `tests/test-cache-ttl.js` — pure unit test for the new `getCacheTTL` signature. No DB. No `lib/auth.js` import → no `process.exit` needed.

**Wiring:**

- `package.json` — add `tests/test-cache-ttl.js` to the `test` script.
- `.github/workflows/test.yml` — add a new step for `test-cache-ttl`.

**Not touched (deferred):**

- `lib/pipeline/persist-lots.js:60-70` loads the full calendar and linearly matches. Inefficient but working; fixing it is part of C3's naming/cleanup pass, not C1.

---

## Task 1: Extend `getCacheTTL` to accept `auctionDate`

**Files:**
- Modify: `lib/config.js:22-35`

- [ ] **Step 1: Write the failing test**

Create `tests/test-cache-ttl.js` with this content:

```javascript
/**
 * Cache TTL Test Suite
 * ====================
 * Tests getCacheTTL(houseKey, auctionDate?). Pure function, no DB.
 * Run: node tests/test-cache-ttl.js
 */

import { getCacheTTL } from '../lib/config.js';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, msg) {
  if (actual === expected) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg} — expected ${expected}, got ${actual}`);
    failed++;
  }
}

const HOUR = 3600000;
const now = Date.now();

// ── Tier-only (no auctionDate) ──
console.log('\n--- Tier-only behaviour ---');
assertEqual(getCacheTTL('allsop'), 12 * HOUR, 'high tier (allsop) → 12h');
assertEqual(getCacheTTL('cliveemson'), 18 * HOUR, 'medium tier (cliveemson) → 18h');
assertEqual(getCacheTTL('unknown'), 24 * HOUR, 'low tier (unknown) → 24h');
assertEqual(getCacheTTL('allsop', undefined), 12 * HOUR, 'undefined auctionDate → tier default');
assertEqual(getCacheTTL('allsop', null), 12 * HOUR, 'null auctionDate → tier default');

// ── Future auction > 48h: no cap ──
console.log('\n--- Future auction > 48h ---');
const in5Days = new Date(now + 5 * 24 * HOUR).toISOString();
assertEqual(getCacheTTL('allsop', in5Days), 12 * HOUR, 'high tier, 5d out → 12h (uncapped)');
assertEqual(getCacheTTL('cliveemson', in5Days), 18 * HOUR, 'medium tier, 5d out → 18h (uncapped)');
const in49h = new Date(now + 49 * HOUR).toISOString();
assertEqual(getCacheTTL('allsop', in49h), 12 * HOUR, 'high tier, 49h out → 12h (just outside window)');

// ── Near auction < 48h: capped at 2h ──
console.log('\n--- Near auction < 48h ---');
const in30h = new Date(now + 30 * HOUR).toISOString();
assertEqual(getCacheTTL('allsop', in30h), 2 * HOUR, 'high tier, 30h out → 2h (capped)');
assertEqual(getCacheTTL('cliveemson', in30h), 2 * HOUR, 'medium tier, 30h out → 2h (capped)');
assertEqual(getCacheTTL('unknown', in30h), 2 * HOUR, 'low tier, 30h out → 2h (capped)');
const in1h = new Date(now + 1 * HOUR).toISOString();
assertEqual(getCacheTTL('allsop', in1h), 2 * HOUR, 'high tier, 1h out → 2h (capped)');

// ── Past auction: no cap (finished auctions are irrelevant) ──
console.log('\n--- Past auction ---');
const yesterday = new Date(now - 24 * HOUR).toISOString();
assertEqual(getCacheTTL('allsop', yesterday), 12 * HOUR, 'high tier, 1d ago → 12h (past, no cap)');

// ── Accepts Date and string ──
console.log('\n--- Input types ---');
assertEqual(getCacheTTL('allsop', new Date(now + 30 * HOUR)), 2 * HOUR, 'Date instance, 30h out → 2h');
assertEqual(getCacheTTL('allsop', '2099-01-01'), 12 * HOUR, 'ISO date string, far future → 12h');

// ── Summary ──
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All cache-TTL tests passed!');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-cache-ttl.js`
Expected: most "near auction" assertions FAIL because `getCacheTTL` currently ignores the second argument.

- [ ] **Step 3: Update `lib/config.js` — add window constants + extend signature**

Replace the block at `lib/config.js:22-35`:

```javascript
// ── Rate limits & caching ──
export const RATE_LIMIT_PER_DAY = STRIPE_ENABLED ? 5 : 50;
export const CACHE_DAYS = 7;
export const CACHE_TIERS = {
  high:   { houses: ['allsop','savills','sdl','network','bidx1'], ttlHours: 12 },
  medium: { houses: ['cliveemson','edwardmellor','bondwolfe','strettons','countrywide','suttonkersh','tcpa','futureauctions','firstforauctions','harmanhealy','astleys','henrysykes','clarkesimpson','durrants','dawsons','goldings','auctionhousescotland','austingray','auctionhouseeastanglia','auctionhousenorthwest','auctionhousenortheast','auctionhousewales','auctionhousebirmingham','auctionhousekent','iamsold','buttersjohnbee','brownco','fssproperty','auctionhousedevon','auctionhouseeastmidlands','auctionhousewestmidlands','auctionhouseessex','auctionhousemanchester','romanway','hammerprice'], ttlHours: 18 },
  low:    { houses: [], ttlHours: 24 }  // everything else
};

// When an auction is within this window, cap the TTL so the frontend sees near-live data.
export const NEAR_AUCTION_WINDOW_MS = 48 * 3600000;
export const NEAR_AUCTION_TTL_MS = 2 * 3600000;

export function getCacheTTL(houseKey, auctionDate) {
  let ttl;
  if (CACHE_TIERS.high.houses.includes(houseKey)) ttl = CACHE_TIERS.high.ttlHours * 3600000;
  else if (CACHE_TIERS.medium.houses.includes(houseKey)) ttl = CACHE_TIERS.medium.ttlHours * 3600000;
  else ttl = CACHE_TIERS.low.ttlHours * 3600000;

  if (auctionDate) {
    const ts = auctionDate instanceof Date ? auctionDate.getTime() : Date.parse(auctionDate);
    if (!Number.isNaN(ts)) {
      const msUntilAuction = ts - Date.now();
      if (msUntilAuction > 0 && msUntilAuction < NEAR_AUCTION_WINDOW_MS) {
        return Math.min(ttl, NEAR_AUCTION_TTL_MS);
      }
    }
  }
  return ttl;
}
```

Rationale for each branch:
- `msUntilAuction > 0` — past auctions are finished; no point refreshing aggressively.
- `msUntilAuction < NEAR_AUCTION_WINDOW_MS` — exactly at 48h is *outside* the window (the tier default is still shorter or equal to 24h in the low tier, so it never creates a 48h gap by itself).
- `Math.min(ttl, …)` — if a future tier TTL is ever shorter than 2h, we don't *raise* it.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-cache-ttl.js`
Expected: PASS (all 16 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/config.js tests/test-cache-ttl.js
git commit -m "$(cat <<'EOF'
feat: cap cache TTL at 2h when auction is within 48h

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `getAuctionDateForUrl` helper

**Files:**
- Modify: `lib/calendar.js` — add one exported function after `getCalendarAuctions`

- [ ] **Step 1: Append the helper**

Append to the end of `lib/calendar.js`:

```javascript
/**
 * Look up the next upcoming auction date for a catalogue URL.
 * Used by the cache-write call sites to tighten TTL when an auction is imminent.
 *
 * @param {string} catalogueUrl — any form; will be normalised internally
 * @returns {Promise<string | null>} — ISO date (YYYY-MM-DD) or null on miss / error
 */
export async function getAuctionDateForUrl(catalogueUrl) {
  if (!catalogueUrl) return null;
  const norm = normaliseUrl(catalogueUrl);
  if (!norm) return null;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data, error } = await supabase
      .from('auction_calendar')
      .select('date')
      .eq('url', norm)
      .gte('date', today)
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data.date || null;
  } catch {
    return null;
  }
}
```

This helper returns `null` on every failure mode — calendar miss, DB error, bad URL — so callers can pass the result straight into `getCacheTTL(house, auctionDate)` without guarding. A `null` auction date means "fall back to tier-only TTL", which is the pre-C1 behaviour.

- [ ] **Step 2: Smoke-test by running existing tests**

Run: `npm test`
Expected: all tests pass (helper is new, no existing consumers yet).

- [ ] **Step 3: Commit**

```bash
git add lib/calendar.js
git commit -m "$(cat <<'EOF'
feat: add getAuctionDateForUrl helper for cache-TTL lookups

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire probe.js to pass auction date into `getCacheTTL`

**Files:**
- Modify: `lib/pipeline/probe.js:13` (import), `:74` + `:82` (call sites)

- [ ] **Step 1: Update imports**

Replace line 13:

```javascript
import { getCacheTTL } from '../config.js';
```

with:

```javascript
import { getCacheTTL } from '../config.js';
import { getAuctionDateForUrl } from '../calendar.js';
```

- [ ] **Step 2: Resolve auction date once, reuse in both call sites**

Replace the block `lib/pipeline/probe.js:69-86` (from `const contentHash = …` through the `return { skip: true, … }` line) with:

```javascript
  const contentHash = createHash('md5').update(probeHtml).digest('hex');

  // Hash matches + cache still valid → extend TTL, skip re-scrape
  const cacheStillValid = existingCache.expires_at && new Date(existingCache.expires_at) > new Date();
  if (existingCache.content_hash === contentHash && cacheStillValid) {
    const auctionDate = await getAuctionDateForUrl(normalisedUrl);
    const ttlMs = getCacheTTL(house, auctionDate);
    const newExpiry = new Date(Date.now() + ttlMs).toISOString();
    await supabase
      .from('cached_analyses')
      .update({ expires_at: newExpiry, last_scraped_at: new Date().toISOString() })
      .eq('url', normalisedUrl);

    emitPipelineEvent({
      module: 'probe', house, action: 'hash_hit',
      probeSource, cacheExtendedHours: Math.round(ttlMs / 3600000),
    });
    console.log(`probe:${house} → hash_hit, cache extended (probe: ${probeSource})`);
    return { skip: true, contentHash, probeSource, cacheExtended: true };
  }
```

Two call sites in the original code now both use `ttlMs` — avoids a second DB roundtrip and keeps the logged hours consistent with the stored `expires_at`.

- [ ] **Step 3: Smoke-test by running existing tests**

Run: `npm test`
Expected: all tests pass. (No test covers probe directly; we are verifying we did not break imports or break the harness / enrichment tests.)

- [ ] **Step 4: Commit**

```bash
git add lib/pipeline/probe.js
git commit -m "$(cat <<'EOF'
feat: thread auction date into probe-stage cache TTL

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire persist-stage.js to pass auction date into `getCacheTTL`

**Files:**
- Modify: `lib/pipeline/persist-stage.js:13` (import), `:52` (call site)

- [ ] **Step 1: Update imports**

Replace line 13:

```javascript
import { getCacheTTL } from '../config.js';
```

with:

```javascript
import { getCacheTTL } from '../config.js';
import { getAuctionDateForUrl } from '../calendar.js';
```

- [ ] **Step 2: Resolve and pass through**

Replace `lib/pipeline/persist-stage.js:52`:

```javascript
  const expiresAt = new Date(Date.now() + getCacheTTL(house)).toISOString();
```

with:

```javascript
  const auctionDate = await getAuctionDateForUrl(normalisedUrl);
  const expiresAt = new Date(Date.now() + getCacheTTL(house, auctionDate)).toISOString();
```

No other changes in this file — `expiresAt` is referenced later at line 173 inside the upsert, which already consumes the local.

- [ ] **Step 3: Smoke-test by running existing tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/pipeline/persist-stage.js
git commit -m "$(cat <<'EOF'
feat: thread auction date into persist-stage cache TTL

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire routes/analyse.js to pass auction date into `getCacheTTL`

**Files:**
- Modify: `routes/analyse.js:8` (import), `:510` (call site)

- [ ] **Step 1: Update imports**

Line 8 currently imports from `../lib/config.js`. Add `getAuctionDateForUrl` from calendar. Replace line 8:

```javascript
import { resolveEffectiveTier, getCacheTTL, RATE_LIMIT_PER_DAY, FREE_SCAN_LIMIT, stripAIFields, HEADERS, MAX_LOTS_PER_SCRAPE } from '../lib/config.js';
```

with:

```javascript
import { resolveEffectiveTier, getCacheTTL, RATE_LIMIT_PER_DAY, FREE_SCAN_LIMIT, stripAIFields, HEADERS, MAX_LOTS_PER_SCRAPE } from '../lib/config.js';
import { getAuctionDateForUrl } from '../lib/calendar.js';
```

- [ ] **Step 2: Resolve and pass through**

Replace `routes/analyse.js:510`:

```javascript
    const expiresAt = new Date(Date.now() + getCacheTTL(house)).toISOString();
```

with:

```javascript
    const auctionDate = await getAuctionDateForUrl(normalisedUrl);
    const expiresAt = new Date(Date.now() + getCacheTTL(house, auctionDate)).toISOString();
```

`normalisedUrl` is already in scope at this point in the handler (used on line 521 for the `cached_analyses` lookup immediately below).

- [ ] **Step 3: Smoke-test by running existing tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add routes/analyse.js
git commit -m "$(cat <<'EOF'
feat: thread auction date into manual-analyse cache TTL

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire the new test into `npm test` and CI

**Files:**
- Modify: `package.json` (test script)
- Modify: `.github/workflows/test.yml` (new step)

- [ ] **Step 1: Update `package.json` test script**

Replace the `"test":` line so it now includes `tests/test-cache-ttl.js`. Current value (single line — use `replace_all: false`, match exactly):

```json
    "test": "node tests/test-extractors.js && node tests/test-detail-extractors.js && node tests/test-scoring.js && node tests/test-gating.js && node tests/test-fundability.js && node tests/test-harness.js && node tests/test-enrichment.js && node tests/test-image-coverage.js && node tests/test-missing-images-endpoint.js",
```

New value:

```json
    "test": "node tests/test-extractors.js && node tests/test-detail-extractors.js && node tests/test-scoring.js && node tests/test-gating.js && node tests/test-cache-ttl.js && node tests/test-fundability.js && node tests/test-harness.js && node tests/test-enrichment.js && node tests/test-image-coverage.js && node tests/test-missing-images-endpoint.js",
```

(Order: group it with `test-gating` since both are pure config-function unit tests.)

- [ ] **Step 2: Add CI step**

In `.github/workflows/test.yml`, add this step between the `test-gating` step and the `test-enrichment` step:

```yaml
      - name: test-cache-ttl
        run: node tests/test-cache-ttl.js
```

- [ ] **Step 3: Run the full local test suite**

Run: `npm test`
Expected: every existing test still passes AND `test-cache-ttl` prints `All cache-TTL tests passed!` with 16 PASS lines.

- [ ] **Step 4: Commit and push**

```bash
git add package.json .github/workflows/test.yml
git commit -m "$(cat <<'EOF'
chore: wire test-cache-ttl into npm test and CI

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

Then confirm CI goes green on the push (branch is `main`; CI gates the result).

---

## Verification (full C1)

1. **Unit test passes:** `node tests/test-cache-ttl.js` → 16 PASS.
2. **Full suite passes:** `npm test` → all 10 local tests green (CI runs 11, adding `test-manifest` and `test-auth-cache`).
3. **Manual smoke test** *(optional, requires local Supabase env)*:
   - Start `node --watch server.js`.
   - In Supabase, ensure an `auction_calendar` row has `date` = today or tomorrow for a catalogue URL whose house is in the `high` tier (e.g. `allsop`).
   - Hit `POST /api/analyse` against that URL (or let `autoAnalyseAll` pick it up).
   - Check `cached_analyses.expires_at` for that URL — should be ~2h from now, not 12h.
   - Change the row's `date` to 10 days from now, re-run, verify `expires_at` is ~12h again.
4. **No regressions in enrichment / probe:** tail the server log during an `autoAnalyseAll` run; confirm `probe:<house> → hash_hit, cache extended` still appears and `cacheExtendedHours` is either 12/18/24 or 2 depending on proximity.
5. **CI stays green on push.**

---

## Out of scope (deferred)

- **C2** — Round-robin status drift (separate plan)
- **C3** — `house` / `slug` / `house_slug` / `auction_house` naming consistency pass; includes cleaning up `lib/pipeline/persist-lots.js:60-70` to use the new `getAuctionDateForUrl` helper
- **A2** — Retire `lib/scoring.js` (only consumer is its own test)
- **D1** — Shell harness 0-byte glitch (superseded by CI)
