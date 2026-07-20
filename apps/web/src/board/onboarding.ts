import { isBlankRow, parseSheet } from "@memoria/sheet-core";
import { moveToFolder, tagAsBoard, tagAsNotes, type CollectionKind } from "../api/drive.js";
import { ensureMemoriaFolders, folderForKind, markOrganized } from "../api/folders.js";
import { createSpreadsheet, getValues, NOTES_TAB, TASKS_TAB, writeHeaderRow } from "../api/sheets.js";

/**
 * Creates a brand-new collection: a spreadsheet with the right tab + header
 * row, the appProperties tag for reconnect, filed under `Memoria/boards/`
 * or `Memoria/notes/` in the user's Drive. Filing is best-effort — a
 * failure leaves the sheet in the Drive root, where the boot-time organizer
 * will pick it up later.
 */
export async function createCollection(token: string, title: string, kind: CollectionKind): Promise<string> {
  const tab = kind === "notes" ? NOTES_TAB : TASKS_TAB;
  const spreadsheetId = await createSpreadsheet(token, title, tab);
  await writeHeaderRow(token, spreadsheetId, tab);
  await (kind === "notes" ? tagAsNotes(token, spreadsheetId) : tagAsBoard(token, spreadsheetId));
  try {
    const folders = await ensureMemoriaFolders(token);
    await moveToFolder(token, spreadsheetId, folderForKind(folders, kind));
    markOrganized(spreadsheetId);
  } catch {
    // Left unfiled; organizeCollections retries on a later boot.
  }
  return spreadsheetId;
}

/** Creates a brand-new board (kept for existing call sites and tests). */
export async function createBoard(token: string, title = "Todos"): Promise<string> {
  return createCollection(token, title, "board");
}

export type AttachOutcome =
  { kind: "attached" } | { kind: "bootstrapped" } | { kind: "refused"; reason: string };

/**
 * Handles the "use an existing sheet" path (Picker result): an empty sheet
 * gets headers bootstrapped and becomes a board; a sheet with valid Todos
 * headers is attached as-is; anything else is refused with a precise reason
 * rather than silently reinterpreted. Attached sheets stay where the user
 * keeps them — they explicitly chose that file, so we don't move it.
 */
export async function attachOrBootstrap(token: string, spreadsheetId: string): Promise<AttachOutcome> {
  const rawRows = await getValues(token, spreadsheetId);
  const isEmpty = rawRows.length === 0 || rawRows.every(isBlankRow);
  if (isEmpty) {
    await writeHeaderRow(token, spreadsheetId);
    await tagAsBoard(token, spreadsheetId);
    markOrganized(spreadsheetId); // user-picked: leave it where they keep it
    return { kind: "bootstrapped" };
  }

  const result = parseSheet(rawRows);
  if (result.ok) {
    await tagAsBoard(token, spreadsheetId);
    markOrganized(spreadsheetId);
    return { kind: "attached" };
  }
  return { kind: "refused", reason: result.error.message };
}
