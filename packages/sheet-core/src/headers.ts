/**
 * Constants describing the shape of the Todos Google Sheet. There is exactly
 * one tab, named `Tasks`, whose row 1 is a frozen header matching `HEADERS`
 * exactly (same names, same order).
 */

/** Name of the spreadsheet tab that holds tasks. */
export const SHEET_TAB_NAME = "Tasks";

/**
 * Column headers, in column order (A..K). This is the contract both clients
 * validate against — the header row of the sheet must match exactly (or
 * match one of `LEGACY_HEADER_SHAPES`, the older generations; see
 * `parseSheet`).
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
  "due_date",
  "tags",
  "blocked_until",
  "recurs",
] as const;

/** The A1 range covering the whole tab (header + data). */
export const SHEET_RANGE = `${SHEET_TAB_NAME}!A:${String.fromCharCode(64 + HEADERS.length)}`;

/**
 * Every previous generation of the header, oldest first: the original
 * 8-column shape (before `due_date` and `tags`), the 10-column shape
 * (before `blocked_until`), and the 11-column shape (before `recurs`).
 * Sheets with one of these headers still parse — the missing fields are
 * just empty — and the web app extends the header in place (an additive,
 * non-destructive write of the new header cells) the first time it loads
 * one.
 */
export const LEGACY_HEADER_SHAPES: readonly (readonly string[])[] = [
  HEADERS.slice(0, 8),
  HEADERS.slice(0, 10),
  HEADERS.slice(0, 11),
];

/** Google Drive `appProperties` key used to tag spreadsheets created by this app. */
export const APP_PROPERTY_KEY = "todosBoard";
export const APP_PROPERTY_VALUE = "1";
