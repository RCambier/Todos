import type { BoardColumn, SheetStore } from "@memoria/sheet-core";

/** A board as the catalog sees it: identity plus enough metadata to pick one. */
export interface BoardInfo {
  id: string;
  name: string;
  /** ISO 8601 last-modified timestamp. */
  modifiedTime: string;
}

/**
 * The multi-board surface `registerTools` runs against. Transport-free for the
 * same reason as `SheetStore`: the hosted connector backs it with Drive
 * queries using the caller's own OAuth token; tests back it with in-memory
 * fakes.
 */
export interface BoardCatalog {
  /** Every board this account can see, newest-modified first. */
  listBoards(): Promise<BoardInfo[]>;
  /** A store bound to one board. No existence check — the backend errors on first use if `id` is bogus. */
  openBoard(id: string): SheetStore;
  /**
   * A board's columns (from its `Columns` tab), in display order. Falls back
   * to the legacy column set for a board that predates customization — the
   * connector reads columns, never migrates them (the web app does that).
   */
  readColumns(id: string): Promise<BoardColumn[]>;
}

/** The account has no board at all. The message is written for the agent to relay. */
export class NoBoardError extends Error {
  constructor() {
    super(
      "No board was found in this Google account's Drive. Open the web app, sign in with the " +
        "same Google account used to add this connector, and create (or reconnect) a board — then " +
        "this connector will be able to find it.",
    );
    this.name = "NoBoardError";
  }
}

/** `board_id` was omitted but the account has several boards — refusing to guess. */
export class AmbiguousBoardError extends Error {
  constructor(boards: BoardInfo[]) {
    const listing = boards.map((b) => `"${b.name}" (board_id ${b.id})`).join(", ");
    super(`This account has ${boards.length} boards — pass board_id to say which one: ${listing}.`);
    this.name = "AmbiguousBoardError";
  }
}

/**
 * Resolves which board a tool call targets. An explicit `boardId` wins (and
 * skips the listing round-trip entirely); otherwise a lone board is
 * unambiguous, no board is `NoBoardError`, and several boards is
 * `AmbiguousBoardError` — never a silent guess.
 */
export async function resolveBoardId(catalog: BoardCatalog, boardId?: string): Promise<string> {
  if (boardId) return boardId;
  const boards = await catalog.listBoards();
  if (boards.length === 0) throw new NoBoardError();
  if (boards.length > 1) throw new AmbiguousBoardError(boards);
  return boards[0]!.id;
}

export async function resolveBoard(catalog: BoardCatalog, boardId?: string): Promise<SheetStore> {
  return catalog.openBoard(await resolveBoardId(catalog, boardId));
}

/** Resolves a board and reads its columns in one step — for the tools that need both. */
export async function resolveBoardWithColumns(
  catalog: BoardCatalog,
  boardId?: string,
): Promise<{ store: SheetStore; columns: BoardColumn[] }> {
  const id = await resolveBoardId(catalog, boardId);
  const [store, columns] = [catalog.openBoard(id), await catalog.readColumns(id)];
  return { store, columns };
}

/**
 * The notes side of the catalog — notes collections are spreadsheets tagged
 * `memoriaNotes` (never listed as boards, and vice versa), and a notes store
 * is bound to the `Notes` tab. Same transport-free shape as `BoardCatalog`.
 */
export interface NotesCatalog {
  /** Every notes collection this account can see, newest-modified first. */
  listNotesCollections(): Promise<BoardInfo[]>;
  /** A store bound to one notes collection's `Notes` tab. No existence check. */
  openNotes(id: string): SheetStore;
}

/**
 * The memories side of the catalog — memories collections are spreadsheets
 * tagged `memoriaMemories` (never listed as boards or notes collections),
 * and a memories store is bound to the `Memories` tab. Same transport-free
 * shape as `BoardCatalog`.
 */
export interface MemoriesCatalog {
  /** Every memories collection this account can see, newest-modified first. */
  listMemoriesCollections(): Promise<BoardInfo[]>;
  /** A store bound to one memories collection's `Memories` tab. No existence check. */
  openMemories(id: string): SheetStore;
}

/** Everything `registerTools` runs against: boards, notes, and memories collections. */
export type MemoriaCatalog = BoardCatalog & NotesCatalog & MemoriesCatalog;

/** The account has no notes collection at all. Written for the agent to relay. */
export class NoNotesCollectionError extends Error {
  constructor() {
    super(
      "No notes collection was found in this Google account's Drive. Open the web app, sign in " +
        "with the same Google account used to add this connector, and create a Notes collection " +
        "(the “+” next to the tabs → Notes) — then this connector will be able to read and write notes.",
    );
    this.name = "NoNotesCollectionError";
  }
}

/** `notes_id` was omitted but the account has several notes collections — refusing to guess. */
export class AmbiguousNotesCollectionError extends Error {
  constructor(collections: BoardInfo[]) {
    const listing = collections.map((c) => `"${c.name}" (notes_id ${c.id})`).join(", ");
    super(
      `This account has ${collections.length} notes collections — pass notes_id to say which one: ${listing}.`,
    );
    this.name = "AmbiguousNotesCollectionError";
  }
}

/** Resolves which notes collection a tool call targets — same rules as `resolveBoard`. */
export async function resolveNotes(catalog: NotesCatalog, notesId?: string): Promise<SheetStore> {
  if (notesId) return catalog.openNotes(notesId);
  const collections = await catalog.listNotesCollections();
  if (collections.length === 0) throw new NoNotesCollectionError();
  if (collections.length > 1) throw new AmbiguousNotesCollectionError(collections);
  return catalog.openNotes(collections[0]!.id);
}

/** The account has no memories collection at all. Written for the agent to relay. */
export class NoMemoriesCollectionError extends Error {
  constructor() {
    super(
      "No AI Memories collection was found in this Google account's Drive. Open the web app, " +
        "sign in with the same Google account used to add this connector, and create an " +
        "AI Memories collection (the “+” next to the tabs → AI Memories) — then this connector " +
        "will be able to read and write memories.",
    );
    this.name = "NoMemoriesCollectionError";
  }
}

/** `memories_id` was omitted but the account has several memories collections — refusing to guess. */
export class AmbiguousMemoriesCollectionError extends Error {
  constructor(collections: BoardInfo[]) {
    const listing = collections.map((c) => `"${c.name}" (memories_id ${c.id})`).join(", ");
    super(
      `This account has ${collections.length} memories collections — pass memories_id to say which one: ${listing}.`,
    );
    this.name = "AmbiguousMemoriesCollectionError";
  }
}

/** Resolves which memories collection a tool call targets — same rules as `resolveBoard`. */
export async function resolveMemories(catalog: MemoriesCatalog, memoriesId?: string): Promise<SheetStore> {
  if (memoriesId) return catalog.openMemories(memoriesId);
  const collections = await catalog.listMemoriesCollections();
  if (collections.length === 0) throw new NoMemoriesCollectionError();
  if (collections.length > 1) throw new AmbiguousMemoriesCollectionError(collections);
  return catalog.openMemories(collections[0]!.id);
}
