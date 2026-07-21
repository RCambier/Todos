import { describe, expect, it } from "vitest";
import {
  addMemory,
  appendMemoryIfAbsent,
  applyMemoriesPending,
  buildMemory,
  deleteMemory,
  enqueueMemoryOp,
  isMemoryExpired,
  listMemories,
  MemoryNotFoundError,
  MEMORIES_HEADERS,
  memoryToRow,
  memoriesOrder,
  parseMemoriesSheet,
  rowToMemory,
  updateMemory,
  type Memory,
  type MemoryPendingOp,
} from "../src/memories.js";
import { MalformedSheetError } from "../src/board.js";
import type { SheetStore } from "../src/store.js";

/** In-memory fake of the Sheets API surface memories.ts depends on. */
class FakeSheetStore implements SheetStore {
  rows: string[][];

  constructor(dataRows: string[][] = []) {
    this.rows = [[...MEMORIES_HEADERS], ...dataRows];
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

function row(
  id: string,
  title: string,
  body = "",
  tags = "",
  source = "user",
  at = "2026-01-01T00:00:00.000Z",
  expires = "",
): string[] {
  return [id, title, body, tags, source, at, at, expires];
}

function memory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id,
    title: "T",
    body: "B",
    tags: [],
    source: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "",
    ...overrides,
  };
}

describe("appendMemoryIfAbsent (replay safety)", () => {
  it("appends a memory that isn't on the sheet yet", async () => {
    const store = new FakeSheetStore();
    const m = buildMemory({ title: "Fresh" }, "user");
    await appendMemoryIfAbsent(store, m);
    expect(store.rows).toHaveLength(2); // header + the one row
    expect(store.rows[1]![0]).toBe(m.id);
  });

  it("is a no-op when the id already landed (retry after a lost response)", async () => {
    const store = new FakeSheetStore();
    const m = buildMemory({ title: "Once" }, "user");
    await appendMemoryIfAbsent(store, m); // first attempt lands
    await appendMemoryIfAbsent(store, m); // retry after a lost response
    expect(store.rows).toHaveLength(2); // still one row — never duplicated
  });

  it("refuses to append onto a malformed sheet", async () => {
    const store = new FakeSheetStore([["", "no id", "body", "", "user", "x", "y"]]);
    const m = buildMemory({ title: "New" }, "user");
    await expect(appendMemoryIfAbsent(store, m)).rejects.toThrow(MalformedSheetError);
  });
});

describe("parseMemoriesSheet", () => {
  it("parses a header-only sheet to zero memories", () => {
    const result = parseMemoriesSheet([[...MEMORIES_HEADERS]]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.memories).toEqual([]);
  });

  it("parses memories, tags included, and skips blank rows", () => {
    const result = parseMemoriesSheet([
      [...MEMORIES_HEADERS],
      row("m1", "One", "", "family, preferences"),
      ["", ""],
      row("m2", "", "body only"),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.memories.map((m) => m.id)).toEqual(["m1", "m2"]);
      expect(result.memories[0]!.tags).toEqual(["family", "preferences"]);
      expect(result.memories[1]!.title).toBe("");
      expect(result.memories[1]!.body).toBe("body only");
      expect(result.memories[1]!.tags).toEqual([]);
    }
  });

  it("rejects a wrong header with a precise message", () => {
    const result = parseMemoriesSheet([
      ["id", "title", "text", "tags", "source", "created_at", "updated_at"],
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.row).toBe(1);
      expect(result.error.message).toContain('"body"');
    }
  });

  it("rejects a Notes-shaped header (a notes sheet is not a memories sheet)", () => {
    const result = parseMemoriesSheet([["id", "title", "body", "source", "created_at", "updated_at"]]);
    expect(result.ok).toBe(false);
  });

  it("rejects extra columns beyond the schema", () => {
    const result = parseMemoriesSheet([[...MEMORIES_HEADERS, "extra"]]);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing id, locating the row", () => {
    const result = parseMemoriesSheet([[...MEMORIES_HEADERS], row("m1", "ok"), row("", "no id")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.row).toBe(3);
      expect(result.error.column).toBe("id");
    }
  });

  it("rejects duplicate ids", () => {
    const result = parseMemoriesSheet([[...MEMORIES_HEADERS], row("m1", "a"), row("m1", "b")]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("already used");
  });

  it("rejects missing timestamps", () => {
    const result = parseMemoriesSheet([[...MEMORIES_HEADERS], ["m1", "t", "b", "", "user", "", ""]]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.column).toBe("created_at");
  });
});

describe("rowToMemory / memoryToRow", () => {
  it("round-trips a memory", () => {
    const m = memory("m1", {
      title: "Hello",
      body: "# md\n\ntext",
      tags: ["family", "travel"],
      source: "agent",
      expiresAt: "2026-08-02",
    });
    expect(rowToMemory(memoryToRow(m))).toEqual(m);
  });

  it("rejects a malformed expires_at, locating the column", () => {
    const result = parseMemoriesSheet([
      [...MEMORIES_HEADERS],
      row("m1", "t", "b", "", "user", "2026-01-01T00:00:00.000Z", "next week"),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.column).toBe("expires_at");
      expect(result.error.message).toContain("YYYY-MM-DD");
    }
  });

  it("coerces unknown sources to user", () => {
    expect(rowToMemory(row("m1", "t", "b", "", "banana")).source).toBe("user");
  });

  it("cleans up messy tag cells", () => {
    expect(rowToMemory(row("m1", "t", "b", " a ,, b ,")).tags).toEqual(["a", "b"]);
  });
});

describe("isMemoryExpired", () => {
  it("never expires a memory without an expiry date", () => {
    expect(isMemoryExpired(memory("m"), "2099-01-01")).toBe(false);
  });

  it("keeps the expiry day itself valid, expires the day after", () => {
    const m = memory("m", { expiresAt: "2026-08-02" });
    expect(isMemoryExpired(m, "2026-08-01")).toBe(false);
    expect(isMemoryExpired(m, "2026-08-02")).toBe(false);
    expect(isMemoryExpired(m, "2026-08-03")).toBe(true);
  });
});

describe("memoriesOrder", () => {
  it("sorts by updatedAt desc, then createdAt desc", () => {
    const a = memory("a", { updatedAt: "2026-01-01T00:00:00.000Z" });
    const b = memory("b", { updatedAt: "2026-01-03T00:00:00.000Z" });
    const c = memory("c", { updatedAt: "2026-01-02T00:00:00.000Z" });
    expect(memoriesOrder([a, b, c]).map((m) => m.id)).toEqual(["b", "c", "a"]);
  });
});

describe("memory operations", () => {
  it("listMemories returns memories newest-edited first", async () => {
    const store = new FakeSheetStore([
      row("old", "Old", "", "", "user", "2026-01-01T00:00:00.000Z"),
      row("new", "New", "", "", "user", "2026-02-01T00:00:00.000Z"),
    ]);
    const memories = await listMemories(store);
    expect(memories.map((m) => m.id)).toEqual(["new", "old"]);
  });

  it("addMemory appends a row with the given source and tags", async () => {
    const store = new FakeSheetStore();
    const created = await addMemory(store, { title: "Hi", body: "there", tags: ["preferences"] }, "agent");
    expect(store.rows).toHaveLength(2);
    expect(store.rows[1]).toEqual(memoryToRow(created));
    expect(created.source).toBe("agent");
    expect(created.tags).toEqual(["preferences"]);
  });

  it("updateMemory merges the patch onto the freshest row and bumps updatedAt", async () => {
    const store = new FakeSheetStore([row("m1", "Old title", "old body", "keep")]);
    const updated = await updateMemory(store, "m1", { body: "new body" });
    expect(updated.title).toBe("Old title");
    expect(updated.body).toBe("new body");
    expect(updated.tags).toEqual(["keep"]); // untouched by a body-only patch
    expect(store.rows[1]![2]).toBe("new body");
    expect(store.rows[1]![6]).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("updateMemory replaces the tag set when the patch provides one", async () => {
    const store = new FakeSheetStore([row("m1", "T", "B", "old")]);
    const updated = await updateMemory(store, "m1", { tags: ["new1", "new2"] });
    expect(updated.tags).toEqual(["new1", "new2"]);
    expect(store.rows[1]![3]).toBe("new1, new2");
  });

  it("updateMemory sets and clears the expiry independently of other fields", async () => {
    const store = new FakeSheetStore([row("m1", "T", "B")]);
    const set = await updateMemory(store, "m1", { expiresAt: "2026-08-02" });
    expect(set.expiresAt).toBe("2026-08-02");
    expect(store.rows[1]![7]).toBe("2026-08-02");
    const kept = await updateMemory(store, "m1", { title: "T2" });
    expect(kept.expiresAt).toBe("2026-08-02"); // untouched by an unrelated patch
    const cleared = await updateMemory(store, "m1", { expiresAt: "" });
    expect(cleared.expiresAt).toBe("");
    expect(store.rows[1]![7]).toBe("");
  });

  it("updateMemory locates the row by id even after rows moved", async () => {
    const store = new FakeSheetStore([row("a", "A"), row("b", "B")]);
    store.rows.splice(1, 1); // "a" deleted remotely; "b" shifts up
    await updateMemory(store, "b", { title: "B2" });
    expect(store.rows[1]![1]).toBe("B2");
  });

  it("updateMemory throws MemoryNotFoundError for a vanished memory", async () => {
    const store = new FakeSheetStore([row("m1", "x")]);
    await expect(updateMemory(store, "gone", { title: "y" })).rejects.toBeInstanceOf(MemoryNotFoundError);
  });

  it("deleteMemory removes exactly that row", async () => {
    const store = new FakeSheetStore([row("a", "A"), row("b", "B")]);
    await deleteMemory(store, "a");
    expect(store.rows.map((r) => r[0])).toEqual(["id", "b"]);
  });

  it("mutations refuse to touch a malformed sheet", async () => {
    const store = new FakeSheetStore([["", "no id", "", "", "user", "x", "x"]]);
    await expect(updateMemory(store, "m1", { title: "y" })).rejects.toBeInstanceOf(MalformedSheetError);
  });

  it("buildMemory defaults title, body, tags, and expiry to empty", () => {
    const m = buildMemory({}, "user");
    expect(m.title).toBe("");
    expect(m.body).toBe("");
    expect(m.tags).toEqual([]);
    expect(m.expiresAt).toBe("");
    expect(m.id).toBeTruthy();
  });
});

describe("applyMemoriesPending", () => {
  it("applies add, edit, delete in order", () => {
    const base = [memory("a")];
    const ops: MemoryPendingOp[] = [
      { kind: "add", memory: memory("b", { title: "New" }) },
      {
        kind: "edit",
        id: "a",
        patch: { body: "edited", tags: ["t1"] },
        at: "2026-03-01T00:00:00.000Z",
      },
      { kind: "delete", id: "b" },
    ];
    const result = applyMemoriesPending(base, ops);
    expect(result.map((m) => m.id)).toEqual(["a"]);
    expect(result[0]!.body).toBe("edited");
    expect(result[0]!.tags).toEqual(["t1"]);
    expect(result[0]!.updatedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("skips an add whose id already landed in the replica", () => {
    const result = applyMemoriesPending(
      [memory("a", { title: "server" })],
      [{ kind: "add", memory: memory("a", { title: "local" }) }],
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("server");
  });

  it("skips ops on remotely-deleted memories", () => {
    const result = applyMemoriesPending([], [{ kind: "edit", id: "gone", patch: { title: "x" }, at: "t" }]);
    expect(result).toEqual([]);
  });

  it("never lets a projected copy share tag arrays with the replica", () => {
    const base = [memory("a", { tags: ["orig"] })];
    const result = applyMemoriesPending(base, []);
    result[0]!.tags.push("mutated");
    expect(base[0]!.tags).toEqual(["orig"]);
  });
});

describe("enqueueMemoryOp", () => {
  it("folds an edit into a still-pending add", () => {
    const ops = enqueueMemoryOp([{ kind: "add", memory: memory("a", { title: "v1" }) }], {
      kind: "edit",
      id: "a",
      patch: { title: "v2", tags: ["t"] },
      at: "2026-03-01T00:00:00.000Z",
    });
    expect(ops).toHaveLength(1);
    expect(ops[0]!.kind).toBe("add");
    if (ops[0]!.kind === "add") {
      expect(ops[0]!.memory.title).toBe("v2");
      expect(ops[0]!.memory.tags).toEqual(["t"]);
    }
  });

  it("merges consecutive edits on the same memory (later fields win)", () => {
    const ops = enqueueMemoryOp([{ kind: "edit", id: "a", patch: { title: "t" }, at: "1" }], {
      kind: "edit",
      id: "a",
      patch: { tags: ["x"] },
      at: "2",
    });
    expect(ops).toHaveLength(1);
    if (ops[0]!.kind === "edit") expect(ops[0]!.patch).toEqual({ title: "t", tags: ["x"] });
  });

  it("delete cancels a still-pending add outright", () => {
    const ops = enqueueMemoryOp(
      [
        { kind: "add", memory: memory("a") },
        { kind: "edit", id: "a", patch: { body: "x" }, at: "1" },
      ],
      { kind: "delete", id: "a" },
    );
    expect(ops).toEqual([]);
  });

  it("delete drops earlier edits for an already-flushed memory but keeps the delete", () => {
    const ops = enqueueMemoryOp([{ kind: "edit", id: "a", patch: { body: "x" }, at: "1" }], {
      kind: "delete",
      id: "a",
    });
    expect(ops).toEqual([{ kind: "delete", id: "a" }]);
  });
});

describe("cell limit (Google Sheets caps a cell at 50k characters)", () => {
  const tooLong = "x".repeat(50_001);

  it("buildMemory refuses an oversized body with a precise error", () => {
    expect(() => buildMemory({ title: "ok", body: tooLong }, "user")).toThrowError(/50,000/);
  });

  it("updateMemory refuses an oversized patch before any write", async () => {
    const store = new FakeSheetStore([row("m1", "A", "body")]);
    await expect(updateMemory(store, "m1", { body: tooLong })).rejects.toThrowError(/50,000/);
    expect(store.rows).toHaveLength(2); // untouched
  });
});
