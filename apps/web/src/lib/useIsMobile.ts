import { useSyncExternalStore } from "react";

/** Must match the stylesheet's mobile breakpoint (styles.css `@media (max-width: 720px)`). */
const MOBILE_QUERY = "(max-width: 720px)";

/** True when the viewport is phone-sized; live — flips on rotate/resize. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(MOBILE_QUERY).matches);
}

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  // Some embedded/emulated viewports resize without firing MQL change
  // events; window resize covers them (no-op snapshots don't re-render).
  window.addEventListener("resize", onChange);
  return () => {
    mql.removeEventListener("change", onChange);
    window.removeEventListener("resize", onChange);
  };
}
