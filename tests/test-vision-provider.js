// test-vision-provider.js — OpenRouter vision cascade + image-filter fail-open
// Run: node tests/test-vision-provider.js
// Offline: global.fetch is mocked. No network, no API key needed.

import assert from 'assert';
import {
  extractJson, visionModels, isOpenRouterVisionEnabled, classifyImageViaOpenRouter,
} from '../lib/vision-provider.js';
import { filterImages, filterMainImage } from '../lib/pipeline/image-quality-filter.js';

const origFetch = global.fetch;
const origEnv = { ...process.env };
function restore() {
  global.fetch = origFetch;
  process.env = { ...origEnv };
}

function mockResp({ ok = true, status = 200, json = null, text = '', contentType = 'image/jpeg' }) {
  return {
    ok, status,
    headers: { get: () => contentType },
    arrayBuffer: async () => new Uint8Array([255, 216, 255, 224]).buffer, // tiny JPEG header
    text: async () => (typeof text === 'string' ? text : JSON.stringify(text)),
    json: async () => json,
  };
}
const orJson = (verdict, extra = {}) => ({
  choices: [{ message: { content: JSON.stringify({ verdict, confidence: 'high', reason: 't', is_primary: verdict === 'property_photo', ...extra }) } }],
});

let filterMixCounter = 0;

async function main() {
  // ── extractJson ──
  assert.deepStrictEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepStrictEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepStrictEqual(extractJson('Sure! {"verdict":"logo"} done'), { verdict: 'logo' });
  assert.strictEqual(extractJson('no json here'), null);
  assert.strictEqual(extractJson(''), null);
  console.log('PASS: extractJson handles plain / fenced / prose / garbage');

  // ── visionModels default + override ──
  delete process.env.OPENROUTER_VISION_MODELS;
  const def = visionModels();
  assert.ok(def.length >= 2, 'has a multi-model cascade by default');
  assert.ok(def[0].includes('gemini') && def[0].includes('flash'), 'primary is a Gemini flash model');
  process.env.OPENROUTER_VISION_MODELS = 'a/b, c/d ,e/f';
  assert.deepStrictEqual(visionModels(), ['a/b', 'c/d', 'e/f'], 'env override splits + trims');
  restore();
  console.log('PASS: visionModels default cascade + env override');

  // ── isOpenRouterVisionEnabled ──
  delete process.env.OPENROUTER_API_KEY;
  assert.strictEqual(isOpenRouterVisionEnabled(), false);
  process.env.OPENROUTER_API_KEY = 'sk-test';
  assert.strictEqual(isOpenRouterVisionEnabled(), true);
  restore();
  console.log('PASS: isOpenRouterVisionEnabled reflects key presence');

  // ── cascade: first model succeeds, no fallthrough ──
  process.env.OPENROUTER_API_KEY = 'sk-test';
  delete process.env.OPENROUTER_VISION_MODELS;
  let calls = 0;
  global.fetch = async () => { calls++; return mockResp({ json: orJson('property_photo') }); };
  let r = await classifyImageViaOpenRouter({ base64: 'AAA', mimeType: 'image/jpeg', prompt: 'x' });
  assert.strictEqual(r.verdict, 'property_photo');
  assert.strictEqual(calls, 1, 'stops at first success');
  restore();
  console.log('PASS: cascade returns on first model success');

  // ── cascade: primary 429 → fallback succeeds ──
  process.env.OPENROUTER_API_KEY = 'sk-test';
  delete process.env.OPENROUTER_VISION_MODELS;
  calls = 0;
  global.fetch = async () => {
    calls++;
    if (calls === 1) return mockResp({ ok: false, status: 429, text: 'rate limited' });
    return mockResp({ json: orJson('floor_plan') });
  };
  r = await classifyImageViaOpenRouter({ base64: 'AAA', prompt: 'x' });
  assert.strictEqual(r.verdict, 'floor_plan');
  assert.strictEqual(calls, 2, 'falls through to second model on primary failure');
  restore();
  console.log('PASS: cascade falls through to fallback on primary failure');

  // ── cascade: every model fails → throws ──
  process.env.OPENROUTER_API_KEY = 'sk-test';
  process.env.OPENROUTER_VISION_MODELS = 'm/1,m/2';
  global.fetch = async () => mockResp({ ok: false, status: 500, text: 'boom' });
  let threw = false;
  try { await classifyImageViaOpenRouter({ base64: 'AAA', prompt: 'x' }); }
  catch (e) { threw = true; assert.ok(/cascade exhausted/.test(e.message), 'message names the cascade'); }
  assert.ok(threw, 'throws when all models fail');
  restore();
  console.log('PASS: cascade throws when every model fails');

  // ── filterImages FAIL-OPEN: classifier down → all images kept ──
  process.env.OPENROUTER_API_KEY = 'sk-test';
  delete process.env.OPENROUTER_VISION_MODELS;
  global.fetch = async (url) => {
    if (typeof url === 'string' && url.includes('openrouter.ai')) return mockResp({ ok: false, status: 503, text: 'down' });
    return mockResp({ ok: true, status: 200 }); // image fetch ok
  };
  let res = await filterImages(['https://img/1.jpg', 'https://img/2.jpg']);
  assert.deepStrictEqual(res.keep, ['https://img/1.jpg', 'https://img/2.jpg'], 'all kept when classifier fails');
  assert.strictEqual(res.discard.length, 0, 'nothing discarded on classifier failure');
  assert.strictEqual(res.primary, 'https://img/1.jpg', 'primary falls back to first kept');
  restore();
  console.log('PASS: filterImages fails OPEN (classifier down → galleries preserved)');

  // ── filterImages: confident junk IS discarded when classifier works ──
  process.env.OPENROUTER_API_KEY = 'sk-test';
  delete process.env.OPENROUTER_VISION_MODELS;
  global.fetch = async (url) => {
    if (typeof url === 'string' && url.includes('openrouter.ai')) return mockResp({ json: orJson('logo') });
    return mockResp({ ok: true, status: 200 });
  };
  res = await filterImages(['https://img/logo.png']);
  assert.deepStrictEqual(res.keep, [], 'confident junk not kept');
  assert.deepStrictEqual(res.discard, ['https://img/logo.png'], 'confident junk discarded');
  restore();
  console.log('PASS: filterImages discards confidently-classified junk');

  // ── filterImages: keeps property photo, discards mixed junk ──
  process.env.OPENROUTER_API_KEY = 'sk-test';
  global.fetch = async (url) => {
    if (typeof url === 'string' && url.includes('openrouter.ai')) {
      // alternate verdicts by a counter
      filterMixCounter++;
      return mockResp({ json: orJson(filterMixCounter === 1 ? 'property_photo' : 'banner') });
    }
    return mockResp({ ok: true, status: 200 });
  };
  res = await filterImages(['https://img/house.jpg', 'https://img/banner.png']);
  assert.deepStrictEqual(res.keep, ['https://img/house.jpg'], 'property photo kept');
  assert.deepStrictEqual(res.discard, ['https://img/banner.png'], 'banner discarded');
  assert.strictEqual(res.primary, 'https://img/house.jpg', 'property photo is primary');
  restore();
  console.log('PASS: filterImages keeps photo + discards banner (mixed batch)');

  // ── filterMainImage fail-open ──
  process.env.OPENROUTER_API_KEY = 'sk-test';
  global.fetch = async (url) => {
    if (typeof url === 'string' && url.includes('openrouter.ai')) return mockResp({ ok: false, status: 500, text: 'x' });
    return mockResp({ ok: true, status: 200 });
  };
  const main1 = await filterMainImage('https://img/main.jpg');
  assert.strictEqual(main1, 'https://img/main.jpg', 'main image kept when classifier fails');
  restore();
  console.log('PASS: filterMainImage fails OPEN');

  console.log('\nAll vision-provider tests passed.');
}

main().catch(err => {
  console.error('FAIL:', err && err.stack ? err.stack : err);
  process.exit(1);
});
