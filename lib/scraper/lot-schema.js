// lib/scraper/lot-schema.js — JSON schemas for Firecrawl structured extraction

export const CATALOGUE_SCHEMA = {
  type: 'object',
  properties: {
    lots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lot_number: { type: 'number', description: 'Auction lot number' },
          address: { type: 'string', description: 'Full property address including postcode' },
          guide_price: { type: 'string', description: 'Guide price or price range as shown' },
          property_type: { type: 'string', description: 'house, flat, land, commercial, etc.' },
          bedrooms: { type: 'number', description: 'Number of bedrooms if stated' },
          tenure: { type: 'string', description: 'Freehold or Leasehold' },
          image_url: { type: 'string', description: 'Main property image URL (full URL)' },
          detail_url: { type: 'string', description: 'Link to full lot details page (full URL)' },
          description: { type: 'string', description: 'Brief property description' },
          lot_status: { type: 'string', description: 'available, sold, withdrawn, postponed' },
          auction_date: { type: 'string', description: 'Auction date if shown on this page' }
        },
        required: ['address']
      }
    },
    auction_date: { type: 'string', description: 'Overall auction date for this catalogue' },
    total_lots: { type: 'number', description: 'Total number of lots if stated' }
  },
  required: ['lots']
};

export const DETAIL_SCHEMA = {
  type: 'object',
  properties: {
    address: { type: 'string', description: 'Full property address' },
    description: { type: 'string', description: 'Full property description' },
    image_urls: {
      type: 'array',
      items: { type: 'string' },
      description: 'All property image URLs (gallery)'
    },
    floor_plan_url: { type: 'string', description: 'Floor plan image URL' },
    epc_rating: { type: 'string', description: 'EPC rating A-G' },
    epc_url: { type: 'string', description: 'EPC certificate image/PDF URL' },
    legal_pack_url: { type: 'string', description: 'Legal pack download URL' },
    guide_price: { type: 'string', description: 'Guide price' },
    tenure: { type: 'string', description: 'Freehold or Leasehold' },
    ground_rent: { type: 'string', description: 'Annual ground rent if leasehold' },
    service_charge: { type: 'string', description: 'Annual service charge if applicable' },
    council_tax_band: { type: 'string', description: 'Council tax band A-H' },
    sqft: { type: 'number', description: 'Square footage or square metres' },
    bedrooms: { type: 'number' },
    bathrooms: { type: 'number' },
    reception_rooms: { type: 'number' },
    special_conditions: { type: 'string', description: 'Deposit %, completion timeline, special notes' },
    property_type: { type: 'string' }
  },
  required: ['address']
};
