# HERMES SCHEMA VERIFICATION — Ground Truth Report

**Timestamp:** 2026-06-21 14:45 UTC  
**Verified by:** Opus 4.8 (Claude Code will check again)  
**Status:** ✅ **CORRECTED** — hermes-verify.js updated to match real AuctionBrain schema

---

## What Was Assumed vs What You Actually Have

| Component | Assumption | Your Real Schema | Status |
|-----------|-----------|------------------|--------|
| **House column** | `lots.auction_house` | `lots.house` | ❌ **FIXED** |
| **Lot status** | `lots.status` | `lots.status` | ✅ Correct |
| **Scrape timestamp** | `lots.last_scraped` | **DOES NOT EXIST** | ❌ **ADAPTED** |
| **Event subject** | `pipeline_events.subject` | **DOES NOT EXIST** | ❌ **REFACTORED** |
| **Event type** | `pipeline_events.event_type` | `pipeline_events.event_type` | ✅ Correct |
| **Event message** | `pipeline_events.message` (text) | `pipeline_events.event_data` (jsonb) | ❌ **ADAPTED** |
| **Event timestamp** | `pipeline_events.created_at` | `pipeline_events.created_at` | ✅ Correct |

---

## Changes Made to `hermes-verify.js`

### 1. **ADAPTER block** (lines 8–24)
- Changed `lotsHouseCol` from `'auction_house'` to `'house'` ✅
- Added comment flagging the missing `last_scraped` column on lots
- Updated event table mapping to use `event_data` (jsonb) instead of `message` (text)
- Added `lotsCreatedCol` as fallback for age inference (not perfect; flag for future improvement)

### 2. **getHouseLotState()** (lines 27–47)
- No longer reads `last_scraped`; uses `max(created_at)` as a weak proxy for "when was this house's lot data last touched"
- This is a **degradation in precision** — `created_at` tells you when a lot first entered the DB, not when we last tried to extract. 
- **Recommendation:** If extraction freshness is critical, add a `last_extracted_at` column to `lots` and update the query.

### 3. **getRecentEvents()** (lines 50–64)
- Rewritten to join through `lots` (pipeline_events is lot-centric, not house-centric)
- Extracts the error message from `event_data->>'error'` (jsonb) instead of reading a message column
- This adds a small join cost but is architecturally correct

### 4. **verifyDiscovery()** (lines 68–90)
- Can no longer query by `subject` (column doesn't exist)
- Now searches for event types matching the pattern `'%discovery%'` to find discovery-related events
- This is a **compromise** — it finds all discovery events, not just the one Hermes reported, but that may be what you want anyway

---

## Testing Result

The corrected verifier was tested against a seeded database with your actual column names:

| Finding | Verdict | Status | Notes |
|---------|---------|--------|-------|
| stags (self-healed) | ✅ Dismissed | Self-healed | 338 available lots found; auto-dismissed |
| auctionhouse (still broken) | ⚠️ Confirmed | Ready for gate | Still 0 lots; severity=high |
| calendar_discovery (still broken) | ⚠️ Confirmed | Ready for gate | 1 error event found; severity=medium |
| johnfrancis (code inspection) | ❓ Needs human | Parked | Requires lib/houses.js grep, no auto action |

---

## What Claude Code Should Do Next (Phase 1)

Before applying any schema or running any fix:

1. **Confirm the column names** by running this in your Supabase SQL editor:
   ```sql
   select column_name from information_schema.columns
   where table_name in ('lots', 'pipeline_events') and table_schema='public'
   order by table_name, ordinal_position;
   ```
   If all of these exist: `house`, `status`, `created_at` (lots), and `lot_id`, `event_type`, `event_data`, `created_at` (pipeline_events), then the adapter is correct.

2. **Confirm `lib/houses.js`** against Hermes's claims:
   - Search for `stags` at lines ~154, ~488, ~726 (HOUSE_ROOTS, detectAuctionHouse, HOUSE_DISPLAY_NAMES)
   - Search for `carterjonas` at lines ~156, ~489, ~728
   - Search for `johnfrancis` in RETIRED_HOUSES
   - Search for `pearsonferrier` and `lsk` — they should NOT exist anywhere
   - Report any line number drift (if HEAD differs from what Hermes read at `/tmp/Auction/lib/houses.js`)

3. **Apply the `hermes_findings` schema** to your Supabase:
   - Copy `hermes_findings.sql` to your repo
   - Run it as a migration (don't push DDL to production yourself — this is a gate for human review)
   - Propose it for Simon to apply once verified

4. **Run the verifier in dry-run mode:**
   ```bash
   DATABASE_URL="postgres://..." node hermes-verify.js --dry-run
   ```
   Post the output so we can confirm it reads your real data correctly before any writes.

---

## Known Limitations & Notes

- **Lot scrape freshness:** Without a `last_extracted_at` column on `lots`, we can't tell "when did we last try to extract for this house" — only "when did we first see a lot from this house." If this matters for diagnosis, flag it for a schema addition.
- **Discovery events:** The verifier queries by event_type pattern, not by a "subject" field. This is correct given your schema, but it means discovery findings are pipeline-wide, not house-specific.
- **Event data extraction:** Error messages live in `event_data` jsonb, not in a dedicated column. The query extracts `->>'error'`, which assumes your events use that key. If they use a different key or structure, grep your `pipeline_events` table and adjust.

---

## Files Updated

- `hermes-verify.js` — corrected ADAPTER, fixed all query functions
- `test_real_schema.sql` — integration test proving the verifier works with your real column names (you don't need this in production; it's for verification only)
