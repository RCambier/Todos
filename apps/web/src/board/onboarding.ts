import { isBlankRow, parseSheet } from "@todos/sheet-core";
import { tagAsBoard } from "../api/drive.js";
import { createSpreadsheet, getValues, writeHeaderRow } from "../api/sheets.js";

/** Creates a brand-new board: a spreadsheet, header row, and the appProperties tag for reconnect. */
export async function createBoard(token: string, title = "Todos"): Promise<string> {
  const spreadsheetId = await createSpreadsheet(token, title);
  await writeHeaderRow(token, spreadsheetId);
  await tagAsBoard(token, spreadsheetId);
  return spreadsheetId;
}

export type AttachOutcome =
  { kind: "attached" } | { kind: "bootstrapped" } | { kind: "refused"; reason: string };

/**
 * Handles the "use an existing sheet" path (Picker result): an empty sheet
 * gets headers bootstrapped and becomes a board; a sheet with valid Todos
 * headers is attached as-is; anything else is refused with a precise reason
 * rather than silently reinterpreted.
 */
export async function attachOrBootstrap(token: string, spreadsheetId: string): Promise<AttachOutcome> {
  const rawRows = await getValues(token, spreadsheetId);
  const isEmpty = rawRows.length === 0 || rawRows.every(isBlankRow);
  if (isEmpty) {
    await writeHeaderRow(token, spreadsheetId);
    await tagAsBoard(token, spreadsheetId);
    return { kind: "bootstrapped" };
  }

  const result = parseSheet(rawRows);
  if (result.ok) {
    await tagAsBoard(token, spreadsheetId);
    return { kind: "attached" };
  }
  return { kind: "refused", reason: result.error.message };
}
