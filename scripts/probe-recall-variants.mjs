#!/usr/bin/env node
// Option B experiment: can we get JSON recall ≥18/20 on Pattinson without
// a markdown parser? Test 4 variants and report recall for each.
//
// Variants:
//   1. Current schema + current prompt (baseline — known ~10/20)
//   2. Current schema + EMPHATIC prompt (count, must return all 20)
//   3. Minimal schema (just address + detail_url) + emphatic prompt
//   4. /v2/agent with spark-1-pro
//
// Run: FIRECRAWL_API_KEY=fc-... node scripts/probe-recall-variants.mjs

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) { console.error('ERROR: FIRECRAWL_API_KEY not set'); process.exit(1); }

const URL_TO_TEST = 'https://www.pattinson.co.uk/auction/property-search?p=2';

const FULL_SCHEMA = {
  type: 'object',
  properties: {
    lots: {
      type: 'array',
      description: 'Every property listing card visible on the page — typically 20 per listing page.',
      items: {
        type: 'object',
        properties: {
          lot_number: { type: 'number' },
          address: { type: 'string', description: 'Full address including postcode.' },
          guide_price: { type: 'string' },
          property_type: { type: 'string' },
          bedrooms: { type: 'number' },
          tenure: { type: 'string' },
          image_url: { type: 'string' },
          detail_url: { type: 'string' },
          description: { type: 'string' },
          lot_status: { type: 'string' },
          auction_date: { type: 'string' }
        },
        required: ['address']
      }
    }
  },
  required: ['lots']
};

const MINIMAL_SCHEMA = {
  type: 'object',
  properties: {
    lots: {
      type: 'array',
      description: 'Every property card on the page — there are 20.',
      items: {
        type: 'object',
        properties: {
          address: { type: 'string' },
          detail_url: { type: 'string' }
        },
        required: ['address', 'detail_url']
      }
    }
  },
  required: ['lots']
};

const POLITE_PROMPT =
  'Extract EVERY property listing card visible on this page. Do not skip any. ' +
  'Catalogue listing pages typically show ~20 lots per page; ensure your `lots` array contains all of them. ' +
  'For each lot, fill every field that is visible on the card.';

const EMPHATIC_PROMPT =
  'CRITICAL: This page contains EXACTLY 20 property listing cards. You MUST return ALL 20.\n' +
  'BEFORE responding, COUNT the cards on the page. Returning fewer than 20 is a failure.\n' +
  'Each card has an image, a price, a property type, an address, and a link to /property/{id}.\n' +
  'The page header shows "1673 results" — those 1673 are spread across 84 pages, with 20 per page.\n' +
  'Your `lots` array MUST have 20 entries. Do not stop until you have 20.\n' +
  'For each card, extract every visible field. If a field is not on the card, return null for it.';

async function withRetry(fn, label) {
  const BACKOFF = [2000, 4000, 8000, 16000, 30000];
  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    try { return await fn(); }
    catch (err) {
      const retryable = /UND_ERR_SOCKET|fetch failed|timeout|abort|5\d\d/i.test(err.message + (err.cause?.code || ''));
      if (!retryable || attempt === BACKOFF.length) throw err;
      const delay = BACKOFF[attempt];
      console.log(`  ${label} attempt ${attempt + 1} failed (${err.cause?.code || err.message}), retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function probeScrape({ label, schema, prompt }) {
  const t0 = Date.now();
  const body = {
    url: URL_TO_TEST,
    formats: [{ type: 'json', schema, prompt }, 'markdown'],
    timeout: 120000,
  };
  const resp = await withRetry(() => fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(150000),
  }), label);
  const elapsed = Date.now() - t0;
  const data = await resp.json();
  if (!data.success) return { label, fail: true, err: data.error, elapsed };
  const lots = data.data?.json?.lots || [];
  const md = data.data?.markdown || '';
  const mdIds = new Set([...md.matchAll(/\/property\/(\d+)/g)].map(m => m[1]));
  return { label, fail: false, jsonCount: lots.length, mdCount: mdIds.size, elapsed, sample: lots[0] };
}

async function probeAgent({ label, schema, prompt, model }) {
  const t0 = Date.now();
  // Start agent job
  const startResp = await withRetry(() => fetch('https://api.firecrawl.dev/v2/agent', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, urls: [URL_TO_TEST], schema, model, maxCredits: 500 }),
    signal: AbortSignal.timeout(30000),
  }), label + ' (start)');
  const startData = await startResp.json();
  if (!startData.success) return { label, fail: true, err: startData.error, elapsed: Date.now() - t0 };
  const jobId = startData.id;
  if (!jobId) return { label, fail: true, err: 'no jobId', elapsed: Date.now() - t0 };

  // Poll
  const deadline = Date.now() + 600000; // 10 min
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const pollResp = await fetch(`https://api.firecrawl.dev/v2/agent/${jobId}`, {
      headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}` },
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    if (!pollResp || !pollResp.ok) continue;
    const pollData = await pollResp.json();
    if (pollData.status === 'completed') {
      const elapsed = Date.now() - t0;
      const data = pollData.data || {};
      const lots = data?.lots || (Array.isArray(data) ? data : []);
      return { label, fail: false, jsonCount: lots.length, mdCount: null, elapsed, creditsUsed: pollData.creditsUsed, sample: lots[0] };
    }
    if (pollData.status === 'failed' || pollData.status === 'cancelled') {
      return { label, fail: true, err: pollData.error || pollData.status, elapsed: Date.now() - t0 };
    }
  }
  return { label, fail: true, err: 'agent timed out', elapsed: Date.now() - t0 };
}

const RESULTS = [];
console.log('Option B experiment — Pattinson recall variants');
console.log(`URL: ${URL_TO_TEST}`);
console.log(`API key: ${FIRECRAWL_API_KEY.slice(0, 8)}...${FIRECRAWL_API_KEY.slice(-4)}`);
console.log('='.repeat(70));

console.log('\n[1/4] /v2/scrape, full schema, polite prompt (baseline)');
RESULTS.push(await probeScrape({ label: 'scrape-full-polite', schema: FULL_SCHEMA, prompt: POLITE_PROMPT }));
await new Promise(r => setTimeout(r, 3000));

console.log('\n[2/4] /v2/scrape, full schema, EMPHATIC prompt');
RESULTS.push(await probeScrape({ label: 'scrape-full-emphatic', schema: FULL_SCHEMA, prompt: EMPHATIC_PROMPT }));
await new Promise(r => setTimeout(r, 3000));

console.log('\n[3/4] /v2/scrape, MINIMAL schema (address+detail_url only), emphatic prompt');
RESULTS.push(await probeScrape({ label: 'scrape-minimal-emphatic', schema: MINIMAL_SCHEMA, prompt: EMPHATIC_PROMPT }));
await new Promise(r => setTimeout(r, 3000));

console.log('\n[4/4] /v2/agent, full schema, emphatic prompt, spark-1-pro');
RESULTS.push(await probeAgent({ label: 'agent-pro-emphatic', schema: FULL_SCHEMA, prompt: EMPHATIC_PROMPT, model: 'spark-1-pro' }));

console.log(`\n${'='.repeat(70)}`);
console.log('SUMMARY (target: ≥18 lots in JSON for Pattinson p=2)');
console.log('='.repeat(70));
for (const r of RESULTS) {
  if (r.fail) {
    console.log(`  ${r.label.padEnd(28)} FAIL — ${r.err} (${(r.elapsed / 1000).toFixed(0)}s)`);
  } else {
    const verdict = r.jsonCount >= 18 ? 'PASS' : 'FAIL';
    const mdPart = r.mdCount != null ? `/${r.mdCount} md` : '';
    const credPart = r.creditsUsed != null ? `, ${r.creditsUsed} credits` : '';
    console.log(`  ${r.label.padEnd(28)} ${verdict} — ${r.jsonCount} lots${mdPart} (${(r.elapsed / 1000).toFixed(0)}s${credPart})`);
    if (r.sample) console.log(`    sample: ${r.sample.address || '?'} — ${r.sample.guide_price || r.sample.detail_url || '?'}`);
  }
}

const wins = RESULTS.filter(r => !r.fail && r.jsonCount >= 18);
console.log(`\n${wins.length}/${RESULTS.length} variants reach the target.`);
if (wins.length > 0) {
  console.log(`\n✓ Option B works. Cheapest winner: ${wins[0].label}`);
  console.log('  → no markdown parser needed, just configure this approach for Pattinson');
} else {
  console.log('\n✗ Option B does not reach target. Revert to Option A (restore parsePattinsonLotCard).');
}
