# contracts/

Pinned schemas + value sets that producers and consumers across the codebase depend on. The CI harness (`contracts/check.js`) compares each pinned constant against the `main` branch on every PR and fails the build on breaking changes.

## Why this exists

Before this directory, the producer/consumer pinning was convention-only — a grep, a comment, and a hope. The first real exercise (the `pipeline_events` table landing 2026-05-25) immediately surfaced the gap: nothing would have stopped a contributor from renaming `enrich_uprn_ok` and silently breaking every dashboard. This harness closes that gap.

## What's pinned

| Contract file | Source of truth | What it pins |
|---|---|---|
| `lot.contract.js` | `lib/types/lot.js` | DB column manifest (`LOT_COLUMNS_PINNED`) + camelCase app-side field set (`LOT_APP_FIELDS_PINNED`). |
| `lot-events.contract.js` | `lib/pipeline/lot-events.js` + `public.lot_events` | Table schema, `LOT_EVENT_TYPES_PINNED` vocabulary, per-type payload shapes, required `source` JSONB keys. |
| `pipeline-events.contract.js` | `lib/pipeline/pipeline-events.js` + emit sites in `lib/os-places.js`, `lib/pipeline/persist-lots.js` + `public.pipeline_events` | Table schema, `PIPELINE_EVENT_TYPES_PINNED` vocabulary, per-type `event_data` payload shapes. |

Each contract carries a `*_SCHEMA_VERSION` constant that consumers can read to detect intentional breaking changes.

## Failure conditions enforced

`contracts/check.js` fails the build if **any of these** are true relative to `main`:

1. **Table column** removed, renamed, retyped, or changed from `nullable: true` to `nullable: false`.
2. **Event type** value removed or renamed from a pinned value set.
3. **Payload key** removed, renamed, or retyped within a per-event-type shape.
4. **Lot type** (`LOT_COLUMNS_PINNED` / `LOT_APP_FIELDS_PINNED`) modified — *even additively* — without bumping `LOT_SCHEMA_VERSION`. The lot type is consumed widely enough that every modification is a deliberate event.

Additive changes — new columns, new event types, new payload keys, new optional fields — **pass** without a version bump for `lot-events` and `pipeline-events`. Bumping their `*_SCHEMA_VERSION` on additive changes is still recommended discipline so consumers know to look.

## Bump procedure

### Additive change (new column / new event_type / new payload key)

1. Add the new field/value to the producer (e.g., `lib/pipeline/pipeline-events.js`).
2. Add the same field/value to the relevant contract file in this directory.
3. Optional but recommended: bump `*_SCHEMA_VERSION` (e.g., `1.0.0` → `1.1.0`) so consumers can detect the addition.
4. Commit. CI will pass.

### Breaking change (rename, removal, retype, nullable → non-null)

1. Stop. A breaking change to a pinned contract is a major event. Confirm with the owner before proceeding.
2. Identify every consumer:
   - Producers: `grep -rn "PIPELINE_EVENT_TYPES\." lib/` (or the relevant constant).
   - Consumers: dashboards, views in `migrations/*-views.sql`, observability scripts in `scripts/`.
   - External: anyone reading the table directly.
3. Migrate all consumers in the same PR — the CI gate will block on `main` until they're done.
4. Bump `*_SCHEMA_VERSION` to signal the break (e.g., `1.x.x` → `2.0.0`).
5. Update the contract file.
6. If the change adds CHECK constraints or removes columns from the live table, add a migration under `migrations/` (additive-only patterns: add column, then in a later release drop the old one).
7. Commit. CI will pass once the contract update matches the new producer state and the version is bumped.

### Renaming a contract file

Don't. Add a new contract alongside, migrate consumers, then delete the old one in a separate release.

## Running the check locally

```bash
node contracts/check.js                     # compare HEAD vs main
CONTRACTS_BASE_REF=origin/main node contracts/check.js
CONTRACTS_BASE_REF=HEAD~1     node contracts/check.js   # what would this commit break?
```

The check is also wired into `.github/workflows/test.yml` and runs on every PR.

## What this harness deliberately does NOT do

- It does not verify the **live database schema** matches the contract. Migrations + the producer wrapper handle that; the contract pins the shape, not the runtime state. The next regression that warrants schema-vs-contract drift detection (e.g., a manual ALTER in Supabase) can add that check later.
- It does not check **payload values** at runtime. Producers should assert their own preconditions; the contract is a compile-time / pre-merge gate.
- It does not enforce **additive-change version bumps** on `lot-events` or `pipeline-events`. Only `lot` enforces this, because only the lot type is consumed by every layer.
