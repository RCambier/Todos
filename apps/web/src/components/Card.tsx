import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Status, Task } from "@todos/sheet-core";

const STATUS_LABEL: Record<Status, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  done: "Done",
};

const ALL_STATUSES: Status[] = ["backlog", "in_progress", "done"];

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface CardProps {
  task: Task;
  isTouch: boolean;
  readOnly: boolean;
  onMove: (status: Status) => void;
  onDelete: () => void;
}

export function Card({ task, isTouch, readOnly, onMove, onDelete }: CardProps) {
  const dragDisabled = isTouch || readOnly;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: dragDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const otherStatuses = ALL_STATUSES.filter((s) => s !== task.status);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card${task.status === "done" ? " done" : ""}${isDragging ? " dragging" : ""}`}
      {...attributes}
      {...(dragDisabled ? {} : listeners)}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <p className="title" style={{ flex: 1 }}>
          {task.title}
        </p>
        {!readOnly && (
          <button className="card-delete" aria-label={`Delete "${task.title}"`} onClick={onDelete}>
            ×
          </button>
        )}
      </div>
      {task.notes && <p className="notes">{task.notes}</p>}
      <div className="meta">
        {task.source === "agent" && <span className="chip">✳ agent</span>}
        <span>{formatDate(task.createdAt)}</span>
      </div>
      {isTouch && !readOnly && (
        <div className="move-actions">
          {otherStatuses.map((s) => (
            <button key={s} type="button" onClick={() => onMove(s)}>
              → {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
