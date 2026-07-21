import { describe, expect, it } from "vitest";
import { HEADERS } from "../src/headers.js";
import { parseSheet } from "../src/parse.js";

const goodRow1 = [
  "id1",
  "Buy milk",
  "backlog",
  "0",
  "",
  "user",
  "2026-01-01T00:00:00.000Z",
  "2026-01-01T00:00:00.000Z",
];
const goodRow2 = [
  "id2",
  "Walk dog",
  "in_progress",
  "1",
  "notes here",
  "agent",
  "2026-01-02T00:00:00.000Z",
  "2026-01-02T00:00:00.000Z",
];

describe("parseSheet — valid sheets", () => {
  it("parses an empty sheet (header only) to zero tasks", () => {
    const result = parseSheet([[...HEADERS]]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tasks).toEqual([]);
  });

  it("parses a sheet with several valid rows", () => {
    const result = parseSheet([[...HEADERS], goodRow1, goodRow2]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0]?.id).toBe("id1");
      expect(result.tasks[1]?.id).toBe("id2");
    }
  });

  it("ignores fully blank rows interspersed between data", () => {
    const blank = ["", "", "", "", "", "", "", ""];
    const result = parseSheet([[...HEADERS], goodRow1, blank, goodRow2]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tasks).toHaveLength(2);
  });

  it("ignores trailing blank rows", () => {
    const blank: string[] = [];
    const result = parseSheet([[...HEADERS], goodRow1, blank]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tasks).toHaveLength(1);
  });

  it("handles a sheet with no data rows beyond the header array itself", () => {
    const result = parseSheet([[...HEADERS]]);
    expect(result.ok).toBe(true);
  });
});

describe("parseSheet — header errors", () => {
  it("fails when the sheet has no rows at all", () => {
    const result = parseSheet([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.row).toBe(1);
      expect(result.error.message).toMatch(/header row is missing/);
    }
  });

  it("fails when the header row is empty", () => {
    const result = parseSheet([[]]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.row).toBe(1);
  });

  it("fails when a header column is misspelled", () => {
    const badHeader = [...HEADERS];
    badHeader[2] = "state";
    const result = parseSheet([badHeader]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.row).toBe(1);
      expect(result.error.column).toBe("status");
      expect(result.error.value).toBe("state");
      expect(result.error.message).toMatch(/column 3/);
    }
  });

  it("fails when headers are reordered", () => {
    const reordered = ["title", "id", "status", "sort_order", "notes", "source", "created_at", "updated_at"];
    const result = parseSheet([reordered]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.column).toBe("id");
  });

  it("fails when the header is missing trailing columns", () => {
    const short = ["id", "title", "status"];
    const result = parseSheet([short]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.column).toBe("sort_order");
  });
});

describe("parseSheet — row errors", () => {
  it("accepts an arbitrary custom status (columns are customizable)", () => {
    const custom = [
      "id7",
      "Do a thing",
      "doing",
      "0",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    const result = parseSheet([[...HEADERS], goodRow1, goodRow2, custom]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tasks.find((t) => t.id === "id7")?.status).toBe("doing");
    }
  });

  it("reports the exact row and column for an empty status", () => {
    const bad = [
      "id7",
      "Do a thing",
      "",
      "0",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    const result = parseSheet([[...HEADERS], goodRow1, goodRow2, bad]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.row).toBe(4);
      expect(result.error.column).toBe("status");
      expect(result.error.message).toBe("Row 4: status is required but was empty.");
    }
  });

  it("reports the exact row for a non-numeric sort_order", () => {
    const bad = [
      "id7",
      "Do a thing",
      "backlog",
      "not-a-number",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    const result = parseSheet([[...HEADERS], bad]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.row).toBe(2);
      expect(result.error.column).toBe("sort_order");
      expect(result.error.message).toMatch(/sort_order "not-a-number" isn't a number/);
    }
  });

  it("reports a missing title", () => {
    const bad = [
      "id7",
      "",
      "backlog",
      "0",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    const result = parseSheet([[...HEADERS], bad]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.column).toBe("title");
      expect(result.error.row).toBe(2);
    }
  });

  it("reports a missing id", () => {
    const bad = [
      "",
      "Title",
      "backlog",
      "0",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    const result = parseSheet([[...HEADERS], bad]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.column).toBe("id");
  });

  it("reports duplicate ids with both row numbers", () => {
    const dup = [
      "id1",
      "Different title",
      "done",
      "5",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    const result = parseSheet([[...HEADERS], goodRow1, dup]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.row).toBe(3);
      expect(result.error.column).toBe("id");
      expect(result.error.message).toMatch(/already used by row 2/);
    }
  });

  it("stops at the first error rather than collecting all of them", () => {
    const bad1 = [
      "id7",
      "",
      "backlog",
      "0",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    const bad2 = [
      "id8",
      "Fine",
      "doing",
      "0",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    const result = parseSheet([[...HEADERS], bad1, bad2]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.row).toBe(2);
  });
});

describe("parseSheet — legacy headers", () => {
  const legacyRow = [
    "id9",
    "Old task",
    "backlog",
    "0",
    "",
    "user",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  ];

  it("parses the original 8-column header and flags legacyHeader", () => {
    const result = parseSheet([[...HEADERS.slice(0, 8)], legacyRow]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.legacyHeader).toBe(true);
      expect(result.tasks[0]?.dueDate).toBe("");
      expect(result.tasks[0]?.tags).toEqual([]);
      expect(result.tasks[0]?.blockedUntil).toBe("");
    }
  });

  it("parses the 10-column (pre-blocked_until) header and flags legacyHeader", () => {
    const row = [...legacyRow, "2026-07-21", "errand"];
    const result = parseSheet([[...HEADERS.slice(0, 10)], row]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.legacyHeader).toBe(true);
      expect(result.tasks[0]?.dueDate).toBe("2026-07-21");
      expect(result.tasks[0]?.blockedUntil).toBe("");
    }
  });

  it("full header is not flagged as legacy", () => {
    const result = parseSheet([[...HEADERS]]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.legacyHeader).toBe(false);
  });
});

describe("parseSheet — due_date and tags", () => {
  it("rejects a malformed due_date with a precise error", () => {
    const bad = [...goodRow1.slice(0, 8), "next tuesday", ""];
    const result = parseSheet([[...HEADERS], bad]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.column).toBe("due_date");
      expect(result.error.message).toContain("next tuesday");
    }
  });

  it("accepts a valid due_date and comma-separated tags", () => {
    const row = [...goodRow1.slice(0, 8), "2026-07-21", "errand, home"];
    const result = parseSheet([[...HEADERS], row]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tasks[0]?.dueDate).toBe("2026-07-21");
      expect(result.tasks[0]?.tags).toEqual(["errand", "home"]);
    }
  });

  it("accepts blocked_until as a date or as free-form event text", () => {
    const byDate = [...goodRow1.slice(0, 8), "", "", "2026-08-01"];
    const byEvent = [...goodRow2.slice(0, 8), "", "", "Trip done"];
    const result = parseSheet([[...HEADERS], byDate, byEvent]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tasks[0]?.blockedUntil).toBe("2026-08-01");
      expect(result.tasks[1]?.blockedUntil).toBe("Trip done");
    }
  });
});
