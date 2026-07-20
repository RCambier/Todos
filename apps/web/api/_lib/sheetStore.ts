import type { BoardInfo, MemoriaCatalog, SheetStore } from "@memoria/mcp-server";
import { findCollections, type Collection, type CollectionKind } from "../../src/api/drive.js";
import { NOTES_TAB } from "../../src/api/sheets.js";
import { HttpSheetStore } from "../../src/api/sheetStore.js";

/**
 * The connector's catalog: the same Drive listing (`src/api/drive.ts`) and
 * the same `SheetStore` adapter (`src/api/sheetStore.ts`) the web app uses,
 * bound to the caller's per-request OAuth token. One instance per request:
 * the Drive listing runs at most once (on first use, shared by the board
 * and notes sides) and is cached for the rest of that request's tool calls
 * — and not at all when every call names its target id.
 */
export class RemoteCatalog implements MemoriaCatalog {
  private collectionsPromise: Promise<Collection[]> | undefined;

  constructor(private readonly token: string) {}

  private async listOfKind(kind: CollectionKind): Promise<BoardInfo[]> {
    if (!this.collectionsPromise) {
      this.collectionsPromise = findCollections(this.token);
    }
    const collections = await this.collectionsPromise;
    return collections
      .filter((c) => c.kind === kind)
      .map(({ id, name, modifiedTime }) => ({ id, name, modifiedTime }));
  }

  listBoards(): Promise<BoardInfo[]> {
    return this.listOfKind("board");
  }

  listNotesCollections(): Promise<BoardInfo[]> {
    return this.listOfKind("notes");
  }

  openBoard(id: string): SheetStore {
    return new HttpSheetStore(this.token, id);
  }

  openNotes(id: string): SheetStore {
    return new HttpSheetStore(this.token, id, NOTES_TAB);
  }
}
