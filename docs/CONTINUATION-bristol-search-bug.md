# 🔴 Bug: searching for "Bristol" returns only 2 lots

Continuation prompt for a focused bug-fix session. Reported by Simon 2026-05-01.

---

## Drop-in prompt

> A user search for "Bristol" on auctions.bridgematch.co.uk returns only 2 lots. The DB has at least 65 lots with "Bristol" in the address and 468 with a `BS*` postcode — so the search is dropping ~95% of legitimate matches. Read `docs/CONTINUATION-bristol-search-bug.md` for the diagnostic evidence, then trace the search path end-to-end (frontend filter → API → SQL) to find where the matches are being lost. **Before touching code: invoke the `auction-conventions` skill.**

---

## What's broken

Searching the catalogue UI for "Bristol" returns 2 lots. Expected: dozens.

## Diagnostic evidence (gathered via Supabase MCP 2026-05-01)

```sql
SELECT
  count(*) AS total_lots,                                                      -- 11,405
  count(*) FILTER (WHERE address ILIKE '%bristol%') AS addr_match,             -- 65
  count(*) FILTER (WHERE postcode ILIKE 'BS%') AS bs_postcode,                 -- 468
  count(*) FILTER (WHERE search_text ILIKE '%bristol%') AS search_text_match,  -- 69
  count(*) FILTER (WHERE address ILIKE '%bristol%' AND auction_date >= CURRENT_DATE) AS upcoming, -- 27
  count(*) FILTER (WHERE address ILIKE '%bristol%' AND status = 'available')   AS available,     -- 31
  count(*) FILTER (WHERE search_vector @@ to_tsquery('english', 'bristol'))    AS tsvector_match -- 69
FROM lots;
```

So the data is there. The question is which layer is filtering it down to 2.

## API surface (from `routes/search.js`)

| Endpoint | Notes |
|---|---|
| `POST /api/smart-search` | AI search (Gemini-powered). Body: `{query, soldFilter, location}`. Requires auth. Anonymous → 403. **Confirmed via curl on production.** |
| `GET /api/all-lots` | No `q` param — just returns full lot list with `includePast` filter. Catalogue page **filters client-side** in `script.js`. ETag-cached. |
| `GET /api/lots/:id/comps` | Per-lot comps. Not relevant. |

## Most likely root causes (ranked)

1. **🔴 Frontend ILIKE-equivalent filter is matching too narrowly.** `script.js` likely does something like `lot.address.toLowerCase().includes(query)` — but if it's filtering on `lot.postcode` or `lot.searchableField` and 95%+ of Bristol lots have a `BS*` postcode but no "Bristol" string in the postcode field, the filter misses them. Grep `script.js` for `Bristol`-relevant filter logic — search input handler, `filterLots()`, `applySearch()`, `renderLots()`.

2. **🟡 Search input is mapped to a postcode-prefix or town-name dropdown that has only 2 hits for "Bristol".** Recent CONTINUATION-2026-04-30 mentioned splitting location filter into "Town + Postcode". If "Bristol" is going into the Town filter and the Town list is derived from a stale or incomplete town extraction, it could match only a literal `Bristol` token — and the 65 "Bristol"-containing addresses might be `Bristol BS1 5HX` (full city name) versus `Greater Bristol` etc. that get dropped.

3. **🟡 `/api/all-lots` is silently de-duping or paginating and the cache TTL is hiding fresh data.** ETag + 10-min in-memory cache (line 1493-1500). If the cache was warmed before tonight's bleed-fix or scrape and never invalidated for new Bristol lots, anonymous users get a stale shape.

4. **🟢 (less likely) The 2 returned lots are from a special path** — e.g. AI search returning a Gemini-narrowed set when the user is signed in and on free tier (5/day). Worth checking what the user was logged in as when they saw "2".

## Investigation path (recommended order)

1. **Reproduce on the live frontend.** Open auctions.bridgematch.co.uk in an incognito browser, type "Bristol" in the search field, count the results. Open DevTools Network tab — what endpoint(s) does it hit? Body? Response shape? **This single observation eliminates 2 of the 4 hypotheses.**
2. **Open `script.js`** — grep for `searchInput`, `filterLots`, `applySearch`, the click/keyup handler on the search box. Trace the field(s) it tests against.
3. **Check `index.html`** — line 1316 area has `search-input` references. Is there a separate Town + Postcode split? What dropdowns flank the input?
4. **Run the SQL queries above against your local DB or via MCP** and confirm the numbers haven't moved.
5. **Try the live `/api/smart-search`** with auth and see what AI returns for "Bristol":
   ```bash
   # Needs ADMIN_SECRET to use the auth bypass header, OR a real session token
   curl -X POST "https://auctions.bridgematch.co.uk/api/smart-search" \
     -H "Origin: https://auctions.bridgematch.co.uk" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <SUPABASE_JWT>" \
     -d '{"query":"Bristol"}'
   ```

## Files most likely to need touching

- `script.js` — frontend filter (probably the bug)
- `routes/search.js:356-...` — `/api/smart-search` if AI is over-narrowing
- `routes/search.js:1483-1509` — `/api/all-lots` if cache is stale
- `index.html:1316` — search-input wiring
- `lib/pipeline/persist-lots.js` — only if `search_text` column is being set wrong (column has 69 matches per query 1, so probably fine)

## Verification path

After fixing:
1. Manually reproduce in a fresh incognito browser → "Bristol" should return ≥27 (the upcoming-Bristol count).
2. Add a test to `tests/test-search-filter.js` (create if not present) — synthetic lot data, assert that "Bristol" matches both `address: 'X, Bristol, BS1 5HX'` and (if the heuristic catches it) `address: 'X, Y, BS1 5HX'` via postcode prefix.
3. Once the fix lands, also try **"Manchester"** (similar major city, M-prefix postcodes), **"Liverpool"** (L-prefix), **"Leeds"** (LS-prefix). Reports of those returning low counts would confirm the same class of bug; reports of those working confirm the bug is Bristol-specific (less likely but possible — e.g. a hardcoded town list missing Bristol).

## Hard rules (carry over from auction-self-healing)

- Don't auto-commit a frontend filter rewrite without the §3b unambiguous-fix gate. This is shared code (`script.js` is the only frontend file); behavior change needs eyeballing.
- Add a regression test in the same commit. The auction-self-healing skill explicitly demands this.
- If the fix changes the search semantics (e.g. now matches on postcode prefix), update the placeholder text in `index.html` so users know what they can search for.

## Out of scope for this session

- Fixing the 461 `cross_house_url_leak` findings from tonight's visual audit (separate)
- The per-house extractor & coverage audit (deferred to its own session per `CONTINUATION-2026-05-01.md` item #3)
- Charlesdarrow domain probe + landwood zombie purge (separate)
