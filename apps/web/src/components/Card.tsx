import { Draggable } from "@hello-pangea/dnd";
import type { Status, Task } from "@memoria/sheet-core";
import { useRef, useState } from "react";
import { tagColorClass } from "../lib/tagColor.js";
import { TaskForm, type TaskFormValues } from "./TaskForm.js";

const STATUS_LABEL: Record<Status, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  done: "Done",
};

/** Where a rightward swipe sends a card (design 2a: swipe advances one status). */
const NEXT_STATUS: Partial<Record<Status, Status>> = {
  backlog: "in_progress",
  in_progress: "done",
};

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
  isTouch: boolean;
  readOnly: boolean;
  /** Swipe-right commit on touch: advance one status (design 2a). */
  onAdvance: (to: Status) => void;
  onEdit: (patch: { title: string; notes: string; dueDate: string; tags: string[] }) => void;
  onDelete: () => void;
}

/** Past this fraction of the card's width, releasing the swipe commits the move. */
const COMMIT_FRACTION = 0.33;
/** A gesture must move this many px mostly-horizontally before we treat it as a swipe. */
const INTENT_PX = 10;

export function Card({ task, index, isTouch, readOnly, onAdvance, onEdit, onDelete }: CardProps) {
  const [editing, setEditing] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [settling, setSettling] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    startX: number;
    startY: number;
    mode: "undecided" | "advance" | "pager" | "vertical";
    pagerStart: number;
  } | null>(null);

  const nextStatus = NEXT_STATUS[task.status];
  // Desktop drags with the library; touch swipes with our gesture; editing suspends both.
  const dragDisabled = isTouch || readOnly || editing;
  const suppressClick = useRef(false);

  function pagerEl(): HTMLElement | null {
    return wrapRef.current?.closest(".board") ?? null;
  }

  function onTouchStart(e: React.TouchEvent): void {
    if (!isTouch || readOnly || editing) return;
    const t = e.touches[0];
    if (!t) return;
    gesture.current = {
      startX: t.clientX,
      startY: t.clientY,
      mode: "undecided",
      pagerStart: pagerEl()?.scrollLeft ?? 0,
    };
    setSettling(false);
  }

  function onTouchMove(e: React.TouchEvent): void {
    const g = gesture.current;
    const t = e.touches[0];
    if (!g || !t) return;
    const dx = t.clientX - g.startX;
    const dy = t.clientY - g.startY;

    if (g.mode === "undecided") {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > INTENT_PX) {
        g.mode = "vertical"; // let the column scroll; we stay out of it
      } else if (Math.abs(dx) > INTENT_PX) {
        // Rightward advances the card (when it has somewhere to go);
        // leftward — or rightward on a Done card — pages the board instead.
        g.mode = dx > 0 && nextStatus ? "advance" : "pager";
      }
    }

    if (g.mode === "advance") {
      setDragX(Math.max(0, dx));
    } else if (g.mode === "pager") {
      pagerEl()?.scrollTo({ left: g.pagerStart - dx });
    }
  }

  function onTouchEnd(): void {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;

    if (g.mode === "advance") {
      suppressClick.current = true;
      const width = wrapRef.current?.offsetWidth ?? 320;
      if (dragX > width * COMMIT_FRACTION && nextStatus) {
        onAdvance(nextStatus);
      }
      setSettling(true);
      setDragX(0);
    } else if (g.mode === "pager") {
      suppressClick.current = true;
      const pager = pagerEl();
      if (pager) {
        const page = pager.clientWidth * 0.85; // matches the mobile column width
        pager.scrollTo({ left: Math.round(pager.scrollLeft / page) * page, behavior: "smooth" });
      }
    }
  }

  function handleSave(values: TaskFormValues): void {
    setEditing(false);
    onEdit(values);
  }

  const revealClass = nextStatus === "done" ? "reveal-done" : "reveal-progress";
  const swiping = dragX > 0;

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
            <div className="swipe-wrap" ref={wrapRef}>
              {swiping && nextStatus && (
                <div className={`swipe-reveal ${revealClass}`} aria-hidden="true">
                  <span className="swipe-check">✓</span>
                  <span>{STATUS_LABEL[nextStatus]}</span>
                </div>
              )}
              <div
                {...provided.dragHandleProps}
                className={`card${task.status === "done" ? " done" : ""}${snapshot.isDragging ? " dragging" : ""}`}
                style={
                  swiping
                    ? {
                        transform: `translateX(${dragX}px) rotate(${Math.min(1.2, dragX / 80)}deg)`,
                        boxShadow: "0 8px 20px rgba(0,0,0,.12)",
                      }
                    : settling
                      ? { transition: "transform 0.18s ease" }
                      : undefined
                }
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                onClick={
                  readOnly
                    ? undefined
                    : () => {
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        setEditing(true);
                      }
                }
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
          </div>
        );
      }}
    </Draggable>
  );
}
