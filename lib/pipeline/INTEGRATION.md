# Modular Pipeline Experiment — Integration Guide

## Overview

This guide shows the exact changes needed to wire the modular pipeline experiment into the existing codebase. The experiment runs treatment houses through `lib/pipeline/` while control houses use the existing code path.

## Step 1: Run the Migration

Execute `lib/pipeline/migration.sql` in the Supabase SQL editor to create:
- `experiment_log` table
- `experiment_comparison` view
- `experiment_daily_summary` view

## Step 2: Add Environment Variables

```env
# Enable the experiment (default: false)
EXPERIMENT_ENABLED=true

# Comma-separated house slugs for the treatment group
# Choose ~15 houses matched by platform family and lot volume
EXPERIMENT_TREATMENT_HOUSES=pugh,savills,allsop,sdlauctions,auctionhouselondon,networkauctions,barnardmarcus,cliveemson,iamsold,bidx1,bradleyhall,edwardmellor,landwood,connells,townandcountry
```

## Step 3: Wire into analysis.js

### 3a. Add import (top of file)

```js
import {
  initExperiment, isTreatmentHouse, startExperimentCycle,
  runModularPipeline, logControlMetrics, endExperimentCycle,
  initHarnessBridge,
} from './pipeline/index.js';
```

### 3b. Initialize in initAnalysis()

Add after the existing `Object.assign(_deps, deps)`:

```js
initExperiment({
  supabase,
  ...deps,
  isCreditExhausted: () => creditExhausted,
});
initHarnessBridge({
  healBrokenHouse,
  fireAlert: deps.fireAlert,
});
```

### 3c. Hook into _doAutoAnalyseAll()

After the manager pre-scrape cycle (~line 630), add:

```js
startExperimentCycle();
```

After the manager post-scrape cycle (~line 858), add:

```js
await endExperimentCycle();
```

### 3d. Route treatment houses in processAuction()

Replace the `autoAnalyseOne` call (~line 779) with:

```js
const slug = auction._slug || detectAuctionHouse(auction.url);
if (isTreatmentHouse(slug)) {
  console.log(`AUTO: [EXPERIMENT:treatment] Analysing ${auction.house} via modular pipeline`);
  const rewritten = await _deps.rewriteUrl(auction.url, slug);
  const lots = await runModularPipeline(auction.url, slug, rewritten);
  // Cache the result the same way the legacy path does
  if (lots && lots.length > 0) {
    _deps.normaliseLotStatuses(lots);
    await upsertToLotsTable(lots, auction.house, auction.url, {
      scrapedWith: 'modular-pipeline',
    });
  }
} else {
  const startMs = Date.now();
  await autoAnalyseOne(auction.url);
  // Log control metrics for comparison
  const normUrl = normaliseUrl(auction.url);
  const { data: lotsData } = await supabase
    .from('lots')
    .select('image_url, beds, tenure, address, guide_price')
    .eq('catalogue_url', normUrl);
  if (lotsData) {
    const total = lotsData.length;
    const withImg = lotsData.filter(l => l.image_url).length;
    await logControlMetrics(slug, {
      lotCount: total,
      imageCoverage: total > 0 ? Math.round((withImg / total) * 100) : 0,
      durationMs: Date.now() - startMs,
    });
  }
}
```

## Step 4: Add Admin Endpoints (optional, for fault injection)

In `routes/admin.js`:

```js
import { injectFault, clearFault, getInjectedFault } from '../lib/pipeline/index.js';

// Inject a fault for experiment testing
router.post('/experiment/fault', requireAdmin, (req, res) => {
  const { house, type, config } = req.body;
  if (!house || !type) return res.status(400).json({ error: 'house and type required' });
  injectFault(house, type, config);
  res.json({ ok: true, house, type });
});

// Clear a fault
router.delete('/experiment/fault/:house', requireAdmin, (req, res) => {
  clearFault(req.params.house);
  res.json({ ok: true });
});

// View injected faults
router.get('/experiment/faults', requireAdmin, (req, res) => {
  // List all
  res.json({ ok: true });
});
```

## Step 5: Choose Treatment Houses

Match 15 treatment houses against 15 control houses by:

| Criterion | How to Match |
|-----------|-------------|
| Platform family | Same family in both groups (EIG, AH UK, SDL, etc.) |
| Typical lot count | Similar average lot volume |
| Historical failure rate | Check `pipeline_alerts` for recent regressions |
| Extraction method | DOM vs Gemini in both groups |

## Step 6: Analyse Results

Query the comparison view after each cycle:

```sql
-- Per-house treatment vs control lot counts
select * from experiment_comparison
where metric = 'lot_count'
order by cycle_ts desc;

-- Daily averages
select * from experiment_daily_summary
where metric in ('lot_count', 'image_coverage', 'total_duration_ms')
order by day desc, metric;

-- M5: Wasted AI calls
select * from experiment_log
where metric = 'wasted_ai_calls'
order by cycle_ts desc;
```
