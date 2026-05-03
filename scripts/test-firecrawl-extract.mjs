#!/usr/bin/env node
// Step 1A: Validate Firecrawl JSON schema extraction on 5 auction houses.
// Run: node scripts/test-firecrawl-extract.mjs
// Requires: FIRECRAWL_API_KEY in environment

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) {
  console.error('ERROR: FIRECRAWL_API_KEY not set');
  process.exit(1);
}

const CATALOGUE_SCHEMA = {
  type: 'object',
  properties: {
    lots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lot_number: { type: 'number', description: 'Auction lot number' },
          address: { type: 'string', description: 'Full property address including postcode' },
          guide_price: { type: 'string', description: 'Guide price or price range as shown' },
          property_type: { type: 'string', description: 'house, flat, land, commercial, etc.' },
          bedrooms: { type: 'number', description: 'Number of bedrooms if stated' },
          tenure: { type: 'string', description: 'Freehold or Leasehold' },
          image_url: { type: 'string', description: 'Main property image URL (full URL)' },
          detail_url: { type: 'string', description: 'Link to full lot details page (full URL)' },
          description: { type: 'string', description: 'Brief property description' },
          lot_status: { type: 'string', description: 'available, sold, withdrawn, postponed' },
          auction_date: { type: 'string', description: 'Auction date if shown on this page' }
        },
        required: ['address']
      }
    },
    auction_date: { type: 'string', description: 'Overall auction date for this catalogue' },
    total_lots: { type: 'number', description: 'Total number of lots if stated' }
  },
  required: ['lots']
};

const TEST_HOUSES = [
  { slug: 'allsop', url: 'https://www.allsop.co.uk/auctions/residential-auctions/', baseline: 412 },
  { slug: 'savills', url: 'https://auctions.savills.co.uk/upcoming-auctions', baseline: 166 },
  { slug: 'connectuk', url: 'https://connectukgroup.co.uk/auctions/', baseline: 41 },
  { slug: 'sdl', url: 'https://www.sdlauctions.co.uk/properties/', baseline: 200 },
  { slug: 'edwardmellor', url: 'https://www.edwardmellor.co.uk/auction/', baseline: 24 },
];

async function testExtract(house) {
  const start = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${house.slug} (baseline: ${house.baseline} lots)`);
  console.log(`URL: ${house.url}`);
  console.log('='.repeat(60));

  try {
    const resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: house.url,
        formats: [
          { type: 'json', schema: CATALOGUE_SCHEMA },
          'rawHtml'
        ]
      }),
      signal: AbortSignal.timeout(130000),
    });

    const elapsed = Date.now() - start;

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.log(`  FAILED: HTTP ${resp.status} — ${text.slice(0, 200)}`);
      return { slug: house.slug, success: false, error: `HTTP ${resp.status}`, elapsed };
    }

    const data = await resp.json();

    if (!data.success) {
      console.log(`  FAILED: API returned success=false — ${data.error || 'unknown'}`);
      return { slug: house.slug, success: false, error: data.error, elapsed };
    }

    const json = data.data?.json;
    const lots = json?.lots || [];
    const htmlLength = (data.data?.rawHtml || '').length;

    console.log(`  Time: ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`  Lots extracted: ${lots.length} (baseline: ${house.baseline})`);
    console.log(`  Recovery: ${((lots.length / house.baseline) * 100).toFixed(0)}%`);
    console.log(`  Raw HTML length: ${htmlLength.toLocaleString()} chars`);
    console.log(`  Auction date: ${json?.auction_date || 'not found'}`);
    console.log(`  Total lots stated: ${json?.total_lots || 'not stated'}`);

    if (lots.length > 0) {
      const withAddress = lots.filter(l => l.address).length;
      const withPrice = lots.filter(l => l.guide_price).length;
      const withImage = lots.filter(l => l.image_url).length;
      const withDetail = lots.filter(l => l.detail_url).length;
      const withType = lots.filter(l => l.property_type).length;

      console.log(`\n  Field coverage:`);
      console.log(`    address:       ${withAddress}/${lots.length} (${((withAddress / lots.length) * 100).toFixed(0)}%)`);
      console.log(`    guide_price:   ${withPrice}/${lots.length} (${((withPrice / lots.length) * 100).toFixed(0)}%)`);
      console.log(`    image_url:     ${withImage}/${lots.length} (${((withImage / lots.length) * 100).toFixed(0)}%)`);
      console.log(`    detail_url:    ${withDetail}/${lots.length} (${((withDetail / lots.length) * 100).toFixed(0)}%)`);
      console.log(`    property_type: ${withType}/${lots.length} (${((withType / lots.length) * 100).toFixed(0)}%)`);

      console.log(`\n  Sample lot (first):`);
      console.log(`    ${JSON.stringify(lots[0], null, 4).split('\n').join('\n    ')}`);

      if (lots.length > 2) {
        console.log(`\n  Sample lot (last):`);
        console.log(`    ${JSON.stringify(lots[lots.length - 1], null, 4).split('\n').join('\n    ')}`);
      }
    }

    return {
      slug: house.slug,
      success: true,
      lotCount: lots.length,
      baseline: house.baseline,
      recovery: ((lots.length / house.baseline) * 100).toFixed(0) + '%',
      elapsed,
      fieldCoverage: lots.length > 0 ? {
        address: lots.filter(l => l.address).length,
        guide_price: lots.filter(l => l.guide_price).length,
        image_url: lots.filter(l => l.image_url).length,
        detail_url: lots.filter(l => l.detail_url).length,
      } : null
    };

  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`  ERROR: ${err.message}`);
    return { slug: house.slug, success: false, error: err.message, elapsed };
  }
}

async function main() {
  console.log('Firecrawl JSON Schema Extraction — Validation Test');
  console.log(`Testing ${TEST_HOUSES.length} houses...`);
  console.log(`API Key: ${FIRECRAWL_API_KEY.slice(0, 8)}...${FIRECRAWL_API_KEY.slice(-4)}`);

  const results = [];
  for (const house of TEST_HOUSES) {
    results.push(await testExtract(house));
    await new Promise(r => setTimeout(r, 1000)); // 1s gap between calls
  }

  console.log('\n\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`\n${'House'.padEnd(15)} ${'Lots'.padEnd(8)} ${'Baseline'.padEnd(10)} ${'Recovery'.padEnd(10)} ${'Time'.padEnd(8)} Status`);
  console.log('-'.repeat(65));

  let successes = 0;
  for (const r of results) {
    if (r.success) {
      successes++;
      console.log(`${r.slug.padEnd(15)} ${String(r.lotCount).padEnd(8)} ${String(r.baseline).padEnd(10)} ${r.recovery.padEnd(10)} ${(r.elapsed / 1000).toFixed(1).padEnd(8)}s OK`);
    } else {
      console.log(`${r.slug.padEnd(15)} ${'—'.padEnd(8)} ${String(r.baseline || '?').padEnd(10)} ${'—'.padEnd(10)} ${(r.elapsed / 1000).toFixed(1).padEnd(8)}s FAIL: ${r.error}`);
    }
  }

  console.log(`\nResult: ${successes}/${results.length} houses returned data`);

  if (successes >= 4) {
    console.log('\n✓ GATE PASSED — proceed with integration');
  } else if (successes >= 2) {
    console.log('\n⚠ PARTIAL — proceed with caution, keep backstop active');
  } else {
    console.log('\n✗ GATE FAILED — Firecrawl extract not suitable, revert to previous plan');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
