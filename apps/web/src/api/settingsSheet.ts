import {
  parseSettingsSheet,
  SETTINGS_HEADERS,
  SETTINGS_TAB_NAME,
  settingsToRows,
  type AppSettings,
} from "@memoria/sheet-core";
import { findSettingsSheet, moveToFolder, tagAsSettings } from "./drive.js";
import { ensureMemoriaFolders } from "./folders.js";
import {
  createSpreadsheet,
  getValues,
  overwriteTab,
  protectAllTabs,
  writeHeaderRow,
  type SheetTab,
} from "./sheets.js";

export const SETTINGS_TAB: SheetTab = { name: SETTINGS_TAB_NAME, headers: SETTINGS_HEADERS };

/**
 * Finds the Settings spreadsheet, creating it on first use: a "Settings"
 * spreadsheet with the key/value tab + header, tagged for reconnect, warn-
 * protected, filed at the top of the `Memoria/` folder (next to `todos/`,
 * `notes/`, `memories/`). Protection and filing are best-effort — a failure
 * leaves a working settings sheet, just unprotected or in the Drive root.
 */
export async function ensureSettingsSheet(token: string): Promise<string> {
  const existing = await findSettingsSheet(token);
  if (existing) return existing;

  const spreadsheetId = await createSpreadsheet(token, "Settings", SETTINGS_TAB);
  await writeHeaderRow(token, spreadsheetId, SETTINGS_TAB);
  await tagAsSettings(token, spreadsheetId);
  try {
    await protectAllTabs(token, spreadsheetId);
  } catch {
    // Left unprotected; the warning banner is cosmetic, never load-bearing.
  }
  try {
    const folders = await ensureMemoriaFolders(token);
    await moveToFolder(token, spreadsheetId, folders.memoriaId);
  } catch {
    // Left unfiled in the Drive root; settings still work by tag lookup.
  }
  return spreadsheetId;
}

/** Reads the whole settings grid. */
export async function readSettings(token: string, spreadsheetId: string): Promise<AppSettings> {
  return parseSettingsSheet(await getValues(token, spreadsheetId, SETTINGS_TAB));
}

/**
 * Overwrites the whole settings grid. Callers pass the full map (read-modify-
 * write), so an unrelated key set on another device survives a toggle here
 * as long as it was in the last read.
 */
export async function writeSettings(
  token: string,
  spreadsheetId: string,
  settings: AppSettings,
): Promise<void> {
  await overwriteTab(token, spreadsheetId, SETTINGS_TAB, settingsToRows(settings));
}
