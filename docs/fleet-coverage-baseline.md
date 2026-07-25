# Fleet Coverage Baseline Freeze

**Plan:** `/.hermes/plans/2026-07-25_063855-fleet-coverage-robustness.md` — Task 0  
**Frozen at:** 2026-07-25 (UTC morning snapshot via read-only Supabase + code inventory)  
**Script:** `scripts/fleet-coverage-baseline.mjs`  
**Scope:** Read-only. No DB writes. No scheduler/heal behaviour changed.

This is the pre-change comparison point for the five robustness improvements (next-sale discovery for existing houses → automatic future-lot population).

---

## How to re-run

```bash
# Code inventory only (works without credentials)
node scripts/fleet-coverage-baseline.mjs --code-only

# Full code + DB join (needs SUPABASE_URL + SUPABASE_SERVICE_KEY)
node scripts/fleet-coverage-baseline.mjs
node scripts/fleet-coverage-baseline.mjs --json --save
node scripts/fleet-coverage-baseline.mjs --horizon-days 56
```

Hosted Hermes often lacks local Supabase env; use Composio `SUPABASE_RUN_READ_ONLY_QUERY` against project ref `pohrbfhftbprlfzsozyj` (Auction.Bridgematch / AuctionBrain) with the same cohort SQL as below, or run the script where Railway/prod credentials exist.

---

## Code inventory (2026-07-25)

| Metric | Value |
|---|---|
| `HOUSE_ROOTS` total | **212** |
| Active (`HOUSE_ROOTS − RETIRED_HOUSES`) | **196** |
| Retired still present in roots | **16** |
| `AUCTION_DISCOVERY` (Cat B watcher) | **10** |
| AH platform slugs active in roots | **31** |
| Active covered by Cat B ∪ AH | **41** |
| Active **not** covered by Cat B ∪ AH | **155** |
| Active roots with rolling-ish URL hints | **93** |

### Cat B (`AUCTION_DISCOVERY`) slugs
`allsop`, `auctionhouselondon`, `bondwolfe`, `buttersjohnbee`, `countrywide`, `hollismorgan`, `knightfrank`, `maggsandallen`, `savills`, `suttonkersh`

### Implication
Even before quality of calendar rows: **only ~21% of active houses** sit in an explicit next-sale watcher family (Cat B or AH). The other ~79% depend on always-on continuity + opportunistic discovery that currently **skips houses already on the calendar**.

---

## Live DB snapshot (2026-07-25, read-only)

### Calendar row shape

| Status | Rows | Distinct houses |
|---|---|---|
| `always_on` | 212 | 212 |
| `upcoming` | 90 | 24 |
| `past` | 10 | 4 |
| `merged` | 1 | 1 |

### Real upcoming spine (status=`upcoming`, date ≥ today, date < 2090)

| Metric | Value |
|---|---|
| Upcoming rows | **30** |
| Houses with any real upcoming | **12** |
| Houses with upcoming in next **56 days** | **12** (all of them) |
| Earliest / latest | 2026-07-25 → 2026-12-10 |
| Houses with **ready** upcoming (`catalogue_ready=true`) | **11** (SQL aggregate earlier in session: 11 ready; 12 real) |

### Available lots (global)

| Metric | Value |
|---|---|
| Total `available` lots | **~11,692** |
| `available` with **null** `auction_date` | **~7,795** |
| `available` with real upcoming date | **~3,336** |
| `available` with 2099 sentinel | **6** (good — nearly eliminated) |
| `available` seen in last 7d | **~8,731** |
| Houses with available but **0** seen in 7d | **36** |

### Cohort map (calendar ⊔ lots, all calendar house_slugs)

Heuristic used for freeze (matches planned Task 2 proxy, not final scorer):

1. `trad_ready_upcoming` — has ready real upcoming  
2. else `trad_upcoming_not_ready` — real upcoming but not ready  
3. else `mmoa_fresh` — always_on + available seen in 7d  
4. else `mmoa_stale_available` — always_on + available > 0 but none seen 7d  
5. else `mmoa_no_available` — always_on + no available lots  
6. else `calendar_dark` — no always_on and no real upcoming  

| Cohort | Houses | Available lots (sum) | Seen 7d (sum) | Null dates (sum) |
|---|---|---|---|---|
| `mmoa_fresh` | **89** | 9,023 | 7,361 | 6,505 |
| `mmoa_no_available` | **85** | 0 | 0 | 0 |
| `mmoa_stale_available` | **33** | 1,120 | 0 | 1,114 |
| `trad_ready_upcoming` | **11** | 1,547 | 1,370 | 174 |
| `calendar_dark` | **3** | 0 | 0 | 0 |
| `trad_upcoming_not_ready` | **1** | 0 | 0 | 0 |
| **Total classified** | **222** | | | |

> Note: calendar house_slug set (222) ≠ active roots (196). Includes retired/legacy slugs still holding calendar or lot history (`markjenkinson`, `woolleyandwallis`, `sdl`, `auctionhousenational`, etc.). Task 1+2 metrics must filter to **active non-retired roots**.

---

## Traditional next-sale intelligence (the weak core)

### Houses with ready real upcoming (11)
`auctionestates`, `auctionhouselondon`, `bondwolfe`, `btgeddisons`, `countrywide`, `hollismorgan`, `knightfrank`, `robinsonhall`, `savills`, `sdl`, `suttonkersh`

### Real upcoming but not ready (1)
- `mchughandco` — nearest `2026-09-16`, `catalogue_ready=false`  
  → invisible to scheduler filters that require ready catalogues (known failure class from calendar-sync rescue comments).

### Calendar “dark” (3) — mostly retired/noise
- `markjenkinson` (retired brand-front)  
- `network`  
- `woolleyandwallis` (retired)  

**Not the main gap.** The main gap is **always_on-only active houses with no traditional upcoming spine**, including many that should rotate dated sales.

### Cat B health vs goal

| Cat B slug | In ready-upcoming set? | Notes |
|---|---|---|
| `auctionhouselondon` | yes | nearest 2026-07-29 |
| `bondwolfe` | yes | 2026-09-10 |
| `countrywide` | yes | 2026-09-10 |
| `hollismorgan` | yes | 2026-07-25 |
| `knightfrank` | yes | 2026-09-17 (+ Oct) |
| `savills` | yes | multi-sale horizon present |
| `suttonkersh` | yes | 2026-09-10 |
| `allsop` | **no** | Should have next sales; still always_on / market path only |
| `buttersjohnbee` | **no** | Watcher configured; no ready upcoming |
| `maggsandallen` | **no** | EIG family poster child; no ready upcoming in freeze |

**Cat B with zero ready upcoming at freeze: 3/10.**  
Watcher “has any upcoming → skip” + thin family coverage are confirmed live.

### AH platform
31 active AH roots exist in code. Almost all currently sit in always_on cohorts (fresh/empty/stale), **not** traditional ready-upcoming — despite homepage-watch already knowing how to resolve future-dated regional URLs.  
This is the single highest-leverage auto-populate gap for Improvement 2 (feed AH future-dates into calendar API upserts).

---

## Continuity vs population quality

### What is working
- Always-on insert/realign keeps most roots **schedulable**.
- Large MMOA fresh belt: **89** houses / **~9k** available / strong 7d seen mass.
- Sentinel 2099 on available lots nearly gone (**6** rows).
- Ready traditional set, though small, is high-quality (BTG multi-horizon, Savills multi-sale, Hollis same-day).

### What fails the “100% automatic future lots” bar
1. **Only ~12 houses** have any real upcoming calendar date (vs 196 active).  
2. Discovery cannot recruit new dates for the ~212 always_on identities while skip-if-already-on-calendar remains.  
3. **~7.8k available lots undated** — listing truth weak even when stock flows (esp. purplebricks/AH style null-date bulk).  
4. **33 always_on houses** still show available stock with **0** 7d sees (stale inventory risk): includes `harmanhealy` (402), `pattinson` (229), `acuitus` (70), `underthehammer` (70), `barnardmarcus` (19), etc. Some are retired/should-be-purged; active ones are scrape/populate failures, not “no catalogue URL”.  
5. **85 always_on with zero available** — mixture of truly empty, dark rotating houses unmarked as traditional, retired leftovers, and brand fragments. Needs classification before discovery thrash.

### Proxy scores (active-root aware scoring comes in Task 2; these are fleet-wide calendar-joined proxies)

Using classified 222 rows:

| Proxy | Value | Reading |
|---|---|---|
| Ready trad houses | 11 | Thin traditional spine |
| MMOA fresh houses | 89 | Continuity OK for continuous catalogues |
| MMOA stale available | 33 | Freshness / scrap health problem |
| MMOA empty | 85 | Needs class split (true empty vs dark trad) |
| Real upcoming houses / active roots | 12 / 196 ≈ **6.1%** | **Primary gap metric for Imp 1–2** |
| Null-date share of available | 7795 / 11692 ≈ **66.7%** | **Primary gap metric for Imp 4** |

---

## Upcoming detail freeze (all real upcoming rows by house)

- **auctionestates:** 2026-08-20, 2026-10-08, 2026-12-10 (all ready)  
- **auctionhouselondon:** 2026-07-29 ready  
- **bondwolfe:** 2026-09-10 ready  
- **btgeddisons:** Jul–Nov multi-lot timed + live-stream pair horizon (mixed ready flags)  
- **countrywide:** 2026-09-10 ready  
- **hollismorgan:** 2026-07-25 ready  
- **knightfrank:** 2026-09-17, 2026-10-22 ready  
- **mchughandco:** 2026-09-16 **not ready**  
- **robinsonhall:** 2026-08-05 ready  
- **savills:** 2026-07-28 (not ready), 2026-08-18 ready, 2026-09-01 ready  
- **sdl:** Jul–Nov monthly ready set (retired front — do not “fix” into scrape; coverage should remain under `btgeddisons` / `sdlauctions` paths)  
- **suttonkersh:** 2026-09-10 ready  

---

## Task-0 cohort labels for later work

Use these names consistently in Task 1 classification + Task 2 metric:

| Label | Meaning | Owner action in later tasks |
|---|---|---|
| `trad_ready_upcoming` | Healthy traditional target | Keep; extend horizon if near-dated only |
| `trad_upcoming_not_ready` | Date known, not schedulable | Rescue ready flag / verify URL |
| `mmoa_fresh` | Continuous stock flowing | Do **not** AI-discovery thrash |
| `mmoa_stale_available` | Continuity URL may be wrong **or** extractor dead | Health/scrape path, not only date discovery |
| `mmoa_no_available` | Empty or dark | Classify: true MMOA empty vs traditional missing next sale |
| `calendar_dark` | No always_on / no upcoming | Usually retired or onboarding hole |
| `retired_noise` | In calendar/lots but `RETIRED_HOUSES` | Exclude from fleet score denominator |

---

## SQL used for freeze (reproducible)

```sql
-- Status mix
SELECT status, COUNT(*) n, COUNT(DISTINCT house_slug) houses
FROM auction_calendar GROUP BY 1 ORDER BY n DESC;

-- Real upcoming spine
SELECT COUNT(*) FILTER (WHERE date >= CURRENT_DATE AND date < '2090-01-01') upcoming_rows,
       COUNT(DISTINCT house_slug) FILTER (WHERE date >= CURRENT_DATE AND date < '2090-01-01') houses_upcoming,
       COUNT(*) FILTER (
         WHERE date >= CURRENT_DATE
           AND date < CURRENT_DATE + INTERVAL '56 days'
           AND date < '2090-01-01'
       ) upcoming_8w_rows
FROM auction_calendar
WHERE status = 'upcoming';

-- Available lot date / freshness gauges
SELECT
  COUNT(*) FILTER (WHERE status = 'available') AS available,
  COUNT(*) FILTER (WHERE status = 'available' AND auction_date IS NULL) AS null_date,
  COUNT(*) FILTER (
    WHERE status = 'available'
      AND auction_date >= CURRENT_DATE
      AND auction_date < '2090-01-01'
  ) AS real_upcoming_date,
  COUNT(*) FILTER (WHERE status = 'available' AND auction_date::text LIKE '2099%') AS sentinel,
  COUNT(*) FILTER (WHERE status = 'available' AND last_seen_at > NOW() - INTERVAL '7 days') AS seen_7d
FROM lots;
```

Per-house cohort query is embedded in session notes / can be regenerated via the script’s DB mode.

---

## Baseline conclusions (drive implementation order)

1. **Continuity layer is NOT the main failure** — always_on coverage is broad; lots are flowing for a large MMOA belt.  
2. **Next-sale intelligence is fringe** — ~6% of active houses have a real upcoming calendar date.  
3. **Configured watchers are incomplete and under-used** — 3/10 Cat B lack ready upcoming; 31 AH roots almost unused as trad spine.  
4. **Stale available always_on (33)** is a second failure mode (scrape/health), distinct from missing next-sale URLs — do not “fix” only with discovery.  
5. **Null lot dates (~67% of available)** will still leave “future lots” half-blind even after calendar UPSERTs — Improvement 4 remains mandatory.  
6. **Safety confirmation for plan rails:** retired brand-fronts appear in calendar noise (`sdl`, `markjenkinson`); metrics and discovery must hard-exclude `RETIRED_HOUSES` so automation does not revive them.

---

## Comparison targets after implementation

Re-run this freeze after Phases 1–2 and after soak:

| Target metric | Baseline (2026-07-25) | Phase-2 exit gate | Phase-5 done gate |
|---|---|---|---|
| Active houses with ready real upcoming | ~11–12 raw calendar houses (≈6% of 196) | ≥ existing + AH/EIG enrolled & healthy | Unexplained dark trad ≈ 0 for 48h |
| Cat B ready-upcoming share | 7/10 | 10/10 or explained miss | explained only |
| AH active with ready/dated spine or proven empty | ~0 structured | majority of regions with live sales | all regions classified |
| Available null-date share | ~66.7% | ↓ after consensus/date prefer | sustained ↓, no 2099 regression |
| MMOA fresh count | 89 | no >2pp regression | stable/up |
| Junk heal / autopromote incidents | n/a (heal default off) | still 0 unsupervised junk | still 0 |

---

## Artifacts

- Script: `scripts/fleet-coverage-baseline.mjs`  
- Plan: `.hermes/plans/2026-07-25_063855-fleet-coverage-robustness.md`  
- This freeze: `docs/fleet-coverage-baseline.md`  
- Optional saved JSON from script: `scripts/output/fleet-coverage-baseline-YYYY-MM-DD.json` (when run with `--save` + credentials)

**Task 0 status:** complete enough to unlock Task 1 (house classification) and Task 2 (fleet metric module) without further owner input.
