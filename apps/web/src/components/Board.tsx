import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import {
  hiddenColumns,
  visibleColumns,
  type BoardColumn,
  type Recurrence,
  type Status,
  type Task,
} from "@memoria/sheet-core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildColumnMeta, humanizeStatus, statusLabel } from "../lib/statusMeta.js";
import { useBackClose } from "../lib/useBackClose.js";
import { useIsMobile } from "../lib/useIsMobile.js";
import { useVisualViewportHeight } from "../lib/useVisualViewportHeight.js";
import { AddFab } from "./AddFab.js";
import { Column } from "./Column.js";
import { Composer, type NewTaskInput } from "./Composer.js";
import { TaskDetail, type TaskDetailMode } from "./TaskDetail.js";

interface BoardProps {
  tasks: Task[];
  /** The board's configured columns (customizable), in display order. */
  columns: BoardColumn[];
  /** The done-role column id, or null if none is designated (the ✓ affordance hides). */
  doneStatus: string | null;
  token: string | null;
  readOnly: boolean;
  onAdd: (status: Status, input: NewTaskInput) => void;
  onMove: (id: string, status: Status, dropIndex: number) => void;
  onEdit: (
    id: string,
    patch: Partial<{
      title: string;
      notes: string;
      dueDate: string;
      blockedUntil: string;
      tags: string[];
      recurs: Recurrence;
    }>,
  ) => void;
  onDelete: (id: string) => void;
}

/**
 * A column as the board renders it: a configured column, or a synthesized
 * one standing in for a task status that no column covers (e.g. a column was
 * deleted) so no task ever disappears.
 */
interface RenderColumn {
  id: string;
  label: string;
}

/**
 * The columns to render, derived from the config plus any orphaned task
 * statuses. Configured visible columns come first (in order), then a
 * synthesized visible column per orphan status, then the hidden columns.
 */
function deriveColumns(
  columns: BoardColumn[],
  tasks: Task[],
): { visible: RenderColumn[]; hidden: RenderColumn[] } {
  const visible: RenderColumn[] = visibleColumns(columns).map((c) => ({ id: c.id, label: c.label }));
  const hidden: RenderColumn[] = hiddenColumns(columns).map((c) => ({ id: c.id, label: c.label }));
  const known = new Set(columns.map((c) => c.id));
  const orphans = [...new Set(tasks.map((t) => t.status).filter((s) => !known.has(s)))].sort();
  for (const status of orphans) visible.push({ id: status, label: humanizeStatus(status) });
  return { visible, hidden };
}

export function Board({
  tasks,
  columns,
  doneStatus,
  token,
  readOnly,
  onAdd,
  onMove,
  onEdit,
  onDelete,
}: BoardProps) {
  const meta = useMemo(() => buildColumnMeta(columns), [columns]);
  const { visible, hidden } = useMemo(() => deriveColumns(columns, tasks), [columns, tasks]);

  // The panel shown by default on mobile: the second visible column (day-to-day
  // work) when there is one, else the first.
  const defaultMobileStatus = visible[Math.min(1, visible.length - 1)]?.id ?? visible[0]?.id ?? "";

  const [activeMobileStatus, setActiveMobileStatus] = useState<Status>(defaultMobileStatus);
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
  const panelRefs = useRef<Record<string, HTMLDivElement>>({});
  // The hidden columns (long-horizon buckets) fold away on every load —
  // deliberately not persisted, so the board always opens focused.
  const [showHidden, setShowHidden] = useState(false);
  const shownColumns: RenderColumn[] = showHidden ? [...visible, ...hidden] : visible;
  const hiddenCount = hidden.reduce((n, c) => n + tasks.filter((t) => t.status === c.id).length, 0);

  const byStatus = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of tasks) (map[t.status] ??= []).push(t);
    return map;
  }, [tasks]);
  const tasksIn = (status: string): Task[] => byStatus[status] ?? [];

  // If the open task vanishes (deleted elsewhere, board switch), the dialog goes with it.
  const detailTask = detail ? tasks.find((t) => t.id === detail.taskId) : undefined;

  // If the active mobile column disappears (e.g. deleted in settings), fall back.
  useEffect(() => {
    if (!shownColumns.some((c) => c.id === activeMobileStatus) && defaultMobileStatus) {
      setActiveMobileStatus(defaultMobileStatus);
    }
  }, [shownColumns, activeMobileStatus, defaultMobileStatus]);

  // Land on the default panel by default (no animation — this is the initial
  // position, not a navigation). useLayoutEffect so it happens before paint.
  useLayoutEffect(() => {
    const board = boardRef.current;
    const panel = panelRefs.current[defaultMobileStatus];
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
      const clamped = Math.min(shownColumns.length - 1, Math.max(0, index));
      setActiveMobileStatus(shownColumns[clamped]?.id ?? defaultMobileStatus);
    }
    board.addEventListener("scroll", onScroll, { passive: true });
    return () => board.removeEventListener("scroll", onScroll);
  }, [shownColumns, defaultMobileStatus]);

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
    const index = Math.min(shownColumns.length - 1, Math.max(0, Math.round(board.scrollLeft / page)));
    const status = shownColumns[index]?.id;
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

  const activeLabel = statusLabel(meta, activeMobileStatus);

  return (
    <div className="board-scroll">
      <div className="seg-switcher">
        {shownColumns.map((col) => (
          <button
            key={col.id}
            type="button"
            className={col.id === activeMobileStatus ? "active" : ""}
            onClick={() => goToPanel(col.id)}
          >
            {statusLabel(meta, col.id)} {tasksIn(col.id).length}
          </button>
        ))}
        {hidden.length > 0 && (
          <button
            type="button"
            className="seg-reveal"
            aria-pressed={showHidden}
            onClick={() => setShowHidden((v) => !v)}
          >
            {showHidden ? "Less" : `+${hidden.length}`}
          </button>
        )}
      </div>
      <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className={`board${cardDragging ? " snap-off" : ""}`} ref={boardRef}>
          {shownColumns.map((col) => (
            <Column
              key={col.id}
              token={token}
              panelRef={(el) => {
                if (el) panelRefs.current[col.id] = el;
              }}
              status={col.id}
              label={statusLabel(meta, col.id)}
              pillStyle={meta.get(col.id)?.style}
              tasks={tasksIn(col.id)}
              doneStatus={doneStatus}
              doneLabel={doneStatus ? statusLabel(meta, doneStatus) : ""}
              readOnly={readOnly}
              composerOpen={composerStatus === col.id}
              onOpenComposer={() => setComposerStatus(col.id)}
              onCloseComposer={() => setComposerStatus(null)}
              onAdd={(input) => onAdd(col.id, input)}
              onOpen={(id, mode) => setDetail({ taskId: id, mode })}
              onComplete={doneStatus ? (id) => onMove(id, doneStatus, 0) : undefined}
            />
          ))}
          {/* Right-edge rail: reveals the hidden columns (desktop). */}
          {hidden.length > 0 && (
            <button
              type="button"
              className="reveal-rail"
              aria-pressed={showHidden}
              title={showHidden ? "Hide extra columns" : "Show hidden columns"}
              onClick={() => setShowHidden((v) => !v)}
            >
              <span className="reveal-rail-label">
                {showHidden
                  ? "Hide"
                  : `${hidden.length} hidden column${hidden.length === 1 ? "" : "s"}${hiddenCount > 0 ? ` · ${hiddenCount}` : ""}`}
              </span>
              <span aria-hidden="true">{showHidden ? "«" : "»"}</span>
            </button>
          )}
        </div>
      </DragDropContext>
      <div className="pager-dots" aria-hidden="true">
        {shownColumns.map((col) => (
          <span key={col.id} className={col.id === activeMobileStatus ? "dot active" : "dot"} />
        ))}
      </div>
      {/* Mobile-only "+" — adds a todo to the column currently on screen. */}
      {!readOnly && activeMobileStatus && (
        <AddFab
          label={`Add a todo to ${activeLabel}`}
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
              token={token}
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
          columns={columns}
          columnMeta={meta}
          doneStatus={doneStatus}
          token={token}
          initialMode={detail.mode}
          readOnly={readOnly}
          onClose={() => setDetail(null)}
          onSave={(patch) => onEdit(detailTask.id, patch)}
          onMoveTo={(status) => {
            onMove(detailTask.id, status, 0);
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
