/**
 * The scheduling slot: a task has either a due date or a blocked-until,
 * never both. `blockedUntil` holds a `YYYY-MM-DD` date or a free-text event
 * (e.g. "Trip done"); either field is `""` when unset.
 */

export interface Schedule {
  dueDate: string;
  blockedUntil: string;
}

/**
 * Merges a partial schedule patch onto the current values, keeping the
 * either/or invariant: a patch that sets one field non-empty clears the
 * other. Explicit `""` clears just that field; `undefined` leaves it alone.
 * If a patch sets both non-empty (contradictory — the MCP tools reject it
 * up front), blocked-until wins: blocking is the more deliberate statement.
 * Total — never throws — so it's safe in the web app's projection path.
 */
export function mergeSchedule(
  current: Schedule,
  patch: { dueDate?: string; blockedUntil?: string },
): Schedule {
  if (patch.blockedUntil) return { dueDate: "", blockedUntil: patch.blockedUntil };
  if (patch.dueDate) return { dueDate: patch.dueDate, blockedUntil: "" };
  return {
    dueDate: patch.dueDate ?? current.dueDate,
    blockedUntil: patch.blockedUntil ?? current.blockedUntil,
  };
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** One year later, same month/day (Feb 29 lands on Feb 28 in non-leap years). */
function plusOneYear(date: string): string {
  const [y = 0, m = 0, d = 0] = date.split("-").map(Number);
  const year = y + 1;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = m === 2 && d === 29 && !isLeap ? 28 : d;
  return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Advances `date` by whole years until it is strictly after `today` (both `YYYY-MM-DD`). */
export function nextYearlyDate(date: string, today: string): string {
  let next = plusOneYear(date);
  while (next <= today) next = plusOneYear(next); // long-overdue: land in the future, not last year
  return next;
}

/**
 * What a move actually does to a task — THE recurrence rule, shared by the
 * board operation (`moveTask`) and the local-first projection
 * (`applyPending`) so the optimistic UI and the flushed write can never
 * disagree:
 *
 * Completing a `yearly` task that carries a date doesn't finish it — it
 * advances that date one year (into the future) and leaves the task in its
 * column. Everything else is a plain move. A yearly task with no date (or a
 * blocked-until naming an event) has nothing to recur on and completes
 * normally.
 */
export function resolveMove(
  task: Pick<Schedule, "dueDate" | "blockedUntil"> & { recurs: string },
  status: string,
  today: string,
  /** Which column counts as "done" for this board (the recurrence trigger). */
  doneStatus: string = "done",
): { redated: Partial<Schedule> | null } {
  if (status !== doneStatus || task.recurs !== "yearly") return { redated: null };
  if (task.dueDate !== "") return { redated: { dueDate: nextYearlyDate(task.dueDate, today) } };
  if (DATE_ONLY_RE.test(task.blockedUntil)) {
    return { redated: { blockedUntil: nextYearlyDate(task.blockedUntil, today) } };
  }
  return { redated: null };
}
