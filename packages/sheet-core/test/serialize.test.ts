import { describe, expect, it } from "vitest";
import { isBlankRow, RowValidationError, rowToTask, taskToRow } from "../src/serialize.js";
import type { Task } from "../src/types.js";

const validRow = [
  "id1",
  "Buy milk",
  "backlog",
  "0",
  "2% please",
  "agent",
  "2026-01-01T00:00:00.000Z",
  "2026-01-02T00:00:00.000Z",
];

describe("rowToTask", () => {
  it("parses a fully populated valid row", () => {
    expect(rowToTask(validRow)).toEqual({
      id: "id1",
      title: "Buy milk",
      status: "backlog",
      sortOrder: 0,
      notes: "2% please",
      source: "agent",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      dueDate: "",
      tags: [],
      blockedUntil: "",
      recurs: "",
    });
  });

  it("reads blocked_until from column K — a date or free-form event text", () => {
    expect(rowToTask([...validRow, "", "", "2026-08-01"]).blockedUntil).toBe("2026-08-01");
    expect(rowToTask([...validRow, "", "", " Trip done "]).blockedUntil).toBe("Trip done");
  });

  it("reads recurs from column L, rejecting anything but yearly", () => {
    expect(rowToTask([...validRow, "", "", "", "yearly"]).recurs).toBe("yearly");
    expect(rowToTask([...validRow, "", "", "", ""]).recurs).toBe("");
    expect(() => rowToTask([...validRow, "", "", "", "monthly"])).toThrow(RowValidationError);
  });

  it("trims whitespace from id, title, status", () => {
    const row = [
      " id1 ",
      " Buy milk ",
      " backlog ",
      "0",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    const task = rowToTask(row);
    expect(task.id).toBe("id1");
    expect(task.title).toBe("Buy milk");
    expect(task.status).toBe("backlog");
  });

  it("defaults source to 'user' when missing or unrecognized (informational only)", () => {
    const row = [
      "id1",
      "Buy milk",
      "backlog",
      "0",
      "",
      "",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    expect(rowToTask(row).source).toBe("user");

    const rowWeird = [
      "id1",
      "Buy milk",
      "backlog",
      "0",
      "",
      "robot",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    expect(rowToTask(rowWeird).source).toBe("user");
  });

  it("accepts negative and fractional sort_order", () => {
    const row = [
      "id1",
      "Buy milk",
      "backlog",
      "-3.5",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    expect(rowToTask(row).sortOrder).toBe(-3.5);
  });

  it("accepts an empty notes cell as empty string", () => {
    const row = [
      "id1",
      "Buy milk",
      "backlog",
      "0",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    expect(rowToTask(row).notes).toBe("");
  });

  it("throws RowValidationError on missing id", () => {
    const row = [
      "",
      "Buy milk",
      "backlog",
      "0",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    expect(() => rowToTask(row)).toThrow(RowValidationError);
    try {
      rowToTask(row);
    } catch (err) {
      expect(err).toBeInstanceOf(RowValidationError);
      expect((err as RowValidationError).column).toBe("id");
    }
  });

  it("throws RowValidationError on missing title", () => {
    const row = [
      "id1",
      "  ",
      "backlog",
      "0",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    expect(() => rowToTask(row)).toThrow(RowValidationError);
  });

  it("accepts an arbitrary custom status (columns are customizable)", () => {
    const row = [
      "id1",
      "Buy milk",
      "doing",
      "0",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    expect(rowToTask(row).status).toBe("doing");
  });

  it("throws RowValidationError on an empty status", () => {
    const row = [
      "id1",
      "Buy milk",
      "",
      "0",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    try {
      rowToTask(row);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RowValidationError);
      expect((err as RowValidationError).column).toBe("status");
    }
  });

  it("throws RowValidationError on non-numeric sort_order", () => {
    const row = [
      "id1",
      "Buy milk",
      "backlog",
      "abc",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    try {
      rowToTask(row);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RowValidationError);
      expect((err as RowValidationError).column).toBe("sort_order");
    }
  });

  it("throws RowValidationError on empty sort_order", () => {
    const row = [
      "id1",
      "Buy milk",
      "backlog",
      "",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ];
    expect(() => rowToTask(row)).toThrow(RowValidationError);
  });

  it("throws RowValidationError on missing created_at", () => {
    const row = ["id1", "Buy milk", "backlog", "0", "", "user", "", "2026-01-01T00:00:00.000Z"];
    try {
      rowToTask(row);
      throw new Error("expected to throw");
    } catch (err) {
      expect((err as RowValidationError).column).toBe("created_at");
    }
  });

  it("throws RowValidationError on missing updated_at", () => {
    const row = ["id1", "Buy milk", "backlog", "0", "", "user", "2026-01-01T00:00:00.000Z", ""];
    try {
      rowToTask(row);
      throw new Error("expected to throw");
    } catch (err) {
      expect((err as RowValidationError).column).toBe("updated_at");
    }
  });

  it("treats a short row (missing trailing cells) as invalid", () => {
    const row = ["id1", "Buy milk", "backlog"];
    expect(() => rowToTask(row)).toThrow(RowValidationError);
  });
});

describe("taskToRow", () => {
  it("round-trips through rowToTask", () => {
    const task: Task = {
      id: "id1",
      title: "Buy milk",
      status: "in_progress",
      sortOrder: -1.5,
      notes: "2% please",
      source: "agent",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      dueDate: "2026-07-21",
      tags: ["errand", "home"],
      blockedUntil: "",
      recurs: "",
    };
    expect(rowToTask(taskToRow(task))).toEqual(task);
  });

  it("round-trips a blocked-until event", () => {
    const task: Task = {
      id: "id1",
      title: "Book flights",
      status: "backlog",
      sortOrder: 0,
      notes: "",
      source: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      dueDate: "",
      tags: [],
      blockedUntil: "Trip done",
      recurs: "",
    };
    expect(rowToTask(taskToRow(task))).toEqual(task);
  });

  it("produces cells in HEADERS column order", () => {
    const task: Task = {
      id: "id1",
      title: "Buy milk",
      status: "backlog",
      sortOrder: 0,
      notes: "",
      source: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      dueDate: "2026-07-21",
      tags: ["errand", "home"],
      blockedUntil: "",
      recurs: "yearly",
    };
    expect(taskToRow(task)).toEqual([
      "id1",
      "Buy milk",
      "backlog",
      "0",
      "",
      "user",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-07-21",
      "errand, home",
      "",
      "yearly",
    ]);
  });
});

describe("isBlankRow", () => {
  it("is true for an empty array", () => {
    expect(isBlankRow([])).toBe(true);
  });

  it("is true for all-empty-string cells", () => {
    expect(isBlankRow(["", "", "  ", ""])).toBe(true);
  });

  it("is false if any cell has content", () => {
    expect(isBlankRow(["", "x", ""])).toBe(false);
  });
});
