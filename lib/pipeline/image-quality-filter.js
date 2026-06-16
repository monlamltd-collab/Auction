// lib/pipeline/image-quality-filter.js
// Filters scraped property images by vision classification.
// Classifies each image as: property_photo, floor_plan, map, logo, banner,
// stock_photo, auction_sign, document, or unknown. Non-property images
// (logos, banners, stock photos) are discarded before they reach investors.
//
// This replaces the old "hero_image_bleed" self-healing entry — instead of
// detecting bleed after it pollutes the DB, we reject junk at the boundary.
//
// PROVIDER (2026-06-17): classification runs through the OpenRouter cheap
// flash-vision cascade (lib/vision-provider.js) when OPENROUTER_API_KEY is set,
// falling back to Gemini-direct otherwise so pre-key deployments still work.
//
// FAIL-OPEN (2026-06-17): on ANY classifier failure (provider outage, quota,
// timeout) the image is KEPT, not discarded. Discarding-on-failure is what
// silently wiped galleries when Gemini's free-tier quota died — `discard`
// swallowed every image because failed calls returned 'unknown'.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { classifyImageViaOpenRouter, isOpenRouterVisionEnabled } from '../vision-provider.js';

// Legacy Gemini-direct fallback — only used when no OPENROUTER_API_KEY is set.
const geminiKey = process.env.GEMINI_API_KEY;
const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
const geminiModel = genAI ? genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' }) : null;

const VALID_TYPES = new Set(['property_photo', 'floor_plan']);

// Shared instruction for both providers. OpenRouter models get the JSON shape
// described in-prompt (they don't all honour responseSchema); Gemini-direct
// also gets the structured SCHEMA below.
const CLASSIFY_PROMPT = `You are auditing property auction listing images. Look at this image and classify it.

Only classify as "property_photo" if it shows an actual property — exterior, interior, garden, or rooms. Logos, website headers/banners, stock photos of unrelated things, auction-house signboards, maps, and text documents are NOT property photos. Floor plans are valid but classify them as "floor_plan".

Identify the SINGLE best main image: prefer clear exterior front shots. If the image is not a property photo, set is_primary=false.

Respond ONLY with a JSON object of exactly this shape:
{"verdict":"property_photo|floor_plan|map|logo|banner|stock_photo|auction_sign|document|unknown","confidence":"high|medium|low","reason":"one short line","is_primary":true|false}`;

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

// Coerce a model response into the canonical verdict shape.
function normaliseVerdict(p) {
  if (!p || typeof p !== 'object') {
    return { verdict: 'unknown', confidence: 'low', reason: 'empty response', is_primary: true, _error: true };
  }
  return {
    verdict: String(p.verdict || 'unknown'),
    confidence: String(p.confidence || 'low'),
    reason: String(p.reason || ''),
    is_primary: !!p.is_primary,
  };
}

/**
 * Classify a single image URL.
 * Returns { verdict, confidence, reason, is_primary } — and `_error: true` when
 * classification failed (so callers can fail OPEN and keep the image).
 */
async function classifyImage(imageUrl) {
  try {
    // Fetch the image as base64
    const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      // Image URL itself is dead — keep is meaningless; mark as error (kept,
      // but it'll 404 in the carousel which the broken-image filter handles).
      return { verdict: 'unknown', confidence: 'low', reason: `HTTP ${resp.status}`, is_primary: false, _error: true };
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    const mimeType = resp.headers.get('content-type') || 'image/jpeg';
    const base64 = buffer.toString('base64');

    // Primary path: OpenRouter cheap flash-vision cascade.
    if (isOpenRouterVisionEnabled()) {
      const parsed = await classifyImageViaOpenRouter({ base64, mimeType, prompt: CLASSIFY_PROMPT });
      return normaliseVerdict(parsed);
    }

    // Legacy fallback: Gemini direct (only when no OpenRouter key configured).
    if (!geminiModel) {
      // No vision provider available at all — fail open (keep).
      return { verdict: 'unknown', confidence: 'low', reason: 'no vision provider configured', is_primary: true, _error: true };
    }
    const result = await geminiModel.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: CLASSIFY_PROMPT },
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
    return normaliseVerdict(JSON.parse(result.response.text()));
  } catch (err) {
    console.warn(`Image quality filter error (${imageUrl}): ${err.message}`);
    // FAIL OPEN — keep the image on any classifier failure. `_error` signals
    // filterImages/filterMainImage to keep rather than discard.
    return { verdict: 'unknown', confidence: 'low', reason: err.message, is_primary: true, _error: true };
  }
}

/**
 * Filter and score a batch of image URLs.
 * Returns { keep: string[], discard: string[], primary: string|null }
 *   keep — property photos, floor plans, and anything we couldn't confidently
 *          classify (unknown / classifier error) — fail-open
 *   discard — only images CONFIDENTLY classified as junk (logo, banner, etc.)
 *   primary — the single best main image URL (or null)
 */
async function filterImages(imageUrls) {
  if (!imageUrls || imageUrls.length === 0) {
    return { keep: [], discard: [], primary: null };
  }

  const results = await Promise.all(imageUrls.map(url => classifyImage(url)));

  const keep = [];
  const discard = [];
  let bestPrimary = null;

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const r = results[i];
    if (!r) { keep.push(url); continue; }

    // Fail-open: keep valid types, anything unknown, and anything that errored.
    // Only drop images a working classifier CONFIDENTLY tagged as junk.
    if (VALID_TYPES.has(r.verdict) || r.verdict === 'unknown' || r._error) {
      keep.push(url);
      if (r.is_primary && !r._error && (!bestPrimary || r.confidence === 'high')) {
        bestPrimary = url;
      }
    } else {
      discard.push(url);
    }
  }

  // Fallback: if nothing marked as primary, use the first kept image.
  if (!bestPrimary && keep.length > 0) {
    bestPrimary = keep[0];
  }

  return { keep, discard, primary: bestPrimary };
}

/**
 * Filter a single main image URL. Returns the URL if valid (or if classification
 * failed — fail-open), null only if confidently classified as junk.
 */
async function filterMainImage(imageUrl) {
  if (!imageUrl) return null;
  const result = await classifyImage(imageUrl);
  if (!result) return imageUrl;
  if (VALID_TYPES.has(result.verdict) || result.verdict === 'unknown' || result._error) return imageUrl;
  return null;
}

export { filterImages, filterMainImage, classifyImage };
