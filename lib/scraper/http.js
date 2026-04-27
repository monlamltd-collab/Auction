// ═══════════════════════════════════════════════════════════════
// lib/scraper/http.js — Plain HTTP fetch (last-resort scraper tier)
//
// fetchPage is the third tier in the Firecrawl → Puppeteer → HTTP
// fallback chain. No state, no DOM parsing — just an aborted fetch
// with the project's standard headers and timeout.
// ═══════════════════════════════════════════════════════════════

import { HEADERS, TIMEOUT } from '../config.js';

export async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    clearTimeout(timeout);
  }
}
