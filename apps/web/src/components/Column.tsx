import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Status, Task } from "@todos/sheet-core";
import { useState } from "react";
import { Card } from "./Card.js";
import { Composer } from "./Composer.js";

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
  isTouch: boolean;
  isActive: boolean;
  readOnly: boolean;
  onAdd: (title: string) => void;
  onMove: (id: string, status: Status) => void;
  onDelete: (id: string) => void;
}

export function Column({ status, tasks, isTouch, isActive, readOnly, onAdd, onMove, onDelete }: ColumnProps) {
  const { setNodeRef } = useDroppable({ id: status });
  const [composerOpen, setComposerOpen] = useState(false);

  return (
    <div className={`col${isActive ? " active" : ""}`}>
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
      <div className="stack" ref={setNodeRef}>
        {composerOpen && (
          <Composer
            onSubmit={(title) => {
              onAdd(title);
              setComposerOpen(false);
            }}
            onCancel={() => setComposerOpen(false)}
          />
        )}
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <Card
              key={task.id}
              task={task}
              isTouch={isTouch}
              readOnly={readOnly}
              onMove={(s) => onMove(task.id, s)}
              onDelete={() => onDelete(task.id)}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && !composerOpen && !readOnly && (
          <button className="ghost-add" onClick={() => setComposerOpen(true)}>
            + New task
          </button>
        )}
      </div>
    </div>
  );
}
