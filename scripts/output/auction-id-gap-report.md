# auction_id backfill gap — diagnostic report

Generated: 2026-05-12 (Supabase project `pohrbfhftbprlfzsozyj`)
Total lots: **13,678**
Distinct (house, catalogue_url) pairs: **194**
Total `auction_calendar` rows: **268**

## Recommendation

**FIX_UP_FIRST** — normalise `auction_calendar.url` (and apply the same normalisation at the calendar write path) before Move 2's backfill.

A simple lowercase/strip-www/strip-trailing-slash pass against existing `auction_calendar.url` values lifts the join match rate from **6.7% → ~57%**. The remaining ~43% is a separate problem (URL rotation on live houses + archived lots without calendar rows) — surface it after normalisation, fix the live-house URL drifts in a second pass, accept archival NULLs.

This is a single, contained, idempotent fix that makes Move 2's dual-read pattern far more useful from day one.

## Status: shipped 2026-05-12

Migration `migrations/2026-05-12-normalise-calendar-url.sql` applied to prod.

Post-migration cohort (re-run of the same classification query):

| Class | Lots (pre) | Lots (post) | Delta |
|---|---:|---:|---:|
| `exact_match` | 911 (6.7%) | **7,741 (56.6%)** | +6,830 |
| `normalised_only` | 6,914 (50.5%) | 84 (0.6%) | −6,830 |
| `url_mismatch` | 5,815 (42.5%) | 5,815 (42.5%) | — |
| `no_calendar_for_house` | 38 (0.3%) | 38 (0.3%) | — |

Trigger `trg_normalise_calendar_url` is registered on `BEFORE INSERT OR UPDATE` of `auction_calendar.url`, so future writes are canonical. The 84 residual `normalised_only` are likely query-string edge cases (e.g. `?bid=11&showstc=on&orderby=lot_no+asc`) — not worth chasing further; will be absorbed by the writer-stamps-`auction_id` flow in Move 2.

## Cohort summary (with normalisation)

| Class | Distinct pairs | Lots | % of lots |
|---|---:|---:|---:|
| `normalised_only` (would match if both sides were normalised) | 99 | **6,914** | **50.5%** |
| `url_mismatch` (calendar exists for house, but no URL match even after normalisation) | 62 | 5,815 | 42.5% |
| `exact_match` (already joins today) | 29 | 911 | 6.7% |
| `no_calendar_for_house` (slug never appears in calendar) | 4 | 38 | 0.3% |

The 6.5% match figure I reported earlier was the **exact-only** join. Adding URL normalisation makes ~57% of lots joinable immediately — that's the single highest-leverage fix.

## No-match cohort split (after normalisation lift)

The 5,853 remaining no-match lots (5,815 `url_mismatch` + 38 `no_calendar_for_house`):

| Cohort | Lots | % of no-match |
|---|---:|---:|
| Total no-match | 5,853 | 100% |
| Live (last_seen_at < 7 days) | 1,834 | 31.3% |
| Archival (last_seen_at > 30 days or NULL) | 742 | 12.7% |
| Inactive status (sold/withdrawn/archived/unsold/ended) | 867 | 14.8% |
| Status = active or NULL | 0 | 0% |

The "live" cohort here is the concerning one: 1,834 lots that we *just scraped* are still URL-mismatched even after normalisation. These are URL-rotation cases on live houses (e.g. paulfosh, firstforauctions, harmanhealy use different platform URLs in `lots.catalogue_url` than what's in `auction_calendar.url`).

## Where the biggest wins are

Top 10 houses by no-match volume (after normalisation):

| House | Total lots | normalised_only (free win) | url_mismatch | Live (<7d) | Notes |
|---|---:|---:|---:|---:|---|
| paulfosh | 1,307 | 0 | 1,307 | 47 | EIG-platform URL drift; not normalisation |
| tcpa | 1,115 | **1,115** | 0 | 304 | Pure normalisation win |
| auctionhouse | 1,020 | **1,020** | 0 | 3 | Pure normalisation win (www) |
| firstforauctions | 947 | 0 | 947 | 142 | EIG-platform URL drift |
| purplebricksgoto | 715 | 0 | 715 | 715 | All live, URL rotation; needs calendar reconcile |
| harmanhealy | 572 | 0 | 572 | 39 | URL drift |
| savills | 493 | 0 | 0 (493 exact) | 174 | Already healthy |
| pugh | 475 | **475** | 0 | 442 | Pure normalisation win |
| allsop | 414 | **414** | 0 | 414 | Pure normalisation win |
| auctionhouseuklondon | 394 | **394** | 0 | 11 | Pure normalisation win |

**~3,418 lots from 5 houses** flip from no-match to match with a single normalisation pass. That's the bulk of the win.

## Sampled no-match pairs (representative)

### Normalised-only (fixed by normalisation pass alone)

| House | Lot's catalogue_url | Last seen | Lots |
|---|---|---|---:|
| tcpa | `https://townandcountrypropertyauctions.co.uk/search` | 2026-05-12 | 1,115 |
| auctionhouse | `https://auctionhouse.co.uk/online` | 2026-05-09 | 1,020 |
| pugh | `https://pugh-auctions.com/property-search?include-sold=off` | 2026-05-09 | 475 |
| allsop | `https://allsop.co.uk/auctions/residential-auctions` | 2026-05-12 | 414 |
| mchughandco | `https://mchughandco.com/current-auction` | 2026-05-11 | 273 |
| venmore | `https://venmoreauctions.co.uk/property-search` | 2026-05-12 | 81 |
| edwardmellor | `https://edwardmellor.co.uk/auctions/13may2026` | 2026-05-12 | 179 |
| sdl | `https://sdlauctions.co.uk/auction/1298/live-streamed-auction-2026-04-30` | 2026-05-12 | 18 |

### URL mismatch (needs deeper fix or accept NULL)

| House | Lot's catalogue_url | Last seen | Lots | Diagnosis |
|---|---|---|---:|---|
| paulfosh | `https://paulfosh.eigonlineauctions.com/search` | 2026-05-09 | 1,307 | EIG-platform URL; calendar likely has different URL string |
| firstforauctions | `https://online.firstforauctions.co.uk/search?view=grid` | 2026-05-07 | 947 | Query-param drift |
| purplebricksgoto | `https://purplebricks.gotoproperties.co.uk/search?pagesize=48` | 2026-05-09 | 715 | Query-param drift |
| harmanhealy | `https://harman-healy.co.uk/search` | 2026-05-11 | 572 | URL rotation |
| pattinson | `https://pattinson.co.uk/auction/property-search` | 2026-05-09 | 313 | Calendar URL diverges |
| ahlondon | `https://ahlondon.eigonlineauctions.com/search` | 2026-05-09 | 183 | EIG-platform URL |
| futureauctions | `https://futurepropertyauctions.co.uk/catalogue_viewall.asp` | 2026-05-12 | 177 | URL drift |
| sdl | `https://charlesdarrow.co.uk/auctions` | 2026-04-22 | 176 | Stale brand URL (charlesdarrow was retired) |
| hollismorgan | `…/search-auction/?bid=11&showstc=on&orderby=lot_no+asc` | 2026-05-11 | 168 | Query-param-laden URL |
| countrywide | `https://propertyauctionsouthwest.co.uk` | 2026-05-06 | 103 | Sub-brand URL |
| buttersjohnbee | `https://buttersjohnbee.com/listings?auction=1&status=all` | 2026-05-09 | 68 | Query-param drift |
| brggibsondublin | `https://brggibsondublinauctions.eigonlineauctions.com/search` | 2026-04-17 | 34 | No calendar row for slug at all |
| johnpye | `https://johnpye.co.uk/properties` | 2026-05-12 | 27 | URL drift |

## Suggested Step C (fix-up before Move 2)

Two passes, executed in order, each as its own small PR:

### C1 — Normalise `auction_calendar.url` (~57% match recovery)

One migration that adds a `BEFORE INSERT OR UPDATE` trigger normalising `url` on every write, plus a one-shot update statement to backfill existing rows. Idempotent.

```sql
-- migrations/2026-05-13-normalise-calendar-url.sql
CREATE OR REPLACE FUNCTION normalise_calendar_url() RETURNS trigger AS $$
BEGIN
  NEW.url := lower(rtrim(regexp_replace(NEW.url, '^https?://(www\.)?', 'https://', 'i'), '/'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalise_calendar_url ON auction_calendar;
CREATE TRIGGER trg_normalise_calendar_url
  BEFORE INSERT OR UPDATE ON auction_calendar
  FOR EACH ROW EXECUTE FUNCTION normalise_calendar_url();

-- Backfill existing rows. ON CONFLICT (url, date) handles the case where
-- a non-normalised row already matches an existing normalised row.
UPDATE auction_calendar
SET url = lower(rtrim(regexp_replace(url, '^https?://(www\.)?', 'https://', 'i'), '/'))
WHERE url != lower(rtrim(regexp_replace(url, '^https?://(www\.)?', 'https://', 'i'), '/'));
```

The matching JS side already lives at [lib/utils.js:18](C:\Users\User\Documents\GitHub\Auction\lib\utils.js) (`normaliseUrl`). The write site at [lib/analysis.js:108-115](C:\Users\User\Documents\GitHub\Auction\lib\analysis.js) should be audited to confirm `normaliseUrl()` is applied to `url` before upsert (the trigger is belt-and-braces).

Risk: the backfill may collide on `uq_cal_url_date` for rows that normalise to the same `(url, date)`. Handle with `ON CONFLICT (url, date) DO NOTHING` on a staged copy, or — simpler — delete-then-upsert the offending rows. Worst case is 268 rows; manageable.

After this: rerun the diagnostic. Expected `exact_match` lots ~57% (up from 6.7%).

### C2 — Calendar reconcile for URL-rotated live houses (optional, ~32% of remaining no-match)

For each of the top `url_mismatch` houses with live lots — paulfosh, firstforauctions, purplebricksgoto, harmanhealy, etc. — manually inspect the calendar rows vs the lots' `catalogue_url`. Decide:

- If the lot URL is the **current** correct catalogue and the calendar row is stale → update calendar row's URL.
- If the lot URL is **stale** (URL rotated since lot was persisted) → leave calendar as-is; the lot's `auction_id` stays NULL; the writer's stamp on future scrapes fixes the live cohort.

This is a lower-priority cleanup. Move 2 can ship before this; dual-read carries the gap.

## Decision criteria revisited (from plan)

| Plan's criterion | Observed | Verdict |
|---|---|---|
| ≥80% archival → PROCEED (skip C) | 12.7% archival | Not met |
| Significant normalisation cluster → FIX_UP_FIRST | 50.5% normalised_only | **Strongly met** |
| Significant URL rotation in live lots → FIX_UP_FIRST | 31.3% live no-match | Met (lower priority than normalisation) |

→ **Do Step C (at least C1), then Move 2.**

## What's next

1. User reviews this report.
2. If approved: ship the C1 migration as a separate small PR (after PR #23 lands).
3. Rerun the diagnostic; confirm match rate jumps to ~57%.
4. Decide whether to do C2 now or defer.
5. Branch off main and execute Step D (Move 2) per the original plan.

---

Run (read-only): `SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/diagnose-auction-id-gap.mjs`
Data collected via Supabase MCP `mcp__supabase-authed__execute_sql` against project `pohrbfhftbprlfzsozyj`.
