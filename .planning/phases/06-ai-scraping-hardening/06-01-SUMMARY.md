---
phase: 06-ai-scraping-hardening
plan: 01
subsystem: ai
tags: [gemini, grok, xai, provider-abstraction, cost-tracking, supabase]

requires:
  - phase: 04-foundation
    provides: Express server, Supabase client, admin auth pattern
provides:
  - callAI() multi-provider abstraction (Gemini + Grok)
  - ai_usage Supabase table for per-call cost logging
  - GET /api/admin/ai-costs endpoint
  - AI_PROVIDER env var for provider switching
  - In-memory daily budget tracking
affects: [06-02, 06-03, server.js AI calls, admin dashboard]

tech-stack:
  added: [xai-grok-api]
  patterns: [provider-abstraction, fire-and-forget-logging, dependency-injection]

key-files:
  created: [lib/ai-provider.js]
  modified: [server.js, schema.sql, .env.example]

key-decisions:
  - "Dependency injection via initAI() rather than direct imports to keep genAI instance shared"
  - "Daily budget is soft cap (warns but proceeds) to avoid breaking production extraction"
  - "In-memory budget counter avoids DB race conditions on concurrent AI calls"
  - "PDF extraction always forces Gemini regardless of AI_PROVIDER (Grok lacks multimodal)"

patterns-established:
  - "Provider abstraction: callAI(prompt, { tier, taskType }) replaces direct model selection"
  - "Fire-and-forget cost logging: never await in critical path, try/catch with console.warn"
  - "Tier-based model selection: 'fast' and 'capable' tiers mapped per provider"

requirements-completed: [AI-01, AI-02, AI-03]

duration: 10min
completed: 2026-03-22
---

# Phase 06 Plan 01: AI Provider Abstraction Summary

**Multi-provider AI layer with Gemini + Grok support, per-call cost logging to Supabase, and daily budget tracking via callAI() abstraction**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-22T23:44:46Z
- **Completed:** 2026-03-22T23:55:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Extracted all AI calls from server.js into lib/ai-provider.js with generic callAI() interface
- Token usage logged per call to ai_usage Supabase table with cost estimates and model breakdown
- AI_PROVIDER env var switches between Gemini and Grok; PDF extraction always forces Gemini
- Daily budget tracking with in-memory counter and midnight UTC reset
- Admin endpoint GET /api/admin/ai-costs surfaces daily spend, per-model breakdown, and budget status

## Task Commits

Each task was committed atomically:

1. **Task 1: Create lib/ai-provider.js with provider abstraction, cost logging, and Supabase schema** - `abff019` (feat)
2. **Task 2: Migrate all callGemini() callsites in server.js to callAI() and add admin cost endpoint** - `6d779d0` (feat)

## Files Created/Modified
- `lib/ai-provider.js` - Provider abstraction with callAI(), initAI(), getAICostSummary() exports
- `server.js` - Migrated 5 callGemini() callsites to callAI(), removed old functions, added /api/admin/ai-costs
- `schema.sql` - Added ai_usage table DDL with indexes and RLS policy
- `.env.example` - Added AI_PROVIDER, GROK_API_KEY, AI_DAILY_BUDGET, GROK_MIN_GAP_MS

## Decisions Made
- Used dependency injection (initAI) so server.js can share its existing genAI and supabase instances
- Daily budget is a soft cap -- logs warning but continues processing to avoid breaking live extraction
- In-memory counter for budget tracking avoids DB query race conditions on concurrent calls
- PDF extraction always forces Gemini since Grok lacks multimodal support
- Rate limiting moved into provider layer with per-provider gap timers

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed MODEL_FLASH references in error response JSON**
- **Found during:** Task 2 (migration)
- **Issue:** Smart search error responses referenced MODEL_FLASH constant which was removed
- **Fix:** Replaced with string literals and process.env.AI_PROVIDER for dynamic provider name
- **Files modified:** server.js
- **Verification:** grep confirms no remaining MODEL_PRO or MODEL_FLASH references
- **Committed in:** 6d779d0 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary fix for removed constants. No scope creep.

## Issues Encountered
None

## User Setup Required

To use the new AI cost tracking, run the ai_usage table DDL in Supabase SQL Editor:
```sql
CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  est_cost NUMERIC(10,6) DEFAULT 0,
  task_type TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage(provider, created_at DESC);
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON ai_usage FOR ALL USING (true) WITH CHECK (true);
```

Optional env vars for provider switching:
- `AI_PROVIDER=grok` + `GROK_API_KEY=xai-...` to use Grok
- `AI_DAILY_BUDGET=0.50` to set daily cost cap (USD)

## Next Phase Readiness
- AI provider abstraction in place, ready for scraping hardening (06-02)
- Cost logging will immediately start capturing data once ai_usage table is created
- Admin can monitor costs via /api/admin/ai-costs

## Self-Check: PASSED

- All 4 files verified present (lib/ai-provider.js, server.js, schema.sql, .env.example)
- Both task commits found: abff019, 6d779d0
- callGemini references: 1 (comment only)
- callAI callsites: 5 (all migrated)
- ai_usage in schema: present
- /api/admin/ai-costs endpoint: present

---
*Phase: 06-ai-scraping-hardening*
*Completed: 2026-03-22*
