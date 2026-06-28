-- Migration: register SDL Auctions in house_skills so the scheduler scrapes it.
-- Date: 2026-06-27. Part of the SDL de-conflation follow-up (render-enable).
--
-- WHY: de-conflation plan 4 onboarded `sdlauctions` in CODE (HOUSE_ROOTS,
-- recogniser, recall sentinel) but never created a `house_skills` row. The daily
-- scheduler iterates `house_skills`, so with no row SDL was NEVER scraped → 0
-- live lots. (CD, by contrast, already HAS a row — its blocker is a tripped
-- circuit, handled separately.)
--
-- The companion CODE change (same PR) adds an `sdlauctions.co.uk` entry to
-- `CLICK_TO_LOAD_SELECTORS` in lib/scraper/crawlee.js so the render clicks the
-- "Show: All" page-size link — without it the /search/ grid yields only 12 of
-- ~186 lots (a partial, which the 100%-coverage rule forbids). Verified live
-- 2026-06-27: default render 11 → click-All 186, recogniser 186/186.
--
-- Row mirrors the sister btg_sdl platform row (btgeddisons): Crawlee is the
-- default engine (requires_puppeteer=false — the engine router ignores that
-- flag under CRAWLEE_DEFAULT=true and routes recogniser houses to Crawlee).
-- Idempotent: ON CONFLICT re-arms the row without clobbering accrued metrics.

INSERT INTO house_skills
  (slug, house, catalogue_url, extractor, requires_puppeteer, requires_firecrawl,
   pagination_pattern, status, circuit_state, health_score, consecutive_failures,
   platform_family, dormant, notes)
VALUES
  ('sdlauctions', 'SDL Auctions', 'https://www.sdlauctions.co.uk/search/',
   'crawlee+gemini', false, false,
   'none', 'healthy', 'closed', 100, 0,
   'btg_sdl', false,
   'AJAX /search/ grid; render clicks Show:All (a.pageLimit "All") for the full ~186-lot book — see lib/scraper/crawlee.js CLICK_TO_LOAD_SELECTORS. recogniseSdlAuctionsLotsFromMarkdown. Onboarded plan 4; row added 2026-06-27.')
ON CONFLICT (slug) DO UPDATE SET
  house              = EXCLUDED.house,
  catalogue_url      = EXCLUDED.catalogue_url,
  extractor          = EXCLUDED.extractor,
  requires_puppeteer = EXCLUDED.requires_puppeteer,
  requires_firecrawl = EXCLUDED.requires_firecrawl,
  pagination_pattern = EXCLUDED.pagination_pattern,
  status             = 'healthy',
  circuit_state      = 'closed',
  health_score       = 100,
  consecutive_failures = 0,
  platform_family    = EXCLUDED.platform_family,
  dormant            = false;

-- Verify after applying:
--   SELECT slug, house, status, circuit_state, requires_puppeteer, platform_family
--     FROM house_skills WHERE slug = 'sdlauctions';
--   Then POST /api/admin/rescrape {house:'sdlauctions'} (or wait one scheduler
--   cycle) and expect ~186 live lots under house='sdlauctions'. No restart
--   needed — SDL has no tripped circuit; the scheduler reads house_skills fresh.
