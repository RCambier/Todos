import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { STATUSES, type Status, type Task } from "@memoria/sheet-core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Column } from "./Column.js";
import type { NewTaskInput } from "./Composer.js";
import { TaskDetail, type TaskDetailMode } from "./TaskDetail.js";

const STATUS_LABEL: Record<Status, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  done: "Done",
};

/** The panel shown by default on mobile load — the column most people care about day to day. */
const DEFAULT_MOBILE_STATUS: Status = "in_progress";

interface BoardProps {
  tasks: Task[];
  readOnly: boolean;
  onAdd: (status: Status, input: NewTaskInput) => void;
  onMove: (id: string, status: Status, dropIndex: number) => void;
  onEdit: (id: string, patch: { title: string; notes: string; dueDate: string; tags: string[] }) => void;
  onDelete: (id: string) => void;
}

export function Board({ tasks, readOnly, onAdd, onMove, onEdit, onDelete }: BoardProps) {
  const [activeMobileStatus, setActiveMobileStatus] = useState<Status>(DEFAULT_MOBILE_STATUS);
  // While a card is mid-drag the pager's scroll snapping is suspended so the
  // library's edge auto-scroll can carry the card to a neighboring column.
  const [cardDragging, setCardDragging] = useState(false);
  // The open task detail dialog, if any. The task itself is looked up live so
  // edits (or a sync) refresh the dialog rather than showing stale data.
  const [detail, setDetail] = useState<{ taskId: string; mode: TaskDetailMode } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Partial<Record<Status, HTMLDivElement>>>({});

  const byStatus = useMemo(() => {
    const map: Record<Status, Task[]> = { backlog: [], in_progress: [], done: [] };
    for (const t of tasks) map[t.status].push(t);
    return map;
  }, [tasks]);

  // If the open task vanishes (deleted elsewhere, board switch), the dialog goes with it.
  const detailTask = detail ? tasks.find((t) => t.id === detail.taskId) : undefined;

  // Land on the "In progress" panel by default (no animation — this is the
  // initial position, not a navigation). useLayoutEffect so it happens
  // before paint, with no visible jump from "Backlog" to "In progress".
  useLayoutEffect(() => {
    const board = boardRef.current;
    const panel = panelRefs.current[DEFAULT_MOBILE_STATUS];
    if (board && panel) board.scrollLeft = panel.offsetLeft - 20;
  }, []);

  // Swiping between panels updates which pill reads as active. Panels are
  // equal-width snap points (85% of the container, so the next column peeks
  // at the edge — design 2a), so the visible one is the nearest multiple of
  // that page width.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    function onScroll(): void {
      const current = boardRef.current;
      if (!current) return;
      const page = current.clientWidth * 0.85 || 1;
      const index = Math.round(current.scrollLeft / page);
      const clamped = Math.min(STATUSES.length - 1, Math.max(0, index));
      setActiveMobileStatus(STATUSES[clamped] ?? DEFAULT_MOBILE_STATUS);
    }
    board.addEventListener("scroll", onScroll, { passive: true });
    return () => board.removeEventListener("scroll", onScroll);
  }, []);

  function goToPanel(status: Status): void {
    setActiveMobileStatus(status);
    const board = boardRef.current;
    const panel = panelRefs.current[status];
    if (board && panel) board.scrollTo({ left: panel.offsetLeft - 20, behavior: "smooth" });
  }

  /** After a drag's auto-scroll leaves the pager between snap points, settle on the nearest panel. */
  function settlePager(): void {
    const board = boardRef.current;
    // Desktop: the .board element isn't the scroll container, so nothing to settle.
    if (!board || board.scrollWidth <= board.clientWidth) return;
    const page = board.clientWidth * 0.85 || 1;
    const index = Math.min(STATUSES.length - 1, Math.max(0, Math.round(board.scrollLeft / page)));
    const status = STATUSES[index];
    if (status) goToPanel(status);
  }

  function handleDragStart(): void {
    setCardDragging(true);
  }

  function handleDragEnd(result: DropResult): void {
    setCardDragging(false);
    settlePager();
    if (readOnly) return;
    const { draggableId, source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    onMove(draggableId, destination.droppableId as Status, destination.index);
  }

  return (
    <div className="board-scroll">
      <div className="seg-switcher">
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={status === activeMobileStatus ? "active" : ""}
            onClick={() => goToPanel(status)}
          >
            {STATUS_LABEL[status]} {byStatus[status].length}
          </button>
        ))}
      </div>
      <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className={`board${cardDragging ? " snap-off" : ""}`} ref={boardRef}>
          {STATUSES.map((status) => (
            <Column
              key={status}
              panelRef={(el) => {
                if (el) panelRefs.current[status] = el;
              }}
              status={status}
              tasks={byStatus[status]}
              readOnly={readOnly}
              onAdd={(input) => onAdd(status, input)}
              onOpen={(id, mode) => setDetail({ taskId: id, mode })}
            />
          ))}
        </div>
      </DragDropContext>
      <div className="pager-dots" aria-hidden="true">
        {STATUSES.map((status) => (
          <span key={status} className={status === activeMobileStatus ? "dot active" : "dot"} />
        ))}
      </div>
      {detailTask && detail && (
        <TaskDetail
          task={detailTask}
          initialMode={detail.mode}
          readOnly={readOnly}
          onClose={() => setDetail(null)}
          onSave={(patch) => onEdit(detailTask.id, patch)}
          onDelete={() => {
            onDelete(detailTask.id);
            setDetail(null);
          }}
        />
      )}
    </div>
  );
}
