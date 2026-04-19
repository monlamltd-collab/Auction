// lib/analysis.js — Auto-analysis orchestration, healing, DB persistence, concurrency
import { createHash } from 'crypto';
import { log } from './logging.js';
import { supabase } from './supabase.js';
import { HOUSE_ROOTS, PUPPETEER_IMAGE_HOUSES, detectAuctionHouse, HOUSE_DISPLAY_NAMES, getHouseDisplayName } from './houses.js';
import { getCacheTTL, MAX_AUCTIONS_PER_HOUSE, HEADERS, MAX_LOTS_PER_SCRAPE, resolveEffectiveTier, stripAIFields } from './config.js';
import { normaliseUrl } from './utils.js';
import { validateUrl } from './security.js';
import { isCircuitOpen, getAllHealth } from './harness/house-health.js';
import { resetBrokenExtractors } from './extractors/index.js';
import { getEnrichmentReport } from './harness/enrichment-engine.js';
import { FALLBACK_CALENDAR } from './calendar.js';
import {
  initExperiment, isTreatmentHouse, startExperimentCycle,
  runModularPipeline, logControlMetrics, endExperimentCycle,
  initHarnessBridge, resetCycleSignals, EnrichmentService,
  initModularScraper, initModularExtractor, initModularScorer,
  probe, scrapeStage, enrichStage, persistStage, cacheEnrichStage,
  healBrokenHouse as _healBrokenHouseImpl,
  getHealingState as _getHealingStateImpl,
  clearHealingCooldown as _clearHealingCooldownImpl,
  discoverAndUpdateCalendar as _discoverAndUpdateCalendarImpl,
  updateHouseSkill as _updateHouseSkillImpl,
  saveDailySnapshot,
} from './pipeline/index.js';

// Dependencies injected via initAnalysis() to avoid circular imports
let _deps = {};

export function initAnalysis(deps) {
  Object.assign(_deps, deps);

  // Initialize experiment infrastructure (gated behind EXPERIMENT_ENABLED env var)
  initExperiment({
    supabase,
    ...deps,
    isCreditExhausted: () => deps.budget ? deps.budget.getCreditExhausted() : false,
  });
  initHarnessBridge({
    healBrokenHouse,
    fireAlert: deps.harnessFireAlert,
  });
}

// ── State variables ──
let _autoAnalysisRunning = false;
// Gemini credit state now delegated to budget (auto-reset handled there too).
// Firecrawl auto-reset timers also handled by budget._autoReset().
let apiCallCount = 0;
let hashHitCount = 0;
const serverStartTime = new Date().toISOString();
// Healing state now managed by lib/pipeline/healing.js
let _enrichmentWaveRunning = false;

// ── State getters/setters ──
// Gemini exhaustion delegates to budget (backward compat for callers)
export function getCreditExhausted() { return _deps.budget ? _deps.budget.getCreditExhausted() : false; }
export function setCreditExhausted(v) { if (_deps.budget) _deps.budget.setCreditExhausted(v); }
export function getCreditExhaustedAt() { return _deps.budget ? _deps.budget.getCreditExhaustedAt() : 0; }
export function setCreditExhaustedAt(v) { if (_deps.budget) _deps.budget.setCreditExhaustedAt(v); }
export function getApiCallCount() { return apiCallCount; }
export function incApiCallCount() { apiCallCount++; }
export function getHashHitCount() { return hashHitCount; }
export function getServerStartTime() { return serverStartTime; }
export function isEnrichmentWaveRunning() { return _enrichmentWaveRunning; }
export function isAutoAnalysisRunning() { return _autoAnalysisRunning; }
export function getHealingState() { return _getHealingStateImpl(); }
export function clearHealingCooldown(slug) { _clearHealingCooldownImpl(slug); }

// ══════════════════════════════════════════════════════════════════
// qualityGate
// ══════════════════════════════════════════════════════════════════
function qualityGate(lots, house, prevCached, prevLots) {
  const alerts = [];
  const before = lots.length;

  // ── Guard 1: Price sanity — strip lots with implausible prices ──
  lots = lots.filter(lot => {
    if (!lot.price) return true; // no price is OK (many lots don't list one)
    if (lot.price < 1000) {
      alerts.push(`Stripped lot with implausible price £${lot.price}: "${(lot.address || '').substring(0, 50)}"`);
      return false;
    }
    if (lot.price > 50000000) {
      alerts.push(`Stripped lot with implausible price £${lot.price.toLocaleString()}: "${(lot.address || '').substring(0, 50)}"`);
      return false;
    }
    return true;
  });

  // ── Guard 2: URL validation — strip lots without a usable URL ──
  lots = lots.filter(lot => {
    if (!lot.url) return true; // missing URL is tolerated (Gemini-extracted lots often lack URLs)
    // Strip lots with javascript: or clearly broken URLs
    if (/^javascript:|^#|^mailto:|^void/i.test(lot.url)) {
      lot.url = ''; // clear the junk URL but keep the lot
    }
    return true;
  });

  // ── Guard 3: Minimum quality gate — reject batch if too sparse ──
  // At least 30% of lots must have either a price OR an image to be worth caching.
  // This catches catastrophic extraction failures where we get addresses only.
  if (lots.length >= 5) {
    const hasSubstance = lots.filter(l => l.price || l.imageUrl).length;
    const coverage = hasSubstance / lots.length;
    if (coverage < 0.3) {
      alerts.push(`QUALITY GATE FAIL: only ${Math.round(coverage * 100)}% of lots have a price or image (${hasSubstance}/${lots.length}). Batch rejected.`);
      return { lots, alerts, rejected: true };
    }
  }

  // ── Guard 4: Regression detection — compare against previous cache ──
  if (prevCached && prevCached.total_lots > 5) {
    // Lot count regression (already in autoAnalyseOne, now universal)
    if (lots.length < prevCached.total_lots * 0.5) {
      alerts.push(`LOT COUNT REGRESSION: ${prevCached.total_lots} → ${lots.length} (${Math.round(lots.length / prevCached.total_lots * 100)}%). Batch rejected.`);
      return { lots, alerts, rejected: true };
    }

    // Image coverage regression — if previous had >50% images and new has <20%, flag it
    if (Array.isArray(prevLots) && prevLots.length > 0) {
      const prevImgCount = prevLots.filter(l => l.imageUrl || l.image_url).length;
      const prevImgPct = prevImgCount / prevCached.total_lots;
      const newImgCount = lots.filter(l => l.imageUrl).length;
      const newImgPct = lots.length > 0 ? newImgCount / lots.length : 0;
      if (prevImgPct > 0.5 && newImgPct < 0.2) {
        alerts.push(`IMAGE COVERAGE REGRESSION: ${Math.round(prevImgPct * 100)}% → ${Math.round(newImgPct * 100)}% (${prevImgCount} → ${newImgCount})`);
        // Don't reject — images can be backfilled, but log the alert
      }
    }
  }

  const stripped = before - lots.length;
  if (stripped > 0) {
    alerts.push(`Cleaned ${stripped} lots with invalid data (${before} → ${lots.length})`);
  }

  // Log all alerts
  for (const a of alerts) {
    console.log(`[QUALITY] ${house}: ${a}`);
  }

  return { lots, alerts, rejected: false };
}

// ══════════════════════════════════════════════════════════════════
// W2N + analyseLot
// ══════════════════════════════════════════════════════════════════
const W2N = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };

function analyseLot(raw) {
  // Strip Strettons date prefix (e.g. "19 Feb 26  -  Lot 25Flat 6 Noble House...")
  let cleanAddress = raw.address;
  cleanAddress = cleanAddress.replace(/^\d{1,2}\s+\w{3}\s+\d{2}\s*-\s*(?:Lot\s*\d+)?/i, '').trim();
  const t = (raw.bullets.join(' ') + ' ' + cleanAddress).toLowerCase();
  const L = { ...raw, score: 0, opps: [], risks: [], dealType: 'Standard', propType: '', beds: null,
    tenure: '', condition: '', vacant: null, sqft: null, titleSplit: false, units: 0 };

  // PropType inference — order matters: specific residential types first, then commercial/land
  // Development sites with bed counts are residential, not land
  const hasBeds = /\d+\s*[-\s]?bed|\bone\s+bed|\btwo\s+bed|\bthree\s+bed|\bstudio/.test(t);
  const hasResidentialSignal = /\bflats?\b|\bhouse\b|\bcottage\b|\bbungalow\b|\bapartments?\b|\bmaisonette\b/.test(t);
  if (/semi[- ]?detached|terraced?|terrace house|detached house|town\s?house|end of terrace|mid[- ]terrace/.test(t)) L.propType = 'house';
  else if (/bungalow/.test(t)) L.propType = 'house';
  else if (/\bflt\b|\bflats?\b|\bapartments?\b|\bmaisonette\b/.test(t) && !/\bblock\b.*\bflats?\b|development\s+site|building\s+plot|planning\s+permission\s+for/.test(t)) L.propType = 'flat';
  else if (/\bdetached\b|period\s+property|residential\s+property|chalet|cottage|lodge|villa|mansion/.test(t)) L.propType = 'house';
  else if (/\bhouse\b/.test(t)) L.propType = 'house';
  else if (/\bshop\b|\boffice\b|\bcommercial\b|\bretail\b|\bindustrial\b|\bwarehouse\b|\bground rent\b/.test(t) && !hasResidentialSignal && !hasBeds) L.propType = 'commercial';
  else if (hasBeds && !hasResidentialSignal) L.propType = 'house'; // Bed count without type = residential
  else if (/\bland\b|\bplot\b|\bsite\b|\bchurch\b|\bhall\b|\bchapel\b/.test(t) && !hasBeds) L.propType = 'land';
  else if (/\bgarage\b|\bparking\b|lock.?up/.test(t)) L.propType = 'garage';
  else if (/\binvestment\b/.test(t) && hasBeds) L.propType = 'house'; // Residential investment
  else if (/\binvestment\b/.test(t)) L.propType = 'commercial'; // Pure investment = commercial
  else L.propType = 'other';

  // Beds — prefer structured field from Gemini, then fall back to regex
  if (raw.beds != null && typeof raw.beds === 'number' && raw.beds >= 0 && raw.beds <= 20) {
    L.beds = raw.beds;
  } else {
    const bm = t.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*[-\s]?bed/) || t.match(/(\w+)\s*[-\s]?bed/);
    if (bm) {
      // "2/3 bed" → take the higher number; "three bed" → word-to-number
      const v = (bm[2] || bm[1]).toLowerCase();
      L.beds = W2N[v] || (v.match(/^\d+$/) ? +v : null);
    }
  }
  // Cap residential bed count at 10 — higher counts are student blocks/HMOs/hotels
  if (L.beds > 10 && ['house', 'flat', 'bungalow'].includes(L.propType)) L.beds = null;
  if (/studio/.test(t) && L.beds === null) L.beds = 0;

  // Tenure — prefer structured field from Gemini, then fall back to regex
  const rawTenure = (raw.tenure || '').trim().toLowerCase();
  if (/share.?of.?freehold/.test(rawTenure)) L.tenure = 'Share of Freehold';
  else if (/freehold/.test(rawTenure) && !/leasehold/.test(rawTenure)) L.tenure = 'Freehold';
  else if (/leasehold/.test(rawTenure)) L.tenure = 'Leasehold';

  // Regex fallback on bullets + address text
  if (!L.tenure) {
    if (/share of freehold|share\s+of\s+the\s+freehold/.test(t)) L.tenure = 'Share of Freehold';
    else if (/flying freehold/.test(t)) L.tenure = 'Freehold';
    else if (/\bfreehold\b/.test(t) && !/leasehold/.test(t)) L.tenure = 'Freehold';
    else if (/long\s+lease(?:hold)?|\bleasehold\b|\blease\s+remaining\b|\byears?\s+(?:remaining|unexpired|left)\b|\b\d+\s*(?:year|yr)\s*lease\b/.test(t)) L.tenure = 'Leasehold';
  }
  // Infer from property type when tenure not stated: flats are almost always leasehold, houses freehold
  if (!L.tenure && L.propType === 'flat' && /\b\d{2,3}\s*(?:year|yr)s?\b/.test(t)) L.tenure = 'Leasehold';

  if (/derelict|dilapidated|fire damage|structurally unsound|uninhabitable|condemned/.test(t)) L.condition = 'poor';
  else if (/modernis|refurbishment|renovation|updating|in need of|improvement|for improve|requires? (?:updating|work|repair)|(?:tired|dated|worn) (?:condition|decor|throughout)|cosmetic work|stripping out|(?:complete|full|extensive) refurb|fixer.upper|requires attention/.test(t)) L.condition = 'needs work';
  else if (/good order|good decorative|well maintained|recently refurbished|well presented|good condition|excellent condition|ready to let|move.in|turnkey/.test(t)) L.condition = 'good';

  if (/vacant possession|\bvp\b|vacant property|\bvacant\b|with vacant|sold with vacant/.test(t)) L.vacant = true;
  else if (/tenant|let to|tenanted|occupied|sitting tenant|subject to tenancy|assured shorthold/.test(t)) L.vacant = false;

  const executor = /executor|probate|estate of|personal representative/.test(t);
  const receivership = /receiver|receivership|administrator|liquidator|lpa receiver/.test(t);
  const devP = /development potential|development opportunity|planning permission|pp granted|change of use|conversion potential|redevelopment|building plot/.test(t);
  const extP = /extension potential|scope to extend|subject to requi[st]i?te? consents|loft conversion|\bhmo\b|potential to extend/.test(t);

  const sm = t.match(/([\d,]+)\s*sq\s*(?:ft|feet)/);
  if (sm) L.sqft = parseInt(sm[1].replace(/,/g, ''));

  let uc = 0;
  const um = t.match(/(\d+)\s*(?:x\s*)?(?:self[- ]contained\s+)?(?:flat|apartment|unit)/); if (um) uc = Math.max(uc, +um[1]);
  const bk = t.match(/block\s+of\s+(\d+)/); if (bk) uc = Math.max(uc, +bk[1]);
  const mx = [...t.matchAll(/(\d+)\s*x\s*(?:one|two|three|1|2|3)\s*[-\s]?bed/g)];
  if (mx.length) uc = Math.max(uc, mx.reduce((s, m) => s + +m[1], 0));
  const fr = cleanAddress.toLowerCase().match(/flats?\s*([a-z])\s*[-–&]\s*([a-z])/);
  if (fr) uc = Math.max(uc, fr[2].charCodeAt(0) - fr[1].charCodeAt(0) + 1);
  const ar = cleanAddress.match(/^(\d+)\s*[-–]\s*(\d+)\s/);
  if (ar) { const d = +ar[2] - +ar[1] + 1; if (d >= 2 && d <= 20) uc = Math.max(uc, d); }
  if (/gff|fff|sff|tff/.test(cleanAddress.toLowerCase())) uc = Math.max(uc, 2);
  const apt = t.match(/(\d+)\s*(?:self[- ]contained\s+)?apartments/); if (apt) uc = Math.max(uc, +apt[1]);
  const isFH = /freehold/.test(t), hasFlats = /flats|apartments|self[- ]contained|arranged as/.test(t);
  const indivSales = /individual flat sales|individual sales/.test(t);
  if (uc >= 2 || ((isFH && hasFlats) || indivSales)) { L.titleSplit = true; L.units = uc || 2; }

  let s = 0;
  const sb = []; // scoreBreakdown: tracks each signal's contribution
  if (L.condition === 'needs work') { s += 2; sb.push({ signal: 'Needs modernisation', pts: 2 }); L.opps.push('Needs modernisation'); }
  if (L.condition === 'poor') { s += 2.5; sb.push({ signal: 'Poor condition', pts: 2.5 }); L.opps.push('Poor condition'); }
  if (executor) { s += 1.5; sb.push({ signal: 'Executor/probate', pts: 1.5 }); L.opps.push('Executor/probate'); }
  if (receivership) { s += 2; sb.push({ signal: 'Receivership', pts: 2 }); L.opps.push('Receivership'); }
  // Development potential: full score for dwellings (it's a genuine uplift signal),
  // reduced for land (it's table stakes — almost every land listing says this)
  if (devP && L.propType !== 'land') { s += 2; sb.push({ signal: 'Development potential', pts: 2 }); L.opps.push('Development potential'); }
  else if (devP && L.propType === 'land') { s += 0.5; sb.push({ signal: 'Development potential', pts: 0.5 }); L.opps.push('Development potential'); }
  if (extP) { s += 1.5; sb.push({ signal: 'Extension/HMO potential', pts: 1.5 }); L.opps.push('Extension/HMO potential'); }
  // Vacant: meaningful for dwellings (no tenant = faster refurb), not for land (land is always vacant)
  if (L.vacant && ['house', 'bungalow', 'flat'].includes(L.propType)) { s += 1; sb.push({ signal: 'Vacant', pts: 1 }); L.opps.push('Vacant'); }
  else if (L.vacant && L.propType === 'land') { L.opps.push('Vacant'); } // tag it but no score boost
  if (L.tenure === 'Freehold' && ['house', 'bungalow'].includes(L.propType)) { s += 0.5; sb.push({ signal: 'Freehold', pts: 0.5 }); L.opps.push('Freehold'); }
  // £/sqft: only meaningful for dwellings with actual floor area (not land/acreage)
  if (L.sqft && L.price && L.propType !== 'land') {
    const p = L.price / L.sqft;
    if (p < 200) { s += 2; sb.push({ signal: `£${Math.round(p)}/sqft`, pts: 2 }); L.opps.push(`£${Math.round(p)}/sqft`); }
    else if (p < 300) { s += 1; sb.push({ signal: `£${Math.round(p)}/sqft`, pts: 1 }); L.opps.push(`£${Math.round(p)}/sqft`); }
  }

  const rm = t.match(/(?:let\s+at|rent\s+of|income\s+of|producing)\s+£?([\d,]+)\s*(?:p\.?a|per\s*annum)/);
  if (rm && L.price) {
    const rent = parseInt(rm[1].replace(/,/g, '')); const gy = (rent / L.price) * 100;
    if (gy > 8) { s += 2.5; sb.push({ signal: `${gy.toFixed(1)}% GIY`, pts: 2.5 }); L.opps.push(`${gy.toFixed(1)}% GIY`); }
    else if (gy > 6) { s += 1.5; sb.push({ signal: `${gy.toFixed(1)}% GIY`, pts: 1.5 }); L.opps.push(`${gy.toFixed(1)}% GIY`); }
  }

  if (/(?:4|5|6)\s*week\s*completion|six week/.test(t)) { s += 0.5; sb.push({ signal: 'Quick completion', pts: 0.5 }); L.opps.push('Quick completion'); }
  if (/by order of/.test(t) && !executor && !receivership) { s += 0.5; sb.push({ signal: 'Motivated seller', pts: 0.5 }); L.opps.push('Motivated seller'); }
  if (L.titleSplit) { s += 1; sb.push({ signal: `Title split (${L.units} units)`, pts: 1 }); L.opps.push(`Title split (${L.units} units)`); }

  if (/sitting tenant/.test(t)) { s -= 2; sb.push({ signal: 'Sitting tenant', pts: -2 }); L.risks.push('Sitting tenant'); }
  if (/knotweed/.test(t)) { s -= 2; sb.push({ signal: 'Knotweed', pts: -2 }); L.risks.push('Knotweed'); }
  if (/flying freehold/.test(t)) { s -= 1; sb.push({ signal: 'Flying freehold', pts: -1 }); L.risks.push('Flying freehold'); }
  if (/non[- ]?standard|timber frame|prefab|prc/.test(t)) { s -= 1; sb.push({ signal: 'Non-std construction', pts: -1 }); L.risks.push('Non-std construction'); }
  if (/flood risk|flood zone/.test(t)) { s -= 1; sb.push({ signal: 'Flood risk', pts: -1 }); L.risks.push('Flood risk'); }
  if (/asbestos|contamination/.test(t)) { s -= 1; sb.push({ signal: 'Contamination', pts: -1 }); L.risks.push('Contamination'); }
  if (/grade ii|listed/.test(t)) L.risks.push('Listed building');
  if (!L.price) L.risks.push('Guide TBA');
  L.scoreBreakdown = sb;

  if (devP) L.dealType = 'Development';
  else if ((L.condition === 'needs work' || L.condition === 'poor') && extP) L.dealType = 'Refurb+Extend';
  else if (L.condition === 'needs work' || L.condition === 'poor') L.dealType = 'Refurb';
  else if (L.titleSplit) L.dealType = 'Title Split';
  else if (executor || receivership) L.dealType = 'Motivated';
  else L.dealType = 'Standard';

  L.score = Math.max(0, Math.min(10, Math.round(s * 10) / 10));
  return L;
}

// ══════════════════════════════════════════════════════════════════
// HOUSE_NAME_MIGRATIONS + syncCalendarAndHouseNames
// ══════════════════════════════════════════════════════════════════
const HOUSE_NAME_MIGRATIONS = {
  'SDL Auctions': 'BTG Eddisons',
};

async function syncCalendarAndHouseNames() {
  if (!supabase) return;
  try {
    // 1) Upsert all FALLBACK_CALENDAR entries into auction_calendar
    const rows = FALLBACK_CALENDAR.map(a => ({
      house: a.house, house_slug: a.houseSlug, logo: a.logo,
      date: a.date, date_end: a.dateEnd || null, title: a.title,
      lots: a.lots || null, url: a.url, location: a.location,
      type: a.type, status: a.status, catalogue_ready: a.catalogueReady,
      updated_at: new Date().toISOString(),
    }));
    const { error: calErr } = await supabase.from('auction_calendar').upsert(rows, { onConflict: 'url,date' });
    if (calErr) console.error('Calendar sync error:', calErr.message);
    else console.log(`Calendar sync: upserted ${rows.length} entries`);

    // 2) Fix stale house names in cached_analyses
    for (const [oldName, newName] of Object.entries(HOUSE_NAME_MIGRATIONS)) {
      const { data, error } = await supabase
        .from('cached_analyses')
        .update({ house: newName })
        .eq('house', oldName);
      if (error) console.error(`House rename ${oldName} → ${newName} error:`, error.message);
      else console.log(`House rename: ${oldName} → ${newName}`);
    }

    // 3) Purge stale calendar entries for past dates
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from('auction_calendar').delete().lt('date', today);
    console.log('Calendar sync: purged past-date entries');
  } catch (e) {
    console.error('syncCalendarAndHouseNames error:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// createSemaphore + runWave
// ══════════════════════════════════════════════════════════════════
function createSemaphore(max) {
  let active = 0;
  const queue = [];
  return {
    async acquire() {
      if (active < max) { active++; return; }
      await new Promise(resolve => queue.push(resolve));
      active++;
    },
    release() {
      active--;
      if (queue.length > 0) queue.shift()();
    },
  };
}

async function runWave(auctions, concurrency, label, processFn) {
  if (auctions.length === 0) return { analysed: 0, skipped: 0, failed: 0 };
  console.log(`WAVE [${label}]: ${auctions.length} houses at concurrency ${concurrency}`);
  const sem = createSemaphore(concurrency);
  const results = await Promise.allSettled(
    auctions.map(async (auction) => {
      await sem.acquire();
      try {
        return await processFn(auction);
      } finally {
        sem.release();
      }
    })
  );
  let analysed = 0, skipped = 0, failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value === 'analysed') analysed++;
      else if (r.value === 'skipped') skipped++;
      else if (r.value === 'failed') failed++;
    } else {
      failed++;
    }
  }
  console.log(`WAVE [${label}]: done — ${analysed} analysed, ${skipped} cached, ${failed} failed`);
  return { analysed, skipped, failed };
}

// ══════════════════════════════════════════════════════════════════
// autoAnalyseAll + _doAutoAnalyseAll
// ══════════════════════════════════════════════════════════════════
async function autoAnalyseAll() {
  if (getCreditExhausted()) {
    console.log('AUTO: Gemini API rate limited — DOM-only houses will still be processed');
  }
  if (_autoAnalysisRunning) {
    console.log('AUTO: Analysis already running, skipping this invocation');
    return { skipped: true, reason: 'already_running' };
  }
  _autoAnalysisRunning = true;
  try {
    return await _doAutoAnalyseAll();
  } finally {
    _autoAnalysisRunning = false;
  }
}

async function _doAutoAnalyseAll() {
  console.log('\n═══ AUTO-ANALYSIS: checking all catalogue-ready auctions ═══');
  if (!process.env.GEMINI_API_KEY) { console.log('AUTO: No Gemini API key, skipping'); return; }

  // ── Reset broken extractors so fixed ones get retried each cycle ──
  resetBrokenExtractors();

  // ── Step 0: Purge cached_analyses rows for past auctions ──
  // Cross-reference with auction_calendar to find cached rows whose auction
  // date has passed. These are stale data from completed auctions that should
  // not be served or re-scraped.
  // IMPORTANT: Some houses reuse the same URL across multiple auction dates
  // (e.g. BidX1, BTG Eddisons). Only purge URLs that appear ONLY in past
  // entries — never delete cache for a URL that also has an upcoming auction.
  try {
    const today = new Date().toISOString().slice(0, 10);
    const normalise = normaliseUrl;
    const BATCH = 50;

    // Get URLs from past calendar entries (exclude always_on — they don't expire)
    const { data: pastCalendar } = await supabase
      .from('auction_calendar')
      .select('url')
      .lt('date', today)
      .neq('status', 'always_on');

    // Get URLs from upcoming calendar entries + always_on (protect from purge)
    const { data: upcomingCalendar } = await supabase
      .from('auction_calendar')
      .select('url')
      .or(`date.gte.${today},status.eq.always_on`);

    if (pastCalendar && pastCalendar.length > 0) {
      const upcomingUrls = new Set((upcomingCalendar || []).map(r => normalise(r.url)));
      // Only purge URLs that do NOT also appear in upcoming auctions
      const purgeable = [...new Set(pastCalendar.map(r => normalise(r.url)).filter(Boolean))]
        .filter(u => !upcomingUrls.has(u));

      let purged = 0;
      for (let i = 0; i < purgeable.length; i += BATCH) {
        const batch = purgeable.slice(i, i + BATCH);
        const { data: deleted, error } = await supabase
          .from('cached_analyses')
          .delete()
          .in('url', batch)
          .select('url');
        if (!error && deleted) purged += deleted.length;
      }
      if (purged > 0) {
        console.log(`AUTO-PURGE: Removed ${purged} cached_analyses rows for past-only auctions (${pastCalendar.length} past, ${purgeable.length} purgeable after protecting ${upcomingUrls.size} upcoming URLs)`);
      }
    }

    // Also purge orphaned cache entries — URLs not in any calendar entry at all
    const { data: allCalendar } = await supabase.from('auction_calendar').select('url');
    const allCalendarUrls = new Set((allCalendar || []).map(r => normalise(r.url)).filter(Boolean));
    const { data: allCached } = await supabase.from('cached_analyses').select('url');
    if (allCached) {
      const orphaned = allCached
        .map(r => normalise(r.url))
        .filter(u => u && !allCalendarUrls.has(u));
      if (orphaned.length > 0) {
        let orphanPurged = 0;
        for (let i = 0; i < orphaned.length; i += BATCH) {
          const batch = orphaned.slice(i, i + BATCH);
          const { data: deleted, error } = await supabase.from('cached_analyses').delete().in('url', batch).select('url');
          if (!error && deleted) orphanPurged += deleted.length;
        }
        if (orphanPurged > 0) console.log(`AUTO-PURGE: Removed ${orphanPurged} orphaned cache entries (no calendar match)`);
      }
    }

    // Purge expired cache entries older than 7 days — no point keeping ancient stale data
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
    const { data: oldExpired, error: oldErr } = await supabase
      .from('cached_analyses')
      .delete()
      .lt('expires_at', sevenDaysAgo)
      .select('url');
    if (!oldErr && oldExpired && oldExpired.length > 0) {
      console.log(`AUTO-PURGE: Removed ${oldExpired.length} cache entries expired >7 days ago`);
    }
  } catch (e) {
    console.warn('AUTO-PURGE: cleanup failed (non-fatal) —', e.message);
  }

  // ── Step 0.5: Ensure every HOUSE_ROOTS entry has at least one calendar entry ──
  // Many houses (EIG, AH UK, etc.) have root URLs that ARE the catalogue page.
  // Without a calendar entry, they never get analysed. These are "always-on"
  // houses — their catalogue is permanently live, not tied to a specific date.
  // We mark them status='always_on' with a sentinel date so they:
  //   - Never get purged by the date-based cleanup in Step 0
  //   - Show separately in the admin UI from dated auctions
  //   - Still get scraped by autoAnalyseOne like any other catalogue-ready entry
  try {
    // Only count ACTIVE entries (upcoming dates or always_on) — stale past entries
    // don't count, otherwise houses with only expired entries never get always_on added
    const lookback7 = new Date();
    lookback7.setDate(lookback7.getDate() - 7);
    const lookbackStr = lookback7.toISOString().slice(0, 10);
    const { data: existingCalendar } = await supabase
      .from('auction_calendar')
      .select('id, house_slug, url, status')
      .or(`date.gte.${lookbackStr},status.eq.always_on`);
    const calendarSlugs = new Set((existingCalendar || []).map(r => r.house_slug).filter(Boolean));
    const calendarUrls = new Set((existingCalendar || []).map(r => normaliseUrl(r.url)));

    // ── Deduplicate: remove duplicate always_on entries per house_slug ──
    // Keep the first entry per slug, delete the rest
    const alwaysOnBySlug = new Map();
    for (const row of (existingCalendar || [])) {
      if (row.status !== 'always_on' || !row.house_slug) continue;
      if (!alwaysOnBySlug.has(row.house_slug)) {
        alwaysOnBySlug.set(row.house_slug, []);
      }
      alwaysOnBySlug.get(row.house_slug).push(row.id);
    }
    let dedupDeleted = 0;
    for (const [slug, ids] of alwaysOnBySlug) {
      if (ids.length <= 1) continue;
      // Keep the first, delete the rest
      const toDelete = ids.slice(1);
      const { error } = await supabase.from('auction_calendar').delete().in('id', toDelete);
      if (!error) dedupDeleted += toDelete.length;
    }
    if (dedupDeleted > 0) {
      console.log(`AUTO-CALENDAR: Deduplicated ${dedupDeleted} duplicate always_on entries`);
    }

    // ── Deduplicate: remove duplicate entries with same normalised URL ──
    // Regardless of status, keep one entry per URL (prefer always_on, then earliest date)
    const byUrl = new Map();
    for (const row of (existingCalendar || [])) {
      const norm = normaliseUrl(row.url);
      if (!norm) continue;
      if (!byUrl.has(norm)) {
        byUrl.set(norm, []);
      }
      byUrl.get(norm).push(row);
    }
    let urlDedupDeleted = 0;
    for (const [, rows] of byUrl) {
      if (rows.length <= 1) continue;
      // Prefer always_on entries, then keep first
      rows.sort((a, b) => {
        if (a.status === 'always_on' && b.status !== 'always_on') return -1;
        if (b.status === 'always_on' && a.status !== 'always_on') return 1;
        return 0;
      });
      const toDelete = rows.slice(1).map(r => r.id);
      const { error } = await supabase.from('auction_calendar').delete().in('id', toDelete);
      if (!error) urlDedupDeleted += toDelete.length;
    }
    if (urlDedupDeleted > 0) {
      console.log(`AUTO-CALENDAR: Deduplicated ${urlDedupDeleted} duplicate URL entries`);
    }

    let autoInserted = 0;
    for (const [slug, rootUrl] of Object.entries(HOUSE_ROOTS)) {
      const normUrl = normaliseUrl(rootUrl);
      // Skip if this house already has an active (upcoming/always_on) calendar entry
      if (calendarSlugs.has(slug) || calendarUrls.has(normUrl)) continue;
      // Auto-insert as always-on catalogue with sentinel date (won't be purged)
      const { error } = await supabase.from('auction_calendar').insert({
        house: HOUSE_DISPLAY_NAMES[slug] || slug,
        house_slug: slug,
        logo: '🔨',
        date: '2099-12-31',
        title: 'Current Catalogue',
        url: rootUrl,
        location: 'Online',
        type: 'Residential & Commercial',
        status: 'always_on',
        catalogue_ready: true,
        updated_at: new Date().toISOString(),
      });
      if (!error) {
        autoInserted++;
      } else {
        console.warn(`AUTO-CALENDAR: Failed to insert ${slug}: ${error.message || JSON.stringify(error)}`);
      }
    }
    console.log(`AUTO-CALENDAR: Step 0.5 complete — ${autoInserted} new always-on entries inserted, ${calendarSlugs.size} active slugs found, ${Object.keys(HOUSE_ROOTS).length} total houses`);

    // Migrate any existing auto-inserted entries (date=today, title='Current Catalogue')
    // that were created by the old logic — convert them to always_on
    const { data: migratable } = await supabase
      .from('auction_calendar')
      .select('id')
      .eq('title', 'Current Catalogue')
      .neq('status', 'always_on');
    if (migratable && migratable.length > 0) {
      const { error: migErr } = await supabase
        .from('auction_calendar')
        .update({ status: 'always_on', date: '2099-12-31' })
        .eq('title', 'Current Catalogue')
        .neq('status', 'always_on');
      if (!migErr) {
        console.log(`AUTO-CALENDAR: Migrated ${migratable.length} legacy entries to always_on`);
      }
    }
  } catch (e) {
    console.warn('AUTO-CALENDAR: root URL insertion failed (non-fatal) —', e.message);
  }

  // ── Step 1: Analyse all catalogue-ready auctions FIRST ──
  // Discovery is deferred to AFTER scraping so users see fresh lots quickly.
  const allReady = await _deps.getCalendarAuctions();
  // Limit to nearest MAX_AUCTIONS_PER_HOUSE upcoming dates per house
  const byHouse = {};
  for (const a of allReady) {
    const h = a.house || 'unknown';
    if (!byHouse[h]) byHouse[h] = [];
    byHouse[h].push(a);
  }
  const ready = [];
  for (const [h, auctions] of Object.entries(byHouse)) {
    auctions.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    ready.push(...auctions.slice(0, MAX_AUCTIONS_PER_HOUSE));
    for (const skippedA of auctions.slice(MAX_AUCTIONS_PER_HOUSE)) {
      console.log(`Skipping ${h} ${skippedA.date || skippedA.url} — beyond ${MAX_AUCTIONS_PER_HOUSE}-auction lookahead limit`);
    }
  }
  console.log(`AUTO: ${ready.length} catalogue-ready auctions to check (${allReady.length} total, limited to ${MAX_AUCTIONS_PER_HOUSE} per house)`);

  // ── Manager pre-scrape cycle → get directives ──
  let directives;
  try {
    const preReport = await _deps.runManagerCycle();
    if (preReport && !preReport.skipped) {
      console.log(`MANAGER PRE-SCRAPE: Cycle ${preReport.cycle} — ${preReport.actions_taken.length} actions`);
    }
    directives = _deps.getManagerDirectives();
  } catch (mgrErr) {
    console.warn('MANAGER PRE-SCRAPE: failed (non-fatal):', mgrErr.message);
    directives = _deps.getManagerDirectives(); // returns defaults
  }

  // ── Experiment: start cycle (resets event buffers) ──
  startExperimentCycle();
  resetCycleSignals();

  // ── Partition into DOM houses vs Gemini houses ──
  const skipSet = new Set(directives.skip_houses || []);
  const priorityOrder = (directives.priority_houses || []).reduce((m, slug, i) => { m[slug] = i; return m; }, {});

  const domHouses = [];
  const geminiHouses = [];
  const skippedByManager = [];

  for (const auction of ready) {
    const slug = detectAuctionHouse(auction.url);
    if (skipSet.has(slug)) {
      skippedByManager.push(auction);
      console.log(`AUTO: Skipping ${auction.house} — manager directive (${(directives.skip_reasons || {})[slug] || 'skipped'})`);
      continue;
    }
    auction._slug = slug;
    auction._priority = priorityOrder[slug] !== undefined ? priorityOrder[slug] : 999;
    if (slug && _deps.DOM_EXTRACTORS[slug]) {
      domHouses.push(auction);
    } else {
      geminiHouses.push(auction);
    }
  }

  // ── Boost never-scraped houses to the front of the queue ──
  // Houses that have never been scraped (no cached_analyses entry) should be
  // processed first so they don't languish behind already-cached re-checks.
  const { data: cachedHouses } = await supabase
    .from('cached_analyses')
    .select('house');
  const cachedHouseSet = new Set((cachedHouses || []).map(r => r.house));
  for (const auction of [...domHouses, ...geminiHouses]) {
    const slug = auction._slug || detectAuctionHouse(auction.url);
    if (!cachedHouseSet.has(slug)) {
      // Never-scraped houses get top priority (below explicit manager priorities)
      auction._priority = Math.min(auction._priority, 1);
    }
  }

  // Sort by manager priority (lower = higher priority)
  domHouses.sort((a, b) => a._priority - b._priority);
  geminiHouses.sort((a, b) => a._priority - b._priority);

  const neverScrapedCount = [...domHouses, ...geminiHouses].filter(a => a._priority <= 1).length;
  console.log(`AUTO: Partitioned — ${domHouses.length} DOM houses, ${geminiHouses.length} Gemini houses, ${skippedByManager.length} skipped by manager, ${neverScrapedCount} never-scraped boosted`);

  // ── Per-auction processing function (same logic as before, no 5s pause) ──
  async function processAuction(auction) {
    try {
      const normalisedUrl = normaliseUrl(auction.url);

      // Check if we already have a fresh cache
      const { data: cached } = await supabase
        .from('cached_analyses')
        .select('url, total_lots, created_at')
        .eq('url', normalisedUrl)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (cached && cached.total_lots > 0) {
        // Read lots from lots table (single source of truth)
        const { data: lotRows } = await supabase
          .from('lots')
          .select(LOTS_SELECT)
          .eq('catalogue_url', normalisedUrl);
        const cachedLots = (lotRows || []).map(dbRowToFrontendLot);

        // ── Delegate to cache-enrich-stage module ──
        await cacheEnrichStage(
          { auction, normalisedUrl, cachedLots, cachedTotalLots: cached.total_lots },
          {
            rewriteUrl: _deps.rewriteUrl,
            scrapeAllsopApi: _deps.scrapeAllsopApi,
            enrichAllsopLots: _deps.enrichAllsopLots,
            backfillImages: _deps.backfillImages,
            backfillImagesFromLotPages: _deps.backfillImagesFromLotPages,
            backfillImagesWithFirecrawl: _deps.backfillImagesWithFirecrawl,
            backfillImagesWithPuppeteer: _deps.backfillImagesWithPuppeteer,
            normaliseLotStatuses: _deps.normaliseLotStatuses,
            upsertToLotsTable,
            FIRECRAWL_API_KEY: _deps.FIRECRAWL_API_KEY,
            isFcCreditExhausted: _deps.isFcCreditExhausted,
            puppeteer: _deps.puppeteer,
          },
        );
        return 'skipped';
      }

      console.log(`AUTO: Analysing ${auction.house} — ${auction.url}`);
      const HOUSE_TIMEOUT_MS = 90000;
      const slug = auction._slug || detectAuctionHouse(auction.url);

      // Experiment: route treatment houses through modular pipeline
      if (isTreatmentHouse(slug)) {
        console.log(`AUTO: [EXPERIMENT:treatment] ${auction.house} via modular pipeline`);
        const rewritten = await _deps.rewriteUrl(auction.url, slug);
        await Promise.race([
          (async () => {
            const lots = await runModularPipeline(auction.url, slug, rewritten);
            if (lots && lots.length > 0) {
              _deps.normaliseLotStatuses(lots);
              await upsertToLotsTable(lots, auction.house, auction.url, {
                scrapedWith: 'modular-pipeline',
              });
            }
          })(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('House scrape timeout (90s)')), HOUSE_TIMEOUT_MS))
        ]);
      } else {
        // Control group: legacy path
        const startMs = Date.now();
        await Promise.race([
          autoAnalyseOne(auction.url),
          new Promise((_, reject) => setTimeout(() => reject(new Error('House scrape timeout (90s)')), HOUSE_TIMEOUT_MS))
        ]);
        // Log control metrics for experiment comparison
        const normUrl = normaliseUrl(auction.url);
        const { data: lotsData } = await supabase
          .from('lots')
          .select('image_url, beds, tenure, address, guide_price')
          .eq('catalogue_url', normUrl);
        if (lotsData) {
          const total = lotsData.length;
          const withImg = lotsData.filter(l => l.image_url).length;
          await logControlMetrics(slug, {
            lotCount: total,
            imageCoverage: total > 0 ? Math.round((withImg / total) * 100) : 0,
            durationMs: Date.now() - startMs,
          });
        }
      }
      return 'analysed';

    } catch (e) {
      console.error(`AUTO: ✗ ${auction.house} failed: ${e.message}`);
      return 'failed';
    }
  }

  // ── Wave 1: DOM houses at high concurrency ──
  const wave1 = await runWave(domHouses, directives.dom_concurrency || 10, 'DOM', processAuction);

  // ── Wave 2: Gemini houses at low concurrency ──
  const wave2 = await runWave(geminiHouses, directives.gemini_concurrency || 3, 'Gemini', processAuction);

  const analysed = wave1.analysed + wave2.analysed;
  const skipped = wave1.skipped + wave2.skipped + skippedByManager.length;
  const failed = wave1.failed + wave2.failed;

  console.log(`═══ AUTO-ANALYSIS COMPLETE: ${analysed} analysed, ${skipped} cached/skipped, ${failed} failed ═══\n`);

  // ── Step 3: Proactive healing sweep for houses with unresolved 0-lot regressions ──
  if (_deps.FIRECRAWL_API_KEY && !_deps.isFcCreditExhausted()) {
    try {
      const { data: unresolvedAlerts } = await supabase
        .from('pipeline_alerts')
        .select('house, message')
        .eq('event_type', 'extractor_regression')
        .eq('resolved', false)
        .order('created_at', { ascending: false });

      if (unresolvedAlerts && unresolvedAlerts.length > 0) {
        // Deduplicate by house
        const housesToHeal = [...new Set(unresolvedAlerts.map(a => a.house).filter(Boolean))];
        console.log(`HEAL-SWEEP: ${housesToHeal.length} houses with unresolved regressions: ${housesToHeal.join(', ')}`);

        let healed = 0;
        for (const slug of housesToHeal) {
          const rootUrl = HOUSE_ROOTS[slug];
          if (!rootUrl) continue;

          const healedUrl = await healBrokenHouse(slug, rootUrl);
          if (healedUrl) {
            healed++;
            // Try re-analysing with the healed URL
            try {
              await autoAnalyseOne(healedUrl);
            } catch { /* already logged inside */ }
          }
        }
        if (healed > 0) {
          console.log(`HEAL-SWEEP: ✓ Healed ${healed}/${housesToHeal.length} houses`);
        }
      }
    } catch (healErr) {
      console.warn('HEAL-SWEEP: failed (non-fatal) —', healErr.message);
    }
  }

  // ── Step 4: Discover new catalogues AFTER scraping ──
  // Discovery is expensive (Firecrawl + Gemini per house) so runs after lots are live.
  if (getCreditExhausted()) {
    console.log('AUTO-DISCOVER: Skipping — Gemini API rate limited (discovery requires AI)');
  } else {
    await discoverAndUpdateCalendar().catch(e =>
      console.error('AUTO-DISCOVER: failed —', e.message)
    );
  }

  // ── Harness: Manager post-scrape cycle (corrective actions) ──
  try {
    const postReport = await _deps.runManagerCycle();
    if (postReport && !postReport.skipped) {
      console.log(`MANAGER POST-SCRAPE: Cycle ${postReport.cycle}: ${postReport.actions_taken.length} actions, effectiveness ${postReport.effectiveness_score}`);
    }
  } catch (mgrErr) {
    console.warn('MANAGER POST-SCRAPE: failed (non-fatal):', mgrErr.message);
  }

  // ── Experiment: end cycle (flush event buffers, log summary) ──
  await endExperimentCycle();

  // ── Save daily analytics snapshot ──
  try { await saveDailySnapshot(); } catch (e) { console.warn('Daily snapshot failed:', e.message); }

  return { analysed, skipped, failed, total: ready.length };
}

// ══════════════════════════════════════════════════════════════════
// healBrokenHouse — thin wrapper delegating to lib/pipeline/healing.js
// ══════════════════════════════════════════════════════════════════
async function healBrokenHouse(slug, oldUrl) {
  return _healBrokenHouseImpl(slug, oldUrl, {
    FIRECRAWL_API_KEY: _deps.FIRECRAWL_API_KEY,
    scrapeWithFirecrawl: _deps.scrapeWithFirecrawl,
    callAI: _deps.callAI,
    extractWithJSDOM: _deps.extractWithJSDOM,
    HEADERS,
  });
}

// ══════════════════════════════════════════════════════════════════
// discoverAndUpdateCalendar — thin wrapper delegating to lib/pipeline/discovery.js
// ══════════════════════════════════════════════════════════════════
async function discoverAndUpdateCalendar() {
  return _discoverAndUpdateCalendarImpl({
    FIRECRAWL_API_KEY: _deps.FIRECRAWL_API_KEY,
    isFcCreditExhausted: _deps.isFcCreditExhausted,
    scrapeWithFirecrawl: _deps.scrapeWithFirecrawl,
    callAI: _deps.callAI,
    HEADERS,
  });
}

// ══════════════════════════════════════════════════════════════════
// JUNK_LOT_PATTERN + buildSearchText + upsertToLotsTable
// ══════════════════════════════════════════════════════════════════
const JUNK_LOT_PATTERN = /^(I'd like to|Property search|Popular|Auction Dates|Register to bid|Information|\dBid Basket|Cookie|Privacy)/i;

// Build a complete natural-language snapshot of a lot for search.
// Everything goes in — the intelligence is in the QUERY strategy, not the storage.
// Structured queries (price, tenure, beds) hit formal columns via SQL.
// This blob is searched only for things that don't map to columns.
function buildSearchText(lot) {
  const parts = [];

  if (lot.address) parts.push(lot.address);
  if (lot.postcode) parts.push(lot.postcode);

  const typeDesc = [lot.beds ? `${lot.beds} bed` : '', lot.propType || '', lot.tenure || ''].filter(Boolean).join(' ');
  if (typeDesc) parts.push(typeDesc);
  if (lot.sqft) parts.push(`${lot.sqft} sqft`);
  if (lot.leaseLength) parts.push(`${lot.leaseLength} year lease`);
  if (lot.units && lot.units > 1) parts.push(`${lot.units} units`);
  if (lot.condition) parts.push(lot.condition);
  if (lot.vacant) parts.push('Vacant possession');
  if (lot.dealType) parts.push(lot.dealType);
  if (lot.price) parts.push(`Guide £${lot.price.toLocaleString()}`);
  if (lot.streetAvg) parts.push(`Street avg £${lot.streetAvg.toLocaleString()}`);
  if (lot.belowMarket) parts.push(`${lot.belowMarket}% below market value`);
  if (lot.estGrossYield) parts.push(`Yield ${lot.estGrossYield}%`);
  if (lot.titleSplit) parts.push('Title split potential');
  if (lot.epcRating) parts.push(`EPC ${lot.epcRating}`);
  if (lot.floodRiskLevel) parts.push(`Flood risk ${lot.floodRiskLevel}`);
  if (lot.opps && lot.opps.length) parts.push(lot.opps.join('. '));
  if (lot.risks && lot.risks.length) parts.push(lot.risks.join('. '));
  if (lot.bullets && lot.bullets.length) parts.push(lot.bullets.join('. '));
  if (lot.scoreBreakdown && lot.scoreBreakdown.length) {
    const labels = lot.scoreBreakdown.map(s => typeof s === 'string' ? s : (s.label || s.reason || '')).filter(Boolean);
    if (labels.length) parts.push(labels.join('. '));
  }

  return parts.join('. ').substring(0, 4000) || null;
}

async function upsertToLotsTable(enrichedLots, house, catalogueUrl, metadata = {}) {
  if (!supabase || !enrichedLots || enrichedLots.length === 0) return;
  try {
    const now = new Date().toISOString();

    // Look up auction date from calendar for this catalogue URL
    let catalogueAuctionDate = null;
    try {
      const normCatUrl = normaliseUrl(catalogueUrl);
      const { data: calRows } = await supabase
        .from('auction_calendar')
        .select('url, date')
        .order('date', { ascending: true });
      if (calRows) {
        for (const r of calRows) {
          if (normaliseUrl(r.url) === normCatUrl) { catalogueAuctionDate = r.date; break; }
        }
      }
    } catch { /* non-fatal */ }

    // Build lot rows
    const rows = [];
    for (const lot of enrichedLots) {
      const addr = (lot.address || '').trim();
      if (!addr || addr.length < 5) continue;
      if (JUNK_LOT_PATTERN.test(addr)) continue;

      let lotUrl = lot.url || null;
      if (!lotUrl) {
        lotUrl = `__synthetic__${house}__${addr.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 80)}__${lot.price || 0}`;
      }

      // Per-lot auction date from EIG bullets takes priority over catalogue date
      let lotAuctionDate = catalogueAuctionDate;
      if (lot.bullets && Array.isArray(lot.bullets)) {
        for (const b of lot.bullets) {
          const m = b.match(/Auction\s*Ends?:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
          if (m) { lotAuctionDate = m[3] + '-' + m[2] + '-' + m[1]; break; }
        }
      }

      rows.push({
        house,
        lot_number: lot.lot || null,
        url: lotUrl,
        catalogue_url: normaliseUrl(catalogueUrl),
        address: addr,
        postcode: lot.postcode || null,
        price: (typeof lot.price === 'number' && lot.price > 0) ? lot.price : null,
        price_text: lot.priceText || null,
        prop_type: lot.propType || null,
        beds: (typeof lot.beds === 'number') ? lot.beds : null,
        tenure: lot.tenure || null,
        lease_length: (typeof lot.leaseLength === 'number') ? lot.leaseLength : null,
        sqft: (typeof lot.sqft === 'number') ? lot.sqft : null,
        condition: lot.condition || null,
        image_url: lot.imageUrl || null,
        bullets: lot.bullets || [],
        units: lot.units || 0,
        auction_date: lotAuctionDate,
        status: lot.status || 'available',
        sold_price: (typeof lot.soldPrice === 'number') ? lot.soldPrice : null,
        epc_rating: lot.epcRating || null,
        epc_score: (typeof lot.epcScore === 'number') ? lot.epcScore : null,
        epc_date: lot.epcDate || null,
        flood_zone: (typeof lot.floodZone === 'number') ? lot.floodZone : null,
        flood_risk: lot.floodRiskLevel || null,
        street_avg: (typeof lot.streetAvg === 'number') ? lot.streetAvg : null,
        street_sales: lot.streetSales || null,
        street_sales_count: (typeof lot.streetSalesCount === 'number') ? lot.streetSalesCount : null,
        below_market: (typeof lot.belowMarket === 'number') ? lot.belowMarket : null,
        est_monthly_rent: (typeof lot.estMonthlyRent === 'number') ? lot.estMonthlyRent : null,
        est_annual_rent: (typeof lot.estAnnualRent === 'number') ? lot.estAnnualRent : null,
        est_gross_yield: (typeof lot.estGrossYield === 'number') ? lot.estGrossYield : null,
        score: (typeof lot.score === 'number') ? lot.score : null,
        score_breakdown: lot.scoreBreakdown || [],
        opps: lot.opps || [],
        risks: lot.risks || [],
        deal_type: lot.dealType || null,
        vacant: lot.vacant || null,
        title_split: lot.titleSplit || null,
        raw_text: lot.rawText || null,
        extracted_with: metadata.extractedWith || null,
        scraped_with: metadata.scrapedWith || null,
        last_seen_at: now,
        enriched_at: lot.enrichedAt || null,
        search_text: buildSearchText(lot),
        // Note: first_seen_at deliberately omitted — uses column default (now()) on INSERT,
        // and is not overwritten on conflict UPDATE
      });
    }

    if (rows.length === 0) return;

    // Fetch existing lots with ALL fields so we can merge without data loss
    const { data: existingLots } = await supabase
      .from('lots')
      .select('*')
      .eq('house', house)
      .eq('catalogue_url', normaliseUrl(catalogueUrl));

    const existingMap = new Map((existingLots || []).map(l => [l.url, l]));

    // Detect status changes for history tracking
    const statusChanges = [];

    // ── Merge: never overwrite existing non-null with null ──
    // Fields that should ALWAYS be overwritten (even with null) when the scraper provides them:
    const ALWAYS_OVERWRITE = new Set(['last_seen_at', 'scraped_with', 'extracted_with', 'search_text']);
    // Fields that represent identity/structure (always take new value):
    const IDENTITY_FIELDS = new Set(['house', 'url', 'catalogue_url']);

    let preserved = 0;
    for (const row of rows) {
      const existing = existingMap.get(row.url);
      if (!existing) continue; // new lot, no merge needed

      // Track status changes before merge
      if (existing.status && existing.status !== row.status) {
        statusChanges.push({
          lot_id: existing.id,
          old_status: existing.status,
          new_status: row.status,
          source: 'scrape',
        });
      }

      // Merge: for each field, keep existing value if new value is null/empty
      for (const [key, newVal] of Object.entries(row)) {
        if (IDENTITY_FIELDS.has(key) || ALWAYS_OVERWRITE.has(key)) continue;
        if (key === 'id' || key === 'first_seen_at' || key === 'search_vector') continue;

        const oldVal = existing[key];
        const newIsEmpty = newVal === null || newVal === undefined;
        const oldHasValue = oldVal !== null && oldVal !== undefined;

        // Never replace non-null with null
        if (newIsEmpty && oldHasValue) {
          row[key] = oldVal;
          preserved++;
        }

        // For JSONB arrays (bullets, opps, risks, score_breakdown, street_sales):
        // keep existing if new is an empty array and old has content
        if (Array.isArray(newVal) && newVal.length === 0 && Array.isArray(oldVal) && oldVal.length > 0) {
          row[key] = oldVal;
          preserved++;
        }
      }

      // Carry forward enriched_at if we preserved enrichment data
      if (!row.enriched_at && existing.enriched_at) {
        row.enriched_at = existing.enriched_at;
      }
    }

    if (preserved > 0) {
      console.log(`LOTS: ${house}: preserved ${preserved} existing field values from DB (would have been wiped)`);
    }

    // Upsert in batches of 50
    const BATCH_SIZE = 50;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('lots')
        .upsert(batch, { onConflict: 'house,url' });
      if (error) {
        console.warn(`LOTS: Batch upsert error for ${house}: ${error.message}`);
      } else {
        upserted += batch.length;
      }
    }

    // Record status changes in history table
    if (statusChanges.length > 0) {
      const { error: histErr } = await supabase
        .from('lot_status_history')
        .insert(statusChanges);
      if (histErr) console.warn(`LOTS: Status history insert error: ${histErr.message}`);
      else console.log(`LOTS: ${statusChanges.length} status changes recorded for ${house}`);
    }

    console.log(`LOTS: ✓ ${house}: ${upserted}/${rows.length} lots upserted`);
  } catch (err) {
    console.warn(`LOTS: Failed to upsert lots for ${house}: ${err.message}`);
  }
}

// ══════════════════════════════════════════════════════════════════
// autoAnalyseOne
// ══════════════════════════════════════════════════════════════════
async function autoAnalyseOne(url) {
  const urlCheck = await validateUrl(url);
  if (!urlCheck.ok) { log.warn('autoAnalyseOne skipped — invalid URL', { url, reason: urlCheck.error }); return []; }
  const house = detectAuctionHouse(url);

  try {
  // ── Harness: circuit breaker check ──
  if (isCircuitOpen(house)) {
    console.log(`AUTO: Skipping ${house} — circuit breaker open`);
    return;
  }

  // Skip Knight Frank forthcoming-auctions index page — it's a discovery page, not a catalogue.
  // Actual catalogue URLs like /auction/3833/... are discovered and analysed separately.
  if (house === 'knightfrank' && url.toLowerCase().includes('forthcoming-auctions')) {
    console.log(`AUTO: Skipping ${house} forthcoming-auctions index page (not a catalogue)`);
    return;
  }

  const rewritten = await _deps.rewriteUrl(url, house);
  if (rewritten.blocked) {
    console.log(`AUTO: Skipping ${house} — marked as blocked (anti-bot protection)`);
    return [];
  }
  const scrapeUrl = rewritten.baseUrl;
  const normalisedUrl = normaliseUrl(url);

  // ── Stage 1: Probe — HTML change detection ──
  const probeResult = await probe(
    { url, house, scrapeUrl, normalisedUrl },
    { budget: _deps.budget, scrapeWithFirecrawl: _deps.scrapeWithFirecrawl, fetchPage: _deps.fetchPage },
  );
  if (probeResult.skip) {
    hashHitCount++;
    return;
  }
  autoAnalyseOne._lastContentHash = probeResult.contentHash;

  // ── Stage 2: Scrape — fetch raw lots from catalogue ──
  const scrapeDeps = {
    scrapeAllsopApi: _deps.scrapeAllsopApi,
    extractAllsopLotsFromJson: _deps.extractAllsopLotsFromJson,
    scrapeRenderedPage: _deps.scrapeRenderedPage,
    extractWithJSDOM: _deps.extractWithJSDOM,
    detectTotalPages: _deps.detectTotalPages,
    buildPageUrl: _deps.buildPageUrl,
    fetchPage: _deps.fetchPage,
    scrapeAllPages: _deps.scrapeAllPages,
    extractLotsWithAI: _deps.extractLotsWithAI,
    isFcCreditExhausted: _deps.isFcCreditExhausted,
    isCreditExhausted: () => _deps.budget ? _deps.budget.getCreditExhausted() : false,
    puppeteer: _deps.puppeteer,
    healBrokenHouse,
  };
  const { rawLots } = await scrapeStage(
    { house, url, scrapeUrl, rewritten },
    scrapeDeps,
  );

  if (rawLots.length === 0) {
    // Self-healing: try to find a new catalogue URL (recursive re-analyse)
    try {
      const { data: prevSkill } = await supabase.from('house_skills').select('last_lot_count').eq('slug', house).maybeSingle();
      if (prevSkill && prevSkill.last_lot_count > 0) {
        const healedUrl = await healBrokenHouse(house, url);
        if (healedUrl) {
          console.log(`HEAL: ✓ ${house} healed — re-analysing with new URL: ${healedUrl}`);
          try {
            await autoAnalyseOne(healedUrl);
            // Resolve the old regression alert if re-analysis succeeded
            try {
              await supabase.from('pipeline_alerts')
                .update({ resolved: true, resolved_at: new Date().toISOString() })
                .eq('house', house)
                .eq('event_type', 'extractor_regression')
                .eq('resolved', false);
            } catch { /* non-fatal */ }
          } catch (reErr) {
            console.log(`HEAL: Re-analysis with healed URL failed for ${house}: ${reErr.message}`);
          }
        }
      }
    } catch (healErr) { console.warn('HEAL: Self-healing failed:', healErr.message); }
    return;
  }

  // ── Stage 3: Enrich — score, EPC/flood/tenure, image backfill, fundability ──
  const enrichDeps = {
    analyseLot,
    enrichLots: _deps.enrichLots,
    enrichLotsFromLotPages: _deps.enrichLotsFromLotPages,
    backfillImagesWithFirecrawl: _deps.backfillImagesWithFirecrawl,
    backfillImagesWithPuppeteer: _deps.backfillImagesWithPuppeteer,
    FIRECRAWL_API_KEY: _deps.FIRECRAWL_API_KEY,
    isFcCreditExhausted: _deps.isFcCreditExhausted,
    puppeteer: _deps.puppeteer,
  };
  const { lots: enrichedLots } = await enrichStage(
    { rawLots, house, url },
    enrichDeps,
  );

  // ── Stage 4: Persist — quality gate, harness, cache upsert, lots upsert, skill tracking ──
  const persistDeps = {
    qualityGate,
    dbRowToFrontendLot,
    upsertToLotsTable,
    updateHouseSkill,
    computeScrapeDiff,
    normaliseLotStatuses: _deps.normaliseLotStatuses,
    getLastScrapeEngine: _deps.getLastScrapeEngine,
    getLastExtractorUsed: _deps.getLastExtractorUsed,
    getLastAITier: _deps.getLastAITier,
    harnessUpdateHealth: _deps.harnessUpdateHealth,
    harnessFireAlert: _deps.harnessFireAlert,
    harnessResolveAlert: _deps.harnessResolveAlert,
  };
  await persistStage(
    { lots: enrichedLots, house, url, normalisedUrl, rewritten, contentHash: probeResult.contentHash },
    persistDeps,
  );

  } catch (autoErr) {
    // ── Pipeline alert: auto-analyse failure ──
    console.error(`AUTO: autoAnalyseOne failed for ${house}:`, autoErr.message);
    try {
      await supabase.from('pipeline_alerts').insert({
        event_type: 'auto_analyse_failure',
        severity: 'error',
        house,
        message: `Auto-analyse failed for ${HOUSE_DISPLAY_NAMES[house] || house}: ${autoErr.message}`
      });
    } catch (alertErr) { console.warn('ALERT: Failed to record auto-analyse failure:', alertErr.message); }
  }
}

// ══════════════════════════════════════════════════════════════════
// computeScrapeDiff
// ══════════════════════════════════════════════════════════════════
function computeScrapeDiff(oldLots, newLots) {
  const oldMap = new Map((oldLots || []).map(l => [l.lotNumber || l.address || l.lot, l]));
  const newMap = new Map((newLots || []).map(l => [l.lotNumber || l.address || l.lot, l]));
  const added = [...newMap.keys()].filter(k => k && !oldMap.has(k));
  const removed = [...oldMap.keys()].filter(k => k && !newMap.has(k));
  const changed = [...newMap.keys()].filter(k => {
    if (!k || !oldMap.has(k)) return false;
    const o = oldMap.get(k), n = newMap.get(k);
    return o.price !== n.price || o.status !== n.status;
  });
  const imagesGained = (newLots || []).filter(l => l.imageUrl && !(oldMap.get(l.lotNumber || l.address || l.lot)?.imageUrl)).length;
  const imagesLost = (oldLots || []).filter(l => l.imageUrl && !(newMap.get(l.lotNumber || l.address || l.lot)?.imageUrl)).length;

  const summary = [];
  if (added.length) summary.push(`+${added.length} new lots`);
  if (removed.length) summary.push(`${removed.length} removed`);
  if (changed.length) summary.push(`${changed.length} changed`);
  if (imagesGained) summary.push(`${imagesGained} images added`);
  if (imagesLost) summary.push(`${imagesLost} images lost`);

  return {
    lots_added: added.length,
    lots_removed: removed.length,
    lots_changed: changed.length,
    images_gained: imagesGained,
    images_lost: imagesLost,
    status_changes: summary,
    timestamp: new Date().toISOString()
  };
}

// ══════════════════════════════════════════════════════════════════
// updateHouseSkill — thin wrapper delegating to lib/pipeline/house-skills.js
// ══════════════════════════════════════════════════════════════════
async function updateHouseSkill(slug, params) {
  return _updateHouseSkillImpl(slug, params, { DOM_EXTRACTORS: _deps.DOM_EXTRACTORS });
}

// saveDailySnapshot — now imported directly from lib/pipeline/analytics.js

// ══════════════════════════════════════════════════════════════════
// dbRowToLot + dbRowToFrontendLot + LOTS_SELECT + upsertLotGroups
// ══════════════════════════════════════════════════════════════════
function dbRowToLot(dbRow) {
  return {
    lot: dbRow.lot_number, address: dbRow.address, postcode: dbRow.postcode || _deps.extractPostcode(dbRow.address),
    price: dbRow.price, priceText: dbRow.price_text, propType: dbRow.prop_type, beds: dbRow.beds,
    tenure: dbRow.tenure, leaseLength: dbRow.lease_length, sqft: dbRow.sqft, condition: dbRow.condition,
    imageUrl: dbRow.image_url, bullets: dbRow.bullets || [], units: dbRow.units || 0,
    status: dbRow.status || 'available', soldPrice: dbRow.sold_price,
    epcRating: dbRow.epc_rating, epcScore: dbRow.epc_score, epcDate: dbRow.epc_date,
    floodZone: dbRow.flood_zone, floodRiskLevel: dbRow.flood_risk,
    streetAvg: dbRow.street_avg, streetSales: dbRow.street_sales, streetSalesCount: dbRow.street_sales_count,
    belowMarket: dbRow.below_market, estMonthlyRent: dbRow.est_monthly_rent,
    estAnnualRent: dbRow.est_annual_rent, estGrossYield: dbRow.est_gross_yield,
    score: dbRow.score != null ? dbRow.score : 0, scoreBreakdown: dbRow.score_breakdown || [],
    opps: dbRow.opps || [], risks: dbRow.risks || [], dealType: dbRow.deal_type,
    vacant: dbRow.vacant, titleSplit: dbRow.title_split, url: dbRow.url, enrichedAt: dbRow.enriched_at,
    rawText: dbRow.raw_text || null,
    _dbId: dbRow.id, _house: dbRow.house, _catalogueUrl: dbRow.catalogue_url,
  };
}

// ── Helper: convert DB row to frontend-ready camelCase lot (for API responses) ──
function dbRowToFrontendLot(r) {
  return {
    _house: r.house, lot: r.lot_number, url: r.url, _sourceUrl: r.catalogue_url,
    address: r.address, postcode: r.postcode, price: r.price, priceText: r.price_text,
    propType: r.prop_type, beds: r.beds, tenure: r.tenure, leaseLength: r.lease_length,
    sqft: r.sqft, condition: r.condition, imageUrl: r.image_url, bullets: r.bullets || [],
    units: r.units || 0, _auctionDate: r.auction_date, status: r.status, soldPrice: r.sold_price,
    epcRating: r.epc_rating, epcScore: r.epc_score, epcDate: r.epc_date,
    floodZone: r.flood_zone, floodRiskLevel: r.flood_risk, streetAvg: r.street_avg,
    streetSales: r.street_sales, streetSalesCount: r.street_sales_count,
    belowMarket: r.below_market, estMonthlyRent: r.est_monthly_rent,
    estAnnualRent: r.est_annual_rent,
    estGrossYield: r.est_gross_yield != null ? parseFloat(r.est_gross_yield) : null,
    score: r.score != null ? parseFloat(r.score) : null, scoreBreakdown: r.score_breakdown || [],
    opps: r.opps || [], risks: r.risks || [], dealType: r.deal_type,
    vacant: r.vacant, titleSplit: r.title_split,
    _searchText: r.search_text || '',
  };
}

// ── Helper: standard lots select columns for DB queries ──
const LOTS_SELECT = 'house, lot_number, url, catalogue_url, address, postcode, price, price_text, prop_type, beds, tenure, lease_length, sqft, condition, image_url, bullets, units, auction_date, status, sold_price, epc_rating, epc_score, epc_date, flood_zone, flood_risk, street_avg, street_sales, street_sales_count, below_market, est_monthly_rent, est_annual_rent, est_gross_yield, score, score_breakdown, opps, risks, deal_type, vacant, title_split, search_text';

// ── Helper: group lots by house+catalogue and upsert ──
async function upsertLotGroups(lotObjs, source) {
  const groups = {};
  for (const lot of lotObjs) {
    const key = `${lot._house}|${lot._catalogueUrl}`;
    if (!groups[key]) groups[key] = { house: lot._house, catalogueUrl: lot._catalogueUrl, lots: [] };
    groups[key].lots.push(lot);
  }
  let total = 0;
  for (const [, g] of Object.entries(groups)) {
    _deps.normaliseLotStatuses(g.lots);
    await upsertToLotsTable(g.lots, g.house, g.catalogueUrl, { scrapedWith: source });
    total += g.lots.length;
  }
  return total;
}

// ══════════════════════════════════════════════════════════════════
// extractPriceFromText
// ══════════════════════════════════════════════════════════════════
// ── Price extraction from HTML (shared by price hunter + lot-page enrichment) ──
function extractPriceFromText(text) {
  const patterns = [
    /(?:guide\s*price|starting\s*bid|minimum\s*opening\s*bid|reserve\s*price|current\s*bid)[^£]{0,30}£([\d,]+)/i,
    /£([\d,]+)\s*(?:guide|starting|plus|reserve|\+)/i,
    /(?:price|sold\s*(?:for|at|price))[^£]{0,20}£([\d,]+)/i,
    /£([\d,]+)\s*[-–]\s*£([\d,]+)/i, // range — take lower
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const p = parseInt(m[1].replace(/,/g, ''), 10);
      if (p >= 500 && p <= 50000000) return { price: p, priceText: null };
    }
  }
  // Fallback: any standalone £ amount
  const allPrices = [...text.matchAll(/£([\d,]+)/g)]
    .map(m => parseInt(m[1].replace(/,/g, ''), 10))
    .filter(p => p >= 1000 && p <= 50000000);
  if (allPrices.length === 1) return { price: allPrices[0], priceText: null };
  if (allPrices.length > 1) {
    const nonFee = allPrices.filter(p => p >= 5000);
    if (nonFee.length > 0) return { price: nonFee[0], priceText: null };
  }
  // Detect explicit no-price
  if (/\b(?:price on application|p\.?o\.?a\.?|to be advised|t\.?b\.?a\.?|refer to auctioneer|contact.*for.*price|price available on request|offers? invited|no guide|by negotiation)\b/i.test(text)) {
    return { price: null, priceText: 'POA' };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// runEnrichmentWave
// ══════════════════════════════════════════════════════════════════
async function runEnrichmentWave() {
  if (_enrichmentWaveRunning) { console.log('HYGIENE: Already running, skipping'); return; }
  _enrichmentWaveRunning = true;
  const stats = { lotPageFetched: 0, pricesFound: 0, pricesPoa: 0, postcodeFixed: 0, enriched: 0, lotPageEnriched: 0 };
  try {
    console.log(`HYGIENE: Starting at ${new Date().toISOString()}...`);

    // ═══ PASS 1: Price Hunter — fetch lot pages for every lot missing price ═══
    // Price is the #1 non-negotiable. 500 per cycle — Firecrawl budget has headroom.
    const { data: pricelessLots } = await supabase
      .from('lots')
      .select('*')
      .or('price.is.null,price.eq.0')
      .not('url', 'like', '__synthetic__%')
      .is('price_text', null) // skip lots already confirmed POA
      .order('last_seen_at', { ascending: false })
      .limit(500);

    if (pricelessLots && pricelessLots.length > 0) {
      console.log(`HYGIENE [price]: ${pricelessLots.length} lots missing prices...`);
      for (let i = 0; i < pricelessLots.length; i += 5) {
        if (i > 0) await new Promise(r => setTimeout(r, 300));
        const batch = pricelessLots.slice(i, i + 5);
        await Promise.allSettled(batch.map(async (dbRow) => {
          try {
            const result = await _deps.fetchLotPage(dbRow.url);
            if (!result) return;
            stats.lotPageFetched++;
            const text = result.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
            const extracted = extractPriceFromText(text);
            const update = {};
            if (extracted) {
              if (extracted.price) { update.price = extracted.price; stats.pricesFound++; }
              if (extracted.priceText) { update.price_text = extracted.priceText; stats.pricesPoa++; }
            }
            // Capture raw_text while we have the page
            if (!dbRow.raw_text) {
              const rawText = result.html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              if (rawText.length > 50) update.raw_text = rawText.slice(0, 10000);
            }
            if (Object.keys(update).length > 0) {
              await supabase.from('lots').update(update).eq('id', dbRow.id);
            }
          } catch { /* retry next cycle */ }
        }));
      }
      console.log(`HYGIENE [price]: ✓ ${stats.pricesFound} found, ${stats.pricesPoa} POA`);
    }

    // ═══ PASS 2: Postcode rescue — lot-page fetch for lots with no postcode ═══
    const { data: noPostcodeLots } = await supabase
      .from('lots')
      .select('*')
      .is('postcode', null)
      .not('url', 'like', '__synthetic__%')
      .order('last_seen_at', { ascending: false })
      .limit(300);

    if (noPostcodeLots && noPostcodeLots.length > 0) {
      console.log(`HYGIENE [postcode]: ${noPostcodeLots.length} lots missing postcodes...`);
      const lotObjs = noPostcodeLots.map(dbRowToLot);
      await _deps.enrichLotsFromLotPages(lotObjs, 3);
      for (const lot of lotObjs) {
        if (!lot.postcode && lot.address) {
          lot.postcode = _deps.extractPostcode(lot.address);
          if (lot.postcode) stats.postcodeFixed++;
        }
      }
      await upsertLotGroups(lotObjs, 'hygiene-postcode');
      console.log(`HYGIENE [postcode]: ✓ ${stats.postcodeFixed} postcodes recovered`);
    }

    // ═══ PASS 3: Full enrichment — comps, yield, EPC, flood for lots with postcode but missing data ═══
    // No time gates. If you have a postcode and are missing EPC/flood/comps/yield, you get enriched NOW.
    const { data: needsEnrichment } = await supabase
      .from('lots')
      .select('*')
      .not('postcode', 'is', null)
      .or('enriched_at.is.null,epc_rating.is.null,flood_risk.is.null,street_avg.is.null,est_gross_yield.is.null')
      .order('last_seen_at', { ascending: false })
      .limit(500);

    if (needsEnrichment && needsEnrichment.length > 0) {
      console.log(`HYGIENE [enrich]: ${needsEnrichment.length} lots have postcode but missing EPC/flood/comps/yield...`);
      const groups = {};
      for (const row of needsEnrichment) {
        const key = `${row.house}|${row.catalogue_url}`;
        if (!groups[key]) groups[key] = { house: row.house, catalogueUrl: row.catalogue_url, rows: [] };
        groups[key].rows.push(row);
      }

      for (const [, group] of Object.entries(groups)) {
        try {
          const lotObjs = group.rows.map(dbRowToLot);
          // Re-analyse unscored lots
          for (const lot of lotObjs) {
            if (lot.score === 0 && (!lot.scoreBreakdown || lot.scoreBreakdown.length === 0)) {
              Object.assign(lot, analyseLot(lot));
            }
            // Condition inference from bullets
            if (!lot.condition && lot.bullets && lot.bullets.length > 0) {
              const t = lot.bullets.join(' ').toLowerCase();
              if (/derelict|dilapidated|fire damage/.test(t)) lot.condition = 'poor';
              else if (/modernis|refurbishment|renovation|updating|in need of|improvement|requires? (?:updating|work|repair)|fixer.upper/.test(t)) lot.condition = 'needs work';
              else if (/good order|good decorative|well maintained|recently refurbished|good condition/.test(t)) lot.condition = 'good';
            }
          }
          // enrichLots does: Land Registry comps, yield calc, EPC lookup, flood check
          await _deps.enrichLots(lotObjs, group.house, group.catalogueUrl);
          _deps.normaliseLotStatuses(lotObjs);
          await upsertToLotsTable(lotObjs, group.house, group.catalogueUrl, { scrapedWith: 'hygiene-enrich' });
          stats.enriched += lotObjs.length;
          console.log(`HYGIENE [enrich]: ✓ ${group.house}: ${lotObjs.length} lots`);
        } catch (e) {
          console.warn(`HYGIENE [enrich]: Failed for ${group.house}: ${e.message}`);
        }
      }
    }

    // ═══ PASS 4: Lot-page deep enrichment — tenure, condition, beds, vacant, images ═══
    // Targets any lot still missing non-negotiable fields that has a fetchable URL.
    const { data: needsLotPage } = await supabase
      .from('lots')
      .select('*')
      .not('url', 'like', '__synthetic__%')
      .or('tenure.is.null,condition.is.null,beds.is.null,image_url.is.null,prop_type.is.null,vacant.is.null')
      .order('last_seen_at', { ascending: false })
      .limit(300);

    if (needsLotPage && needsLotPage.length > 0) {
      console.log(`HYGIENE [lot-page]: ${needsLotPage.length} lots need deep enrichment from lot pages...`);
      const lotObjs = needsLotPage.map(dbRowToLot);
      try {
        await _deps.enrichLotsFromLotPages(lotObjs, 3);
        await upsertLotGroups(lotObjs, 'hygiene-lotpage');
        stats.lotPageEnriched += lotObjs.length;
        console.log(`HYGIENE [lot-page]: ✓ ${lotObjs.length} lots enriched`);
      } catch (e) {
        console.warn(`HYGIENE [lot-page]: Failed: ${e.message}`);
      }
    }

    // ═══ Summary ═══
    const { count: remainingNoPrice } = await supabase.from('lots').select('*', { count: 'exact', head: true }).or('price.is.null,price.eq.0').is('price_text', null);
    const { count: remainingNoPostcode } = await supabase.from('lots').select('*', { count: 'exact', head: true }).is('postcode', null).not('url', 'like', '__synthetic__%');
    const { count: remainingNoEnrich } = await supabase.from('lots').select('*', { count: 'exact', head: true }).is('enriched_at', null).not('postcode', 'is', null);
    console.log(`HYGIENE: Complete — prices:${stats.pricesFound}found/${stats.pricesPoa}poa, postcodes:${stats.postcodeFixed}fixed, enriched:${stats.enriched}, lotPages:${stats.lotPageEnriched}`);
    console.log(`HYGIENE: Remaining gaps — no price:${remainingNoPrice || 0}, no postcode:${remainingNoPostcode || 0}, no enrichment:${remainingNoEnrich || 0}`);
  } catch (e) {
    console.error('HYGIENE: Fatal error:', e.message);
  } finally {
    _enrichmentWaveRunning = false;
  }
}

// ══════════════════════════════════════════════════════════════════
// logActivityEvent
// ══════════════════════════════════════════════════════════════════
async function logActivityEvent(action, detail = {}, email = null, ip = null) {
  try {
    await supabase.from('activity_events').insert({
      user_email: email || null,
      action,
      detail,
      ip: ip || null,
    });
  } catch (e) {
    console.warn('Activity log error:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// Exports
// ══════════════════════════════════════════════════════════════════
export { qualityGate, analyseLot, W2N };
export { HOUSE_NAME_MIGRATIONS, syncCalendarAndHouseNames };
export { createSemaphore, runWave };
export { autoAnalyseAll, autoAnalyseOne };
export { healBrokenHouse, discoverAndUpdateCalendar };
export { JUNK_LOT_PATTERN, buildSearchText, upsertToLotsTable };
export { computeScrapeDiff, updateHouseSkill, saveDailySnapshot };
export { dbRowToLot, dbRowToFrontendLot, LOTS_SELECT, upsertLotGroups };
export { extractPriceFromText, runEnrichmentWave, logActivityEvent };
