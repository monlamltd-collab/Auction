// tests/test-pricing-route.js — locks the contract for the public
// /pricing page (Milestone 4). Asserts SEO meta, four tiers, the right
// CTAs back to the home page, and the JSON-LD Product offer block.
//
// We only exercise the pure renderPricingHtml() — booting the Express
// server adds noise (Supabase env-var validation, etc.) and the route
// handler itself is a one-liner that delegates to the renderer.

import { JSDOM } from 'jsdom';
import { renderPricingHtml } from '../routes/pricing.js';

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const html = renderPricingHtml();
const dom = new JSDOM(html);
const doc = dom.window.document;

console.log('\npricing page: SEO meta');
{
  assert(doc.title.includes('Pricing'), 'title contains "Pricing"');
  assert(doc.querySelector('meta[name="description"]'), 'description meta present');
  assert(doc.querySelector('meta[name="robots"][content="index,follow"]'), 'robots index,follow');
  const canon = doc.querySelector('link[rel="canonical"]');
  assert(canon && canon.getAttribute('href').endsWith('/pricing'), 'canonical points to /pricing');
  assert(doc.querySelector('meta[property="og:image"]'), 'og:image present');
  assert(doc.querySelector('meta[name="twitter:card"][content="summary_large_image"]'), 'twitter card large');
}

console.log('\npricing page: four tiers');
{
  const tiers = doc.querySelectorAll('.pr-tier');
  assert(tiers.length === 4, `exactly 4 tier columns (got ${tiers.length})`);
  const headings = [...doc.querySelectorAll('.pr-tier h2')].map(h => h.textContent.trim());
  assert(headings.includes('Anonymous'), 'Anonymous tier heading');
  assert(headings.includes('Free'), 'Free tier heading');
  assert(headings.includes('Day Pass'), 'Day Pass tier heading');
  assert(headings.includes('Pro'), 'Pro tier heading');
  assert(doc.querySelector('.pr-tier-featured'), 'one tier flagged as featured');
}

console.log('\npricing page: CTA wiring routes back to /');
{
  const ctaHrefs = [...doc.querySelectorAll('.pr-btn')].map(a => a.getAttribute('href'));
  assert(ctaHrefs.includes('/'), 'Anonymous CTA links home (no friction)');
  assert(ctaHrefs.includes('/?cta=signup'), 'Free tier CTA → /?cta=signup');
  assert(ctaHrefs.includes('/?cta=day_pass'), 'Day Pass CTA → /?cta=day_pass');
  assert(ctaHrefs.includes('/?cta=monthly'), 'Pro CTA → /?cta=monthly');
}

console.log('\npricing page: JSON-LD Product schema');
{
  const ld = doc.querySelector('script[type="application/ld+json"]');
  assert(!!ld, 'JSON-LD block present');
  if (ld) {
    const data = JSON.parse(ld.textContent);
    assert(data['@type'] === 'Product', 'schema type Product');
    assert(Array.isArray(data.offers) && data.offers.length === 3,
      'three priced offers (Free, Day Pass, Pro)');
    const offerNames = data.offers.map(o => o.name);
    assert(offerNames.includes('Day Pass'), 'Day Pass offer in schema');
    assert(offerNames.includes('Pro'), 'Pro offer in schema');
    const dayPass = data.offers.find(o => o.name === 'Day Pass');
    assert(dayPass && dayPass.price === '1.99' && dayPass.priceCurrency === 'GBP',
      'Day Pass priced at £1.99');
    const pro = data.offers.find(o => o.name === 'Pro');
    assert(pro && pro.price === '9.99' && pro.priceCurrency === 'GBP',
      'Pro priced at £9.99');
  }
}

console.log('\npricing page: FAQ section');
{
  const faqItems = doc.querySelectorAll('.pricing-faq details');
  assert(faqItems.length >= 3, `FAQ has at least 3 entries (got ${faqItems.length})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
