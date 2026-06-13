// lib/pipeline/image-quality-filter.js
// Filters scraped property images using Gemini Flash vision.
// Classifies each image as: property_photo, floor_plan, map, logo, banner,
// stock_photo, auction_sign, document, or unknown. Non-property images
// (logos, banners, stock photos) are discarded before they reach investors.
//
// This replaces the old "hero_image_bleed" self-healing entry — instead of
// detecting bleed after it pollutes the DB, we reject junk at the boundary.

import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Fast, cheap model — image classification is a simple task
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

const VALID_TYPES = new Set(['property_photo', 'floor_plan']);

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

/**
 * Classify a single image URL using Gemini Flash vision.
 * Returns { verdict, confidence, reason, is_primary } or null on failure.
 */
async function classifyImage(imageUrl) {
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
    console.warn(`Image quality filter error (${imageUrl}): ${err.message}`);
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
async function filterImages(imageUrls) {
  if (!imageUrls || imageUrls.length === 0) {
    return { keep: [], discard: [], primary: null };
  }

  const results = await Promise.all(imageUrls.map(url => classifyImage(url)));

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
async function filterMainImage(imageUrl) {
  if (!imageUrl) return null;
  const result = await classifyImage(imageUrl);
  // 'unknown' fails open — see filterImages.
  if (result && (VALID_TYPES.has(result.verdict) || result.verdict === 'unknown')) return imageUrl;
  return null;
}

export { filterImages, filterMainImage, classifyImage };
