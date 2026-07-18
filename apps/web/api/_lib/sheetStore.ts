import { APP_PROPERTY_KEY, APP_PROPERTY_VALUE } from "@memoria/sheet-core";
import type { BoardCatalog, BoardInfo, SheetStore } from "@memoria/mcp-server";
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
 * Sheets is reused here verbatim rather than duplicated. Only the board-*listing* query below is
 * new: the web app's own `findBoards` (src/api/drive.ts) fetches ids and names for a reconnect
 * picker, while the catalog also needs `modifiedTime` so an agent can tell boards apart.
 */

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

interface DriveFilesListResponse {
  files?: { id: string; name: string; modifiedTime: string }[];
}

/**
 * Lists every tagged board the token's `drive.file` grant can see, newest-modified first.
 * Exported standalone (rather than only as a private method below) so the Drive response-mapping
 * logic is unit-testable without going through the full catalog.
 */
export async function findBoards(token: string): Promise<BoardInfo[]> {
  const q =
    `mimeType='${SPREADSHEET_MIME_TYPE}' and trashed=false and ` +
    `appProperties has { key='${APP_PROPERTY_KEY}' and value='${APP_PROPERTY_VALUE}' }`;
  const params = new URLSearchParams({
    q,
    orderBy: "modifiedTime desc",
    pageSize: "50",
    fields: "files(id,name,modifiedTime)",
    spaces: "drive",
  });
  const data = await authedJson<DriveFilesListResponse>(token, `${DRIVE_FILES_URL}?${params.toString()}`);
  return (data.files ?? []).map(({ id, name, modifiedTime }) => ({ id, name, modifiedTime }));
}

/** Adapts the caller's own OAuth token into a `SheetStore` bound to one spreadsheet. */
export class RemoteSheetStore implements SheetStore {
  constructor(
    private readonly token: string,
    private readonly spreadsheetId: string,
  ) {}

  async readRows(): Promise<string[][]> {
    return getValues(this.token, this.spreadsheetId);
  }

  async appendRow(row: string[]): Promise<void> {
    await appendSheetRow(this.token, this.spreadsheetId, row);
  }

  async updateRow(rowNumber: number, row: string[]): Promise<void> {
    await updateSheetRow(this.token, this.spreadsheetId, rowNumber, row);
  }

  async deleteRow(rowNumber: number): Promise<void> {
    await deleteSheetRow(this.token, this.spreadsheetId, rowNumber);
  }
}

/**
 * The caller's boards, as `registerTools` (from `@memoria/mcp-server`) expects them. One instance
 * per request: the Drive listing runs at most once (on first use) and is cached for the rest of
 * that request's tool calls — and not at all when every call names its `board_id`.
 */
export class RemoteBoardCatalog implements BoardCatalog {
  private boardsPromise: Promise<BoardInfo[]> | undefined;

  constructor(private readonly token: string) {}

  listBoards(): Promise<BoardInfo[]> {
    if (!this.boardsPromise) {
      this.boardsPromise = findBoards(this.token);
    }
    return this.boardsPromise;
  }

  openBoard(id: string): SheetStore {
    return new RemoteSheetStore(this.token, id);
  }
}
