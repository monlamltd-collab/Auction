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
// LOT FRESHNESS AUDIT
// ═══════════════════════════════════════════════════════════════
// Checks if lot detail data (e.g. auction end dates visible on
// individual lot pages) contradicts the calendar status.

export async function auditLotFreshness(slug, lots, calendarDate) {
  if (!lots || lots.length === 0) return null;

  // Check if lot bullets/descriptions mention past dates
  const now = new Date();
  const suspiciousLots = [];

  for (const lot of lots.slice(0, 10)) { // sample first 10
    const text = [
      ...(lot.bullets || []),
      lot.description || '',
      lot.auctionDate || '',
    ].join(' ');

    // Look for date patterns suggesting auction already ended
    const dateMatches = text.match(/(?:ends?|closing|auction)\s*(?:date)?[:\s]*(\d{1,2}[\s/-]\w+[\s/-]\d{2,4})/gi);
    if (dateMatches) {
      for (const m of dateMatches) {
        const parsed = new Date(m.replace(/.*?(\d)/, '$1'));
        if (!isNaN(parsed) && parsed < now) {
          suspiciousLots.push({ lot: lot.lot, text: m, parsed: parsed.toISOString() });
        }
      }
    }
  }

  if (suspiciousLots.length > 0) {
    await fireAlert({
      type: 'lot_freshness',
      severity: 'warning',
      house: slug,
      message: `${suspiciousLots.length} lots appear to reference past auction dates — catalogue may be stale`,
      meta: { samples: suspiciousLots.slice(0, 3) },
    });
  }

  return { slug, suspiciousLots: suspiciousLots.length };
}

// ═══════════════════════════════════════════════════════════════
// GATHER DATA QUALITY METRICS (for manager dashboard)
// ═══════════════════════════════════════════════════════════════
// Scans cached_analyses to produce per-house field coverage stats.
// Designed to be cheap (one Supabase query, no AI).

export async function gatherDataQualityMetrics() {
  if (!_supabase) return {};

  try {
    const { data: cached } = await _supabase
      .from('cached_analyses')
      .select('house_slug, total_lots, lots')
      .gt('expires_at', new Date().toISOString());

    if (!cached || cached.length === 0) return {};

    const metrics = {};
    for (const entry of cached) {
      const slug = entry.house_slug;
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
