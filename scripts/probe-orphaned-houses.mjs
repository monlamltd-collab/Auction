#!/usr/bin/env node
// scripts/probe-orphaned-houses.mjs — Diagnostic: probe no-extractor houses to see which are worth building extractors for
// Run: node scripts/probe-orphaned-houses.mjs

import { HOUSE_ROOTS, HOUSE_DISPLAY_NAMES } from '../lib/houses.js';

const NO_EXTRACTOR_SLUGS = [
  'aldreds', 'auctionhammermidlands', 'charlesdarrow', 'clarkegammon',
  'fisherGerman', 'foxgrant', 'gherbertbanks', 'hairandson', 'halls',
  'hawkesford', 'hobbsparker', 'howkinsandharrison', 'humberts', 'jjmorris',
  'johnpye', 'luscombemaye', 'mellerbraggins', 'pearsonferrier',
  'phillipssmithanddunn', 'regionalauctioneers', 'robinjessop',
  'sharpesauctions', 'stags', 'taylerandfletcher', 'walkersingleton',
  'webbers', 'woolleyandwallis',
];

async function probeUrl(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    clearTimeout(timer);
    const text = await resp.text();
    const redirected = resp.url !== url;
    if (resp.status === 200 && text.length > 500) {
      const hasCaptcha = /captcha|challenge|cf-browser/i.test(text);
      if (hasCaptcha) return { status: 'blocked', code: 200, note: 'captcha/challenge detected', redirected };
      return { status: 'reachable', code: 200, note: `${text.length} chars HTML`, redirected };
    }
    if (resp.status === 403) return { status: 'blocked', code: 403, note: 'Forbidden', redirected };
    if (resp.status === 404) return { status: 'dead', code: 404, note: 'Not Found', redirected };
    return { status: 'other', code: resp.status, note: `${text.length} chars`, redirected };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return { status: 'timeout', code: null, note: 'Timed out after 10s' };
    return { status: 'error', code: null, note: err.message };
  }
}

async function main() {
  console.log(`Probing ${NO_EXTRACTOR_SLUGS.length} no-extractor houses...\n`);
  const results = [];

  for (const slug of NO_EXTRACTOR_SLUGS) {
    const url = HOUSE_ROOTS[slug];
    const name = HOUSE_DISPLAY_NAMES[slug] || slug;
    if (!url) {
      results.push({ slug, name, url: '(missing)', status: 'no-url', code: null, note: 'Not in HOUSE_ROOTS' });
      continue;
    }
    process.stdout.write(`  ${name}... `);
    const result = await probeUrl(url);
    console.log(result.status);
    results.push({ slug, name, url, ...result });
  }

  // Summary table
  console.log('\n' + '='.repeat(100));
  console.log('PROBE RESULTS');
  console.log('='.repeat(100));
  console.log(`${'Slug'.padEnd(28)} ${'Name'.padEnd(32)} ${'Status'.padEnd(12)} ${'Code'.padEnd(6)} Notes`);
  console.log('-'.repeat(100));

  const groups = { reachable: [], blocked: [], dead: [], timeout: [], error: [], other: [], 'no-url': [] };
  for (const r of results) {
    console.log(`${r.slug.padEnd(28)} ${r.name.padEnd(32)} ${r.status.padEnd(12)} ${String(r.code || '-').padEnd(6)} ${r.note || ''}${r.redirected ? ' (redirected)' : ''}`);
    (groups[r.status] || groups.other).push(r);
  }

  console.log('-'.repeat(100));
  console.log(`\nReachable: ${groups.reachable.length} | Blocked: ${groups.blocked.length} | Dead: ${groups.dead.length} | Timeout: ${groups.timeout.length} | Error: ${groups.error.length}`);
  console.log('\nReachable houses are candidates for new extractors.');
}

main().catch(console.error);
