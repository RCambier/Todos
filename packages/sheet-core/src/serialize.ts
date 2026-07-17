import { HEADERS } from "./headers.js";
import { isStatus, type SheetRow, type Source, type Task } from "./types.js";

/** A single field failed validation. Carries enough to build a precise, human-readable error. */
export class RowValidationError extends Error {
  constructor(
    public readonly column: (typeof HEADERS)[number],
    public readonly value: string,
  ) {
    super(`Invalid value for column "${column}": ${JSON.stringify(value)}`);
    this.name = "RowValidationError";
  }
}

function cell(row: SheetRow, index: number): string {
  return row[index] ?? "";
}

function coerceSource(value: string): Source {
  return value === "agent" ? "agent" : "user";
}

/**
 * Converts one validated raw row into a `Task`. Throws `RowValidationError`
 * if a required field is missing or malformed — callers that already know
 * the row is well-formed (e.g. round-tripping a task they just wrote) don't
 * need to catch it; `parseSheet` uses the thrown error to build a precise,
 * row-located message for the user.
 */
export function rowToTask(row: SheetRow): Task {
  const id = cell(row, 0).trim();
  if (id === "") throw new RowValidationError("id", cell(row, 0));

  const title = cell(row, 1).trim();
  if (title === "") throw new RowValidationError("title", cell(row, 1));

  const statusRaw = cell(row, 2).trim();
  if (!isStatus(statusRaw)) throw new RowValidationError("status", cell(row, 2));

  const sortOrderRaw = cell(row, 3).trim();
  const sortOrder = Number(sortOrderRaw);
  if (sortOrderRaw === "" || Number.isNaN(sortOrder)) {
    throw new RowValidationError("sort_order", cell(row, 3));
  }

  const notes = cell(row, 4);
  const source = coerceSource(cell(row, 5).trim());
  const createdAt = cell(row, 6).trim();
  if (createdAt === "") throw new RowValidationError("created_at", cell(row, 6));
  const updatedAt = cell(row, 7).trim();
  if (updatedAt === "") throw new RowValidationError("updated_at", cell(row, 7));

  return {
    id,
    title,
    status: statusRaw,
    sortOrder,
    notes,
    source,
    createdAt,
    updatedAt,
  };
}

/** Converts a `Task` into a raw row, in `HEADERS` column order, ready to write. */
export function taskToRow(task: Task): SheetRow {
  return [
    task.id,
    task.title,
    task.status,
    String(task.sortOrder),
    task.notes,
    task.source,
    task.createdAt,
    task.updatedAt,
  ];
}

/** True if every cell in the row is empty — such rows are ignored, not errors. */
export function isBlankRow(row: SheetRow): boolean {
  return row.every((c) => (c ?? "").trim() === "");
}
