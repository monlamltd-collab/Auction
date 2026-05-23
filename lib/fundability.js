/**
 * Fundability Badge — maps auction lots to BridgeMatch DealEssentials
 * and fetches lender match counts.
 *
 * Exports:
 *   mapLotToDeal(lot)         — maps lot fields → DealEssentials object
 *   getFundabilityBadge(lot)  — calls BridgeMatch /api/filter, returns badge data or null
 *   buildBridgematchUrl(deal) — builds deep link URL with UTM params
 *   _mapPropertyType(type)    — exported for testing only (prefixed with _)
 *   _deriveDeal(lot)          — exported for testing only; returns { deal, provenance }
 */

// ─── In-memory cache: lot URL → { data, expires } ───
const _cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCached(key) {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    _cache.delete(key);
    return undefined;
  }
  return entry.data;
}

function setCache(key, data) {
  _cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
  // Prevent unbounded growth — evict oldest entries over 5000
  if (_cache.size > 5000) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
}

// ─── Geography detection from address ───
const SCOTLAND_PATTERNS = /\b(Edinburgh|Glasgow|Aberdeen|Dundee|Inverness|Perth|Stirling|Falkirk|Paisley|Kilmarnock|Ayr|Dumfries|EH\d|G\d|AB\d|DD\d|IV\d|PH\d|FK\d|PA\d|KA\d|KY\d|ML\d|DG\d|TD\d|ZE\d|HS\d|KW\d)\b/i;
const WALES_PATTERNS = /\b(Cardiff|Swansea|Newport|Wrexham|Bangor|Llanelli|Bridgend|Neath|Barry|Pontypridd|CF\d|SA\d|NP\d|LL\d|SY\d|LD\d|HR\d)\b/i;
// Note: HR postcodes straddle England/Wales — acceptable approximation

function detectGeography(address) {
  if (!address) return 'England';
  if (SCOTLAND_PATTERNS.test(address)) return 'Scotland';
  if (WALES_PATTERNS.test(address)) return 'Wales';
  return 'England';
}

// ─── Property type mapping ───
export function _mapPropertyType(type) {
  const map = {
    'house': 'residential',
    'flat': 'residential',
    'apartment': 'residential',
    'bungalow': 'residential',
    'maisonette': 'residential',
    'cottage': 'residential',
    'hmo': 'hmo',
    'mixed_use': 'mixed_use',
    'mixed use': 'mixed_use',
    'commercial': 'commercial',
    'shop': 'commercial',
    'retail': 'retail',
    'office': 'office',
    'industrial': 'industrial',
    'warehouse': 'industrial',
    'land': 'land',
    'plot': 'land',
    'development_site': 'development_site',
    'development site': 'development_site',
  };
  return map[(type || '').toLowerCase()] || 'residential';
}

// ─── Deal derivation constants ───
// LTV defaults by property type — conservative upper bounds typical in UK bridging
const LTV_BY_TYPE = {
  residential: 75,
  hmo: 75,
  mixed_use: 75,
  commercial: 60,
  office: 60,
  retail: 60,
  industrial: 60,
  land: 45,
  development_site: 45,
};
const DEFAULT_LTV = 65; // conservative fallback for unknown types

// Works cost as fraction of purchase price, by condition keyword (checked in order, first match wins)
const WORKS_COST_RULES = [
  { keywords: ['derelict', 'major_works', 'shell'], pct: 0.35, label: 'derelict' },
  { keywords: ['poor', 'needs_modernisation', 'cosmetic_plus'], pct: 0.20, label: 'poor' },
  { keywords: ['cosmetic', 'light_refurb', 'needs_refresh'], pct: 0.08, label: 'cosmetic' },
];
const DEFAULT_REFURB_WORKS_PCT = 0.15; // unknown refurb condition fallback
// GDV = purchase_price + works_cost + 15% uplift (rough proxy; real GDV requires valuation)
const GDV_UPLIFT_PCT = 0.15;
// Auction bridging is typically a 6-month bridge, not the API default of 12
const DEFAULT_LOAN_TERM_MONTHS = 6;

const REFURB_CONDITION_KEYWORDS = [
  'poor', 'derelict', 'needs work', 'needs modernisation', 'needs refurbishment',
  'major_works', 'shell', 'cosmetic_plus', 'needs_modernisation', 'light_refurb',
  'needs_refresh', 'cosmetic',
];

function deriveWorksCost(price, conditionStr) {
  for (const rule of WORKS_COST_RULES) {
    if (rule.keywords.some(k => conditionStr.includes(k))) {
      return { works_cost: Math.round(price * rule.pct), source: `condition:${rule.label}` };
    }
  }
  return { works_cost: Math.round(price * DEFAULT_REFURB_WORKS_PCT), source: 'default_refurb' };
}

// ─── Internal: derive deal + provenance from a lot ───
// Provenance records how each derived input was obtained so downstream
// consumers (quality gates, manifest, UI) can distinguish real data from proxies.
export function _deriveDeal(lot) {
  const price = lot.price || lot.guidePrice || 0;
  const conditionStr = (lot.condition || '').toLowerCase();
  const isRefurb = REFURB_CONDITION_KEYWORDS.some(k => conditionStr.includes(k));
  const propertyType = _mapPropertyType(lot.propType);
  const ltvPct = LTV_BY_TYPE[propertyType] ?? DEFAULT_LTV;

  const deal = {
    purchase_price: price,
    market_value: price,
    property_type: propertyType,
    geography: detectGeography(lot.address),
    is_refurb: isRefurb,
    loan_amount: Math.round(price * (ltvPct / 100)),
  };

  const provenance = {
    ltv_pct: ltvPct,
    ltv_source: `type_default:${propertyType}`,
    gdv_source: 'purchase_price',
    works_cost_source: null,
    loan_term_source: null,
    confidence: 'high',
  };

  if (isRefurb && price > 0) {
    const { works_cost, source } = deriveWorksCost(price, conditionStr);
    // GDV = purchase_price + works_cost + 15% uplift — conservative proxy only;
    // a real GDV requires a surveyor's valuation on the completed property.
    const gdv = Math.round(price + works_cost + price * GDV_UPLIFT_PCT);
    deal.works_cost = works_cost;
    deal.gdv = gdv;
    deal.loan_term = lot.loanTerm || DEFAULT_LOAN_TERM_MONTHS;
    provenance.works_cost_source = source;
    provenance.gdv_source = `proxy:price+works+${GDV_UPLIFT_PCT * 100}pct_uplift`;
    provenance.loan_term_source = lot.loanTerm ? 'lot_data' : `default_${DEFAULT_LOAN_TERM_MONTHS}m`;
    // Refurb lots carry two proxies (gdv + works_cost) → medium confidence
    provenance.confidence = 'medium';
  }

  return { deal, provenance };
}

// ─── Lot → DealEssentials mapping ───
export function mapLotToDeal(lot) {
  return _deriveDeal(lot).deal;
}

// ─── BridgeMatch deep link URL builder ───
export function buildBridgematchUrl(deal) {
  const params = new URLSearchParams({
    purchase_price: deal.purchase_price,
    property_type: deal.property_type,
    loan_amount: deal.loan_amount,
    is_refurb: deal.is_refurb,
    geography: deal.geography,
    utm_source: 'auctionbrain',
    utm_medium: 'lot_badge',
    utm_campaign: 'fundability',
  });
  // Pre-fill refurb-specific fields so the deep link arrives with complete deal data
  if (deal.works_cost != null) params.set('works_cost', deal.works_cost);
  if (deal.gdv != null) params.set('gdv', deal.gdv);
  if (deal.loan_term != null) params.set('loan_term', deal.loan_term);
  return `https://www.bridgematch.co.uk/check?${params}`;
}

// ─── Fetch fundability badge data from BridgeMatch API ───
export async function getFundabilityBadge(lot) {
  const { deal, provenance } = _deriveDeal(lot);
  if (!deal.purchase_price || deal.purchase_price <= 0) {
    console.warn('[fundability] Skipping badge — missing or zero purchase_price', { lot_address: lot.address });
    return { status: 'no_price', lenderCount: null };
  }

  // Cache key includes all inputs that affect lender matching.
  // works_cost is bucketed to nearest £5k to avoid over-fragmentation from
  // minor price differences on otherwise identical deal shapes.
  const worksBucket = deal.works_cost != null
    ? Math.round(deal.works_cost / 5000) * 5000
    : 'none';
  const cacheKey = [
    deal.purchase_price,
    deal.property_type,
    deal.is_refurb,
    deal.geography,
    worksBucket,
    deal.loan_term ?? DEFAULT_LOAN_TERM_MONTHS,
  ].join('_');
  const cached = getCached(cacheKey);
  if (cached !== undefined) {
    if (cached === null) return null;
    return { ...cached, _provenance: { ...provenance, status: 'cache_hit' } };
  }

  const baseUrl = process.env.BRIDGEMATCH_API_URL || 'https://www.bridgematch.co.uk';
  const url = `${baseUrl}/api/filter`;
  const startMs = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deal),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      setCache(cacheKey, null);
      return null;
    }

    const data = await response.json();
    const base = {
      lenderCount: data.summary?.eligible || data.eligible?.length || 0,
      possibleCount: data.summary?.possible || 0,
      ltv: provenance.ltv_pct,
      // Canonical server-derived loan figure — consumed by the frontend
      // "Get a bridging quote" lead-capture CTA so the lead payload uses
      // the same loan_amount BridgeMatch's /api/filter was queried with.
      loanAmount: deal.loan_amount,
      bridgematchUrl: buildBridgematchUrl(deal),
    };
    setCache(cacheKey, base);

    return {
      ...base,
      _provenance: { ...provenance, status: 'api_ok', response_time_ms: Date.now() - startMs },
    };
  } catch {
    // Graceful degradation — no badge shown on timeout or network error
    return null;
  }
}

// ─── Batch helper: enrich an array of lots with fundability data ───
// Fire-and-forget style — never throws, never blocks the pipeline.
// Processes sequentially with a small gap to avoid hammering BridgeMatch.
// Populates lot._enrichment.fundability (if a manifest is present) with the
// per-lot outcome so silent badge failures become observable downstream.
export async function enrichLotsWithFundability(lots) {
  const GAP_MS = 100; // 100ms between calls to avoid overwhelming BridgeMatch

  // Lazy import to keep fundability.js usable standalone (tests do not
  // need the manifest module).
  let manifestMod = null;
  try {
    manifestMod = await import('./enrichment-manifest.js');
  } catch { /* manifest module optional */ }

  for (const lot of lots) {
    if (!lot.price && !lot.guidePrice) continue;

    // Derive deal + provenance locally so we can populate the manifest
    // even if the API call itself fails or is skipped.
    const { deal, provenance } = _deriveDeal(lot);
    const inputsDerived = [
      provenance.gdv_source?.startsWith('proxy') ? 'gdv' : null,
      provenance.works_cost_source != null ? 'works_cost' : null,
      provenance.loan_term_source ? 'loan_term' : null,
    ].filter(Boolean);

    // Expose suggested defaults to the deal-stacking widget on the frontend
    lot.suggested = {
      worksCost: deal.works_cost ?? null,
      gdv: deal.gdv ?? null,
      worksSource: provenance.works_cost_source,
      gdvSource: provenance.gdv_source,
      confidence: provenance.confidence,
    };

    let badge = null;
    try {
      badge = await getFundabilityBadge(lot);
    } catch {
      badge = null;
    }
    lot.fundability = badge;

    // Record outcome in manifest (if the lot has one)
    if (manifestMod && lot._enrichment) {
      let status;
      let lenderCount;
      let responseTimeMs;
      if (badge && badge.status === 'no_price') {
        status = 'no_price';
      } else if (badge && badge._provenance) {
        status = badge._provenance.status || 'api_ok';
        lenderCount = badge.lenderCount;
        responseTimeMs = badge._provenance.response_time_ms;
      } else {
        status = 'api_error';
      }
      manifestMod.recordFundability(lot._enrichment, {
        status,
        lender_count: lenderCount,
        ltv_pct: provenance.ltv_pct,
        inputs_derived: inputsDerived,
        confidence: provenance.confidence,
        response_time_ms: responseTimeMs,
      });
    }

    if (GAP_MS > 0) await new Promise(r => setTimeout(r, GAP_MS));
  }
}
