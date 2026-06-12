// ═══════════════════════════════════════════════════════════════
// lib/scraper/structure-fingerprint.js — proactive presentation-change
// detection (2026-06-12).
//
// The recall sentinel catches a presentation change REACTIVELY — after an
// extraction run under-recalls. This module catches it PROACTIVELY: each
// successful page-1 render is reduced to a compact structural fingerprint
// (CSS class vocabulary + signal counts), compared against the previous
// run's fingerprint stored in house_skills.engine_stats._fingerprint. A
// step-change (template rebuild, framework migration, cookie-wall takeover)
// fires a structure_drift alert BEFORE any lots are lost, naming what moved.
//
// Deterministic by design: routine lot churn (new addresses, new prices)
// leaves the class vocabulary and signal RATIOS stable — only a structural
// rebuild shifts them. Pure functions, no I/O; the caller persists.
// ═══════════════════════════════════════════════════════════════

// How many distinct class names the vocabulary keeps (by frequency). Big
// enough to characterise a template, small enough for a JSONB cell.
const VOCAB_SIZE = 40;
// Jaccard similarity of class vocabularies below this = the template was
// rebuilt. Routine content churn on the same template scores ~0.9+.
const VOCAB_DRIFT_THRESHOLD = parseFloat(process.env.STRUCTURE_VOCAB_DRIFT || '0.40');
// A signal previously present in volume that collapses to zero while the page
// stays big is structural (e.g. prices moved behind JS, lot links re-shaped).
const COLLAPSE_FLOOR = 5;

const PRICE_TOKEN_RE = /£\s?\d{1,3}(?:,\d{3})+|£\s?\d{4,}/g;
const POSTCODE_RE = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/g;

/**
 * Reduce rendered HTML to a compact structural fingerprint.
 * @param {string} html
 * @param {RegExp|null} [sentinelPattern] - the house's recall sentinel (counts advertised lot ids)
 * @returns {object|null} fingerprint, or null when the page is too small to characterise
 */
export function computeStructureFingerprint(html, sentinelPattern = null) {
  const src = String(html || '');
  if (src.length < 500) return null; // cookie wall / empty shell — nothing to fingerprint

  // Class vocabulary: the template's signature. Split class attributes into
  // individual names, count, keep the top N. Hashed/utility suffixes (CSS
  // modules like `card__x-3fA9z`, tailwind arbitrary values) are kept as-is —
  // they churn only when the BUILD changes, which is exactly a rebuild signal.
  const freq = new Map();
  for (const m of src.matchAll(/class\s*=\s*["']([^"']+)["']/gi)) {
    for (const cls of m[1].split(/\s+/)) {
      if (!cls || cls.length > 60) continue;
      freq.set(cls, (freq.get(cls) || 0) + 1);
    }
  }
  const classVocab = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, VOCAB_SIZE)
    .map(([cls]) => cls)
    .sort();

  const stripped = src
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');

  let sentinelIds = 0;
  if (sentinelPattern) {
    const ids = new Set();
    for (const m of stripped.matchAll(new RegExp(sentinelPattern.source, sentinelPattern.flags.includes('g') ? sentinelPattern.flags : sentinelPattern.flags + 'g'))) {
      if (m[1]) ids.add(m[1]);
    }
    sentinelIds = ids.size;
  }

  return {
    classVocab,
    counts: {
      htmlKb: Math.round(src.length / 1024),
      links: (src.match(/<a\s/gi) || []).length,
      images: (src.match(/<img\s/gi) || []).length,
      priceTokens: (stripped.match(PRICE_TOKEN_RE) || []).length,
      postcodes: (stripped.match(POSTCODE_RE) || []).length,
      sentinelIds,
    },
    at: new Date().toISOString(),
  };
}

function jaccard(a = [], b = []) {
  if (!a.length && !b.length) return 1;
  const sa = new Set(a), sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Compare the current render's fingerprint to the previous run's.
 * @returns {{drift:boolean, similarity:number|null, reasons:string[]}}
 *   drift=false when there's no previous fingerprint (first run) — nothing to
 *   compare is not a change.
 */
export function compareFingerprints(prev, curr) {
  if (!prev || !curr) return { drift: false, similarity: null, reasons: [] };
  const reasons = [];
  const similarity = Math.round(jaccard(prev.classVocab, curr.classVocab) * 100) / 100;

  if (similarity < VOCAB_DRIFT_THRESHOLD) {
    reasons.push(`class vocabulary shifted (similarity ${similarity} < ${VOCAB_DRIFT_THRESHOLD} — template rebuilt?)`);
  }
  const p = prev.counts || {}, c = curr.counts || {};
  // Signal collapse: present in volume before, zero now, page still
  // substantial (≥2KB and ≥30% of its previous size — below that the page
  // itself broke, which the render/0-lot detectors already own).
  const pageStillBig = (c.htmlKb || 0) >= Math.max(2, (p.htmlKb || 0) * 0.3);
  if (pageStillBig) {
    if ((p.priceTokens || 0) >= COLLAPSE_FLOOR && (c.priceTokens || 0) === 0) {
      reasons.push(`price tokens collapsed ${p.priceTokens}→0 (prices moved behind JS or off the listing?)`);
    }
    if ((p.sentinelIds || 0) >= COLLAPSE_FLOOR && (c.sentinelIds || 0) === 0) {
      reasons.push(`sentinel lot ids collapsed ${p.sentinelIds}→0 (lot URL shape changed — sentinel needs updating)`);
    }
    if ((p.postcodes || 0) >= COLLAPSE_FLOOR && (c.postcodes || 0) === 0) {
      reasons.push(`postcodes collapsed ${p.postcodes}→0 (addresses no longer in the listing markup?)`);
    }
  }
  return { drift: reasons.length > 0, similarity, reasons };
}

export const _internals = { VOCAB_SIZE, VOCAB_DRIFT_THRESHOLD, COLLAPSE_FLOOR, jaccard };
