# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.1 — Hardening, Enrichment & Deal Stacking

**Shipped:** 2026-03-16
**Phases:** 3 | **Plans:** 10 | **Sessions:** ~3

### What Was Built
- Multi-country SDLT calculator (England, Scotland, Wales) with correct 2025/26 investor rates
- Stripe hardening: trial abuse prevention, webhook idempotency, graceful downgrade with 3-day grace
- Pipeline alerting (4 event types) with admin freshness dashboard and per-scrape diff summaries
- EPC rating + flood risk enrichment pipeline with 30-day Supabase caching (free for all users)
- IMG_HELPERS module for DOM extractors with lazy-load fallback chain; missing-image admin tooling
- 15 new auction houses (~3,315 lots, 99.6% image coverage) + critical system-wide ASI bug fix
- Deal stacking calculator with lender-matched bridging costs, flip/hold scenario comparison
- Premium feature wiring (Yield Analysis, Comparables, Deal Stacking) replacing Coming Soon chips
- Cross-tab tier sync, full gating audit, tier lifecycle verification

### What Worked
- **Parallel phase execution** — 3 phases with 10 plans completed in ~2 days
- **DOM extractor expansion via platform aliases** — 6 Auction House UK branches reuse one extractor
- **ASI bug discovery** — found and fixed a system-wide silent failure affecting all ~50 DOM extractors during routine house expansion work
- **Free public APIs for enrichment** — EPC (MHCLG) and flood risk (EA) add value at zero cost
- **details/summary pattern** — native HTML for premium feature gating, no JS framework needed

### What Was Inefficient
- **Requirements tracking lag** — Phase 2 requirements (IMG, ENRH, EXPN) were delivered but never checked off in REQUIREMENTS.md, creating a false "11 unchecked" gap at milestone completion
- **No milestone audit** — skipped `/gsd:audit-milestone` which would have caught the requirements tracking gap earlier

### Patterns Established
- `IMG_HELPERS` module injected into all DOM extractor contexts — reuse for all future houses
- Premium feature gating via `<details>/<summary>` + blur + upgrade CTA
- Enrichment as best-effort pipeline (failures never block extraction)
- `.trim()` on DOM extractor strings to prevent ASI issues

### Key Lessons
1. **Check off requirements as plans complete** — don't defer to milestone completion. The bookkeeping gap caused unnecessary confusion.
2. **Platform aliases scale well** — one DOM extractor serving multiple branches is better than N copies
3. **ASI in `new Function()` contexts is a real trap** — always `.trim()` strings passed to `new Function()`
4. **Free public APIs first** — EPC and flood risk add significant user value without Firecrawl credit spend

### Cost Observations
- Model mix: balanced profile (per config.json)
- Sessions: ~3 (one per phase roughly)
- Notable: 10 plans in 2 days with parallel execution; DOM extractor reuse saved significant time

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.1 | ~3 | 3 | First milestone with GSD workflow; yolo mode |

### Cumulative Quality

| Milestone | Tests Added | Key Quality Win |
|-----------|-------------|-----------------|
| v1.1 | ~170 (enrichment + image + endpoint tests) | ASI bug fix across all extractors |

### Top Lessons (Verified Across Milestones)

1. Check off requirements incrementally, not at milestone end
2. Free public APIs before paid enrichment services
