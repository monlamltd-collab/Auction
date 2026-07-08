# Extraction model swap — cost-cut runbook

**Goal:** cut the OpenRouter extraction bill by replacing the expensive "capable" tier
model (Google Gemini 2.5 Pro) with a much cheaper long-context model, without
regressing recall or field completeness.

**Status:** DECIDED (2026-07-08) — **`deepseek/deepseek-v4-flash` is the primary
extraction model for BOTH tiers**, with a Google Gemini in-request fallback. This
PR ships the cost-logging plumbing (pricing table + date-suffix fix). The model
flip is a hot env-var change (values below) — apply when ready. The variance risk
that once argued for Gemini is now caught by the **recall gate** (`recall_below_100`
alerts) and the **dense-page chunking fix**, both shipped in PR #177.

## Why

Per `ai_usage` (2026-07-07): extraction is ~74% of the AuctionBrain AI bill, and
within extraction the **capable tier alone (Gemini 2.5 Pro) is ~74% of the cost** —
360 calls / $22.47 over a mostly-idle 30-day window. The fast tier (Flash-Lite) is
already cheap. Extraction is templated JSON parsing over Crawlee-rendered markdown
(`lib/scraper/extraction.js` `extractLotsWithAI`), not reasoning — the capable tier
exists for **recall on long/dense pages** (EWMA<0.70 promotion in
`lib/scraper/extraction-tier.js`), i.e. it needs context window + reliable JSON, not
a premium reasoning model.

## Recommended chains (all slugs verified live via a direct OpenRouter API call 2026-07-08)

| Env var | Current | Set to | Why |
|---|---|---|---|
| `OPENROUTER_CAPABLE_MODEL` | *(unset → code default `google/gemini-2.5-pro`)* | `deepseek/deepseek-v4-flash,google/gemini-2.5-flash` | ~34× cheaper/call than Gemini 2.5 Pro; **won on dense houses** in testing |
| `OPENROUTER_FAST_MODEL` | `deepseek/deepseek-v4-pro` | `deepseek/deepseek-v4-flash,google/gemini-2.5-flash` | see **Fast-tier move** below — 5× cheaper than the -pro sibling, matched/beat it |

deepseek-v4-flash `$0.09/$0.18` per Mtok, 1M ctx, text-only. Gemini 2.5 Flash is the
in-request fallback (fires only on a hard deepseek error, so its cost stays ~zero).

**Slug facts (corrected):** an earlier catalog check *falsely* reported the
`google/gemini-2.5-*` slugs as retired. A direct `/chat/completions` probe confirms
`gemini-2.5-pro`, `-flash`, and `-flash-lite` **all resolve** — the WebFetch summary
had just omitted them. OpenRouter returns **date-suffixed served slugs** (e.g.
`deepseek/deepseek-v4-flash-20260423`); the `estimateCost` fix in this PR strips the
suffix so cost still logs (otherwise every deepseek call reads $0).

## Fast-tier move (spec) — `deepseek-v4-pro` → `deepseek-v4-flash`

The fast tier currently runs `deepseek/deepseek-v4-pro` (`$0.435/$0.87` per Mtok).
`deepseek-v4-flash` (`$0.09/$0.18`) is the **same V4 family, ~5× cheaper**, and in the
A/B harness it **matched or beat** the stronger models on the fast-tier houses it was
tested against (e.g. bondwolfe 133 lots with chunking vs Gemini 2.5 Pro's 88;
astleys parity). Known houses are the easy path — there is no recall case for paying
5× for `-pro` on them. Chain: `deepseek/deepseek-v4-flash,google/gemini-2.5-flash`
(flash-lite → flash fallback for the rare error). Validate with the same harness +
gate as the capable tier before flipping; the recall gate backstops any regression.

## Projected impact

Full active month (~9,000 calls): **~$122/mo → ~$20–29/mo (~76–84% off)**. The bulk
is the capable swap (Gemini 2.5 Pro ~$95/mo → deepseek-v4-flash ~$3/mo); the fast-tier
move (`-pro` → `-flash`) trims the remainder (~$26/mo → ~$16/mo).

## Benchmark evidence (live harness, real extractor + Crawlee render, 2026-07-07/08)

| House (sentinel) | deepseek-v4-flash | Gemini 2.5 Pro | Gemini 3.1 Flash-Lite |
|---|---|---|---|
| astleys (27) | 8 | 8 | 8 |
| **bondwolfe (174), chunked** | **133** | 88 | — |
| cliveemson (170) | 49 (0 on one earlier run) | 48 | 89 |
| propertysolvers (123) | 35→59 chunked | — | 0 |

Reads: (1) the expensive **Gemini 2.5 Pro is the *worst* on dense houses** — the
capable tier was paying premium for a weaker result. (2) **Every model has occasional
0-lot runs** (deepseek on cliveemson once; flash-lite on propertysolvers/nesbits) —
so reliability is not a deepseek-only problem, and it's now handled by the recall
gate + fallback, not by model choice. (3) deepseek is cheapest and won the dense
cases. Net: deepseek-v4-flash primary + Gemini fallback + recall gate is the
cost-optimal, coverage-safe design. Full harness output in the session log.

## Prerequisite

`scripts/test-extraction-model-ab.mjs` and the pipeline both call OpenRouter for
real, so the **AuctionBrain Prod** key must have monthly headroom — cap raised to
$200 on 2026-07-07 (done). To run the harness locally: put `OPENROUTER_API_KEY` in
`Auction/.env` and set `PUPPETEER_EXECUTABLE_PATH` to the bundled Chromium
(`node -e "console.log(require('puppeteer').executablePath())"`) so Crawlee renders.

## Validation (before flipping the env var)

Run the A/B harness on three house profiles — an easy/known house, a weak-recall
house currently promoted to `capable`, and a **huge-page house** whose rendered
catalogue lands in the 200k–772k-token band (the single highest risk):

```
node scripts/test-extraction-model-ab.mjs <house> \
  --models deepseek/deepseek-v4-flash,google/gemini-3.1-flash-lite,google/gemini-2.5-pro
```

The harness ranks recall → completeness → cost. Then gate the decision on
`lib/pipeline/parity-gate.js` `evaluateParity` vs the Gemini-2.5-Pro incumbent — ALL
must pass:

- **strict recall parity** (zero lost lots),
- `batchQuality >= incumbent`,
- **no per-field regression** (image / price / tenure / beds / …).

Flip `OPENROUTER_CAPABLE_MODEL` only after the **huge-page** house passes. The one
real risk is silent lot-drop from long-context omission — grounding
(`isLotGrounded`) rejects *fabrication*, not *omission*.

**Backstops (PR #177) that make deepseek-first safe:** (a) the **dense-page chunking
fix** removes the 16k-output truncation that used to halve recall on big pages,
independent of model; (b) the **recall gate** fires a `recall_below_100` alert
(error/warning) the moment any house lands below sentinel parity — so a deepseek
under-recall is surfaced loudly and queryably (`pipeline_alerts WHERE
type='recall_below_100'`), not silent. Between the in-request Gemini fallback, the
gate, and the EWMA/`needs_recogniser` policy, a bad deepseek run degrades visibly
and reversibly rather than dropping lots unnoticed.

## Flip + rollback

The model chain is a hot env var (no deploy). Set `OPENROUTER_CAPABLE_MODEL` in
Railway; roll back instantly by clearing it (falls back to the code default) or
resetting the previous value. After the swap, watch:

- `modelFallbackCount` in `getAICostSummary` — high rollover to the Gemini fallback
  means the cheap primary is failing and eroding the saving;
- a spike in `needs_recogniser` alerts — the tell that deepseek-v4-flash is
  under-recalling on some houses (the EWMA policy self-corrects by keeping them on
  capable and, after 5 runs, flagging for a per-house recogniser).

## Out of scope (do NOT route to a text-only model)

- **PDF extraction** is pinned to direct Google Gemini (inline PDF isn't portable).
- **Image classification** must stay multimodal (`callVisionAI`).

## Subscription vs pay-per-use — settled: stay pay-per-use (2026-07-07)

Researched flat-rate/subscription plans (Z.ai GLM, MiniMax, Alibaba Qwen, Moonshot
Kimi, Chutes, Nebius). **None is usable for this workload** — each fails the
context bar, the automated-batch ToS bar, or both:

- **Context < 256k** → would silently truncate the 265k–772k-token outlier
  catalogues: GLM ~205k, MiniMax ~205k, Kimi ~262k (marginal), Chutes/Nebius
  DeepSeek 128–131k.
- **Automated-batch ToS forbidden** (verified on each provider's policy page): the
  GLM / MiniMax / Kimi "coding plans" restrict use to interactive IDE/agent tools
  and explicitly forbid automated backends / batch pipelines. **Alibaba Cloud Model
  Studio Coding Plan Pro** ($50/mo, 1M ctx) is the *only* flat plan that clears the
  context bar — but its ToS bans "automated scripts, application backends, or other
  non-interactive scenarios," i.e. exactly this pipeline.

The ToS-clean *metered* variants (GLM API, Qwen-Plus PAYGO) hold ≤256k context and
cost 4–7× the deepseek-v4-flash baseline. So `deepseek/deepseek-v4-flash` on
OpenRouter pay-per-use stays the recommendation: cheapest, 1M context, ToS-clean,
already integrated.

## Next cost lever (if ever needed) — NOT a provider switch

Input tokens dominate (extraction ~11–19k in vs ~5k out; image-classify 98M input
tokens/mo). The lever is **input reduction / prompt caching** on the existing
deepseek path — the extraction prompt+schema is a large fixed prefix that
prompt-caching could discount on repeat calls — not a new provider/failure domain.

## Related open lever

- Image classification is ~52k calls/month with **no caching** — a classify-once
  cache would gut the highest call volume (the `image_classifications` table does
  not currently exist in prod).
