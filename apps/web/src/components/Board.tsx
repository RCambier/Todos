import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { STATUSES, type Status, type Task } from "@memoria/sheet-core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIsTouch } from "../lib/useIsTouch.js";
import { Column } from "./Column.js";
import type { NewTaskInput } from "./Composer.js";

const STATUS_LABEL: Record<Status, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  done: "Done",
};

/** The panel shown by default on mobile load — the column most people care about day to day. */
const DEFAULT_MOBILE_STATUS: Status = "in_progress";

/** How long the undo toast lingers after a swipe commit (design 2a). */
const TOAST_MS = 5000;

interface Toast {
  taskId: string;
  from: Status;
  to: Status;
}

interface BoardProps {
  tasks: Task[];
  readOnly: boolean;
  onAdd: (status: Status, input: NewTaskInput) => void;
  onMove: (id: string, status: Status, dropIndex: number) => void;
  onEdit: (id: string, patch: { title: string; notes: string; dueDate: string; tags: string[] }) => void;
  onDelete: (id: string) => void;
}

export function Board({ tasks, readOnly, onAdd, onMove, onEdit, onDelete }: BoardProps) {
  const isTouch = useIsTouch();
  const [activeMobileStatus, setActiveMobileStatus] = useState<Status>(DEFAULT_MOBILE_STATUS);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Partial<Record<Status, HTMLDivElement>>>({});

  const byStatus = useMemo(() => {
    const map: Record<Status, Task[]> = { backlog: [], in_progress: [], done: [] };
    for (const t of tasks) map[t.status].push(t);
    return map;
  }, [tasks]);

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

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  function goToPanel(status: Status): void {
    setActiveMobileStatus(status);
    const board = boardRef.current;
    const panel = panelRefs.current[status];
    if (board && panel) board.scrollTo({ left: panel.offsetLeft - 20, behavior: "smooth" });
  }

  function handleDragEnd(result: DropResult): void {
    if (readOnly) return;
    const { draggableId, source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    onMove(draggableId, destination.droppableId as Status, destination.index);
  }

  /** Swipe commit: move now (optimistic + one-row write), hold an undo toast for 5s. */
  function handleAdvance(id: string, from: Status, to: Status): void {
    onMove(id, to, 0);
    setToast({ taskId: id, from, to });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  function handleUndo(): void {
    if (!toast) return;
    onMove(toast.taskId, toast.from, 0);
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
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
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="board" ref={boardRef}>
          {STATUSES.map((status) => (
            <Column
              key={status}
              panelRef={(el) => {
                if (el) panelRefs.current[status] = el;
              }}
              status={status}
              tasks={byStatus[status]}
              isTouch={isTouch}
              readOnly={readOnly}
              onAdd={(input) => onAdd(status, input)}
              onEdit={onEdit}
              onAdvance={(id, to) => handleAdvance(id, status, to)}
              onDelete={onDelete}
            />
          ))}
        </div>
      </DragDropContext>
      <div className="pager-dots" aria-hidden="true">
        {STATUSES.map((status) => (
          <span key={status} className={status === activeMobileStatus ? "dot active" : "dot"} />
        ))}
      </div>
      {toast && (
        <div className="toast" role="status">
          <span className="toast-check" aria-hidden="true">
            ✓
          </span>
          <span>Moved to {STATUS_LABEL[toast.to]}</span>
          <button type="button" className="toast-undo" onClick={handleUndo}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
