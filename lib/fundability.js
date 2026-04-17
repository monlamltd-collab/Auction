/**
 * Fundability Badge — maps auction lots to BridgeMatch DealEssentials
 * and fetches lender match counts.
 *
 * Exports:
 *   mapLotToDeal(lot)         — maps lot fields → DealEssentials object
 *   getFundabilityBadge(lot)  — calls BridgeMatch /api/filter, returns badge data or null
 *   buildBridgematchUrl(deal) — builds deep link URL with UTM params
 *   _mapPropertyType(type)    — exported for testing only (prefixed with _)
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
    'commercial': 'commercial',
    'shop': 'commercial',
    'office': 'commercial',
    'land': 'land',
    'plot': 'land',
  };
  return map[(type || '').toLowerCase()] || 'residential';
}

// ─── Lot → DealEssentials mapping ───
export function mapLotToDeal(lot) {
  const price = lot.price || lot.guidePrice || 0;
  const conditionStr = (lot.condition || '').toLowerCase();
  const isRefurb = ['poor', 'derelict', 'needs work', 'needs modernisation', 'needs refurbishment']
    .some(s => conditionStr.includes(s));

  return {
    purchase_price: price,
    market_value: price,                     // Conservative: use purchase price as MV
    property_type: _mapPropertyType(lot.propType),
    geography: detectGeography(lot.address),
    is_refurb: isRefurb,
    loan_amount: Math.round(price * 0.7),    // 70% LTV default
  };
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
  return `https://www.bridgematch.co.uk/check?${params}`;
}

// ─── Fetch fundability badge data from BridgeMatch API ───
export async function getFundabilityBadge(lot) {
  const deal = mapLotToDeal(lot);
  if (deal.purchase_price <= 0) return null;

  // Cache key: price + propType + condition + geography (all fields that affect matching)
  const cacheKey = `${deal.purchase_price}_${deal.property_type}_${deal.is_refurb}_${deal.geography}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  const baseUrl = process.env.BRIDGEMATCH_API_URL || 'https://www.bridgematch.co.uk';
  const url = `${baseUrl}/api/filter`;

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
    const result = {
      lenderCount: data.summary?.eligible || data.eligible?.length || 0,
      possibleCount: data.summary?.possible || 0,
      ltv: 70,
      bridgematchUrl: buildBridgematchUrl(deal),
    };

    setCache(cacheKey, result);
    return result;
  } catch {
    // Graceful degradation — no badge shown on timeout or network error
    return null;
  }
}

// ─── Batch helper: enrich an array of lots with fundability data ───
// Fire-and-forget style — never throws, never blocks the pipeline.
// Processes sequentially with a small gap to avoid hammering BridgeMatch.
export async function enrichLotsWithFundability(lots) {
  const GAP_MS = 100; // 100ms between calls to avoid overwhelming BridgeMatch
  for (const lot of lots) {
    if (!lot.price && !lot.guidePrice) continue;
    try {
      lot.fundability = await getFundabilityBadge(lot);
    } catch {
      lot.fundability = null;
    }
    if (GAP_MS > 0) await new Promise(r => setTimeout(r, GAP_MS));
  }
}
