import { locateRowById, type SheetError } from "./grid.js";
import { generateId } from "./id.js";
import { boardOrder, topSortOrder } from "./ordering.js";
import { parseSheet, type ParseResult } from "./parse.js";
import { taskToRow } from "./serialize.js";
import type { SheetStore } from "./store.js";
import { STATUSES, type Source, type Status, type Task } from "./types.js";

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
  tags?: string[];
}

/** Pure: builds the `Task` for a new entry, given the sort orders already in its column. */
export function buildTask(columnOrders: readonly number[], input: NewTaskInput, source: Source): Task {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    title: input.title,
    status: input.status ?? "backlog",
    sortOrder: topSortOrder(columnOrders),
    notes: input.notes ?? "",
    source,
    createdAt: now,
    updatedAt: now,
    dueDate: input.dueDate ?? "",
    tags: input.tags ?? [],
  };
}

/** Appends an already-built task as a new row (the optimistic-UI path: build first, write after). */
export async function appendTask(store: SheetStore, task: Task): Promise<void> {
  await store.appendRow(taskToRow(task));
}

export async function listTasks(store: SheetStore, status?: Status): Promise<Task[]> {
  const { tasks } = await readValidTasks(store);
  const filtered = status ? tasks.filter((t) => t.status === status) : tasks;
  return boardOrder(filtered, STATUSES);
}

/** Reads the board, builds the task at the top of its column, and appends it. */
export async function addTask(store: SheetStore, input: NewTaskInput, source: Source): Promise<Task> {
  const { tasks } = await readValidTasks(store);
  const status = input.status ?? "backlog";
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
  patch: { title?: string; notes?: string; dueDate?: string; tags?: string[] },
): Promise<Task> {
  const { tasks, rawRows } = await readValidTasks(store);
  const current = tasks.find((t) => t.id === id);
  if (!current) throw new TaskNotFoundError(id);

  const updated: Task = {
    ...current,
    title: patch.title ?? current.title,
    notes: patch.notes ?? current.notes,
    dueDate: patch.dueDate ?? current.dueDate,
    tags: patch.tags ?? current.tags,
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
 */
export async function moveTask(
  store: SheetStore,
  id: string,
  status: Status,
  sortOrder?: number,
): Promise<Task> {
  const { tasks, rawRows } = await readValidTasks(store);
  const current = tasks.find((t) => t.id === id);
  if (!current) throw new TaskNotFoundError(id);

  const resolvedSortOrder =
    sortOrder ??
    topSortOrder(tasks.filter((t) => t.status === status && t.id !== id).map((t) => t.sortOrder));
  const updated: Task = {
    ...current,
    status,
    sortOrder: resolvedSortOrder,
    updatedAt: new Date().toISOString(),
  };
  const rowNumber = locateRow(rawRows, id);
  await store.updateRow(rowNumber, taskToRow(updated));
  return updated;
}

export async function completeTask(store: SheetStore, id: string): Promise<Task> {
  return moveTask(store, id, "done");
}

export async function deleteTask(store: SheetStore, id: string): Promise<void> {
  const { rawRows } = await readValidTasks(store);
  const rowNumber = locateRow(rawRows, id);
  await store.deleteRow(rowNumber);
}
