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
};

// ── Rate Limiters ──
const GEMINI_MIN_GAP = parseInt(process.env.GEMINI_MIN_GAP_MS || '100');
const GROK_MIN_GAP = parseInt(process.env.GROK_MIN_GAP_MS || '100');
const CLAUDE_MIN_GAP = parseInt(process.env.CLAUDE_MIN_GAP_MS || '200');
let geminiLastCall = 0;
let grokLastCall = 0;
let claudeLastCall = 0;

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

// Schedule first reset at midnight, then every 24h
setTimeout(() => {
  resetDailyBudget();
  setInterval(resetDailyBudget, 24 * 60 * 60 * 1000);
}, msUntilMidnightUTC());

// ── Cost Estimation ──
function estimateCost(provider, model, tokensIn, tokensOut) {
  const providerConfig = PROVIDERS[provider];
  if (!providerConfig) return 0;
  const pricing = providerConfig.pricing[model];
  if (!pricing) return 0;
  return (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000;
}

// ── Cost Logging (fire-and-forget) ──
function logAICost({ provider, model, tokensIn, tokensOut, estCost, taskType, durationMs }) {
  if (!_supabase) return;
  _supabase
    .from('ai_usage')
    .insert({
      provider,
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      est_cost: estCost,
      task_type: taskType,
      duration_ms: durationMs,
    })
    .then(() => {})
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
  console.log(`AI provider initialized: ${process.env.AI_PROVIDER || 'gemini'} (budget: $${AI_DAILY_BUDGET}/day)`);
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
 * @returns {Promise<string>} The AI response text
 */
export async function callAI(prompt, { tier = 'fast', maxTokens = 8000, systemPrompt = null, pdfBase64 = null, taskType = 'extraction', budgetExempt = false } = {}) {
  // Determine provider — reasoning tier forces Claude, PDF forces Gemini
  let providerName;
  if (tier === 'reasoning') {
    providerName = 'claude';
  } else if (pdfBase64) {
    providerName = 'gemini';
  } else {
    providerName = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  }
  const providerConfig = PROVIDERS[providerName];
  if (!providerConfig) throw new Error(`Unknown AI provider: ${providerName}`);

  const model = providerConfig[tier] || providerConfig.fast;

  // Budget check (soft cap — log warning but still proceed). Skip for budgetExempt calls.
  if (!budgetExempt && dailyCostTotal >= AI_DAILY_BUDGET) {
    budgetExceeded = true;
    console.warn(`AI daily budget exceeded: $${dailyCostTotal.toFixed(4)} >= $${AI_DAILY_BUDGET} (proceeding anyway)`);
  }

  const start = Date.now();
  let result;

  if (providerName === 'claude') {
    result = await callClaudeProvider(prompt, model, maxTokens, systemPrompt);
  } else if (providerName === 'grok') {
    result = await callGrokProvider(prompt, model, maxTokens, systemPrompt);
  } else {
    result = await callGeminiProvider(prompt, model, maxTokens, systemPrompt, pdfBase64);
  }

  const durationMs = Date.now() - start;
  const tokensIn = result.usage.promptTokenCount;
  const tokensOut = result.usage.candidatesTokenCount;
  const estCost = estimateCost(providerName, model, tokensIn, tokensOut);

  // Update in-memory budget tracker (skip for budgetExempt calls like manager reasoning)
  if (!budgetExempt) {
    dailyCostTotal += estCost;
    dailyCallCount++;
    if (dailyCostTotal >= AI_DAILY_BUDGET) budgetExceeded = true;
  }

  // Fire-and-forget cost logging
  logAICost({ provider: providerName, model, tokensIn, tokensOut, estCost, taskType, durationMs });

  return result.text;
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
