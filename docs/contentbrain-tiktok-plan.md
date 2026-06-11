# ContentBrain / GrowthBrain — Dual-Format, TikTok & Investment-Thesis Content Plan

**Status:** Spec / hand-off doc. Created 2026-05-29.
**Owner:** Simon Deeming.
**Implement in:** the `ContentBrain` / GrowthBrain repo (NOT this Auction repo). This file lives in the Auction repo only as a reference to paste into the ContentBrain session.

> GrowthBrain is the shared content engine that covers **both** AuctionBrain (this tool) **and** Bridgematch (bridging finance). A core goal of this plan is to **cross-pollinate** the two so we generate richer, more interesting content than either could alone.

---

## 1. Background — what changed and why

- Daily Facebook **reels** on the AuctionBrain page were paused (reel template weight set to `0` in `app_config`). The FB page is now **image-only** for the daily feed.
- We are **not** simply swapping reels for images. We are expanding the whole content model: more content **types**, a second **platform** (TikTok), and a new **investment-thesis** engine that mines real strategies and cross-pollinates auctions ↔ bridging finance.

---

## 2. Target content model

### Channels
| Channel | Format | Publishing | Notes |
|---|---|---|---|
| **Facebook page** (`auctionbrain`) | **Image posts only** | Auto-queue, ~2/day, human-approved | Daily reel template stays at weight `0`. Reels do NOT post to the FB feed. |
| **TikTok** (`auctionbrain`) | **Vertical 9:16 video** | **Draft only — manual download/post** | A TikTok-formatted version of **every** piece of content. No auto-publish integration (separate future job). |

### Content types feeding the pool
1. **Weekly superlatives** — best / worst / most-expensive / cheapest / biggest-discount lot of the week.
   - Produce **BOTH** an **image/Canva card** (for the FB page) **and** the **reel** (kept — feeds TikTok). Two post rows per pick.
2. **Filler lot posts** — interesting/random lots pulled from AuctionBrain's own `lots` data. Image for FB + TikTok version.
3. **Educational / feature posts** — "how to analyse a lot", "how to get a bridging quote", "getting the most out of AuctionBrain". Image for FB + TikTok version.
4. **Investment-thesis posts** (NEW — see §4) — strategy-led, cross-pollinated auction + bridging content, Firecrawl-enriched. Image for FB + TikTok version.
5. **Existing hook / stat / list templates** — continue as image (FB) + TikTok version.

### Golden rule
**Every piece of content gets a parallel TikTok draft.** Reels pass through natively; image posts become a 9:16 video (Ken Burns over the image, or a TikTok image-carousel) with a TikTok-style caption + hashtags.

---

## 3. Build phases (ContentBrain)

### Phase 1 — Superlatives → dual output
- In the weekly-superlatives flow (`runWeeklySuperlatives` or equivalent), keep `renderVideo` (reel) **and** additionally render a static image card via the image renderer / a Canva-style `superlative.html` template.
- Insert **two** post rows per pick: one `platform='facebook'` image, one reel (which Phase 3 routes to TikTok).

### Phase 2 — New content sources
- **Filler lots generator** — selects fresh/interesting lots from the `lots` table (recency, high AI score, big below-market discount, unusual lot type) and produces an image post.
- **Educational/evergreen generator** — new archetype set driven by an `app_config` topic list so topics can be tuned without code. Seed topics in §5.

### Phase 3 — TikTok variant for everything
- A post-processing step: for each generated piece, emit a parallel **TikTok draft** (`platform='tiktok'`, `status='draft'`).
  - Reels → pass through natively.
  - Image posts → 9:16 video via the existing video renderer (Ken Burns) **or** TikTok image-carousel + TikTok caption/hashtags.
- Surface TikTok drafts under a **separate TikTok tab/filter** in the dashboard so they don't clutter the FB approval queue.

### Phase 4 — Investment-thesis engine (see §4)

---

## 4. Investment-thesis engine (cross-pollination + Firecrawl enrichment)

The highest-value, most differentiated content. Strategy-led posts that tie a **real auction scenario** to a **bridging-finance angle** (GrowthBrain covers both, so this is the natural cross-pollination).

### Seed themes (starter set — engine should grow these, NOT treat as exhaustive)
1. **Side-plot split + build** — buy a property with a large side plot, split the title, build a second dwelling next door.
2. **Japanese knotweed discount play** — buy at a discount because of knotweed, factor in treatment + management plan, capture the spread.
3. **Block of flats on one title** — buy the whole block on a single title, split titles to uplift value.
4. **Super-short leasehold extension** — buy a flat with very few years left on the lease, extend it, bank the capital uplift.
5. **Tired HMOs in Article 4 areas** — buy run-down HMOs where Article 4 limits new ones, refurbish, refinance at the higher value (the existing HMO use is the moat).

### Pipeline
1. **Seed** — themes from a tunable `app_config` list (the five above to start; humans + the engine add more over time).
2. **Enrich** — use **Firecrawl** to find real-world examples, numbers, and pitfalls from the open web and property investment forums (e.g. Property Tribes, PropertyHub, landlord forums, planning portals). Pull case studies, typical discounts, costs, timelines, refinance figures.
3. **Cross-pollinate** — for each thesis, attach the **bridging-finance angle** from Bridgematch (how bridging funds the purchase/works, exit via refinance/sale, indicative terms). This is where the two brains meet.
4. **Consolidate & refine** — Gemini (or the configured LLM) consolidates the enriched material, removes contradictions, and **crystallises** the single most impactful version of each thesis into post copy (FB image card + TikTok script).
5. **Human-in-the-loop (mandatory)** — every thesis post routes to **draft/review** for Simon to confirm it looks authentic, the numbers are sane, and it doesn't say anything stupid or non-compliant (financial-promotions sensitivity). **Never auto-publish thesis content.**

### Guardrails
- No specific financial advice / guaranteed returns; keep it educational and clearly framed.
- Cite/ground enrichment in real sources where possible; flag anything the LLM couldn't corroborate.
- Knotweed, leasehold, Article 4, planning — these are legally/technically nuanced. Human review catches errors. Keep claims hedged and accurate.

---

## 5. Seed copy — educational / feature posts (Phase 2)

Starter angles (expand into full copy during build):
1. **"How to read an auction legal pack in 5 minutes"** — the 4 documents that actually matter.
2. **"What our AI score actually means"** — why 9/10 ≠ a guaranteed bargain.
3. **"Get a bridging quote on any lot in 60 seconds"** — the fundability badge walkthrough.
4. **"Gross yield vs the rent that's actually achievable"** — the common trap.
5. **"3 red flags we auto-flag before you bid"** — address/title checklist.
6. **"Find lots that never hit Rightmove"** — the discovery angle.
7. **"Below-market vs cheap"** — how the discount is calculated.
8. **"From catalogue link to full analysis"** — paste-a-URL demo.

---

## 6. Decisions / defaults (override if wanted)

- **TikTok tagging:** `platform='tiktok'`, `status='draft'`; separate dashboard tab.
- **Image→TikTok:** existing video renderer (Ken Burns over the lot/card image) → true 9:16 video.
- **Educational + thesis topics:** stored in `app_config` so they're editable without code.
- **Thesis content:** always human-reviewed before publish; never auto-posted.
- **FB daily reel weight:** stays `0` (confirmed correct under the new model).

---

## 7. Open questions for build kickoff

1. Confirm the ContentBrain repo name/slug and where post rows are written (table + status enum) so TikTok drafts slot in cleanly.
2. TikTok image content: 9:16 **video** vs native **image carousel** — pick the renderer path.
3. Which forums/sources are acceptable for Firecrawl enrichment (allowlist), and crawl budget per thesis.
4. Compliance framing for bridging-finance angles (financial promotions) — confirm the standard disclaimer/footer.

---

## 8. Next step

Open a session targeting the **ContentBrain / GrowthBrain repo** and paste:
> "Implement the AuctionBrain dual-format + TikTok + educational + investment-thesis content plan (docs/contentbrain-tiktok-plan.md from the Auction repo)."

Build there, open a **draft PR**.
