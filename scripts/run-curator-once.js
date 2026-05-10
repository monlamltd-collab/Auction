#!/usr/bin/env node
// scripts/run-curator-once.js
//
// Manually trigger the curator cycle for a given date (default: today UK).
// Intended for first-time setup, ad-hoc admin use, and CI smoke tests.
//
// Usage:
//   node scripts/run-curator-once.js                # today UK, persist
//   node scripts/run-curator-once.js --date=2026-05-10
//   node scripts/run-curator-once.js --dry-run      # selection + prose, no DB write
//
// Requires the same env vars as the server: SUPABASE_*, GEMINI_API_KEY,
// BRIDGEMATCH_API_URL.

import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initAI } from '../lib/ai-provider.js';
import { initHpi } from '../lib/land-registry-hpi.js';
import { supabase } from '../lib/supabase.js';
import { runCuratorCycle } from '../lib/pipeline/curator-cycle.js';

function parseArgs(argv) {
  const out = { date: null, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run' || arg === '--dryRun') out.dryRun = true;
    else if (arg.startsWith('--date=')) out.date = arg.slice(7);
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY missing');
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY required');
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  initAI(genAI, supabase);
  initHpi({ supabase });

  console.log(`Curator cycle: date=${opts.date || 'today (UK)'} dryRun=${opts.dryRun}`);
  const result = await runCuratorCycle(supabase, {
    pickDate: opts.date || undefined,
    dryRun: opts.dryRun,
  });

  console.log(JSON.stringify(result, null, 2));
  if (result.error) process.exit(1);
}

main().catch(err => {
  console.error('Curator cycle failed:', err);
  process.exit(1);
});
