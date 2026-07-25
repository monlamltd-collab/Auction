// lib/pipeline/calendar-entries.js
// Safe shared helpers for next-sale calendar rows (Task 3).
//
// Rules:
// - Never retire/delete always_on rows.
// - Never stamp sentinel 2099 onto upcoming writers from this module.
// - Prefer requiring a real YYYY-MM-DD auction date for new upcoming rows.
// - Retire past dated upcoming rows by status='past' (not delete).
// - Support dryRun for soak/observe.

async function invalidateCalendarCacheSoft() {
  try {
    const mod = await import('./persist-lots.js');
    if (typeof mod._invalidateCalendarCache === 'function') mod._invalidateCalendarCache();
  } catch {
    /* optional in unit tests / environments without Supabase env */
  }
}

const REAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SENTINEL_CUTOFF = '2098-01-01'; // matches sale-format / persist ideology

/**
 * True when date string is a real traditional calendar date (not 2099 marker).
 * @param {string|null|undefined} date
 */
export function isRealCalendarDate(date) {
  if (!date) return false;
  const d = String(date).slice(0, 10);
  if (!REAL_DATE_RE.test(d)) return false;
  if (d >= SENTINEL_CUTOFF) return false;
  return true;
}

/**
 * Should this calendar row be retired to status=past?
 * Always_on / merged / missing date / future or today → no.
 *
 * @param {{ status?: string, date?: string|null }} row
 * @param {{ todayIso: string }} opts
 */
export function shouldRetireCalendarRow(row, { todayIso } = {}) {
  if (!row) return false;
  const status = String(row.status || '');
  if (status === 'always_on') return false;
  if (status === 'merged') return false;
  if (status === 'past') return false; // already retired
  // Only retire upcoming (or legacy undated status carrying a real past date).
  if (status && status !== 'upcoming') return false;
  const date = row.date ? String(row.date).slice(0, 10) : null;
  if (!isRealCalendarDate(date)) return false;
  const today = todayIso || new Date().toISOString().slice(0, 10);
  return date < today;
}

/**
 * Pure selector of rows to retire.
 * @param {Array<object>} rows
 * @param {{ todayIso?: string }} opts
 */
export function pickRowsToRetire(rows, opts = {}) {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  return (rows || []).filter((r) => shouldRetireCalendarRow(r, { todayIso }));
}

/**
 * Build the upcoming row payload (pure). Returns { ok:false, reason } when
 * the candidate must not be written.
 *
 * Policy:
 * - require real date by default
 * - optional allowDateFallback + fallbackDate for legacy watcher behaviour
 * - never accept sentinel dates
 */
export function buildUpcomingCatalogueRow({
  slug,
  url,
  date = null,
  title = null,
  catalogueReady = true,
  source = null,
  houseName = null,
  location = 'UK',
  type = 'Residential & Commercial',
  allowDateFallback = false,
  fallbackDate = null,
  nowIso = null,
} = {}) {
  if (!slug) return { ok: false, reason: 'missing_slug' };
  if (!url || !String(url).startsWith('http')) return { ok: false, reason: 'missing_or_invalid_url' };

  let finalDate = date ? String(date).slice(0, 10) : null;
  if (!isRealCalendarDate(finalDate)) {
    if (allowDateFallback && isRealCalendarDate(fallbackDate)) {
      finalDate = String(fallbackDate).slice(0, 10);
    } else {
      return { ok: false, reason: 'missing_or_invalid_date' };
    }
  }

  const updatedAt = nowIso || new Date().toISOString();
  const row = {
    house: houseName || slug,
    house_slug: slug,
    logo: '🔨',
    date: finalDate,
    title: title || `${finalDate} Auction`,
    url: String(url).trim(),
    location,
    type,
    status: 'upcoming',
    catalogue_ready: catalogueReady === true,
    updated_at: updatedAt,
  };
  if (source) row._source = source; // not a DB column — stripped before write
  return { ok: true, row, date: finalDate, source: source || null };
}

function stripInternal(row) {
  const out = { ...row };
  delete out._source;
  return out;
}

/**
 * Upsert one upcoming catalogue row.
 *
 * Conflict target: (url, date) — table unique key used by auction-watcher.
 * Also skips when house_slug+date already has a different URL unless
 * replaceSameHouseDate=true.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   action?: 'upserted'|'skipped'|'dry_run',
 *   reason?: string,
 *   row?: object,
 *   error?: string
 * }>}
 */
export async function upsertUpcomingCatalogue(supabase, {
  slug,
  url,
  date = null,
  title = null,
  catalogueReady = true,
  source = null,
  houseName = null,
  dryRun = false,
  allowDateFallback = false,
  fallbackDate = null,
  replaceSameHouseDate = false,
  location = 'UK',
  type = 'Residential & Commercial',
  invalidateCache = true,
} = {}) {
  const built = buildUpcomingCatalogueRow({
    slug,
    url,
    date,
    title,
    catalogueReady,
    source,
    houseName,
    allowDateFallback,
    fallbackDate,
    location,
    type,
  });
  if (!built.ok) {
    return { ok: false, action: 'skipped', reason: built.reason };
  }
  const row = stripInternal(built.row);

  if (!supabase && !dryRun) {
    return { ok: false, action: 'skipped', reason: 'no_supabase', row };
  }

  // Optional same-house+date guard before upsert.
  if (supabase && !replaceSameHouseDate) {
    try {
      const { data: existingDateRows } = await supabase
        .from('auction_calendar')
        .select('id, url, status')
        .eq('house_slug', slug)
        .eq('date', row.date)
        .limit(5);
      const blockers = (existingDateRows || []).filter((r) => {
        if (!r) return false;
        if (r.status === 'always_on') return false;
        // same URL is fine (upsert)
        if (r.url === row.url) return false;
        return true;
      });
      if (blockers.length) {
        return {
          ok: false,
          action: 'skipped',
          reason: 'house_date_exists_different_url',
          row,
        };
      }
    } catch {
      // non-fatal — upsert may still work
    }
  }

  if (dryRun) {
    return { ok: true, action: 'dry_run', row, reason: 'dry_run' };
  }

  try {
    const { error } = await supabase
      .from('auction_calendar')
      .upsert(row, { onConflict: 'url,date' });
    if (error) {
      return { ok: false, action: 'skipped', reason: 'upsert_error', error: error.message, row };
    }
    if (invalidateCache) {
      await invalidateCalendarCacheSoft();
    }
    return { ok: true, action: 'upserted', row };
  } catch (e) {
    return { ok: false, action: 'skipped', reason: 'upsert_throw', error: e.message || String(e), row };
  }
}

/**
 * Retire past dated upcoming rows for one slug (or all when slug null).
 * Prefer status='past' update; never touches always_on.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   considered: number,
 *   retired: number,
 *   ids: string[],
 *   dryRun: boolean,
 *   error?: string
 * }>}
 */
export async function retirePastUpcomingRows(supabase, {
  slug = null,
  todayIso = null,
  dryRun = false,
  invalidateCache = true,
  limit = 500,
} = {}) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  if (!supabase && !dryRun) {
    return { ok: false, considered: 0, retired: 0, ids: [], dryRun, error: 'no_supabase' };
  }

  let rows = [];
  if (supabase) {
    try {
      let q = supabase
        .from('auction_calendar')
        .select('id, house_slug, status, date, url')
        .eq('status', 'upcoming')
        .lt('date', today)
        .gt('date', '1970-01-01')
        .lt('date', SENTINEL_CUTOFF)
        .limit(limit);
      if (slug) q = q.eq('house_slug', slug);
      const { data, error } = await q;
      if (error) throw error;
      rows = data || [];
    } catch (e) {
      return { ok: false, considered: 0, retired: 0, ids: [], dryRun, error: e.message || String(e) };
    }
  }

  const toRetire = pickRowsToRetire(rows, { todayIso: today });
  const ids = toRetire.map((r) => r.id).filter(Boolean);

  if (dryRun) {
    return { ok: true, considered: rows.length, retired: ids.length, ids, dryRun: true };
  }
  if (ids.length === 0) {
    return { ok: true, considered: rows.length, retired: 0, ids: [], dryRun: false };
  }

  try {
    const { error } = await supabase
      .from('auction_calendar')
      .update({ status: 'past', updated_at: new Date().toISOString() })
      .in('id', ids)
      .eq('status', 'upcoming'); // belt: never flip always_on even if id list wrong
    if (error) {
      return { ok: false, considered: rows.length, retired: 0, ids, dryRun: false, error: error.message };
    }
    if (invalidateCache) {
      await invalidateCalendarCacheSoft();
    }
    return { ok: true, considered: rows.length, retired: ids.length, ids, dryRun: false };
  } catch (e) {
    return { ok: false, considered: rows.length, retired: 0, ids, dryRun: false, error: e.message || String(e) };
  }
}
