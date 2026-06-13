// ═══════════════════════════════════════════════════════════════
// AI PROVIDER ABSTRACTION — Multi-provider AI with cost logging
// ═══════════════════════════════════════════════════════════════
// Exports: callAI(), initAI(), getAICostSummary()
// Providers: Gemini (default), Grok (xAI)
// Cost logging: fire-and-forget to Supabase ai_usage table

// ── Dependencies (injected via initAI) ──
let _genAI = null;
let _supabase = null;

// ── Provider Registry ──
const PROVIDERS = {
  gemini: {
    fast: 'gemini-2.5-flash-lite',
    capable: 'gemini-2.5-pro',
    pricing: {
      'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },   // per 1M tokens
      'gemini-2.5-pro':        { input: 1.25, output: 10.00 },
    },
  },
  grok: {
    fast: 'grok-4-1-fast-non-reasoning',
    capable: 'grok-4-1-fast-reasoning',
    pricing: {
      'grok-4-1-fast-non-reasoning': { input: 0.20, output: 0.50 },
      'grok-4-1-fast-reasoning':     { input: 0.20, output: 0.50 },
    },
  },
  claude: {
    fast: 'claude-sonnet-4-6',
    capable: 'claude-sonnet-4-6',
    reasoning: 'claude-opus-4-6',
    pricing: {
      'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
      'claude-opus-4-6':   { input: 15.00, output: 75.00 },
    },
  },
  // OpenRouter — one key, OpenAI-compatible API, access to every model
  // (Gemini, Claude, Kimi, Llama …). Used to remove the single-provider SPOF:
  // when the direct Gemini key is quota/billing-dead, OpenRouter keeps
  // extraction alive on its own billing. Model IDs are env-overridable so the
  // operator can swap the underlying model without a deploy.
  openrouter: {
    // Both tiers accept a COMMA-SEPARATED chain — OpenRouter's `models` array
    // tries each in order within one request, so a free strong model can sit
    // first with a proven paid model as the in-request fallback, e.g.
    //   OPENROUTER_CAPABLE_MODEL="nvidia/llama-3.1-nemotron-ultra-253b-v1:free,google/gemini-2.5-pro"
    // (recall uplift at zero marginal cost; Pro catches free-tier rate limits).
    // Confirm exact slugs at openrouter.ai/models before setting.
    fast: process.env.OPENROUTER_FAST_MODEL || 'google/gemini-2.5-flash-lite',
    capable: process.env.OPENROUTER_CAPABLE_MODEL || 'google/gemini-2.5-pro',
    pricing: {
      // Approximate per-1M-token cost of the defaults; OpenRouter bills the
      // underlying model. estimateCost returns 0 for any unlisted model, so a
      // custom OPENROUTER_*_MODEL just logs $0 rather than crashing.
      'google/gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
      'google/gemini-2.5-pro':        { input: 1.25, output: 10.00 },
    },
  },
};

// ── Rate Limiters ──
const GEMINI_MIN_GAP = parseInt(process.env.GEMINI_MIN_GAP_MS || '100');
const GROK_MIN_GAP = parseInt(process.env.GROK_MIN_GAP_MS || '100');
const CLAUDE_MIN_GAP = parseInt(process.env.CLAUDE_MIN_GAP_MS || '200');
const OPENROUTER_MIN_GAP = parseInt(process.env.OPENROUTER_MIN_GAP_MS || '100');
let geminiLastCall = 0;
let grokLastCall = 0;
let claudeLastCall = 0;
let openrouterLastCall = 0;

async function rateLimited(provider, fn) {
  const now = Date.now();
  if (provider === 'gemini') {
    const earliest = geminiLastCall + GEMINI_MIN_GAP;
    const wait = Math.max(0, earliest - now);
    geminiLastCall = now + wait;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  } else if (provider === 'grok') {
    const earliest = grokLastCall + GROK_MIN_GAP;
    const wait = Math.max(0, earliest - now);
    grokLastCall = now + wait;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  } else if (provider === 'claude') {
    const earliest = claudeLastCall + CLAUDE_MIN_GAP;
    const wait = Math.max(0, earliest - now);
    claudeLastCall = now + wait;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  } else if (provider === 'openrouter') {
    const earliest = openrouterLastCall + OPENROUTER_MIN_GAP;
    const wait = Math.max(0, earliest - now);
    openrouterLastCall = now + wait;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
  return fn();
}

// ── Daily Budget Tracking (in-memory) ──
let dailyCostTotal = 0;
let dailyCallCount = 0;
let budgetExceeded = false;
const AI_DAILY_BUDGET = parseFloat(process.env.AI_DAILY_BUDGET || '0.50');

// Reset at midnight UTC
function resetDailyBudget() {
  dailyCostTotal = 0;
  dailyCallCount = 0;
  budgetExceeded = false;
}

// Calculate ms until next midnight UTC
function msUntilMidnightUTC() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.getTime() - now.getTime();
}

// Schedule first reset at midnight, then every 24h.
// .unref() so the timer doesn't hold the event loop open — without it,
// any test that transitively imports this module (e.g. via generate-prose
// in tests/test-curator.js) hangs after the test body completes because
// the pending timer keeps Node alive. Surfaced when CI hit the 10m
// timeout silently after the curator banner printed.
const _budgetResetTimer = setTimeout(() => {
  resetDailyBudget();
  const _interval = setInterval(resetDailyBudget, 24 * 60 * 60 * 1000);
  _interval.unref();
}, msUntilMidnightUTC());
_budgetResetTimer.unref();

// ── Cost Estimation ──
function estimateCost(provider, model, tokensIn, tokensOut) {
  const providerConfig = PROVIDERS[provider];
  if (!providerConfig) return 0;
  const pricing = providerConfig.pricing[model];
  if (!pricing) return 0;
  return (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000;
}

// ── Cost Logging (fire-and-forget) ──
function logAICost({ provider, model, tokensIn, tokensOut, estCost, taskType, durationMs, userId }) {
  if (!_supabase) return;
  const row = {
    provider,
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    est_cost: estCost,
    task_type: taskType,
    duration_ms: durationMs,
    user_id: userId || null,
  };
  _supabase
    .from('ai_usage')
    .insert(row)
    .then(({ error }) => {
      if (!error) return;
      // Graceful degradation: if the user_id column isn't present yet
      // (migration 2026-05-22-ai-usage-user-id not applied), retry without
      // it so cost logging keeps working — only per-user attribution is
      // lost until the migration lands.
      if (/user_id/i.test(error.message || '')) {
        const { user_id, ...legacy } = row;
        return _supabase.from('ai_usage').insert(legacy).then(() => {});
      }
      console.warn('AI cost log error:', error.message);
    })
    .catch(e => console.warn('AI cost log error:', e.message));
}

// ── Gemini Provider Call ──
async function callGeminiProvider(prompt, model, maxTokens, systemPrompt, pdfBase64) {
  if (!_genAI) throw new Error('AI provider not initialized — call initAI() first');

  const modelOpts = { model };
  if (systemPrompt) modelOpts.systemInstruction = systemPrompt;
  const m = _genAI.getGenerativeModel(modelOpts);
  const parts = [];
  if (pdfBase64) {
    parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfBase64 } });
  }
  parts.push({ text: prompt });

  const result = await rateLimited('gemini', () =>
    m.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: maxTokens },
    })
  );

  if (!result || !result.response) {
    throw new Error(`Gemini returned empty response (${model})`);
  }

  const usage = result.response.usageMetadata || {};
  return {
    text: result.response.text(),
    usage: {
      promptTokenCount: usage.promptTokenCount || 0,
      candidatesTokenCount: usage.candidatesTokenCount || 0,
    },
  };
}

// ── Grok Provider Call (OpenAI-compatible API) ──
async function callGrokProvider(prompt, model, maxTokens, systemPrompt) {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) throw new Error('GROK_API_KEY not set — required when AI_PROVIDER=grok');

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const response = await rateLimited('grok', () =>
    fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
      }),
    })
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Grok API error (${model}): ${response.status} ${body.substring(0, 200)}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error(`Grok returned empty response (${model})`);

  return {
    text: choice.message?.content || '',
    usage: {
      promptTokenCount: data.usage?.prompt_tokens || 0,
      candidatesTokenCount: data.usage?.completion_tokens || 0,
    },
  };
}

// ── OpenRouter Provider Call (OpenAI-compatible) ──
async function callOpenRouterProvider(prompt, model, maxTokens, systemPrompt, { skipFallbacks = false } = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set — required for the openrouter provider');

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  // Backup model(s), two sources merged in order:
  //   1. A comma-separated `model` value (per-tier chain, e.g. a free strong
  //      model first with a proven paid model as in-request fallback — see the
  //      PROVIDERS.openrouter comment).
  //   2. OPENROUTER_FALLBACK_MODELS (global backups, e.g. DeepSeek).
  // OpenRouter's `models` array tries each in order within ONE request, so if
  // the primary model is down/rate-limited it transparently rolls over to the
  // next — model-level resilience on top of the provider-level cascade in
  // callAI. skipFallbacks pins the call to exactly one model — used by
  // callSpecificModel so a benchmark measures the model it names, not a backup.
  const chain = String(model).split(',').map(s => s.trim()).filter(Boolean);
  model = chain[0];
  const backups = skipFallbacks ? [] : [
    ...chain.slice(1),
    ...(process.env.OPENROUTER_FALLBACK_MODELS || '').split(',').map(s => s.trim()).filter(Boolean),
  ].filter((m, i, a) => m !== model && a.indexOf(m) === i);
  const body = {
    messages,
    max_tokens: maxTokens,
    // Let OpenRouter transparently retry on an alternative UPSTREAM host if the
    // chosen model's provider is rate-limited.
    provider: { allow_fallbacks: true },
  };
  if (backups.length) body.models = [model, ...backups];
  else body.model = model;

  const response = await rateLimited('openrouter', () =>
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        // OpenRouter attribution headers (recommended, not required).
        'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://bridgematch.co.uk',
        'X-Title': 'AuctionBrain',
      },
      body: JSON.stringify(body),
    })
  );

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`OpenRouter API error (${model}${backups.length ? ` +${backups.length} backup` : ''}): ${response.status} ${errBody.substring(0, 200)}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error(`OpenRouter returned empty response (${model}): ${JSON.stringify(data).substring(0, 200)}`);
  // data.model reports which model actually served the request (may be a backup).
  if (backups.length && data.model && data.model !== model) {
    console.log(`AI: OpenRouter served via backup model ${data.model} (primary ${model} unavailable)`);
  }

  return {
    text: choice.message?.content || '',
    // Pass the SERVED model upward so ai_usage cost rows attribute the call to
    // the model that actually ran it (matters when a free-first chain rolls
    // over to a paid backup).
    servedModel: data.model || model,
    usage: {
      promptTokenCount: data.usage?.prompt_tokens || 0,
      candidatesTokenCount: data.usage?.completion_tokens || 0,
    },
  };
}

// ── Vision Call (OpenRouter, multimodal) ──
// Image classification/recognition via OpenRouter so it runs on OpenRouter's
// paid billing — NOT the direct Google free tier, whose daily quota is
// exhausted (limit:0 → every call 429s; 2026-06-13 image-filter stall).
// Model is env-overridable (OPENROUTER_VISION_MODEL); default a cheap
// multimodal model. NB text-only models (DeepSeek, most Nemotron variants)
// cannot accept images — the default must be vision-capable.
const OPENROUTER_VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || 'google/gemini-2.5-flash-lite';

/**
 * Classify/recognise an image with a vision model via OpenRouter.
 * Fetches the image, sends it inline (base64 data URL) with `prompt`, returns
 * the raw model text (caller parses). Cost-logged + budget-tracked like callAI.
 * Throws on missing key / fetch failure / API error so the caller can fail open.
 *
 * @param {string} imageUrl
 * @param {string} prompt
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=300]
 * @param {string} [opts.taskType='image-classify']
 * @param {number} [opts.fetchTimeoutMs=8000]
 * @returns {Promise<string>} model response text
 */
export async function callVisionAI(imageUrl, prompt, { maxTokens = 300, taskType = 'image-classify', fetchTimeoutMs = 8000 } = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set — required for vision (callVisionAI)');

  // Fetch the image and inline it as a data URL (OpenRouter vision input).
  const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(fetchTimeoutMs) });
  if (!imgResp.ok) throw new Error(`image fetch HTTP ${imgResp.status}`);
  const mimeType = imgResp.headers.get('content-type') || 'image/jpeg';
  const base64 = Buffer.from(await imgResp.arrayBuffer()).toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const model = OPENROUTER_VISION_MODEL.split(',')[0].trim();
  const start = Date.now();
  const response = await rateLimited('openrouter', () =>
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://bridgematch.co.uk',
        'X-Title': 'AuctionBrain',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
      }),
    })
  );

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`OpenRouter vision error (${model}): ${response.status} ${errBody.substring(0, 200)}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error(`OpenRouter vision empty response (${model})`);

  const servedModel = data.model || model;
  const tokensIn = data.usage?.prompt_tokens || 0;
  const tokensOut = data.usage?.completion_tokens || 0;
  const estCost = estimateCost('openrouter', servedModel, tokensIn, tokensOut);
  dailyCostTotal += estCost;
  dailyCallCount++;
  if (dailyCostTotal >= AI_DAILY_BUDGET) budgetExceeded = true;
  logAICost({ provider: 'openrouter', model: servedModel, tokensIn, tokensOut, estCost, taskType, durationMs: Date.now() - start });

  return choice.message?.content || '';
}

// ── Claude Provider Call (Anthropic Messages API) ──
async function callClaudeProvider(prompt, model, maxTokens, systemPrompt) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set — required for tier=reasoning');

  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (systemPrompt) body.system = systemPrompt;

  const response = await rateLimited('claude', () =>
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })
  );

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Claude API error (${model}): ${response.status} ${errBody.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  if (!text) throw new Error(`Claude returned empty response (${model})`);

  return {
    text,
    usage: {
      promptTokenCount: data.usage?.input_tokens || 0,
      candidatesTokenCount: data.usage?.output_tokens || 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize the AI provider with injected dependencies.
 * Must be called once at server startup after genAI and supabase are created.
 */
export function initAI(genAIInstance, supabaseClient) {
  _genAI = genAIInstance;
  _supabase = supabaseClient;
  const chain = buildProviderChain({ tier: 'fast' });
  console.log(`AI provider initialized: chain=[${chain.join(' → ')}] (budget: $${AI_DAILY_BUDGET}/day)`);
}

/**
 * Main AI call function — routes to the configured provider.
 *
 * @param {string} prompt - The prompt text
 * @param {object} opts - Options
 * @param {string} opts.tier - 'fast' or 'capable' (default: 'fast')
 * @param {number} opts.maxTokens - Max output tokens (default: 8000)
 * @param {string|null} opts.systemPrompt - System prompt (default: null)
 * @param {string|null} opts.pdfBase64 - Base64 PDF data (default: null) — forces Gemini
 * @param {string} opts.taskType - Task category for cost tracking (default: 'extraction')
 * @param {string|null} opts.userId - User who triggered the call, for ai_usage attribution (default: null)
 * @returns {Promise<string>} The AI response text
 */
// Build the ordered list of providers to try for a call. The first is the
// primary; the rest are fallbacks tried in order if the primary throws. This is
// what removes the single-provider SPOF — a Gemini 429 transparently rolls over
// to OpenRouter instead of killing extraction.
//   - reasoning tier → Claude (then fallbacks)
//   - inline PDF → Gemini only (inline PDF isn't portable across providers)
//   - otherwise → AI_PROVIDER (default gemini), then AI_FALLBACK_PROVIDERS
//     (defaults to 'openrouter' when OPENROUTER_API_KEY is set)
export function buildProviderChain({ tier = 'fast', pdfBase64 = null } = {}) {
  if (pdfBase64) return ['gemini'];
  const primary = tier === 'reasoning' ? 'claude' : (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  // Default fallbacks: every OTHER configured provider, so a single provider
  // failure can never zero extraction. Found 2026-06-11: AI_PROVIDER=openrouter
  // produced chain=[openrouter] — the direct-Gemini key (set and healthy) was
  // silently dropped, so any OpenRouter failure had no fallback at all.
  // An explicit AI_FALLBACK_PROVIDERS (including '') still overrides this.
  const fbRaw = process.env.AI_FALLBACK_PROVIDERS != null
    ? process.env.AI_FALLBACK_PROVIDERS
    : [
        process.env.OPENROUTER_API_KEY ? 'openrouter' : '',
        process.env.GEMINI_API_KEY ? 'gemini' : '',
      ].filter(Boolean).join(',');
  const fallbacks = fbRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const chain = [primary, ...fallbacks];
  return chain.filter((p, i) => PROVIDERS[p] && chain.indexOf(p) === i);
}

// True when extraction has a non-Gemini path available, so the Gemini-specific
// "credit exhausted" short-circuit in the extractor should be ignored.
export function hasAIFallback() {
  const chain = buildProviderChain({ tier: 'fast', pdfBase64: null });
  return chain.length > 1 || (chain[0] && chain[0] !== 'gemini');
}

async function dispatchProvider(providerName, prompt, model, maxTokens, systemPrompt, pdfBase64) {
  if (providerName === 'claude') return callClaudeProvider(prompt, model, maxTokens, systemPrompt);
  if (providerName === 'grok') return callGrokProvider(prompt, model, maxTokens, systemPrompt);
  if (providerName === 'openrouter') return callOpenRouterProvider(prompt, model, maxTokens, systemPrompt);
  return callGeminiProvider(prompt, model, maxTokens, systemPrompt, pdfBase64);
}

/**
 * Call ONE explicit model, bypassing the provider chain, budget, and any
 * OpenRouter fallback list — used by the extraction-model A/B harness
 * (scripts/test-extraction-model-ab.mjs) so each model is measured exactly as
 * named. Returns { text, usage }. OpenRouter is the default provider because a
 * single key reaches every model (Gemini, Claude, DeepSeek, Nemotron, …).
 *
 * @param {string} prompt
 * @param {object} opts
 * @param {string} [opts.provider='openrouter']
 * @param {string} opts.model - model slug for the provider
 * @param {number} [opts.maxTokens=16000]
 * @param {string|null} [opts.systemPrompt=null]
 * @param {string|null} [opts.pdfBase64=null] - only for provider='gemini'
 * @returns {Promise<{text:string, usage:{promptTokenCount:number, candidatesTokenCount:number}}>}
 */
export async function callSpecificModel(prompt, { provider = 'openrouter', model, maxTokens = 16000, systemPrompt = null, pdfBase64 = null } = {}) {
  if (!model) throw new Error('callSpecificModel: model is required');
  if (provider === 'openrouter') return callOpenRouterProvider(prompt, model, maxTokens, systemPrompt, { skipFallbacks: true });
  if (provider === 'gemini') return callGeminiProvider(prompt, model, maxTokens, systemPrompt, pdfBase64);
  if (provider === 'claude') return callClaudeProvider(prompt, model, maxTokens, systemPrompt);
  if (provider === 'grok') return callGrokProvider(prompt, model, maxTokens, systemPrompt);
  throw new Error(`callSpecificModel: unknown provider '${provider}'`);
}

export async function callAI(prompt, { tier = 'fast', maxTokens = 8000, systemPrompt = null, pdfBase64 = null, taskType = 'extraction', budgetExempt = false, userId = null } = {}) {
  const chain = buildProviderChain({ tier, pdfBase64 });
  if (chain.length === 0) throw new Error('No AI provider configured (check AI_PROVIDER / API keys)');

  // Budget check (soft cap — log warning but still proceed). Skip for budgetExempt calls.
  if (!budgetExempt && dailyCostTotal >= AI_DAILY_BUDGET) {
    budgetExceeded = true;
    console.warn(`AI daily budget exceeded: $${dailyCostTotal.toFixed(4)} >= $${AI_DAILY_BUDGET} (proceeding anyway)`);
  }

  let lastErr;
  for (let idx = 0; idx < chain.length; idx++) {
    const providerName = chain[idx];
    const providerConfig = PROVIDERS[providerName];
    const model = providerConfig[tier] || providerConfig.fast;
    const start = Date.now();
    try {
      const result = await dispatchProvider(providerName, prompt, model, maxTokens, systemPrompt, pdfBase64);
      const durationMs = Date.now() - start;
      const tokensIn = result.usage.promptTokenCount;
      const tokensOut = result.usage.candidatesTokenCount;
      // Attribute cost to the model that actually served the call (OpenRouter
      // free-first chains may roll over to a paid backup mid-request).
      const servedModel = result.servedModel || model;
      const estCost = estimateCost(providerName, servedModel, tokensIn, tokensOut);

      if (!budgetExempt) {
        dailyCostTotal += estCost;
        dailyCallCount++;
        if (dailyCostTotal >= AI_DAILY_BUDGET) budgetExceeded = true;
      }
      logAICost({ provider: providerName, model: servedModel, tokensIn, tokensOut, estCost, taskType, durationMs, userId });
      if (idx > 0) console.log(`AI: ${providerName} succeeded after ${idx} provider failure(s) [${taskType}]`);
      return result.text;
    } catch (err) {
      lastErr = err;
      const more = idx < chain.length - 1;
      console.warn(`AI provider ${providerName} failed (${err.message})${more ? ` — falling back to ${chain[idx + 1]}` : ' — no more providers'}`);
    }
  }
  throw lastErr || new Error('All AI providers failed');
}

/**
 * Returns in-memory AI cost summary for the admin endpoint.
 */
export function getAICostSummary() {
  return {
    dailyCostTotal: Math.round(dailyCostTotal * 1000000) / 1000000,
    budgetExceeded,
    callCount: dailyCallCount,
    budget: AI_DAILY_BUDGET,
    provider: (process.env.AI_PROVIDER || 'gemini').toLowerCase(),
  };
}
