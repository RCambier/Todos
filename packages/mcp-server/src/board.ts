import {
  boardOrder,
  generateId,
  parseSheet,
  STATUSES,
  taskToRow,
  topSortOrder,
  type Status,
  type Task,
} from "@memoria/sheet-core";
import type { SheetStore } from "./sheetStore.js";

/** The sheet failed `sheet-core` validation. Message is precise and ready to show the user. */
export class MalformedSheetError extends Error {}

/** No row with the given task id was found in the freshest read. */
export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`No task with id "${id}" was found. It may have been deleted or moved — try list_tasks again.`);
  }
}

async function readValidTasks(client: SheetStore): Promise<{ tasks: Task[]; rawRows: string[][] }> {
  const rawRows = await client.readRows();
  const result = parseSheet(rawRows);
  if (!result.ok) {
    throw new MalformedSheetError(
      `The sheet doesn't match the expected format — ${result.error.message} ` +
        "Fix it in Google Sheets (or ask the user to), then try again.",
    );
  }
  return { tasks: result.tasks, rawRows };
}

/**
 * Locates a task's current spreadsheet row by scanning the freshest read.
 * Every write re-locates by id first — rows are never addressed by a
 * remembered position, since other clients may have inserted or deleted
 * rows since the last read.
 */
function locateRow(rawRows: string[][], id: string): number {
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i]!;
    if ((row[0] ?? "").trim() === id) return i + 1;
  }
  throw new TaskNotFoundError(id);
}

export async function listTasks(client: SheetStore, status?: Status): Promise<Task[]> {
  const { tasks } = await readValidTasks(client);
  const filtered = status ? tasks.filter((t) => t.status === status) : tasks;
  return boardOrder(filtered, STATUSES);
}

export async function addTask(
  client: SheetStore,
  input: { title: string; notes?: string; status?: Status; dueDate?: string; tags?: string[] },
): Promise<Task> {
  const { tasks } = await readValidTasks(client);
  const status = input.status ?? "backlog";
  const columnOrders = tasks.filter((t) => t.status === status).map((t) => t.sortOrder);
  const now = new Date().toISOString();
  const task: Task = {
    id: generateId(),
    title: input.title,
    status,
    sortOrder: topSortOrder(columnOrders),
    notes: input.notes ?? "",
    source: "agent",
    createdAt: now,
    updatedAt: now,
    dueDate: input.dueDate ?? "",
    tags: input.tags ?? [],
  };
  await client.appendRow(taskToRow(task));
  return task;
}

export async function updateTask(
  client: SheetStore,
  id: string,
  patch: { title?: string; notes?: string; dueDate?: string; tags?: string[] },
): Promise<Task> {
  const { tasks, rawRows } = await readValidTasks(client);
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
  await client.updateRow(rowNumber, taskToRow(updated));
  return updated;
}

export async function moveTask(client: SheetStore, id: string, status: Status): Promise<Task> {
  const { tasks, rawRows } = await readValidTasks(client);
  const current = tasks.find((t) => t.id === id);
  if (!current) throw new TaskNotFoundError(id);

  const columnOrders = tasks.filter((t) => t.status === status && t.id !== id).map((t) => t.sortOrder);
  const updated: Task = {
    ...current,
    status,
    sortOrder: topSortOrder(columnOrders),
    updatedAt: new Date().toISOString(),
  };
  const rowNumber = locateRow(rawRows, id);
  await client.updateRow(rowNumber, taskToRow(updated));
  return updated;
}

export async function completeTask(client: SheetStore, id: string): Promise<Task> {
  return moveTask(client, id, "done");
}

export async function deleteTask(client: SheetStore, id: string): Promise<void> {
  const { rawRows } = await readValidTasks(client);
  const rowNumber = locateRow(rawRows, id);
  await client.deleteRow(rowNumber);
}
