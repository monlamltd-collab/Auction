# Always-Cached Architecture

> Design document for ensuring every auction house always has fresh cached data.
> No investor should ever see "un-analysed" houses.

---

## Problem

Currently, `autoAnalyseAll()` runs every 6 hours and re-analyses all houses with upcoming auctions.
This is wasteful (re-analyses unchanged catalogues) and insufficient (6-hour gaps mean stale data).

## Architecture: Tiered Refresh with Change Detection

### 1. Catalogue Fingerprinting

Before running a full analysis (which costs $0.05-0.50 in Claude API calls), check if the catalogue content has actually changed.

**New table: `catalogue_fingerprints`**
```sql
CREATE TABLE catalogue_fingerprints (
  url TEXT PRIMARY KEY,
  content_hash TEXT,           -- SHA-256 of page content
  lot_count_estimate INTEGER,  -- regex-extracted lot count from page
  etag TEXT,                   -- HTTP ETag header if available
  last_checked TIMESTAMPTZ,
  last_changed TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,
  check_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0
);
```

**Fingerprint check flow:**
1. HEAD request (or fast GET with abort after headers) to catalogue URL
2. Compare: `ETag` header, `Content-Length`, `Last-Modified`
3. If headers suggest change OR no headers available: fetch full page
4. Extract lot count via regex (`/(\d+)\s+lots?/i`)
5. SHA-256 hash of stripped page content
6. If hash unchanged → skip full analysis (free)
7. If hash changed → queue full analysis

**Cost: ~$0 per fingerprint check** (just an HTTP request).

### 2. Staggered Scheduling

Replace the single 6-hour `autoAnalyseAll()` with a continuous round-robin scheduler.

**Schedule:**
- Probe 5-10 houses every 30 minutes (round-robin across all ~50 houses)
- All houses checked within ~3 hours
- Priority tiers based on auction proximity:

| Tier | Condition | Check interval |
|------|-----------|---------------|
| Urgent | Auction within 7 days | Every 2 hours |
| Active | Auction within 30 days | Every 6 hours |
| Dormant | No upcoming auction | Every 24 hours |

**Implementation:**
```js
// Store next_check_at per house in catalogue_fingerprints
// Scheduler picks the house with the oldest next_check_at
async function scheduledCheck() {
  const { data: next } = await supabase
    .from('catalogue_fingerprints')
    .select('url')
    .lte('next_check_at', new Date().toISOString())
    .order('next_check_at', { ascending: true })
    .limit(5);

  for (const house of (next || [])) {
    const changed = await checkFingerprint(house.url);
    if (changed) await autoAnalyseOne(house.url);
    await updateNextCheck(house.url);
  }
}

// Run every 30 minutes
setInterval(scheduledCheck, 30 * 60 * 1000);
```

### 3. Proactive Refresh

Re-analyse before TTL expiry, not after:

- Current cache TTL: 7 days
- If `expires_at - now() < 2 days` AND content has changed → re-analyse proactively
- Users never see stale data or "analysing..." spinners

```
Timeline:
Day 0: Fresh analysis (TTL = 7 days)
Day 5: Proactive check — if changed, re-analyse
Day 7: Cache would expire (but it's already fresh from day 5)
```

### 4. Cost Management

**Estimated costs:**
- Fingerprint check: ~$0 (HTTP request only)
- Full analysis: $0.05-0.50 depending on catalogue size
- Typical day: 5 changes × $0.30 = $1.50/day
- Worst case: 50 changes × $0.50 = $25/day

**Controls:**

```sql
CREATE TABLE analysis_costs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT,
  house TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd NUMERIC(6,4),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

- Daily budget cap: $10/day (configurable via env var)
- If exceeded: log warning via Sentry, pause non-urgent analyses
- Track tokens per analysis in `analysis_costs` table
- Monthly cost report endpoint for admin dashboard

### 5. Monitoring

**New admin endpoint: `GET /api/admin/cache-health`**

Returns:
```json
{
  "summary": {
    "totalHouses": 50,
    "freshCount": 45,
    "staleCount": 3,
    "failedCount": 2,
    "dailyCostEstimate": "$1.50"
  },
  "houses": [
    {
      "house": "Allsop",
      "url": "...",
      "cacheAge": "2h 15m",
      "expiresIn": "4d 22h",
      "lastChecked": "2025-01-15T10:30:00Z",
      "lastChanged": "2025-01-15T08:00:00Z",
      "status": "fresh",
      "nextCheck": "2025-01-15T12:30:00Z"
    }
  ]
}
```

### 6. Failure Recovery

- Retry failed analyses 3x with exponential backoff: 5min, 30min, 2hr
- Keep last successful cache even if refresh fails (stale > empty)
- After 3 consecutive failures: set `needs_manual_review = true`
- Alert via Sentry with house name + error details
- Admin dashboard shows failed houses with retry button

```
Retry timeline:
Attempt 1: immediate
Attempt 2: +5 minutes
Attempt 3: +30 minutes
Attempt 4: +2 hours
After 4 failures: mark needs_manual_review, alert
```

### 7. Migration Path

**Phase A (this document):** Design approved
**Phase B:** Add `catalogue_fingerprints` table + `checkFingerprint()` function
**Phase C:** Replace `autoAnalyseAll()` with staggered scheduler
**Phase D:** Add proactive refresh logic
**Phase E:** Add cost tracking + monitoring endpoint
**Phase F:** Add Sentry alerts for failures

Each phase is independently deployable. Phase B alone saves significant API costs.
