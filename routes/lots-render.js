// routes/lots-render.js — Pure rendering helpers for the lot detail page.
//
// Extracted from routes/lots.js so they can be imported by tests without
// pulling in lib/supabase.js (which validates env vars at module load).
//
// All exports are pure functions: same inputs → same outputs, no I/O.

import { escHtml } from '../lib/utils.js';

// UUID validation — lots.id is a UUID; reject non-UUIDs at the route so we
// don't issue a doomed Supabase query for typo'd / scraped URLs.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SITE_ORIGIN = 'https://auctions.bridgematch.co.uk';

// wsrv.nl image proxy — same one referenced from index.html's preconnect.
// Keeps hero images on a CDN that strips referrer + serves WebP/AVIF.
export function proxiedImage(url, width = 1200) {
  if (!url) return null;
  const safe = encodeURIComponent(url);
  return `https://wsrv.nl/?url=${safe}&w=${width}&output=webp&q=85`;
}

export function escSvg(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function renderOgSvg({ priceLabel, scoreLabel, shortAddress, displayName, propType }) {
  // 1200x630 OG card. Designed to match the Auction Brain brand (navy nav,
  // green accent). Pure SVG so sharp can rasterise without external assets.
  const safePrice = escSvg(priceLabel);
  const safeAddr = escSvg(shortAddress.length > 56 ? shortAddress.slice(0, 53) + '…' : shortAddress);
  const safeHouse = escSvg(displayName);
  const safeType = propType ? escSvg(propType.toUpperCase()) : '';
  const scoreBadge = scoreLabel ? `
    <g>
      <rect x="980" y="510" width="180" height="80" rx="14" fill="#0f8a5f"/>
      <text x="1070" y="548" font-family="DM Sans, Arial, sans-serif" font-size="20" font-weight="600" fill="#ffffff" text-anchor="middle">SCORE</text>
      <text x="1070" y="582" font-family="DM Sans, Arial, sans-serif" font-size="34" font-weight="700" fill="#ffffff" text-anchor="middle">${escSvg(scoreLabel)}/10</text>
    </g>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bgg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1a2332"/>
      <stop offset="1" stop-color="#2a3648"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bgg)"/>
  <rect x="0" y="0" width="1200" height="6" fill="#0f8a5f"/>
  <text x="60" y="80" font-family="DM Sans, Arial, sans-serif" font-size="28" font-weight="700" fill="#8bc34a">Auction <tspan fill="#ffffff">Brain</tspan></text>
  ${safeType ? `<text x="60" y="170" font-family="DM Sans, Arial, sans-serif" font-size="22" font-weight="600" fill="#8bc34a" letter-spacing="2">${safeType}</text>` : ''}
  <text x="60" y="280" font-family="DM Sans, Arial, sans-serif" font-size="84" font-weight="700" fill="#ffffff">${safePrice}</text>
  <text x="60" y="370" font-family="Source Serif 4, Georgia, serif" font-size="38" font-weight="400" fill="#e4dfd6">${safeAddr}</text>
  <text x="60" y="560" font-family="DM Sans, Arial, sans-serif" font-size="22" font-weight="500" fill="#b0a99e">${safeHouse}</text>
  ${scoreBadge}
</svg>`;
}

export function renderLotHtml({
  title, description, canonical, ogImage, jsonLd,
  shortAddress, priceLabel, scoreLabel, propTypeLabel, displayName,
  address, opps, risks, bullets, heroImg, lotUrl, status,
}) {
  const oppsHtml = opps.length
    ? `<ul class="lot-tags">${opps.map(o => `<li class="tag tag-opp">${escHtml(o)}</li>`).join('')}</ul>`
    : '';
  const risksHtml = risks.length
    ? `<ul class="lot-tags">${risks.map(r => `<li class="tag tag-risk">${escHtml(r)}</li>`).join('')}</ul>`
    : '';
  const bulletsHtml = bullets.length
    ? `<ul class="lot-bullets">${bullets.map(b => `<li>${escHtml(b)}</li>`).join('')}</ul>`
    : '';
  const heroHtml = heroImg
    ? `<img class="lot-hero" src="${escHtml(heroImg)}" alt="${escHtml(shortAddress)}" loading="eager" decoding="async">`
    : '<div class="lot-hero lot-hero-placeholder">No image available</div>';
  const statusBadge = status && status !== 'available'
    ? `<span class="lot-status">${escHtml(String(status).toUpperCase())}</span>`
    : '';
  const auctionLink = lotUrl
    ? `<a class="cta-secondary" href="${escHtml(lotUrl)}" target="_blank" rel="noopener nofollow">View on ${escHtml(displayName)} ↗</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(description)}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${escHtml(canonical)}">
<link rel="icon" href="/public/favicon.svg" type="image/svg+xml">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escHtml(canonical)}">
<meta property="og:image" content="${escHtml(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(description)}">
<meta name="twitter:image" content="${escHtml(ogImage)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<link rel="preconnect" href="https://wsrv.nl" crossorigin>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Source+Serif+4:wght@400;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/public/styles.css">
</head>
<body class="lot-detail-page">
<nav class="lot-detail-nav" aria-label="Main navigation">
  <a href="/" class="logo">Auction <span>Brain</span></a>
  <a href="/" class="nav-back">← Browse all lots</a>
</nav>
<main class="lot-detail-main">
  <article class="lot-detail-card">
    ${heroHtml}
    <div class="lot-detail-body">
      <div class="lot-detail-meta">
        <span class="lot-house-badge">${escHtml(displayName)}</span>
        <span class="lot-prop-type">${escHtml(propTypeLabel)}</span>
        ${statusBadge}
      </div>
      <h1 class="lot-detail-address">${escHtml(address || shortAddress)}</h1>
      <div class="lot-detail-price-row">
        <span class="lot-detail-price">${escHtml(priceLabel)}</span>
        ${scoreLabel ? `<span class="lot-detail-score">Score <strong>${escHtml(scoreLabel)}</strong></span>` : ''}
      </div>
      ${oppsHtml ? `<section class="lot-section"><h2>Opportunities</h2>${oppsHtml}</section>` : ''}
      ${risksHtml ? `<section class="lot-section"><h2>Risks</h2>${risksHtml}</section>` : ''}
      ${bulletsHtml ? `<section class="lot-section"><h2>Lot details</h2>${bulletsHtml}</section>` : ''}
      <div class="lot-detail-ctas">
        <a class="cta-primary" href="/check">Check finance options</a>
        ${auctionLink}
      </div>
      <p class="lot-detail-disclaimer">Indicative analysis from auction-house listing data. Verify with the legal pack and your broker before bidding.</p>
    </div>
  </article>
</main>
</body>
</html>`;
}
