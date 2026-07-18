import type { Status, Task } from "@memoria/sheet-core";
import { useEffect, useRef, useState } from "react";
import { formatDueDateLong, formatFullDate, isOverdue } from "../lib/dates.js";
import { tagColorClass } from "../lib/tagColor.js";
import { TaskForm, type TaskFormValues } from "./TaskForm.js";

/** What the dialog opens onto: reading, editing, or confirming a delete. */
export type TaskDetailMode = "view" | "edit" | "confirm";

const STATUS_LABEL: Record<Status, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  done: "Done",
};
const STATUS_PILL_CLASS: Record<Status, string> = {
  backlog: "pill-backlog",
  in_progress: "pill-progress",
  done: "pill-done",
};

interface TaskDetailProps {
  task: Task;
  initialMode: TaskDetailMode;
  readOnly: boolean;
  onClose: () => void;
  onSave: (patch: { title: string; notes: string; dueDate: string; tags: string[] }) => void;
  onDelete: () => void;
}

/**
 * The task detail dialog — a bottom sheet on mobile, a centered dialog on
 * desktop. One surface for the whole card lifecycle: view shows every field,
 * edit swaps in the shared TaskForm, and delete always passes through an
 * explicit confirm step.
 */
export function TaskDetail({ task, initialMode, readOnly, onClose, onSave, onDelete }: TaskDetailProps) {
  const [mode, setMode] = useState<TaskDetailMode>(readOnly ? "view" : initialMode);
  const confirmRef = useRef<HTMLDivElement>(null);

  // The confirm strip sits below the task details — on long tasks it can land
  // past the fold, so bring it (and its buttons) into view when it appears.
  useEffect(() => {
    if (mode === "confirm") confirmRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [mode]);

  // The dialog owns the screen while open — keep the page behind it still.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Escape steps back before it closes: edit/confirm return to view (nothing
  // is lost or deleted by accident), view closes the dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      if (mode === "view") onClose();
      else setMode("view");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  function handleSave(values: TaskFormValues): void {
    onSave(values);
    setMode("view");
  }

  return (
    <div
      className="detail-overlay"
      onClick={() => {
        // A stray tap outside shouldn't discard someone's typing mid-edit.
        if (mode !== "edit") onClose();
      }}
    >
      <div
        className="detail-panel"
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="detail-grabber" aria-hidden="true" />
        <div className="detail-head">
          <span className={`status-pill ${STATUS_PILL_CLASS[task.status]}`}>
            <span className="sdot" />
            {STATUS_LABEL[task.status]}
          </span>
          <button className="detail-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        {mode === "edit" ? (
          <TaskForm
            initial={{ title: task.title, notes: task.notes, dueDate: task.dueDate, tags: task.tags }}
            submitLabel="Save"
            onSubmit={handleSave}
            onCancel={() => setMode("view")}
          />
        ) : (
          <>
            <h2 className={`detail-title${task.status === "done" ? " done" : ""}`}>{task.title}</h2>
            {task.tags.length > 0 && (
              <div className="card-tags">
                {task.tags.map((t) => (
                  <span key={t} className={`tag ${tagColorClass(t)}`}>
                    {t}
                  </span>
                ))}
              </div>
            )}
            {task.notes && <p className="detail-notes">{task.notes}</p>}
            <dl className="detail-meta">
              {task.dueDate && (
                <div>
                  <dt>Due</dt>
                  <dd className={isOverdue(task) ? "overdue" : undefined}>
                    ⚑ {formatDueDateLong(task.dueDate)}
                    {isOverdue(task) && " · overdue"}
                  </dd>
                </div>
              )}
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

            {!readOnly && mode === "view" && (
              <div className="detail-actions">
                <button type="button" className="btn-ghost btn-sm danger-text" onClick={() => setMode("confirm")}>
                  Delete…
                </button>
                <div className="composer-spacer" />
                <button type="button" className="btn-primary btn-sm" onClick={() => setMode("edit")}>
                  Edit
                </button>
              </div>
            )}
            {!readOnly && mode === "confirm" && (
              <div className="detail-confirm" role="alertdialog" aria-label="Confirm delete" ref={confirmRef}>
                <p>
                  Delete “{task.title}”? This can’t be undone.
                </p>
                <div className="detail-actions">
                  <div className="composer-spacer" />
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setMode("view")}>
                    Cancel
                  </button>
                  <button type="button" className="btn-danger btn-sm" onClick={onDelete}>
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
