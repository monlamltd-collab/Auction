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
