import {
  appendNote as appendNoteOp,
  buildNote,
  deleteNote,
  fetchNotes as fetchNotesOp,
  updateNote,
  type Note,
  type ParseNotesResult,
} from "@memoria/sheet-core";
import { HttpSheetStore } from "../api/sheetStore.js";
import { NOTES_TAB } from "../api/sheets.js";

/**
 * Thin (token, spreadsheetId) façade over the sheet-core note operations —
 * the notes twin of `board/boardApi.ts`, bound to the `Notes` tab.
 */

function store(token: string, spreadsheetId: string): HttpSheetStore {
  return new HttpSheetStore(token, spreadsheetId, NOTES_TAB);
}

/** Reads and validates the whole notes sheet. Never throws for a malformed sheet — check `result.ok`. */
export function fetchNotes(token: string, spreadsheetId: string): Promise<ParseNotesResult> {
  return fetchNotesOp(store(token, spreadsheetId));
}

/** Pure: builds the `Note` object for a new user-created note (the optimistic-UI path). */
export function buildNewNote(input: { title?: string; body?: string }): Note {
  return buildNote(input, "user");
}

/** Appends a newly built note as a new row. */
export function appendNote(token: string, spreadsheetId: string, note: Note): Promise<void> {
  return appendNoteOp(store(token, spreadsheetId), note);
}

/** Edits a note's fields; merges the patch onto the freshest read, never a stale local copy. */
export function editNote(
  token: string,
  spreadsheetId: string,
  id: string,
  patch: { title?: string; body?: string },
): Promise<Note> {
  return updateNote(store(token, spreadsheetId), id, patch);
}

export function removeNote(token: string, spreadsheetId: string, id: string): Promise<void> {
  return deleteNote(store(token, spreadsheetId), id);
}
