// scripts/verify-deal-signals.mjs — READ-ONLY diagnostic for the deal-signal
// identifier layer (contract 3.4.0). Runs analyseLot over a sample of live
// active lots WITHOUT writing anything, and reports what the detector would
// flag fleet-wide — plus the Pembroke Avenue ground-truth rows explicitly.
//
// Usage:  set -a; source .env; set +a; node scripts/verify-deal-signals.mjs [sampleSize]

import { supabase } from '../lib/supabase.js';
import { LOT_COLUMNS, dbRowToLot } from '../lib/types/lot.js';
import { analyseLot } from '../lib/pipeline/scoring.js';

// Pre-migration compatibility: this diagnostic must run BEFORE the 3.4.0
// columns exist (that is its point — measure what the detector WOULD write),
// so select the column set minus the new ones. house alias mirrors lot.js.
const NEW_COLS = new Set(['deal_signals', 'stated_income_pa', 'income_kind']);
const COMPAT_SELECT = LOT_COLUMNS
  .filter(c => !NEW_COLS.has(c))
  .map(c => (c === 'house' ? 'house:house_slug' : c))
  .join(', ');

const SAMPLE = parseInt(process.argv[2] || '3000', 10);
const PAGE = 1000;

async function fetchActive(limit) {
  const rows = [];
  const today = new Date().toISOString().slice(0, 10);
  for (let from = 0; from < limit; from += PAGE) {
    const { data, error } = await supabase
      .from('lots')
      .select(COMPAT_SELECT)
      .in('status', ['available', 'stc'])
      .gte('auction_date', today)
      .order('last_seen_at', { ascending: false })
      .range(from, Math.min(from + PAGE, limit) - 1);
    if (error) { console.error('query failed:', error.message); process.exit(1); }
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const rows = await fetchActive(SAMPLE);
console.log(`Sampled ${rows.length} active lots (most recently seen first).\n`);

const signalCounts = {};
let hmoDealType = 0, dealTypeChanged = 0, incomeCount = 0, invValCount = 0;
const examples = { hmo: [], 'investment-valuation': [] };

for (const row of rows) {
  const lot = dbRowToLot(row);
  const analysed = analyseLot(lot);
  for (const s of analysed.dealSignals) {
    signalCounts[s] = (signalCounts[s] || 0) + 1;
    if (examples[s] && examples[s].length < 8) {
      examples[s].push(`${lot._house} | ${lot.address} | £${lot.price || '?'} | beds:${analysed.beds ?? '?'} | ${analysed.dealSignals.join(',')}${analysed.statedIncomePa ? ` | £${analysed.statedIncomePa}pa(${analysed.incomeKind})` : ''}`);
    }
  }
  if (analysed.dealType === 'HMO') hmoDealType++;
  if (analysed.dealType !== (row.deal_type || 'Standard')) dealTypeChanged++;
  if (analysed.statedIncomePa != null) incomeCount++;
  if (analysed.dealSignals.includes('investment-valuation')) invValCount++;
}

console.log('Signal counts across sample:');
for (const [s, n] of Object.entries(signalCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${s.padEnd(24)} ${n}`);
}
console.log(`\ndealType=HMO: ${hmoDealType} | investment-valuation: ${invValCount} | stated income: ${incomeCount} | deal_type would change on ${dealTypeChanged}/${rows.length} lots`);

for (const key of Object.keys(examples)) {
  if (!examples[key].length) continue;
  console.log(`\n${key} examples:`);
  for (const e of examples[key]) console.log(`  - ${e}`);
}

// ── Ground truth: 3 Pembroke Avenue, Bristol BS11 9SJ ──
const { data: pembroke, error: pembrokeErr } = await supabase
  .from('lots')
  .select(COMPAT_SELECT)
  .ilike('address', '%pembroke avenue%')
  .ilike('postcode', 'BS11%');
console.log('\nPembroke Avenue ground truth:');
if (pembrokeErr) console.log('  query failed:', pembrokeErr.message);
for (const row of (pembroke || [])) {
  const analysed = analyseLot(dbRowToLot(row));
  console.log(`  ${row.status} £${row.price} → dealType:${analysed.dealType} | signals:[${analysed.dealSignals.join(', ')}] | income:£${analysed.statedIncomePa ?? '—'} (${analysed.incomeKind ?? '—'}) | score:${analysed.score}`);
}
console.log('\nREAD-ONLY diagnostic complete — nothing was written.');
process.exit(0);
