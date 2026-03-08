#!/usr/bin/env node
/**
 * Pre-Launch QA Script (#18)
 * Checks: every house has >0 lots, no duplicate lot numbers,
 * all images resolve, all prices parse.
 *
 * Usage: node scripts/pre-launch-qa.mjs [--base-url https://auctions.bridgematch.co.uk]
 */

const BASE = process.argv.find(a => a.startsWith('--base-url='))?.split('=')[1]
  || process.argv[process.argv.indexOf('--base-url') + 1]
  || 'http://localhost:3000';

async function main() {
  console.log(`\n  Pre-Launch QA — checking ${BASE}\n`);

  // 1. Fetch all lots
  const res = await fetch(`${BASE}/api/all-lots`);
  if (!res.ok) { console.error(`  FAIL: /api/all-lots returned ${res.status}`); process.exit(1); }
  const { lots, sources } = await res.json();

  console.log(`  Total lots: ${lots.length}`);
  console.log(`  Sources: ${sources?.length || 'N/A'}\n`);

  const issues = [];
  const byHouse = {};

  // Group lots by house
  for (const lot of lots) {
    const h = lot._house || 'unknown';
    if (!byHouse[h]) byHouse[h] = [];
    byHouse[h].push(lot);
  }

  // 2. Check each house has >0 lots
  if (sources) {
    for (const src of sources) {
      const slug = src.house || src.slug || src.id;
      if (!byHouse[slug] || byHouse[slug].length === 0) {
        issues.push({ severity: 'CRITICAL', house: slug, issue: 'Zero lots returned' });
      }
    }
  }

  // 3. Check for duplicate lot numbers within each house
  for (const [house, houseLots] of Object.entries(byHouse)) {
    const seen = new Map();
    for (const lot of houseLots) {
      const key = lot.lot || lot.url || lot.address;
      if (seen.has(key)) {
        issues.push({ severity: 'WARN', house, issue: `Duplicate lot: ${key}` });
      }
      seen.set(key, true);
    }
  }

  // 4. Check prices parse correctly
  let missingPrice = 0, badPrice = 0;
  for (const lot of lots) {
    if (!lot.price && !lot.guidePrice) { missingPrice++; continue; }
    const p = lot.price || lot.guidePrice;
    if (typeof p === 'string' && !/^\d/.test(p.replace(/[£,]/g, ''))) {
      badPrice++;
      issues.push({ severity: 'WARN', house: lot._house, issue: `Bad price format: "${p}" on ${lot.address?.slice(0,40)}` });
    }
  }

  // 5. Check image URLs (sample 5 per house)
  let imgChecked = 0, imgBroken = 0;
  const imgChecks = [];
  for (const [house, houseLots] of Object.entries(byHouse)) {
    const withImages = houseLots.filter(l => l.imageUrl);
    const sample = withImages.slice(0, 5);
    for (const lot of sample) {
      imgChecks.push(
        fetch(lot.imageUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
          .then(r => {
            imgChecked++;
            if (!r.ok) {
              imgBroken++;
              issues.push({ severity: 'WARN', house, issue: `Image 404: ${lot.imageUrl.slice(0,60)}` });
            }
          })
          .catch(() => {
            imgChecked++;
            imgBroken++;
            issues.push({ severity: 'WARN', house, issue: `Image unreachable: ${lot.imageUrl.slice(0,60)}` });
          })
      );
    }
  }
  await Promise.all(imgChecks);

  // 6. Image coverage stats
  const houseStats = [];
  for (const [house, houseLots] of Object.entries(byHouse)) {
    const withImg = houseLots.filter(l => l.imageUrl).length;
    const coverage = ((withImg / houseLots.length) * 100).toFixed(0);
    houseStats.push({ house, lots: houseLots.length, images: withImg, coverage: +coverage });
    if (+coverage < 30) {
      issues.push({ severity: 'WARN', house, issue: `Low image coverage: ${coverage}% (${withImg}/${houseLots.length})` });
    }
  }

  // ── Report ──
  console.log('  ┌──────────────────────────────────────────────────────┐');
  console.log('  │  HOUSE COVERAGE                                     │');
  console.log('  ├─────────────────────┬───────┬────────┬──────────────┤');
  console.log('  │ House               │ Lots  │ Images │ Coverage     │');
  console.log('  ├─────────────────────┼───────┼────────┼──────────────┤');
  for (const s of houseStats.sort((a, b) => b.lots - a.lots)) {
    const bar = s.coverage >= 70 ? '  OK' : s.coverage >= 30 ? '  LOW' : '  BAD';
    console.log(`  │ ${s.house.padEnd(19)} │ ${String(s.lots).padStart(5)} │ ${String(s.images).padStart(6)} │ ${String(s.coverage + '%').padStart(5)}${bar.padEnd(5)} │`);
  }
  console.log('  └─────────────────────┴───────┴────────┴──────────────┘');

  console.log(`\n  Prices: ${lots.length - missingPrice} with price, ${missingPrice} missing, ${badPrice} malformed`);
  console.log(`  Images: ${imgChecked} checked, ${imgBroken} broken`);

  // ── Issues ──
  const critical = issues.filter(i => i.severity === 'CRITICAL');
  const warnings = issues.filter(i => i.severity === 'WARN');

  if (critical.length) {
    console.log(`\n  CRITICAL ISSUES (${critical.length}):`);
    for (const i of critical) console.log(`    [${i.house}] ${i.issue}`);
  }
  if (warnings.length) {
    console.log(`\n  WARNINGS (${warnings.length}):`);
    for (const i of warnings.slice(0, 20)) console.log(`    [${i.house}] ${i.issue}`);
    if (warnings.length > 20) console.log(`    ... and ${warnings.length - 20} more`);
  }

  if (critical.length === 0 && warnings.length === 0) {
    console.log('\n  ALL CHECKS PASSED');
  }

  console.log(`\n  QA complete. ${critical.length} critical, ${warnings.length} warnings.\n`);
  process.exit(critical.length > 0 ? 1 : 0);
}

main().catch(err => { console.error('QA script error:', err); process.exit(1); });
