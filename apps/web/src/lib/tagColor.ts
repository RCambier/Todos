import { useSyncExternalStore } from "react";

/**
 * Tag colors. A tag's color is a property of its *name* (shared across every
 * card and note it appears on), so it lives outside the sheet — the sheet
 * only ever stores tag names. Resolution order for a name's color:
 *
 *   1. a color the user explicitly picked (persisted in localStorage),
 *   2. a built-in default (so the two named tags look right on a fresh device
 *      with nothing stored),
 *   3. a deterministic hash of the name (a stable fallback for everything else).
 *
 * The palette itself is `.tag-<id>` classes in styles.css.
 */

/** The named tag palette. Each id maps to a `.tag-<id>` class and a `.sw-<id>` swatch. */
export const TAG_COLORS = ["blue", "orange", "green", "purple", "pink", "teal", "amber", "slate"] as const;
export type TagColor = (typeof TAG_COLORS)[number];

/** Colors that ship on by default — no storage needed for these to be right. */
const BUILT_IN: Record<string, TagColor> = { revolut: "blue", anthropic: "orange" };

const STORAGE_KEY = "memoria:tagColors";

type ColorMap = Record<string, TagColor>;

const isTagColor = (v: unknown): v is TagColor =>
  typeof v === "string" && (TAG_COLORS as readonly string[]).includes(v);

function readStored(): ColorMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: ColorMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isTagColor(value)) out[key.toLowerCase()] = value;
    }
    return out;
  } catch {
    return {};
  }
}

let overrides: ColorMap = readStored();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Cross-tab: another tab changing a color updates this one live.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      overrides = readStored();
      emit();
    }
  });
}

/** Stable reference until a color changes — safe for useSyncExternalStore. */
function getSnapshot(): ColorMap {
  return overrides;
}

/** A stable deterministic color for tags with no explicit pick or built-in. */
function hashColor(name: string): TagColor {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length]!;
}

/** The resolved color id for a tag: user pick → built-in → deterministic hash. */
export function tagColorId(name: string, map: ColorMap = overrides): TagColor {
  const key = name.trim().toLowerCase();
  return map[key] ?? BUILT_IN[key] ?? hashColor(key);
}

/** The CSS class carrying a tag's color. */
export function tagColorClass(name: string, map?: ColorMap): string {
  return `tag-${tagColorId(name, map)}`;
}

/** Sets (or changes) a tag's color. Persisted locally and broadcast to subscribers. */
export function setTagColor(name: string, color: TagColor): void {
  const key = name.trim().toLowerCase();
  if (!key) return;
  overrides = { ...overrides, [key]: color };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // best-effort; the in-memory map still updates for this session
  }
  emit();
}

/**
 * Subscribes to tag colors and returns a `(name) => className` resolver that
 * re-renders its component whenever any color changes. Use it in anything that
 * paints tags so a color pick lands everywhere at once.
 */
export function useTagColors(): (name: string) => string {
  const map = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (name: string) => tagColorClass(name, map);
}
