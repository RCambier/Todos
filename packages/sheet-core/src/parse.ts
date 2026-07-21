import { parseItemRows, type SheetError } from "./grid.js";
import { HEADERS, LEGACY_HEADER_SHAPES } from "./headers.js";
import { RowValidationError, rowToTask } from "./serialize.js";
import type { SheetRow, Task } from "./types.js";

export type { SheetError } from "./grid.js";

export type ParseResult =
  | {
      ok: true;
      tasks: Task[];
      /**
       * True when the sheet still has an older header generation (see
       * `LEGACY_HEADER_SHAPES`). Tasks parse fine (the missing fields are
       * just empty); the web app uses this flag to extend the header row in
       * place — an additive write of new header cells, never touching data.
       */
      legacyHeader: boolean;
    }
  | { ok: false; error: SheetError };

/** True if `row` matches `headers` exactly — same names, same order, nothing extra. */
function matchesHeaders(row: SheetRow, headers: readonly string[]): boolean {
  if (row.length < headers.length) return false;
  for (let i = 0; i < row.length; i++) {
    const expected = headers[i] ?? "";
    if ((row[i] ?? "").trim() !== expected) return false;
  }
  return true;
}

function headerError(row: SheetRow | undefined): SheetError | null {
  if (row === undefined || row.length === 0) {
    return {
      row: 1,
      column: null,
      value: null,
      message: `Row 1: the header row is missing. Expected: ${HEADERS.join(", ")}.`,
    };
  }
  for (let i = 0; i < HEADERS.length; i++) {
    const expected = HEADERS[i]!;
    const actual = (row[i] ?? "").trim();
    if (actual !== expected) {
      return {
        row: 1,
        column: expected,
        value: actual,
        message: `Row 1: expected column ${i + 1} to be "${expected}", found "${actual || "(empty)"}". Header row must be exactly: ${HEADERS.join(", ")}.`,
      };
    }
  }
  return null;
}

function fieldErrorMessage(row: number, err: RowValidationError): SheetError {
  const { column, value } = err;
  let message: string;
  switch (column) {
    case "id":
      message = `Row ${row}: id is required but was empty.`;
      break;
    case "title":
      message = `Row ${row}: title is required but was empty.`;
      break;
    case "status":
      message = `Row ${row}: status is required but was empty.`;
      break;
    case "sort_order":
      message = `Row ${row}: sort_order "${value}" isn't a number.`;
      break;
    case "created_at":
      message = `Row ${row}: created_at is required but was empty.`;
      break;
    case "updated_at":
      message = `Row ${row}: updated_at is required but was empty.`;
      break;
    case "due_date":
      message = `Row ${row}: due_date "${value}" isn't a YYYY-MM-DD date (leave it empty for no due date).`;
      break;
    case "recurs":
      message = `Row ${row}: recurs "${value}" isn't supported — use "yearly" or leave it empty.`;
      break;
    default:
      message = `Row ${row}: ${column} "${value}" is invalid.`;
  }
  return { row, column, value, message };
}

/**
 * Validates and parses the full `Tasks` sheet (header + data rows, as
 * returned by a Sheets `values.get` call on the Tasks tab). Never throws.
 *
 * Returns every valid task on success, or the first problem found on
 * failure, described precisely enough to fix without guessing (row,
 * column, offending value, and a plain-English sentence).
 */
export function parseSheet(rows: readonly SheetRow[]): ParseResult {
  const headerRow = rows[0];
  const legacyHeader =
    headerRow !== undefined && LEGACY_HEADER_SHAPES.some((shape) => matchesHeaders(headerRow, shape));
  if (!legacyHeader) {
    const hErr = headerError(rows[0]);
    if (hErr) return { ok: false, error: hErr };
  }

  const result = parseItemRows(rows, {
    rowToItem: rowToTask,
    idOf: (task) => task.id,
    fieldError: fieldErrorMessage,
  });
  if (!result.ok) return result;
  return { ok: true, tasks: result.items, legacyHeader };
}
