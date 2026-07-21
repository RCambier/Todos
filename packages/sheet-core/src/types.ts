/**
 * A task's column, identified by its column *id*. Columns are customizable
 * per board and stored in the sheet's `Columns` tab (see `columns.ts`), so a
 * status is any non-empty column id — not a fixed enum. Tasks whose status
 * points at a column that no longer exists are still valid data (the board
 * folds them into a fallback column); the model never rejects them.
 */
export type Status = string;

/**
 * The column ids every board historically shipped with, in display order.
 * No longer the definition of "a valid status" — it's the fallback ordering
 * used when a board's column config isn't available, and the id set of
 * `LEGACY_COLUMNS` (the migration target for pre-customization boards).
 */
export const STATUSES = [
  "backlog",
  "in_progress",
  "blocked",
  "done",
  "admin_renewals",
  "health_checks",
] as const;

/** A status is valid as long as it's a non-empty string — any column id qualifies. */
export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && value.trim() !== "";
}

/** How a task repeats. Completing a "yearly" task re-dates it instead of finishing it. */
export const RECURRENCES = ["", "yearly"] as const;

export type Recurrence = (typeof RECURRENCES)[number];

export function isRecurrence(value: unknown): value is Recurrence {
  return typeof value === "string" && (RECURRENCES as readonly string[]).includes(value);
}

/** Who created the task. Informational only — never used for authorization. */
export const SOURCES = ["user", "agent"] as const;

export type Source = (typeof SOURCES)[number];

export interface Task {
  id: string;
  title: string;
  status: Status;
  /** Ascending within a column = top to bottom. A float; see ordering.ts. */
  sortOrder: number;
  notes: string;
  source: Source;
  /** ISO 8601, set once at creation. */
  createdAt: string;
  /** ISO 8601, set on every mutation. */
  updatedAt: string;
  /** Due date as `YYYY-MM-DD`, or `""` for none. */
  dueDate: string;
  /**
   * What the task is waiting on before it's actionable: a `YYYY-MM-DD` date
   * or a free-text event (e.g. "Trip done"). `""` = not blocked. A task has
   * either a due date or a blocked-until, never both — see `mergeSchedule`.
   */
  blockedUntil: string;
  /** Free-form labels. Stored comma-separated in the sheet, so names can't contain commas. */
  tags: string[];
  /** `"yearly"` re-dates the task on completion instead of finishing it; `""` = one-off. */
  recurs: Recurrence;
}

/** A raw row of string cells as returned by the Sheets API (already A:J sliced). */
export type SheetRow = string[];
