import { orderColumns, type BoardColumn, type Status } from "@memoria/sheet-core";

/**
 * Display metadata for the board's columns. Columns are customizable per
 * board (stored in the sheet's `Columns` tab), so labels and colors are
 * derived from that config at render time rather than a fixed table.
 *
 * Colors: the done and blocked roles get their semantic tokens (green /
 * clay); every other column rotates through a curated palette by position.
 * For a board with the historical columns this reproduces exactly the colors
 * the app always showed.
 */

/** Inline CSS custom properties a `.status-pill` reads for its colors. */
export interface PillStyle {
  "--pill-bg": string;
  "--pill-fg": string;
  "--pill-dot": string;
}

/** A column's display metadata: its label and pill colors. */
export interface ColumnMeta {
  label: string;
  style: PillStyle;
}

function style(bg: string, fg: string, dot: string): PillStyle {
  return { "--pill-bg": bg, "--pill-fg": fg, "--pill-dot": dot };
}

const DONE_STYLE = style("var(--status-done-bg)", "var(--status-done)", "var(--status-done-dot)");
const BLOCKED_STYLE = style("var(--status-blocked-bg)", "var(--status-blocked)", "var(--status-blocked-dot)");

/** Neutral fallback for a task pointing at a column that no longer exists. */
export const ORPHAN_STYLE = style(
  "var(--status-backlog-bg)",
  "var(--status-backlog)",
  "var(--status-backlog-dot)",
);

/** Colors for non-role columns, rotated by position (design tokens first, then extras). */
const PALETTE: readonly PillStyle[] = [
  style("var(--status-backlog-bg)", "var(--status-backlog)", "var(--status-backlog-dot)"),
  style("var(--status-progress-bg)", "var(--status-progress)", "var(--status-progress-dot)"),
  style("var(--status-admin-bg)", "var(--status-admin)", "var(--status-admin-dot)"),
  style("var(--status-health-bg)", "var(--status-health)", "var(--status-health-dot)"),
  style("#efeaf5", "#6b5b8a", "#9584b8"),
  style("#f6eaef", "#8a5b6f", "#b884a0"),
  style("#eaf1f6", "#4f6f8a", "#7f9bb5"),
];

/**
 * Builds an id → { label, style } lookup for a board's columns. Role columns
 * (done / blocked) take their semantic color; the rest rotate through
 * `PALETTE` in display order, so colors stay stable as long as the column
 * set does.
 */
export function buildColumnMeta(columns: readonly BoardColumn[]): Map<string, ColumnMeta> {
  const meta = new Map<string, ColumnMeta>();
  let paletteIndex = 0;
  for (const column of orderColumns(columns)) {
    const pill = column.done
      ? DONE_STYLE
      : column.blocked
        ? BLOCKED_STYLE
        : PALETTE[paletteIndex++ % PALETTE.length]!;
    meta.set(column.id, { label: column.label, style: pill });
  }
  return meta;
}

/** Turns a bare status id into a readable label (for tasks orphaned from any column). */
export function humanizeStatus(id: Status): string {
  const spaced = id.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : id;
}

/** The label to show for a status, falling back to a humanized id for orphans. */
export function statusLabel(meta: Map<string, ColumnMeta>, id: Status): string {
  return meta.get(id)?.label ?? humanizeStatus(id);
}

/** The pill colors for a status, falling back to a neutral style for orphans. */
export function statusStyle(meta: Map<string, ColumnMeta>, id: Status): PillStyle {
  return meta.get(id)?.style ?? ORPHAN_STYLE;
}
