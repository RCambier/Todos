import type { SheetRow } from "./types.js";

/**
 * App-wide settings live in their own small spreadsheet, `Settings`, at the
 * top of the user's `Memoria/` Drive folder — one `Settings` tab, one
 * key/value row per setting. Storing them in Drive (not localStorage) makes
 * a setting follow the account across browsers and devices. Like the
 * `Columns` tab, parsing is deliberately lenient — this is settings, not
 * user data: a malformed row is skipped, never fatal, and a missing key just
 * means "default".
 */

/** Name of the settings spreadsheet's single tab (and of the file itself). */
export const SETTINGS_TAB_NAME = "Settings";

/** Column headers for the `Settings` tab, in column order (A..B). */
export const SETTINGS_HEADERS = ["key", "value"] as const;

/** Google Drive `appProperties` tag on the settings spreadsheet, so any device can find it. */
export const SETTINGS_APP_PROPERTY_KEY = "memoriaSettings";
export const SETTINGS_APP_PROPERTY_VALUE = "1";

/** The Google Tasks calendar-mirror toggle. Values: `"on"` / `"off"`; absent = off. */
export const CALENDAR_MIRROR_SETTING = "calendar_mirror";

/** A parsed settings grid: raw string values by key. Absent key = that setting's default. */
export type AppSettings = Record<string, string>;

/**
 * Parses the `Settings` tab (header + rows, as returned by `values.get`).
 * Total and forgiving: rows with a blank key are skipped, duplicate keys
 * keep the first, and a missing value cell reads as `""`.
 */
export function parseSettingsSheet(rows: readonly SheetRow[]): AppSettings {
  const settings: AppSettings = {};
  // Row 0 is the header; if it's absent the tab is empty anyway.
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const key = (row[0] ?? "").trim();
    if (key === "" || key in settings) continue;
    settings[key] = row[1] ?? "";
  }
  return settings;
}

/** The full grid for the `Settings` tab: the header row followed by one row per key, sorted for stable diffs. */
export function settingsToRows(settings: AppSettings): SheetRow[] {
  const keys = Object.keys(settings).sort();
  return [[...SETTINGS_HEADERS], ...keys.map((key) => [key, settings[key] ?? ""])];
}
