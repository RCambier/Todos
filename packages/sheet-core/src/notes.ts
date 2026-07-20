import { MalformedSheetError } from "./board.js";
import { generateId } from "./id.js";
import type { SheetError } from "./parse.js";
import { isBlankRow, RowValidationError } from "./serialize.js";
import type { SheetRow, Source } from "./types.js";
import type { SheetStore } from "./store.js";

/**
 * The Notes sheet — the second collection kind next to the Todos board. A
 * notes spreadsheet has exactly one tab, `Notes`, one markdown note per row.
 * Same design rules as the Tasks sheet: header row is the contract, every
 * mutation re-reads, validates, re-locates its row by id, and touches
 * exactly that row.
 */

/** Name of the spreadsheet tab that holds notes. */
export const NOTES_TAB_NAME = "Notes";

/** The A1 range covering the whole Notes tab (header + data). */
export const NOTES_RANGE = `${NOTES_TAB_NAME}!A:F`;

/** Column headers for a notes sheet, in column order (A..F). */
export const NOTES_HEADERS = ["id", "title", "body", "source", "created_at", "updated_at"] as const;

/**
 * Google Drive `appProperties` key that tags a spreadsheet as a Memoria
 * notes collection. Deliberately a different key from the board tag
 * (`todosBoard`) so existing clients — including the hosted MCP connector's
 * board catalog — never mistake a notes sheet for a board.
 */
export const NOTES_APP_PROPERTY_KEY = "memoriaNotes";
export const NOTES_APP_PROPERTY_VALUE = "1";

export interface Note {
  id: string;
  /** First line of the note; may be empty (a note can be body-only). */
  title: string;
  /** Markdown body; may be empty. */
  body: string;
  source: Source;
  /** ISO 8601, set once at creation. */
  createdAt: string;
  /** ISO 8601, set on every mutation. */
  updatedAt: string;
}

/** No row with the given note id was found in the freshest read. */
export class NoteNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(
      `No note with id "${id}" was found — it may have been changed or removed elsewhere. ` +
        "Refresh and try again.",
    );
    this.name = "NoteNotFoundError";
  }
}

function cell(row: SheetRow, index: number): string {
  return row[index] ?? "";
}

/** Converts one raw row into a `Note`. Throws `RowValidationError` for a bad required field. */
export function rowToNote(row: SheetRow): Note {
  const id = cell(row, 0).trim();
  if (id === "") throw new RowValidationError("id", cell(row, 0));

  const title = cell(row, 1);
  const body = cell(row, 2);
  const source: Source = cell(row, 3).trim() === "agent" ? "agent" : "user";

  const createdAt = cell(row, 4).trim();
  if (createdAt === "") throw new RowValidationError("created_at", cell(row, 4));
  const updatedAt = cell(row, 5).trim();
  if (updatedAt === "") throw new RowValidationError("updated_at", cell(row, 5));

  return { id, title, body, source, createdAt, updatedAt };
}

/** Converts a `Note` into a raw row, in `NOTES_HEADERS` column order, ready to write. */
export function noteToRow(note: Note): SheetRow {
  return [note.id, note.title, note.body, note.source, note.createdAt, note.updatedAt];
}

export type ParseNotesResult = { ok: true; notes: Note[] } | { ok: false; error: SheetError };

function notesHeaderError(row: SheetRow | undefined): SheetError | null {
  if (row === undefined || row.length === 0) {
    return {
      row: 1,
      column: null,
      value: null,
      message: `Row 1: the header row is missing. Expected: ${NOTES_HEADERS.join(", ")}.`,
    };
  }
  for (let i = 0; i < Math.max(row.length, NOTES_HEADERS.length); i++) {
    const expected = NOTES_HEADERS[i] ?? "";
    const actual = (row[i] ?? "").trim();
    if (actual !== expected) {
      return {
        row: 1,
        column: expected || null,
        value: actual,
        message: `Row 1: expected column ${i + 1} to be "${expected || "(nothing)"}", found "${actual || "(empty)"}". Header row must be exactly: ${NOTES_HEADERS.join(", ")}.`,
      };
    }
  }
  return null;
}

function noteFieldError(rowNumber: number, err: RowValidationError): SheetError {
  const { column, value } = err;
  const message =
    column === "id"
      ? `Row ${rowNumber}: id is required but was empty.`
      : column === "created_at" || column === "updated_at"
        ? `Row ${rowNumber}: ${column} is required but was empty.`
        : `Row ${rowNumber}: ${column} "${value}" is invalid.`;
  return { row: rowNumber, column, value, message };
}

/**
 * Validates and parses a full `Notes` sheet (header + data rows). Never
 * throws — returns every note on success, or the first problem found,
 * located precisely (row, column, offending value).
 */
export function parseNotesSheet(rows: readonly SheetRow[]): ParseNotesResult {
  const hErr = notesHeaderError(rows[0]);
  if (hErr) return { ok: false, error: hErr };

  const notes: Note[] = [];
  const idToRow = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (isBlankRow(row)) continue;

    const rowNumber = i + 1;
    try {
      const note = rowToNote(row);
      const firstSeenAt = idToRow.get(note.id);
      if (firstSeenAt !== undefined) {
        return {
          ok: false,
          error: {
            row: rowNumber,
            column: "id",
            value: note.id,
            message: `Row ${rowNumber}: id "${note.id}" is already used by row ${firstSeenAt} — ids must be unique.`,
          },
        };
      }
      idToRow.set(note.id, rowNumber);
      notes.push(note);
    } catch (err) {
      if (err instanceof RowValidationError) {
        return { ok: false, error: noteFieldError(rowNumber, err) };
      }
      throw err;
    }
  }

  return { ok: true, notes };
}

/** Grid display order: most recently edited first (ISO timestamps compare lexically). */
export function notesOrder(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) =>
    a.updatedAt !== b.updatedAt
      ? b.updatedAt.localeCompare(a.updatedAt)
      : b.createdAt.localeCompare(a.createdAt),
  );
}

// ---------- note operations (same write-safety invariant as board.ts) ----------

export interface NewNoteInput {
  title?: string;
  body?: string;
}

/** Pure: builds the `Note` for a new entry. */
export function buildNote(input: NewNoteInput, source: Source): Note {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    title: input.title ?? "",
    body: input.body ?? "",
    source,
    createdAt: now,
    updatedAt: now,
  };
}

/** Reads and validates the whole notes sheet. Never throws for a malformed sheet — check `result.ok`. */
export async function fetchNotes(store: SheetStore): Promise<ParseNotesResult> {
  return parseNotesSheet(await store.readRows());
}

async function readValidNotes(store: SheetStore): Promise<{ notes: Note[]; rawRows: string[][] }> {
  const rawRows = await store.readRows();
  const result = parseNotesSheet(rawRows);
  if (!result.ok) throw new MalformedSheetError(result.error);
  return { notes: result.notes, rawRows };
}

function locateRow(rawRows: string[][], id: string): number {
  for (let i = 1; i < rawRows.length; i++) {
    if ((rawRows[i]?.[0] ?? "").trim() === id) return i + 1;
  }
  throw new NoteNotFoundError(id);
}

export async function listNotes(store: SheetStore): Promise<Note[]> {
  const { notes } = await readValidNotes(store);
  return notesOrder(notes);
}

/** Appends an already-built note as a new row (the optimistic-UI path: build first, write after). */
export async function appendNote(store: SheetStore, note: Note): Promise<void> {
  await store.appendRow(noteToRow(note));
}

/** Reads the sheet, builds the note, and appends it. */
export async function addNote(store: SheetStore, input: NewNoteInput, source: Source): Promise<Note> {
  await readValidNotes(store); // validate before writing, like every other mutation
  const note = buildNote(input, source);
  await appendNote(store, note);
  return note;
}

/** Edits a note's fields; merges the patch onto the freshest read, never a stale local copy. */
export async function updateNote(
  store: SheetStore,
  id: string,
  patch: { title?: string; body?: string },
): Promise<Note> {
  const { notes, rawRows } = await readValidNotes(store);
  const current = notes.find((n) => n.id === id);
  if (!current) throw new NoteNotFoundError(id);

  const updated: Note = {
    ...current,
    title: patch.title ?? current.title,
    body: patch.body ?? current.body,
    updatedAt: new Date().toISOString(),
  };
  const rowNumber = locateRow(rawRows, id);
  await store.updateRow(rowNumber, noteToRow(updated));
  return updated;
}

export async function deleteNote(store: SheetStore, id: string): Promise<void> {
  const { rawRows } = await readValidNotes(store);
  const rowNumber = locateRow(rawRows, id);
  await store.deleteRow(rowNumber);
}

// ---------- pending ops (the notes half of the local-first vocabulary) ----------

export type NotePendingOp =
  | { kind: "add"; note: Note }
  | {
      kind: "edit";
      id: string;
      patch: { title?: string; body?: string };
      /** ISO timestamp of the local edit — becomes `updatedAt` in the projection. */
      at: string;
    }
  | { kind: "delete"; id: string };

/**
 * Pure projection: the replica's notes with every pending op applied, in
 * order. Ops on ids that no longer exist are skipped; an `add` whose id is
 * already in the replica (its flush landed and a poll caught up) is skipped.
 */
export function applyNotesPending(notes: readonly Note[], ops: readonly NotePendingOp[]): Note[] {
  const result = notes.map((n) => ({ ...n }));
  for (const op of ops) {
    switch (op.kind) {
      case "add": {
        if (!result.some((n) => n.id === op.note.id)) result.push({ ...op.note });
        break;
      }
      case "edit": {
        const n = result.find((x) => x.id === op.id);
        if (!n) break;
        if (op.patch.title !== undefined) n.title = op.patch.title;
        if (op.patch.body !== undefined) n.body = op.patch.body;
        n.updatedAt = op.at;
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
 * shorter queue — same rules as the task outbox (`enqueueOp`): edits fold
 * into a still-pending add, consecutive edits on one note merge, and a
 * delete cancels a still-pending add outright.
 */
export function enqueueNoteOp(ops: readonly NotePendingOp[], op: NotePendingOp): NotePendingOp[] {
  const next = [...ops];

  const pendingAddIndex = (id: string): number => next.findIndex((o) => o.kind === "add" && o.note.id === id);

  switch (op.kind) {
    case "add": {
      next.push(op);
      return next;
    }
    case "edit": {
      const addIdx = pendingAddIndex(op.id);
      if (addIdx !== -1) {
        const add = next[addIdx] as Extract<NotePendingOp, { kind: "add" }>;
        next[addIdx] = {
          kind: "add",
          note: {
            ...add.note,
            title: op.patch.title ?? add.note.title,
            body: op.patch.body ?? add.note.body,
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
      const filtered = next.filter((o) => (o.kind === "add" ? o.note.id !== op.id : o.id !== op.id));
      // If the add was still pending, the note never reached the sheet —
      // dropping every op for the id IS the delete.
      if (addIdx !== -1) return filtered;
      filtered.push(op);
      return filtered;
    }
  }
}
