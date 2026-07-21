import type { Task } from "@memoria/sheet-core";
import { describe, expect, it } from "vitest";
import { markerTaskId, mirrorMarker, planMirror, type GTaskLite } from "../src/calendar/mirrorDiff.js";

const BOARD = "sheet-1";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    status: "backlog",
    sortOrder: 1,
    notes: "",
    source: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    dueDate: "2026-07-21",
    tags: [],
    blockedUntil: "",
    recurs: "" as const,
    ...overrides,
  };
}

function gtask(taskId: string, overrides: Partial<GTaskLite> = {}): GTaskLite {
  return {
    id: `g-${taskId}`,
    title: `Task ${taskId}`,
    notes: mirrorMarker(BOARD, taskId),
    due: "2026-07-21T00:00:00.000Z",
    status: "needsAction",
    ...overrides,
  };
}

describe("markerTaskId", () => {
  it("extracts the task id for the right board only", () => {
    expect(markerTaskId(mirrorMarker(BOARD, "abc"), BOARD)).toBe("abc");
    expect(markerTaskId(mirrorMarker("other-board", "abc"), BOARD)).toBeNull();
    expect(markerTaskId("no marker here", BOARD)).toBeNull();
  });

  it("finds the marker at the end of real notes", () => {
    expect(markerTaskId(`Buy milk\n\n${mirrorMarker(BOARD, "x1")}`, BOARD)).toBe("x1");
  });
});

describe("planMirror", () => {
  it("creates mirrors for dated, not-done tasks", () => {
    const ops = planMirror(BOARD, [task("a")], []);
    expect(ops).toEqual([
      {
        kind: "create",
        title: "Task a",
        notes: mirrorMarker(BOARD, "a"),
        due: "2026-07-21T00:00:00.000Z",
      },
    ]);
  });

  it("skips tasks with no date at all", () => {
    expect(planMirror(BOARD, [task("a", { dueDate: "" })], [])).toEqual([]);
  });

  it("mirrors a task blocked until a date, on that date", () => {
    const ops = planMirror(BOARD, [task("a", { dueDate: "", blockedUntil: "2026-08-03" })], []);
    expect(ops).toEqual([
      {
        kind: "create",
        title: "Task a",
        notes: mirrorMarker(BOARD, "a"),
        due: "2026-08-03T00:00:00.000Z",
      },
    ]);
  });

  it("skips a blocked-until that names an event — it has no date to sit on", () => {
    expect(planMirror(BOARD, [task("a", { dueDate: "", blockedUntil: "Trip done" })], [])).toEqual([]);
  });

  it("re-dates the mirror when a blocked-until date moves", () => {
    const blocked = task("a", { dueDate: "", blockedUntil: "2026-08-03" });
    const ops = planMirror(BOARD, [blocked], [gtask("a")]); // mirror still on 2026-07-21
    expect(ops).toEqual([{ kind: "patch", googleId: "g-a", fields: { due: "2026-08-03T00:00:00.000Z" } }]);
  });

  it("deletes the mirror when a blocked-until date becomes an event", () => {
    const blocked = gtask("a", { due: "2026-08-03T00:00:00.000Z" });
    expect(planMirror(BOARD, [task("a", { dueDate: "", blockedUntil: "Trip done" })], [blocked])).toEqual([
      { kind: "delete", googleId: "g-a" },
    ]);
  });

  it("never creates a mirror for an already-done task", () => {
    expect(planMirror(BOARD, [task("a", { status: "done" })], [])).toEqual([]);
  });

  it("is a no-op when the mirror already matches", () => {
    expect(planMirror(BOARD, [task("a")], [gtask("a")])).toEqual([]);
  });

  it("patches only the changed fields", () => {
    const ops = planMirror(BOARD, [task("a", { title: "Renamed", dueDate: "2026-08-01" })], [gtask("a")]);
    expect(ops).toEqual([
      {
        kind: "patch",
        googleId: "g-a",
        fields: { title: "Renamed", due: "2026-08-01T00:00:00.000Z" },
      },
    ]);
  });

  it("includes board notes above the marker", () => {
    const ops = planMirror(BOARD, [task("a", { notes: "call them" })], [gtask("a")]);
    expect(ops).toEqual([
      {
        kind: "patch",
        googleId: "g-a",
        fields: { notes: `call them\n\n${mirrorMarker(BOARD, "a")}` },
      },
    ]);
  });

  it("marks the mirror completed when the task is done (and back)", () => {
    expect(planMirror(BOARD, [task("a", { status: "done" })], [gtask("a")])).toEqual([
      { kind: "patch", googleId: "g-a", fields: { status: "completed" } },
    ]);
    expect(planMirror(BOARD, [task("a")], [gtask("a", { status: "completed" })])).toEqual([
      { kind: "patch", googleId: "g-a", fields: { status: "needsAction" } },
    ]);
  });

  it("uses the board's designated done column, not the literal 'done'", () => {
    // A custom board whose done column is "shipped": a task there completes its
    // mirror, and a task in the literal "done" column does not.
    expect(planMirror(BOARD, [task("a", { status: "shipped" })], [gtask("a")], "shipped")).toEqual([
      { kind: "patch", googleId: "g-a", fields: { status: "completed" } },
    ]);
    expect(planMirror(BOARD, [task("a", { status: "done" })], [gtask("a")], "shipped")).toEqual([]);
  });

  it("with no done column, nothing is ever completed", () => {
    expect(planMirror(BOARD, [task("a", { status: "done" })], [gtask("a")], null)).toEqual([]);
  });

  it("deletes mirrors whose task vanished or lost its due date", () => {
    expect(planMirror(BOARD, [], [gtask("gone")])).toEqual([{ kind: "delete", googleId: "g-gone" }]);
    expect(planMirror(BOARD, [task("a", { dueDate: "" })], [gtask("a")])).toEqual([
      { kind: "delete", googleId: "g-a" },
    ]);
  });

  it("keeps the first of duplicate mirrors and deletes the rest", () => {
    const dupe = { ...gtask("a"), id: "g-a-dupe" };
    const ops = planMirror(BOARD, [task("a")], [gtask("a"), dupe]);
    expect(ops).toEqual([{ kind: "delete", googleId: "g-a-dupe" }]);
  });

  it("never touches another board's mirrors or hand-made tasks", () => {
    const foreign: GTaskLite = { ...gtask("a"), notes: mirrorMarker("other-board", "a"), id: "g-f" };
    const handmade: GTaskLite = { id: "g-h", title: "Groceries", notes: "", due: "", status: "needsAction" };
    const ops = planMirror(BOARD, [], [foreign, handmade]);
    expect(ops).toEqual([]);
  });

  it("date-only compare: a Google due with the same date needs no patch", () => {
    const ops = planMirror(BOARD, [task("a")], [gtask("a", { due: "2026-07-21T00:00:00.000Z" })]);
    expect(ops).toEqual([]);
  });
});
