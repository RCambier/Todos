import {
  applyMemoriesPending,
  enqueueMemoryOp,
  MalformedSheetError,
  MemoryNotFoundError,
  memoriesOrder,
  type Memory,
  type MemoryPendingOp,
  type SheetError,
} from "@memoria/sheet-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/http.js";
import {
  readMemoriesOutbox,
  readMemoriesReplica,
  writeMemoriesOutbox,
  writeMemoriesReplica,
  type PersistedMemoriesReplica,
} from "../lib/storage.js";
import * as memoriesApi from "./memoriesApi.js";

const POLL_INTERVAL_MS = 5000;

type MemoriesState =
  | { status: "loading" }
  | { status: "ready"; memories: Memory[] }
  | { status: "malformed"; error: SheetError }
  | { status: "error"; message: string };

interface UseMemoriesResult {
  state: MemoriesState;
  /** When the last successful (or malformed-but-reachable) read completed. */
  lastSyncedAt: Date | null;
  /** True while the sheet can't be reached; memories keep working locally. */
  offline: boolean;
  /** Local mutations not yet confirmed against the sheet. */
  pendingCount: number;
  /** Google rejected the queued write (not a connectivity problem) — shown so a wedged queue is never silent. */
  writeRejected: string | null;
  // No addMemory: memories are recorded by agents through the MCP tools, never
  // composed in the web UI. The hook still *flushes* pending "add" ops so an
  // outbox from an older client drains safely — it just never enqueues one.
  updateMemory: (
    id: string,
    patch: { title?: string; body?: string; tags?: string[]; expiresAt?: string },
  ) => void;
  deleteMemory: (id: string) => void;
  refresh: () => Promise<void>;
}

/** One memories sheet's local-first state: the last server snapshot plus the pending-op queue. */
interface LocalMemories {
  sheetId: string | null;
  replica: PersistedMemoriesReplica | null;
  outbox: MemoryPendingOp[];
}

function loadLocal(sheetId: string | null): LocalMemories {
  if (!sheetId) return { sheetId, replica: null, outbox: [] };
  return { sheetId, replica: readMemoriesReplica(sheetId), outbox: readMemoriesOutbox(sheetId) };
}

/**
 * Owns AI Memories state for one spreadsheet — the memories twin of
 * `useNotes`, same local-first scheme (projection = replica + outbox,
 * single-flight flusher, epoch-guarded polls).
 */
export function useMemories(token: string | null, spreadsheetId: string | null): UseMemoriesResult {
  const [local, setLocal] = useState<LocalMemories>(() => loadLocal(spreadsheetId));
  const [malformed, setMalformed] = useState<SheetError | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [writeRejected, setWriteRejected] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Reset local state when the sheet changes — render-time-with-guard, so no
  // frame shows sheet A's memories under sheet B.
  if (local.sheetId !== spreadsheetId) {
    setLocal(loadLocal(spreadsheetId));
    setMalformed(null);
    setFetchError(null);
    setWriteRejected(null);
    setLastSyncedAt(null);
  }

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
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist on every change, keyed by the sheet the state belongs to.
  useEffect(() => {
    if (!local.sheetId) return;
    if (local.replica) writeMemoriesReplica(local.sheetId, local.replica);
    writeMemoriesOutbox(local.sheetId, local.outbox);
  }, [local]);

  const projection = useMemo(
    () => (local.replica ? memoriesOrder(applyMemoriesPending(local.replica.memories, local.outbox)) : null),
    [local],
  );
  const projectionRef = useRef(projection);
  projectionRef.current = projection;

  const setOutbox = useCallback((sheetId: string, ops: MemoryPendingOp[]) => {
    setLocal((l) => (l.sheetId === sheetId ? { ...l, outbox: ops } : l));
  }, []);

  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const flush = useCallback(async (): Promise<void> => {
    if (flushing.current) return;
    flushing.current = true;
    let confirmedWrites = 0;
    try {
      for (;;) {
        const t = tokenRef.current;
        const sheetId = localRef.current.sheetId;
        const op = localRef.current.outbox[0];
        if (!t || !sheetId || !op || malformedRef.current) break;

        try {
          if (op.kind === "add") {
            // Replay-safe at the source of truth: appendMemory re-reads the
            // sheet and skips if this id already landed (response lost, page
            // reloaded), so a retry can never write the row twice. See
            // sheet-core appendMemoryIfAbsent.
            await memoriesApi.appendMemory(t, sheetId, op.memory);
          } else if (op.kind === "edit") {
            await memoriesApi.editMemory(t, sheetId, op.id, op.patch);
          } else {
            await memoriesApi.removeMemory(t, sheetId, op.id);
          }
          syncEpoch.current++;
          confirmedWrites++;
          setFetchError(null);
          setWriteRejected(null);
        } catch (err) {
          if (err instanceof MemoryNotFoundError) {
            // The target vanished remotely — drop the op; the sheet wins.
          } else if (err instanceof MalformedSheetError) {
            setMalformed(err.error);
            break;
          } else {
            // Park the queue; 'online'/next poll retries. A Google rejection
            // is surfaced separately — retrying alone will never fix it.
            setFetchError(err instanceof Error ? err.message : String(err));
            if (err instanceof ApiError) setWriteRejected(err.message);
            break;
          }
        }

        // Commit the op into the replica in the SAME update that removes it
        // from the queue (see useBoard for the flash-of-old-state rationale).
        const cur = localRef.current;
        const rest = cur.outbox.slice(1);
        const replica = cur.replica
          ? { ...cur.replica, memories: applyMemoriesPending(cur.replica.memories, [op]) }
          : cur.replica;
        localRef.current = { ...cur, outbox: rest, replica };
        setLocal((l) => (l.sheetId === sheetId ? { ...l, outbox: rest, replica } : l));
      }
    } finally {
      flushing.current = false;
    }
    // Reconcile immediately after a drain (see useBoard).
    if (confirmedWrites > 0 && localRef.current.outbox.length === 0) {
      void refreshRef.current();
    }
  }, [setOutbox]);

  const refresh = useCallback(async (): Promise<void> => {
    const t = tokenRef.current;
    const sheetId = localRef.current.sheetId;
    if (!t || !sheetId || pollInFlight.current) return;
    pollInFlight.current = true;
    const epochAtStart = syncEpoch.current;
    let rerunStale = false;
    try {
      const result = await memoriesApi.fetchMemories(t, sheetId);
      if (localRef.current.sheetId !== sheetId) {
        // Sheet switched mid-read — drop the snapshot.
      } else if (syncEpoch.current !== epochAtStart) {
        rerunStale = true;
      } else {
        setLastSyncedAt(new Date());
        setFetchError(null);
        if (result.ok) {
          setMalformed(null);
          const replica: PersistedMemoriesReplica = {
            memories: result.memories,
            fetchedAt: new Date().toISOString(),
          };
          localRef.current = { ...localRef.current, replica };
          setLocal((l) => (l.sheetId === sheetId ? { ...l, replica } : l));
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
    (op: MemoryPendingOp) => {
      const sheetId = localRef.current.sheetId;
      if (!sheetId) return;
      const ops = enqueueMemoryOp(localRef.current.outbox, op);
      localRef.current = { ...localRef.current, outbox: ops };
      setOutbox(sheetId, ops);
      void flush();
    },
    [flush, setOutbox],
  );

  const updateMemory = useCallback(
    (id: string, patch: { title?: string; body?: string; tags?: string[]; expiresAt?: string }) => {
      enqueue({ kind: "edit", id, patch, at: new Date().toISOString() });
    },
    [enqueue],
  );

  const deleteMemory = useCallback(
    (id: string) => {
      enqueue({ kind: "delete", id });
    },
    [enqueue],
  );

  const state: MemoriesState = malformed
    ? { status: "malformed", error: malformed }
    : projection
      ? { status: "ready", memories: projection }
      : fetchError
        ? { status: "error", message: fetchError }
        : { status: "loading" };

  return {
    state,
    lastSyncedAt,
    offline: fetchError !== null,
    pendingCount: local.outbox.length,
    writeRejected: local.outbox.length > 0 ? writeRejected : null,
    updateMemory,
    deleteMemory,
    refresh,
  };
}
