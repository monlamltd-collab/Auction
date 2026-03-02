# CLAUDE.md — Bridgematch Auction Tool

## Project Overview

Bridgematch is a UK property auction directory and AI-powered catalogue analyser, live at [bridgematch.co.uk](https://bridgematch.co.uk). It scrapes upcoming auction catalogues from UK auction houses, uses Claude AI to extract structured lot data, scores each lot for investment potential, and presents results in a filterable frontend.

**Owner:** Simon Deeming
**Repo:** `monlamltd-collab/Auction`
**Hosting:** Railway (Express server) — was originally Vercel but migrated
**Domain:** bridgematch.co.uk
**Stack:** Node.js (Express), Puppeteer, Anthropic Claude API, vanilla JS frontend

---

## Architecture

```
server.js (Express, ~131K)
├── GET  /api/auctions        → Returns upcoming auction dates (curated list)
├── POST /api/analyse          → Scrapes catalogue URL, Claude extracts lots, scores them
├── GET  /auctions             → Serves index.html (directory view)
├── GET  /analyse              → Serves index.html (analyser view)
└── GET  /                     → Serves index.html

script.js (~105K)
└── Frontend JS — handles UI, filtering, lot display, analysis triggers

index.html (~79K)
└── Single-page app with tab switching between /auctions and /analyse views
```

### Key Dependencies
- `@anthropic-ai/sdk` — Claude API for lot data extraction
- `puppeteer` — Headless Chrome for scraping JS-rendered auction sites
- `express` — HTTP server
- `@supabase/supabase-js` — Auth (for future features)

---

## How the Analyser Works

1. User pastes an auction catalogue URL or selects an auction house
2. Server fetches catalogue pages (direct HTTP or Puppeteer for JS-rendered sites)
3. Each page's HTML is stripped and sent to Claude (Sonnet) with extraction instructions
4. Claude returns structured lot data as JSON
5. Server runs the **scoring engine** on each lot
6. Results cached in memory/database per auction house
7. Frontend displays lots with filters (price, type, score, opportunities)

### Extraction Pipeline
- **Primary:** DOM extractors — custom per-house selectors that parse HTML directly
- **Fallback:** Claude API extraction — when DOM extractors return 0 lots, the stripped HTML is sent to Claude with structured extraction prompts
- **Critical gotcha:** The Claude model string must be `claude-sonnet-4-6` (NOT `claude-sonnet-4-6-20250514` with date suffix — this caused 404 errors on every API call)

### Puppeteer & Memory
- Puppeteer instances consume significant RAM on Railway
- A **skip list** exists for houses where Puppeteer is futile (blocked requests, empty pages, JS-only rendering that still fails)
- Memory optimisation: skip list prevents wasting resources on houses that will never return data via Puppeteer

---

## Scoring System

Each lot gets an investment score based on detected signals:

| Signal | Score |
|---|---|
| Needs modernisation | +2.0 |
| Poor/derelict condition | +2.5 |
| Executor/probate | +1.5 |
| Receivership/distressed | +2.0 |
| Development potential | +2.0 |
| Extension/HMO potential | +1.5 |
| Vacant (residential) | +1.0 |
| Freehold house | +0.5 |
| Low £/sqft (<£200) | +2.0 |
| Good yield (6-8% GIY) | +1.5 |
| High yield (>8% GIY) | +2.5 |
| Quick completion | +0.5 |
| Motivated seller | +0.5 |
| Title split potential | +1.0 |
| Sitting tenant | -2.0 |
| Knotweed | -2.0 |
| Flying freehold | -1.0 |
| Non-standard construction | -1.0 |
| Flood risk | -1.0 |
| Contamination | -1.0 |

Title split detection covers 7 pattern types. Budget filtering has separate limits for standard vs title split deals.

---

## Auction Houses

### Currently Working (~21 houses, ~2,364 lots)
The system successfully scrapes and analyses lots from 21 auction houses. Some houses that were previously failing were fixed by:
- **BidX1** (90 lots) — DOM extraction fix
- **Edward Mellor** (24 lots) — DOM extraction fix
- **Bradley Hall** — URL moved to `auction.bradleyhall.co.uk`
- **Landwood** — Uses different domain `landwoodpropertyauctions.com`

### Summary Statistics (displayed as green badges)
- Total lots
- Lots under £100k
- Average yield percentage
- Properties with development potential
- Vacant properties

These are computed from lot data fields: `price`, `estGrossYield`, `opportunities` array, `vacant` boolean.

### Problem Houses
- Some block scraping requests entirely
- Some use JS-only rendering that even Puppeteer can't handle
- Some have catalogue timing issues (no current catalogue available)
- These are on the skip list to save memory/time

---

## Frontend Design

- **Light theme** — clean, professional look (distinct from Bridging Brain's dark theme)
- **Mobile-first** responsive design
- Colour palette:
  - Backgrounds: `--bg-primary: #f5f7fa`, `--bg-secondary: #ffffff`, `--bg-card: #eef2f7`
  - Accent: `--accent: #2e7d32` (forest green), `--accent-match: #4a9e2f`, `--accent-hover: #1b5e20`
  - Status: `--accent-warn: #e67e22` (orange), `--accent-danger: #c0392b` (red), `--accent-info: #2e86c1` (blue)
  - Text: `--text: #1a2a3a` (dark navy), `--text-muted: #6b7c8d`
  - Navy header gradient: `linear-gradient(135deg, #1a3a5c, #2a5a8c)`
  - Brand colours: "Bridge" in white, "Match" in `#8bc34a` (light green)
- Fonts: `--font-main: 'Outfit'`, `--font-brand: 'Sora'`, `--font-mono: 'JetBrains Mono'`
- Use native HTML elements like `<details>/<summary>` for accordions — these are more reliable across browsers than JS-driven alternatives (learned the hard way)
- Avoid `overflow:hidden` on parent containers that need click events

---

## Known Issues & Gotchas

1. **Claude API model string** — Must be `claude-sonnet-4-6` without date suffix, or all extraction calls 404
2. **Puppeteer memory** — Railway has limited RAM; use skip lists for houses that won't work anyway
3. **DOM extractor failures** — When a house redesigns their site, the DOM extractor breaks and falls back to Claude API (which costs money per call)
4. **Pagination** — Each auction house has different pagination patterns; these are handled per-house in server.js
5. **vercel.json still present** — Legacy from when this was on Vercel; now on Railway with Express. The vercel.json is vestigial

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key for lot extraction |
| `PORT` | Server port (Railway sets this) |
| `SUPABASE_URL` | Supabase project URL (future auth) |
| `SUPABASE_ANON_KEY` | Supabase anon key (future auth) |

---

## TODO / Roadmap

- [ ] Redesign auction frontend
- [ ] Connect more auction houses
- [ ] Automated calendar scraping via cron
- [ ] Email alerts when new catalogues drop
- [ ] Blog/content section for SEO
- [ ] Land Registry comps integration
- [ ] EPC rating lookups
- [ ] **Integration with Bridgematch bridging finance tool** (see below)

---

## Sister Project: Bridgematch (Bridging Brain)

**Repo:** `monlamltd-collab/Bridging-Brain`
**What it does:** A bridging finance matching tool that takes a property deal's parameters and matches it against a proprietary database of ~50+ UK bridging lenders, showing which lenders will fund the deal and on what terms.

### Why This Matters for the Auction Tool
The ultimate vision is an **end-to-end pipeline**: the auction scraper identifies investment opportunities, and the bridging tool automatically shows how each lot could be funded. This is the key competitive advantage over Brickflow and Broka — neither combines auction analysis with finance matching.

### Bridgematch Lite / Bridgematch Investor
The file `bridgematch-lite.html` in this repo is the **investor-facing version** of the full Bridgematch bridging finance tool. It's a simplified deal analyser that runs the lender matching engine against a deal's parameters. This is distinct from the full broker-focused Bridgematch tool (in the Bridging-Brain repo) which has more detailed lender output and admin features.

### Integration Points
- **Lot data → Deal parameters:** Each auction lot has price, estimated yield, condition, property type — these map directly to the bridging tool's input fields (purchase price, GDV, works cost, property type)
- **Fundability scoring:** The bridging tool could add a "fundability" badge to each lot showing how many lenders would fund it and at what LTV
- **Domain:** Both will eventually be accessible via bridgematch.co.uk routes

### Branding (Evolving)
Current branding is everything under "Bridgematch" but this may split into:
- **AuctionBrain** — the auction catalogue scraper/analyser (this project)
- **Bridgematch** — the bridging finance matching tool (Bridging-Brain repo)

This is a future consideration — for now both live under bridgematch.co.uk, but keep branding loosely coupled so it's easy to rename later. The auction frontend already uses "BridgeMatch" with the green "Match" text as its brand mark.

### Design Language
- **Auction tool** (`index.html`): Light theme, forest green `#2e7d32`, navy gradient header, Outfit/Sora fonts
- **Bridgematch Lite / Investor** (`bridgematch-lite.html`): Warm cream `#faf8f4`, green `#0f8a5f`, Outfit font — based on the full Bridgematch tool's design
- **Deal Analyser** (standalone HTML, built in Claude Chat): Dark theme `#0c1220`, emerald `#10b981`, DM Sans — may or may not be used going forward
- Design language may converge as the products mature and branding is finalised

### Bridgematch Technical Context (for integration)
- **Backend:** Python FastAPI (`main.py`, ~155K)
- **Lender database:** SQLite with ~50+ lenders, each with detailed criteria columns (day-1 advance rates, interest rates, max LTV, max LTGDV, property types, geographic restrictions, works funding model, etc.)
- **Matching logic:** Per-lender LTGDV calculation that accounts for each lender's specific funding model:
  - **Upfront** (e.g., MS Lending at 85% gross, Mint at 90% gross) — works funded upfront as part of day-1 advance
  - **In arrears / tranched** (e.g., Octane at 75% net day-one plus staged works) — works released against progress
  - **Self-fund** — no works funding, borrower funds all refurb costs
- **Key calculation insight:** LTGDV must be calculated per-lender based on actual debt exposure (day-1 loan + rolled-up interest + lender-funded works) / GDV — NOT using purchase price, which was a previous bug that unfairly penalised deals
- **Frontend:** Single-page HTML apps (`index.html` for broker tool, `bridgematch-lite.html` for investor-facing version)

### IP & Competition
- Competitive advantage comes from trade secrets and the proprietary lender database, not patents
- Business methods alone aren't easily patentable in the UK
- Key competitors: Brickflow, Broka — neither has auction integration
- Marketing strategy: position Simon as a fellow investor who built useful tools, not a company selling products

---

## Appendix: Bridging Finance Domain Knowledge

See `BRIDGING_FINANCE_KNOWLEDGE_PACK.md` in this repo for comprehensive domain knowledge covering:
- Gross vs Net LTV calculations and why they matter
- Valuation basis hierarchy (MV vs 180-day vs 90-day) and impact on effective advance
- LTGDV formula (per-lender, not project-level) and the critical bug that was fixed
- The three funding models (upfront, arrears/staged, self-fund) and their cash flow implications
- Works intensity bands (light/medium/heavy/very heavy) and how they map to lender criteria
- Knockout rules and deal appetite scoring
- Lender ranking logic
- Property type → LTV column mapping
- Common auction + bridging scenarios

**Do not modify bridgematch-lite.html based on this knowledge right now** — it works. This appendix exists so future enhancements are built on correct domain logic rather than guesswork.
