// lib/pipeline/cycle-coordination.js
// Process-local flags so overnight steps don't thrash the same house twice.

/** @type {Set<string>} */
let _watcherHandledSlugs = new Set();
/** @type {object|null} */
let _lastWatcherSummary = null;
/** @type {object|null} */
let _lastHomepageFeedSummary = null;
/** @type {object|null} */
let _lastLotConsensusSummary = null;

export function setWatcherHandledSlugs(slugs = []) {
  _watcherHandledSlugs = new Set((slugs || []).filter(Boolean).map((s) => String(s).toLowerCase()));
}

export function markWatcherHandled(slug) {
  if (slug) _watcherHandledSlugs.add(String(slug).toLowerCase());
}

export function getWatcherHandledSlugs() {
  return new Set(_watcherHandledSlugs);
}

export function clearWatcherHandledSlugs() {
  _watcherHandledSlugs = new Set();
}

export function setLastWatcherSummary(summary) {
  _lastWatcherSummary = summary || null;
}

export function getLastWatcherSummary() {
  return _lastWatcherSummary;
}

export function setLastHomepageFeedSummary(summary) {
  _lastHomepageFeedSummary = summary || null;
}

export function getLastHomepageFeedSummary() {
  return _lastHomepageFeedSummary;
}

export function setLastLotConsensusSummary(summary) {
  _lastLotConsensusSummary = summary || null;
}

export function getLastLotConsensusSummary() {
  return _lastLotConsensusSummary;
}
