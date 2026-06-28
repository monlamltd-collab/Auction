-- 2026-06-27-retired-houses-dormant-backfill.sql
--
-- One-off backfill: stamp house_skills.dormant=true for every house that is
-- retired in code (RETIRED_HOUSES, lib/houses.js) but still sits in the DB as
-- dormant=false. Retiring a house was historically code-only, so retired houses
-- lingered as dormant=false / circuit_state='closed' / status='healthy',
-- masquerading as live to every monitor: the /api/admin/extraction-liveness
-- `!dormant` gate, the Hermes deterministic detection rules (gate:
-- circuit_state='closed' AND dormant=false), and any "healthy house" count.
--
-- Forward-fix: reconcileRetiredHousesDormant() in lib/houses.js runs this same
-- reconciliation on every boot, so future retirements self-heal — this file is
-- just the immediate one-shot for before the next deploy lands. The slug list
-- mirrors RETIRED_HOUSES at time of writing; the boot reconcile is the
-- canonical, drift-proof mechanism (SQL can't read the JS Set).
--
-- Idempotent: `is distinct from true` matches both false and NULL, and re-runs
-- touch nothing once the rows are dormant.
update house_skills
   set dormant       = true,
       dormant_since = coalesce(dormant_since, now())
 where slug in (
   'groundrentauctions','auctiontrade','romanway','hammerprice','brggibson',
   'brggibsondublin','nationalpropertyauctions','lodgeandthomas','woolleyandwallis',
   'morrismarshall','clarkegammon','taylerandfletcher','hammertime','network',
   'scargillmann','humberts','lextons'
 )
   and dormant is distinct from true;
