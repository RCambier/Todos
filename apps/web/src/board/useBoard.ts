import {
  applyPending,
  boardOrder,
  enqueueOp,
  MalformedSheetError,
  STATUSES,
  TaskNotFoundError,
  type PendingOp,
  type Recurrence,
  type SheetError,
  type Status,
  type Task,
} from "@memoria/sheet-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/http.js";
import { writeHeaderRow } from "../api/sheets.js";
import { readOutbox, readReplica, writeOutbox, writeReplica, type PersistedReplica } from "../lib/storage.js";
import * as boardApi from "./boardApi.js";
import { computeDropSortOrder } from "./dropOrder.js";

const POLL_INTERVAL_MS = 5000;

type BoardState =
  | { status: "loading" }
  | { status: "ready"; tasks: Task[] }
  | { status: "malformed"; error: SheetError }
  | { status: "error"; message: string };

interface UseBoardResult {
  state: BoardState;
  /** When the last successful (or malformed-but-reachable) read completed. */
  lastSyncedAt: Date | null;
  /** True while the sheet can't be reached; the board keeps working locally. */
  offline: boolean;
  /** Local mutations not yet confirmed against the sheet. */
  pendingCount: number;
  /** Google rejected the queued write (not a connectivity problem) — shown so a wedged queue is never silent. */
  writeRejected: string | null;
  addTask: (input: {
    title: string;
    notes?: string;
    status: Status;
    dueDate?: string;
    blockedUntil?: string;
    tags?: string[];
  }) => Promise<void>;
  updateTask: (
    id: string,
    patch: {
      title?: string;
      notes?: string;
      dueDate?: string;
      blockedUntil?: string;
      tags?: string[];
      recurs?: Recurrence;
    },
  ) => Promise<void>;
  /** Moves a task to `status`, inserting it at `dropIndex` among that column's other tasks. */
  moveTask: (id: string, status: Status, dropIndex: number) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/** One board's local-first state: the last server snapshot plus the pending-op queue. */
interface LocalBoard {
  boardId: string | null;
  replica: PersistedReplica | null;
  outbox: PendingOp[];
}

function loadLocal(boardId: string | null): LocalBoard {
  if (!boardId) return { boardId, replica: null, outbox: [] };
  return { boardId, replica: readReplica(boardId), outbox: readOutbox(boardId) };
}

/**
 * Owns board state for one spreadsheet, local-first:
 *
 * - The UI renders a **projection**: the last known server state (the
 *   *replica*, persisted per board) with the pending local mutations (the
 *   *outbox*, also persisted) applied on top — so every mutation is visible
 *   instantly, a reload paints the board before any network round-trip, and
 *   a stale poll can never clobber a local change.
 * - Polls (every 5s while visible, plus focus/online) update only the
 *   replica. A poll whose read started before a flush completed is
 *   discarded (`syncEpoch`), so the projection never regresses.
 * - A single-flight **flusher** drains the outbox in order through the
 *   sheet-core board operations (fresh read → locate by id → write one
 *   row). Network failure parks the queue — offline just means the outbox
 *   grows until connectivity returns. Replay is safe: task ids are
 *   client-generated, so an `add` whose row already landed is skipped, and
 *   ops on remotely-deleted tasks are dropped.
 */
export function useBoard(
  token: string | null,
  spreadsheetId: string | null,
  /** The board's column ids, left to right — drives projection grouping. */
  columnOrder: readonly string[] = STATUSES,
  /** Which column counts as "done" (the recurrence trigger). */
  doneStatus: string = "done",
): UseBoardResult {
  const [local, setLocal] = useState<LocalBoard>(() => loadLocal(spreadsheetId));
  const [malformed, setMalformed] = useState<SheetError | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [writeRejected, setWriteRejected] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Reset local state when the board changes — the render-time-with-guard
  // pattern, so there is no frame where board A's state shows under board B.
  if (local.boardId !== spreadsheetId) {
    setLocal(loadLocal(spreadsheetId));
    setMalformed(null);
    setFetchError(null);
    setWriteRejected(null);
    setLastSyncedAt(null);
  }

  // Latest values for async code (flusher, poll) without re-subscribing.
  const localRef = useRef(local);
  localRef.current = local;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const malformedRef = useRef(malformed);
  malformedRef.current = malformed;

  const pollInFlight = useRef(false);
  const flushing = useRef(false);
  /** Bumped after every confirmed write; polls that predate a bump are discarded. */
  const syncEpoch = useRef(0);
  const upgradedHeader = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist on every change, keyed by the board the state belongs to.
  useEffect(() => {
    if (!local.boardId) return;
    if (local.replica) writeReplica(local.boardId, local.replica);
    writeOutbox(local.boardId, local.outbox);
  }, [local]);

  const projection = useMemo(
    () =>
      local.replica
        ? boardOrder(applyPending(local.replica.tasks, local.outbox, doneStatus), columnOrder)
        : null,
    [local, columnOrder, doneStatus],
  );
  const projectionRef = useRef(projection);
  projectionRef.current = projection;

  /** Mutates the outbox for the current board only. */
  const setOutbox = useCallback((boardId: string, ops: PendingOp[]) => {
    setLocal((l) => (l.boardId === boardId ? { ...l, outbox: ops } : l));
  }, []);

  // flush → refresh would be a circular useCallback dependency; a ref breaks it.
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const flush = useCallback(async (): Promise<void> => {
    if (flushing.current) return;
    flushing.current = true;
    let confirmedWrites = 0;
    try {
      for (;;) {
        const t = tokenRef.current;
        const boardId = localRef.current.boardId;
        const op = localRef.current.outbox[0];
        if (!t || !boardId || !op || malformedRef.current) break;

        try {
          if (op.kind === "add") {
            // Replay-safe at the source of truth: appendTask re-reads the sheet
            // and skips if this id already landed (response lost, page reloaded),
            // so a retry can never write the row twice. See sheet-core
            // appendTaskIfAbsent — the local replica is not consulted here.
            await boardApi.appendTask(t, boardId, op.task);
          } else if (op.kind === "edit") {
            await boardApi.editTask(t, boardId, op.id, op.patch);
          } else if (op.kind === "move") {
            await boardApi.relocateTask(t, boardId, op.id, op.status, op.sortOrder);
          } else {
            await boardApi.removeTask(t, boardId, op.id);
          }
          syncEpoch.current++;
          confirmedWrites++;
          setFetchError(null);
          setWriteRejected(null);
        } catch (err) {
          if (err instanceof TaskNotFoundError) {
            // The target vanished remotely — drop the op; the sheet wins.
          } else if (err instanceof MalformedSheetError) {
            setMalformed(err.error);
            break;
          } else {
            // Park the queue; 'online'/next poll retries. A Google rejection
            // (e.g. a cell over the 50k limit written by an older client) is
            // surfaced separately — retrying alone will never fix it, and the
            // "Offline" label would be a lie.
            setFetchError(err instanceof Error ? err.message : String(err));
            if (err instanceof ApiError) setWriteRejected(err.message);
            break;
          }
        }

        // Confirmed (or dropped) — commit the op into the local replica in
        // the SAME update that removes it from the queue: popping alone
        // would make the projection regress to the pre-write snapshot until
        // the reconcile fetch lands (a visible flash of the old state).
        // Applying a dropped op is harmless — applyPending skips ops whose
        // target is gone. The ref updates eagerly so this loop sees the
        // shorter queue; state follows on the next render.
        const cur = localRef.current;
        const rest = cur.outbox.slice(1);
        const replica = cur.replica
          ? { ...cur.replica, tasks: applyPending(cur.replica.tasks, [op]) }
          : cur.replica;
        localRef.current = { ...cur, outbox: rest, replica };
        setLocal((l) => (l.boardId === boardId ? { ...l, outbox: rest, replica } : l));
      }
    } finally {
      flushing.current = false;
    }
    // Reconcile immediately after a drain: pull the post-write server state
    // into the replica (and its persisted copy) instead of waiting for the
    // next poll — otherwise a reload in that window boots from a snapshot
    // that predates the writes just confirmed.
    if (confirmedWrites > 0 && localRef.current.outbox.length === 0) {
      void refreshRef.current();
    }
  }, [setOutbox]);

  const refresh = useCallback(async (): Promise<void> => {
    const t = tokenRef.current;
    const boardId = localRef.current.boardId;
    if (!t || !boardId || pollInFlight.current) return;
    pollInFlight.current = true;
    const epochAtStart = syncEpoch.current;
    let rerunStale = false;
    try {
      const result = await boardApi.fetchBoard(t, boardId);
      if (localRef.current.boardId !== boardId) {
        // Board switched mid-read — drop the snapshot.
      } else if (syncEpoch.current !== epochAtStart) {
        // A write landed while this read was in flight: the snapshot is
        // stale AND the sheet has newer state — refetch below rather than
        // waiting a poll interval.
        rerunStale = true;
      } else {
        setLastSyncedAt(new Date());
        setFetchError(null);
        if (result.ok) {
          setMalformed(null);
          const replica: PersistedReplica = {
            tasks: result.tasks,
            fetchedAt: new Date().toISOString(),
          };
          localRef.current = { ...localRef.current, replica };
          setLocal((l) => (l.boardId === boardId ? { ...l, replica } : l));
          // Older boards predate the due_date/tags columns. Extend the header
          // row in place, once — purely additive; task rows are never touched.
          if (result.legacyHeader && !upgradedHeader.current) {
            upgradedHeader.current = true;
            writeHeaderRow(t, boardId).catch(() => {
              upgradedHeader.current = false;
            });
          }
          if (localRef.current.outbox.length > 0) void flush();
        } else {
          setMalformed(result.error);
        }
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      pollInFlight.current = false;
    }
    if (rerunStale) await refreshRef.current();
  }, [flush]);
  refreshRef.current = refresh;

  // Poll while visible; refresh + flush on focus, visibility, and reconnect.
  useEffect(() => {
    if (!token || !spreadsheetId) return;
    void refresh();
    void flush();

    function startPolling(): void {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(() => {
        if (!document.hidden) void refresh();
      }, POLL_INTERVAL_MS);
    }
    function stopPolling(): void {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    }
    function onVisibilityChange(): void {
      if (document.hidden) {
        stopPolling();
      } else {
        void refresh();
        startPolling();
      }
    }
    function onFocus(): void {
      void refresh();
    }
    function onOnline(): void {
      void flush();
      void refresh();
    }

    startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [token, spreadsheetId, refresh, flush]);

  /** Queues a local mutation and kicks the flusher. Instant — never awaits the network. */
  const enqueue = useCallback(
    (op: PendingOp) => {
      const boardId = localRef.current.boardId;
      if (!boardId) return;
      const ops = enqueueOp(localRef.current.outbox, op);
      localRef.current = { ...localRef.current, outbox: ops };
      setOutbox(boardId, ops);
      void flush();
    },
    [flush, setOutbox],
  );

  const addTask = useCallback(
    async (input: {
      title: string;
      notes?: string;
      status: Status;
      dueDate?: string;
      blockedUntil?: string;
      tags?: string[];
    }) => {
      const tasks = projectionRef.current;
      if (!tasks) return;
      const columnOrders = tasks.filter((t) => t.status === input.status).map((t) => t.sortOrder);
      enqueue({ kind: "add", task: boardApi.buildNewTask(columnOrders, input) });
    },
    [enqueue],
  );

  const updateTask = useCallback(
    async (
      id: string,
      patch: {
        title?: string;
        notes?: string;
        dueDate?: string;
        blockedUntil?: string;
        tags?: string[];
        recurs?: Recurrence;
      },
    ) => {
      enqueue({ kind: "edit", id, patch, at: new Date().toISOString() });
    },
    [enqueue],
  );

  const moveTask = useCallback(
    async (id: string, status: Status, dropIndex: number) => {
      const tasks = projectionRef.current;
      if (!tasks) return;
      const destColumn = tasks.filter((t) => t.status === status && t.id !== id);
      const sortOrder = computeDropSortOrder(destColumn, dropIndex);
      enqueue({ kind: "move", id, status, sortOrder, at: new Date().toISOString() });
    },
    [enqueue],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      enqueue({ kind: "delete", id });
    },
    [enqueue],
  );

  const state: BoardState = malformed
    ? { status: "malformed", error: malformed }
    : projection
      ? { status: "ready", tasks: projection }
      : fetchError
        ? { status: "error", message: fetchError }
        : { status: "loading" };

  return {
    state,
    lastSyncedAt,
    offline: fetchError !== null,
    pendingCount: local.outbox.length,
    writeRejected: local.outbox.length > 0 ? writeRejected : null,
    addTask,
    updateTask,
    moveTask,
    deleteTask,
    refresh,
  };
}
