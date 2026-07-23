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
  assert(scriptSrcs.includes('/public/finance.js'),
    'loads /public/finance.js');
  assert(scriptSrcs.includes('/public/app.js'),
    'loads /public/app.js');

  // Order matters: supabase + town-match + finance must load before app.js so
  // app.js can reference window.supabase / AB_townMatch / AB_finance synchronously.
  const orderIdx = (s) => scriptSrcs.indexOf(s);
  assert(orderIdx('/public/supabase.min.js') < orderIdx('/public/app.js'),
    'supabase loads before app.js');
  assert(orderIdx('/public/town-match.js') < orderIdx('/public/app.js'),
    'town-match loads before app.js');
  assert(orderIdx('/public/finance.js') < orderIdx('/public/app.js'),
    'finance loads before app.js');
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

console.log('\nMobile launch fixes (review 2026-05-10) — BLOCKs');
{
  const appJs = readFileSync(join(here, '..', 'public', 'app.js'), 'utf8');
  const css = readFileSync(join(here, '..', 'public', 'styles.css'), 'utf8');

  // B1 — Sign-in CTA overflow at 375. Hide PRICING/BLOG nav links at <420px.
  assert(/@media\s*\(max-width:\s*419px\)\s*\{[^}]*\.nav-link-blog[^}]*display:\s*none/.test(css.replace(/\n/g, ' ')),
    'B1: .nav-link-blog hidden at <420px so Sign-in CTA fits in iPhone SE viewport');

  // B2 — paywall modal scroll-within
  assert(/\.modal\.pw-modal[\s\S]{0,300}max-height:\s*calc\(100dvh/.test(css),
    'B2: .pw-modal has dvh-aware max-height so the title isn\'t pushed off-screen on mobile');
  assert(/\.modal\.pw-modal[\s\S]{0,300}overflow-y:\s*auto/.test(css),
    'B2: .pw-modal scrolls within itself when content exceeds viewport height');

  // L3 — hero image in expanded panel
  assert(/\.exp-v2-hero\s*\{/.test(css),
    'L3: .exp-v2-hero CSS class exists');
  assert(/img class="exp-v2-hero"/.test(appJs),
    'L3: buildExpV2Header emits an <img class="exp-v2-hero"> element');
  assert(/Array\.isArray\(lot\.images\)[\s\S]{0,80}lot\.imageUrl/.test(appJs),
    'L3: hero source falls back from lot.images[0] → lot.imageUrl');

  // L4 — dynamic section numbering
  assert(/__SEC_NUM__/.test(appJs),
    'L4: section builders emit __SEC_NUM__ placeholder instead of literal 1/2/3');
  assert(/_secCounter\s*=\s*0/.test(appJs),
    'L4: assembler tracks running counter');
  assert(/replace\(\/__SEC_NUM__/.test(appJs),
    'L4: assembler substitutes the placeholder with the running count, surviving any hidden section');
  // Make sure the old literal numbers are gone from the badge slots
  assert(!/sec-num-badge">1</.test(appJs),
    'L4: no literal "1" left in sec-num-badge slot');
  assert(!/sec-num-badge">2</.test(appJs),
    'L4: no literal "2" left in sec-num-badge slot');
  assert(!/sec-num-badge">3</.test(appJs),
    'L4: no literal "3" left in sec-num-badge slot');
}

console.log('\nMobile launch fixes (review 2026-05-10) — FLAGs');
{
  const appJs = readFileSync(join(here, '..', 'public', 'app.js'), 'utf8');
  const css = readFileSync(join(here, '..', 'public', 'styles.css'), 'utf8');

  // L5 — postcode block
  assert(/\.lcv2-addr \.pc\s*\{[^}]*display:\s*block/.test(css),
    'L5: .lcv2-addr .pc forced to its own line (no collision with wrapped address)');

  // L6 — house display lookup wired into both list card and expanded header
  assert(/_HOUSE_DISPLAY\s*=\s*\{/.test(appJs),
    'L6: _HOUSE_DISPLAY map declared');
  assert(/getHouseDisplay\(/.test(appJs),
    'L6: getHouseDisplay() helper exposed and called');
  assert(/futureauctions:\s*'Future Property Auctions'/.test(appJs),
    'L6: known offender futureauctions has a friendly display name');
  assert(/hollismorgan:\s*'Hollis Morgan'/.test(appJs),
    'L6: hollismorgan has a friendly display name');

  // L7 — View lot ↗
  assert(/View lot <span class="arr">↗<\/span>/.test(appJs),
    'L7: list-card "View lot" footer link uses ↗ (external) instead of →');

  // F4 — input min-height
  assert(/min-height:\s*44px/.test(css),
    'F4: input/select chrome reaches WCAG 44px minimum on mobile');

  // F2 — footer link padding (tap target)
  assert(/footer p a\s*\{[^}]*padding:\s*8px/.test(css),
    'F2: footer text links carry a hit-area padding so they\'re tappable on mobile');
}

console.log('\nUI polish: Unsold-lots is Pro-gated, section heads use numbered badges');
{
  // Reported 2026-05-10: "Unsold lots" pill should be a Pro tool — confusing
  // for free users. The §1 / §2 / §3 section headers were rendering as
  // garbled glyphs on iOS Safari (font missing the section-sign). Bid +
  // Save buttons read as a single string "I want to bid → ♥" — needed
  // visual separation.
  const unsoldBtn = doc.getElementById('unsoldToggle');
  assert(!!unsoldBtn, 'unsoldToggle still exists in markup');
  assert(unsoldBtn && unsoldBtn.hasAttribute('data-pro-only'),
    'Unsold pill carries data-pro-only — hidden by default');
  assert(unsoldBtn && /pro-tool/.test(unsoldBtn.className),
    'Unsold pill flagged as pro-tool for styling');
  assert(unsoldBtn && unsoldBtn.querySelector('.pro-badge'),
    'Unsold pill displays a "PRO" badge so its tier requirement is obvious');

  const appJs = readFileSync(join(here, '..', 'public', 'app.js'), 'utf8');
  assert(/document\.body\.classList\.toggle\('is-pro'/.test(appJs),
    'is-pro body class wired from tier change');
  assert(/document\.body\.classList\.remove\('is-pro'\)/.test(appJs),
    'is-pro removed on sign-out');

  // Section-head garbling — §1/§2/§3 replaced
  assert(!/§\d+ ·/.test(appJs),
    'no remaining "§N · " section-sign-prefix patterns in app.js');
  // Section numbering moved from literal 1/2/3 to a __SEC_NUM__ placeholder
  // pattern (review 2026-05-10 L4) so hidden sections don't leave gaps.
  // The badges now render via the assembler's running counter — see the
  // dedicated L4 assertions further below.
  assert(/sec-num-badge">__SEC_NUM__</.test(appJs),
    'sec-num-badge slot uses __SEC_NUM__ placeholder for dynamic numbering');

  // Bid + Save polish
  assert(/exp-v2-bid-arr[^<]*↗/.test(appJs),
    'bid button uses external-link arrow ↗ (not generic →)');
  assert(/View on \' \+ esc\(houseLabel/.test(appJs),
    'bid button text is "View on {auction-house}" — clearer than "I want to bid"');
  assert(/exp-v2-fav-label/.test(appJs),
    'save button has a visible label not just the heart glyph');

  // Unsold view — gate also runs at the function boundary, not just the
  // CSS visibility layer. Otherwise ?status=unsold from an alert email
  // would silently apply the filter to a free user with no way to escape.
  assert(/function _gateUnsoldView/.test(appJs),
    '_gateUnsoldView function exists');
  assert(/function toggleUnsoldView[\s\S]{0,200}_gateUnsoldView\(\)/.test(appJs),
    'toggleUnsoldView early-returns when the gate fails');
  assert(/function enforceUnsoldGating/.test(appJs),
    'enforceUnsoldGating function exists');
  assert(/__pendingUnsoldFromUrl/.test(appJs),
    '?status=unsold URL hint stored as pending — only activated when tier is Pro');
  assert(/enforceUnsoldGating\(\)/.test(appJs),
    'enforceUnsoldGating invoked from tier-change paths');
  // Make sure the URL IIFE no longer eagerly sets _unsoldViewActive=true
  // before the tier resolves (would cause a flicker for free users).
  assert(!/_unsoldViewActive=true;\s*\n\s*\$\('unsoldToggle'\)\?\.classList\.add\('active'\)/.test(appJs),
    'URL IIFE no longer eagerly activates the unsold view pre-tier-resolve');
}

console.log('\nOAuth return-URL preservation (mobile sign-in regression)');
{
  // Reported 2026-05-10: signing in with Google from a lot card on mobile
  // dropped the user back at the home page with default filters — the lot
  // they were viewing was lost. Cause: redirectTo: window.location.origin
  // strips the search string, and Supabase's callback overwrites the hash
  // with auth tokens. Fix saves window.location.search to sessionStorage
  // before redirect and restores it on return (only when hash carries auth
  // tokens, so it doesn't fire on plain refreshes).
  const appJs = readFileSync(join(here, '..', 'public', 'app.js'), 'utf8');
  assert(/_saveReturnUrlForOAuth\s*\(/.test(appJs),
    'handleGoogleSignIn calls _saveReturnUrlForOAuth before redirect');
  assert(/sessionStorage\.setItem\('ab_post_auth_search'/.test(appJs),
    'pre-redirect search-string saved under ab_post_auth_search');
  assert(/restoreSearchAfterOAuth/.test(appJs),
    'restoreSearchAfterOAuth IIFE present at module init');
  assert(/access_token=|refresh_token=/.test(appJs),
    'restoration gated on hash carrying auth tokens (not a plain refresh)');
  assert(/async function handleSendMagicLink[\s\S]{0,2000}_saveReturnUrlForOAuth\s*\([\s\S]{0,1500}signInWithOtp/.test(appJs),
    'magic-link path also preserves return URL before signInWithOtp');
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
