import { MalformedSheetError } from "./board.js";
import { assertCellLimits, locateRowById, parseItemRows, type SheetError } from "./grid.js";
import { generateId } from "./id.js";
import { parseTags, RowValidationError } from "./serialize.js";
import type { SheetRow, Source } from "./types.js";
import type { SheetStore } from "./store.js";

/**
 * The Memories sheet — the third collection kind, next to the Todos board
 * and the Notes grid. A memories spreadsheet holds the facts and memories an
 * AI gathers about its user over time: free-text markdown like a note, plus
 * tags to categorize ("family", "preferences", "work", …). One tab,
 * `Memories`, one memory per row. Same design rules as the other kinds:
 * header row is the contract, every mutation re-reads, validates,
 * re-locates its row by id, and touches exactly that row.
 */

/** Name of the spreadsheet tab that holds memories. */
export const MEMORIES_TAB_NAME = "Memories";

/** Column headers for a memories sheet, in column order (A..H). */
export const MEMORIES_HEADERS = [
  "id",
  "title",
  "body",
  "tags",
  "source",
  "created_at",
  "updated_at",
  "expires_at",
] as const;

/**
 * Google Drive `appProperties` key that tags a spreadsheet as a Memoria
 * memories collection. A different key from the board (`todosBoard`) and
 * notes (`memoriaNotes`) tags so no client ever mistakes one kind for
 * another.
 */
export const MEMORIES_APP_PROPERTY_KEY = "memoriaMemories";
export const MEMORIES_APP_PROPERTY_VALUE = "1";

export interface Memory {
  id: string;
  /** First line of the memory; may be empty (a memory can be body-only). */
  title: string;
  /** Markdown body; may be empty. */
  body: string;
  /** Free-form labels. Stored comma-separated in the sheet, so names can't contain commas. */
  tags: string[];
  source: Source;
  /** ISO 8601, set once at creation. */
  createdAt: string;
  /** ISO 8601, set on every mutation. */
  updatedAt: string;
  /**
   * `YYYY-MM-DD` after which the fact no longer holds ("in SF until Aug 2"),
   * or `""` for a fact with no natural end. Expired memories stay on the
   * sheet — they're flagged, not hidden, so clients and agents can review
   * and clean them up deliberately (see `isMemoryExpired`).
   */
  expiresAt: string;
}

/** No row with the given memory id was found in the freshest read. */
export class MemoryNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(
      `No memory with id "${id}" was found — it may have been changed or removed elsewhere. ` +
        "Refresh and try again.",
    );
    this.name = "MemoryNotFoundError";
  }
}

function cell(row: SheetRow, index: number): string {
  return row[index] ?? "";
}

/** Converts one raw row into a `Memory`. Throws `RowValidationError` for a bad required field. */
export function rowToMemory(row: SheetRow): Memory {
  const id = cell(row, 0).trim();
  if (id === "") throw new RowValidationError("id", cell(row, 0));

  const title = cell(row, 1);
  const body = cell(row, 2);
  const tags = parseTags(cell(row, 3));
  const source: Source = cell(row, 4).trim() === "agent" ? "agent" : "user";

  const createdAt = cell(row, 5).trim();
  if (createdAt === "") throw new RowValidationError("created_at", cell(row, 5));
  const updatedAt = cell(row, 6).trim();
  if (updatedAt === "") throw new RowValidationError("updated_at", cell(row, 6));

  const expiresAt = cell(row, 7).trim();
  if (expiresAt !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    throw new RowValidationError("expires_at", cell(row, 7));
  }

  return { id, title, body, tags, source, createdAt, updatedAt, expiresAt };
}

/** Converts a `Memory` into a raw row, in `MEMORIES_HEADERS` column order, ready to write. */
export function memoryToRow(memory: Memory): SheetRow {
  return [
    memory.id,
    memory.title,
    memory.body,
    memory.tags.join(", "),
    memory.source,
    memory.createdAt,
    memory.updatedAt,
    memory.expiresAt,
  ];
}

export type ParseMemoriesResult = { ok: true; memories: Memory[] } | { ok: false; error: SheetError };

function memoriesHeaderError(row: SheetRow | undefined): SheetError | null {
  if (row === undefined || row.length === 0) {
    return {
      row: 1,
      column: null,
      value: null,
      message: `Row 1: the header row is missing. Expected: ${MEMORIES_HEADERS.join(", ")}.`,
    };
  }
  for (let i = 0; i < Math.max(row.length, MEMORIES_HEADERS.length); i++) {
    const expected = MEMORIES_HEADERS[i] ?? "";
    const actual = (row[i] ?? "").trim();
    if (actual !== expected) {
      return {
        row: 1,
        column: expected || null,
        value: actual,
        message: `Row 1: expected column ${i + 1} to be "${expected || "(nothing)"}", found "${actual || "(empty)"}". Header row must be exactly: ${MEMORIES_HEADERS.join(", ")}.`,
      };
    }
  }
  return null;
}

function memoryFieldError(rowNumber: number, err: RowValidationError): SheetError {
  const { column, value } = err;
  const message =
    column === "id"
      ? `Row ${rowNumber}: id is required but was empty.`
      : column === "created_at" || column === "updated_at"
        ? `Row ${rowNumber}: ${column} is required but was empty.`
        : column === "expires_at"
          ? `Row ${rowNumber}: expires_at "${value}" isn't a YYYY-MM-DD date (leave it empty for a fact that doesn't expire).`
          : `Row ${rowNumber}: ${column} "${value}" is invalid.`;
  return { row: rowNumber, column, value, message };
}

/**
 * Validates and parses a full `Memories` sheet (header + data rows). Never
 * throws — returns every memory on success, or the first problem found,
 * located precisely (row, column, offending value).
 */
export function parseMemoriesSheet(rows: readonly SheetRow[]): ParseMemoriesResult {
  const hErr = memoriesHeaderError(rows[0]);
  if (hErr) return { ok: false, error: hErr };

  const result = parseItemRows(rows, {
    rowToItem: rowToMemory,
    idOf: (memory) => memory.id,
    fieldError: memoryFieldError,
  });
  if (!result.ok) return result;
  return { ok: true, memories: result.items };
}

/**
 * Whether a memory's fact has lapsed: `expiresAt` is set and strictly before
 * `todayYmd` (a `YYYY-MM-DD` string — lexical compare is date compare). The
 * expiry *day itself* still counts as valid ("until Aug 2" includes Aug 2).
 * Pure; callers supply today so clients can pick their own timezone rule.
 */
export function isMemoryExpired(memory: Memory, todayYmd: string): boolean {
  return memory.expiresAt !== "" && memory.expiresAt < todayYmd;
}

/** Grid display order: most recently edited first (ISO timestamps compare lexically). */
export function memoriesOrder(memories: readonly Memory[]): Memory[] {
  return [...memories].sort((a, b) =>
    a.updatedAt !== b.updatedAt
      ? b.updatedAt.localeCompare(a.updatedAt)
      : b.createdAt.localeCompare(a.createdAt),
  );
}

// ---------- memory operations (same write-safety invariant as board.ts) ----------

export interface NewMemoryInput {
  title?: string;
  body?: string;
  tags?: string[];
  /** `YYYY-MM-DD`, or empty/omitted for a fact that doesn't expire. */
  expiresAt?: string;
}

/** Pure: builds the `Memory` for a new entry. */
export function buildMemory(input: NewMemoryInput, source: Source): Memory {
  assertCellLimits({ title: input.title, body: input.body });
  const now = new Date().toISOString();
  return {
    id: generateId(),
    title: input.title ?? "",
    body: input.body ?? "",
    tags: input.tags ?? [],
    source,
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt ?? "",
  };
}

/** Reads and validates the whole memories sheet. Never throws for a malformed sheet — check `result.ok`. */
export async function fetchMemories(store: SheetStore): Promise<ParseMemoriesResult> {
  return parseMemoriesSheet(await store.readRows());
}

async function readValidMemories(store: SheetStore): Promise<{ memories: Memory[]; rawRows: string[][] }> {
  const rawRows = await store.readRows();
  const result = parseMemoriesSheet(rawRows);
  if (!result.ok) throw new MalformedSheetError(result.error);
  return { memories: result.memories, rawRows };
}

/** Re-locates a memory's row by id in the freshest read (see grid.ts), or throws. */
function locateRow(rawRows: string[][], id: string): number {
  const rowNumber = locateRowById(rawRows, id);
  if (rowNumber === null) throw new MemoryNotFoundError(id);
  return rowNumber;
}

export async function listMemories(store: SheetStore): Promise<Memory[]> {
  const { memories } = await readValidMemories(store);
  return memoriesOrder(memories);
}

/** Appends an already-built memory as a new row (the optimistic-UI path: build first, write after). */
export async function appendMemory(store: SheetStore, memory: Memory): Promise<void> {
  await store.appendRow(memoryToRow(memory));
}

/**
 * Replay-safe append: re-reads the sheet and writes the row only if no row
 * already carries this memory's id — same reasoning as `appendNoteIfAbsent`.
 */
export async function appendMemoryIfAbsent(store: SheetStore, memory: Memory): Promise<void> {
  const { rawRows } = await readValidMemories(store);
  if (locateRowById(rawRows, memory.id) !== null) return; // already landed
  await store.appendRow(memoryToRow(memory));
}

/** Reads the sheet, builds the memory, and appends it. */
export async function addMemory(store: SheetStore, input: NewMemoryInput, source: Source): Promise<Memory> {
  await readValidMemories(store); // validate before writing, like every other mutation
  const memory = buildMemory(input, source);
  await appendMemory(store, memory);
  return memory;
}

/** Edits a memory's fields; merges the patch onto the freshest read, never a stale local copy. */
export async function updateMemory(
  store: SheetStore,
  id: string,
  patch: { title?: string; body?: string; tags?: string[]; expiresAt?: string },
): Promise<Memory> {
  assertCellLimits({ title: patch.title, body: patch.body });
  const { memories, rawRows } = await readValidMemories(store);
  const current = memories.find((m) => m.id === id);
  if (!current) throw new MemoryNotFoundError(id);

  const updated: Memory = {
    ...current,
    title: patch.title ?? current.title,
    body: patch.body ?? current.body,
    tags: patch.tags ?? current.tags,
    expiresAt: patch.expiresAt ?? current.expiresAt,
    updatedAt: new Date().toISOString(),
  };
  const rowNumber = locateRow(rawRows, id);
  await store.updateRow(rowNumber, memoryToRow(updated));
  return updated;
}

export async function deleteMemory(store: SheetStore, id: string): Promise<void> {
  const { rawRows } = await readValidMemories(store);
  const rowNumber = locateRow(rawRows, id);
  await store.deleteRow(rowNumber);
}

// ---------- pending ops (the memories third of the local-first vocabulary) ----------

export type MemoryPendingOp =
  | { kind: "add"; memory: Memory }
  | {
      kind: "edit";
      id: string;
      patch: { title?: string; body?: string; tags?: string[]; expiresAt?: string };
      /** ISO timestamp of the local edit — becomes `updatedAt` in the projection. */
      at: string;
    }
  | { kind: "delete"; id: string };

/**
 * Pure projection: the replica's memories with every pending op applied, in
 * order. Ops on ids that no longer exist are skipped; an `add` whose id is
 * already in the replica (its flush landed and a poll caught up) is skipped.
 */
export function applyMemoriesPending(memories: readonly Memory[], ops: readonly MemoryPendingOp[]): Memory[] {
  const result = memories.map((m) => ({ ...m, tags: [...m.tags] }));
  for (const op of ops) {
    switch (op.kind) {
      case "add": {
        if (!result.some((m) => m.id === op.memory.id))
          result.push({ ...op.memory, tags: [...op.memory.tags] });
        break;
      }
      case "edit": {
        const m = result.find((x) => x.id === op.id);
        if (!m) break;
        if (op.patch.title !== undefined) m.title = op.patch.title;
        if (op.patch.body !== undefined) m.body = op.patch.body;
        if (op.patch.tags !== undefined) m.tags = [...op.patch.tags];
        if (op.patch.expiresAt !== undefined) m.expiresAt = op.patch.expiresAt;
        m.updatedAt = op.at;
        break;
      }
      case "delete": {
        const i = result.findIndex((x) => x.id === op.id);
        if (i !== -1) result.splice(i, 1);
        break;
      }
    }
  }
  return result;
}

/**
 * Appends an op to the queue, collapsing where that yields an equivalent but
 * shorter queue — same rules as the task and note outboxes: edits fold into
 * a still-pending add, consecutive edits on one memory merge, and a delete
 * cancels a still-pending add outright.
 */
export function enqueueMemoryOp(ops: readonly MemoryPendingOp[], op: MemoryPendingOp): MemoryPendingOp[] {
  const next = [...ops];

  const pendingAddIndex = (id: string): number =>
    next.findIndex((o) => o.kind === "add" && o.memory.id === id);

  switch (op.kind) {
    case "add": {
      next.push(op);
      return next;
    }
    case "edit": {
      const addIdx = pendingAddIndex(op.id);
      if (addIdx !== -1) {
        const add = next[addIdx] as Extract<MemoryPendingOp, { kind: "add" }>;
        next[addIdx] = {
          kind: "add",
          memory: {
            ...add.memory,
            title: op.patch.title ?? add.memory.title,
            body: op.patch.body ?? add.memory.body,
            tags: op.patch.tags ?? add.memory.tags,
            expiresAt: op.patch.expiresAt ?? add.memory.expiresAt,
            updatedAt: op.at,
          },
        };
        return next;
      }
      const last = next[next.length - 1];
      if (last && last.kind === "edit" && last.id === op.id) {
        next[next.length - 1] = {
          kind: "edit",
          id: op.id,
          patch: { ...last.patch, ...op.patch },
          at: op.at,
        };
        return next;
      }
      next.push(op);
      return next;
    }
    case "delete": {
      const addIdx = pendingAddIndex(op.id);
      const filtered = next.filter((o) => (o.kind === "add" ? o.memory.id !== op.id : o.id !== op.id));
      // If the add was still pending, the memory never reached the sheet —
      // dropping every op for the id IS the delete.
      if (addIdx !== -1) return filtered;
      filtered.push(op);
      return filtered;
    }
  }
}
