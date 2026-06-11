#!/usr/bin/env node
// scripts/validate-crawlee-houses.mjs — No-LLM Crawlee validation across houses.
//
// Renders each house's live catalogue page 1 with Crawlee and reports the
// signals that don't need Gemini or Supabase:
//   • render: did we get substantive HTML (length, blocked-page heuristics)?
//   • sentinel: how many distinct lot IDs does the rendered page advertise?
//     (this is the recall denominator the parity gate uses)
//   • recogniser houses: how many lots does turndown→recogniser recover,
//     with what field coverage (validateBatch)?
//
// Gemini extraction is the one step not exercised here (needs GEMINI_API_KEY);
// it is already production-proven as the existing fallback extractor.
//
// Run: PUPPETEER_EXECUTABLE_PATH=$(node -e "console.log(require('puppeteer').executablePath())") \
//        node scripts/validate-crawlee-houses.mjs [slug ...]

import { hasCrawlee, scrapeWithCrawlee, teardownCrawlee } from '../lib/scraper/crawlee.js';
import { htmlToRecognitionMarkdown } from '../lib/scraper/html-to-markdown.js';
import { HOUSE_RECOGNISERS } from '../lib/scraper/house-recognisers.js';
import { validateBatch } from '../lib/harness/data-contract.js';
import { normaliseScrapedLot } from '../lib/types/lot.js';

if (!hasCrawlee()) { console.error('ERROR: crawlee not installed'); process.exit(1); }

// Platform sentinels (mirrors detectPlatformSentinel in lib/analysis.js).
const EIG_AH = /\/lot\/(?:details|redirect)\/(\d+)/g;
const BAMBOO = /\/property\/([a-z0-9_-]{6,})/gi;

// House → { url, sentinel } . Recogniser houses pull sentinel from the registry.
const HOUSES = {
  // Platform houses (Gemini-extracted in production; here we check render + sentinel)
  astleys:                { url: 'https://astleys.eigonlineauctions.com/search', sentinel: EIG_AH },
  paulfosh:               { url: 'https://paulfosh.eigonlineauctions.com/search', sentinel: EIG_AH },
  brownco:                { url: 'https://brownandco.eigonlineauctions.com/search', sentinel: EIG_AH },
  auctionhouseeastanglia: { url: 'https://www.auctionhouse.co.uk/eastanglia/auction/search-results', sentinel: EIG_AH },
  stags:                  { url: 'https://stags.bambooauctions.com/', sentinel: BAMBOO },
  // Recogniser houses (turndown bridge fully exercisable without Gemini)
  hollismorgan:           { url: 'https://www.hollismorgan.co.uk/search-auction/', recogniser: 'hollismorgan' },
  maggsandallen:          { url: 'https://www.maggsandallen.co.uk/search-auction/', recogniser: 'maggsandallen' },
  mchughandco:            { url: 'https://www.mchughandco.com/search', recogniser: 'mchughandco' },
  johnpye:                { url: 'https://www.johnpye.co.uk/property/', recogniser: 'johnpye' },
  pattinson:              { url: 'https://www.pattinson.co.uk/auction', recogniser: 'pattinson' },
};

const BLOCK_HINTS = /just a moment|cloudflare|access denied|verify you are human|captcha|attention required/i;

const pick = process.argv.slice(2);
const slugs = pick.length ? pick : Object.keys(HOUSES);

const rows = [];
for (const slug of slugs) {
  const spec = HOUSES[slug];
  if (!spec) { console.log(`skip ${slug}: not in validation map`); continue; }
  const rec = spec.recogniser ? HOUSE_RECOGNISERS[spec.recogniser] : null;
  const sentinel = rec?.recallSentinelPattern || spec.sentinel;
  process.stdout.write(`\n=== ${slug} — ${spec.url}\n`);
  const t0 = Date.now();
  try {
    const r = await scrapeWithCrawlee(spec.url);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const html = r?.html || '';
    const blocked = BLOCK_HINTS.test(html.slice(0, 4000)) || html.length < 2000;
    let sentinelIds = 0;
    if (sentinel) sentinelIds = new Set([...html.matchAll(sentinel)].map(m => m[1])).size;

    let recovered = 0, quality = null, coverage = null;
    if (rec) {
      const md = htmlToRecognitionMarkdown(html, spec.url);
      const mdIds = new Set([...md.matchAll(rec.recallSentinelPattern)].map(m => m[1])).size;
      sentinelIds = Math.max(sentinelIds, mdIds);
      const map = rec.recogniseFromMarkdown(md);
      const lots = [...map.values()]
        .map(raw => normaliseScrapedLot(raw, { house: slug, catalogueUrl: spec.url, extractionSource: 'crawlee-markdown-recognition' }))
        .filter(Boolean);
      recovered = lots.length;
      if (lots.length) {
        const vb = validateBatch(lots, slug, {});
        quality = vb.batchQuality;
        coverage = vb.fieldCoverage;
      }
    }
    console.log(`  render: ${html.length.toLocaleString()} chars in ${secs}s ${blocked ? '⚠ LOOKS BLOCKED/EMPTY' : '✓'}`);
    console.log(`  sentinel lot IDs advertised: ${sentinelIds}`);
    if (rec) {
      console.log(`  recogniser recovered: ${recovered} lots${quality != null ? `, batchQuality ${quality}` : ''}`);
      if (coverage) console.log(`  field coverage: ${Object.entries(coverage).map(([k, v]) => `${k} ${v}%`).join(', ')}`);
    }
    rows.push({ slug, ok: !blocked, htmlLen: html.length, secs, sentinelIds, recovered, quality });
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
    rows.push({ slug, ok: false, error: err.message });
  }
}

console.log(`\n${'='.repeat(72)}\nSUMMARY`);
console.log('house'.padEnd(24), 'render', 'sentinelIDs', 'recognised', 'quality');
for (const r of rows) {
  console.log(
    r.slug.padEnd(24),
    (r.ok ? 'OK' : 'FAIL').padEnd(6),
    String(r.sentinelIds ?? '—').padEnd(11),
    String(r.recovered ?? '—').padEnd(10),
    String(r.quality ?? '—'),
  );
}
await teardownCrawlee();
process.exit(0);
