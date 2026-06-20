# ContentBrain — Facebook Token Automation: Design & Handoff

**Created:** 2026-06-02. **For:** a ContentBrain / GrowthBrain session (publishing engine lives there).
**Database:** Supabase `pohrbfhftbprlfzsozyj` (shared with Auction). **The `social_tokens` table is already provisioned** (see below) — this doc is the build spec for the rest.

---

## The problem
Facebook publishing currently relies on an **expiring token stored as a Railway env var**. When it expires, publishing silently dies and the token is manually regenerated in Graph API Explorer and re-pasted. Recurring fire-drill. Goal: make token obtainment + integration a **one-time setup that never rotates**, with automated health monitoring.

## The solution (two layers)

### Layer 1 — Use a Meta **System User token** (never expires)
One-time setup by the human (Simon), in **Meta Business Settings** (`business.facebook.com/settings`):
1. **Users → System Users → Add** → role **Admin**, name `contentbrain-publisher`.
2. **Add Assets:** assign the **Facebook Page** (Full control) **and** the **App** to that system user. (Page + App must be in the **same Business Manager** as the system user.)
3. **Generate New Token** → pick the App → **Token Expiration: `Never`** → scopes:
   - `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `read_insights`, `business_management`.
4. Copy the token once → insert into `social_tokens` (SQL template at the bottom).

**Caveats to verify before relying on it:**
- App must be in **Live mode**; `pages_manage_posts` requires **Advanced Access**. For a first-party Page+App owned by the same Business, a system-user token typically works without full App Review — but confirm the app's current access level, and submit for review if Meta blocks the publish call.

### Layer 2 — Store in DB + health sentinel (already half-built)
- **Token lives in `social_tokens`, not a Railway env var.** Rotating = one DB update, no redeploy.
- **Daily health sentinel** (new ContentBrain cron) validates the token and alerts *before* breakage.
- **Optional zero-touch recovery:** an in-app Facebook Login OAuth button that re-derives and stores a fresh token in one click.

---

## `social_tokens` table — ALREADY CREATED ✅

Migration `create_social_tokens` is applied. Schema:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `brand` | text | `auctionbrain` / `bridgematch` |
| `platform` | text | default `facebook` |
| `page_id` | text | the FB Page ID |
| `token_type` | text | `system_user` / `page` / `long_lived_user` |
| `access_token` | text | the credential |
| `scopes` | text[] | granted scopes |
| `expires_at` | timestamptz | **NULL = never expires** |
| `is_valid` | boolean | set by sentinel |
| `is_active` | boolean | the live credential (unique per brand+platform) |
| `last_checked_at` | timestamptz | sentinel timestamp |
| `last_error` | text | last `/debug_token` failure |
| `meta` | jsonb | app_id, business_id, system_user_id |
| `created_at` / `updated_at` | timestamptz | |

- **RLS:** enabled, **no policies** → only the **service role** (ContentBrain server) and postgres can read/write. anon/auth get nothing. Never expose this table to the client.
- **Unique:** partial index `social_tokens_active_uniq (brand, platform) where is_active` → exactly one live credential per brand+platform.

---

## ContentBrain build tasks

### 1. Publisher reads token from DB
Replace the `FB_PAGE_ACCESS_TOKEN` env-var read with:
```sql
select access_token, page_id from public.social_tokens
where brand = $1 and platform = 'facebook' and is_active and is_valid
limit 1;
```
Publish endpoints (Graph API v19.0+):
- Image post: `POST /{page_id}/photos` (`url` or `source`, `caption`, `access_token`)
- Link/text: `POST /{page_id}/feed`
- Reel: `POST /{page_id}/video_reels` (resumable upload flow)
On success store `fb_post_id` on the `posts` row (already a column).

### 2. Token-health sentinel (daily cron)
For each active token:
```
GET https://graph.facebook.com/debug_token
    ?input_token=<access_token>
    &access_token=<app_id>|<app_secret>
```
From the response update `is_valid`, `expires_at` (from `data.expires_at`; `0` = never), `last_checked_at`, `last_error`.
- If `is_valid=false` **or** `expires_at` within 7 days → fire a Telegram alert (reuse existing Telegram plumbing): `fireAlert`-style message with the brand, the error, and the re-auth link.
- Keep it cheap: one call per active token per day.

### 3. (Optional) One-click re-auth — full zero-touch
- Add a `/auth/facebook` route → FB Login OAuth dialog (scopes as above) → callback exchanges `code` → long-lived user token → `GET /me/accounts` to fetch the page token → upsert into `social_tokens` (flip old `is_active=false`, insert new active). Covers the rare hard-revocation case in ~10 seconds with no Graph API Explorer.

---

## SQL template — drop the token in once generated

```sql
-- run as service role / via Supabase SQL editor
insert into public.social_tokens
  (brand, platform, page_id, token_type, access_token, scopes, expires_at, is_active, meta)
values
  ('auctionbrain', 'facebook', '<PAGE_ID>', 'system_user',
   '<SYSTEM_USER_TOKEN>',
   array['pages_manage_posts','pages_read_engagement','pages_show_list','read_insights','business_management'],
   null,                       -- never expires
   true,
   jsonb_build_object('app_id','<APP_ID>','business_id','<BUSINESS_ID>'))
on conflict do nothing;
```
(Repeat with `brand='bridgematch'` for the bridging page.)

---

## Done-when
- A `system_user` row sits in `social_tokens` with `expires_at = null`.
- Publisher reads from DB; a test post returns an `fb_post_id`.
- Sentinel runs daily and has written `last_checked_at`/`is_valid`.
- No Facebook token remains in any Railway env var.

> Pair this with the daily-posts outage fix (`docs/contentbrain-daily-posts-incident.md`) — a healthy token is necessary for the publish step to resume.
