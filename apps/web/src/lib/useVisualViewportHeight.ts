import { useEffect, useState } from "react";

/**
 * Height of the *visual* viewport in px, tracked live — or `null` where the
 * API is unavailable. The point: on iOS the on-screen keyboard shrinks only
 * the visual viewport, never the layout viewport, so a `position: fixed;
 * inset: 0` overlay keeps its bottom edge (and any controls pinned there)
 * hidden behind the keyboard. Sizing the overlay to this height keeps its
 * bottom row sitting right on top of the keyboard.
 */
export function useVisualViewportHeight(active: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = (): void => setHeight(vv.height);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setHeight(null);
    };
  }, [active]);

  return height;
}
