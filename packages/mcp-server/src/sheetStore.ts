/**
 * The narrow surface `board.ts` (and the tools built on it) need from a
 * sheet backend, always bound to a single board — which board is the
 * `BoardCatalog`'s job (see `catalog.ts`). Transport-free by design — no
 * `googleapis`, no `fetch`, nothing that assumes how the caller
 * authenticates. This is what lets `registerTools` run against the hosted
 * Vercel MCP endpoint (a plain-`fetch` wrapper authenticated with the
 * caller's own Google OAuth token — see `apps/web/api/_lib/sheetStore.ts`).
 *
 * Implementations structurally satisfy this interface; tests can supply a
 * lightweight fake instead of talking to a real API.
 */
export interface SheetStore {
  readRows(): Promise<string[][]>;
  appendRow(row: string[]): Promise<void>;
  updateRow(rowNumber: number, row: string[]): Promise<void>;
  deleteRow(rowNumber: number): Promise<void>;
}
