import { ensureFolder, moveToFolder, type Collection, type CollectionKind } from "./drive.js";

/**
 * The app's home in the user's Drive:
 *
 *     Memoria/
 *       boards/            ← board spreadsheets
 *       notes/             ← notes spreadsheets
 *         attachments/     ← images pasted into notes
 *
 * Folders are found-or-created lazily, once per session. Collections that
 * predate this layout (or were created on another device before it ran)
 * are moved in by `organizeCollections`, with a localStorage memo so each
 * file's parents are checked at most once per browser.
 */

export interface MemoriaFolders {
  memoriaId: string;
  boardsId: string;
  notesId: string;
  attachmentsId: string;
}

const ORGANIZED_KEY = "todos:organizedFiles";

let foldersPromise: Promise<MemoriaFolders> | null = null;

/** Finds or creates the Memoria folder tree. Memoized per session; a failure clears the memo. */
export function ensureMemoriaFolders(token: string): Promise<MemoriaFolders> {
  if (!foldersPromise) {
    foldersPromise = (async () => {
      const memoriaId = await ensureFolder(token, "Memoria", "root");
      const [boardsId, notesId] = await Promise.all([
        ensureFolder(token, "boards", memoriaId),
        ensureFolder(token, "notes", memoriaId),
      ]);
      const attachmentsId = await ensureFolder(token, "attachments", notesId!);
      return { memoriaId, boardsId: boardsId!, notesId: notesId!, attachmentsId };
    })().catch((err: unknown) => {
      foldersPromise = null;
      throw err;
    });
  }
  return foldersPromise;
}

/** The folder a collection of `kind` belongs in. */
export function folderForKind(folders: MemoriaFolders, kind: CollectionKind): string {
  return kind === "notes" ? folders.notesId : folders.boardsId;
}

function readOrganized(): Set<string> {
  try {
    const raw = localStorage.getItem(ORGANIZED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeOrganized(ids: Set<string>): void {
  try {
    localStorage.setItem(ORGANIZED_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable — worst case the parents get re-checked next boot.
  }
}

/** Marks a file as already living in the Memoria tree (e.g. it was just created there). */
export function markOrganized(fileId: string): void {
  const ids = readOrganized();
  ids.add(fileId);
  writeOrganized(ids);
}

/**
 * Moves every tagged collection into `Memoria/boards/` or `Memoria/notes/`.
 * Best-effort and quiet: a failure (offline, revoked file) leaves that file
 * where it is and retries on a later boot. Never touches file contents.
 */
export async function organizeCollections(token: string, collections: Collection[]): Promise<void> {
  const organized = readOrganized();
  const pending = collections.filter((c) => !organized.has(c.id));
  if (pending.length === 0) return;

  const folders = await ensureMemoriaFolders(token);
  for (const c of pending) {
    try {
      await moveToFolder(token, c.id, folderForKind(folders, c.kind));
      organized.add(c.id);
    } catch {
      // Leave it for a future boot; organizing is never load-bearing.
    }
  }
  writeOrganized(organized);
}
