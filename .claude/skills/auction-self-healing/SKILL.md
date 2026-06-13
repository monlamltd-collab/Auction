---
name: auction-self-healing
description: Use when an auction house returns 0 lots, regresses, or is suspected broken — and for routine pipeline maintenance (image backfills, cache clears, onboarding new houses, resolving pipeline_alerts). Triggers on `/heal`, on any user mention of "house X is broken / showing no lots / 0 results / regressed / not scraping", or when unresolved rows appear in the `pipeline_alerts` table.
---

# Auction Self-Healing

You are operating on the Bridgematch AuctionBrain repo. This skill makes you the on-call engineer for the scraping pipeline. Follow it exactly — its rules are distilled from real production incidents.

## Activation

Invoke this skill when ANY of these are true:
1. User runs `/heal` (with or without a house slug argument).
2. User runs `/fix_lot` and/or attaches a screenshot of one or more broken lots on the live frontend (auctions.bridgematch.co.uk). Treat any screenshot showing placeholder images, town-only addresses, "other" property types, "Guide TBA" where guides should exist, or wrong bed counts as a `/fix_lot` invocation even if the user didn't type the command.
3. User says a house is broken, returning 0 lots, missing images, or regressed.
4. You spot unresolved rows in `pipeline_alerts` while doing other work.
5. User asks to onboard a new house, backfill images, clear cache, or resolve an alert backlog.

If the trigger is ambiguous, start anyway — the diagnostic phase is cheap and read-only.

## /fix_lot — screenshot-driven sub-flow

When invoked via screenshot:

1. **Read the screenshot literally.** Identify each visible lot card and record: house slug (badge in card top-left), lot number, address text, price, badges (bedrooms, EPC, tenure, "Guide TBA", "Needs modernisation", etc.), and whether the image is a real photo or a house logo / generic placeholder.
2. **Cluster symptoms by house slug.** If three lots from the same slug all show the house logo as the image, the bug is in that slug's extractor / image strategy — not a per-lot data issue.
3. **Map symptoms to causes** (Firecrawl-first since 2026-05-08 — fixes are at the schema / prompt level, not per-house DOM):
   - House logo / brand colour as image → Firecrawl JSON extract grabbed a hero/banner image instead of a per-card image. Inspect the Firecrawl markdown response: are real per-lot images present in the markdown? If yes, the `lot-schema.js` image extraction prompt needs sharpening. If no, the page is image-lazy and needs a Firecrawl `executeJavascript` scroll action via `HOUSE_SCRAPE_OVERRIDES` in `lib/scraper.js`. The hero-bleed guard at upsert (`lib/pipeline/persist-lots.js::HERO_BLEED_THRESHOLD = 3`) auto-strips a single image URL shared across ≥3 distinct addresses — that's the safety net.
   - Address = single town name → Firecrawl JSON returned the section heading instead of the lot address. Usually a per-house `HOUSE_OVERRIDES` markdown recogniser fixes it (see Pattinson, John Pye in `lib/houses.js`) — read the full lot block out of markdown rather than relying on JSON extract alone.
   - "other" property type or wrong bed count → enrichment classifier in `lib/scraper/extraction.js` couldn't infer from the bullets. Confirm the bullets array is populated (markdown recogniser may need to capture more text).
   - "Guide TBA" on every lot → price genuinely missing OR Firecrawl JSON dropped the `priceText`. Cross-check against the markdown response.
4. **Fetch the live catalogue** via `POST /api/admin/rescrape { slug }` or `node scripts/test-firecrawl-extract.mjs <url>` — confirm the diagnosis end-to-end before changing code. There are no DOM snapshots any more; rely on live re-scrape.
5. From here, follow the main `DIAGNOSE → CLASSIFY → FIX → VERIFY → REPORT → LEARN` loop. Schema/prompt changes still require explicit "push" confirmation (rule 6).

## The Loop

```
DIAGNOSE → CLASSIFY → FIX → VERIFY → REPORT → LEARN
```

Never skip steps. Never reorder them. Each is described below.

---

## 1. DIAGNOSE (read-only, always safe)

Always start by querying the alert backlog and house state. Do this **before** asking the user anything.

```sql
-- Open alerts (entrypoint)
SELECT event_type, severity, house, message, created_at, meta
FROM pipeline_alerts
WHERE resolved = false
ORDER BY severity DESC, created_at DESC;

-- For a specific slug
SELECT * FROM auction_calendar  WHERE house_slug = $1 ORDER BY date DESC LIMIT 5;
SELECT url, total_lots, expires_at FROM cached_analyses WHERE url ILIKE '%'||$1||'%';
SELECT slug, healing_cooldown_until, image_coverage,
       next_scrape_at, consecutive_same_count, last_probe_result,
       last_full_extract_at
FROM house_skills WHERE slug = $1;
SELECT count(*) FROM lots WHERE house = $1;
```

Then fetch the suspect URL **once** with Firecrawl (or curl if Firecrawl budget is tight) and inspect:
- Footer / banner text — read with eyes, not just regex.
- Whether the page is a JS-rendered template (jQuery-tmpl, Next.js, React).
- Presence of captcha (`grecaptcha`, `stackProtect`, Cloudflare).
- Presence of a "we've moved" / "now part of" / "visit our new website" notice.

**Adaptive cadence check (added 2026-05-12):** If a house seems silently unscraped, check `next_scrape_at`. The scheduler in `_doAutoAnalyseAll` skips houses whose `next_scrape_at` is in the future. `consecutive_same_count` rises every Firecrawl `changeStatus='same'` and earns longer intervals up to a 7-day freshness cap (see `lib/pipeline/scheduling.js::BACKOFF_HOURS`). A high count + a future `next_scrape_at` is **not** a regression — it's the system correctly throttling a stable catalogue. To force an immediate re-scrape: `POST /api/admin/rescrape { house }` (calls `autoAnalyseOne` directly, bypassing the filter) or `POST /api/admin/heal { slug }` (also calls `resetAdaptiveBackoff` first).

**Do not modify anything in this phase. Do not commit. Do not push. Do not rescrape.**

## 2. CLASSIFY

Assign exactly one primary cause. Confidence ≥ 0.75 is required to auto-fix; below that, escalate (see §5 Telegram).

| Cause | Signal | Default action |
|---|---|---|
| `merger` | Banner/footer phrases like "now part of", "acquired by", "visit our new website", "auctions now run by" | Resolve via merger flow (§3a). **NEVER invent a new URL on the parent's domain without first calling `detectAuctionHouse(newUrl)` and checking it does not collide with an existing slug.** |
| `url_rotation` | Domain unchanged but path moved (e.g. `/auctions` → `/properties`) | Update HOUSE_ROOTS + AUCTION_DISCOVERY entry, push, rescrape |
| `firecrawl_extract_regression` | URL fine, page renders, Firecrawl markdown shows lots, but JSON extract returns 0 / few | Tighten the Firecrawl `jsonOptions` schema/prompt in `lib/scraper/lot-schema.js`, OR add a per-house `HOUSE_OVERRIDES` markdown recogniser in `lib/houses.js` (see Pattinson, John Pye). DOM extractors are gone — there's nothing per-house to "fix" at the DOM level. (§3b — REQUIRES CONFIRMATION for schema changes.) |
| `captcha_block` | reCAPTCHA / StackProtect / Cloudflare on a page whose content **isn't already scraped under another slug** | Add Firecrawl `preActions` override in `HOUSE_SCRAPE_OVERRIDES` (lib/scraper.js). **Skip entirely if the same lots flow through a sibling slug — that's a merger, not a captcha problem.** |
| `image_coverage_low` | `house_skills.image_coverage < 0.7` | Run `/api/admin/backfill-images` |
| `two_tier_mistarget` | All lots share an identical `imageUrl`, addresses are single town/branch words (no commas, ≤2 words), 0 bullets across the board, and lot count matches a suspiciously round branch count (10–20). The scraper is reading an *events listing* (one card per branch/auction event) instead of a *lot listing*. | Fix `rewriteUrl()` in `lib/houses.js` for that house — drill from events page to event-detail page that actually contains `/property/` href links. **Never short-circuit on a CSS class alone (e.g. `FeaturedGrid`) — events pages reuse the same components.** Always require a property-link signal before treating a page as lot-bearing. |
| `genuine_zero` | Auction calendar empty / between cycles. Confirm by fetching the catalogue page directly (curl/Firecrawl) and looking for a literal "no results" / "no upcoming" / "Sorry, there were no results" text marker — selectors returning 0 *plus* a "no results" banner = genuine zero, not regression. | No action; mark alert resolved with note "no current catalogue (text marker confirmed)". John Pye 2026-04-25 — 77 alerts resolved this way after confirming "no upcoming auctions" banner. **⚠️ NEVER conclude genuine_zero from a static curl on a JS-rendered site (returns an empty SPA shell) — RENDER the page (Playwright/Puppeteer) first. Zero-delivery audit 2026-06-13: of 8 "between-auction" houses, 2 were live gaps we mis-handled — savills (`probe=error`+maxed `same_cnt` stalled the scheduler while real upcoming auctions existed → rescrape recovered) and strakers (catalogue URL was a lot-less marketing landing page; real lots at `/property-auctions/for-sale/` → rewriteUrl retarget, PR #92). Also rule out a PHANTOM slug: btgeddisons showed 0 under `network` but delivers 141 lots under `sdl` (the canonical slug) — check `detectAuctionHouse` before chasing. Always: render the page, find the REAL current-catalogue URL (it may have rotated month or moved to /for-sale//properties), and confirm the slug mapping.** |
| `auth_wall` | HTTP 401 / 403 on every request, including from a clean browser session. Site requires login (e.g. agent portal). Firecrawl + Puppeteer both blocked. | Add `blocked: true` short-circuit in `rewriteUrl()` (lib/houses.js) so the slug is skipped before any scrape attempt. Resolve open alerts with note "auth wall — blocked permanently until credentials supplied". Halls 2026-04-25 — 401 on all paths, blocked + 1 alert resolved. |
| `theme_distinct` | House previously aliased to a platform extractor (Homeflow, Bamboo, etc.) but the live page uses a different layout. Symptom: Firecrawl JSON returns 0 / few lots even though the page renders and has property cards. **Pre-2026-05-08 fix was a standalone DOM extractor; that path no longer exists.** | Add a per-house `HOUSE_OVERRIDES` markdown recogniser in `lib/houses.js` so Firecrawl markdown is parsed with house-specific patterns. If even markdown is thin, fall back to a Firecrawl `executeJavascript` scroll action in `HOUSE_SCRAPE_OVERRIDES` (lib/scraper.js) to get the SPA to hydrate. Historical Clee Tompkinson incident (2026-04-25) was resolved by a standalone DOM extractor at the time; the same fix today is a markdown recogniser. |
| `hero_image_bleed` | A single `image_url` is shared across ≥3 distinct addresses for one house (often the company logo, homepage hero, or a "no image" stock). Frontend shows the same photo on every card for that house. Detection SQL: `SELECT lower(house), count(*), count(DISTINCT image_url), count(DISTINCT address) FROM lots WHERE image_url IS NOT NULL GROUP BY lower(house) HAVING count(*) > 3 AND count(DISTINCT image_url) = 1 AND count(DISTINCT address) > 3;` | The defensive guard in `lib/pipeline/persist-lots.js` (`HERO_BLEED_THRESHOLD = 3`) auto-strips bleed URLs at upsert. For *existing* poisoned rows, run `UPDATE lots SET image_url = NULL WHERE house = $1 AND image_url IN (<bleed-urls>)` — multi-image-sweep picks them up next pass. If the bleed *recurs* after rescrape, sharpen the per-card image extraction in the Firecrawl `jsonOptions` schema (`lib/scraper/lot-schema.js`) so the prompt explicitly rejects logos/banners. Lextons / philliparnold / driversnorris / walkersingleton 2026-04-25 all hit this. |
| `slug_case_dup` | Same house has rows under both `lextons` and `Lextons` (or any case variant). Detection: `SELECT lower(house), count(DISTINCT house) FROM lots GROUP BY lower(house) HAVING count(DISTINCT house) > 1;`. Caused by two code paths writing the slug differently — usually one path used `auction_calendar.house` (display name) and another used `auction_calendar.house_slug` (canonical). | Lowercase guard now lives in `persist-lots.js` (`house = (house || '').toLowerCase()` at function entry). Existing duplicate rows: `UPDATE lots SET house = lower(house) WHERE house != lower(house)` — but check unique constraints first because `(house, url)` may collide. If collisions exist, prefer the row with the most enriched fields. |
| `retired_slug_resurrected` | Slug was removed from `HOUSE_ROOTS` in `lib/houses.js` (e.g. domain parked / merged) but the slug still appears in `lots`, `auction_calendar`, or `cached_analyses`. Either an old calendar row never got cleaned up, or `detectAuctionHouse()` is still routing the dead domain to the retired slug. | Three-step cleanup: (1) `DELETE FROM lots WHERE house ILIKE $slug` + same for `auction_calendar` + `cached_analyses` + resolve open alerts. (2) Add `if (house === '$slug') return { ..., blocked: true }` guard in `rewriteUrl()` so any straggler URL short-circuits. (3) Optional: also remove the `detectAuctionHouse` line that routes the dead domain. Lextons 2026-04-25 — 62 stale rows (split 31/31 case), 1 calendar row, 1 hero-bleed image, all purged + blocked. |
| `mixed_content_http_images` | All lots for one house show "No photo available" placeholder on the live frontend, but `SELECT image_url FROM lots WHERE house = '$slug'` returns populated values starting with `http://`. The frontend is HTTPS-only, so browsers block as mixed content; `routes/search.js` `isValidImageUrl()` also strips `http://` URLs server-side. **Detection SQL:** `SELECT house, COUNT(*) FILTER (WHERE image_url LIKE 'http://%') AS http_imgs FROM lots GROUP BY house HAVING COUNT(*) FILTER (WHERE image_url LIKE 'http://%') > 0;` | Two fixes: (1) Add `if (src.startsWith('http://')) src = src.replace('http://', 'https://')` in the per-house extractor's image selector — verify the source actually serves HTTPS first via `curl -sI https://host/path`. (2) Bulk-update existing rows: `UPDATE lots SET image_url = REPLACE(image_url, 'http://', 'https://') WHERE house = '$slug' AND image_url LIKE 'http://%'`. Futureauctions 2026-04-30 — 143 rows fixed; extractor already had the rewrite from a prior change but legacy rows pre-dated it. |
| `address_whitespace_mangled` | Lots have addresses with embedded `\n\t\t\t...` patterns — `.trim()` on `textContent` of an h3/h4 only strips leading/trailing, not internal. Symptom: `SELECT address FROM lots WHERE address ~ E'\\s{2,}'` returns long-tabbed strings. The frontend mostly tolerates it but enrichment (EPC fuzzy match, OS Places) becomes flaky. | Add `address = address.replace(/\\s+/g, ' ').trim()` defensively at the end of address extraction in the offending platform extractor. Bulk-fix existing rows: `UPDATE lots SET address = regexp_replace(address, '\\s+', ' ', 'g') WHERE house = '$slug' AND address ~ E'\\s{2,}'`. Futureauctions 2026-04-30 — h3 fallback path; ~140 rows cleaned. |
| `sold_overlay_drops_lot` | Firecrawl JSON extract drops any lot block preceded by `![SOLD](...)` overlay images (the LLM reads the badges as the card header and gives up). Symptom: `recall_diagnostic` shows mdIds > jsonIds, and the missing IDs all correspond to SOLD PRIOR / withdrawn lots visible in markdown. Sister symptom: per-auction `LOT TBC` preview entries (no lot number) also get dropped. Maggs & Allen 2026-05-11 — 38 lots stated, 24 extracted, 14 missing (Lot 6 SOLD PRIOR + Lots 10/13/16/22/24/31 + 7 LOT TBC June previews). | Add a markdown recogniser that parses the `**LOT N**` / `**LOT TBC**` blocks and reads address + price + bullets + status from each. `lot_status='sold'` when an `![SOLD]` overlay precedes the address heading or "SOLD PRIOR" appears in the bullets. See `recogniseMaggsLotsFromMarkdown` in `lib/pipeline/firecrawl-extract.js` as the reference. The recall loop in `extractCatalogueListing` only fires the recogniser for IDs MISSING from JSON, so JSON-extracted lots are unaffected. **Also check that `auction_calendar.url` points to the CURRENT auction's `?auction=N` query param** — Maggs had `?auction=2` (past 23 April catalogue, all lots ended/STC) when the current was `?auction=3`. The URL fix alone moved the dial more than the recogniser did. |
| `changetracking_flapping` | Same slug returns alternating 0-lot and full-count scrapes within an hour, visible in `recall_diagnostic` alerts. When 0, the orchestrator falls back to Gemini, which writes thinner/wrong data (Maggs 2026-05-11 → Gemini marked all 9 lots `status='stc'` even though the auction was 8 days away). Auto-heal doesn't fire because the next scrape comes back full, so the symptom looks transient — but the bad-data writes accumulate. Detection: `SELECT created_at, message FROM pipeline_alerts WHERE house='$slug' AND event_type='recall_diagnostic' ORDER BY created_at DESC LIMIT 20;` — look for alternating ratios in the 60–90 minute window. | Add `changeTracking: false` to `HOUSE_OVERRIDES.$slug` in `lib/analysis.js`. Same fix as Pattinson (PR #11, 2026-05-04) — accept the cost of always re-rendering rather than the data corruption from Firecrawl returning empty payloads. The empty payload happens when Firecrawl's changeTracking layer decides the page is "same" but the cached delta is stale; we don't get markdown or JSON lots back, recogniser sees nothing, fallback to Gemini fires. Maggs & Allen 2026-05-12 incident. |
| `auction_date_rollforward_typo` | A house has `auction_date` set to ~12 months in the future, but the lot URLs and bullet content reference a past auction. Detection: `SELECT auction_date, count(*) FROM lots WHERE house='$slug' AND auction_date > now() + interval '6 months' GROUP BY auction_date;`. Root cause was `parseAuctionDateFromBullet` in `lib/utils.js` rolling no-year bullets like "20 May LIVE ONLINE AUCTION" forward to next year when current-year was past — innocuous for SPA pages always showing the next auction, **but** cache-enrich passes re-process bullets on existing rows, and a past-auction bullet would roll forward to a fake 2027 date. Maggs & Allen 2026-05-12: 18 lots persisted with `auction_date='2027-04-23'` from the 23 April 2026 catalogue. | Fixed at parser level in [lib/utils.js:55-72](lib/utils.js:55) (2026-05-12) — branch 3 now returns `null` when the current-year date is past instead of rolling forward. Catalogue-level `auction_date` from `auction_calendar` fills the gap when known; otherwise `auction_date=null` and the lot drops out of "upcoming auction" filters. For existing poisoned rows: `UPDATE lots SET auction_date = (corrected-date) WHERE house = '$slug' AND auction_date > now() + interval '6 months'`. |
| `dense_platform_undercount` | A multi-site PLATFORM family renders its WHOLE catalogue on one page (hundreds of lots, no pagination) and Crawlee+Gemini returns only a token-limited slice (~100 of 800+); recall reads falsely OK because the sentinel only matched ONE of the platform's lot-URL forms. The AuctionHouse UK franchise (auctionhouse.co.uk/{region}, ~33 sites) — London 848 cards on one page, Gemini got ~105, sentinel counted 255 of 848 (missed the `/{region}/auction/lot/{id}` form, only matched `/lot/redirect/{id}`). | Build a DETERMINISTIC platform markdown recogniser (not per-house) — parse every card from the turndown markdown, keyed by lot id; wire to ALL sites on the platform by HOUSE_ROOTS domain via `resolvePlatformRecogniser()` in `lib/scraper/house-recognisers.js` (no per-region entries). Broaden the sentinel to count EVERY lot-URL form (see `AUCTIONHOUSE_SENTINEL`). Capture per-lot status off the card (sold/withdrawn badges) so sold lots never persist as available. Reference: `recogniseAuctionHouseLotsFromMarkdown` in `lib/pipeline/firecrawl-extract.js` (PR #82). London ~105→844 lots, 100% recall, all images. |
| `rolling_url_stale_date` | A house PERSISTS its full catalogue (lots land in `lots`, `scrape_persisted` events fire) but `live_now=0` on the frontend because every fresh lot carries a PAST `auction_date`. **This is NOT a recall/persist bug — the lots are there, they're just hidden by the `auction_date >= today` live filter.** Detection: `SELECT status, count(*), to_char(min(auction_date),'YYYY-MM-DD') mn, to_char(max(auction_date),'YYYY-MM-DD') mx FROM lots WHERE house='$slug' AND last_seen_at > now()-interval '20 min' GROUP BY status;` → all rows share ONE past date. Then `SELECT to_char(date,'YYYY-MM-DD'), status, url FROM auction_calendar WHERE house_slug='$slug' ORDER BY date;` → TWO+ rows on the SAME catalogue URL, an old past one still marked `upcoming` and never retired. The house reuses one rolling URL (e.g. `/current-auction`) across monthly sales. mchughandco 2026-06-13: 271 lots persisted, ALL stamped 2026-05-13 (a month-old sale) while the real auction was 2026-06-30 → live_now=0. | Fixed systemically in `getCalendarDateMap` + pure helper `pickCalendarEntryForUrl` (`lib/pipeline/persist-lots.js`, PR #90): the URL→date map now binds a shared URL to the SOONEST UPCOMING calendar row (today-or-later), falling back to the most-recent past only if none upcoming — replacing the old "earliest date wins" which picked the stalest row. **A re-scrape after deploy re-stamps existing rows automatically (the hygiene-enrich pass re-reads the calendar) — no manual UPDATE needed.** If you must deliver before the deploy lands: `UPDATE lots SET auction_date='<upcoming>' WHERE house='$slug' AND auction_date='<stale>'`. Retiring the stale calendar row (`status='past'`) is optional hygiene — the code now ignores it for URL attribution. |
| `unknown` | None of the above | Do nothing destructive; send Telegram report and stop |

## 3. FIX

### 3a. Merger flow (low-risk, auto-commit)

When `_hasMergerSignal()` fires in `lib/pipeline/healing.js`, the harness already commits the merger and inserts a `house_merged` alert. You finish the job:

1. Run `detectAuctionHouse(newOwnerUrl)` — confirm it maps to an existing tracked slug.
2. If yes:
   - Remove the dead slug from `HOUSE_ROOTS`, `HOUSE_DISPLAY_NAMES`, `AUCTION_DISCOVERY` in `lib/houses.js`.
   - Add an alias clause in `detectAuctionHouse()` so any of the dead house's domains route to the parent slug.
   - Remove the slug from `admin.html` friendly-name maps.
   - Delete stale rows: `lots`, `cached_analyses`, `auction_calendar`, and resolve all open alerts for the slug.
3. If no (new owner not tracked) → insert `merger_detected_unknown` alert + Telegram report. Stop.

This flow is **auto-commit + auto-push** because it cannot duplicate or destroy real lot data.

### 3b. Firecrawl schema / markdown-recogniser rewrite

For `firecrawl_extract_regression`, `theme_distinct`, or any change to `lib/scraper/lot-schema.js`, `lib/pipeline/firecrawl-extract.js`, or `HOUSE_OVERRIDES` in `lib/houses.js`:
1. Confirm the symptom against a live re-scrape (`POST /api/admin/rescrape { slug }` or `node scripts/test-firecrawl-extract.mjs <url>`). DOM snapshots no longer exist — rely on live verification.
2. Decide the layer:
   - JSON extract isn't returning a field → tweak the schema / prompt in `lib/scraper/lot-schema.js`.
   - Markdown has the lots but JSON misses them → add or sharpen a per-house `HOUSE_OVERRIDES[slug].markdownRecogniser(markdown)` in `lib/houses.js` (Pattinson, John Pye are reference implementations).
   - Page is JS-heavy and even markdown is thin → add a Firecrawl `executeJavascript` / scroll action in `HOUSE_SCRAPE_OVERRIDES` (`lib/scraper.js`).
3. Run `npm test` — must be green.
4. **Auto-commit policy** (per user directive):
   - **Auto-commit + push allowed when ALL of these hold** (the "unambiguous fix" gate):
     - Confidence ≥ 0.85 in CLASSIFY.
     - Change is additive or scoped to a single slug (e.g. new `HOUSE_OVERRIDES` entry, refining one regex in a recogniser, adding a single field to the JSON schema).
     - `npm test` is green.
     - No change to scoring logic, pricing math, slug routing, or shared schema fields used by other houses.
     - Lot count from VERIFY is within 80% of last-known-good (or > 0 if no prior baseline).
   - **Confirmation required when ANY of these hold** ("ambiguous"):
     - Confidence < 0.85.
     - Change touches shared code (`lib/scraper/lot-schema.js` core fields, `lib/scraper.js` shared overrides, `lib/houses.js` slug routing, `lib/pipeline/healing.js`).
     - Live re-scrape fails or produces < 80% expected.
   - When in doubt, send the proposal via Telegram and wait. The user explicitly said: auto-commit is welcome where the advantages are unambiguous; when not, ask.

### 3c. Routine maintenance (auto-commit low-risk)

- **Image backfills**: hit `POST /api/admin/backfill-images` with the slug. Auto-commit any helper changes.
- **Cache clears**: hit `POST /api/admin/clear-cache`. No commit needed.
- **Onboarding new houses**: follow `.claude/skills/auction-conventions/references/new-house-playbook.md`. Treat as 3b (confirmation required) because it adds a new DOM extractor.

### 3d. Captcha override

Edit `HOUSE_SCRAPE_OVERRIDES` in `lib/scraper.js`. **Before committing, verify the house's lots are NOT already arriving under a different slug** — query `SELECT DISTINCT house FROM lots WHERE address ILIKE '%<known address>%'`. If they are, classify as merger instead.

## 4. VERIFY (always run)

After every push that changes scraping behaviour:
1. Wait for Railway deploy (typically 60–90s — use `ScheduleWakeup` 90s).
2. Trigger `POST /api/admin/rescrape` with the slug (admin secret in `ADMIN_SECRET` env or known to user).
3. Wait again (~120s for scrape).
4. Query `SELECT count(*) FROM lots WHERE house = $1` and compare to expected (use last-known-good count from `auction_calendar` or git blame on the snapshot).
5. If lot count is within 80% of expected → SUCCESS. Mark relevant `pipeline_alerts` resolved.
6. If lot count is < 50% of expected → ROLLBACK is on the table; send Telegram report and stop.

## 5. REPORT (Telegram, always for ambiguous outcomes)

Send a Telegram message via `lib/telegram.js`. Use `sendHealReport({ slug, cause, confidence, action, verify, decision, evidence, commits })` — it formats the §5 message template for you. Falls back gracefully (returns `false`, never throws) if `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` are not set, so heal sessions never crash on a Telegram outage. Plain text via `sendNotification(html)` is also exported.

**Always Telegram-report when:**
- Confidence < 0.75 in CLASSIFY.
- VERIFY produced < 80% of expected lots.
- A merger was detected but the new owner is not a tracked slug.
- You decided to do nothing because cause = `unknown` or `genuine_zero`.
- Any rollback or revert happened.

**Telegram message format** (HTML, ≤ 4000 chars):
```
<b>🩺 Heal: {slug}</b>
<b>Cause:</b> {cause} (confidence {n.nn})
<b>Action taken:</b> {one-line summary}
<b>Verify:</b> {N} lots scraped (expected ~{M})
<b>Decision needed:</b> {what you want from the user, or "none"}
<b>Evidence:</b>
- {bullet 1 — URL, regex hit, banner text, etc.}
- {bullet 2}
<b>Commits:</b> {sha1, sha2 or "none"}
```

Keep the user out of the loop where possible — **but the Telegram rule above always wins** over silent action.

## 6. LEARN (feed back into this skill)

Every time you fix a new failure mode, before closing the session:
1. Add one row to the CLASSIFY table above with the new signal + default action.
2. If the lesson is a "never do this", add it to **§ Hard rules** below.
3. If the fix added or changed a heuristic in `lib/pipeline/healing.js`, mention the function name in §1 DIAGNOSE.
4. Commit the SKILL.md update in the same push as the fix (`chore: feed {slug} lesson into auction-self-healing skill`).

This is non-negotiable. The skill must compound — each incident makes the next faster.

---

## Crawlee-everywhere playbook (post-Firecrawl, 2026-06-13)

**Firecrawl credits are gone for good.** Crawlee (Puppeteer render → turndown markdown → Gemini-via-OpenRouter extract) is the primary engine for EVERY house: `CRAWLEE_DEFAULT=true` is set in prod, so `engine-router.js` routes Crawlee first (reason `config-default`) with Firecrawl only as a dead fallback. The mission: 100% of every UK house's available+unsold lots on the UI, fully enriched, with real images. These are the load-bearing pieces shipped 2026-06-13 (PRs #75–#85) — do not regress them:

1. **Markdown reaches Gemini WITH images.** `crawlee-extract.js` runs the turndown bridge (`htmlToRecognitionMarkdown`) for EVERY page — `stripHtml` deletes `<img>`, so without this Gemini sees no images (PR #75).
2. **Recogniser corroboration.** On the Crawlee path the per-house/platform recogniser's deterministically-parsed status + image override Gemini's inference for shared lot ids (Gemini smears SOLD/STC on overlay-heavy pages). PR #78.
3. **Status is NOT derived in the detail-page pass.** `enrichLotsFromLotPages` must never set lot status from whole-page text — site chrome ("Sold Archive" nav) fabricates sold/withdrawn. Status = catalogue extraction + recogniser only, pre-auction; sweeps reconcile post-auction. PR #79.
4. **Per-run detail-fetch cap** = `DETAIL_FETCH_CAP_PER_RUN` (80) in `lib/scraper/lot-detail.js`. A platform recogniser can surface 800+ first-contact lots in one scrape; detail-fetching them all BEFORE persist stalled the whole scrape so NONE landed. The cap lets the rest persist now (with catalogue data) and deep-enrich over later cycles. PR #83.
5. **Image recognition runs on OpenRouter vision, not the dead Gemini free tier.** `ai-provider.callVisionAI()` (model `OPENROUTER_VISION_MODEL`, default `google/gemini-2.5-flash-lite`). `image-quality-filter.classifyImage` prefers it when `OPENROUTER_API_KEY` is set; a quota circuit-breaker fails open fast if vision is rate-limited. **DeepSeek/most Nemotron are text-only — a vision default MUST be multimodal.** PR #84/#85.
6. **Host-canonicalise at scrape time.** The DB trigger `trg_normalise_calendar_url` strips `www.`/trailing-slash from `auction_calendar.url`; houses that only serve on `www` (Hollis, Maggs) get `canonicaliseHouseHost()` in `rewriteUrl()`. Recogniser URL regexes are host-tolerant `(?:www\.)?`. PR #77/#81.

**Onboarding a new house / platform to Crawlee (the method that works):**
1. Render the REAL catalogue locally: `PUPPETEER_EXECUTABLE_PATH=<chrome> node` a small script calling `scrapeAllPagesWithCrawlee(url, slug, {maxPages:1})` → `htmlToRecognitionMarkdown`. Study the actual card markdown.
2. If Gemini under-counts a dense page, write a deterministic recogniser in `firecrawl-extract.js` (parse every card → Map keyed by lot id). Per-platform (HOUSE_ROOTS domain) if a template is shared; per-house otherwise.
3. Wire via `HOUSE_RECOGNISERS` (per-house) or `resolvePlatformRecogniser()` (platform); ensure the recall sentinel counts EVERY lot-URL form the page uses.
4. TDD: red→green against a captured markdown fixture; assert status parsing (sold/withdrawn never → available) + lettered lot numbers + both URL forms. Then `npm test`.
5. Deploy, rescrape via `POST /api/admin/rescrape {house}` (needs `x-admin-secret` + `Origin: https://auctions.bridgematch.co.uk`), verify `recall_diagnostic` ~100% and lot count on `/api/all-lots`.

**Railway ops:** a project token (Settings→Tokens) drives deploys/logs without the OAuth 1h expiry — `Project-Access-Token` header on `backboard.railway.com/graphql/v2` to poll `deployments`, or `RAILWAY_TOKEN=<t> railway logs/status`. Auto-deploy on push to main (~2.5min build→live).

**Known open follow-ups (not yet fixed):** (a) first-contact URL churn — franchise re-scrapes flag all ~840 lots first-contact every run, so recogniser `detail_url` ≠ persisted `lots.url` → duplicate rows accumulate (frontend address-dedups for display; lots table bloats; wastes the 80 deep-fetches). Fix: make recogniser URL == persisted URL. (b) image-classify runs on every lot every scrape (cost ≈ $0.00016/img, ~$0.50/cron) — optimise to classify only first-contact/changed images.

---

## Hard rules (never violate)

1. **Never invent a new URL without `detectAuctionHouse()` first.** If the new domain maps to an existing slug → it's a merger, not a URL rotation. Duplicating SDL lots under a fake slug was the Charles Darrow incident.
2. **Never bypass a captcha for a site whose lots are already scraped elsewhere.** Check sibling slugs first.
3. **Always read footer + banner text for merger phrases before assuming URL rotation.** Use the regex set in `lib/pipeline/healing.js` MERGER_PHRASES, but trust your eyes too.
4. **Never `git add -A` or `git add .`.** Add files by name. The 70-file accidental commit (graphify-out, .remember, all_lots.json, email PDFs) must not repeat. `.gitignore` is not a sufficient guard.
5. **Always run `npm test` before push.** Green or push is blocked.
6. **Auto-commit extractor rewrites only when the §3b "unambiguous fix" gate passes.** Otherwise show diff and wait for "push".
7. **Never push to main with `--no-verify` or skip hooks** unless the user explicitly says so.
8. **Never amend commits.** Always create new ones — pre-commit hook failures mean the commit didn't land; `--amend` would mutate the previous one.
9. **Always close the loop on `pipeline_alerts.resolved`** when a fix verifies. Stale alerts pollute the next session's DIAGNOSE.
10. **When in doubt, Telegram + stop.** Better to wake the user than to corrupt lot data or duplicate slugs.
11. **Never short-circuit a two-tier discovery on CSS-class presence alone.** Events listing pages on multi-branch auctioneers (Symonds, John Pye, Stags, LSH, Carter Jonas, Halls, GTH) reuse the same card components as lot pages, so `FeaturedGrid` / `PropertyCard` / similar selectors will be present on the wrong page too. Require an actual `/property/` (or per-house equivalent) href as the lot-bearing signal before treating a page as a catalogue. The Symonds 13-placeholder-card incident (2026-04-25) was caused by exactly this short-circuit.
12. **Always run a sanity sweep across sibling houses when fixing a two-tier mistarget.** A bug in one branch's discovery often hides in others — same code path, different slug. The sanity-sweep snippet in `/fix_lot` (clusters by slug, flags identical-image + town-only-address + zero-bullets) catches the four-symptom signature in one query.
15. **Run the data-integrity sweep on every screenshot-driven session, before assuming the issue is per-house.** A bug that hits one house often hits 3–4 others under the same code path. The standard sweep — three queries that finish in milliseconds:
    ```sql
    -- Hero-image bleed (one image shared across many addresses)
    SELECT lower(house) AS slug, count(*) AS n, count(DISTINCT image_url) AS imgs, count(DISTINCT address) AS addrs
    FROM lots WHERE image_url IS NOT NULL GROUP BY lower(house)
    HAVING count(*) > 3 AND count(DISTINCT image_url) = 1 AND count(DISTINCT address) > 3;
    -- Slug-case duplication
    SELECT lower(house), count(DISTINCT house) FROM lots GROUP BY lower(house) HAVING count(DISTINCT house) > 1;
    -- Retired-slug stragglers (compare against HOUSE_ROOTS keys)
    SELECT DISTINCT lower(house) FROM lots WHERE lower(house) NOT IN (<HOUSE_ROOTS_keys>);
    ```
    Lextons 2026-04-25 was reported as one bug; the sweep surfaced four houses with the same hero-bleed pattern in <1s. Always sweep first. Fix the class, not the instance.
16. **Always reach for Firecrawl on tricky pages and persistently thin data** (user directive 2026-04-25). curl/JSDOM is fine for static HTML, but the moment a page is a JS-rendered SPA, behind anti-bot, lazy-loads images, or returns a too-thin shell (<500 chars visible text, suspicious lot count, missing prices/images across the board), switch to Firecrawl `rawHtml` + `images` + `executeJavascript` immediately rather than fighting the static fetch. Same rule applies to data-richness regressions: if `house_skills.image_coverage < 0.7`, addresses are coming through as town-only, or bullets are empty across many lots, run a Firecrawl probe before assuming the extractor is broken — usually the extractor is fine and the input HTML was malnourished. Budget is a soft cap, not a wall: spend 2–4 credits to confirm a diagnosis instead of guessing.

17. **Always check the latest visual-audit report at the start of a heal session.** Run `npm run audit:visual` (or `POST /api/admin/visual-audit`) before opening any extractor — it's a 1-second pre-flight that surfaces the class of bugs a human would notice while scrolling. Findings land in `audits/visual-audit-{ISO-date}.md` and are upserted as `pipeline_alerts` (event_type `visual_audit_issue`) so they queue alongside the screenshot-driven session. Catches bugs the screenshot didn't show — Lextons hero-bleed (2026-04-25) hit 4 houses but only one user-screenshotted.

    Each heuristic maps to a typical fix path — when a finding fires, this is where to look first:

    | Heuristic | Typical cause | Where to look first |
    |---|---|---|
    | `hero_image_bleed` | Extractor falling back to a banner / logo when the per-lot image selector misses | DOM extractor's image selector — scope it to the lot card, not the page |
    | `slug_case_duplication` | Same house ingested under multiple casings (`Stags` vs `stags`) | Normalise slug via `lower()` at upsert; backfill existing rows |
    | `town_only_address` | Address selector grabbed only the city/town tag, not the full line | Extractor's address joiner — check it concatenates street + town + postcode |
    | `identical_price_wall` | Extractor scraping a hero/banner price applied to every card | Price selector inside the lot-card scope, not page-wide |
    | `guide_tba_wall` | Genuine pre-catalogue period (lots listed without prices yet) — info, not bug | Verify on the live page first; only fix if prices ARE on the page and we're missing them |
    | `bullet_starvation` | Extractor missed the description block | Bullets selector — check it's reading the lot description, not metadata |
    | `image_coverage_low` | Lazy-load not triggered on Firecrawl/Puppeteer | Add scroll/exec actions or escalate to Puppeteer fallback |
    | `image_domain_mismatch` | Cross-house URL leak — image points to a different house's CDN | Verify `image_url` is scoped to the current page's source |
    | `stale_lot_wall` | Catalogue ended but status not updated | Run hygiene wave to mark expired auctions |
    | `duplicate_address_wall` | Same lot ingested twice (dedup key miss) | Check upsert key — usually `(house, lot_url)` or `(house, lot_number, address)` |
    | `cross_house_url_leak` | `detectAuctionHouse()` routing to wrong slug (the stags/bambooauctions bug, 2026-04-25) | Precedence in `lib/houses.js` — specific subdomain matches must come BEFORE generic catch-alls |
    | `retired_slug_straggler` | Old slug rows weren't migrated when house renamed/merged | Manual SQL `UPDATE lots SET house = '<new>' WHERE LOWER(house) = '<old>'`; remove from `HOUSE_ROOTS` |

    Cron is intentionally **not yet enabled** — observe a few manual runs first to confirm noise levels before automating. Promote this table into its own skill if the heuristic count grows past ~20.

## Quick reference: admin endpoints

```
POST /api/admin/rescrape          { slug }              → re-scrape a single house
POST /api/admin/heal              { slug }              → run healing.js for a house
POST /api/admin/clear-cache       { slug? }             → drop cached_analyses rows
POST /api/admin/backfill-images   { slug, limit? }      → run backfillImagesFromLotPages
```

All require header `x-admin-secret: $ADMIN_SECRET`.

## Quick reference: key files

- `lib/houses.js` — HOUSE_ROOTS, HOUSE_DISPLAY_NAMES, HOUSE_OVERRIDES (markdown recognisers), `detectAuctionHouse()`, `rewriteUrl()`
- `lib/scraper.js` — façade re-exporting `lib/scraper/*`; HOUSE_SCRAPE_OVERRIDES live here
- `lib/scraper/lot-schema.js` — Firecrawl JSON-extract schema + prompt (CRITICAL: edit prompt instructions here)
- `lib/scraper/rendering.js` — `scrapeRenderedPage()` three-tier orchestration
- `lib/pipeline/firecrawl-extract.js` — catalogue extractor + ALL markdown recognisers (pattinson, johnpye, mchugh, markjenkinson, maggs, hollismorgan, **auctionhouse platform**)
- `lib/scraper/house-recognisers.js` — `HOUSE_RECOGNISERS` (per-house) + `resolvePlatformRecogniser()` (platform-by-domain) + `houseRecogniser()`; both cron & on-demand resolve through here
- `lib/scraper/recall-sentinels.js` — `RECALL_SENTINELS`, `detectPlatformSentinel()`, `AUCTIONHOUSE_SENTINEL` (both lot-URL forms)
- `lib/scraper/crawlee-extract.js` — Crawlee render→turndown→Gemini path + recogniser recovery/corroboration
- `lib/scraper/lot-detail.js` — `enrichLotsFromLotPages` + `DETAIL_FETCH_CAP_PER_RUN` (per-run detail-fetch cap)
- `lib/ai-provider.js` — `callAI()` (text, provider chain) + `callVisionAI()` (OpenRouter vision for image classification)
- `lib/pipeline/image-quality-filter.js` — OpenRouter-vision-first classifier + quota circuit-breaker
- `lib/pipeline/extractor.js` — Gemini fallback (only fires when Firecrawl JSON returns 0 lots)
- `lib/pipeline/healing.js` — MERGER_PHRASES, `_detectMerger()`, `_commitMerger()`, `healBrokenHouse()`
- `lib/pipeline/persist-lots.js` — hero-bleed guard, slug lowercase normalisation
- `admin.html` — friendly-name map + slug detection (mirror any slug change here)
- `scripts/test-firecrawl-extract.mjs` — manual probe for Firecrawl JSON extract on a single URL
- `scripts/visual-audit.mjs` — automated visual heuristic loop (run before any heal session)
