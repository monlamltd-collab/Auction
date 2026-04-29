// lib/pipeline/scoring.js — Investment scoring engine for auction lots

import { createManifest, recordYieldScoring } from '../enrichment-manifest.js';

const W2N = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };

/**
 * Analyse a raw lot and compute investment score, property type, tenure,
 * condition, deal type, title split detection, and risk/opportunity signals.
 * Pure function — no external dependencies.
 *
 * @param {object} raw - Raw lot with address, bullets, price, beds, tenure fields
 * @returns {object} Enriched lot with score, opps, risks, dealType, propType, etc.
 */
function analyseLot(raw) {
  // Strip Strettons date prefix (e.g. "19 Feb 26  -  Lot 25Flat 6 Noble House...")
  let cleanAddress = raw.address;
  cleanAddress = cleanAddress.replace(/^\d{1,2}\s+\w{3}\s+\d{2}\s*-\s*(?:Lot\s*\d+)?/i, '').trim();
  const t = (raw.bullets.join(' ') + ' ' + cleanAddress).toLowerCase();
  const L = { ...raw, score: 0, opps: [], risks: [], dealType: 'Standard', propType: '', beds: null,
    tenure: '', condition: '', vacant: null, sqft: null, titleSplit: false, units: 0,
    _enrichment: raw._enrichment || createManifest() };

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
  // Cap captured digit-count at 2 digits (1-99). The unbounded `\d+` form
  // matched 4-digit years preceding "apartment" — e.g. text like
  // "Auction: 13/05/2026 Apartment 5" → uc=2026, which then tripped the
  // titleSplit branch and stamped a "Title split (2026 units)" badge on
  // 7 Venmore/TCPA lots. (Bug surfaced 2026-04-30.)
  const um = t.match(/(\d{1,2})\s*(?:x\s*)?(?:self[- ]contained\s+)?(?:flats?|apartments?|units?)\b/);
  if (um) uc = Math.max(uc, +um[1]);
  const bk = t.match(/block\s+of\s+(\d{1,2})\b/); if (bk) uc = Math.max(uc, +bk[1]);
  const mx = [...t.matchAll(/(\d{1,2})\s*x\s*(?:one|two|three|1|2|3)\s*[-\s]?bed/g)];
  if (mx.length) uc = Math.max(uc, mx.reduce((s, m) => s + +m[1], 0));
  const fr = cleanAddress.toLowerCase().match(/flats?\s*([a-z])\s*[-–&]\s*([a-z])/);
  if (fr) uc = Math.max(uc, fr[2].charCodeAt(0) - fr[1].charCodeAt(0) + 1);
  const ar = cleanAddress.match(/^(\d+)\s*[-–]\s*(\d+)\s/);
  if (ar) { const d = +ar[2] - +ar[1] + 1; if (d >= 2 && d <= 20) uc = Math.max(uc, d); }
  if (/gff|fff|sff|tff/.test(cleanAddress.toLowerCase())) uc = Math.max(uc, 2);
  const apt = t.match(/(\d{1,2})\s*(?:self[- ]contained\s+)?apartments\b/); if (apt) uc = Math.max(uc, +apt[1]);
  // Defensive cap — anything implausibly large is almost certainly a parser
  // mistake (planning-permission counts e.g. "120 apartment scheme" don't
  // belong here either; that's development potential, not a multi-unit lot).
  if (uc > 99) uc = 0;
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
    const signal = `${gy.toFixed(1)}% GIY`;
    if (gy > 8) { s += 2.5; sb.push({ signal, pts: 2.5 }); L.opps.push(signal); recordYieldScoring(L._enrichment, { scoredBy: 'scoring', signal }); }
    else if (gy > 6) { s += 1.5; sb.push({ signal, pts: 1.5 }); L.opps.push(signal); recordYieldScoring(L._enrichment, { scoredBy: 'scoring', signal }); }
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

export { analyseLot, W2N };
