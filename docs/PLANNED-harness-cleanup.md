# PLANNED — Harness cleanup (Step 3 of Path 1)

**Status:** captured for execution after the **manager-on-failure** trigger
(shipped 2026-05-02) has had ~4 weeks of `manager_cycles` data showing
whether the lower-cost cadence is sufficient.

**Trigger date:** 2026-05-30. A scheduled remote agent will fire on that
date to re-evaluate this plan, propose the right shape, and notify the
user. Plan-mode session expected after that ping.

**Why we waited:** Path 1 (the user's choice) said: "ship the cheap fix
now, the real feature work next, the architectural cleanup last with
data." Doing the cleanup before the data is in means deciding without
evidence. Doing it after means the decision is obvious.

---

## Decision context

The architectural insight from the conversation that produced this plan:

- **Stable-state inputs** (alert dedup, circuit breakers, quality
  thresholds, schema validation) don't need agents — they're plain
  validators with shared state.
- **Dynamic-state inputs** (broken extractors, redesigned auction
  sites, new houses) genuinely benefit from AI judgement.
- The "manager" was conceptual leftover from an "agents" framing that
  never matched what got built. The orchestration concept is real and
  in code (`lib/harness/manager.js`); the 6 named agents in the old
  CLAUDE.md were aspirational and never became real skills.

**Open question** (which the 4-week data answers): with the on-failure
trigger, does the manager **ever** fire usefully? If `manager_cycles`
shows the manager regularly queues actions in response to real alerts,
keep it. If the trigger fires but the manager just produces empty
cycles, delete it.

---

## What to look at first (the data)

Before executing, run these queries against Supabase:

```sql
-- 1. How often did the on-failure trigger fire in the last 30 days?
SELECT count(*) AS total_cycles
FROM manager_cycles
WHERE created_at > now() - interval '30 days';

-- 2. Of those cycles, how many actually queued actions (vs sat idle)?
SELECT
  count(*) FILTER (WHERE jsonb_array_length(actions_taken) > 0) AS productive,
  count(*) FILTER (WHERE jsonb_array_length(actions_taken) = 0) AS empty,
  count(*) AS total
FROM manager_cycles
WHERE created_at > now() - interval '30 days';

-- 3. What did the productive cycles do?
SELECT
  jsonb_array_elements(actions_taken)->>'type' AS action_type,
  count(*) AS n
FROM manager_cycles
WHERE created_at > now() - interval '30 days'
  AND jsonb_array_length(actions_taken) > 0
GROUP BY action_type
ORDER BY n DESC;

-- 4. Did effectiveness scores trend upward (manager learning) or
--    flat-line / drop (manager not adding value)?
SELECT
  date_trunc('week', created_at) AS week,
  avg(effectiveness_score) AS avg_eff,
  count(*) AS cycles
FROM manager_cycles
WHERE created_at > now() - interval '60 days'
GROUP BY 1 ORDER BY 1 DESC;
```

**Decision rule:**

- If **productive / total ≥ 30%** AND average effectiveness ≥ 0.5 →
  manager is doing real work. **Keep** it (failure-triggered shape) and
  proceed with the file flatten below.
- If **productive / total < 30%** OR average effectiveness < 0.5 →
  manager isn't earning its complexity. **Delete** the manager file
  entirely. AI capabilities (`healBrokenHouse`, `generateExtractor`,
  `discoverNewHouses`) get called directly by their specific failure
  events without an orchestrator.

---

## The cleanup map (assuming "keep manager, flatten the rest")

This is Scenario A from the original conversation. Each module's fate
is decided here so future-Claude doesn't have to re-think.

| Module | Fate | Reasoning |
|---|---|---|
| `alert-router.js` | **Keep** in `lib/harness/` | Shared state (dedup map, escalation map, count cache). Can't safely flatten. |
| `house-health.js` | **Keep** | Per-house circuit-breaker state shared across many call sites. Can't flatten. |
| `quality-gate.js` | **Keep** | Central definition of pass/fail thresholds + cross-cutting `checkEndedLotRatio` and `checkCalendarDateSanity`. |
| `regression-detector.js` | **Keep** | Central definition of what "regression" means; called from persist-stage. Stays as an importable function. |
| `data-contract.js` | **Flatten into `lib/pipeline/persist-stage.js`** | Stateless rule-checker. `validateLot()` and `validateBatch()` become 5-10 lines inline in persist-stage. Unique checks (price normalisation, tenure abbrev expansion, gap detection) get migrated into the persist flow as named helper functions. |
| `enrichment-engine.js` | **Audit before deciding** | Has `enrichBatch()` for cross-lot inference + `getEnrichmentReport()`. If actively used, keep; if dormant, delete. Use `grep -rn enrichBatch` to confirm callers. |
| `extractor-generator.js` | **Move to `lib/dynamic/extractor-gen.js`** (or keep in harness) | Genuine AI capability for dynamic data. The "harness" naming is a misnomer; rename namespace if convenient but don't bother if it adds churn. |
| `house-discovery.js` | **Move to `lib/dynamic/discovery.js`** (or keep) | Same reasoning. |
| `sub-agents.js` | **Split** | Keep `auditDataQuality` and the status-drift functions (`auditStatusDrift`, `pickNextHouseForDrift`, `initStatusDrift`) as standalone exports. Delete the rest if exported-but-uncalled (verify each via grep). |
| `manager.js` | **Keep but slim down** | After 4 weeks of data: if it's productive, keep the failure-triggered shape and slim to ~300 lines (split out dashboard building + AI reasoning if needed). If unproductive, delete. |

**If "delete manager" wins**: also delete `manager_cycles` table writes and the `runManagerCycle` import in `routes/admin.js:1029` (or repoint the admin endpoint to a no-op + warning).

---

## File-by-file actions (per the table above)

### 1. `lib/harness/data-contract.js` → flatten

```bash
# Verify all callers — there should be exactly two:
grep -rn "validateLot\|validateBatch" lib/ routes/ tests/
```

Move `validateLot(lot)` and `validateBatch(lots)` into
`lib/pipeline/persist-stage.js`. Helper functions used by them
(`normalizePrice`, `normalizeTenure`, `detectGaps`) become private
helpers in the same file.

Migrate `tests/test-harness.js` data-contract section into
`tests/test-persist-stage.js` (create if it doesn't exist).

Delete `lib/harness/data-contract.js`.

### 2. `lib/harness/sub-agents.js` → split

```bash
# Find what's actually used:
grep -rn "auditDataQuality\|auditStatusDrift\|pickNextHouseForDrift\|initStatusDrift\|gatherDataQualityMetrics" lib/ routes/ server.js
```

Functions to keep (move to `lib/audits.js` or similar — drop the
"sub-agents" name):
- `auditDataQuality` (called from manager + admin route)
- `initStatusDrift`, `auditStatusDrift`, `detectSourceStatus` (called from server.js scheduler)
- `pickNextHouseForDrift` — verify usage; may already be moved to `lib/pipeline/drift-scheduler.js`
- `gatherDataQualityMetrics` — verify if dashboard uses it

Functions to delete (already removed `auditLotFreshness` in 5dc5f3c;
verify nothing else is dead):
- Any export that grep returns zero hits for outside the file itself.

Update imports in callers.

### 3. `lib/harness/enrichment-engine.js` → audit then decide

```bash
grep -rn "enrichBatch\|getEnrichmentReport" lib/ routes/ tests/
```

If only the manager calls `enrichBatch` and we're slimming the manager,
this might be dead too. If actively used (e.g. by admin route, or if
the manager retains it as a fallback enrichment path), keep — but
move into `lib/enrichment/` directory alongside the per-source files.

### 4. `lib/harness/extractor-generator.js`, `house-discovery.js` → optional rename

Both are genuine AI capabilities. They CAN stay in `lib/harness/`
(naming is fine if you accept "harness = anything that helps the
pipeline self-correct") OR move to `lib/dynamic/` to make the
distinction explicit. **Recommendation: leave alone unless renaming
brings clarity**. Naming churn for its own sake isn't worth it.

### 5. `lib/harness/manager.js` → keep slim or delete (4-week data decides)

If kept, target ~300 lines. Possible splits:
- `manager-dashboard.js` — `buildManagerDashboard()`, ~150 lines
- `manager-reasoning.js` — Gemini-backed reasoning, ~150 lines
- `manager.js` — cycle orchestration, ~250 lines

If deleted:
- Remove `_deps.runManagerCycle` calls from `lib/analysis.js` (the
  manager-on-failure gates we shipped become no-ops or get removed).
- Repoint `POST /api/manager/cycle` admin endpoint to a 410 Gone
  response (or remove the route).
- AI capabilities (heal, generate, discover) get called directly:
  - `healBrokenHouse` already called inline from autoAnalyseAll on
    0-lot regression. Keep.
  - `generateExtractor` would need a new trigger — propose: when a
    regression alert is opened with `extractor_regression`, fire the
    generator inline (with confidence gate from `auction-self-healing`
    skill).
  - `discoverNewHouses` is currently only exposed via admin manual
    trigger. Keep that pattern — no auto-discovery without the manager.

---

## Test migration plan

- `tests/test-harness.js`:
  - Keep: alert-router, house-health, quality-gate, regression-detector
    sections (they cover what stays).
  - Migrate to `tests/test-persist-stage.js`: data-contract validateLot
    + validateBatch tests (~50 cases per current count).
  - Delete: enrichment-engine tests if module is deleted.
  - Update: extractor-generator + house-discovery tests if they move
    files.
  - Decide: manager tests stay if manager stays, delete if manager
    deleted.

- New tests to add:
  - `tests/test-persist-stage.js` — covers the migrated validation
    rules + the existing persist-stage logic.

- Run `npm test` — should still be 100% green after migration. Net
  test count should stay roughly the same; just redistributed.

---

## Rollback plan

Each step is a discrete commit:

1. Commit 1: Flatten `data-contract.js` into `persist-stage.js`. Tests
   migrated. If anything breaks, revert this commit only.
2. Commit 2: Split `sub-agents.js`. If a caller is missing, revert.
3. Commit 3 (optional): Audit + delete `enrichment-engine.js`. Revert
   if any consumer surfaces.
4. Commit 4 (decided by 4-week data): Slim or delete manager.

Each commit is independently revertable. Whole effort can be unwound
in 4 reverts if it goes wrong.

---

## Success criteria

After the cleanup lands:
- `lib/harness/` has 4-5 files (down from current 10), each holding
  shared state.
- `tests/test-harness.js` covers only the modules that remain in
  `lib/harness/`.
- Architecture map (`docs/ARCHITECTURE.md`) updated with the new layout.
- CLAUDE.md scoring/architecture sections still accurate.
- No regressions: `npm test` green, `manager_cycles` data continues
  to look healthy (productive cycles continue, effectiveness stable
  or improving).

---

## What NOT to do (lessons from prior cleanups)

- **Don't rename for the sake of it.** The "harness" name is fine if
  the directory holds shared-state modules. Don't churn imports across
  20 files just to say `lib/validators/` instead.
- **Don't delete a module without grep-confirming zero callers.**
  `auditLotFreshness` was safe to delete; verify the same for any
  other candidate.
- **Don't merge this cleanup with feature work.** Path 1 deliberately
  separates "internal hygiene" from "investor value" so each can be
  reviewed and reverted independently.

---

## When this fires (next steps)

1. The scheduled remote agent runs on **2026-05-30 at 08:00 UTC**.
2. It pulls the queries above, makes a recommendation, and notifies
   the user.
3. The user opens a fresh plan-mode session referencing this file.
4. The plan executes the items above as discrete commits.
5. Estimated effort: ~2 days of focused work for the full Scenario A
   shape, ~1 day if the data tells us to delete the manager outright.
