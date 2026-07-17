import { describe, expect, it } from "vitest";
import {
  clearCachedSpreadsheetId,
  getCachedSpreadsheetId,
  type KeyValueStore,
  setCachedSpreadsheetId,
} from "../src/lib/storage.js";

function fakeStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe("cached spreadsheet id", () => {
  it("returns null when nothing is cached", () => {
    expect(getCachedSpreadsheetId(fakeStore())).toBeNull();
  });

  it("round-trips a set value", () => {
    const store = fakeStore();
    setCachedSpreadsheetId("abc123", store);
    expect(getCachedSpreadsheetId(store)).toBe("abc123");
  });

  it("clears the cached value", () => {
    const store = fakeStore();
    setCachedSpreadsheetId("abc123", store);
    clearCachedSpreadsheetId(store);
    expect(getCachedSpreadsheetId(store)).toBeNull();
  });
});
