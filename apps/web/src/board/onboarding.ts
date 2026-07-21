import { DEFAULT_NEW_COLUMNS } from "@memoria/sheet-core";
import { writeColumnsTab } from "../api/columnsSheet.js";
import { moveToFolder, tagAsBoard, tagAsMemories, tagAsNotes, type CollectionKind } from "../api/drive.js";
import { ensureMemoriaFolders, folderForKind, markOrganized } from "../api/folders.js";
import {
  createSpreadsheet,
  MEMORIES_TAB,
  NOTES_TAB,
  protectAllTabs,
  TASKS_TAB,
  writeHeaderRow,
  type SheetTab,
} from "../api/sheets.js";

function tabForKind(kind: CollectionKind): SheetTab {
  return kind === "memories" ? MEMORIES_TAB : kind === "notes" ? NOTES_TAB : TASKS_TAB;
}

function tagForKind(token: string, spreadsheetId: string, kind: CollectionKind): Promise<void> {
  return kind === "memories"
    ? tagAsMemories(token, spreadsheetId)
    : kind === "notes"
      ? tagAsNotes(token, spreadsheetId)
      : tagAsBoard(token, spreadsheetId);
}

/**
 * Creates a brand-new collection sheet: a spreadsheet with the right tab +
 * header row, the appProperties tag for reconnect, filed under
 * `Memoria/todos/`, `Memoria/notes/`, or `Memoria/memories/` in the user's Drive. Filing is
 * best-effort — a failure leaves the sheet in the Drive root, where the
 * boot-time organizer will pick it up later.
 */
export async function createCollection(token: string, title: string, kind: CollectionKind): Promise<string> {
  const tab = tabForKind(kind);
  const spreadsheetId = await createSpreadsheet(token, title, tab);
  await writeHeaderRow(token, spreadsheetId, tab);
  await tagForKind(token, spreadsheetId, kind);
  // A brand-new board starts with the default three columns (Backlog / In
  // progress / Done). Best-effort: a failure just defers to migration-on-load.
  if (kind === "board") {
    try {
      await writeColumnsTab(token, spreadsheetId, DEFAULT_NEW_COLUMNS);
    } catch {
      // Left without a Columns tab; useColumns migrates it on first load.
    }
  }
  // Every tab gets the warn-on-manual-edit protection: the sheets are the
  // app's storage, so hand edits in the Sheets UI deserve an "are you sure?".
  try {
    await protectAllTabs(token, spreadsheetId);
  } catch {
    // Left unprotected; the warning banner is cosmetic, never load-bearing.
  }
  try {
    const folders = await ensureMemoriaFolders(token);
    await moveToFolder(token, spreadsheetId, folderForKind(folders, kind));
    markOrganized(spreadsheetId);
  } catch {
    // Left unfiled; organizeCollections retries on a later boot.
  }
  return spreadsheetId;
}
