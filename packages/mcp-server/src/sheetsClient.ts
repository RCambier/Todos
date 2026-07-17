import { google, type sheets_v4 } from "googleapis";
import { SHEET_RANGE, SHEET_TAB_NAME } from "@todos/sheet-core";

/**
 * The narrow surface `board.ts` needs. `SheetsClient` implements this
 * structurally; tests can supply a lightweight fake instead of talking to
 * the real Sheets API.
 */
export interface SheetStore {
  readRows(): Promise<string[][]>;
  appendRow(row: string[]): Promise<void>;
  updateRow(rowNumber: number, row: string[]): Promise<void>;
  deleteRow(rowNumber: number): Promise<void>;
}

/**
 * Thin wrapper around the Sheets v4 API for the one tab this app cares
 * about. Every write here is surgical (append one row, overwrite one row,
 * delete one row) — never a whole-grid write. Row numbers are always
 * 1-indexed spreadsheet rows (row 1 is the header).
 */
export class SheetsClient implements SheetStore {
  private cachedTabSheetId: number | undefined;

  private constructor(
    private readonly sheets: sheets_v4.Sheets,
    private readonly spreadsheetId: string,
  ) {}

  static async create(spreadsheetId: string, credentialsPath: string): Promise<SheetsClient> {
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    return new SheetsClient(sheets, spreadsheetId);
  }

  /** Reads every row currently in the tab, header included. */
  async readRows(): Promise<string[][]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: SHEET_RANGE,
    });
    return (res.data.values ?? []) as string[][];
  }

  /** Appends one row after the tab's last row. */
  async appendRow(row: string[]): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: SHEET_RANGE,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  }

  /** Overwrites exactly one existing row. */
  async updateRow(rowNumber: number, row: string[]): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_TAB_NAME}!A${rowNumber}:H${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  }

  /** Deletes exactly one row. */
  async deleteRow(rowNumber: number): Promise<void> {
    const sheetId = await this.tabSheetId();
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: rowNumber - 1,
                endIndex: rowNumber,
              },
            },
          },
        ],
      },
    });
  }

  /** Confirms the spreadsheet is reachable with current credentials (used for startup checks). */
  async ping(): Promise<void> {
    await this.tabSheetId();
  }

  private async tabSheetId(): Promise<number> {
    if (this.cachedTabSheetId !== undefined) return this.cachedTabSheetId;
    const res = await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const tab = res.data.sheets?.find((s) => s.properties?.title === SHEET_TAB_NAME);
    if (!tab || tab.properties?.sheetId == null) {
      throw new Error(
        `The spreadsheet has no tab named "${SHEET_TAB_NAME}". This doesn't look like a Todos board.`,
      );
    }
    this.cachedTabSheetId = tab.properties.sheetId;
    return this.cachedTabSheetId;
  }
}
