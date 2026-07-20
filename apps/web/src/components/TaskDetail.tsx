import type { Task } from "@memoria/sheet-core";
import { useEffect, useRef, useState } from "react";
import {
  formatBlockedUntilLong,
  formatDueDateLong,
  formatFullDate,
  isBlockLifted,
  isDateOnly,
  isOverdue,
} from "../lib/dates.js";
import { Linkify } from "../lib/linkify.js";
import { STATUS_LABEL, STATUS_PILL_CLASS } from "../lib/statusMeta.js";
import { useAutoGrow } from "../lib/useAutoGrow.js";
import { TagsEditor } from "./TagsEditor.js";

/** What the dialog opens onto. "edit" just focuses the title — every field is
 *  always editable in place; only "confirm" (delete) is a distinct state. */
export type TaskDetailMode = "view" | "edit" | "confirm";

/** The editable slice of a task the dialog can write back, one field at a time. */
type TaskPatch = Partial<{
  title: string;
  notes: string;
  dueDate: string;
  blockedUntil: string;
  tags: string[];
}>;

/** The scheduling slot: a task is either due, blocked, or neither (matches TaskForm). */
type ScheduleKind = "none" | "due" | "blocked";

interface TaskDetailProps {
  task: Task;
  initialMode: TaskDetailMode;
  readOnly: boolean;
  onClose: () => void;
  onSave: (patch: TaskPatch) => void;
  /** Marks the task done and closes the dialog. */
  onComplete: () => void;
  onDelete: () => void;
}

/**
 * The task detail dialog — a bottom sheet on mobile, a centered dialog on
 * desktop. Editing is inline and seamless (no edit mode): the title is a live
 * field, the description turns editable on click, the schedule and tags edit in
 * place, and each change autosaves on commit. Delete still passes through an
 * explicit confirm step.
 */
export function TaskDetail({
  task,
  initialMode,
  readOnly,
  onClose,
  onSave,
  onComplete,
  onDelete,
}: TaskDetailProps) {
  const [confirming, setConfirming] = useState(initialMode === "confirm");
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  // The confirm strip sits at the bottom — on long tasks it can land past the
  // fold, so bring it into view when it appears.
  useEffect(() => {
    if (confirming) confirmRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [confirming]);

  // The dialog owns the screen while open — keep the page behind it still.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Escape steps back: an active field defocuses (committing its edit), then a
  // pending delete cancels, then the dialog closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      const active = document.activeElement;
      if (
        active &&
        panelRef.current?.contains(active) &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")
      ) {
        (active as HTMLElement).blur();
        return;
      }
      if (confirming) setConfirming(false);
      else onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, onClose]);

  return (
    <div
      className="detail-overlay"
      onClick={() => {
        // A stray tap outside closes — commit-on-blur already saved any edit.
        if (!confirming) onClose();
      }}
    >
      <div
        className="detail-panel"
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="detail-head">
          <span className={`status-pill ${STATUS_PILL_CLASS[task.status]}`}>
            <span className="sdot" />
            {STATUS_LABEL[task.status]}
          </span>
          <button className="detail-close" aria-label="Close" onClick={onClose}>
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

        <TitleField
          value={task.title}
          done={task.status === "done"}
          readOnly={readOnly}
          autoFocus={initialMode === "edit"}
          onCommit={(title) => onSave({ title })}
        />

        <TagsEditor tags={task.tags} readOnly={readOnly} onChange={(tags) => onSave({ tags })} />

        <NotesField value={task.notes} readOnly={readOnly} onCommit={(notes) => onSave({ notes })} />

        <dl className="detail-meta">
          <ScheduleField task={task} readOnly={readOnly} onSave={onSave} />
          <div>
            <dt>Created</dt>
            <dd>{formatFullDate(task.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatFullDate(task.updatedAt)}</dd>
          </div>
          {task.source === "agent" && (
            <div>
              <dt>Source</dt>
              <dd>
                <span className="chip">✳ agent</span>
              </dd>
            </div>
          )}
        </dl>

        {!readOnly && !confirming && (
          <div className="detail-actions">
            <button
              type="button"
              className="btn-ghost btn-sm danger-text"
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
            <div className="flex-spacer" />
            {task.status !== "done" && (
              <button type="button" className="btn-primary btn-sm" onClick={onComplete}>
                Move to Done
              </button>
            )}
          </div>
        )}
        {!readOnly && confirming && (
          <div className="detail-confirm" role="alertdialog" aria-label="Confirm delete" ref={confirmRef}>
            <p>Delete “{task.title}”? This can’t be undone.</p>
            <div className="detail-actions">
              <div className="flex-spacer" />
              <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button type="button" className="btn-danger btn-sm" onClick={onDelete}>
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The title — a borderless field that looks like a heading and edits in place. */
function TitleField({
  value,
  done,
  readOnly,
  autoFocus,
  onCommit,
}: {
  value: string;
  done: boolean;
  readOnly: boolean;
  autoFocus: boolean;
  onCommit: (title: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  useAutoGrow(ref, draft);

  // Track remote edits (a sync landing while open) unless you're mid-edit.
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  if (readOnly) return <h2 className={`detail-title${done ? " done" : ""}`}>{value}</h2>;

  return (
    <textarea
      ref={ref}
      className={`detail-title-input${done ? " done" : ""}`}
      value={draft}
      rows={1}
      aria-label="Task title"
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ""))}
      onBlur={() => {
        focused.current = false;
        const trimmed = draft.trim();
        if (trimmed !== "" && trimmed !== value) onCommit(trimmed);
        else setDraft(value); // an empty title reverts — a task must keep a title
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
    />
  );
}

/** The description — rendered (with clickable links) until you click it, then a
 *  plain textarea that autosaves on blur. */
function NotesField({
  value,
  readOnly,
  onCommit,
}: {
  value: string;
  readOnly: boolean;
  onCommit: (notes: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, editing ? draft : "");

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  if (editing) {
    return (
      <textarea
        ref={ref}
        className="detail-notes-input"
        value={draft}
        aria-label="Description"
        placeholder="Add a description…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ref.current?.blur();
        }}
      />
    );
  }

  const empty = value.trim() === "";
  if (readOnly && empty) return null;

  return (
    <div
      className={`detail-notes-view${empty ? " empty" : ""}`}
      role={readOnly ? undefined : "button"}
      tabIndex={readOnly ? undefined : 0}
      title={readOnly ? undefined : "Click to edit"}
      onClick={() => {
        if (!readOnly) setEditing(true);
      }}
      onKeyDown={(e) => {
        if (!readOnly && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          setEditing(true);
        }
      }}
    >
      {empty ? "Add a description…" : <Linkify text={value} />}
    </div>
  );
}

/**
 * The schedule slot — due date OR blocked-until (a date or a free-text event),
 * never both. Read-only shows whichever is set; editable is an inline kind
 * picker plus the matching input(s). Each change commits both fields together
 * so sheet-core's mergeSchedule keeps the either/or invariant.
 */
function ScheduleField({
  task,
  readOnly,
  onSave,
}: {
  task: Task;
  readOnly: boolean;
  onSave: (patch: TaskPatch) => void;
}) {
  const focused = useRef(false);
  const [kind, setKind] = useState<ScheduleKind>(
    task.blockedUntil ? "blocked" : task.dueDate ? "due" : "none",
  );
  const [dueDate, setDueDate] = useState(task.dueDate);
  const [blockedDate, setBlockedDate] = useState(isDateOnly(task.blockedUntil) ? task.blockedUntil : "");
  const [blockedEvent, setBlockedEvent] = useState(isDateOnly(task.blockedUntil) ? "" : task.blockedUntil);

  // Reseed from the task when it changes remotely, unless a field is focused.
  useEffect(() => {
    if (focused.current) return;
    setKind(task.blockedUntil ? "blocked" : task.dueDate ? "due" : "none");
    setDueDate(task.dueDate);
    setBlockedDate(isDateOnly(task.blockedUntil) ? task.blockedUntil : "");
    setBlockedEvent(isDateOnly(task.blockedUntil) ? "" : task.blockedUntil);
  }, [task.dueDate, task.blockedUntil]);

  function commit(next: {
    kind: ScheduleKind;
    dueDate: string;
    blockedDate: string;
    blockedEvent: string;
  }): void {
    onSave({
      dueDate: next.kind === "due" ? next.dueDate : "",
      blockedUntil: next.kind === "blocked" ? next.blockedEvent.trim() || next.blockedDate : "",
    });
  }

  if (readOnly) {
    if (!task.dueDate && !task.blockedUntil) return null;
    return (
      <>
        {task.dueDate && (
          <div>
            <dt>Due</dt>
            <dd className={isOverdue(task) ? "overdue" : undefined}>
              ⚑ {formatDueDateLong(task.dueDate)}
              {isOverdue(task) && " · overdue"}
            </dd>
          </div>
        )}
        {task.blockedUntil && (
          <div>
            <dt>Blocked</dt>
            <dd className={isBlockLifted(task) ? "overdue" : undefined}>
              ⏸︎ until {formatBlockedUntilLong(task.blockedUntil)}
              {isBlockLifted(task) && " · ready now"}
            </dd>
          </div>
        )}
      </>
    );
  }

  return (
    <div>
      <dt>Schedule</dt>
      <dd>
        <div className="detail-schedule">
          <select
            className="detail-schedule-select"
            aria-label="Schedule"
            value={kind}
            onFocus={() => (focused.current = true)}
            onBlur={() => (focused.current = false)}
            onChange={(e) => {
              const nextKind = e.target.value as ScheduleKind;
              setKind(nextKind);
              commit({ kind: nextKind, dueDate, blockedDate, blockedEvent });
            }}
          >
            <option value="none">No date</option>
            <option value="due">Due</option>
            <option value="blocked">Blocked until</option>
          </select>
          {kind === "due" && (
            <input
              type="date"
              className="detail-due-input"
              aria-label="Due date"
              value={dueDate}
              onFocus={() => (focused.current = true)}
              onBlur={() => (focused.current = false)}
              onChange={(e) => {
                setDueDate(e.target.value);
                commit({ kind, dueDate: e.target.value, blockedDate, blockedEvent });
              }}
            />
          )}
          {kind === "blocked" && (
            <>
              <input
                type="date"
                className="detail-due-input"
                aria-label="Blocked until date"
                value={blockedDate}
                onFocus={() => (focused.current = true)}
                onBlur={() => (focused.current = false)}
                onChange={(e) => {
                  const nextDate = e.target.value;
                  setBlockedDate(nextDate);
                  if (nextDate) setBlockedEvent("");
                  commit({
                    kind,
                    dueDate,
                    blockedDate: nextDate,
                    blockedEvent: nextDate ? "" : blockedEvent,
                  });
                }}
              />
              <input
                type="text"
                className="detail-blocked-event"
                aria-label="Blocked until event"
                placeholder="or an event — “Trip done”"
                value={blockedEvent}
                onFocus={() => (focused.current = true)}
                onChange={(e) => {
                  const nextEvent = e.target.value;
                  setBlockedEvent(nextEvent);
                  if (nextEvent.trim()) setBlockedDate("");
                }}
                onBlur={() => {
                  focused.current = false;
                  commit({
                    kind,
                    dueDate,
                    blockedDate: blockedEvent.trim() ? "" : blockedDate,
                    blockedEvent,
                  });
                }}
              />
            </>
          )}
        </div>
      </dd>
    </div>
  );
}
