// lib/scraper/homepage-audit.js
// Self-hosted homepage audit — the non-Firecrawl replacement for
// extractHomepage(). Fetches via Crawlee (fallback plain HTTP), converts to
// markdown, runs a Gemini structured audit mirroring HOMEPAGE_AUDIT_SCHEMA/
// PROMPT, and produces the SAME audit shape homepage-watch's decide() consumes.
// Change detection is self-hosted: sha256 of normalised markdown vs the prior
// hash stored on house_homepage_watch.last_content_hash.

import { createHash } from 'node:crypto';
import { fetchPage } from './http.js';
import { hasCrawlee, scrapeWithCrawlee } from './crawlee.js';
import { htmlToRecognitionMarkdown } from './html-to-markdown.js';
import { getCallAI } from './state.js';
import { HOMEPAGE_AUDIT_PROMPT } from './homepage-schema.js';

// Strip volatile bits so cosmetic re-renders don't read as a content change.
function normaliseForHash(md) {
  return String(md || '')
    .toLowerCase()
    .replace(/\?(?:v|ver|cb|cache|_)=[a-z0-9]+/gi, '')   // cache-buster qs
    .replace(/nonce[-_]?[a-z0-9]{6,}/gi, '')             // inline nonces
    .replace(/\b[0-9a-f]{32,}\b/gi, '')                  // long hex tokens
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/gi, '')        // iso timestamps
    .replace(/\s+/g, ' ')
    .trim();
}
function contentHash(md) { return createHash('sha256').update(normaliseForHash(md)).digest('hex'); }

async function fetchHomepageHtml(url) {
  if (hasCrawlee()) {
    try {
      const { html, sourceURL } = await scrapeWithCrawlee(url);
      if (html && html.length > 0) return { html, sourceURL: sourceURL || url };
    } catch { /* fall through to plain HTTP */ }
  }
  const html = await fetchPage(url); // throws on !resp.ok → caller maps to fetchError
  return { html, sourceURL: url };
}

// Parse the first balanced {...} object out of model output. {} on failure.
function parseAuditObject(text) {
  const raw = String(text || '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  if (start === -1) return {};
  for (let end = body.lastIndexOf('}'); end > start; end = body.lastIndexOf('}', end - 1)) {
    try { const o = JSON.parse(body.slice(start, end + 1)); if (o && typeof o === 'object') return o; }
    catch { /* try previous brace */ }
  }
  return {};
}

function buildPrompt(url, markdown) {
  return `${HOMEPAGE_AUDIT_PROMPT}

You are auditing the homepage of a UK property auction house. URL: ${url}

Return ONLY a JSON object with these fields (no prose, no code fence):
- current_catalogue_url: string|null  — full URL of the current/next auction catalogue page (lists individual lots). null if none linked.
- next_auction_date: string|null      — date of the next auction as displayed (e.g. "19 May 2026"). null if not visible.
- has_active_inventory: boolean       — whether lots/properties are currently listed for an upcoming or active auction.
- site_status: string                 — one of "active" | "no_current_auction" | "domain_parked" | "not_an_auction_house".
- notes: string                       — one short sentence noting anything unusual (login wall, redirect, captcha, now part of larger group). "" if nothing notable.

Be conservative: only return a current_catalogue_url the page actually links as the current catalogue. Do not guess.

=== HOMEPAGE CONTENT ===
${markdown}

Return ONLY the JSON object:`;
}

// Drop-in replacement for extractHomepage(url, opts). Same return shape.
// opts.prev = the house_homepage_watch row (for the self-hosted diff).
export async function auditHomepageSelfHosted(url, opts = {}) {
  const prev = opts.prev || null;
  const { html, sourceURL } = await fetchHomepageHtml(url);
  const md = htmlToRecognitionMarkdown(html, sourceURL) || '';

  const looks404 = /can.t be found|page not found|http error 404|no webpage|not.{0,5}found|domain.{0,30}parked/i.test(md);

  const hash = contentHash(md);
  const prevHash = prev?.last_content_hash || null;
  let changeStatus;
  if (!prevHash) changeStatus = 'new';
  else if (prevHash === hash) changeStatus = 'same';
  else changeStatus = 'changed';

  // RECORD_ONLY short-circuit: unchanged AND we already have a stored catalogue
  // URL — reuse persisted fields, skip the Gemini call (mirrors FC 'same').
  let json = {};
  if (changeStatus === 'same' && prev?.last_extracted_catalogue_url != null) {
    json = {
      current_catalogue_url: prev.last_extracted_catalogue_url,
      next_auction_date: prev.last_next_auction_date || null,
      site_status: prev.last_site_status || null,
      has_active_inventory: null,
      notes: '',
    };
  } else {
    const callAI = getCallAI();
    if (!callAI) throw new Error('callAI not initialised (homepage-audit)');
    const text = await callAI(buildPrompt(sourceURL, md.slice(0, 24000)), {
      tier: 'fast', maxTokens: 1000, taskType: 'homepage-audit',
    });
    json = parseAuditObject(text);
  }

  return {
    currentCatalogueUrl: (json.current_catalogue_url || '').toString().trim() || null,
    nextAuctionDate: (json.next_auction_date || '').toString().trim() || null,
    hasActiveInventory: typeof json.has_active_inventory === 'boolean' ? json.has_active_inventory : null,
    siteStatus: (json.site_status || '').toString().trim() || (looks404 ? 'domain_parked' : null),
    notes: (json.notes || '').toString().trim() || (looks404 ? 'page returned 404-style marker' : ''),
    changeStatus,
    previousScrapeAt: prev?.last_checked_at || null,
    markdown: md,
    contentHash: hash,   // NEW — persistResult stores this as last_content_hash
  };
}
