#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// scripts/recogniser-coverage.mjs — audit a house's markdown recogniser
// against THE 100% COMMANDMENT.
//
// Renders the catalogue ONCE (Crawlee, the production path), counts the lot
// IDs the recall sentinel advertises, runs the deterministic recogniser, and
// reports recall + WHICH sentinel IDs the recogniser missed, with a markdown
// snippet around each miss so the coverage gap can be diagnosed and closed.
//
// Deterministic — needs Chromium for the render but NO LLM / OpenRouter.
//
// Usage: node scripts/recogniser-coverage.mjs <house-slug> [--misses N]
// ═══════════════════════════════════════════════════════════════

import { HOUSE_ROOTS } from '../lib/houses.js';
import { houseRecogniser } from '../lib/scraper/house-recognisers.js';
import { resolveRecallSentinel } from '../lib/scraper/recall-sentinels.js';
import { scrapeAllPagesWithCrawlee } from '../lib/scraper/crawlee-render.js';
import { htmlToRecognitionMarkdown } from '../lib/scraper/html-to-markdown.js';

const house = process.argv.slice(2).find(a => !a.startsWith('--'));
const missN = parseInt((process.argv.find(a => a.startsWith('--misses=')) || '').split('=')[1] || '8');
if (!house) { console.error('Usage: node scripts/recogniser-coverage.mjs <house-slug> [--misses=N]'); process.exit(1); }

const url = HOUSE_ROOTS[house];
if (!url) { console.error(`Unknown house '${house}' — not in HOUSE_ROOTS`); process.exit(1); }
const override = houseRecogniser(house) || {};
const sentinel = resolveRecallSentinel(house, override.recallSentinelPattern);
const recogniser = override.recogniseFromMarkdown;
if (!sentinel) { console.error(`${house}: no recall sentinel — cannot measure`); process.exit(1); }
if (!recogniser) { console.error(`${house}: no recogniseFromMarkdown override — uses LLM path only`); process.exit(1); }

const mpArg = parseInt((process.argv.find(a => a.startsWith('--maxpages=')) || '').split('=')[1] || '');
const maxPages = Number.isFinite(mpArg) ? mpArg : (override.maxPages || 1);
console.log(`Recogniser-coverage audit: ${house}`);
console.log(`URL: ${url}  (maxPages ${maxPages})\nRendering with Crawlee…`);

const pages = await scrapeAllPagesWithCrawlee(url, house, { maxPages, paginateAs: override.paginateAs });
if (!pages?.length) { console.error('Render returned 0 pages'); process.exit(1); }
for (const p of pages) { if (p.markdown == null) p.markdown = htmlToRecognitionMarkdown(p.html, p.url || url); }
const markdown = pages.map(p => p.markdown || '').join('\n\n');

// Sentinel IDs advertised in the markdown (the denominator).
const sentinelIds = new Set([...markdown.matchAll(sentinel)].map(m => m[1]).filter(Boolean));
// IDs the recogniser recovers.
const recovered = recogniser(markdown);
const recoveredIds = new Set(recovered.keys ? [...recovered.keys()] : []);

const missed = [...sentinelIds].filter(id => !recoveredIds.has(id));
const recall = sentinelIds.size ? recoveredIds.size / sentinelIds.size : null;

console.log(`\n${'═'.repeat(70)}`);
console.log(`Sentinel advertises : ${sentinelIds.size} lot(s)`);
console.log(`Recogniser recovered: ${recovered.size} lot(s)  (${recoveredIds.size} with a sentinel id)`);
console.log(`Recall              : ${recall == null ? 'n/a' : (recall * 100).toFixed(1) + '%'}`);
console.log(`MISSED              : ${missed.length} lot(s)`);
console.log('═'.repeat(70));

// Show markdown around the first N missed IDs so we can see WHY they're dropped.
const idRe = new RegExp(sentinel.source, sentinel.flags.replace('g', ''));
for (const id of missed.slice(0, missN)) {
  const anchor = markdown.search(new RegExp(`properties/${id}-`, 'i'));
  const from = Math.max(0, anchor - 400);
  const snippet = markdown.slice(from, anchor + 200).replace(/\n{3,}/g, '\n\n');
  console.log(`\n──── MISSED id=${id} (context) ────`);
  console.log(snippet);
}
if (missed.length > missN) console.log(`\n… and ${missed.length - missN} more missed ids: ${missed.slice(missN).join(', ')}`);
