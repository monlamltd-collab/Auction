---
name: coverage-check
description: "Audit lot coverage for one auction house or the whole fleet against the 100%-coverage standing rule. Usage: /coverage-check [slug]. Use when asked 'is house X showing all its lots?', 'how is coverage?', 'audit recall', or before/after shipping a scraper change. Compares DB lot counts against the source site's visible lot count and reports field coverage (images, price, address, UPRN)."
---

# Coverage Check

Standing rule: **every house must show 100% of its available lots, with real
images where the source has them.** 20/27 is a failure, not a partial
success. This skill measures where each house actually stands.

## Arguments

`/coverage-check [slug]` — with a slug, audit one house deeply; without,
produce a fleet-wide summary and flag the worst offenders.

## Workflow

### 1. DB-side counts

Use the Supabase MCP (`execute_sql`) or `.env` credentials. Key queries:

```sql
-- Active lots per house (fleet view)
SELECT house, count(*) AS lots,
       count(*) FILTER (WHERE image_url IS NOT NULL) AS with_image,
       count(*) FILTER (WHERE price IS NOT NULL) AS with_price
FROM lots
WHERE status NOT IN ('sold', 'withdrawn')
GROUP BY house ORDER BY lots DESC;

-- Recent scrape health for a house
SELECT * FROM scrape_health_daily
WHERE house = '<slug>' ORDER BY day DESC LIMIT 7;
```

Also check `house_skills` for engine locks and `pipeline_alerts` for
unresolved rows on the house.

### 2. Source-side truth

The DB count means nothing without the denominator. Establish how many lots
the house *actually* lists right now:

- Render the catalogue URL (`HOUSE_ROOTS[slug]` in `lib/houses.js`) with the
  local Crawlee path or Puppeteer and count lots in the output. Watch for
  pagination and "Show: All" toggles — several houses (SDL) hide most lots
  behind a click; a naive count is itself a recall bug.
- Cross-check with the recall sentinel: run the house's
  `RECALL_SENTINELS[slug]` / platform sentinel regex against the rendered
  markdown and count distinct matches.

### 3. Field coverage

```bash
node scripts/coverage-report.mjs --house <slug>     # or omit --house for fleet
node scripts/coverage-report.mjs --recent           # only lots seen in last 7d
```

Requires `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (in `.env`).

### 4. Verdict

Report per house: **"N of M available lots (X%)"**, plus image/price/address
coverage, and classify:

- **100%** — healthy, note the verified date.
- **Partial** — a recall gap. Per the standing rule this must be fixed in the
  same session or explicitly handed off — never left silently partial.
  Diagnose with the `auction-self-healing` skill (`/heal <slug>`).
- **Zero** — dead or circuit-broken. Verify against the live site before
  retiring anything (the dead-house prober has false-negatived on anti-bot
  houses before). Then `/heal <slug>`.

### 5. Record

If the audit changed your understanding of a house (new quirk, new
denominator source, pagination trap), update `docs/houses/<slug>.md`.
