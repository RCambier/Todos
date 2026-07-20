import { isBlankRow, RowValidationError } from "./serialize.js";
import type { SheetRow } from "./types.js";

/**
 * The pieces of sheet-reading that are identical for every collection kind
 * (tasks, notes): walking data rows into items with precise, row-located
 * errors, and re-locating a row by its id column. Domain modules
 * (`parse.ts`, `notes.ts`) own their header contracts and field messages;
 * this module owns the loop.
 */

/**
 * A precise, human-readable description of why a sheet failed validation.
 * `row` is the 1-indexed spreadsheet row (row 1 is the header). `column`
 * and `value` are `null` for sheet-level problems (e.g. a missing or wrong
 * header row) and set for a single bad cell.
 */
export interface SheetError {
  row: number;
  column: string | null;
  value: string | null;
  message: string;
}

export interface ParseItemsSpec<T> {
  /** Converts one raw row; throws `RowValidationError` for a bad field. */
  rowToItem(row: SheetRow): T;
  idOf(item: T): string;
  /** Wraps a field failure in the domain's human sentence for that column. */
  fieldError(rowNumber: number, err: RowValidationError): SheetError;
}

/**
 * Walks the data rows (everything after the header) into items: blank rows
 * are skipped, the first bad cell or duplicated id stops the walk with a
 * precise error. Shared by the tasks and notes parsers — the domain modules
 * validate their header row first, then hand the rows here.
 */
export function parseItemRows<T>(
  rows: readonly SheetRow[],
  spec: ParseItemsSpec<T>,
): { ok: true; items: T[] } | { ok: false; error: SheetError } {
  const items: T[] = [];
  const idToRow = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (isBlankRow(row)) continue;

    const rowNumber = i + 1;
    try {
      const item = spec.rowToItem(row);
      const id = spec.idOf(item);
      const firstSeenAt = idToRow.get(id);
      if (firstSeenAt !== undefined) {
        return {
          ok: false,
          error: {
            row: rowNumber,
            column: "id",
            value: id,
            message: `Row ${rowNumber}: id "${id}" is already used by row ${firstSeenAt} — ids must be unique.`,
          },
        };
      }
      idToRow.set(id, rowNumber);
      items.push(item);
    } catch (err) {
      if (err instanceof RowValidationError) {
        return { ok: false, error: spec.fieldError(rowNumber, err) };
      }
      throw err;
    }
  }

  return { ok: true, items };
}

/**
 * Locates an item's current spreadsheet row (1-indexed) by scanning the
 * freshest read's id column. Rows are never addressed by a remembered
 * position — other clients may have inserted or deleted rows since the last
 * read. Returns `null` when the id is gone; callers throw their domain's
 * not-found error.
 */
export function locateRowById(rawRows: string[][], id: string): number | null {
  for (let i = 1; i < rawRows.length; i++) {
    if ((rawRows[i]?.[0] ?? "").trim() === id) return i + 1;
  }
  return null;
}
