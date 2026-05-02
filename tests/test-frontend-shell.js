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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
