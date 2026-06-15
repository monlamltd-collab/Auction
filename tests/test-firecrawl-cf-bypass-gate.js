/**
 * Firecrawl CF-bypass-only gate tests
 * ===================================
 * Verifies FIRECRAWL_CF_BYPASS_ONLY (Simon, 2026-06-15): every Firecrawl entry
 * point is blocked unless it's a proxy:'stealth' Cloudflare-bypass call. This is
 * the guard that stops the FIRE-1 agent + per-page JSON-extract from re-burning
 * the 1,000-credit budget (root cause of the 2026-06-01..03 6,209-credit spend).
 *
 * Offline by design: the gate fires BEFORE canUseFirecrawl() and before any
 * fetch, so the blocked-path assertions never touch the network.
 *
 * Run: node tests/test-firecrawl-cf-bypass-gate.js
 */

import { ResourceBudget } from '../lib/resource-budget.js';
import { initState } from '../lib/scraper/state.js';
import {
  isFirecrawlCfBypassOnly,
  assertFirecrawlAllowed,
  scrapeWithFirecrawl,
  extractCatalogue,
  extractHomepage,
  extractDetail,
  batchExtractCatalogues,
  agentExtract,
  mapSiteUrls,
} from '../lib/scraper/firecrawl.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const ORIG = process.env.FIRECRAWL_CF_BYPASS_ONLY;
function setFlag(v) {
  if (v === undefined) delete process.env.FIRECRAWL_CF_BYPASS_ONLY;
  else process.env.FIRECRAWL_CF_BYPASS_ONLY = v;
}

async function throwsGate(fn) {
  try { await fn(); return false; }
  catch (e) { return !!e && e.code === 'FC_CF_BYPASS_ONLY'; }
}

// A budget whose canUseFirecrawl() is TRUE, so the GATE (not the budget) is what
// blocks the no-proxy calls below.
const budget = new ResourceBudget({ firecrawlApiKey: 'test-key', monthlyBudget: 1000 });
initState({ budget });

// ── Test 1: default (flag unset) = gate ON ──
console.log('Test 1: default mode is CF-bypass-only (flag unset)');
{
  setFlag(undefined);
  assert(isFirecrawlCfBypassOnly() === true, 'isFirecrawlCfBypassOnly() true by default');
}

// ── Test 2: pure guard logic ──
console.log('\nTest 2: assertFirecrawlAllowed gate logic');
{
  setFlag(undefined);
  let threw = false;
  try { assertFirecrawlAllowed('x', {}); } catch (e) { threw = e.code === 'FC_CF_BYPASS_ONLY'; }
  assert(threw, 'no-proxy call throws FC_CF_BYPASS_ONLY when gate on');

  let stealthOk = true;
  try { assertFirecrawlAllowed('x', { proxy: 'stealth' }); } catch { stealthOk = false; }
  assert(stealthOk, 'proxy:stealth call is allowed when gate on');
}

// ── Test 3: gate off (flag=false) allows everything ──
console.log('\nTest 3: FIRECRAWL_CF_BYPASS_ONLY=false disables the gate');
{
  setFlag('false');
  assert(isFirecrawlCfBypassOnly() === false, 'isFirecrawlCfBypassOnly() false when flag=false');
  let ok = true;
  try { assertFirecrawlAllowed('x', {}); } catch { ok = false; }
  assert(ok, 'no-proxy call allowed when gate off');
}

// ── Test 4: every entry point blocked without stealth (no network hit) ──
console.log('\nTest 4: all Firecrawl entry points blocked in CF-bypass-only mode');
{
  setFlag(undefined); // gate ON
  assert(await throwsGate(() => scrapeWithFirecrawl('https://x.test')), 'scrapeWithFirecrawl(no proxy) blocked');
  assert(await throwsGate(() => extractCatalogue('https://x.test')), 'extractCatalogue blocked');
  assert(await throwsGate(() => extractHomepage('https://x.test')), 'extractHomepage blocked');
  assert(await throwsGate(() => extractDetail('https://x.test')), 'extractDetail blocked');
  assert(await throwsGate(() => batchExtractCatalogues(['https://x.test'])), 'batchExtractCatalogues blocked');
  assert(await throwsGate(() => agentExtract('https://x.test', 'p', {})), 'agentExtract (FIRE-1) blocked');
  assert(await throwsGate(() => mapSiteUrls('https://x.test', 'q')), 'mapSiteUrls blocked');
}

// ── Test 5: proxy:stealth scrape passes the gate (CF-bypass path) ──
// Offline-safe: use an over-cap budget so the stealth call stops at
// canUseFirecrawl() (a non-gate error) instead of reaching the network — proving
// the gate itself let the stealth call through.
console.log('\nTest 5: proxy:stealth scrape passes the gate (CF-bypass allowed)');
{
  setFlag(undefined); // gate ON
  const blocked = new ResourceBudget({ firecrawlApiKey: 'test-key', monthlyBudget: 1 });
  blocked.recordFcRequest('full');
  blocked.recordFcRequest('full'); // creditsUsed >= 2 > cap of 1 → canUseFirecrawl() false
  initState({ budget: blocked });

  let err = null;
  try { await scrapeWithFirecrawl('https://x.test', { proxy: 'stealth' }); }
  catch (e) { err = e; }
  assert(err && err.code !== 'FC_CF_BYPASS_ONLY',
    'stealth scrape passes the gate (blocked later by budget, not by FC_CF_BYPASS_ONLY)');

  blocked.destroy?.();
  initState({ budget }); // restore
}

setFlag(ORIG);
budget.destroy?.();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
