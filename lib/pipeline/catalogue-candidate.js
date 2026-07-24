// lib/pipeline/catalogue-candidate.js
// Shared catalogue URL scoring + verification for human-in-the-loop heal/apply.
// Builds on healCandidateVerdict (lots on page) with stronger path heuristics so
// past-auctions / PDFs / single lots / art calendars never look "good".

import { normaliseUrl } from '../utils.js';
import {
  healCandidateVerdict,
  isJunkSearchUrl,
  countAdvertisedLots,
} from './healing.js';

const MIN_ADVERTISED_LOTS = 4;

const NEGATIVE_PATH_RE = [
  { re: /\/past[-_]?auctions?\b|\/archive\b|\/sold\b|\/results\b|\/previous\b/i, pen: 8, tag: 'past' },
  { re: /\.pdf(?:\?|#|$)/i, pen: 10, tag: 'pdf' },
  { re: /asian[-_]?art|fine[-_]?art|antiques?|furniture|collectables?/i, pen: 9, tag: 'non-property' },
  { re: /\/lot\/\d+|\/lots\/\d+|\/property\/\d+|lot[_-]?id=|property[_-]?id=/i, pen: 7, tag: 'single-lot' },
  { re: /brochure|buyer'?s?[-_]?guide|guidance|how[-_]?to|about[-_]?us|contact|news|blog|press/i, pen: 6, tag: 'content-page' },
  { re: /future[-_]?auction[-_]?dates|auction[-_]?dates?$|\/calendar\b|\/events?(?:\/|$)/i, pen: 5, tag: 'calendar-shell' },
  { re: /\/login|\/signin|\/account|\/register/i, pen: 6, tag: 'auth' },
];

const POSITIVE_PATH_RE = [
  { re: /current[-_]?auction|current[-_]?lots|live[-_]?auction/i, pts: 5, tag: 'current' },
  { re: /upcoming|for[-_]?sale|properties|catalogue|catalog/i, pts: 3, tag: 'listing' },
  { re: /search[-_]?results|\/search(?:\?|$)|\/lots(?:\?|$)|online[-_]?lots/i, pts: 2, tag: 'search' },
  { re: /auction/i, pts: 1, tag: 'auction' },
];

/**
 * Path-only score for a candidate URL (no fetch).
 * @returns {{ score: number, tags: string[], reject: boolean, rejectReason: string|null }}
 */
export function scoreCatalogueUrlPath(url) {
  if (!url || typeof url !== 'string') {
    return { score: -100, tags: ['empty'], reject: true, rejectReason: 'empty' };
  }
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed) || trimmed === 'null' || trimmed === 'undefined') {
    return { score: -100, tags: ['empty'], reject: true, rejectReason: 'empty' };
  }
  if (isJunkSearchUrl(trimmed)) {
    return { score: -100, tags: ['junk'], reject: true, rejectReason: 'junk-url' };
  }

  let score = 0;
  const tags = [];
  for (const { re, pen, tag } of NEGATIVE_PATH_RE) {
    if (re.test(trimmed)) {
      score -= pen;
      tags.push(tag);
    }
  }
  for (const { re, pts, tag } of POSITIVE_PATH_RE) {
    if (re.test(trimmed)) {
      score += pts;
      tags.push(tag);
    }
  }

  try {
    const u = new URL(trimmed);
    if ((u.pathname === '/' || u.pathname === '') && !u.search) {
      score -= 3;
      tags.push('homepage-root');
    }
  } catch {
    score -= 5;
    tags.push('bad-url');
  }

  let rejectReason = null;
  if (tags.includes('pdf')) rejectReason = 'pdf';
  else if (tags.includes('single-lot')) rejectReason = 'single-lot-url';
  else if (tags.includes('junk')) rejectReason = 'junk-url';
  else if (tags.includes('non-property')) rejectReason = 'non-property';
  else if (tags.includes('past') && score < 2) rejectReason = 'past-archive';
  else if (score <= -6) rejectReason = 'low-path-score';

  const reject = !!rejectReason;
  return { score, tags, reject, rejectReason };
}

/**
 * Full candidate assessment. Pass html when fetched; omit for path-only precheck.
 * @returns {{ ok: boolean, score: number, lots: number, reason: string, tags: string[], summary: string }}
 */
export function assessCatalogueCandidate(url, html, slug) {
  const path = scoreCatalogueUrlPath(url);
  if (path.reject && !['low-path-score', 'past-archive'].includes(path.rejectReason)) {
    return {
      ok: false,
      score: path.score,
      lots: 0,
      reason: path.rejectReason,
      tags: path.tags,
      summary: `reject ${path.rejectReason} (path score ${path.score})`,
    };
  }

  if (html != null) {
    const verdict = healCandidateVerdict(url, html, slug);
    const lots = verdict.lots || 0;
    const lotBonus = Math.min(8, Math.floor(lots / 5));
    let score = path.score + (verdict.ok ? lotBonus + 2 : (lots > 0 ? 1 : -4));
    // Past / archive never becomes ok even if lots exist on the page.
    if (path.tags.includes('past') || path.tags.includes('non-property') || path.tags.includes('pdf')) {
      return {
        ok: false,
        score,
        lots,
        reason: path.rejectReason || path.tags[0] || 'bad-path',
        tags: path.tags,
        summary: `reject ${path.rejectReason || path.tags[0]} lots=${lots} score=${score}`,
      };
    }
    const ok = verdict.ok && score >= 0;
    return {
      ok,
      score,
      lots,
      reason: ok ? 'ok' : (verdict.ok ? (path.rejectReason || 'path-downrank') : verdict.reason),
      tags: path.tags,
      summary: ok
        ? `ok lots=${lots} score=${score} [${path.tags.join(',') || 'plain'}]`
        : `reject ${verdict.ok ? (path.rejectReason || 'path') : verdict.reason} lots=${lots} score=${score}`,
    };
  }

  return {
    ok: !path.reject && path.score >= 1,
    score: path.score,
    lots: 0,
    reason: path.reject ? (path.rejectReason || 'path') : 'path-only',
    tags: path.tags,
    summary: path.reject
      ? `reject ${path.rejectReason} (path-only score ${path.score})`
      : `path-only score ${path.score} [${path.tags.join(',') || 'plain'}]`,
  };
}

/**
 * Pick best URL from a list using path scoring (no fetch).
 */
export function pickBestCatalogueCandidate(urls) {
  const scored = (urls || [])
    .filter(Boolean)
    .map(u => ({ u, ...scoreCatalogueUrlPath(u) }))
    .filter(x => !x.reject)
    .sort((a, b) => (b.score - a.score) || (a.u.length - b.u.length));
  return scored[0] || null;
}

/**
 * True if two glossary URLs point at the same catalogue endpoint after normalise.
 */
export function sameCatalogueUrl(a, b) {
  return normaliseUrl(a || '') === normaliseUrl(b || '');
}

export { healCandidateVerdict, isJunkSearchUrl, countAdvertisedLots, MIN_ADVERTISED_LOTS, normaliseUrl };
