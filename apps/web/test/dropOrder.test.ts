import type { Task } from "@todos/sheet-core";
import { describe, expect, it } from "vitest";
import { computeDropSortOrder } from "../src/board/dropOrder.js";

function task(id: string, sortOrder: number): Task {
  return {
    id,
    title: id,
    status: "backlog",
    sortOrder,
    notes: "",
    source: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("computeDropSortOrder", () => {
  it("returns 0 for the only item in an empty column", () => {
    expect(computeDropSortOrder([], 0)).toBe(0);
  });

  it("computes top-of-column order when dropped at index 0", () => {
    const column = [task("a", 5), task("b", 10)];
    expect(computeDropSortOrder(column, 0)).toBe(4);
  });

  it("computes bottom-of-column order when dropped past the end", () => {
    const column = [task("a", 5), task("b", 10)];
    expect(computeDropSortOrder(column, 2)).toBe(11);
  });

  it("computes the midpoint when dropped between two items", () => {
    const column = [task("a", 5), task("b", 10)];
    expect(computeDropSortOrder(column, 1)).toBe(7.5);
  });
});
