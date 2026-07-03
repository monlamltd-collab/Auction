// tests/test-lead-attribution.js — Defends Phase 3 lead attribution
// (2026-07-03). Three facts this pins down:
//   1. The BridgeMatch deep link targets /apply — www.bridgematch.co.uk/check
//      is a live 404 (verified 2026-07-03); every deep link had been landing
//      users on a 404 page.
//   2. Per-lot attribution is appended at USE time (withLotAttribution) —
//      the base URL is cached per deal shape, so lots with identical deals
//      share it and attribution can never be baked in.
//   3. utm_campaign carries lot_<uuid> because BridgeMatch already stores
//      utm_campaign on every lead — attribution lands with no schema change.
import { buildBridgematchUrl, withLotAttribution } from '../lib/fundability.js';
import { renderDigestEmail } from '../lib/pipeline/weekly-digest.js';
import { renderLotHtml } from '../routes/lots-render.js';

let pass = 0, fail = 0;
const check = (label, cond) => {
  if (cond) { console.log(`✓ ${label}`); pass++; }
  else { console.log(`✗ ${label}`); fail++; }
};

const deal = {
  purchase_price: 200000, property_type: 'residential', loan_amount: 140000,
  is_refurb: true, geography: 'england_wales', works_cost: 30000, gdv: 290000, loan_term: 12,
};
const base = buildBridgematchUrl(deal);

check('deep link targets /apply (the /check path 404s live)',
  base.startsWith('https://www.bridgematch.co.uk/apply?'));
check('deal params survive', base.includes('purchase_price=200000') && base.includes('gdv=290000'));

const LOT_ID = '123e4567-e89b-12d3-a456-426614174000';
const attributed = withLotAttribution(base, { lotRef: LOT_ID, medium: 'lot_page', clickId: 'c_abc123' });
const u = new URL(attributed);
check('utm_campaign carries lot_<uuid> (lands in the existing BridgeMatch column)',
  u.searchParams.get('utm_campaign') === `lot_${LOT_ID}`);
check('explicit lot_ref set', u.searchParams.get('lot_ref') === LOT_ID);
check('click_id set', u.searchParams.get('click_id') === 'c_abc123');
check('utm_medium reflects the touchpoint', u.searchParams.get('utm_medium') === 'lot_page');
check('utm_source unchanged', u.searchParams.get('utm_source') === 'auctionbrain');
check('deal params still intact after attribution', u.searchParams.get('purchase_price') === '200000');
check('no attribution args → url unchanged', withLotAttribution(base) === base);
check('null url passes through', withLotAttribution(null, { lotRef: LOT_ID }) === null);
check('garbage url passes through unchanged', withLotAttribution('not a url', { lotRef: LOT_ID }) === 'not a url');

// Weekly digest finance CTA
const digest = renderDigestEmail({
  recipientEmail: 'x@y.com', unsubscribeToken: 't',
  weekLabel: 'w', matches: [
    { id: LOT_ID, price: 150000, address: '1 High St', _house: 'allsop' },
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', price: null, address: '2 Low St', _house: 'allsop' },
  ],
});
check('digest carries the finance CTA for priced lots',
  digest.html.includes('Check bridging finance') && digest.html.includes(`lot_ref=${LOT_ID}`));
check('digest CTA uses digest_email medium', digest.html.includes('utm_medium=digest_email'));
check('digest omits the CTA for unpriced lots',
  (digest.html.match(/Check bridging finance/g) || []).length === 1);

// Lot page finance block
const baseArgs = {
  title: 't', description: 'd', canonical: 'c', ogImage: 'o', jsonLd: {},
  shortAddress: '1 High St', priceLabel: '£150,000', scoreLabel: null,
  propTypeLabel: 'House', displayName: 'Allsop', address: '1 High St',
  opps: [], risks: [], bullets: [], heroImg: null, lotUrl: null, status: 'available',
  valueEstimate: null,
};
const withFinance = renderLotHtml({ ...baseArgs, financeUrl: attributed });
check('lot page renders the contextual finance CTA',
  withFinance.includes('Check bridging finance for this lot') && withFinance.includes(`lot_ref=${LOT_ID}`));
const withoutFinance = renderLotHtml({ ...baseArgs, financeUrl: null });
check('lot page falls back to /check without a finance url',
  withoutFinance.includes('href="/check"') && !withoutFinance.includes('Check bridging finance for this lot'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
