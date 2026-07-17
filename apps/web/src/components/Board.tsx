import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { STATUSES, type Status, type Task } from "@todos/sheet-core";
import { useMemo, useState } from "react";
import { useIsTouch } from "../lib/useIsTouch.js";
import { Column } from "./Column.js";

const STATUS_LABEL: Record<Status, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  done: "Done",
};

interface BoardProps {
  tasks: Task[];
  readOnly: boolean;
  onAdd: (status: Status, title: string) => void;
  onMove: (id: string, status: Status, dropIndex: number) => void;
  onDelete: (id: string) => void;
}

export function Board({ tasks, readOnly, onAdd, onMove, onDelete }: BoardProps) {
  const isTouch = useIsTouch();
  const [activeMobileStatus, setActiveMobileStatus] = useState<Status>("backlog");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const byStatus = useMemo(() => {
    const map: Record<Status, Task[]> = { backlog: [], in_progress: [], done: [] };
    for (const t of tasks) map[t.status].push(t);
    return map;
  }, [tasks]);

  function handleDragEnd(event: DragEndEvent): void {
    if (readOnly) return;
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const activeTask = tasks.find((t) => t.id === activeId);
    if (!activeTask) return;

    const overId = String(over.id);
    let destStatus: Status;
    let destIndex: number;

    if ((STATUSES as readonly string[]).includes(overId)) {
      destStatus = overId as Status;
      destIndex = byStatus[destStatus].filter((t) => t.id !== activeId).length;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask) return;
      destStatus = overTask.status;
      const columnIds = byStatus[destStatus].filter((t) => t.id !== activeId).map((t) => t.id);
      const idx = columnIds.indexOf(overId);
      destIndex = idx === -1 ? columnIds.length : idx;
    }

    const currentIndex = byStatus[activeTask.status].findIndex((t) => t.id === activeId);
    if (destStatus === activeTask.status && destIndex === currentIndex) return;

    onMove(activeId, destStatus, destIndex);
  }

  return (
    <div className="board-scroll">
      <div className="seg-switcher">
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={status === activeMobileStatus ? "active" : ""}
            onClick={() => setActiveMobileStatus(status)}
          >
            {STATUS_LABEL[status]}
          </button>
        ))}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="board">
          {STATUSES.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={byStatus[status]}
              isTouch={isTouch}
              isActive={status === activeMobileStatus}
              readOnly={readOnly}
              onAdd={(title) => onAdd(status, title)}
              onMove={(id, s) => onMove(id, s, 0)}
              onDelete={onDelete}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
