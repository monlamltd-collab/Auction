# Mobile lot drawer — manual/MCP verification (run server locally first)

## Mobile (390×844)
- [ ] Tap lot card → drawer slides in from right; scrim dims during entry; background locked.
- [ ] Body scrolls header → DD → scores → comparables → deal stack → fundability → "what happens next".
- [ ] CLOSE ✕ (≥44px) / Esc / Android Back / LEFT-EDGE SWIPE each close + restore focus to the card.
      (At full width the scrim is covered — no scrim-tap close on mobile; that's desktop-only.)
- [ ] Deal-stack recalc (premium); anon → "Sign in free" → paywall opens ABOVE the drawer.
- [ ] Focus a deal-stack numeric input → field scrolls clear of the keyboard.
- [ ] Tab cycles within the drawer (trap); background inert; after close, focus on the card.
- [ ] Closed drawer's off-screen buttons NOT tabbable (inert).
- [ ] URL has ?lot=<uuid> while open; reload reopens; filter change keeps ?lot=.
- [ ] Background re-render while open → drawer stays intact.
- [ ] Reduced-motion → instant appear/dismiss.
- [ ] Standalone/landscape: sticky CLOSE header clears the notch (top safe-area); footer clears home indicator.
- [ ] analytics: lot_drawer_open once; lot_view de-dupe intact.

## Desktop (1280×900) — regression
- [ ] Lot click still opens the INLINE panel; cache + scroll-restore intact; close works.

## SEO guardrail
- [ ] GET /lot/<uuid> still SSR-renders (title/canonical/og/JSON-LD); /lot route + sitemap files unchanged.

## Backend gate
- [ ] node tests/test-lot-columns.js → PASS.
