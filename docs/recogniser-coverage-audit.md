# Recogniser + fleet coverage audit — 2026-07-08

Audit of every house's recall against its sentinel, in service of THE 100%
COMMANDMENT. Method: the production recall history (`pipeline_alerts` type
`recall_diagnostic` / `recall_below_100`, `meta.recall` vs `meta.sentinelLots`)
gives the real per-scrape recall for every actively-scraping house — no re-render
needed. `scripts/recogniser-coverage.mjs <house>` re-verifies any recogniser house
deterministically (render → recogniser → missed-id diff).

## Headline: the recognisers are healthy

**Every recogniser house and every AuctionHouse-platform franchise is at ~100%.**
bondwolfe 174/174, cliveemson 170/170, hollismorgan 60/60, btgeddisons 395/395,
auctionhouselondon 78/78, and the ~33 `auctionhouse.co.uk/{region}` sites all at
100% (auctionhousesouthyorkshire 1604/1608, northwest 508/509, wales 389/389, …).
The only recogniser house below parity is **markjenkinson 97% (76/78)** — 2 lots.

**The earlier "bondwolfe 79%" alarm was a measurement artifact:** it compared
*active-only* DB lots (137) against a sentinel that counts *all* rendered lots
(174, incl. 23 sold + 13 withdrawn). The recogniser captures all 174; the 37
"missing" are ended lots correctly excluded from the active view. Verified with
`scripts/recogniser-coverage.mjs bondwolfe` → 174/174, 0 missed.

## Real recall gaps (LLM-path houses, small)

These have a sentinel but no recogniser, so they run the Gemini/deepseek LLM path:

| House | Recall | Missing | Platform |
|---|---|---|---|
| **harmanhealy** | 24% (12/50) | 38 | EIG OAS (no recogniser) — but between-auctions since 07-02 |
| bradleyhall | 88% (22/25) | 3 | |
| agentsproperty | 89% (8/9) | 1 | |
| bradleysdevon | 91% (10/11) | 1 | |
| firstforauctions | 96% (48/50) | 2 | EIG OAS (no recogniser) |
| seelauctions | 96% (50/52) | 2 | |
| andrewcraig | 96% (23/24) | 1 | |
| markjenkinson | 97% (76/78) | 2 | recogniser |

The **generic fix** (per the minimise-per-house rule): an **EIG OAS platform
recogniser** — the `.lot-panel` / `/lot/details/{id}` structure is shared by
harmanhealy, firstforauctions, landwood, tcpa, mchughandco (which already has a
per-house `recogniseMcHughLotsFromMarkdown`). Generalise it and resolve it by the
EIG sentinel pattern in `resolvePlatformRecogniser`, fixing the whole EIG cohort at
once. The now-merged dense-page chunking fix (PR #177) also lifts these on the LLM
path where truncation was the cause.

## The bigger risk: ~25 houses gone dark since mid-June (BLIND SPOT)

Houses with lots 15–30 days ago but **zero in the last 14 days**, all last-seen
clustered 2026-06-13…06-19 — a systemic event, not one-off:

`purplebricksgoto` **1,124 lots**, edwardmellor 91, wilsons 70, connectuk 57,
philliparnold 48, higginsdrysdale 47, thepropertyauctionhouse 42, robinsonhall 36,
ahlondon 35, sarahmains 34, halls 32, howkinsandharrison 29, brownco 26, gth 21,
stags 20, allwalesauction 19, walkersingleton 18, rendells 15, johnfrancis 13,
sheldonbosley 12, henrysykes 11, lot9 11, astleys 10, pattinson 8, bramleys 7.

This is a **liveness/scheduling** issue, not a recogniser gap, and dwarfs the
recall-% gaps in lot volume. **Needs triage before treating as breakage** (the
dead-house rule: many infrequent auctioneers are legitimately between auctions;
verify against the source's current calendar, don't retire). purplebricksgoto
(1,124) is the priority to diagnose. pattinson is a recogniser house that also went
dark — worth checking its scheduler/circuit separately.

## Ranked next actions

1. **Triage the ~25 dark houses** — biggest coverage lever by far. Distinguish
   between-auctions (fine) from genuinely-broken (bug). Start with purplebricksgoto.
2. **EIG OAS platform recogniser** — generic fix for harmanhealy + firstforauctions
   + the EIG cohort; the many-birds fix.
3. **Small %-gaps** (bradleyhall, markjenkinson, …) — 1–3 lots each; per-house
   recogniser/regex tweaks, lower priority.

The recall gate (PR #177, now live) will keep all of these visible going forward:
`SELECT * FROM pipeline_alerts WHERE event_type='recall_below_100' AND NOT resolved`.
