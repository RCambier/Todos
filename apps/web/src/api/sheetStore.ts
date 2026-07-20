import type { SheetStore } from "@memoria/sheet-core";
import { appendRow, deleteRow, getValues, TASKS_TAB, updateRow, type SheetTab } from "./sheets.js";

/**
 * The one `SheetStore` adapter: a caller's OAuth token bound to one
 * spreadsheet and one tab (Tasks by default, Notes for a notes collection),
 * over the plain-`fetch` Sheets helpers. Used identically by the web app
 * (`board/boardApi.ts`, `notes/notesApi.ts`) and the hosted MCP connector
 * (`api/_lib/sheetStore.ts`) — the operations behind it live in
 * `@memoria/sheet-core`.
 */
export class HttpSheetStore implements SheetStore {
  constructor(
    private readonly token: string,
    private readonly spreadsheetId: string,
    private readonly tab: SheetTab = TASKS_TAB,
  ) {}

  readRows(): Promise<string[][]> {
    return getValues(this.token, this.spreadsheetId, this.tab);
  }

  async appendRow(row: string[]): Promise<void> {
    await appendRow(this.token, this.spreadsheetId, row, this.tab);
  }

  async updateRow(rowNumber: number, row: string[]): Promise<void> {
    await updateRow(this.token, this.spreadsheetId, rowNumber, row, this.tab);
  }

  async deleteRow(rowNumber: number): Promise<void> {
    await deleteRow(this.token, this.spreadsheetId, rowNumber, this.tab);
  }
}
