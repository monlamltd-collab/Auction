// ═══════════════════════════════════════════════════════════════
// EXTRACTOR GENERATOR — AI-powered DOM extractor creation + repair
// ═══════════════════════════════════════════════════════════════

import { JSDOM } from 'jsdom';
import { fireAlert } from './alert-router.js';

let _supabase = null;
let _callAI = null;

// Track generation attempts: slug → { attempts: number, lastAttempt: Date }
const _genAttempts = new Map();
const MAX_ATTEMPTS_PER_WEEK = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Log of generation attempts
const _generatorLog = [];
const MAX_LOG_ENTRIES = 100;

// Platform family templates
const PLATFORM_TEMPLATES = {
  eig: `(() => {
    const lots = []; const seen = new Set();
    document.querySelectorAll('.lot-card, .property-card, [class*="lot-item"]').forEach(card => {
      const lotEl = card.querySelector('.lot-number, [class*="lot-num"]');
      const lot = lotEl ? parseInt(lotEl.textContent.replace(/\\D/g,'')) : null;
      if (!lot || seen.has(lot)) return; seen.add(lot);
      const addrEl = card.querySelector('.address, h3, h4, [class*="address"]');
      const address = addrEl ? addrEl.textContent.trim() : '';
      const priceEl = card.querySelector('.guide-price, [class*="price"]');
      const priceText = priceEl ? priceEl.textContent.replace(/[^0-9]/g,'') : '';
      const price = priceText ? parseInt(priceText) : null;
      const linkEl = card.querySelector('a[href*="/lot"]');
      const url = linkEl ? linkEl.href : '';
      const imgEl = card.querySelector('img[src*="http"], img[data-src*="http"]');
      const imageUrl = imgEl ? (imgEl.src || imgEl.dataset.src || '') : '';
      lots.push({ lot, address, price, url, imageUrl, bullets: [], status: '' });
    });
    return lots;
  })()`,
  sdl: `(() => {
    const lots = []; const seen = new Set();
    document.querySelectorAll('.property-card, .auction-lot').forEach(card => {
      const lotEl = card.querySelector('[class*="lot"]');
      const lotMatch = lotEl ? lotEl.textContent.match(/(\\d+)/) : null;
      const lot = lotMatch ? parseInt(lotMatch[1]) : null;
      if (!lot || seen.has(lot)) return; seen.add(lot);
      const addrEl = card.querySelector('h2, h3, .address');
      const address = addrEl ? addrEl.textContent.trim() : '';
      const priceEl = card.querySelector('[class*="price"]');
      const priceText = priceEl ? priceEl.textContent.replace(/[^0-9]/g,'') : '';
      const price = priceText ? parseInt(priceText) : null;
      const linkEl = card.querySelector('a[href]');
      const url = linkEl ? linkEl.href : '';
      const imgEl = card.querySelector('img');
      const imageUrl = imgEl ? (imgEl.src || imgEl.dataset.src || '') : '';
      lots.push({ lot, address, price, url, imageUrl, bullets: [], status: '' });
    });
    return lots;
  })()`,
};

export function initGenerator(supabase, callAI) {
  _supabase = supabase;
  _callAI = callAI;
}

/**
 * Generate a new DOM extractor for a house using AI.
 * @param {string} slug - House slug
 * @param {string} sampleHtml - Sample HTML from the catalogue page
 * @param {object[]} existingLots - Lots from universal/Gemini extractor (for validation)
 * @returns {{ code: string|null, testResult: { lots: number, quality: number }|null, confidence: number }}
 */
export async function generateExtractor(slug, sampleHtml, existingLots = []) {
  if (!_callAI) return { code: null, testResult: null, confidence: 0 };

  // Rate limit check
  const attempt = _genAttempts.get(slug) || { attempts: 0, lastAttempt: 0 };
  if (attempt.attempts >= MAX_ATTEMPTS_PER_WEEK && (Date.now() - attempt.lastAttempt) < WEEK_MS) {
    _logAttempt(slug, 'generate', 'skipped', 'Weekly attempt limit reached');
    return { code: null, testResult: null, confidence: 0 };
  }

  attempt.attempts++;
  attempt.lastAttempt = Date.now();
  _genAttempts.set(slug, attempt);

  const truncatedHtml = sampleHtml.substring(0, 30000);
  const sampleLots = existingLots.slice(0, 5).map(l => ({
    lot: l.lot, address: l.address?.substring(0, 80), price: l.price,
  }));

  const prompt = `Given this HTML from auction house "${slug}", write a DOM extractor function.
The function is an IIFE that receives the global \`document\` object (JSDOM) and must return an array of lot objects.

Each lot object shape: { lot: number, address: string, price: number|null, url: string, imageUrl: string, bullets: string[], status: string }

Here is a sample of the HTML (truncated to 30K chars):
${truncatedHtml}

Here are ${sampleLots.length} lots that another extractor found (for validation):
${JSON.stringify(sampleLots)}

Rules:
- Use querySelectorAll, not getElementsBy*
- Return empty array on failure, never throw
- Price must be integer (pence removed, commas stripped) or null for POA/TBC
- imageUrl must be absolute URL starting with https
- Deduplicate by lot number using a Set
- The IIFE pattern: (() => { ... return lots; })()
- Strip "Guide Price", "£", commas from price text before parseInt

Return ONLY the JavaScript code block, no explanation.`;

  try {
    const response = await _callAI(prompt, {
      tier: 'capable',
      maxTokens: 4000,
      taskType: 'extractor_generation',
    });

    // Extract code block
    const codeMatch = response.match(/```(?:javascript|js)?\s*([\s\S]*?)```/) || response.match(/(\(\(\)\s*=>\s*\{[\s\S]*\}\)\(\))/);
    if (!codeMatch) {
      _logAttempt(slug, 'generate', 'failed', 'No code block in AI response');
      return { code: null, testResult: null, confidence: 0 };
    }

    const code = codeMatch[1].trim();

    // Test in JSDOM sandbox
    const testResult = _testExtractor(code, sampleHtml, existingLots);

    if (testResult.lots >= Math.max(1, existingLots.length * 0.8)) {
      _logAttempt(slug, 'generate', 'success', `${testResult.lots} lots extracted`);
      return { code, testResult, confidence: Math.min(0.9, testResult.lots / Math.max(1, existingLots.length)) };
    }

    // One retry with error feedback
    const retryPrompt = `The extractor you wrote for "${slug}" only extracted ${testResult.lots} lots (expected ~${existingLots.length}).
Error: ${testResult.error || 'Low lot count'}

Here is the code that failed:
${code}

Please fix it. Return ONLY the corrected JavaScript IIFE code block.`;

    const retryResponse = await _callAI(retryPrompt, {
      tier: 'capable',
      maxTokens: 4000,
      taskType: 'extractor_generation',
    });

    const retryMatch = retryResponse.match(/```(?:javascript|js)?\s*([\s\S]*?)```/) || retryResponse.match(/(\(\(\)\s*=>\s*\{[\s\S]*\}\)\(\))/);
    if (retryMatch) {
      const retryCode = retryMatch[1].trim();
      const retryResult = _testExtractor(retryCode, sampleHtml, existingLots);
      if (retryResult.lots >= Math.max(1, existingLots.length * 0.8)) {
        _logAttempt(slug, 'generate', 'success_retry', `${retryResult.lots} lots on retry`);
        return { code: retryCode, testResult: retryResult, confidence: Math.min(0.9, retryResult.lots / Math.max(1, existingLots.length)) };
      }
    }

    _logAttempt(slug, 'generate', 'failed', `Retry also failed (${testResult.lots} lots)`);
    return { code: null, testResult, confidence: 0 };

  } catch (e) {
    _logAttempt(slug, 'generate', 'error', e.message);
    return { code: null, testResult: null, confidence: 0 };
  }
}

/**
 * Repair an existing extractor that's losing lots.
 */
export async function repairExtractor(slug, currentCode, sampleHtml, failureReason) {
  if (!_callAI) return { code: null, testResult: null, confidence: 0 };

  const attempt = _genAttempts.get(slug) || { attempts: 0, lastAttempt: 0 };
  if (attempt.attempts >= MAX_ATTEMPTS_PER_WEEK && (Date.now() - attempt.lastAttempt) < WEEK_MS) {
    return { code: null, testResult: null, confidence: 0 };
  }
  attempt.attempts++;
  attempt.lastAttempt = Date.now();
  _genAttempts.set(slug, attempt);

  const prompt = `This DOM extractor for "${slug}" is broken or degraded.

Failure reason: ${failureReason}

Current extractor code:
${currentCode}

Sample HTML (truncated):
${sampleHtml.substring(0, 25000)}

Please fix the extractor. The function must return an array of: { lot, address, price, url, imageUrl, bullets, status }
Return ONLY the corrected JavaScript IIFE code block.`;

  try {
    const response = await _callAI(prompt, {
      tier: 'capable',
      maxTokens: 4000,
      taskType: 'extractor_repair',
    });

    const codeMatch = response.match(/```(?:javascript|js)?\s*([\s\S]*?)```/) || response.match(/(\(\(\)\s*=>\s*\{[\s\S]*\}\)\(\))/);
    if (!codeMatch) {
      _logAttempt(slug, 'repair', 'failed', 'No code block in AI response');
      return { code: null, testResult: null, confidence: 0 };
    }

    const code = codeMatch[1].trim();
    const testResult = _testExtractor(code, sampleHtml, []);

    if (testResult.lots > 0) {
      _logAttempt(slug, 'repair', 'success', `${testResult.lots} lots extracted`);
      return { code, testResult, confidence: 0.7 };
    }

    _logAttempt(slug, 'repair', 'failed', 'Repaired code extracted 0 lots');
    return { code: null, testResult, confidence: 0 };

  } catch (e) {
    _logAttempt(slug, 'repair', 'error', e.message);
    return { code: null, testResult: null, confidence: 0 };
  }
}

/**
 * Get a platform family template extractor.
 */
export function getTemplateExtractor(platformFamily) {
  return PLATFORM_TEMPLATES[platformFamily] || null;
}

/**
 * Test extractor code in a JSDOM sandbox.
 */
function _testExtractor(code, html, expectedLots = []) {
  try {
    const dom = new JSDOM(html, { url: 'https://example.com', runScripts: 'outside-only' });
    const extractFn = new Function('document', `return ${code}`);
    const lots = extractFn(dom.window.document);
    dom.window.close();

    if (!Array.isArray(lots)) {
      return { lots: 0, quality: 0, error: 'Extractor did not return an array' };
    }

    // Basic quality check
    const validLots = lots.filter(l => l && (l.lot || l.address));
    const withAddress = validLots.filter(l => l.address && l.address.length > 3).length;
    const withPrice = validLots.filter(l => l.price && l.price > 0).length;
    const quality = validLots.length > 0
      ? (withAddress / validLots.length * 0.5 + withPrice / validLots.length * 0.5)
      : 0;

    return { lots: validLots.length, quality: Math.round(quality * 100) / 100, error: null };
  } catch (e) {
    return { lots: 0, quality: 0, error: e.message };
  }
}

function _logAttempt(slug, action, result, detail) {
  const entry = {
    slug, action, result, detail,
    timestamp: new Date().toISOString(),
  };
  _generatorLog.push(entry);
  if (_generatorLog.length > MAX_LOG_ENTRIES) _generatorLog.shift();
  console.log(`EXTRACTOR-GEN: ${slug} ${action} → ${result}: ${detail}`);

  // Fire alert for successes
  if (result === 'success' || result === 'success_retry') {
    fireAlert({
      type: 'extractor_generated',
      severity: 'info',
      house: slug,
      message: `Extractor ${action}ed: ${detail}`,
    }).catch(() => {});
  }
}

export function getGeneratorLog() {
  return [..._generatorLog];
}
