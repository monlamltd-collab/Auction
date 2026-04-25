# New Auction House Playbook

Step-by-step checklist for adding a new auction house to Bridgematch. All touchpoints are in `server.js` unless noted.

---

## Prerequisites

Before starting, gather:
1. The house's catalogue URL (the page listing all lots for an upcoming auction)
2. Whether the site is static HTML or JS-rendered (check: does View Source show lot data?)
3. The CSS selectors for lot cards, address, price, image, and detail links
4. Whether the site paginates, and how (URL path `/page-2`, query `?page=2`, infinite scroll)

---

## Step 1: detectAuctionHouse()

**Location:** ~line 2970

Add a new `if` clause **before** the final `return 'unknown'`:

```javascript
if (u.includes('mynewhouse.co.uk')) return 'mynewhouse';
```

- Include all domain variants (old domains, subdomains, merged names)
- Test longer/more specific patterns first
- Slug must be lowercase, no spaces

---

## Step 2: HOUSE_ROOTS

**Location:** ~line 301

Add the root/listing URL where upcoming catalogues are found:

```javascript
mynewhouse: 'https://www.mynewhouse.co.uk/auctions/current',
```

This is used by `/api/discover-catalogues` to auto-detect new auction URLs.

---

## Step 3: HOUSE_DISPLAY_NAMES

**Location:** ~line 3021

Add the human-readable name:

```javascript
mynewhouse: 'My New House Auctions',
```

Used in calendar display, API responses, and frontend rendering.

---

## Step 4: rewriteUrl()

**Location:** ~line 3054

Add a new `if (house === 'mynewhouse')` block:

```javascript
if (house === 'mynewhouse') {
  return { baseUrl: url, isApi: false, paginateAs: null, preferPuppeteer: false };
}
```

**Return object fields:**
| Field | Type | Purpose |
|-------|------|---------|
| `baseUrl` | String | URL to scrape (may differ from user's URL) |
| `isApi` | Boolean | `true` if JSON API endpoint, `false` if HTML |
| `paginateAs` | String\|null | `'savills_pages'`, `'sdl_pages'`, `'allsop_api'`, or `null` |
| `preferPuppeteer` | Boolean | `true` if site needs JS rendering |

**Common patterns:**
- Static HTML, no pagination: `{ baseUrl: url, isApi: false, paginateAs: null }`
- JS-rendered, paginated: `{ baseUrl: url, isApi: false, paginateAs: 'sdl_pages', preferPuppeteer: true }`
- JSON API: `{ baseUrl: apiUrl, isApi: true, paginateAs: 'allsop_api' }`

If the house uses a unique pagination URL pattern, also add a case to **buildPageUrl()** (~line 3407):

```javascript
case 'mynewhouse': return `${clean}/page/${page}`;
```

---

## Step 5: HOUSE_EXTRACTION_HINTS

**Location:** ~line 248

Add a one-line structural description for the Gemini fallback prompt:

```javascript
mynewhouse: 'My New House Auctions. Bootstrap cards in div.property-card with h3.address, span.guide-price, and detail links to /lot/ID.',
```

**Include:** Platform type, CSS selectors for containers/address/price, image CDN, any quirks.

---

## Step 6: DOM_EXTRACTORS (recommended)

**Location:** ~line 3749

Add a template literal IIFE that runs in the Puppeteer page context:

```javascript
mynewhouse: `
  (() => {
    const lots = [];
    const seen = new Set();
    const cards = document.querySelectorAll('div.property-card');
    for (const card of cards) {
      // Address (required)
      const address = card.querySelector('h3.address')?.textContent.trim() || '';
      if (!address) continue;

      // Lot number
      let lotNum = lots.length + 1;
      const lotMatch = card.textContent.match(/Lot\\s+(\\d+)/i);
      if (lotMatch) lotNum = parseInt(lotMatch[1]);
      if (seen.has(lotNum)) continue;
      seen.add(lotNum);

      // Price
      let price = null;
      const priceText = card.querySelector('span.guide-price')?.textContent || '';
      const pm = priceText.match(/\\u00a3([\\d,]+)/);
      if (pm) price = parseInt(pm[1].replace(/,/g, ''));

      // Detail URL
      const url = card.querySelector('a[href]')?.getAttribute('href') || '';

      // Image
      let imageUrl = '';
      const img = card.querySelector('img[src]');
      if (img) {
        const s = img.getAttribute('src') || img.dataset.src || '';
        if (s && !s.includes('logo') && !s.includes('icon') && s.length > 10) imageUrl = s;
      }

      // Bullets (features, tenure, etc.)
      const bullets = [];
      card.querySelectorAll('li').forEach(li => {
        const t = li.textContent.trim();
        if (t.length > 3 && t.length < 200) bullets.push(t);
      });

      // Detect sold/withdrawn
      if (card.textContent.match(/\\bSOLD\\b|\\bSALE.?AGREED\\b|\\bSTC\\b|\\bWithdrawn\\b/i)) {
        if (!bullets.some(b => b.match(/SOLD|STC|WITHDRAWN/i))) bullets.push('SOLD/STC');
      }

      lots.push({ lot: lotNum, address, price, url, bullets, imageUrl: imageUrl || undefined });
    }
    return lots;
  })()
`,
```

**Key patterns to follow:**
- Use `seen` Set to deduplicate by lot number
- Walk up DOM tree if card container isn't directly selectable
- Use `\\u00a3` for the £ symbol in regex (template literal escaping)
- Filter out logo/icon images
- Always check `textContent.trim()` for empty strings
- Push SOLD/STC to bullets array

---

## Step 7: buildLotUrl() (if needed)

**Location:** ~line 6647

Add a case if lot detail URLs need special construction:

```javascript
case 'mynewhouse':
  if (lot.url && lot.url.startsWith('/')) {
    return `https://www.mynewhouse.co.uk${lot.url}`;
  }
  break;
```

Only needed when:
- DOM extractor returns relative URLs (starting with `/`)
- Detail URLs follow a pattern that needs the lot reference/ID
- The house uses a different domain for lot detail pages

---

## Step 8: CACHE_TIERS

**Location:** ~line 187

Add to the appropriate tier:

```javascript
medium: { houses: [..., 'mynewhouse'], ttlHours: 18 },
```

| Tier | TTL | When to use |
|------|-----|-------------|
| high | 12h | High-volume, frequent updates (Savills, Allsop, SDL) |
| medium | 18h | Standard auction houses (start here) |
| low | 24h | Small/specialty auctioneers (default if not listed) |

---

## Step 9: Test snapshot

1. Visit the house's catalogue page in a browser
2. Right-click > Save As > HTML Only > `tests/snapshots/mynewhouse.html`
3. Add an entry to `EXPECTED` in `tests/test-extractors.js`:

```javascript
mynewhouse: {
  minLots: 3,
  samples: [
    { lot: 1, addressContains: 'Some Street', priceMin: 50000 },
    { lot: 2, addressContains: 'Another Road', priceMin: 80000 },
  ]
},
```

4. Run: `npm test`

---

## Step 10: House-specific enrichment (rare)

**Only needed when** the house provides supplementary API data alongside DOM extraction (like Allsop's JSON API with image file IDs).

**Pattern** (see `enrichAllsopLots()` ~line 3303):
1. Parse raw API JSON from pages
2. Build lookup by postcode or reference
3. Match lots using 2-3 strategies (exact postcode > fuzzy address > street number)
4. Enrich with `reference`, `imageUrl`, house-specific IDs
5. Track matches with a `Set` to prevent double-matching
6. Log: `console.log(\`${house} enrichment: matched ${matched}/${lots.length}\`)`

Call immediately after extraction, before generic `enrichLots()`.

---

## Step 11: Verify & audit

```bash
# Run the extractor test
npm test

# Run the audit script against the new house
node scripts/audit.mjs --house mynewhouse

# Test a live analysis (dev mode)
node --watch server.js
# Then POST to http://localhost:3000/api/analyse with the catalogue URL
```

---

## Optional: SKIP_PUPPETEER

**Location:** ~line 2027

Only add if Puppeteer consistently returns 0 lots for this house:

```javascript
const SKIP_PUPPETEER = ['philliparnold', 'knightfrank', 'mynewhouse'];
```

---

## Quick reference: All touchpoints

| # | What | Location | Required? |
|---|------|----------|-----------|
| 1 | `detectAuctionHouse()` | ~line 2970 | Yes |
| 2 | `HOUSE_ROOTS` | ~line 301 | Yes |
| 3 | `HOUSE_DISPLAY_NAMES` | ~line 3021 | Yes |
| 4 | `rewriteUrl()` | ~line 3054 | Yes |
| 5 | `HOUSE_EXTRACTION_HINTS` | ~line 248 | Recommended |
| 6 | `DOM_EXTRACTORS` | ~line 3749 | Recommended |
| 7 | `buildLotUrl()` | ~line 6647 | If relative URLs |
| 8 | `CACHE_TIERS` | ~line 187 | Optional |
| 9 | Test snapshot + EXPECTED | `tests/` | Recommended |
| 10 | House-specific enrichment | After extraction | Rare |
| 11 | `buildPageUrl()` | ~line 3407 | If custom pagination |
| 12 | `SKIP_PUPPETEER` | ~line 2027 | If Puppeteer fails |

---

## EIG platform houses (shortcut)

Many houses use the EIG (Essential Information Group) auction platform. These share common patterns:

- **Selectors:** `div.lot-panel`, `h4.grid-address` or `[data-address-searchable]`, `div.grid-guideprice b`
- **Images:** EIG CDN URLs
- **Lot links:** `/lot/details/{id}`
- **Existing EIG houses:** `paulfosh`, `cottons`, `landwood`, `firstforauctions`, `harmanhealy`, `seelauctions`, `tcpa`

When adding a new EIG house, copy an existing EIG extractor and adjust the selectors for any layout differences.
