#!/usr/bin/env node
// contracts/check.js — Contract-drift CI gate.
//
// For each contract file: loads the main version (`git show main:...`)
// and the HEAD version, then fails the build if a pinned constant has
// changed in a way that would break consumers. Additive changes pass.
//
// See contracts/README.md for the bump procedure + diagnostic playbook.
//
// Exit codes: 0 = pass, 1 = breaking-change violation, 2 = harness error.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE_REF = process.env.CONTRACTS_BASE_REF || 'main';
const TMP = path.join(tmpdir(), `contracts-check-${process.pid}`);
const CONTRACTS = [
  { file: 'contracts/lot.contract.js',             label: 'lot' },
  { file: 'contracts/lot-events.contract.js',      label: 'lot-events' },
  { file: 'contracts/pipeline-events.contract.js', label: 'pipeline-events' },
];

// ─── Load helpers ─────────────────────────────────────────────────────────
function loadMainSource(file) {
  try {
    // execFileSync (no shell) — BASE_REF cannot inject shell metacharacters.
    return execFileSync('git', ['show', `${BASE_REF}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null; // file is new on this branch — first introduction, no diff to check
  }
}
async function loadModule(source, label) {
  mkdirSync(TMP, { recursive: true });
  const p = path.join(TMP, `${label}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(p, source);
  return import(pathToFileURL(p).href);
}

// ─── Comparators (one per failure condition) ──────────────────────────────
// 1. Tables: removed/renamed columns, retyped, nullable → non-nullable.
function compareTable(label, mainTable, headTable, errors) {
  if (!mainTable || !headTable) return;
  const mc = mainTable.columns || {};
  const hc = headTable.columns || {};
  for (const [col, m] of Object.entries(mc)) {
    const h = hc[col];
    if (!h)                                errors.push(`[${label}] table column "${col}" removed or renamed`);
    else if (h.type !== m.type)            errors.push(`[${label}] table column "${col}" type changed ${m.type} → ${h.type}`);
    else if (m.nullable && h.nullable === false) errors.push(`[${label}] table column "${col}" was nullable, now NOT NULL — breaks producers writing null`);
  }
}

// 2. Event type sets: removed/renamed values (additive new values are fine).
function compareValueSet(label, name, mainArr, headArr, errors) {
  if (!Array.isArray(mainArr) || !Array.isArray(headArr)) return;
  const headSet = new Set(headArr);
  for (const v of mainArr) if (!headSet.has(v)) errors.push(`[${label}] ${name}: value "${v}" removed or renamed`);
}

// 3. Per-event-type payload shape: removed/renamed/retyped keys.
// Auto-detects two shapes:
//   - lot-events:      { eventType: { old: {...}, new: {...} } }
//   - pipeline-events: { eventType: {...keys...} }
function comparePayloads(label, mainPayloads, headPayloads, errors) {
  if (!mainPayloads || !headPayloads) return;
  for (const [evType, mainShape] of Object.entries(mainPayloads)) {
    const headShape = headPayloads[evType];
    if (headShape === undefined) continue; // removal of the event_type is caught by compareValueSet
    const isOldNewStyle = mainShape && typeof mainShape === 'object' && ('old' in mainShape || 'new' in mainShape);
    if (isOldNewStyle) {
      for (const slot of ['old', 'new']) compareKeyTypes(`${label}] ${evType}.${slot}`, mainShape?.[slot], headShape?.[slot], errors);
    } else {
      compareKeyTypes(`${label}] ${evType}`, mainShape, headShape, errors);
    }
  }
}
function compareKeyTypes(ctx, mainObj, headObj, errors) {
  if (mainObj == null || headObj == null) return;
  if (typeof mainObj !== 'object' || typeof headObj !== 'object') return;
  for (const [k, mType] of Object.entries(mainObj)) {
    const hType = headObj[k];
    if (hType === undefined)   errors.push(`[${ctx} payload key "${k}" removed or renamed`);
    else if (hType !== mType)  errors.push(`[${ctx} payload key "${k}" type changed ${mType} → ${hType}`);
  }
}

// 4. Lot contract: any change to LOT_COLUMNS_PINNED or LOT_APP_FIELDS_PINNED
//    requires bumping LOT_SCHEMA_VERSION. The lot type is consumed widely
//    enough that version-bumping is mandatory on every modification, not just
//    breaking ones. (For lot-events / pipeline-events the bump is recommended
//    but not enforced on additive changes.)
function compareLotSchemaVersion(MAIN, HEAD, errors) {
  if (!MAIN || !HEAD) return;
  const fieldsChanged =
    JSON.stringify(MAIN.LOT_COLUMNS_PINNED)    !== JSON.stringify(HEAD.LOT_COLUMNS_PINNED) ||
    JSON.stringify(MAIN.LOT_APP_FIELDS_PINNED) !== JSON.stringify(HEAD.LOT_APP_FIELDS_PINNED);
  if (fieldsChanged && MAIN.LOT_SCHEMA_VERSION === HEAD.LOT_SCHEMA_VERSION) {
    errors.push(`[lot] LOT_COLUMNS_PINNED or LOT_APP_FIELDS_PINNED changed but LOT_SCHEMA_VERSION did not bump (still "${HEAD.LOT_SCHEMA_VERSION}")`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────
(async () => {
  const errors = [];
  try {
    for (const { file, label } of CONTRACTS) {
      const mainSource = loadMainSource(file);
      if (mainSource === null) { console.log(`[${label}] new contract — no main version to diff, passing`); continue; }
      if (!existsSync(file))   { errors.push(`[${label}] contract file ${file} deleted in HEAD — breaks consumers`); continue; }
      const MAIN = await loadModule(mainSource, `${label}-main`);
      const HEAD = await import(pathToFileURL(path.resolve(file)).href);
      // Tables (lot_events, pipeline_events only — lot.contract has no table block).
      compareTable(label, MAIN.LOT_EVENTS_TABLE      || MAIN.PIPELINE_EVENTS_TABLE,
                          HEAD.LOT_EVENTS_TABLE      || HEAD.PIPELINE_EVENTS_TABLE, errors);
      // Event type vocabularies.
      compareValueSet(label, 'LOT_EVENT_TYPES_PINNED',      MAIN.LOT_EVENT_TYPES_PINNED,      HEAD.LOT_EVENT_TYPES_PINNED,      errors);
      compareValueSet(label, 'PIPELINE_EVENT_TYPES_PINNED', MAIN.PIPELINE_EVENT_TYPES_PINNED, HEAD.PIPELINE_EVENT_TYPES_PINNED, errors);
      compareValueSet(label, 'LOT_EVENTS_SOURCE_REQUIRED',  MAIN.LOT_EVENTS_SOURCE_REQUIRED,  HEAD.LOT_EVENTS_SOURCE_REQUIRED,  errors);
      // Payload shapes.
      comparePayloads(label, MAIN.LOT_EVENT_PAYLOADS,      HEAD.LOT_EVENT_PAYLOADS,      errors);
      comparePayloads(label, MAIN.PIPELINE_EVENT_PAYLOADS, HEAD.PIPELINE_EVENT_PAYLOADS, errors);
      // Lot-shape column/field sets.
      compareValueSet(label, 'LOT_COLUMNS_PINNED',     MAIN.LOT_COLUMNS_PINNED,     HEAD.LOT_COLUMNS_PINNED,     errors);
      compareValueSet(label, 'LOT_APP_FIELDS_PINNED',  MAIN.LOT_APP_FIELDS_PINNED,  HEAD.LOT_APP_FIELDS_PINNED,  errors);
      // Lot-specific: any modification requires version bump.
      if (label === 'lot') compareLotSchemaVersion(MAIN, HEAD, errors);
    }
  } catch (err) {
    console.error('contracts/check.js: harness error:', err.message);
    rmSync(TMP, { recursive: true, force: true });
    process.exit(2);
  }
  rmSync(TMP, { recursive: true, force: true });
  if (errors.length === 0) { console.log('contracts/check.js: PASS — no breaking contract changes vs', BASE_REF); process.exit(0); }
  console.error(`contracts/check.js: FAIL — ${errors.length} breaking change(s) vs ${BASE_REF}:`);
  for (const e of errors) console.error('  •', e);
  console.error('\nIf this change is intentional, see contracts/README.md for the bump + migration procedure.');
  process.exit(1);
})();
