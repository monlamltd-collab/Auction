#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// scripts/audit-image-validator-unification.mjs
//
// Regression check for fix/unify-image-validator. Sample real lot
// image URLs from prod and compare:
//   (a) the OLD client validator (verbatim copy from public/app.js
//       before this branch — pasted inline below)
//   (b) the NEW unified validator (lib/scraper/validation.js, which
//       re-exports from public/img-validator.js)
//
// Reports:
//   - Newly-passing URLs (the fix — should be > 0): URLs that the
//     OLD client rejected but the NEW unified validator accepts.
//   - Regressions (must be 0): URLs the OLD client accepted but
//     the NEW one rejects. Listed in full so they can be inspected.
//
// Usage: node scripts/audit-image-validator-unification.mjs
//
// Reads URLs via the Supabase MCP from outside this script — the
// caller (Claude / lead) supplies a sample. To keep this script
// runnable standalone too, it accepts a JSON array of URLs from
// stdin or via --sample <path-to-json> for ad-hoc reuse.
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { isValidImageUrl as newIsValid } from '../lib/scraper/validation.js';

// ── OLD CLIENT VALIDATOR (verbatim snapshot from public/app.js
//    pre-branch, line 4260). Includes the junk pre-filter so the
//    comparison is apples-to-apples — without it, every logo/floorplan
//    URL would show up as a "fix" when really only the CDN allowlist
//    drift is being unified.
function oldClientIsValid(url) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https:\/\//i.test(url)) return false;
  if (/floor[\s_-]?plan|floorplan|site[\s_-]?plan|epc[\s_-]?chart|logo|icon|\.svg|placeholder|map[\s_-]?view/i.test(url)) return false;
  if (/\.(jpe?g|png|webp)(\?.*)?$/i.test(url)) return true;
  if (/cloudinary\.com|imgix\.net|cdn\.sanity\.io|amazonaws\.com|cloudfront\.net|googleusercontent\.com|wp-content\/uploads|supabase\.co\/storage|i\.imgur\.com|eigpropertyauctions\.co\.uk|auction|property|lot|catalogue|catalog/i.test(url)) return true;
  return false;
}

// The new isValid does NOT include the junk pre-filter (that lives
// in the client wrapper in public/app.js). To compare like-for-like
// at the user-visible level, mirror the wrapper here.
function newClientIsValid(url) {
  if (!url || typeof url !== 'string') return false;
  if (/floor[\s_-]?plan|floorplan|site[\s_-]?plan|epc[\s_-]?chart|logo|icon|\.svg|placeholder|map[\s_-]?view/i.test(url)) return false;
  return newIsValid(url);
}

function readSample() {
  const sampleArg = process.argv.indexOf('--sample');
  if (sampleArg !== -1 && process.argv[sampleArg + 1]) {
    return JSON.parse(readFileSync(process.argv[sampleArg + 1], 'utf8'));
  }
  // stdin
  let stdin = '';
  try {
    stdin = readFileSync(0, 'utf8');
  } catch {
    // no stdin available
  }
  if (stdin.trim()) return JSON.parse(stdin);
  console.error('Provide a sample via --sample <file.json> or pipe JSON to stdin.');
  console.error('Each entry should be { image_url: string } or just a URL string.');
  process.exit(1);
}

function normalise(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') return item.image_url || item.url || '';
  return '';
}

function main() {
  const raw = readSample();
  const urls = (Array.isArray(raw) ? raw : []).map(normalise).filter(Boolean);
  console.log(`Sample size: ${urls.length} URLs`);

  const newlyPassing = [];
  const regressions = [];
  let bothPass = 0;
  let bothFail = 0;

  for (const url of urls) {
    const oldOk = oldClientIsValid(url);
    const newOk = newClientIsValid(url);
    if (oldOk && newOk) bothPass++;
    else if (!oldOk && !newOk) bothFail++;
    else if (!oldOk && newOk) newlyPassing.push(url);
    else if (oldOk && !newOk) regressions.push(url);
  }

  console.log('');
  console.log('Both pass:        ' + bothPass);
  console.log('Both fail:        ' + bothFail);
  console.log('Newly passing:    ' + newlyPassing.length + '  (the fix — should be > 0)');
  console.log('Regressions:      ' + regressions.length + '  (must be 0)');

  if (newlyPassing.length > 0) {
    console.log('');
    console.log('── Newly-passing URL examples (up to 20) ──');
    for (const u of newlyPassing.slice(0, 20)) console.log('  + ' + u);
  }

  if (regressions.length > 0) {
    console.log('');
    console.log('── REGRESSIONS — must investigate ──');
    for (const u of regressions) console.log('  - ' + u);
    process.exit(2);
  }
}

main();
