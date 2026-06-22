# Phase 2a runbook — `lots.house` → `house_slug` (PROPOSE ONLY)

Concrete, staged plan to rename the one dangerous column (`lots.house`, which holds a
*slug* but is named like the *display* columns elsewhere). **Nothing here is applied or
deployed.** Migrations are draft `.sql` files on this branch; code changes are given as
exact diffs to apply on a branch synced with live code. Simon applies the DDL.

**Design lever:** the column is renamed but the **public wire keys `house` / `_house`
stay unchanged** (the RPC aliases `l.house_slug AS house`; the mapper keeps emitting
`_house`). Blast radius stays backend-only. Grounded on the **live** `get_active_lots`
def and live schema (2026-06-22): `lots.house` is `text NOT NULL`, `house_slug` does not
yet exist, sole index is `idx_lots_house`.

---

## Sequence (5 gates — stop & verify at each)

| Gate | Action | Reversible? |
|---|---|---|
| **1** | Apply **step1** migration (add `house_slug` + backfill + mirror trigger + new index). DB-only, no behaviour change. | yes (drop new col) |
| **2** | **Deploy A** (reader code below) **+** apply **step2** migration (RPC → `house_slug AS house`). Reads now come from `house_slug` (== `house` via trigger); wire keys unchanged. | yes (revert code + RPC) |
| **3** | **Soak 7–14 days.** Verify feed parity + zero nulls/mismatches. | — |
| **4** | Apply **step3** migration (`house_slug` → NOT NULL). | yes (drop not null) |
| **5** | **Deploy B** (writer code below) **+** apply **step4** migration (drop trigger/fn/`idx_lots_house`/column `house`). | hard (re-create from house_slug) |

> The mirror trigger means readers (Gate 2) can move before writers (Gate 5) with no
> window where `house_slug` is stale — `house` stays the source until the very end.

---

## Deploy A — reader changes (with Gate 2). All safe pre-drop (use `??` fallbacks).

**1. `lib/types/lot.js:295`** — read new col, fall back to old:
```diff
-    _house: row.house,
+    _house: row.house_slug ?? row.house,   // Phase 2a: prefer house_slug; wire key _house unchanged
```

**2. `routes/search.js`** — the RPC-fallback path (the only direct `lots.house` read):
```diff
@@ ~361 (the .from('lots') fallback select)
-      .select('catalogue_url, house, last_seen_at, auction_id')
+      .select('catalogue_url, house_slug, last_seen_at, auction_id')
@@ ~376
-        house: r.house,
+        house: r.house_slug,
```
(All other `house` refs in search.js ride `lot._house` from the mapper or `cached_analyses.house` — out of scope — so they need no change.)

**3. `scripts/hermes-verify.js` ADAPTER (~line 53)** — one constant fixes all 4 raw-SQL sites:
```diff
-  lotsHouseCol:   'house',             // CORRECTED: was 'auction_house'
+  lotsHouseCol:   'house_slug',        // Phase 2a (was 'house'); drives getHouseLotState/getRecentEvents
```

**4. RPC** — applied as the **step2** migration (`l.house` → `l.house_slug AS house`).

---

## Deploy B — writer change (with Gate 5, the cutover)

**`lib/pipeline/persist-lots.js:371-372`** — write the new column (value is the same canonical slug variable `house`):
```diff
       rows.push({
-        house,
+        house_slug: house,            // Phase 2a cutover: write house_slug; column `house` dropped in step4
         // auctioneer: human-readable house name for display (house stays the slug).
         auctioneer: getHouseDisplayName(house) || null,
```

---

## Reader audit — MUST pass before applying step4 (the drop)

Confirm nothing live still reads `lots.house`. Known readers, all handled by Deploy A:
`get_active_lots` (step2), `lib/types/lot.js` mapper, `routes/search.js` fallback, the
verifier ADAPTER. Then sweep the **live** code (feature branches included):

```bash
# any lots query still naming the old column (should be empty after Deploy A):
grep -rnE "from\('lots'\)[^;]*\bselect\([^)]*\bhouse\b" lib routes      # supabase-js selects
grep -rnE "\bl\.house\b|\blots\.house\b" lib routes migrations          # raw SQL
# dynamic refs a column grep misses:
#   - scripts/hermes-verify.js ADAPTER lotsHouseCol (covered in Deploy A)
#   - lib/types/lot.js:322  set('house', lot._house)  — IF this builder ever inserts lots,
#     switch it to house_slug at Deploy B; verify its call sites first.
```

**Not affected by the drop** (separate columns / couplings — leave alone): `cached_analyses.house`,
`lot_details.house`, `pipeline_alerts.house`, `user_lot_actions.house`, `user_deal_scenarios.house`,
`house_skills.slug` (the join counterpart — still `slug`), and the `event_data->>'house'` JSONB reads
in `scrape_health_24h` / `dormant_sources`.

---

## Verification (read-only) at each gate

- **After step1:** `select count(*) from lots where house_slug is distinct from house;` → 0; and `… where house_slug is null;` → 0.
- **After step2 / Deploy A:** `select json_array_length(get_active_lots());` equals the pre-step2 count; feed still carries key `house`; load the live site and confirm house chips render. Verifier (if run): same gate classification as before.
- **Before step3:** nulls = 0 (the migration self-aborts otherwise).
- **Before step4:** `select count(*) from lots where house is distinct from house_slug;` → 0 (the migration self-aborts otherwise); reader audit grep is empty.

---

## Rollback

- **Gates 1–4:** fully reversible — `house` is still the populated source of truth. Revert the code deploy, re-run the prior RPC def, and drop `house_slug` (each step file has its ROLLBACK block).
- **Gate 5 (post-drop):** the only non-trivial one — re-add `house`, `update lots set house = house_slug`, restore `idx_lots_house`, revert Deploy A+B, re-run step2 RPC with `l.house`. This is why step 5 waits for a clean soak.

---

## Apply order (what Simon runs)

1. Apply `…step1…sql`. Verify.
2. Deploy A code + apply `…step2-rpc…sql`. Verify feed parity. **Soak 7–14d.**
3. Apply `…step3…sql`.
4. Deploy B code + apply `…step4…sql`. Verify. Done — schema is consistent (no column named `house` holds a slug).

I can apply the migrations for you via the Supabase MCP at each gate (you've shown you're
happy to authorise that per-step), or you run them. The code diffs need to land on a
branch synced with live `lib/`/`routes/` — say the word and I'll prepare that PR.
