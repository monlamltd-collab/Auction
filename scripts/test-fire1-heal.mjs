#!/usr/bin/env node
// scripts/test-fire1-heal.mjs — Manual smoke test for the FIRE-1 healing swap.
// Verifies that Firecrawl's FIRE-1 autonomous agent can identify the current
// catalogue URL on an auction house's homepage with usable confidence — the
// behaviour previously powered by Gemini-2.5-pro in lib/pipeline/healing.js.
//
// Usage:
//   FIRECRAWL_API_KEY=fc-... node scripts/test-fire1-heal.mjs [homepage-url]
// Default URL: https://www.maggsandallen.co.uk/

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://test.local';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test';

const { ResourceBudget } = await import('../lib/resource-budget.js');
const { initState } = await import('../lib/scraper/state.js');
const { agentExtract } = await import('../lib/scraper/firecrawl.js');

if (!process.env.FIRECRAWL_API_KEY) {
  console.error('FIRECRAWL_API_KEY env var required');
  process.exit(1);
}

const budget = new ResourceBudget({ firecrawlApiKey: process.env.FIRECRAWL_API_KEY });
initState({ budget });

const homepage = process.argv[2] || 'https://www.maggsandallen.co.uk/';
const schema = {
  type: 'object',
  properties: {
    newUrl: { type: ['string', 'null'], description: 'Absolute URL of the current upcoming property auction catalogue page, or null if none found' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
    reason: { type: 'string' },
  },
  required: ['newUrl', 'confidence', 'reason'],
};
const prompt = `Starting from this homepage of a UK property auction house, navigate the site as needed to find the CURRENT upcoming property auction catalogue page — the page bidders use to browse all lots in the next auction. Prefer pages with "catalogue", "lots", "properties", "auction", "current", "upcoming", "search". Avoid past/archived auctions, news, blog, about, contact pages. Return your finding via the schema; set confidence='none' and newUrl=null if no current catalogue exists.`;

console.log(`FIRE-1 smoke test against ${homepage}`);
const t0 = Date.now();
try {
  const result = await agentExtract(homepage, prompt, schema, { timeout: 120000 });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nFIRE-1 result (${elapsed}s):`);
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nCredits used this run: ${budget.getFcCreditsUsed()} (FIRE-1 multiplier = ${budget.fire1CreditMult})`);
} catch (err) {
  console.error(`FIRE-1 failed after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, err.message);
  process.exit(2);
} finally {
  budget.destroy();
}
