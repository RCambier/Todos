import {
  APP_PROPERTY_KEY,
  APP_PROPERTY_VALUE,
  NOTES_APP_PROPERTY_KEY,
  NOTES_APP_PROPERTY_VALUE,
} from "@memoria/sheet-core";
import { authedFetch, authedJson } from "./http.js";

const BASE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";
const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export interface DriveFile {
  id: string;
  name: string;
  /** ISO 8601 last-modified timestamp. */
  modifiedTime: string;
}

/** What a tagged Memoria spreadsheet holds — a Todos board or a Notes grid. */
export type CollectionKind = "board" | "notes";

export interface Collection extends DriveFile {
  kind: CollectionKind;
}

/**
 * THE collection-listing query — the one place the "what counts as a
 * Memoria sheet" filter lives: spreadsheets tagged at creation with
 * `todosBoard` (a board) or `memoriaNotes` (a notes grid) that the current
 * `drive.file`-scoped token can still see, newest-modified first. The
 * `appProperties` on each file say which kind it is. Used by the web app's
 * tabs/shelf and by the hosted MCP connector's catalog
 * (`api/_lib/sheetStore.ts`), which splits it by kind so the board tools
 * can never open a notes sheet and vice versa.
 */
export async function findCollections(token: string): Promise<Collection[]> {
  const q =
    `mimeType='${SPREADSHEET_MIME_TYPE}' and trashed=false and ` +
    `(appProperties has { key='${APP_PROPERTY_KEY}' and value='${APP_PROPERTY_VALUE}' } or ` +
    `appProperties has { key='${NOTES_APP_PROPERTY_KEY}' and value='${NOTES_APP_PROPERTY_VALUE}' })`;
  const params = new URLSearchParams({
    q,
    orderBy: "modifiedTime desc",
    pageSize: "50",
    fields: "files(id,name,modifiedTime,appProperties)",
    spaces: "drive",
  });
  const data = await authedJson<{ files?: (DriveFile & { appProperties?: Record<string, string> })[] }>(
    token,
    `${BASE}?${params.toString()}`,
  );
  return (data.files ?? []).map(({ id, name, modifiedTime, appProperties }) => ({
    id,
    name,
    modifiedTime,
    kind:
      appProperties?.[NOTES_APP_PROPERTY_KEY] === NOTES_APP_PROPERTY_VALUE
        ? ("notes" as const)
        : ("board" as const),
  }));
}

/** Tags a spreadsheet as a Todos board so `findCollections` can find it later from any device. */
export async function tagAsBoard(token: string, fileId: string): Promise<void> {
  await tagFile(token, fileId, { [APP_PROPERTY_KEY]: APP_PROPERTY_VALUE });
}

/** Tags a spreadsheet as a Memoria notes collection. */
export async function tagAsNotes(token: string, fileId: string): Promise<void> {
  await tagFile(token, fileId, { [NOTES_APP_PROPERTY_KEY]: NOTES_APP_PROPERTY_VALUE });
}

async function tagFile(token: string, fileId: string, appProperties: Record<string, string>): Promise<void> {
  const url = `${BASE}/${fileId}?fields=id`;
  await authedFetch(token, url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appProperties }),
  });
}

/** Fetches basic metadata for a Picker-selected file, to check it's actually a spreadsheet. */
export async function getFileMeta(
  token: string,
  fileId: string,
): Promise<{ id: string; name: string; mimeType: string }> {
  const url = `${BASE}/${fileId}?fields=id,name,mimeType`;
  return authedJson(token, url);
}

/**
 * Finds a folder by name under `parentId` ("root" for My Drive), creating it
 * if missing. With the `drive.file` scope the search only sees folders this
 * app created — exactly the ones we manage.
 */
export async function ensureFolder(token: string, name: string, parentId: string): Promise<string> {
  // Drive queries quote with single quotes; escape any in the name.
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q =
    `mimeType='${FOLDER_MIME_TYPE}' and trashed=false and ` +
    `name='${escaped}' and '${parentId}' in parents`;
  const params = new URLSearchParams({ q, pageSize: "1", fields: "files(id)", spaces: "drive" });
  const found = await authedJson<{ files?: { id: string }[] }>(token, `${BASE}?${params.toString()}`);
  const existing = found.files?.[0]?.id;
  if (existing) return existing;

  const created = await authedJson<{ id: string }>(token, `${BASE}?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME_TYPE, parents: [parentId] }),
  });
  return created.id;
}

/**
 * Moves a file into `folderId`, detaching it from its current parents.
 * No-op when it's already there.
 */
export async function moveToFolder(token: string, fileId: string, folderId: string): Promise<void> {
  const meta = await authedJson<{ parents?: string[] }>(token, `${BASE}/${fileId}?fields=parents`);
  const parents = meta.parents ?? [];
  if (parents.includes(folderId)) return;
  const params = new URLSearchParams({ fields: "id" });
  params.set("addParents", folderId);
  if (parents.length > 0) params.set("removeParents", parents.join(","));
  await authedFetch(token, `${BASE}/${fileId}?${params.toString()}`, { method: "PATCH" });
}

/** Uploads a binary file (an image attachment) into a folder. Returns the new file's id. */
export async function uploadFile(
  token: string,
  folderId: string,
  name: string,
  blob: Blob,
): Promise<{ id: string; name: string }> {
  const metadata = { name, parents: [folderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", blob);
  return authedJson(token, `${UPLOAD_BASE}?uploadType=multipart&fields=id,name`, {
    method: "POST",
    body: form,
  });
}

/** Downloads a Drive file's content (used to display image attachments with the user's token). */
export async function downloadFile(token: string, fileId: string): Promise<Blob> {
  const res = await authedFetch(token, `${BASE}/${fileId}?alt=media`);
  return res.blob();
}
