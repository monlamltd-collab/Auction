// ═══════════════════════════════════════════════════════════════
// MANAGER — Autonomous orchestrator for the harness
// ═══════════════════════════════════════════════════════════════
// Periodically reviews all harness metrics, decides what needs
// attention, and dispatches work. Runs at the end of autoAnalyseAll().

import { fireAlert, getUnresolved } from './alert-router.js';
import { getAllHealth, getHealth, getBaseline, setCircuitState } from './house-health.js';
import { getDiscoveryQueue, evaluateCandidate, discoverNewHouses, getDiscoveryBudget } from './house-discovery.js';
import { generateExtractor, repairExtractor, getGeneratorLog } from './extractor-generator.js';
import { initSubAgents, resetSubAgentBudget, auditDataQuality, auditCalendarStaleness, gatherDataQualityMetrics } from './sub-agents.js';

let _supabase = null;
let _callAI = null;
let _deps = {};

// Manager state
let _cycleNumber = 0;
let _lastReport = null;
let _lastDirectives = null;
const _effectivenessHistory = []; // last N cycle scores

// Config (overridable)
let _config = {
  enabled: (process.env.MANAGER_ENABLED || 'true') === 'true',
  cycleBudgetFC: parseInt(process.env.MANAGER_CYCLE_BUDGET_FC || '30'),
  cycleBudgetAI: parseInt(process.env.MANAGER_CYCLE_BUDGET_AI || '5'),
  autoApprove: (process.env.MANAGER_AUTO_APPROVE || 'false') === 'true',
  autoDeployExtractors: (process.env.MANAGER_AUTO_DEPLOY_EXTRACTORS || 'true') === 'true',
  logLevel: process.env.MANAGER_LOG_LEVEL || 'actions_only',
  useAI: (process.env.MANAGER_USE_AI || 'true') === 'true',
  cycleBudgetReasoning: parseInt(process.env.MANAGER_CYCLE_BUDGET_REASONING || '2'),
};

// ── Default directives (used when AI is off or fails) ──
const DEFAULT_DIRECTIVES = {
  dom_concurrency: 10,
  gemini_concurrency: 3,
  priority_houses: [],
  skip_houses: [],
  skip_reasons: {},
};

/**
 * Initialize the manager with all harness module dependencies.
 */
export function initManager(deps) {
  _supabase = deps.supabase;
  _callAI = deps.callAI;
  _deps = deps;
  initSubAgents({ supabase: deps.supabase, callAI: deps.callAI });
}

// ── AI Manager: Dashboard + Reasoning ──

async function buildManagerDashboard() {
  const allHealth = getAllHealth();
  const grouped = { healthy: [], degraded: [], broken: [] };
  for (const [slug, h] of Object.entries(allHealth)) {
    if (h.status === 'broken' || h.health < 20) {
      grouped.broken.push({ slug, health: h.health, failures: h.consecutiveFailures, lots: h.averageLotCount });
    } else if (h.status === 'degraded' || h.health < 50) {
      grouped.degraded.push({ slug, health: h.health, failures: h.consecutiveFailures, lots: h.averageLotCount });
    } else {
      grouped.healthy.push({ slug, lots: h.averageLotCount });
    }
  }

  // Gather data quality metrics (per-house field coverage %)
  const dataQuality = await gatherDataQualityMetrics();
  // Surface houses with poor coverage (any key field < 50%)
  const poorQuality = {};
  for (const [slug, m] of Object.entries(dataQuality)) {
    if (m.beds < 50 || m.images < 50 || m.price < 50) {
      poorQuality[slug] = m;
    }
  }

  return JSON.stringify({
    timestamp: new Date().toISOString(),
    cycle: _cycleNumber + 1,
    health: {
      healthy: grouped.healthy.length,
      degraded: grouped.degraded.map(h => ({ slug: h.slug, health: h.health, failures: h.failures, lots: h.lots })),
      broken: grouped.broken.map(h => ({ slug: h.slug, health: h.health, failures: h.failures, lots: h.lots })),
    },
    data_quality: Object.keys(poorQuality).length > 0 ? poorQuality : 'all_adequate',
    previous_effectiveness: _effectivenessHistory.slice(-3),
    budget: { ai_calls: _config.cycleBudgetAI, fc_credits: _config.cycleBudgetFC },
  });
}

async function callManagerAI(dashboard) {
  if (!_callAI) throw new Error('callAI not available');

  const systemPrompt = `You are the pipeline manager for a UK property auction scraping system.
You receive a health dashboard (including data quality metrics) and must return JSON directives to optimise the next scrape cycle.

Available actions in corrective_actions:
- {"type": "heal_url", "house": "slug", "reason": "why"} — fix a broken catalogue URL
- {"type": "open_circuit", "house": "slug", "reason": "why"} — stop scraping a broken house
- {"type": "repair_extractor", "house": "slug", "reason": "why"} — repair a failing DOM extractor
- {"type": "audit_data_quality", "house": "slug", "reason": "why"} — dispatch sub-agent to diagnose poor field coverage (beds, images, price missing). Use when data_quality shows a house with key fields below 50%.

The data_quality section shows per-house field coverage percentages (beds, images, price, address). "all_adequate" means no house has key fields below 50%. When houses appear here, consider dispatching audit_data_quality for the worst offenders (max 2 per cycle).

Respond with ONLY valid JSON matching this schema:
{
  "pipeline_directives": {
    "dom_concurrency": <number 5-20>,
    "gemini_concurrency": <number 1-8>,
    "priority_houses": [<slugs to process first>],
    "skip_houses": [<slugs to skip this cycle>],
    "skip_reasons": {<slug>: <reason>}
  },
  "corrective_actions": [<action objects>],
  "observations": "<brief strategic notes>"
}`;

  // Use capable tier (Gemini Pro free) by default; reasoning tier (Claude Opus) if CLAUDE_API_KEY is set
  const tier = process.env.CLAUDE_API_KEY ? 'reasoning' : 'capable';
  const text = await _callAI(dashboard, {
    tier,
    taskType: 'manager',
    maxTokens: 2000,
    systemPrompt,
    budgetExempt: true,
  });

  // Parse JSON from response (handle markdown code fences)
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Run a full manager review cycle.
 * Called at the end of autoAnalyseAll() or manually via admin endpoint.
 * Uses the 'capable' AI tier for all decisions (strongest model available).
 * @returns {ManagerReport}
 */
export async function runManagerCycle() {
  if (!_config.enabled) {
    return { cycle: _cycleNumber, skipped: true, reason: 'Manager disabled' };
  }

  const startTime = Date.now();
  _cycleNumber++;

  const report = {
    cycle: _cycleNumber,
    timestamp: new Date().toISOString(),
    duration_ms: 0,
    houses_reviewed: 0,
    actions_taken: [],
    actions_skipped: [],
    health_summary: { healthy: 0, degraded: 0, broken: 0 },
    effectiveness_score: 0,
    budget_used: { ai_calls: 0, fc_credits: 0 },
    budget_remaining: { ai_calls: _config.cycleBudgetAI, fc_credits: _config.cycleBudgetFC },
    next_priorities: [],
  };

  const budget = { ai: _config.cycleBudgetAI, fc: _config.cycleBudgetFC };
  resetSubAgentBudget();

  try {
    // ── 0. AI REASONING (if enabled) ──
    let aiDirectives = null;
    if (_config.useAI && _callAI) {
      try {
        const dashboard = await buildManagerDashboard();
        const aiResult = await callManagerAI(dashboard);
        aiDirectives = aiResult;

        // Store directives for pipeline consumption
        _lastDirectives = aiResult.pipeline_directives || DEFAULT_DIRECTIVES;
        report.ai_directives = aiResult.pipeline_directives;
        report.ai_observations = aiResult.observations;

        console.log(`MANAGER: AI reasoning complete — concurrency dom=${_lastDirectives.dom_concurrency} gemini=${_lastDirectives.gemini_concurrency}, ${(aiResult.corrective_actions || []).length} corrective actions`);

        // Execute AI's corrective actions through existing machinery
        for (const action of (aiResult.corrective_actions || [])) {
          if (action.type === 'heal_url' && action.house && _deps.healBrokenHouse) {
            try {
              const rootUrl = _deps.houseRoots?.[action.house];
              if (rootUrl) {
                const healed = await _deps.healBrokenHouse(action.house, rootUrl);
                report.actions_taken.push({ type: 'ai_heal_url', house: action.house, result: healed ? 'success' : 'failed', detail: action.reason });
              }
            } catch (e) {
              report.actions_taken.push({ type: 'ai_heal_url', house: action.house, result: 'error', detail: e.message });
            }
          } else if (action.type === 'open_circuit' && action.house) {
            setCircuitState(action.house, 'open');
            report.actions_taken.push({ type: 'ai_open_circuit', house: action.house, result: 'success', detail: action.reason });
          } else if (action.type === 'audit_data_quality' && action.house && _supabase) {
            try {
              // Fetch lots for this house from cache
              const { data: cached } = await _supabase
                .from('cached_analyses')
                .select('lots')
                .eq('house_slug', action.house)
                .gt('expires_at', new Date().toISOString())
                .single();
              if (cached?.lots) {
                const auditResult = await auditDataQuality(action.house, cached.lots);
                report.actions_taken.push({
                  type: 'ai_audit_data_quality', house: action.house,
                  result: auditResult ? 'success' : 'skipped',
                  detail: auditResult?.recommendation || action.reason,
                });
              } else {
                report.actions_taken.push({ type: 'ai_audit_data_quality', house: action.house, result: 'skipped', detail: 'No cached lots found' });
              }
            } catch (e) {
              report.actions_taken.push({ type: 'ai_audit_data_quality', house: action.house, result: 'error', detail: e.message });
            }
          }
        }
      } catch (aiErr) {
        console.warn(`MANAGER: AI reasoning failed, falling back to rule-based — ${aiErr.message}`);
        _lastDirectives = { ...DEFAULT_DIRECTIVES };
      }
    } else {
      _lastDirectives = { ...DEFAULT_DIRECTIVES };
    }

    // ── 1. REVIEW HEALTH ──
    const allHealth = getAllHealth();
    const healthEntries = Object.entries(allHealth);
    report.houses_reviewed = healthEntries.length;

    const broken = [];
    const degraded = [];
    const declining = [];

    for (const [slug, h] of healthEntries) {
      if (h.status === 'broken' || h.health < 20) {
        broken.push({ slug, ...h });
        report.health_summary.broken++;
      } else if (h.status === 'degraded' || h.health < 50) {
        degraded.push({ slug, ...h });
        report.health_summary.degraded++;
      } else {
        report.health_summary.healthy++;
      }
    }

    // ── 2. REVIEW UNRESOLVED ALERTS ──
    const unresolvedAlerts = await getUnresolved();
    const alertsByHouse = {};
    for (const alert of unresolvedAlerts) {
      if (!alert.house) continue;
      if (!alertsByHouse[alert.house]) alertsByHouse[alert.house] = [];
      alertsByHouse[alert.house].push(alert);
    }

    // ── 3. BUILD ACTION QUEUE (prioritized) ──
    const actions = [];

    // Broken houses → heal URL
    for (const h of broken) {
      if (h.consecutiveFailures >= 2 && _deps.healBrokenHouse) {
        actions.push({
          type: 'heal_url',
          house: h.slug,
          priority: _computePriority(h.averageLotCount, h.consecutiveFailures, 1, 0),
          cost: { ai: 1, fc: 2 },
          execute: () => _executeHealUrl(h.slug),
        });
      }
      // Open circuit for broken houses still being scraped
      if (h.circuitBreaker !== 'open' && h.health < 20) {
        actions.push({
          type: 'open_circuit',
          house: h.slug,
          priority: 100, // high priority, zero cost
          cost: { ai: 0, fc: 0 },
          execute: () => {
            setCircuitState(h.slug, 'open');
            return { success: true };
          },
        });
      }
    }

    // Degraded houses → repair extractor
    for (const h of degraded) {
      if (h.consecutiveFailures >= 3) {
        actions.push({
          type: 'repair_extractor',
          house: h.slug,
          priority: _computePriority(h.averageLotCount, h.consecutiveFailures, 1, 0),
          cost: { ai: 1, fc: 0 },
          execute: () => _executeRepairExtractor(h.slug),
        });
      }
    }

    // Unresolved alerts >72h → escalate
    const now = Date.now();
    for (const alert of unresolvedAlerts) {
      if (!alert.created_at) continue;
      const age = now - new Date(alert.created_at).getTime();
      if (age > 72 * 60 * 60 * 1000 && alert.severity === 'warning') {
        actions.push({
          type: 'escalate_alert',
          house: alert.house,
          priority: 30,
          cost: { ai: 0, fc: 0 },
          execute: async () => {
            await fireAlert({
              type: alert.event_type,
              severity: 'error',
              house: alert.house,
              message: `[AUTO-ESCALATED after 72h] ${alert.message}`,
            });
            return { success: true };
          },
        });
      }
    }

    // Discovery: evaluate pending candidates
    const discoveryQueue = await getDiscoveryQueue();
    for (const candidate of discoveryQueue.slice(0, 3)) {
      if (candidate.status === 'pending') {
        const age = now - new Date(candidate.discovered_at).getTime();
        if (age > 24 * 60 * 60 * 1000) {
          actions.push({
            type: 'evaluate_candidate',
            house: candidate.name || candidate.url,
            priority: 20 + (candidate.gem_score || 0) / 10,
            cost: { ai: 1, fc: 0 },
            execute: () => evaluateCandidate(candidate),
          });
        }
      }
    }

    // Discovery: run proactive discovery
    if (_deps.houseRoots && budget.ai > 0) {
      actions.push({
        type: 'discover_houses',
        house: null,
        priority: 10,
        cost: { ai: 1, fc: 0 },
        execute: () => discoverNewHouses(_deps.houseRoots),
      });
    }

    // ── 4. SORT BY PRIORITY, EXECUTE WITHIN BUDGET ──
    actions.sort((a, b) => b.priority - a.priority);

    for (const action of actions) {
      // Budget check
      if (action.cost.ai > budget.ai || action.cost.fc > budget.fc) {
        report.actions_skipped.push({
          type: action.type,
          house: action.house,
          reason: 'budget_exhausted',
        });
        if (!report.next_priorities.some(p => p.includes(action.house))) {
          report.next_priorities.push(`${action.house}: ${action.type} (deferred — budget)`);
        }
        continue;
      }

      // Execute
      try {
        const result = await action.execute();
        budget.ai -= action.cost.ai;
        budget.fc -= action.cost.fc;
        report.budget_used.ai_calls += action.cost.ai;
        report.budget_used.fc_credits += action.cost.fc;

        report.actions_taken.push({
          type: action.type,
          house: action.house,
          result: result?.success !== false ? 'success' : 'failed',
          cost: action.cost,
          detail: result?.reason || result?.detail || null,
        });
      } catch (e) {
        report.actions_taken.push({
          type: action.type,
          house: action.house,
          result: 'error',
          cost: { ai: 0, fc: 0 },
          detail: e.message,
        });
      }
    }

    // ── 4.5. CALENDAR STALENESS CHECK (rule-based, no AI cost) ──
    if (_supabase) {
      try {
        const { data: calEntries } = await _supabase
          .from('auction_calendar')
          .select('house, house_slug, date, url, status')
          .neq('status', 'always_on');
        if (calEntries && calEntries.length > 0) {
          const staleResult = await auditCalendarStaleness(calEntries);
          if (staleResult.stale.length > 0) {
            report.actions_taken.push({
              type: 'calendar_staleness_check',
              house: null,
              result: 'success',
              detail: `${staleResult.stale.length} stale entries found`,
            });
          }
        }
      } catch (e) {
        // Non-fatal
      }
    }

    // ── 5. SELF-REFLECTION ──
    report.budget_remaining = { ai_calls: budget.ai, fc_credits: budget.fc };
    report.duration_ms = Date.now() - startTime;
    report.effectiveness_score = _computeEffectiveness(report);

    _effectivenessHistory.push(report.effectiveness_score);
    if (_effectivenessHistory.length > 10) _effectivenessHistory.shift();

    // Manager ineffectiveness alert
    if (_effectivenessHistory.length >= 3) {
      const last3 = _effectivenessHistory.slice(-3);
      if (last3.every(s => s < 0.3)) {
        await fireAlert({
          type: 'manager_ineffective',
          severity: 'warning',
          house: null,
          message: `Manager effectiveness below 30% for ${last3.length} consecutive cycles. Human review recommended.`,
        });
      }
    }

    // ── 6. PERSIST CYCLE REPORT ──
    if (_supabase) {
      try {
        await _supabase.from('manager_cycles').insert({
          cycle_number: report.cycle,
          duration_ms: report.duration_ms,
          actions_taken: report.actions_taken,
          actions_skipped: report.actions_skipped,
          health_summary: report.health_summary,
          effectiveness_score: report.effectiveness_score,
          budget_used: report.budget_used,
          ai_directives: report.ai_directives || null,
        });
      } catch (e) {
        console.warn('MANAGER: Failed to persist cycle report:', e.message);
      }
    }

  } catch (e) {
    console.error('MANAGER: Cycle error:', e.message);
    report.actions_taken.push({
      type: 'flag_for_human',
      house: null,
      result: 'error',
      detail: `Manager cycle failed: ${e.message}`,
    });
  }

  _lastReport = report;
  console.log(`MANAGER: Cycle ${report.cycle} complete — ${report.actions_taken.length} actions, effectiveness ${report.effectiveness_score.toFixed(2)}, ${report.duration_ms}ms`);

  return report;
}

/**
 * Get the last manager cycle report.
 */
export function getManagerReport() {
  return _lastReport;
}

/**
 * Get the latest pipeline directives from AI manager (or defaults).
 * Called by server.js to configure wave concurrency.
 */
export function getManagerDirectives() {
  return _lastDirectives || { ...DEFAULT_DIRECTIVES };
}

/**
 * Update manager config.
 */
export function setManagerConfig(overrides) {
  _config = { ..._config, ...overrides };
  return _config;
}

/**
 * Get current manager config.
 */
export function getManagerConfig() {
  return { ..._config };
}

// ── Internal helpers ──

function _computePriority(lotCount, urgencyDays, aiCost, fcCost) {
  const impact = Math.log2(Math.max(1, lotCount)) * 10; // larger houses = more impact
  const urgency = Math.min(urgencyDays * 5, 50);
  const cost = Math.max(1, aiCost + fcCost);
  return Math.round((impact + urgency) / cost);
}

function _computeEffectiveness(report) {
  const taken = report.actions_taken.length;
  if (taken === 0) return 0.5; // no actions needed = neutral

  const succeeded = report.actions_taken.filter(a => a.result === 'success').length;
  return Math.round((succeeded / taken) * 100) / 100;
}

async function _executeHealUrl(slug) {
  if (!_deps.healBrokenHouse || !_deps.houseRoots) {
    return { success: false, reason: 'healBrokenHouse not available' };
  }
  const rootUrl = _deps.houseRoots[slug];
  if (!rootUrl) return { success: false, reason: 'No root URL' };

  try {
    const healedUrl = await _deps.healBrokenHouse(slug, rootUrl);
    if (healedUrl) {
      // Close circuit on successful heal
      setCircuitState(slug, 'closed');
      return { success: true, detail: `Healed to ${healedUrl}` };
    }
    return { success: false, reason: 'Healing returned no URL' };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

async function _executeRepairExtractor(slug) {
  if (!_deps.domExtractors || !_deps.domExtractors[slug]) {
    return { success: false, reason: 'No existing extractor to repair' };
  }

  const baseline = getBaseline(slug);
  const result = await repairExtractor(
    slug,
    _deps.domExtractors[slug],
    '', // would need sample HTML from last scrape — not available here
    `Consecutive failures: ${getHealth(slug).consecutiveFailures}, avg lots: ${baseline.averageLotCount}`,
  );

  if (result.code && result.testResult && result.testResult.lots > 0) {
    if (_config.autoDeployExtractors) {
      // Deploy in-memory (takes effect immediately for next scrape)
      _deps.domExtractors[slug] = result.code;
      await fireAlert({
        type: 'extractor_repaired',
        severity: 'info',
        house: slug,
        message: `Extractor auto-repaired: ${result.testResult.lots} lots in test`,
      });
      return { success: true, detail: `Repaired, ${result.testResult.lots} lots in test` };
    }
    return { success: true, detail: 'Repair generated but auto-deploy disabled' };
  }

  return { success: false, reason: 'Repair attempt failed' };
}
