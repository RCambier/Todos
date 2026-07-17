import { useEffect, useState } from "react";

/** True on primarily-touch devices — used to swap drag-and-drop for tap-to-move. */
export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
  );

  useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)");
    const handler = (): void => setIsTouch(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isTouch;
}
