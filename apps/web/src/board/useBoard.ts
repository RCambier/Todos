import { boardOrder, STATUSES, type SheetError, type Status, type Task } from "@todos/sheet-core";
import { useCallback, useEffect, useRef, useState } from "react";
import * as boardApi from "./boardApi.js";
import { computeDropSortOrder } from "./dropOrder.js";

const POLL_INTERVAL_MS = 5000;

export type BoardState =
  | { status: "loading" }
  | { status: "ready"; tasks: Task[] }
  | { status: "malformed"; error: SheetError }
  | { status: "error"; message: string };

export interface UseBoardResult {
  state: BoardState;
  /** When the last successful (or malformed-but-reachable) read completed. */
  lastSyncedAt: Date | null;
  addTask: (input: { title: string; notes?: string; status: Status }) => Promise<void>;
  updateTask: (id: string, patch: { title?: string; notes?: string }) => Promise<void>;
  /** Moves a task to `status`, inserting it at `dropIndex` among that column's other tasks. */
  moveTask: (id: string, status: Status, dropIndex: number) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Owns board state for one spreadsheet: polls every 5s while the tab is
 * visible (paused when hidden, refreshed immediately on focus/visible), and
 * exposes optimistic mutations. Every mutation re-locates its row by task id
 * against a fresh read before writing (see board/boardApi.ts) — this hook
 * only ever updates local state ahead of that write, for a snappy UI.
 */
export function useBoard(token: string | null, spreadsheetId: string | null): UseBoardResult {
  const [state, setState] = useState<BoardState>({ status: "loading" });
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!token || !spreadsheetId) return;
    try {
      const result = await boardApi.fetchBoard(token, spreadsheetId);
      setLastSyncedAt(new Date());
      if (result.ok) {
        setState({ status: "ready", tasks: boardOrder(result.tasks, STATUSES) });
      } else {
        setState({ status: "malformed", error: result.error });
      }
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [token, spreadsheetId]);

  useEffect(() => {
    if (!token || !spreadsheetId) return;
    void refresh();

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

    startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", refresh);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", refresh);
    };
  }, [token, spreadsheetId, refresh]);

  const addTask = useCallback(
    async (input: { title: string; notes?: string; status: Status }) => {
      if (!token || !spreadsheetId || stateRef.current.status !== "ready") return;
      const columnOrders = stateRef.current.tasks
        .filter((t) => t.status === input.status)
        .map((t) => t.sortOrder);
      const task = boardApi.buildNewTask(columnOrders, input);

      setState({ status: "ready", tasks: boardOrder([...stateRef.current.tasks, task], STATUSES) });
      try {
        await boardApi.appendTask(token, spreadsheetId, task);
      } catch {
        await refresh();
      }
    },
    [token, spreadsheetId, refresh],
  );

  const updateTask = useCallback(
    async (id: string, patch: { title?: string; notes?: string }) => {
      if (!token || !spreadsheetId || stateRef.current.status !== "ready") return;
      const now = new Date().toISOString();
      const optimistic = stateRef.current.tasks.map((t) =>
        t.id === id ? { ...t, ...patch, updatedAt: now } : t,
      );
      setState({ status: "ready", tasks: optimistic });
      try {
        await boardApi.editTask(token, spreadsheetId, id, patch);
      } catch {
        await refresh();
      }
    },
    [token, spreadsheetId, refresh],
  );

  const moveTask = useCallback(
    async (id: string, status: Status, dropIndex: number) => {
      if (!token || !spreadsheetId || stateRef.current.status !== "ready") return;
      const destColumn = stateRef.current.tasks.filter((t) => t.status === status && t.id !== id);
      const sortOrder = computeDropSortOrder(destColumn, dropIndex);
      const now = new Date().toISOString();
      const optimistic = boardOrder(
        stateRef.current.tasks.map((t) => (t.id === id ? { ...t, status, sortOrder, updatedAt: now } : t)),
        STATUSES,
      );
      setState({ status: "ready", tasks: optimistic });
      try {
        await boardApi.relocateTask(token, spreadsheetId, id, status, sortOrder);
      } catch {
        await refresh();
      }
    },
    [token, spreadsheetId, refresh],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      if (!token || !spreadsheetId || stateRef.current.status !== "ready") return;
      const optimistic = stateRef.current.tasks.filter((t) => t.id !== id);
      setState({ status: "ready", tasks: optimistic });
      try {
        await boardApi.removeTask(token, spreadsheetId, id);
      } catch {
        await refresh();
      }
    },
    [token, spreadsheetId, refresh],
  );

  return { state, lastSyncedAt, addTask, updateTask, moveTask, deleteTask, refresh };
}
