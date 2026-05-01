# Continuation prompt — pick up where we left off (2026-05-01)

Paste this into a new Claude Code session in this repo to resume.

---

## Drop-in prompt

> Context: yesterday's session shipped the visual-audit auto-fix bot (markdown reports + hero_image_bleed cleanup), the Telegram report channel for self-healing (`lib/telegram.js`), and a detail-page postcode extractor for edwardmellor that closes today's `extractor_postcode_regression` alert. Read `docs/CONTINUATION-2026-05-01.md` for the full state. Then do this next: **{pick one from the "Pick next" section below}**.
>
> Before touching code: invoke the `auction-conventions` skill. For any house-broken / image-coverage / extractor incident: invoke `auction-self-healing`. Supabase MCP is authenticated; use `mcp__plugin_supabase_supabase__execute_sql` directly.

---

## What shipped 2026-05-01 (4 commits on `main`)

| Commit | What |
|---|---|
| `7920865` | Wire visual audit (`scripts/visual-audit.mjs`) into nightly cron via the existing admin endpoint — dry-run, JSON artifact only |
| `b089cce` | Markdown report committed to `audits/` nightly + `applyAutoFixes()` for `hero_image_bleed` (nulls bleed image_urls so backfill repopulates) |
| `ca24ef5` | Port `lib/telegram.js` from ContentBrain → activates the auction-self-healing skill's REPORT phase |
| `42cf763` | `lib/extractors/details/edwardmellor.js` — recovers full postcode from detail page after EM's catalogue switched to outward-only addresses |

## Live state changes

- **Visual audit goes live tonight at 05:00 UTC** — first auto-fix run nulls ~27 hero-bleed image_urls across 7 houses (sdl, buttersjohnbee, maggsandallen, kivells, venmore, suttonkersh, gth). Markdown report committed to `audits/visual-audit-2026-05-01.md`.
- **Telegram REPORT phase operational** — `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` set on Railway. `sendHealReport()` lands in Simon's chat for any heal session at confidence < 0.75 (or other §5 triggers).
- **Edwardmellor postcode regression** — extractor + detail-page fix pushed; 279 lots without postcode become gap-fill targets on next `autoAnalyseAll()`. Verification still pending (mark alert resolved once `count(*) WHERE postcode IS NOT NULL` rebounds to ≥80%).

## Scheduled remote agent

- **`trig_013B2HN7QZhqbUtTeqAqyvzV`** fires at 07:00 UTC May 1: reads `audits/visual-audit-2026-05-01.md`, opens a PR with `docs/plans/visual-audit-v2.md` containing verification + design specs for `slug_case_dup` auto-fix and the alert auto-resolve loop. Manage at https://claude.ai/code/routines/trig_013B2HN7QZhqbUtTeqAqyvzV

## New tables / RPCs / migrations

(None today — all work was application-layer.)

## Code review / rollout backlog status

Nothing changed since 2026-04-30 doc; rollout #7 (rentals cron + materialised views + remaining-postcode scrape) and #8 (Title API + comps UI) still outstanding.

---

## OUTSTANDING / "PICK NEXT"

### 🔴 Action items the user needs to run (no code work)

1. **Verify edwardmellor postcode rebound** — after tonight's nightly:
   ```sql
   SELECT count(*) AS total,
          count(*) FILTER (WHERE postcode IS NOT NULL) AS with_postcode
   FROM lots WHERE lower(house) = 'edwardmellor';
   ```
   Expect `with_postcode` to jump from 5 → ~250+. Then `UPDATE pipeline_alerts SET resolved=true WHERE event_type='extractor_postcode_regression' AND house='edwardmellor' AND resolved=false`.
2. **Verify visual-audit auto-fix landed** — `audits/visual-audit-2026-05-01.md` should be on main with a `## Auto-fixes applied` section showing hero_image_bleed rows nulled. The 07:00 UTC scheduled agent will do this and open a v2-spec PR.

### 🟢 High-leverage next builds

3. **Per-house extractor & coverage audit** — Simon explicitly flagged this as a separate session. Goal: a `references/house-coverage-matrix.md` in `auction-self-healing` skill, one row per house, columns for each enriched field (postcode, image, beds, sqft, EPC, lat/lng, UPRN, prop_type, condition, tenure), flagging which fields are underserved per house and the per-house fix recipe (detail-page extractor / URL routing fix / captcha override / etc). Split into 3 phases — phase 0 is a prerequisite, then 3a/3b/3c are the audit itself.

   **Phase 0 (prerequisite — lands via tomorrow's scheduled-agent PR):** implement the alert auto-resolve loop. Without it the 5,316-row unresolved-alert backlog drowns the by-house aggregation in 3a. Cheap to skip if the loop already ran (just check unresolved counts on `created_at > now() - interval '7 days'` and rely on the fresh window).

   **3a — Survey** (~30 min, single session). Extend `scripts/visual-audit.mjs` to emit a companion `audits/coverage-gaps-{date}.md` artifact alongside the existing `audits/visual-audit-{date}.md`. Adds one SQL aggregate that joins per-field heuristic findings with `pipeline_alerts.event_type LIKE 'extractor_%_regression' AND created_at > now() - interval '7 days'`. Fold into the existing nightly workflow step. **Critically: don't touch `lib/extractors/details/*` here — Phase 1 is read-only diagnostics.**

   **3b — Matrix** (~2 hours, single session). Read `audits/coverage-gaps-{latest}.md`. For each (house, field) gap row: pick a fix recipe from {detail-page extractor / URL routing / captcha override / domain probe / data-hygiene purge / dead-house removal}. Output: `references/house-coverage-matrix.md` in the auction-self-healing skill. Cross-reference each row to the existing CLASSIFY table entries. Don't ship any code here — just the document.

   **3c — Execute** (ongoing, parallelizable). Each row in the matrix becomes a self-contained fix task. Naturally suited to scheduled remote agents — one agent per (house, field), each opens its own PR following the recipe. Could clear 30+ houses in a week of background runs. Track completion by adding a `status: open|in_progress|shipped` column to the matrix.
4. **Charlesdarrow domain probe** (~30 min) — `house_skills.last_lot_count=6, status=degraded`, BUT 0 lots in `lots` table. Needs Firecrawl probe of HOUSE_ROOTS URL to classify as `merger`/`genuine_zero`/`auth_wall`. If genuine_zero (between auction cycles), no action; mark alert `acknowledged_no_action`.
5. **Landwood zombie purge** (~15 min) — 93 rows from 2026-04-17 calendar-drift period frozen at `last_seen_at='2026-04-17'`, status='available', auction_date='2099-12-31'. Targeted DELETE clears row-level coverage. Destructive — confirm with Simon before running. Pattern: the lots-table purge gap that `purge.js` doesn't cover. Worth lifting into `purgeStaleLots()`.

### 🟠 Visual audit follow-ups

6. **Tighten `cross_house_url_leak` heuristic** — first dry-run preview showed 449 findings, mostly `auctionhouse*` regional collisions (e.g. `auctionhousedevon` and `auctionhouseessex` sharing a Country-wide listing URL via the Auction House UK platform). Filter: skip when both slugs share the `auctionhouse` prefix; downgrade severity from `error` to `info`. Prevents alert spam when v2 flips writeAlerts to true.
7. **slug_case_dup + retired_slug_straggler auto-fix recipes** — tomorrow's scheduled agent drafts the spec. Implementation candidates for v2 of `applyAutoFixes()`.
8. **Auto-resolve loop for stale `pipeline_alerts`** — 5,316 unresolved rows (mostly `auto_analyse_failure` / `extractor_regression` / `scrape_failure`) destroying signal. Spec being drafted by tomorrow's agent. Schema diff: add `auto_resolved_at` + `auto_resolved_reason` columns to `pipeline_alerts`; integration point at end of `lib/analysis.js::autoAnalyseAll()`.

### 🟡 Lower priority / deferred

9. **`auction-data-hygiene` skill** (project-local) — encapsulate purge / dedupe / case-normalisation patterns (zombie purge, hero-bleed fix, slug-case dedupe). Currently spread across the self-healing skill prose + ad-hoc SQL.
10. **`auction-deploy` skill** (project-local) — Railway log fetch, deploy trigger, env var inspection. Right now I have to ask Simon to run those.
11. **`graphify update .`** — repo CLAUDE.md says to run after code changes. Hasn't been done since the recent commits. Quick.
12. **Update CLAUDE.md** to mention the new `audits/` directory, visual-audit endpoint, auto-fix bot, telegram lib, edwardmellor detail extractor. ~10 min.
13. **Items still open from CONTINUATION-2026-04-30.md** that didn't make this session: rentals cron + materialised views (#7), Title API + comps UI (#8), EPC coverage plan, OpenRent via Firecrawl, multi-unit detector — see that doc.

---

## Conventions to follow

(Unchanged from 2026-04-30 doc — see `docs/CONTINUATION-2026-04-30.md`.)

## Files that changed today

```
lib/extractors/details/edwardmellor.js     — NEW, detail-page postcode parser
lib/extractors/details/index.js            — register edwardmellor
lib/telegram.js                            — NEW, ported from ContentBrain
.github/workflows/nightly-audit.yml        — visual-audit step + markdown commit
scripts/visual-audit.mjs                   — applyAutoFixes() for hero_image_bleed
routes/admin.js                            — extend /api/admin/visual-audit
                                              with autoFix + includeMarkdown
tests/snapshots/edwardmellor-detail.html   — NEW fixture
tests/test-detail-extractors.js            — synthetic + snapshot edwardmellor tests
CLAUDE.md                                  — TELEGRAM_BOT_TOKEN/CHAT_ID env entries
.claude/skills/auction-self-healing/SKILL.md — REPORT phase points at lib/telegram.js
```

---

## My recommendation for the next session

In this order:

1. **Verify edwardmellor + close the alert** (5 min, just the SQL query above).
2. **Read tomorrow's scheduled-agent PR** — accept/iterate the v2 spec (slug_case_dup + alert auto-resolve loop). Once that's in, alert backlog cleanup unblocks the per-house audit.
3. **Per-house extractor & coverage audit** (item #3) — Simon explicitly flagged this as the priority follow-up.
4. **Then consider:** charlesdarrow probe, landwood zombie purge, EPC coverage plan, OpenRent.
