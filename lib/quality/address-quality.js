// lib/quality/address-quality.js
// Shared gate for lot addresses that must never become browse cards.
//
// Two failure modes this kills:
//   1) City / region / portfolio SHELLS — "Bristol", "Teesside", "The Ace Portfolio"
//      (Allsop CP/RP/CI marketing titles with no street identity).
//   2) Town–county LABELS with no street — "Dover - Kent", "Blackpool",
//      "Portsmouth" (Clive Emson incomplete scrape; Bond Wolfe placeholders).
//
// Legitimate land / farm / named-house lots (no house number) stay allowed when
// they carry a street-type token OR a UK postcode OR a named-building cue.

const UK_POSTCODE_RE =
  /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

// Street / thoroughfare tokens that make a line look like a postal address.
const STREET_TOKEN_RE =
  /\b(road|rd|street|st|lane|ln|avenue|ave|close|drive|dr|way|court|crt|ct|place|pl|terrace|ter|crescent|cres|gardens|gdns|grove|grv|hill|park|mews|square|sq|row|walk|parade|rise|end|view|green|common|yard|wharf|quay|villas?|cottages?|flats?|apartments?|house|farm|estate|meadow|croft|gate|broadway|circus|embankment|promenade|causeway|alley|passage|wynd|brae)\b/i;

// Named-building / plot cues that can stand without a classic street word.
const NAMED_SITE_RE =
  /\b(plot|land|site|unit|warehouse|office|shop|hotel|pub|inn|manor|lodge|hall|chapel|church|school|works|mill|barn|stables?|garage|yard|depot|factory|centre|center|building|block|tower|house)\b/i;

// Explicit non-property shells.
const PLACEHOLDER_RE =
  /^(properties?\s+coming\s+soon|coming\s+soon|t\.?\s*b\.?\s*a\.?|to\s+be\s+advised|various\s+locations?|multiple\s+locations?|see\s+catalogue|full\s+details|lot\s*\d+|view\s+lot|more\s+details)$/i;

const PORTFOLIO_TITLE_RE =
  /\b(portfolio|investment\s+portfolio|property\s+portfolio|hmo\s+portfolio|residential\s+portfolio|commercial\s+portfolio|ace\s+portfolio)\b/i;

// Single-token UK city / region shells commonly used as Allsop marketing titles.
// Keep conservative — only tokens that are NEVER a complete postal address alone.
const CITY_REGION_SHELL_RE =
  /^(bristol|teesside|manchester|birmingham|liverpool|leeds|london|glasgow|edinburgh|cardiff|belfast|newcastle|sheffield|nottingham|leicester|coventry|southampton|portsmouth|brighton|oxford|cambridge|reading|bath|york|exeter|plymouth|norwich|ipswich|blackpool|sunderland|middlesbrough|wolverhampton|derby|preston|bolton|wigan|warrington|stockport|oldham|rochdale|huddersfield|halifax|bradford|wakefield|doncaster|rotherham|barnsley|chester|crewe|stoke|stafford|worcester|gloucester|cheltenham|swindon|slough|luton|watford|croydon|bromley|kingston|richmond|harrow|enfield|barnet|ealing|brent|hackney|islington|camden|southwark|lambeth|lewisham|greenwich|bexley|havering|redbridge|waltham|newham|tower\s+hamlets|westminster|kensington|chelsea|hammersmith|fulham|wandsworth|merton|sutton|kingston\s+upon\s+thames|twickenham|uxbridge|heathrow|gatwick|stansted|essex|kent|surrey|sussex|hampshire|dorset|devon|cornwall|somerset|wiltshire|gloucestershire|oxfordshire|berkshire|buckinghamshire|hertfordshire|bedfordshire|cambridgeshire|norfolk|suffolk|lincolnshire|nottinghamshire|derbyshire|staffordshire|warwickshire|worcestershire|shropshire|cheshire|lancashire|yorkshire|cumbria|northumberland|durham|tyne\s+and\s+wear|merseyside|greater\s+manchester|west\s+midlands|east\s+midlands|south\s+west|south\s+east|north\s+west|north\s+east|wales|scotland|northern\s+ireland|midlands|home\s+counties)$/i;

// "Town - County" / "Town, County" with no street number and no street token.
const TOWN_COUNTY_ONLY_RE =
  /^[A-Za-z][A-Za-z'’.\s-]{1,40}(?:\s*[-–,]\s*|\s+)(?:kent|hampshire|sussex|surrey|essex|devon|cornwall|somerset|dorset|wiltshire|gloucestershire|oxfordshire|berkshire|buckinghamshire|hertfordshire|bedfordshire|cambridgeshire|norfolk|suffolk|lincolnshire|nottinghamshire|derbyshire|staffordshire|warwickshire|worcestershire|shropshire|cheshire|lancashire|yorkshire|cumbria|northumberland|durham|merseyside|west\s+midlands|east\s+sussex|west\s+sussex|north\s+yorkshire|south\s+yorkshire|west\s+yorkshire|east\s+yorkshire|isle\s+of\s+wight|greater\s+manchester|tyne\s+and\s+wear|avon|gwent|powys|dyfed|clwyd|gwynedd|mid\s+glamorgan|south\s+glamorgan|west\s+glamorgan|strathclyde|lothian|grampian|tayside|fife|borders|central|highland|dumfries(?:shire)?|galloway|argyll|bute|ayrshire|lanarkshire|renfrewshire|dunbartonshire|stirlingshire|perthshire|angus|aberdeenshire|moray|inverness(?:shire)?|ross(?:shire)?|cromarty|sutherland|caithness|orkney|shetland|western\s+isles|carmarthenshire|ceredigion|pembrokeshire|monmouthshire|flintshire|denbighshire|conwy|anglesey|wrexham|newport|cardiff|swansea|bridgend|neath|port\s+talbot|rhondda|cynon|taff|merthyr|caerphilly|blaenau|gwent|torfaen|monmouth|vale\s+of\s+glamorgan|county\s+durham|area)$/i;

function normAddress(raw) {
  return String(raw || '')
    .replace(/\\+/g, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPostcode(text) {
  const m = String(text || '').toUpperCase().match(UK_POSTCODE_RE);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/**
 * True when a string looks like a usable UK postal address line (not a shell).
 * @param {string|null|undefined} address
 * @param {{ postcode?: string|null, url?: string|null, reference?: string|null }} [opts]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function assessLotAddress(address, opts = {}) {
  const addr = normAddress(address);
  if (!addr || addr.length < 5) {
    return { ok: false, reason: 'missing_or_too_short' };
  }

  // Legacy junk patterns (also used by all-lots sanitiser).
  if (/^(enquiries|info|sales|contact|admin|hello)@/i.test(addr)) {
    return { ok: false, reason: 'email_address' };
  }
  if (/^£[\d,]+/i.test(addr) || /^Properties?$/i.test(addr)) {
    return { ok: false, reason: 'price_or_label' };
  }
  if (/^(Lot\s*\d+|View|More|See|Click|Browse)\s/i.test(addr) || /^Property Type$/i.test(addr)) {
    return { ok: false, reason: 'ui_chrome_label' };
  }
  if (PLACEHOLDER_RE.test(addr)) {
    return { ok: false, reason: 'placeholder' };
  }

  const postcode = extractPostcode(opts.postcode) || extractPostcode(addr);
  const hasDigit = /\d/.test(addr);
  const hasStreet = STREET_TOKEN_RE.test(addr);
  const hasNamedSite = NAMED_SITE_RE.test(addr);
  const isPortfolioTitle = PORTFOLIO_TITLE_RE.test(addr);

  // Portfolio marketing titles without a street identity are never browse lots.
  // Digits in "LS6 HMO Portfolio" / guide fragments must not rescue them.
  if (isPortfolioTitle && !hasStreet) {
    return { ok: false, reason: 'portfolio_title_shell' };
  }

  // "Bristol" / "Teesside" alone — even if a postcode was supplied separately,
  // a single city/region token is not a postal address line.
  if (CITY_REGION_SHELL_RE.test(addr)) {
    return { ok: false, reason: 'city_region_shell' };
  }

  // Single token, no digit, no postcode — almost never a real lot card.
  const tokens = addr.split(/[\s,/-]+/).filter(Boolean);
  if (tokens.length === 1 && !hasDigit && !postcode) {
    return { ok: false, reason: 'single_token_shell' };
  }

  // "Dover - Kent", "Maidstone - Kent", "Canterbury Area - Kent Area"
  if (!postcode && !hasDigit && !hasStreet && TOWN_COUNTY_ONLY_RE.test(addr)) {
    return { ok: false, reason: 'town_county_label' };
  }

  // Short locality with no street cue and no postcode (e.g. "Heathfield Area").
  if (
    !postcode
    && !hasDigit
    && !hasStreet
    && !hasNamedSite
    && addr.length <= 40
    && tokens.length <= 4
    && !/,.*,/.test(addr) // three+ comma parts often "building, town, county"
  ) {
    // Allow "Something Farm" / "Unit X" via NAMED_SITE; otherwise reject.
    return { ok: false, reason: 'locality_only_no_street' };
  }

  // Synthetic rows with no street identity (placeholders / incomplete scrapes).
  if (/__synthetic__/i.test(String(opts.url || '')) && !hasStreet && !hasDigit && !postcode) {
    return { ok: false, reason: 'synthetic_thin_address' };
  }

  return { ok: true, postcode: postcode || null };
}

/** @returns {boolean} */
export function isBrowseableLotAddress(address, opts = {}) {
  return assessLotAddress(address, opts).ok;
}

/**
 * Filter a lot array, dropping non-browseable addresses.
 * @param {Array<object>} lots
 * @param {{ addressKey?: string, postcodeKey?: string, urlKey?: string }} [opts]
 * @returns {{ kept: object[], dropped: Array<{lot:object, reason:string}> }}
 */
export function filterBrowseableLots(lots, opts = {}) {
  const addressKey = opts.addressKey || 'address';
  const postcodeKey = opts.postcodeKey || 'postcode';
  const urlKey = opts.urlKey || 'url';
  const kept = [];
  const dropped = [];
  for (const lot of lots || []) {
    if (!lot) continue;
    const verdict = assessLotAddress(lot[addressKey], {
      postcode: lot[postcodeKey] ?? lot.post_code ?? null,
      url: lot[urlKey] ?? null,
      reference: lot.reference || lot.lot_number || null,
    });
    if (verdict.ok) kept.push(lot);
    else dropped.push({ lot, reason: verdict.reason });
  }
  return { kept, dropped };
}

export const ADDRESS_QUALITY = {
  UK_POSTCODE_RE,
  STREET_TOKEN_RE,
  PORTFOLIO_TITLE_RE,
  CITY_REGION_SHELL_RE,
};
