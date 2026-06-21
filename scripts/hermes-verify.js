#!/usr/bin/env node
'use strict';
/* ============================================================================
 *  hermes-verify.js  —  evidence gatherer for hermes_findings
 * ----------------------------------------------------------------------------
 *  What this does (and what the earlier console.log "verifier" did NOT):
 *
 *   - RE-CONFIRMS CURRENT STATE. Hermes findings are hours stale by the time
 *     they're processed and AuctionBrain self-heals. "Was broken at 11:34" is
 *     not "is broken now", so every finding is re-checked against live data.
 *
 *   - SEPARATES SYMPTOM FROM CAUSE. It can confirm the symptom is still present
 *     (a house is at 0 lots NOW) but it never asserts Hermes's hypothesised
 *     cause. It attaches the live error strings so a human / Claude Code judges
 *     the cause at the gate.
 *
 *   - ONLY AUTO-CLOSES NON-PROBLEMS. self_healed findings are dismissed
 *     automatically (safe). A confirmed-still-broken finding is moved to
 *     'confirmed' and parked at the human gate. It NEVER marks anything
 *     'resolved' and NEVER edits code. (Resolution happens after a real fix.)
 *
 *  Usage:
 *     node hermes-verify.js                 # check all open (new + verifying)
 *     node hermes-verify.js --id <uuid>     # check one finding
 *     node hermes-verify.js --dry-run       # gather + print, write nothing
 *     node hermes-verify.js --probe         # also HTTP GET catalogue URLs (read-only)
 *
 *  Connection: set DATABASE_URL (or standard PG* env vars). The findings table
 *  and your lots/pipeline_events tables all live in the same Supabase Postgres,
 *  so one connection covers everything.
 * ========================================================================== */

import pg from 'pg';
const { Pool } = pg;            // ESM: the Auction repo is "type":"module" (cf. scripts/run-curator-once.js)

/* ===========================================================================
 *  SCHEMA ADAPTER  —  VERIFIED AGAINST REAL SCHEMA (2026-06-21)
 * ---------------------------------------------------------------------------
 *  These names are confirmed against information_schema.columns, not guessed.
 *  Last verified: lots.house, lots.status exist; lots has NO scrape timestamp.
 *  pipeline_events.event_type, .event_data, .created_at exist; NO subject col.
 *
 *  NOTE ON pipeline_events: It stores lot_id (not house slug), so the verifier
 *  must join through lots to find "all events for house X". This is a
 *  data-model thing, not a bug — it's lot-centric, which is correct — but it
 *  means the verifier reads slightly differently than the discovery-focused
 *  Hermes reports (which report by house). If you want findings to have a
 *  house-centric observability view, consider a materialized view or a
 *  dedicated table. For now, we work with what we have.
 * ========================================================================= */
const ADAPTER = {
  lotsTable:      'lots',
  lotsHouseCol:   'house',             // CORRECTED: was 'auction_house'
  lotsStatusCol:  'status',            // ✅ correct
  // NOTE: lots table has NO scrape timestamp. We'll use created_at as proxy
  // (time lot was first seen in DB), but this isn't perfect. Consider adding
  // a last_extracted_at or similar if you need precision.
  lotsCreatedCol: 'created_at',        // used as fallback for "age" info
  
  eventsTable:    'pipeline_events',
  // pipeline_events is lot-centric: lot_id (uuid), not house slug.
  // To find "events for house X", join through lots.
  eventsLotCol:   'lot_id',            // FK to lots.id
  eventsTypeCol:  'event_type',        // ✅ correct
  eventsDataCol:  'event_data',        // CORRECTED: was 'message'. It's jsonb.
  eventsTimeCol:  'created_at',        // ✅ correct
};

async function getHouseLotState(db, house) {
  const a = ADAPTER;
  // Get current lot counts by status for this house.
  const { rows } = await db.query(
    `select ${a.lotsStatusCol} as status, count(*)::int as n
       from ${a.lotsTable} where ${a.lotsHouseCol} = $1 group by ${a.lotsStatusCol}`,
    [house]);
  const byStatus = Object.fromEntries(rows.map(r => [r.status, r.n]));
  const total = rows.reduce((s, r) => s + r.n, 0);
  
  // lots table has no scrape timestamp. Use created_at (first seen) as a weak proxy.
  // This tells us "when did we first see lots for this house" not "when did we last
  // try to extract". If you need true scrape recency, add a last_extracted_at column.
  const { rows: ageRows } = await db.query(
    `select max(${a.lotsCreatedCol}) as max_created, 
            min(${a.lotsCreatedCol}) as min_created
       from ${a.lotsTable} where ${a.lotsHouseCol} = $1`, [house]);
  const maxCreated = ageRows[0]?.max_created ?? null;
  const ageHours = maxCreated
    ? Math.round((Date.now() - new Date(maxCreated).getTime()) / 36e5) : null;
  
  return { byStatus, total, available: byStatus.available ?? 0, maxCreated, ageHours };
}

/* ===========================================================================
 *  HOUSE HEALTH  —  house_skills gate inputs.  Added Phase 1 (2026-06-21).
 * ---------------------------------------------------------------------------
 *  Join key CONFIRMED against live data, not guessed: house_skills.slug =
 *  lots.house. (lots.house stores the SLUG; house_skills.house stores the
 *  DISPLAY name, so joining on .house matches almost nothing.) Verified
 *  2026-06-21: slug-join covers 153/155 distinct lot-houses; house-join = 2.
 *
 *  getHouseHealth returns the row, or null when the house has no house_skills
 *  row (currently brggibsondublin [retired] + driversnorris). null — or null
 *  health columns — is handled CONSERVATIVELY by the gate: "no data" never
 *  hides a real breakage (it routes to confirmed_current, not a dismissal).
 *
 *  Reliability (Phase 0): circuit_state / dormant / consecutive_failures are
 *  100% populated; last_full_extract_at ~92%; next_scrape_at / last_success_at
 *  ~94%. We gate primarily on circuit_state + dormant (the populated, meaningful
 *  signals) and use last_full_extract_at for scrape-recency.
 * ========================================================================= */
const HEALTH = {
  table:   'house_skills',
  joinCol: 'slug',                 // = lots.house (the slug). CONFIRMED 2026-06-21.
};
// "last_full_extract_at recent" threshold for the not-yet-due branch. 7 days
// mirrors the pipeline's freshness floor (no house should go a week unscraped).
const RECENT_EXTRACT_HOURS = 24 * 7;

const fmtAge = (h) => (h == null ? '?h' : `${h}h`);
const fmtTs  = (t) => { try { return new Date(t).toISOString(); } catch { return String(t); } };

async function getHouseHealth(db, house) {
  const { rows } = await db.query(
    `select slug, circuit_state, circuit_opened_at, dormant, dormant_since,
            next_scrape_at, last_full_extract_at, last_success_at,
            consecutive_failures, healing_cooldown_until, status
       from ${HEALTH.table} where ${HEALTH.joinCol} = $1`, [house]);
  return rows[0] || null;
}

async function getRecentEvents(db, house, hours = 48, limit = 20) {
  const a = ADAPTER;
  // pipeline_events is lot-centric (has lot_id, not house slug).
  // To get "all events for house X", join through lots.
  const { rows } = await db.query(
    `select e.${a.eventsTimeCol} as at, e.${a.eventsTypeCol} as type, 
            e.${a.eventsDataCol}->>'error' as msg
       from ${a.eventsTable} e
       join ${a.lotsTable} l on e.${a.eventsLotCol} = l.id
      where l.${a.lotsHouseCol} = $1
        and e.${a.eventsTimeCol} > now() - make_interval(hours => $2::int)
      order by e.${a.eventsTimeCol} desc limit $3`,
    [house, hours, limit]);
  return rows;
}

/* ===========================================================================
 *  Optional read-only endpoint probe (only with --probe)
 * ========================================================================= */
async function probeUrl(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    const body = await res.text();
    const visibleText = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      url, httpStatus: res.status,
      // heuristic only — flags the JS-hydrated pattern the Bamboo finding describes
      looksJsHydrated: /id="__next"|__NEXT_DATA__|window\.__NEXT/.test(body),
      visibleTextLength: visibleText.length,
    };
  } catch (e) {
    return { url, error: String(e.message || e) };
  } finally { clearTimeout(t); }
}

function firstUrl(evidenceRefs) {
  const flat = JSON.stringify(evidenceRefs ?? []);
  const m = flat.match(/https?:\/\/[^\s"'\\]+/);
  return m ? m[0] : null;
}

/* ===========================================================================
 *  Severity rule  —  derived from a REAL number, not invented.
 *  Based on how many lots the house used to carry (observed_metrics).
 * ========================================================================= */
function severityFromMetrics(m) {
  const prev = Number(m?.previous_lots ?? 0);
  if (prev >= 100) return 'high';
  if (prev >= 1)   return 'medium';
  return null;       // no basis -> leave for a human
}

/* ===========================================================================
 *  Verifiers, keyed by symptom. Each returns:
 *    { verdict, status, severity?, dismiss_reason?, notes, evidence }
 * ========================================================================= */
async function verifyHouseLots(db, f, { probe } = {}) {
  const live = await getHouseLotState(db, f.subject);
  const evidence = { checked_at: new Date().toISOString(), live_lot_state: live };

  if (probe && f.symptom === 'extractor_broke') {
    const url = firstUrl(f.evidence_refs);
    if (url) evidence.probe = await probeUrl(url);
  }

  // (1) Recovered — the symptom is gone. Auto-dismiss (safe). Unchanged.
  if (live.available > 0) {
    return {
      verdict: 'self_healed', status: 'dismissed', dismiss_reason: 'self_healed',
      notes: `Self-healed: ${f.subject} now has ${live.available} available lots. `
           + `No action needed.`,
      evidence,
    };
  }

  // (2) Still 0 available lots. BEFORE confirming a breakage, consult house
  //     health — most 0-lot states are EXPECTED (circuit-breaker cooldown,
  //     dormancy, or a scrape that isn't due yet) and must NOT be paraded as
  //     breakages. This is the Phase 1 health gate (2026-06-21).
  const health = await getHouseHealth(db, f.subject);
  evidence.house_health = health ? {
    circuit_state:        health.circuit_state,
    circuit_opened_at:    health.circuit_opened_at,
    dormant:              health.dormant,
    dormant_since:        health.dormant_since,
    next_scrape_at:       health.next_scrape_at,
    last_full_extract_at: health.last_full_extract_at,
    last_success_at:      health.last_success_at,
    consecutive_failures: health.consecutive_failures,
    status:               health.status,
  } : null;

  // Scrape-recency signal: prefer house_skills.last_full_extract_at (the real
  // "when did we last extract") over the lots.created_at proxy (only "when a lot
  // was first seen"). Phase 0 confirmed last_full_extract_at is live (max age
  // ~40d), the upgrade this gate unlocks. Fall back to the proxy when no health.
  const lfe = health?.last_full_extract_at ? new Date(health.last_full_extract_at) : null;
  const extractAgeHours = lfe != null
    ? Math.round((Date.now() - lfe.getTime()) / 36e5)
    : live.ageHours;
  evidence.scrape_recency = {
    source: lfe ? 'house_skills.last_full_extract_at' : 'lots.created_at (proxy)',
    age_hours: extractAgeHours,
  };

  // Known-state dismissal: 0 lots but an expected condition. Persisted as
  // verdict='false_positive' + dismiss_reason='known_state' (the verdict enum is
  // intentionally left unchanged; the reason carries the meaning).
  const dismissKnownState = (why) => ({
    verdict: 'false_positive', status: 'dismissed', dismiss_reason: 'known_state',
    notes: `Known-state (not a breakage): ${f.subject} at 0 available lots — ${why}. `
         + `Dismissed by the health gate; no action.`,
    evidence,
  });

  // No house_skills row (e.g. brggibsondublin, driversnorris): a benign cause
  // cannot be ruled out, so we DO NOT dismiss — confirm conservatively.
  if (!health) {
    const events = await getRecentEvents(db, f.subject, 48, 15);
    evidence.recent_events = events;
    return {
      verdict: 'confirmed_current', status: 'confirmed',
      severity: severityFromMetrics(f.observed_metrics),
      notes: `Still 0 available lots for ${f.subject}; NO house_skills row — `
           + `no health data, benign cause could not be ruled out. ${events.length} `
           + `live event(s) attached. Hermes guessed "${f.hypothesis ?? 'n/a'}" `
           + `(untrusted) — judge cause from the evidence.`,
      evidence,
    };
  }

  // Health row present — apply the expected-state dismissals in priority order.
  if (health.dormant === true) {
    return dismissKnownState(
      `house is dormant${health.dormant_since ? ` (since ${fmtTs(health.dormant_since)})` : ''}, `
      + `0 lots expected`);
  }
  // 'open' = tripped; 'half-open' = the 24h auto-recovery probe window
  // (lib/harness/house-health.js:140,151 persist this to circuit_state). BOTH
  // are cooldown/recovery, not actionable now. Live data is currently all
  // open/closed, but the breaker CAN persist 'half-open' — if the gate only
  // matched 'open', a recovering house would be paraded as a breakage, exactly
  // the noise this gate exists to suppress.
  if (health.circuit_state === 'open' || health.circuit_state === 'half-open') {
    const st = health.circuit_state === 'half-open' ? 'HALF-OPEN (auto-recovery probe)' : 'OPEN';
    return dismissKnownState(
      `circuit breaker ${st}${health.circuit_opened_at ? ` since ${fmtTs(health.circuit_opened_at)}` : ''} `
      + `— in cooldown/recovery, not actionable now`);
  }
  // "Not yet due": a future scrape is scheduled AND the last full extract is
  // recent. Inert today (Phase 0: no house currently has a future next_scrape_at)
  // but wired for when the scheduler writes future timestamps. A past-due
  // next_scrape_at is NOT a breakage by itself — it just fails this dismissal.
  const nextDue = health.next_scrape_at ? new Date(health.next_scrape_at) : null;
  // Also require a SUCCESS signal: a recent extract only proves we TRIED
  // recently, not that it worked. A recently-run-but-broken extractor (ran,
  // produced 0 lots, consecutive_failures > 0) must NOT be hidden as merely
  // "not due yet". Stricter than the literal spec, in the safe (never-hide-a-
  // breakage) direction. consecutive_failures is 100% populated (Phase 0).
  const notYetDue = nextDue != null && nextDue.getTime() > Date.now()
                 && lfe != null && extractAgeHours <= RECENT_EXTRACT_HOURS
                 && (health.consecutive_failures ?? 0) === 0;
  if (notYetDue) {
    return dismissKnownState(
      `not due to scrape yet (next_scrape_at ${fmtTs(health.next_scrape_at)}, `
      + `last full extract ${fmtAge(extractAgeHours)} ago)`);
  }

  // (3) Genuinely overdue/failing: circuit closed, not dormant, due-or-overdue,
  //     still 0. Confirm for the human gate and attach last_success_at +
  //     consecutive_failures as the spec requires. Cause stays unjudged.
  const events = await getRecentEvents(db, f.subject, 48, 15);
  evidence.recent_events = events;
  return {
    verdict: 'confirmed_current', status: 'confirmed',
    severity: severityFromMetrics(f.observed_metrics),
    notes: `Still 0 available lots for ${f.subject} — genuinely overdue/failing `
         + `(circuit ${health.circuit_state}, ${health.consecutive_failures ?? '?'} `
         + `consecutive failure(s), last success `
         + `${health.last_success_at ? fmtTs(health.last_success_at) : 'never'}, last full `
         + `extract ${fmtAge(extractAgeHours)} ago). Hermes guessed `
         + `"${f.hypothesis ?? 'n/a'}" (untrusted) — judge cause from the `
         + `${events.length} live event(s) attached.`,
    evidence,
  };
}

async function verifyDiscovery(db, f) {
  // discovery_errors findings are about the discovery *pipeline*, not a specific house.
  // We can't query pipeline_events by subject (no such column), so we look for
  // recent discovery-related event types.
  const a = ADAPTER;
  const { rows } = await db.query(
    `select ${a.eventsTimeCol} as at, ${a.eventsTypeCol} as type, 
            ${a.eventsDataCol}->>'error' as msg
       from ${a.eventsTable}
      where ${a.eventsTypeCol} ilike '%discovery%' 
        and ${a.eventsTimeCol} > now() - make_interval(hours => 24)
      order by ${a.eventsTimeCol} desc limit 20`);
  const errs = rows.filter(e => /error|fail|exception/i.test(`${e.type} ${e.msg ?? ''}`));
  const evidence = {
    checked_at: new Date().toISOString(),
    recent_discovery_event_count: rows.length,
    recent_discovery_errors: errs,
    note: 'Discovery events are pipeline-wide, not house-specific; queried by event_type pattern.'
  };
  if (rows.length > 0 && errs.length === 0) {
    return { verdict: 'self_healed', status: 'dismissed', dismiss_reason: 'self_healed',
             notes: `Discovery pipeline: recent run(s) with no errors. Self-healed.`, evidence };
  }
  return { verdict: 'confirmed_current', status: 'confirmed', severity: 'medium',
           notes: `Discovery pipeline: ${errs.length} error event(s) still present — `
                + `inspect the event_data for a shared root cause.`, evidence };
}

function codeInspection(f, instruction) {
  return {
    verdict: 'needs_human', status: 'verifying',
    notes: `Code/config inspection (not a runtime check): ${instruction}`,
    evidence: { checked_at: new Date().toISOString(), kind: 'manual_inspection' },
  };
}

const VERIFIERS = {
  zero_extraction:          (db, f, o) => verifyHouseLots(db, f, o),
  extractor_broke:          (db, f, o) => verifyHouseLots(db, f, o),
  discovery_errors:         (db, f)    => verifyDiscovery(db, f),
  retirement_verify:        (_, f)     => codeInspection(f,
      `grep ${f.subject} in lib/houses.js across all 5 layers `
    + `(HOUSE_ROOTS, detectAuctionHouse, HOUSE_DISPLAY_NAMES, rewriteUrl, RETIRED_HOUSES).`),
  job_config_contradiction: (_, f)     => codeInspection(f,
      `review the cron job definition for ${f.subject}; this is a config contradiction, `
    + `not a code bug.`),
};

async function defaultVerifier(db, f) {
  const events = await getRecentEvents(db, f.subject, 48, 15).catch(() => []);
  return { verdict: 'needs_human', status: 'verifying',
           notes: `No verifier for symptom "${f.symptom}". Recent events attached for triage.`,
           evidence: { checked_at: new Date().toISOString(), recent_events: events } };
}

/* ===========================================================================
 *  Dry-run synthesiser (READ-ONLY; --dry-run ONLY).
 * ---------------------------------------------------------------------------
 *  The health gate can only be SEEN working if there are findings to run it on.
 *  Until the cron jobs are re-scoped to emit findings (and the migration is
 *  applied), the table is empty/absent — so a plain dry-run would show "0
 *  findings". This builds representative findings straight from live data —
 *  up to 3 zero-available-lot houses per health bucket — so every gate branch
 *  is exercised against the real house_skills state. It NEVER writes, and it is
 *  only ever called in --dry-run. Synthetic rows carry id=null.
 * ========================================================================= */
async function synthesizeDryRunFindings(db) {
  const { rows } = await db.query(`
    with avail as (
      select house,
             count(*) filter (where status = 'available') as available,
             count(*) as total
        from lots group by house
    ),
    zero as (
      select a.house as subject, a.total,
             case
               when hs.slug is null                    then 'no_health'
               when hs.dormant                         then 'dormant'
               when hs.circuit_state in ('open','half-open') then 'circuit_open'
               when hs.next_scrape_at > now()
                and hs.last_full_extract_at > now() - interval '7 days'
                                                        then 'not_due'
               else                                         'overdue_or_failing'
             end as bucket
        from avail a
        left join house_skills hs on hs.slug = a.house
       where a.available = 0
    ),
    ranked as (
      select subject, total, bucket,
             row_number() over (partition by bucket order by total desc) as rn
        from zero
    )
    select subject, total, bucket from ranked where rn <= 3 order by bucket, total desc`);
  return rows.map(r => ({
    id: null, symptom: 'zero_extraction', subject: r.subject,
    observation: `[synthetic/${r.bucket}] ${r.subject} at 0 available lots (history: ${r.total} rows)`,
    hypothesis: null,
    observed_metrics: { previous_lots: r.total },
    evidence_refs: [],
  }));
}

/* ===========================================================================
 *  Main
 * ========================================================================= */
async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const probe  = argv.includes('--probe');
  const idIdx  = argv.indexOf('--id');
  const onlyId = idIdx >= 0 ? argv[idIdx + 1] : null;

  const pool = new Pool(process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL } : {});
  const db = await pool.connect();

  try {
    let findings = [];
    let synthetic = false;
    try {
      const res = onlyId
        ? await db.query(`select * from hermes_findings where id = $1`, [onlyId])
        : await db.query(
            `select * from hermes_findings
              where status in ('new','verifying') order by created_at`);
      findings = res.rows;
    } catch (e) {
      if (e.code === '42P01') {           // undefined_table — migration not applied yet
        if (!dryRun) throw e;             // a real run REQUIRES the findings table
        console.log('\n⚠️  hermes_findings not found (migration not applied yet) — '
                  + '--dry-run will synthesise findings from live data.');
        synthetic = true;
      } else { throw e; }
    }
    // In --dry-run, if nothing is queued (table empty, or crons not emitting yet),
    // demonstrate the gate on live houses. Never happens outside --dry-run.
    if (dryRun && !onlyId && findings.length === 0) {
      if (!synthetic) console.log('\n(no open findings queued — synthesising from live data for the dry-run.)');
      synthetic = true;
      findings = await synthesizeDryRunFindings(db);
    }

    console.log(`\n🔍 hermes-verify  ${dryRun ? '(dry run) ' : ''}`
              + `${synthetic ? '[SYNTHETIC findings from live data] ' : ''}`
              + `— ${findings.length} finding(s) to check\n`);
    if (probe) console.log('   (endpoint probing ON — read-only GETs)\n');

    const tally = { self_healed: 0, known_state: 0, confirmed_current: 0, needs_human: 0, other: 0 };

    for (const f of findings) {
      const verifier = VERIFIERS[f.symptom] || defaultVerifier;
      let result;
      try {
        result = await verifier(db, f, { probe });
      } catch (e) {
        result = { verdict: 'needs_human', status: 'verifying',
          notes: `Verifier error (likely a schema-adapter mismatch — check the `
               + `ADAPTER block): ${e.message}`,
          evidence: { checked_at: new Date().toISOString(), error: String(e.message) } };
      }
      // Bucket known-state dismissals separately from ordinary self-heals so the
      // gate's effect is visible at a glance.
      const bucket = result.dismiss_reason === 'known_state' ? 'known_state'
                   : Object.prototype.hasOwnProperty.call(tally, result.verdict) ? result.verdict
                   : 'other';
      tally[bucket] = (tally[bucket] ?? 0) + 1;

      const icon = bucket === 'self_healed'       ? '✅'
                 : bucket === 'known_state'       ? '🟦'
                 : bucket === 'confirmed_current' ? '⚠️ ' : '❓';
      console.log(`${icon} [${f.symptom}] ${f.subject}`);
      console.log(`     Hermes said : ${f.observation}`);
      if (f.hypothesis) console.log(`     Hermes guess: ${f.hypothesis}  (untrusted)`);
      console.log(`     Verdict     : ${result.verdict}`
                + `${result.severity ? `  severity=${result.severity}` : ''}`
                + `  ->  status='${result.status}'`);
      console.log(`     ${result.notes}`);
      if (result.evidence?.live_lot_state)
        console.log(`     live lots   : ${JSON.stringify(result.evidence.live_lot_state.byStatus)}`);
      if (result.evidence?.probe)
        console.log(`     probe       : ${JSON.stringify(result.evidence.probe)}`);
      console.log('');

      if (!dryRun && f.id) {
        await db.query(
          `update hermes_findings set
             status = $2, verdict = $3,
             severity = coalesce($4, severity),
             dismiss_reason = $5, verifier_notes = $6,
             verified_evidence = $7::jsonb, verified_at = now()
           where id = $1`,
          [f.id, result.status, result.verdict, result.severity ?? null,
           result.dismiss_reason ?? null, result.notes,
           JSON.stringify(result.evidence)]);
      }
    }

    console.log('────────────────────────────────────────');
    console.log(`✅ self-healed (auto-dismissed)  : ${tally.self_healed}`);
    console.log(`🟦 known-state (gated, dismissed): ${tally.known_state}`);
    console.log(`⚠️  confirmed still broken        : ${tally.confirmed_current}`);
    console.log(`❓ needs human inspection         : ${tally.needs_human}`);
    console.log(`\nNext: review the verified, still-broken set before any fix:`);
    console.log(`      select * from hermes_actionable;`);
    if (dryRun) console.log(`\n(dry run — no rows were written)`);
    console.log('');
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
