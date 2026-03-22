# Phase 6: AI & Scraping Hardening - Research

**Researched:** 2026-03-22
**Domain:** AI provider abstraction, cost logging, DOM extractor auditing, admin dashboard
**Confidence:** HIGH

## Summary

This phase has two major workstreams: (1) extracting the AI layer into a multi-provider abstraction with cost logging, and (2) auditing and hardening the scraping/extractor pipeline with admin visibility improvements.

The AI abstraction is well-scoped. The existing `callGemini()` function at server.js:908 is the single choke-point -- all AI calls flow through it. The `@google/generative-ai` SDK already returns `usageMetadata` on every response with `promptTokenCount` and `candidatesTokenCount`, making token tracking straightforward. The xAI Grok API is OpenAI-compatible (`https://api.x.ai/v1`), so it can be called with a lightweight `fetch`-based wrapper using the same chat completions format.

The scraping audit has strong existing infrastructure. `scripts/audit.mjs` already runs HTTP probes, Puppeteer probes, production comparison, structure fingerprinting, and problem detection. Extending it with lot-count cross-validation is the main gap. The admin dashboard currently has 2 tabs (Overview, Analytics) -- a new System Health tab needs adding.

**Primary recommendation:** Build `lib/ai-provider.js` as a single module exporting `callAI()` that wraps both Gemini (existing SDK) and Grok (fetch-based OpenAI-compatible). Log every call to a new `ai_usage` Supabase table. Extend the existing audit.mjs for lot-count validation. Add a System Health tab to admin.html.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Multi-provider ready: abstract to a generic `callAI()` interface, not just a Gemini extraction
- Day-one providers: Gemini (existing) + Grok (xAI) via OpenAI-compatible API
- Model tier abstraction: each provider exposes a cheap/fast model and a capable/expensive model (e.g., Gemini flash-lite vs pro, Grok mini vs full). The provider layer handles this mapping internally
- Provider and model selection: Claude's discretion on whether to use a single env var or per-task env vars, based on how the code uses AI (extraction, search, discovery have different needs)
- Extract `callGemini()` and related functions from server.js to `lib/ai-provider.js`
- Per-call logging to new Supabase `ai_usage` table: provider, model, tokens_in, tokens_out, est_cost, timestamp, task_type
- Dedicated "AI Costs" section in admin dashboard with daily spend, per-model breakdown, and budget tracking
- Daily cost budget alert via `AI_DAILY_BUDGET` env var (e.g., 0.50). Admin shows red warning when exceeded
- AI cost tracking only -- Firecrawl cost-monitor stays as-is (separate system)
- "Broken" defined by comparing scraped lot count vs house-advertised lot count
- Self-audit validation: cross-reference scraped count against house's stated count
- Multi-angle validation: research approaches for maximum coverage (pagination detection, alternate URL patterns, API endpoints)
- Automated + ongoing: extend existing nightly audit (scripts/audit.mjs) for lot-count comparison
- Auto-disable broken extractors + pipeline alert when mismatch detected. Gemini fallback handles extraction until manually fixed. Re-enable after fix
- Image coverage verification across all houses (target >90%)
- Add 5-10 new houses if time allows -- target easy additions (EIG platform clones or Auction House UK network branches)
- New "System Health" tab in admin with 4 sections: Broken Extractors (red alerts), AI Costs (daily spend + budget), Coverage (house-by-house grid), Pipeline Health (engine status)
- Stale cached houses: collapse into summary count ("12 inactive houses -- no upcoming auctions"), expandable if needed
- Upcoming auctions section: confirm house is reporting correctly (validated lot count)
- Issues section: include diagnostic hints and attempt auto-fix where possible
- Missing catalogues section: clarify what it means or auto-fix if possible
- Fix perpetual "analysing" status bug: show actual state or "idle"
- All four priority areas at a glance: broken extractors, AI cost today, coverage summary, pipeline health

### Claude's Discretion
- Per-task vs single env var for provider selection (based on how extraction, search, and discovery use AI differently)
- Auto-fix implementation details for broken extractors (what's realistically automatable)
- Exact layout and styling of new System Health tab
- Timeout/retry logic for the "stuck analysing" UI fix
- Which specific new auction houses to recruit (EIG/AuctionHouseUK clones)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AI-01 | `callGemini()` extracted to `lib/ai-provider.js` with provider abstraction | Provider abstraction pattern documented; Gemini SDK + Grok fetch wrapper architecture |
| AI-02 | Token usage and cost logging per API call | Gemini `usageMetadata` returns token counts; xAI returns OpenAI-format `usage`; pricing tables for cost estimation |
| AI-03 | Model selection via env var (ready for future provider swap) | `AI_PROVIDER` env var + tier mapping (fast/capable per provider) |
| SCRP-01 | All existing DOM extractors audited and broken ones fixed | Extend audit.mjs with lot-count cross-validation; auto-disable pattern |
| SCRP-02 | Image coverage verified across all houses (target >90%) | Existing audit.mjs already checks image coverage; extend with per-house reporting |
| SCRP-03 | New auction houses recruited to increase coverage | EIG platform clones share identical HTML structure; Auction House UK branches use same platform |
| SCRP-04 | Admin dashboard cleaned up -- surface actionable data, hide noise | New System Health tab with 4 sections; collapse stale houses; fix "analysing" bug |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@google/generative-ai` | ^0.24.1 | Gemini API calls | Already in project, provides `usageMetadata` for token tracking |
| Native `fetch` | Built-in | Grok/xAI API calls | xAI is OpenAI-compatible REST; no SDK needed, just fetch to `https://api.x.ai/v1/chat/completions` |
| `@supabase/supabase-js` | ^2.45.0 | Already in project | `ai_usage` table for cost logging follows existing pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `puppeteer` | ^22.0.0 | Already in project | Audit script Puppeteer probes |
| `jsdom` | ^24.0.0 | Already in project | DOM extractor testing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native fetch for Grok | `openai` npm package | Adds 2MB dependency for one endpoint; fetch is simpler for this use case |
| `@google/genai` (new SDK) | Current `@google/generative-ai` | Google deprecated the old SDK in favor of `@google/genai` but migration is out of scope -- current SDK works fine and returns usageMetadata |

**No new dependencies needed.** The provider abstraction uses the existing Gemini SDK + native fetch for Grok.

## Architecture Patterns

### Recommended Project Structure
```
lib/
  ai-provider.js       # NEW: callAI(), provider registry, cost logging
server.js              # MODIFIED: import callAI from lib, remove callGemini
scripts/
  audit.mjs            # MODIFIED: add lot-count cross-validation
admin.html             # MODIFIED: add System Health tab
schema.sql             # MODIFIED: add ai_usage table
```

### Pattern 1: Provider Abstraction Layer
**What:** Single `callAI(prompt, opts)` function that routes to the configured provider
**When to use:** Every AI call in the system

```javascript
// lib/ai-provider.js
import { GoogleGenerativeAI } from '@google/generative-ai';

// Provider registry
const PROVIDERS = {
  gemini: {
    fast: 'gemini-2.5-flash-lite',
    capable: 'gemini-2.5-pro',
    call: callGeminiProvider,
    pricing: {
      'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },  // per 1M tokens
      'gemini-2.5-pro': { input: 1.25, output: 10.00 },
    },
  },
  grok: {
    fast: 'grok-4-1-fast-non-reasoning',
    capable: 'grok-4-1-fast-reasoning',
    call: callGrokProvider,
    pricing: {
      'grok-4-1-fast-non-reasoning': { input: 0.20, output: 0.50 },
      'grok-4-1-fast-reasoning': { input: 0.20, output: 0.50 },
    },
  },
};

// Main interface
export async function callAI(prompt, {
  tier = 'fast',          // 'fast' or 'capable'
  maxTokens = 8000,
  systemPrompt = null,
  pdfBase64 = null,
  taskType = 'extraction', // for logging: extraction, search, discovery
} = {}) {
  const providerName = process.env.AI_PROVIDER || 'gemini';
  const provider = PROVIDERS[providerName];
  const model = provider[tier];

  const startTime = Date.now();
  const { text, usage } = await provider.call(prompt, { model, maxTokens, systemPrompt, pdfBase64 });

  // Log cost asynchronously (fire and forget)
  logAICost({
    provider: providerName, model,
    tokens_in: usage.promptTokenCount,
    tokens_out: usage.candidatesTokenCount,
    est_cost: estimateCost(providerName, model, usage),
    task_type: taskType,
    duration_ms: Date.now() - startTime,
  });

  return text;
}
```

### Pattern 2: Grok via OpenAI-Compatible Fetch
**What:** Lightweight fetch wrapper for xAI's OpenAI-compatible endpoint
**When to use:** When AI_PROVIDER=grok

```javascript
async function callGrokProvider(prompt, { model, maxTokens, systemPrompt }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Grok API error (${model}): ${res.status} ${err}`);
  }

  const data = await res.json();
  return {
    text: data.choices[0].message.content,
    usage: {
      promptTokenCount: data.usage.prompt_tokens,
      candidatesTokenCount: data.usage.completion_tokens,
    },
  };
}
```

### Pattern 3: Cost Logging to Supabase
**What:** Async fire-and-forget logging of every AI call
**When to use:** After every callAI() invocation

```javascript
async function logAICost({ provider, model, tokens_in, tokens_out, est_cost, task_type, duration_ms }) {
  try {
    await supabase.from('ai_usage').insert({
      provider, model, tokens_in, tokens_out,
      est_cost, task_type, duration_ms,
    });
  } catch (e) {
    console.warn('AI cost log error:', e.message);
  }
}
```

### Pattern 4: Single AI_PROVIDER Env Var (Recommended)
**What:** One env var selects the provider for ALL AI tasks; tier (fast/capable) is determined by task context as it already is today (Flash for known houses, Pro for unknown/PDF)
**Why:** The current code already differentiates between MODEL_FLASH and MODEL_PRO based on house type. The provider abstraction maps these to tier='fast' and tier='capable' internally. No need for per-task env vars -- the task context already carries the tier information.

```
AI_PROVIDER=gemini          # or 'grok'
GROK_API_KEY=xai-...        # only needed when AI_PROVIDER=grok
AI_DAILY_BUDGET=0.50        # daily spend cap in USD
```

### Pattern 5: Lot-Count Cross-Validation
**What:** Scrape the house's own "total lots" indicator and compare to extracted lot count
**When to use:** In audit.mjs nightly run

```javascript
// During Puppeteer probe, extract the house's stated lot count
const statedCount = await page.evaluate(() => {
  const text = document.body.innerText;
  // Common patterns: "45 Lots", "Showing 1-20 of 45", "45 properties"
  const match = text.match(/(\d+)\s+(?:lots?|properties|results)/i) ||
                text.match(/of\s+(\d+)/i);
  return match ? parseInt(match[1]) : null;
});

// Compare: if stated > extracted * 1.3, flag mismatch
if (statedCount && statedCount > extractorLots * 1.3) {
  issues.push({
    type: 'LOT_COUNT_MISMATCH',
    severity: 'BROKEN',
    detail: `House says ${statedCount} lots but extractor found ${extractorLots}`,
  });
}
```

### Anti-Patterns to Avoid
- **Don't create separate SDK clients for Grok:** Use native fetch. The xAI API is simple REST; adding the openai package is unnecessary bloat.
- **Don't log costs synchronously:** Cost logging must be fire-and-forget to avoid slowing AI responses. Never await the Supabase insert in the critical path.
- **Don't extract to multiple files:** Keep it as one `lib/ai-provider.js` module. The project convention is monolithic; one new file is already a concession.
- **Don't change the callGemini signature everywhere at once:** Create `callAI()` as the new interface, then update callers one by one. Keep `callGemini()` as a deprecated wrapper initially if needed during migration.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Manual string-length estimation | `response.usageMetadata` from Gemini SDK / `usage` from xAI response | SDK returns exact counts including thinking tokens |
| Cost estimation | Complex per-model calculator | Simple lookup table in provider registry | Pricing changes rarely; a static map per model is sufficient |
| OpenAI-compatible client | Full SDK wrapper | Native `fetch` to `api.x.ai/v1/chat/completions` | xAI endpoint is standard REST; fetch is simpler than importing a library |
| Audit lot-count detection | Custom per-house scrapers | Regex patterns on `document.body.innerText` | Most houses use "X lots" or "Showing X of Y" patterns; heuristic is good enough |

**Key insight:** The existing audit.mjs already does 90% of what SCRP-01/SCRP-02 need. The main additions are lot-count cross-validation and auto-disable logic. Don't rebuild the audit system.

## Common Pitfalls

### Pitfall 1: Gemini usageMetadata Not Extracted
**What goes wrong:** The current `callGemini()` returns `result.response.text()` but discards `result.response.usageMetadata`. Token counts are lost.
**Why it happens:** The function was written before cost tracking was needed.
**How to avoid:** Modify the provider wrapper to extract both text and usageMetadata from the response object before returning.
**Warning signs:** `tokens_in` and `tokens_out` are always null in the `ai_usage` table.

### Pitfall 2: Grok PDF Support
**What goes wrong:** Grok/xAI does not support `inlineData` with PDF base64 like Gemini does. If `pdfBase64` is passed to Grok, it will fail.
**Why it happens:** The current `callGemini()` supports PDFs via Gemini's multimodal input. Grok's chat completions API is text-only.
**How to avoid:** When `pdfBase64` is provided, force the provider to Gemini regardless of `AI_PROVIDER` env var. Document this limitation.
**Warning signs:** PDF extraction calls fail when AI_PROVIDER=grok.

### Pitfall 3: Rate Limiting Differences
**What goes wrong:** The existing Gemini rate limiter (100ms gap) is tuned for Gemini Tier 1. Grok has different rate limits.
**Why it happens:** Rate limiting is currently coupled to Gemini-specific timing.
**How to avoid:** Move rate limiting into each provider's `call` function with provider-specific gaps. Gemini keeps 100ms; Grok may need different timing.
**Warning signs:** 429 errors from one provider but not the other.

### Pitfall 4: Admin Tab Injection Order
**What goes wrong:** Adding a new tab to admin.html breaks existing tab switching if the switchTab() function doesn't handle new tab IDs.
**Why it happens:** The tab system uses `data-tab` attributes and `switchTab('tabname')` -- new tabs need both a button and a pane with matching IDs.
**How to avoid:** Follow the exact same pattern as existing tabs: `<button class="tab-btn" data-tab="health" onclick="switchTab('health')">System Health</button>` and `<div class="tab-pane" id="tab-health">`.
**Warning signs:** Clicking the new tab shows blank content or breaks other tabs.

### Pitfall 5: Auto-Disable Breaking Production
**What goes wrong:** Auto-disabling a broken extractor stops that house from being scraped entirely, even if Gemini fallback could handle it.
**Why it happens:** "Disable" is too aggressive -- the intent is to flag and fall back, not stop.
**How to avoid:** Auto-disable means "skip DOM extractor, use Gemini AI fallback directly" -- not "remove house from pipeline". The house should still be scraped, just via Gemini extraction.
**Warning signs:** Houses disappear from the lot listing after auto-disable.

### Pitfall 6: Cost Budget Check Race Condition
**What goes wrong:** Multiple concurrent AI calls check the daily budget simultaneously, all see "under budget", and collectively exceed it.
**Why it happens:** Budget check is non-atomic across concurrent requests.
**How to avoid:** Use an in-memory running total (not just DB queries) with an atomic increment. Check budget before each call using the in-memory counter, not a DB query.
**Warning signs:** Daily spend exceeds AI_DAILY_BUDGET by 2-3x.

## Code Examples

### Supabase ai_usage Table Schema
```sql
-- New table for AI cost tracking
CREATE TABLE ai_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL,           -- 'gemini' or 'grok'
  model TEXT NOT NULL,              -- e.g. 'gemini-2.5-flash-lite'
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  est_cost NUMERIC(10,6) DEFAULT 0, -- estimated cost in USD
  task_type TEXT,                   -- 'extraction', 'search', 'discovery'
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_usage_created ON ai_usage(created_at DESC);
CREATE INDEX idx_ai_usage_provider ON ai_usage(provider, created_at DESC);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON ai_usage FOR ALL USING (true) WITH CHECK (true);
```

### Admin API Endpoint for AI Costs
```javascript
// GET /api/admin/ai-costs -- returns daily spend summary
app.get('/api/admin/ai-costs', async (req, res) => {
  const token = req.headers['x-admin-secret'] || '';
  if (!process.env.ADMIN_SECRET || !safeCompare(token, process.env.ADMIN_SECRET)) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('ai_usage')
    .select('provider, model, tokens_in, tokens_out, est_cost, task_type, created_at')
    .gte('created_at', today + 'T00:00:00Z');

  const dailyTotal = (data || []).reduce((sum, r) => sum + (r.est_cost || 0), 0);
  const budget = parseFloat(process.env.AI_DAILY_BUDGET || '0.50');
  const overBudget = dailyTotal > budget;

  // Group by model
  const byModel = {};
  for (const row of (data || [])) {
    const key = `${row.provider}/${row.model}`;
    if (!byModel[key]) byModel[key] = { calls: 0, tokens_in: 0, tokens_out: 0, cost: 0 };
    byModel[key].calls++;
    byModel[key].tokens_in += row.tokens_in || 0;
    byModel[key].tokens_out += row.tokens_out || 0;
    byModel[key].cost += row.est_cost || 0;
  }

  res.json({ dailyTotal, budget, overBudget, byModel, callCount: (data || []).length });
});
```

### Extracting usageMetadata from Gemini Response
```javascript
// Current: result.response.text() -- discards metadata
// New: extract both text and usage
async function callGeminiProvider(prompt, { model, maxTokens, systemPrompt, pdfBase64 }) {
  const config = { maxOutputTokens: maxTokens };
  const modelOpts = { model };
  if (systemPrompt) modelOpts.systemInstruction = systemPrompt;
  const m = genAI.getGenerativeModel(modelOpts);

  const parts = [];
  if (pdfBase64) parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfBase64 } });
  parts.push({ text: prompt });

  const result = await rateLimited('gemini', () =>
    m.generateContent({ contents: [{ role: 'user', parts }], generationConfig: config })
  );

  const response = result.response;
  const usage = response.usageMetadata || {};

  return {
    text: response.text(),
    usage: {
      promptTokenCount: usage.promptTokenCount || 0,
      candidatesTokenCount: usage.candidatesTokenCount || 0,
    },
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@google/generative-ai` SDK | `@google/genai` (new official SDK) | Late 2025 | Old SDK still works but is deprecated. Migration optional for now. |
| Gemini free tier (15 RPM) | Gemini paid Tier 1 (~2000 RPM for flash-lite) | Already in project (GEMINI_MIN_GAP=100ms) | Much higher throughput; rate limiter already adjusted |
| xAI Grok 2/3 | Grok 4.1 Fast (March 2026) | March 2026 | $0.20/M input, $0.50/M output -- very competitive with Gemini Flash-Lite |

**Deprecated/outdated:**
- `@google/generative-ai` npm package: Google recommends migration to `@google/genai` but the old package works. Do NOT migrate as part of this phase -- that's a separate effort.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Custom vanilla assertions with JSDOM (no test library) |
| Config file | `tests/test-extractors.js` (existing) |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AI-01 | callAI routes to correct provider | unit | `node tests/test-ai-provider.js` | No -- Wave 0 |
| AI-02 | Token usage logged to ai_usage table | integration | Manual -- requires Supabase | manual-only |
| AI-03 | AI_PROVIDER env var switches provider | unit | `node tests/test-ai-provider.js` | No -- Wave 0 |
| SCRP-01 | DOM extractors return non-zero lots | unit | `npm test` (existing) | Yes |
| SCRP-02 | Image coverage >90% per house | integration | `node scripts/audit.mjs --fast` | Yes (existing audit) |
| SCRP-03 | New houses return lots | unit | `npm test` (with new snapshots) | Partial -- needs new snapshots |
| SCRP-04 | Admin System Health tab renders | manual-only | Visual check of admin.html | manual-only |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test && node scripts/audit.mjs --fast`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test-ai-provider.js` -- unit tests for provider abstraction (AI-01, AI-03)
- [ ] `lib/` directory creation -- doesn't exist yet, needed for `lib/ai-provider.js`

## Open Questions

1. **Which specific EIG/Auction House UK branches to recruit?**
   - What we know: EIG platform clones share identical HTML structure (knightfrank, paulfosh, cottons, dedmangray, landwood, mchughandco, tcpa all use EIG). Auction House UK has a network of regional branches.
   - What's unclear: Which branches have active upcoming auctions worth scraping
   - Recommendation: Run `audit.mjs --discover` to find EIG branches, then pick 5-10 with active catalogues

2. **"Stuck analysing" bug root cause**
   - What we know: User reports admin sections permanently show "analysing" when nothing is running
   - What's unclear: Whether this is a frontend state issue (admin.html) or a backend status endpoint returning stale state
   - Recommendation: Investigate during implementation -- likely a missing "idle" state fallback in the admin polling logic

3. **Auto-fix scope for broken extractors**
   - What we know: Common failures are selector mismatches and URL changes
   - What's unclear: How much can realistically be auto-fixed without human review
   - Recommendation: Auto-fix is limited to: (a) switching to universal extractor when custom fails, (b) trying known URL rewrites, (c) falling back to Gemini extraction. True selector fixes require human review.

## Sources

### Primary (HIGH confidence)
- Project codebase: `server.js` lines 908-938 (callGemini), 238-244 (model constants, rate limiter), 5284-5323 (extractLotsWithAI)
- Project codebase: `scripts/audit.mjs` (full audit system, 922 lines)
- Project codebase: `schema.sql` (existing tables including pipeline_alerts)
- Project codebase: `admin.html` (existing tab structure)
- [Gemini usageMetadata docs](https://github.com/google-gemini/deprecated-generative-ai-js/blob/main/docs/reference/main/generative-ai.usagemetadata.md) -- token count fields
- [xAI migration guide](https://docs.x.ai/docs/guides/migration) -- OpenAI-compatible API at `https://api.x.ai/v1`
- [xAI models and pricing](https://docs.x.ai/developers/models) -- Grok 4.1 Fast at $0.20/$0.50 per 1M tokens

### Secondary (MEDIUM confidence)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) -- Flash-Lite $0.10/$0.40, Pro $1.25/$10.00 per 1M tokens
- Multiple pricing comparison sources confirming token costs

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, verified against existing codebase
- Architecture: HIGH -- pattern follows existing conventions, verified API compatibility
- Pitfalls: HIGH -- derived from direct code analysis of existing callGemini, admin.html, audit.mjs
- Pricing: MEDIUM -- verified via multiple sources but prices change frequently

**Research date:** 2026-03-22
**Valid until:** 2026-04-07 (pricing may shift; API compatibility stable)
