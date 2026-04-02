// ═══════════════════════════════════════════════════════════════
// ALERT ROUTER — Unified alert dispatch with dedup + escalation
// ═══════════════════════════════════════════════════════════════

let _supabase = null;

// In-memory dedup map: `${house}:${type}` → { lastFired, count }
const _dedupMap = new Map();
const DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

// Escalation tracking: `${house}:${type}` → { fires: number, firstFired: Date }
const _escalationMap = new Map();
const ESCALATION_THRESHOLD = 3;
const ESCALATION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export function initAlerts(supabase) {
  _supabase = supabase;
}

/**
 * Fire a deduplicated alert.
 * @param {{ type: string, severity: string, house: string|null, message: string, meta?: object }} alert
 * @returns {{ fired: boolean, suppressed: boolean, escalated: boolean }}
 */
export async function fireAlert({ type, severity = 'warning', house = null, message, meta = {} }) {
  const key = `${house || '_system'}:${type}`;
  const now = Date.now();

  // Deduplication check
  const existing = _dedupMap.get(key);
  if (existing && (now - existing.lastFired) < DEDUP_WINDOW_MS) {
    existing.count++;
    return { fired: false, suppressed: true, escalated: false };
  }

  // Update dedup map
  _dedupMap.set(key, { lastFired: now, count: 1 });

  // Escalation check
  let escalated = false;
  const escEntry = _escalationMap.get(key) || { fires: 0, firstFired: now };
  escEntry.fires++;
  if (escEntry.fires >= ESCALATION_THRESHOLD && (now - escEntry.firstFired) <= ESCALATION_WINDOW_MS) {
    if (severity === 'warning') {
      severity = 'error';
      escalated = true;
      message = `[ESCALATED] ${message}`;
    }
  }
  _escalationMap.set(key, escEntry);

  // Persist to Supabase
  if (_supabase) {
    try {
      await _supabase.from('pipeline_alerts').insert({
        event_type: type,
        severity,
        house,
        message: meta ? `${message} | ${JSON.stringify(meta)}` : message,
      });
    } catch (e) {
      console.warn('ALERT-ROUTER: Failed to persist alert:', e.message);
    }
  }

  console.warn(`ALERT [${severity}] ${house || 'system'}: ${type} — ${message}`);

  return { fired: true, suppressed: false, escalated };
}

/**
 * Resolve all alerts for a house/type combination.
 */
export async function resolveAlert(house, type) {
  // Clear dedup and escalation state
  const key = `${house || '_system'}:${type}`;
  _dedupMap.delete(key);
  _escalationMap.delete(key);

  if (_supabase) {
    try {
      await _supabase.from('pipeline_alerts')
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq('house', house)
        .eq('event_type', type)
        .eq('resolved', false);
    } catch (e) {
      console.warn('ALERT-ROUTER: Failed to resolve alert:', e.message);
    }
  }
}

/**
 * Get unresolved alerts, optionally filtered by house.
 */
export async function getUnresolved(house = null) {
  if (!_supabase) return [];
  try {
    let query = _supabase.from('pipeline_alerts')
      .select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(100);
    if (house) query = query.eq('house', house);
    const { data } = await query;
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Get dedup stats (for admin/debugging).
 */
export function getDedupStats() {
  const stats = {};
  for (const [key, val] of _dedupMap) {
    stats[key] = { ...val, lastFired: new Date(val.lastFired).toISOString() };
  }
  return stats;
}
