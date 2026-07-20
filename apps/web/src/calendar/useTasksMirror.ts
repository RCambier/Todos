import type { Task } from "@memoria/sheet-core";
import { useEffect, useMemo, useRef } from "react";
import { applyMirrorOp, ensureMemoriaList, listMirrorTasks } from "./gtasksApi.js";
import { planMirror } from "./mirrorDiff.js";

/** Reconcile at most this often when nothing changed (drift repair). */
const IDLE_INTERVAL_MS = 5 * 60 * 1000;
/** Back off this long after a failed attempt. */
const RETRY_INTERVAL_MS = 60 * 1000;

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
  active: boolean;
}): void {
  const { token, boardId, tasks, active } = opts;

  // Everything the mirror renders from, in one comparable string.
  const fingerprint = useMemo(() => {
    if (!tasks) return null;
    return tasks
      .filter((t) => t.dueDate !== "")
      .map((t) => [t.id, t.title, t.notes, t.dueDate, t.status === "done" ? "c" : "n"].join("|"))
      .sort()
      .join("\n");
  }, [tasks]);

  const running = useRef(false);
  const listIdRef = useRef<string | null>(null);
  const lastSynced = useRef<{ boardId: string; fingerprint: string; at: number } | null>(null);
  const lastAttempt = useRef(0);

  useEffect(() => {
    if (!active || !token || !boardId || fingerprint === null || running.current) return;

    const synced = lastSynced.current;
    const unchanged = synced?.boardId === boardId && synced.fingerprint === fingerprint;
    const now = Date.now();
    if (unchanged && now - (synced?.at ?? 0) < IDLE_INTERVAL_MS) return;
    if (now - lastAttempt.current < RETRY_INTERVAL_MS && unchanged) return;

    running.current = true;
    lastAttempt.current = now;
    void (async () => {
      try {
        listIdRef.current ??= await ensureMemoriaList(token);
        const googleTasks = await listMirrorTasks(token, listIdRef.current);
        const ops = planMirror(boardId, tasks ?? [], googleTasks);
        for (const op of ops) await applyMirrorOp(token, listIdRef.current, op);
        lastSynced.current = { boardId, fingerprint, at: Date.now() };
      } catch {
        // Offline, revoked scope, or a Google hiccup — the next window retries.
        listIdRef.current = null;
      } finally {
        running.current = false;
      }
    })();
  }, [active, token, boardId, fingerprint, tasks]);
}
