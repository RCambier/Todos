import { MAX_CELL_CHARS } from "@memoria/sheet-core";
import { useEffect, useRef, useState } from "react";
import { isDateOnly, localTomorrow } from "../lib/dates.js";
import { uploadTaskAttachment } from "../notes/attachments.js";
import { TagsEditor } from "./TagsEditor.js";

export interface TaskFormValues {
  title: string;
  notes: string;
  dueDate: string;
  blockedUntil: string;
  tags: string[];
}

/** The one scheduling slot: a task is either due, blocked, or neither. */
type ScheduleKind = "none" | "due" | "blocked";

interface TaskFormProps {
  initial?: TaskFormValues;
  /** Null while the session restores — attaching files needs Drive. */
  token: string | null;
  submitLabel: string;
  onSubmit: (values: TaskFormValues) => void;
  onCancel: () => void;
}

/**
 * The one task form, covering the full model: title, description, schedule
 * (due date or blocked-until — one slot, never both), tags. The composer
 * uses it empty ("Add task"); a card in edit mode seeds it with the task's
 * current values ("Save"). Enter on the title submits; Escape cancels from
 * anywhere.
 */
export function TaskForm({ initial, token, submitLabel, onSubmit, onCancel }: TaskFormProps) {
  const initialBlocked = initial?.blockedUntil ?? "";
  const [title, setTitle] = useState(initial?.title ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>(
    initialBlocked ? "blocked" : initial?.dueDate ? "due" : "none",
  );
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  // A blocked-until is a date OR an event; filling one input empties the other.
  const [blockedDate, setBlockedDate] = useState(isDateOnly(initialBlocked) ? initialBlocked : "");
  const [blockedEvent, setBlockedEvent] = useState(isDateOnly(initialBlocked) ? "" : initialBlocked);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [attaching, setAttaching] = useState(0);
  const [attachError, setAttachError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  /** Uploads dropped/picked files to Drive; each lands as a 📎 line in the description. */
  async function attachFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    if (!token) {
      setAttachError("Sign in to attach files.");
      return;
    }
    setAttachError(null);
    for (const file of files) {
      setAttaching((n) => n + 1);
      try {
        const { line } = await uploadTaskAttachment(token, file);
        setNotes((n) => (n === "" ? line : `${n}\n${line}`));
      } catch (err) {
        setAttachError(
          `Couldn't attach ${file.name || "file"}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setAttaching((n) => n - 1);
      }
    }
  }

  function submit(): void {
    const trimmed = title.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    onSubmit({
      title: trimmed,
      notes: notes.trim(),
      dueDate: scheduleKind === "due" ? dueDate : "",
      blockedUntil: scheduleKind === "blocked" ? blockedEvent.trim() || blockedDate : "",
      tags,
    });
  }

  return (
    <div
      className="composer"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        void attachFiles(files);
      }}
    >
      {/* Hard caps: a Google Sheets cell rejects anything over 50k characters. */}
      <input
        ref={titleRef}
        type="text"
        className="composer-title"
        placeholder="Task title…"
        value={title}
        maxLength={MAX_CELL_CHARS}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <textarea
        className="composer-notes"
        placeholder="Description…"
        rows={2}
        value={notes}
        maxLength={MAX_CELL_CHARS}
        onChange={(e) => setNotes(e.target.value)}
      />

      <TagsEditor tags={tags} onChange={setTags} />

      {attachError && <p className="note-upload-error">{attachError}</p>}

      <div className="composer-actions">
        {/* Any file can be attached (drop it anywhere on the form, or pick):
            it uploads to Drive and links from the description. */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void attachFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="attach-btn"
          title="Attach a file (or drop one anywhere on the form)"
          aria-label="Attach a file"
          disabled={attaching > 0}
          onClick={() => fileInputRef.current?.click()}
        >
          {attaching > 0 ? "…" : "📎"}
        </button>
        <select
          className="composer-schedule"
          aria-label="Schedule"
          value={scheduleKind}
          onChange={(e) => {
            const nextKind = e.target.value as ScheduleKind;
            setScheduleKind(nextKind);
            // An empty date input renders invisible on iOS — picking "Due"
            // starts from tomorrow instead of a blank.
            if (nextKind === "due" && dueDate === "") setDueDate(localTomorrow());
          }}
        >
          <option value="none">No date</option>
          <option value="due">Due</option>
          <option value="blocked">Blocked until</option>
        </select>
        {scheduleKind === "due" && (
          <input
            type="date"
            className="composer-date"
            aria-label="Due date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        )}
        {scheduleKind === "blocked" && (
          <>
            <input
              type="date"
              className="composer-date"
              aria-label="Blocked until date"
              value={blockedDate}
              onChange={(e) => {
                setBlockedDate(e.target.value);
                if (e.target.value) setBlockedEvent("");
              }}
            />
            <input
              type="text"
              className="composer-blocked-event"
              aria-label="Blocked until event"
              placeholder="or an event — “Trip done”"
              value={blockedEvent}
              onChange={(e) => {
                setBlockedEvent(e.target.value);
                if (e.target.value.trim()) setBlockedDate("");
              }}
            />
          </>
        )}
        <div className="composer-buttons">
          <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={submit}
            disabled={!title.trim() || attaching > 0}
          >
            {attaching > 0 ? "Attaching…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
