# CLAUDE.md — Bridgematch Auction Tool

UK property auction directory + AI catalogue analyser. Live at [auctions.bridgematch.co.uk](https://auctions.bridgematch.co.uk).

**Owner:** Simon Deeming · **Repo:** `monlamltd-collab/Auction` · **Hosting:** Railway · **Stack:** Node.js (Express), Firecrawl (primary scraper), Google Gemini, vanilla JS frontend.

**Architecture map:** `docs/ARCHITECTURE.md` — file layout, data flow, tables, weakness audit. **Read that first** if you've just opened this codebase. For coding conventions, naming, file structure, testing, scoring rules, and "Adding a New Auction House", invoke the `auction-conventions` skill. This file is orientation only.

---

## How the Analyser Works

1. User submits a catalogue URL or selects a house.
2. **Firecrawl** renders the page when needed (Puppeteer fallback, plain HTTP last resort) — `lib/scraper/rendering.js:scrapeRenderedPage`.
3. Lot extraction is unified — every house goes through the same path:
   - **Firecrawl JSON extract** — primary, AI-driven, no per-house code (`lib/pipeline/firecrawl-extract.js:extractCatalogueListing`). Handles single-page and paginated catalogues. `changeTracking` short-circuits unchanged pages at ~1 credit.
   - **Markdown recogniser** — optional per-house function in `HOUSE_OVERRIDES` (currently Pattinson + John Pye) reads the same Firecrawl markdown response to recover lots the JSON extractor missed. This is recognition, not extraction — Firecrawl-at-the-heart by definition.
   - **Gemini fallback** — fires only when Firecrawl JSON returns 0 lots (Flash for known houses, Pro for unknown / PDF).
   - **Allsop JSON-API exception** — `lib/scraper/allsop.js` consumes Allsop's private JSON endpoint directly (zero credits, ~50ms/page). Not the DOM anti-pattern: it's a structured API consumer, not a layout scraper.
4. `analyseLot()` (`lib/pipeline/scoring.js`) scores each lot 0–10.
5. Results cached in `lots`; `lot_history` snapshots written when fields change.
6. Frontend (`public/app.js`) renders with filters.

> **DOM extractors retired 2026-05-08.** `lib/extractors/` was deleted along with `tests/snapshots/`, `tests/test-extractors.js`, `tests/test-detail-extractors.js`, and `scripts/audit*.mjs`. The `USE_FIRECRAWL_EXTRACT` env var, `FORCE_EXTRACT_HOUSES` safelist, `BROKEN_EXTRACTORS` set, and DOM→Gemini merge code are all gone. If you find references to any of these, they're stale — flag them.

### First-contact maximisation
On a brand-new lot URL, the pipeline forces a detail-page fetch + OS Places API lookup (UPRN, canonical address, lat/lng) and writes a `lot_history` snapshot. See `lib/pipeline/persist-lots.js`.

### Recall sentinels
Every house should have a recall pattern so the harness can measure scrape recall. EIG / AH UK / Bamboo platforms are auto-detected by `detectPlatformSentinel()` in `lib/analysis.js`. For non-platform houses, add a `RECALL_SENTINELS[slug]` regex — it's free (one line) and tightens recall measurement immediately.

---

## Scoring & Self-Healing

- **Source of truth for scoring signals & weights:** `lib/pipeline/scoring.js:analyseLot()` (lines 114–151). Score range **0–10**, always clamped (`Math.max(0, Math.min(10, ...))`).
- Self-healing harness lives in `lib/harness/`. When a house returns 0 lots, `healBrokenHouse()` searches for the new catalogue URL via Firecrawl + Gemini, with exponential cooldown (24h → 7d). Invoke the `auction-self-healing` skill for the full diagnose-fix-verify-report playbook.
- Circuit breakers (`house-health.js`): 3 consecutive failures → auto-skip with backoff.

---

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini API key |
| `FIRECRAWL_API_KEY` | Firecrawl API key (primary scraper) |
| `FIRECRAWL_MONTHLY_BUDGET` | Credit cap per month (override default in `lib/resource-budget.js`) |
| `FIRECRAWL_SKIP_HOUSES` | Comma-separated slugs to skip Firecrawl for |
| `OS_DATA_HUB_KEY` | OS Places API key (UPRN + canonical address, free 100k/mo) |
| `EPC_API_EMAIL` / `EPC_API_KEY` | EPC register API |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_KEY` | Supabase auth + server writes |
| `BRIDGEMATCH_API_URL` | BridgeMatch API base for fundability badge |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Self-healing report destination (optional) |
| `ROLE` | `web` (HTTP only), `worker` (HTTP + schedulers), unset (single-process default) |

---

## Non-Negotiables

- **Firecrawl primary, Puppeteer fallback, HTTP last** — never reverse the order
- **Score range 0–10**, always clamped
- **Silent failures banned** — every skipped/failed lookup records a reason in `lots.enrichment_manifest`
- **Manifest gating on yield + below-market** to prevent double-counting (`canScoreYield` / `canScoreBelowMarket`)
- **`lib/scoring.js` was deleted** — never reintroduce; use `lib/pipeline/scoring.js::analyseLot`
- **Harness alerts** use the single-object signature: `fireAlert({ type, severity, house, message, meta })`
- **Don't reintroduce the `server.js` monolith** — logic lives in `routes/`, `lib/`, `lib/pipeline/`, `lib/harness/`
- **Don't modify `bridgematch-lite.html`** based on bridging finance knowledge without explicit user confirmation — the logic is fragile and correct
- **Frontend edits** go in `public/app.js` / `public/styles.css`, NOT inline in `index.html` (the env-shim block is the only inline JS that should remain)

---

## Sister Project: Bridgematch (Bridging-Brain)

Bridging finance matching tool — Python FastAPI, ~50+ UK lender database. Repo: `monlamltd-collab/Bridging-Brain`. Integration is live via `lib/fundability.js` calling `${BRIDGEMATCH_API_URL}/api/filter` to add a fundability badge to each lot. See `BRIDGING_FINANCE_KNOWLEDGE_PACK.md` for domain knowledge — do not apply it to `bridgematch-lite.html` without explicit confirmation.

---

## Skills

- **`auction-conventions`** — invoke before any code edits. Architecture, naming, file structure, API patterns, scoring, manifest stamping, harness alert signature, "Adding a New Auction House".
- **`auction-self-healing`** — invoke when a house returns 0 lots, regresses, or you suspect breakage. Full diagnose-classify-fix-verify-report playbook.
