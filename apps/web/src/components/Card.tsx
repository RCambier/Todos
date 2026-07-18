import { Draggable } from "@hello-pangea/dnd";
import type { Task } from "@memoria/sheet-core";
import { useState } from "react";
import { formatDueDate, isOverdue } from "../lib/dates.js";
import { tagColorClass } from "../lib/tagColor.js";
import type { TaskDetailMode } from "./TaskDetail.js";

interface CardProps {
  task: Task;
  /** Position within the destination column's rendered list — the draggable index. */
  index: number;
  readOnly: boolean;
  /** Opens the task detail dialog: click → view, menu → edit / confirm delete. */
  onOpen: (mode: TaskDetailMode) => void;
  /** Marks the task done (moves it to the top of the Done column). */
  onComplete: () => void;
}

export function Card({ task, index, readOnly, onOpen, onComplete }: CardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  function pick(mode: TaskDetailMode): (e: React.MouseEvent) => void {
    return (e) => {
      e.stopPropagation();
      setMenuOpen(false);
      onOpen(mode);
    };
  }

  return (
    <Draggable draggableId={task.id} index={index} isDragDisabled={readOnly}>
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

        return (
          <div ref={provided.innerRef} {...provided.draggableProps} style={style}>
            <div
              {...provided.dragHandleProps}
              className={`card${task.status === "done" ? " done" : ""}${snapshot.isDragging ? " dragging" : ""}`}
              onClick={() => onOpen("view")}
              title="Open task"
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <p className="title" style={{ flex: 1 }}>
                  {task.title}
                </p>
                {!readOnly && (
                  <div className="card-menu">
                    <button
                      className="card-menu-btn"
                      aria-label={`Actions for "${task.title}"`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen((v) => !v);
                      }}
                    >
                      ⋯
                    </button>
                    {menuOpen && (
                      <>
                        <div
                          className="menu-backdrop"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpen(false);
                          }}
                        />
                        <div className="menu-pop" role="menu">
                          {task.status !== "done" && (
                            <button
                              type="button"
                              role="menuitem"
                              className="menu-item"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpen(false);
                                onComplete();
                              }}
                            >
                              Done
                            </button>
                          )}
                          <button type="button" role="menuitem" className="menu-item" onClick={pick("edit")}>
                            Edit
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="menu-item danger"
                            onClick={pick("confirm")}
                          >
                            Delete…
                          </button>
                        </div>
                      </>
                    )}
                  </div>
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
              {/* Meta line = due date only. No created date (noise on a board), and
                  no agent chip (provenance lives in the detail dialog). No due date
                  → no meta line at all. */}
              {task.dueDate && (
                <div className="meta">
                  <span className={`due${isOverdue(task) ? " overdue" : ""}`} title={`Due ${task.dueDate}`}>
                    ⚑ {formatDueDate(task.dueDate)}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      }}
    </Draggable>
  );
}
