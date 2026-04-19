// lib/pipeline/scrape-diff.js — Compare old vs new lots to detect additions, removals, changes

/**
 * Compute a diff between old and new lot arrays.
 * Pure function — no external dependencies.
 *
 * @param {Array} oldLots - Previous lot array
 * @param {Array} newLots - Current lot array
 * @returns {{ lots_added, lots_removed, lots_changed, images_gained, images_lost, status_changes, timestamp }}
 */
export function computeScrapeDiff(oldLots, newLots) {
  const oldMap = new Map((oldLots || []).map(l => [l.lotNumber || l.address || l.lot, l]));
  const newMap = new Map((newLots || []).map(l => [l.lotNumber || l.address || l.lot, l]));
  const added = [...newMap.keys()].filter(k => k && !oldMap.has(k));
  const removed = [...oldMap.keys()].filter(k => k && !newMap.has(k));
  const changed = [...newMap.keys()].filter(k => {
    if (!k || !oldMap.has(k)) return false;
    const o = oldMap.get(k), n = newMap.get(k);
    return o.price !== n.price || o.status !== n.status;
  });
  const imagesGained = (newLots || []).filter(l => l.imageUrl && !(oldMap.get(l.lotNumber || l.address || l.lot)?.imageUrl)).length;
  const imagesLost = (oldLots || []).filter(l => l.imageUrl && !(newMap.get(l.lotNumber || l.address || l.lot)?.imageUrl)).length;
  const summary = [];
  if (added.length) summary.push(`+${added.length} new lots`);
  if (removed.length) summary.push(`${removed.length} removed`);
  if (changed.length) summary.push(`${changed.length} changed`);
  if (imagesGained) summary.push(`${imagesGained} images added`);
  if (imagesLost) summary.push(`${imagesLost} images lost`);
  return {
    lots_added: added.length, lots_removed: removed.length, lots_changed: changed.length,
    images_gained: imagesGained, images_lost: imagesLost, status_changes: summary,
    timestamp: new Date().toISOString(),
  };
}
