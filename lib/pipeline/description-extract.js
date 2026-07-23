// lib/pipeline/description-extract.js
//
// House-agnostic lot-narrative extraction from detail-page HTML.
//
// Catalogue scrapes capture short feature bullets; the source site's real
// narrative ("The property comprises…", situation, accommodation) lives on
// the lot detail page. This module pulls that narrative out of rendered HTML
// with zero per-house code, mirroring image-extract.js in spirit:
//
//   1. Heading-anchored — headings like "Property Description" /
//      "Situation" / "Accommodation" mark the narrative on brochure-style
//      pages (Bond Wolfe et al.) where the text sits in bare nodes, not in a
//      helpfully-classed container.
//   2. Container-scored — the block container holding the largest volume of
//      non-boilerplate paragraph text, with a bonus for description-ish
//      class/id names. Covers most houses.
//   3. Meta fallback — og:description / meta description (truncated upstream,
//      but honest narrative when the body strategies find nothing).
//
// Residual boilerplate (bidding help, guide-price definitions, agent
// disclaimers) repeats across a house's lots while narrative never does, so
// the narrative sweep strips cross-lot repeats via computeDescriptionBleed —
// the same trick computeBleedByHouse plays for shared gallery images.

import { JSDOM } from 'jsdom';

export const DESCRIPTION_MIN_CHARS = 40;   // below this → treat as no narrative
export const DESCRIPTION_MAX_CHARS = 4000; // storage cap; frontend clamps visually
const PARA_MIN_CHARS = 40;                 // ignore stub lines ("Read more", labels)
const HEADING_RESULT_MIN_CHARS = 150;      // heading strategy must clear this to win

// Paragraph-level boilerplate: auction mechanics, legal/fee text, agent
// disclaimers, site chrome. Matching paragraphs are dropped before scoring so
// a disclaimer-heavy container can't outscore the real description.
const BOILERPLATE_RE = new RegExp([
  // site chrome / account
  'cookie', 'newsletter', 'subscribe', 'sign ?up', 'log ?in', 'create (an )?account', 'privacy policy',
  // bidding mechanics
  'place (a |your )?bids?', 'bid increments?', 'proxy bid', 'maximum bid', 'bid history',
  'register (to|for) (bid|the auction)', 'bidding (opens|closes|platform)', 'how to bid',
  'current bid on a lot', 'notified that (he|she|they) (has|have) been outbid', 'internet connection',
  // guide price / reserve definitions
  'guide prices? (is|are) (an indication|issued|given|provided|subject)',
  "seller'?s current minimum acceptable price", 'reserve (price|range) (is|will|can|has been)',
  'provisional reserve', 'exceed (any|the) guide price',
  // fees / legal / conditions
  "buyer'?s (premium|fee)", 'administration (fee|charge)', 'completion (monies|takes place)',
  'money laundering', 'anti-money', 'special conditions of sale', 'legal pack',
  'common auction conditions', 'bidder terms', 'binding contracts? will be exchanged',
  'unconditional sale type', 'terms (and|&) conditions',
  // agent disclaimers
  'to the best of (their|our) knowledge', 'make their own enquiries', 'should not be relied upon',
  'for (guidance|illustration|identification) (purposes )?only', 'wide.?angle lens',
  'services .{0,30}not (been )?tested', 'measurements .{0,30}approximate',
  'particulars .{0,40}(do not|are not|prepared)', 'errors? (and|&) omissions',
  'deemed to have viewed', 'at (your|their) own risk', 'under no circumstances',
  'copyright', 'all rights reserved', 'registered in england', 'trading name of',
  'client money protection', 'propertymark',
  // covid-era viewing rules (still live on some sites)
  'social distancing', 'facemasks?', 'government guidelines',
].join('|'), 'i');

// Elements that never contain lot narrative — removed before any scoring.
const CHROME_SEL = 'script,style,noscript,nav,header,footer,form,iframe,svg,button,select,input,label,aside,[role="navigation"],[aria-hidden="true"]';

// class/id fragments marking a container as description-ish (score bonus) or
// as page chrome (skipped unless it ALSO looks description-ish).
const DESC_HINT_RE = /descr|about|summary|overview|property-?(text|info|content)/i;
const SKIP_HINT_RE = /nav|menu|footer|header|cookie|breadcrumb|share|social|sidebar|related|similar|listing|search|filter|modal|popup|banner|gform|gfield/i;

// Headings that anchor narrative sections on brochure-style pages. Deliberately
// narrow — "Pre-auction Offers", "Auction Details", "Viewings" etc. stay out.
const NARRATIVE_HEADING_RE = /^(propert(y|ies)\s+)?descriptions?$|^(the\s+)?propert(y|ies)$|^situation$|^location$|^accommodation$|^about\s+(this|the)\s+propert/i;

function textOf(node) { return (node.textContent || '').replace(/\s+/g, ' ').trim(); }
function hintOf(el) {
  try { return ((el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || '')); } catch { return ''; }
}

function keepPara(t) {
  return t.length >= PARA_MIN_CHARS && !BOILERPLATE_RE.test(t);
}

// ── Strategy 1: heading-anchored ──
// For each narrative heading, walk following siblings (elements AND text
// nodes — brochure pages often put narrative in bare text) until the next
// heading, collecting paragraph-sized chunks.
function headingAnchoredParas(doc) {
  const out = [];
  for (const h of doc.querySelectorAll('h1,h2,h3,h4,h5')) {
    if (!NARRATIVE_HEADING_RE.test(textOf(h))) continue;
    let node = h.nextSibling;
    let buffer = '';
    while (node) {
      const isEl = node.nodeType === 1;
      if (isEl && /^H[1-6]$/.test(node.tagName)) break;
      const t = isEl ? textOf(node) : String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) {
        // block elements flush as their own paragraph; text nodes accumulate
        if (isEl) {
          if (buffer && keepPara(buffer)) out.push(buffer);
          buffer = '';
          if (keepPara(t)) out.push(t);
        } else {
          buffer = buffer ? buffer + ' ' + t : t;
        }
      }
      node = node.nextSibling;
    }
    if (buffer && keepPara(buffer)) out.push(buffer);
  }
  return out;
}

// ── Strategy 2: container-scored ──
function containerScoredParas(doc) {
  const candidates = [];
  for (const el of doc.querySelectorAll('div,section,article,main')) {
    const hint = hintOf(el);
    if (SKIP_HINT_RE.test(hint) && !DESC_HINT_RE.test(hint)) continue;
    const paras = [];
    for (const n of el.querySelectorAll('p, li')) {
      const t = textOf(n);
      if (keepPara(t)) paras.push(t);
    }
    // leaf container holding bare narrative text (no p/li, no nested blocks)
    if (paras.length === 0 && el.querySelectorAll('div,section,p,li').length === 0) {
      const own = textOf(el);
      if (own.length >= 80 && own.length <= 3000 && keepPara(own)) paras.push(own);
    }
    if (paras.length === 0) continue;
    const total = paras.reduce((n, p) => n + p.length, 0);
    // Hint bonus only when there's substance — a description-classed div
    // holding a 40-char headline must not outscore the real content block
    // (Bond Wolfe's "PropertyHeader-description" holds only the headline).
    const bonus = (DESC_HINT_RE.test(hint) && total >= 200) ? 1.8 : 1;
    candidates.push({ score: total * bonus, paras });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? candidates[0].paras : [];
}

// ── Strategy 3: meta fallback ──
function metaDescription(doc) {
  const og = doc.querySelector('meta[property="og:description"]')?.getAttribute('content')
    || doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  const t = og.replace(/\s+/g, ' ').trim();
  return t.length >= DESCRIPTION_MIN_CHARS ? [t] : [];
}

function dedupeParas(paras) {
  const seen = new Set();
  const out = [];
  for (const p of paras) {
    const k = paraKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/**
 * Stable key for cross-lot paragraph comparison (bleed detection + dedupe).
 * First 100 normalised chars — long enough that two different lots' narrative
 * never collides, short enough that trailing dynamic bits (dates, prices)
 * don't defeat matching.
 */
export function paraKey(p) {
  return String(p || '').slice(0, 100).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Extract candidate narrative paragraphs from a lot detail page.
 * Returns [] when the page yields nothing usable (SPA shell, error page).
 *
 * @param {string} html - Rendered detail-page HTML.
 * @returns {string[]} paragraphs, page order, boilerplate-filtered.
 */
// JSDOM's memory footprint scales super-linearly with page size, and a few
// houses serve multi-MB SPA shells / inlined-JS pages. Parsing those in a
// sweep loop is what OOM-killed the whole prod process at 07:00 daily
// (narrative sweep, 2026-07-22 boot-loop). Real narrative sits well inside
// the first 500KB of every genuine detail page; anything past that is script
// payload, so truncating loses nothing and bounds the parse.
export const EXTRACT_HTML_CAP = 500_000;

// assembleDescription can only ever use DESCRIPTION_MAX_CHARS of text, so
// returning more than ~2× that (headroom for the bleed strip removing leading
// paragraphs) is pure memory waste. Without this cap a verbose page staged
// 50KB+ of paragraphs, and the sweep holds paras for up to 2,000 lots — the
// second leg of the 07:00 OOM (the first was bulk-holding raw HTML).
const PARAS_RETURN_CAP = DESCRIPTION_MAX_CHARS * 2;
function capParas(paras) {
  let total = 0;
  const kept = [];
  for (const p of paras || []) {
    if (total >= PARAS_RETURN_CAP) break;
    kept.push(p);
    total += p.length;
  }
  return kept;
}

export function extractDescriptionParas(html) {
  if (!html || typeof html !== 'string' || html.length < 200) return [];
  if (html.length > EXTRACT_HTML_CAP) html = html.slice(0, EXTRACT_HTML_CAP);
  let dom;
  try { dom = new JSDOM(html); } catch { return []; }
  try {
    const doc = dom.window.document;
    try { for (const el of doc.querySelectorAll(CHROME_SEL)) el.remove(); } catch { /* selector engine quirk — continue unpruned */ }

    const heading = dedupeParas(headingAnchoredParas(doc));
    const headingChars = heading.reduce((n, p) => n + p.length, 0);
    if (headingChars >= HEADING_RESULT_MIN_CHARS) return capParas(heading);

    const container = dedupeParas(containerScoredParas(doc));
    const containerChars = container.reduce((n, p) => n + p.length, 0);
    // A thin heading result still beats an even thinner container result.
    if (headingChars > containerChars) return capParas(heading);
    if (containerChars > 0) return capParas(container);

    return metaDescription(doc);
  } finally {
    try { dom.window.close(); } catch { /* jsdom teardown is best-effort */ }
  }
}

/**
 * Cross-lot boilerplate detection: any paragraph key seen on >= minLots
 * distinct lots of the same house is boilerplate, not narrative.
 *
 * @param {Array<{house: string, paras: string[]}>} items - one entry per lot.
 * @param {number} [minLots=3]
 * @returns {Map<string, Set<string>>} house → Set<paraKey>
 */
export function computeDescriptionBleed(items, minLots = 3) {
  const countsByHouse = new Map();
  for (const it of items || []) {
    if (!it || !it.house || !Array.isArray(it.paras)) continue;
    let counts = countsByHouse.get(it.house);
    if (!counts) { counts = new Map(); countsByHouse.set(it.house, counts); }
    for (const k of new Set(it.paras.map(paraKey))) {
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const bleed = new Map();
  for (const [house, counts] of countsByHouse) {
    const set = new Set();
    for (const [k, n] of counts) if (n >= minLots) set.add(k);
    if (set.size) bleed.set(house, set);
  }
  return bleed;
}

/**
 * Assemble the final stored description from candidate paragraphs, minus a
 * house's bleed set. Returns null when nothing substantive remains.
 *
 * @param {string[]} paras
 * @param {Set<string>} [bleedSet]
 * @returns {string|null}
 */
export function assembleDescription(paras, bleedSet) {
  const kept = (paras || []).filter(p => !(bleedSet && bleedSet.has(paraKey(p))));
  let text = dedupeParas(kept).join('\n\n').trim();
  if (text.length < DESCRIPTION_MIN_CHARS) return null;
  if (text.length > DESCRIPTION_MAX_CHARS) {
    text = text.slice(0, DESCRIPTION_MAX_CHARS).replace(/\s+\S*$/, '') + '…';
  }
  return text;
}

/**
 * One-shot convenience for single-page contexts (first-contact detail pass)
 * where no cross-lot bleed set exists yet — the boilerplate regex is the only
 * cleaner. The narrative sweep later re-extracts with bleed applied.
 *
 * @param {string} html
 * @returns {string|null}
 */
export function extractDescriptionFromHtml(html) {
  return assembleDescription(extractDescriptionParas(html));
}

/**
 * Prefer-longer rule for narrative writes — the sweep-side mirror of the
 * scrape-path merge (PR #194): a re-extraction that yields LESS text than the
 * stored narrative must never clobber it (a cookie-walled or partially-rendered
 * fetch reads as "less narrative", not "the narrative shrank"). Equal-length is
 * not an upgrade either — rewriting identical text would just churn rows.
 *
 * @param {string|null|undefined} existing - stored lots.description
 * @param {string|null|undefined} candidate - freshly extracted narrative
 * @returns {boolean} true when the candidate should replace the stored text
 */
export function shouldUpgradeDescription(existing, candidate) {
  if (!candidate || candidate.length < DESCRIPTION_MIN_CHARS) return false;
  return candidate.length > (existing ? String(existing).length : 0);
}
