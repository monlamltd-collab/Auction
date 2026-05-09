// lib/scraper/homepage-schema.js — Firecrawl JSON schema + prompt for the
// daily homepage watcher (lib/pipeline/homepage-watch.js) and the manual
// CLI audit (scripts/audit-houses.mjs). Both ask the same question: "what
// does this auction house's homepage say is the current catalogue URL?"
//
// Field names are aligned with house_homepage_watch column names so the
// persistence step is a near-direct copy.

export const HOMEPAGE_AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    current_catalogue_url: {
      type: 'string',
      description: 'Full URL of the current or next upcoming property auction catalogue page on this site — the page that lists individual lots/properties for sale at auction. Return null if no catalogue is linked from this homepage.',
    },
    next_auction_date: {
      type: 'string',
      description: 'Date of the next auction as displayed (e.g. "19 May 2026", "Wednesday 14th May"). Null if not visible.',
    },
    has_active_inventory: {
      type: 'boolean',
      description: 'Whether the page indicates lots/properties are currently listed for an upcoming or active auction.',
    },
    site_status: {
      type: 'string',
      description: 'One of: "active" (auction house operating with current or upcoming auction), "no_current_auction" (between auctions), "domain_parked" (site dead or unrelated landing page), "not_an_auction_house" (page no longer about property auctions).',
    },
    notes: {
      type: 'string',
      description: 'One short sentence noting anything unusual: "site requires login", "redirected to different domain", "now part of larger group", "captcha wall". Empty string if nothing notable.',
    },
  },
  required: ['current_catalogue_url'],
};

export const HOMEPAGE_AUDIT_PROMPT =
  'Read the page as a property-auction-buyer would. Find the link to the current or upcoming auction catalogue (the page listing individual lots). ' +
  'Return that URL in `current_catalogue_url`. If the homepage clearly says no auction is currently running, return null for that field and set `site_status` to "no_current_auction". ' +
  'If the page is parked, sold, or no longer about property auctions, set `site_status` accordingly and return null. ' +
  'Be conservative: only return a URL if the homepage actually links to it as the current catalogue. Do not guess.';
