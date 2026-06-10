// ═══════════════════════════════════════════════════════════════
// lib/scraper/html-to-markdown.js — HTML → recognition markdown.
//
// The markdown-recogniser houses (Pattinson, John Pye, McHugh, Mark
// Jenkinson, Maggs, Hollis Morgan) recover lots the JSON extractor missed
// by parsing Firecrawl's markdown. Crawlee yields HTML only, so this
// bridge converts Crawlee-rendered HTML into the same shape those
// recognisers expect: inline links `[text](href)`, headings, and bullet
// lists preserved (the structural anchors the recognisers key on —
// detail-page URLs that match the recall sentinel, `### Lot N` headers,
// `- ` bullets). See docs/ENGINE-ROUTER.md (Phase 3).
//
// turndown is configured to stay close to Firecrawl's markdown:
//   • linkStyle 'inlined' — keep `[text](url)` (sentinel matching needs hrefs)
//   • atx headings (`#`), `-` bullets, `*` emphasis
// Scripts/styles are stripped so they don't pollute the text the
// recognisers scan.
// ═══════════════════════════════════════════════════════════════

import TurndownService from 'turndown';

let _service = null;
function service() {
  if (_service) return _service;
  _service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    linkStyle: 'inlined',
    emDelimiter: '*',
  });
  // Drop non-content nodes entirely (turndown otherwise emits their text).
  _service.remove(['script', 'style', 'noscript', 'svg', 'head']);
  return _service;
}

/**
 * Convert rendered HTML to recogniser-friendly markdown.
 * Returns '' on empty/invalid input or conversion failure (never throws —
 * the recogniser then simply finds no IDs and the engine falls back).
 * @param {string} html
 * @returns {string}
 */
export function htmlToRecognitionMarkdown(html) {
  if (!html || typeof html !== 'string') return '';
  try {
    return service().turndown(html);
  } catch (err) {
    console.warn(`html-to-markdown: turndown failed (${err.message})`);
    return '';
  }
}
