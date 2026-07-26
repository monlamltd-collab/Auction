/**
 * Resolver-capable catalogue roots must remain schedulable even when all dated
 * calendar rows are catalogue_ready=false. The resolver itself determines
 * whether live lots exist; no database readiness flag is force-flipped.
 * Run: node tests/test-calendar-resolver-backstops.js
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { addResolverBackstops } = await import('../lib/calendar.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const roots = {
  savills: 'https://auctions.savills.co.uk/upcoming-auctions',
  edwardmellor: 'https://edwardmellor.co.uk/auctions/',
  mchughandco: 'https://mchughandco.com/current-auction',
};
const names = { savills: 'Savills', edwardmellor: 'Edward Mellor', mchughandco: 'McHugh & Co' };

console.log('resolver backstops');
{
  const rows = [{ house: 'Other', url: 'https://other.example/live', date: '2099-12-31', catalogueReady: true, status: 'always_on' }];
  const out = addResolverBackstops(rows, {
    resolverSlugs: new Set(['savills', 'edwardmellor']), houseRoots: roots, displayNames: names,
  });
  assert(out.some(r => r.house === 'Savills' && r.url === roots.savills && r.resolverBackstop === true), 'Savills resolver root added');
  assert(out.some(r => r.house === 'Edward Mellor' && r.url === roots.edwardmellor), 'Edward Mellor resolver root added');
  assert(!out.some(r => r.house === 'McHugh & Co'), 'ordinary rolling root is not force-scheduled');
  const savills = out.find(r => r.houseSlug === 'savills');
  assert(savills.catalogueReady === false, 'resolver queue record does not claim catalogue readiness');
  assert(savills.status === 'resolver_backstop', 'resolver queue record does not impersonate always_on/MMOA');
}

console.log('\ndedupes by selected slug, not display-name equality');
{
  const rows = [{ house: 'Savills Auctions (alias)', houseSlug: 'savills', url: 'https://auctions.savills.co.uk/auctions/28-july-2026-229', date: '2026-07-28', catalogueReady: true, status: 'upcoming' }];
  const out = addResolverBackstops(rows, {
    resolverSlugs: new Set(['savills']), houseRoots: roots, displayNames: names,
  });
  assert(out.length === 1, 'house_slug suppresses backstop despite display-name alias');
}

console.log('\ndedupes by normalised resolver root URL');
{
  const rows = [{ house: 'Legacy label', houseSlug: 'legacy-slug', url: 'https://www.edwardmellor.co.uk/auctions', date: '2026-07-28', catalogueReady: true, status: 'always_on' }];
  const out = addResolverBackstops(rows, {
    resolverSlugs: new Set(['edwardmellor']), houseRoots: roots, displayNames: names,
  });
  assert(out.length === 1, 'www/trailing-slash root variant suppresses duplicate backstop');
}

console.log('\ndisplay-name equality alone does not suppress the selected slug');
{
  const rows = [{ house: 'Savills', houseSlug: 'other-house', url: 'https://other.example/catalogue', date: '2026-07-28', catalogueReady: true, status: 'upcoming' }];
  const out = addResolverBackstops(rows, {
    resolverSlugs: new Set(['savills']), houseRoots: roots, displayNames: names,
  });
  assert(out.length === 2 && out[1].houseSlug === 'savills', 'backstop carries resolver slug and ignores coincidental display-name match');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
