/**
 * The package's entrypoint: tool registration and the `SheetStore` contract,
 * deliberately transport-free. The hosted MCP function in `apps/web/api/`
 * mounts these six tools over Streamable HTTP against its own `SheetStore`
 * (REST `fetch` with the caller's per-request OAuth token).
 */
export { registerTools } from "./tools.js";
export type { SheetStore } from "./sheetStore.js";
