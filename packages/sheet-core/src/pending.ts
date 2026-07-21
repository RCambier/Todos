import { mergeSchedule, resolveMove } from "./schedule.js";
import type { Recurrence, Status, Task } from "./types.js";

/**
 * The local-first layer's vocabulary: a **pending op** is a mutation the user
 * has made locally that hasn't been confirmed against the sheet yet. The UI
 * renders a **projection** — the last known server state (the *replica*)
 * with the pending ops applied on top — so local changes are visible
 * instantly and can never be clobbered by a stale poll. The web app's
 * flusher drains ops in order through the board operations (`board.ts`);
 * this module is the pure half: applying and queueing ops.
 *
 * Task ids are client-generated (`generateId`), which is what makes the
 * whole scheme replay-safe: an `add` can be recognised in the replica after
 * the fact, and every other op targets an id.
 */
export type PendingOp =
  | { kind: "add"; task: Task }
  | {
      kind: "edit";
      id: string;
      patch: {
        title?: string;
        notes?: string;
        dueDate?: string;
        blockedUntil?: string;
        tags?: string[];
        recurs?: Recurrence;
      };
      /** ISO timestamp of the local edit — becomes `updatedAt` in the projection. */
      at: string;
    }
  | { kind: "move"; id: string; status: Status; sortOrder: number; at: string }
  | { kind: "delete"; id: string };

/**
 * Pure projection: the replica's tasks with every pending op applied, in
 * order. Ops referencing ids that no longer exist (deleted remotely) are
 * skipped; an `add` whose id is already in the replica (its flush landed and
 * a poll caught up) is skipped too. The result is NOT board-ordered —
 * callers order it like any other task list.
 */
export function applyPending(
  tasks: readonly Task[],
  ops: readonly PendingOp[],
  /** Which column counts as "done" (the recurrence trigger) for this board. */
  doneStatus: string = "done",
): Task[] {
  const result = tasks.map((t) => ({ ...t }));
  for (const op of ops) {
    switch (op.kind) {
      case "add": {
        if (!result.some((t) => t.id === op.task.id)) result.push({ ...op.task });
        break;
      }
      case "edit": {
        const t = result.find((x) => x.id === op.id);
        if (!t) break;
        if (op.patch.title !== undefined) t.title = op.patch.title;
        if (op.patch.notes !== undefined) t.notes = op.patch.notes;
        // Same either/or rule as board.updateTask, so the projection never
        // disagrees with what the flushed write will produce.
        Object.assign(t, mergeSchedule(t, op.patch));
        if (op.patch.tags !== undefined) t.tags = [...op.patch.tags];
        if (op.patch.recurs !== undefined) t.recurs = op.patch.recurs;
        t.updatedAt = op.at;
        break;
      }
      case "move": {
        const t = result.find((x) => x.id === op.id);
        if (!t) break;
        // Same recurrence rule as board.moveTask: completing a yearly task
        // re-dates it in place, so the projection matches the flushed write.
        const { redated } = resolveMove(t, op.status, op.at.slice(0, 10), doneStatus);
        if (redated) {
          Object.assign(t, mergeSchedule(t, redated));
        } else {
          t.status = op.status;
          t.sortOrder = op.sortOrder;
        }
        t.updatedAt = op.at;
        break;
      }
      case "delete": {
        const i = result.findIndex((x) => x.id === op.id);
        if (i !== -1) result.splice(i, 1);
        break;
      }
    }
  }
  return result;
}

/**
 * Appends an op to the queue, collapsing where that yields an equivalent but
 * shorter queue (fewer network round-trips at flush time, no lost intent):
 *
 * - edit/move on a still-pending `add` folds into the add itself.
 * - delete of a still-pending `add` cancels the add (and any ops on it) —
 *   the task never existed remotely.
 * - consecutive intent on the same task merges: edit+edit merges patches
 *   (later fields win), move+move keeps the last destination.
 * - delete drops any earlier edits/moves for that id (they'd be wasted
 *   writes on a row about to disappear).
 */
export function enqueueOp(ops: readonly PendingOp[], op: PendingOp): PendingOp[] {
  const next = [...ops];

  const pendingAddIndex = (id: string): number => next.findIndex((o) => o.kind === "add" && o.task.id === id);

  switch (op.kind) {
    case "add": {
      next.push(op);
      return next;
    }
    case "edit": {
      const addIdx = pendingAddIndex(op.id);
      if (addIdx !== -1) {
        const add = next[addIdx] as Extract<PendingOp, { kind: "add" }>;
        next[addIdx] = {
          kind: "add",
          task: {
            ...add.task,
            title: op.patch.title ?? add.task.title,
            notes: op.patch.notes ?? add.task.notes,
            ...mergeSchedule(add.task, op.patch),
            tags: op.patch.tags ? [...op.patch.tags] : add.task.tags,
            recurs: op.patch.recurs ?? add.task.recurs,
            updatedAt: op.at,
          },
        };
        return next;
      }
      const last = next[next.length - 1];
      if (last && last.kind === "edit" && last.id === op.id) {
        next[next.length - 1] = {
          kind: "edit",
          id: op.id,
          patch: { ...last.patch, ...op.patch },
          at: op.at,
        };
        return next;
      }
      next.push(op);
      return next;
    }
    case "move": {
      const addIdx = pendingAddIndex(op.id);
      if (addIdx !== -1) {
        const add = next[addIdx] as Extract<PendingOp, { kind: "add" }>;
        next[addIdx] = {
          kind: "add",
          task: { ...add.task, status: op.status, sortOrder: op.sortOrder, updatedAt: op.at },
        };
        return next;
      }
      const last = next[next.length - 1];
      if (last && last.kind === "move" && last.id === op.id) {
        next[next.length - 1] = op;
        return next;
      }
      next.push(op);
      return next;
    }
    case "delete": {
      const addIdx = pendingAddIndex(op.id);
      const filtered = next.filter((o) => {
        if (o.kind === "add") return o.task.id !== op.id;
        return o.id !== op.id;
      });
      // If the add was still pending, the task never reached the sheet —
      // dropping every op for the id IS the delete.
      if (addIdx !== -1) return filtered;
      filtered.push(op);
      return filtered;
    }
  }
}
