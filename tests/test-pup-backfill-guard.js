// tests/test-pup-backfill-guard.js — regression for the 2026-06-12 incident:
// server.js stopped wiring the retired backfillImagesWithPuppeteer no-op into
// initAnalysis deps, but enrich-stage / cache-enrich-stage still called it
// whenever deps.puppeteer was truthy and the Firecrawl pass couldn't run
// (credits exhausted). Result: "deps.backfillImagesWithPuppeteer is not a
// function" → all scrape tiers failed for any PUPPETEER_IMAGE_HOUSES member
// with ≥1 imageless lot (iamsold + halls, 2026-06-11/12 pipeline_alerts).
//
// Contract: both stages tolerate the dep being absent (skip the pass), and
// still invoke it when a caller does provide it.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost.invalid';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const { enrichStage } = await import('../lib/pipeline/enrich-stage.js');
const { cacheEnrichStage } = await import('../lib/pipeline/cache-enrich-stage.js');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

// Addresses stay under 5 chars so runOsPlacesPass has no targets (no network).
function rawLot() {
  return { lot: 1, address: 'A St', url: 'https://example.invalid/lot/1' };
}

const baseEnrichDeps = () => ({
  analyseLot: l => ({ ...l, score: 5 }),
  enrichLots: async () => {},
  enrichLotsFromLotPages: async () => {},
  FIRECRAWL_API_KEY: undefined, // Firecrawl pass can't run (credit-outage analogue)
  isFcCreditExhausted: () => true,
  puppeteer: {}, // truthy — the production trap
});

console.log('\nenrichStage: retired Puppeteer backfill dep');
{
  let threw = null;
  try {
    await enrichStage(
      { rawLots: [rawLot()], house: 'iamsold', url: 'https://example.invalid/cat' },
      baseEnrichDeps(), // backfillImagesWithPuppeteer ABSENT
    );
  } catch (e) { threw = e; }
  assert(!threw, `absent dep is skipped, not called (got: ${threw ? threw.message : 'no throw'})`);

  let called = 0;
  const deps = { ...baseEnrichDeps(), backfillImagesWithPuppeteer: async () => { called++; return 0; } };
  await enrichStage({ rawLots: [rawLot()], house: 'iamsold', url: 'https://example.invalid/cat' }, deps);
  assert(called === 1, 'provided dep is still invoked for imageless lots');
}

console.log('\ncacheEnrichStage: retired Puppeteer backfill dep');
{
  const makeCtx = () => ({
    auction: { house: 'iamsold', url: 'https://example.invalid/cat' },
    normalisedUrl: 'https://example.invalid/cat',
    cachedLots: [rawLot()],
    cachedTotalLots: 1,
  });
  const makeDeps = () => ({
    backfillImages: async () => null,
    backfillImagesFromLotPages: async () => 0,
    FIRECRAWL_API_KEY: undefined,
    isFcCreditExhausted: () => true,
    puppeteer: {},
    normaliseLotStatuses: () => {},
    upsertToLotsTable: async () => {},
  });

  let threw = null;
  try {
    await cacheEnrichStage(makeCtx(), makeDeps()); // dep ABSENT
  } catch (e) { threw = e; }
  assert(!threw, `absent dep is skipped, not called (got: ${threw ? threw.message : 'no throw'})`);

  let called = 0;
  await cacheEnrichStage(makeCtx(), { ...makeDeps(), backfillImagesWithPuppeteer: async () => { called++; return 0; } });
  assert(called === 1, 'provided dep is still invoked for imageless lots');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
