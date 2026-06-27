# HOUSE_KEY_PLAN.md — House-identifier standardisation (PROPOSE ONLY)

**Status:** proposal for review. **Nothing here has been executed.** Phase 2 of the
hermes-verifier work. Author: Opus 4.8, 2026-06-22.

**Standing rules honoured:** no DDL run; no column renamed/dropped; all steps additive
and reversible. **Out of scope:** dropping any "vestigial" table (`auction_houses` is
barely used, but names aren't usage evidence — it is left alone).

Evidence base: Phase 0 live `information_schema` + value sampling; a DB-object scan
(views/RPCs/FKs); and a 7-agent code map of every read/write site (`lib/`, `routes/`,
`public/`, `migrations/`, the verifier).

---

## 1. TL;DR recommendation

Adopt **one canonical pair across all four tables**:

| Concept | Canonical column | 
|---|---|
| machine slug (`acuitus`) | **`house_slug`** |
| human display name (`Acuitus`) | **`house_name`** |

But **the only column whose *current name* is actively dangerous is `lots.house`** — it
holds a *slug* yet is named `house`, the same name every other table uses for the
*display name*. So the recommendation is **phased**:

- **Phase 2a (recommended — fixes the actual hazard):** rename **`lots.house` → `house_slug`**. After this, *no column named `house` ever holds a slug.* The schema becomes consistent in meaning even before any cosmetic renames.
- **Phase 2b (optional polish):** `house_skills.slug → house_slug` (it's a PRIMARY KEY) and the display columns `house_skills.house` / `auction_calendar.house` → `house_name`, for full name symmetry.
- **Already canonical:** `auction_calendar.house_slug` — no change.
- **Vestigial:** `auction_houses.slug` / `.name` — 0 readers/writers, not even in repo DDL. Leave as-is (out of scope to drop).

**Key design lever (shrinks the blast radius to backend-only):** *rename the column but
keep the public wire keys `house` / `_house` unchanged*, by aliasing in the
`get_active_lots` RPC (`l.house_slug AS house`) and in the `lib/types/lot.js` mapper.
The browser contract never changes.

---

## 2. Current state — the inconsistency

| Table | Slug column | Display column | Notes |
|---|---|---|---|
| `lots` | **`house`** ⚠️ | (none — display derived from `HOUSE_DISPLAY_NAMES[slug]` constant) | the dangerous outlier |
| `house_skills` | `slug` (PK) | `house` | slug & display both present |
| `auction_calendar` | `house_slug` ✅ | `house` | already canonical slug name |
| `auction_houses` | `slug` (hyphenated, e.g. `savills-auctions`) | `name` | 3 rows, vestigial |

**Wider footprint (from the DB scan — beyond the 4 named tables):** the same slug value
also lives as a `house` column in `cached_analyses`, `lot_details`, `pipeline_alerts`,
`user_lot_actions`, `user_deal_scenarios`, as `subject` in `hermes_findings`, as `slug`
in `house_homepage_watch`, and inside `analytics_snapshots` JSONB aggregates — plus 3
views (`scrape_health_daily`, `scrape_health_24h`, `dormant_sources`) and the
`get_active_lots` RPC. The plan scopes the **4 named tables**; this list is flagged so the
true reach is visible.

**FKs are safe:** `lots` / `catalogue_snapshots` / `pipeline_events` reference
`auction_calendar` by the surrogate **`id`**, not by the house text. A slug rename does
**not** touch referential integrity.

---

## 3. The hazard (why bother)

The literal column name **`house` means a slug in `lots` but a display name in
`house_skills` / `auction_calendar`.** A developer (or a cheap model, or a future
Claude session) joining or filtering on "house" will silently mismatch — e.g. the
`hermes-verify.js` health gate joins `house_skills.slug = lots.house` precisely because
joining on `house_skills.house` (display) would match almost nothing (Phase 0: 2 vs 153).
This is a latent footgun that has already cost investigation time.

---

## 4. Blast radius per column

| Column | Role | Reads | Writes | Frontend key | Risk |
|---|---|---|---|---|---|
| `lots.house` | slug | 21 | `persist-lots.js:372` (`canonicaliseHouseSlug`); migration `2026-05-05-fix-leaked-display-name-slugs` | `_house` + raw `house` (RPC `json_agg` key) | **HIGH — hardest** |
| `house_skills.slug` | slug (PK) | 14 | upserts `house-skills.js:84/106`, `telegram-actions.js:139`; all others `.eq('slug')` | `slug` (admin) | **HIGH** |
| `auction_calendar.house_slug` | slug | 17 | 11 app sites + ~40 migration literals | `houseSlug` | **HIGH** (already canonical name) |
| `auction_calendar.house` | display | 5 | co-written with `house_slug` everywhere | `house` | MED |
| `house_skills.house` | display | 2 | `house-skills.js:84` only | `house` (admin only) | LOW |
| `auction_houses.slug` | slug | 0 | — | none | LOW (vestigial) |
| `auction_houses.name` | display | 0 | — | none | LOW (orphan) |

**`lots.house` is the hardest** because it is projected by **9 historical versions of the
`get_active_lots()` RPC** into the public JSON feed (key `house`), bridges to the
frontend via the `_house` contract (`lib/types/lot.js:295/322`), and is referenced
**dynamically** in the verifier ADAPTER.

### 4.1 Grep-invisible traps (a naive find-and-replace WILL miss these)
1. **Verifier ADAPTER** (`scripts/hermes-verify.js`): `lotsHouseCol:'house'` and `healthJoinCol:'slug'` are *string values* interpolated into raw SQL (`where ${a.lotsHouseCol}=$1` at lines ~80/91/143; `${a.healthJoinCol}` at ~130). Updating the two ADAPTER constants fixes all four SQL sites — this is the single chokepoint to change for the verifier.
2. **View alias** `scrape_health_daily`: `ac.house_slug AS house` — the *output* name `house` is a consumer contract, distinct from the source column.
3. **JSONB reads** `scrape_health_24h` / `dormant_sources`: `event_data->>'house'` — reads the slug from a JSONB key written by pipeline code, **not** from `lots.house`. Coupled to the writers' JSON key; must be kept in sync **separately** (do not assume a column rename touches it).
4. **Runtime slug producer** `routes/calendar.js:60`: derives `house_slug` by slugifying `auction.house` (`toLowerCase().replace(/[^a-z0-9]/g,'')`) — an implicit slug source invisible to a column grep.
5. **Slug *values*** in `lib/houses.js` (`HOUSE_ROOTS`/`HOUSE_DISPLAY_NAMES` keys, `detectAuctionHouse`/`rewriteUrl` if-chains, `RETIRED_HOUSES`): out of scope for a *column* rename, but the same grep-invisibility class — flagged so a future "change a slug value" task knows the reach.

---

## 5. Migration strategy — staged, reversible (never a hard rename)

Applied first to **`lots.house → house_slug`** (Phase 2a). Same recipe re-used for any
Phase 2b column.

> **Why staged beats lockstep:** the three slug columns form an app-level (no-FK)
> equality chain (`lots.house = house_skills.slug`; `auction_calendar.house_slug` joins
> `lots` on `(house_slug,url)`). A *hard* rename would force all three to move in one
> transaction or joins silently return **empty rows with no error**. The add→backfill→
> dual-write→dual-read→drop recipe keeps both old and new columns populated throughout,
> so each column migrates **independently and safely**, and any single missed reader
> fails loudly (column-not-found) rather than silently.

**Step 1 — ADD (additive, reversible).**
```sql
alter table lots add column house_slug text;            -- nullable for now
```

**Step 2 — BACKFILL.**
```sql
update lots set house_slug = house where house_slug is null;
```

**Step 3 — DUAL-WRITE (belt-and-braces).**
- App: `persist-lots.js:372` writes **both** `house` and `house_slug`.
- DB safety net (covers any missed writer): a `before insert/update` trigger
  `new.house_slug := coalesce(new.house_slug, new.house)` (and keep them equal).
- Soak until every write path is confirmed populating both.

**Step 4 — DUAL-READ → cut reads over (keep the wire contract):**
- `get_active_lots()`: change `l.house` → `l.house_slug`, **aliased `AS house`** so the
  emitted JSON key is unchanged. (Only the *current* function version matters; the 8
  historical versions are inert.)
- `lib/types/lot.js` `dbRowToLot`: read `row.house_slug`, keep emitting `_house`/`house`.
- Verifier ADAPTER: `lotsHouseCol:'house'` → `'house_slug'` (one line; fixes all 4 SQL sites).
- Recreate index: `idx_lots_house` → on `house_slug`.
- `routes/search.js` `buildAllLotsResponse` `sources[]` / `data.house` header: read `house_slug`, emit `house`.
- **Leave the JSONB `event_data->>'house'` reads alone** (separate coupling — trap #3).

**Step 5 — ENFORCE.** Once dual-write is proven and all readers use `house_slug`:
```sql
alter table lots alter column house_slug set not null;
```

**Step 6 — DROP-OLD (after a soak window, e.g. 7–14 days).**
```sql
drop trigger ... ; alter table lots drop column house;
```
Do **not** rewrite already-run historical migrations (e.g. `2026-05-05-…`); just ensure
no **live** code path references `lots.house` before this step.

**Phase 2b (optional, same recipe):** `house_skills.slug → house_slug` additionally needs
the PRIMARY KEY constraint recreated and the ADAPTER `healthJoinCol` + every `.eq('slug')`
updated; display columns `→ house_name` are low-risk repeats. Recommend only after 2a soaks.

---

## 6. Rollback

- **Before Step 6 (drop):** fully reversible at any point — revert the readers (old `house`
  column is still dual-written), then `alter table lots drop column house_slug;`. No data loss.
- **After Step 6:** re-add and backfill from the new column:
  ```sql
  alter table lots add column house text;
  update lots set house = house_slug;
  -- revert readers/RPC/ADAPTER to 'house'
  ```
- Keep the 7–14 day soak specifically so a rollback never needs the post-drop path.

---

## 7. Recommended sequencing & open questions

**Recommended scope:** do **Phase 2a (`lots.house → house_slug`) only**, as one
migration + deploy that ships the column DDL, the live `get_active_lots` rewrite, the two
views' touch-points, the `lib/types/lot.js` mappers, and the verifier ADAPTER constant
**together**. That removes the hazard with a backend-only, wire-compatible change. Treat
2b as deferred polish.

**Decisions for you:**
1. **Scope:** Phase 2a only (recommended), or full 2a+2b canonicalisation?
2. **Canonical display name:** keep display columns as `house` (already consistent), or rename to `house_name` for symmetry? (Recommend: keep `house` — renaming display is cost without hazard.)
3. **`auction_houses`:** confirm leave-as-is (vestigial, out of scope to drop).
4. When ready, I can draft the **actual migration SQL + the code diff** for Phase 2a as the next proposal (still propose-only — you apply the DDL).
