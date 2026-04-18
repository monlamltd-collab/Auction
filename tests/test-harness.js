// ═══════════════════════════════════════════════════════════════
// HARNESS MODULE TESTS — Unit tests for all 9 harness modules
// ═══════════════════════════════════════════════════════════════
// Run: node tests/test-harness.js

import { validateLot, validateBatch } from '../lib/harness/data-contract.js';
import { detectRegression } from '../lib/harness/regression-detector.js';
import { evaluateGate, checkEndedLotRatio, checkCalendarDateSanity } from '../lib/harness/quality-gate.js';
import { initAlerts, fireAlert, resolveAlert, getUnresolved, getDedupStats } from '../lib/harness/alert-router.js';
import { updateHealth, getHealth, getAllHealth, isCircuitOpen, getBaseline } from '../lib/harness/house-health.js';
import { enrichBatch, getEnrichmentReport } from '../lib/harness/enrichment-engine.js';
import { initDiscovery, getDiscoveryBudget } from '../lib/harness/house-discovery.js';
import { initGenerator, generateExtractor, getGeneratorLog, getTemplateExtractor } from '../lib/harness/extractor-generator.js';
import { initManager, runManagerCycle, getManagerReport, setManagerConfig, getManagerConfig } from '../lib/harness/manager.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ═══════════════════════════════════════════════════════════════
// 1. DATA CONTRACT
// ═══════════════════════════════════════════════════════════════
section('data-contract: validateLot');

// Valid lot
const validResult = validateLot({
  lot: 1, address: '12 High Street, London', price: '£150,000',
  imageUrl: 'https://example.com/img.jpg', tenure: 'FH',
  beds: 3, url: 'https://example.com/lot/1',
});
assert(validResult.valid === true, 'Valid lot passes validation');
assert(validResult.quality >= 0.9, `Quality score high for complete lot: ${validResult.quality}`);
assert(validResult.gaps.length === 0, 'No gaps for complete lot');
assert(validResult.normalized.price === 150000, 'Price normalised to integer');
assert(validResult.normalized.tenure === 'Freehold', 'Tenure normalised: FH → Freehold');

// Lot with no identifier
const noId = validateLot({ price: 50000 });
assert(noId.valid === false, 'Lot without lot number or address is invalid');

// Lot with missing optional fields
const partial = validateLot({ lot: 5, address: '10 Oak Road' });
assert(partial.valid === true, 'Lot with lot+address but missing optionals is valid');
assert(partial.quality < 0.5, `Quality low for sparse lot: ${partial.quality}`);
assert(partial.gaps.includes('imageUrl'), 'Missing imageUrl flagged');
assert(partial.gaps.includes('price'), 'Missing price flagged');

// Junk image filtering
const junkImg = validateLot({
  lot: 1, address: 'Test', imageUrl: 'https://example.com/logo.png',
});
assert(junkImg.normalized.imageUrl === '', 'Junk logo image filtered out');

// Price normalisation
const priceNorm = validateLot({ lot: 1, address: 'Test', price: 'Guide Price £250,000' });
assert(priceNorm.normalized.price === 250000, 'Guide price parsed correctly');

// PropType normalisation
const propNorm = validateLot({ lot: 1, address: 'Test', propType: 'terraced house' });
assert(propNorm.normalized.propType === 'house', 'terraced house → house');

section('data-contract: validateBatch');

const batch = validateBatch([
  { lot: 1, address: '1 High St', price: 100000, imageUrl: 'https://img.com/1.jpg', tenure: 'Freehold', beds: 2, url: 'https://ex.com/1' },
  { lot: 2, address: '2 High St', price: 200000 },
  { lot: 3, address: '3 High St' },
], 'testHouse');
assert(batch.lots.length === 3, 'All 3 lots pass validation');
assert(batch.batchQuality > 0, `Batch quality > 0: ${batch.batchQuality}`);
assert(batch.viable === true, 'Batch is viable');
assert(batch.fieldCoverage.price >= 60, `Price coverage correct: ${batch.fieldCoverage.price}%`);

// Empty batch
const emptyBatch = validateBatch([], 'test');
assert(emptyBatch.viable === false, 'Empty batch is not viable');

// Batch with lot count penalty
const penalisedBatch = validateBatch(
  [{ lot: 1, address: 'Test Addr' }],
  'test',
  { averageLotCount: 100 },
);
assert(penalisedBatch.batchQuality < 0.3, `Batch quality penalised for 1 lot vs avg 100: ${penalisedBatch.batchQuality}`);

// ═══════════════════════════════════════════════════════════════
// 2. REGRESSION DETECTOR
// ═══════════════════════════════════════════════════════════════
section('regression-detector');

const healthyRegression = detectRegression('test', {
  lots: new Array(50).fill(null).map((_, i) => ({ lot: i })),
  batchQuality: 0.7,
  fieldCoverage: { imageUrl: 60, price: 80 },
}, { averageLotCount: 50, imageCoverage: 60 });
assert(healthyRegression.verdict === 'healthy', 'No regression when counts match');

const lotDropRegression = detectRegression('test', {
  lots: new Array(10).fill(null).map((_, i) => ({ lot: i })),
  batchQuality: 0.7,
  fieldCoverage: { imageUrl: 60 },
}, { averageLotCount: 50, imageCoverage: 60 });
assert(lotDropRegression.verdict === 'regression', `Lot count drop 80% → regression: ${lotDropRegression.verdict}`);
assert(lotDropRegression.severity === 'error', 'Severity is error');

const imgDropRegression = detectRegression('test', {
  lots: new Array(50).fill(null).map((_, i) => ({ lot: i })),
  batchQuality: 0.7,
  fieldCoverage: { imageUrl: 20 },
}, { averageLotCount: 50, imageCoverage: 60 });
assert(imgDropRegression.verdict === 'degraded', `Image coverage drop → degraded: ${imgDropRegression.verdict}`);

// ═══════════════════════════════════════════════════════════════
// WAVE 0 FIXES — Tests for changed behaviours (must run RED before implementation)
// ═══════════════════════════════════════════════════════════════
section('wave-0: normalisePrice k-suffix');

// Import normalisePrice and normalisePropType via validateLot (they are not exported directly)
// We test through validateLot which calls normalisePrice internally
{
  // normalisePrice('50k-60k') should parse to 50000 (lower bound, k-suffix range)
  const r1 = validateLot({ lot: 1, address: 'Test', price: '50k-60k' });
  assert(r1.normalized.price === 50000, 'normalisePrice(\'50k-60k\') === 50000');

  // normalisePrice('£50k') should parse to 50000 (single k-suffix with £)
  const r2 = validateLot({ lot: 1, address: 'Test', price: '£50k' });
  assert(r2.normalized.price === 50000, 'normalisePrice(\'£50k\') === 50000');

  // normalisePrice('50,000-60,000') should parse to 50000 (comma range — regression guard)
  const r3 = validateLot({ lot: 1, address: 'Test', price: '50,000-60,000' });
  assert(r3.normalized.price === 50000, 'normalisePrice(\'50,000-60,000\') === 50000 (range lower bound)');

  // normalisePropType('bungalow') should return 'house' (PROP_TYPE_MAP maps it)
  const r4 = validateLot({ lot: 1, address: 'Test', propType: 'bungalow' });
  assert(r4.normalized.propType === 'house', 'normalisePropType(\'bungalow\') === \'house\'');
}

section('wave-0: quality gate thresholds');

{
  // evaluateGate with batchQuality=0.44 → verdict 'reject' (new threshold 0.45)
  const g1 = evaluateGate('wave0test',
    { lots: new Array(10), batchQuality: 0.44 },
    { verdict: 'healthy', reasons: [], severity: 'info' },
    { total_lots: 10 },
  );
  assert(g1.decision === 'reject', 'evaluateGate batchQuality=0.44 → reject (new threshold 0.45)');

  // evaluateGate with batchQuality=0.50 → verdict 'cache_warn' (in new warn band 0.45-0.60)
  const g2 = evaluateGate('wave0test',
    { lots: new Array(10), batchQuality: 0.50 },
    { verdict: 'healthy', reasons: [], severity: 'info' },
    { total_lots: 10 },
  );
  assert(g2.decision === 'cache_warn', 'evaluateGate batchQuality=0.50 → cache_warn (new warn band 0.45-0.60)');

  // evaluateGate with batchQuality=0.65 → verdict 'cache' (above new warn ceiling 0.60)
  const g3 = evaluateGate('wave0test',
    { lots: new Array(10), batchQuality: 0.65 },
    { verdict: 'healthy', reasons: [], severity: 'info' },
    { total_lots: 10 },
  );
  assert(g3.decision === 'cache', 'evaluateGate batchQuality=0.65 → cache (above warn ceiling 0.60)');
}

// ═══════════════════════════════════════════════════════════════
// 3. QUALITY GATE
// ═══════════════════════════════════════════════════════════════
section('quality-gate');

// Init alert router for quality-gate (which uses fireAlert)
initAlerts(null);

const cacheResult = evaluateGate('test',
  { lots: new Array(50), batchQuality: 0.7 },
  { verdict: 'healthy', reasons: [], severity: 'info' },
  { total_lots: 45 },
);
assert(cacheResult.decision === 'cache', 'Good batch → cache');

const rejectResult = evaluateGate('test',
  { lots: new Array(10), batchQuality: 0.7 },
  { verdict: 'regression', reasons: ['Lot count drop'], severity: 'error' },
  { total_lots: 50 },
);
assert(rejectResult.decision === 'reject', 'Regression + 5x cached lots → reject');

const lowQualityResult = evaluateGate('test',
  { lots: new Array(10), batchQuality: 0.2 },
  { verdict: 'healthy', reasons: [], severity: 'info' },
  { total_lots: 10 },
);
assert(lowQualityResult.decision === 'reject', 'Low quality batch → reject');

const warnResult = evaluateGate('test',
  { lots: new Array(40), batchQuality: 0.50 },
  { verdict: 'healthy', reasons: [], severity: 'info' },
  { total_lots: 40 },
);
assert(warnResult.decision === 'cache_warn', 'Marginal quality (0.50, in warn band 0.45-0.60) → cache_warn');

const degradedWarn = evaluateGate('test',
  { lots: new Array(40), batchQuality: 0.7 },
  { verdict: 'degraded', reasons: ['Image drop'], severity: 'warning' },
  { total_lots: 40 },
);
assert(degradedWarn.decision === 'cache_warn', 'Degraded verdict → cache_warn');

const firstRun = evaluateGate('test',
  { lots: new Array(5), batchQuality: 0.65 },
  { verdict: 'healthy', reasons: [], severity: 'info' },
  null,
);
assert(firstRun.decision === 'cache', 'First run (no existing cache) → always cache');

// ── 3b. ENDED-LOT RATIO GATE ──
section('ended-lot-ratio');

{
  // 90% ended → flagged
  const endedLots = Array.from({ length: 10 }, (_, i) => ({
    lot: i + 1, address: `${i} Test St`, status: i < 9 ? 'sold' : 'available', bullets: [],
  }));
  const e1 = checkEndedLotRatio('test-ended', endedLots);
  assert(e1.flagged === true, 'checkEndedLotRatio 90% ended → flagged');
  assert(e1.ratio === 0.9, 'checkEndedLotRatio ratio = 0.9');
  assert(e1.endedCount === 9, 'checkEndedLotRatio endedCount = 9');

  // 50% ended → not flagged (below 80% threshold)
  const halfEnded = Array.from({ length: 10 }, (_, i) => ({
    lot: i + 1, address: `${i} Test St`, status: i < 5 ? 'unsold' : 'available', bullets: [],
  }));
  const e2 = checkEndedLotRatio('test-half', halfEnded);
  assert(e2.flagged === false, 'checkEndedLotRatio 50% ended → not flagged');

  // Detect "Auction Ended" in bullets even if status is available
  const bulletEnded = Array.from({ length: 6 }, (_, i) => ({
    lot: i + 1, address: `${i} Test St`, status: 'available',
    bullets: i < 5 ? ['Auction Ended'] : [],
  }));
  const e3 = checkEndedLotRatio('test-bullets', bulletEnded);
  assert(e3.flagged === true, 'checkEndedLotRatio detects "Auction Ended" in bullets');
  assert(e3.endedCount === 5, 'checkEndedLotRatio counts bullet-based ended lots');

  // Too few lots → not flagged
  const tiny = [{ lot: 1, address: 'A', status: 'sold', bullets: [] }];
  const e4 = checkEndedLotRatio('test-tiny', tiny);
  assert(e4.flagged === false, 'checkEndedLotRatio <5 lots → not flagged');
}

// ── 3c. CALENDAR DATE SANITY ──
section('calendar-date-sanity');

{
  // Single date on >100 lots → flagged
  const bulkDate = Array.from({ length: 120 }, (_, i) => ({
    lot: i + 1, address: `${i} St`, auctionDate: '2026-05-01',
  }));
  const d1 = checkCalendarDateSanity('test-bulk', bulkDate);
  assert(d1.flagged === true, 'checkCalendarDateSanity >100 lots on one date → flagged');
  assert(d1.flags.some(f => f.includes('120 lots')), 'checkCalendarDateSanity flag mentions lot count');

  // Non-always_on house with multiple dates → flagged
  const multiDate = [
    { lot: 1, address: 'A', auctionDate: '2026-05-01' },
    { lot: 2, address: 'B', auctionDate: '2026-05-01' },
    { lot: 3, address: 'C', auctionDate: '2026-06-01' },
  ];
  const d2 = checkCalendarDateSanity('test-multi', multiDate, { isAlwaysOn: false });
  assert(d2.flagged === true, 'checkCalendarDateSanity non-always_on with 2 dates → flagged');

  // Same house as always_on → not flagged for multi-date
  const d3 = checkCalendarDateSanity('test-ao', multiDate, { isAlwaysOn: true });
  assert(d3.flagged === false, 'checkCalendarDateSanity always_on with 2 dates → not flagged');

  // Normal single-date batch → not flagged
  const normal = Array.from({ length: 20 }, (_, i) => ({
    lot: i + 1, address: `${i} St`, auctionDate: '2026-05-01',
  }));
  const d4 = checkCalendarDateSanity('test-normal', normal, { isAlwaysOn: false });
  assert(d4.flagged === false, 'checkCalendarDateSanity 20 lots on one date → not flagged');
}

// ═══════════════════════════════════════════════════════════════
// 4. ALERT ROUTER
// ═══════════════════════════════════════════════════════════════
section('alert-router');

// Fire an alert
const alert1 = await fireAlert({ type: 'test_alert', severity: 'warning', house: 'testHouse', message: 'Test message' });
assert(alert1.fired === true, 'First alert fires');

// Dedup — same type+house within 6h
const alert2 = await fireAlert({ type: 'test_alert', severity: 'warning', house: 'testHouse', message: 'Duplicate' });
assert(alert2.suppressed === true, 'Duplicate alert suppressed');

// Different type fires
const alert3 = await fireAlert({ type: 'different_type', severity: 'warning', house: 'testHouse', message: 'Different' });
assert(alert3.fired === true, 'Different type fires');

// Dedup stats
const stats = getDedupStats();
assert(Object.keys(stats).length >= 2, 'Dedup stats track alerts');

// ═══════════════════════════════════════════════════════════════
// 5. HOUSE HEALTH
// ═══════════════════════════════════════════════════════════════
section('house-health');

// Update with good scrape
const health1 = updateHealth('healthTest', {
  lots: { lots: new Array(50), batchQuality: 0.8, fieldCoverage: { imageUrl: 70 } },
  regression: { verdict: 'healthy' },
  gate: { decision: 'cache' },
  extractionMethod: 'dom',
});
assert(health1.health > 50, `Good scrape → healthy: ${health1.health}`);
assert(health1.circuitBreaker === 'closed', 'Circuit closed for healthy house');

// Update with failures
let lastHealth;
for (let i = 0; i < 5; i++) {
  lastHealth = updateHealth('failingHouse', {
    lots: { lots: [], batchQuality: 0, fieldCoverage: {} },
    regression: { verdict: 'regression' },
    gate: { decision: 'reject' },
    extractionMethod: 'failed',
  });
}
assert(lastHealth.health < 30, `5 consecutive failures → low health: ${lastHealth.health}`);
assert(lastHealth.circuitBreaker !== 'closed', `Circuit not closed after failures: ${lastHealth.circuitBreaker}`);

// isCircuitOpen
assert(isCircuitOpen('failingHouse') === true || lastHealth.circuitBreaker === 'half-open', 'Failing house circuit opens or half-opens');

// getBaseline
const baseline = getBaseline('healthTest');
assert(baseline.rollingLotCounts.length > 0, 'Baseline has rolling lot counts');

// getAllHealth
const allHealth = getAllHealth();
assert(allHealth.healthTest !== undefined, 'getAllHealth includes healthTest');

// ═══════════════════════════════════════════════════════════════
// 6. ENRICHMENT ENGINE
// ═══════════════════════════════════════════════════════════════
section('enrichment-engine');

const enrichResult = enrichBatch([
  { lot: 1, address: '3 Bed Semi, 12 Oak Road', price: 100000, tenure: '', beds: null, propType: '' },
  { lot: 2, address: 'Flat 4, 20 High Street', price: 200000, tenure: '', beds: null, propType: '' },
  { lot: 3, address: '5 Elm Drive', price: 150000, tenure: 'Freehold', beds: 2, propType: 'house' },
], 'enrichTest', {
  previousCache: [
    { lot: '1', tenure: 'Freehold', beds: 3, condition: 'Good' },
  ],
});

assert(enrichResult.stats.enriched > 0, `Enrichment improved ${enrichResult.stats.enriched} lots`);

// Cross-lot inference: beds from address
const lot1 = enrichResult.lots.find(l => l.lot === 1);
assert(lot1.beds === 3, 'Beds extracted from address "3 Bed Semi"');

// Address-based inference: flat → Leasehold
const lot2 = enrichResult.lots.find(l => l.lot === 2);
assert(lot2.propType === 'flat', 'PropType inferred from "Flat 4" in address');
assert(lot2.tenure === 'Leasehold', 'Tenure defaulted to Leasehold for flat');

// Previous cache carry-forward
assert(lot1.condition === 'Good', 'Condition carried forward from previous cache');

// Never overwrite good data
const lot3 = enrichResult.lots.find(l => l.lot === 3);
assert(lot3.tenure === 'Freehold', 'Existing tenure preserved');
assert(lot3.beds === 2, 'Existing beds preserved');

// Enrichment tags
assert(lot1._enrichedFields && lot1._enrichedFields.length > 0, 'Enriched fields tagged');

// Enrichment report
const report = getEnrichmentReport(enrichResult.lots, 'enrichTest');
assert(report.totalLots === 3, 'Report shows correct lot count');
assert(report.gaps.price !== undefined, 'Report includes gap analysis');

// ═══════════════════════════════════════════════════════════════
// 7. HOUSE DISCOVERY
// ═══════════════════════════════════════════════════════════════
section('house-discovery');

initDiscovery(null, null); // no supabase/AI in tests
const budget = getDiscoveryBudget();
assert(budget.budget > 0, `Discovery budget exists: ${budget.budget}`);
assert(budget.remaining >= 0, `Budget remaining: ${budget.remaining}`);

// ═══════════════════════════════════════════════════════════════
// 8. EXTRACTOR GENERATOR
// ═══════════════════════════════════════════════════════════════
section('extractor-generator');

initGenerator(null, null); // no supabase/AI in tests

// Platform templates
const eigTemplate = getTemplateExtractor('eig');
assert(eigTemplate && eigTemplate.includes('querySelectorAll'), 'EIG template exists and uses querySelectorAll');

const sdlTemplate = getTemplateExtractor('sdl');
assert(sdlTemplate && sdlTemplate.includes('property-card'), 'SDL template exists');

// Generator log starts empty
const log = getGeneratorLog();
assert(Array.isArray(log), 'Generator log is an array');

// ═══════════════════════════════════════════════════════════════
// 9. MANAGER
// ═══════════════════════════════════════════════════════════════
section('manager');

// Init with minimal deps
initManager({
  supabase: null,
  callAI: null,
  houseRoots: { test: 'https://example.com' },
  domExtractors: {},
  healBrokenHouse: null,
});

// Config
const config = getManagerConfig();
assert(config.enabled === true, 'Manager enabled by default');
assert(config.cycleBudgetAI > 0, `AI budget: ${config.cycleBudgetAI}`);

// Update config
setManagerConfig({ cycleBudgetAI: 10 });
assert(getManagerConfig().cycleBudgetAI === 10, 'Config updated');

// Run cycle (with no supabase — will still produce report)
const managerReport = await runManagerCycle();
assert(managerReport.cycle > 0, `Cycle number: ${managerReport.cycle}`);
assert(managerReport.health_summary !== undefined, 'Report includes health summary');
assert(managerReport.effectiveness_score >= 0, `Effectiveness: ${managerReport.effectiveness_score}`);

// getManagerReport
const lastReport = getManagerReport();
assert(lastReport !== null, 'Last report available');
assert(lastReport.cycle === managerReport.cycle, 'Last report matches');

// Disable manager
setManagerConfig({ enabled: false });
const skippedReport = await runManagerCycle();
assert(skippedReport.skipped === true, 'Disabled manager skips cycle');
setManagerConfig({ enabled: true }); // re-enable

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
console.log(`\n═══ HARNESS TESTS: ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);
