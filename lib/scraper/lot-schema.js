// lib/scraper/lot-schema.js — JSON schemas + extraction prompts for Firecrawl structured extraction.
//
// The prompts are critical for high-recall list extraction. Without them the LLM
// returns 6–10 lots per page on a list of 20. With them, recall jumps to ~95%.
// See docs/firecrawl-extractor-playbook.md "The recall problem".

export const CATALOGUE_SCHEMA = {
  type: 'object',
  properties: {
    lots: {
      type: 'array',
      description: 'Every property listing card visible on the page — typically 20 per listing page. Include all of them. Each card represents one lot.',
      items: {
        type: 'object',
        properties: {
          lot_number: { type: 'number', description: 'Auction lot number if shown on the card. Return null if not visible.' },
          address: { type: 'string', description: 'Full property address including postcode if available.' },
          guide_price: { type: 'string', description: 'Guide price exactly as shown (e.g. "£250,000", "£100,000+", "Offers in Excess of £150,000"). Return null if not shown.' },
          property_type: { type: 'string', description: 'house, flat, land, commercial, apartment, bungalow, etc. Return null if not stated.' },
          bedrooms: { type: 'number', description: 'Number of bedrooms if stated. Return null if not on the card.' },
          tenure: { type: 'string', description: 'Freehold or Leasehold. Return null if not stated.' },
          image_url: { type: 'string', description: 'Main property image URL — full URL starting with https://. Return null if no image.' },
          detail_url: { type: 'string', description: 'Link to the full lot details page — full URL starting with https://. Return null if no link.' },
          description: { type: 'string', description: 'Brief property description if shown on the card.' },
          lot_status: { type: 'string', description: 'One of: available, sold, withdrawn, postponed. Default to "available" if no status badge is shown.' },
          auction_date: { type: 'string', description: 'Auction date for this lot if shown on the card.' }
        },
        required: ['address']
      }
    },
    auction_date: { type: 'string', description: 'Overall auction date for this catalogue if shown in the page header.' },
    total_lots: { type: 'number', description: 'Total number of lots stated on the page (e.g. "1673 results"). Return null if not shown.' }
  },
  required: ['lots']
};

// Prompt to pass alongside CATALOGUE_SCHEMA. Critical for high-recall list
// extraction. Empirically, a polite prompt under-extracts ~30-50% on dense
// SPAs (e.g. Pattinson returned 14/20 lots). The emphatic version below
// pushed the same page to 20/20 in 53s. Verified 2026-05-04 against Pattinson
// page 2 with full CATALOGUE_SCHEMA via /v2/scrape.
export const CATALOGUE_PROMPT =
  'CRITICAL: Return EVERY property listing card visible on this page. ' +
  'Most catalogue pages display 10-25 lot cards in a list or grid layout.\n' +
  'BEFORE responding, COUNT the cards on the page. Returning fewer than what you can actually see is a failure.\n' +
  'Each card typically has: an image, a price (e.g. "£250,000" or "Guide £150,000+"), ' +
  'a property type / bedrooms label, an address, and a link to a per-lot detail page.\n' +
  'Your `lots` array MUST contain one entry per visible card. Do not stop early. ' +
  'Do not deduplicate cards that look similar. Treat every distinct card as a separate lot.\n' +
  'For each card, fill every field that is visible on it. Return null for fields that are not present on this card. ' +
  'Lot status values: available | sold | withdrawn | postponed (default to "available" if no status badge).';

export const DETAIL_SCHEMA = {
  type: 'object',
  properties: {
    address: { type: 'string', description: 'Full property address including postcode.' },
    description: { type: 'string', description: 'Full property description from the listing page.' },
    image_urls: {
      type: 'array',
      items: { type: 'string' },
      description: 'All property image URLs in the gallery — full URLs starting with https://.'
    },
    floor_plan_url: { type: 'string', description: 'Floor plan image or PDF URL if shown.' },
    epc_rating: { type: 'string', description: 'EPC rating A-G if displayed.' },
    epc_url: { type: 'string', description: 'EPC certificate image/PDF URL if linked.' },
    legal_pack_url: { type: 'string', description: 'Legal pack download URL if linked.' },
    guide_price: { type: 'string', description: 'Guide price exactly as shown.' },
    tenure: { type: 'string', description: 'Freehold or Leasehold.' },
    ground_rent: { type: 'string', description: 'Annual ground rent if leasehold.' },
    service_charge: { type: 'string', description: 'Annual service charge if applicable.' },
    council_tax_band: { type: 'string', description: 'Council tax band A-H.' },
    sqft: { type: 'number', description: 'Square footage or square metres if stated.' },
    bedrooms: { type: 'number' },
    bathrooms: { type: 'number' },
    reception_rooms: { type: 'number' },
    special_conditions: { type: 'string', description: 'Deposit %, completion timeline, special notes.' },
    property_type: { type: 'string' },
    lot_number: { type: 'number', description: 'Auction lot number if shown.' },
    lot_status: { type: 'string', description: 'available, sold, withdrawn, postponed.' },
    auction_date: { type: 'string', description: 'Auction date.' }
  },
  required: ['address']
};

// Prompt for DETAIL_SCHEMA. Used for per-detail-page backfill when listing-page
// JSON extraction misses a lot. Detail pages usually have one set of fields,
// so recall is rarely a problem here, but null-handling guidance still helps.
export const DETAIL_PROMPT =
  'Extract the property details for this single lot. Fill every field that is visible on the page. ' +
  'Return null for fields that are not stated. Use the exact text from the page for prices and addresses.';
