import type { Note } from "@memoria/sheet-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatFullDate } from "../lib/dates.js";
import { MAX_CELL_CHARS } from "@memoria/sheet-core";
import { isAttachableImage, uploadAttachment } from "../notes/attachments.js";
import { Markdown } from "./Markdown.js";

type EditorMode = "view" | "edit" | "confirm";

interface NoteEditorProps {
  note: Note;
  token: string | null;
  readOnly: boolean;
  /** New notes open straight into the editor; existing ones open rendered. */
  startInEdit: boolean;
  onClose: () => void;
  onSave: (patch: { title?: string; body?: string }) => void;
  onDelete: () => void;
}

/** How long the editor waits after the last keystroke before autosaving. */
const AUTOSAVE_MS = 1200;

let uploadSeq = 0;

/**
 * The note dialog — full-bleed on mobile (design 5b), centered on desktop.
 * Two faces: the rendered note (markdown, provenance chip, dates) and a
 * minimal editor (borderless title + a plain markdown textarea). Edits
 * autosave through the notes outbox; images pasted or dropped into the
 * editor upload to `Memoria/notes/attachments/` and embed as markdown.
 */
export function NoteEditor({
  note,
  token,
  readOnly,
  startInEdit,
  onClose,
  onSave,
  onDelete,
}: NoteEditorProps) {
  const [mode, setMode] = useState<EditorMode>(readOnly ? "view" : startInEdit ? "edit" : "view");
  // Which field the editor jumps to when you click into a note — so clicking the
  // title lands the cursor in the title, clicking the body lands it in the body.
  const [focusField, setFocusField] = useState<"title" | "body">(startInEdit ? "title" : "body");
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [draftBody, setDraftBody] = useState(note.body);
  const [uploads, setUploads] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // The draft the sheet already has — saves are diffed against this, so
  // autosave never writes a no-op row.
  const savedRef = useRef({ title: note.title, body: note.body });
  const draftRef = useRef({ title: draftTitle, body: draftBody });
  draftRef.current = { title: draftTitle, body: draftBody };
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const saveIfDirty = useCallback((): void => {
    const draft = draftRef.current;
    const saved = savedRef.current;
    const patch: { title?: string; body?: string } = {};
    if (draft.title !== saved.title) patch.title = draft.title;
    if (draft.body !== saved.body) patch.body = draft.body;
    if (Object.keys(patch).length === 0) return;
    savedRef.current = { ...draft };
    onSaveRef.current(patch);
  }, []);

  // Autosave while typing; the trailing save on unmount catches the rest.
  useEffect(() => {
    if (mode !== "edit") return;
    const timer = setTimeout(saveIfDirty, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [mode, draftTitle, draftBody, saveIfDirty]);
  useEffect(() => () => saveIfDirty(), [saveIfDirty]);

  // Outside the editor, track the live note — a remote edit landing while
  // the note is open in view mode shows up, and Edit starts from fresh text.
  useEffect(() => {
    if (mode === "edit") return;
    setDraftTitle(note.title);
    setDraftBody(note.body);
    savedRef.current = { title: note.title, body: note.body };
  }, [mode, note.title, note.body]);

  // The dialog owns the screen while open — keep the page behind it still.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    if (mode === "edit") (focusField === "title" ? titleRef : bodyRef).current?.focus();
  }, [mode, focusField]);

  /** Opens the editor with the cursor in the clicked field. */
  function enterEdit(field: "title" | "body"): void {
    if (readOnly) return;
    setFocusField(field);
    setMode("edit");
  }

  // Escape steps back: edit → view (saving), confirm → view, view → close.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        if (mode === "view") onClose();
        else {
          saveIfDirty();
          setMode("view");
        }
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && mode === "edit") {
        saveIfDirty();
        setMode("view");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose, saveIfDirty]);

  /** Replaces `find` with `replace` in the draft body (used by upload placeholders). */
  function patchBody(find: string, replace: string): void {
    setDraftBody((b) => b.replace(find, replace));
  }

  function insertAtCursor(snippet: string): void {
    const el = bodyRef.current;
    setDraftBody((b) => {
      if (!el) return b === "" ? snippet : `${b}\n${snippet}`;
      const start = el.selectionStart ?? b.length;
      const end = el.selectionEnd ?? start;
      const before = b.slice(0, start);
      const after = b.slice(end);
      // Images sit on their own line.
      const pad = before === "" || before.endsWith("\n") ? "" : "\n";
      return `${before}${pad}${snippet}${after.startsWith("\n") || after === "" ? "" : "\n"}${after}`;
    });
  }

  async function uploadImages(files: File[]): Promise<void> {
    if (!token) {
      setUploadError("Sign in to add images.");
      return;
    }
    setUploadError(null);
    for (const file of files) {
      const placeholder = `![Uploading image…](uploading:${++uploadSeq})`;
      insertAtCursor(placeholder);
      setUploads((n) => n + 1);
      try {
        const { markdown } = await uploadAttachment(token, file);
        patchBody(placeholder, markdown);
      } catch (err) {
        patchBody(`${placeholder}\n`, "");
        patchBody(placeholder, "");
        setUploadError(
          `Couldn't upload ${file.name || "image"}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setUploads((n) => n - 1);
      }
    }
  }

  function imagesFrom(list: FileList | null | undefined): File[] {
    return Array.from(list ?? []).filter(isAttachableImage);
  }

  function handlePaste(e: React.ClipboardEvent): void {
    const images = imagesFrom(e.clipboardData?.files);
    if (images.length === 0) return;
    e.preventDefault();
    void uploadImages(images);
  }

  function handleDrop(e: React.DragEvent): void {
    setDragOver(false);
    const images = imagesFrom(e.dataTransfer?.files);
    if (images.length === 0) return;
    e.preventDefault();
    if (mode !== "edit") setMode("edit");
    void uploadImages(images);
  }

  const isEmpty = draftTitle.trim() === "" && draftBody.trim() === "";

  function handleClose(): void {
    // A brand-new note abandoned empty just disappears — no junk rows.
    if (startInEdit && isEmpty) {
      savedRef.current = draftRef.current; // nothing left to autosave
      onDelete();
      onClose();
      return;
    }
    saveIfDirty();
    onClose();
  }

  const agent = note.source === "agent";

  return (
    <div
      className="detail-overlay"
      onClick={() => {
        if (mode !== "edit") handleClose();
      }}
    >
      <div
        className={`detail-panel note-panel${agent ? " agent" : ""}${dragOver ? " drag-over" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={note.title || "Note"}
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes("Files")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={handleDrop}
      >
        <div className="detail-head">
          <span className="note-head-meta">
            {agent && <span className="chip">✳ agent</span>}
            <span className="note-head-date">Updated {formatFullDate(note.updatedAt)}</span>
            {uploads > 0 && <span className="note-uploading">Uploading image…</span>}
          </span>
          <button className="detail-close" aria-label="Close" onClick={handleClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M1.5 1.5 10.5 10.5M10.5 1.5 1.5 10.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {mode === "edit" ? (
          <>
            <div className="note-edit">
              <input
                ref={titleRef}
                className="note-title-input"
                type="text"
                placeholder="Title"
                value={draftTitle}
                maxLength={MAX_CELL_CHARS}
                aria-label="Note title"
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    bodyRef.current?.focus();
                  }
                }}
              />
              <textarea
                ref={bodyRef}
                className="note-body-input"
                placeholder={"Write in markdown — paste or drag an image to attach it…"}
                value={draftBody}
                maxLength={MAX_CELL_CHARS}
                aria-label="Note body (markdown)"
                onChange={(e) => setDraftBody(e.target.value)}
                onPaste={handlePaste}
              />
              {uploadError && <p className="note-upload-error">{uploadError}</p>}
            </div>
            <div className="detail-actions note-foot">
              {/* A Google Sheets cell caps at 50k characters — the input is
                  hard-capped above; the counter appears near the ceiling. */}
              {draftBody.length > MAX_CELL_CHARS - 5_000 ? (
                <span className="note-length-hint" role="status">
                  {draftBody.length.toLocaleString("en-US")} / {MAX_CELL_CHARS.toLocaleString("en-US")}{" "}
                  characters — a sheet cell caps at {MAX_CELL_CHARS.toLocaleString("en-US")}
                </span>
              ) : (
                <span className="note-md-hint" aria-hidden="true">
                  **bold** · # heading · - list · ![image]
                </span>
              )}
              <div className="flex-spacer" />
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => {
                  saveIfDirty();
                  setMode("view");
                }}
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="note-scroll">
              <h2
                className={`note-view-title${draftTitle ? "" : " empty"}${readOnly ? "" : " editable"}`}
                title={readOnly ? undefined : "Click to edit"}
                onClick={() => enterEdit("title")}
              >
                {draftTitle || (readOnly ? "" : "Title")}
              </h2>
              <div
                className={`note-view-body${readOnly ? "" : " editable"}`}
                title={readOnly ? undefined : "Click to edit"}
                onClick={() => enterEdit("body")}
              >
                {draftBody.trim() !== "" ? (
                  <Markdown text={draftBody} token={token} />
                ) : (
                  <p className="note-view-empty">{readOnly ? "Empty note." : "Click to write…"}</p>
                )}
              </div>
            </div>

            {!readOnly && mode === "view" && (
              <div className="detail-actions note-foot">
                <button
                  type="button"
                  className="btn-ghost btn-sm danger-text"
                  onClick={() => setMode("confirm")}
                >
                  Delete
                </button>
                <div className="flex-spacer" />
                <span className="note-edit-hint" aria-hidden="true">
                  Click the note to edit
                </span>
              </div>
            )}
            {!readOnly && mode === "confirm" && (
              <div className="detail-confirm note-foot" role="alertdialog" aria-label="Confirm delete">
                <p>Delete {note.title ? `“${note.title}”` : "this note"}? This can’t be undone.</p>
                <div className="detail-actions">
                  <div className="flex-spacer" />
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setMode("view")}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => {
                      savedRef.current = draftRef.current; // deleted — nothing to autosave
                      onDelete();
                      onClose();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
