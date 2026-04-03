# Phase 8: Field Extraction & Validation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-03
**Phase:** 8 — Field Extraction & Validation

---

## Areas Selected for Discussion

User selected: Lot-page enrichment cap, Quality gate threshold, Admin coverage dashboard
(Price range strategy was presented but not selected.)

---

## Lot-Page Enrichment Cap

**Q:** How aggressively should we fetch detail pages for missing beds/tenure?

**Options presented:**
1. Raise to 30/house
2. Raise to 50/house
3. Keep at 10 but smarter targeting

**User response:** "there should be no artificial limits in place preventing us obtaining the data - why is this being suggested?"

**Resolution:** Remove the cap entirely. Enrichment already targets only lots missing the field — that's sufficient cost control. No hard ceiling.

---

## Quality Gate Threshold

**Q:** What should the quality gate do when a lot has missing fields?

**Options:** Omit silently / Show soft indicator / Claude's discretion

**Selected:** Omit the field silently

**Q:** Which fields should be silently omitted when missing?

**Options:** Beds/tenure/propType only / Beds/tenure/propType/sqft/leaseLength / Claude's discretion

**Selected:** Claude's discretion — builder decides based on field type

---

## Admin Coverage Dashboard

**Q:** How to see per-house field coverage?

**Options:** Table in Operations tab / Separate Quality tab

**Selected:** Table in Operations tab

**Q:** What action from coverage table?

**Options:** View only / Trigger re-analyse per house

**Selected:** View only — backfill/re-analyse triggers already exist elsewhere

---

*Discussion complete: 2026-04-03*
