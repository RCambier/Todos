import type { SheetStore } from "./sheetStore.js";

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
export async function resolveBoard(catalog: BoardCatalog, boardId?: string): Promise<SheetStore> {
  if (boardId) return catalog.openBoard(boardId);
  const boards = await catalog.listBoards();
  if (boards.length === 0) throw new NoBoardError();
  if (boards.length > 1) throw new AmbiguousBoardError(boards);
  return catalog.openBoard(boards[0]!.id);
}
