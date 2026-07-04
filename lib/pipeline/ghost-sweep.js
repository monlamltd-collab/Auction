// lib/pipeline/ghost-sweep.js — Daily portfolio-freshness sweep.
//
// Kills the two stale-lot classes the 2026-07-04 portfolio audit found being
// SERVED to users (get_active_lots keeps 'available' lots visible for its
// whole last_seen window, so anything the prune misses lingers in the feed):
//
//   GHOSTS (696 found, 54 houses): the house has been scraped recently, but
//   the lot hasn't been re-seen — it vanished from the catalogue without the
//   snapshot-diff prune catching it. Root cause is usually lot-URL identity
//   churn (site rebuild / host or path variants) orphaning rows outside the
//   prune's per-catalogue scope — e.g. the mid-June Auction House franchise
//   skin rebuild. This sweep is CAUSE-AGNOSTIC: whatever creates a ghost,
//   "house scraped, lot unseen for N days" retires it.
//
//   PAST-DATED (265 found): 'available' lots whose auction happened and whose
//   status the post-auction/same-day sweeps never transitioned. Conservative
//   double guard (auction long past AND lot long unseen) so a stale-date
//   stamping bug (the PR #90 class) on a genuinely live lot can't hide it.
//
// Semantics mirror the persist-lots prune exactly: status -> 'withdrawn' with
// removed_reason + removed_at, lot_vanished + lot_status_changed events. The
// per-house safety gate mirrors the prune's regression gate: if a house has
// fewer FRESH lots than would-be ghosts, the scrape is probably partial —
// hold the flips and alert rather than hide real lots (recall > cleanliness).
//
// All I/O injected (deps) — unit-testable, no circular imports.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// A house counts as "actively scraped" when ANY of its lots was re-seen this
// recently — the freshness stack (#154/#155) guarantees ≤48h attempts, so a
// house outside this window is stalled and must NOT be swept (its lots are
// unconfirmed, not gone).
const HOUSE_SCRAPED_WITHIN_HOURS = 48;

// A lot is a ghost when the house is actively scraped but the lot itself has
// not been re-seen for this many days (default 4 — two full daily passes plus
// slack, and well past the pulse's hourly cadence).
export function ghostUnseenDays() {
  const n = parseFloat(process.env.GHOST_SWEEP_UNSEEN_DAYS || '');
  return Number.isFinite(n) && n > 0 ? n : 4;
}

/**
 * Pure classification (exported for tests).
 *
 * @param {{
 *   rows: Array<{id: string, house: string, last_seen_at: string, auction_date?: string|null, status: string}>,
 *   nowMs: number,
 *   unseenDays?: number,
 * }} p
 * @returns {{
 *   ghostFlips: Array<object>, pastDatedFlips: Array<object>,
 *   held: Array<{house: string, ghosts: number, fresh: number}>,
 *   houseStats: Map<string, {fresh: number, ghosts: number, maxSeenMs: number}>,
 * }}
 */
export function classifyGhosts({ rows, nowMs, unseenDays = ghostUnseenDays() }) {
  const freshCutoff = nowMs - HOUSE_SCRAPED_WITHIN_HOURS * HOUR_MS;
  const unseenCutoff = nowMs - unseenDays * DAY_MS;
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  const pastDateCutoff = new Date(nowMs - 7 * DAY_MS).toISOString().slice(0, 10);

  const houseStats = new Map();
  for (const r of rows) {
    const seenMs = new Date(r.last_seen_at).getTime();
    let s = houseStats.get(r.house);
    if (!s) { s = { fresh: 0, ghosts: 0, maxSeenMs: 0 }; houseStats.set(r.house, s); }
    if (seenMs > s.maxSeenMs) s.maxSeenMs = seenMs;
    if (seenMs > freshCutoff) s.fresh++;
    else if (seenMs < unseenCutoff) s.ghosts++;
  }

  const ghostFlips = [];
  const pastDatedFlips = [];
  const held = [];
  const heldHouses = new Set();

  // Per-house gate: only sweep houses that are actively scraped, and hold the
  // whole house when fresh < ghosts (partial-scrape protection — mirrors the
  // prune's <50% regression gate: fresh/(fresh+ghosts) must be >= 0.5).
  for (const [house, s] of houseStats) {
    if (s.maxSeenMs <= freshCutoff) continue; // stalled house — never sweep
    if (s.ghosts > 0 && s.fresh < s.ghosts) {
      held.push({ house, ghosts: s.ghosts, fresh: s.fresh });
      heldHouses.add(house);
    }
  }

  for (const r of rows) {
    const seenMs = new Date(r.last_seen_at).getTime();
    const s = houseStats.get(r.house);
    const houseActive = s.maxSeenMs > freshCutoff;
    const isGhost = houseActive && !heldHouses.has(r.house) && seenMs < unseenCutoff;
    // Past-dated pass is house-independent (the auction is over regardless of
    // whether the house still scrapes) but conservative on BOTH axes: auction
    // >7d past AND lot unseen >7d — a live lot with a mis-stamped past date
    // keeps being re-seen, so it can never qualify.
    const dateStr = r.auction_date ? String(r.auction_date).slice(0, 10) : null;
    const isPastDated = dateStr && dateStr < pastDateCutoff && dateStr < todayStr
      && seenMs < nowMs - 7 * DAY_MS;

    if (isGhost) ghostFlips.push(r);
    else if (isPastDated) pastDatedFlips.push(r);
  }

  return { ghostFlips, pastDatedFlips, held, houseStats };
}

/**
 * Run one ghost sweep. deps:
 * @param {{
 *   fetchAvailableRows: () => Promise<Array>,   // id, house, last_seen_at, auction_date, status for status='available'
 *   flipLots: (ids: string[], patch: object) => Promise<number>,  // returns rows updated
 *   emitEvents: (events: Array<object>) => Promise<void>,
 *   buildVanishedEvent: Function, buildLotEvent: Function, LOT_EVENT_TYPES: object,
 *   fireAlert: Function,
 * }} deps
 * @param {{ nowMs?: number, unseenDays?: number, dryRun?: boolean }} [opts]
 */
export async function runGhostSweep(deps, opts = {}) {
  if (process.env.GHOST_SWEEP_DISABLED === 'true') {
    return { skipped: 'disabled', ghosts: 0, pastDated: 0, held: [] };
  }
  const nowMs = opts.nowMs || Date.now();
  const rows = await deps.fetchAvailableRows();
  const { ghostFlips, pastDatedFlips, held } = classifyGhosts({
    rows, nowMs, unseenDays: opts.unseenDays ?? ghostUnseenDays(),
  });

  for (const h of held) {
    try {
      await deps.fireAlert({
        type: 'ghost_sweep_held',
        severity: 'warning',
        house: h.house,
        message: `Ghost sweep HELD for ${h.house}: ${h.ghosts} unseen lots vs only ${h.fresh} fresh — looks like a partial scrape, not vanished lots. Investigate extraction recall before these go stale.`,
        meta: { ghosts: h.ghosts, fresh: h.fresh },
      });
    } catch { /* alerting must never break the sweep */ }
  }

  if (opts.dryRun) {
    return { skipped: 'dry_run', ghosts: ghostFlips.length, pastDated: pastDatedFlips.length, held };
  }

  const now = new Date(nowMs).toISOString();
  let ghosts = 0, pastDated = 0;
  for (const [flips, reason, counterAdd] of [
    [ghostFlips, 'ghost_sweep_unseen', (n) => { ghosts += n; }],
    [pastDatedFlips, 'auction_passed_unswept', (n) => { pastDated += n; }],
  ]) {
    if (flips.length === 0) continue;
    const patch = { status: 'withdrawn', removed_reason: reason, removed_at: now };
    // Batch by id, mirroring the prune's batching.
    for (let i = 0; i < flips.length; i += 100) {
      const batch = flips.slice(i, i + 100);
      const updated = await deps.flipLots(batch.map(r => r.id), patch);
      counterAdd(updated);
      const source = { scraper_version: 'ghost-sweep', writer: 'ghost-sweep.flip' };
      const events = [];
      for (const r of batch) {
        const vanished = deps.buildVanishedEvent({ lotId: r.id, oldStatus: r.status, source });
        if (vanished) events.push(vanished);
        const flip = deps.buildLotEvent({
          lotId: r.id,
          eventType: deps.LOT_EVENT_TYPES.STATUS_CHANGED,
          oldValue: { status: r.status ?? null },
          newValue: { status: 'withdrawn' },
          source,
        });
        if (flip) events.push(flip);
      }
      try { await deps.emitEvents(events); } catch (e) {
        console.warn(`GHOST-SWEEP: lot_events emission failed: ${e.message}`);
      }
    }
  }

  console.log(`GHOST-SWEEP: retired ${ghosts} ghosts + ${pastDated} past-dated lots (${held.length} houses held on partial-scrape gate)`);
  return { skipped: null, ghosts, pastDated, held };
}
