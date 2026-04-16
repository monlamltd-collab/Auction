/**
 * Fundability Badge Test Suite
 * ============================
 * Tests lot-to-DealEssentials mapping, BridgeMatch URL builder,
 * property type mapping, refurb detection, and cache TTL.
 *
 * Run: node tests/test-fundability.js
 */

import { mapLotToDeal, buildBridgematchUrl, _mapPropertyType, getFundabilityBadge } from '../lib/fundability.js';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

// ─── mapPropertyType ───
console.log('\n── mapPropertyType ──');

assert(_mapPropertyType('house') === 'residential', 'house → residential');
assert(_mapPropertyType('flat') === 'residential', 'flat → residential');
assert(_mapPropertyType('apartment') === 'residential', 'apartment → residential');
assert(_mapPropertyType('bungalow') === 'residential', 'bungalow → residential');
assert(_mapPropertyType('maisonette') === 'residential', 'maisonette → residential');
assert(_mapPropertyType('cottage') === 'residential', 'cottage → residential');
assert(_mapPropertyType('commercial') === 'commercial', 'commercial → commercial');
assert(_mapPropertyType('shop') === 'commercial', 'shop → commercial');
assert(_mapPropertyType('office') === 'commercial', 'office → commercial');
assert(_mapPropertyType('land') === 'land', 'land → land');
assert(_mapPropertyType('plot') === 'land', 'plot → land');
assert(_mapPropertyType('garage') === 'residential', 'garage → residential (default)');
assert(_mapPropertyType('other') === 'residential', 'other → residential (default)');
assert(_mapPropertyType('') === 'residential', 'empty → residential (default)');
assert(_mapPropertyType(undefined) === 'residential', 'undefined → residential (default)');
assert(_mapPropertyType('HOUSE') === 'residential', 'HOUSE (uppercase) → residential');

// ─── mapLotToDeal ───
console.log('\n── mapLotToDeal ──');

// Standard lot with price
const stdLot = { price: 200000, propType: 'house', condition: 'good', address: '10 High St, London' };
const stdDeal = mapLotToDeal(stdLot);
assert(stdDeal.purchase_price === 200000, 'purchase_price = lot.price');
assert(stdDeal.market_value === 200000, 'market_value = lot.price (conservative)');
assert(stdDeal.loan_amount === 140000, 'loan_amount = price * 0.7');
assert(stdDeal.property_type === 'residential', 'house maps to residential');
assert(stdDeal.is_refurb === false, 'good condition = not refurb');
assert(stdDeal.geography === 'England', 'default geography is England');

// Refurb detection — poor condition
const poorLot = { price: 100000, propType: 'house', condition: 'poor' };
assert(mapLotToDeal(poorLot).is_refurb === true, 'poor condition = refurb');

// Refurb detection — needs work
const worksLot = { price: 100000, propType: 'flat', condition: 'needs work' };
assert(mapLotToDeal(worksLot).is_refurb === true, 'needs work = refurb');

// Refurb detection — derelict
const derelictLot = { price: 50000, propType: 'house', condition: 'derelict' };
assert(mapLotToDeal(derelictLot).is_refurb === true, 'derelict condition = refurb');

// Refurb detection — needs modernisation (from bullets, not condition field)
const modernLot = { price: 80000, propType: 'house', condition: 'needs modernisation' };
assert(mapLotToDeal(modernLot).is_refurb === true, 'needs modernisation = refurb');

// Refurb detection — needs refurbishment
const refurbLot = { price: 80000, propType: 'house', condition: 'needs refurbishment' };
assert(mapLotToDeal(refurbLot).is_refurb === true, 'needs refurbishment = refurb');

// No condition
const noCond = { price: 150000, propType: 'commercial' };
assert(mapLotToDeal(noCond).is_refurb === false, 'no condition = not refurb');

// Zero price
const zeroPriceLot = { price: 0, propType: 'house', condition: 'good' };
const zeroDeal = mapLotToDeal(zeroPriceLot);
assert(zeroDeal.purchase_price === 0, 'zero price preserved');
assert(zeroDeal.loan_amount === 0, 'zero price = zero loan');

// Null/missing price — fallback to guidePrice
const guideLot = { guidePrice: 300000, propType: 'flat', condition: '' };
const guideDeal = mapLotToDeal(guideLot);
assert(guideDeal.purchase_price === 300000, 'falls back to guidePrice');
assert(guideDeal.loan_amount === 210000, 'loan_amount from guidePrice');

// Both price and guidePrice — price wins
const bothLot = { price: 200000, guidePrice: 250000, propType: 'house' };
assert(mapLotToDeal(bothLot).purchase_price === 200000, 'price takes precedence over guidePrice');

// Completely missing price
const noPriceLot = { propType: 'land' };
const noPriceDeal = mapLotToDeal(noPriceLot);
assert(noPriceDeal.purchase_price === 0, 'missing price → 0');

// Land type
const landLot = { price: 50000, propType: 'land' };
assert(mapLotToDeal(landLot).property_type === 'land', 'land propType maps correctly');

// Scottish geography detection
const scotLot = { price: 100000, propType: 'house', address: '15 Royal Mile, Edinburgh EH1 2PB' };
assert(mapLotToDeal(scotLot).geography === 'Scotland', 'Edinburgh address → Scotland');

// Welsh geography detection
const welshLot = { price: 100000, propType: 'flat', address: '3 Castle St, Cardiff CF10 1BT' };
assert(mapLotToDeal(welshLot).geography === 'Wales', 'Cardiff address → Wales');

// ─── buildBridgematchUrl ───
console.log('\n── buildBridgematchUrl ──');

const deal = {
  purchase_price: 200000,
  property_type: 'residential',
  loan_amount: 140000,
  is_refurb: false,
};
const bmUrl = buildBridgematchUrl(deal);
assert(bmUrl.startsWith('https://www.bridgematch.co.uk/check?'), 'URL starts with BridgeMatch check page');
assert(bmUrl.includes('purchase_price=200000'), 'includes purchase_price');
assert(bmUrl.includes('property_type=residential'), 'includes property_type');
assert(bmUrl.includes('loan_amount=140000'), 'includes loan_amount');
assert(bmUrl.includes('is_refurb=false'), 'includes is_refurb');
assert(bmUrl.includes('utm_source=auctionbrain'), 'includes utm_source');
assert(bmUrl.includes('utm_medium=lot_badge'), 'includes utm_medium');
assert(bmUrl.includes('utm_campaign=fundability'), 'includes utm_campaign');

// Refurb deal
const refurbDeal = { purchase_price: 100000, property_type: 'residential', loan_amount: 70000, is_refurb: true };
assert(buildBridgematchUrl(refurbDeal).includes('is_refurb=true'), 'refurb deal has is_refurb=true');

// ─── getFundabilityBadge (mocked fetch) ───
console.log('\n── getFundabilityBadge ──');

// Save original fetch
const _origFetch = globalThis.fetch;

// Helper to mock fetch
function mockFetch(response, status = 200) {
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
  });
}

// Test: successful API call
mockFetch({ summary: { eligible: 12, possible: 3 }, eligible: new Array(12) });
const successLot = { price: 250000, propType: 'house', condition: 'good', address: '1 Test St, London' };
const successResult = await getFundabilityBadge(successLot);
assert(successResult !== null, 'successful call returns result');
assert(successResult.lenderCount === 12, 'lenderCount from summary.eligible');
assert(successResult.possibleCount === 3, 'possibleCount from summary.possible');
assert(successResult.ltv === 70, 'default LTV is 70');
assert(successResult.bridgematchUrl.includes('purchase_price=250000'), 'bridgematchUrl has price');

// Test: zero-price lot returns null without calling API
let fetchCalled = false;
globalThis.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };
const zeroPriceResult = await getFundabilityBadge({ price: 0, propType: 'house' });
assert(zeroPriceResult === null, 'zero price returns null');
assert(!fetchCalled, 'zero price does not call fetch');

// Test: API error returns null (graceful degradation)
globalThis.fetch = async () => { throw new Error('Network error'); };
const errorLot = { price: 999999, propType: 'land', condition: '' };
const errorResult = await getFundabilityBadge(errorLot);
assert(errorResult === null, 'network error returns null');

// Test: non-200 response returns null
mockFetch({}, 500);
const serverErrLot = { price: 888888, propType: 'commercial', condition: '' };
const serverErrResult = await getFundabilityBadge(serverErrLot);
assert(serverErrResult === null, 'server error returns null');

// Restore original fetch
globalThis.fetch = _origFetch;

// ─── Summary ───
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
