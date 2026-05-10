// routes/pricing.js — Public /pricing page (4-tier comparison).
//
// Server-rendered HTML with full SEO meta — Google indexes it, social
// previews render a card, marketing campaigns can deep-link to specific
// tiers via the #tier-{slug} anchor.
//
// CTAs link back to /?cta=<action> rather than calling Stripe directly,
// because Stripe Checkout requires the user's bearer token and we want
// the pricing page itself to be cacheable and JS-light. The home page
// reads the cta query param at boot and dispatches signup / checkout.
//
// Pure render in renderPricingHtml() so tests can assert structure
// without booting Express or Supabase.

import { Router } from 'express';
import { escHtml } from '../lib/utils.js';

const router = Router();
const SITE_ORIGIN = 'https://auctions.bridgematch.co.uk';

export function renderPricingHtml() {
  const title = 'Pricing — Auction Brain';
  const description = 'Compare plans for Auction Brain. Browse all UK auction lots free, then upgrade to a Day Pass (£1.99) or Pro (£9.99/mo) for unlimited AI scoring, comparables and saved-search email alerts.';
  const canonical = `${SITE_ORIGIN}/pricing`;
  const ogImage = `${SITE_ORIGIN}/public/og-image.png`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Auction Brain',
    description,
    brand: { '@type': 'Brand', name: 'Auction Brain' },
    offers: [
      {
        '@type': 'Offer',
        name: 'Free',
        price: '0',
        priceCurrency: 'GBP',
        availability: 'https://schema.org/InStock',
        url: `${SITE_ORIGIN}/?cta=signup`,
      },
      {
        '@type': 'Offer',
        name: 'Day Pass',
        price: '1.99',
        priceCurrency: 'GBP',
        availability: 'https://schema.org/InStock',
        url: `${SITE_ORIGIN}/?cta=day_pass`,
      },
      {
        '@type': 'Offer',
        name: 'Pro',
        price: '9.99',
        priceCurrency: 'GBP',
        availability: 'https://schema.org/InStock',
        url: `${SITE_ORIGIN}/?cta=monthly`,
      },
    ],
  };

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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Source+Serif+4:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/public/styles.css">
</head>
<body class="pricing-page">
<nav class="lot-detail-nav" aria-label="Main navigation">
  <a href="/" class="logo">Auction <span>Brain</span></a>
  <a href="/" class="nav-back">← Browse all lots</a>
</nav>
<main class="pricing-main">
  <header class="pricing-header">
    <h1>Simple pricing. No surprises.</h1>
    <p>Browse every UK auction lot for free. Pay only when you want unlimited AI scoring or saved-search email alerts.</p>
  </header>
  <div class="pricing-tiers">
    <article class="pr-tier" id="tier-anon">
      <h2>Anonymous</h2>
      <div class="pr-price"><span class="pr-amt">£0</span><span class="pr-price-sub">no sign-up</span></div>
      <p class="pr-tagline">Browse lots without an account.</p>
      <ul class="pr-features">
        <li>See every active lot &amp; image</li>
        <li>Filter by location, price, beds</li>
        <li>3 AI scans per day</li>
        <li class="pr-feature-off">No saved favourites</li>
        <li class="pr-feature-off">No saved searches</li>
      </ul>
      <a class="pr-btn pr-btn-ghost" href="/">Start browsing</a>
    </article>

    <article class="pr-tier" id="tier-free">
      <h2>Free</h2>
      <div class="pr-price"><span class="pr-amt">£0</span><span class="pr-price-sub">forever</span></div>
      <p class="pr-tagline">Sign in to save lots and searches.</p>
      <ul class="pr-features">
        <li>Everything in Anonymous</li>
        <li>5 AI scans per day</li>
        <li>Save up to 5 favourites</li>
        <li>Save up to 3 searches</li>
        <li class="pr-feature-off">No email alerts</li>
      </ul>
      <a class="pr-btn pr-btn-secondary" href="/?cta=signup">Sign up free</a>
    </article>

    <article class="pr-tier" id="tier-day-pass">
      <h2>Day Pass</h2>
      <div class="pr-price"><span class="pr-amt">£1.99</span><span class="pr-price-sub">24-hour access</span></div>
      <p class="pr-tagline">All-you-can-analyse for 24 hours.</p>
      <ul class="pr-features">
        <li>Everything in Free</li>
        <li><strong>Unlimited AI scans</strong></li>
        <li>Comparables &amp; yield analysis</li>
        <li>Deal stacking calculator</li>
        <li class="pr-feature-off">No saved-search alerts</li>
      </ul>
      <a class="pr-btn pr-btn-secondary" href="/?cta=day_pass">Buy Day Pass</a>
    </article>

    <article class="pr-tier pr-tier-featured" id="tier-pro">
      <div class="pr-badge">Best value</div>
      <h2>Pro</h2>
      <div class="pr-price"><span class="pr-amt">£9.99</span><span class="pr-price-sub">per month</span></div>
      <p class="pr-tagline">Never miss a lot worth bidding on.</p>
      <ul class="pr-features">
        <li>Everything in Day Pass</li>
        <li><strong>Email alerts</strong> on saved searches</li>
        <li>Unlimited favourites</li>
        <li>Unlimited saved searches</li>
        <li>Cancel anytime</li>
      </ul>
      <a class="pr-btn pr-btn-primary" href="/?cta=monthly">Subscribe</a>
    </article>
  </div>
  <section class="pricing-faq">
    <h2>Common questions</h2>
    <details>
      <summary>Do I need a credit card to sign up?</summary>
      <p>No. The Free tier needs only an email address. Cards are only required for the Day Pass or Pro plans, which you can start whenever you want unlimited AI scans or saved-search alerts.</p>
    </details>
    <details>
      <summary>What happens after the Day Pass expires?</summary>
      <p>You drop back to the Free tier (5 AI scans per day). Saved favourites and searches stay in your account.</p>
    </details>
    <details>
      <summary>Can I cancel Pro anytime?</summary>
      <p>Yes. Cancel from the billing portal in your account — you keep Pro access until the end of the current billing period, then revert to Free.</p>
    </details>
    <details>
      <summary>Why is Anonymous browsing free?</summary>
      <p>We want every potential investor to be able to see what's at auction this month with zero friction. The paid tiers cover the AI scoring + alert infrastructure, not the catalogue itself.</p>
    </details>
  </section>
  <p class="pricing-fine-print">All prices in GBP, including VAT where applicable. Secure payment via Stripe.</p>
</main>
</body>
</html>`;
}

router.get('/pricing', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
  res.type('html').send(renderPricingHtml());
});

export default router;
