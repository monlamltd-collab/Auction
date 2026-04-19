// lib/pipeline/analytics.js — Daily analytics snapshot
// Captures a point-in-time snapshot of pipeline health: total lots,
// image coverage, scrape engine breakdown, house health status.
// Called at the end of each autoAnalyseAll() cycle.

import { supabase } from '../supabase.js';

/**
 * Save (or update) today's analytics snapshot.
 */
export async function saveDailySnapshot() {
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from('analytics_snapshots')
    .select('id')
    .eq('date', today)
    .maybeSingle();

  // Gather current state
  const [{ data: cached }, { data: imgStats }] = await Promise.all([
    supabase.from('cached_analyses').select('house, total_lots, scraped_with').gt('expires_at', new Date().toISOString()),
    supabase.from('lots').select('house, image_url'),
  ]);

  const houses = cached || [];
  let totalLots = 0;
  const lotsByHouse = {};
  const engineCounts = { firecrawl: 0, puppeteer: 0, http: 0 };

  for (const h of houses) {
    totalLots += h.total_lots || 0;
    lotsByHouse[h.house] = h.total_lots || 0;
    if (h.scraped_with && engineCounts[h.scraped_with] !== undefined) {
      engineCounts[h.scraped_with]++;
    }
  }

  const totalLotsForImages = (imgStats || []).length;
  const totalWithImages = (imgStats || []).filter(l => l.image_url).length;
  const imageCoveragePct = totalLotsForImages > 0 ? Math.round(totalWithImages / totalLotsForImages * 100) : 0;

  // Read skill health status
  let healthyHouses = 0, degradedHouses = 0, brokenHouses = 0;
  try {
    const { data: skills } = await supabase.from('house_skills').select('status');
    for (const s of (skills || [])) {
      if (s.status === 'healthy') healthyHouses++;
      else if (s.status === 'degraded') degradedHouses++;
      else if (s.status === 'broken') brokenHouses++;
    }
  } catch {}

  const snapshot = {
    date: today,
    total_lots: totalLots,
    image_coverage_pct: imageCoveragePct,
    lots_by_house: lotsByHouse,
    engine_breakdown: engineCounts,
    healthy_houses: healthyHouses,
    degraded_houses: degradedHouses,
    broken_houses: brokenHouses,
  };

  if (existing) {
    await supabase.from('analytics_snapshots').update(snapshot).eq('date', today);
  } else {
    await supabase.from('analytics_snapshots').insert(snapshot);
  }

  console.log(`ANALYTICS: Snapshot saved for ${today} — ${totalLots} lots, ${imageCoveragePct}% images, ${houses.length} houses`);
}
