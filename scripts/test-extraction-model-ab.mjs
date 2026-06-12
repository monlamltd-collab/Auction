#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// scripts/test-extraction-model-ab.mjs — extraction-model A/B harness.
//
// Answers "is Flash-Lite the best model for this house?" with measurement,
// not a hunch. Renders a catalogue ONCE (Crawlee, the production render path),
// then runs the REAL extraction prompt (extractLotsWithAI) against each model
// in turn — including the free strong models on OpenRouter (Nemotron Ultra,
// DeepSeek) — and reports, per model: lots recovered, recall vs the house's
// sentinel, per-field completeness, hallucination blocks, latency, tokens and
// est. cost. Then recommends the best by the product ethos: recall first, then
// field completeness, then cost.
//
// Because a single OpenRouter key reaches every model, this needs only
// OPENROUTER_API_KEY (+ Chromium for the Crawlee render).
//
// Usage:
//   node scripts/test-extraction-model-ab.mjs <house-slug|catalogue-url> [--models a,b,c] [--max-pages N]
//   node scripts/test-extraction-model-ab.mjs astleys
//   node scripts/test-extraction-model-ab.mjs https://x.eigonlineauctions.com/ --models google/gemini-2.5-flash-lite,deepseek/deepseek-chat
//
// Model slugs are passed straight to OpenRouter — confirm exact slugs (and
// which are :free) at https://openrouter.ai/models. A bad slug is reported as
// a per-model error, not a crash.
// ═══════════════════════════════════════════════════════════════

import { HOUSE_ROOTS } from '../lib/houses.js';
import { houseRecogniser } from '../lib/scraper/house-recognisers.js';
import { resolveRecallSentinel } from '../lib/scraper/recall-sentinels.js';
import { scrapeAllPagesWithCrawlee } from '../lib/scraper/crawlee-render.js';
import { extractLotsWithAI } from '../lib/scraper/extraction.js';
import { recallRatio } from '../lib/scraper/engine-router.js';
import { callSpecificModel } from '../lib/ai-provider.js';
import { initState } from '../lib/scraper/state.js';

if (!process.env.OPENROUTER_API_KEY) {
  console.error('ERROR: OPENROUTER_API_KEY not set — required to reach the models.');
  process.exit(1);
}

// ── Default model line-up. Flash-Lite is the incumbent; the rest are the
// candidates worth pitting against it, incl. the free strong models. Override
// with --models. Confirm exact slugs on openrouter.ai/models.
const DEFAULT_MODELS = [
  'google/gemini-2.5-flash-lite',                 // incumbent (fast tier)
  'google/gemini-2.5-flash',                      // mid
  'google/gemini-2.5-pro',                        // capable tier
  'deepseek/deepseek-chat',                       // DeepSeek (confirm V4 slug)
  'nvidia/llama-3.1-nemotron-ultra-253b-v1:free', // Nemotron Ultra (free)
];

// ── Sentinel resolution — the shared map + ladder (universal coverage as of
// 2026-06-12, so every house scores absolute recall here).
function resolveSentinel(slug) {
  return resolveRecallSentinel(slug, houseRecogniser(slug)?.recallSentinelPattern);
}

function countSentinelIds(pages, pattern) {
  if (!pattern) return 0;
  const ids = new Set();
  for (const p of pages) {
    const src = String(p.markdown || p.html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
    for (const m of src.matchAll(pattern)) { if (m[1]) ids.add(m[1]); }
  }
  return ids.size;
}

function coverage(lots) {
  const n = lots.length || 1;
  const pc = (have) => Math.round((have / n) * 1000) / 10;
  return {
    address: pc(lots.filter(l => l.address && l.address.length > 5).length),
    price:   pc(lots.filter(l => typeof l.price === 'number' && l.price > 0).length),
    image:   pc(lots.filter(l => !!l.imageUrl).length),
    tenure:  pc(lots.filter(l => !!l.tenure).length),
    beds:    pc(lots.filter(l => typeof l.beds === 'number').length),
  };
}

// Composite field-completeness score for ranking (the per-lot product quality).
function completeness(cov) {
  return (cov.address + cov.price + cov.image + cov.tenure + cov.beds) / 5;
}

async function benchmarkModel(model, pages, house, sentinelIds) {
  // Inject a callAI pinned to this model, then run the REAL extractor — same
  // prompt, parse, grounding, dedup as production. Token usage is tallied here.
  let tokensIn = 0, tokensOut = 0;
  initState({
    callAI: async (prompt, { maxTokens = 16000 } = {}) => {
      const { text, usage } = await callSpecificModel(prompt, { provider: 'openrouter', model, maxTokens });
      tokensIn += usage.promptTokenCount || 0;
      tokensOut += usage.candidatesTokenCount || 0;
      return text;
    },
  });

  // Spy on hallucination / failure alerts the extractor fires internally.
  let hallucinationBlocks = 0, extractionFailure = false;
  const fireAlert = (a) => {
    if (a?.type === 'ai_hallucination_blocked') hallucinationBlocks++;
    if (a?.type === 'ai_extraction_failure') extractionFailure = true;
    return Promise.resolve();
  };

  const start = Date.now();
  let lots = [], error = null;
  try {
    lots = await extractLotsWithAI(pages, house, null, pages[0]?.url || HOUSE_ROOTS[house] || '', { fireAlert }) || [];
  } catch (e) { error = e.message; }
  const elapsed = Date.now() - start;

  const recall = sentinelIds ? recallRatio({ extractedLots: lots.length, sentinelLots: sentinelIds }) : null;
  return {
    model, error, elapsed, lots: lots.length, recall,
    cov: coverage(lots), hallucinationBlocks, extractionFailure,
    tokensIn, tokensOut,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.find(a => !a.startsWith('--'));
  if (!target) {
    console.error('Usage: node scripts/test-extraction-model-ab.mjs <house-slug|catalogue-url> [--models a,b,c] [--max-pages N]');
    process.exit(1);
  }
  const modelsArg = args.find(a => a.startsWith('--models='))?.split('=')[1]
    || (args.includes('--models') ? args[args.indexOf('--models') + 1] : null);
  const models = modelsArg ? modelsArg.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_MODELS;
  const maxPagesArg = args.find(a => a.startsWith('--max-pages='))?.split('=')[1]
    || (args.includes('--max-pages') ? args[args.indexOf('--max-pages') + 1] : null);

  const isUrl = /^https?:\/\//i.test(target);
  const house = isUrl ? (Object.keys(HOUSE_ROOTS).find(s => HOUSE_ROOTS[s] === target) || 'unknown') : target;
  const url = isUrl ? target : HOUSE_ROOTS[target];
  if (!url) { console.error(`Unknown house slug '${target}' — not in HOUSE_ROOTS. Pass a catalogue URL instead.`); process.exit(1); }

  const rec = houseRecogniser(house);
  const maxPages = maxPagesArg ? parseInt(maxPagesArg) : (rec?.maxPages || 1);

  console.log('Extraction-model A/B harness');
  console.log(`House:   ${house}`);
  console.log(`URL:     ${url}`);
  console.log(`Models:  ${models.join(', ')}`);
  console.log(`\nRendering ${maxPages} page(s) with Crawlee (once, shared across all models)…`);

  let pages;
  try {
    pages = await scrapeAllPagesWithCrawlee(url, house, { maxPages });
  } catch (e) {
    console.error(`Crawlee render failed: ${e.message}\n(Chromium must be available — run where the production render path works.)`);
    process.exit(1);
  }
  if (!pages?.length) { console.error('Render returned 0 pages — nothing to extract.'); process.exit(1); }
  // Bridge HTML→markdown for recogniser houses so the sentinel denominator and
  // the Gemini input match the production Crawlee path.
  if (rec?.recogniseFromMarkdown) {
    const { htmlToRecognitionMarkdown } = await import('../lib/scraper/html-to-markdown.js');
    for (const p of pages) { if (p.markdown == null) p.markdown = htmlToRecognitionMarkdown(p.html, p.url || url); }
  }

  const sentinel = resolveSentinel(house);
  const sentinelIds = countSentinelIds(pages, sentinel);
  const totalChars = pages.reduce((s, p) => s + (p.markdown || p.html || '').length, 0);
  console.log(`Rendered ${pages.length} page(s), ${totalChars.toLocaleString()} chars. Sentinel advertises ${sentinelIds || 'n/a'} lot(s).\n`);

  const results = [];
  for (const model of models) {
    process.stdout.write(`  ${model} … `);
    const r = await benchmarkModel(model, pages, house, sentinelIds || null);
    console.log(r.error ? `ERROR: ${r.error}` : `${r.lots} lots, recall ${r.recall == null ? 'n/a' : (r.recall * 100).toFixed(0) + '%'}, ${(r.elapsed / 1000).toFixed(1)}s`);
    results.push(r);
    await new Promise(res => setTimeout(res, 500));
  }

  // ── Report ──
  console.log(`\n${'═'.repeat(96)}`);
  console.log('RESULTS');
  console.log('═'.repeat(96));
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('Model', 42)}${pad('Lots', 6)}${pad('Recall', 8)}${pad('Fields%', 9)}${pad('img/ten/bed', 14)}${pad('Halluc', 8)}${pad('Time', 7)}Tokens`);
  console.log('─'.repeat(96));
  for (const r of results) {
    if (r.error) { console.log(`${pad(r.model, 42)}ERROR: ${r.error}`); continue; }
    const c = r.cov;
    console.log(
      pad(r.model, 42) +
      pad(r.lots, 6) +
      pad(r.recall == null ? 'n/a' : (r.recall * 100).toFixed(0) + '%', 8) +
      pad(completeness(c).toFixed(0) + '%', 9) +
      pad(`${c.image}/${c.tenure}/${c.beds}`, 14) +
      pad(r.hallucinationBlocks || (r.extractionFailure ? 'FAIL' : '0'), 8) +
      pad((r.elapsed / 1000).toFixed(1) + 's', 7) +
      `${(r.tokensIn / 1000).toFixed(0)}k→${(r.tokensOut / 1000).toFixed(0)}k`
    );
  }

  // ── Recommendation: recall (or lots) first, then field completeness, then
  // fewer tokens (cost proxy). Matches the product ethos — recall is sacred,
  // field completeness next, cost only as a tie-break (and free models cost 0).
  const ok = results.filter(r => !r.error && !r.extractionFailure && r.lots > 0);
  if (ok.length) {
    ok.sort((a, b) => {
      const ra = a.recall == null ? a.lots : a.recall;
      const rb = b.recall == null ? b.lots : b.recall;
      if (Math.abs(rb - ra) > (a.recall == null ? 0.5 : 0.02)) return rb - ra; // recall/lots first
      const fa = completeness(a.cov), fb = completeness(b.cov);
      if (Math.abs(fb - fa) > 2) return fb - fa;                                // then field completeness
      return (a.tokensIn + a.tokensOut) - (b.tokensIn + b.tokensOut);           // then cost
    });
    const best = ok[0];
    const incumbent = results.find(r => /flash-lite/i.test(r.model));
    console.log(`\n${'─'.repeat(96)}`);
    console.log(`RECOMMENDED: ${best.model}`);
    if (incumbent && best.model !== incumbent.model && !incumbent.error) {
      const dLots = best.lots - incumbent.lots;
      const dRecall = (best.recall != null && incumbent.recall != null) ? ((best.recall - incumbent.recall) * 100).toFixed(0) + 'pp' : `${dLots >= 0 ? '+' : ''}${dLots} lots`;
      console.log(`  vs Flash-Lite incumbent: ${dRecall} recall, ${(completeness(best.cov) - completeness(incumbent.cov)).toFixed(0)}pp field completeness.`);
      console.log(`  → If the uplift is real and the model is free/cheap, set OPENROUTER_CAPABLE_MODEL to it and let the`);
      console.log(`    extraction-tier policy route this house there (it auto-promotes weak houses to the 'capable' tier).`);
    } else if (incumbent && best.model === incumbent.model) {
      console.log(`  Flash-Lite is already the best here — no change needed.`);
    }
  } else {
    console.log('\nNo model returned lots — check the render / sentinel / model slugs.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
