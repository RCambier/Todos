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

  // The mobile pager's single source of truth: the index of the panel the
  // pager is on. The active pill, the dots, and the add-FAB all render from
  // it, and it is only ever set from a measurement of the pager's real
  // scroll position (measurePagerIndex) — so the highlighted pill can never
  // disagree with the column actually on screen.
  const [activeIndex, setActiveIndex] = useState(0);
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

  // A stale index (columns removed, hidden set folded away) clamps at render;
  // the browser clamps the pager's scroll the same way and the resulting
  // scroll event re-measures, so both stay on the last panel together.
  const clampedIndex = Math.min(activeIndex, Math.max(0, shownColumns.length - 1));
  const activeStatus: Status = shownColumns[clampedIndex]?.id ?? "";

  /**
   * The panel the pager is actually on: the one whose snap position
   * (offsetLeft minus the 20px scroll-padding) is nearest the current
   * scrollLeft. Measured from the real DOM instead of re-deriving the CSS
   * geometry, so it stays correct if the layout changes.
   */
  function measurePagerIndex(board: HTMLDivElement): number {
    let best = 0;
    let bestDistance = Infinity;
    shownColumns.forEach((col, index) => {
      const panel = panelRefs.current[col.id];
      if (!panel) return;
      const distance = Math.abs(panel.offsetLeft - 20 - board.scrollLeft);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  // Land on the default panel — the second visible column (day-to-day work)
  // when there is one — with no animation: this is the initial position, not
  // a navigation. On first load the columns arrive async, so this runs every
  // render until the pager is actually scrollable (panels present and laid
  // out), then positions once and adopts the measured result. useLayoutEffect
  // so the jump happens before paint.
  const pagerPositioned = useRef(false);
  useLayoutEffect(() => {
    if (pagerPositioned.current) return;
    const board = boardRef.current;
    const target = visible[Math.min(1, visible.length - 1)];
    const panel = target ? panelRefs.current[target.id] : undefined;
    if (!board || !panel) return;
    // Desktop (where .board isn't the scroll container) or a single panel:
    // nothing to position, and index 0 is already the measured truth.
    if (board.scrollWidth <= board.clientWidth) return;
    board.scrollLeft = panel.offsetLeft - 20;
    pagerPositioned.current = true;
    setActiveIndex(measurePagerIndex(board));
  });

  // Swiping (or any scroll, programmatic or not) re-measures which panel is
  // on screen — the only other writer of activeIndex.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    function onScroll(): void {
      const current = boardRef.current;
      if (!current) return;
      setActiveIndex(measurePagerIndex(current));
    }
    board.addEventListener("scroll", onScroll, { passive: true });
    return () => board.removeEventListener("scroll", onScroll);
  }, [shownColumns]);

  function goToPanel(index: number): void {
    setActiveIndex(index);
    const board = boardRef.current;
    const panel = panelRefs.current[shownColumns[index]?.id ?? ""];
    if (board && panel) board.scrollTo({ left: panel.offsetLeft - 20, behavior: "smooth" });
  }

  /** After a drag's auto-scroll leaves the pager between snap points, settle on the nearest panel. */
  function settlePager(): void {
    const board = boardRef.current;
    // Desktop: the .board element isn't the scroll container, so nothing to settle.
    if (!board || board.scrollWidth <= board.clientWidth) return;
    goToPanel(measurePagerIndex(board));
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

  const activeLabel = statusLabel(meta, activeStatus);

  return (
    <div className="board-scroll">
      <div className="seg-switcher">
        {shownColumns.map((col, index) => (
          <button
            key={col.id}
            type="button"
            className={index === clampedIndex ? "active" : ""}
            onClick={() => goToPanel(index)}
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
        {shownColumns.map((col, index) => (
          <span key={col.id} className={index === clampedIndex ? "dot active" : "dot"} />
        ))}
      </div>
      {/* Mobile-only "+" — adds a todo to the column currently on screen. */}
      {!readOnly && activeStatus && (
        <AddFab
          label={`Add a todo to ${activeLabel}`}
          onClick={() => setComposerStatus(activeStatus)}
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
