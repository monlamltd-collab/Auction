// ═══════════════════════════════════════════════════════════════
// HOUSE DISCOVERY — Proactive new auction house discovery
// ═══════════════════════════════════════════════════════════════

import { fireAlert } from './alert-router.js';

let _supabase = null;
let _callAI = null;

const DISCOVERY_WEEKLY_BUDGET = parseInt(process.env.DISCOVERY_WEEKLY_BUDGET || '20');

// Track weekly credit usage
let _weeklyCreditsUsed = 0;
let _weekResetAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

function checkWeekReset() {
  if (Date.now() > _weekResetAt) {
    _weeklyCreditsUsed = 0;
    _weekResetAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  }
}

export function initDiscovery(supabase, callAI) {
  _supabase = supabase;
  _callAI = callAI;
}

/**
 * Discover new auction houses from known ecosystem.
 * @param {object} existingHouses - HOUSE_ROOTS map { slug: url }
 * @returns {{ candidates: Array<{ name: string, url: string, confidence: number, source: string }> }}
 */
export async function discoverNewHouses(existingHouses = {}) {
  checkWeekReset();
  const existingUrls = new Set(Object.values(existingHouses).map(u => new URL(u).hostname));
  const candidates = [];

  // Strategy 1: AI-powered discovery (if budget allows)
  if (_callAI && _weeklyCreditsUsed < DISCOVERY_WEEKLY_BUDGET) {
    try {
      const slugList = Object.keys(existingHouses).slice(0, 80).join(', ');
      const prompt = `You are an expert on UK property auctions. List 10 UK property auction houses that run online catalogues and are NOT in this list: ${slugList}

For each house, provide:
- name: The auction house name
- url: Their main auction catalogue URL
- region: Where they primarily operate

Return ONLY valid JSON array: [{"name":"...","url":"...","region":"..."}]
Do NOT include houses that are subsidiaries or alternate names for houses in the list.
Focus on smaller regional houses that might be under the radar.`;

      const response = await _callAI(prompt, {
        tier: 'fast',
        maxTokens: 2000,
        taskType: 'discovery',
      });
      _weeklyCreditsUsed++;

      // Parse AI response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        for (const house of parsed) {
          if (!house.url || !house.name) continue;
          try {
            const hostname = new URL(house.url).hostname;
            if (existingUrls.has(hostname)) continue;
            candidates.push({
              name: house.name,
              url: house.url,
              confidence: 0.5, // AI suggestions get medium confidence
              source: 'ai_search',
              region: house.region || null,
              platformFamily: null,
            });
          } catch { /* invalid URL, skip */ }
        }
      }
    } catch (e) {
      console.warn('DISCOVERY: AI search failed:', e.message);
    }
  }

  // Persist candidates to Supabase
  if (_supabase && candidates.length > 0) {
    for (const c of candidates) {
      try {
        await _supabase.from('discovery_candidates').upsert({
          url: c.url,
          name: c.name,
          source: c.source,
          confidence: c.confidence,
          platform_family: c.platformFamily,
          gem_score: scoreCandidate(c),
          status: 'pending',
          discovered_at: new Date().toISOString(),
        }, { onConflict: 'url' });
      } catch (e) {
        // Ignore duplicates
        if (!e.message?.includes('duplicate')) {
          console.warn('DISCOVERY: Failed to persist candidate:', e.message);
        }
      }
    }
  }

  return { candidates };
}

/**
 * Evaluate a candidate to determine if it's a viable auction house.
 * @param {{ url: string, name: string }} candidate
 * @returns {{ viable: boolean, reason: string, lotEstimate: number|null, catalogueUrl: string|null }}
 */
export async function evaluateCandidate(candidate) {
  if (!_callAI) {
    return { viable: false, reason: 'AI not available', lotEstimate: null, catalogueUrl: null };
  }

  checkWeekReset();
  if (_weeklyCreditsUsed >= DISCOVERY_WEEKLY_BUDGET) {
    return { viable: false, reason: 'Weekly discovery budget exhausted', lotEstimate: null, catalogueUrl: null };
  }

  try {
    // Update status to evaluating
    if (_supabase) {
      await _supabase.from('discovery_candidates')
        .update({ status: 'evaluating' })
        .eq('url', candidate.url);
    }

    // Try to fetch the page
    let pageContent = '';
    try {
      const resp = await fetch(candidate.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuctionBrain/1.0)' },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        pageContent = await resp.text();
        pageContent = pageContent.substring(0, 20000); // truncate for AI
      }
    } catch {
      // Site not reachable
      if (_supabase) {
        await _supabase.from('discovery_candidates')
          .update({ status: 'rejected', reject_reason: 'Site not reachable', evaluated_at: new Date().toISOString(), cooldown_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() })
          .eq('url', candidate.url);
      }
      return { viable: false, reason: 'Site not reachable', lotEstimate: null, catalogueUrl: null };
    }

    // Ask AI to evaluate
    const prompt = `Evaluate this website: ${candidate.url}
Name: ${candidate.name}

Page content (truncated):
${pageContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 8000)}

Questions:
1. Is this a UK property auction house with an online catalogue?
2. Approximately how many lots are visible?
3. What platform does it appear to use? (EIG/SDL/Auction Hammer/custom)
4. What is the direct URL to their auction catalogue/lots page?

Return JSON: {"isAuction":true/false,"lotEstimate":N,"platform":"...","catalogueUrl":"...","reason":"..."}`;

    const response = await _callAI(prompt, {
      tier: 'fast',
      maxTokens: 1000,
      taskType: 'discovery',
    });
    _weeklyCreditsUsed++;

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { viable: false, reason: 'Could not parse AI evaluation', lotEstimate: null, catalogueUrl: null };
    }

    const eval_ = JSON.parse(jsonMatch[0]);
    const viable = eval_.isAuction === true && (eval_.lotEstimate || 0) > 0;

    // Update candidate in Supabase
    if (_supabase) {
      await _supabase.from('discovery_candidates')
        .update({
          status: viable ? 'pending' : 'rejected',
          reject_reason: viable ? null : (eval_.reason || 'Not a viable auction house'),
          est_lots: eval_.lotEstimate || null,
          platform_family: eval_.platform || null,
          evaluated_at: new Date().toISOString(),
          cooldown_until: viable ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('url', candidate.url);
    }

    return {
      viable,
      reason: eval_.reason || (viable ? 'Viable auction house' : 'Not viable'),
      lotEstimate: eval_.lotEstimate || null,
      catalogueUrl: eval_.catalogueUrl || null,
    };
  } catch (e) {
    console.warn('DISCOVERY: Evaluation failed:', e.message);
    return { viable: false, reason: `Evaluation error: ${e.message}`, lotEstimate: null, catalogueUrl: null };
  }
}

/**
 * Score a discovery candidate by "rare gems" value.
 */
function scoreCandidate(candidate) {
  let score = 50; // base

  // Size inverse bonus: smaller houses score higher
  if (candidate.estLots && candidate.estLots < 20) score += 20;
  else if (candidate.estLots && candidate.estLots < 50) score += 10;

  // Platform family bonus: known platform = cheap to add
  if (candidate.platformFamily && candidate.platformFamily !== 'custom') score += 15;

  // Source bonus: AI discovery is less reliable than link harvest
  if (candidate.source === 'link_harvest') score += 10;
  if (candidate.source === 'directory') score += 15;

  return Math.min(100, score);
}

/**
 * Get pending discovery candidates.
 */
export async function getDiscoveryQueue() {
  if (!_supabase) return [];
  try {
    const { data } = await _supabase.from('discovery_candidates')
      .select('*')
      .in('status', ['pending', 'evaluating'])
      .order('gem_score', { ascending: false })
      .limit(50);
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Approve a discovery candidate.
 */
export async function approveCandidate(url) {
  if (!_supabase) return false;
  try {
    const { error } = await _supabase.from('discovery_candidates')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('url', url);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Get weekly budget status.
 */
export function getDiscoveryBudget() {
  checkWeekReset();
  return {
    used: _weeklyCreditsUsed,
    budget: DISCOVERY_WEEKLY_BUDGET,
    remaining: DISCOVERY_WEEKLY_BUDGET - _weeklyCreditsUsed,
    resetsAt: new Date(_weekResetAt).toISOString(),
  };
}
