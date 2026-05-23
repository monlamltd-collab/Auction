// ═══════════════════════════════════════════════════════════════
// LAND REGISTRY — CORPORATE / OVERSEAS OWNERSHIP QUERIES
// ═══════════════════════════════════════════════════════════════
// Reads from the bulk-loaded `hmlr_corporate_owners` Supabase table
// (refreshed monthly by scripts/refresh-hmlr-companies.mjs). Combines
// CCOD (UK companies) and OCOD (overseas companies) — distinguish via
// the `dataset` column.
//
// Auction-brain use case: given a lot's postcode, find any titles at
// that postcode owned by a corporate or overseas entity. Often a
// probate / corporate-disposal / distressed-sale signal.

let supabase = null;

export function initCompanies({ supabase: sb } = {}) {
  if (sb) supabase = sb;
}

/**
 * Find corporate / overseas-owned titles at a given postcode.
 *
 * @param {string} postcode — UK postcode (with or without space)
 * @returns {Promise<{ status: string, ccod: object[], ocod: object[], total: number }>}
 *   status: 'ok' | 'no_match' | 'no_postcode' | 'db_error'
 */
export async function queryOwnersByPostcode(postcode) {
  if (!supabase) return { status: 'db_error', error: 'supabase not initialised', ccod: [], ocod: [], total: 0 };
  if (!postcode) return { status: 'no_postcode', ccod: [], ocod: [], total: 0 };

  const normalised = postcode.replace(/\s+/g, ' ').trim().toUpperCase();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/.test(normalised)) {
    return { status: 'no_postcode', ccod: [], ocod: [], total: 0 };
  }

  const { data, error } = await supabase
    .from('hmlr_corporate_owners')
    .select('title_number, dataset, property_address, postcode, tenure, price_paid, date_proprietor_added, proprietors')
    .eq('postcode', normalised)
    .limit(50);

  if (error) {
    return { status: 'db_error', error: error.message, ccod: [], ocod: [], total: 0 };
  }
  if (!data || data.length === 0) {
    return { status: 'no_match', ccod: [], ocod: [], total: 0 };
  }

  const ccod = data.filter(r => r.dataset === 'ccod');
  const ocod = data.filter(r => r.dataset === 'ocod');

  return { status: 'ok', ccod, ocod, total: data.length };
}

/**
 * Summarised "is this lot interesting from a corporate-ownership angle?"
 * Returns flags suitable for use as auction-brain scoring signals.
 *
 * @param {string} postcode
 * @returns {Promise<{ status: string, hasUkCorporate: boolean, hasOverseas: boolean, countryCounts: Record<string, number>, sample: object[] }>}
 */
export async function summariseOwnersByPostcode(postcode) {
  const r = await queryOwnersByPostcode(postcode);
  if (r.status !== 'ok') {
    return { status: r.status, hasUkCorporate: false, hasOverseas: false, countryCounts: {}, sample: [] };
  }

  const countryCounts = {};
  for (const row of r.ocod) {
    const props = Array.isArray(row.proprietors) ? row.proprietors : [];
    for (const p of props) {
      const c = (p && p.country) ? p.country.trim() : null;
      if (c) countryCounts[c] = (countryCounts[c] || 0) + 1;
    }
  }

  return {
    status: 'ok',
    hasUkCorporate: r.ccod.length > 0,
    hasOverseas: r.ocod.length > 0,
    countryCounts,
    sample: [...r.ccod.slice(0, 3), ...r.ocod.slice(0, 3)],
  };
}

// ═══════════════════════════════════════════════════════════════
// TITLE-REGISTER ADDRESS MATCHING (LR title surfacing)
// ═══════════════════════════════════════════════════════════════
// The full HMLR title register is a paid, per-title product. But the
// free CCOD/OCOD bulk data already carries a title_number + registered
// proprietor for every corporately- or overseas-owned title. These pure
// functions match a lot's address to one of those rows so the pipeline
// can surface the title number + owner for that subset of lots.
//
// Conservative by design: a wrong title stamped on a lot is worse than
// no title, so anything ambiguous is rejected.

function _titleNormAddr(s) {
  return String(s || '').toUpperCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Leading house number — "12", "12A". Null for "Flat 2, ...", "Land at ...".
function _leadingHouseNumber(normAddr) {
  const m = normAddr.match(/^(\d+[A-Z]?)\b/);
  return m ? m[1] : null;
}

// First street word (3+ letters) after the house number. Within a single
// postcode, house-number + first-street-word is a near-unique key.
function _streetWord(normAddr, houseNumber) {
  const toks = normAddr.split(' ');
  const start = toks[0] === houseNumber ? 1 : 0;
  for (let i = start; i < toks.length; i++) {
    if (/^[A-Z]{3,}$/.test(toks[i])) return toks[i];
  }
  return null;
}

/**
 * Join the proprietor name(s) of a corporate-owner row into one string.
 * @param {object} row — an hmlr_corporate_owners row
 * @returns {string|null}
 */
export function extractRegisteredOwner(row) {
  const props = Array.isArray(row && row.proprietors) ? row.proprietors : [];
  const names = props
    .map(p => (p && p.name ? String(p.name).trim() : ''))
    .filter(Boolean);
  return names.length ? names.join(' & ') : null;
}

/**
 * Match a lot's address to a single corporate/overseas-owned title.
 * ownerRows must already be scoped to the lot's postcode (the caller
 * passes the queryOwnersByPostcode result for that postcode).
 *
 * @param {string} lotAddress
 * @param {object[]} ownerRows — hmlr_corporate_owners rows
 * @returns {{ matched: boolean, row?: object, registeredOwner?: string|null, reason?: string }}
 */
export function matchTitleByAddress(lotAddress, ownerRows) {
  const rows = Array.isArray(ownerRows) ? ownerRows : [];
  if (rows.length === 0) return { matched: false, reason: 'no_owner_rows' };

  const normLot = _titleNormAddr(lotAddress);
  if (!normLot) return { matched: false, reason: 'no_address' };

  const houseNo = _leadingHouseNumber(normLot);
  if (!houseNo) return { matched: false, reason: 'no_house_number' };

  const streetWord = _streetWord(normLot, houseNo);
  if (!streetWord) return { matched: false, reason: 'no_street_word' };

  const hits = [];
  for (const row of rows) {
    const toks = _titleNormAddr(row && row.property_address).split(' ');
    if (toks.includes(houseNo) && toks.includes(streetWord)) hits.push(row);
  }

  if (hits.length === 0) return { matched: false, reason: 'no_match' };
  if (hits.length > 1) return { matched: false, reason: 'ambiguous' };

  return { matched: true, row: hits[0], registeredOwner: extractRegisteredOwner(hits[0]) };
}
