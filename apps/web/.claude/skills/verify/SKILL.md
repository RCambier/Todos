---
name: verify
description: Build, run, and drive the Memoria web app to verify board/card UI changes end-to-end.
---

# Verifying @memoria/web UI changes

The real app needs Google auth + a Sheets backend, so board UI changes are
verified against a harness page that mounts the real `Board` component with
in-memory tasks inside the real Vite dev server.

## Recipe

1. `npm install` at the repo root (runs `prepare`, which builds `sheet-core`).
2. Create two temporary files (delete them before committing):
   - `apps/web/verify.html` — copy of `index.html` pointing at `/src/verify-main.tsx`.
   - `apps/web/src/verify-main.tsx` — mounts `<Board>` with sample `Task`s and a
     stateful `onMove` that records calls on `window.__moves` for assertions.
3. `cd apps/web && npx vite --port 5199 --strictPort` (background).
4. Drive with `playwright-core` (install in the scratchpad; launch the
   pre-installed browser at `/opt/pw-browsers/.../chrome` via `executablePath`).

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
