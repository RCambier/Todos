import { useLayoutEffect, type RefObject } from "react";

/**
 * Keeps a textarea's height matched to its content, so an inline-editable
 * field grows and shrinks with the text instead of showing a scrollbar.
 * Re-measures whenever `value` changes.
 */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}
