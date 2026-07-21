import type { SheetRow } from "./types.js";

/**
 * A board's columns are customizable per board and live in their own tab on
 * the Todos spreadsheet, `Columns`, one row per column. This is the single
 * definition of that tab's shape and the pure logic for reading, writing,
 * and reasoning about a column list — the counterpart to `headers.ts` /
 * `parse.ts` for tasks, kept deliberately lenient because a column config is
 * *settings*, not user task data: a malformed row is skipped, never fatal.
 */

/** Name of the spreadsheet tab that holds the board's column configuration. */
export const COLUMNS_TAB_NAME = "Columns";

/**
 * Column headers for the `Columns` tab, in column order (A..F). `sort_order`
 * is a float (ascending = left to right, same idea as a task's sort order);
 * `done` / `blocked` / `hidden` are role flags, written as `"1"` / `""`.
 */
export const COLUMNS_HEADERS = ["id", "label", "sort_order", "done", "blocked", "hidden"] as const;

/** One board column. `id` is stable across renames; `label` is what's shown. */
export interface BoardColumn {
  /** Stable slug stored on each task's `status`. Never changes on rename. */
  id: string;
  /** Display name, left to right. */
  label: string;
  /** Ascending = left to right. A float, so a column can be reordered between two others. */
  sortOrder: number;
  /**
   * The "done" column: the card ✓ and the agent's `complete_task` send tasks
   * here, and the calendar mirror treats tasks here as finished. At most one
   * per board.
   */
  done: boolean;
  /**
   * The "blocked" column: giving a task a blocked-until date auto-moves it
   * here, clearing it releases the task. At most one per board.
   */
  blocked: boolean;
  /** Folded away by default on the board, revealed from the right edge. */
  hidden: boolean;
}

/** The columns a brand-new board is created with. `done` carries the done role. */
export const DEFAULT_NEW_COLUMNS: readonly BoardColumn[] = [
  { id: "backlog", label: "Backlog", sortOrder: 0, done: false, blocked: false, hidden: false },
  { id: "in_progress", label: "In progress", sortOrder: 1, done: false, blocked: false, hidden: false },
  { id: "done", label: "Done", sortOrder: 2, done: true, blocked: false, hidden: false },
];

/**
 * The columns every pre-customization board effectively had — the migration
 * target when a board has no `Columns` tab yet, so an existing board keeps
 * exactly the columns and behaviors it always showed.
 */
export const LEGACY_COLUMNS: readonly BoardColumn[] = [
  { id: "backlog", label: "Backlog", sortOrder: 0, done: false, blocked: false, hidden: false },
  { id: "in_progress", label: "In progress", sortOrder: 1, done: false, blocked: false, hidden: false },
  { id: "blocked", label: "Blocked", sortOrder: 2, done: false, blocked: true, hidden: false },
  { id: "done", label: "Done", sortOrder: 3, done: true, blocked: false, hidden: false },
  { id: "admin_renewals", label: "Admin renewals", sortOrder: 4, done: false, blocked: false, hidden: true },
  { id: "health_checks", label: "Health checks", sortOrder: 5, done: false, blocked: false, hidden: true },
];

/** True for the cell values we treat as a set role flag (`"1"`, `"true"`, `"yes"`). */
function truthy(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export interface ParseColumnsResult {
  columns: BoardColumn[];
  /** True when the tab held no usable column rows (missing tab, header only, or all-blank). */
  empty: boolean;
}

/**
 * Parses the `Columns` tab (header + rows, as returned by `values.get`).
 * Deliberately total and forgiving: rows without an id are skipped, a
 * missing label falls back to the id, a non-numeric sort_order falls back to
 * row position, duplicate ids keep the first, and the done/blocked roles are
 * clamped to at most one column each (first wins). Callers fall back to a
 * default column set when `empty` is true.
 */
export function parseColumnsSheet(rows: readonly SheetRow[]): ParseColumnsResult {
  const columns: BoardColumn[] = [];
  const seen = new Set<string>();
  let sawDone = false;
  let sawBlocked = false;

  // Row 0 is the header; if it's absent the tab is empty anyway.
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const id = (row[0] ?? "").trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);

    const label = (row[1] ?? "").trim() || id;
    const sortRaw = (row[2] ?? "").trim();
    const parsedSort = Number(sortRaw);
    const sortOrder = sortRaw !== "" && !Number.isNaN(parsedSort) ? parsedSort : i - 1;

    const done = !sawDone && truthy(row[3] ?? "");
    if (done) sawDone = true;
    const blocked = !sawBlocked && truthy(row[4] ?? "");
    if (blocked) sawBlocked = true;
    const hidden = truthy(row[5] ?? "");

    columns.push({ id, label, sortOrder, done, blocked, hidden });
  }

  return { columns: orderColumns(columns), empty: columns.length === 0 };
}

/** Sorts a column list into display order (ascending sort_order, then label). */
export function orderColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return [...columns].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

/** Converts one column to a raw row in `COLUMNS_HEADERS` order. */
export function columnToRow(column: BoardColumn): SheetRow {
  return [
    column.id,
    column.label,
    String(column.sortOrder),
    column.done ? "1" : "",
    column.blocked ? "1" : "",
    column.hidden ? "1" : "",
  ];
}

/** The full grid for the `Columns` tab: the header row followed by one row per column, in order. */
export function columnsToRows(columns: readonly BoardColumn[]): SheetRow[] {
  return [[...COLUMNS_HEADERS], ...orderColumns(columns).map(columnToRow)];
}

/** The column ids in display order — the ordering a board uses to group tasks. */
export function columnIds(columns: readonly BoardColumn[]): string[] {
  return orderColumns(columns).map((c) => c.id);
}

/** The id of the done-role column, or `null` if none is designated. */
export function doneColumnId(columns: readonly BoardColumn[]): string | null {
  return columns.find((c) => c.done)?.id ?? null;
}

/** The id of the blocked-role column, or `null` if none is designated. */
export function blockedColumnId(columns: readonly BoardColumn[]): string | null {
  return columns.find((c) => c.blocked)?.id ?? null;
}

/** The columns shown by default (not flagged hidden), in display order. */
export function visibleColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return orderColumns(columns).filter((c) => !c.hidden);
}

/** The columns folded away by default, in display order. */
export function hiddenColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return orderColumns(columns).filter((c) => c.hidden);
}

/**
 * Turns a label into a stable, sheet-friendly column id unique among
 * `existing`. Lowercases, keeps ASCII word characters, joins the rest with
 * underscores; falls back to `column` for an empty result, and appends
 * `_2`, `_3`, … on collision.
 */
export function slugifyColumnId(label: string, existing: readonly string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "column";
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
