// tests/test-frontend-shell.js — locks the structural contract of the
// frontend after the inline-CSS / inline-JS split (Issue 8 PRs 1+2).
//
// What broke: the prior shape (massive inline <style> + <script>) was changed
// to external assets in /public/. If someone re-inlines them — or accidentally
// breaks the env-shim that server.js does string-substitution on — auth
// silently 401s on every request. This test asserts the shape stays sane.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

console.log('\nfrontend shell: external assets');
{
  const linkHrefs = [...doc.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href'));
  assert(linkHrefs.includes('/public/styles.css'),
    'index.html links /public/styles.css');
  assert(doc.querySelectorAll('style').length === 0,
    'no inline <style> blocks remain');

  const scriptSrcs = [...doc.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  assert(scriptSrcs.includes('/public/supabase.min.js'),
    'loads /public/supabase.min.js');
  assert(scriptSrcs.includes('/public/town-match.js'),
    'loads /public/town-match.js');
  assert(scriptSrcs.includes('/public/app.js'),
    'loads /public/app.js');

  // Order matters: supabase + town-match must load before app.js so app.js
  // can reference window.supabase and window.AB_townMatch synchronously.
  const orderIdx = (s) => scriptSrcs.indexOf(s);
  assert(orderIdx('/public/supabase.min.js') < orderIdx('/public/app.js'),
    'supabase loads before app.js');
  assert(orderIdx('/public/town-match.js') < orderIdx('/public/app.js'),
    'town-match loads before app.js');
}

console.log('\nfrontend shell: env-shim must remain inline');
{
  // server.js does string-substitution on these exact tokens at startup.
  // If anyone moves them to an external file, auth + analytics silently break.
  assert(html.includes("window.__SUPABASE_URL__ || ''"),
    "env-shim has SUPABASE_URL placeholder for server substitution");
  assert(html.includes("window.__SUPABASE_ANON_KEY__ || ''"),
    "env-shim has SUPABASE_ANON_KEY placeholder for server substitution");
  assert(html.includes("window.__AUTH_ENABLED__ || false"),
    "env-shim has AUTH_ENABLED placeholder for server substitution");
  assert(html.includes('data-website-id=""'),
    'Umami data-website-id placeholder for server substitution');
}

console.log('\nfrontend shell: only the env-shim is inline JS');
{
  const inlineScripts = [...doc.querySelectorAll('script:not([src])')]
    .filter(s => (s.getAttribute('type') || '').toLowerCase() !== 'application/ld+json')
    .map(s => (s.textContent || '').trim());

  // Exactly one inline (non-JSON-LD) script: the env-shim.
  assert(inlineScripts.length === 1,
    `exactly one inline JS block remains (got ${inlineScripts.length})`);
  if (inlineScripts.length === 1) {
    const body = inlineScripts[0];
    assert(body.includes('SUPABASE_URL') && body.includes('SUPABASE_ANON_KEY') && body.includes('AUTH_ENABLED'),
      'the remaining inline script IS the env-shim (not stray code)');
    assert(body.split('\n').length <= 6,
      'env-shim stays small (<=6 lines)');
  }
}

console.log('\nfrontend shell: HTML budget');
{
  // After PRs 1+2, index.html should be a thin shell. If someone re-introduces
  // a giant inline block, this guard fires.
  const lineCount = html.split('\n').length;
  assert(lineCount < 1500,
    `index.html stays under 1500 lines (was ~6120 before split, now ${lineCount})`);
}

console.log('\npaywall modal: 3-tier upgrade comparison');
{
  // Lock the contract for Milestone 3 — the upgrade modal must offer Free,
  // Day Pass, and Pro side-by-side with the right CTAs. If a refactor strips
  // a tier or breaks the startCheckout wiring, this guard fires.
  const modal = doc.getElementById('paywallModal');
  assert(!!modal, 'paywallModal exists');
  if (modal) {
    assert(!!doc.getElementById('paywallTitle'),
      'paywallTitle remains so showPaywall() can target it');
    assert(!!doc.getElementById('paywallReason'),
      'paywallReason remains so showPaywall() can set context');

    const tiers = modal.querySelectorAll('.pw-tier');
    assert(tiers.length === 3, `exactly 3 tiers (got ${tiers.length})`);

    const headings = [...modal.querySelectorAll('.pw-tier h3')].map(h => h.textContent.trim());
    assert(headings.includes('Free'), 'Free tier heading present');
    assert(headings.includes('Day Pass'), 'Day Pass tier heading present');
    assert(headings.includes('Pro'), 'Pro tier heading present');

    const buttons = [...modal.querySelectorAll('.pw-btn')].map(b => b.getAttribute('onclick') || '');
    assert(buttons.some(b => b.includes("startCheckout('day_pass')")),
      "Day Pass button calls startCheckout('day_pass')");
    assert(buttons.some(b => b.includes("startCheckout('monthly')")),
      "Pro button calls startCheckout('monthly')");

    assert(modal.querySelector('.pw-tier-featured'),
      'Pro tier flagged as featured (visual hierarchy)');
    assert(modal.querySelector('.pw-tier-current'),
      'Free tier flagged as current (visual hierarchy)');
  }
}

console.log('\nanon view-count nudges (Milestone 1)');
{
  // The nudge fires at exact view counts. If a refactor renames the
  // localStorage keys, drops the wiring inside expandCard, or changes
  // the thresholds, marketing loses the conversion path. Lock the shape.
  const appJs = readFileSync(join(here, '..', 'public', 'app.js'), 'utf8');
  assert(/function trackAnonViewNudge\b/.test(appJs),
    'trackAnonViewNudge() declared in app.js');
  assert(/function showAnonViewToast\b/.test(appJs),
    'showAnonViewToast() declared in app.js');
  assert(/function showAnonViewSoftModal\b/.test(appJs),
    'showAnonViewSoftModal() declared in app.js');
  assert(/ANON_NUDGE_TOAST_AT\s*=\s*10/.test(appJs),
    'toast threshold = 10 unique lot views');
  assert(/ANON_NUDGE_MODAL_AT\s*=\s*25/.test(appJs),
    'soft-modal threshold = 25 unique lot views');
  assert(/expandCard\([\s\S]{0,200}trackAnonViewNudge/.test(appJs) ||
    /trackAnonViewNudge[\s\S]{0,5000}function expandCard/.test(appJs) ||
    /function expandCard[\s\S]{0,2000}trackAnonViewNudge/.test(appJs),
    'expandCard() invokes trackAnonViewNudge()');
  assert(/ab_anon_view_count/.test(appJs),
    'persists count under ab_anon_view_count');
  assert(/ab_anon_nudge_dismissed/.test(appJs),
    'honours an explicit dismiss flag (no re-nag after close)');
}

console.log('\nsearch-filter Bristol bug — smartQuery + town-radius wiring');
{
  // Reported 2026-05-10: typing "Bristol" returned 2 unsold lots when 3
  // existed. Two paths needed fixing in renderLots:
  //   (a) the smartQuery (top bar) substring filter must also consult the
  //       town→postcode-area predicate so "Bristol" matches BS-prefix lots
  //       whose address doesn't literally say "Bristol".
  //   (b) the fTown geocoded-radius default (10mi) must NOT apply when the
  //       typed town is in TOWN_POSTCODE_PREFIXES — otherwise Weston-Super-
  //       Mare (BS23, ~18mi from Bristol centre) gets excluded despite
  //       sharing the BS postcode region. Explicit user-picked radius
  //       still wins.
  const appJs = readFileSync(join(here, '..', 'public', 'app.js'), 'utf8');
  assert(/_townHasPostcode/.test(appJs),
    'renderLots tracks _townHasPostcode for radius suppression');
  assert(/TOWN_POSTCODE_PREFIXES\?\.\[ftownLower\]/.test(appJs),
    'lookup uses ftownLower against TOWN_POSTCODE_PREFIXES');
  assert(/!_townHasPostcode/.test(appJs),
    'default radius is gated on !_townHasPostcode');
  assert(/townMatchesLot\(l,\s*fs\)/.test(appJs),
    'smartQuery substring filter falls back to townMatchesLot(l, fs)');
}

console.log('\nweekly digest signup form (Milestone 6)');
{
  const form = doc.getElementById('digestForm');
  assert(!!form, 'digestForm exists in footer');
  if (form) {
    assert(form.getAttribute('onsubmit') === 'return handleDigestSubscribe(event)',
      'form submit wired to handleDigestSubscribe');
    const input = form.querySelector('input[type="email"]');
    assert(!!input && input.id === 'digestEmail', 'email input present (#digestEmail)');
    assert(!!input && input.required, 'email input is required');
    const btn = form.querySelector('button[type="submit"]');
    assert(!!btn, 'submit button present');
    assert(!!doc.getElementById('digestFormStatus'),
      'status target #digestFormStatus exists for aria-live updates');
  }
  const appJs = readFileSync(join(here, '..', 'public', 'app.js'), 'utf8');
  assert(/async function handleDigestSubscribe\b/.test(appJs),
    'handleDigestSubscribe declared in app.js');
  assert(/\/api\/digest\/subscribe/.test(appJs),
    "POSTs to /api/digest/subscribe");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
