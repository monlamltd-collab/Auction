# Shelved Feature Revival Framework

> Decision framework for evaluating whether shelved features should be revived during the modular rebuild (v1.2→v1.3+).

---

## How to Use This Document

For each shelved feature, answer the 5 questions below. Score each dimension 1-5, then apply the decision matrix at the bottom. Features scoring **18+** = **KEEP**, **12-17** = **REVISIT LATER**, **<12** = **KILL**.

---

## The 5 Questions

### Q1: Why Did It Fail Before? (Failure Clarity Score)

| Score | Meaning |
|-------|---------|
| 5 | Clear external blocker that's now resolved (e.g. missing API, legal block lifted) |
| 4 | Architectural limitation in the monolith that modularization fixes |
| 3 | Deprioritised for resources/time — never truly "failed" |
| 2 | Partially built but created tech debt or UX confusion |
| 1 | Fundamentally flawed concept or no real user demand |

### Q2: What's Different Now Architecturally? (Architecture Leverage Score)

| Score | Meaning |
|-------|---------|
| 5 | New modular structure directly enables this (e.g. isolated route, clean lib boundary) |
| 4 | Extracted modules reduce integration risk significantly |
| 3 | Architecture is neutral — same effort either way |
| 2 | Still requires cross-cutting changes across multiple modules |
| 1 | Would require new infrastructure (new service, new DB schema, new deployment) |

### Q3: Implementation Cost — Modular vs Monolith (Cost Advantage Score)

| Score | Meaning |
|-------|---------|
| 5 | Trivial in new structure — drop-in module, <2 hours |
| 4 | Significantly cheaper — clear module boundary, 1-2 day effort |
| 3 | Comparable cost to before — half day to two days |
| 2 | Still expensive — multi-day effort, touches 3+ modules |
| 1 | More expensive now — modular boundaries add coordination overhead |

### Q4: Risk/Reward If It Still Doesn't Work (Downside Protection Score)

| Score | Meaning |
|-------|---------|
| 5 | Zero blast radius — feature toggle or isolated module, instant rollback |
| 4 | Low risk — contained to one route/lib file, easy to rip out |
| 3 | Moderate — touches DB schema or shared state, rollback needs migration |
| 2 | High — affects core pipeline (scraping, analysis, scoring), failure cascades |
| 1 | Critical — affects auth, payments, or data integrity, failure = downtime |

### Q5: Can We Test It Cheaply? (Validation Cost Score)

| Score | Meaning |
|-------|---------|
| 5 | Can validate with existing data/users in <1 hour (e.g. feature flag to 10% of users) |
| 4 | Can build throwaway prototype in a few hours using existing modules |
| 3 | Needs a day of work to get a testable version |
| 2 | Requires real user feedback loop or external integration to validate |
| 1 | Can't test without full implementation — all-or-nothing |

---

## Decision Matrix

| Total Score | Verdict | Action |
|-------------|---------|--------|
| **18-25** | **KEEP** | Schedule into next available phase. Worth the investment. |
| **12-17** | **REVISIT LATER** | Park with conditions — document what would need to change to score higher. |
| **<12** | **KILL** | Remove from backlog. Document why so we don't revisit again. |

**Override rules:**
- If Q1 = 1 (no real demand), auto-KILL regardless of total score
- If Q4 = 1 (threatens core systems), auto-REVISIT unless total ≥ 22
- If Q5 = 5 AND Q1 ≥ 3, always test before killing — cheap validation trumps gut feel

---

## Feature Evaluations

### 1. Email/Webhook Push Alerts (New Catalogue Notifications)

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 3 | Never attempted — deprioritised, not failed |
| Q2: Architecture? | 5 | `lib/calendar.js` already detects new catalogues; `lib/email.js` extracted; clean hook point |
| Q3: Cost? | 4 | Wire calendar detection → email module, add user preference table. 1-2 days |
| Q4: Risk? | 5 | Completely isolated — worst case users get no email, zero pipeline impact |
| Q5: Test? | 4 | Send test emails to own account using existing catalogue data |
| **Total** | **21** | **KEEP** |

**Verdict: KEEP** — Low-hanging fruit. Modular structure makes this trivial. Schedule for v1.3 or v1.4.

---

### 2. Geocoding Persistence to DB (Map View Foundation)

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 3 | Intentionally deferred — temp `_lat`/`_lng` fields exist, just no DB column |
| Q2: Architecture? | 4 | `lib/enrichment.js` already does geocoding; persistence is an additive change |
| Q3: Cost? | 5 | Add two columns to lots table, persist in enrichment pipeline. <2 hours |
| Q4: Risk? | 4 | Additive DB change, no existing columns affected |
| Q5: Test? | 5 | Run enrichment on 10 lots, check DB. Instant validation |
| **Total** | **21** | **KEEP** |

**Verdict: KEEP** — Almost zero cost, enables future map view. Do it in v1.3.

---

### 3. Individual Lot Pages with SEO-Friendly URLs

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 3 | Never attempted — frontend is SPA with no server-rendered pages |
| Q2: Architecture? | 3 | Routes extracted, but this needs SSR or pre-rendering — not solved by current refactor |
| Q3: Cost? | 2 | Significant — needs URL routing, meta tags, OG images, canonical URLs, sitemap |
| Q4: Risk? | 3 | Touches routing layer and SEO — broken URLs = Google penalty |
| Q5: Test? | 3 | Need to build route + template before any validation |
| **Total** | **14** | **REVISIT LATER** |

**Verdict: REVISIT LATER** — Valuable for SEO but the SPA architecture doesn't help. Revisit when/if frontend framework migration happens. **Trigger:** If organic traffic becomes a priority or competitor SEO analysis shows this is critical.

---

### 4. Legal Pack Completeness Tracking

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 3 | Never attempted — deprioritised |
| Q2: Architecture? | 4 | `lib/extractors.js` per-house parsing could detect legal pack links; `lib/analysis.js` could score |
| Q3: Cost? | 3 | Moderate — each house formats legal packs differently, extraction rules needed per-house |
| Q4: Risk? | 4 | Additive field — if wrong, just shows "unknown", no cascade |
| Q5: Test? | 3 | Need to audit 5-10 houses for legal pack patterns before building |
| **Total** | **17** | **REVISIT LATER** |

**Verdict: REVISIT LATER** — Useful signal for investors but extraction is fiddly across 40+ houses. **Trigger:** When field coverage targets (beds, tenure) are met and there's bandwidth for new fields.

---

### 5. Bid Prior to Auction as Search Parameter

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 3 | Never attempted |
| Q2: Architecture? | 4 | `lib/extractors.js` could flag lots with "offers prior" text; `routes/search.js` could filter |
| Q3: Cost? | 4 | Regex/text match in extractors + boolean column + filter checkbox. 1 day |
| Q4: Risk? | 5 | Additive filter — if detection is wrong, just doesn't show the filter |
| Q5: Test? | 4 | Grep existing lot descriptions for "prior", "offers invited" patterns |
| **Total** | **20** | **KEEP** |

**Verdict: KEEP** — Simple text detection, high investor value (pre-auction offers = less competition). Easy win.

---

### 6. Auction Terms (28/56 Day Completion) as Searchable Field

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 3 | Never attempted |
| Q2: Architecture? | 4 | Same pattern as bid-prior — extractor detection + search filter |
| Q3: Cost? | 3 | Harder extraction — completion terms buried in legal packs or lot details, varies by house |
| Q4: Risk? | 4 | Additive, low blast radius |
| Q5: Test? | 3 | Needs manual audit of how houses present completion terms |
| **Total** | **17** | **REVISIT LATER** |

**Verdict: REVISIT LATER** — Valuable for bridging finance users (shorter completion = different loan product), but extraction complexity is high. **Trigger:** When legal pack tracking is built (they share data sources).

---

### 7. Re-marketed Property Recognition

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 3 | Never attempted |
| Q2: Architecture? | 4 | Could compare lot addresses across catalogue snapshots in `lib/analysis.js` |
| Q3: Cost? | 2 | Needs historical lot matching (fuzzy address comparison), retention of old catalogue data |
| Q4: Risk? | 3 | False positives could mislead investors (flagging "re-listed" when it's a different unit) |
| Q5: Test? | 2 | Needs multiple scrape cycles of same house to have comparison data |
| **Total** | **14** | **REVISIT LATER** |

**Verdict: REVISIT LATER** — Powerful signal (re-marketed = distressed seller = potential deal), but requires longitudinal data we may not be retaining. **Trigger:** When DB retains historical lot data across catalogue cycles.

---

### 8. AI Smart Search (Free Tier)

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 1 | Deliberately killed — moved to premium-only to protect margins and gate AI costs |
| Q2: Architecture? | 3 | `routes/search.js` already has it, just auth-gated |
| Q3: Cost? | 5 | Remove one auth check. Minutes |
| Q4: Risk? | 2 | Opens Gemini API costs to all unauthenticated users — potential abuse |
| Q5: Test? | 5 | Toggle the gate, monitor costs for a week |
| **Total** | **16** | **BUT Q1=1 → AUTO-KILL** |

**Verdict: KILL** — This was a deliberate business decision, not a technical failure. Free AI search burns Gemini credits with no revenue path. Keep premium-only.

---

### 9. Zoopla/Rightmove Scraping

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 1 | Legal blocker — ToS explicitly prohibit scraping |
| Q2: Architecture? | 1 | Architecture irrelevant — it's a legal constraint |
| Q3: Cost? | 1 | Infinite — legal liability |
| Q4: Risk? | 1 | C&D letters, potential lawsuit |
| Q5: Test? | 1 | Cannot test without violating ToS |
| **Total** | **5** | **KILL** |

**Verdict: KILL** — Hard legal constraint. Not a technical problem. Never revisit unless they offer a public API.

---

### 10. XML Sitemap Generation

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 3 | Deferred — depends on having indexable pages (which the SPA doesn't really have) |
| Q2: Architecture? | 3 | `routes/` could serve `/sitemap.xml` easily, but content to index is the blocker |
| Q3: Cost? | 4 | Simple XML generation from active catalogue data. Half day |
| Q4: Risk? | 5 | Zero risk — worst case Google ignores a bad sitemap |
| Q5: Test? | 5 | Generate XML, submit to Google Search Console, check indexing |
| **Total** | **20** | **KEEP** |

**Verdict: KEEP** — But only valuable alongside lot pages (Feature #3). Implement as pair. **Condition:** Bundle with individual lot pages when that's revisited.

---

### 11. Full Bridgematch Integration (Auto-Finance Per Lot)

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 3 | Never attempted — always "future milestone" |
| Q2: Architecture? | 4 | `lib/fundability.js` exists as the bridge point; modular structure helps |
| Q3: Cost? | 2 | Cross-system integration — Auction ↔ Bridgematch API, different tech stacks (Node vs Python) |
| Q4: Risk? | 3 | If Bridgematch API is slow/down, affects Auction UX |
| Q5: Test? | 3 | Need both systems running, test with sample lots |
| **Total** | **15** | **REVISIT LATER** |

**Verdict: REVISIT LATER** — This is the eventual product vision but premature now. **Trigger:** When Bridgematch has stable API and Auction has sufficient user base to justify the integration cost.

---

### 12. Mobile App

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 3 | Never attempted — web-first strategy |
| Q2: Architecture? | 2 | API exists but no mobile-optimised endpoints; auth is cookie-based |
| Q3: Cost? | 1 | Entirely new codebase, app store overhead, ongoing maintenance |
| Q4: Risk? | 2 | Splits development focus for a solo developer |
| Q5: Test? | 2 | PWA could be a cheap test, but real mobile needs real investment |
| **Total** | **10** | **KILL** |

**Verdict: KILL** — Solo developer, £950 budget. A responsive web app is the right call. If mobile demand emerges, consider PWA as the first step, not a native app.

---

### 13. Content Section / Blog for SEO (on Auction Tool)

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 3 | Deferred — AuctionBrain-Content exists as separate repo, not integrated into main tool |
| Q2: Architecture? | 3 | Separate repo means integration still needs cross-system work |
| Q3: Cost? | 3 | Content engine exists; embedding in auction tool needs route + template work |
| Q4: Risk? | 4 | Low risk — additive page, doesn't touch core pipeline |
| Q5: Test? | 4 | Can deploy a single blog post and measure traffic |
| **Total** | **17** | **REVISIT LATER** |

**Verdict: REVISIT LATER** — Content engine is being built separately. Integrate once it's producing consistent quality content. **Trigger:** When AuctionBrain-Content has 20+ published posts and landing site blog is stable.

---

### 14. Author Attribution & E-E-A-T for Content

| Question | Score | Rationale |
|----------|-------|-----------|
| Q1: Why fail? | 3 | Deferred from v1.2 content phases |
| Q2: Architecture? | 3 | Content system, not auction tool architecture |
| Q3: Cost? | 4 | Author metadata + schema markup. Straightforward |
| Q4: Risk? | 5 | Zero risk — additive SEO metadata |
| Q5: Test? | 4 | Add to one post, check Google Rich Results Test |
| **Total** | **19** | **KEEP** |

**Verdict: KEEP** — Google rewards E-E-A-T signals. Low cost, measurable SEO impact. Schedule when content pipeline is producing regularly.

---

## Summary Dashboard

| # | Feature | Score | Verdict |
|---|---------|-------|---------|
| 1 | Email/webhook alerts | 21 | **KEEP** |
| 2 | Geocoding persistence | 21 | **KEEP** |
| 3 | Individual lot pages (SEO) | 14 | REVISIT LATER |
| 4 | Legal pack tracking | 17 | REVISIT LATER |
| 5 | Bid prior to auction filter | 20 | **KEEP** |
| 6 | Completion terms filter | 17 | REVISIT LATER |
| 7 | Re-marketed property detection | 14 | REVISIT LATER |
| 8 | AI smart search (free tier) | 16* | **KILL** (Q1=1) |
| 9 | Zoopla/Rightmove scraping | 5 | **KILL** |
| 10 | XML sitemap | 20 | **KEEP** (with #3) |
| 11 | Full Bridgematch integration | 15 | REVISIT LATER |
| 12 | Mobile app | 10 | **KILL** |
| 13 | Blog/content on auction tool | 17 | REVISIT LATER |
| 14 | Author attribution / E-E-A-T | 19 | **KEEP** |

### Verdict Breakdown
- **KEEP (6):** Email alerts, geocoding, bid-prior filter, sitemap, E-E-A-T, (sitemap conditional on lot pages)
- **KILL (3):** Free AI search, Zoopla scraping, mobile app
- **REVISIT LATER (5):** Lot pages, legal packs, completion terms, re-marketed detection, Bridgematch integration, blog integration

---

## Implementation Priority (KEEP items)

| Priority | Feature | Why First |
|----------|---------|-----------|
| 1 | Geocoding persistence | <2 hours, enables future map view, zero risk |
| 2 | Bid prior to auction filter | 1 day, immediate user value, simple extraction |
| 3 | Email/webhook alerts | 1-2 days, retention driver, modular architecture makes it clean |
| 4 | E-E-A-T / author attribution | Half day, SEO value, depends on content pipeline maturity |
| 5 | XML sitemap | Half day, but valuable only when lot pages exist |

---

## Revisit Triggers

| Feature | Revisit When... |
|---------|-----------------|
| Individual lot pages | Frontend framework decision is made OR SEO becomes urgent |
| Legal pack tracking | Field coverage targets (beds 80%, tenure 80%) are met |
| Completion terms | Legal pack tracking is built (shared data source) |
| Re-marketed detection | DB retains historical lots across catalogue refresh cycles |
| Bridgematch integration | Bridgematch API is stable + auction tool has 500+ monthly users |
| Blog integration | AuctionBrain-Content has 20+ published posts |
