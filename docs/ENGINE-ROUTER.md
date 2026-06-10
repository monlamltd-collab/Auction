# Best-Engine-First Router

**Status:** Phase 1 landed (decision core + schema, dormant). Phases 2–4 staged.
**Owner:** Simon Deeming · **Decision core:** `lib/scraper/engine-router.js` · **Tests:** `tests/test-engine-router.js`

Replaces the rigid "Firecrawl primary, Puppeteer fallback, HTTP last — never reverse"
non-negotiable with a **scored, per-house engine choice**. The engine's job is to pick the
*best tool for each house's nature*; "best" is a trade-off, not a fixed list.

---

## Why

Firecrawl's JSON extraction costs ~5 credits/page, so the 100k Standard plan yields only
~19k LLM-extracted pages, not 95k. The expensive part is *extraction*; rendering is cheap.
For the cooperative platform houses (EIG / AH UK / Bamboo — the bulk of volume) a
self-hosted render (**Crawlee**) + the existing **Gemini** extractor produces the same lots
for roughly **$0 + a few Gemini-Flash cents** instead of 5 Firecrawl credits. Crawlee is
Node-native (Apache 2.0) and adds the browser fingerprinting / session pooling the bare
Puppeteer tier lacks.

We do **not** rip out Firecrawl. We route each house to the cheapest engine that matches its
recall, and keep Firecrawl for what only it does well: changeTracking, markdown recognisers,
FIRE-1 healing, and bot-protected sites.

## What "best" means

Four competing axes, in priority order:

1. **Recall** — do we get *all* the lots? The cardinal sin is silently missing lots.
2. **Reliability** — does the engine actually succeed on this site (not blocked / timing out)?
3. **Cost** — Firecrawl credits vs Crawlee (~free) vs a future managed-unblocker tier.
4. **Fidelity needs** — does the house *require* a specific engine's output?

**Recall is never knowingly traded for cost.** Cost is the tie-breaker that only applies once
recall is proven equal (see *Strict recall parity*).

## Reading a house's nature — the signals we already have

The router reads sensors the codebase already maintains; it never guesses blind:

| Signal | Source | Tells the router |
|---|---|---|
| Platform auto-detect (EIG/AH UK/Bamboo) | `detectPlatformSentinel()` in `lib/analysis.js` | Cooperative HTML → cheap engine viable |
| Recall sentinel ratio | `RECALL_SENTINELS[slug]` / platform sentinel | **Ground truth for recall** comparisons |
| Structured API | `rewriteUrl().isApi` (Allsop) | Bypass rendering entirely |
| Markdown recogniser dependency | `HOUSE_OVERRIDES[slug].recogniseFromMarkdown` | Must stay on Firecrawl (needs *its* markdown) |
| changeTracking incompatibility | `HOUSE_OVERRIDES[slug].changeTracking === false` | Known site quirk |
| Per-engine success history | `house_skills.engine_stats` (new) | Reliability score |
| Cost per tier | `lib/resource-budget.js` | Cost score |

## The decision: `chooseEngine(ctx)`

A pure function (`lib/scraper/engine-router.js`) consulted before rendering. Three layers,
evaluated top-down; the first match wins:

1. **Deterministic overrides** (nature facts that don't change):
   - `engine_locked` set → that engine (operator escape hatch, beats everything)
   - `isApi` → `api` (Allsop)
   - `isPdf` → `pdf-gemini`
   - has markdown recogniser → `firecrawl`
   - bot-protected → `firecrawl` (best anti-bot we run today; managed-unblocker is future)
2. **Learned policy** — `house_skills.preferred_engine`, seeded by the onboarding profiler
   and refined by the adaptive feedback loop.
3. **Default** — `firecrawl`, the safe incumbent, until a policy is learned.

A final availability pass degrades the choice if the desired engine can't run right now
(Crawlee not installed, Firecrawl budget exhausted) and **annotates the reason** — never a
silent no-op. Every verdict is `{ engine, reason }` and the reason is stamped for the
manifest.

## Strict recall parity (operator-chosen, 2026-06)

The cheaper *challenger* engine only displaces the *incumbent* when, against the house's
recall sentinel:

- `challengerRecall >= incumbentRecall` (tolerance **0** — strict), **and**
- `challengerLots >= incumbentLots`, **and**
- `incumbentLots >= minLots` (enough signal to trust the comparison).

Implemented in `shouldDemote()`. Cost is *not* an input — it only breaks ties once recall is
proven equal. This honours "never sacrifice recall for cost".

## In-run escalation ratchet

`shouldEscalate({ recall, floor })` — if the chosen engine under-recalls mid-run (below
`floor`, default 0.85, relative to the sentinel), climb the ladder
(`escalationTarget`: crawlee → firecrawl → *managed-unblocker (future)*), persist the new
floor, and fire a harness alert. A periodic cheap re-probe lets a house ratchet *back down*
when the site relaxes, so nothing gets permanently stuck on the expensive engine.

## Data model (migration `2026-06-10-house-skills-engine-router.sql`)

Three additive, nullable columns on `house_skills`:

- `preferred_engine TEXT` — learned policy. NULL = use default (Firecrawl).
- `engine_locked TEXT` — manual override; wins over everything.
- `engine_stats JSONB DEFAULT '{}'` — per-engine rolling rollup
  `{ "<engine>": { runs, successes, recallSum, recallRuns, creditSum, lastRunAt } }`.
  Folded by the pure reducers `recordEngineOutcome()` / scored by `engineScore()`.

## Rollout phases

- **Phase 1 (landed, dormant):** decision core + reducers + strict-parity gate
  (`engine-router.js`), the `crawlee.js` adapter (conditional import — `hasCrawlee()` is
  false until `npm install crawlee`), the migration, and full unit tests. **No runtime
  behaviour changes** — the router isn't called from the hot path yet and Crawlee is
  uninstalled.
- **Phase 2 (next PR):** install `crawlee`; wire `chooseEngine()` into the
  rendering/extraction stage behind a `CRAWLEE_HOUSES` allowlist; route 2–3 cooperative
  platform houses (which have recall sentinels, so regression is measurable). Render with
  Crawlee → extract with `extractLotsWithAI()` (the existing Gemini path). Fall back to
  Firecrawl on 0 lots.
- **Phase 3:** the onboarding **profiler** — classify a new house's nature on first contact
  (challenge page? empty SPA shell? cheap-engine recall vs sentinel?) and write
  `preferred_engine`. Generalise the Pattinson page-1 MD5 gate
  (`getCataloguePage1Hash`) to every Crawlee-routed house for ~0-cost change detection.
- **Phase 4:** the **adaptive tuner** — fold each run's `(success, recall, credits)` into
  `engine_stats`, demote on proven strict parity, periodically shadow-probe the cheaper
  engine to allow ratchet-down. Optional managed-unblocker (Bright Data Web Unlocker) as a
  top-of-ladder escalation target for the handful of bot-protected stragglers.

## Engines

| id | meaning |
|---|---|
| `api` | structured JSON API consumer (Allsop) |
| `firecrawl` | Firecrawl render + server-side JSON extract (incumbent default) |
| `crawlee` | Crawlee render + Gemini extract (cheap, self-hosted) |
| `pdf-gemini` | PDF download → Gemini Pro extract |

Within any rendering engine the existing fallback chain (Firecrawl → Puppeteer → HTTP) is
unchanged; the router decides the *primary* engine, not the fallback tiers.

---

## Phase 2 — wiring + the product-integrity gate (landed)

Phase 2 makes Crawlee+Gemini a real, gate-guarded engine. It ships **dormant**:
`crawlee` is a dependency but the router only picks it when `hasCrawlee()` is true *and*
the house is enabled via config, so behaviour is unchanged until an operator opts in.

**The single seam.** `lib/pipeline/engine-decision.js::resolveEngineForHouse()` is the one
place the router is consulted — from the cron path (`lib/analysis.js::autoAnalyseOne`) and
the on-demand path (`routes/analyse.js`). It gathers a house's live signals (engine policy
from `house_skills`, `rewriteUrl` shape, PDF check, crawlee availability, Firecrawl budget)
and hands them to the pure `chooseEngine()`. `isCrawleeEnabled()` holds the
dormant→allowlist→default progression.

**Render + extract.** `lib/scraper/crawlee-render.js::scrapeAllPagesWithCrawlee` mirrors the
Firecrawl multi-page wrapper (reusing `detectTotalPages`/`buildPageUrl`, capped at
`MAX_PUPPETEER_PAGES`). `lib/pipeline/crawlee-extract.js::renderAndExtractWithCrawlee` renders
then runs the existing `extractLotsWithAI` (Gemini), and computes recall against the house's
sentinel so the gate has a comparable challenger figure. Firecrawl's
`extractCatalogueListing` now also returns `recall`/`sentinelLots` for the same comparison.

**The gate.** `lib/pipeline/parity-gate.js::evaluateParity()` composes
`shouldDemote` (strict recall parity) + `validateBatch().batchQuality` (per-lot completeness)
+ `detectFieldRegressions` (no field may regress). `promote` requires all three. This is the
enforcement of the "scraper builds the product" ethos: lot count alone never promotes.

**Migration flow (cron path).**
- *Candidate, not yet promoted* (`isCrawleeEnabled` + structurally eligible, `preferred_engine`
  ≠ crawlee): Firecrawl runs and is persisted (investors see the incumbent); then Crawlee runs
  as a **shadow** challenger and `evaluateParity` decides whether to set
  `preferred_engine='crawlee'`. Every run folds an outcome into `engine_stats`.
- *Promoted/locked* (`chosenEngine === CRAWLEE`): Crawlee renders + extracts and is persisted;
  no Firecrawl spend. A free page-1 MD5 gate (`scrapeWithCrawlee` probe vs
  `getCataloguePage1Hash`) skips the Gemini extract when nothing changed. On 0 lots it falls
  back to Firecrawl.

**On-demand path** is conservative: it honours Crawlee only for an already-promoted house and
never shadow-compares or cold-starts an engine on the latency-sensitive user request.

**Provenance.** `scraped_with='crawlee'` / `extracted_with='gemini'` flow from the existing
`state.js` stamps; the Firecrawl JSON path now correctly stamps `extracted_with='firecrawl-json'`
(it previously defaulted to `'unknown'`).

**Config:** `CRAWLEE_DEFAULT` (master switch), `CRAWLEE_HOUSES` (first-migration allowlist),
`CRAWLEE_SHADOW` (run shadow comparison, default on). First candidates: `astleys`, `brownco`,
`stags`, `paulfosh`, `auctionhouseeastanglia`. Roll back any house with
`house_skills.engine_locked='firecrawl'`.

**Verify:** `node scripts/test-engine-ab.mjs <slug> <url> [paginateAs]` prints the side-by-side
parity verdict; `tests/test-parity-gate.js` + `tests/test-engine-decision.js` cover the gate
and the decision seam.
