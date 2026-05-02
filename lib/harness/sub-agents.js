// ═══════════════════════════════════════════════════════════════
// SUB-AGENTS — Targeted AI tasks dispatched by the manager
// ═══════════════════════════════════════════════════════════════
// The manager (Gemini Pro) identifies problems; sub-agents (Claude
// Sonnet or Gemini) execute focused diagnosis and recommendations.
// Each sub-agent call is cheap (~$0.01) and capped per cycle.

import { fireAlert } from './alert-router.js';

let _supabase = null;
let _callAI = null;

// Budget: max sub-agent calls per manager cycle
const MAX_SUBAGENT_CALLS_PER_CYCLE = parseInt(process.env.SUBAGENT_CALLS_PER_CYCLE || '3');
let _callsThisCycle = 0;

export function initSubAgents({ supabase, callAI }) {
  _supabase = supabase;
  _callAI = callAI;
}

export function resetSubAgentBudget() {
  _callsThisCycle = 0;
}

function canSpend() {
  return _callsThisCycle < MAX_SUBAGENT_CALLS_PER_CYCLE;
}

// ── Determine which tier to use for sub-agent work ──
// Claude Sonnet if available (better at structured analysis), else Gemini capable
function getSubAgentTier() {
  return process.env.CLAUDE_API_KEY ? 'capable' : 'capable';
}

function getSubAgentProvider() {
  // If Claude key exists, force claude provider for sub-agents
  return process.env.CLAUDE_API_KEY ? 'claude' : undefined;
}

// ═══════════════════════════════════════════════════════════════
// DATA QUALITY AUDIT
// ═══════════════════════════════════════════════════════════════
// Analyses field coverage for a house's lots and produces
// actionable recommendations.

export async function auditDataQuality(slug, lots) {
  if (!_callAI || !canSpend()) return null;
  if (!lots || lots.length === 0) return null;

  // Build coverage stats
  const total = lots.length;
  const coverage = {
    beds: lots.filter(l => l.beds != null).length,
    price: lots.filter(l => l.price != null).length,
    imageUrl: lots.filter(l => l.imageUrl).length,
    url: lots.filter(l => l.url).length,
    address: lots.filter(l => l.address && l.address.length > 5).length,
    propertyType: lots.filter(l => l.propertyType).length,
    tenure: lots.filter(l => l.tenure).length,
    condition: lots.filter(l => l.condition).length,
  };

  const pct = {};
  for (const [field, count] of Object.entries(coverage)) {
    pct[field] = Math.round((count / total) * 100);
  }

  // Only call AI if there are significant gaps (any key field below 50%)
  const keyFields = ['beds', 'price', 'imageUrl', 'address'];
  const hasGaps = keyFields.some(f => pct[f] < 50);
  if (!hasGaps) return { slug, coverage: pct, action: 'none', reason: 'Coverage adequate' };

  _callsThisCycle++;

  const prompt = `Analyse this auction house data quality and recommend fixes.

House: ${slug}
Total lots: ${total}
Field coverage (% of lots with data):
${Object.entries(pct).map(([f, p]) => `  ${f}: ${p}%`).join('\n')}

Sample lot (first with most fields):
${JSON.stringify(lots.find(l => l.beds && l.price && l.address) || lots[0], null, 2)}

The data comes from DOM extraction (HTML scraping with CSS selectors) on a UK property auction website.
Common reasons for missing fields: extractor doesn't target that selector, field uses non-standard HTML, data only on lot detail page not catalogue listing.

Respond with JSON only:
{
  "severity": "low|medium|high",
  "gaps": [{"field": "beds", "pct": 10, "likely_cause": "...", "suggested_fix": "..."}],
  "recommendation": "brief action summary"
}`;

  try {
    const text = await _callAI(prompt, {
      tier: getSubAgentTier(),
      taskType: 'sub_agent_quality',
      maxTokens: 1000,
      budgetExempt: true,
    });

    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result = JSON.parse(cleaned);

    // Fire alert if severity is medium or high
    if (result.severity === 'medium' || result.severity === 'high') {
      await fireAlert({
        type: 'data_quality_gap',
        severity: result.severity === 'high' ? 'error' : 'warning',
        house: slug,
        message: `Data quality audit: ${result.recommendation}`,
        meta: { coverage: pct, gaps: result.gaps },
      });
    }

    return { slug, coverage: pct, ...result };
  } catch (e) {
    console.warn(`SUB-AGENT: Data quality audit failed for ${slug}:`, e.message);
    return { slug, coverage: pct, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR STALENESS AUDIT
// ═══════════════════════════════════════════════════════════════
// Checks calendar entries for stale dates and mismatched statuses.
// This is mostly rule-based (no AI needed) but fires alerts.

export async function auditCalendarStaleness(calendarEntries) {
  const now = new Date();
  const stale = [];

  for (const entry of calendarEntries) {
    if (entry.status === 'always_on') continue; // always_on never stales
    if (!entry.date) continue;

    const auctionDate = new Date(entry.date);
    const daysPast = Math.floor((now - auctionDate) / (1000 * 60 * 60 * 24));

    if (daysPast > 7) {
      stale.push({
        house: entry.house_slug || entry.house,
        date: entry.date,
        daysPast,
        url: entry.url,
        status: entry.status,
      });
    }
  }

  if (stale.length > 0) {
    for (const s of stale) {
      await fireAlert({
        type: 'calendar_stale',
        severity: s.daysPast > 30 ? 'error' : 'warning',
        house: s.house,
        message: `Calendar entry ${s.daysPast} days past auction date (${s.date}), status still '${s.status}'`,
      });
    }
  }

  return { stale, total: calendarEntries.length };
}

// ═══════════════════════════════════════════════════════════════
// GATHER DATA QUALITY METRICS (for manager dashboard)
// ═══════════════════════════════════════════════════════════════
// Scans cached_analyses to produce per-house field coverage stats.
// Designed to be cheap (one Supabase query, no AI).

// ═══════════════════════════════════════════════════════════════
// STATUS DRIFT DETECTOR
// ═══════════════════════════════════════════════════════════════
// Samples 3-5 lot detail pages per house, fetches the source HTML,
// and compares the status visible on the page against what we have
// stored. Flags mismatches where source says "Sold"/"Auction Ended"
// but we show "available", or vice versa.
//
// Expensive: uses fetchLotPage (1 Firecrawl credit or plain HTTP per lot).
// Should only be called by the manager for houses with suspicious data.

let _fetchLotPage = null;

export function initStatusDrift({ fetchLotPage }) {
  _fetchLotPage = fetchLotPage;
}

const SOURCE_STATUS_RE = {
  sold:      /\bSOLD\b(?!\s*(?:STC|SUBJECT))/i,
  stc:       /\bSTC\b|\bSALE\s*AGREED\b|\bUNDER\s*OFFER\b|\bSOLD\s*SUBJECT\b/i,
  unsold:    /\bUNSOLD\b|\bNO[\s-]?SALE\b|\bPASSED\b|\bNOT\s*SOLD\b/i,
  withdrawn: /\bWITHDRAWN\b|\bPOSTPONED\b/i,
  ended:     /\bAuction\s*Ended\b|\bBidding\s*(?:has\s*)?Ended\b|\bLot\s*(?:has\s*)?Closed\b/i,
};

export function detectSourceStatus(html) {
  if (SOURCE_STATUS_RE.stc.test(html)) return 'stc';
  if (SOURCE_STATUS_RE.sold.test(html)) return 'sold';
  if (SOURCE_STATUS_RE.unsold.test(html)) return 'unsold';
  if (SOURCE_STATUS_RE.withdrawn.test(html)) return 'withdrawn';
  if (SOURCE_STATUS_RE.ended.test(html)) return 'unsold';
  return 'available';
}

export async function auditStatusDrift(slug, lots, { sampleSize = 5 } = {}) {
  if (!_fetchLotPage) return { slug, skipped: true, reason: 'fetchLotPage not available' };
  if (!lots || lots.length === 0) return { slug, skipped: true, reason: 'no lots' };

  // Sample lots that have URLs
  const candidates = lots.filter(l => l.url && l.url.startsWith('http'));
  if (candidates.length === 0) return { slug, skipped: true, reason: 'no lots with URLs' };

  // Prefer available lots (drift from available->ended is the key failure mode)
  const available = candidates.filter(l => !l.status || l.status === 'available');
  const nonAvailable = candidates.filter(l => l.status && l.status !== 'available');

  const sample = [
    ...available.slice(0, Math.min(sampleSize - 1, available.length)),
    ...nonAvailable.slice(0, 1),
  ].slice(0, sampleSize);

  const mismatches = [];
  let checked = 0;

  for (const lot of sample) {
    try {
      // skipCache: drift detection requires a fresh fetch
      const result = await _fetchLotPage(lot.url, { skipCache: true, house: slug });
      if (!result?.html) continue;
      checked++;

      const sourceStatus = detectSourceStatus(result.html);
      const ourStatus = lot.status || 'available';

      if (sourceStatus !== ourStatus) {
        mismatches.push({
          lot: lot.lot || lot.lot_number,
          url: lot.url,
          address: (lot.address || '').substring(0, 60),
          ourStatus,
          sourceStatus,
          direction: ourStatus === 'available' ? 'stale' : 'reverse',
        });
      }
    } catch (e) {
      continue;
    }
  }

  const result = { slug, checked, mismatches: mismatches.length, details: mismatches };

  if (mismatches.length > 0) {
    const staleDrift = mismatches.filter(m => m.direction === 'stale');
    const severity = staleDrift.length >= 2 ? 'error' : 'warning';
    await fireAlert({
      type: 'status_drift',
      severity,
      house: slug,
      message: `Status drift: ${mismatches.length}/${checked} sampled lots have mismatched status (${staleDrift.length} showing as available but ended on source)`,
      meta: { samples: mismatches.slice(0, 3) },
    });
  }

  return result;
}

export async function gatherDataQualityMetrics() {
  if (!_supabase) return {};

  try {
    const { data: cached } = await _supabase
      .from('cached_analyses')
      .select('house, total_lots, lots')
      .gt('expires_at', new Date().toISOString());

    if (!cached || cached.length === 0) return {};

    const metrics = {};
    for (const entry of cached) {
      const slug = entry.house;
      if (!slug || !entry.lots) continue;

      const lots = entry.lots;
      const total = lots.length;
      if (total === 0) continue;

      metrics[slug] = {
        total,
        beds: Math.round(lots.filter(l => l.beds != null).length / total * 100),
        images: Math.round(lots.filter(l => l.imageUrl).length / total * 100),
        price: Math.round(lots.filter(l => l.price != null).length / total * 100),
        address: Math.round(lots.filter(l => l.address && l.address.length > 5).length / total * 100),
      };
    }

    return metrics;
  } catch (e) {
    console.warn('SUB-AGENT: Failed to gather data quality metrics:', e.message);
    return {};
  }
}
