import { describe, expect, it } from "vitest";
import {
  AmbiguousBoardError,
  AmbiguousMemoriesCollectionError,
  AmbiguousNotesCollectionError,
  NoBoardError,
  NoMemoriesCollectionError,
  NoNotesCollectionError,
  resolveBoard,
  resolveMemories,
  resolveNotes,
  type BoardCatalog,
  type BoardInfo,
  type MemoriesCatalog,
  type NotesCatalog,
} from "../src/catalog.js";
import { LEGACY_COLUMNS, type SheetStore } from "@memoria/sheet-core";

function fakeStore(id: string): SheetStore {
  return {
    readRows: async () => [[id]],
    appendRow: async () => {},
    updateRow: async () => {},
    deleteRow: async () => {},
  };
}

function boardInfo(id: string, name: string): BoardInfo {
  return { id, name, modifiedTime: "2026-07-18T00:00:00.000Z" };
}

/** A catalog that records which boards get opened and whether listing was needed. */
function fakeCatalog(boards: BoardInfo[]): BoardCatalog & { opened: string[]; listed: number } {
  return {
    opened: [],
    listed: 0,
    async listBoards() {
      this.listed += 1;
      return boards;
    },
    openBoard(id: string) {
      this.opened.push(id);
      return fakeStore(id);
    },
    async readColumns() {
      return [...LEGACY_COLUMNS];
    },
  };
}

describe("resolveBoard", () => {
  it("opens the named board directly, without listing", async () => {
    const catalog = fakeCatalog([boardInfo("a", "Todos"), boardInfo("b", "Notes")]);
    const store = await resolveBoard(catalog, "b");
    expect(await store.readRows()).toEqual([["b"]]);
    expect(catalog.opened).toEqual(["b"]);
    expect(catalog.listed).toBe(0);
  });

  it("defaults to the account's only board when boardId is omitted", async () => {
    const catalog = fakeCatalog([boardInfo("only", "Todos")]);
    await resolveBoard(catalog);
    expect(catalog.opened).toEqual(["only"]);
  });

  it("throws NoBoardError when the account has no boards", async () => {
    const catalog = fakeCatalog([]);
    await expect(resolveBoard(catalog)).rejects.toBeInstanceOf(NoBoardError);
    expect(catalog.opened).toEqual([]);
  });

  it("refuses to guess between several boards, naming them in the error", async () => {
    const catalog = fakeCatalog([boardInfo("a", "Todos"), boardInfo("b", "Notes")]);
    const err = await resolveBoard(catalog).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AmbiguousBoardError);
    expect((err as Error).message).toContain('"Todos" (board_id a)');
    expect((err as Error).message).toContain('"Notes" (board_id b)');
    expect(catalog.opened).toEqual([]);
  });
});

/** The notes-side twin of `fakeCatalog`. */
function fakeNotesCatalog(collections: BoardInfo[]): NotesCatalog & { opened: string[]; listed: number } {
  return {
    opened: [],
    listed: 0,
    async listNotesCollections() {
      this.listed += 1;
      return collections;
    },
    openNotes(id: string) {
      this.opened.push(id);
      return fakeStore(id);
    },
  };
}

describe("resolveNotes", () => {
  it("opens the named collection directly, without listing", async () => {
    const catalog = fakeNotesCatalog([boardInfo("a", "Notes"), boardInfo("b", "Recipes")]);
    const store = await resolveNotes(catalog, "b");
    expect(await store.readRows()).toEqual([["b"]]);
    expect(catalog.opened).toEqual(["b"]);
    expect(catalog.listed).toBe(0);
  });

  it("defaults to the account's only notes collection when notesId is omitted", async () => {
    const catalog = fakeNotesCatalog([boardInfo("only", "Notes")]);
    await resolveNotes(catalog);
    expect(catalog.opened).toEqual(["only"]);
  });

  it("throws NoNotesCollectionError when the account has none", async () => {
    const catalog = fakeNotesCatalog([]);
    await expect(resolveNotes(catalog)).rejects.toBeInstanceOf(NoNotesCollectionError);
    expect(catalog.opened).toEqual([]);
  });

  it("refuses to guess between several collections, naming them in the error", async () => {
    const catalog = fakeNotesCatalog([boardInfo("a", "Notes"), boardInfo("b", "Recipes")]);
    const err = await resolveNotes(catalog).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AmbiguousNotesCollectionError);
    expect((err as Error).message).toContain('"Notes" (notes_id a)');
    expect((err as Error).message).toContain('"Recipes" (notes_id b)');
    expect(catalog.opened).toEqual([]);
  });
});

/** The memories-side twin of `fakeCatalog`. */
function fakeMemoriesCatalog(
  collections: BoardInfo[],
): MemoriesCatalog & { opened: string[]; listed: number } {
  return {
    opened: [],
    listed: 0,
    async listMemoriesCollections() {
      this.listed += 1;
      return collections;
    },
    openMemories(id: string) {
      this.opened.push(id);
      return fakeStore(id);
    },
  };
}

describe("resolveMemories", () => {
  it("opens the named collection directly, without listing", async () => {
    const catalog = fakeMemoriesCatalog([boardInfo("a", "AI Memories"), boardInfo("b", "Work Memories")]);
    const store = await resolveMemories(catalog, "b");
    expect(await store.readRows()).toEqual([["b"]]);
    expect(catalog.opened).toEqual(["b"]);
    expect(catalog.listed).toBe(0);
  });

  it("defaults to the account's only memories collection when memoriesId is omitted", async () => {
    const catalog = fakeMemoriesCatalog([boardInfo("only", "AI Memories")]);
    await resolveMemories(catalog);
    expect(catalog.opened).toEqual(["only"]);
  });

  it("throws NoMemoriesCollectionError when the account has none", async () => {
    const catalog = fakeMemoriesCatalog([]);
    await expect(resolveMemories(catalog)).rejects.toBeInstanceOf(NoMemoriesCollectionError);
    expect(catalog.opened).toEqual([]);
  });

  it("refuses to guess between several collections, naming them in the error", async () => {
    const catalog = fakeMemoriesCatalog([boardInfo("a", "AI Memories"), boardInfo("b", "Work Memories")]);
    const err = await resolveMemories(catalog).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AmbiguousMemoriesCollectionError);
    expect((err as Error).message).toContain('"AI Memories" (memories_id a)');
    expect((err as Error).message).toContain('"Work Memories" (memories_id b)');
    expect(catalog.opened).toEqual([]);
  });
});
