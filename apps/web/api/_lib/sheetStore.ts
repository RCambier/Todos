import type { BoardInfo, MemoriaCatalog, SheetStore } from "@memoria/mcp-server";
import { type BoardColumn, LEGACY_COLUMNS } from "@memoria/sheet-core";
import { readColumnsTab } from "../../src/api/columnsSheet.js";
import { findCollections, type Collection, type CollectionKind } from "../../src/api/drive.js";
import { MEMORIES_TAB, NOTES_TAB } from "../../src/api/sheets.js";
import { HttpSheetStore } from "../../src/api/sheetStore.js";

/**
 * The connector's catalog: the same Drive listing (`src/api/drive.ts`) and
 * the same `SheetStore` adapter (`src/api/sheetStore.ts`) the web app uses,
 * bound to the caller's per-request OAuth token. One instance per request:
 * the Drive listing runs at most once (on first use, shared by the board,
 * notes, and memories sides) and is cached for the rest of that request's
 * tool calls — and not at all when every call names its target id.
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

  listMemoriesCollections(): Promise<BoardInfo[]> {
    return this.listOfKind("memories");
  }

  openBoard(id: string): SheetStore {
    return new HttpSheetStore(this.token, id);
  }

  /**
   * A board's columns, read straight from its `Columns` tab. A board that
   * predates customizable columns (no tab, or a header-only tab) reports the
   * legacy set — the connector reads columns but never migrates them; the
   * web app persists the migration when the user next opens the board.
   */
  async readColumns(id: string): Promise<BoardColumn[]> {
    const columns = await readColumnsTab(this.token, id);
    return columns && columns.length > 0 ? columns : [...LEGACY_COLUMNS];
  }

  openNotes(id: string): SheetStore {
    return new HttpSheetStore(this.token, id, NOTES_TAB);
  }

  openMemories(id: string): SheetStore {
    return new HttpSheetStore(this.token, id, MEMORIES_TAB);
  }
}
