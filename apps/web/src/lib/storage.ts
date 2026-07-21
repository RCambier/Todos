import type {
  BoardColumn,
  Memory,
  MemoryPendingOp,
  Note,
  NotePendingOp,
  PendingOp,
  Task,
} from "@memoria/sheet-core";

/** Pre-simplification keys: one cached sheet + its kind. Read once as a migration source. */
const LEGACY_SPREADSHEET_ID_KEY = "todos:spreadsheetId";
const LEGACY_COLLECTION_KIND_KEY = "todos:collectionKind";
const SHEET_ID_KEY_PREFIX = "todos:sheet:";
const ACTIVE_KIND_KEY = "todos:activeKind";
const REPLICA_KEY_PREFIX = "todos:replica:";
const OUTBOX_KEY_PREFIX = "todos:outbox:";
const COLUMNS_KEY_PREFIX = "todos:columns:";
const CALENDAR_MIRROR_KEY = "todos:calendarMirror";
const NOTES_REPLICA_KEY_PREFIX = "todos:notes-replica:";
const NOTES_OUTBOX_KEY_PREFIX = "todos:notes-outbox:";
const MEMORIES_REPLICA_KEY_PREFIX = "todos:memories-replica:";
const MEMORIES_OUTBOX_KEY_PREFIX = "todos:memories-outbox:";

/** The three sheet kinds the app manages — one connected sheet of each. */
type CachedCollectionKind = "board" | "notes" | "memories";

/** Minimal subset of the `Storage` interface, so tests can inject a fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The connected sheet of one kind (the app allows exactly one Todos sheet
 * and one Notes sheet). Old caches stored a single sheet + kind pair; that
 * pair seeds the matching kind's slot on first read.
 */
export function getConnectedSheetId(
  kind: CachedCollectionKind,
  store: KeyValueStore = localStorage,
): string | null {
  const id = store.getItem(SHEET_ID_KEY_PREFIX + kind);
  if (id !== null) return id;
  const legacyId = store.getItem(LEGACY_SPREADSHEET_ID_KEY);
  const legacyKind = store.getItem(LEGACY_COLLECTION_KIND_KEY) === "notes" ? "notes" : "board";
  if (legacyId !== null && legacyKind === kind) {
    store.setItem(SHEET_ID_KEY_PREFIX + kind, legacyId);
    return legacyId;
  }
  return null;
}

export function setConnectedSheetId(
  kind: CachedCollectionKind,
  id: string,
  store: KeyValueStore = localStorage,
): void {
  store.setItem(SHEET_ID_KEY_PREFIX + kind, id);
}

export function clearConnectedSheetId(kind: CachedCollectionKind, store: KeyValueStore = localStorage): void {
  store.removeItem(SHEET_ID_KEY_PREFIX + kind);
  // The legacy pair would otherwise re-seed this kind on the next read.
  if ((store.getItem(LEGACY_COLLECTION_KIND_KEY) === "notes" ? "notes" : "board") === kind) {
    store.removeItem(LEGACY_SPREADSHEET_ID_KEY);
    store.removeItem(LEGACY_COLLECTION_KIND_KEY);
  }
}

/** Which of the views (Todos / Notes / AI Memories) was active last — decides what boots. */
export function getActiveKind(store: KeyValueStore = localStorage): CachedCollectionKind {
  const kind = store.getItem(ACTIVE_KIND_KEY) ?? store.getItem(LEGACY_COLLECTION_KIND_KEY);
  return kind === "notes" ? "notes" : kind === "memories" ? "memories" : "board";
}

export function setActiveKind(kind: CachedCollectionKind, store: KeyValueStore = localStorage): void {
  store.setItem(ACTIVE_KIND_KEY, kind);
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

/**
 * Cached column configuration per board, so the board paints its columns
 * instantly on reload (before the `Columns` tab is re-read). Purely an
 * optimization — the sheet is the source of truth.
 */
export function readColumnsCache(
  spreadsheetId: string,
  store: KeyValueStore = localStorage,
): BoardColumn[] | null {
  const columns = readJson<BoardColumn[]>(store, COLUMNS_KEY_PREFIX + spreadsheetId);
  return Array.isArray(columns) ? columns : null;
}

export function writeColumnsCache(
  spreadsheetId: string,
  columns: BoardColumn[],
  store: KeyValueStore = localStorage,
): void {
  writeJson(store, COLUMNS_KEY_PREFIX + spreadsheetId, columns);
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

/** The AI Memories twin of the replica/outbox pair, one per memories spreadsheet. */

export interface PersistedMemoriesReplica {
  memories: Memory[];
  /** ISO timestamp of the fetch that produced this snapshot. */
  fetchedAt: string;
}

export function readMemoriesReplica(
  spreadsheetId: string,
  store: KeyValueStore = localStorage,
): PersistedMemoriesReplica | null {
  const replica = readJson<PersistedMemoriesReplica>(store, MEMORIES_REPLICA_KEY_PREFIX + spreadsheetId);
  return replica && Array.isArray(replica.memories) ? replica : null;
}

export function writeMemoriesReplica(
  spreadsheetId: string,
  replica: PersistedMemoriesReplica,
  store: KeyValueStore = localStorage,
): void {
  writeJson(store, MEMORIES_REPLICA_KEY_PREFIX + spreadsheetId, replica);
}

export function readMemoriesOutbox(
  spreadsheetId: string,
  store: KeyValueStore = localStorage,
): MemoryPendingOp[] {
  const ops = readJson<MemoryPendingOp[]>(store, MEMORIES_OUTBOX_KEY_PREFIX + spreadsheetId);
  return Array.isArray(ops) ? ops : [];
}

export function writeMemoriesOutbox(
  spreadsheetId: string,
  ops: MemoryPendingOp[],
  store: KeyValueStore = localStorage,
): void {
  writeJson(store, MEMORIES_OUTBOX_KEY_PREFIX + spreadsheetId, ops);
}
