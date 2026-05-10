# Mobile UI Review — 2026-05-10

**Target:** local dev server on the `claude/naughty-wing-cf4ff2` branch
(post-PR [#8](https://github.com/monlamltd-collab/Auction/pull/8) state, all
recent fixes applied — db5153c, 65d63da, 58af908, 8298d11, etc.).
**Viewports:** 375×812 (iPhone SE), 375×667 (older iPhone), 393×851
(iPhone 14 / Pixel 7), 768×1024 (small tablet / landscape phone).
**Tool:** Playwright MCP — Chrome MCP wasn't available (no connected
browsers), Playwright was the planned fallback.
**Coverage limitation:** local server boots on stub Supabase env, so the
lot list is empty (renders skeleton placeholders). Lot-card chrome was
reviewed via static markup + recent-commit walk-through; the hero,
expanded-panel, and per-card carousel weren't visually confirmed in this
pass and are flagged for a follow-up review on a server with real data.

## Summary

**2 BLOCK · 5 FLAG · 4 NICE.** Two issues are visible-on-arrival
problems for marketing traffic: the Sign-in button overflows the iPhone SE
viewport, and the paywall modal's title is positioned off-screen on any
mobile viewport (the recipient can't see what they're being asked to pay
for). Both have surgical fixes (~1 hour each). The five FLAGs are
quality-of-life — most are 1-2 line CSS rules. The four NICE-to-haves are
polish for a follow-up sweep.

---

## Findings table

| ID | Severity | Page / state | Pillar | Description | Suggested fix |
|----|----------|--------------|--------|-------------|---------------|
| **B1** | BLOCK | Home / 375×812 | Overflow + tap target | "Sign in" CTA overflows viewport by 17px. `.nav-cta` right edge at x=391.75 in a 375 viewport. body.scrollWidth = 392. The PRICING + BLOG nav links eat the available space and push Sign-in past the edge. Body has `overflow-x:hidden` so the user doesn't see a scroll bar, but the right ~17px of the red button is clipped — including ~3 chars of "Sign in". | At <420px, hide `.nav-link-blog` (the Pricing + Blog text links — both are reachable from the footer). Or tighten `.nav-right { gap: 4px }` and reduce nav-cta padding from 8px 20px to 8px 12px on narrow screens. File: `public/styles.css:48-53` (.nav-inner / .nav-cta). |
| **B2** | BLOCK | Paywall modal / 375×667 + 375×812 | Overflow | `.pw-modal` is 1158px tall in a 667-px or 812-px viewport with `overflow:visible` and `max-height:none`. The flex-centred modal positions itself with `top: -245.09` (375×667) or `top: -172.76` (375×812). The title "Unlock unlimited AI" sits at y=-148 — completely off-screen and unreachable. The user only sees the bottom 2 of 3 tiers (Day Pass + Pro). Worse: body has `overflow-y: auto` but the modal is `position: fixed` so body scroll doesn't bring the title into view. | Add `max-height: calc(100dvh - 32px); overflow-y: auto;` to `.pw-modal` at `<= 720px` (mirrors `#signupModal .modal` already in `public/styles.css:844-847`). File: `public/styles.css` — extend the `.modal.pw-modal` mobile media query at line 1234-ish. |
| **F1** | FLAG | Home / "How it works" section | Glyph rendering | The icons above each numbered card are emoji (🔍 magnifier, 🎯 ball, ⚡ lightning, 🔨 hammer-ish). Same font-fallback risk that produced the original `§N` regression — emoji rendering is inconsistent across iOS / Android default fonts and especially older Samsung devices. | Replace with inline SVG icons (12-line files each, hosted in `public/`). Or use a stable text-glyph set tested against iOS Safari + Samsung Internet + Pixel Chrome. The `.sec-num-badge` from db5153c is a known-good pattern — could be extended to carry an inline-SVG sibling. |
| **F2** | FLAG | Footer (all viewports) | Tap target | Footer links — Pricing, Privacy Policy, Terms of Service, Contact — render at **16px height** (single-line text, no padding). Far below WCAG 2.5.5 minimum 44×44. Easy to mis-tap "Privacy" when aiming for "Terms" on mobile. Measured: Pricing 38×16, Privacy Policy 77×16. | Add `display: inline-block; padding: 12px 8px;` to footer `<a>` elements. Increases hit area to ~40-44px without changing visible spacing much. File: `public/styles.css` (footer rules) or inline `style="..."` on the existing `<a>` in `index.html:558` (currently has `margin: 0 8px`). |
| **F3** | FLAG | Home (all viewports) | UX consistency | **Two newsletter signup forms on the home page.** "Get Weekly Auction Deal Alerts" appears in a body section, and "Just want a weekly digest?" appears in the footer. Both POST to `/api/digest/subscribe`. Visitors see the same offer twice and may submit twice. The body form is the older landing-page-style pitch; the footer form is from Milestone 6. | Keep one. Recommend keeping the **footer** form (less obtrusive, fits the "just want updates" affordance) and removing the body section. Saves ~150px of vertical space on mobile. File: search `index.html` for "Get Weekly Auction Deal Alerts" and remove that section; keep the digest-form footer block from Milestone 6 (`#digestForm`). |
| **F4** | FLAG | Forms + small buttons (375×812) | Tap target | Multiple form inputs and buttons measure 36-40px tall — below the WCAG 2.5.5 minimum of 44×44. Counts: smartQuery search 218×**36**, mobileFiltersToggle 61×**40**, digestEmail 303×**40**, paywall close (×) 35×44 (**width** too narrow at 35), budget calc inputs 139×**36** (×7 inputs). | One CSS rule fixes most: `.tb-search, .tb-select, input[type="text"], input[type="email"], input[type="number"] { min-height: 44px; }` scoped to `@media (max-width: 720px)`. Bump the paywall close button to `width: 44px`. |
| **F5** | FLAG | Home / 393×851 + 375×* | Overflow + space efficiency | The toggle pills row ("Favourites / Analysed / Save search") wraps to 3 vertical lines on narrow phones, eating ~110px of vertical height before the user reaches lot results. The earlier db5153c fix added horizontal-scroll to `.sp-toggle-row` — but the toggle row I'm seeing here is a different row (`.sp-filter-row`?) that wasn't covered. | Apply the same `flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none;` pattern to whichever row is wrapping (likely `.sp-toggle-row` with `+ Save search` added since the fix). Inspect the rendered DOM at 375 to confirm class name. |
| **N1** | NICE | /pricing / 375×* | Typography | H1 "Simple pricing. No surprises." breaks after "No" — orphan word "surprises." on its own line. | Add `text-wrap: balance` to `.pricing-header h1` (or `text-wrap: pretty` for older browsers). Modern Chrome/Safari support it. Or rephrase to a single-line-friendly version. |
| **N2** | NICE | Home (all viewports) | Tap target | Logo "Auction Brain" is 142px wide × **24px tall** — under the 44px minimum. Mobile users habitually tap logos to return home. | Wrap the logo `<a>` in a 44px-min-height container, or `display: flex; align-items: center; min-height: 44px` on `.logo`. |
| **N3** | NICE | /pricing / 768×1024 | Visual rhythm | "How it works" cards have 4 different icon shapes/colours that don't follow a consistent visual system (orange magnifier, pink ball, lightning bolt). Ad-hoc rather than designed. | Replace with an inline-SVG icon set with consistent stroke weight + colour. Combines well with F1. |
| **N4** | NICE | Home / 768×1024 | Visual consistency | The numbered "2" badge in "How it works" carries a red border that "1" and "3" don't. Reads as if 2 is selected/active — but it's just the AI step. | Make the three badges identical, or accept the highlighting and apply it intentionally to the "money" step. |

---

## Out-of-this-pass

These weren't visually confirmed but are flagged for a follow-up review
once a real-data dev server is available:

- **Lot card hero** at 375 — the recent multi-image carousel work
  ([58af908](https://github.com/monlamltd-collab/Auction/pull/8/commits/58af908))
  exposed the `images` field but the live state is mostly single-image (only
  ~55 lots filled). On real data the carousel transition timing should be
  reviewed.
- **Expanded panel `.exp-v2-*`** — bid + save buttons (db5153c) need a
  real lot to render. The CSS rules I added stack them at <560px, but a
  visual check at 375 would catch any padding/gap mismatches.
- **`/lot/:id`** server-rendered page — same constraint, needs a real
  UUID. The `.lot-detail-*` styles in `public/styles.css` haven't been
  walked through at mobile viewports recently.

## Console errors observed

Two CORS errors hitting `https://www.bridgematch.co.uk/api/lenders-lite`
from `localhost:3000` — local-dev-only artefact, not a real bug.

## Screenshots captured

In `audits/screenshots/`:

- `375-home-anon-default.png` — home full-page, anon, default filters
- `375-signup-modal.png` — signup modal at 375×812 (clean, scrolls within)
- `375-paywall-modal.png` — **paywall at 375×812 showing B2** — title invisible
- `375-pricing.png` — /pricing full-page
- `375-filters-expanded.png` — home with mobile filters revealed (also shows B1)
- `375x667-paywall-clipped-top.png` — paywall at iPhone-SE shorter height (B2 worse)
- `393-home-fold.png` — home above-fold at iPhone 14
- `768-home-fold.png` — home above-fold at small tablet

---

## Suggested fix order

If we want to ship a focused "mobile cleanup" PR, the order I'd take:

1. **B1 + B2 first** (~30 minutes combined) — both are tiny CSS edits with
   clear targets. Both are visible-on-arrival to mobile traffic and both
   block the primary conversion path (sign-in CTA, upgrade modal).
2. **F4 next** (10 minutes) — single CSS rule, big tap-target win.
3. **F2** (5 minutes) — footer link padding.
4. **F3** (10 minutes) — pick one digest form.
5. **F5** (10 minutes) — confirm class name then apply scroll-row pattern.
6. **F1** (1-2 hours) — needs SVG icon set or curated unicode test.
7. **N1-N4** (30 minutes total, if appetite remains).

Total to ship the BLOCKs + FLAGs: ~2-3 hours. NICE-to-haves: another
30 minutes if bundled.

These findings are the input to a follow-up implementation session — no
code has been changed in this review pass.

---

## Addendum — lot card review (live production, post-write follow-up)

**Coverage gap:** the original review was limited to chrome / modals /
static pages because local dev had stub Supabase (empty lot list). User
flagged that the lot card itself is the most-viewed surface and needs a
real visual pass. Done now against **live production**
(`https://auctions.bridgematch.co.uk`) which has 30+ real cards. Live
is **pre-PR #8** — the recent fixes (db5153c et al) aren't deployed yet,
so each finding is marked with deploy status.

### Findings — lot card list view (collapsed)

| ID | Severity | Status vs PR #8 | Description | Suggested fix |
|----|----------|------|-------------|---------------|
| **L1** | BLOCK | **ALREADY FIXED** in db5153c | Section heads showed `§1 · DUE DILIGENCE CHECKS`, `§3 · COMPARABLES` — the section-sign garble bug. Confirmed live in expanded panel. | Will resolve when PR #8 ships. Test once deployed by re-walking the same lot at 375. |
| **L2** | BLOCK | **ALREADY FIXED** in db5153c | "I want to bid → ♡" rendered as one unstyled string in expanded sidebar. | Will resolve when PR #8 ships. |
| **L3** | BLOCK | **STILL TODO** | **Expanded panel has zero hero images** (`image_count: 0` in DOM). For a property auction the photo is the primary buying signal. The user expands a card and sees a 1937px-tall wall of text-only sections — no image, no carousel, no visual confirmation of what they're looking at. The list card has the photo right above the address; the expanded panel discards it. | Add a hero image to the top of `.exp-v2-header .left` (or above the whole header). Use `lot.imageUrl` plus the new `lot.images` array (now exposed via 58af908) to render either a single hero or the cascading carousel pattern from public/app.js card renderer. File: `public/app.js` `buildExpV2Header()` — there's no equivalent in the expanded path currently. |
| **L4** | BLOCK | **STILL TODO** | **Section numbering jumps from "1" to "3"** when a lot has no opportunities and no risks (Hollis Morgan / Whitehall Road sample shown). `buildExpV2Scores()` returns empty string when both arrays are empty (`public/app.js:4553`), so §2 disappears entirely and the user sees 1 → 3. After PR #8 the badges are 1/2/3 not §1/§2/§3 but the gap remains. | Either always render §2 with an empty-state ("Scoring data still loading for this lot"), or compute the visible-section count and number 1..N dynamically. Recommend the latter — cleaner aesthetically. File: `public/app.js` — track a counter across `buildExpV2DD`, `buildExpV2Scores`, `buildExpV2Comparables` calls. |
| **L5** | FLAG | **STILL TODO** | **Address `<h3>` and postcode `<span class="pc">` collide on narrow widths** when the address wraps. Sample observed at 375: "Whitehall Road, WhitehallBS5 9BJ" — the postcode appears immediately after the wrapped final word with no whitespace or break. The HTML is correct (`<h3>...</h3><span class="pc">...</span>`) but the rendered flow joins them. | Add `display: block; margin-top: 4px;` to `.lcv2-addr .pc` (currently inline-by-default span). File: `public/styles.css` near the `.lcv2-addr` rules. |
| **L6** | FLAG | **STILL TODO** | **House-slug rendering loses spaces** in the strip header — e.g. `FUTUREAUCTIONS · LOT 01` (should be `FUTURE AUCTIONS`). `auctionhousescotland` → `AUCTIONHOUSESCOTLAND` is even worse. The display-name lookup table (`getHouseDisplayName`) is missing entries for these slugs, so the renderer falls back to the raw slug → uppercased. | Add the missing slug → display-name pairs to `lib/houses.js::HOUSE_DISPLAY_NAMES`. Audit list: walk `SELECT DISTINCT house FROM lots` and ensure every slug has a friendly name. |
| **L7** | FLAG | **STILL TODO** | **"View lot →" footer button uses `→` instead of `↗`** — but the destination is the EXTERNAL auction-house site. The same logic that drove the change to `.exp-v2-bid` (db5153c) applies here. Currently misleads users into thinking they'll stay in-app. | Swap `→` to `↗` in the `.lcv2-foot .view` link template. File: `public/app.js` near line 3382 (`'View lot <span class="arr">→</span>'`). |
| **L8** | FLAG | **STILL TODO** | **Save pill at top-right of hero** (Milestone 2 / 3746ab2) is positioned correctly but shaves close to the right edge on aerial-photo-style images. At 393×851 the pill's right edge is ~4px from the hero edge — not clipping but feels precarious. | Add `right: 12px; top: 12px` (or move to 16/16) to `.lcv2-save`. File: `public/styles.css` around line 2228. |
| **L9** | FLAG | **STILL TODO** | **Expanded panel sections lack visual separation.** All sections (§1 DD, §3 comparables, deal stack, fundability, auction logistics) sit on the same cream paper background with thin top borders — they bleed into each other when scrolling. On a 1937px-tall mobile panel, the user has no anchor to know which section they're in. | Apply alternating background tones, or add card-style framing per section (`background: var(--paper); border: 1px solid; border-radius: 4px; padding: 18px; margin-bottom: 12px`). Mirrors how list cards already self-frame. |
| **L10** | NICE | **STILL TODO** | The expanded panel header strip "HOLLISMORGAN · LOT 01 · WEDNESDAY 20 MAY 2026" wraps to 2 lines on mobile with the date overflow. Could be tightened by abbreviating to "WED 20 MAY". | Format auction date as `WED 20 MAY` rather than `WEDNESDAY 20 MAY 2026` at <500px. File: `public/app.js` `buildExpV2Header()` date formatter. |
| **L11** | NICE | **STILL TODO** | **Address `<h1>` is huge** (display font, `font-size: clamp(2.5rem, ...)` or similar) and wraps to 3 lines for short addresses ("Whitehall Road, Whitehall" → 3 lines). Editorial intent is right but the type-scale is overshooting on narrow viewports. | Scale H1 down at <480px: `font-size: clamp(1.6rem, 6vw, 2.2rem)` or use a fluid clamp tied to viewport. File: `public/styles.css` `.exp-v2-header .left h1`. |
| **L12** | POSITIVE | n/a | **The card aesthetic itself is genuinely good** — editorial cream/ink palette, monospace caps for chrome, serif display for address, sharp red CTA on right of the split footer. Has a clear point-of-view (FT-meets-WSJ). Don't lose this in any redesign — the issues above are all surgical. |

### Cross-reference table — what PR #8 already handles

| Issue (live production) | PR #8 commit |
|---|---|
| `§1 · ` / `§2 · ` / `§3 · ` garbled section heads | db5153c (`.sec-num-badge`) |
| "I want to bid → ♡" garbled string | db5153c (`.exp-v2-bid` + `.exp-v2-fav`) |
| Mobile right-edge clipping in lot card chrome | db5153c (min-width:0, word-break) |
| Unsold-lots pill exposed to free users | db5153c + 65d63da (Pro-gating + state defence) |
| Multi-image carousel data not flowing through | 58af908 (LOTS_SELECT, mappers, RPC) |
| Anon nudges (toast at 10, modal at 25) | eae4a36 |

### Net new findings (NOT addressed by PR #8)

**4 items need new work before marketing push** (in priority order):

1. **L3 — no image in expanded panel** (BLOCK, ~1 hour). Carry hero + carousel into `buildExpV2Header()`.
2. **L4 — section numbering 1→3 jump** (BLOCK, ~30 min). Dynamic numbering across rendered sections.
3. **L5 — address/postcode whitespace collision** (FLAG, 5 min). One CSS rule.
4. **L7 — "View lot →" should be ↗** (FLAG, 5 min). One char swap.

L6 (house display names), L8 (save pill positioning), L9 (section separation), L10/L11 (typography), are 30-90 minute items that improve polish but don't block traffic.

### Updated total findings

| Category | Count |
|---|---|
| **Net BLOCK after PR #8 deploys** | 2 (B1 + B2 from chrome review) + 2 (L3 + L4 from lot card) = **4** |
| **Net FLAG after PR #8 deploys** | 5 (chrome review) + 4 (L5/L6/L7/L8 from lot card) = **9** |
| **NICE-to-have** | 4 (chrome) + 3 (L9/L10/L11 from lot card) = **7** |

Suggested ship grouping for a "mobile pre-launch" PR:

- **PR — Mobile launch blockers (B1, B2, L3, L4):** ~3 hours total
- **PR — Mobile polish (F1-F5, L5-L8):** ~3-4 hours
- **PR — Polish round 2 (NICE items):** ~1.5 hours, optional

### Lot-card screenshots added

- `audits/screenshots/375-lotcard-collapsed.png` — list card on iPhone SE
- `audits/screenshots/375-lotcard-expanded-1.png` — expanded panel, head + DD list
- `audits/screenshots/393-lotcard.png` — list card at iPhone 14 width
