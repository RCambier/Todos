import { describe, expect, it } from "vitest";
import { parseSettingsSheet, SETTINGS_HEADERS, settingsToRows } from "../src/settings.js";

describe("parseSettingsSheet", () => {
  it("reads key/value rows, skipping the header", () => {
    expect(parseSettingsSheet([[...SETTINGS_HEADERS], ["calendar_mirror", "on"], ["theme", "dark"]])).toEqual(
      { calendar_mirror: "on", theme: "dark" },
    );
  });

  it("returns {} for an empty or header-only tab", () => {
    expect(parseSettingsSheet([])).toEqual({});
    expect(parseSettingsSheet([[...SETTINGS_HEADERS]])).toEqual({});
  });

  it("skips blank keys, keeps the first duplicate, and defaults a missing value to empty", () => {
    expect(
      parseSettingsSheet([
        [...SETTINGS_HEADERS],
        ["", "orphan"],
        ["  ", "orphan"],
        ["calendar_mirror", "on"],
        ["calendar_mirror", "off"],
        ["bare_key"],
      ]),
    ).toEqual({ calendar_mirror: "on", bare_key: "" });
  });
});

describe("settingsToRows", () => {
  it("round-trips through parseSettingsSheet", () => {
    const settings = { calendar_mirror: "off", theme: "dark" };
    expect(parseSettingsSheet(settingsToRows(settings))).toEqual(settings);
  });

  it("emits the header row and sorts keys for stable output", () => {
    expect(settingsToRows({ b: "2", a: "1" })).toEqual([[...SETTINGS_HEADERS], ["a", "1"], ["b", "2"]]);
  });
});
