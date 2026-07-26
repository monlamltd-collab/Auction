/** McHugh AI candidates require both live lots and a page-verified candidate date. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
const { filterAiCandidates } = await import('../lib/pipeline/auction-watcher.js');
const { AUCTION_DISCOVERY } = await import('../lib/houses.js');
let passed = 0, failed = 0;
const assert = (c, m) => c ? (console.log(`  PASS: ${m}`), passed++) : (console.error(`  FAIL: ${m}`), failed++);
const entry = { url: 'https://mchughandco.com/current-auction', date: '2026-09-16', source: 'ai' };
const cfg = AUCTION_DISCOVERY.mchughandco;
const lots = Array.from({ length: 4 }, (_, i) => `<a href="/lot/${100 + i}">Lot ${i + 1}</a>`).join('');
const page = (heading) => `<html><body><h1>${heading}</h1>${lots}<p>${'catalogue '.repeat(80)}</p></body></html>`;

assert(cfg?.requireCandidateDateVerification === true, 'McHugh requires candidate-date verification');
assert(cfg?.allowDateFallback === false, 'McHugh explicitly disables the 30-day date fallback');

const rejected = await filterAiCandidates('mchughandco', [entry], async () => { throw new Error('timeout'); });
assert(rejected.length === 0, 'verification fetch error rejects candidate');

const shell = await filterAiCandidates('mchughandco', [entry], async () => '<html><h1>Next auction 16 September 2026</h1></html>');
assert(shell.length === 0, 'dated pre-publication shell without lots is rejected');

const staleLots = await filterAiCandidates('mchughandco', [entry], async () => page('Previous auction 22 July 2026'));
assert(staleLots.length === 0, 'lot links alone cannot bind stale lots to the AI candidate date');

const undatedLots = await filterAiCandidates('mchughandco', [{ ...entry, date: null }], async () => page('Current auction lots'));
assert(undatedLots.length === 0, 'undated candidate cannot become ready even when lot links exist');

const verified = await filterAiCandidates('mchughandco', [entry], async () => page('Next auction 16th September 2026'));
assert(verified.length === 1, 'candidate is accepted only when live lots and matching page date are both present');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
