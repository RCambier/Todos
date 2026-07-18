/**
 * The package's entrypoint: tool registration and the `SheetStore` /
 * `BoardCatalog` contracts, deliberately transport-free. The hosted MCP
 * function in `apps/web/api/` mounts these tools over Streamable HTTP against
 * its own catalog (REST `fetch` with the caller's per-request OAuth token).
 */
export { registerTools } from "./tools.js";
export type { SheetStore } from "./sheetStore.js";
export { AmbiguousBoardError, NoBoardError, resolveBoard } from "./catalog.js";
export type { BoardCatalog, BoardInfo } from "./catalog.js";
