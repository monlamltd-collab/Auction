# ContentBrain — Daily Posts Outage: Handoff / Fault Report

**Created:** 2026-06-02 (~23:05 UTC) from an Auction-repo session with shared Supabase access.
**For:** a **ContentBrain / GrowthBrain** session (the generation + publishing engine lives there; the Auction repo only *reads* `posts` for analytics).
**Database:** Supabase project `pohrbfhftbprlfzsozyj` ("Auction.Bridgematch") — **shared** between Auction and ContentBrain, so these findings reproduce from either session.

> Diagnosis only. The Auction repo cannot fix this — `routes/admin.js` merely reads `posts` for pattern analytics; nothing here generates or publishes. Fix in ContentBrain.

---

## TL;DR — two independent faults

1. **Generation cron is dead.** Last post created **2026-05-31 07:00:36 UTC**. Nothing on Jun 1 or Jun 2. The daily job clearly fires ~07:00 each morning and has not run for ~2.5 days. Upstream `content_seeds` also stops at **2026-05-30 23:21**.
2. **Publishing is gated on an approval step that stopped firing.** **332 of 392 posts are stuck in `draft`** — *none* approved, *none* published, but **316 have a `scheduled_for` timestamp set**. Last approval **2026-05-27 18:46**; last publish **2026-05-30 10:00**. So even while generation ran, drafts piled up unapproved.

**Net effect to the audience:** only ~58 posts ever published (lifetime); effectively nothing has reached Facebook since ~May 30, and nothing new has been generated since May 31.

---

## Hard data (as of 2026-06-02 22:59 UTC)

**Status distribution (`public.posts`, 392 rows total):**

| status | count | has approved_at | has published_at | has scheduled_for | oldest created | newest created |
|---|---|---|---|---|---|---|
| `draft` | **332** | 0 | 0 | **316** | 2026-04-18 | 2026-05-31 07:00 |
| `published` | 58 | 57 | 58 | 58 | 2026-04-06 | 2026-05-26 |
| `rejected` | 2 | 0 | 0 | 2 | 2026-04-06 | 2026-04-06 |

**Key timestamps:**
- `max(created_at)` = **2026-05-31 07:00:36** (generation stopped)
- `max(published_at)` = **2026-05-30 10:00:05** (publishing stopped)
- `max(approved_at)` = **2026-05-27 18:46:26** (approvals stopped)

**Upstream content tables:**
| table | last row | rows last 7d | total |
|---|---|---|---|
| `content_seeds` | 2026-05-30 23:21 | 3 | 36 |
| `content_briefs` | 2026-05-06 20:41 | 0 | 8 |
| `content_sources` | 2026-05-02 22:36 | 0 | 20 |
| `posts` | 2026-05-31 07:00 | 39 | 392 |

---

## Timeline reconstruction

- **≤ May 26:** posts created *and* some approved → published (58 published over the project lifetime).
- **May 27 18:46:** last approval recorded (`approved_at`).
- **May 30 10:00:** last actual publish (`published_at`) — a previously-approved post going out.
- **May 30 23:21:** last `content_seeds` row.
- **May 31 07:00:** last post generated (`created_at`). Daily generation cron has not fired since.
- **Jun 1–2:** silence — no seeds, no posts, no approvals, no publishes.

---

## Data-model facts the fix should respect

- The lifecycle is **`draft → (approval) → published`**. Approval sets `approved_at` *and* drives publishing (published rows have both `approved_at` and `published_at`). There is **no intermediate `approved` status** in use.
- New posts are created as `draft` with `scheduled_for` already populated (316/332 drafts have it) — i.e. generation pre-schedules; an **approval gate** is what releases them.
- `posts.brand` is mostly `auctionbrain` (some `bridgematch`); `posts.platform` mostly `facebook` (some `null`). Columns of interest: `status`, `template_type`, `track`, `channel`, `scheduled_for`, `approved_at`, `published_at`, `fb_post_id`, `meta` (jsonb: `hook_pattern`, `cta_pattern`).

---

## Investigation checklist for ContentBrain

**Fault 1 — generation cron (priority):**
- [ ] Find the daily ~07:00 UTC job that inserts into `posts` (and the seed job ~23:00 that writes `content_seeds`). Confirm the scheduler/worker process is alive and the cron is registered.
- [ ] Check the worker host/deploy: did a deploy on/around May 30–31 break the schedule, crash the worker, or change `ROLE`/cron wiring? Look for unhandled exceptions at the 07:00 run on Jun 1/2.
- [ ] Check any provider quota/credit caps (Gemini/Firecrawl/image render) that would make the job throw and exit before inserting.

**Fault 2 — approval/publish gate:**
- [ ] Identify the approval mechanism. Strong signal it's **Telegram-driven**: `app_config` has `dashboard.send_telegram_receipt=true` and many rows `updated_by='telegram'`. Confirm whether approval is **human-via-Telegram** or an **auto-approver**.
  - If **human approval**: approvals stopping May 27 may be a *process* gap (nobody actioned them) rather than a bug — but verify the Telegram approval prompts are still being *sent*. If prompts stopped, that's the bug.
  - If **auto-approver**: it stopped on/around May 27 — treat as a code/cron fault like Fault 1.
- [ ] Decide what to do with the **332-draft backlog**: bulk-approve a sensible recent subset, or discard stale ones (some drafts date back to Apr 18). `app_config.dashboard.bulk_approve_cap=10` exists — there may already be a bulk-approve path.

---

## NOT the cause (don't chase these)

- **`template_weights.reel=0`** in `app_config` (updated 2026-05-29, `updated_by='claude-config (mentor: image-only)'`) is **intentional** — the FB page is image-only by design. It only zeroes the *reel* template weight; `hook/stat/list` remain at 1. It does not stop generation or publishing.
- The Auction repo is not involved beyond read-only analytics.

---

## Reproduce these queries

```sql
-- status + approval/publish signals
select status, count(*) n,
       count(*) filter (where approved_at is not null) approved,
       count(*) filter (where published_at is not null) published,
       count(*) filter (where scheduled_for is not null) scheduled
from public.posts group by status order by n desc;

-- key timestamps
select max(created_at) last_created, max(published_at) last_published,
       max(approved_at) last_approved from public.posts;

-- daily generation/publish timeline
select date_trunc('day', created_at)::date day, count(*) created,
       count(*) filter (where published_at is not null) published
from public.posts where created_at > now()-interval '30 days'
group by 1 order by 1 desc;
```

---

## Once fixed
Resume the strategy build in `docs/contentbrain-tiktok-plan.md` (dual-format superlatives, TikTok drafts, educational + investment-thesis content). That work assumes a healthy generation+publish loop, so this incident is the blocker to clear first.
