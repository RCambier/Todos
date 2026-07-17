import { describe, expect, it } from "vitest";
import { betweenSortOrder, boardOrder, sortByOrder, topSortOrder } from "../src/ordering.js";
import type { Task } from "../src/types.js";

function task(id: string, status: Task["status"], sortOrder: number): Task {
  return {
    id,
    title: id,
    status,
    sortOrder,
    notes: "",
    source: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("topSortOrder", () => {
  it("returns 0 for an empty column", () => {
    expect(topSortOrder([])).toBe(0);
  });

  it("returns one less than the current minimum", () => {
    expect(topSortOrder([5, 2, 9])).toBe(1);
  });

  it("handles negative existing orders", () => {
    expect(topSortOrder([-3, -1])).toBe(-4);
  });

  it("handles a single existing order", () => {
    expect(topSortOrder([10])).toBe(9);
  });
});

describe("betweenSortOrder", () => {
  it("returns 0 for an empty column (both neighbors null)", () => {
    expect(betweenSortOrder(null, null)).toBe(0);
  });

  it("returns one less than below when dropped at the top", () => {
    expect(betweenSortOrder(null, 4)).toBe(3);
  });

  it("returns one more than above when dropped at the bottom", () => {
    expect(betweenSortOrder(4, null)).toBe(5);
  });

  it("returns the midpoint between two neighbors", () => {
    expect(betweenSortOrder(2, 4)).toBe(3);
    expect(betweenSortOrder(1, 2)).toBe(1.5);
  });

  it("supports repeated midpoint insertion without collision", () => {
    let a = 1;
    let b = 2;
    const seen = new Set<number>([a, b]);
    for (let i = 0; i < 30; i++) {
      const mid = betweenSortOrder(a, b);
      expect(seen.has(mid)).toBe(false);
      seen.add(mid);
      b = mid;
    }
  });
});

describe("sortByOrder", () => {
  it("sorts ascending by sortOrder", () => {
    const tasks = [task("c", "backlog", 3), task("a", "backlog", 1), task("b", "backlog", 2)];
    expect(sortByOrder(tasks).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const tasks = [task("b", "backlog", 2), task("a", "backlog", 1)];
    const copy = [...tasks];
    sortByOrder(tasks);
    expect(tasks).toEqual(copy);
  });
});

describe("boardOrder", () => {
  it("groups by status in the given status order, sorted within each group", () => {
    const tasks = [
      task("d1", "done", 5),
      task("b2", "backlog", 2),
      task("p1", "in_progress", 1),
      task("d0", "done", 1),
      task("b1", "backlog", 1),
    ];
    const ordered = boardOrder(tasks, ["backlog", "in_progress", "done"]);
    expect(ordered.map((t) => t.id)).toEqual(["b1", "b2", "p1", "d0", "d1"]);
  });
});
