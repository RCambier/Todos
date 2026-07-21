import {
  appendMemoryIfAbsent as appendMemoryOp,
  buildMemory,
  deleteMemory,
  fetchMemories as fetchMemoriesOp,
  updateMemory,
  type Memory,
  type ParseMemoriesResult,
} from "@memoria/sheet-core";
import { HttpSheetStore } from "../api/sheetStore.js";
import { MEMORIES_TAB } from "../api/sheets.js";

/**
 * Thin (token, spreadsheetId) façade over the sheet-core memory operations —
 * the AI Memories twin of `notes/notesApi.ts`, bound to the `Memories` tab.
 */

function store(token: string, spreadsheetId: string): HttpSheetStore {
  return new HttpSheetStore(token, spreadsheetId, MEMORIES_TAB);
}

/** Reads and validates the whole memories sheet. Never throws for a malformed sheet — check `result.ok`. */
export function fetchMemories(token: string, spreadsheetId: string): Promise<ParseMemoriesResult> {
  return fetchMemoriesOp(store(token, spreadsheetId));
}

/** Pure: builds the `Memory` object for a new user-created memory (the optimistic-UI path). */
export function buildNewMemory(input: {
  title?: string;
  body?: string;
  tags?: string[];
  expiresAt?: string;
}): Memory {
  return buildMemory(input, "user");
}

/**
 * Appends a newly built memory, replay-safely: the flusher may retry an
 * append whose response was lost, so the shared op re-reads and skips if the
 * id is already on the sheet (never a duplicate row).
 */
export function appendMemory(token: string, spreadsheetId: string, memory: Memory): Promise<void> {
  return appendMemoryOp(store(token, spreadsheetId), memory);
}

/** Edits a memory's fields; merges the patch onto the freshest read, never a stale local copy. */
export function editMemory(
  token: string,
  spreadsheetId: string,
  id: string,
  patch: { title?: string; body?: string; tags?: string[]; expiresAt?: string },
): Promise<Memory> {
  return updateMemory(store(token, spreadsheetId), id, patch);
}

export function removeMemory(token: string, spreadsheetId: string, id: string): Promise<void> {
  return deleteMemory(store(token, spreadsheetId), id);
}
