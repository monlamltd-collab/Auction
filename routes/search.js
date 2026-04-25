import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { validateUserFromReq, rateLimit, getClientIP, safeCompare } from '../lib/auth.js';
import { log } from '../lib/logging.js';
import { resolveEffectiveTier, getAISearchLimit, STRIPE_ENABLED, stripAIFields } from '../lib/config.js';
import { callAI } from '../lib/ai-provider.js';
import { dbRowToFrontendLot, LOTS_SELECT, logActivityEvent, getCreditExhausted, setCreditExhausted, getCreditExhaustedAt, setCreditExhaustedAt } from '../lib/analysis.js';
import { enrichLotsWithFundability } from '../lib/fundability.js';
import { normaliseUrl } from '../lib/utils.js';
import { FALLBACK_CALENDAR } from '../lib/calendar.js';
import { normaliseLotStatuses, isValidImageUrl } from '../lib/scraper.js';
import { createHash } from 'crypto';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// PRESET QUERIES — cached for instant results
// ═══════════════════════════════════════════════════════════════
const PRESET_QUERIES = {
  'Properties needing heavy refurbishment': 'heavy-refurb',
  'Freehold multi-unit blocks for title splitting': 'title-splits',
  'High yield investments over 8%': 'high-yield-8',
  'Development land with planning': 'dev-land',
  'Probate or executor sales': 'probate',
  'Best scoring deals': 'top-picks',
  'Vacant properties': 'vacant',
  'Properties under £100k': 'under-100k',
  'Commercial property': 'commercial',
  'Land and development sites': 'land-dev',
  'Flats and apartments': 'flats',
};

// ── Deterministic preset filters — bypass Gemini entirely ──
// Each preset defines: filter (lot => boolean), sort (compare fn), report (count => string)
const PRESET_FILTERS = {
  'top-picks': {
    filter: l => (l.score || 0) >= 3,
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} high-scoring investment opportunities (score 3+) across ${total} auction lots. These properties show the strongest combination of investment signals — such as below-market pricing, development potential, motivated sellers, and value-add condition. Higher scores indicate more overlapping opportunity signals.`
      : `No lots currently score 3 or above. Scores are based on investment signals like condition, tenure, yield, and seller motivation. Try browsing the full directory or check back when new catalogues are analysed.`,
  },
  'under-100k': {
    filter: l => l.price && l.price > 0 && l.price < 100000,
    sort: (a, b) => (a.price || Infinity) - (b.price || Infinity),
    report: (n, total) => n > 0
      ? `Found ${n} properties listed under £100,000 across ${total} lots. These are sorted by guide price, lowest first. Remember that guide prices at auction are often below the expected sale price.`
      : `No properties currently listed under £100,000. Guide prices change as new catalogues are published — check back soon.`,
  },
  'vacant': {
    filter: l => l.vacant === true,
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} vacant properties across ${total} lots, sorted by investment score. Vacant possession means faster completion and immediate access for refurbishment or re-letting.`
      : `No properties explicitly listed as vacant possession. Some lots may still be vacant but not stated in the listing — check individual lot details.`,
  },
  'flats': {
    filter: l => l.propType === 'flat',
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} flats and apartments across ${total} lots, sorted by investment score. Check tenure carefully — most flats are leasehold.`
      : `No flats or apartments found in current catalogues.`,
  },
  'high-yield-8': {
    filter: l => l.estGrossYield && l.estGrossYield >= 8,
    sort: (a, b) => (b.estGrossYield || 0) - (a.estGrossYield || 0),
    report: (n, total) => n > 0
      ? `Found ${n} properties with estimated gross yield of 8% or above across ${total} lots, sorted by yield. These yields are estimates based on guide price and local rental data — verify with your own research.`
      : `No properties currently show an estimated gross yield of 8% or above. Yields are calculated from guide prices and local rental data, so they update as new catalogues are published.`,
  },
  'title-splits': {
    filter: l => l.titleSplit === true,
    sort: (a, b) => (b.units || 0) - (a.units || 0) || (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} potential title split opportunities across ${total} lots — freehold properties containing multiple self-contained units. Sorted by unit count. Title splitting can unlock significant value but requires legal and planning checks.`
      : `No title split opportunities detected in current catalogues. These are identified by freehold multi-unit properties where individual flats could be sold separately.`,
  },
  'probate': {
    filter: l => (l.opps || []).some(o => /executor|probate/i.test(o)),
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} probate and executor sales across ${total} lots, sorted by investment score. These often come with motivated sellers and potential for below-market pricing.`
      : `No probate or executor sales found in current catalogues. These are identified by keywords like "executor", "probate", "estate of" in lot descriptions.`,
  },
  'heavy-refurb': {
    filter: l => l.condition === 'needs work' || l.condition === 'poor',
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} properties needing refurbishment across ${total} lots, sorted by investment score. These range from cosmetic updates to full renovations — check lot details for specifics.`
      : `No properties explicitly described as needing refurbishment in current catalogues.`,
  },
  'dev-land': {
    filter: l => (l.opps || []).some(o => /development/i.test(o)),
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} development opportunities across ${total} lots, sorted by investment score. These include properties with planning permission, development potential, or conversion opportunities.`
      : `No development opportunities found in current catalogues. These are identified by keywords like "planning permission", "development potential", "conversion" in lot descriptions.`,
  },
  'commercial': {
    filter: l => l.propType === 'commercial',
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} commercial properties across ${total} lots, sorted by investment score. Includes shops, offices, retail units, industrial premises, and investment portfolios.`
      : `No commercial properties found in current catalogues.`,
  },
  'land-dev': {
    filter: l => l.propType === 'land' || (l.opps || []).some(o => /development/i.test(o)),
    sort: (a, b) => (b.score || 0) - (a.score || 0),
    report: (n, total) => n > 0
      ? `Found ${n} land and development sites across ${total} lots, sorted by investment score. Includes building plots, development sites, and properties with planning permission.`
      : `No land or development sites found in current catalogues.`,
  },
};

function isPresetQuery(query) {
  return PRESET_QUERIES[query] || null;
}

// ═══════════════════════════════════════════════════════════════
// SMART SEARCH QUERY PARSER — extracts structured column filters
// from natural language queries so the lots table can be queried
// with SQL before sending the narrowed set to Gemini.
// ═══════════════════════════════════════════════════════════════
function parseSmartSearchQuery(query) {
  const result = { filters: {}, softFilters: {}, locationTerms: [], freeText: [], intentWords: [], concepts: [], original: query };
  let q = query.toLowerCase().trim();

  // ── Concept detection — compound intents that shouldn't be split into individual hard filters ──
  // "block(s) of flats" / "blocks of apartments" → multi-unit freehold concept
  if (/blocks?\s+of\s+(?:flats?|apartments?)/i.test(q)) {
    result.concepts.push('multi_unit_freehold');
    q = q.replace(/blocks?\s+of\s+(?:flats?|apartments?)/gi, '').trim();
  }
  // "could title split" / "title split potential" / "potential to title split"
  if (/(?:could|potential\s+to)\s+title\s+split/i.test(q)) {
    result.concepts.push('title_split_potential');
    q = q.replace(/(?:could|potential\s+to)\s+title\s+split/gi, '').trim();
  }
  // "HMO conversion" / "convert to HMO"
  if (/(?:hmo\s+conversion|convert(?:ed)?\s+to\s+hmo)/i.test(q)) {
    result.concepts.push('hmo_conversion');
    q = q.replace(/(?:hmo\s+conversion|convert(?:ed)?\s+to\s+hmo)/gi, '').trim();
  }
  // "development site" / "development opportunity"
  if (/development\s+(?:site|opportunity|potential|plot)/i.test(q)) {
    result.concepts.push('development');
    q = q.replace(/development\s+(?:site|opportunity|potential|plot)/gi, '').trim();
  }
  // "flip" / "buy to flip" / "quick flip"
  if (/(?:buy\s+to\s+|quick\s+)?flip/i.test(q)) {
    result.concepts.push('flip');
    q = q.replace(/(?:buy\s+to\s+|quick\s+)?flip/gi, '').trim();
  }
  // "buy to let" / "BTL" / "rental"
  if (/(?:buy\s+to\s+let|btl|rental\s+(?:investment|property|yield))/i.test(q)) {
    result.concepts.push('buy_to_let');
    q = q.replace(/(?:buy\s+to\s+let|btl|rental\s+(?:investment|property|yield))/gi, '').trim();
  }

  // ── Multi-word phrases (extract before splitting into words) ──
  // title_split as standalone phrase (not part of a concept) → soft filter
  if (/title\s+split/i.test(q)) { result.softFilters.title_split = true; q = q.replace(/title\s+splits?/gi, '').trim(); }
  if (/need(?:s|ing)?\s+work/i.test(q)) { result.softFilters.condition = ['needs work', 'poor']; q = q.replace(/need(?:s|ing)?\s+(?:of\s+)?work/gi, '').trim(); }
  if (/poor\s+condition/i.test(q)) { result.softFilters.condition = ['needs work', 'poor']; q = q.replace(/poor\s+condition/gi, '').trim(); }
  if (/good\s+condition/i.test(q)) { result.filters.condition = ['good']; q = q.replace(/good\s+condition/gi, '').trim(); }
  if (/share\s+of\s+freehold/i.test(q)) { result.filters.tenure = 'Share of Freehold'; q = q.replace(/share\s+of\s+freehold/gi, '').trim(); }
  if (/high\s+yield/i.test(q)) { result.filters.sortBy = 'yield'; q = q.replace(/high\s+yield/gi, '').trim(); }
  if (/deal\s+stack/i.test(q)) { result.concepts.push('deal_stack'); q = q.replace(/deal\s+stack(?:ing)?/gi, '').trim(); }

  // ── Multi-word location names (must extract before splitting) ──
  const multiWordLocations = {
    'milton keynes': 'Milton Keynes', 'st albans': 'St Albans', 'stoke on trent': 'Stoke',
    'weston-super-mare': 'Weston-super-Mare', 'weston super mare': 'Weston-super-Mare',
    'tunbridge wells': 'Tunbridge', 'bury st edmunds': 'Bury St Edmunds',
    'kings lynn': 'Kings Lynn', 'great yarmouth': 'Great Yarmouth',
    'hemel hempstead': 'Hemel Hempstead', 'st helens': 'St Helens',
    'west bromwich': 'West Bromwich', 'sutton coldfield': 'Sutton Coldfield',
    'stratford-upon-avon': 'Stratford-upon-Avon', 'stratford upon avon': 'Stratford-upon-Avon',
    'bishop auckland': 'Bishop Auckland', 'south shields': 'South Shields',
    'port talbot': 'Port Talbot', 'isle of wight': 'Isle of Wight',
    'fort william': 'Fort William', 'east kilbride': 'East Kilbride',
    'barrow in furness': 'Barrow', 'colwyn bay': 'Colwyn Bay',
  };
  for (const [phrase, canonical] of Object.entries(multiWordLocations)) {
    if (q.includes(phrase)) { result.locationTerms.push(canonical); q = q.replace(new RegExp(phrase.replace(/[-]/g, '\\-'), 'gi'), '').trim(); }
  }

  // ── Region names → postcode prefix filters ──
  const regionPostcodes = {
    'london': ['E','EC','N','NW','SE','SW','W','WC','EN','HA','IG','KT','TW','UB','BR','CR','DA','SM','RM'],
    'south east': ['BN','CT','GU','ME','MK','OX','PO','RG','RH','SL','SO','TN','HP'],
    'south west': ['BA','BH','BS','DT','EX','GL','PL','SN','SP','TA','TQ','TR'],
    'east': ['AL','CB','CM','CO','IP','LU','NR','PE','SG','SS','WD'],
    'west midlands': ['B','CV','DY','HR','ST','TF','WR','WS','WV'],
    'east midlands': ['DE','DN','LE','LN','NG','NN'],
    'north west': ['BB','BL','CA','CH','CW','FY','L','LA','M','OL','PR','SK','WA','WN'],
    'north east': ['DH','DL','HG','NE','SR','TS'],
    'yorkshire': ['BD','DN','HD','HG','HU','HX','LS','S','WF','YO'],
    'wales': ['CF','LD','LL','NP','SA','SY'],
    'scotland': ['AB','DD','DG','EH','FK','G','HS','IV','KA','KW','KY','ML','PA','PH','TD','ZE'],
  };
  // Check region phrases (must check multi-word first; 'london' is included
  // because lots in "47 Brompton Road, SW3" never contain the literal word
  // 'london' — postcode prefix matching catches them)
  const regionOrder = ['south east','south west','west midlands','east midlands','north west','north east','east','yorkshire','wales','scotland','london'];
  for (const region of regionOrder) {
    // Use word-boundary regex so 'east' inside 'east-end' doesn't match
    // and 'south east' doesn't trigger 'east' as well
    const regionRe = new RegExp('\\b' + region.replace(/\s+/g, '\\s+') + '\\b', 'i');
    if (regionRe.test(q)) {
      result.filters.regionPostcodes = regionPostcodes[region];
      result.filters.regionName = region;
      q = q.replace(new RegExp(regionRe.source, 'gi'), '').trim();
      break;
    }
  }

  // ── Price patterns ──
  const underMatch = q.match(/(?:under|below|max|up\s+to|less\s+than)\s*£?\s*(\d[\d,]*)\s*k?\b/i);
  if (underMatch) {
    let price = parseInt(underMatch[1].replace(/,/g, ''));
    if (price < 10000) price *= 1000;
    result.filters.maxPrice = price;
    q = q.replace(underMatch[0], '').trim();
  }
  const overMatch = q.match(/(?:over|above|min|more\s+than|from)\s*£?\s*(\d[\d,]*)\s*k?\b/i);
  if (overMatch) {
    let price = parseInt(overMatch[1].replace(/,/g, ''));
    if (price < 10000) price *= 1000;
    result.filters.minPrice = price;
    q = q.replace(overMatch[0], '').trim();
  }

  // ── Beds ──
  const bedMatch = q.match(/(\d+)\s*(?:bed(?:room)?s?\b)/i);
  if (bedMatch) { result.filters.beds = parseInt(bedMatch[1]); q = q.replace(bedMatch[0], '').trim(); }

  // ── Word classification ──
  const propTypes = { house: 'house', houses: 'house', property: null, properties: null, flat: 'flat', flats: 'flat', apartment: 'flat', apartments: 'flat', land: 'land', commercial: 'commercial', garage: 'garage', bungalow: 'bungalow' };
  const conditionWords = { refurb: ['needs work', 'poor'], refurbishment: ['needs work', 'poor'], derelict: ['poor'], dilapidated: ['poor'], rundown: ['needs work', 'poor'] };

  // Intent words — carry meaning for AI ranking but NOT for SQL filtering
  const intentWords = new Set([
    'best','good','great','top','cheap','cheapest','bargain','bargains','deal','deals',
    'interesting','opportunity','opportunities','investment','investments','promising',
    'strong','value','undervalued','potential','recommend','recommended','find','show',
    'search','looking','want','need','any','all','the','with','for','and','near',
    'around','area','region','in','at','on','from','to','what','where','which','how',
    'can','could','should','would','some','these','those','most','more','very','really',
    'please','thanks','help','me','my','give','list','lots','auction','auctions','market',
  ]);

  // Known UK cities/towns for location detection
  const knownLocations = new Set([
    'london','manchester','birmingham','leeds','sheffield','liverpool','bristol','newcastle','nottingham',
    'cardiff','edinburgh','glasgow','belfast','bradford','leicester','coventry','hull','wolverhampton',
    'stoke','derby','swansea','southampton','portsmouth','plymouth','exeter','reading','oxford','cambridge',
    'brighton','bournemouth','bath','york','chester','lancaster','durham','norwich','ipswich','luton',
    'sunderland','middlesbrough','blackpool','bolton','burnley','rochdale','wigan','warrington','crewe',
    'gloucester','cheltenham','swindon','taunton','peterborough','northampton','lincoln','doncaster',
    'halifax','huddersfield','wakefield','barnsley','rotherham','harrogate','scarborough','carlisle',
    'preston','accrington','salford','oldham','stockport','macclesfield','stafford','tamworth',
    'shrewsbury','telford','hereford','worcester','redditch','nuneaton','rugby','solihull',
    'walsall','dudley','kidderminster','chesterfield','mansfield','grantham','loughborough','corby',
    'kettering','wellingborough','buxton','matlock','colchester','chelmsford','southend','basildon',
    'stevenage','watford','hertford','hastings','eastbourne','crawley','chichester',
    'basingstoke','winchester','folkestone','margate','dover','ashford','woking','guildford','maidstone',
    'canterbury','tunbridge','chatham','dartford','gravesend','poole','weymouth','dorchester','barnstaple',
    'yeovil','bridgwater','salisbury','chippenham','truro','penzance','newquay','falmouth',
    'carmarthen','wrexham','bangor','newport','llandudno','aberystwyth','barry','bridgend','neath',
    'llanelli','haverfordwest','pembroke','brecon','aberdeen','dundee','inverness','stirling','perth',
    'falkirk','paisley','kilmarnock','ayr','dumfries','dunfermline','livingston',
    'croydon','bromley','sutton','kingston','richmond','ealing','hounslow','brent','harrow','barnet',
    'enfield','brixton','peckham','hackney','islington','camden','greenwich','lewisham','southwark',
    'lambeth','wandsworth','tottenham','stratford','ilford','romford','dagenham','woolwich','deptford',
  ]);

  const words = q.split(/\s+/).filter(w => w.length > 1);
  const consumed = new Set();
  for (const word of words) {
    const w = word.replace(/[^a-z0-9-]/g, '');
    if (!w) continue;
    if (w === 'freehold' && !result.filters.tenure) { result.filters.tenure = 'Freehold'; consumed.add(word); }
    else if (w === 'leasehold' && !result.filters.tenure) { result.filters.tenure = 'Leasehold'; consumed.add(word); }
    else if (w === 'vacant') { result.softFilters.vacant = true; consumed.add(word); }
    else if (w === 'unsold' || w === 'failed') { result.filters.statusOverride = 'unsold'; consumed.add(word); }
    else if (w === 'development') { result.freeText.push(w); consumed.add(word); }
    else if (w === 'hmo') { result.freeText.push(w); consumed.add(word); }
    else if (w === 'repossession' || w === 'repossessed' || w === 'receivership') { result.freeText.push(w); consumed.add(word); }
    else if (w === 'yield') { result.filters.sortBy = result.filters.sortBy || 'yield'; consumed.add(word); }
    else if (propTypes[w] !== undefined) { if (propTypes[w]) result.softFilters.prop_type = propTypes[w]; consumed.add(word); }
    else if (conditionWords[w] && !result.softFilters.condition) { result.softFilters.condition = conditionWords[w]; consumed.add(word); }
    else if (knownLocations.has(w)) { result.locationTerms.push(w); consumed.add(word); }
    // Postcode prefix (e.g. BS1, M1, LS2)
    else if (/^[a-z]{1,2}\d{1,2}[a-z]?$/i.test(w)) { result.locationTerms.push(w.toUpperCase()); consumed.add(word); }
    // Intent/filler words — strip from SQL, pass context to Gemini
    else if (intentWords.has(w)) { result.intentWords.push(w); consumed.add(word); }
  }

  // Remaining unconsumed words → freeText for full-text search (NOT location)
  for (const word of words) {
    if (consumed.has(word)) continue;
    const w = word.replace(/[^a-z0-9-]/g, '');
    if (!w || w.length < 3) continue;
    result.freeText.push(w);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// SMART SEARCH: Column-filtered database query + AI analysis
// ═══════════════════════════════════════════════════════════════
const _smartSearchCache = new Map();
const SMART_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Clean up expired smart search cache entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - SMART_CACHE_TTL;
  for (const [k, v] of _smartSearchCache) {
    if (v.timestamp < cutoff) _smartSearchCache.delete(k);
  }
}, 10 * 60 * 1000);

// Returns active catalogue rows from cached_analyses, or synthesises them
// from recent lots if cached_analyses is empty (admin clear-cache, deploy
// issue, etc). Same fallback pattern as buildAllLotsResponse() — keeps the
// site usable when the cache pointer table gets wiped.
async function getActiveCataloguesWithFallback() {
  const { data, error } = await supabase
    .from('cached_analyses')
    .select('url, house, created_at')
    .gt('expires_at', new Date().toISOString());
  if (error) return { rows: null, error, fromFallback: false };
  if (data && data.length > 0) return { rows: data, error: null, fromFallback: false };

  // Fallback: derive distinct catalogue_urls from lots seen in the last 14 days
  const fbCutoff = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: fbRows, error: fbErr } = await supabase
    .from('lots')
    .select('catalogue_url, house, last_seen_at')
    .gte('last_seen_at', fbCutoff)
    .not('catalogue_url', 'is', null)
    .limit(10000);
  if (fbErr || !fbRows || fbRows.length === 0) return { rows: null, error: fbErr, fromFallback: true };
  const seen = new Map();
  for (const r of fbRows) {
    if (!seen.has(r.catalogue_url) || r.last_seen_at > seen.get(r.catalogue_url).created_at) {
      seen.set(r.catalogue_url, { url: r.catalogue_url, house: r.house, created_at: r.last_seen_at });
    }
  }
  log.warn('cached_analyses empty — synthesised active catalogues from lots table', { synthesised: seen.size });
  return { rows: [...seen.values()], error: null, fromFallback: true };
}

router.post('/api/smart-search', async (req, res) => {
  const { query, soldFilter, location } = req.body || {};
  if (!query) return res.status(400).json({ error: 'Missing search query' });

  // ── Normalise UI-supplied location filter (postcode/town input + radius) ──
  // Sent by the catalogue page to keep AI search synced with the dropdowns.
  // Precedence: precise center+radius > rawInput postcode prefix > rawInput address ILIKE.
  let uiLoc = null;
  if (location && typeof location === 'object') {
    const center = location.center && Number.isFinite(location.center.lat) && Number.isFinite(location.center.lng)
      ? { lat: +location.center.lat, lng: +location.center.lng }
      : null;
    const radiusMiles = Number.isFinite(+location.radiusMiles) && +location.radiusMiles > 0 ? +location.radiusMiles : null;
    const rawInput = typeof location.rawInput === 'string' ? location.rawInput.trim() : '';
    if (center && radiusMiles) {
      // Bounding-box approximation: 1° lat ≈ 69mi; 1° lng ≈ 40mi at UK latitudes (conservative).
      uiLoc = { type: 'bbox', minLat: center.lat - radiusMiles / 69, maxLat: center.lat + radiusMiles / 69, minLng: center.lng - radiusMiles / 40, maxLng: center.lng + radiusMiles / 40 };
    } else if (rawInput) {
      const pcMatch = rawInput.match(/^([A-Z]{1,2}\d[A-Z\d]?)/i);
      uiLoc = pcMatch ? { type: 'postcode', prefix: pcMatch[1].toUpperCase() } : { type: 'address', text: rawInput };
    }
  }
  const applyUiLoc = (q) => {
    if (!uiLoc) return q;
    if (uiLoc.type === 'bbox') return q.gte('lat', uiLoc.minLat).lte('lat', uiLoc.maxLat).gte('lng', uiLoc.minLng).lte('lng', uiLoc.maxLng);
    if (uiLoc.type === 'postcode') return q.ilike('postcode', `${uiLoc.prefix}%`);
    if (uiLoc.type === 'address') return q.ilike('address', `%${uiLoc.text}%`);
    return q;
  };

  // Authenticate user
  const user = await validateUserFromReq(req);

  // Anonymous users cannot use AI search at all — must sign up
  if (!user) {
    return res.status(403).json({ error: 'premium_required', message: 'Sign up for free to get 5 AI searches per day, or upgrade to Pro for unlimited.' });
  }

  // ── Rate limiting (free: 5/day, premium/trial: unlimited) ──
  const searchLimit = getAISearchLimit(user);
  const searchToday = new Date().toISOString().slice(0, 10);
  let searchesUsed = 0;
  const _searchIp = req.ip || 'unknown';
  const _searchKey = `aisearch:${_searchIp}`;

  if (searchLimit !== Infinity) {
    if (user) {
      const userSearchDate = user.ai_searches_date ? new Date(user.ai_searches_date).toISOString().slice(0, 10) : null;
      if (userSearchDate === searchToday) searchesUsed = user.ai_searches_today || 0;
      if (searchesUsed >= searchLimit) {
        return res.status(429).json({
          error: 'rate_limited',
          message: `You've used all ${searchLimit} AI searches for today. Upgrade to Pro for unlimited.`,
          searchesUsed, searchLimit,
        });
      }
    } else {
      try {
        const { data: sr } = await supabase.from('rate_limits').select('requests').eq('ip', _searchKey).eq('date', searchToday).single();
        searchesUsed = sr?.requests || 0;
      } catch { /* no row yet */ }
      if (searchesUsed >= searchLimit) {
        return res.status(429).json({
          error: 'rate_limited',
          message: `You've used all ${searchLimit} free AI searches for today. Sign up for 10 per day!`,
          searchesUsed, searchLimit, signup_prompt: true,
        });
      }
    }
  }

  // Helper: increment search counter AFTER successful response
  async function incrementSearchCounter() {
    try {
      if (user) {
        await supabase.from('users').update({ ai_searches_today: searchesUsed + 1, ai_searches_date: searchToday }).eq('id', user.id);
      } else {
        const { data: sr } = await supabase.from('rate_limits').select('requests').eq('ip', _searchKey).eq('date', searchToday).single();
        if (sr) { await supabase.from('rate_limits').update({ requests: (sr.requests || 0) + 1 }).eq('ip', _searchKey).eq('date', searchToday); }
        else { await supabase.from('rate_limits').insert({ ip: _searchKey, date: searchToday, requests: 1 }); }
      }
      searchesUsed += 1;
    } catch { /* non-critical */ }
  }

  const presetSlug = isPresetQuery(query);
  const sf = soldFilter || 'all';

  // ── Smart search cache: return cached result for identical queries ──
  const _smCacheKey = (query.toLowerCase().trim() + '|' + sf).trim();
  const _smCached = _smartSearchCache.get(_smCacheKey);
  if (_smCached && (Date.now() - _smCached.timestamp) < SMART_CACHE_TTL) {
    await incrementSearchCounter();
    log.info('smart-search cache-hit', { query, cacheAge: Math.round((Date.now() - _smCached.timestamp) / 1000) + 's' });
    return res.json({ ..._smCached.result, searchesUsed, searchLimit });
  }

  // ── Deterministic preset fast path — no AI needed ──
  // Presets like "Best scoring deals", "Under £100k", "Vacant" etc. can be resolved
  // by filtering/sorting on precomputed lot fields. Reads from lots table (single source of truth).
  const presetFilter = presetSlug ? PRESET_FILTERS[presetSlug] : null;
  if (presetFilter) {
    try {
      // Query lots table directly — get all lots from active catalogues
      // (with fallback if cached_analyses is empty)
      const { rows: activeCatalogues } = await getActiveCataloguesWithFallback();

      if (!activeCatalogues || activeCatalogues.length === 0) {
        await incrementSearchCounter();
        return res.json({ results: [], report: 'No cached auction data available. Please analyse some auction catalogues first.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
      }

      const activeUrls = [...new Set(activeCatalogues.map(c => c.url))];

      // Build status filter at DB level
      let dbQuery = supabase.from('lots').select(LOTS_SELECT).in('catalogue_url', activeUrls);
      if (sf === 'available') dbQuery = dbQuery.or('status.eq.available,status.is.null');
      else if (sf === 'sold') dbQuery = dbQuery.in('status', ['sold', 'stc', 'withdrawn']);
      else if (sf === 'unsold') dbQuery = dbQuery.eq('status', 'unsold');
      else if (sf === 'stc') dbQuery = dbQuery.eq('status', 'stc');
      else if (sf === 'withdrawn') dbQuery = dbQuery.eq('status', 'withdrawn');
      else if (sf !== 'everything') dbQuery = dbQuery.or('status.eq.available,status.eq.unsold,status.is.null');

      dbQuery = applyUiLoc(dbQuery);
      dbQuery = dbQuery.order('score', { ascending: false, nullsFirst: false }).limit(2000);
      const { data: lotRows } = await dbQuery;

      if (!lotRows || lotRows.length === 0) {
        await incrementSearchCounter();
        return res.json({ results: [], report: 'No lots found matching criteria.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
      }

      const allLots = lotRows.map(dbRowToFrontendLot);
      const sources = [];
      const sourceMap = {};
      for (const c of activeCatalogues) {
        if (!sourceMap[c.url]) { sourceMap[c.url] = { house: c.house, url: c.url, count: 0 }; sources.push(sourceMap[c.url]); }
      }
      for (const lot of allLots) {
        if (sourceMap[lot._sourceUrl]) sourceMap[lot._sourceUrl].count++;
      }

      // Apply preset filter and sort
      const matchingLots = allLots.filter(presetFilter.filter);
      matchingLots.sort(presetFilter.sort);

      const report = presetFilter.report(matchingLots.length, allLots.length);

      log.info('smart_search_deterministic', { preset: presetSlug, matches: matchingLots.length, total: allLots.length });
      logActivityEvent('smart_search', { query, results_count: matchingLots.length, deterministic: true }, user?.email, getClientIP(req));

      await incrementSearchCounter();
      return res.json({
        results: matchingLots,
        report,
        sources,
        totalSearched: allLots.length,
        searchesUsed, searchLimit,
      });
    } catch (err) {
      log.warn('Deterministic preset search failed, falling through to AI search', { preset: presetSlug, error: err.message });
      // Fall through to Gemini-based search below
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    log.warn('smart-search: GEMINI_API_KEY not set');
    return res.status(500).json({ error: 'key_missing', message: 'AI search is not configured — GEMINI_API_KEY is missing.' });
  }
  if (getCreditExhausted()) {
    const exhaustedAgo = getCreditExhaustedAt() ? Math.round((Date.now() - getCreditExhaustedAt()) / 60000) : '?';
    log.warn('smart-search: blocked by creditExhausted flag', { exhaustedMinutesAgo: exhaustedAgo });
    return res.status(503).json({ error: 'ai_quota_exhausted', message: `Gemini API rate limit hit ${exhaustedAgo}min ago. Auto-resets after 1 hour. Try again soon.`, exhaustedMinutesAgo: exhaustedAgo });
  }
  const keyPrefix = (process.env.GEMINI_API_KEY || '').substring(0, 10);
  log.info('smart-search pre-flight', { tier: 'fast', keyPrefix: keyPrefix + '...', query: query.substring(0, 60) });

  try {
    // ═══════════════════════════════════════════════════════════
    // LAYER 1: Parse query into structured column filters
    // ═══════════════════════════════════════════════════════════
    const sqParsed = parseSmartSearchQuery(query);
    log.info('smart-search parsed', sqParsed);

    // ── Get active catalogue URLs for freshness gate (with fallback) ──
    const { rows: activeCatalogues } = await getActiveCataloguesWithFallback();

    if (!activeCatalogues || activeCatalogues.length === 0) {
      await incrementSearchCounter();
      return res.json({ results: [], report: 'No active auction data available.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
    }
    const activeUrls = [...new Set(activeCatalogues.map(c => c.url))];

    const effectiveSold = sqParsed.filters.statusOverride || sf;
    const sortCol = sqParsed.filters.sortBy === 'yield' ? 'est_gross_yield' : 'score';

    // UI-supplied postcode/town + radius (from catalogue dropdowns)
    dbQuery = applyUiLoc(dbQuery);

    // ── Concept-based broadening — build OR conditions for semantic intent ──
    const conceptOrClauses = [];
    for (const concept of sqParsed.concepts) {
      if (concept === 'multi_unit_freehold') {
        // A "block of flats" could be listed as any prop_type, but will have units > 1 or
        // mention flats/apartments in search_text. Tenure freehold is handled as hard filter above.
        conceptOrClauses.push('units.gt.1');
        conceptOrClauses.push('title_split.eq.true');
        conceptOrClauses.push('search_text.ilike.%flats%');
        conceptOrClauses.push('search_text.ilike.%apartments%');
        conceptOrClauses.push('search_text.ilike.%block%');
        conceptOrClauses.push('search_text.ilike.%units%');
        conceptOrClauses.push('prop_type.eq.flat');
      } else if (concept === 'title_split_potential') {
        conceptOrClauses.push('title_split.eq.true');
        conceptOrClauses.push('units.gt.1');
        conceptOrClauses.push('search_text.ilike.%title split%');
        conceptOrClauses.push('search_text.ilike.%flats%');
        conceptOrClauses.push('search_text.ilike.%block%');
      } else if (concept === 'hmo_conversion') {
        conceptOrClauses.push('search_text.ilike.%hmo%');
        conceptOrClauses.push('beds.gte.4');
        conceptOrClauses.push('search_text.ilike.%conversion%');
      } else if (concept === 'development') {
        conceptOrClauses.push('search_text.ilike.%development%');
        conceptOrClauses.push('search_text.ilike.%planning%');
        conceptOrClauses.push('prop_type.eq.land');
        conceptOrClauses.push('deal_type.ilike.%development%');
      } else if (concept === 'flip') {
        conceptOrClauses.push('condition.in.(needs work,poor)');
        conceptOrClauses.push('below_market.gt.10');
        conceptOrClauses.push('search_text.ilike.%modernisation%');
        conceptOrClauses.push('search_text.ilike.%refurb%');
      } else if (concept === 'buy_to_let') {
        conceptOrClauses.push('est_gross_yield.gt.5');
        conceptOrClauses.push('search_text.ilike.%tenant%');
        conceptOrClauses.push('search_text.ilike.%rental%');
        conceptOrClauses.push('search_text.ilike.%let%');
      } else if (concept === 'deal_stack') {
        conceptOrClauses.push('title_split.eq.true');
        conceptOrClauses.push('condition.in.(needs work,poor)');
        conceptOrClauses.push('below_market.gt.15');
      }
    }

    // ── Soft filters — OR-based signals that widen the net, not hard constraints ──
    // These get added to the concept OR clauses so the DB returns candidates matching ANY signal
    const softOrClauses = [];
    if (sqParsed.softFilters.title_split) softOrClauses.push('title_split.eq.true', 'search_text.ilike.%title split%', 'units.gt.1');
    if (sqParsed.softFilters.vacant) softOrClauses.push('vacant.eq.true', 'search_text.ilike.%vacant%');
    if (sqParsed.softFilters.prop_type) softOrClauses.push(`prop_type.eq.${sqParsed.softFilters.prop_type}`, `search_text.ilike.%${sqParsed.softFilters.prop_type}%`);
    if (sqParsed.softFilters.condition) {
      softOrClauses.push(`condition.in.(${sqParsed.softFilters.condition.join(',')})`);
      softOrClauses.push('search_text.ilike.%refurb%', 'search_text.ilike.%modernisation%');
    }

    // Concept/soft/free-text OR clauses are no longer used as Layer-1 filters
    // — Layer 2 (Gemini) is the semantic interpreter. They're still computed
    // above so they can flow into the AI prompt as context (filterNote).
    const allOrClauses = [...conceptOrClauses, ...softOrClauses];

    // ── Layer-1 query — broad candidate pool ──
    // PHILOSOPHY: Layer 1 should ONLY apply the user's EXPLICIT, MEASURABLE
    // constraints (status, location, hard price/beds/tenure). Anything that
    // requires interpretation — "title split", "good for HMO", "needs work",
    // "could be split" — is left to Layer 2 (Gemini), which can reason about
    // a lot's search_text using its general knowledge of property investment.
    //
    // This prevents over-narrowing: e.g. "freehold multi unit block to split"
    // shouldn't require literal words "block" or "split" to appear in
    // search_text. Gemini reads the lot descriptions and recognises a 4-flat
    // freehold investment as a title-split candidate even when the data
    // doesn't tag it explicitly.
    //
    // Relaxation only kicks in if hard filters narrow to zero — drop hard
    // filters, then drop location, then wildcard. Each drop is reported to
    // Gemini so the report can be honest about what was matched.
    function buildLayer1Query(tier) {
      let q = supabase.from('lots').select(LOTS_SELECT).in('catalogue_url', activeUrls);

      // Status (always applied — semantic meaning of 'available' / 'unsold' etc)
      if (effectiveSold === 'available') q = q.or('status.eq.available,status.is.null');
      else if (effectiveSold === 'sold') q = q.in('status', ['sold', 'stc', 'withdrawn']);
      else if (effectiveSold === 'unsold') q = q.eq('status', 'unsold');
      else if (effectiveSold === 'stc') q = q.eq('status', 'stc');
      else if (effectiveSold === 'withdrawn') q = q.eq('status', 'withdrawn');
      else if (effectiveSold !== 'everything') q = q.or('status.eq.available,status.eq.unsold,status.is.null');

      // Hard filters (tier 0 only) — explicit user constraints from query parser
      if (tier === 0) {
        if (sqParsed.filters.tenure) q = q.ilike('tenure', sqParsed.filters.tenure);
        if (sqParsed.filters.maxPrice) q = q.lte('price', sqParsed.filters.maxPrice);
        if (sqParsed.filters.minPrice) q = q.gte('price', sqParsed.filters.minPrice);
        if (sqParsed.filters.beds) q = q.gte('beds', sqParsed.filters.beds);
        if (sqParsed.filters.condition) q = q.in('condition', sqParsed.filters.condition);
      }

      // Location (tiers 0-1)
      if (tier <= 1) {
        for (const loc of sqParsed.locationTerms) q = q.ilike('address', `%${loc}%`);
        if (sqParsed.filters.regionPostcodes) {
          const pcOr = sqParsed.filters.regionPostcodes.map(p => `postcode.ilike.${p}%`).join(',');
          q = q.or(pcOr);
        }
      }

      // Up the limit to 800 — Layer 2 (Gemini) gets a wider candidate pool to
      // reason over so semantic concepts (title-split, HMO, refurb, etc.)
      // can be recognised even when the database doesn't tag them.
      return q.order(sortCol, { ascending: false, nullsFirst: false }).limit(800);
    }

    const TIER_LABELS = ['strict', 'location-only', 'wildcard'];
    let lotRows = null, lotErr = null, searchTier = 0;
    for (let tier = 0; tier <= 2; tier++) {
      const { data, error } = await buildLayer1Query(tier);
      if (error) { lotErr = error; break; }
      if (data && data.length > 0) { lotRows = data; searchTier = tier; break; }
    }
    if (searchTier > 0) log.info('smart-search relaxed filters', { from: 'strict', to: TIER_LABELS[searchTier], query, results: lotRows?.length || 0 });

    // ── Also include persisted unsold lots from expired catalogues (30-day window) ──
    let unsoldExtra = [];
    if (effectiveSold === 'unsold' || effectiveSold === 'all' || sf === 'everything') {
      const unsoldCutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      let unsoldQuery = supabase.from('lots').select(LOTS_SELECT)
        .in('status', ['unsold', 'withdrawn'])
        .gte('auction_date', unsoldCutoff);
      // Apply same hard filters to unsold lots
      if (sqParsed.filters.tenure) unsoldQuery = unsoldQuery.ilike('tenure', sqParsed.filters.tenure);
      if (sqParsed.filters.maxPrice) unsoldQuery = unsoldQuery.lte('price', sqParsed.filters.maxPrice);
      if (sqParsed.filters.minPrice) unsoldQuery = unsoldQuery.gte('price', sqParsed.filters.minPrice);
      for (const loc of sqParsed.locationTerms) unsoldQuery = unsoldQuery.ilike('address', `%${loc}%`);
      if (sqParsed.filters.regionPostcodes) unsoldQuery = unsoldQuery.or(sqParsed.filters.regionPostcodes.map(p => `postcode.ilike.${p}%`).join(','));
      unsoldQuery = applyUiLoc(unsoldQuery);
      // Apply same concept/soft OR clauses
      if (allOrClauses.length > 0) unsoldQuery = unsoldQuery.or(allOrClauses.join(','));
      unsoldQuery = unsoldQuery.order(sortCol, { ascending: false, nullsFirst: false }).limit(200);
      const { data: unsoldRows } = await unsoldQuery;
      unsoldExtra = unsoldRows || [];
    }

    if (lotErr) {
      log.error('smart-search lots query failed', { error: lotErr.message });
      return res.status(500).json({ error: 'db_error', message: 'Database query failed.' });
    }

    // Merge active + persisted unsold, dedup by URL
    const allRows = [...(lotRows || []).map(dbRowToFrontendLot), ...unsoldExtra.map(dbRowToFrontendLot)];
    const dedupMap = new Map();
    for (const lot of allRows) {
      const key = lot.url || `${lot._house}|${(lot.address || '').toLowerCase().replace(/[\s,]+/g, ' ').trim()}`;
      const existing = dedupMap.get(key);
      if (existing) {
        const richness = l => (l.score || 0) * 10 + (l.imageUrl ? 5 : 0) + (l.bullets?.length || 0);
        if (richness(lot) > richness(existing)) dedupMap.set(key, lot);
      } else {
        dedupMap.set(key, lot);
      }
    }
    const filteredLots = [...dedupMap.values()];

    // Build sources summary
    const sourceMap = new Map();
    for (const lot of filteredLots) {
      if (!sourceMap.has(lot._sourceUrl)) sourceMap.set(lot._sourceUrl, { house: lot._house, url: lot._sourceUrl, count: 0 });
      sourceMap.get(lot._sourceUrl).count++;
    }
    const sources = [...sourceMap.values()];

    const totalSearched = filteredLots.length;
    log.info('smart-search layer1', { query, columnFilters: sqParsed.filters, softFilters: sqParsed.softFilters, concepts: sqParsed.concepts, locations: sqParsed.locationTerms, freeText: sqParsed.freeText, results: totalSearched });

    // ═══════════════════════════════════════════════════════════
    // LAYER 2: Send matching lots' search_text to Gemini
    // ═══════════════════════════════════════════════════════════
    // Note: progressive relaxation above almost guarantees filteredLots > 0.
    // If we're STILL at 0 here, the catalogue genuinely has no lots in the
    // requested status — return a clear message but don't pretend to search.
    if (filteredLots.length === 0) {
      await incrementSearchCounter();
      return res.json({ results: [], report: 'No auction lots are available in the current catalogue. The next scrape will run shortly.', sources: [], totalSearched: 0, searchesUsed, searchLimit });
    }

    // Always send to Gemini — Layer 2 is the semantic interpreter, not a ranker.
    // Wider candidate pool (was 200) so the LLM has more lots to reason over
    // when interpreting concept queries like "freehold multi unit block to split".
    const geminiLots = filteredLots.slice(0, 400);
    const lotSummaries = geminiLots.map((l, i) => {
      const meta = [
        l.status && l.status !== 'available' ? `STATUS:${l.status}` : '',
        l.propType ? `Type:${l.propType}` : '',
        l.tenure ? `Tenure:${l.tenure}` : '',
        l.beds ? `${l.beds}bed` : '',
        l.condition ? `Cond:${l.condition}` : '',
        l.estGrossYield ? `Yield:${l.estGrossYield}%` : '',
        l.belowMarket ? `${l.belowMarket}%belowMkt` : '',
        l.vacant ? 'VACANT' : '',
        l.titleSplit ? 'TITLE_SPLIT' : '',
      ].filter(Boolean).join(' ');
      const context = (l._searchText || '').substring(0, 500);
      return `[${i}] ${l._house} L${l.lot}: ${l.address} | £${l.price || '?'} | Score:${l.score || 0} | ${meta} | ${context}`;
    }).join('\n');

    const soldInstruction = sf === 'available' ? '\nIMPORTANT: Showing only available (unsold) lots.' :
      sf === 'sold' ? '\nIMPORTANT: Showing sold/STC/withdrawn lots only.' :
      sf === 'unsold' ? '\nIMPORTANT: Showing unsold (failed at auction) lots only.' : '';

    // Build filter description for Gemini context
    const appliedFilters = [
      ...sqParsed.locationTerms.map(l => `location: ${l}`),
      sqParsed.filters.regionName ? `region: ${sqParsed.filters.regionName}` : '',
      sqParsed.softFilters.title_split ? 'title split potential (soft)' : '',
      sqParsed.softFilters.vacant ? 'vacant (soft)' : '',
      sqParsed.filters.tenure ? `tenure: ${sqParsed.filters.tenure}` : '',
      sqParsed.softFilters.prop_type ? `type: ${sqParsed.softFilters.prop_type} (soft)` : '',
      sqParsed.filters.beds ? `${sqParsed.filters.beds}+ beds` : '',
      sqParsed.filters.maxPrice ? `under £${sqParsed.filters.maxPrice.toLocaleString()}` : '',
      sqParsed.filters.minPrice ? `over £${sqParsed.filters.minPrice.toLocaleString()}` : '',
      (sqParsed.softFilters.condition || sqParsed.filters.condition) ? `condition: ${(sqParsed.softFilters.condition || sqParsed.filters.condition).join('/')}` : '',
      ...sqParsed.freeText.map(t => `keyword: ${t}`),
      ...sqParsed.concepts.map(c => `concept: ${c.replace(/_/g, ' ')}`),
    ].filter(Boolean);
    const filterNote = appliedFilters.length ? `\nDatabase pre-filters applied: ${appliedFilters.join(', ')}` : '';

    // Build concept explanation for Gemini
    const conceptExplanations = {
      multi_unit_freehold: 'The user wants freehold buildings containing multiple flats/units that could be sold individually — look for blocks of flats, multi-unit properties, properties with 2+ units.',
      title_split_potential: 'The user wants properties where individual units could be split onto separate titles — look for multi-unit freehold properties, blocks of flats, houses converted to flats.',
      hmo_conversion: 'The user wants properties suitable for conversion to Houses in Multiple Occupation — look for large houses (4+ beds), existing HMOs, properties with conversion potential.',
      development: 'The user wants development opportunities — look for land, properties with planning permission, sites with development potential.',
      flip: 'The user wants properties to buy, refurbish, and sell quickly — look for below market value properties in poor condition with good locations.',
      buy_to_let: 'The user wants rental investment properties — look for good yields, existing tenancies, properties in rental demand areas.',
      deal_stack: 'The user wants properties with multiple value-add angles — look for title split potential combined with refurbishment needs and below market value.',
    };
    const conceptNote = sqParsed.concepts.length > 0
      ? '\n\nSEARCH CONCEPTS:\n' + sqParsed.concepts.map(c => `- ${conceptExplanations[c] || c}`).join('\n')
      : '';

    // If hard filters narrowed to 0, tell the AI so the report can explain.
    // 3-tier ladder: strict / location-only / wildcard.
    const relaxationNote = searchTier === 0 ? '' :
      searchTier === 1 ? '\nNOTE: No lots matched the user\'s exact constraints (price/beds/tenure/type). The lots below match the user\'s LOCATION + STATUS only — be honest in the report ("no exact matches for your filters") and rank as alternatives.' :
      '\nNOTE: No lots matched the user\'s area at all. Showing top-scored available lots from the wider catalogue — say "no matches in your area" and suggest reviewing these alternatives.';

    const responseText = await callAI(`You are a UK property investment analyst with deep knowledge of property strategies (title-split, HMO conversion, BTL, refurb-and-flip, deal stacking, multi-unit freeholds, GDV uplift, planning gain, lease extension arbitrage, etc.).

USER'S SEARCH QUERY: "${query}"
${soldInstruction}${filterNote}${conceptNote}${relaxationNote}

YOUR JOB IS SEMANTIC INTERPRETATION, NOT KEYWORD MATCHING.
The database has done minimal pre-filtering — only the user's EXPLICIT measurable constraints (status, location, hard price/beds/tenure) have been applied. The candidate pool below intentionally INCLUDES lots that don't literally contain the user's words. YOU are responsible for using your understanding of property investment to find lots that fit the user's INTENT.

Examples of how to interpret intent:
- "freehold multi unit block to title split" → look for tenure=Freehold + descriptions of multiple flats/units (e.g. "investment of 4 self-contained flats", "freehold building with 6 apartments", "5 units producing £X rent"). Do NOT require literal words "title split" or "block".
- "HMO opportunity" → 4+ bed houses, large terraces near universities/hospitals, properties described as "currently let on AST" or "convertible".
- "buy to let in good rental area" → properties with existing tenants, decent yields, addresses in known rental hotspots.
- "needs work for flip" → "in need of modernisation", "scope for improvement", repossessions, vacant possession in below-market areas.
- "development opportunity" → land with planning, properties with planning history, sites with PD potential, anything described as "development potential".

Be generous when the search_text describes the concept in different words. Be skeptical when the search_text doesn't support the user's intent at all.

Lots (top ${geminiLots.length} of ${totalSearched} by investment score; status+location filtered, semantic concepts NOT pre-filtered):
${lotSummaries}

Respond in this exact JSON format (and nothing else):
{"indices":[0,5,12],"report":"Your investment commentary..."}

Pick the indices of lots that genuinely match the user's INTENT — quality over quantity. Aim for 5-30 picks for a typical query; fewer if matches are weak. The report (2-3 paragraphs) should: (1) summarise what was found, (2) call out standout lots with their investment angle, (3) honestly note if the user's exact concept couldn't be matched and what was returned instead.`, { tier: 'fast', maxTokens: 4000, taskType: 'search' });
    log.info('smart_search_full', { tier: 'fast', preFiltered: totalSearched, sentToAI: geminiLots.length, relaxationTier: TIER_LABELS[searchTier] });

    let aiParsed;
    try {
      let cleaned = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      aiParsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(cleaned);
    } catch (e) {
      console.log('Smart search JSON parse failed:', e.message, 'Raw:', responseText.substring(0, 200));
      const reportMatch = responseText.match(/"report"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
      const indicesMatch = responseText.match(/"indices"\s*:\s*\[([\d,\s]*)\]/);
      aiParsed = {
        indices: indicesMatch ? indicesMatch[1].split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n)) : [],
        report: reportMatch ? reportMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : 'Search completed.'
      };
    }

    let matchingLots = (aiParsed.indices || [])
      .filter(i => i >= 0 && i < geminiLots.length)
      .map(i => geminiLots[i]);

    // Fallback: if Gemini returned nothing, return all pre-filtered lots (they already match)
    if (matchingLots.length === 0) {
      matchingLots = geminiLots;
      log.info('smart-search ai-empty-fallback', { returning: matchingLots.length });
      if (!aiParsed.report || aiParsed.report === 'Search completed.') {
        aiParsed.report = `Found ${totalSearched} lot${totalSearched !== 1 ? 's' : ''} matching "${query}". Sorted by investment score.`;
      }
    }

    // Strip _searchText from response (large, not needed by frontend)
    for (const lot of matchingLots) delete lot._searchText;

    await incrementSearchCounter();
    logActivityEvent('smart_search', { query, results_count: matchingLots.length, mode: 'db_plus_ai', preFiltered: totalSearched }, user?.email, getClientIP(req));

    // Cache the result for repeat queries
    const _smResponseData = { results: matchingLots, report: aiParsed.report || '', sources, totalSearched };
    _smartSearchCache.set(_smCacheKey, { result: _smResponseData, timestamp: Date.now() });

    return res.json({
      ..._smResponseData, searchesUsed, searchLimit,
    });
  } catch (err) {
    const msg = err.message || String(err);
    log.error('Smart search error', { error: msg, status: err.status, stack: err.stack?.split('\n').slice(0, 3).join(' | ') });
    if (err.status === 429 || /quota|rate.limit|resource.exhausted/i.test(msg)) {
      setCreditExhausted(true); setCreditExhaustedAt(Date.now());
      return res.status(503).json({ error: 'ai_quota_exhausted', message: 'AI rate limit hit. Auto-resets after 1 hour.', provider: process.env.AI_PROVIDER || 'gemini', tier: 'fast' });
    }
    if (err.status === 401 || err.status === 403 || /invalid.api.key|unauthorized|forbidden/i.test(msg)) {
      return res.status(500).json({ error: 'key_invalid', message: 'AI API key is invalid or expired. Check environment variables in Railway.', provider: process.env.AI_PROVIDER || 'gemini' });
    }
    return res.status(500).json({ error: 'api_error', message: 'Smart search failed.', detail: msg, provider: process.env.AI_PROVIDER || 'gemini', tier: 'fast' });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: ALL LOTS — pre-load every cached lot for frontend filtering
// ═══════════════════════════════════════════════════════════════
// In-memory response cache. The pipeline below takes 3-4s per call against
// Supabase; without this cache, INITIAL_SESSION repeats and cross-tab opens
// caused dozens of redundant runs. Auction data refreshes once nightly via
// autoAnalyseAll at 03:00 UK, so a long TTL is safe — invalidate manually
// after scrape completion via invalidateAllLotsCache() if needed.
const _allLotsCache = new Map(); // key = `${signed|anon}:${past|future}` → { body, etag, ts }
const ALL_LOTS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

export function invalidateAllLotsCache() {
  _allLotsCache.clear();
  log.info('all-lots cache invalidated');
}

// Pure compute: builds the all-lots response payload + ETag for a given
// (isSignedIn, includePast) pair. No HTTP concerns — used by both the route
// handler and warmAllLotsCache(). Returns { body, etag } always; etag is null
// when the response is the trivial-empty shape (no need to cache).
async function buildAllLotsResponse({ isSignedIn, includePast }) {
  const emptyBody = { lots: [], sources: [], stripeEnabled: STRIPE_ENABLED };
  if (!supabase) return { body: emptyBody, etag: null };

  // ── Step 1: Get active catalogue URLs from cached_analyses ──
    let { data: activeCatalogues, error: catErr } = await supabase
      .from('cached_analyses')
      .select('url, house, created_at')
      .gt('expires_at', new Date().toISOString());

    if (catErr) { log.error('all-lots: cached_analyses query failed', { error: catErr.message }); return { body: emptyBody, etag: null }; }

    // Resilience fallback: if cached_analyses got wiped (admin clear-cache,
    // deploy issue, etc) we'd otherwise serve a blank site to all users
    // until the next 03:00 UK auto-analyse repopulates it. Instead, fall
    // back to the lots table directly — serve every lot scraped in the last
    // 14 days, and synthesize active-catalogue rows from their catalogue_url
    // values so the rest of the pipeline (sources array, dedup, scoring) is
    // unchanged. Auto-analyse will repopulate cached_analyses naturally.
    let usedFallback = false;
    let fallbackLotRows = null;
    if (!activeCatalogues || activeCatalogues.length === 0) {
      log.warn('all-lots: cached_analyses empty — using lots-table fallback (last 14d)', { isSignedIn, includePast });
      const fbCutoff = new Date(Date.now() - 14 * 86400000).toISOString();
      const { data: fbRows, error: fbErr } = await supabase
        .from('lots').select(LOTS_SELECT)
        .gte('last_seen_at', fbCutoff)
        .limit(5000);
      if (fbErr || !fbRows || fbRows.length === 0) {
        log.error('all-lots: fallback query failed', { error: fbErr?.message, rows: fbRows?.length || 0 });
        return { body: emptyBody, etag: null };
      }
      fallbackLotRows = fbRows;
      const catMap = new Map();
      for (const r of fbRows) {
        if (r.catalogue_url && !catMap.has(r.catalogue_url)) {
          catMap.set(r.catalogue_url, { url: r.catalogue_url, house: r.house, created_at: r.last_seen_at });
        }
      }
      activeCatalogues = [...catMap.values()];
      usedFallback = true;
    }

    const activeUrls = [...new Set(activeCatalogues.map(c => normaliseUrl(c.url)))];

    // ── Step 2: Run independent queries in parallel ──
    const unsoldCutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const [lotResult, unsoldResult, calendarResult, skillsResult] = await Promise.all([
      // Skip the RPC if we already loaded lot rows in the fallback above
      usedFallback ? Promise.resolve({ data: fallbackLotRows, error: null }) : supabase.rpc('get_active_lots'),
      supabase.from('lots').select(LOTS_SELECT)
        .in('status', ['unsold', 'withdrawn'])
        .gte('auction_date', unsoldCutoff)
        .limit(1000),
      supabase.from('auction_calendar').select('url, date').gte('date', weekAgo),
      supabase.from('house_skills').select('slug, logo_url').not('logo_url', 'is', null),
    ]);

    const { data: lotRows, error: lotErr } = lotResult;
    const { data: unsoldRows } = unsoldResult;

    if (lotErr) {
      log.error('all-lots: get_active_lots RPC failed', { error: lotErr.message });
      return { body: emptyBody, etag: null };
    }

    if (!lotRows || lotRows.length === 0) {
      return { body: emptyBody, etag: null };
    }

    // Merge unsold lots, avoiding duplicates with active catalogue lots
    const activeLotKeys = new Set((lotRows || []).map(r => `${r.house}|${r.url}`));
    const extraUnsold = (unsoldRows || []).filter(r => !activeLotKeys.has(`${r.house}|${r.url}`));

    const allLotRows = [...(lotRows || []), ...extraUnsold];
    const rawTotal = allLotRows.length;
    log.info('all-lots query', { activeCatalogues: activeCatalogues.length, activeLots: (lotRows || []).length, persistedUnsold: extraUnsold.length, rawLotCount: rawTotal });

    // ── Step 3: Map snake_case DB columns → camelCase frontend format ──
    const lots = allLotRows.map(r => ({
      _house: r.house,
      lot: r.lot_number,
      url: r.url,
      _sourceUrl: r.catalogue_url,
      address: r.address,
      postcode: r.postcode,
      price: r.price,
      priceText: r.price_text,
      propType: r.prop_type,
      beds: r.beds,
      tenure: r.tenure,
      leaseLength: r.lease_length,
      sqft: r.sqft,
      condition: r.condition,
      imageUrl: r.image_url,
      bullets: r.bullets || [],
      units: r.units || 0,
      _auctionDate: r.auction_date,
      status: r.status,
      soldPrice: r.sold_price,
      epcRating: r.epc_rating,
      epcScore: r.epc_score,
      epcDate: r.epc_date,
      floodZone: r.flood_zone,
      floodRiskLevel: r.flood_risk,
      streetAvg: r.street_avg,
      streetSales: r.street_sales,
      streetSalesCount: r.street_sales_count,
      belowMarket: r.below_market,
      estMonthlyRent: r.est_monthly_rent,
      estAnnualRent: r.est_annual_rent,
      estGrossYield: r.est_gross_yield != null ? parseFloat(r.est_gross_yield) : null,
      score: r.score != null ? parseFloat(r.score) : null,
      scoreBreakdown: r.score_breakdown || [],
      opps: r.opps || [],
      risks: r.risks || [],
      dealType: r.deal_type,
      vacant: r.vacant,
      titleSplit: r.title_split,
      _lat: r.lat != null ? parseFloat(r.lat) : null,
      _lng: r.lng != null ? parseFloat(r.lng) : null,
      _lastSeenAt: r.last_seen_at || null,
    }));

    // Normalise statuses + extract lease length from bullets (handles edge cases)
    normaliseLotStatuses(lots);

    // Within-house address dedup (URL dedup handled by lots table unique constraint)
    // Group by house for address dedup (same logic as before, just no URL dedup needed)
    const lotsByHouse = new Map();
    for (const lot of lots) {
      const h = lot._house;
      if (!lotsByHouse.has(h)) lotsByHouse.set(h, []);
      lotsByHouse.get(h).push(lot);
    }

    const dedupedAll = [];
    for (const [house, houseLots] of lotsByHouse) {
      const byAddr = new Map();
      for (const lot of houseLots) {
        const normAddr = (lot.address || '').toLowerCase().replace(/[\s,]+/g, ' ').replace(/^(lot\s*\d+\s*[-:]?\s*)/i, '').trim();
        const addrKey = normAddr + '|' + (lot.price || '');
        if (normAddr.length > 5) {
          const existing = byAddr.get(addrKey);
          if (existing) {
            const richness = (l) => (l.imageUrl ? 10 : 0) + (l.bullets?.length || 0);
            if (richness(lot) > richness(existing)) byAddr.set(addrKey, lot);
          } else {
            byAddr.set(addrKey, lot);
          }
        } else {
          byAddr.set(`__short_${byAddr.size}`, lot);
        }
      }
      const deduped = [...byAddr.values()];
      const removed = houseLots.length - deduped.length;
      if (removed > 0) console.log(`Dedup ${house}: ${houseLots.length} → ${deduped.length} (removed ${removed})`);
      dedupedAll.push(...deduped);
    }

    // Build sources array — one entry per catalogue (matches old cached_analyses behavior)
    const sources = [];
    const catalogueUpdatedAt = new Map(activeCatalogues.map(c => [normaliseUrl(c.url), c.created_at]));
    const lotsByCatalogue = new Map();
    for (const lot of dedupedAll) {
      const catUrl = lot._sourceUrl;
      if (!lotsByCatalogue.has(catUrl)) lotsByCatalogue.set(catUrl, { house: lot._house, count: 0 });
      lotsByCatalogue.get(catUrl).count++;
    }
    for (const [catUrl, info] of lotsByCatalogue) {
      sources.push({ house: info.house, url: catUrl, count: info.count, updatedAt: catalogueUpdatedAt.get(catUrl) });
    }

    // Replace lots array content with deduped results
    lots.length = 0;
    lots.push(...dedupedAll);

    // ── Attach _auctionDate from calendar (DB + fallback) ──
    const urlDateMap = {};
    // Use pre-fetched calendar data from parallel query (Step 2)
    const calRows = calendarResult.data;
    if (calRows) for (const a of calRows) {
      const nu = normaliseUrl(a.url);
      if (nu && a.date && (!urlDateMap[nu] || a.date < urlDateMap[nu])) urlDateMap[nu] = a.date;
    }
    // Fallback calendar overlay
    for (const a of FALLBACK_CALENDAR) {
      const nu = normaliseUrl(a.url);
      if (!urlDateMap[nu] || a.date < urlDateMap[nu]) urlDateMap[nu] = a.date;
    }
    for (const lot of lots) {
      // Per-lot end date from bullets (EIG timed auctions) takes priority
      let lotEndDate = null;
      if (lot.bullets && Array.isArray(lot.bullets)) {
        for (const b of lot.bullets) {
          const m = b.match(/Auction\s*Ends?:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
          if (m) { lotEndDate = m[3] + '-' + m[2] + '-' + m[1]; break; }
        }
      }
      if (lotEndDate) {
        lot._auctionDate = lotEndDate;
      } else if (!lot._auctionDate) {
        // Fallback to calendar lookup only if lots table didn't have a date
        const su = normaliseUrl(lot._sourceUrl);
        const rawDate = urlDateMap[su] || null;
        lot._auctionDate = (rawDate && rawDate > '2098-01-01') ? null : rawDate;
      }
    }

    // ── Staleness fallback (Issue 2 fix (c)) ──
    // Lots with no auction_date (source doesn't publish one, no calendar row,
    // no EIG "Auction Ends:" bullet) get stuck rendering as live forever. If
    // we haven't re-seen a lot in 14+ days, synthesise an end-date from its
    // last_seen_at so the "Auction ended" badge fires and the default
    // future-only filter can exclude it. Read-time only — no DB mutation.
    const STALE_GRACE_MS = 14 * 86400000;
    const staleCutoff = Date.now() - STALE_GRACE_MS;
    let staleSynth = 0;
    for (const lot of lots) {
      if (lot._auctionDate || !lot._lastSeenAt) continue;
      const seenMs = Date.parse(lot._lastSeenAt);
      if (!Number.isFinite(seenMs) || seenMs >= staleCutoff) continue;
      lot._auctionDate = new Date(seenMs + STALE_GRACE_MS).toISOString().slice(0, 10);
      lot._auctionDateSource = 'stale_synth';
      staleSynth++;
    }
    if (staleSynth > 0) log.info('all-lots: stale-synth dates', { count: staleSynth, graceDays: 14 });

    // ── Server-side future-only filtering (7-day grace period) ──
    if (!includePast) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const beforeFilter = lots.length;
      const filtered = lots.filter(lot => {
        if (!lot._auctionDate) return true; // Include lots with no date
        return lot._auctionDate >= cutoffStr;
      });
      const pastRemoved = beforeFilter - filtered.length;
      if (pastRemoved > 0) console.log(`Future-only filter: removed ${pastRemoved} past lots (cutoff: ${cutoffStr})`);
      lots.length = 0;
      lots.push(...filtered);
    }

    // ── Phase 3: Cross-auction dedup by normalised address (same house only) ──
    // Only dedup lots listed by the SAME house at different auction dates (e.g., timed vs live)
    // Cross-house duplicates are kept — users want to see the same property from different houses
    const crossAddrMap = new Map();
    for (const lot of lots) {
      const normAddr = (lot.address || '').toLowerCase().replace(/[\s,]+/g, ' ').replace(/^(lot\s*\d+\s*[-:]?\s*)/i, '').trim();
      if (normAddr.length <= 5) continue;
      const houseAddr = `${lot._house}|${normAddr}`;
      const entry = crossAddrMap.get(houseAddr);
      if (entry) {
        entry.count++;
        const entryDate = entry.lot._auctionDate || '9999-12-31';
        const lotDate = lot._auctionDate || '9999-12-31';
        if (lotDate < entryDate) entry.lot = lot;
      } else {
        crossAddrMap.set(houseAddr, { lot, count: 1 });
      }
    }
    const keptLots = new Set();
    const dupAddrs = new Set();
    for (const [key, entry] of crossAddrMap) {
      keptLots.add(entry.lot);
      if (entry.count > 1) dupAddrs.add(key);
    }
    const beforeCross = lots.length;
    const finalLots = lots.filter(l => {
      const normAddr = (l.address || '').toLowerCase().replace(/[\s,]+/g, ' ').replace(/^(lot\s*\d+\s*[-:]?\s*)/i, '').trim();
      if (normAddr.length <= 5) { l._alsoInFutureAuctions = false; return true; }
      const houseAddr = `${l._house}|${normAddr}`;
      if (keptLots.has(l)) { l._alsoInFutureAuctions = dupAddrs.has(houseAddr); return true; }
      return false;
    });
    const crossRemoved = beforeCross - finalLots.length;
    if (crossRemoved > 0) console.log(`Cross-auction dedup: removed ${crossRemoved} duplicate lots (same house, different dates)`);

    // Sanitise junk lots — remove non-property entries (email addresses, field labels, etc.)
    const junkAddr = /^(enquiries|info|sales|contact|admin|hello)@|^£[\d,]+|^Properties?$/i;
    const junkAddr2 = /^(Lot|View|More|See|Click|Browse)\s|^Property Type$/i;
    const beforeJunkLot = finalLots.length;
    const cleanLots = finalLots.filter(l => {
      const addr = (l.address || '').trim();
      if (addr.length < 5) return false;
      if (junkAddr.test(addr) || junkAddr2.test(addr)) return false;
      return true;
    });
    const junkLotRemoved = beforeJunkLot - cleanLots.length;
    if (junkLotRemoved > 0) console.log(`Lot sanitiser: removed ${junkLotRemoved} junk lots (non-property entries)`);

    // Sanitise image URLs — strip junk images (logos, council branding, ad trackers, placeholders)
    const junkImg = /logo|icon|\.svg|favicon|banner|flannels|kirklees|\brdw\b|council\.gov|\.gov\.uk\/|googleads|doubleclick|spacer|pixel|1x1|placeholder|no-image|noimage|spinner|badge|modal\.png|_NYC\.|_LCC\.|_BMDC\.|Unit[ie]*d?_?Utilit|Cardwells|themes\/.*assets\/images\/|download_\(\d+\)\./i;
    let imgStripped = 0;
    for (const lot of cleanLots) {
      if (lot.imageUrl && junkImg.test(lot.imageUrl)) { lot.imageUrl = undefined; imgStripped++; }
    }
    if (imgStripped > 0) console.log(`Image sanitiser: stripped ${imgStripped} junk images`);

    // Validate image URLs — must be https + known extension or CDN domain
    let imgInvalid = 0;
    for (const lot of cleanLots) {
      if (lot.imageUrl && !isValidImageUrl(lot.imageUrl)) { lot.imageUrl = undefined; imgInvalid++; }
    }
    if (imgInvalid > 0) console.log(`Image validator: rejected ${imgInvalid} invalid image URLs`);

    // Ensure every lot has a URL — fallback to catalogue page if no lot-specific link
    for (const lot of cleanLots) {
      if (!lot.url && lot._sourceUrl) lot.url = lot._sourceUrl;
    }

    // ── Diagnostic: pipeline summary ──
    log.info('all-lots pipeline', {
      rawFromDb: rawTotal,
      afterAddressDedup: dedupedAll.length,
      afterCrossAuctionDedup: finalLots.length,
      afterJunkRemoval: cleanLots.length,
      junkRemoved: junkLotRemoved,
      imgStripped
    });

    // ── Post-processing enrichment fixes ──
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const lot of cleanLots) {
      // 1. Auto-reclassify past-auction lots as "unsold" if still "available"
      if (lot._auctionDate && lot._auctionDate < todayStr &&
          (!lot.status || lot.status === 'available')) {
        lot.status = 'unsold';
      }

      // 2. Structural risk flag for ultra-low prices
      if (lot.price && lot.price < 25000 && lot.propType !== 'land' && lot.propType !== 'other') {
        if (!lot.risks) lot.risks = [];
        if (!lot.risks.some(r => /low.*price|significant works/i.test(r))) {
          lot.risks.push('Very low guide — likely significant works required');
        }
      }

      // 3. Infer propType from address/title when "other" or "unknown"
      if (!lot.propType || lot.propType === 'other' || lot.propType === 'unknown') {
        const addr = (lot.address || '').toLowerCase();
        if (/\bflat\b|\bapt\b|\bapartment\b/.test(addr)) lot.propType = 'flat';
        else if (/\bhouse\b|\bcottage\b|\bvilla\b|\blodge\b/.test(addr)) lot.propType = 'house';
        else if (/\bbungalow\b/.test(addr)) lot.propType = 'house';
        else if (/\bland\b|\bplot\b|\bgarage\b|\bparking\b|\bkiosk\b/.test(addr)) lot.propType = 'land';
        else if (/\bshop\b|\boffice\b|\bwarehouse\b|\bindustrial\b|\bhotel\b|\bpub\b/.test(addr)) lot.propType = 'commercial';
      }

      // 4. Mark fallback rent estimates so they're not confused with real data
      if (lot.estAnnualRent && lot.estMonthlyRent) {
        const defaultRent = Math.round(825 * 1.10); // VOA_RENTS._default[2] * RENT_UPLIFT._default
        if (lot.estMonthlyRent === defaultRent && !lot.beds) {
          lot._rentEstimated = true; // Signal to frontend this is a generic estimate
        }
      }

      // 5. Freehold opp tag for residential if not already present
      if (lot.tenure === 'Freehold' && ['house', 'bungalow'].includes(lot.propType)) {
        if (lot.opps && !lot.opps.includes('Freehold')) lot.opps.push('Freehold');
      }

      // 6. Days since auction failed (for unsold lots)
      if (lot.status === 'unsold' && lot._auctionDate) {
        const auctionMs = new Date(lot._auctionDate).getTime();
        if (!isNaN(auctionMs)) {
          lot.daysSinceAuction = Math.floor((Date.now() - auctionMs) / 86400000);
        }
      }
    }

    // 6b. Batch relist verification for unsold lots
    const unsoldLots = cleanLots.filter(l => l.status === 'unsold' && l._auctionDate);
    if (unsoldLots.length > 0) {
      const normAddr = (addr) => (addr || '').toLowerCase().replace(/[\s,]+/g, ' ')
        .replace(/^(lot\s*\d+\s*[-:]?\s*)/i, '').trim();

      const unsoldAddrs = unsoldLots.map(l => ({
        lot: l,
        house: l._house,
        addr: normAddr(l.address),
        date: l._auctionDate
      })).filter(x => x.addr.length > 5);

      if (unsoldAddrs.length > 0) {
        const houses = [...new Set(unsoldAddrs.map(x => x.house))];
        const minDate = unsoldAddrs.reduce((min, x) => x.date < min ? x.date : min, '9999-12-31');
        const { data: newerLots } = await supabase
          .from('lots')
          .select('house, address, auction_date, status, sold_price')
          .in('house', houses)
          .in('status', ['sold', 'stc', 'available'])
          .gte('auction_date', minDate);

        if (newerLots?.length) {
          const newerMap = new Map();
          for (const nl of newerLots) {
            const key = `${nl.house}|${normAddr(nl.address)}`;
            const existing = newerMap.get(key);
            if (!existing || nl.auction_date > existing.auction_date) {
              newerMap.set(key, nl);
            }
          }

          let relistCount = 0;
          for (const { lot, house, addr, date } of unsoldAddrs) {
            const key = `${house}|${addr}`;
            const newer = newerMap.get(key);
            if (newer && newer.auction_date > date) {
              lot._relistStatus = newer.status;
              lot._relistPrice = newer.sold_price || null;
              lot._relistDate = newer.auction_date;
              relistCount++;
            }
          }
          if (relistCount > 0) log.info('relist-verification', { unsold: unsoldLots.length, relisted: relistCount });
        }
      }
    }

    // 7. High-turnover block warning — flag addresses where same building has many sales
    const streetCounts = {};
    for (const lot of cleanLots) {
      if (!lot.streetSalesCount) continue;
      // Group by building/block — use first line of address (e.g. "123 High Street")
      const addr = (lot.address || '').split(',')[0].trim().toLowerCase();
      if (!addr) continue;
      // Extract building name/number pattern
      const buildingMatch = addr.match(/^(.+?)(?:\s+flat\s+\d+|\s+apartment\s+\d+)?$/i);
      const building = buildingMatch ? buildingMatch[1] : addr;
      if (!streetCounts[building]) streetCounts[building] = { count: 0, lots: [] };
      streetCounts[building].count += lot.streetSalesCount;
      streetCounts[building].lots.push(lot);
    }
    for (const [building, data] of Object.entries(streetCounts)) {
      if (data.count > 8) {
        for (const lot of data.lots) {
          if (!lot.risks) lot.risks = [];
          if (!lot.risks.some(r => /high.?turnover/i.test(r))) {
            lot.risks.push(`High-turnover block (${data.count} sales nearby)`);
          }
        }
      }
    }

    // Directory data: free for all, but AI analysis layer requires signup
    // Anonymous users see address/price/image/house but not scores/opps/risks/dealType
    if (!isSignedIn) {
      for (const lot of cleanLots) {
        lot.score = null;
        lot.opps = [];
        lot.risks = [];
        lot.scoreBreakdown = [];
        lot.dealType = null;
        lot.condition = null;
        lot.vacant = null;
        lot.titleSplit = null;
        lot.estGrossYield = null;
        lot.anonGated = true;   // Signal to frontend to show signup prompt
        delete lot.blurred;
      }
    } else {
      for (const lot of cleanLots) { delete lot.blurred; }
    }
    // ── House logos from pre-fetched house_skills (Step 2 parallel query) ──
    const uniqueHouses = new Set(sources.map(s => s.house));
    let houseMeta = {};
    const skills = skillsResult.data;
    if (skills) {
      for (const s of skills) houseMeta[s.slug] = { logoUrl: s.logo_url };
    }

    // ── ETag: skip full response if client already has this data ──
    // IMPORTANT: include the signed-in flag in the hash. Anon responses strip
    // score/dealType/opps/risks while signed-in responses include them, so two
    // states with the same lots produce different payloads. Without this, a
    // signed-in user whose browser cached the anon ETag gets 304 and keeps
    // seeing "Sign up for AI scores" / "Sign up for deal type" stubs.
    const etag = '"' + createHash('md5')
      .update((isSignedIn ? 'signed:' : 'anon:') + cleanLots.length + ':' + cleanLots.map(l => l.url + (l.status || '')).join(','))
      .digest('hex') + '"';

    const body = {
      lots: cleanLots,
      sources,
      houseMeta,
      houseCount: uniqueHouses.size,
      blurred: false,
      anonGated: !isSignedIn,
      stripeEnabled: STRIPE_ENABLED,
      _debug: {
        activeCatalogues: activeCatalogues.length,
        rawLotCount: rawTotal,
        afterAddressDedup: lots.length,
        afterCrossAuctionDedup: finalLots.length,
        afterJunkRemoval: cleanLots.length,
        source: 'lots_table'
      }
    };

    return { body, etag };
}

// Pre-warm the cache for both visitor variants. Called from server.js on boot
// and on a periodic interval to keep the cache continuously hot — first
// visitor never pays the ~3-4s pipeline cost.
export async function warmAllLotsCache() {
  for (const includePast of [false]) {
    for (const isSignedIn of [false, true]) {
      try {
        const started = Date.now();
        const { body, etag } = await buildAllLotsResponse({ isSignedIn, includePast });
        if (etag) {
          const key = (isSignedIn ? 'signed' : 'anon') + ':' + (includePast ? 'past' : 'future');
          _allLotsCache.set(key, { body, etag, ts: Date.now() });
          log.info('all-lots cache warmed', { key, ms: Date.now() - started, lots: body.lots?.length || 0 });
        }
      } catch (e) {
        log.warn('all-lots cache warm failed', { isSignedIn, err: e.message });
      }
    }
  }
}

router.get('/api/all-lots', rateLimit(60000, 30), async (req, res) => {
  try {
    const includePast = req.query.includePast === 'true';
    const user = await validateUserFromReq(req);
    const adminToken = req.headers['x-admin-secret'] || '';
    const isAdmin = process.env.ADMIN_SECRET && safeCompare(adminToken, process.env.ADMIN_SECRET);
    const isSignedIn = !!user || isAdmin;

    const cacheKey = (isSignedIn ? 'signed' : 'anon') + ':' + (includePast ? 'past' : 'future');
    const hit = _allLotsCache.get(cacheKey);
    if (hit && (Date.now() - hit.ts) < ALL_LOTS_CACHE_TTL_MS) {
      if (req.headers['if-none-match'] === hit.etag) return res.status(304).end();
      res.set('ETag', hit.etag);
      return res.json(hit.body);
    }

    const { body, etag } = await buildAllLotsResponse({ isSignedIn, includePast });
    if (etag) _allLotsCache.set(cacheKey, { body, etag, ts: Date.now() });

    if (etag && req.headers['if-none-match'] === etag) return res.status(304).end();
    if (etag) res.set('ETag', etag);
    res.json(body);
  } catch (e) {
    log.error('All lots error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
