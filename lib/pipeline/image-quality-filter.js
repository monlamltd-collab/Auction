// lib/pipeline/image-quality-filter.js
// Filters scraped property images using Gemini Flash vision.
// Classifies each image as: property_photo, floor_plan, map, logo, banner,
// stock_photo, auction_sign, document, or unknown. Non-property images
// (logos, banners, stock photos) are discarded before they reach investors.
//
// This replaces the old "hero_image_bleed" self-healing entry — instead of
// detecting bleed after it pollutes the DB, we reject junk at the boundary.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { callVisionAI } from '../ai-provider.js';
import { supabase } from '../supabase.js';

// Direct-Gemini client — LEGACY fallback only, used when OPENROUTER_API_KEY is
// unset. Primary path is OpenRouter vision (callVisionAI), because the direct
// Google free-tier quota is exhausted (limit:0). See ai-provider.callVisionAI.
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Fast, cheap model — image classification is a simple task
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

// Prompt for the OpenRouter path — asks for compact JSON (no responseSchema
// passthrough, so we parse leniently). Same verdict vocabulary as SCHEMA below.
const VISION_PROMPT = `You are auditing UK property auction listing images. Classify this SINGLE image.
Reply with ONLY a compact JSON object, no markdown:
{"verdict":"property_photo|floor_plan|map|logo|banner|stock_photo|auction_sign|document|unknown","confidence":"high|medium|low","reason":"short","is_primary":true|false}
property_photo = an actual property (exterior, interior, garden, rooms). floor_plan = a layout diagram. logo, banner (website header/ad), stock_photo, auction_sign (physical signboard) and document (text/legal) are NOT property photos. is_primary = is this the best main listing image (prefer a clear exterior front shot; false for non-property images).`;

// Lenient parse — pull the first {...} from the model text and validate verdict.
function parseVerdict(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    if (o && typeof o.verdict === 'string') {
      return { verdict: o.verdict, confidence: o.confidence || 'low', reason: o.reason || '', is_primary: !!o.is_primary };
    }
  } catch { /* fall through */ }
  return null;
}

const VALID_TYPES = new Set(['property_photo', 'floor_plan']);

// Quota circuit-breaker (2026-06-13). When the Gemini key's quota is exhausted
// (free-tier limit:0 → HTTP 429), every classification fails open anyway — but
// doing so one image at a time across a fleet sweep fires hundreds of doomed
// round-trips per house, each adding latency before the catch, stalling persist
// for 15-20 min (AuctionHouse London: 844 lots × a dead free-tier quota). On the
// first quota error we trip a cooldown so the rest skip Gemini entirely and keep
// their images unfiltered. Self-heals when the window elapses.
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000;
let _quotaCooldownUntil = 0;
const isQuotaError = (err) => /\b429\b|quota|rate.?limit|resource.?exhausted|exceeded/i.test(err?.message || '');

// Test seam — reset the breaker between tests.
export function __resetImageFilterBreakerForTest() { _quotaCooldownUntil = 0; }

const SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['property_photo', 'floor_plan', 'map', 'logo', 'banner', 'stock_photo', 'auction_sign', 'document', 'unknown'],
      description: 'What this image shows. property_photo = actual property (exterior or interior). floor_plan = layout diagram. logo = company logo. banner = website header/ad. stock_photo = generic stock imagery. auction_sign = physical auction signboard. document = text/legal document photographed.',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string', description: 'Brief one-line explanation.' },
    is_primary: { type: 'boolean', description: 'Is this the best main image for the listing? Prefer exterior front shots over interiors, and avoid signs/boards.' },
  },
  required: ['verdict', 'confidence', 'reason', 'is_primary'],
};

// ── Per-image-URL classification cache ──
// A given image URL's verdict (property_photo / floor_plan / logo / …) is
// intrinsic to the image, so once we've classified a URL we never pay the
// vision model for it again — across re-scrapes, re-onboarding, or images
// shared between houses. This is the bulk of flash-lite spend (image-classify
// was ~99% of it), so the cache is the main saving. Backed by the
// `image_classifications` table (migrations/2026-07-11-image-classification-cache.sql).
const IMAGE_CACHE_TABLE = 'image_classifications';
const IMAGE_CACHE_TTL_MS = parseInt(process.env.IMAGE_CACHE_TTL_MS || String(90 * 24 * 60 * 60 * 1000), 10);
// Operator kill-switch (IMAGE_CLASSIFICATION_CACHE=off) + a null-db guard so
// offline/test runs skip the DB entirely.
const imageCacheEnabled = (db) => !!db && process.env.IMAGE_CLASSIFICATION_CACHE !== 'off';

// Only a real judgement about what the image shows is cacheable. NEVER cache
// 'unknown' — that's the fail-open verdict when the classifier couldn't SEE the
// image (fetch blocked / model error / quota cooldown). Caching a transient
// failure would permanently skip classification for that URL.
function isAffirmativeVerdict(v) {
  return !!v && typeof v.verdict === 'string' && v.verdict !== 'unknown';
}

// Batch-read cached verdicts for a set of URLs. Returns a Map (url → verdict);
// a miss (or any DB error) simply isn't in the map, so the caller classifies.
async function readImageCache(urls, db) {
  if (!imageCacheEnabled(db) || !urls || !urls.length) return new Map();
  try {
    const { data, error } = await db
      .from(IMAGE_CACHE_TABLE)
      .select('url, verdict, confidence, is_primary, reason')
      .in('url', urls)
      .gt('expires_at', new Date().toISOString());
    if (error || !data) return new Map();
    return new Map(data.map(r => [r.url, {
      verdict: r.verdict,
      confidence: r.confidence || 'low',
      reason: r.reason || '',
      is_primary: !!r.is_primary,
      _cached: true,
    }]));
  } catch {
    return new Map();
  }
}

// Fire-and-forget upsert of an affirmative verdict. A write failure is
// non-fatal — we just re-classify that URL next time it's seen.
function writeImageCache(url, verdict, db) {
  if (!imageCacheEnabled(db) || !isAffirmativeVerdict(verdict)) return;
  const row = {
    url,
    verdict: verdict.verdict,
    confidence: verdict.confidence || null,
    is_primary: !!verdict.is_primary,
    reason: (verdict.reason || '').slice(0, 500),
    model: (process.env.OPENROUTER_VISION_MODEL || 'google/gemini-2.5-flash-lite').split(',')[0].trim(),
    classified_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + IMAGE_CACHE_TTL_MS).toISOString(),
  };
  Promise.resolve(db.from(IMAGE_CACHE_TABLE).upsert(row, { onConflict: 'url' }))
    .then(({ error } = {}) => { if (error) console.warn(`image cache write failed (${url}): ${error.message}`); })
    .catch(e => console.warn(`image cache write failed (${url}): ${e.message}`));
}

/**
 * Classify a single image URL, reusing a cached verdict when available.
 * Returns { verdict, confidence, reason, is_primary }.
 */
async function classifyImage(imageUrl, { db = supabase } = {}) {
  const cached = (await readImageCache([imageUrl], db)).get(imageUrl);
  if (cached) return cached;
  const verdict = await classifyImageFresh(imageUrl);
  writeImageCache(imageUrl, verdict, db);
  return verdict;
}

/**
 * Classify a single image URL using vision (no cache). Returns
 * { verdict, confidence, reason, is_primary }; 'unknown' on any failure.
 */
async function classifyImageFresh(imageUrl) {
  // Circuit-breaker open → fail open immediately, no network, no model call.
  if (Date.now() < _quotaCooldownUntil) {
    return { verdict: 'unknown', confidence: 'low', reason: 'quota-cooldown (skipped)', is_primary: true };
  }

  // Primary path: OpenRouter vision (paid billing, not the dead Google free tier).
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const text = await callVisionAI(imageUrl, VISION_PROMPT, { taskType: 'image-classify' });
      const parsed = parseVerdict(text);
      // Unparseable → fail open (keep), don't discard on a formatting wobble.
      return parsed || { verdict: 'unknown', confidence: 'low', reason: 'unparseable vision response', is_primary: true };
    } catch (err) {
      if (isQuotaError(err)) {
        if (Date.now() >= _quotaCooldownUntil) {
          console.warn(`Image quality filter: vision quota/rate-limit hit — pausing classification for ${QUOTA_COOLDOWN_MS / 60000}min; images kept unfiltered`);
        }
        _quotaCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
      } else {
        console.warn(`Image quality filter (openrouter) error (${imageUrl}): ${err.message}`);
      }
      return { verdict: 'unknown', confidence: 'low', reason: err.message, is_primary: true };
    }
  }

  // Legacy fallback: direct Gemini (only when OpenRouter isn't configured).
  try {
    // Fetch the image as base64
    const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return { verdict: 'unknown', confidence: 'low', reason: `HTTP ${resp.status}`, is_primary: false };

    const buffer = Buffer.from(await resp.arrayBuffer());
    const mimeType = resp.headers.get('content-type') || 'image/jpeg';
    const base64 = buffer.toString('base64');

    const prompt = `You are auditing property auction listing images. Look at this image and classify it.

IMPORTANT: Only classify as "property_photo" if this shows an actual property — exterior, interior, garden, or rooms. Logos, website headers, stock photos of unrelated things, auction house signboards, and text documents are NOT property photos.

Floor plans are valid but classify them as "floor_plan" not "property_photo".

Identify the SINGLE best main image: prefer clear exterior front shots. If the image is not a property photo, set is_primary=false.`;

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        temperature: 0,
        maxOutputTokens: 200,
      },
    });

    const text = result.response.text();
    return JSON.parse(text);
  } catch (err) {
    if (isQuotaError(err)) {
      // Trip the breaker once (log once), then go quiet for the cooldown.
      if (Date.now() >= _quotaCooldownUntil) {
        console.warn(`Image quality filter: Gemini quota exhausted — pausing classification for ${QUOTA_COOLDOWN_MS / 60000}min; images kept unfiltered`);
      }
      _quotaCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
    } else {
      console.warn(`Image quality filter error (${imageUrl}): ${err.message}`);
    }
    // On failure, be conservative — don't discard potentially valid images
    return { verdict: 'unknown', confidence: 'low', reason: err.message, is_primary: true };
  }
}

/**
 * Filter and score a batch of image URLs.
 * Returns { keep: string[], discard: string[], primary: string|null }
 *   keep — URLs that are property photos or floor plans
 *   discard — URLs that are logos, banners, stock photos, etc.
 *   primary — the single best main image URL (or null)
 */
async function filterImages(imageUrls, { db = supabase } = {}) {
  if (!imageUrls || imageUrls.length === 0) {
    return { keep: [], discard: [], primary: null };
  }

  // One cache read for the whole lot; only cache MISSES pay the vision model.
  const cacheMap = await readImageCache([...new Set(imageUrls)], db);
  const results = await Promise.all(imageUrls.map(async (url) => {
    const hit = cacheMap.get(url);
    if (hit) return hit;
    const verdict = await classifyImageFresh(url);
    writeImageCache(url, verdict, db);
    return verdict;
  }));

  const keep = [];
  const discard = [];
  let primary = null;
  let bestPrimary = null;

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const r = results[i];
    if (!r) { keep.push(url); continue; }

    if (VALID_TYPES.has(r.verdict)) {
      keep.push(url);
      if (r.is_primary && (!bestPrimary || r.confidence === 'high')) {
        bestPrimary = url;
      }
    } else if (r.verdict === 'unknown') {
      // Fail-open: 'unknown' means the classifier couldn't SEE the image
      // (fetch blocked/timed out/Gemini error), not that it judged it junk.
      // Discarding here wiped every hollismorgan image on every scrape —
      // their CDN 403s non-browser fetches from Railway (2026-06-13).
      keep.push(url);
    } else {
      discard.push(url);
    }
  }

  // Fallback: if nothing marked as primary, use the first kept exterior photo
  if (!bestPrimary && keep.length > 0) {
    bestPrimary = keep[0];
  }

  return { keep, discard, primary: bestPrimary };
}

/**
 * Filter a single main image URL. Returns the URL if valid, null if it should be discarded.
 */
async function filterMainImage(imageUrl, { db = supabase } = {}) {
  if (!imageUrl) return null;
  const result = await classifyImage(imageUrl, { db });
  // 'unknown' fails open — see filterImages.
  if (result && (VALID_TYPES.has(result.verdict) || result.verdict === 'unknown')) return imageUrl;
  return null;
}

export { filterImages, filterMainImage, classifyImage };
