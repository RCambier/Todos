import type { Task } from "./types.js";

/**
 * `sort_order` is a float. Ascending within a column = top to bottom.
 * There is no global renumbering: every reorder is a single-row write.
 *
 * Float exhaustion (running out of representable midpoints) would need on
 * the order of ~50 consecutive midpoint inserts into the exact same gap to
 * matter in practice. We accept that theoretical limit rather than engineer
 * around it (e.g. periodic renumbering) per the architecture doc.
 */

/** The sort_order for a new task inserted at the top of a column. */
export function topSortOrder(existingOrders: readonly number[]): number {
  if (existingOrders.length === 0) return 0;
  return Math.min(...existingOrders) - 1;
}

/**
 * The sort_order for a task dropped between two neighbors. Pass `null` for
 * `above`/`below` when dropping at the very top or very bottom of a column.
 */
export function betweenSortOrder(above: number | null, below: number | null): number {
  if (above === null && below === null) return 0;
  if (above === null) return below! - 1;
  if (below === null) return above + 1;
  return (above + below) / 2;
}

/** Sorts tasks within a status column by ascending sort_order (top to bottom). */
export function sortByOrder(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Groups and sorts tasks into board order: each status column, top to
 * bottom, in the given column order. Tasks whose status isn't among
 * `statuses` (e.g. a column was deleted) are never dropped — they follow the
 * known columns, grouped by their orphaned status, so no task ever
 * disappears from a listing.
 */
export function boardOrder(tasks: readonly Task[], statuses: readonly string[]): Task[] {
  const known = new Set(statuses);
  const ordered = statuses.flatMap((status) => sortByOrder(tasks.filter((t) => t.status === status)));
  const orphanStatuses = [...new Set(tasks.filter((t) => !known.has(t.status)).map((t) => t.status))].sort();
  const orphans = orphanStatuses.flatMap((status) => sortByOrder(tasks.filter((t) => t.status === status)));
  return [...ordered, ...orphans];
}
