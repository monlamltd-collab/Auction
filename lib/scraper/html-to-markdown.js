// ═══════════════════════════════════════════════════════════════
// lib/scraper/html-to-markdown.js — HTML → recognition markdown.
//
// The markdown-recogniser houses (Pattinson, John Pye, McHugh, Mark
// Jenkinson, Maggs, Hollis Morgan) recover lots the JSON extractor missed
// by parsing Firecrawl's markdown. Crawlee yields HTML only, so this
// bridge converts Crawlee-rendered HTML into the same shape those
// recognisers expect. Two Firecrawl idioms matter (verified against the
// real recognisers, 2026-06-11):
//
//   • Hard line breaks: Firecrawl emits `\\` + newline for <br> (the
//     Pattinson recogniser splits on /\\\\\s*\n\s*/ —
//     lib/pipeline/firecrawl-extract.js:159). turndown's default is
//     two-space + newline, which recognises NOTHING — so a custom br
//     rule emits the Firecrawl idiom.
//   • Absolute URLs: Firecrawl absolutises hrefs; turndown preserves
//     them verbatim. Four of six recognisers and the markjenkinson
//     sentinel anchor on `https://www.<domain>/...`, so relative
//     hrefs/srcs are resolved against the page URL.
//
// turndown config otherwise mirrors Firecrawl: inline links, atx
// headings, `-` bullets. Scripts/styles stripped.
// ═══════════════════════════════════════════════════════════════

import TurndownService from 'turndown';

// Base URL for the conversion in progress. turndown is synchronous, so a
// module-level slot is safe — set on entry, cleared on exit.
let _base = null;

function absolutise(url) {
  if (!url || /^(https?:|data:|mailto:|tel:|#)/i.test(url)) return url;
  if (!_base) return url;
  try { return new URL(url, _base).href; } catch { return url; }
}

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

  // Firecrawl hard-break idiom: `\\` + newline (NOT turndown's default
  // two-space break). The Pattinson recogniser splits lot cards on this.
  _service.addRule('firecrawlBreak', {
    filter: 'br',
    replacement: () => '\\\\\n',
  });

  // Inline links with absolutised hrefs — recognisers + sentinels anchor on
  // full `https://…` detail URLs, as Firecrawl emits them.
  _service.addRule('absoluteLink', {
    filter: (node) => node.nodeName === 'A' && node.getAttribute('href'),
    replacement: (content, node) => {
      const href = absolutise(node.getAttribute('href'));
      return href ? `[${content}](${href})` : content;
    },
  });

  // Images with absolutised src (lazy-load attrs as fallback — the Crawlee
  // renderer materialises data-src → src, but belt-and-braces here).
  _service.addRule('absoluteImage', {
    filter: 'img',
    replacement: (content, node) => {
      const src = absolutise(
        node.getAttribute('src') || node.getAttribute('data-src') || node.getAttribute('data-lazy-src') || ''
      );
      const alt = (node.getAttribute('alt') || '').replace(/[\[\]]/g, '');
      return src ? `![${alt}](${src})` : '';
    },
  });

  return _service;
}

/**
 * Convert rendered HTML to recogniser-friendly markdown.
 * @param {string} html
 * @param {string} [baseUrl] - page URL; relative hrefs/srcs resolve against it
 * @returns {string} '' on empty/invalid input or conversion failure (never
 *   throws — the recogniser then finds no IDs and the engine falls back).
 */
export function htmlToRecognitionMarkdown(html, baseUrl = null) {
  if (!html || typeof html !== 'string') return '';
  _base = baseUrl || null;
  try {
    return service().turndown(html);
  } catch (err) {
    console.warn(`html-to-markdown: turndown failed (${err.message})`);
    return '';
  } finally {
    _base = null;
  }
}
