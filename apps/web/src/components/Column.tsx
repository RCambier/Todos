import { Droppable } from "@hello-pangea/dnd";
import type { Status, Task } from "@memoria/sheet-core";
import { useIsMobile } from "../lib/useIsMobile.js";
import { Card } from "./Card.js";
import { Composer, type NewTaskInput } from "./Composer.js";
import type { TaskDetailMode } from "./TaskDetail.js";

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

interface ColumnProps {
  status: Status;
  tasks: Task[];
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
  /** Marks a card done (moves it to the top of the Done column). */
  onComplete: (id: string) => void;
}

export function Column({
  status,
  tasks,
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

  return (
    <div className="col" ref={panelRef} data-status={status}>
      {/* Hidden on mobile — the seg-switcher pills already name the columns,
          and the floating + (Board) replaces the per-column add. */}
      <div className="col-head">
        <span className={`status-pill ${STATUS_PILL_CLASS[status]}`}>
          <span className="sdot" />
          {STATUS_LABEL[status]}
        </span>
        <span className="count">{tasks.length}</span>
        {!readOnly && (
          <button className="add" aria-label={`Add task to ${STATUS_LABEL[status]}`} onClick={onOpenComposer}>
            +
          </button>
        )}
      </div>
      <Droppable droppableId={status}>
        {(provided) => (
          <div className="stack" ref={provided.innerRef} {...provided.droppableProps}>
            {composerOpen && !isMobile && (
              <Composer
                onSubmit={(input) => {
                  onAdd(input);
                  onCloseComposer();
                }}
                onCancel={onCloseComposer}
              />
            )}
            {tasks.map((task, index) => (
              <Card
                key={task.id}
                task={task}
                index={index}
                readOnly={readOnly}
                onOpen={(mode) => onOpen(task.id, mode)}
                onComplete={() => onComplete(task.id)}
              />
            ))}
            {provided.placeholder}
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
