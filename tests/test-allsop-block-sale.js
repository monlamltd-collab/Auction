// tests/test-allsop-block-sale.js
/**
 * Allsop Block-Sale Tests
 * =======================
 * Tests the RI/RP/CI prefix classifier (lib/scraper/allsop.js),
 * the new manifest skip-recorders (lib/enrichment-manifest.js),
 * and the analyseLot block-lot gating (lib/pipeline/scoring.js).
 *
 * Background: Allsop's JSON API returns reference codes whose prefix
 * encodes the lot type. RI* / RP* / CI* are whole-block / portfolio
 * sales. Storing them as a single flat (the API's property_types[0])
 * broke per-unit yield + below-market signals — Lakeshore RI00313
 * showed below_market = -4969% and yield = 0.20%.
 *
 * Run: node tests/test-allsop-block-sale.js
 */

import { classifyAllsopRefPrefix } from '../lib/scraper/allsop.js';
import {
  createManifest,
  recordYieldSkipped,
  recordBelowMarketSkipped,
  recordYieldScoring,
  recordBelowMarketScoring,
  canScoreYield,
  canScoreBelowMarket,
  SCORING_SKIP_REASONS,
} from '../lib/enrichment-manifest.js';
import { analyseLot } from '../lib/pipeline/scoring.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

function assertThrows(fn, pattern, msg) {
  try { fn(); assert(false, `${msg} (expected throw)`); }
  catch (e) { assert(pattern.test(e.message), `${msg} — threw: ${e.message}`); }
}

// ═══════════════════════════════════════════════════════════════
// classifyAllsopRefPrefix
// ═══════════════════════════════════════════════════════════════
console.log('\n── classifyAllsopRefPrefix ──');
{
  assert(classifyAllsopRefPrefix('RI00313') === 'block_sale', 'RI prefix → block_sale');
  assert(classifyAllsopRefPrefix('RI00001') === 'block_sale', 'RI with low number → block_sale');
  assert(classifyAllsopRefPrefix('RI99999') === 'block_sale', 'RI with high number → block_sale');
  assert(classifyAllsopRefPrefix('RP00054') === 'portfolio', 'RP prefix → portfolio');
  assert(classifyAllsopRefPrefix('CI00038') === 'commercial_block', 'CI prefix → commercial_block');
  assert(classifyAllsopRefPrefix('R00001') === null, 'single-letter R prefix → null (not RI/RP/CI)');
  assert(classifyAllsopRefPrefix('AB12345') === null, 'unrelated prefix → null');
  assert(classifyAllsopRefPrefix('') === null, 'empty string → null');
  assert(classifyAllsopRefPrefix(null) === null, 'null → null');
  assert(classifyAllsopRefPrefix(undefined) === null, 'undefined → null');
  assert(classifyAllsopRefPrefix('00313') === null, 'no prefix letters → null');
}

// ═══════════════════════════════════════════════════════════════
// SCORING_SKIP_REASONS registry
// ═══════════════════════════════════════════════════════════════
console.log('\n── SCORING_SKIP_REASONS ──');
{
  assert(Array.isArray(SCORING_SKIP_REASONS), 'is an array');
  assert(SCORING_SKIP_REASONS.includes('skipped_block_lot'), 'includes skipped_block_lot');
  assert(Object.isFrozen(SCORING_SKIP_REASONS), 'is frozen');
}

// ═══════════════════════════════════════════════════════════════
// recordYieldSkipped + recordBelowMarketSkipped
// ═══════════════════════════════════════════════════════════════
console.log('\n── recordYieldSkipped ──');
{
  const m = createManifest();
  recordYieldSkipped(m, 'skipped_block_lot');
  assert(m.scoring.yield_scored_by === 'skipped_block_lot', 'yield_scored_by set to skip reason');
  assert(canScoreYield(m) === false, 'canScoreYield → false (slot closed)');
}

console.log('\n── recordYieldSkipped: first-writer-wins ──');
{
  const m = createManifest();
  recordYieldSkipped(m, 'skipped_block_lot');
  recordYieldScoring(m, { scoredBy: 'scoring', signal: '8% GIY' });
  assert(m.scoring.yield_scored_by === 'skipped_block_lot',
    'skip reason preserved when later genuine score attempts to write');
}

console.log('\n── recordYieldSkipped validation ──');
{
  const m = createManifest();
  assertThrows(
    () => recordYieldSkipped(m, undefined),
    /reason is required/i,
    'throws on missing reason',
  );
  assertThrows(
    () => recordYieldSkipped(m, 'made_up_reason'),
    /unknown reason/i,
    'throws on unregistered reason',
  );
}

console.log('\n── recordBelowMarketSkipped ──');
{
  const m = createManifest();
  recordBelowMarketSkipped(m, 'skipped_block_lot');
  assert(m.scoring.below_market_scored_by === 'skipped_block_lot', 'below_market_scored_by set');
  assert(canScoreBelowMarket(m) === false, 'canScoreBelowMarket → false (slot closed)');
}

console.log('\n── recordBelowMarketSkipped: first-writer-wins ──');
{
  const m = createManifest();
  recordBelowMarketSkipped(m, 'skipped_block_lot');
  recordBelowMarketScoring(m);
  assert(m.scoring.below_market_scored_by === 'skipped_block_lot',
    'skip reason preserved when later genuine score attempts to write');
}

console.log('\n── recordBelowMarketSkipped validation ──');
{
  const m = createManifest();
  assertThrows(
    () => recordBelowMarketSkipped(m, undefined),
    /reason is required/i,
    'throws on missing reason',
  );
  assertThrows(
    () => recordBelowMarketSkipped(m, 'made_up_reason'),
    /unknown reason/i,
    'throws on unregistered reason',
  );
}

// ═══════════════════════════════════════════════════════════════
// analyseLot — block-lot scoring gates
// ═══════════════════════════════════════════════════════════════
console.log('\n── analyseLot: yield NOT scored on block_sale prop_type ──');
{
  // A block_sale lot with text that WOULD ordinarily fire a yield signal
  const lot = {
    address: '123 Block St',
    bullets: [],
    price: 9500000,
    propType: 'block_sale',
    raw_text: 'Let at £600,000 per annum across 60 flats',
  };
  const result = analyseLot(lot);
  assert(result._enrichment.scoring.yield_scored_by === 'skipped_block_lot',
    'yield slot closed with skipped_block_lot reason');
  assert(!result.opps.some(o => /GIY/.test(o)), 'no GIY signal in opps');
  assert(!result.scoreBreakdown?.some(s => /GIY/.test(s.signal)), 'no GIY signal in scoreBreakdown');
}

console.log('\n── analyseLot: below_market also closed for block_sale ──');
{
  const lot = {
    address: '123 Block St',
    bullets: [],
    price: 9500000,
    propType: 'block_sale',
    raw_text: '',
  };
  const result = analyseLot(lot);
  assert(result._enrichment.scoring.below_market_scored_by === 'skipped_block_lot',
    'below_market slot closed with skipped_block_lot reason');
}

console.log('\n── analyseLot: portfolio + commercial_block both gated ──');
{
  for (const propType of ['portfolio', 'commercial_block']) {
    const lot = {
      address: '1 Portfolio Way',
      bullets: [],
      price: 5000000,
      propType,
      raw_text: 'Producing £400,000 per annum',
    };
    const result = analyseLot(lot);
    assert(result._enrichment.scoring.yield_scored_by === 'skipped_block_lot',
      `yield gated for propType='${propType}'`);
    assert(result._enrichment.scoring.below_market_scored_by === 'skipped_block_lot',
      `below_market gated for propType='${propType}'`);
  }
}

console.log('\n── analyseLot: units > 1 also triggers the gate ──');
{
  // Even without an upstream block-class propType, units > 1 is a portfolio signal.
  const lot = {
    address: '1 Tower Block',
    bullets: [],
    price: 4000000,
    units: 25,
    raw_text: 'Producing £200,000 per annum',
  };
  const result = analyseLot(lot);
  assert(result._enrichment.scoring.yield_scored_by === 'skipped_block_lot',
    'yield gated when units > 1');
  assert(result._enrichment.scoring.below_market_scored_by === 'skipped_block_lot',
    'below_market gated when units > 1');
}

console.log('\n── analyseLot: ordinary flat still scores yield normally ──');
{
  // A real per-unit lot should still score yield if the rent text is present.
  // Note: scoring.js builds its search text from bullets + address, not from
  // a separate raw_text field — see lib/pipeline/scoring.js line 40.
  const lot = {
    address: '5 Normal Road, Bristol',
    bullets: ['Let at £15,000 per annum'],
    price: 200000,
    propType: 'flat',
  };
  const result = analyseLot(lot);
  assert(result._enrichment.scoring.yield_scored_by === 'scoring',
    'yield_scored_by set to scoring for ordinary flat');
  assert(result.opps.some(o => /GIY/.test(o)), 'GIY signal recorded in opps');
}

console.log('\n── analyseLot: upstream block_sale propType survives inference ──');
{
  // Upstream (Allsop scraper) sets propType='block_sale'. The analyseLot
  // inference based on bullet text would otherwise overwrite it back to 'flat'
  // because 'Flats/Houses' bullets contain the word 'flat'.
  const lot = {
    address: 'Lakeshore, Lakeshore Drive, Bristol, BS13 7BA',
    bullets: ['Flats/Houses', 'EXCHANGED', 'Offers in Excess Of', 'Residential'],
    price: 9500000,
    propType: 'block_sale',
    raw_text: 'flat Leasehold. Standard.',
  };
  const result = analyseLot(lot);
  assert(result.propType === 'block_sale',
    `upstream block_sale survives inference (got '${result.propType}')`);
}

// ─── Summary ───
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
