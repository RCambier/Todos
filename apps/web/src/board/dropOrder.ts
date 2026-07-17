import { betweenSortOrder, topSortOrder, type Task } from "@memoria/sheet-core";

/**
 * Computes the `sort_order` for a task dropped at `dropIndex` within a
 * destination column. `columnTasks` is that column's current tasks, top to
 * bottom, with the dragged task already excluded — this is exactly the
 * shape @hello-pangea/dnd's `destination.index` is defined against (the
 * destination list without the dragged item), so callers can pass
 * `result.destination.index` straight through.
 *
 * - Dropped at the top (`dropIndex <= 0`) → `topSortOrder`.
 * - Dropped past the end (`dropIndex >= columnTasks.length`) → below the
 *   last card.
 * - Otherwise → the midpoint between its new neighbors (`betweenSortOrder`).
 */
export function computeDropSortOrder(columnTasks: readonly Task[], dropIndex: number): number {
  if (columnTasks.length === 0) return topSortOrder([]);
  if (dropIndex <= 0) {
    return topSortOrder(columnTasks.map((t) => t.sortOrder));
  }
  const last = columnTasks[columnTasks.length - 1];
  if (dropIndex >= columnTasks.length) {
    return betweenSortOrder(last?.sortOrder ?? null, null);
  }
  const above = columnTasks[dropIndex - 1];
  const below = columnTasks[dropIndex];
  return betweenSortOrder(above?.sortOrder ?? null, below?.sortOrder ?? null);
}
