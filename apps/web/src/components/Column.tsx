import { Droppable } from "@hello-pangea/dnd";
import type { Status, Task } from "@memoria/sheet-core";
import { useState } from "react";
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
  onAdd: (input: NewTaskInput) => void;
  /** Opens the task detail dialog for a card in this column. */
  onOpen: (id: string, mode: TaskDetailMode) => void;
}

export function Column({ status, tasks, readOnly, panelRef, onAdd, onOpen }: ColumnProps) {
  const [composerOpen, setComposerOpen] = useState(false);

  return (
    <div className="col" ref={panelRef} data-status={status}>
      <div className="col-head">
        <span className={`status-pill ${STATUS_PILL_CLASS[status]}`}>
          <span className="sdot" />
          {STATUS_LABEL[status]}
        </span>
        <span className="count">{tasks.length}</span>
        {!readOnly && (
          <button
            className="add"
            aria-label={`Add task to ${STATUS_LABEL[status]}`}
            onClick={() => setComposerOpen(true)}
          >
            +
          </button>
        )}
      </div>
      <Droppable droppableId={status}>
        {(provided) => (
          <div className="stack" ref={provided.innerRef} {...provided.droppableProps}>
            {composerOpen && (
              <Composer
                onSubmit={(input) => {
                  onAdd(input);
                  setComposerOpen(false);
                }}
                onCancel={() => setComposerOpen(false)}
              />
            )}
            {tasks.map((task, index) => (
              <Card
                key={task.id}
                task={task}
                index={index}
                readOnly={readOnly}
                onOpen={(mode) => onOpen(task.id, mode)}
              />
            ))}
            {provided.placeholder}
            {tasks.length === 0 && !composerOpen && !readOnly && (
              <button className="ghost-add" onClick={() => setComposerOpen(true)}>
                + New task
              </button>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}
