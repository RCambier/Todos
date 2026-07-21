import {
  APP_PROPERTY_KEY,
  APP_PROPERTY_VALUE,
  MEMORIES_APP_PROPERTY_KEY,
  MEMORIES_APP_PROPERTY_VALUE,
  NOTES_APP_PROPERTY_KEY,
  NOTES_APP_PROPERTY_VALUE,
  SETTINGS_APP_PROPERTY_KEY,
  SETTINGS_APP_PROPERTY_VALUE,
} from "@memoria/sheet-core";
import { authedFetch, authedJson } from "./http.js";

const BASE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";
const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

interface DriveFile {
  id: string;
  name: string;
  /** ISO 8601 last-modified timestamp. */
  modifiedTime: string;
}

/** What a tagged Memoria spreadsheet holds — a Todos board, a Notes grid, or an AI Memories grid. */
export type CollectionKind = "board" | "notes" | "memories";

export interface Collection extends DriveFile {
  kind: CollectionKind;
}

/**
 * THE collection-listing query — the one place the "what counts as a
 * Memoria sheet" filter lives: spreadsheets tagged at creation with
 * `todosBoard` (a board), `memoriaNotes` (a notes grid), or
 * `memoriaMemories` (an AI Memories grid) that the current
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
    `appProperties has { key='${NOTES_APP_PROPERTY_KEY}' and value='${NOTES_APP_PROPERTY_VALUE}' } or ` +
    `appProperties has { key='${MEMORIES_APP_PROPERTY_KEY}' and value='${MEMORIES_APP_PROPERTY_VALUE}' })`;
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
      appProperties?.[MEMORIES_APP_PROPERTY_KEY] === MEMORIES_APP_PROPERTY_VALUE
        ? ("memories" as const)
        : appProperties?.[NOTES_APP_PROPERTY_KEY] === NOTES_APP_PROPERTY_VALUE
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

/** Tags a spreadsheet as a Memoria AI Memories collection. */
export async function tagAsMemories(token: string, fileId: string): Promise<void> {
  await tagFile(token, fileId, { [MEMORIES_APP_PROPERTY_KEY]: MEMORIES_APP_PROPERTY_VALUE });
}

/** Tags a spreadsheet as the app's Settings sheet. Its own tag keeps it out of `findCollections`. */
export async function tagAsSettings(token: string, fileId: string): Promise<void> {
  await tagFile(token, fileId, { [SETTINGS_APP_PROPERTY_KEY]: SETTINGS_APP_PROPERTY_VALUE });
}

/**
 * Finds the app's Settings spreadsheet by its tag, newest-modified first if
 * two devices ever raced to create one. Null when it doesn't exist yet —
 * every setting is then at its default, and the sheet is only created the
 * first time a setting is changed.
 */
export async function findSettingsSheet(token: string): Promise<string | null> {
  const q =
    `mimeType='${SPREADSHEET_MIME_TYPE}' and trashed=false and ` +
    `appProperties has { key='${SETTINGS_APP_PROPERTY_KEY}' and value='${SETTINGS_APP_PROPERTY_VALUE}' }`;
  const params = new URLSearchParams({
    q,
    orderBy: "modifiedTime desc",
    pageSize: "1",
    fields: "files(id)",
    spaces: "drive",
  });
  const data = await authedJson<{ files?: { id: string }[] }>(token, `${BASE}?${params.toString()}`);
  return data.files?.[0]?.id ?? null;
}

/**
 * Unlinks a sheet from the app by removing its kind tag. The file itself is
 * untouched — it stays in the user's Drive (with all its data), it just no
 * longer appears in the app's listing.
 */
export async function untagCollection(token: string, fileId: string, kind: CollectionKind): Promise<void> {
  const key =
    kind === "memories"
      ? MEMORIES_APP_PROPERTY_KEY
      : kind === "notes"
        ? NOTES_APP_PROPERTY_KEY
        : APP_PROPERTY_KEY;
  // Drive removes an appProperties key when it's set to null.
  await tagFile(token, fileId, { [key]: null });
}

async function tagFile(
  token: string,
  fileId: string,
  appProperties: Record<string, string | null>,
): Promise<void> {
  const url = `${BASE}/${fileId}?fields=id`;
  await authedFetch(token, url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appProperties }),
  });
}

/**
 * Finds a folder by name under `parentId` ("root" for My Drive). With the
 * `drive.file` scope the search only sees folders this app created —
 * exactly the ones we manage. Returns `null` when there is none.
 */
export async function findFolder(token: string, name: string, parentId: string): Promise<string | null> {
  // Drive queries quote with single quotes; escape any in the name.
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q =
    `mimeType='${FOLDER_MIME_TYPE}' and trashed=false and ` +
    `name='${escaped}' and '${parentId}' in parents`;
  const params = new URLSearchParams({ q, pageSize: "1", fields: "files(id)", spaces: "drive" });
  const found = await authedJson<{ files?: { id: string }[] }>(token, `${BASE}?${params.toString()}`);
  return found.files?.[0]?.id ?? null;
}

/** Finds a folder by name under `parentId`, creating it if missing. */
export async function ensureFolder(token: string, name: string, parentId: string): Promise<string> {
  const existing = await findFolder(token, name, parentId);
  if (existing) return existing;

  const created = await authedJson<{ id: string }>(token, `${BASE}?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME_TYPE, parents: [parentId] }),
  });
  return created.id;
}

/** Renames a file or folder in place (id, parents, and contents unchanged). */
export async function renameFile(token: string, fileId: string, name: string): Promise<void> {
  await authedFetch(token, `${BASE}/${fileId}?fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
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

/**
 * Fetches the short-lived signed URL of Drive's own thumbnail for a file —
 * Google generates and CDN-serves resized versions of every image, so
 * attachments can render at tens of KB instead of the full original. Null
 * when Drive has no thumbnail (yet); the link itself expires after a few
 * hours, so callers cache per session and fall back on error.
 */
export async function fetchThumbnailLink(token: string, fileId: string): Promise<string | null> {
  const data = await authedJson<{ thumbnailLink?: string }>(token, `${BASE}/${fileId}?fields=thumbnailLink`);
  return data.thumbnailLink ?? null;
}

/**
 * Rewrites a `thumbnailLink`'s trailing size directive (`=s220`) to the
 * requested pixel size (longest edge). Only real http(s) CDN links are
 * rewritten — anything else (test fixtures, data: URLs) passes through.
 * Pure; exported for tests.
 */
export function thumbnailUrlAt(link: string, px: number): string {
  if (!/^https?:/.test(link)) return link;
  const size = Math.max(1, Math.round(px));
  const rewritten = link.replace(/=s\d+(-[a-z]+)*$/, `=s${size}`);
  return rewritten === link && !/=s\d+/.test(link) ? `${link}=s${size}` : rewritten;
}
