# Coding Conventions

## Language & Runtime

- **Language:** JavaScript (ES2022+)
- **Runtime:** Node.js >= 18
- **Module system:** ES Modules (`"type": "module"` in `package.json`)
- All imports use `import` syntax, never `require()`

## Code Style

### Indentation & Formatting

- **Indentation:** 2 spaces throughout all JS, HTML, JSON, and config files
- **Semicolons:** Always used at statement ends
- **Quotes:** Single quotes (`'`) for JavaScript strings. Double quotes for HTML attributes and JSON
- **Trailing commas:** Used in multi-line object/array literals (e.g., dependency lists in `server.js`)
- **Line length:** No enforced limit. Lines regularly exceed 120 characters, especially in URL strings, CSS-in-JS, and regex patterns
- **Braces:** K&R style (opening brace on same line). One-liners sometimes omit braces for `if` statements:
  ```js
  if (!url) return res.status(400).json({ error: 'Missing url' });
  ```

### No Linter or Formatter Config

There is **no ESLint, Prettier, or EditorConfig** at the project root. The only lint/format configs in the repo belong to `node_modules/`. Code style is maintained by convention, not tooling.

## Naming Conventions

### Variables & Functions

- **Variables:** camelCase for all local and module-level variables (`fcCreditsUsed`, `geminiLastCall`, `lotsMissingImg`)
- **Constants:** UPPER_SNAKE_CASE for configuration constants (`MAX_PAGES`, `RATE_LIMIT`, `CACHE_DAYS`, `MODEL_PRO`, `FIRECRAWL_MONTHLY_BUDGET`)
- **Functions:** camelCase (`detectAuctionHouse`, `scrapeWithFirecrawl`, `extractWithJSDOM`, `analyseLot`, `getCacheTTL`)
- **Boolean variables:** Often prefixed with `is`/`has` or use descriptive names (`fcCreditExhausted`, `fcTemporarilyDown`, `catalogueChanged`, `AUTH_ENABLED`)
- **Private/internal state:** Prefixed with underscore (`_fcLastCall`, `_lastExtractorUsed`, `_lastScrapeEngine`, `_lastContentHash`)

### Files

- **Server entry:** `server.js` (monolithic, ~9,749 lines)
- **API route files (legacy Vercel):** lowercase, kebab-style directory with camelCase filenames (`api/analyse.js`, `api/auctions.js`)
- **Scripts:** lowercase with hyphens, `.mjs` extension for standalone scripts (`scripts/audit.mjs`, `scripts/audit-fix.mjs`, `scripts/pre-launch-qa.mjs`, `scripts/test-btg-extractor.mjs`, `scripts/test-new-houses.mjs`)
- **Test files:** `tests/test-extractors.js` (matches `package.json` `"type": "module"` so `.js` works)
- **SQL schemas:** snake_case with descriptive names (`schema.sql`, `leads_schema.sql`, `auction_calendar_schema.sql`, `smart_search_cache_schema.sql`)
- **HTML pages:** lowercase, no hyphens for single-word names (`index.html`, `admin.html`, `welcome.html`, `privacy.html`, `terms.html`). Hyphenated for compound names (`bridgematch-lite.html`)

## Import Style

All files use ESM `import` statements. Imports are organized in a specific order in `server.js`:

1. Error tracking (Sentry) -- must be first
2. Framework imports (`express`)
3. Node.js built-ins (`url`, `path`, `crypto`, `fs`, `dns/promises`)
4. Third-party libraries (`@google/generative-ai`, `@supabase/supabase-js`, `jose`, `jsdom`, `stripe`)
5. Conditional/optional imports wrapped in try/catch:
   ```js
   let puppeteer = null;
   try { puppeteer = (await import('puppeteer')).default; } catch {}
   ```

Scripts use the same pattern. The `__dirname` polyfill is standard across all files:
```js
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
```

## Common Patterns

### Async/Await

- `async/await` is used universally. No callbacks, no raw `.then()` chains
- Top-level await is used for conditional imports (`await import('puppeteer')`)
- Standalone scripts use an async IIFE or `async function main()` with `.catch()`:
  ```js
  main().catch(err => { console.error('QA script error:', err); process.exit(1); });
  ```

### Error Handling

- **Try/catch wrapping:** Every Express route handler and async function wraps its body in `try/catch`
- **Empty catch blocks:** Used intentionally for non-critical operations (e.g., `try { ... } catch {}` for optional Puppeteer import, optional Supabase reads)
- **Route-level error pattern:** Catch-all returns a JSON error response with generic message (never leaks internals to the client):
  ```js
  } catch (e) {
    log.error('Analytics endpoint error', { error: e.message });
    res.status(500).json({ error: 'Internal server error' });
  }
  ```
- **Graceful degradation:** Failed optional operations (image backfill, analytics snapshots, activity logging) log a warning and continue rather than throwing
- **Rate limit / credit exhaustion:** Uses flag-based circuit breakers (`fcCreditExhausted`, `fcTemporarilyDown`) that auto-clear after timeout periods

### Express Route Patterns

- Routes use `app.get()` / `app.post()` with inline async handlers
- Auth checks are done at the top of each admin route using `safeCompare()` for timing-safe token comparison
- CORS is handled via manual middleware (not the `cors` package)
- CSRF protection via origin header validation middleware
- Request body validation returns early with `400` status codes
- Admin routes are protected by `x-admin-secret` header

### Data Flow Pattern

The core analysis pipeline follows a consistent numbered-step pattern documented in comments:
```js
// Step 1: Detect auction house
// Step 2: Scrape all pages
// Step 3: Extract lot data (DOM extractor -> Gemini fallback)
// Step 4: Score lots
// Step 5: Budget filter
```

### Rate Limiting

A reusable rate-limiter pattern is used for both Gemini and Firecrawl APIs:
```js
let lastCall = 0;
async function rateLimited(fn) {
  const now = Date.now();
  const earliest = lastCall + GAP_MS;
  const wait = Math.max(0, earliest - now);
  lastCall = now + wait;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  return fn();
}
```

### DOM Extractors

DOM extractors are stored as string source code in the `DOM_EXTRACTORS` object and evaluated at runtime using `new Function('document', ...)`. Each extractor is an IIFE string that runs in a JSDOM or Puppeteer context:
```js
const DOM_EXTRACTORS = {
  savills: `(() => { const lots = []; ... return lots; })()`,
  allsop: `(() => { ... })()`,
};
```

## Comment Style

### Section Headers

Major sections use a prominent double-line box style:
```js
// ═══════════════════════════════════════════════════════════════
// SECTION NAME
// ═══════════════════════════════════════════════════════════════
```

### Sub-section Headers

Minor sections use a single-line dash style:
```js
// ── Sub-section name ──
```

### Inline Comments

- Used frequently for explaining "why" rather than "what"
- Placed on the same line for short notes, above the line for longer explanations
- Technical debt and gotchas are called out explicitly (e.g., `// TODO`, `// HACK`, `// IMPORTANT`)

### JSDoc

Minimal JSDoc usage. Scripts have descriptive header blocks with usage examples:
```js
/**
 * DOM Extractor Test Suite
 * ========================
 * Tests auction house DOM extractors against saved HTML snapshots.
 * Run: node tests/test-extractors.js
 */
```

## Environment Variables

- Validated at startup with two tiers: `REQUIRED_ENV` (fatal if missing) and `RECOMMENDED_ENV` (warning if missing)
- Accessed via `process.env.KEY` with `|| ''` or `|| defaultValue` fallback
- Integer env vars parsed with `parseInt()` and default values
- Documented in `.env.example` at `C:\Users\User\Documents\GitHub\Auction\.env.example`

## Security Patterns

- Timing-safe string comparison (`timingSafeEqual`) for auth tokens
- HTML escaping helper (`escHtml`) for user input rendered in HTML
- Content Security Policy headers set via middleware
- JWT verification with JWKS (ES256) primary, HS256 fallback
- Stripe webhook signature verification with raw body parser

## Structured Logging

A custom structured logging function outputs JSON lines:
```js
function log(level, message, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, msg: message, ...meta };
  console.log(JSON.stringify(entry));
}
```

Mixed with plain `console.log()` for operational messages (e.g., `AUTO: savills: 45 lots found`). The structured logger is used for request logging and errors; plain console for scraping progress.

## Monolithic Architecture

The entire backend lives in a single `server.js` file (~9,749 lines). The `api/` directory contains legacy Vercel serverless handlers from before the Railway migration -- these are vestigial and not used in the current Express server.
