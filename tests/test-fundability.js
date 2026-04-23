/**
 * Fundability Badge Test Suite
 * ============================
 * Tests lot-to-DealEssentials mapping, BridgeMatch URL builder,
 * property type mapping, refurb detection, cache TTL, and provenance.
 *
 * Run: node tests/test-fundability.js
 */

import {
  mapLotToDeal,
  buildBridgematchUrl,
  _mapPropertyType,
  _deriveDeal,
  getFundabilityBadge,
} from '../lib/fundability.js';

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

// ─── mapLotToDeal — core fields ───
console.log('\n── mapLotToDeal (core fields) ──');

// Standard residential (non-refurb)
const stdLot = { price: 200000, propType: 'house', condition: 'good', address: '10 High St, London' };
const stdDeal = mapLotToDeal(stdLot);
assert(stdDeal.purchase_price === 200000, 'purchase_price = lot.price');
assert(stdDeal.market_value === 200000, 'market_value = lot.price (conservative)');
assert(stdDeal.property_type === 'residential', 'house maps to residential');
assert(stdDeal.is_refurb === false, 'good condition = not refurb');
assert(stdDeal.geography === 'England', 'default geography is England');
assert(stdDeal.loan_amount === 150000, 'residential loan_amount = price * 0.75 (type-aware LTV)');
assert(stdDeal.works_cost === undefined, 'non-refurb: no works_cost');
assert(stdDeal.gdv === undefined, 'non-refurb: no gdv');
assert(stdDeal.loan_term === undefined, 'non-refurb: no loan_term');

// Commercial — 60% LTV
const commLot = { price: 500000, propType: 'commercial', condition: 'good' };
const commDeal = mapLotToDeal(commLot);
assert(commDeal.loan_amount === 300000, 'commercial loan_amount = price * 0.60');
assert(commDeal.property_type === 'commercial', 'commercial type preserved');

// Land — 45% LTV
const landDeal = mapLotToDeal({ price: 200000, propType: 'land' });
assert(landDeal.loan_amount === 90000, 'land loan_amount = price * 0.45');
assert(landDeal.property_type === 'land', 'land type preserved');

// ─── mapLotToDeal — refurb detection + derived refurb fields ───
console.log('\n── mapLotToDeal (refurb) ──');

// Poor condition — 25% works, 1.25x GDV
const poorLot = { price: 100000, propType: 'house', condition: 'poor' };
const poorDeal = mapLotToDeal(poorLot);
assert(poorDeal.is_refurb === true, 'poor condition = refurb');
assert(poorDeal.works_cost === 25000, 'poor → works_cost = 25% of price');
assert(poorDeal.gdv === 125000, 'refurb gdv = price * 1.25');
assert(poorDeal.loan_term === 12, 'refurb loan_term = 12 months default');

// Derelict — 30%
const derelictLot = { price: 50000, propType: 'house', condition: 'derelict' };
const derelictDeal = mapLotToDeal(derelictLot);
assert(derelictDeal.is_refurb === true, 'derelict condition = refurb');
assert(derelictDeal.works_cost === 15000, 'derelict → works_cost = 30% of price');

// Needs work — 15%
const worksLot = { price: 100000, propType: 'flat', condition: 'needs work' };
const worksDeal = mapLotToDeal(worksLot);
assert(worksDeal.is_refurb === true, 'needs work = refurb');
assert(worksDeal.works_cost === 15000, 'needs work → works_cost = 15% of price');

// Needs refurbishment — 15%
const refurbLot = { price: 80000, propType: 'house', condition: 'needs refurbishment' };
assert(mapLotToDeal(refurbLot).works_cost === 12000, 'needs refurbishment → 15% of price');

// Needs modernisation — 12%
const modernLot = { price: 80000, propType: 'house', condition: 'needs modernisation' };
const modernDeal = mapLotToDeal(modernLot);
assert(modernDeal.is_refurb === true, 'needs modernisation = refurb');
assert(modernDeal.works_cost === 9600, 'needs modernisation → works_cost = 12% of price');

// ─── mapLotToDeal — edge cases ───
console.log('\n── mapLotToDeal (edge cases) ──');

// No condition
const noCond = { price: 150000, propType: 'commercial' };
assert(mapLotToDeal(noCond).is_refurb === false, 'no condition = not refurb');

// Zero price
const zeroPriceLot = { price: 0, propType: 'house', condition: 'good' };
const zeroDeal = mapLotToDeal(zeroPriceLot);
assert(zeroDeal.purchase_price === 0, 'zero price preserved');
assert(zeroDeal.loan_amount === 0, 'zero price = zero loan');

// Zero price + refurb: should not add derived refurb fields (no base to proxy from)
const zeroRefurb = mapLotToDeal({ price: 0, propType: 'house', condition: 'derelict' });
assert(zeroRefurb.works_cost === undefined, 'zero price + refurb: no works_cost');
assert(zeroRefurb.gdv === undefined, 'zero price + refurb: no gdv');

// Null/missing price — fallback to guidePrice
const guideLot = { guidePrice: 300000, propType: 'flat', condition: '' };
const guideDeal = mapLotToDeal(guideLot);
assert(guideDeal.purchase_price === 300000, 'falls back to guidePrice');
assert(guideDeal.loan_amount === 225000, 'loan_amount from guidePrice at 75% resi LTV');

// Both price and guidePrice — price wins
const bothLot = { price: 200000, guidePrice: 250000, propType: 'house' };
assert(mapLotToDeal(bothLot).purchase_price === 200000, 'price takes precedence over guidePrice');

// Completely missing price
const noPriceLot = { propType: 'land' };
const noPriceDeal = mapLotToDeal(noPriceLot);
assert(noPriceDeal.purchase_price === 0, 'missing price → 0');

// Scottish geography detection
const scotLot = { price: 100000, propType: 'house', address: '15 Royal Mile, Edinburgh EH1 2PB' };
assert(mapLotToDeal(scotLot).geography === 'Scotland', 'Edinburgh address → Scotland');

// Welsh geography detection
const welshLot = { price: 100000, propType: 'flat', address: '3 Castle St, Cardiff CF10 1BT' };
assert(mapLotToDeal(welshLot).geography === 'Wales', 'Cardiff address → Wales');

// ─── _deriveDeal provenance ───
console.log('\n── _deriveDeal provenance ──');

const { provenance: provStd } = _deriveDeal(stdLot);
assert(provStd.ltv_pct === 75, 'residential provenance: ltv_pct = 75');
assert(provStd.ltv_source === 'type_default:residential', 'ltv_source flags type-default origin');
assert(provStd.gdv_source === 'purchase_price', 'non-refurb: gdv_source = purchase_price');
assert(provStd.works_cost_source === null, 'non-refurb: works_cost_source = null');
assert(provStd.confidence === 'high', 'non-refurb: confidence = high');

const { provenance: provComm } = _deriveDeal(commLot);
assert(provComm.ltv_pct === 60, 'commercial provenance: ltv_pct = 60');

const { provenance: provLand } = _deriveDeal({ price: 100000, propType: 'land' });
assert(provLand.ltv_pct === 45, 'land provenance: ltv_pct = 45');

const { provenance: provPoor } = _deriveDeal(poorLot);
assert(provPoor.works_cost_source === 'condition:poor', 'poor → works_cost_source labelled');
assert(provPoor.gdv_source === 'proxy_1.25x', 'refurb: gdv_source flags proxy');
assert(provPoor.loan_term_source === 'default_12m', 'refurb: loan_term_source flags default');
assert(provPoor.confidence === 'medium', 'refurb: confidence downgraded to medium');

const { provenance: provDerelict } = _deriveDeal(derelictLot);
assert(provDerelict.works_cost_source === 'condition:derelict', 'derelict → works_cost_source labelled');

const { provenance: provModern } = _deriveDeal(modernLot);
assert(provModern.works_cost_source === 'condition:modernisation', 'modernisation → works_cost_source labelled');

// ─── buildBridgematchUrl ───
console.log('\n── buildBridgematchUrl ──');

const deal = {
  purchase_price: 200000,
  property_type: 'residential',
  loan_amount: 140000,
  is_refurb: false,
  geography: 'England',
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
const refurbDeal = { purchase_price: 100000, property_type: 'residential', loan_amount: 70000, is_refurb: true, geography: 'England' };
assert(buildBridgematchUrl(refurbDeal).includes('is_refurb=true'), 'refurb deal has is_refurb=true');

// ─── getFundabilityBadge (mocked fetch) ───
console.log('\n── getFundabilityBadge ──');

// Save original fetch
const _origFetch = globalThis.fetch;

// Helper to mock fetch + capture the request body the badge sent
let lastRequestBody = null;
function mockFetch(response, status = 200) {
  globalThis.fetch = async (_url, opts) => {
    lastRequestBody = opts?.body ? JSON.parse(opts.body) : null;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
    };
  };
}

// Test: successful API call (residential non-refurb)
mockFetch({ summary: { eligible: 12, possible: 3 }, eligible: new Array(12) });
const successLot = { price: 250000, propType: 'house', condition: 'good', address: '1 Test St, London' };
const successResult = await getFundabilityBadge(successLot);
assert(successResult !== null, 'successful call returns result');
assert(successResult.lenderCount === 12, 'lenderCount from summary.eligible');
assert(successResult.possibleCount === 3, 'possibleCount from summary.possible');
assert(successResult.ltv === 75, 'residential ltv in result = 75');
assert(successResult.bridgematchUrl.includes('purchase_price=250000'), 'bridgematchUrl has price');
assert(successResult._provenance?.status === 'api_ok', 'provenance.status = api_ok on fresh API call');
assert(successResult._provenance?.confidence === 'high', 'non-refurb result carries high confidence');
assert(typeof successResult._provenance?.response_time_ms === 'number', 'provenance.response_time_ms set');
assert(lastRequestBody?.loan_amount === 187500, 'API received 75% LTV loan_amount for residential');
assert(lastRequestBody?.works_cost === undefined, 'API not sent works_cost for non-refurb');

// Test: refurb lot sends works_cost, gdv, loan_term to API
mockFetch({ summary: { eligible: 8, possible: 2 } });
const refurbApiLot = { price: 100000, propType: 'house', condition: 'poor', address: '1 Ruin Rd, London' };
const refurbApiResult = await getFundabilityBadge(refurbApiLot);
assert(refurbApiResult !== null, 'refurb lot returns result');
assert(lastRequestBody?.is_refurb === true, 'refurb sent to API');
assert(lastRequestBody?.works_cost === 25000, 'works_cost sent to API (25% of price for poor)');
assert(lastRequestBody?.gdv === 125000, 'gdv sent to API (1.25x price)');
assert(lastRequestBody?.loan_term === 12, 'loan_term sent to API (default 12m)');
assert(refurbApiResult._provenance?.confidence === 'medium', 'refurb result flagged medium confidence');
assert(refurbApiResult._provenance?.gdv_source === 'proxy_1.25x', 'refurb result carries gdv provenance');

// Test: second call for same deal hits cache — status becomes cache_hit
mockFetch({ summary: { eligible: 999 } }); // different data, should not be returned
const refurbCached = await getFundabilityBadge(refurbApiLot);
assert(refurbCached.lenderCount === 8, 'cache hit returns cached lenderCount (not new mock)');
assert(refurbCached._provenance?.status === 'cache_hit', 'cache hit flagged in provenance');

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
