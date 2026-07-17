/**
 * Constants describing the shape of the Todos Google Sheet. There is exactly
 * one tab, named `Tasks`, whose row 1 is a frozen header matching `HEADERS`
 * exactly (same names, same order).
 */

/** Name of the spreadsheet tab that holds tasks. */
export const SHEET_TAB_NAME = "Tasks";

/** The A1 range covering the whole tab (header + data). */
export const SHEET_RANGE = `${SHEET_TAB_NAME}!A:H`;

/**
 * Column headers, in column order (A..H). This is the contract both clients
 * validate against — the header row of the sheet must match exactly.
 */
export const HEADERS = [
  "id",
  "title",
  "status",
  "sort_order",
  "notes",
  "source",
  "created_at",
  "updated_at",
] as const;

export type Header = (typeof HEADERS)[number];

/** Google Drive `appProperties` key used to tag spreadsheets created by this app. */
export const APP_PROPERTY_KEY = "todosBoard";
export const APP_PROPERTY_VALUE = "1";
