---
name: verify
description: Build, run, and drive the Memoria web app to verify board/card UI changes end-to-end.
---

# Verifying @memoria/web UI changes

The real app needs Google auth + a Sheets backend, so UI changes are verified
against the **committed** harness page `apps/web/verify.html` +
`src/verify-main.tsx`: it mounts the REAL `App` with every network call
stubbed (session, userinfo, Drive listing, Sheets grid) — auth, the board
shelf, and board flows all work end-to-end without Google. Dev-only: vite
serves it, the production build ignores it.

## Recipe

1. `npm install` at the repo root (runs `prepare`, which builds `sheet-core`).
2. `cd apps/web && VITE_GOOGLE_CLIENT_ID=harness VITE_GOOGLE_API_KEY=harness npx vite --port 5199 --strictPort`
   (background), then open `http://localhost:5199/verify.html`. The dummy env
   satisfies the config check without a `.env`; a dev server already running
   with real credentials works just as well.
3. Drive with `playwright-core` (install in the scratchpad; launch the
   pre-installed browser via `executablePath` — on macOS
   `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).
4. Need a different fixture (extra boards, malformed sheet, 401s)? Edit
   `src/verify-main.tsx`'s stubbed fetch — but return it to the standard
   fixture before committing, or commit the improvement deliberately.

Sheets writes are accepted and dropped (the next 5s poll re-serves the same
grid) — assert on intercepted calls or optimistic state, not persistence.

## Gotchas

- Mobile context needs `hasTouch: true, isMobile: true`, viewport ~390×844.
- Playwright has no touch-drag API; dispatch raw gestures over CDP with
  `Input.dispatchTouchEvent` (`touchStart`/`touchMove`/`touchEnd`).
- dnd long-press: hold ~350ms after `touchStart` before moving to lift a card;
  moving within ~120ms falls through to native scroll (that's the page swipe).
- The mobile board is a scroll-snap pager showing one column per page. Before
  touching a card, navigate its panel into view (tap its `.seg-switcher` pill)
  — `boundingBox()` of an off-screen card gives coordinates outside the
  viewport and touches silently miss.
- Cross-column drag: hold the lifted card at the screen edge ~2s so dnd
  auto-scroll pages the board, then move back over the column body before
  releasing — releasing at the extreme edge lands outside the droppable.
- Sync/local-first assertions: don't sample at checkpoints — regressions can
  live in sub-500ms windows (e.g. the old flash-of-old-state between write
  confirm and reconcile). Inject ~150ms latency into the stubbed fetch, then
  poll the DOM every ~10ms asserting the expected state is NEVER absent for
  the whole window.
