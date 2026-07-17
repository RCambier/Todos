import { HEADERS, SHEET_RANGE, SHEET_TAB_NAME } from "@todos/sheet-core";
import { authedFetch, authedJson } from "./http.js";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

function rowRange(rowNumber: number): string {
  return `${SHEET_TAB_NAME}!A${rowNumber}:H${rowNumber}`;
}

/** Reads every row currently in the Tasks tab, header included. */
export async function getValues(token: string, spreadsheetId: string): Promise<string[][]> {
  const url = `${BASE}/${spreadsheetId}/values/${encodeURIComponent(SHEET_RANGE)}`;
  const data = await authedJson<{ values?: string[][] }>(token, url);
  return data.values ?? [];
}

/** Appends one row after the tab's last row (used for inserts). */
export async function appendRow(token: string, spreadsheetId: string, row: string[]): Promise<void> {
  const url =
    `${BASE}/${spreadsheetId}/values/${encodeURIComponent(SHEET_RANGE)}:append` +
    `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  await authedFetch(token, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
}

/** Overwrites exactly one existing row (1-indexed spreadsheet row, header = 1). */
export async function updateRow(
  token: string,
  spreadsheetId: string,
  rowNumber: number,
  row: string[],
): Promise<void> {
  const url = `${BASE}/${spreadsheetId}/values/${encodeURIComponent(rowRange(rowNumber))}?valueInputOption=RAW`;
  await authedFetch(token, url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
}

/** Fetches the tab's internal numeric sheetId, needed for row deletion. */
export async function getTabSheetId(token: string, spreadsheetId: string): Promise<number> {
  const url = `${BASE}/${spreadsheetId}?fields=sheets.properties`;
  const data = await authedJson<{ sheets?: { properties?: { title?: string; sheetId?: number } }[] }>(
    token,
    url,
  );
  const tab = data.sheets?.find((s) => s.properties?.title === SHEET_TAB_NAME);
  if (!tab?.properties || tab.properties.sheetId == null) {
    throw new Error(`This spreadsheet has no tab named "${SHEET_TAB_NAME}".`);
  }
  return tab.properties.sheetId;
}

/** Deletes exactly one row. */
export async function deleteRow(token: string, spreadsheetId: string, rowNumber: number): Promise<void> {
  const sheetId = await getTabSheetId(token, spreadsheetId);
  const url = `${BASE}/${spreadsheetId}:batchUpdate`;
  await authedFetch(token, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber },
          },
        },
      ],
    }),
  });
}

/** Creates a new spreadsheet with a single `Tasks` tab. Returns its spreadsheet ID. */
export async function createSpreadsheet(token: string, title: string): Promise<string> {
  const data = await authedJson<{ spreadsheetId: string }>(token, BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: SHEET_TAB_NAME } }],
    }),
  });
  return data.spreadsheetId;
}

/** Writes the header row (used when creating a board or bootstrapping an empty attached sheet). */
export async function writeHeaderRow(token: string, spreadsheetId: string): Promise<void> {
  await updateRow(token, spreadsheetId, 1, [...HEADERS]);
}
