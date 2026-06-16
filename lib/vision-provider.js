// ═══════════════════════════════════════════════════════════════
// VISION PROVIDER — image classification via OpenRouter cheap-vision cascade
// ═══════════════════════════════════════════════════════════════
// Exports: classifyImageViaOpenRouter(), isOpenRouterVisionEnabled(), visionModels()
//
// Why this exists: the image-quality-filter classified scraped photos by
// calling Gemini directly (gemini-2.0-flash-lite, free tier). When that quota
// dies, every classify call fails — and the filter used to discard on failure,
// which wiped galleries. Routing through OpenRouter with a multi-provider cheap
// FLASH-VISION cascade removes the single-provider quota cliff (Simon,
// 2026-06-17: "ensure openrouter is used … cheap model with visual capabilities
// e.g. Gemini Flash as main, other cheap flash vision LLMs as backup").
//
// NOTE on DeepSeek: requested as a fallback, but verified text-only on
// OpenRouter (0 of 11 deepseek models accept image input, 2026-06-17), so it
// cannot sit in a vision cascade. Cheap flash-vision models from other
// providers are used instead. DeepSeek stays available for TEXT extraction.

import { log } from './logging.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ── Cheap flash-VISION cascade ──
// Ordered by priority. All verified image-capable + <$0.10/M input on
// OpenRouter (2026-06-17). Diverse providers so one provider's outage doesn't
// take out the whole cascade. Override with OPENROUTER_VISION_MODELS
// (comma-separated, priority order) — no deploy needed to retune.
const DEFAULT_VISION_MODELS = [
  'google/gemini-2.5-flash-lite',   // primary — cheap Gemini Flash ($0.10/M)
  'qwen/qwen3-vl-8b-instruct',      // fallback — Qwen vision ($0.08/M)
  'bytedance-seed/seed-1.6-flash',  // fallback — flash vision ($0.075/M)
];

const PER_MODEL_TIMEOUT_MS = parseInt(process.env.OPENROUTER_VISION_TIMEOUT_MS || '12000', 10);

export function visionModels() {
  const env = (process.env.OPENROUTER_VISION_MODELS || '').trim();
  if (env) return env.split(',').map(s => s.trim()).filter(Boolean);
  return DEFAULT_VISION_MODELS;
}

export function isOpenRouterVisionEnabled() {
  return !!process.env.OPENROUTER_API_KEY;
}

// Vision models don't reliably honour response_format, and some wrap JSON in
// prose or markdown fences. Pull the first balanced {...} object out defensively.
export function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); }
  catch { return null; }
}

async function callModel({ model, prompt, dataUrl }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // OpenRouter attribution headers (optional, recommended).
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://auctions.bridgematch.co.uk',
      'X-Title': 'AuctionBrain image filter',
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 200,
    }),
    signal: AbortSignal.timeout(PER_MODEL_TIMEOUT_MS),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`OpenRouter ${model}: HTTP ${resp.status} ${body.slice(0, 150)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  const parsed = extractJson(content);
  if (!parsed) throw new Error(`OpenRouter ${model}: unparseable response`);
  return parsed;
}

/**
 * Classify an image through the cheap flash-vision cascade.
 * Tries each model in priority order; returns the first parsed JSON object.
 * @param {{ base64: string, mimeType?: string, prompt: string }} args
 * @returns {Promise<object>} parsed model JSON
 * @throws if OPENROUTER_API_KEY is unset or every model in the cascade fails
 */
export async function classifyImageViaOpenRouter({ base64, mimeType, prompt }) {
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64}`;
  const models = visionModels();
  let lastErr;
  for (const model of models) {
    try {
      return await callModel({ model, prompt, dataUrl });
    } catch (err) {
      lastErr = err;
      log.warn('vision-provider: model failed, trying next', { model, err: err.message });
    }
  }
  throw new Error(`vision cascade exhausted (${models.length} models): ${lastErr?.message || 'no models configured'}`);
}
