/**
 * The package's entrypoint: tool registration and the catalog contracts
 * (boards + notes collections), deliberately transport-free. The board operations themselves
 * (and the `SheetStore` seam they run against) live in `@memoria/sheet-core`
 * — this package only wraps them as MCP tools. The hosted MCP function in
 * `apps/web/api/` mounts these tools over Streamable HTTP against its own
 * catalog (REST `fetch` with the caller's per-request OAuth token).
 */
export { registerTools } from "./tools.js";
export type { SheetStore } from "@memoria/sheet-core";
export {
  AmbiguousBoardError,
  AmbiguousNotesCollectionError,
  NoBoardError,
  NoNotesCollectionError,
  resolveBoard,
  resolveNotes,
} from "./catalog.js";
export type { BoardCatalog, BoardInfo, MemoriaCatalog, NotesCatalog } from "./catalog.js";
