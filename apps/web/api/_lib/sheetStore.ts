import { APP_PROPERTY_KEY, APP_PROPERTY_VALUE } from "@memoria/sheet-core";
import type { SheetStore } from "@memoria/mcp-server";
import { authedJson } from "../../src/api/http.js";
import {
  appendRow as appendSheetRow,
  deleteRow as deleteSheetRow,
  getValues,
  updateRow as updateSheetRow,
} from "../../src/api/sheets.js";

/**
 * Both REST helper modules above (`apps/web/src/api/http.ts`, `sheets.ts`) are already plain
 * `fetch` wrappers with no browser-specific globals — the same code the web app uses to talk to
 * Sheets is reused here verbatim rather than duplicated. Only the board-*discovery* query below is
 * new: the web app's own `findBoards` (src/api/drive.ts) returns every board unordered for a
 * reconnect picker, but a stateless MCP call needs exactly one board with no user present to ask —
 * "most recently modified", per docs/ARCHITECTURE.md.
 */

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

interface DriveFilesListResponse {
  files?: { id: string }[];
}

/**
 * Finds the id of the most recently modified Todos board the token's `drive.file` grant can see, or
 * `undefined` if there isn't one. Exported standalone (rather than only as a private method below)
 * so the Drive response-mapping logic is unit-testable without going through the full `SheetStore`.
 */
export async function findMostRecentBoardId(token: string): Promise<string | undefined> {
  const q =
    `mimeType='${SPREADSHEET_MIME_TYPE}' and trashed=false and ` +
    `appProperties has { key='${APP_PROPERTY_KEY}' and value='${APP_PROPERTY_VALUE}' }`;
  const params = new URLSearchParams({
    q,
    orderBy: "modifiedTime desc",
    pageSize: "1",
    fields: "files(id)",
    spaces: "drive",
  });
  const data = await authedJson<DriveFilesListResponse>(token, `${DRIVE_FILES_URL}?${params.toString()}`);
  return data.files?.[0]?.id;
}

/**
 * No board was found for this account. The message is written for the agent to relay to the
 * person it's working for — the fix is on the web app, not this connector.
 */
export class NoBoardError extends Error {
  constructor() {
    super(
      "No Todos board was found in this Google account's Drive. Open the web app, sign in with the " +
        "same Google account used to add this connector, and create (or reconnect) a board — then " +
        "this connector will be able to find it.",
    );
    this.name = "NoBoardError";
  }
}

/**
 * Adapts the caller's own OAuth token into the `SheetStore` contract `registerTools` (from
 * `@memoria/mcp-server`) expects. One instance per request: board discovery runs at most once (on
 * first use) and its result is cached for the rest of that request's tool calls.
 */
export class RemoteSheetStore implements SheetStore {
  private spreadsheetIdPromise: Promise<string> | undefined;

  constructor(private readonly token: string) {}

  private spreadsheetId(): Promise<string> {
    if (!this.spreadsheetIdPromise) {
      this.spreadsheetIdPromise = findMostRecentBoardId(this.token).then((id) => {
        if (!id) throw new NoBoardError();
        return id;
      });
    }
    return this.spreadsheetIdPromise;
  }

  async readRows(): Promise<string[][]> {
    return getValues(this.token, await this.spreadsheetId());
  }

  async appendRow(row: string[]): Promise<void> {
    await appendSheetRow(this.token, await this.spreadsheetId(), row);
  }

  async updateRow(rowNumber: number, row: string[]): Promise<void> {
    await updateSheetRow(this.token, await this.spreadsheetId(), rowNumber, row);
  }

  async deleteRow(rowNumber: number): Promise<void> {
    await deleteSheetRow(this.token, await this.spreadsheetId(), rowNumber);
  }
}
