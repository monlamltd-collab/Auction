/**
 * Multi-image-sweep — structural tests.
 *
 * The fair-share function itself is exercised in test-post-auction-sweep.js
 * (single source of truth, imported here). The pure image primitives
 * (extractImagesFromHtml, stripBleedImages) are exercised behaviourally in
 * test-image-extract.js. This file locks the SWEEP WIRING: the two-pass flow
 * (cooldown-free cache reconcile + skipCache live fetch), the generic
 * shared-image strip, fair-share + wall-clock guards, and the end-to-end
 * exposure of the `images` field.
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

console.log('multi-image-sweep — two-pass flow, guards, generic strip');
{
  const src = readFileSync(join(here, '..', 'lib', 'pipeline', 'multi-image-sweep.js'), 'utf8');

  // Shared, house-agnostic primitives (no inline duplicate regex/junk logic).
  assert(/import\s*\{\s*extractImagesFromHtml,\s*computeBleedByHouse,\s*dechromeGallery\s*\}\s*from\s*['"]\.\/image-extract\.js['"]/.test(src),
    'image primitives imported from the shared pure module (DRY, no per-file copy)');

  // PASS 1 — cooldown-free cache reconciliation (the fix for the locked
  // no_images_found backlog).
  assert(/loadFreshCache\(/.test(src),
    'PASS 1 batch-reads fresh lot_details cache (loadFreshCache)');
  assert(/cooled\.push\(lot\)/.test(src) && /fresh\.push\(lot\)/.test(src),
    'candidates split into cooled (cache-only) vs fresh (live fetch) by cooldown');
  assert(/reconciledFromCache/.test(src),
    'cache reconciliation is counted in stats (observability)');

  // PASS 2 — live fetch never trusts a possibly-stale cache.
  assert(/skipCache:\s*true/.test(src),
    'live fetch uses skipCache:true so a stale imageless cache cannot drive a false no_images_found');

  // Generic shared-image guard (gallery hero-bleed analogue) — unified cleaner
  // with the never-blank-via-bleed guard, shared with the retroactive endpoint.
  assert(/computeBleedByHouse\(/.test(src) && /dechromeGallery\(/.test(src),
    'per-lot dechromeGallery + per-house bleed applied before persist (no per-house code)');

  // Throughput: cap raised now Firecrawl is out of this fetch path.
  assert(/SWEEP_BATCH_LIMIT\s*=\s*500/.test(src),
    'live-fetch cap raised to 500 (FC spend no longer in this path; wall-clock is the real guard)');
  assert(/SWEEP_WALL_CLOCK_MS\s*=\s*30 \* 60_000/.test(src),
    'wall-clock budget = 30 minutes (the actual safety, not row count)');
  assert(/SWEEP_FETCH_POOL\s*=\s*1500/.test(src),
    'DB fetch pool keeps headroom for fair-share round-robin');
  assert(/import\s*\{\s*fairShareByHouse\s*\}\s*from\s*['"]\.\/post-auction-sweep\.js['"]/.test(src),
    'fairShareByHouse imported from post-auction-sweep — single source of truth');
  assert(/fairShareByHouse\(fresh,\s*SWEEP_BATCH_LIMIT\)/.test(src),
    'fair-share applied to the fresh (not-cooled) fetch set');
  assert(/wallClockBailed/.test(src),
    'stats expose wallClockBailed flag for dashboards');
}

console.log('\nimages field exposed end-to-end');
{
  const lotTypes = readFileSync(join(here, '..', 'lib', 'types', 'lot.js'), 'utf8');
  assert(/'image_url',\s*'images',/.test(lotTypes),
    'LOT_COLUMNS includes images column adjacent to image_url');
  assert(/images:\s*Array\.isArray\(row\.images\)\s*\?\s*row\.images\s*:\s*\[\]/.test(lotTypes),
    'dbRowToLot maps images with safe array fallback');

  const searchRoute = readFileSync(join(here, '..', 'routes', 'search.js'), 'utf8');
  assert(/images:\s*Array\.isArray\(r\.images\)\s*\?\s*r\.images\s*:\s*\[\]/.test(searchRoute),
    '/api/all-lots inline mapper exposes images so the carousel can render');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
