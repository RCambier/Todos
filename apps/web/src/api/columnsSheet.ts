import { columnsToRows, parseColumnsSheet, type BoardColumn } from "@memoria/sheet-core";
import { addTab, COLUMNS_TAB, getValues, listTabs, overwriteTab } from "./sheets.js";

/**
 * Reads a Todos board's `Columns` tab. Returns `null` when the tab doesn't
 * exist yet (a board created before customizable columns) — the caller
 * decides whether to migrate — and the parsed column list otherwise
 * (possibly empty, if the tab is header-only).
 */
export async function readColumnsTab(token: string, spreadsheetId: string): Promise<BoardColumn[] | null> {
  const tabs = await listTabs(token, spreadsheetId);
  if (!tabs.some((t) => t.title === COLUMNS_TAB.name)) return null;
  const rows = await getValues(token, spreadsheetId, COLUMNS_TAB);
  return parseColumnsSheet(rows).columns;
}

/**
 * Writes the board's columns to its `Columns` tab, creating the tab first if
 * it's missing. A whole-tab overwrite (not a surgical row write) because
 * reordering or removing a column inherently rewrites the small config grid —
 * this touches only the settings tab, never a task row.
 */
export async function writeColumnsTab(
  token: string,
  spreadsheetId: string,
  columns: readonly BoardColumn[],
): Promise<void> {
  const tabs = await listTabs(token, spreadsheetId);
  if (!tabs.some((t) => t.title === COLUMNS_TAB.name)) {
    await addTab(token, spreadsheetId, COLUMNS_TAB.name);
  }
  await overwriteTab(token, spreadsheetId, COLUMNS_TAB, columnsToRows(columns));
}
