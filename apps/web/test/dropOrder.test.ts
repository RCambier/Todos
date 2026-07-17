import type { Task } from "@memoria/sheet-core";
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
    dueDate: "",
    tags: [],
  };
}

describe("computeDropSortOrder", () => {
  // `columnTasks` mirrors the shape @hello-pangea/dnd hands us in
  // onDragEnd: the destination column's current cards, top to bottom, with
  // the dragged card already excluded, plus a raw `destination.index`.

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

  it("computes the midpoint between the correct neighbors in a longer column", () => {
    const column = [task("a", 1), task("b", 2), task("c", 3), task("d", 4)];
    expect(computeDropSortOrder(column, 2)).toBe(2.5);
  });

  it("treats a negative index the same as the top", () => {
    const column = [task("a", 5), task("b", 10)];
    expect(computeDropSortOrder(column, -1)).toBe(4);
  });
});
