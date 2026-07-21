import { assertCellLimits, locateRowById, type SheetError } from "./grid.js";
import { generateId } from "./id.js";
import { boardOrder, topSortOrder } from "./ordering.js";
import { parseSheet, type ParseResult } from "./parse.js";
import { mergeSchedule, resolveMove } from "./schedule.js";
import { taskToRow } from "./serialize.js";
import type { SheetStore } from "./store.js";
import { STATUSES, type Recurrence, type Source, type Status, type Task } from "./types.js";

/**
 * The board operations — the ONE implementation of the write-safety
 * invariant both clients rely on: every mutation does a fresh read,
 * validates it, re-locates its row by task id, and touches exactly that
 * row. The web app and the MCP tools call these same functions; they differ
 * only in the `SheetStore` adapter they pass in and the `source` they stamp
 * on new tasks.
 */

/** The sheet failed validation. `error` pinpoints the exact row/column/value. */
export class MalformedSheetError extends Error {
  constructor(public readonly error: SheetError) {
    super(
      `The sheet doesn't match the expected format — ${error.message} ` +
        "Fix it in Google Sheets, then try again.",
    );
    this.name = "MalformedSheetError";
  }
}

/** No row with the given task id was found in the freshest read. */
export class TaskNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(
      `No task with id "${id}" was found — it may have been changed or removed elsewhere. ` +
        "Refresh the board (or call list_tasks) and try again.",
    );
    this.name = "TaskNotFoundError";
  }
}

/** Reads and validates the whole board. Never throws for a malformed sheet — check `result.ok`. */
export async function fetchBoard(store: SheetStore): Promise<ParseResult> {
  return parseSheet(await store.readRows());
}

async function readValidTasks(store: SheetStore): Promise<{ tasks: Task[]; rawRows: string[][] }> {
  const rawRows = await store.readRows();
  const result = parseSheet(rawRows);
  if (!result.ok) throw new MalformedSheetError(result.error);
  return { tasks: result.tasks, rawRows };
}

/** Re-locates a task's row by id in the freshest read (see grid.ts), or throws. */
function locateRow(rawRows: string[][], id: string): number {
  const rowNumber = locateRowById(rawRows, id);
  if (rowNumber === null) throw new TaskNotFoundError(id);
  return rowNumber;
}

export interface NewTaskInput {
  title: string;
  notes?: string;
  status?: Status;
  dueDate?: string;
  blockedUntil?: string;
  tags?: string[];
  recurs?: Recurrence;
}

/** The status a task lands in when the caller names none — the historical first column. */
export const DEFAULT_STATUS: Status = "backlog";

/** Pure: builds the `Task` for a new entry, given the sort orders already in its column. */
export function buildTask(columnOrders: readonly number[], input: NewTaskInput, source: Source): Task {
  assertCellLimits({ title: input.title, notes: input.notes });
  const now = new Date().toISOString();
  return {
    id: generateId(),
    title: input.title,
    status: input.status ?? DEFAULT_STATUS,
    sortOrder: topSortOrder(columnOrders),
    notes: input.notes ?? "",
    source,
    createdAt: now,
    updatedAt: now,
    ...mergeSchedule({ dueDate: "", blockedUntil: "" }, input),
    tags: input.tags ?? [],
    recurs: input.recurs ?? "",
  };
}

/** Appends an already-built task as a new row (the optimistic-UI path: build first, write after). */
export async function appendTask(store: SheetStore, task: Task): Promise<void> {
  await store.appendRow(taskToRow(task));
}

/**
 * Replay-safe append: re-reads the sheet and writes the row only if no row
 * already carries this task's id. The optimistic-sync flusher retries an
 * append whose write may have landed but whose response was lost; without
 * this, the ambiguous retry would append the same id twice and make the
 * sheet malformed (duplicate-id parse error). Confirmation comes from the
 * source of truth, not a local replica — so a lost response can never
 * duplicate a row.
 */
export async function appendTaskIfAbsent(store: SheetStore, task: Task): Promise<void> {
  const { rawRows } = await readValidTasks(store);
  if (locateRowById(rawRows, task.id) !== null) return; // already landed
  await store.appendRow(taskToRow(task));
}

/**
 * Lists tasks in board order. `columnOrder` (a board's column ids, left to
 * right — from the `Columns` tab) drives the grouping; it defaults to the
 * legacy id set. Tasks whose status isn't in the order still appear, after
 * the known columns (see `boardOrder`).
 */
export async function listTasks(
  store: SheetStore,
  status?: Status,
  columnOrder: readonly string[] = STATUSES,
): Promise<Task[]> {
  const { tasks } = await readValidTasks(store);
  const filtered = status ? tasks.filter((t) => t.status === status) : tasks;
  return boardOrder(filtered, columnOrder);
}

/**
 * Reads the board, builds the task at the top of its column, and appends it.
 * With no explicit status the task lands in `defaultStatus` (a board's first
 * column, or the legacy default).
 */
export async function addTask(
  store: SheetStore,
  input: NewTaskInput,
  source: Source,
  defaultStatus: Status = DEFAULT_STATUS,
): Promise<Task> {
  const { tasks } = await readValidTasks(store);
  const status = input.status ?? defaultStatus;
  const columnOrders = tasks.filter((t) => t.status === status).map((t) => t.sortOrder);
  const task = buildTask(columnOrders, { ...input, status }, source);
  await appendTask(store, task);
  return task;
}

/**
 * Edits a task's fields. Merges the patch onto the freshest known fields —
 * never onto a possibly-stale local copy — so a concurrent edit elsewhere is
 * only ever overwritten in the fields this caller actually changed.
 */
export async function updateTask(
  store: SheetStore,
  id: string,
  patch: {
    title?: string;
    notes?: string;
    dueDate?: string;
    blockedUntil?: string;
    tags?: string[];
    recurs?: Recurrence;
  },
): Promise<Task> {
  assertCellLimits({ title: patch.title, notes: patch.notes });
  const { tasks, rawRows } = await readValidTasks(store);
  const current = tasks.find((t) => t.id === id);
  if (!current) throw new TaskNotFoundError(id);

  const updated: Task = {
    ...current,
    title: patch.title ?? current.title,
    notes: patch.notes ?? current.notes,
    ...mergeSchedule(current, patch),
    tags: patch.tags ?? current.tags,
    recurs: patch.recurs ?? current.recurs,
    updatedAt: new Date().toISOString(),
  };
  const rowNumber = locateRow(rawRows, id);
  await store.updateRow(rowNumber, taskToRow(updated));
  return updated;
}

/**
 * Moves a task to `status`. With an explicit `sortOrder` (the web app's drag
 * position) it lands exactly there; without one (the MCP tools) it lands at
 * the top of the destination column.
 *
 * Recurrence: completing a `yearly` task that carries a date re-dates it one
 * year ahead and leaves it in its column (see `resolveMove` in schedule.ts).
 */
export async function moveTask(
  store: SheetStore,
  id: string,
  status: Status,
  sortOrder?: number,
  doneStatus: Status = "done",
): Promise<Task> {
  const { tasks, rawRows } = await readValidTasks(store);
  const current = tasks.find((t) => t.id === id);
  if (!current) throw new TaskNotFoundError(id);

  const now = new Date();
  const { redated } = resolveMove(current, status, now.toISOString().slice(0, 10), doneStatus);
  const updated: Task = redated
    ? { ...current, ...mergeSchedule(current, redated), updatedAt: now.toISOString() }
    : {
        ...current,
        status,
        sortOrder:
          sortOrder ??
          topSortOrder(tasks.filter((t) => t.status === status && t.id !== id).map((t) => t.sortOrder)),
        updatedAt: now.toISOString(),
      };
  const rowNumber = locateRow(rawRows, id);
  await store.updateRow(rowNumber, taskToRow(updated));
  return updated;
}

export async function completeTask(
  store: SheetStore,
  id: string,
  doneStatus: Status = "done",
): Promise<Task> {
  return moveTask(store, id, doneStatus, undefined, doneStatus);
}

export async function deleteTask(store: SheetStore, id: string): Promise<void> {
  const { rawRows } = await readValidTasks(store);
  const rowNumber = locateRow(rawRows, id);
  await store.deleteRow(rowNumber);
}
