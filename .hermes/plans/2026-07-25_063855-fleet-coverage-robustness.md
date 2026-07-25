# Fleet Coverage Robustness (5 Improvements) Implementation Plan

> **For Hermes:** Use subagent-driven-development / task-by-task execution. Plan only — no code changes yet.
>
> **Model routing (owner preference):** auto-switch per task.
> - **Capable / spine:** `x-ai/grok-4.5` (Grok 4.5)
> - **Basic / pure / tests-heavy:** `deepseek/deepseek-v4-pro` (DeepSeek V4 Pro, OpenRouter)
> - If a basic-task diff touches discovery/watcher/heal/schedule invariants, **escalate to Grok 4.5** before commit.
> - Final integration/regression review of each phase: **Grok 4.5**.

**Goal:** Get as close as practical to **100% automatic population of future lots for 100% of active houses**, with **no owner tinkering**, by implementing the five robustness improvements identified in the calendar/date-discovery review — without breaking paths that already work well (always-on / MMOA rolling catalogues, custom `resolveCatalogueUrl` drills, verified heal scoring, site-pace budgets).

**Architecture:** Keep the existing three-layer shape, but make each layer do its real job:

1. **Continuity layer (safe, keep)** — `syncCalendar` + always-on roots keep scrapeable houses on a permanent schedule.
2. **Next-sale intelligence layer (strengthen)** — `auction-watcher` + fixed `discoverAndUpdateCalendar` + platform family configs keep *traditional dated sales* current for *existing houses*, even when calendar already has rows.
3. **Date quality + observability layer (close the loop)** — lot/card dates win over stale calendars; homepage-watch feeds date/URL candidates; a single fleet coverage metric makes dark houses impossible to miss.

**Tech Stack:** Node.js / Express AuctionBrain (`monlamltd-collab/Auction`), Supabase `auction_calendar` + `lots` + `house_homepage_watch` + `pipeline_alerts`, existing Gemini/`callAI` + Crawlee/HTTP fetch (no new Firecrawl spend by default), existing test runners (`node tests/test-*.js`).

---

## Non-goals / hard constraints (do not break)

These are working well and must remain invariants:

1. **Always-on / MMOA houses stay always-on.** Do **not** mass-convert always_on → upcoming. `syncCalendar` still inserts/realigns always_on for missing static roots.
2. **AUTO_HEAL_ENABLED default remains OFF.** No silent URL rewrite/autopromote. Admin `force: true` remains allowed. Prefer score → human apply/retire (except for already-safe same-domain continuity paths that already exist and are gated).
3. **BACKLOG_DIGEST_ENABLED default remains OFF.** No noisy corpse digests.
4. **Do not re-enable unsupervised junk URL heals.** Continue using `healCandidateVerdict` / catalogue verification.
5. **RETIRED_HOUSES stay retired** (`pugh`, `markjenkinson`, `sdl`, `auctionhousenational`, etc.). Discovery watches skip them.
6. **Do not stamp lot `auction_date = 2099-12-31`.** Marker stays calendar-only (persist-lots sentinel nulling remains).
7. **Keep credit/budget discipline.** Prefer free HTTP → Crawlee → Gemini. No new FIRE-1 blast by default.
8. **Product north star remains Coverage first** — but coverage means *lots appearing automatically*, not just calendar placeholders.

---

## Baseline (current state)

| Layer | What it does today | Gap vs goal |
|---|---|---|
| `syncCalendar` | Ensures every `HOUSE_ROOTS` slug has an active calendar row (mostly `always_on`) | Continuity OK; not next-sale discovery |
| `auction-watcher` (`AUCTION_DISCOVERY`) | Real next-sale discovery for **~10 Cat B slugs** only; skips if any upcoming exists | Too few houses; stop-at-first-upcoming |
| `discoverAndUpdateCalendar` | AI root scan, but **skips any house that already has any upcoming calendar row** | Structurally fails the main goal for existing houses |
| homepage-watch | Records URL drift + `last_next_auction_date` | Date signal not wired into calendar automation |
| persist-lots date precedence | bullets → `_auctionDate` → calendar (never 2099) | Good foundation; needs majority-lot reinforcement + metric |
| coverage-digest | Enrichment quality (image/EPC/etc.) | Not a fleet house/date coverage scoreboard |

Live rough snapshot when analysed (2026-07-25): ~212 always_on houses, only ~24 houses with real `upcoming` calendar rows, thousands of available lots still undated. Continuity ≠ traditional next-sale intelligence.

---

## The 5 improvements (implementation targets)

1. **Flip discovery semantics** for *existing* houses: look for *new* dated sales even when calendar already has rows; retire past rows safely.
2. **Expand `AUCTION_DISCOVERY` / platform family watchers** (EIG, Auction House UK, common CMS patterns) so most traditional houses are actively watched without per-house hand care.
3. **Homepage-watch feed date extraction into scored candidates** (not just URL drift); still human-gated for apply when auto-heal risk exists.
4. **Prefer lot/card auction dates** as source of truth when catalogue-level date is rolling/stale; reinforce return-trip into calendar when confident.
5. **Fleet coverage metric** + automatic escalation: `% of active traditional houses with a real upcoming calendar date within N weeks` (plus MMOA freshness), nightly, with alerts before dark houses accumulate.

---

## Target end state (acceptance)

For **active non-retired** houses:

### A. Continuous / MMOA (Category C)
- Has schedulable always_on (or equivalent rolling root).
- Scraped on cadence.
- Fresh lots when source has stock (`last_seen_at` within policy window, currently ~7–30d depending path).
- Real per-lot dates preferred when cards expose them; never immortal 2099 dates on lots.

### B. Traditional / rotating sale (Category B and undated traditional A→B promotions)
- At least one **real** `auction_calendar` row with:
  - `status='upcoming'`
  - `date` in `[today, today+N weeks]` (suggested N=8 initially)
  - `catalogue_ready=true`
  - URL verified as catalogue (via existing verdict helpers when newly discovered)
- Or an explicit, durable classification that the house is MMOA/rolling (so it is not counted against traditional coverage).

### C. Operator experience
- Owner receives **coverage scoreboard + actionable misses**, not raw junk noise.
- Adding a future lot for a known house should not require manual calendar edits in the normal case.

**Numeric target (phased):**
- Phase 1: metric live; no regression on always_on scrape continuity.
- Phase 2: traditional configured/family houses ≥ **95%** “has real upcoming within 8 weeks OR correctly classified as no-upcoming/dark-with-reason”.
- Phase 3: all active houses classified; unexplained dark traditional houses = 0 for >48h without alert.

100% absolute population is still bounded by source truth (house truly has no catalogue yet / site down / legal scrape blocks). The system must auto-classify those as **explained misses**, not silent holes.

---

## Design principles (safety rails)

### Rail 1 — Classify before discovering
Never run expensive “next sale” AI discovery against pure always_on MMOA houses unless signals say they actually rotated to dated sales.

Add durable classification (code-level first; DB later if needed):

```js
// conceptual
// 'mmoa' | 'traditional_static' | 'traditional_rotating' | 'platform_family' | 'retired' | 'unknown'
```

Seed from:
- existing `always_on` calendar status
- `AUCTION_DISCOVERY` membership
- `AH_PLATFORM_SLUGS` / `isEigWhitelabel`
- house dossier/root URL patterns (`/current-auction`, `?auction_date=`, etc.)
- homepage-watch `next_auction_date` history

### Rail 2 — Additive calendar writes, careful retires
- Prefer **insert/upsert new upcoming** over rewriting always_on.
- Retire only rows that are past-dated `upcoming` (or superseded same-URL/same-date).
- Do **not** delete always_on just because an upcoming exists (many houses legitimately have both).

### Rail 3 — Verify candidates before calendar populate
Reuse `healCandidateVerdict(url, html, slug)` for newly discovered catalogue URLs in discovery + watcher paths (discovery already does; watcher should too when promoting AI/regex finds that are undated or low trust).

### Rail 4 — Dry-run first
Every new writer path supports:
- `opts.dryRun=true` → compute actions, no DB writes
- structured report: `{ considered, skippedClass, discovered, upserted, retired, rejected, errors }`

### Rail 5 — Kill switches
Env flags (defaults shown):

| Flag | Default | Purpose |
|---|---|---|
| `NEXT_SALE_DISCOVERY_ENABLED` | `true` after phase1 tests | master switch for flipped fleet discovery |
| `AUCTION_WATCHER_EXPAND_ENABLED` | `true` | platform-family expansion |
| `HOMEPAGE_DATE_FEED_ENABLED` | `true` | homepage date → calendar candidate feed |
| `LOT_DATE_CALENDAR_BACKFILL_ENABLED` | `false` initially | back-propagate confident lot dates into calendar |
| `FLEET_COVERAGE_ALERTS_ENABLED` | `true` | metric alerts |
| existing `AUTO_HEAL_ENABLED` | `false` | unchanged |
| existing `BACKLOG_DIGEST_ENABLED` | `false` | unchanged |

---

## Phase map

| Phase | Theme | Risk | Owner-visible outcome | Default model |
|---|---|---|---|---|
| 0 | Guardrails + metrics scaffolding (read-only) | Very low | Dashboard of dark houses | DeepSeek V4 Pro (+ Grok review of metric defs) |
| 1 | Fix discovery skip semantics + retire-past helper (dry-runable) | Medium | Existing-house new sales can be found | **Grok 4.5** |
| 2 | Expand platform/family `AUCTION_DISCOVERY` coverage | Medium | Most traditional houses watched cheaply | **Grok 4.5** |
| 3 | Homepage-watch date feed (scored candidates) | Medium-low | Automatic candidate generation without auto-junk apply | **Grok 4.5** |
| 4 | Lot-date source-of-truth reinforcement (+ optional calendar backfill) | Medium | Fewer null/stale lot dates; better listing truth | **Grok 4.5** |
| 5 | Alerts/escalation + soak + turn on safe auto-populate defaults | Low if 0–4 solid | No tinkering operations mode | Grok 4.5 for defaults-on; DeepSeek OK for runbook polish |

**Do not reorder:** metric first prevents flying blind; discovery flip without classification risks AI thrash on always_on fleet.

---

## Model auto-switch policy

### Labels
- **Grok 4.5** = capable spine model (`x-ai/grok-4.5`)
- **DeepSeek V4 Pro** = basic/mid implementer (`deepseek/deepseek-v4-pro`)

### When to use DeepSeek V4 Pro
- Pure functions with no DB writer side effects (or writers fully mocked)
- Unit tests, fixtures, docs/runbooks, baseline inventory scripts
- Extracting shared utils after Grok defined the interface
- Narrow admin JSON formatters once endpoint shape is fixed

### When to use Grok 4.5
- Any change to eligibility/skip semantics, calendar mutate/retire, scheduler order
- Platform-family expansion that can create many calendar rows
- Homepage candidate auto-upsert thresholds linked to heal policy
- Lot-date consensus writers
- Kill-switch / env default decisions
- Any failing canary or invariant doubt

### Execution rule for Hermes
For each task below:
1. Spawn/implement with the task’s **Model** line.
2. Run the task’s focused tests.
3. If DeepSeek task modifies any file under `lib/pipeline/{discovery,auction-watcher,homepage-watch,healing,calendar-sync,persist-lots,analysis}.js` or `server.js` schedule block beyond a trivial call-site, **stop and re-run review/fix with Grok 4.5** before commit.
4. After each phase (0–5), one Grok 4.5 pass reviews the phase diff against Non-goals / hard constraints.

---

# Step-by-step plan

### Task 0: Capture freeze baseline & inventory classifications

**Model:** DeepSeek V4 Pro  
**Review:** Grok 4.5 only if baseline metric definitions look wrong

**Objective:** Know current active house universe and which of the 5 gaps each house hits, before any writer changes.

**Files:**
- Create: `docs/fleet-coverage-baseline.md`
- Create: `scripts/fleet-coverage-baseline.mjs` (read-only)
- Optional SQL notes in that doc (Composio/Supabase read-only)

**Steps:**
1. Enumerate active slugs: `Object.keys(HOUSE_ROOTS) - RETIRED_HOUSES`.
2. Join calendar: always_on / upcoming real dates / none.
3. Join recent lots: available count, null dates, last_seen_at.
4. Emit cohorts:
   - MMOA continuous healthy
   - traditional with upcoming healthy
   - traditional dark (no real upcoming)
   - scheduled but stale scrape
   - undated available stock heavy
5. Save baseline counts into the doc (timestamped). This becomes the pre-change comparison for soak.

**Verify:** Script runs without writes; produces counts that match manual SQL spot checks.

**Commit:** `chore: add fleet coverage baseline inventory script`

---

### Task 1: Pure house classification helper

**Model:** DeepSeek V4 Pro (pure rules + tests)  
**Review:** Grok 4.5 if classification causes always_on houses to become `needsNextSaleWatch=true` too aggressively

**Objective:** Single function deciding whether a house needs next-sale discovery.

**Files:**
- Create: `lib/pipeline/house-class.js`
- Create: `tests/test-house-class.js`

**Behaviour:**

```js
export function classifyHouseForDiscovery({
  slug,
  roots,            // HOUSE_ROOTS entry/url
  calendarRows,     // [{status,date,url,catalogue_ready}]
  discoveryConfig,  // AUCTION_DISCOVERY[slug]
  platformHints,    // { eig, ah, ... }
  homepageWatch,    // optional { last_next_auction_date, last_extracted_catalogue_url }
}) {
  // returns {
  //   class: 'retired'|'mmoa'|'traditional_rotating'|'traditional_static'|'unknown',
  //   needsNextSaleWatch: boolean,
  //   reasons: string[],
  // }
}
```

Rules (initial, conservative):
1. retired → no watch
2. in `AUCTION_DISCOVERY` or platform family → `traditional_rotating`, needs watch
3. only always_on calendar + root looks rolling (`current`, `available`, `search` static, etc.) and no homepage next date history → `mmoa`, no next-sale AI watch
4. always_on **plus** homepage `next_auction_date` changing over time → promote to `traditional_rotating` watch
5. has/had real upcoming date rows → `traditional_rotating`
6. else `unknown` with low-rate opportunistic watch (budgeted)

**Tests:** fixtures for allsop/savills/mmoa-root/rotating eig/retired.

**Commit:** `feat: classify houses for next-sale discovery eligibility`

---

### Task 2: Fleet coverage metric module (Improvement 5, read path first)

**Model:** DeepSeek V4 Pro for pure scoring + tests; **Grok 4.5** for any `server.js` / digest emit wiring  
**Review:** Grok 4.5 on final metric definitions + alert copy

**Objective:** Make coverage impossibility-of-missing before changing writers.

**Files:**
- Create: `lib/pipeline/fleet-coverage.js`
- Create: `tests/test-fleet-coverage.js`
- Modify later: `lib/pipeline/coverage-digest.js` or `server.js` schedule to emit alongside daily digest
- Optional table later: reuse `coverage_snapshots` extras **or** new `fleet_coverage_snapshots` migration (only if needed; prefer JSON blob column addition if table exists and is flexible — otherwise compute ephemeral + pipeline_alerts first to avoid migration dependency)

**Metric definition (v1):**

For active non-retired houses:

- `mmoa_total`, `mmoa_fresh` (scraped within F days; F=7 default)
- `trad_total`, `trad_with_upcoming_8w`, `trad_dark`, `trad_explained_miss`
- `unknown_total`
- `fleet_populate_score` =
  - weighted: MMOA fresh contributes full credit if fresh; traditional contributes full credit if upcoming real date within 8 weeks **or** explained miss with fresh evidence “no catalogue yet”
- `dark_houses[]` top offenders with reason codes:
  - `no_upcoming_row`
  - `upcoming_not_ready`
  - `stale_scrape`
  - `discover_miss`
  - `unclassified`

**Telegram format:** short scoreboard + max 10 dark houses; no HTML dumps.

**Scheduler:** daily with coverage digest (existing slot ~server schedule). Gate with `FLEET_COVERAGE_ALERTS_ENABLED`.

**Verify:** unit tests pure; one dry run against prod-readonly via script.

**Commit:** `feat: fleet house coverage metric and dark-house scoreboard`

---

### Task 3: Calendar retire/upsert helpers (shared, safe)

**Model:** **Grok 4.5** for mutate/retire semantics; DeepSeek V4 Pro may draft pure selectors/tests first  
**Review:** Grok 4.5 mandatory before any adapter call from discovery/watcher

**Objective:** One place to add upcoming sales and retire past dated rows without touching always_on continuity.

**Files:**
- Create: `lib/pipeline/calendar-entries.js`
- Create: `tests/test-calendar-entries.js`
- Modify: `lib/pipeline/auction-watcher.js`, `lib/pipeline/discovery.js` to call helpers (thin adapters)

**API:**

```js
export function shouldRetireCalendarRow(row, { todayIso }) {
  // upcoming|past with date < today (and not always_on, not 2099) → retire
}

export function pickRowsToRetire(rows, opts) { /* pure */ }

export async function upsertUpcomingCatalogue(supabase, {
  slug, url, date, title, catalogueReady, source, dryRun
}) { /* verify-optional, conflict on url+date or house+date */ }

export async function retirePastUpcomingRows(supabase, { slug, todayIso, dryRun }) {
  // set status='past' (preferred) rather than delete
}
```

**Rules:**
- Never retire/delete `always_on`.
- Never invent dates from today for undated always_on.
- Discovery currently inserts with `date: cat.date || today` — **change undated insert policy**:
  - if class is rotating and date unknown, either skip **or** insert with `catalogue_ready=false` and title signal, but **prefer requiring date or verified current-catalogue marker**.
  - Safer default: **require date OR existing rolling root already covers continuity**. Undated “new URL” only replaces when signature says current catalogue and house is rotating.

**Tests:** pure retire selection; always_on immunity; url/date dedupe.

**Commit:** `feat: safe calendar upsert/retire helpers for next-sale rows`

---

### Task 4: Flip `discoverAndUpdateCalendar` semantics (Improvement 1)

**Model:** **Grok 4.5 only** (spine; do not assign to DeepSeek)

**Objective:** Stop skipping houses just because they already have calendar rows.

**Files:**
- Modify: `lib/pipeline/discovery.js`
- Create/Modify: `tests/test-discovery-next-sale.js`
- Modify: `lib/analysis.js` only if wrapper needs dry-run/options passthrough

**Current bug (structural):**

```js
// today: skips any house with ANY upcoming calendar entry
const slugs = Object.keys(HOUSE_ROOTS).filter(s => !alreadyInCalendar.has(s));
```

**New algorithm:**

1. Load active calendar rows for all houses (not just future map of slugs).
2. Classify each non-retired house.
3. Eligible for AI root discovery only if:
   - `needsNextSaleWatch === true`, AND
   - not already handled successfully by `auction-watcher` this cycle (optional coordination flag), AND
   - missing healthy upcoming in window **OR** forced refresh cadence due (e.g. weekly recheck even if upcoming exists, to find *second* future sales), AND
   - budget remaining.
4. For houses with healthy upcoming already:
   - still allow discovery of **additional future dates** (not only first), with dedupe on url/date.
   - do not thrash daily if last discovery attempt recorded recently (new lightweight state: `house_skills.last_discovery_at` or in-memory/day table via pipeline_events/alerts meta — prefer existing columns if present; else store on `house_homepage_watch` companion fields only if clean; otherwise a small `discovery_runs` memory in `pipeline_alerts` is wrong — use `house_skills` JSON or new nullable timestamps only with migration if required).

**Cadence proposal (no migration if possible):**
- Use env `DISCOVERY_RECHECK_DAYS=7`.
- If house has upcoming date ≥ today, only re-search when nearest upcoming is within 14 days (find next-after-next) **or** last recheck older than 7 days.
- If house dark, check every full pass.

**Budget:**
- Cap AI discovery houses/pass: e.g. 25 dark + 10 rechecks (configurable).
- Prioritize dark traditional over unknown.

**Writes:**
- Use Task 3 upsert + retire helpers.
- Keep `healCandidateVerdict` verification before insert.
- After successful insert, invalidate calendar cache.

**DRY RUN:** `discoverAndUpdateCalendar({ dryRun:true })` returns would-be inserts.

**Tests:**
- house already in calendar but missing next date → still considered
- always_on mmoa → skipped
- retired → skipped
- candidate lot URL → rejected
- past dated candidate → rejected
- existing url/date → no dup insert

**Commit:** `fix(discovery): find next sales for houses already on calendar`

---

### Task 5: Upgrade auction-watcher beyond first-upcoming short-circuit (Improvement 1 partial + 2 foundation)

**Model:** **Grok 4.5** for watcher control-flow; DeepSeek V4 Pro OK for extracted pure `getUpcomingHorizon` tests only

**Objective:** Watcher should maintain a healthy horizon, not stop at one future row of any quality.

**Files:**
- Modify: `lib/pipeline/auction-watcher.js`
- Create/Modify: `tests/test-auction-watcher-horizon.js` (pure helpers extracted)

**Change `hasFreshUpcomingEntry` → `getUpcomingHorizon(slug)`:**

```js
// returns {
//   hasAnyUpcoming: boolean,
//   nearestDate: string|null,
//   count: number,
//   hasReady: boolean,
//   needsRefresh: boolean, // no ready upcoming within HORIZON_DAYS OR only undated junk
// }
```

Skip only when `needsRefresh === false` (unless `opts.force`).

Also:
1. Upsert **up to K=3** future entries (soonest first), not only the first picked.
2. Before upsert, run soft verification for AI tier results (fetch + `healCandidateVerdict`) when HTML available cheaply.
3. Call `retirePastUpcomingRows(slug)` once per watched house.
4. Emit structured result fields for metric consume.

**Keep:** past-dated rejection logic (critical working guard).

**Commit:** `fix(auction-watcher): maintain multi-sale horizon and retire past rows`

---

### Task 6: Expand `AUCTION_DISCOVERY` via platform families (Improvement 2)

**Model:** **Grok 4.5** (family auto-enrol can mass-create calendar rows)  
**Assist:** DeepSeek V4 Pro may add fixtures/fingerprint unit tests after Grok lands resolver API

**Objective:** Cover most rotating traditional houses without 200 hand configs.

**Files:**
- Modify: `lib/houses.js` (`AUCTION_DISCOVERY` + helpers)
- Create: `lib/pipeline/platform-discovery.js` (family strategies)
- Modify: `lib/pipeline/auction-watcher.js` to resolve config via family resolver
- Tests: `tests/test-platform-discovery.js`
- Docs: update relevant `docs/houses/*.md` when a family is proven

**Family packs (priority order):**

1. **EIG white-label**  
   - Already strong for Maggs/Hollis via probe tier.  
   - Auto- enrol any house where homepage HTML matches `isEigWhitelabel` OR root patterns.  
   - Shared strategy: auctions index + probe dates.

2. **Auction House UK platform**  
   - Already has `AH_PLATFORM_SLUGS` + future-dates resolver in homepage-watch.  
   - Feed those resolved dated URLs into calendar upserts automatically each watcher cycle (this is high confidence, platform bilingual source).  
   - Do **not** scrape retired national rollup duplicates.

3. **Date-query CMS** (`?auction_date=YYYY-MM-DD`)  
   - Generalize Countrywide pattern.

4. **Path-date / month-slug catalogues**  
   - Shared regex pack with per-host `buildUrl` overrides only when needed.

5. **Homeflow / common agency CMS** (only after fingerprint confidence usefulness proven on 2+ live houses)

**Resolver API:**

```js
export function resolveDiscoveryConfig(slug, {
  explicit = AUCTION_DISCOVERY[slug],
  htmlFingerprints,
  platformSets,
}) {
  if (explicit) return { ...explicit, source: 'explicit' };
  if (platformSets.ah.has(slug)) return ahFamilyConfig(slug);
  if (htmlFingerprints.eig) return eigFamilyConfig(slug);
  return null;
}
```

**Safety:** family auto-enrol starts in **observe mode**:
- first release: compute matches + dry-run calendar actions
- second release: enable writes behind `AUCTION_WATCHER_EXPAND_ENABLED`

**Commit(s):**
- `feat: platform-family discovery resolver`
- `feat(auction-watcher): auto-enrol AH + EIG families`

---

### Task 7: Homepage-watch date feed into scored calendar candidates (Improvement 3)

**Model:** **Grok 4.5** for thresholds + auto-upsert policy; DeepSeek V4 Pro OK for shared date-parse extract + pure scorer tests

**Objective:** Use already-collected `next_auction_date` + catalogue URL as quiet automation fuel, without turning auto-heal back on.

**Files:**
- Modify: `lib/pipeline/homepage-watch.js`
- Modify: `lib/scraper/homepage-audit.js` / schema only if date parse quality weak
- Create: `lib/pipeline/homepage-date-feed.js`
- Tests: `tests/test-homepage-date-feed.js`
- Optional: Telegram apply cards reuse existing backlog/action plumbing but stay filtered/default-off for bulk noise

**Behaviour:**

On each homepage watch result where:
- non-retired
- `nextAuctionDate` parses to real future ISO
- `currentCatalogueUrl` present
- house classified rotating/unknown (not pure mmoa unless date signal contradicts)

Create/update a **candidate action** (not necessarily direct apply):

```js
{
  slug,
  url,
  date,
  source: 'homepage-watch',
  confidence: 0-100,
  reasons: [...],
}
```

Confidence scoring (simple, testable):
- +40 URL same domain as root
- +25 date parse firm
- +20 healCandidateVerdict ok (if fetched)
- +15 URL differs from stale calendar entry
- −50 lot-level URL patterns
- −40 parked/not auction verdicts
- −30 junk search URL

Promotion policy:
1. **confidence ≥ 80** and house not heal-sensitive → auto-upsert upcoming via Task 3 helpers (still not HOUSE_ROOTS rewrite unless already always_on continuity path separately).
2. **confidence 50–79** → store candidate + include in fleet dark digest section “ready to apply”.
3. **\<50** → record only.

Preserve:
- URL_DRIFT_NEW_DOMAIN remains alert/human.
- AUTO_HEAL_ENABLED still gates healBrokenHouse auto path.
- No BACKLOG spam; use fleet coverage digest section instead.

**Date parse normalization:** convert homepage strings (“19 May 2026”) → `YYYY-MM-DD` once in shared util (reuse auction-watcher `parseUkDate` — **extract shared date util** to avoid drift).

**Commit:**
- `refactor: share UK auction date parser`
- `feat: homepage-watch next-sale candidate feed`

---

### Task 8: Lot/card date as stronger source of truth (Improvement 4)

**Model:** **Grok 4.5** for persist/consensus writers; DeepSeek V4 Pro OK for pure consensus math/tests if interface already fixed

**Objective:** When extractors already see per-lot dates, trust them over rolling/stale catalogue calendar; optionally lift high-confidence majority dates into calendar.

**Files:**
- Modify (only if needed): `lib/pipeline/persist-lots.js` (already mostly correct)
- Create: `lib/pipeline/lot-date-consensus.js`
- Modify: `lib/pipeline/persist-stage.js` or analysis post-scrape hook to call consensus after a successful house scrape
- Tests: `tests/test-lot-date-consensus.js`

**A. Persist path (confirm/harden only)**  
Keep precedence:

```text
bulletDate || lot._auctionDate || non-sentinel calendarDate
```

Add guards:
1. Reject absurd far-future non-sentinel years (e.g. > currentYear+2) unless house known multi-year.
2. Reject year-roll typo patterns already documented if utility exists; otherwise light sanity clamp.
3. Do not overwrite an existing lot real date with null on sparse scrape (merge rules likely exist — verify, add test if missing).

**B. Consensus calendar lift (optional writer, default off then on)**  
After scrape of house H with ≥ M lots (M=8) where ≥ R% (R=70) share the same real future date D and catalogue URL U:

- upsert upcoming calendar row `(H,U,D)` source=`lot_consensus`
- only if house not already having ready upcoming D
- never create always_on from this path
- never write 2099 onto lots

This is the self-healing bridge: even without homepage dates, successful extractors keep calendar honest.

**Commit:**
- `feat: lot-date consensus backflow into auction_calendar (gated)`

---

### Task 9: Wire schedulers & coordination (no double thrash)

**Model:** **Grok 4.5 only**

**Objective:** Full-pass order that maximizes automatic population while controlling cost.

**Files:**
- Modify: `server.js` schedule tier full pass
- Modify: `lib/analysis.js` pre/post scrape steps if needed

**Proposed full-pass order (03:00 UK):**

1. `watchAuctionCalendar()` (now family-expanded + horizon-aware)
2. `runHomepageDateFeed()` (cheap DB memo + selective verify; or at end of homepage-watch cycle if separate)
3. `syncCalendar()` (always_on continuity; unchanged purpose)
4. `autoAnalyseAll()` (scrape + extract + persist)
5. per-house lot-date consensus backflow (gated)
6. `discoverAndUpdateCalendar()` for remaining dark traditional (post-scrape is OK; may also run a **pre-scrape dark-only mini pass** if many houses are unscheduled — optional)
7. fleet coverage snapshot + alert if score drops / dark unexplained > threshold

**Coordination:**
- Watcher marks slugs refreshed in-cycle; discovery skips those unless still dark.
- Discovery budget diminishes with AI failures.

**Commit:** `chore(schedule): coordinate watcher, date-feed, discovery, coverage`

---

### Task 10: Admin/ops visibility (hands-off for owner, inspectable for agent)

**Model:** DeepSeek V4 Pro once endpoint contracts are specified; **Grok 4.5** if auth/routing is non-trivial

**Objective:** Replace tinkering with observability.

**Files:**
- Modify: `routes/calendar.js` or admin endpoints (if exists) to expose:
  - fleet coverage JSON
  - dry-run discovery for one slug
  - force watcher for one slug (may already exist)
- Docs: `docs/fleet-coverage-ops.md` short runbook

Endpoints (minimal, auth as existing admin):
- `GET /admin/fleet-coverage`
- `POST /admin/discovery/dry-run` `{ slug? }`
- Existing force heal remains force-only

**Commit:** `feat(admin): fleet coverage and discovery dry-run endpoints`

---

### Task 11: Soak, thresholds, then defaults-on

**Model:** **Grok 4.5** for defaults-on / threshold decisions; DeepSeek V4 Pro for soak notes/runbook edits

**Objective:** Prove automatic population without flipping all writers on day one.

**Soak plan (production):**

Day 0–1:
- Deploy Tasks 0–2 (metric only) + helpers dry-run.
- Observe dark list; manually sanity-check top 20.

Day 2–4:
- Enable watcher horizon + AH/EIG family observes with writes for high-confidence only.
- Enable discovery flip behind cap, dry-run compare for 1 night then writes.

Day 5–7:
- Enable homepage date feed auto-upsert ≥80 confidence.
- Enable lot consensus backfill.

Success gates before claiming done:
1. No increase in heal junk URL incidents.
2. No always_on mass deletion/alteration beyond realign rules.
3. Traditional dark unexplained trend ↓ day over day.
4. Available lot inflow for previously dark trad houses ↑.
5. MMOA fresh rate does not regress >2pp.
6. Firecrawl/Gemini daily usage within budget envelope.

Only after gates: set defaults so owner does nothing under normal ops.

---

## Detailed implementation notes by improvement

### Improvement 1 — Flip discovery semantics (SAFE design)

**Do:**
- eligibility by classification + horizon health
- insert additional future sales
- retire past `upcoming`

**Don't:**
- delete always_on when upcoming appears
- skip only on “any calendar row exists”
- accept past sales or lot pages

**Primary code pivot:** `lib/pipeline/discovery.js` lines currently building `alreadyInCalendar` from upcoming rows and filtering whole slugs out.

### Improvement 2 — Expand platform watchers

**Do:**
- family resolver over giant per-slug map
- reuse AH future-dates source of truth
- EIG probe path generalization

**Don't:**
- onboard brand-front duplicates/retired slugs
- treat Sequence branches as duplicates (they are coverage-positive; ensure family rules don’t collapse them)

### Improvement 3 — Homepage date extraction feed

**Do:**
- normalize and score dates already audited
- auto-populate only high-confidence same-domain catalogues
- surface medium confidence in coverage scoreboard

**Don't:**
- re-enable unsupervised cross-domain heal/apply
- telegram spam every candidate

### Improvement 4 — Lot/card dates source of truth

**Do:**
- keep bullets/`_auctionDate` above calendar
- majority consensus to calendar
- merge-safe date preservation

**Don't:**
- force one lot’s minority date onto whole house calendar
- stamp 2099 onto lots
- backfill historical finished lots en masse (out of scope)

### Improvement 5 — Coverage metric

**Do:**
- traditional upcoming-within-N-weeks metric
- MMOA freshness metric
- explained vs unexplained miss
- alert on regression

**Don't:**
- overload enrichment coverage-digest meaning; either separate message or clearly sectioned “Fleet population” block

---

## Files likely to change (summary)

**Create:**
- `lib/pipeline/house-class.js`
- `lib/pipeline/fleet-coverage.js`
- `lib/pipeline/calendar-entries.js`
- `lib/pipeline/platform-discovery.js`
- `lib/pipeline/homepage-date-feed.js`
- `lib/pipeline/lot-date-consensus.js`
- `lib/utils/auction-date-parse.js` (extract shared parser)
- `scripts/fleet-coverage-baseline.mjs`
- `tests/test-house-class.js`
- `tests/test-fleet-coverage.js`
- `tests/test-calendar-entries.js`
- `tests/test-discovery-next-sale.js`
- `tests/test-auction-watcher-horizon.js`
- `tests/test-platform-discovery.js`
- `tests/test-homepage-date-feed.js`
- `tests/test-lot-date-consensus.js`
- `docs/fleet-coverage-baseline.md`
- `docs/fleet-coverage-ops.md`

**Modify:**
- `lib/pipeline/discovery.js` (core semantic flip)
- `lib/pipeline/auction-watcher.js` (horizon + multi-upsert + family config)
- `lib/pipeline/homepage-watch.js` (hook feed)
- `lib/pipeline/persist-lots.js` and/or `persist-stage.js` (only if merge/sanity gaps)
- `lib/houses.js` (family helpers / maybe thin AUCTION_DISCOVERY)
- `lib/analysis.js` (ordering/options)
- `server.js` (schedule + digest emit)
- `lib/pipeline/coverage-digest.js` (optional section) or independent sender
- `.env.example` (new flags)
- possibly `routes/calendar.js` admin

**Avoid modifying unless necessary:**
- `lib/pipeline/healing.js` core auto-apply policy
- `lib/pipeline/calendar-sync.js` always_on continuity logic (call order only)
- recognisers wholesale (per-house extract quality is complementary, not this plan’s main lever)

---

## Test / validation matrix

### Unit (must pass before deploy)
```bash
node tests/test-house-class.js
node tests/test-fleet-coverage.js
node tests/test-calendar-entries.js
node tests/test-discovery-next-sale.js
node tests/test-auction-watcher-horizon.js
node tests/test-platform-discovery.js
node tests/test-homepage-date-feed.js
node tests/test-lot-date-consensus.js
node tests/test-single-cal-fallback.js
node tests/test-auction-date-sentinel.js
node tests/test-healing-agent.js
node tests/test-homepage-watch.js
node tests/test-coverage-digest.js
node tests/test-sale-format.js
```

### Integration dry-runs (staging/prod-read with dryRun writes off)
```bash
node scripts/fleet-coverage-baseline.mjs
# then after code:
node -e "import('./lib/pipeline/discovery.js').then(m=>m.discoverAndUpdateCalendar({dryRun:true})).then(console.log)"
# watcher force dry if supported
```

### Production soak checks (SQL read-only)
- always_on count stable (± small realign)
- upcoming real-date house count ↑
- available lots last_seen_at freshness by house
- pipeline_alerts: no spike in junk heal / merger false positives
- no growth in lots with auction_date > 2098

### Regression canaries (houses known working)
Pick 6 canaries and snapshot before/after:
1. pure MMOA rolling (e.g. a known always_on healthy house)
2. Savills multi-sale drill
3. Allsop API path
4. EIG Maggs/Hollis
5. AH regional platform slug
6. Sequence branch (`bagshaws`/`foxandsons`/`williamhbrownnorwich`)

Must remain scheduled + scrape-positive.

---

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| AI discovery hammers always_on fleet | Cost + noise | classification skip + caps + recheck windows |
| Auto calendar insert of junk URLs | Fake lots / bad schedule | healCandidateVerdict; confidence thresholds; dry-run soak |
| Retire helper marks good rows past | Temporary under-scrape | only date < today and status upcoming; never always_on |
| Lot consensus wrong majority from boilerplate date | Wrong house date | require ≥8 lots and ≥70% agreement; future-only |
| AH national collision | Cross-house URL steal | keep retired national/fronts out; existing unique URL lessons |
| Homepage false next date | Bad upcoming rows | score + verify fetch; medium confidence not auto |
| Metric alert spam | Operator fatigue | threshold + top-10 dark only; unexplained only |
| Double scrapes of same new URL same night | Waste | in-cycle coordination + calendar cache invalidate once |

---

## What “no tinkering” means operationally after rollout

Owner should not need to:
- manually add next auction URLs for known houses
- manually mark past auctions past (system retires)
- manually re-run discovery for ordinary rotations

Owner/agent may still need to intervene for:
- true mergers/new domains (human apply)
- brand-new auction houses not in `HOUSE_ROOTS` (separate new-house discovery budget lane; out of core 5 but leave queue intact)
- site redesigns that break family fingerprints (metric alerts raise these)

Those are exception paths, not routine.

---

## Suggested execution order for implementer

| Order | Task | Model |
|---|---|---|
| 1 | Task 0 baseline | DeepSeek V4 Pro |
| 2 | Task 1 classification | DeepSeek V4 Pro (+ Grok review if aggressive) |
| 3 | Task 2 metrics | DeepSeek pure / **Grok** if wiring schedule |
| 4 | Task 3 calendar helpers | **Grok 4.5** |
| 5 | Task 5 watcher horizon | **Grok 4.5** |
| 6 | Task 6 family expansion (AH + EIG first) | **Grok 4.5** |
| 7 | Task 4 discovery flip | **Grok 4.5 only** |
| 8 | Task 7 homepage date feed | **Grok 4.5** |
| 9 | Task 8 lot consensus (gated) | **Grok 4.5** |
| 10 | Task 9 schedule wire-up | **Grok 4.5 only** |
| 11 | Task 10 admin visibility | DeepSeek (Grok if auth/routing hard) |
| 12 | Task 11 soak + defaults | **Grok 4.5** for defaults; DeepSeek for notes |

Each task: tests first → implement with task Model → run focused tests → canary check → commit.  
If DeepSeek drifts into spine files, escalate to Grok 4.5 before commit.  
Phase-end invariant review: always Grok 4.5.

### OpenRouter model IDs (verify at run time)
- Capable: `x-ai/grok-4.5` (Grok 4.5)
- Basic: `deepseek/deepseek-v4-pro` (DeepSeek V4 Pro)

If either slug 404s on OpenRouter, resolve the current slug once and patch this plan — do not silently substitute a random weaker model.

---

## Open questions (do not block Phase 0–2; decide before Phase 7 writes)

1. **Horizon N weeks:** default 8 — OK, or match business “looking ahead” UI default?
2. **Should high-confidence homepage candidates auto-write calendar immediately, or always wait until next full pass watcher?** (Recommendation: write immediately if verified, so same-day scrape can pick up.)
3. **Persist fleet snapshots to DB vs log+alert only?** (Recommendation: start log/alert; add table if day-over-day needed beyond coverage_snapshots.)
4. **Is there appetite for a one-time manual accept of the first dark-house cohort** if family expansion surfaces many medium-confidence rows? (Automation can still stage them.)

---

## Definition of done

- [ ] All 5 improvements implemented behind tested helpers
- [ ] Always-on continuity and heal kill-switch defaults unchanged
- [ ] Unit suites above green
- [ ] Dry-run then soak gates green
- [ ] Fleet metric shows near-full explained coverage; unexplained dark traditional ≈ 0 within 48h SLA
- [ ] Canary houses healthy
- [ ] Ops runbook committed
- [ ] Owner can leave the system unattended for ordinary next-sale rotations

---

## Handoff note

This plan is intentionally incremental and kill-switched. The previous production incident class (junk URL auto-heal / corpse alert noise) is treated as a hard regression boundary: **automation expands calendar intelligence and scrape targeting, not unsupervised identity rewrites.**

**Owner model preference locked for this workstream:** auto-switch **Grok 4.5** (capable spine) and **DeepSeek V4 Pro** (basic/pure/tests). Do not run the full plan on a single cheap model.
