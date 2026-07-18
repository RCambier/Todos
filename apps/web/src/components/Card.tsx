import { Draggable } from "@hello-pangea/dnd";
import type { Task } from "@memoria/sheet-core";
import { useState } from "react";
import { tagColorClass } from "../lib/tagColor.js";
import { TaskForm, type TaskFormValues } from "./TaskForm.js";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Formats a `YYYY-MM-DD` due date as e.g. "Jul 21" (local, no timezone drift). */
function formatDueDate(dueDate: string): string {
  const d = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dueDate;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A due date is overdue once the local calendar day has passed — unless the task is done. */
function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === "done") return false;
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return task.dueDate < localToday;
}

interface CardProps {
  task: Task;
  /** Position within the destination column's rendered list — the draggable index. */
  index: number;
  readOnly: boolean;
  onEdit: (patch: { title: string; notes: string; dueDate: string; tags: string[] }) => void;
  onDelete: () => void;
}

export function Card({ task, index, readOnly, onEdit, onDelete }: CardProps) {
  const [editing, setEditing] = useState(false);

  // Mouse drags start immediately; touch drags start after the library's
  // long-press delay, so a plain swipe on a card falls through to the
  // board's native horizontal scroll. Editing suspends dragging.
  const dragDisabled = readOnly || editing;

  function handleSave(values: TaskFormValues): void {
    setEditing(false);
    onEdit(values);
  }

  return (
    <Draggable draggableId={task.id} index={index} isDragDisabled={dragDisabled}>
      {(provided, snapshot) => {
        // The library owns `style.transform` for positioning/drop animation;
        // merge our lift-and-tilt on top rather than overriding it via CSS
        // (an inline style always wins over a stylesheet rule).
        const style = {
          ...provided.draggableProps.style,
          transform: snapshot.isDragging
            ? `${provided.draggableProps.style?.transform ?? ""} rotate(1.2deg)`.trim()
            : provided.draggableProps.style?.transform,
        };

        if (editing) {
          return (
            <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
              <TaskForm
                initial={{ title: task.title, notes: task.notes, dueDate: task.dueDate, tags: task.tags }}
                submitLabel="Save"
                onSubmit={handleSave}
                onCancel={() => setEditing(false)}
              />
            </div>
          );
        }

        return (
          <div ref={provided.innerRef} {...provided.draggableProps} style={style}>
            <div
              {...provided.dragHandleProps}
              className={`card${task.status === "done" ? " done" : ""}${snapshot.isDragging ? " dragging" : ""}`}
              onClick={readOnly ? undefined : () => setEditing(true)}
              title={readOnly ? undefined : "Click to edit"}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <p className="title" style={{ flex: 1 }}>
                  {task.title}
                </p>
                {!readOnly && (
                  <button
                    className="card-delete"
                    aria-label={`Delete "${task.title}"`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              {task.notes && <p className="notes">{task.notes}</p>}
              {task.tags.length > 0 && (
                <div className="card-tags">
                  {task.tags.map((t) => (
                    <span key={t} className={`tag ${tagColorClass(t)}`}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="meta">
                {task.source === "agent" && <span className="chip">✳ agent</span>}
                {task.dueDate && (
                  <span className={`due${isOverdue(task) ? " overdue" : ""}`} title={`Due ${task.dueDate}`}>
                    ⚑ {formatDueDate(task.dueDate)}
                  </span>
                )}
                <span>{formatDate(task.createdAt)}</span>
              </div>
            </div>
          </div>
        );
      }}
    </Draggable>
  );
}
