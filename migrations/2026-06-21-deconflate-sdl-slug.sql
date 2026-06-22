-- Migration: de-conflate the `sdl` slug into clean per-house slugs.
-- Date: 2026-06-21. Part of the SDL de-conflation programme (Plan 2).
--
-- RUN ORDER: apply this AFTER the re-slug code is deployed (the deployed app
-- expects house='btgeddisons'; the charlesdarrow + sdlauctions houses are
-- registered by Plans 3/4 in the same deploy). Running it before deploy would
-- briefly mislabel BTG lots. Idempotent / safe to re-run.
--
-- Effect (verified pre-migration counts 2026-06-21):
--   sdl→btgeddisons.com  595 (480 active)  -> rename to btgeddisons
--   sdl→charlesdarrow    176 (170 zombies) -> re-key to charlesdarrow + retire stale
--   sdl→sdlauctions.co.uk 64 (17 fabricated)-> PURGE (Gemini hallucinations)
--   network              191 (0 active)    -> fold into btgeddisons
--   scargillmann          0                -> retired in code; no rows

-- 1. Charles Darrow: re-key live rows by domain, then retire the stale zombies.
--    (Plan 3 re-scrapes fresh CD lots under house='charlesdarrow' afterwards.)
UPDATE lots SET house = 'charlesdarrow'
 WHERE house = 'sdl' AND url ILIKE '%charlesdarrow%';

UPDATE lots SET status = 'withdrawn'
 WHERE house = 'charlesdarrow'
   AND status IN ('available','unsold')
   AND last_seen_at < now() - interval '14 days';

-- 2. SDL Auctions: PURGE the fabricated lots (synthetic addresses + sequential
--    demo URLs — Gemini hallucinations from a contentless page). Plan 4 onboards
--    the REAL SDL Auctions house, which repopulates house='sdlauctions' from
--    real /property/{id}/ URLs.
DELETE FROM lots WHERE house = 'sdl' AND url ILIKE '%sdlauctions.co.uk%';

-- 3. network: dead historical BTG (0 active) -> fold into btgeddisons.
UPDATE lots SET house = 'btgeddisons' WHERE house = 'network';

-- 4. Remainder (real btgeddisons.com lots + a couple of typo-domain variants)
--    -> rename slug.
UPDATE lots SET house = 'btgeddisons' WHERE house = 'sdl';

-- 5. Companion tables.
UPDATE house_skills SET house = 'btgeddisons' WHERE house IN ('sdl','network');
UPDATE auction_calendar SET house = 'btgeddisons' WHERE house IN ('sdl','network');

-- Verify (run as a read-only check after applying):
--   SELECT house, count(*) FROM lots
--    WHERE house IN ('sdl','network','btgeddisons','charlesdarrow','sdlauctions')
--    GROUP BY 1 ORDER BY 1;
--   Expect: zero 'sdl'/'network'; btgeddisons ~= 595+191; charlesdarrow zombies withdrawn;
--   zero sdlauctions.co.uk rows surviving.
