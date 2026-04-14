# Phase 9: Image Pipeline & Frontend Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 09-image-pipeline-frontend-polish
**Areas discussed:** HTTP HEAD validation, wsrv.nl proxy & badge bug, VAL-02 remaining empty gaps, Admin image coverage table

---

## HTTP HEAD Validation

| Option | Description | Selected |
|--------|-------------|----------|
| At scrape time | Validate images during existing scrape/analyse cycle, parallelised | |
| Async background job | Nightly pass HEAD-checks cached images, doesn't slow scrape | ✓ |
| On-demand at quality gate | HEAD-check only lots that pass other quality signals | |

**User's choice:** Async background job

---

| Option | Description | Selected |
|--------|-------------|----------|
| Drop imageUrl silently | Set imageUrl = null, lot shows placeholder | |
| Mark as broken, keep URL | Store broken flag, URL preserved, admin can see count | ✓ |

**User's choice:** Mark as broken, keep URL — URL preserved for admin inspection

---

| Option | Description | Selected |
|--------|-------------|----------|
| All active lots' images | HEAD-check every imageUrl nightly, 24h TTL cache | ✓ |
| Only lots not checked in 7 days | Incremental, lower load | |
| Sample: first 20 per house | Lightweight systemic check only | |

**User's choice:** All active lots' images with 24h TTL caching

---

| Option | Description | Selected |
|--------|-------------|----------|
| Fold into admin image coverage table | Broken count column in IMG-03 table | ✓ |
| Internal only | No admin surfacing | |

**User's choice:** Surface broken count in admin image coverage table

---

## wsrv.nl Proxy & Badge Bug

| Option | Description | Selected |
|--------|-------------|----------|
| Remove &default=1, rely on onerror | wsrv.nl returns 404, onerror fires, proper placeholder shows | ✓ |
| Keep &default=1, detect via onload dimensions | Fragile — depends on wsrv.nl placeholder exact size | |

**User's choice:** Remove `&default=1` from optimImg()

---

| Option | Description | Selected |
|--------|-------------|----------|
| Fix: remove broken slides + update dots | Remove failed carousel img from DOM, update dot indicators | ✓ |
| Fix: hide only, no dot update | Current behaviour, accepts mismatched dots | |
| Out of scope | Don't touch carousel | |

**User's choice:** Full carousel fix — remove broken slides and update dot count

---

## VAL-02: Remaining Empty Gaps

| Area | Selected |
|------|----------|
| Expanded panel fields | ✓ |
| List view layout | ✓ |
| AI analysis output | ✓ |
| Export/share features | ✓ |

**User's choice:** Audit all four areas

---

| Option | Description | Selected |
|--------|-------------|----------|
| Fix only confirmed gap patterns | Code audit, fix specific rendering paths | ✓ |
| Full visual audit first, then fix | Load live site, manual inspection | |

**User's choice:** Code audit approach — fix confirmed patterns in index.html

---

## Admin Image Coverage Table

| Option | Description | Selected |
|--------|-------------|----------|
| Add to existing Phase 8 table | New columns in existing per-house field coverage table | ✓ |
| New separate table | Separate table in Operations tab | |

**User's choice:** Add Images % and Broken count columns to existing table

---

## Claude's Discretion

- Exact nightly schedule timing for HEAD job
- HEAD timeout per request
- Whether to persist HEAD results in a separate table or via `broken_image` column on `lots`
- Parallelism level for nightly job

## Deferred Ideas

- None
