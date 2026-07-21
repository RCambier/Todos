import type { Note } from "@memoria/sheet-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDueDateLong, formatFullDate, localToday } from "../lib/dates.js";
import { MAX_CELL_CHARS } from "@memoria/sheet-core";
import { useTagColors } from "../lib/tagColor.js";
import { isAttachableImage, uploadNoteAttachment } from "../notes/attachments.js";
import { AgentMark } from "./AgentMark.js";
import { Markdown } from "./Markdown.js";
import { PaperclipIcon } from "./PaperclipIcon.js";
import { TagChip } from "./TagChip.js";
import { TagsEditor } from "./TagsEditor.js";

type EditorMode = "view" | "edit" | "confirm";

interface NoteEditorProps {
  /** A note, or anything note-shaped (an AI memory — then pass `onTagsChange` to edit its tags). */
  note: Note & { tags?: string[]; expiresAt?: string };
  token: string | null;
  readOnly: boolean;
  /** New notes open straight into the editor; existing ones open rendered. */
  startInEdit: boolean;
  onClose: () => void;
  onSave: (patch: { title?: string; body?: string }) => void;
  onDelete: () => void;
  /** Provided by the memories view: shows the tag chips/editor and saves tag changes immediately. */
  onTagsChange?: (tags: string[]) => void;
  /** Provided by the memories view: shows the expiry date field ("" clears it), saved immediately. */
  onExpiresChange?: (expiresAt: string) => void;
  /** What the item is called in the UI ("note" by default; "memory" for AI Memories). */
  noun?: string;
  /** Where a pasted/dropped file uploads to — defaults to the notes attachments folder. */
  uploadAttachment?: (token: string, file: File) => Promise<{ fileId: string; markdown: string }>;
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
  onTagsChange,
  onExpiresChange,
  noun = "note",
  uploadAttachment = uploadNoteAttachment,
}: NoteEditorProps) {
  const tagClass = useTagColors();
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
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        // Close through handleClose so a brand-new note abandoned empty is
        // cleaned up on Escape too, not just on click-close.
        if (mode === "view") handleCloseRef.current();
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

  async function uploadFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    if (!token) {
      setUploadError("Sign in to attach files.");
      return;
    }
    setUploadError(null);
    for (const file of files) {
      // Images become the img-loading box they'll swap into; other files a link.
      const placeholder = isAttachableImage(file)
        ? `![Uploading image…](uploading:${++uploadSeq})`
        : `[📎 Uploading ${(file.name || "file").replace(/[[\]()\n]/g, "")}…](uploading:${++uploadSeq})`;
      insertAtCursor(placeholder);
      setUploads((n) => n + 1);
      try {
        const { markdown } = await uploadAttachment(token, file);
        patchBody(placeholder, markdown);
      } catch (err) {
        patchBody(`${placeholder}\n`, "");
        patchBody(placeholder, "");
        setUploadError(
          `Couldn't upload ${file.name || "file"}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setUploads((n) => n - 1);
      }
    }
  }

  function handlePaste(e: React.ClipboardEvent): void {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    void uploadFiles(files);
  }

  function handleDrop(e: React.DragEvent): void {
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    if (mode !== "edit") setMode("edit");
    void uploadFiles(files);
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
  // Ref, so the Escape listener (bound per mode change) always closes with
  // the current draft's emptiness, never a stale snapshot.
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;

  const agent = note.source === "agent";
  const capNoun = noun.charAt(0).toUpperCase() + noun.slice(1);

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
        aria-label={note.title || capNoun}
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
            {agent && (
              <span className="chip">
                <AgentMark /> agent
              </span>
            )}
            <span className="note-head-date">Updated {formatFullDate(note.updatedAt)}</span>
            {uploads > 0 && <span className="note-uploading">Uploading…</span>}
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
                aria-label={`${capNoun} title`}
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
                placeholder={"Write in markdown — paste or drop images and files to attach them…"}
                value={draftBody}
                maxLength={MAX_CELL_CHARS}
                aria-label={`${capNoun} body (markdown)`}
                onChange={(e) => setDraftBody(e.target.value)}
                onPaste={handlePaste}
              />
              {onTagsChange && <TagsEditor tags={note.tags ?? []} onChange={onTagsChange} />}
              {onExpiresChange && (
                <label className="note-expiry-field">
                  <span>Fact holds until</span>
                  <input
                    type="date"
                    value={note.expiresAt ?? ""}
                    onChange={(e) => onExpiresChange(e.target.value)}
                    aria-label="Expiry date (empty for a fact that doesn't expire)"
                  />
                  {note.expiresAt ? (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => onExpiresChange("")}>
                      Clear
                    </button>
                  ) : (
                    <span className="note-expiry-hint">leave empty if it doesn’t expire</span>
                  )}
                </label>
              )}
              {uploadError && <p className="note-upload-error">{uploadError}</p>}
            </div>
            <div className="detail-actions note-foot">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void uploadFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="attach-btn"
                title="Attach a file (or drop / paste one)"
                aria-label="Attach a file"
                onClick={() => fileInputRef.current?.click()}
              >
                <PaperclipIcon />
              </button>
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
              {((note.tags && note.tags.length > 0) || note.expiresAt) && (
                <div className="card-tags">
                  {note.tags?.map((t) => (
                    <TagChip key={t} name={t} colorClass={tagClass(t)} />
                  ))}
                  {note.expiresAt && (
                    <span className={`note-expiry${note.expiresAt < localToday() ? " lapsed" : ""}`}>
                      {note.expiresAt < localToday()
                        ? `Expired ${formatDueDateLong(note.expiresAt)}`
                        : `Until ${formatDueDateLong(note.expiresAt)}`}
                    </span>
                  )}
                </div>
              )}
              <div
                className={`note-view-body${readOnly ? "" : " editable"}`}
                title={readOnly ? undefined : "Click to edit"}
                onClick={() => enterEdit("body")}
              >
                {draftBody.trim() !== "" ? (
                  <Markdown text={draftBody} token={token} />
                ) : (
                  <p className="note-view-empty">{readOnly ? `Empty ${noun}.` : "Click to write…"}</p>
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
                  Click the {noun} to edit
                </span>
              </div>
            )}
            {!readOnly && mode === "confirm" && (
              <div className="detail-confirm note-foot" role="alertdialog" aria-label="Confirm delete">
                <p>Delete {note.title ? `“${note.title}”` : `this ${noun}`}? This can’t be undone.</p>
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
