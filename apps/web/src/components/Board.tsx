import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { STATUSES, type Status, type Task } from "@memoria/sheet-core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STATUS_LABEL } from "../lib/statusMeta.js";
import { useBackClose } from "../lib/useBackClose.js";
import { useIsMobile } from "../lib/useIsMobile.js";
import { useVisualViewportHeight } from "../lib/useVisualViewportHeight.js";
import { AddFab } from "./AddFab.js";
import { Column } from "./Column.js";
import { Composer, type NewTaskInput } from "./Composer.js";
import { TaskDetail, type TaskDetailMode } from "./TaskDetail.js";

/** The panel shown by default on mobile load — the column most people care about day to day. */
const DEFAULT_MOBILE_STATUS: Status = "in_progress";

interface BoardProps {
  tasks: Task[];
  readOnly: boolean;
  onAdd: (status: Status, input: NewTaskInput) => void;
  onMove: (id: string, status: Status, dropIndex: number) => void;
  onEdit: (
    id: string,
    patch: Partial<{ title: string; notes: string; dueDate: string; blockedUntil: string; tags: string[] }>,
  ) => void;
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
  // Which column's composer is open, if any. Desktop renders it inline at the
  // top of that column; mobile renders it as a full-screen overlay here —
  // portaled to <body> (position:fixed inside the board breaks on iOS once
  // the keyboard opens) and sized to the visual viewport so the action row
  // rides above the keyboard. The page behind it is frozen while open.
  const [composerStatus, setComposerStatus] = useState<Status | null>(null);
  const isMobile = useIsMobile();
  const mobileComposerOpen = composerStatus !== null && isMobile;
  const overlayHeight = useVisualViewportHeight(mobileComposerOpen);
  // Back closes overlays instead of leaving the app.
  useBackClose(detail !== null, () => setDetail(null));
  useBackClose(mobileComposerOpen, () => setComposerStatus(null));
  useEffect(() => {
    if (!mobileComposerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileComposerOpen]);
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
              composerOpen={composerStatus === status}
              onOpenComposer={() => setComposerStatus(status)}
              onCloseComposer={() => setComposerStatus(null)}
              onAdd={(input) => onAdd(status, input)}
              onOpen={(id, mode) => setDetail({ taskId: id, mode })}
              onComplete={(id) => onMove(id, "done", 0)}
            />
          ))}
        </div>
      </DragDropContext>
      <div className="pager-dots" aria-hidden="true">
        {STATUSES.map((status) => (
          <span key={status} className={status === activeMobileStatus ? "dot active" : "dot"} />
        ))}
      </div>
      {/* Mobile-only "+" — adds a todo to the column currently on screen. */}
      {!readOnly && (
        <AddFab
          label={`Add a todo to ${STATUS_LABEL[activeMobileStatus]}`}
          onClick={() => setComposerStatus(activeMobileStatus)}
        />
      )}
      {composerStatus !== null &&
        isMobile &&
        createPortal(
          <div
            className="composer-overlay"
            style={overlayHeight !== null ? { height: overlayHeight } : undefined}
          >
            <Composer
              onSubmit={(input) => {
                onAdd(composerStatus, input);
                setComposerStatus(null);
              }}
              onCancel={() => setComposerStatus(null)}
            />
          </div>,
          document.body,
        )}
      {detailTask && detail && (
        <TaskDetail
          task={detailTask}
          initialMode={detail.mode}
          readOnly={readOnly}
          onClose={() => setDetail(null)}
          onSave={(patch) => onEdit(detailTask.id, patch)}
          onComplete={() => {
            onMove(detailTask.id, "done", 0);
            setDetail(null);
          }}
          onDelete={() => {
            onDelete(detailTask.id);
            setDetail(null);
          }}
        />
      )}
    </div>
  );
}
