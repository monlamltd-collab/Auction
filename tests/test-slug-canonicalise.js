// tests/test-slug-canonicalise.js — canonicaliseHouseSlug after sdl→btgeddisons rename.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
const { canonicaliseHouseSlug } = await import('../lib/houses.js');

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

assert(canonicaliseHouseSlug('btgeddisons') === 'btgeddisons', 'btgeddisons is canonical');
assert(canonicaliseHouseSlug('sdl') === 'btgeddisons', "legacy 'sdl' → btgeddisons");
assert(canonicaliseHouseSlug('BTG Eddisons') === 'btgeddisons', "display 'BTG Eddisons' → btgeddisons");
assert(canonicaliseHouseSlug('charlesdarrow') === 'charlesdarrow' || canonicaliseHouseSlug('charlesdarrow') === null, 'charlesdarrow resolves or is unregistered (plan 3)');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
