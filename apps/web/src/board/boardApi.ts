import {
  appendTaskIfAbsent as appendTaskOp,
  buildTask,
  deleteTask,
  fetchBoard as fetchBoardOp,
  moveTask,
  updateTask,
  type ParseResult,
  type Recurrence,
  type Status,
  type Task,
} from "@memoria/sheet-core";
import { HttpSheetStore } from "../api/sheetStore.js";

/**
 * Thin (token, spreadsheetId) façade over the sheet-core board operations —
 * the write-safety invariant itself (fresh read → validate → locate row by
 * id → touch one row) lives in `@memoria/sheet-core`, shared verbatim with
 * the MCP tools.
 */

function store(token: string, spreadsheetId: string): HttpSheetStore {
  return new HttpSheetStore(token, spreadsheetId);
}

/** Reads and validates the whole board. Never throws for a malformed sheet — check `result.ok`. */
export function fetchBoard(token: string, spreadsheetId: string): Promise<ParseResult> {
  return fetchBoardOp(store(token, spreadsheetId));
}

/** Pure: builds the `Task` object for a new user-created task (the optimistic-UI path). */
export function buildNewTask(
  columnOrders: readonly number[],
  input: {
    title: string;
    notes?: string;
    status: Status;
    dueDate?: string;
    blockedUntil?: string;
    tags?: string[];
  },
): Task {
  return buildTask(columnOrders, input, "user");
}

/**
 * Appends a newly built task, replay-safely: the flusher may retry an append
 * whose response was lost, so the shared op re-reads and skips if the id is
 * already on the sheet (never a duplicate row).
 */
export function appendTask(token: string, spreadsheetId: string, task: Task): Promise<void> {
  return appendTaskOp(store(token, spreadsheetId), task);
}

/** Edits a task's fields; merges the patch onto the freshest read, never a stale local copy. */
export function editTask(
  token: string,
  spreadsheetId: string,
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
  return updateTask(store(token, spreadsheetId), id, patch);
}

/** Moves a task to `status` at `sortOrder` (computed by the caller from the drop position). */
export function relocateTask(
  token: string,
  spreadsheetId: string,
  id: string,
  status: Status,
  sortOrder: number,
): Promise<Task> {
  return moveTask(store(token, spreadsheetId), id, status, sortOrder);
}

export function removeTask(token: string, spreadsheetId: string, id: string): Promise<void> {
  return deleteTask(store(token, spreadsheetId), id);
}
