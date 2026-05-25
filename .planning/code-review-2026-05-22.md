# Code Review — Auction Brain — 2026-05-22

> Auto-saved planning document for the `/github:code-review-swarm`
> audit run on **2026-05-22 21:55 → 22:56** against the
> `feat/telegram-verified-url` branch. Five subagents ran in parallel:
> UX audit, Firecrawl token economy, monolith decomposition, and two
> passes of "Firecrawl savings hunt." Original session: `07b0d868`.
>
> This doc preserves the raw findings + tracks which have shipped
> and which remain. It lives on `main` so any future branch can read it.

---

## Snapshot — status as of 2026-05-25

| PR | Theme | Status | Commit(s) on main |
|----|-------|--------|-------------------|
| **A1** | Render `scoreBreakdown` in lot detail panel | ✅ Shipped | `16b76b4` |
| **A2** | Remove dead/fake panel rendering (logistics, fake net-yield, tier chips, dupes) | ✅ Shipped | `9660654` |
| **A3.1** | Persist `lot.floorPlanUrl` end-to-end (column + mapper + upsert) | ✅ Shipped | `ea1b454` (migration: `2026-05-23-lots-floor-plan-url.sql`) |
| **A3.2** | Lot gallery + lightbox in expanded panel | ✅ Shipped | `24899b4` |
| **A3.3** | Photo-count badge on card | ✅ Shipped | `41f8fcf` |
| **B** | Firecrawl round-2 savings (past-auction lookback, `requires_puppeteer` skip, adaptive backoff) | ⏳ Pending | — |
| **C** | Decomposition pass 1 (rewrite stale `ARCHITECTURE.md`, split `lib/enrichment.js`, split `routes/admin.js`) | ⏳ Pending | — |
| **D** | `public/app.js` decomposition (6k lines → finance/card/auth/scenarios modules) | ⏳ Pending | — |
| **E** | Real Land Registry comparables on card + flip-margin number on card | ⏳ Pending | — |
| **F** | Cleanup (`pivot-warn.js` stale string, stale worktree prune, `dbRowToLot` consolidation) | 🟡 Partial — canonical `lib/types/lot.js` landed via `refactor/canonical-lot-contract`, legacy mappers deleted (`1a73fe1`); `pivot-warn.js` + worktree prune still pending |

The PR A1–A3.3 work originally lived on a local worktree
(`worktree-render-scorebreakdown`); it was re-applied as
`feat/investor-trust-render` and merged into main on 2026-05-25. The
worktree branch is now redundant and can be safely removed:

```bash
git branch -D worktree-render-scorebreakdown                 # if local
git push origin --delete worktree-render-scorebreakdown      # if pushed
git worktree remove .claude/worktrees/render-scorebreakdown --force
```

---

## Prioritised 13-item findings (from the original audit synthesis)

Severity / impact ranking from the synthesis I did on 2026-05-23. Done
items struck through.

1. ~~**Render `scoreBreakdown` in lot detail panel.**~~ Biggest investor-trust gap. — **A1**
2. **Surface real Land Registry comparables** on the card / detail panel (3–5 actual sales: address, date, price). Stop fabricating `streetRange` from ±20%. (`buildExpV2Comparables`, `app.js:4789`) — **PR E**
3. **Adaptive Firecrawl backoff tied to auction proximity** (`scheduling.js`: raise `BACKOFF_HOURS` cap + `FRESHNESS_FLOOR_MS` to 14d; near-auction stays at 6–12h). Strategic FC win. — **PR B**
4. **Drop the 7-day past-auction lookback** in `getCalendarAuctions` (`lib/calendar.js:792-803`). Finished auctions get fully re-scraped for 7 nights. ~1–3k credits/mo. — **PR B**
5. **Skip Firecrawl for `requires_puppeteer=true` houses** (`schema.sql:82-83`, `resource-budget.js:19-21`). Chronic failers burn the FC attempt + retries before fallback. ~500–2k credits/mo. — **PR B**
6. **`app.js` decomposition** (6k → finance/card/auth/scenarios modules). — **PR D**
7. **`lib/enrichment.js` decomposition** — already four data-source families with comment-fenced blocks (LR/EPC/flood/rent). Near-mechanical. — **PR C**
8. **`routes/admin.js` decomposition** — 48 handlers; split out `intel` (~570 lines, worst chunk), `pipeline`, `observability`, `static-pages`. — **PR C**
9. **Rewrite stale `docs/ARCHITECTURE.md`** — lines 66-129, 168, 261-266 describe the deleted `lib/extractors/` tree as live; line 14 says `server.js` is 428 lines (actually 850). — **PR C**
10. ~~**Dead-weight UI cleanup** — `buildExpV2Logistics` (hardcoded "£1,500 + VAT / 28 days / 10% on the fall"), net-yield `gy * 0.867` haircut, hardcoded Tier 1/2/3 ✓ chips, duplicate comparables renderer at `app.js:5045`.~~ — **A2**
11. **Flip/profit number on the card** — compute margin from existing `suggestWorksAndGdv` logic (`app.js:3594`); surface to grid level instead of buried in deal-stack. — **PR E**
12. **`.claude/hooks/pivot-warn.js:34`** still lists `lib/extractors/` in a warning string (stale); plus `.claude/worktrees/agent-a4583740/` and `.planning/` plans treat `BROKEN_EXTRACTORS` as live. Production code is clean. — **PR F**
13. ~~**Consolidate `dbRowToLot` vs `dbRowToFrontendLot`**~~ — done as part of `refactor/canonical-lot-contract` (`lib/types/lot.js` landed `1a73fe1`).

---

## Full audit reports (verbatim)

The five subagent reports, copied verbatim from session
`07b0d868-0f64-475b-8fde-15b3ccb10021` tool-results dump. Some "Plausible
steady-state" figures are estimates from `lib/resource-budget.js`
internal weights, not Firecrawl invoices — see each report's caveat.

### 1. Investor UX audit (`ux-auditor`)

**What the user sees**

- **Landing + browse**: a marketing shell (how-it-works, stats bar "2000+ lots", email-capture, bottom CTA) above a unified filter bar, then a grid/list of lot cards. A "Today's top deals" curator widget (`renderCuratorWidget`, app.js:5495) shows 3 hand-picked lots scored 7+.
- **Lot card** (`card()`, app.js:3288, `.lot-card-v2`): house+lot strip, photo or "NO CATALOGUE IMAGE" stripe, address, a 3-cell stat row — **GUIDE / GROSS YIELD / SCORE** (score is a coloured 0–10 badge, green ≥8 / amber ≥6.5), an "Est. £Xk · confidence" value line, up to 4 opp/risk tags, a meta line (type·beds·tenure·FZ·EPC), an AI pull-quote, and two CTAs: "View lot ↗" and "BridgeMatch it £".
- **Filters**: price, beds, type, region, town/postcode+radius, lot status, sort (soonest/price/yield/score/longest-unsold), plus a "Pro filters" popover (house, opportunity, tenure, POA, condition) and quick toggles (Unsold/Favourites/Analysed).
- **Lot detail** (`expandCard`, app.js:4906): an inline editorial panel — hero image, guide price + below-market badge, **Due-diligence checklist** (flood/tenure/EPC/occupancy, "X of N cleared"), **"Why this lot scores"** (opps/risks lists), **Comparables on this street** (sales count + guide-vs-median bar), a **deal-stack calculator** (price/works/GDV/rent → flip vs hold, save scenarios), **Fundability** (bridging lender count), **Auction logistics**, and a "what happens next" buyer's guide.
- **Smart-search** (`/api/smart-search`): AI returns a 2–3 paragraph report + ranked lots; a stats row and a non-determinism disclaimer show.
- **Score signals**: 0–10 from `scoring.js:analyseLot` — condition, executor/receivership, development/extension potential, vacant, freehold, £/sqft, rental yield, title-split, minus knotweed/flood/sitting-tenant/non-standard-construction.
- **Enrichment**: EPC rating, flood zone, gross yield, Land Registry street median, fundability badge — gated for anon users (search.js:1510 nulls score/opps/yield).

**WORKS (ranked)**

1. **The 3-cell stat row** (app.js:3401) puts guide, yield, score side-by-side — the three numbers an investor needs, instantly scannable.
2. **Below-market badge** (app.js:4599) — "▼ 22% below local median sold" is the single strongest deal signal and it's prominent in the detail header.
3. **Due-diligence checklist** (`buildExpV2DD`, app.js:4651) — turns flood/tenure/EPC into a pass/warn/fail list; unknowns become amber, never silently dropped. Genuinely decision-useful.
4. **Deal-stack calculator** with auto-suggested works/GDV from condition (app.js:3594) and saveable scenarios — real underwriting.
5. **Honesty cues**: value estimate always shown as band+confidence; yield >30% warning (app.js:5017); AI non-determinism disclaimer.

**DEAD WEIGHT (ranked)**

1. **`toggleScorePopup` / `showScoreTip` (app.js:4353–4419) is unreachable dead code.** It attaches to a `.badge-score` element from a retired card renderer; the live `card()` emits a static `lcv2-score-badge` (app.js:3408) with **no onclick/hover**. The full point-by-point breakdown UI exists but no user can ever open it. *(Resolved differently — A1 ships the breakdown in the detail panel, the popup itself stays as a card-overlay affordance.)*
2. **`buildExpV2Logistics` (app.js:4872)** — every value is hardcoded ("£1,500 + VAT typical", "28 days", "10% on the fall"). Generic norms presented as if lot-specific; adds no per-lot signal and risks being wrong. *(Resolved — A2 deleted it.)*
3. **Net-yield "calculation"** (app.js:5009) — `gy * 0.867`, a flat 13.3% haircut. Fake precision; doesn't reflect real costs. *(Resolved — A2.)*
4. **"Fundability" tier chips** (app.js:4850) — three "Tier 1/2/3 ✓" badges hardcoded whenever lenderCount > 0; decorative, not data. *(Resolved — A2.)*
5. Two near-duplicate comparables renderers (`buildExpV2Comparables` and the inline `compSection`, app.js:4756 & 5045) — maintenance dead weight. *(Resolved — A2 dropped `compSection`.)*

**FRICTION (ranked)**

1. **Score is a bare number with no inline "why".** The card badge isn't interactive; the detail panel's "Why this lot scores" lists opp/risk *labels* but **never the points** (`buildExpV2Scores`, app.js:4732 ignores `lot.scoreBreakdown` entirely). A user sees "7" and cannot see it's 2+2+1.5+1.5. *(Resolved — A1.)*
2. **Anonymous users see no score, yield, or tags at all** (search.js:1510) — the homepage's headline value ("AI scores every lot") is invisible until signup. The card yield cell is also blanked for anon (app.js:3396), so the grid looks data-poor on first visit.
3. **Heavy filter bar**: ~16 controls across 4 rows plus a separate bridging-finance "advanced" panel — the score/yield/below-market signals compete with a wall of dropdowns. *(Partially addressed by the Rightmove-style mobile redesign, PR #49/#50.)*
4. **Sold/unsold default**: "Lot status" defaults to all-inclusive in places; users report "0 of N" confusion (the code carries multiple banner workarounds, app.js:2876 — a symptom of confusing defaults).
5. Smart-search is non-deterministic and may return lots "outside your literal parameters" — honest, but unsettling for a high-stakes purchase decision.

**GAPS (ranked)**

1. **Score breakdown is not shown to users** — biggest trust gap. *(Resolved — A1.)*
2. **Land Registry depth is thin** — confirmed. The UI only ever shows a street *median* + sale *count* + a synthetic ±20% bar (`buildExpV2Comparables`, app.js:4789 fabricates the range when `streetRange` is absent). No actual comparable addresses, dates, or prices. ARCHITECTURE.md's flag holds. → **PR E**
3. **Image coverage 60–80%** — confirmed in UI: cards render a "▢ NO CATALOGUE IMAGE · ADDRESS ONLY" stripe (app.js:3384). A meaningful share of lots are photo-less.
4. **No refurb/flip profit signal on the card** — the deal-stack calculator is buried in the expanded panel and premium-gated; flip margin (GDV − price − works − costs) never surfaces at grid level despite "flip" being an onboarding strategy. → **PR E**
5. **No rent-comparable transparency** — `estGrossYield` appears as a single number; the user can't see the assumed monthly rent or its source on the card (`_rentEstimated` flag exists but only shows in the panel).
6. **No "price changed" / guide-revision signal** on the card despite `lot_history` tracking it server-side.

**Top 3 changes to most improve investor decision-making**

1. **Render `scoreBreakdown` in the detail panel.** The data and a drawing component already exist — rewire `buildExpV2Scores` (or revive `toggleScorePopup` against the live `lcv2-score-badge`) so every lot shows its signal-by-signal points and category rank. Turns an opaque number into a trusted one. *(Resolved — A1.)*
2. **Surface real comparables, not a synthetic bar.** Show 3–5 actual Land Registry sales (address, date, price) in `buildExpV2Comparables`; stop fabricating `streetRange` from ±20%. This is the below-market claim's evidence base. → **PR E**
3. **Put a flip/profit number on the card.** Compute a rule-based margin (GDV − guide − suggested works − costs, logic already in `suggestWorksAndGdv`, app.js:3594) and show it as a 4th stat or tag so refurb investors can triage from the grid instead of opening every lot. → **PR E**

---

### 2. Firecrawl credit-economy audit (`firecrawl-auditor`)

**Credit cost model** (from `lib/resource-budget.js`) — internal accounting weights, not Firecrawl invoices:

- Basic scrape (`rawHtml`/`markdown`): **1 credit**
- JSON-extract scrape (`computeScrapeWeight`, `FIRECRAWL_JSON_EXTRACT_MULT`): **5 credits**
- `changeTracking` "same" short-circuit: billed as **1 credit** (the whole point)
- Each action/wait: **+1 credit** each
- FIRE-1 agent call (`FIRECRAWL_FIRE1_CREDIT_MULT`): **5 credits**
- Monthly cap: **95,000** (`FIRECRAWL_MONTHLY_BUDGET`); daily cap **8,000**

Every catalogue scrape requests `[{json,schema}, 'markdown']` (+`changeTracking` when enabled) — `firecrawl-extract.js:120-122`. So a single-page catalogue costs **~5 credits**; a changed page is 5, an unchanged one 1.

**Ranked credit sinks (estimated, ~173 houses)**

| # | Source | Credits/cycle | Frequency | Est. monthly |
|---|---|---|---|---|
| 1 | **Tier-1 full pass** `autoAnalyseAll` — JSON extract every eligible house; paginated houses multiply (Pattinson `maxPages:84` × 5 = ~420, Allsop is free API) | ~173 houses, mix of `same`(1) / `changed`(5) + paginated multipliers → **~3,000–6,000** | nightly 03:00 | **~90,000–180,000** |
| 2 | **Homepage watch** Tier 12 — `extractHomepage` = JSON+markdown+changeTracking for **all 173 houses** every day | 173 × (5 changed / 1 same) ≈ **~600–900** | daily 03:30 | **~18,000–27,000** |
| 3 | **First-contact image backfill** `enrich-stage.js:227` → `backfillImagesWithFirecrawl` — rendered scrape with 4 actions ≈ **5 credits/call**, only `PUPPETEER_IMAGE_HOUSES`, once per catalogue | ~1 call/affected house/cycle | nightly | **~1,500–4,000** |
| 4 | **Multi-image sweep** Tier 7 — 200 lot-page fetches/day, ~30–60% fall back to Firecrawl (1 credit each, plain detail fetch) | ~60–120 | daily 06:00 | **~2,000–3,600** |
| 5 | **`probe.js`** pre-scrape HTML hash — `scrapeWithFirecrawl(rawHtml)` = **1 credit**, only when a cache row exists | ~1/house with cache | nightly | **~3,000–5,000** |
| 6 | **Self-healing** `healBrokenHouse` — homepage scrape(s) + up to 3 FIRE-1 agent calls (5 ea) + verify; **~15–30 credits/attempt** | per 0-lot house; heal-sweep + boot + homepage-watch all trigger it | event-driven | **~2,000–8,000** (spiky) |
| 7 | **Auction-watcher** Tier 2 — FIRE-1 fallback (5cr) for Cat-B houses missing a dated entry | per Cat-B miss | nightly | **~500–2,000** |
| 8 | **Status drift** Tier 3 — 1 house/hr × 10 lots, mostly plain HTTP | low | hourly 09–18 | **~1,000–2,000** |
| 9 | **Post-auction / same-day sweeps** — mostly plain HTTP, Firecrawl only on fallback | low | daily | **~1,000–2,000** |
| 10 | **On-demand `/api/analyse`** — `forceExtract:true`, bypasses changeTracking entirely (5cr/page) | per user request | user-driven | variable |

**Plausible steady-state total: ~120,000–230,000 credits/month against a 95k cap.** The plan is structurally over budget; the daily 8k cap is the only thing preventing a single-night blowout, and tripping it silently drops houses to Puppeteer/HTTP.

**The single biggest waste**

The Tier-1 full pass re-runs a 5-credit JSON extract on every house every night, and the adaptive cadence barely throttles it. Two compounding faults:

1. **`changeTracking` is disabled on the most expensive houses.** `HOUSE_OVERRIDES` in `analysis.js:599,651` sets `changeTracking:false` for **Pattinson** (`maxPages:84`) and **Maggs**. Pattinson alone is ~84 pages × 5 credits = **~420 credits, every single night, unconditionally** — roughly 12,600/month from one house that cannot short-circuit. *(Resolved in PR #46 via the page-1 hash gate.)*
2. **Adaptive scheduling can't save unchanged houses that lack changeTracking.** `scheduling.js` only lengthens the interval when Firecrawl returns `changeStatus:'same'`. Pattinson/Maggs never return `'same'` (tracking off → always `'changed'`), so they're pinned at the 6h floor forever. Houses *with* changeTracking still pay 5 credits on the first `changed` and 1 thereafter, but the freshness floor forces a full 5-credit extract weekly regardless. → **PR B**

**Are `changeTracking` and `probe.js` used to full effect? No.**

- **`changeTracking`:** Correctly wired into `extractCatalogueListing` (page-1 short-circuit, `firecrawl-extract.js:797,844`) and `extractHomepage`. **Gap:** turned OFF for Pattinson and Maggs — the two highest-volume houses — so the biggest catalogues get zero benefit. Also OFF on every on-demand `/api/analyse` and `/api/admin/rescrape` call (`forceExtract:true`), which is defensible for user-initiated requests but means no protection there. *(Pattinson resolved via hash gate.)*
- **`probe.js`:** **Effectively dead code on the main path.** It's only reached at `analysis.js:1059` *after* the Firecrawl JSON-extract block — and that block `return`s on success, on `skipped`, on 0-lots-with-agent, and on most errors. probe.js runs only in the rare legacy-fallback tail. It is *not* "wired in before every scrape" — `changeTracking` superseded it. Worse, when it does run it spends a credit (`scrapeWithFirecrawl` rawHtml) doing the same job changeTracking does server-side for 1 credit anyway. It is redundant, not additive. *(Resolved in PR #46.)*

**Ranked reduction levers**

| Lever | Change | Est. saving | Effort | Status |
|---|---|---|---|---|
| 1. Re-enable changeTracking on Pattinson/Maggs (via page-1 hash gate) | `analysis.js:HOUSE_OVERRIDES` | 15–25% | S | ✅ PR #46 |
| 2. Stop re-paginating unchanged paginated houses | `firecrawl-extract.js:extractCatalogueListing` | 10–20% | S | ✅ PR #46 |
| 3. Make homepage-watch cheaper / less frequent (every 2–3 days) | `server.js` Tier 12 + `homepage-watch.js` | 10–15% | S | ✅ PR #46 |
| 4. Widen adaptive backoff + tie cadence to auction proximity | `scheduling.js` | 15–25% | M | ⏳ PR B |
| 5. Delete the `probe.js` Firecrawl branch | `probe.js:52-56` | 3–5% | S | ✅ PR #46 |
| 6. Gate first-contact image backfill (skip when ≥80% have images) | `enrich-stage.js:227` | 2–4% | S | ⏳ PR B-stretch |
| 7. Lower multi-image-sweep batch + lengthen cooldown | `multi-image-sweep.js` | 1–2% | S | ⏳ PR B-stretch |
| 8. Set `FIRECRAWL_MONTHLY_BUDGET` honestly + alert earlier | env / `resource-budget.js` | enables all above | S | ⏳ PR B-stretch |

**Highest-leverage combination (levers 1+2+3+5):** plausibly **35–50%** reduction with negligible risk to freshness — landed in PR #46. Lever 4 (adaptive backoff tied to auction proximity) is the strategically correct fix and directly serves the "updated regularly" goal by spending credits where auctions are imminent.

> Caveat: the credit weights (`JSON_EXTRACT_MULT=5`, `FIRE1_MULT=5`, action cost) are explicitly self-described as unverified estimates (`resource-budget.js:36`). The *ranking* above is robust, but exact monthly figures should be reconciled against an actual Firecrawl invoice before sizing the cap.

---

### 3. Monolith audit (`monolith-auditor`)

**Files over 500 lines (largest first)**

| File | Lines | Responsibilities | Verdict |
|---|---|---|---|
| `public/app.js` | 6,019 | Entire frontend: filters, favourites, auth, billing, onboarding, search, card render, expanded panel, deal-stack calculator, SDLT calc, curator widget, scenarios, finance | **DECOMPOSE** — PR D |
| `admin.html` | 2,754 | Admin dashboard markup + inline CSS + inline JS | SPLIT-WHEN-URGENT |
| `lib/enrichment.js` | 2,053 | Land Registry, EPC, flood, rent estimation, postcode geocode, `enrichLots` orchestrator (684 lines alone) | **DECOMPOSE** — PR C |
| `routes/admin.js` | 1,772 | 48 route handlers + Umami + `/api/admin/intel` (~390-line handler) + `_patternIntel` | **DECOMPOSE** — PR C |
| `routes/search.js` | 1,716 | `/api/smart-search` (one ~610-line handler), `parseSmartSearchQuery`, `buildAllLotsResponse` (~540 lines), comps | SPLIT-WHEN-URGENT |
| `lib/houses.js` | 1,473 | Mostly large config literals (`HOUSE_ROOTS`, `HOUSE_DISPLAY_NAMES`, `AUCTION_DISCOVERY`) + small fns | FINE (cohesive registry) |
| `lib/analysis.js` | 1,280 | Wave orchestration, `_doAutoAnalyseAll` (~290 lines), `autoAnalyseOne` (~680 lines) | SPLIT-WHEN-URGENT |
| `lib/pipeline/firecrawl-extract.js` | 1,139 | Firecrawl JSON extraction — one clear responsibility | FINE |
| `bridgematch-lite.html` | 1,163 | Self-contained bridging calculator (CLAUDE.md: do not touch) | FINE (frozen) |
| `lib/calendar.js` | 889 | 738-line `FALLBACK_CALENDAR` literal + 3 small fns | FINE (cohesive) |
| `server.js` | 850 | Express wiring + scheduler | SPLIT-WHEN-URGENT |
| `lib/harness/manager.js` | 652 | One AI-manager cycle; `runManagerCycle` ~400 lines | FINE (cohesive, lower than feared) |

`index.html` (585) is fine. `lib/houses.js`, `lib/calendar.js`, `firecrawl-extract.js` are large-but-cohesive (config blobs or one job) — line count alone overstates pain.

**Top 3 DECOMPOSE targets**

1. **`public/app.js` (6,019)** — best ROI. Six unrelated clusters tangled in one global-scope file:
   - **`public/app-finance.js`** — SDLT/deal-stack/affordability: `calcSDLT` (3482), `detectCountry` (3565), `calcDealStack` (3802), `runDealStack`/`renderDealStackResults` (3927–4161), `calcAffordability` (1145), `_parseLTV`/`_parseRate`/etc. (1134–1145). ~700 lines, pure functions, easiest to lift.
   - **`public/app-card.js`** — card + expanded panel render: `card` (3288), `renderLots` (2628), `expandCard` (4906–5241), all `buildExpV2*` (4553–4905), image helpers (4220–4475). ~2,000 lines.
   - **`public/app-auth.js`** — auth/billing/paywall: `initAuth`→`signOut` (1348–1639), `showPaywall`/`startCheckout`/`openBillingPortal` (1817–1894), session expiry (1659–1771). ~600 lines.
   - **`public/app-scenarios.js`** — saved scenarios + curator widget (3615–3760, 5495–5683). ~350 lines.
   - Keep filters/search/favourites in `app.js` core. → **PR D**

2. **`lib/enrichment.js` (2,053)** — already four data-source families with no cross-coupling:
   - **`lib/enrichment/land-registry.js`** — `queryLandRegistry` (101–234)
   - **`lib/enrichment/epc.js`** — `fetchEPCByPostcode`, `fetchEPCRecommendations`, `matchEPCToLot`, `parseEpcIndicativeCost` (840–1310)
   - **`lib/enrichment/flood.js`** — `fetchFloodZone` (1050–1190)
   - **`lib/enrichment/rent.js`** — `estimateMonthlyRent*`, `isHmoLot` (235–467)
   - `enrichLots` (1311–1995) stays as the thin orchestrator importing the four. Each block is already fenced by `// ──` comment headers — a near-mechanical split. → **PR C**

3. **`routes/admin.js` (1,772)** — 48 handlers spanning unrelated domains. Split by concern, keeping `routes/admin.js` as an aggregator:
   - **`routes/admin/intel.js`** — `/api/admin/intel` + `_patternIntel` + Umami fetchers (1024–1591). ~570 lines, the single worst chunk.
   - **`routes/admin/pipeline.js`** — rescrape, analyse-all/new, run-watcher, re-enrich, enrich-waves, seed-snapshot.
   - **`routes/admin/observability.js`** — system-health, quality-report, cost-monitor, ai-costs, alerts, recall, snapshots.
   - **`routes/admin/static-pages.js`** — `/welcome`, `/privacy`, `/terms`, `/robots.txt`, `/sitemap.xml`, `/check`. → **PR C**

**Dead / duplicated / stale code**

- **`docs/ARCHITECTURE.md` is significantly stale** (last verified 2026-05-02). Lines 66-129, 168, 261-266 describe the deleted `lib/extractors/` tree (`houses/`, `platforms/`, `detail/`, `extractor-generator.js`), `extractWithJSDOM`, and `audit.mjs` as live. Line 14 claims `server.js` is 428 lines — actually 850. Needs a rewrite. → **PR C**
- **`dbRowToLot` vs `dbRowToFrontendLot` drift** (`lib/pipeline/lot-mappers.js`): two near-identical mappers. *(Resolved — `refactor/canonical-lot-contract` landed `lib/types/lot.js` (`1a73fe1`), legacy mappers deleted.)*
- **Stale extractor references are all in tooling, not production code**: `.claude/hooks/pivot-warn.js:34` lists `lib/extractors/` in a warning string; `.claude/skills/auction-conventions/references/new-house-playbook.md` correctly marks it deleted; the `.claude/worktrees/agent-a4583740/` copy and `.planning/` plans still treat extractors/`BROKEN_EXTRACTORS` as live. No `lib/`, `routes/`, or `server.js` file references the deleted modules — production is clean. Worth pruning the stale worktree and fixing the `pivot-warn.js` hook string. → **PR F**
- `LOTS_SELECT` comment in `lot-mappers.js` notes `images` was "held out historically" — now included; comment is now just history, harmless.

No dead functions found in app.js — `runAnalysis`, `runSmartSearch`, `loadCalendar` are all still wired (`index.html:481`, `app.js:1043–1052`).

**ROI ranking:** (1) `app.js` split — highest pain (every frontend change risks the 6k-line file), moderate effort since clusters are clean. (2) `enrichment.js` — comment-fenced blocks make it near-mechanical, high clarity gain. (3) `routes/admin.js` — pure handler-moving, low risk, removes the worst single chunk (`intel`). `routes/search.js`, `analysis.js`, `server.js`, `admin.html` are SPLIT-WHEN-URGENT — large but each has a coherent core; defer until they next need real change.

---

### 4. Firecrawl savings — second pass / deep-dive (`firecrawl-savings-2`)

**Highest-value finding**

**Paginated catalogues never early-stop on empty pages.** `extractCatalogueListing` builds the *full* `pageUrls` array up front (`firecrawl-extract.js:789-791`) and scrapes every URL concurrently (`:816-837`). There is no "page returned 0 lots → stop" logic. Pattinson is `maxPages:84` (`analysis.js:594`) — **all 84 pages are fetched every night even if real content ends at page 30**. Every other paginated non-Allsop house (countrywide, suttonkersh, pugh, savills, sdl) hits `extractPaginatedCatalogue`'s default `maxPages:25` (`firecrawl-extract.js:974`). Each catalogue page is a JSON-extract scrape = **5 credits** (`resource-budget.js:37,253`). Pattinson alone = 84 × 5 = **420 credits/night ≈ 12,600/month**; if it truly fills ~30 pages, ~54 wasted pages = **~8,000 credits/month wasted**. Across the other ~5 paginated houses, similar over-fetch likely adds **~2,000–4,000/month**. *(Resolved in PR #46.)*

**Ranked savings table**

| Candidate saving | Est. credits saved/mo | File:line | Effort | Status |
|---|---|---|---|---|
| Early-stop pagination when a page yields 0 lots (consecutive-empty cutoff) | ~8,000–12,000 | `firecrawl-extract.js:789-791, 814-848` | M | ✅ PR #46 |
| Scheduler duplication: `ROLE` unset on Railway → schedulers run on every instance | Up to **2× all spend** if >1 instance | `server.js:824-825`; `Dockerfile:54` | S | ✅ Verified — 1 replica only |
| Healing: no lifetime cap — dead house heals forever on 7d ceiling | ~150–600 | `healing.js:132-134` | S | ✅ PR #46 |
| Homepage-watch still 150 houses/other-day on a sunk ~5-credit FIRE-1+merger ladder per drifted house | variable | `server.js:616`, `healing.js:399-431` | M | 🟡 PR #46 reduced cadence; FIRE-1 ladder cost not yet capped |
| `'markdown'` format on every catalogue scrape, unused for ~half of houses | unknown | `firecrawl.js:120` | S | ⏳ verify billing first |
| Multi-image sweep — genuine coverage work, already well-capped | minimal | `multi-image-sweep.js:34-37` | — | — |

**Per-area facts**

**1. Scheduler duplication (confirmed risk, not theoretical).** `RUN_SCHEDULERS = ROLE !== 'web'` (`server.js:825`). The `Dockerfile` sets **no `ROLE`** (`:54` `CMD ["node","server.js"]`), and there is **no `railway.json`/`railway.toml`/`Procfile`** in the repo. So `ROLE` is unset unless configured in the Railway dashboard. With unset `ROLE`, **every** Railway instance runs `bootDecision` + `scheduleTick` + cache-warm. The in-code `TODO(scheduler)` at `server.js:821-823` explicitly admits there is no `pg_advisory_lock` guard. **If Railway is running >1 replica, the 03:00 full pass, homepage-watch, and every sweep run on each instance — doubling all Firecrawl spend.** *(Verified 2026-05-23 — Railway runs exactly one replica; N/A.)*

**2. Image backfill.** No pure waste found. `backfillImagesWithFirecrawl` only runs if `stillNoImg > 0 && PUPPETEER_IMAGE_HOUSES.has(house)` (`enrich-stage.js:227-229`) — skipped entirely when all lots already have images.

**3. Detail-page fetching.** `fetchLotPage` (`lot-detail.js:75-113`) checks the 30-day `lot_details` cache **first** (`:76-80`), then tries **plain HTTP** (`:86`, free), and only calls Firecrawl (`scrapeWithFirecrawl`, `rawHtml`, base **1 credit**) if HTTP fails *and* budget allows.

**4. Self-healing waste — real gap.** Per heal: homepage scrape (`_scrapeHomepage` Firecrawl, `:402`) + optional root scrape (`:424`) + up to 3 FIRE-1 agent calls (URL-find, merger, search-rank) at **5 credits each** + `_verifyNewUrl` Firecrawl + Firecrawl `/v1/search` (`healing.js:517`). **~15-30 credits per failed attempt.** The cooldown ladder caps at **7d** (`healing.js:134`) but **`healing_attempts` only resets on success** (`:292`) — there is **no lifetime attempt cap**. *(Resolved in PR #46.)*

**5. Pagination over-caps.** See highest-value finding above. *(Resolved in PR #46.)*

**6. Other call sites.** Auction-watcher Tier-2 FIRE-1 fallback fires per-slug only when cheaper tiers find nothing (`auction-watcher.js:209-211, 290`) — 5 credits/call, low volume.

**7. The `markdown` payload.** `extractCatalogue` always requests `[{json,schema}, 'markdown']` (`firecrawl.js:120`). For houses with no `recogniseFromMarkdown` and no recall sentinel, the markdown is fetched and discarded. **Honest caveat:** whether adding `'markdown'` to a request that already does `json` extraction costs extra Firecrawl credits is a billing question not answerable from this code. Internally `computeScrapeWeight` charges a flat `jsonExtractCreditMult` (5) regardless of markdown, implying the team believes it's free. Do not assume savings here without checking the Firecrawl dashboard.

**Recommended priority**

1. Verify Railway replica count + `ROLE` env ✅ done — 1 replica
2. Add consecutive-empty-page early-stop ✅ done — PR #46
3. Add a lifetime heal-attempt cap ✅ done — PR #46

---

### 5. Firecrawl savings — third pass (`firecrawl-savings-3`)

**Ranked candidates**

| # | Candidate | Est. credits/mo saved | file:line | Effort | UI impact |
|---|---|---|---|---|---|
| 1 | `/api/analyse` always forces a full JSON extract on cache miss | ~300–1,500 | `routes/analyse.js:204-208` | M | marginal |
| 2 | Nightly pass scrapes auctions up to 7 days *past* their date | ~1,000–3,000 | `lib/calendar.js:792-803` | S | none |
| 3 | No `requires_firecrawl` / chronic-failer skip | ~500–2,000 | `house_skills` schema + `resource-budget.js:19-21` | M | none |
| 4 | Retry-loop billing | NON-ISSUE | `firecrawl.js:161-174` | — | — |
| 5a | Status-drift `skipCache:true` detail fetches | ~150–600 | `sub-agents.js:230` | S | marginal |
| 5b | `extractCatalogueWithBackfill` alias / agent-mode | NON-ISSUE | — | — | — |

**Detail**

**1. `/api/analyse` force-extract.** The legacy `cached_analyses` 7-day cache **IS consulted first** (`analyse.js:80-85`) and a hit serves from the `lots` table with zero Firecrawl. The endpoint is rate-limited (`RATE_LIMIT_PER_DAY` = 5 with Stripe, 50 without; `config.js:23`). **But** on a cache *miss*, `extractCatalogueListing` is called with `forceExtract:true` (`analyse.js:207`), which bypasses the `changeTracking` short-circuit. → **PR B**

**2. Houses with no upcoming auction — REAL WASTE.** `getCalendarAuctions` (`lib/calendar.js:790-803`) filters `catalogue_ready=true` AND (`date >= today-7days` OR `status='always_on'`). It does **not** scrape all of `HOUSE_ROOTS` — good. **But the 7-day lookback means every auction whose date passed 1–7 days ago is still fully re-scraped each night** (comment line 792: "for past failed scrape auditing"). Tier 6 post-auction-sweep already handles post-auction status separately and cheaply. Re-running a full catalogue extract on a finished auction for 7 nights is wasted 5×-weighted spend. Tightening the lookback to ~1 day (or 0) for the *full extract* path would cut this. → **PR B**

**3. Chronic Firecrawl failers.** `FIRECRAWL_SKIP_HOUSES` env var **exists** (`resource-budget.js:19-21`, `isSkipped()`) but is a manual allowlist — nothing auto-populates it. `house_skills` has `requires_firecrawl` and `requires_puppeteer` boolean columns (`schema.sql:82-83`) but **`requires_firecrawl` is never read to *skip* the Firecrawl attempt** — every house tries Firecrawl first regardless. A house that fails Firecrawl nightly burns the failed call + exponential-backoff retries (`firecrawl.js:161`, BACKOFF up to 5 attempts) before falling to Puppeteer/HTTP. Identify them via `house_skills.requires_puppeteer=true` or low `health_score` / `consecutive_failures`. A "if `requires_puppeteer` then skip Firecrawl" gate would eliminate the wasted attempts. → **PR B**

**4. Retry-loop billing — NON-ISSUE.** `recordFcRequest` (`resource-budget.js:154`) is only called inside `doFetch` **after** a successful `resp.json()`. A failed attempt calls `recordFcError` (no credit booked). Retries that ultimately fail book zero internal credits; a retry that succeeds books exactly one weighted request. No multi-credit exposure in internal accounting.

**5. Other call sites.**
- **Status-drift (Tier 3):** `auditStatusDrift` samples 10 lots with `fetchLotPage(skipCache:true)`. `fetchLotPage` tries plain HTTP first and only hits Firecrawl on failure — mostly free, but `skipCache:true` defeats the detail-page cache for ~90 fetches/day; the Firecrawl-fallback fraction is small spend. Minor.
- **`extractCatalogueWithBackfill`** is just an alias for `extractCatalogueListing` — no separate cost.
- **Agent mode (FIRE-1, 5× multiplier)** is gated to `acuitus` + `foxandsons` only — not waste.

**Biggest genuinely-new win: candidate 2** (drop the 7-day past-auction lookback from the full-extract path). Then candidate 3 (skip Firecrawl for `requires_puppeteer` houses). Candidate 1 is real but capped by the rate limit.

---

## Original code-review-swarm artefacts

- **Session:** `07b0d868-0f64-475b-8fde-15b3ccb10021` (transcript at `~/.claude/projects/C--Users-User-Documents-GitHub-Auction/07b0d868-...jsonl`)
- **Subagents:** 5 — `ux-auditor`, `firecrawl-auditor`, `firecrawl-savings-2`, `firecrawl-savings-3`, `monolith-auditor`
- **Subagent jsonls:** `07b0d868-.../subagents/agent-a*.jsonl` (5 files, ~1.7MB total)
- **Trigger command:** `/github:code-review-swarm I want a full assessment and update of the current state of play on the Auction Brain tool. Identify any potentially unworkable monolithic chunks of code which could be decom…`
- **Branch under review:** `feat/telegram-verified-url`

The verbatim final messages from each subagent are preserved at:
`~/.claude/projects/.../99b68289-.../tool-results/bc2qev2ym.txt` (255 lines, 36KB).
