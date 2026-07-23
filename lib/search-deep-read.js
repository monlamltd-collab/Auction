// lib/search-deep-read.js — Stage-2 "deep read" helpers for AI smart search.
//
// Stage 1 shortlists candidates from 500-char search_text snippets (wide pool,
// shallow text). Stage 2 re-presents ONLY the shortlist with each lot's full
// structured data AND the auctioneer's verbatim narrative (lots.description,
// harvested by the narrative sweep), so the model can VERIFY each candidate
// against the user's intent and rank the survivors best-fit-first. Pure
// helpers live here so the prompt payload and verdict mapping are testable
// without the route's Supabase/AI wiring.

// Per-lot text budgets. The shortlist is ≤40 lots, so worst case is
// ~40 × (1,400 + 2,200) ≈ 144KB ≈ 36k input tokens on the fast tier — cheap,
// and small enough to never crowd the model's context.
export const DEEP_READ_SEARCHTEXT_CHARS = 1400;
export const DEEP_READ_NARRATIVE_CHARS = 2200;
// Below this many stage-1 picks a verification pass has nothing to prune and
// the extra round-trip is pure latency.
export const DEEP_READ_MIN_LOTS = 3;

function metaLine(l) {
  return [
    l.status && l.status !== 'available' ? `STATUS:${l.status}` : '',
    l.propType ? `Type:${l.propType}` : '',
    l.tenure ? `Tenure:${l.tenure}` : '',
    l.beds ? `${l.beds}bed` : '',
    l.units && l.units > 1 ? `${l.units}units` : '',
    l.condition ? `Cond:${l.condition}` : '',
    l.dealType && l.dealType !== 'Standard' ? `Deal:${l.dealType}` : '',
    l.estGrossYield ? `Yield:${l.estGrossYield}%` : '',
    l.belowMarket ? `${l.belowMarket}%belowMkt` : '',
    l.vacant ? 'VACANT' : '',
    l.titleSplit ? 'TITLE_SPLIT' : '',
    ...(Array.isArray(l.dealSignals) ? l.dealSignals.map(s => String(s).toUpperCase()) : []),
    l.statedIncomePa ? `Income:£${l.statedIncomePa}pa(${l.incomeKind || 'stated'})` : '',
  ].filter(Boolean).join(' ');
}

/**
 * Build the stage-2 prompt payload: one block per shortlisted lot with full
 * structured context + verbatim narrative. Index [i] mirrors the array order
 * so the verdict's indices map straight back.
 *
 * @param {Array} lots - stage-1 picks (mapped lot objects)
 * @returns {string}
 */
export function buildDeepSummaries(lots) {
  return (lots || []).map((l, i) => {
    const context = (l._searchText || '').substring(0, DEEP_READ_SEARCHTEXT_CHARS);
    const narrative = (l.description || '').substring(0, DEEP_READ_NARRATIVE_CHARS);
    return `[${i}] ${l._house} L${l.lot}: ${l.address} | £${l.price || '?'} | Score:${l.score || 0} | ${metaLine(l)}\n` +
      `DATA: ${context}\n` +
      `NARRATIVE: ${narrative || '(no narrative captured for this lot — judge on DATA alone, do not penalise)'}`;
  }).join('\n\n');
}

/**
 * Map a stage-2 verdict back onto the shortlist. Bounds-checked and deduped;
 * order preserved (the model ranks best-fit-first). Returns null when the
 * verdict is unusable — the caller keeps the stage-1 results untouched.
 *
 * @param {Array} lots - the stage-1 shortlist the indices refer to
 * @param {number[]} indices - verdict indices
 * @returns {Array|null}
 */
export function applyDeepVerdict(lots, indices) {
  if (!Array.isArray(lots) || !Array.isArray(indices) || indices.length === 0) return null;
  const seen = new Set();
  const kept = [];
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= lots.length || seen.has(i)) continue;
    seen.add(i);
    kept.push(lots[i]);
  }
  return kept.length > 0 ? kept : null;
}

/**
 * A query deserves the deep-read pass only when it carries SEMANTIC content —
 * concepts, free text, or soft filters that stage 1 interpreted rather than
 * SQL-matched. "3 bed under £200k in Leeds" is pure structured filtering; the
 * narrative can't change its answer, so the second round-trip is skipped.
 *
 * @param {{concepts?: string[], freeText?: string[], softFilters?: object}} sqParsed
 * @returns {boolean}
 */
export function isSemanticQuery(sqParsed) {
  if (!sqParsed) return false;
  if ((sqParsed.concepts || []).length > 0) return true;
  if ((sqParsed.freeText || []).length > 0) return true;
  return Object.keys(sqParsed.softFilters || {}).length > 0;
}
