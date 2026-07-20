import { MAX_CELL_CHARS } from "@memoria/sheet-core";
import { useEffect, useRef, useState } from "react";
import { isDateOnly } from "../lib/dates.js";
import { useTagColors } from "../lib/tagColor.js";
import { TagChip } from "./TagChip.js";

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
export function TaskForm({ initial, submitLabel, onSubmit, onCancel }: TaskFormProps) {
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
  const [tagDraft, setTagDraft] = useState("");
  const tagClass = useTagColors();
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function commitTagDraft(): string[] {
    const t = tagDraft.trim().replace(/,/g, "");
    setTagDraft("");
    if (t === "" || tags.includes(t)) return tags;
    const next = [...tags, t];
    setTags(next);
    return next;
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
      tags: commitTagDraft(),
    });
  }

  return (
    <div
      className="composer"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
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

      <div className="composer-tags">
        {tags.map((t) => (
          <TagChip
            key={t}
            name={t}
            colorClass={tagClass(t)}
            editable
            onRemove={() => setTags(tags.filter((x) => x !== t))}
          />
        ))}
        <input
          type="text"
          className="tag-input"
          placeholder={tags.length === 0 ? "Add tag…" : ""}
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commitTagDraft();
            }
            if (e.key === "Backspace" && tagDraft === "" && tags.length > 0) {
              setTags(tags.slice(0, -1));
            }
          }}
          onBlur={() => commitTagDraft()}
        />
      </div>

      <div className="composer-actions">
        <select
          className="composer-schedule"
          aria-label="Schedule"
          value={scheduleKind}
          onChange={(e) => setScheduleKind(e.target.value as ScheduleKind)}
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
          <button type="button" className="btn-primary btn-sm" onClick={submit} disabled={!title.trim()}>
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
