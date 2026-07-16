# Pattinson (Pattinson Estate Agents) — house dossier

| Field | Value |
|---|---|
| **Slug** | `pattinson` |
| **Display name** | Pattinson |
| **Platform** | Next.js App Router + **Payload CMS** backend, **server-rendered (SSR/RSC)**, behind **Cloudflare**. NOT an empty SPA shell — the raw HTML carries all 20 lots/page WITH prices. But a datacenter/plain-HTTP fetch gets a **403 Cloudflare "Just a moment" block**, so it still needs a **real-browser render** to pass CF. |
| **Region** | North East (+ national auction lots) |
| **Catalogue URL** | `https://www.pattinson.co.uk/auction/property-search` (`HOUSE_ROOTS`), paginated `?p=N`. |
| **Scale (2026-07-16)** | **1761 live lots**, **20/page**, **89 pages** (last link `?p=89`). Page size is FIXED at 20 — no `pageSize`/`limit`/`perPage`/`size`/`take` param is honoured (all tested, all return 20). |
| **Detection** | `detectAuctionHouse()` routes `pattinson.co.uk` → `pattinson`. |
| **Status** | ⚠️ **PARTIAL — max ~17% recall via current render path.** Recogniser works (20/20 page 1), pagination param `?p=N` is correct, but the Crawlee render path is capped at `MAX_PUPPETEER_PAGES=15` → max 15/89 pages ≈ 300/1761 lots. Circuit reset 2026-07-16 unblocks it but it will ship PARTIAL until the render-paginate build below lands. |
| **Last verified** | 2026-07-16 (live browser: 1761 lots / 89 pages confirmed; `?p=1` vs `?p=2` return 0-overlap distinct lots server-side; plain node fetch = 403 CF). |

## 100% fix — bespoke in-page paginator (TODO, de-risked; discovery done 2026-07-16)
The only CF bypass we have that works is a **real browser render** (Firecrawl-stealth is dead — no credits). Render-paginating 89 pages the normal way is blocked two ways: (a) `MAX_PUPPETEER_PAGES=15` hard cap, (b) 89 sequential CF-solving renders would blow the render deadline + load. **Solution:** render page 1 ONCE (clears Cloudflare → warm session), then run an **in-page `fetch()` loop** inside that browser context (`page.evaluate`, reusing the native `cf_clearance` — proven: in-page `fetch('?p=45')` returns 200/20 lots in the cleared session; the cookie is HttpOnly so it can't be copied to a node fetch, and modern CF binds clearance to the browser TLS/JS fingerprint anyway). **Do NOT concatenate 89 × 1.5MB raw HTML (~130MB OOM risk)** — extract each page's lots in-page (regex `/property/(\d+)` + price + address off the fetched HTML) and return compact JSON. Model the module on `lib/scraper/allsop.js` / `symondsandsampson.js`; add a host-keyed in-page-paginate hook in `crawlee.js` requestHandler parallel to `CLICK_TO_LOAD_SELECTORS`. Early-stop when a page yields 0 lots. Backend is Payload CMS (`/api/media/file/…`, `/api/users/me`) but no public list collection was found (all `/api/{properties,property,lots,…}` → 404); the SSR HTML is the source.

**MEASURED 2026-07-16 — cannot reuse the markdown recogniser by concatenating HTML:** each page is ~1.56MB and stripping `<script>/<style>/<svg>` only removes **16%** (→1.32MB) — the bulk is inline card markup (Bootstrap classes/nested divs), NOT the RSC script. Concatenating 89 stripped pages = **~117MB** = OOM. So the in-page loop MUST extract compact fields per card (id/price/beds/address/image/status/url → ~350KB JSON for 1761 lots) and the pattinson path builds normalised lots directly from that JSON (bypassing the markdown recogniser, like `allsop.js`). The catch: card DOM has no clean per-card container (`first.closest(...)` returns a 1.3MB div; `main`/`section`/`ul` hold 0 card anchors) — so in-page extraction is regex-over-fetched-HTML (port the existing recogniser's field regexes to HTML), not `querySelectorAll` per card. This is why it's a dedicated tested build, not a quick change.

## Lot URL pattern
`https://www.pattinson.co.uk/property/{id}` (numeric id).

## Recall sentinel
`/\/property\/(\d+)/g` (`RECALL_SENTINELS.pattinson`; `HOUSE_RECOGNISERS.pattinson.recallSentinelPattern`).

## Recogniser
`recognisePattinsonLotsFromMarkdown` (`lib/pipeline/firecrawl-extract.js`).
Matches each whole card link `[{content}](…/property/{id})` (the lazy inner stops
at the property-url close, past nested `![img](cdn)` links) and reads fields off the
content lines: price (`£N`), `{n} bed {type}`, the postcode-bearing address line,
first `…/property-images/{id}/…` photo. Covered by `tests/test-crawlee-recognition.js`
Test 4.

## Image source
Card carries a photo gallery `https://www.pattinson.co.uk/cdn-cgi/image/…/pattinson.blob.core.windows.net/paccess/property-images/{id}/….jpg`; the first is the lead, the rest fill via the multi-image sweep.

## Incidents
- **2026-06-10→13:** went dark — circuit open, `zero_lots_no_heal`, health 0, 10
  consecutive failures. Root cause: **template rebuild** of the React SPA. The old
  recogniser split on a literal `parking](…/property/{id})` anchor (it assumed every
  card's link text ended in "parking"); the rebuilt template no longer emits that,
  so the recogniser matched nothing → 0 lots even though the render succeeded (20
  `/property/{id}` links were in the markdown).
- **2026-07-08 (fix):** recogniser rewritten to match the whole card link + read
  fields off content lines (template-robust). Live render: 20/20 page 1 (100%), was
  0. Prod verify = deploy + `POST /api/admin/rescrape {pattinson}` (bypasses the open
  circuit, closes on success) → confirm `recall_diagnostic` ~100%.

## Lesson
A recogniser anchored on incidental card text (a "parking" detail label) is brittle —
anchor on the **lot-detail link** (stable) and read fields off content **lines**, not
fixed positional offsets.
