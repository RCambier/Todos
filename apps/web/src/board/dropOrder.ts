import { betweenSortOrder, type Task } from "@todos/sheet-core";

/**
 * Computes the `sort_order` for a task dropped at `dropIndex` within a
 * destination column. `columnTasks` is that column's current tasks, top to
 * bottom, with the dragged task already excluded.
 */
export function computeDropSortOrder(columnTasks: readonly Task[], dropIndex: number): number {
  const above = dropIndex > 0 ? (columnTasks[dropIndex - 1]?.sortOrder ?? null) : null;
  const below = dropIndex < columnTasks.length ? (columnTasks[dropIndex]?.sortOrder ?? null) : null;
  return betweenSortOrder(above, below);
}
