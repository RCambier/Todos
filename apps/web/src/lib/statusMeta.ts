import type { Status } from "@memoria/sheet-core";

/** Display metadata per status — the one place to touch when a column is added or renamed. */
export const STATUS_LABEL: Record<Status, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  admin_renewals: "Admin renewals",
  health_checks: "Health checks",
};

export const STATUS_PILL_CLASS: Record<Status, string> = {
  backlog: "pill-backlog",
  in_progress: "pill-progress",
  blocked: "pill-blocked",
  done: "pill-done",
  admin_renewals: "pill-admin",
  health_checks: "pill-health",
};

/** The columns every board opens with, in board order. */
export const VISIBLE_STATUSES: readonly Status[] = ["backlog", "in_progress", "blocked", "done"];

/**
 * The long-horizon buckets (document renewals, recurring health checks) —
 * folded away by default and revealed from the board's right edge. Purely a
 * display concept: the data model treats every status the same.
 */
export const HIDDEN_STATUSES: readonly Status[] = ["admin_renewals", "health_checks"];
