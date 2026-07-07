# Extraction model swap — cost-cut runbook

**Goal:** cut the OpenRouter extraction bill by replacing the expensive "capable" tier
model (Google Gemini 2.5 Pro) with a much cheaper long-context model, without
regressing recall or field completeness.

**Status:** PREP ONLY. The pricing table + cost-logging fix ship in this change;
the actual model flip is an env-var change applied **after** validation. Subscription-
vs-pay-per-use comparison pending (see bottom).

## Why

Per `ai_usage` (2026-07-07): extraction is ~74% of the AuctionBrain AI bill, and
within extraction the **capable tier alone (Gemini 2.5 Pro) is ~74% of the cost** —
360 calls / $22.47 over a mostly-idle 30-day window. The fast tier (Flash-Lite) is
already cheap. Extraction is templated JSON parsing over Crawlee-rendered markdown
(`lib/scraper/extraction.js` `extractLotsWithAI`), not reasoning — the capable tier
exists for **recall on long/dense pages** (EWMA<0.70 promotion in
`lib/scraper/extraction-tier.js`), i.e. it needs context window + reliable JSON, not
a premium reasoning model.

## Recommended chains (verified against the live OpenRouter models API 2026-07-07)

| Env var | Value | Note |
|---|---|---|
| `OPENROUTER_CAPABLE_MODEL` | `deepseek/deepseek-v4-flash,google/gemini-3.1-flash-lite` | primary $0.09/$0.18 per Mtok, 1M ctx; Gemini 3.1 Flash-Lite fallback |
| `OPENROUTER_FAST_MODEL` | keep current if it still resolves; else `deepseek/deepseek-v4-flash,google/gemini-3.1-flash-lite` | see slug-drift note |

**Slug drift:** `google/gemini-2.5-flash`, `-flash-lite`, and `-pro` no longer appear
in the OpenRouter catalog (superseded by Gemini 3.x). Current cheap Google slugs:
`google/gemini-3.1-flash-lite` ($0.25/$1.50, 1M ctx) and `google/gemini-3.5-flash`
($1.50/$9.00). Before flipping, confirm the *actually billed* slug in `ai_usage` —
if the fast tier is still pinned to a dead 2.5 slug it has been silently rolling to
the free-Llama fallback.

## Projected impact

Full active month (~9,000 calls, ~5:1 fast:capable): **~$122/mo → ~$29/mo (~76% off)**.
The saving is almost entirely the capable-tier swap (Gemini 2.5 Pro ~$95/mo →
deepseek-v4-flash ~$3/mo). Fast tier is already cheap.

## Prerequisite (blocking — Simon)

`scripts/test-extraction-model-ab.mjs` and the pipeline both call OpenRouter for
real. The **AuctionBrain Prod** key ("$30/MONTH" cap) is exhausted — raise it
(~$200) before benchmarking, or every call errors. Cannot be self-served (no
OpenRouter MCP).

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
(`isLotGrounded`) rejects *fabrication*, not *omission* — so the huge-page recall
check is mandatory.

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

## Open

- Subscription vs pay-per-use: whether a flat-rate plan (GLM / MiniMax / Qwen / Kimi)
  beats deepseek-v4-flash pay-per-use — gated on the ≥256k-context requirement for
  the huge pages and on the automated-batch ToS of coding-subscription plans.
- Separate lever: image classification is ~52k calls/month with **no caching** — a
  classify-once cache would gut the highest call volume (the `image_classifications`
  table does not currently exist in prod).
