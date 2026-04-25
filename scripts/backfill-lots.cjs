#!/usr/bin/env node
/**
 * Backfill script: reads cached_analyses blobs and inserts each lot
 * as an individual row in the new `lots` table.
 *
 * Run once: node scripts/backfill-lots.js
 * Safe to re-run: uses ON CONFLICT to skip existing lots.
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY env vars
 * (or falls back to SUPABASE_ANON_KEY).
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function backfill() {
  console.log('Fetching cached_analyses...');
  const { data: cached, error } = await supabase
    .from('cached_analyses')
    .select('house, url, lots, created_at, scraped_with, extracted_with');

  if (error) {
    console.error('Failed to fetch cached_analyses:', error.message);
    process.exit(1);
  }

  console.log(`Found ${cached.length} catalogue rows`);

  let totalLots = 0;
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const catalogue of cached) {
    const lots = catalogue.lots;
    if (!Array.isArray(lots)) continue;

    // Process in batches of 50 to avoid payload limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < lots.length; i += BATCH_SIZE) {
      const batch = lots.slice(i, i + BATCH_SIZE);
      const rows = [];

      for (const lot of batch) {
        totalLots++;

        // Skip garbage lots (junk addresses from broken extractors)
        const addr = (lot.address || '').trim();
        if (!addr || addr.length < 5) continue;
        const junkPattern = /^(I'd like to|Property search|Popular|Auction Dates|Register to bid|Information|\dBid Basket|Cookie|Privacy)/i;
        if (junkPattern.test(addr)) {
          skipped++;
          continue;
        }

        // Build the lot row — map from blob field names to table column names
        const row = {
          house: lot._house || catalogue.house,
          lot_number: lot.lot || null,
          url: lot.url || null,
          catalogue_url: catalogue.url,
          address: addr,
          postcode: lot.postcode || null,
          price: (typeof lot.price === 'number' && lot.price > 0) ? lot.price : null,
          price_text: lot.priceText || null,
          prop_type: lot.propType || null,
          beds: (typeof lot.beds === 'number') ? lot.beds : null,
          tenure: lot.tenure || null,
          lease_length: (typeof lot.leaseLength === 'number') ? lot.leaseLength : null,
          sqft: (typeof lot.sqft === 'number') ? lot.sqft : null,
          condition: lot.condition || null,
          image_url: lot.imageUrl || null,
          bullets: lot.bullets || [],
          units: lot.units || 0,
          auction_date: lot._auctionDate || null,
          status: lot.status || 'available',
          sold_price: null, // not tracked in current system
          epc_rating: lot.epcRating || null,
          epc_score: (typeof lot.epcScore === 'number') ? lot.epcScore : null,
          epc_date: lot.epcDate || null,
          flood_zone: (typeof lot.floodZone === 'number') ? lot.floodZone : null,
          flood_risk: lot.floodRiskLevel || null,
          street_avg: (typeof lot.streetAvg === 'number') ? lot.streetAvg : null,
          street_sales: lot.streetSales || null,
          street_sales_count: (typeof lot.streetSalesCount === 'number') ? lot.streetSalesCount : null,
          below_market: (typeof lot.belowMarket === 'number') ? lot.belowMarket : null,
          est_monthly_rent: (typeof lot.estMonthlyRent === 'number') ? lot.estMonthlyRent : null,
          est_annual_rent: (typeof lot.estAnnualRent === 'number') ? lot.estAnnualRent : null,
          est_gross_yield: (typeof lot.estGrossYield === 'number') ? lot.estGrossYield : null,
          score: (typeof lot.score === 'number') ? lot.score : null,
          score_breakdown: lot.scoreBreakdown || [],
          opps: lot.opps || [],
          risks: lot.risks || [],
          deal_type: lot.dealType || null,
          vacant: lot.vacant || null,
          title_split: lot.titleSplit || null,
          extracted_with: catalogue.extracted_with || null,
          scraped_with: catalogue.scraped_with || null,
          first_seen_at: catalogue.created_at || new Date().toISOString(),
          last_seen_at: catalogue.created_at || new Date().toISOString(),
          enriched_at: lot.enrichedAt || null,
        };

        // Skip lots with no URL (can't dedup without it)
        if (!row.url) {
          // Use a synthetic key: house + address + price
          row.url = `__synthetic__${row.house}__${addr.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 80)}__${row.price || 0}`;
        }

        rows.push(row);
      }

      if (rows.length === 0) continue;

      const { data, error: insertErr } = await supabase
        .from('lots')
        .upsert(rows, { onConflict: 'house,url', ignoreDuplicates: true });

      if (insertErr) {
        console.error(`  Error inserting batch for ${catalogue.house}: ${insertErr.message}`);
        errors += rows.length;
      } else {
        inserted += rows.length;
      }
    }

    console.log(`  ${catalogue.house}: ${lots.length} lots processed`);
  }

  // Verify
  const { count } = await supabase.from('lots').select('*', { count: 'exact', head: true });

  console.log('\n=== BACKFILL COMPLETE ===');
  console.log(`Catalogues processed: ${cached.length}`);
  console.log(`Total lots in blobs: ${totalLots}`);
  console.log(`Inserted/updated: ${inserted}`);
  console.log(`Skipped (garbage): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Rows in lots table: ${count}`);
}

backfill().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
