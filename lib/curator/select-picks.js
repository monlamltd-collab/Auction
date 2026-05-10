// ═══════════════════════════════════════════════════════════════
// CURATOR — selectPicks()
// ═══════════════════════════════════════════════════════════════
// Pure selection algorithm: given a candidate set of recent lots and the
// last N days of prior picks, return up to TOP_N picks for today applying
// quality + diversity constraints.
//
// Selection contract (intentionally strict — first 14 days will be small):
//   1. score >= MIN_SCORE (default 7.0)
//   2. has imageUrl (no point sharing without a hero image)
//   3. has fundability data (price > 0 → BridgeMatch returned ≥1 lender)
//   4. auction date >= MIN_LEAD_DAYS away (so the post has shelf life)
//   5. status === 'available' (skip sold/withdrawn/extraction_failure)
//   6. NOT picked in last DEDUP_DAYS days (rotates inventory)
//   7. Diversity caps: max MAX_PER_HOUSE per auction house, max
//      MAX_PER_PROP_TYPE per property type, max MAX_PER_REGION per region
//
// If fewer than TOP_N qualify, return what's available — never relax the
// score floor below MIN_SCORE. A thin day is acceptable; a poor-quality
// day is not.

const TOP_N             = 8;
const MIN_SCORE         = 7.0;
const MIN_LEAD_DAYS     = 7;
const DEDUP_DAYS        = 14;
const MAX_PER_HOUSE     = 2;
const MAX_PER_PROP_TYPE = 3;
const MAX_PER_REGION    = 2;

/**
 * Pick today's curator lots from a candidate pool.
 *
 * @param {object[]} candidates - Frontend-shape lots (dbRowToFrontendLot output) with
 *                                _house, score, status, imageUrl, fundability, _auctionDate, propType, postcode/address
 * @param {object[]} recentPicks - Prior curator_picks rows from the last DEDUP_DAYS days
 *                                 (only `lot_id` is read)
 * @param {object} [opts] - Optional overrides
 * @param {number} [opts.topN]
 * @param {number} [opts.minScore]
 * @param {Date} [opts.now] - Test override
 * @returns {object[]} Selected lots, ranked best-first
 */
export function selectPicks(candidates, recentPicks = [], opts = {}) {
  const topN = opts.topN ?? TOP_N;
  const minScore = opts.minScore ?? MIN_SCORE;
  const now = opts.now ? new Date(opts.now) : new Date();
  const minAuctionMs = now.getTime() + MIN_LEAD_DAYS * 86400000;

  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const recentLotIds = new Set((recentPicks || []).map(p => p.lot_id));

  // ── Filter pass ──
  const eligible = candidates.filter(lot => {
    if (!lot || !lot._dbId) return false;
    if (recentLotIds.has(lot._dbId)) return false;
    if (typeof lot.score !== 'number' || lot.score < minScore) return false;
    if (!lot.imageUrl) return false;
    if (lot.status && lot.status !== 'available') return false;
    if (!lot.fundability || !(lot.fundability.lenderCount > 0)) return false;
    // Auction date must be >= MIN_LEAD_DAYS away. _auctionDate may be a
    // YYYY-MM-DD string or null; null = unknown → reject (no shelf life).
    if (!lot._auctionDate) return false;
    const auctionMs = new Date(lot._auctionDate + 'T00:00:00Z').getTime();
    if (!Number.isFinite(auctionMs) || auctionMs < minAuctionMs) return false;
    return true;
  });

  // Sort best-first — score DESC, then lower fundability LTV (sharper deal),
  // then more recent _lastSeenAt
  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const la = a.fundability?.ltv ?? 999;
    const lb = b.fundability?.ltv ?? 999;
    if (la !== lb) return la - lb;
    const ta = a._lastSeenAt ? new Date(a._lastSeenAt).getTime() : 0;
    const tb = b._lastSeenAt ? new Date(b._lastSeenAt).getTime() : 0;
    return tb - ta;
  });

  // ── Diversity pass ──
  const picks = [];
  const houseCount = new Map();
  const typeCount = new Map();
  const regionCount = new Map();

  for (const lot of eligible) {
    if (picks.length >= topN) break;
    const house = lot._house || 'unknown';
    const propType = lot.propType || 'other';
    const region = inferRegion(lot);

    if ((houseCount.get(house) || 0) >= MAX_PER_HOUSE) continue;
    if ((typeCount.get(propType) || 0) >= MAX_PER_PROP_TYPE) continue;
    if ((regionCount.get(region) || 0) >= MAX_PER_REGION) continue;

    picks.push(lot);
    houseCount.set(house, (houseCount.get(house) || 0) + 1);
    typeCount.set(propType, (typeCount.get(propType) || 0) + 1);
    regionCount.set(region, (regionCount.get(region) || 0) + 1);
  }

  return picks;
}

// ── Region inference from postcode area letters or address text ──
// Cheap heuristic — doesn't need to be exact, just enough to prevent
// "all 8 picks are London / South East" days. Falls back to 'unknown' when
// neither postcode nor a known city pattern matches.
const REGION_BY_POSTCODE_AREA = {
  // London
  E:'london', EC:'london', N:'london', NW:'london', SE:'london', SW:'london', W:'london', WC:'london', BR:'london', CR:'london', DA:'london', EN:'london', HA:'london', IG:'london', KT:'london', RM:'london', SM:'london', TN:'london', TW:'london', UB:'london', WD:'london',
  // South East
  GU:'south_east', ME:'south_east', OX:'south_east', PO:'south_east', RG:'south_east', RH:'south_east', SL:'south_east', SO:'south_east',
  // South West
  BA:'south_west', BH:'south_west', BS:'south_west', DT:'south_west', EX:'south_west', GL:'south_west', PL:'south_west', SN:'south_west', SP:'south_west', TA:'south_west', TQ:'south_west', TR:'south_west',
  // West Midlands
  B:'west_midlands', CV:'west_midlands', DY:'west_midlands', HR:'west_midlands', ST:'west_midlands', TF:'west_midlands', WR:'west_midlands', WS:'west_midlands', WV:'west_midlands',
  // East Midlands
  DE:'east_midlands', LE:'east_midlands', LN:'east_midlands', NG:'east_midlands', NN:'east_midlands',
  // East
  AL:'east', CB:'east', CM:'east', CO:'east', IP:'east', LU:'east', MK:'east', NR:'east', PE:'east', SG:'east', SS:'east',
  // Yorkshire & Humber
  BD:'yorkshire', DN:'yorkshire', HD:'yorkshire', HG:'yorkshire', HU:'yorkshire', HX:'yorkshire', LS:'yorkshire', S:'yorkshire', WF:'yorkshire', YO:'yorkshire',
  // North West
  BB:'north_west', BL:'north_west', CA:'north_west', CH:'north_west', CW:'north_west', FY:'north_west', L:'north_west', LA:'north_west', M:'north_west', OL:'north_west', PR:'north_west', SK:'north_west', WA:'north_west', WN:'north_west',
  // North East
  DH:'north_east', DL:'north_east', NE:'north_east', SR:'north_east', TS:'north_east',
  // Wales
  CF:'wales', LD:'wales', LL:'wales', NP:'wales', SA:'wales', SY:'wales',
  // Scotland
  AB:'scotland', DD:'scotland', DG:'scotland', EH:'scotland', FK:'scotland', G:'scotland', HS:'scotland', IV:'scotland', KA:'scotland', KW:'scotland', KY:'scotland', ML:'scotland', PA:'scotland', PH:'scotland', TD_S:'scotland', ZE:'scotland',
  // Northern Ireland
  BT:'northern_ireland',
};

function inferRegion(lot) {
  const pc = (lot.postcode || '').trim().toUpperCase();
  if (pc) {
    // Outward postcode = letters at the start
    const m = pc.match(/^([A-Z]{1,2})/);
    if (m) {
      const area = m[1];
      const region = REGION_BY_POSTCODE_AREA[area];
      if (region) return region;
    }
  }
  // Fallback — try address text for major city tokens
  const addr = (lot.address || '').toLowerCase();
  if (/\blondon\b/.test(addr)) return 'london';
  if (/\bmanchester\b|\bliverpool\b|\bbolton\b|\bpreston\b/.test(addr)) return 'north_west';
  if (/\bbirmingham\b|\bcoventry\b|\bwolverhampton\b/.test(addr)) return 'west_midlands';
  if (/\bleeds\b|\bsheffield\b|\bbradford\b/.test(addr)) return 'yorkshire';
  if (/\bbristol\b|\bbath\b|\bplymouth\b/.test(addr)) return 'south_west';
  if (/\bnewcastle\b|\bsunderland\b/.test(addr)) return 'north_east';
  if (/\bcardiff\b|\bswansea\b|\bnewport\b/.test(addr)) return 'wales';
  if (/\bedinburgh\b|\bglasgow\b|\baberdeen\b/.test(addr)) return 'scotland';
  return 'unknown';
}

// Test-only export
export const _internal = { inferRegion, TOP_N, MIN_SCORE, MIN_LEAD_DAYS, DEDUP_DAYS, MAX_PER_HOUSE, MAX_PER_PROP_TYPE, MAX_PER_REGION };
