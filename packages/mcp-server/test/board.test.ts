import { HEADERS } from "@todos/sheet-core";
import { beforeEach, describe, expect, it } from "vitest";
import * as board from "../src/board.js";
import { MalformedSheetError, TaskNotFoundError } from "../src/board.js";
import type { SheetStore } from "../src/sheetsClient.js";

/** In-memory fake of the Sheets API surface board.ts depends on. */
class FakeSheetStore implements SheetStore {
  rows: string[][];

  constructor(dataRows: string[][] = []) {
    this.rows = [[...HEADERS], ...dataRows];
  }

  async readRows(): Promise<string[][]> {
    return this.rows.map((r) => [...r]);
  }

  async appendRow(row: string[]): Promise<void> {
    this.rows.push(row);
  }

  async updateRow(rowNumber: number, row: string[]): Promise<void> {
    this.rows[rowNumber - 1] = row;
  }

  async deleteRow(rowNumber: number): Promise<void> {
    this.rows.splice(rowNumber - 1, 1);
  }
}

function row(id: string, title: string, status: string, sortOrder: number, source = "user"): string[] {
  return [
    id,
    title,
    status,
    String(sortOrder),
    "",
    source,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  ];
}

describe("listTasks", () => {
  it("returns tasks in board order across all columns", async () => {
    const store = new FakeSheetStore([
      row("d1", "Done thing", "done", 1),
      row("b2", "Second backlog", "backlog", 2),
      row("b1", "First backlog", "backlog", 1),
      row("p1", "In progress thing", "in_progress", 1),
    ]);
    const tasks = await board.listTasks(store);
    expect(tasks.map((t) => t.id)).toEqual(["b1", "b2", "p1", "d1"]);
  });

  it("filters by status when given", async () => {
    const store = new FakeSheetStore([row("b1", "A", "backlog", 1), row("d1", "B", "done", 1)]);
    const tasks = await board.listTasks(store, "done");
    expect(tasks.map((t) => t.id)).toEqual(["d1"]);
  });

  it("throws MalformedSheetError with the precise sheet-core message when the sheet is invalid", async () => {
    const store = new FakeSheetStore([row("b1", "A", "doing", 1)]);
    await expect(board.listTasks(store)).rejects.toThrow(MalformedSheetError);
    await expect(board.listTasks(store)).rejects.toThrow(/status "doing" isn't one of/);
  });
});

describe("addTask", () => {
  it("inserts at the top of the target column with source=agent", async () => {
    const store = new FakeSheetStore([row("b1", "Existing", "backlog", 5)]);
    const task = await board.addTask(store, { title: "New task" });
    expect(task.status).toBe("backlog");
    expect(task.source).toBe("agent");
    expect(task.sortOrder).toBeLessThan(5);
    expect(store.rows).toHaveLength(3); // header + existing + new
  });

  it("defaults to backlog when no status is given", async () => {
    const store = new FakeSheetStore();
    const task = await board.addTask(store, { title: "New task" });
    expect(task.status).toBe("backlog");
    expect(task.sortOrder).toBe(0);
  });

  it("respects an explicit status", async () => {
    const store = new FakeSheetStore();
    const task = await board.addTask(store, { title: "New task", status: "in_progress" });
    expect(task.status).toBe("in_progress");
  });

  it("defaults notes to empty string", async () => {
    const store = new FakeSheetStore();
    const task = await board.addTask(store, { title: "New task" });
    expect(task.notes).toBe("");
  });
});

describe("updateTask", () => {
  it("updates only the given fields and bumps updatedAt", async () => {
    const store = new FakeSheetStore([row("b1", "Old title", "backlog", 1)]);
    const before = await board.listTasks(store);
    const task = await board.updateTask(store, "b1", { title: "New title" });
    expect(task.title).toBe("New title");
    expect(task.status).toBe("backlog");
    expect(new Date(task.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before[0]!.updatedAt).getTime(),
    );
  });

  it("writes to the row matching the id, not a remembered position", async () => {
    const store = new FakeSheetStore([row("a", "A", "backlog", 1), row("b", "B", "backlog", 2)]);
    await board.updateTask(store, "b", { title: "B updated" });
    expect(store.rows[1]![1]).toBe("A"); // untouched
    expect(store.rows[2]![1]).toBe("B updated");
  });

  it("throws TaskNotFoundError for an unknown id", async () => {
    const store = new FakeSheetStore([row("a", "A", "backlog", 1)]);
    await expect(board.updateTask(store, "missing", { title: "x" })).rejects.toThrow(TaskNotFoundError);
  });
});

describe("moveTask", () => {
  it("moves to the top of the destination column", async () => {
    const store = new FakeSheetStore([
      row("a", "A", "backlog", 1),
      row("p1", "In progress", "in_progress", -5),
    ]);
    const moved = await board.moveTask(store, "a", "in_progress");
    expect(moved.status).toBe("in_progress");
    expect(moved.sortOrder).toBeLessThan(-5);
  });

  it("excludes the task's own prior order from the top computation when re-ordering within the same column", async () => {
    const store = new FakeSheetStore([row("a", "A", "backlog", -10)]);
    const moved = await board.moveTask(store, "a", "backlog");
    // Only task in the column is itself; top of an (effectively empty) column is 0.
    expect(moved.sortOrder).toBe(0);
  });
});

describe("completeTask", () => {
  it("is sugar for moveTask(id, done)", async () => {
    const store = new FakeSheetStore([row("a", "A", "backlog", 1)]);
    const task = await board.completeTask(store, "a");
    expect(task.status).toBe("done");
  });
});

describe("deleteTask", () => {
  it("removes exactly the matching row", async () => {
    const store = new FakeSheetStore([row("a", "A", "backlog", 1), row("b", "B", "backlog", 2)]);
    await board.deleteTask(store, "a");
    const remaining = await board.listTasks(store);
    expect(remaining.map((t) => t.id)).toEqual(["b"]);
  });

  it("throws TaskNotFoundError for an unknown id", async () => {
    const store = new FakeSheetStore([row("a", "A", "backlog", 1)]);
    await expect(board.deleteTask(store, "missing")).rejects.toThrow(TaskNotFoundError);
  });
});

describe("readValidTasks via listTasks — round trip through real serialization", () => {
  let store: FakeSheetStore;
  beforeEach(() => {
    store = new FakeSheetStore();
  });

  it("add then list then move then complete then delete works end to end", async () => {
    const created = await board.addTask(store, { title: "Ship it", notes: "carefully" });
    let tasks = await board.listTasks(store);
    expect(tasks).toHaveLength(1);

    await board.moveTask(store, created.id, "in_progress");
    tasks = await board.listTasks(store, "in_progress");
    expect(tasks).toHaveLength(1);

    await board.completeTask(store, created.id);
    tasks = await board.listTasks(store, "done");
    expect(tasks).toHaveLength(1);

    await board.deleteTask(store, created.id);
    tasks = await board.listTasks(store);
    expect(tasks).toHaveLength(0);
  });
});
