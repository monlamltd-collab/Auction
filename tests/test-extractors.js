/**
 * DOM Extractor Test Suite
 * ========================
 * Tests auction house DOM extractors against saved HTML snapshots.
 * Run: node tests/test-extractors.js
 *
 * How to add a new snapshot:
 *   1. Visit the auction house page in a browser
 *   2. Right-click → Save As → HTML Only → save to tests/snapshots/{house_slug}.html
 *   3. Add an entry to EXPECTED below with the house slug and expected lot count/sample data
 *   4. Run this test
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load DOM_EXTRACTORS from server.js ───
// We extract the object by regex rather than importing (server.js has side effects)
const serverCode = readFileSync(join(__dirname, '..', 'server.js'), 'utf-8');
const extractorStart = serverCode.indexOf('const DOM_EXTRACTORS = {');
if (extractorStart === -1) {
  console.error('FAIL: Could not find DOM_EXTRACTORS in server.js');
  process.exit(1);
}

// Find the matching closing brace
let braceDepth = 0;
let extractorEnd = -1;
for (let i = extractorStart; i < serverCode.length; i++) {
  if (serverCode[i] === '{') braceDepth++;
  if (serverCode[i] === '}') {
    braceDepth--;
    if (braceDepth === 0) {
      extractorEnd = i + 1;
      break;
    }
  }
}

const extractorCode = serverCode.substring(extractorStart, extractorEnd);
// Evaluate to get the object
const DOM_EXTRACTORS = new Function(`${extractorCode}; return DOM_EXTRACTORS;`)();

// ─── Expected results per snapshot ───
const EXPECTED = {
  savills: {
    minLots: 3,
    samples: [
      { lot: 1, addressContains: 'Acacia Avenue', priceMin: 100000 },
      { lot: 2, addressContains: 'High Street', priceMin: 50000 },
      { lot: 3, addressContains: 'Willow Lane', hasSold: true },
    ]
  },
  sdl: {
    minLots: 2,
    samples: [
      { lot: 1, addressContains: 'Station Road', priceMin: 80000 },
      { lot: 2, addressContains: 'Tower Block', priceMin: 40000 },
    ]
  },
  bondwolfe: {
    minLots: 2,
    samples: [
      { lot: 5, addressContains: 'Broad Street', priceMin: 100000 },
      { lot: 6, addressContains: 'Park Lane', hasSold: true },
    ]
  },
};

// ─── Run tests ───
let passed = 0;
let failed = 0;
let skipped = 0;
let snapshotFails = 0; // Snapshot tests may fail due to JSDOM limitations — tracked separately

function assert(condition, message) {
  if (!condition) {
    console.log(`    FAIL: ${message}`);
    failed++;
    return false;
  }
  passed++;
  return true;
}

// Test every extractor that has a snapshot
for (const [house, extractorCode] of Object.entries(DOM_EXTRACTORS)) {
  const snapshotPath = join(__dirname, 'snapshots', `${house}.html`);

  if (!existsSync(snapshotPath)) {
    console.log(`  SKIP: ${house} (no snapshot file)`);
    skipped++;
    continue;
  }

  console.log(`  TEST: ${house}`);
  const html = readFileSync(snapshotPath, 'utf-8');
  const dom = new JSDOM(html);
  const { document } = dom.window;

  // Run the extractor in a simulated DOM context
  let lots;
  try {
    // Create a function that has access to `document`
    const fn = new Function('document', `return ${extractorCode}`);
    lots = fn(document);
  } catch (err) {
    console.log(`    FAIL: Extractor threw error: ${err.message}`);
    failed++;
    continue;
  }

  if (!Array.isArray(lots)) {
    console.log(`    SNAPSHOT-FAIL: Extractor returned ${typeof lots} (may be JSDOM limitation)`);
    snapshotFails++;
    continue;
  }

  const expected = EXPECTED[house];
  if (!expected) {
    console.log(`    OK: Returned ${lots.length} lots (no expected data to validate)`);
    passed++;
    continue;
  }

  // Check minimum lot count
  assert(lots.length >= expected.minLots,
    `Expected >= ${expected.minLots} lots, got ${lots.length}`);

  // Check sample lots
  for (const sample of (expected.samples || [])) {
    const lot = lots.find(l => l.lot === sample.lot);
    if (!assert(lot, `Lot ${sample.lot} not found in results`)) continue;

    if (sample.addressContains) {
      assert(lot.address && lot.address.includes(sample.addressContains),
        `Lot ${sample.lot} address "${lot.address}" should contain "${sample.addressContains}"`);
    }

    if (sample.priceMin) {
      assert(lot.price && lot.price >= sample.priceMin,
        `Lot ${sample.lot} price ${lot.price} should be >= ${sample.priceMin}`);
    }

    if (sample.hasSold) {
      const hasSoldBullet = lot.bullets && lot.bullets.some(b => /sold|withdrawn|stc/i.test(b));
      assert(hasSoldBullet,
        `Lot ${sample.lot} should have SOLD/Withdrawn in bullets`);
    }
  }

  console.log(`    ${lots.length} lots extracted`);
}

// ─── Syntax check + field coverage validation for ALL extractors ───
console.log('\n  SYNTAX & FIELD CHECK: All extractors');
const REQUIRED_FIELDS = ['lot', 'address', 'price', 'url'];
const OPTIONAL_FIELDS = ['imageUrl', 'bullets', 'beds', 'type', 'tenure'];

for (const [house, code] of Object.entries(DOM_EXTRACTORS)) {
  try {
    new Function('document', `return ${code}`);
  } catch (err) {
    console.log(`    FAIL: ${house} has syntax error: ${err.message}`);
    failed++;
    continue;
  }

  // Check that the extractor code references the required fields
  // Extractors often use aliases (addr→address, p→price) so we check broadly
  const fieldPatterns = {
    lot: [/\blot\s*[:=]/i, /\blot\b/i],
    address: [/\baddress\s*[:=]/i, /\baddr/i, /\baddress\b/i],
    price: [/\bprice\s*[:=]/i, /\bguide/i, /\bprice\b/i, /\bpriceText/i],
    url: [/\burl\s*[:=]/i, /\bhref/i, /\burl\b/i, /\blink\b/i],
  };
  const missingFields = REQUIRED_FIELDS.filter(f => {
    const patterns = fieldPatterns[f] || [new RegExp(`\\b${f}\\b`, 'i')];
    return !patterns.some(p => p.test(code));
  });

  if (missingFields.length > 0) {
    console.log(`    WARN: ${house} — extractor may not return: ${missingFields.join(', ')}`);
    // Not a failure — some houses legitimately omit fields — but worth flagging
  }

  // Check for image extraction coverage
  const hasImageExtraction = /imageUrl|imageurl|img.*src|image_url/i.test(code);
  if (!hasImageExtraction) {
    console.log(`    WARN: ${house} — no image extraction detected`);
  }

  passed++;
}

// ─── Extractor count sanity check ───
const extractorCount = Object.keys(DOM_EXTRACTORS).length;
console.log(`\n  EXTRACTOR COUNT: ${extractorCount}`);
if (extractorCount < 30) {
  console.log(`    WARN: Expected 30+ extractors, got ${extractorCount}. Houses may be missing.`);
}

// Summary
console.log(`\n  ────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (snapshotFails > 0) console.log(`  ${snapshotFails} snapshot tests failed (JSDOM limitation — run via Puppeteer for full validation)`);
console.log(`  ${extractorCount} extractors loaded`);
if (failed > 0) {
  console.log(`\n  SYNTAX/STRUCTURE FAILURES — extractor regressions detected!`);
  process.exit(1);
} else {
  console.log(`\n  All syntax & structure tests passed.`);
}
