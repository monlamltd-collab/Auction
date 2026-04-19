// lib/pipeline/purge.js — Purge stale cached_analyses rows for past/orphaned/expired auctions
import { log } from '../logging.js';
import { normaliseUrl } from '../utils.js';

const BATCH = 50;

/**
 * Purge cached_analyses rows that are no longer needed:
 * 1. Past-only auctions (date passed, no upcoming entry for same URL)
 * 2. Orphaned entries (URL not in any calendar entry)
 * 3. Expired entries older than 7 days
 *
 * @param {{ supabase: object }} deps
 */
export async function purgeStaleCaches({ supabase }) {
  const today = new Date().toISOString().slice(0, 10);

  // ── 1. Purge past-only auction URLs ──
  // IMPORTANT: Some houses reuse the same URL across multiple auction dates
  // (e.g. BidX1, BTG Eddisons). Only purge URLs that appear ONLY in past
  // entries — never delete cache for a URL that also has an upcoming auction.
  const { data: pastCalendar } = await supabase
    .from('auction_calendar')
    .select('url')
    .lt('date', today)
    .neq('status', 'always_on');

  const { data: upcomingCalendar } = await supabase
    .from('auction_calendar')
    .select('url')
    .or(`date.gte.${today},status.eq.always_on`);

  if (pastCalendar && pastCalendar.length > 0) {
    const upcomingUrls = new Set((upcomingCalendar || []).map(r => normaliseUrl(r.url)));
    const purgeable = [...new Set(pastCalendar.map(r => normaliseUrl(r.url)).filter(Boolean))]
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

  // ── 2. Purge orphaned cache entries — URLs not in any calendar entry ──
  const { data: allCalendar } = await supabase.from('auction_calendar').select('url');
  const allCalendarUrls = new Set((allCalendar || []).map(r => normaliseUrl(r.url)).filter(Boolean));
  const { data: allCached } = await supabase.from('cached_analyses').select('url');
  if (allCached) {
    const orphaned = allCached
      .map(r => normaliseUrl(r.url))
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

  // ── 3. Purge expired cache entries older than 7 days ──
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
  const { data: oldExpired, error: oldErr } = await supabase
    .from('cached_analyses')
    .delete()
    .lt('expires_at', sevenDaysAgo)
    .select('url');
  if (!oldErr && oldExpired && oldExpired.length > 0) {
    console.log(`AUTO-PURGE: Removed ${oldExpired.length} cache entries expired >7 days ago`);
  }
}
