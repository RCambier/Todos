import type { Task } from "@memoria/sheet-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyMirrorOp, ensureMemoriaList, listMirrorTasks } from "./gtasksApi.js";
import { planMirror, scheduledDate } from "./mirrorDiff.js";

/** Reconcile at most this often when nothing changed (drift repair). */
const IDLE_INTERVAL_MS = 5 * 60 * 1000;
/** Back off this long after a failed attempt. */
const RETRY_INTERVAL_MS = 60 * 1000;

/**
 * What the mirror is actually doing — surfaced in Settings. Without this a
 * failure (revoked scope, Tasks API disabled in the Cloud project, network)
 * was invisible: Settings said "On" while nothing ever reached Google.
 */
export type MirrorStatus =
  | { state: "idle" }
  | { state: "syncing" }
  | { state: "synced"; at: number; mirrored: number }
  | { state: "error"; message: string };

/**
 * Runs the one-way Google Tasks mirror (see mirrorDiff.ts) from the board
 * loop: immediately when the dated-tasks fingerprint changes, and every few
 * minutes otherwise to repair outside drift (someone editing the "Memoria"
 * list by hand). Single-flight, throttled, silent on failure — the mirror
 * is cosmetic; the board never depends on it.
 */
export function useTasksMirror(opts: {
  token: string | null;
  boardId: string | null;
  /** The board's current (projected) tasks, or null while loading. */
  tasks: readonly Task[] | null;
  /** The board's done-role column id (or null) — tasks there mirror as completed. */
  doneStatus: string | null;
  active: boolean;
}): MirrorStatus {
  const { token, boardId, tasks, doneStatus, active } = opts;
  const [status, setStatus] = useState<MirrorStatus>({ state: "idle" });

  // Everything the mirror renders from, in one comparable string.
  const fingerprint = useMemo(() => {
    if (!tasks) return null;
    return tasks
      .filter((t) => scheduledDate(t) !== "")
      .map((t) => [t.id, t.title, t.notes, scheduledDate(t), t.status === doneStatus ? "c" : "n"].join("|"))
      .sort()
      .join("\n");
  }, [tasks, doneStatus]);

  const running = useRef(false);
  const listIdRef = useRef<string | null>(null);
  const lastSynced = useRef<{ boardId: string; fingerprint: string; at: number } | null>(null);
  const lastFailureAt = useRef(0);

  useEffect(() => {
    if (!active || !token || !boardId || fingerprint === null || running.current) return;

    const synced = lastSynced.current;
    const unchanged = synced?.boardId === boardId && synced.fingerprint === fingerprint;
    const now = Date.now();
    if (unchanged && now - (synced?.at ?? 0) < IDLE_INTERVAL_MS) return;
    // Back off after a failure whether or not anything changed. Gating this on
    // `unchanged` meant a failing mirror retried on every single render —
    // `unchanged` is false precisely when the last attempt never succeeded.
    if (now - lastFailureAt.current < RETRY_INTERVAL_MS) return;

    running.current = true;
    setStatus({ state: "syncing" });
    void (async () => {
      try {
        listIdRef.current ??= await ensureMemoriaList(token);
        const googleTasks = await listMirrorTasks(token, listIdRef.current);
        const ops = planMirror(boardId, tasks ?? [], googleTasks, doneStatus);
        for (const op of ops) await applyMirrorOp(token, listIdRef.current, op);
        lastSynced.current = { boardId, fingerprint, at: Date.now() };
        lastFailureAt.current = 0;
        const mirrored = (tasks ?? []).filter(
          (t) => scheduledDate(t) !== "" && t.status !== doneStatus,
        ).length;
        setStatus({ state: "synced", at: Date.now(), mirrored });
      } catch (err) {
        // Offline, revoked scope, Tasks API disabled in the Cloud project, or a
        // Google hiccup. Report it — a mirror that silently does nothing while
        // Settings reads "On" is the worst possible failure mode.
        lastFailureAt.current = Date.now();
        listIdRef.current = null;
        setStatus({ state: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        running.current = false;
      }
    })();
  }, [active, token, boardId, fingerprint, tasks, doneStatus]);

  return status;
}
