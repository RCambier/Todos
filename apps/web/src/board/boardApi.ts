import {
  generateId,
  parseSheet,
  taskToRow,
  topSortOrder,
  type ParseResult,
  type Source,
  type Status,
  type Task,
} from "@memoria/sheet-core";
import { appendRow, deleteRow, getValues, updateRow } from "../api/sheets.js";

/** No row with the given task id was found in the freshest read. */
export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`That task was changed or removed elsewhere (id ${id} not found). Refreshing…`);
  }
}

async function readRowsAndTasks(
  token: string,
  spreadsheetId: string,
): Promise<{ tasks: Task[]; rawRows: string[][] }> {
  const rawRows = await getValues(token, spreadsheetId);
  const result = parseSheet(rawRows);
  if (!result.ok) throw new MalformedError(result);
  return { tasks: result.tasks, rawRows };
}

/** Carries the precise `sheet-core` validation error alongside a display-ready message. */
export class MalformedError extends Error {
  constructor(public readonly result: Extract<ParseResult, { ok: false }>) {
    super(result.error.message);
  }
}

function locateRow(rawRows: string[][], id: string): number {
  for (let i = 1; i < rawRows.length; i++) {
    if ((rawRows[i]?.[0] ?? "").trim() === id) return i + 1;
  }
  throw new TaskNotFoundError(id);
}

/** Reads and validates the whole board. Never throws for a malformed sheet — check `result.ok`. */
export async function fetchBoard(token: string, spreadsheetId: string): Promise<ParseResult> {
  const rawRows = await getValues(token, spreadsheetId);
  return parseSheet(rawRows);
}

/** Pure: builds the `Task` object for a new task, given the sort orders already in its column. */
export function buildNewTask(
  columnOrders: readonly number[],
  input: { title: string; notes?: string; status: Status; dueDate?: string; tags?: string[] },
  source: Source = "user",
): Task {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    title: input.title,
    status: input.status,
    sortOrder: topSortOrder(columnOrders),
    notes: input.notes ?? "",
    source,
    createdAt: now,
    updatedAt: now,
    dueDate: input.dueDate ?? "",
    tags: input.tags ?? [],
  };
}

/** Appends a newly built task as a new row. */
export async function appendTask(token: string, spreadsheetId: string, task: Task): Promise<void> {
  await appendRow(token, spreadsheetId, taskToRow(task));
}

/**
 * Edits a task's title/notes. Re-locates the row by id in a fresh read
 * first, and merges the patch onto the freshest known fields — never onto
 * a possibly-stale local copy — so a concurrent edit elsewhere is only
 * ever overwritten in the one field this client actually changed.
 */
export async function editTask(
  token: string,
  spreadsheetId: string,
  id: string,
  patch: { title?: string; notes?: string; dueDate?: string; tags?: string[] },
): Promise<Task> {
  const { tasks, rawRows } = await readRowsAndTasks(token, spreadsheetId);
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
  await updateRow(token, spreadsheetId, rowNumber, taskToRow(updated));
  return updated;
}

/** Moves a task to `status` at `sortOrder` (computed by the caller from local column order). */
export async function relocateTask(
  token: string,
  spreadsheetId: string,
  id: string,
  status: Status,
  sortOrder: number,
): Promise<Task> {
  const { tasks, rawRows } = await readRowsAndTasks(token, spreadsheetId);
  const current = tasks.find((t) => t.id === id);
  if (!current) throw new TaskNotFoundError(id);

  const updated: Task = { ...current, status, sortOrder, updatedAt: new Date().toISOString() };
  const rowNumber = locateRow(rawRows, id);
  await updateRow(token, spreadsheetId, rowNumber, taskToRow(updated));
  return updated;
}

export async function removeTask(token: string, spreadsheetId: string, id: string): Promise<void> {
  const { rawRows } = await readRowsAndTasks(token, spreadsheetId);
  const rowNumber = locateRow(rawRows, id);
  await deleteRow(token, spreadsheetId, rowNumber);
}
