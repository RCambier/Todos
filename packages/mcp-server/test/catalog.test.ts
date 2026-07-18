import { describe, expect, it } from "vitest";
import {
  AmbiguousBoardError,
  NoBoardError,
  resolveBoard,
  type BoardCatalog,
  type BoardInfo,
} from "../src/catalog.js";
import type { SheetStore } from "../src/sheetStore.js";

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
