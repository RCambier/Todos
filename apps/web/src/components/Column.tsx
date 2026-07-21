import { Droppable } from "@hello-pangea/dnd";
import type { Status, Task } from "@memoria/sheet-core";
import { useState, type CSSProperties } from "react";
import type { PillStyle } from "../lib/statusMeta.js";
import { useIsMobile } from "../lib/useIsMobile.js";
import { Card } from "./Card.js";
import { Composer, type NewTaskInput } from "./Composer.js";
import type { TaskDetailMode } from "./TaskDetail.js";

/**
 * Long columns (mostly Done) collapse to this many cards, with a "Show all"
 * pill below. Hidden cards are the column's tail, so the visible cards keep
 * their full-list indexes — drops stay correct while collapsed.
 */
const COLLAPSE_AT = 20;

interface ColumnProps {
  status: Status;
  /** This column's display label. */
  label: string;
  /** Inline pill colors for this column's header. */
  pillStyle?: PillStyle;
  tasks: Task[];
  /** The board's done-role column id (or null) — cards here render struck through. */
  doneStatus: string | null;
  /** Label of the done column, for cards' "Move to …" action. */
  doneLabel: string;
  token: string | null;
  readOnly: boolean;
  /** Attaches the mobile pager's panel ref to this column's root element. */
  panelRef: (el: HTMLDivElement | null) => void;
  /** Composer state lives in Board: on mobile it renders as Board's full-screen overlay. */
  composerOpen: boolean;
  onOpenComposer: () => void;
  onCloseComposer: () => void;
  onAdd: (input: NewTaskInput) => void;
  /** Opens the task detail dialog for a card in this column. */
  onOpen: (id: string, mode: TaskDetailMode) => void;
  /** Marks a card done (moves it to the done column). Absent when the board has no done column. */
  onComplete?: (id: string) => void;
}

export function Column({
  status,
  label,
  pillStyle,
  tasks,
  doneStatus,
  doneLabel,
  token,
  readOnly,
  panelRef,
  composerOpen,
  onOpenComposer,
  onCloseComposer,
  onAdd,
  onOpen,
  onComplete,
}: ColumnProps) {
  const isMobile = useIsMobile();
  const [showAll, setShowAll] = useState(false);

  const collapsed = !showAll && tasks.length > COLLAPSE_AT;
  const visible = collapsed ? tasks.slice(0, COLLAPSE_AT) : tasks;

  return (
    <div className="col" ref={panelRef} data-status={status}>
      {/* Hidden on mobile — the seg-switcher pills already name the columns,
          and the floating + (Board) replaces the per-column add. */}
      <div className="col-head">
        <span className="status-pill" style={pillStyle as CSSProperties | undefined}>
          <span className="sdot" />
          {label}
        </span>
        <span className="count">{tasks.length}</span>
        {!readOnly && (
          <button className="add" aria-label={`Add task to ${label}`} onClick={onOpenComposer}>
            +
          </button>
        )}
      </div>
      <Droppable droppableId={status}>
        {(provided) => (
          <div className="stack" ref={provided.innerRef} {...provided.droppableProps}>
            {composerOpen && !isMobile && (
              <Composer
                token={token}
                onSubmit={(input) => {
                  onAdd(input);
                  onCloseComposer();
                }}
                onCancel={onCloseComposer}
              />
            )}
            {visible.map((task, index) => (
              <Card
                key={task.id}
                task={task}
                index={index}
                readOnly={readOnly}
                isDone={doneStatus !== null && task.status === doneStatus}
                doneLabel={doneLabel}
                onOpen={(mode) => onOpen(task.id, mode)}
                onComplete={onComplete ? () => onComplete(task.id) : undefined}
              />
            ))}
            {provided.placeholder}
            {collapsed && (
              <button type="button" className="show-more" onClick={() => setShowAll(true)}>
                Show {tasks.length - COLLAPSE_AT} more
              </button>
            )}
            {showAll && tasks.length > COLLAPSE_AT && (
              <button type="button" className="show-more" onClick={() => setShowAll(false)}>
                Show less
              </button>
            )}
            {tasks.length === 0 && !composerOpen && !readOnly && (
              <button className="ghost-add" onClick={onOpenComposer}>
                + New task
              </button>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}
