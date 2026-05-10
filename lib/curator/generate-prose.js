// ═══════════════════════════════════════════════════════════════
// CURATOR — generateProse()
// ═══════════════════════════════════════════════════════════════
// Calls the AI provider (Gemini Pro by default) with a tightly-constrained
// prompt that turns one curated lot into investor-facing prose. Output is
// strict JSON: { headline, prose, hook }.
//
// Tone discipline is baked into the prompt (no marketing fluff, no emoji,
// no invented figures). The prompt receives ONLY the data we already have
// in the database — the model cannot recommend anything that isn't grounded
// in the input. If hallucination still happens, the manual approval gate
// catches it.

import { callAI } from '../ai-provider.js';
import { queryHPI } from '../land-registry-hpi.js';
import { log } from '../logging.js';

const SYSTEM_PROMPT = `You are an investment analyst writing for UK property auction buyers.

Your job: turn one auction lot's structured data into a concise, investor-grade analysis.

Hard rules:
- Never invent figures. Use only numbers passed in the input.
- No marketing language. No "Don't miss out!", no "stunning", no exclamation marks.
- No emoji. No ALL CAPS. Plain analytical prose.
- Reference specific signals — "£/sqft vs area average", "fundability via N lenders", "scored X/10 because Y".
- Acknowledge risks honestly. Sitting tenant, knotweed, leasehold-with-short-term — name them.
- Output strict JSON only. No prose preamble, no markdown fences.

Output schema (strict):
{
  "headline": "8-12 word headline, sentence case, no full stop",
  "prose": "180-220 word analysis, plain prose, no markdown",
  "hook": "single-sentence LinkedIn hook, under 240 chars, no hashtags"
}`;

/**
 * Generate curator prose for one lot.
 *
 * @param {object} lot - Frontend-shape lot (dbRowToFrontendLot output)
 * @param {object} [deps] - Optional dependency overrides for testing
 * @param {Function} [deps.callAI] - Override the AI call (test stub)
 * @param {Function} [deps.queryHPI] - Override HPI lookup
 * @returns {Promise<{ headline: string, prose: string, hook: string } | null>}
 *   Returns null on irrecoverable failure (caller decides what to do).
 */
export async function generateProse(lot, deps = {}) {
  const _callAI = deps.callAI || callAI;
  const _queryHPI = deps.queryHPI || queryHPI;

  if (!lot || !lot.address || !lot.price) {
    log.warn('curator.generateProse: lot missing address or price — skipping', { lotId: lot?._dbId });
    return null;
  }

  // Best-effort HPI context — failure is non-fatal, just omits area context
  let hpi = null;
  try {
    if (lot.postcode) {
      // postcodes-io is needed for area-code lookup, but we only have postcode
      // here. Pass areaName fallback derived from address (last comma-separated
      // token usually = town). HPI's by-name lookup uses ilike.
      const areaName = lastNonPostcodeToken(lot.address);
      if (areaName) {
        const hpiResult = await _queryHPI({ areaName });
        if (hpiResult.status === 'ok') hpi = hpiResult;
      }
    }
  } catch (e) {
    log.warn('curator.generateProse: HPI lookup failed (non-fatal)', { lotId: lot._dbId, err: e.message });
  }

  const prompt = buildPrompt(lot, hpi);

  let raw;
  try {
    raw = await _callAI(prompt, {
      tier: 'capable',     // Gemini Pro for the longer-form reasoning
      maxTokens: 800,
      systemPrompt: SYSTEM_PROMPT,
      taskType: 'curator_prose',
    });
  } catch (e) {
    log.warn('curator.generateProse: callAI failed', { lotId: lot._dbId, err: e.message });
    return null;
  }

  const parsed = parseProseJson(raw);
  if (!parsed) {
    log.warn('curator.generateProse: model returned unparseable JSON', { lotId: lot._dbId, sample: String(raw).slice(0, 200) });
    return null;
  }

  // Light validation — discard obvious failures so a bad row never reaches admin review
  if (!parsed.headline || parsed.headline.length < 6 || parsed.headline.length > 140) return null;
  if (!parsed.prose || parsed.prose.length < 100 || parsed.prose.length > 2000) return null;
  if (!parsed.hook || parsed.hook.length < 10 || parsed.hook.length > 280) return null;

  return parsed;
}

// ── Build the prompt: structured, no narrative, no fluff ──
export function buildPrompt(lot, hpi) {
  const lines = [];
  lines.push('Lot data (use only these facts — do not invent):');
  lines.push(`  address: ${lot.address}`);
  lines.push(`  price: £${Number(lot.price).toLocaleString('en-GB')}${lot.priceText && lot.priceText !== `£${Number(lot.price).toLocaleString('en-GB')}` ? ` (${lot.priceText})` : ''}`);
  if (lot.propType) lines.push(`  property_type: ${lot.propType}`);
  if (lot.beds != null) lines.push(`  bedrooms: ${lot.beds}`);
  if (lot.tenure) lines.push(`  tenure: ${lot.tenure}`);
  if (lot.condition) lines.push(`  condition: ${lot.condition}`);
  if (lot.sqft) lines.push(`  sqft: ${lot.sqft} (£${Math.round(lot.price / lot.sqft)}/sqft)`);
  if (lot.epcRating) lines.push(`  epc: ${lot.epcRating}${lot.epcScore != null ? ` (${lot.epcScore})` : ''}`);
  if (lot.floodZone) lines.push(`  flood_zone: ${lot.floodZone}`);
  lines.push(`  auction_date: ${lot._auctionDate || 'unknown'}`);
  lines.push(`  auction_house: ${lot._house || 'unknown'}`);
  lines.push(`  score: ${lot.score != null ? lot.score.toFixed(1) : 'unscored'}/10`);

  if (Array.isArray(lot.opps) && lot.opps.length) {
    lines.push(`  opportunities: ${lot.opps.join(' · ')}`);
  }
  if (Array.isArray(lot.risks) && lot.risks.length) {
    lines.push(`  risks: ${lot.risks.join(' · ')}`);
  }
  if (Array.isArray(lot.scoreBreakdown) && lot.scoreBreakdown.length) {
    const parts = lot.scoreBreakdown.map(b => `${b.signal} (${b.pts > 0 ? '+' : ''}${b.pts})`).join(' · ');
    lines.push(`  score_breakdown: ${parts}`);
  }

  if (lot.fundability && lot.fundability.lenderCount != null) {
    lines.push(`  fundability: ${lot.fundability.lenderCount} eligible lenders at ${lot.fundability.ltv}% LTV via BridgeMatch`);
  }

  if (hpi && hpi.latest) {
    const latest = hpi.latest;
    lines.push(`  area_context: ${latest.area_name} avg £${Number(latest.average_price).toLocaleString('en-GB')}, 12m change ${hpi.yoy != null ? hpi.yoy.toFixed(1) + '%' : 'n/a'}`);
    if (latest.terraced_price) lines.push(`  area_terraced_avg: £${Number(latest.terraced_price).toLocaleString('en-GB')}`);
    if (latest.flat_price && lot.propType === 'flat') lines.push(`  area_flat_avg: £${Number(latest.flat_price).toLocaleString('en-GB')}`);
  }

  if (Array.isArray(lot.bullets) && lot.bullets.length) {
    lines.push('  source_bullets:');
    for (const b of lot.bullets.slice(0, 8)) lines.push(`    - ${String(b).slice(0, 200)}`);
  }

  lines.push('');
  lines.push('Write the analysis as JSON per the schema.');
  return lines.join('\n');
}

// ── JSON extractor: strips ```json fences, finds the first { ... } block ──
export function parseProseJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim();
  // Strip code fences if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Find the outermost JSON object — handles models that prepend a sentence
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (!obj || typeof obj !== 'object') return null;
    return {
      headline: typeof obj.headline === 'string' ? obj.headline.trim() : '',
      prose: typeof obj.prose === 'string' ? obj.prose.trim() : '',
      hook: typeof obj.hook === 'string' ? obj.hook.trim() : '',
    };
  } catch {
    return null;
  }
}

function lastNonPostcodeToken(address) {
  if (!address) return null;
  const POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
  const tokens = address.split(',').map(t => t.trim()).filter(Boolean);
  // Walk back from the end, skipping postcodes and 'United Kingdom'
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (POSTCODE_RE.test(t)) continue;
    if (/^(?:uk|united kingdom|england|wales|scotland|n\.? ?ireland)$/i.test(t)) continue;
    return t;
  }
  return null;
}
