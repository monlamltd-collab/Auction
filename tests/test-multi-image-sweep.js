/**
 * Multi-image-sweep — structural tests.
 *
 * The fair-share function itself is exercised in test-post-auction-sweep.js
 * (single source of truth, imported here). This file locks the wiring —
 * cap raised from 50 to a meaningful number, wall-clock budget present,
 * fair-share imported and applied, plus the integration checks that the
 * `images` field is now exposed end-to-end (LOTS_SELECT, mappers, RPC
 * not checked here — that's a live-DB query we ran during diagnosis).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); pass++; }
  else { console.error(`  FAIL: ${msg}`); fail++; }
}

console.log('multi-image-sweep — cap raised + wall-clock + fairness');
{
  const src = readFileSync(join(here, '..', 'lib', 'pipeline', 'multi-image-sweep.js'), 'utf8');
  assert(/SWEEP_BATCH_LIMIT\s*=\s*1000/.test(src),
    'batch limit raised from 50 to 1000 (10k-lot backlog clears in ~2-3 weeks)');
  assert(/SWEEP_WALL_CLOCK_MS\s*=\s*30 \* 60_000/.test(src),
    'wall-clock budget = 30 minutes (the actual safety, not row count)');
  assert(/SWEEP_FETCH_POOL\s*=\s*5000/.test(src),
    'DB fetch pool widened so fair-share has variety to round-robin across');
  assert(/import\s*\{\s*fairShareByHouse\s*\}\s*from\s*['"]\.\/post-auction-sweep\.js['"]/.test(src),
    'fairShareByHouse imported from post-auction-sweep — single source of truth');
  assert(/eligible\s*=\s*fairShareByHouse\(eligibleAll,\s*SWEEP_BATCH_LIMIT\)/.test(src),
    'fair-share applied AFTER cooldown filter, BEFORE the fetch loop');
  assert(/wallClockBailed/.test(src),
    'stats expose wallClockBailed flag for dashboards');
}

console.log('\nimages field exposed end-to-end');
{
  const lotMappers = readFileSync(join(here, '..', 'lib', 'pipeline', 'lot-mappers.js'), 'utf8');
  assert(/image_url,\s*images,/.test(lotMappers),
    'LOTS_SELECT includes images column (was deliberately held out historically)');
  assert(/images:\s*Array\.isArray\(r\.images\)\s*\?\s*r\.images\s*:\s*\[\]/.test(lotMappers),
    'dbRowToFrontendLot maps images with safe array fallback');

  const searchRoute = readFileSync(join(here, '..', 'routes', 'search.js'), 'utf8');
  assert(/images:\s*Array\.isArray\(r\.images\)\s*\?\s*r\.images\s*:\s*\[\]/.test(searchRoute),
    '/api/all-lots inline mapper exposes images so the carousel can render');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
