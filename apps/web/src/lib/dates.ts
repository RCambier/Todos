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

/** Today as a local-calendar `YYYY-MM-DD` — the day boundary for due dates and memory expiry. */
export function localToday(): string {
  return toLocalISO(new Date());
}

/** Tomorrow as a local-calendar `YYYY-MM-DD` — the default when a due date first appears. */
export function localTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toLocalISO(d);
}

function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A due date is overdue once the local calendar day has passed — unless the task is done. */
export function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === "done") return false;
  return task.dueDate < localToday();
}

/** True for a bare `YYYY-MM-DD` value — how a blocked-until date is told apart from an event. */
export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Formats a blocked-until value: dates as e.g. "Jul 21", event text as itself. */
export function formatBlockedUntil(value: string): string {
  return isDateOnly(value) ? formatDueDate(value) : value;
}

/** Like `formatBlockedUntil` but dates include the year, for the task detail view. */
export function formatBlockedUntilLong(value: string): string {
  return isDateOnly(value) ? formatDueDateLong(value) : value;
}

/**
 * A date block lifts the local day it names ("blocked until Jul 21" = free
 * to start on Jul 21). Event blocks ("Trip done") never lift on their own —
 * the user clears them.
 */
export function isBlockLifted(task: Task): boolean {
  if (!task.blockedUntil || task.status === "done" || !isDateOnly(task.blockedUntil)) return false;
  return task.blockedUntil <= localToday();
}
