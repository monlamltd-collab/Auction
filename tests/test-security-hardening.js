/**
 * Regression tests for the 2026-06-12 security review HIGH fixes:
 *   H1 — getClientIP must use the trusted req.ip, not the spoofable
 *        X-Forwarded-For header (rate-limit bypass / quota evasion).
 *   H3 — validateUrl must reject encoded-IP hosts; safeFetch must re-validate
 *        every redirect hop so a public URL can't 302 into an internal address.
 * (H2 — the smartQuery innerHTML escape — is a browser sink; guarded by the
 *  static assertion at the end that the partial .replace was replaced by esc().)
 *
 * Run: node tests/test-security-hardening.js
 */

import { readFileSync } from 'node:fs';
// lib/auth.js transitively imports the Supabase client, which throws on import
// without a URL. Stub the env before that import (mirrors test-auth-cache.js).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
const { getClientIP } = await import('../lib/auth.js');
import { validateUrl, safeFetch } from '../lib/security.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}
async function throwsCode(fn, code, msg) {
  try { await fn(); assert(false, `${msg} (did not throw)`); }
  catch (e) { assert(e.code === code, `${msg} (threw ${e.code || e.message})`); }
}

console.log('H1: getClientIP ignores the spoofable X-Forwarded-For');
{
  const req = {
    ip: '203.0.113.9',                                   // Express's trusted value
    headers: { 'x-forwarded-for': '127.0.0.1, 10.0.0.1' }, // attacker-controlled
    socket: { remoteAddress: '198.51.100.2' },
  };
  assert(getClientIP(req) === '203.0.113.9', 'returns req.ip, not the X-Forwarded-For leftmost');
  assert(getClientIP({ headers: {}, socket: { remoteAddress: '198.51.100.2' } }) === '198.51.100.2',
    'falls back to socket.remoteAddress when req.ip is absent');
  assert(getClientIP({ headers: {}, socket: {} }) === 'unknown', 'final fallback is "unknown"');
}

console.log('\nH3a: validateUrl rejects encoded-IP and private hosts (network-free paths)');
{
  const cases = [
    ['http://2130706433/', 'bare integer IP (127.0.0.1)'],
    ['http://0x7f000001/', 'hex IP'],
    ['http://0177.0.0.1/', 'octal-dotted IP'],
    ['http://0x7f.0.0.1/', 'hex-dotted IP'],
    ['http://127.0.0.1/', 'loopback'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata link-local'],
    ['http://localhost:8080/', 'localhost'],
    ['http://10.1.2.3/', 'RFC1918 10.x'],
    ['http://x.railway.internal/', 'platform-internal host'],
    ['ftp://example.com/', 'non-http protocol'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['not a url', 'unparseable'],
  ];
  for (const [url, label] of cases) {
    const r = await validateUrl(url);
    assert(r.ok === false, `rejects ${label}`);
  }
}

console.log('\nH3b: safeFetch re-validates every redirect hop');
{
  // Stub validateUrl: public hosts pass, anything internal-looking fails —
  // exercises the loop wiring without real DNS.
  const stubValidate = async (u) => {
    if (/169\.254|127\.0\.0\.1|localhost|\.internal/i.test(u)) return { ok: false, error: 'internal' };
    return { ok: true, url: u };
  };

  // (1) A 302 from a public URL to an internal address must be BLOCKED at the
  // next hop — the exact redirect-SSRF the fix closes.
  const redirectToInternal = async (u) => {
    if (u === 'https://public.example/catalogue')
      return { status: 302, headers: { get: (h) => h === 'location' ? 'http://169.254.169.254/' : null } };
    throw new Error(`unexpected fetch to ${u} — redirect target was NOT blocked`);
  };
  await throwsCode(
    () => safeFetch('https://public.example/catalogue', {}, { _validateUrl: stubValidate, _fetch: redirectToInternal }),
    'SSRF_BLOCKED',
    'redirect to 169.254.169.254 is blocked before the second fetch',
  );

  // (2) A plain 200 passes straight through.
  let fetched = [];
  const ok200 = async (u) => { fetched.push(u); return { status: 200, headers: { get: () => null }, ok: true }; };
  const resp = await safeFetch('https://public.example/ok', {}, { _validateUrl: stubValidate, _fetch: ok200 });
  assert(resp.status === 200 && fetched.length === 1, 'non-redirect response returned directly');

  // (3) One public→public redirect is followed (both validated), then 200.
  fetched = [];
  const oneHop = async (u) => {
    fetched.push(u);
    if (u === 'https://a.example/') return { status: 301, headers: { get: (h) => h === 'location' ? 'https://b.example/' : null } };
    return { status: 200, headers: { get: () => null }, ok: true };
  };
  const r3 = await safeFetch('https://a.example/', {}, { _validateUrl: stubValidate, _fetch: oneHop });
  assert(r3.status === 200 && fetched.length === 2, 'public→public redirect followed after re-validation');

  // (4) A redirect loop trips the maxRedirects guard.
  const loop = async () => ({ status: 302, headers: { get: (h) => h === 'location' ? 'https://loop.example/' : null } });
  await throwsCode(
    () => safeFetch('https://loop.example/', {}, { _validateUrl: stubValidate, _fetch: loop, maxRedirects: 3 }),
    'TOO_MANY_REDIRECTS',
    'redirect loop is bounded by maxRedirects',
  );
}

console.log('\nH2: the smartQuery empty-results sink uses esc() (static guard)');
{
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert(/No results for[^\n]*\+\s*esc\(searchQ\)/.test(app),
    'smartQuery is wrapped in esc() in the no-results branch');
  assert(!/No results for[^\n]*searchQ\.replace\(/.test(app),
    'the old partial searchQ.replace() escape is gone');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Security hardening tests: ${passed} passed, ${failed} failed`);
// Force exit — lib/auth.js (jose JWKS) + the rate-limit cleanup interval hold
// background timers that prevent Node from terminating naturally.
process.exit(failed > 0 ? 1 : 0);
