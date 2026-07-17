const SPREADSHEET_ID_KEY = "todos:spreadsheetId";

/** Minimal subset of the `Storage` interface, so tests can inject a fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function getCachedSpreadsheetId(store: KeyValueStore = localStorage): string | null {
  return store.getItem(SPREADSHEET_ID_KEY);
}

export function setCachedSpreadsheetId(id: string, store: KeyValueStore = localStorage): void {
  store.setItem(SPREADSHEET_ID_KEY, id);
}

export function clearCachedSpreadsheetId(store: KeyValueStore = localStorage): void {
  store.removeItem(SPREADSHEET_ID_KEY);
}
