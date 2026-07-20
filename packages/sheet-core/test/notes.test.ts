import { describe, expect, it } from "vitest";
import {
  addNote,
  applyNotesPending,
  buildNote,
  deleteNote,
  enqueueNoteOp,
  listNotes,
  NoteNotFoundError,
  NOTES_HEADERS,
  noteToRow,
  notesOrder,
  parseNotesSheet,
  rowToNote,
  updateNote,
  type Note,
  type NotePendingOp,
} from "../src/notes.js";
import { MalformedSheetError } from "../src/board.js";
import type { SheetStore } from "../src/store.js";

/** In-memory fake of the Sheets API surface notes.ts depends on. */
class FakeSheetStore implements SheetStore {
  rows: string[][];

  constructor(dataRows: string[][] = []) {
    this.rows = [[...NOTES_HEADERS], ...dataRows];
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
  source = "user",
  at = "2026-01-01T00:00:00.000Z",
): string[] {
  return [id, title, body, source, at, at];
}

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: "T",
    body: "B",
    source: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseNotesSheet", () => {
  it("parses a header-only sheet to zero notes", () => {
    const result = parseNotesSheet([[...NOTES_HEADERS]]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.notes).toEqual([]);
  });

  it("parses notes and skips blank rows", () => {
    const result = parseNotesSheet([
      [...NOTES_HEADERS],
      row("n1", "One"),
      ["", ""],
      row("n2", "", "body only"),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.notes.map((n) => n.id)).toEqual(["n1", "n2"]);
      expect(result.notes[1]!.title).toBe("");
      expect(result.notes[1]!.body).toBe("body only");
    }
  });

  it("rejects a wrong header with a precise message", () => {
    const result = parseNotesSheet([["id", "title", "text", "source", "created_at", "updated_at"]]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.row).toBe(1);
      expect(result.error.message).toContain('"body"');
    }
  });

  it("rejects a Tasks-shaped header (a board sheet is not a notes sheet)", () => {
    const result = parseNotesSheet([["id", "title", "status", "sort_order", "notes", "source"]]);
    expect(result.ok).toBe(false);
  });

  it("rejects extra columns beyond the schema", () => {
    const result = parseNotesSheet([[...NOTES_HEADERS, "extra"]]);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing id, locating the row", () => {
    const result = parseNotesSheet([[...NOTES_HEADERS], row("n1", "ok"), row("", "no id")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.row).toBe(3);
      expect(result.error.column).toBe("id");
    }
  });

  it("rejects duplicate ids", () => {
    const result = parseNotesSheet([[...NOTES_HEADERS], row("n1", "a"), row("n1", "b")]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("already used");
  });

  it("rejects missing timestamps", () => {
    const result = parseNotesSheet([[...NOTES_HEADERS], ["n1", "t", "b", "user", "", ""]]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.column).toBe("created_at");
  });
});

describe("rowToNote / noteToRow", () => {
  it("round-trips a note", () => {
    const n = note("n1", { title: "Hello", body: "# md\n\ntext", source: "agent" });
    expect(rowToNote(noteToRow(n))).toEqual(n);
  });

  it("coerces unknown sources to user", () => {
    expect(rowToNote(row("n1", "t", "b", "banana")).source).toBe("user");
  });
});

describe("notesOrder", () => {
  it("sorts by updatedAt desc, then createdAt desc", () => {
    const a = note("a", { updatedAt: "2026-01-01T00:00:00.000Z" });
    const b = note("b", { updatedAt: "2026-01-03T00:00:00.000Z" });
    const c = note("c", { updatedAt: "2026-01-02T00:00:00.000Z" });
    expect(notesOrder([a, b, c]).map((n) => n.id)).toEqual(["b", "c", "a"]);
  });
});

describe("note operations", () => {
  it("listNotes returns notes newest-edited first", async () => {
    const store = new FakeSheetStore([
      row("old", "Old", "", "user", "2026-01-01T00:00:00.000Z"),
      row("new", "New", "", "user", "2026-02-01T00:00:00.000Z"),
    ]);
    const notes = await listNotes(store);
    expect(notes.map((n) => n.id)).toEqual(["new", "old"]);
  });

  it("addNote appends a row with the given source", async () => {
    const store = new FakeSheetStore();
    const created = await addNote(store, { title: "Hi", body: "there" }, "agent");
    expect(store.rows).toHaveLength(2);
    expect(store.rows[1]).toEqual(noteToRow(created));
    expect(created.source).toBe("agent");
  });

  it("updateNote merges the patch onto the freshest row and bumps updatedAt", async () => {
    const store = new FakeSheetStore([row("n1", "Old title", "old body")]);
    const updated = await updateNote(store, "n1", { body: "new body" });
    expect(updated.title).toBe("Old title");
    expect(updated.body).toBe("new body");
    expect(store.rows[1]![2]).toBe("new body");
    expect(store.rows[1]![5]).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("updateNote locates the row by id even after rows moved", async () => {
    const store = new FakeSheetStore([row("a", "A"), row("b", "B")]);
    store.rows.splice(1, 1); // "a" deleted remotely; "b" shifts up
    await updateNote(store, "b", { title: "B2" });
    expect(store.rows[1]![1]).toBe("B2");
  });

  it("updateNote throws NoteNotFoundError for a vanished note", async () => {
    const store = new FakeSheetStore([row("n1", "x")]);
    await expect(updateNote(store, "gone", { title: "y" })).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it("deleteNote removes exactly that row", async () => {
    const store = new FakeSheetStore([row("a", "A"), row("b", "B")]);
    await deleteNote(store, "a");
    expect(store.rows.map((r) => r[0])).toEqual(["id", "b"]);
  });

  it("mutations refuse to touch a malformed sheet", async () => {
    const store = new FakeSheetStore([["", "no id", "", "user", "x", "x"]]);
    await expect(updateNote(store, "n1", { title: "y" })).rejects.toBeInstanceOf(MalformedSheetError);
  });

  it("buildNote defaults title and body to empty strings", () => {
    const n = buildNote({}, "user");
    expect(n.title).toBe("");
    expect(n.body).toBe("");
    expect(n.id).toBeTruthy();
  });
});

describe("applyNotesPending", () => {
  it("applies add, edit, delete in order", () => {
    const base = [note("a")];
    const ops: NotePendingOp[] = [
      { kind: "add", note: note("b", { title: "New" }) },
      { kind: "edit", id: "a", patch: { body: "edited" }, at: "2026-03-01T00:00:00.000Z" },
      { kind: "delete", id: "b" },
    ];
    const result = applyNotesPending(base, ops);
    expect(result.map((n) => n.id)).toEqual(["a"]);
    expect(result[0]!.body).toBe("edited");
    expect(result[0]!.updatedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("skips an add whose id already landed in the replica", () => {
    const result = applyNotesPending(
      [note("a", { title: "server" })],
      [{ kind: "add", note: note("a", { title: "local" }) }],
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("server");
  });

  it("skips ops on remotely-deleted notes", () => {
    const result = applyNotesPending([], [{ kind: "edit", id: "gone", patch: { title: "x" }, at: "t" }]);
    expect(result).toEqual([]);
  });
});

describe("enqueueNoteOp", () => {
  it("folds an edit into a still-pending add", () => {
    const ops = enqueueNoteOp([{ kind: "add", note: note("a", { title: "v1" }) }], {
      kind: "edit",
      id: "a",
      patch: { title: "v2" },
      at: "2026-03-01T00:00:00.000Z",
    });
    expect(ops).toHaveLength(1);
    expect(ops[0]!.kind).toBe("add");
    if (ops[0]!.kind === "add") expect(ops[0]!.note.title).toBe("v2");
  });

  it("merges consecutive edits on the same note (later fields win)", () => {
    const ops = enqueueNoteOp([{ kind: "edit", id: "a", patch: { title: "t" }, at: "1" }], {
      kind: "edit",
      id: "a",
      patch: { body: "b" },
      at: "2",
    });
    expect(ops).toHaveLength(1);
    if (ops[0]!.kind === "edit") expect(ops[0]!.patch).toEqual({ title: "t", body: "b" });
  });

  it("delete cancels a still-pending add outright", () => {
    const ops = enqueueNoteOp(
      [
        { kind: "add", note: note("a") },
        { kind: "edit", id: "a", patch: { body: "x" }, at: "1" },
      ],
      { kind: "delete", id: "a" },
    );
    expect(ops).toEqual([]);
  });

  it("delete drops earlier edits for an already-flushed note but keeps the delete", () => {
    const ops = enqueueNoteOp([{ kind: "edit", id: "a", patch: { body: "x" }, at: "1" }], {
      kind: "delete",
      id: "a",
    });
    expect(ops).toEqual([{ kind: "delete", id: "a" }]);
  });
});
