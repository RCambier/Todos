import type { Task } from "@memoria/sheet-core";

/** Formats an ISO timestamp as e.g. "Jul 21". */
export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Formats an ISO timestamp as e.g. "Jul 21, 2026". */
export function formatFullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Formats a `YYYY-MM-DD` due date as e.g. "Jul 21" (local, no timezone drift). */
export function formatDueDate(dueDate: string): string {
  const d = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dueDate;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Like `formatDueDate` but with the year, for the task detail view. */
export function formatDueDateLong(dueDate: string): string {
  const d = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dueDate;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** A due date is overdue once the local calendar day has passed — unless the task is done. */
export function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === "done") return false;
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return task.dueDate < localToday;
}
