// routes/lots.js — Per-lot deep links + dynamic OG image generation
//
// GET /lot/:id          → server-rendered HTML with per-lot meta tags so
//                         shared links on LinkedIn / Twitter / WhatsApp /
//                         email render a tailored preview card.
// GET /og/lot/:id.png   → 1200x630 PNG composed via sharp from the lot's
//                         price + address + score + house badge. Cached at
//                         the CDN edge for 24h.
//
// Both routes are public (no auth) and crawlable by social bots. The HTML
// page deliberately doesn't load the full SPA — it's a focused share-target
// landing, with CTAs back to "/" and "/check".
//
// Pure render helpers are in routes/lots-render.js — this file holds the
// route handlers + the Supabase fetch.

import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { supabase } from '../lib/supabase.js';
import { LOTS_SELECT, dbRowToLot } from '../lib/types/lot.js';
import { mapLotToDeal, buildBridgematchUrl, withLotAttribution } from '../lib/fundability.js';
import { getHouseDisplayName } from '../lib/houses.js';
import { log } from '../lib/logging.js';
import {
  UUID_RE, SITE_ORIGIN, proxiedImage, renderOgSvg, renderLotHtml, renderNotFoundHtml,
} from './lots-render.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// Lot fetch helper — shared by both routes
// ═══════════════════════════════════════════════════════════════
async function fetchLotById(id) {
  const { data, error } = await supabase
    .from('lots')
    .select('id, ' + LOTS_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    log.warn('lots.fetchLotById error', { id, err: error.message });
    return null;
  }
  return data || null;
}

// ═══════════════════════════════════════════════════════════════
// Lot detail page (HTML) — GET /lot/:id
// ═══════════════════════════════════════════════════════════════
router.get('/lot/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  // Real 404s (SEO Phase 1): the old 302-to-/ answered "gone" with a
  // redirect, which dropped sold-lot URLs from the index and read as a
  // soft-404. Unknown/invalid ids now get an honest 404 page.
  if (!UUID_RE.test(id)) {
    return res.status(404).type('html').send(renderNotFoundHtml({
      heading: 'Lot not found',
      message: 'That link doesn’t match any lot. It may have been mistyped.',
    }));
  }
  const row = await fetchLotById(id);
  if (!row) {
    return res.status(404).type('html').send(renderNotFoundHtml({
      heading: 'Lot not found',
      message: 'This lot is no longer in our records. Browse the live catalogue instead.',
    }));
  }

  const lot = dbRowToLot(row);
  const displayName = getHouseDisplayName(row.house, row.url) || row.house;
  const shortAddress = (lot.address || '').split(',').slice(0, 2).join(',').trim() || 'Auction lot';
  const priceLabel = lot.priceText || (lot.price ? `£${lot.price.toLocaleString('en-GB')}` : 'Guide TBA');
  const scoreLabel = lot.score != null ? `${lot.score.toFixed(1)}/10` : null;
  const propTypeLabel = lot.propType || 'Property';

  // Description for meta + OG. Limited to ~155 chars so search engines don't
  // truncate it.
  const descParts = [priceLabel, propTypeLabel];
  if (scoreLabel) descParts.push(`Score ${scoreLabel}`);
  descParts.push(displayName);
  const description = descParts.join(' · ').slice(0, 155);

  const title = `${shortAddress} — ${priceLabel} | Auction Brain`;
  const canonical = `${SITE_ORIGIN}/lot/${id}`;
  const ogImage = `${SITE_ORIGIN}/og/lot/${id}.png`;

  const opps = (lot.opps || []).slice(0, 5);
  const risks = (lot.risks || []).slice(0, 5);
  const bullets = (lot.bullets || []).slice(0, 6);
  const heroImg = lot.imageUrl ? proxiedImage(lot.imageUrl, 1200) : null;

  // RealEstateListing JSON-LD — gives search engines structured data on the
  // listing. address/offer are required for the type to render rich results.
  // priceSpecification (added with the value estimator) gives Google a
  // value range it can render in rich snippets when the estimator has run.
  const ve = lot.valueEstimate && Number.isFinite(Number(lot.valueEstimate.low)) && Number.isFinite(Number(lot.valueEstimate.high))
    ? lot.valueEstimate : null;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: shortAddress,
    description,
    url: canonical,
    image: lot.imageUrl || ogImage,
    address: { '@type': 'PostalAddress', streetAddress: lot.address || '', addressCountry: 'GB' },
    ...(lot.price ? {
      offers: {
        '@type': 'Offer', price: lot.price, priceCurrency: 'GBP',
        // Sold lots stay indexable as the price archive — tell search
        // engines the truth about availability.
        availability: lot.status === 'sold'
          ? 'https://schema.org/SoldOut'
          : 'https://schema.org/InStock',
      }
    } : {}),
    ...(ve ? {
      priceSpecification: {
        '@type': 'PriceSpecification', priceCurrency: 'GBP',
        minPrice: Number(ve.low), maxPrice: Number(ve.high),
        description: `Estimated value range, ${ve.confidence} confidence`,
      },
    } : {}),
  };

  // Lot-contextual finance CTA (Phase 3): a deep link into BridgeMatch's
  // /apply form pre-filled with THIS lot's deal shape, attributed via
  // lot_ref + utm_campaign=lot_<uuid> so the resulting lead is provably
  // from this lot. Pure URL construction — no API call on the page render.
  // No click_id here: the page is CDN-cached, so a server-minted id would
  // be shared across viewers and lie about click identity.
  let financeUrl = null;
  if (lot.price) {
    try {
      financeUrl = withLotAttribution(buildBridgematchUrl(mapLotToDeal(lot)), {
        lotRef: id, medium: 'lot_page',
      });
    } catch { /* CTA falls back to /check */ }
  }

  res.set('Cache-Control', 'public, max-age=300, s-maxage=900');
  res.type('html').send(renderLotHtml({
    title, description, canonical, ogImage, jsonLd,
    shortAddress, priceLabel, scoreLabel, propTypeLabel, displayName,
    address: lot.address, opps, risks, bullets, heroImg,
    lotUrl: lot.url, status: lot.status,
    valueEstimate: ve, financeUrl,
  }));
}));

// ═══════════════════════════════════════════════════════════════
// OG image — GET /og/lot/:id.png
// 1200x630 PNG generated via sharp from an SVG. Lazy-imports sharp so the
// server boot doesn't pay the ~50ms native-binary load until the first
// social bot crawls a deep link.
// ═══════════════════════════════════════════════════════════════
router.get('/og/lot/:id.png', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.redirect(302, '/public/og-image.png');
  }
  const row = await fetchLotById(id);
  if (!row) {
    return res.redirect(302, '/public/og-image.png');
  }

  try {
    const { default: sharp } = await import('sharp');
    const lot = dbRowToLot(row);
    const displayName = getHouseDisplayName(row.house, row.url) || row.house;
    const priceLabel = lot.priceText || (lot.price ? `£${lot.price.toLocaleString('en-GB')}` : 'Guide TBA');
    const scoreLabel = lot.score != null ? `${lot.score.toFixed(1)}` : null;
    const shortAddress = (lot.address || '').split(',').slice(0, 2).join(',').trim() || 'Auction lot';

    const svg = renderOgSvg({ priceLabel, scoreLabel, shortAddress, displayName, propType: lot.propType });
    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    res.set('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
    res.type('image/png').send(png);
  } catch (err) {
    log.error('og-image generation failed', { id, err: err.message });
    return res.redirect(302, '/public/og-image.png');
  }
}));

export default router;
