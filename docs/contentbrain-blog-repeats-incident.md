# ContentBrain — Repeating Blog Drafts: Diagnosis & Fix Spec

**Created:** 2026-06-10 (~23:50 UTC) from an Auction-repo session with shared Supabase access.
**For:** a **ContentBrain / GrowthBrain** session (the blog generation + Telegram approval flow lives there).
**Database:** Supabase `pohrbfhftbprlfzsozyj` — shared, so all evidence below reproduces from either session.

> Diagnosis + prescribed fix only. The Auction repo cannot fix this — the blog draft queue,
> rejection handling, and generator code are all ContentBrain-side. The *evidence* is in the
> shared DB and is conclusive.

---

## ⚠️ UPDATE 2026-06-10 (later) — root cause found: BRAND→PROJECT MISROUTING

The first pass (below) looked only at the **`pohrbfhftbprlfzsozyj` ("Auction.Bridgematch")**
project and wrongly concluded the drafts were ContentBrain-local. They are **not** — they were
in the **second** Supabase project the account owns:

- **`pohrbfhftbprlfzsozyj` ("Auction.Bridgematch")** — AuctionBrain's *published* blog (28 rows,
  live site). **Zero drafts.**
- **`omlsxojblgigenfuirbs` ("Bridgematch")** — Bridgematch blog flowing normally
  (33 published, 16 rejected) **+ 10 orphaned `brand='auctionbrain'` drafts**, created
  **2026-05-21 → 2026-06-01, never updated since.**

Those 10 = the exact drafts re-announced to Telegram and the ones the user "deletes" but
that reappear. Decisive evidence:

- **Stale, not regenerating** — newest June 1; nothing new in 9 days. They aren't being
  *re-created*; they're **never removed**.
- **Never published/rejected** — in the *same table*, Bridgematch rows transition fine
  (draft→published/rejected). Only the `auctionbrain` rows are frozen as `draft`. ⇒ the
  AuctionBrain approve/reject/**delete** actions **don't operate on this project**, so the
  dashboard delete hits the wrong DB and these orphans persist, getting re-announced on every
  "ContentBrain started" boot.

**Root cause:** ContentBrain's AuctionBrain blog **generator writes drafts to the Bridgematch
project (`omlsxojblgigenfuirbs`)**, while its AuctionBrain **dashboard/approval/delete reads &
writes the Auction project (`pohrbfhftbprlfzsozyj`)**. Split-brain across two Supabase projects.
The brand→project (or SUPABASE_URL) mapping is crossed for the auctionbrain blog path.

**Immediate action taken (this session):** the 10 orphaned `auctionbrain` drafts in
`omlsxojblgigenfuirbs.blog_posts` were set `status='rejected'` (reversible; `revision_feedback`
stamped). Dashboard draft count for auctionbrain is now **0**. If they reappear as *new* draft
rows, the generator is actively re-seeding and the routing fix (below) is mandatory; if they
stay gone, they were pure orphans.

**Durable fix (ContentBrain-side):**
1. **Fix the routing** so the AuctionBrain blog generator writes to the **same** project the
   AuctionBrain dashboard reads/writes (`pohrbfhftbprlfzsozyj`). Audit the `SUPABASE_URL` /
   per-brand client selection in the blog generator vs the dashboard — they disagree for
   `brand='auctionbrain'`.
2. Make **delete** a hard delete (or terminal `status`) **in the project the rows actually live
   in**, and have the boot announcer read drafts from that same project — so a delete sticks.
3. Everything in the "Fix spec" below (persist rejections, dedup gate, mark seeds consumed,
   refresh inputs, cluster rotation) still applies once routing is single-project.

**Security note (surfaced by Supabase advisor):** in `omlsxojblgigenfuirbs`, **RLS is disabled**
on `blog_posts`, `scraped_articles`, `content_sources` — these are fully readable/writable by
anyone holding the anon key. The other project locks `social_tokens` down correctly; this one
does not. Recommend enabling RLS with a service-role-only policy (don't enable without policies
or it blocks all access). Not auto-applied.

---

## Symptom (user-reported, Telegram, 2026-06-10 23:28 & 23:45)

- The **same 10 "AuctionBrain Blog Draft" suggestions** are announced day after day.
- User **rejects them; they come back** on the next "ContentBrain started" boot.
- Two boots 17 minutes apart (23:28, 23:45) re-announced the identical 10 drafts with
  **identical scores** — i.e. a stored queue being re-broadcast, not fresh generation.
- "Drafts: 67 → 70" between boots = the 3 social drafts created at 23:33 (stat/hook/list).
  The counter is `public.posts` drafts; the 10 blog drafts are **not in that count**.

## The five-link failure chain

1. **Blog drafts + rejections are NOT persisted to the shared DB.**
   `blog_posts` contains **28 rows, all `status='published'`** — zero drafts, zero rejected.
   None of the 10 repeating titles exist anywhere in Supabase (`blog_posts`, `posts`,
   `content_briefs`, `content_seeds`). ⇒ the draft queue and the user's rejections live in
   **ContentBrain-local storage** (file/SQLite/memory). A restart or regen resurrects them.
   The schema already supports the fix: `blog_posts.status`, `revision_feedback`,
   `evaluation_score`, `cluster`, `post_type` are all sitting there unused for drafts.

2. **Generator inputs are never consumed.**
   `content_seeds`: 42 rows, `used_for_social=19`, **`used_for_blog=0`**. The blog
   generator has never marked a seed as used. Same input pool every run → same ideas.

3. **Source material is stale.**
   `scraped_articles`: 112 rows, newest **2026-05-19** (3 weeks old at time of writing).
   `content_briefs`: 8 rows, newest 2026-05-06. The article-scraping cron is dead.
   The recycled angles betray it: "BoE holds at 3.75%", "April 2026 analysis",
   "£5.9bn in 2025" — all May-or-older news being re-chewed.

4. **No dedup against published history.**
   The suggestions are near-clones of already-published posts:

   | Repeating suggestion (Jun 10) | Already published |
   |---|---|
   | "How to Buy Property at Auction UK: The Complete Guide for First-Time Bidders" | May 2 **and** May 6 (two variants) |
   | "How to Buy Property at Auction UK 2026: … Bridging Finance and 28-Day Completions" | May 19 "…Fast Finance… 28-Day Completion Reality" |
   | "UK Property Auctions Hit Buyer's Market Territory as Rate Holds…" | May 3, May 4 **and** May 11 (three rate-hold posts) |
   | "Bridging Loans for Auction Purchases UK: Complete Guide…" | May 15 **and** May 18 |
   | "Bridging Finance Market Growth Creates New Auction Purchase Opportunities" | May 17 "Bridging Market Shifts Create Acquisition Opportunities…" |

   The generator clearly never checks `blog_posts` (or checks exact title match only).

5. **Boot re-announcement.** Every "ContentBrain started" re-broadcasts the whole local
   queue to Telegram. Combined with (1), rejected drafts reappear forever.

Also note: last published blog = **May 21**. Blog publishing has been stalled ~3 weeks
while the queue churns.

---

## Fix spec (ContentBrain-side)

### A. Persist the queue in `blog_posts` — one source of truth (the core fix)
- On generation: insert candidate as `status='draft'` (use existing
  `evaluation_score`, `cluster`, `post_type` columns).
- On Telegram reject: `status='rejected'` (+ optional `revision_feedback` from the user).
- On approve/publish: `status='published'` (current behaviour, unchanged).
- Boot announcer reads **drafts from the DB**, never from a local file. Rejections then
  survive restarts by construction. Kill the local queue after migration.

### B. Dedup gate before a draft is announced
Reject a candidate if it is too similar to **any** `blog_posts` row of **any status**
(published, rejected, draft) — rejected history is the user's taste signal; honour it.
- Cheap + effective: Postgres `pg_trgm` similarity on title (+ summary), threshold ~0.5;
  or embedding cosine if preferred. Exact-match is provably insufficient (see table above).
- Also dedup within the candidate batch itself.

### C. Mark inputs consumed
- Set `content_seeds.used_for_blog = true` when a seed feeds a draft.
- Set `scraped_articles.used_in_post` when an article feeds a draft.

### D. Refresh the inputs (the *variety* half of the problem)
- Revive the article-scraping cron (`scraped_articles` dead since May 19;
  `content_sources` since May 2). Add sources while at it.
- Freshness guard: news-driven post types must not use articles older than ~14 days.
- **Mine the shared DB for novel material** — this is the untapped well:
  `lots` (live catalogue data), `auction_calendar`, `postcode_sales`/`postcode_rentals`,
  `hmlr_ppd`/`hmlr_hpi`, `curator_picks`. Regional spotlights, lot-of-the-week analyses,
  real price-trend pieces — content no competitor can copy and no scraper feeds.

### E. Enforce cluster rotation
`blog_posts.cluster` exists (`buying-at-auction`, `bridging-finance`, `market-data`) but
recent output collapsed into the same two clusters. Add a quota (e.g. no cluster twice in
any rolling 5 drafts) and new clusters: `regional-spotlight`, `case-study`, `data-deep-dive`,
`lot-analysis`.

### F. Purge the current queue (immediate relief)
1. Bulk-reject the 10 queued drafts, **writing each as `status='rejected'` to `blog_posts`**
   so the dedup gate (B) blocks them and their clones permanently.
2. Delete/empty the local queue file.
3. Regenerate against refreshed inputs with the gate live.

---

## Done-when
- [ ] `blog_posts` contains `draft`/`rejected` rows; a rejected title never reappears (test: reject, restart, confirm absent).
- [ ] `content_seeds.used_for_blog > 0` and climbing with each generation run.
- [ ] `scraped_articles.max(scraped_at)` is < 48h old on any given day.
- [ ] 10 consecutive new drafts contain no pair (and no match vs history) above the similarity threshold, and span ≥ 3 clusters.

## Reproduce the evidence

```sql
-- 1. No drafts/rejections in the DB (only published)
select status, count(*) from public.blog_posts group by status;

-- 2. Blog never consumes seeds
select count(*) total, count(*) filter (where used_for_blog) used_blog,
       count(*) filter (where used_for_social) used_social from public.content_seeds;

-- 3. Stale articles
select count(*), max(scraped_at) from public.scraped_articles;

-- 4. Published near-dupes of the repeating suggestions
select title, published_at::date from public.blog_posts
where title ilike '%first-time%' or title ilike '%rate hold%' or title ilike '%bridging%'
order by published_at desc;
```

---

## Topic-rotation ledger (explicit user priority, 2026-06-10)

**Requirement (Simon):** keep a durable record of every blog posted, and use it to rotate
topics and avoid repeating ourselves.

**Status — the record exists and is intact; nothing reads it. That is the whole bug.**

| Ledger (per brand → correct project) | Published | Range | Clusters used |
|---|---|---|---|
| auctionbrain → `pohrbfhftbprlfzsozyj` | 28 | 2026-03-25 → **2026-05-21** | **3** |
| bridgematch → `omlsxojblgigenfuirbs` | 33 | 2026-03-25 → 2026-06-07 | 10 |

- The canonical rotation ledger **is `blog_posts` (status='published')** — plus `rejected`
  rows as a negative-signal. `cluster` is the rotation key and already populated.
- **Brand-split:** auctionbrain history lives in the Auction project, bridgematch in the
  Bridgematch project. The generator's dedup/rotation query **must hit the brand-correct
  project** (same misrouting root cause as the drafts). Do not assume one DB.
- **auctionbrain is the problem child:** only 3 clusters ever, and stalled since 2026-05-21.
  Narrow topics + stalled queue = the recycled "first-time guide / rate-hold / bridging"
  angles. bridgematch (10 clusters, current) shows the healthy pattern to match.

**Generator must, before emitting any draft:**
1. Load published (and rejected) titles/summaries/clusters for that brand from the
   brand-correct project.
2. Reject candidates above a similarity threshold vs that history (see §B).
3. Enforce a cluster-rotation quota (see §E) — no cluster more than once per rolling N drafts;
   add `regional-spotlight` / `case-study` / `data-deep-dive` / `lot-analysis` to widen the pool.
4. Prefer net-new clusters when the recent history is concentrated (auctionbrain's 3-cluster rut).
