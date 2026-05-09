// scripts/one-shot-rental-scrape.mjs
//
// One-shot driver: pulls priority postcodes (active-auction lots), runs
// the SpareRoom + OnTheMarket scrapers shipped today, and prints the
// merged listing rows as JSONL on stdout. The caller wraps the output
// in a SQL upsert (e.g. via Supabase MCP) — keeps this script pure.
//
// Used when the live admin endpoint can't be reached from this session.
// In normal operation, use POST /api/admin/rentals/drain instead.

import { scrapeOnTheMarket } from '../lib/rentals/onthemarket.js';
import { scrapeSpareRoom } from '../lib/rentals/spareroom.js';

// Postcodes piped via stdin, one per line.
const data = await new Promise(r => {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => buf += c);
  process.stdin.on('end', () => r(buf));
});
const postcodes = data.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

let written = 0;
for (const postcode of postcodes) {
  for (const [source, fn] of [['onthemarket', scrapeOnTheMarket], ['spareroom', scrapeSpareRoom]]) {
    try {
      const r = await fn(postcode);
      if (r && Array.isArray(r.listings)) {
        for (const l of r.listings) {
          if (!l.source_id || !(l.rent_pcm > 0)) continue;
          process.stdout.write(JSON.stringify({
            postcode,
            source,
            source_id: String(l.source_id),
            url: l.url || null,
            rent_pcm: Math.round(l.rent_pcm),
            beds: typeof l.beds === 'number' ? l.beds : null,
            property_type: l.property_type || null,
            is_room_share: !!l.is_room_share,
            area_label: l.area_label || null,
          }) + '\n');
          written++;
        }
        process.stderr.write(`${postcode} ${source}: ${r.listings.length} listings\n`);
      } else {
        process.stderr.write(`${postcode} ${source}: 0 listings\n`);
      }
    } catch (err) {
      process.stderr.write(`${postcode} ${source}: ERROR ${err.message}\n`);
    }
    // Polite gap between calls
    await new Promise(rr => setTimeout(rr, 200));
  }
}

process.stderr.write(`\nTotal listings written: ${written}\n`);
