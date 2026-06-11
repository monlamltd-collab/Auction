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

---

## Phase 3 — unblock the markdown-recogniser houses + Crawlee as zero-credit failover

The 6 recogniser houses (Pattinson, John Pye, McHugh, Mark Jenkinson, Maggs & Allen,
Hollis Morgan) are the dense, multi-page catalogues — the most expensive on Firecrawl and the
last structural blocker to Crawlee-default. Their recall depends on parsing **Firecrawl's
markdown**; Crawlee yields HTML only. Phase 3 closes that gap.

**The turndown bridge.** A `turndown` HTML→markdown step in the Crawlee path
(`renderAndExtractWithCrawlee` gains `recogniseFromMarkdown` + `recallSentinelPattern`): each
rendered page's HTML is converted to markdown, the existing `recogniseFromMarkdown` runs on it,
and recovered lots are merged with the Gemini lots (dedup by `lot+address`, mirroring the
Firecrawl JSON+markdown merge). turndown preserves the structures the recognisers anchor on
(detail links `[text](/lot/…)`, headings, bullets, em-dash chains), so most recognisers work
with little or no change — and the **product-integrity gate decides empirically**: a recogniser
house only promotes if turndown+recogniser+Gemini hits strict parity, so no degradation ships.

**Guard relaxed (allowlist + gate decides).** `hasMarkdownRecogniser` no longer hard-pins a
house to Firecrawl. Recogniser houses become normal `CRAWLEE_HOUSES` candidates; the cron path
always passes their recogniser into the Crawlee path; the parity gate guards promotion.

**Crawlee as the universal zero-credit failover.** The most valuable Phase 3 behaviour: when
`canUseFirecrawl()` is false (budget exhausted / plan down), **any** house — recogniser houses
included — fails over to the Crawlee turndown path rather than going unscraped. Degraded-but-
present beats a stale catalogue. This decouples the *failover* availability (`crawleeInstalled`
= `hasCrawlee()`, any house) from *proactive migration* availability (`crawleeAvailable`
= `hasCrawlee()` + allowlist). When credits return a non-promoted house reverts to Firecrawl;
a promoted one (passed the gate) stays on Crawlee. Provenance records the
`reason=firecrawl-exhausted` failover so it's auditable.

**Pattinson (84 pages)** is enabled now precisely as that no-credit fallback: it runs on Crawlee
while there are no Firecrawl credits, and reverts to Firecrawl's managed render once credits
exist — unless it clears the parity gate, in which case it stays. The page-1 hash gate skips
unchanged cycles for free.

**Rollout order:** John Pye → Hollis Morgan → Maggs → McHugh → Mark Jenkinson → Pattinson.

**Files:** `lib/scraper/html-to-markdown.js` (turndown helper) · `lib/pipeline/crawlee-extract.js`
(recogniser-aware) · `lib/scraper/engine-router.js` (relax guard, add failover availability) ·
`lib/analysis.js` (pass recognisers + sentinel into the Crawlee branch) · `scripts/test-engine-ab.mjs`
(recogniser-recall column) · recogniser fixture parity tests.

**Turndown fidelity (verified 2026-06-11).** The recognisers depend on two
Firecrawl markdown idioms, so `htmlToRecognitionMarkdown` reproduces them: a
`<br>` becomes `\\`+newline (the Pattinson recogniser splits cards on this —
turndown's default two-space break recognises nothing), and relative hrefs/srcs
are absolutised against the page URL (four recognisers and the markjenkinson
sentinel anchor on `https://www.<domain>/…`). A real-recogniser-over-turndown
fixture test guards this. Cards that render the image as a separate block can
still glue it to the price line — such houses must be A/B-validated; the parity
gate holds promotion until recall is proven, so it fails safe.

**Failover policy.** The zero-credit failover (`crawleeInstalled`) reaches every
house when Firecrawl is exhausted — **except** a `manual-lock`, which is absolute
(a firecrawl-locked house degrades to puppeteer, never to the engine the
operator locked it off). Bot-protected houses are never *proactively* given to
Crawlee, but the failover does reach them (Crawlee's fingerprint hardening beats
bare puppeteer, and degraded-but-present beats stale). A recogniser house renders
at most once per cron pass (`crawleeTried` guards the second extraction block);
the on-demand path caps Crawlee at 25 pages to bound SSE latency.

**`CRAWLEE_DEFAULT=true` = the main-engine switch (2026-06-11).** It does two
things: opens the allowlist to every house AND makes Crawlee the *desired*
engine for any house without a structural override (api/pdf/bot), learned
policy, or lock (`chooseEngine` reason `config-default`). Firecrawl remains the
in-run fallback whenever a Crawlee run yields 0 lots **or under-recalls** (below
`CRAWLEE_RECALL_FLOOR`, default 0.85) *while Firecrawl is available*. Unset it to
revert to Firecrawl-first instantly — promotion state earned via the gate
(`preferred_engine='crawlee'`) survives the flip.

**Trial-hardening knobs (2026-06-11, PR review fixes).** `CRAWLEE_HOUSE_TIMEOUT_MS`
(default 600000) gives likely-Crawlee houses a longer wall-clock than the 90s
Firecrawl budget; `CRAWLEE_RENDER_BUDGET_MS` (420000) bounds multi-page renders;
`CRAWLEE_RECALL_FLOOR` (0.85) gates fallback; `CRAWLEE_PROMOTE_PASSES` (2)
requires consecutive parity passes before promotion. A 402 from Firecrawl now
latches `planExhausted` until cycle rollover (no hourly thrash); the Crawlee
renderer uses the per-house `paginateAs` scheme (Pattinson `?p=N`), caps at
`MAX_PUPPETEER_PAGES`, reuses the change-gate's page-1 render, and stops on a
repeated page. The vanished-lot pruner requires 90% retention (not 50%) on a
Crawlee run before withdrawing lots. Full operator guide:
`docs/CRAWLEE-TRIAL-RUNBOOK.md`.

**Validation harness.** `scripts/validate-crawlee-houses.mjs [slugs…]` renders
live catalogues with Crawlee and reports render health, sentinel lot-ID counts
(the recall denominator), and — for recogniser houses — turndown→recogniser
recovery with `validateBatch` field coverage. Needs no Gemini/Supabase keys, so
it runs anywhere with open egress (it does NOT run in the Claude dev container,
whose network policy blocks auction domains — `x-deny-reason: host_not_allowed`).
`CRAWLEE_IGNORE_CERT_ERRORS=true` is a dev-only knob for TLS-intercepting
proxies; never set it in production.
