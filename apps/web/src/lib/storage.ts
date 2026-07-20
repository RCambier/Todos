import type { Note, NotePendingOp, PendingOp, Task } from "@memoria/sheet-core";

const SPREADSHEET_ID_KEY = "todos:spreadsheetId";
const COLLECTION_KIND_KEY = "todos:collectionKind";
const REPLICA_KEY_PREFIX = "todos:replica:";
const OUTBOX_KEY_PREFIX = "todos:outbox:";
const CALENDAR_MIRROR_KEY = "todos:calendarMirror";
const NOTES_REPLICA_KEY_PREFIX = "todos:notes-replica:";
const NOTES_OUTBOX_KEY_PREFIX = "todos:notes-outbox:";

/** What the cached spreadsheet holds; older caches without the key mean "board". */
export type CachedCollectionKind = "board" | "notes";

/** Minimal subset of the `Storage` interface, so tests can inject a fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function getCachedSpreadsheetId(store: KeyValueStore = localStorage): string | null {
  return store.getItem(SPREADSHEET_ID_KEY);
}

export function setCachedSpreadsheetId(id: string, store: KeyValueStore = localStorage): void {
  store.setItem(SPREADSHEET_ID_KEY, id);
}

export function clearCachedSpreadsheetId(store: KeyValueStore = localStorage): void {
  store.removeItem(SPREADSHEET_ID_KEY);
  store.removeItem(COLLECTION_KIND_KEY);
}

/** The cached collection's kind — decides which view boots before any network. */
export function getCachedCollectionKind(store: KeyValueStore = localStorage): CachedCollectionKind {
  return store.getItem(COLLECTION_KIND_KEY) === "notes" ? "notes" : "board";
}

export function setCachedCollectionKind(
  kind: CachedCollectionKind,
  store: KeyValueStore = localStorage,
): void {
  store.setItem(COLLECTION_KIND_KEY, kind);
}

/** Whether the user turned on the Google Tasks calendar mirror (Settings). */
export function getCalendarMirrorEnabled(store: KeyValueStore = localStorage): boolean {
  return store.getItem(CALENDAR_MIRROR_KEY) === "on";
}

export function setCalendarMirrorEnabled(enabled: boolean, store: KeyValueStore = localStorage): void {
  if (enabled) store.setItem(CALENDAR_MIRROR_KEY, "on");
  else store.removeItem(CALENDAR_MIRROR_KEY);
}

/**
 * Local-first cache, one pair of keys per board (see board/useBoard.ts):
 * the *replica* is the last known server state; the *outbox* is the queue
 * of pending local mutations. Both are versioned — a parse failure or
 * version bump reads as "no cache", never as bad data.
 */

export interface PersistedReplica {
  tasks: Task[];
  /** ISO timestamp of the fetch that produced this snapshot. */
  fetchedAt: string;
}

function readJson<T>(store: KeyValueStore, key: string): T | null {
  const raw = store.getItem(key);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: number; data?: T };
    return parsed.v === 1 && parsed.data !== undefined ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeJson(store: KeyValueStore, key: string, data: unknown): void {
  try {
    store.setItem(key, JSON.stringify({ v: 1, data }));
  } catch {
    // Storage full or unavailable — the cache is an optimization, never load-bearing.
  }
}

export function readReplica(
  spreadsheetId: string,
  store: KeyValueStore = localStorage,
): PersistedReplica | null {
  const replica = readJson<PersistedReplica>(store, REPLICA_KEY_PREFIX + spreadsheetId);
  return replica && Array.isArray(replica.tasks) ? replica : null;
}

export function writeReplica(
  spreadsheetId: string,
  replica: PersistedReplica,
  store: KeyValueStore = localStorage,
): void {
  writeJson(store, REPLICA_KEY_PREFIX + spreadsheetId, replica);
}

export function readOutbox(spreadsheetId: string, store: KeyValueStore = localStorage): PendingOp[] {
  const ops = readJson<PendingOp[]>(store, OUTBOX_KEY_PREFIX + spreadsheetId);
  return Array.isArray(ops) ? ops : [];
}

export function writeOutbox(
  spreadsheetId: string,
  ops: PendingOp[],
  store: KeyValueStore = localStorage,
): void {
  writeJson(store, OUTBOX_KEY_PREFIX + spreadsheetId, ops);
}

/** The notes twin of the replica/outbox pair, one per notes spreadsheet. */

export interface PersistedNotesReplica {
  notes: Note[];
  /** ISO timestamp of the fetch that produced this snapshot. */
  fetchedAt: string;
}

export function readNotesReplica(
  spreadsheetId: string,
  store: KeyValueStore = localStorage,
): PersistedNotesReplica | null {
  const replica = readJson<PersistedNotesReplica>(store, NOTES_REPLICA_KEY_PREFIX + spreadsheetId);
  return replica && Array.isArray(replica.notes) ? replica : null;
}

export function writeNotesReplica(
  spreadsheetId: string,
  replica: PersistedNotesReplica,
  store: KeyValueStore = localStorage,
): void {
  writeJson(store, NOTES_REPLICA_KEY_PREFIX + spreadsheetId, replica);
}

export function readNotesOutbox(spreadsheetId: string, store: KeyValueStore = localStorage): NotePendingOp[] {
  const ops = readJson<NotePendingOp[]>(store, NOTES_OUTBOX_KEY_PREFIX + spreadsheetId);
  return Array.isArray(ops) ? ops : [];
}

export function writeNotesOutbox(
  spreadsheetId: string,
  ops: NotePendingOp[],
  store: KeyValueStore = localStorage,
): void {
  writeJson(store, NOTES_OUTBOX_KEY_PREFIX + spreadsheetId, ops);
}
